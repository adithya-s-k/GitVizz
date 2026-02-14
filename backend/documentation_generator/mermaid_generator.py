"""
Mermaid diagram generator from code graphs.

Generates accurate Mermaid diagrams directly from GitVizz graph data,
eliminating the need for LLM to generate diagrams (which often fail).
"""

from typing import List, Dict, Any, Optional, Set
from pathlib import Path
import networkx as nx


class MermaidGenerator:
    """
    Generate various types of Mermaid diagrams from code graph data.
    
    This produces syntactically correct diagrams that accurately reflect
    the actual code structure, unlike LLM-generated diagrams which often
    have syntax errors or inaccurate relationships.
    """
    
    def __init__(self, nx_graph: nx.DiGraph, node_data_map: Dict[str, Dict[str, Any]] = None):
        """
        Initialize with a NetworkX graph.
        
        Args:
            nx_graph: NetworkX DiGraph with code structure
            node_data_map: Optional mapping of node_id -> node attributes
        """
        self.graph = nx_graph
        self.node_data = node_data_map or {}
    
    def generate_class_diagram(self, node_ids: List[str], title: str = "") -> str:
        """
        Generate a class diagram showing classes and their relationships.
        
        Args:
            node_ids: List of node IDs to include
            title: Optional title for the diagram
            
        Returns:
            Mermaid classDiagram syntax
        """
        lines = ["classDiagram"]
        
        if title:
            lines.insert(0, f"---\ntitle: {title}\n---")
        
        # Filter to class nodes
        class_nodes = [n for n in node_ids if n in self.graph and 
                      self.graph.nodes[n].get("category") == "class"]
        
        added_classes = set()
        added_relationships = set()
        
        for node_id in class_nodes:
            node_data = self.graph.nodes[node_id]
            class_name = self._sanitize_mermaid_id(node_data.get("name", node_id))
            
            if class_name not in added_classes:
                lines.append(f"    class {class_name}")
                added_classes.add(class_name)
                
                # Add methods
                methods = self._get_class_methods(node_id)
                for method in methods[:10]:
                    method_name = self._sanitize_mermaid_id(method.get("name", ""))
                    if method_name:
                        lines.append(f"    {class_name} : +{method_name}()")
            
            # Add inheritance relationships
            for successor in self.graph.successors(node_id):
                edge_data = self.graph.edges.get((node_id, successor), {})
                if edge_data.get("relationship") == "inherits":
                    parent_data = self.graph.nodes.get(successor, {})
                    parent_name = self._sanitize_mermaid_id(parent_data.get("name", successor))
                    
                    rel_key = (class_name, parent_name, "inherits")
                    if rel_key not in added_relationships:
                        lines.append(f"    {parent_name} <|-- {class_name}")
                        added_relationships.add(rel_key)
                        
                        # Ensure parent is added
                        if parent_name not in added_classes:
                            lines.append(f"    class {parent_name}")
                            added_classes.add(parent_name)
        
        if len(added_classes) == 0:
            return ""
        
        return "\n".join(lines)
    
    def generate_sequence_diagram(self, start_node: str, end_node: str = None, 
                                   max_depth: int = 5) -> str:
        """
        Generate a sequence diagram showing call flow.
        
        Args:
            start_node: Starting node ID
            end_node: Optional ending node ID
            max_depth: Maximum call depth to show
            
        Returns:
            Mermaid sequenceDiagram syntax
        """
        lines = ["sequenceDiagram"]
        
        if start_node not in self.graph:
            return ""
        
        # Track participants in order
        participants = []
        added_calls = []
        
        def trace_calls(node_id: str, depth: int = 0):
            if depth >= max_depth:
                return
            
            node_data = self.graph.nodes.get(node_id, {})
            caller_name = self._sanitize_mermaid_id(node_data.get("name", node_id))
            
            if caller_name not in participants:
                participants.append(caller_name)
            
            for successor in self.graph.successors(node_id):
                edge_data = self.graph.edges.get((node_id, successor), {})
                if edge_data.get("relationship") == "calls":
                    target_data = self.graph.nodes.get(successor, {})
                    callee_name = self._sanitize_mermaid_id(target_data.get("name", successor))
                    
                    if callee_name not in participants:
                        participants.append(callee_name)
                    
                    added_calls.append((caller_name, callee_name))
                    
                    if end_node and successor == end_node:
                        return
                    
                    trace_calls(successor, depth + 1)
        
        trace_calls(start_node)
        
        # Add participants
        for p in participants[:15]:
            lines.append(f"    participant {p}")
        
        # Add calls
        for caller, callee in added_calls[:20]:
            lines.append(f"    {caller}->>+{callee}: calls")
        
        if len(added_calls) == 0:
            return ""
        
        return "\n".join(lines)
    
    def generate_flowchart(self, node_ids: List[str], direction: str = "TD",
                           include_imports: bool = False) -> str:
        """
        Generate a flowchart showing relationships between nodes.
        
        Args:
            node_ids: List of node IDs to include
            direction: Flow direction (TD, LR, BT, RL)
            include_imports: Whether to include import relationships
            
        Returns:
            Mermaid flowchart syntax
        """
        lines = [f"flowchart {direction}"]
        
        # Create safe ID mappings
        id_map = {}
        for i, node_id in enumerate(node_ids):
            id_map[node_id] = f"N{i}"
        
        added_nodes: Set[str] = set()
        added_edges: Set[tuple] = set()
        
        for node_id in node_ids:
            if node_id not in self.graph:
                continue
            
            safe_id = id_map.get(node_id)
            if not safe_id:
                continue
            
            node_data = self.graph.nodes[node_id]
            name = self._escape_label(node_data.get("name", node_id.split(".")[-1]))
            category = node_data.get("category", "")
            
            # Add node with appropriate shape
            if safe_id not in added_nodes:
                if category == "class":
                    lines.append(f'    {safe_id}["{name}"]')
                elif category == "function":
                    lines.append(f'    {safe_id}("{name}")')
                elif category == "method":
                    lines.append(f'    {safe_id}(("{name}"))')
                elif category == "module":
                    lines.append(f'    {safe_id}[["{name}"]]')
                else:
                    lines.append(f'    {safe_id}["{name}"]')
                added_nodes.add(safe_id)
            
            # Add edges
            for successor in self.graph.successors(node_id):
                if successor not in id_map:
                    continue
                
                target_id = id_map[successor]
                edge_data = self.graph.edges.get((node_id, successor), {})
                rel = edge_data.get("relationship", "")
                
                # Skip imports unless requested
                if not include_imports and rel in ["imports_module", "imports_symbol"]:
                    continue
                
                edge_key = (safe_id, target_id)
                if edge_key not in added_edges:
                    if rel == "calls":
                        lines.append(f'    {safe_id} --> {target_id}')
                    elif rel == "inherits":
                        lines.append(f'    {safe_id} -.->|extends| {target_id}')
                    elif rel == "defines_class":
                        lines.append(f'    {safe_id} -->|defines| {target_id}')
                    elif rel == "defines_function":
                        lines.append(f'    {safe_id} -->|defines| {target_id}')
                    elif rel == "imports_module":
                        lines.append(f'    {safe_id} -.->|imports| {target_id}')
                    else:
                        lines.append(f'    {safe_id} --> {target_id}')
                    added_edges.add(edge_key)
        
        if len(added_nodes) == 0:
            return ""
        
        return "\n".join(lines)
    
    def generate_component_diagram(self, components: Dict[str, List[str]]) -> str:
        """
        Generate a high-level component diagram.
        
        Args:
            components: Dict mapping component names to lists of node IDs
            
        Returns:
            Mermaid flowchart with subgraphs
        """
        lines = ["flowchart LR"]
        
        component_ids = {}
        
        for i, (comp_name, node_ids) in enumerate(list(components.items())[:12]):
            safe_comp = self._sanitize_mermaid_id(comp_name)
            display_name = self._escape_label(comp_name)
            component_ids[comp_name] = safe_comp
            
            lines.append(f'    subgraph {safe_comp}["{display_name}"]')
            
            # Add key nodes in component
            for j, node_id in enumerate(node_ids[:4]):
                if node_id in self.graph:
                    node_data = self.graph.nodes[node_id]
                    name = self._escape_label(node_data.get("name", "?"))
                    lines.append(f'        {safe_comp}_{j}["{name}"]')
            
            lines.append('    end')
        
        # Add cross-component relationships
        added_component_edges = set()
        for comp_name, node_ids in components.items():
            source_comp = component_ids.get(comp_name)
            if not source_comp:
                continue
            
            for node_id in node_ids:
                if node_id not in self.graph:
                    continue
                
                for successor in self.graph.successors(node_id):
                    # Find which component the successor belongs to
                    for target_comp_name, target_nodes in components.items():
                        if successor in target_nodes and target_comp_name != comp_name:
                            target_comp = component_ids.get(target_comp_name)
                            if target_comp:
                                edge_key = (source_comp, target_comp)
                                if edge_key not in added_component_edges:
                                    lines.append(f'    {source_comp} --> {target_comp}')
                                    added_component_edges.add(edge_key)
                            break
        
        return "\n".join(lines)
    
    def generate_er_diagram(self, model_nodes: List[str]) -> str:
        """
        Generate an entity-relationship diagram for data models.
        
        Args:
            model_nodes: List of class/model node IDs
            
        Returns:
            Mermaid erDiagram syntax
        """
        lines = ["erDiagram"]
        
        added_entities = set()
        
        for node_id in model_nodes:
            if node_id not in self.graph:
                continue
            
            node_data = self.graph.nodes[node_id]
            entity_name = self._sanitize_mermaid_id(node_data.get("name", node_id))
            
            if entity_name not in added_entities:
                # Try to extract attributes from code
                code = node_data.get("code", "")
                attrs = self._extract_model_attributes(code)
                
                lines.append(f"    {entity_name} {{")
                for attr_type, attr_name in attrs[:10]:
                    lines.append(f"        {attr_type} {attr_name}")
                lines.append("    }")
                added_entities.add(entity_name)
                
                # Add relationships
                for successor in self.graph.successors(node_id):
                    edge_data = self.graph.edges.get((node_id, successor), {})
                    if edge_data.get("relationship") == "inherits":
                        target_data = self.graph.nodes.get(successor, {})
                        target_name = self._sanitize_mermaid_id(target_data.get("name", successor))
                        lines.append(f"    {target_name} ||--o{{ {entity_name} : extends")
        
        if len(added_entities) == 0:
            return ""
        
        return "\n".join(lines)
    
    def _get_class_methods(self, class_node_id: str) -> List[Dict[str, Any]]:
        """Get methods defined in a class."""
        methods = []
        
        for successor in self.graph.successors(class_node_id):
            edge_data = self.graph.edges.get((class_node_id, successor), {})
            if edge_data.get("relationship") == "defines_method":
                method_data = self.graph.nodes.get(successor, {})
                if method_data:
                    methods.append(method_data)
        
        return methods
    
    def _sanitize_mermaid_id(self, name: str) -> str:
        """Make a name safe for Mermaid IDs."""
        # Remove or replace problematic characters
        safe = name.replace(" ", "_").replace("-", "_").replace(".", "_")
        safe = safe.replace("(", "").replace(")", "").replace("[", "").replace("]", "")
        safe = safe.replace("<", "").replace(">", "").replace(":", "_")
        safe = safe.replace("/", "_").replace("\\", "_")
        
        # Ensure it starts with a letter
        if safe and not safe[0].isalpha():
            safe = "N" + safe
        
        return safe or "Unknown"
    
    def _escape_label(self, text: str) -> str:
        """Escape text for use in Mermaid labels."""
        return text.replace('"', "'").replace("[", "(").replace("]", ")")
    
    def _extract_model_attributes(self, code: str) -> List[tuple]:
        """Extract attribute definitions from model class code."""
        attributes = []
        
        if not code:
            return attributes
        
        # Simple heuristic: look for variable assignments or type hints
        lines = code.split("\n")
        for line in lines:
            line = line.strip()
            
            # Python style: name: Type or self.name = 
            if ":" in line and "=" not in line.split(":")[0]:
                parts = line.split(":")
                if len(parts) >= 2:
                    attr_name = parts[0].strip()
                    attr_type = parts[1].split("=")[0].strip()
                    if attr_name and not attr_name.startswith(("def ", "class ", "#")):
                        attributes.append((attr_type[:20], self._sanitize_mermaid_id(attr_name)))
            
            # Check for self.x = assignments
            elif "self." in line and "=" in line:
                parts = line.split("=")[0]
                if "self." in parts:
                    attr_name = parts.split("self.")[-1].strip()
                    if attr_name and not attr_name.startswith("_"):
                        attributes.append(("any", self._sanitize_mermaid_id(attr_name)))
        
        return attributes[:10]
