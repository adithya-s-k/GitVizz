"""
Graph-based documentation analyzer.

"""

import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
import networkx as nx

# Add gitvizz to path for imports
gitvizz_path = Path(__file__).parent.parent.parent / "gitvizz"
if str(gitvizz_path) not in sys.path:
    sys.path.insert(0, str(gitvizz_path))

from gitvizz.graph_generator import GraphGenerator
from gitvizz.graph_search_tool import GraphSearchTool


@dataclass
class DocTopic:
    """Represents a documentation topic/page derived from code analysis."""
    id: str
    title: str
    description: str = ""
    node_ids: List[str] = field(default_factory=list)
    primary_files: List[str] = field(default_factory=list)
    importance: int = 3  # 1-5 scale
    topic_type: str = "component"  # component, api, utility, entry_point, overview
    related_topics: List[str] = field(default_factory=list)
    mermaid_diagram: str = ""
    llm_context: str = ""


@dataclass
class ClusterContext:
    """Rich context for a code cluster to pass to LLM."""
    cluster_name: str
    primary_files: List[str]
    nodes: List[Dict[str, Any]]
    relationships: List[Dict[str, Any]]
    code_snippets: Dict[str, str]  # node_id -> code
    neighbor_context: str  # 1-hop neighbors for context
    mermaid_diagram: str


@dataclass
class FileContext:
    """Rich context for a file derived from graph analysis."""
    role: str  # entry_point, core_logic, utility, data_model, unknown
    importance_score: float
    callers: List[Dict[str, str]]  # [{"name": "...", "file": "..."}]
    callees: List[Dict[str, str]]  # [{"name": "...", "file": "..."}]
    imports: List[str]
    exported_functions: List[str]
    cluster_siblings: List[str]  # Related files by connection patterns


class GraphDocAnalyzer:
    """
    Analyzes code graphs to determine documentation structure.
    
    This is the bridge between GitVizz's AST-parsed graph data and
    the documentation generator. Instead of using raw text search,
    we use graph structure to:
    1. Find logical clusters/components
    2. Identify important hub nodes
    3. Generate accurate Mermaid diagrams
    4. Build rich LLM context with relationships
    """
    
    def __init__(self, graph_generator: GraphGenerator):
        """
        Initialize with a parsed GraphGenerator.
        
        Args:
            graph_generator: A GraphGenerator instance that has already
                           called generate() to parse the codebase.
        """
        self.graph = graph_generator
        self.search_tool = GraphSearchTool(graph_generator)
        
        # Build NetworkX graph for analysis
        self.nx_graph = self._build_networkx_graph()
        
        # Cache computed metrics
        self._node_importance: Dict[str, float] = {}
        self._clusters: List[List[str]] = []
    
    def _build_networkx_graph(self) -> nx.DiGraph:
        """Build a NetworkX graph from GraphGenerator data for analysis."""
        G = nx.DiGraph()
        
        # Add nodes with attributes
        for node in self.graph.all_nodes_data:
            node_id = node.get("id", "")
            if node_id:
                G.add_node(
                    node_id,
                    name=node.get("name", ""),
                    category=node.get("category", ""),
                    file=node.get("file", ""),
                    start_line=node.get("start_line", 0),
                    end_line=node.get("end_line", 0),
                    code=node.get("code", ""),
                )
        
        # Add edges
        for edge in self.graph.all_edges_data:
            source = edge.get("source", "")
            target = edge.get("target", "")
            if source and target and source in G and target in G:
                G.add_edge(
                    source, 
                    target, 
                    relationship=edge.get("relationship", "unknown"),
                    file=edge.get("file", ""),
                    line=edge.get("line", 0)
                )
        
        return G
    
    def discover_documentation_topics(self, max_topics: int = 10) -> List[DocTopic]:
        """
        Main method: Discover documentation topics from the code graph.
        
        Uses multiple strategies and combines results:
        1. Community detection for component clusters
        2. Hub nodes for important APIs
        3. Entry points for main flows
        4. Directory structure as fallback
        
        Args:
            max_topics: Maximum number of topics to generate
            
        Returns:
            List of DocTopic objects representing documentation pages
        """
        topics: List[DocTopic] = []
        
        # Get node count for strategy selection
        node_count = len([n for n in self.graph.all_nodes_data 
                         if n.get("category") not in ["directory", "external_symbol"]])
        
        print(f"Graph has {node_count} code nodes, {len(self.graph.all_edges_data)} edges")
        
        # Strategy selection based on repo size
        if node_count >= 30:
            # Large repo: use community detection
            print("Using community detection for large repo")
            cluster_topics = self._discover_by_community_detection()
            topics.extend(cluster_topics[:max_topics - 2])
        elif node_count >= 10:
            # Medium repo: use directory + hub nodes
            print("   Using directory + hub strategy for medium repo")
            dir_topics = self._discover_by_directory_structure()
            hub_topics = self._discover_hub_nodes()
            topics.extend(dir_topics[:max_topics - 3])
            topics.extend(hub_topics[:2])
        else:
            # Small repo: entry points + all modules
            print("Using entry point + module strategy for small repo")
            entry_topics = self._discover_entry_points()
            module_topics = self._discover_all_modules()
            topics.extend(entry_topics)
            topics.extend(module_topics[:max_topics - len(entry_topics) - 1])
        
        # Always add an overview topic
        overview = self._create_overview_topic()
        topics.insert(0, overview)
        
        # Generate context and Mermaid for each topic
        for topic in topics:
            topic.llm_context = self._build_topic_context(topic)
            topic.mermaid_diagram = self._generate_topic_mermaid(topic)
        
        # Limit and deduplicate
        seen_ids = set()
        unique_topics = []
        for t in topics:
            if t.id not in seen_ids:
                seen_ids.add(t.id)
                unique_topics.append(t)
        
        return unique_topics[:max_topics]
    
    def _discover_by_community_detection(self) -> List[DocTopic]:
        """Use Louvain community detection to find code clusters."""
        topics = []
        
        try:
            # Convert to undirected for community detection
            undirected = self.nx_graph.to_undirected()
            
            # Filter to only code nodes (not directories/externals)
            code_nodes = [n for n, d in self.nx_graph.nodes(data=True) 
                         if d.get("category") not in ["directory", "external_symbol", "module"]]
            subgraph = undirected.subgraph(code_nodes)
            
            if len(subgraph.nodes()) < 5:
                return self._discover_by_directory_structure()
            
            # Louvain community detection
            from networkx.algorithms.community import louvain_communities
            communities = louvain_communities(subgraph, resolution=1.0)
            
            for i, community in enumerate(communities):
                if len(community) < 2:
                    continue
                    
                community_list = list(community)
                
                # Get primary files for this cluster
                files = set()
                for node_id in community_list:
                    node_data = self.nx_graph.nodes.get(node_id, {})
                    if node_data.get("file"):
                        files.add(node_data["file"])
                
                # Determine cluster name from common path or most connected node
                cluster_name = self._infer_cluster_name(community_list, list(files))
                
                topic = DocTopic(
                    id=f"cluster-{i}-{cluster_name.lower().replace(' ', '-')}",
                    title=cluster_name,
                    description=f"Component cluster with {len(community_list)} code elements",
                    node_ids=community_list,
                    primary_files=list(files)[:10],
                    importance=min(5, 2 + len(community_list) // 5),
                    topic_type="component"
                )
                topics.append(topic)
                
        except Exception as e:
            print(f"Community detection failed: {e}, falling back to directory structure")
            return self._discover_by_directory_structure()
        
        return sorted(topics, key=lambda t: t.importance, reverse=True)
    
    def _discover_by_directory_structure(self) -> List[DocTopic]:
        """Use directory structure to define components (fallback for small repos)."""
        topics = []
        
        # Group nodes by top-level directory
        dir_groups: Dict[str, List[str]] = {}
        
        for node in self.graph.all_nodes_data:
            if node.get("category") in ["directory", "external_symbol"]:
                continue
                
            file_path = node.get("file", "")
            if not file_path:
                continue
            
            # Get top-level directory (or root)
            parts = Path(file_path).parts
            if len(parts) >= 2:
                top_dir = parts[0]
            else:
                top_dir = "root"
            
            if top_dir not in dir_groups:
                dir_groups[top_dir] = []
            dir_groups[top_dir].append(node.get("id", ""))
        
        for dir_name, node_ids in dir_groups.items():
            if len(node_ids) < 2:
                continue
            
            # Get files
            files = set()
            for node_id in node_ids:
                node_data = self.nx_graph.nodes.get(node_id, {})
                if node_data.get("file"):
                    files.add(node_data["file"])
            
            topic = DocTopic(
                id=f"dir-{dir_name.lower().replace(' ', '-')}",
                title=self._format_directory_title(dir_name),
                description=f"Code in the {dir_name}/ directory",
                node_ids=node_ids,
                primary_files=list(files)[:10],
                importance=min(5, 2 + len(node_ids) // 3),
                topic_type="component"
            )
            topics.append(topic)
        
        return sorted(topics, key=lambda t: t.importance, reverse=True)
    
    def _discover_hub_nodes(self) -> List[DocTopic]:
        """Find high-connectivity nodes (important APIs/utilities)."""
        topics = []
        
        # Calculate degree centrality
        in_degree = dict(self.nx_graph.in_degree())
        out_degree = dict(self.nx_graph.out_degree())
        
        # Find hub nodes (high in-degree = heavily used, high out-degree = orchestrators)
        hub_candidates = []
        for node_id in self.nx_graph.nodes():
            node_data = self.nx_graph.nodes[node_id]
            if node_data.get("category") in ["directory", "external_symbol", "module"]:
                continue
            
            total_degree = in_degree.get(node_id, 0) + out_degree.get(node_id, 0)
            if total_degree >= 3:
                hub_candidates.append((node_id, total_degree, node_data))
        
        # Sort by connectivity
        hub_candidates.sort(key=lambda x: x[1], reverse=True)
        
        for node_id, degree, node_data in hub_candidates[:5]:
            # Get neighbors for context
            neighbors = list(self.nx_graph.predecessors(node_id)) + list(self.nx_graph.successors(node_id))
            
            topic = DocTopic(
                id=f"api-{node_data.get('name', node_id).lower().replace(' ', '-')}",
                title=f"{node_data.get('name', node_id)} API",
                description=f"Central {node_data.get('category', 'component')} with {degree} connections",
                node_ids=[node_id] + neighbors[:10],
                primary_files=[node_data.get("file", "")] if node_data.get("file") else [],
                importance=min(5, 3 + degree // 3),
                topic_type="api"
            )
            topics.append(topic)
        
        return topics
    
    def _discover_entry_points(self) -> List[DocTopic]:
        """Find entry points (main functions, route handlers, etc.)."""
        topics = []
        
        entry_patterns = ["main", "app", "server", "index", "handler", "route", "api", "endpoint"]
        
        for node in self.graph.all_nodes_data:
            if node.get("category") in ["directory", "external_symbol"]:
                continue
            
            name = node.get("name", "").lower()
            node_id = node.get("id", "")
            
            is_entry = any(pattern in name for pattern in entry_patterns)
            
            # Also check if node has no incoming edges (potential entry point)
            if not is_entry and node_id in self.nx_graph:
                in_degree = self.nx_graph.in_degree(node_id)
                out_degree = self.nx_graph.out_degree(node_id)
                if in_degree == 0 and out_degree > 0:
                    is_entry = True
            
            if is_entry:
                # Get downstream nodes
                downstream = []
                if node_id in self.nx_graph:
                    downstream = list(nx.descendants(self.nx_graph, node_id))[:15]
                
                topic = DocTopic(
                    id=f"entry-{name.replace(' ', '-')}",
                    title=f"{node.get('name', node_id)} Entry Point",
                    description=f"Application entry point: {node.get('name', '')}",
                    node_ids=[node_id] + downstream,
                    primary_files=[node.get("file", "")] if node.get("file") else [],
                    importance=4,
                    topic_type="entry_point"
                )
                topics.append(topic)
        
        return topics[:3]  # Limit entry points
    
    def _discover_all_modules(self) -> List[DocTopic]:
        """For small repos: create a topic per module."""
        topics = []
        
        for node in self.graph.all_nodes_data:
            if node.get("category") != "module":
                continue
            
            module_id = node.get("id", "")
            
            # Get all nodes in this module
            child_nodes = [n.get("id") for n in self.graph.all_nodes_data 
                          if n.get("parent_id") == module_id or n.get("file") == node.get("file")]
            
            topic = DocTopic(
                id=f"module-{Path(node.get('file', '')).stem}",
                title=f"{Path(node.get('file', '')).stem} Module",
                description=f"Module: {node.get('file', '')}",
                node_ids=child_nodes,
                primary_files=[node.get("file", "")] if node.get("file") else [],
                importance=3,
                topic_type="component"
            )
            topics.append(topic)
        
        return topics
    
    def _create_overview_topic(self) -> DocTopic:
        """Create an overview topic for the whole codebase."""
        # Get all key nodes
        key_nodes = []
        for node in self.graph.all_nodes_data:
            if node.get("category") in ["class", "function"]:
                key_nodes.append(node.get("id", ""))
        
        # Get entry points
        entry_files = []
        for node in self.graph.all_nodes_data:
            file_path = node.get("file", "") or ""
            if not isinstance(file_path, str):
                file_path = str(file_path)
            if any(p in file_path.lower() for p in ["main", "app", "index", "server", "__init__"]):
                entry_files.append(file_path)
        
        return DocTopic(
            id="overview",
            title="Project Overview",
            description="High-level overview of the project architecture and components",
            node_ids=key_nodes[:20],
            primary_files=list(set(entry_files))[:5],
            importance=5,
            topic_type="overview"
        )
    
    def _infer_cluster_name(self, node_ids: List[str], files: List[str]) -> str:
        """Infer a meaningful name for a cluster."""
        # Try to find common directory
        if files:
            paths = [Path(f) for f in files]
            if len(paths) > 1:
                # Find common prefix
                common_parts = []
                for parts in zip(*[p.parts for p in paths]):
                    if len(set(parts)) == 1:
                        common_parts.append(parts[0])
                    else:
                        break
                if common_parts:
                    return self._format_directory_title(common_parts[-1])
        
        # Use most connected node's name
        max_degree = 0
        best_name = "Component"
        for node_id in node_ids:
            if node_id in self.nx_graph:
                degree = self.nx_graph.degree(node_id)
                if degree > max_degree:
                    max_degree = degree
                    node_data = self.nx_graph.nodes[node_id]
                    best_name = node_data.get("name", "Component")
        
        return best_name
    
    def _format_directory_title(self, dir_name: str) -> str:
        """Format a directory name as a proper title."""
        # Common directory name mappings
        mappings = {
            "src": "Source Code",
            "lib": "Library",
            "utils": "Utilities",
            "api": "API Layer",
            "routes": "Route Handlers",
            "controllers": "Controllers",
            "models": "Data Models",
            "services": "Services",
            "components": "Components",
            "views": "Views",
            "tests": "Tests",
            "config": "Configuration",
            "middleware": "Middleware",
            "handlers": "Handlers",
            "schemas": "Schemas",
        }
        
        lower = dir_name.lower()
        if lower in mappings:
            return mappings[lower]
        
        # Convert snake_case or kebab-case to Title Case
        return dir_name.replace("_", " ").replace("-", " ").title()
    
    def _build_topic_context(self, topic: DocTopic) -> str:
        """Build rich LLM context for a topic."""
        context_parts = []
        
        context_parts.append(f"# {topic.title}")
        context_parts.append(f"Type: {topic.topic_type}")
        context_parts.append(f"Description: {topic.description}")
        context_parts.append("")
        
        # Files involved
        if topic.primary_files:
            context_parts.append("## Files")
            for f in topic.primary_files[:10]:
                context_parts.append(f"- {f}")
            context_parts.append("")
        
        # Code elements
        context_parts.append("## Code Structure")
        for node_id in topic.node_ids[:20]:
            if node_id not in self.nx_graph:
                continue
                
            node_data = self.nx_graph.nodes[node_id]
            category = node_data.get("category", "unknown")
            name = node_data.get("name", node_id)
            file_path = node_data.get("file", "")
            start_line = node_data.get("start_line", 0)
            end_line = node_data.get("end_line", 0)
            
            context_parts.append(f"\n### {name} ({category})")
            context_parts.append(f"File: {file_path} (lines {start_line}-{end_line})")
            
            # Add relationships
            if node_id in self.nx_graph:
                # Outgoing (calls, imports)
                outgoing = list(self.nx_graph.successors(node_id))
                for target in outgoing[:5]:
                    edge_data = self.nx_graph.edges.get((node_id, target), {})
                    rel = edge_data.get("relationship", "references")
                    target_data = self.nx_graph.nodes.get(target, {})
                    context_parts.append(f"  → {rel}: {target_data.get('name', target)}")
                
                # Incoming (called by)
                incoming = list(self.nx_graph.predecessors(node_id))
                for source in incoming[:5]:
                    edge_data = self.nx_graph.edges.get((source, node_id), {})
                    rel = edge_data.get("relationship", "references")
                    source_data = self.nx_graph.nodes.get(source, {})
                    context_parts.append(f"  ← {rel} by: {source_data.get('name', source)}")
            
            # Add code snippet (truncated)
            code = node_data.get("code", "")
            if code:
                code_lines = code.split("\n")[:15]
                context_parts.append("```")
                context_parts.append("\n".join(code_lines))
                if len(code.split("\n")) > 15:
                    context_parts.append("... (truncated)")
                context_parts.append("```")
        
        return "\n".join(context_parts)
    
    def _generate_topic_mermaid(self, topic: DocTopic) -> str:
        """Generate Mermaid diagram directly from graph data."""
        if not topic.node_ids:
            return ""
        
        # Different diagram types based on topic type
        if topic.topic_type == "overview":
            return self._generate_component_diagram(topic.node_ids)
        else:
            return self._generate_flowchart(topic.node_ids)
    
    def _generate_flowchart(self, node_ids: List[str]) -> str:
        """Generate a flowchart Mermaid diagram."""
        lines = ["flowchart TD"]
        
        # Track added nodes to avoid duplicates
        added_nodes = set()
        added_edges = set()
        
        # Create node ID mappings (Mermaid doesn't like dots)
        id_map = {}
        for i, node_id in enumerate(node_ids[:25]):  # Limit for readability
            safe_id = f"N{i}"
            id_map[node_id] = safe_id
        
        for node_id in node_ids[:25]:
            if node_id not in self.nx_graph:
                continue
            
            safe_id = id_map.get(node_id, node_id)
            node_data = self.nx_graph.nodes[node_id]
            name = node_data.get("name", node_id.split(".")[-1])
            category = node_data.get("category", "")
            
            # Escape special characters
            name = name.replace('"', "'").replace("[", "(").replace("]", ")")
            
            # Different shapes for different categories
            if category == "class":
                node_def = f'    {safe_id}["{name}"]'
            elif category == "function":
                node_def = f'    {safe_id}("{name}")'
            elif category == "method":
                node_def = f'    {safe_id}(("{name}"))'
            else:
                node_def = f'    {safe_id}["{name}"]'
            
            if safe_id not in added_nodes:
                lines.append(node_def)
                added_nodes.add(safe_id)
            
            # Add edges
            for successor in self.nx_graph.successors(node_id):
                if successor in id_map:
                    target_id = id_map[successor]
                    edge_data = self.nx_graph.edges.get((node_id, successor), {})
                    rel = edge_data.get("relationship", "")
                    
                    edge_key = (safe_id, target_id)
                    if edge_key not in added_edges:
                        if rel == "calls":
                            lines.append(f'    {safe_id} --> {target_id}')
                        elif rel == "inherits":
                            lines.append(f'    {safe_id} -.->|inherits| {target_id}')
                        elif rel in ["imports_module", "imports_symbol"]:
                            lines.append(f'    {safe_id} -.->|imports| {target_id}')
                        else:
                            lines.append(f'    {safe_id} --> {target_id}')
                        added_edges.add(edge_key)
        
        if len(lines) <= 1:
            return ""
        
        return "\n".join(lines)
    
    def _generate_component_diagram(self, node_ids: List[str]) -> str:
        """Generate a high-level component diagram."""
        lines = ["flowchart LR"]
        
        # Group by module/file
        file_groups: Dict[str, List[str]] = {}
        for node_id in node_ids:
            if node_id not in self.nx_graph:
                continue
            node_data = self.nx_graph.nodes[node_id]
            file_path = node_data.get("file", "other")
            if file_path:
                file_name = Path(file_path).stem
            else:
                file_name = "other"
            
            if file_name not in file_groups:
                file_groups[file_name] = []
            file_groups[file_name].append(node_id)
        
        # Create subgraphs for each file
        for i, (file_name, nodes) in enumerate(list(file_groups.items())[:10]):
            safe_name = file_name.replace("-", "_").replace(".", "_")
            display_name = file_name.replace("_", " ").title()
            lines.append(f'    subgraph {safe_name}["{display_name}"]')
            
            for j, node_id in enumerate(nodes[:5]):
                node_data = self.nx_graph.nodes.get(node_id, {})
                name = node_data.get("name", "?")
                name = name.replace('"', "'")
                lines.append(f'        {safe_name}_{j}["{name}"]')
            
            lines.append('    end')
        
        return "\n".join(lines)
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get graph statistics for documentation."""
        categories = {}
        for node in self.graph.all_nodes_data:
            cat = node.get("category", "unknown")
            categories[cat] = categories.get(cat, 0) + 1
        
        return {
            "total_nodes": len(self.graph.all_nodes_data),
            "total_edges": len(self.graph.all_edges_data),
            "node_categories": categories,
            "languages": self._detect_languages(),
        }
    
    def _detect_languages(self) -> List[str]:
        """Detect programming languages in the codebase."""
        extensions = set()
        for node in self.graph.all_nodes_data:
            file_path = node.get("file", "")
            if file_path:
                ext = Path(file_path).suffix
                if ext:
                    extensions.add(ext)
        
        lang_map = {
            ".py": "Python",
            ".js": "JavaScript", 
            ".ts": "TypeScript",
            ".jsx": "React JSX",
            ".tsx": "React TSX",
            ".java": "Java",
            ".go": "Go",
            ".rs": "Rust",
            ".rb": "Ruby",
        }
        
        return [lang_map.get(ext, ext) for ext in extensions if ext in lang_map]
    
    def build_file_context(self, file_path: str, file_nodes: List[Dict], 
                           all_files: List[Dict] = None) -> FileContext:
        """
        Build comprehensive context for a file using graph analysis.
        
        Args:
            file_path: Path to the file
            file_nodes: List of nodes belonging to this file
            all_files: All files for finding cluster siblings
            
        Returns:
            FileContext with role, importance, callers, callees, etc.
        """
        callers = []
        callees = []
        imports = []
        exported_functions = []
        in_degree_total = 0
        out_degree_total = 0
        
        for node in file_nodes:
            node_id = node.get("id", "")
            if not node_id or node_id not in self.nx_graph:
                continue
            
            # Get degree for importance
            in_deg = self.nx_graph.in_degree(node_id)
            out_deg = self.nx_graph.out_degree(node_id)
            in_degree_total += in_deg
            out_degree_total += out_deg
            
            # Extract exported functions
            if node.get("category") in {"function", "class"}:
                exported_functions.append(node.get("name", ""))
            
            # Get callers (predecessors in the graph)
            for pred in list(self.nx_graph.predecessors(node_id))[:5]:
                pred_data = self.nx_graph.nodes.get(pred, {})
                if pred_data.get("category") in {"function", "class", "method"}:
                    caller_file = pred_data.get("file", "").split("\\")[-1].split("/")[-1]
                    callers.append({
                        "name": pred_data.get("name", ""),
                        "file": caller_file
                    })
            
            # Get callees (successors in the graph)
            for succ in list(self.nx_graph.successors(node_id))[:5]:
                succ_data = self.nx_graph.nodes.get(succ, {})
                if succ_data.get("category") in {"function", "class", "method"}:
                    callee_file = succ_data.get("file", "").split("\\")[-1].split("/")[-1]
                    callees.append({
                        "name": succ_data.get("name", ""),
                        "file": callee_file
                    })
            
            # Get imports
            for succ in self.nx_graph.successors(node_id):
                edge_data = self.nx_graph.edges.get((node_id, succ), {})
                if edge_data.get("relationship") == "imports":
                    imports.append(succ.split(".")[-1])
        
        # Calculate importance score
        importance_score = (in_degree_total * 2) + out_degree_total + len(file_nodes)
        
        # Determine role based on graph characteristics
        file_name = Path(file_path).stem.lower()
        if in_degree_total == 0 and out_degree_total > 3:
            role = "entry_point"
        elif in_degree_total > out_degree_total * 2:
            role = "utility"
        elif "model" in file_name or "schema" in file_name:
            role = "data_model"
        elif file_nodes:
            role = "core_logic"
        else:
            role = "unknown"
        
        # Find cluster siblings
        cluster_siblings = []
        if all_files and callees:
            my_callees = set(c["name"] for c in callees)
            for other_file in (all_files or [])[:30]:
                other_path = other_file.get("path", "")
                if other_path == file_path:
                    continue
                other_callees = set()
                for n in other_file.get("nodes", []):
                    nid = n.get("id", "")
                    if nid in self.nx_graph:
                        for s in self.nx_graph.successors(nid):
                            other_callees.add(s.split(".")[-1])
                overlap = len(my_callees & other_callees)
                if overlap >= 2:
                    cluster_siblings.append(Path(other_path).name)
        
        return FileContext(
            role=role,
            importance_score=importance_score,
            callers=callers[:10],
            callees=callees[:10],
            imports=list(set(imports))[:10],
            exported_functions=exported_functions[:15],
            cluster_siblings=cluster_siblings[:5]
        )
