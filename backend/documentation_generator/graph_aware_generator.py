"""
Graph-Aware Documentation Generator 
1. Uses graph structure for page discovery (not just file scanning)
2. Generates Mermaid diagrams from actual code relationships (not LLM guesses)
3. Builds rich LLM context with caller/callee info
4. Handles small repos with fallback strategies
5. Uses significantly fewer tokens with better output quality
"""

import sys
import time
from typing import List, Dict, Any, Callable, Optional
from datetime import datetime
from pathlib import Path
import shutil

# Add gitvizz to path
gitvizz_path = Path(__file__).parent.parent.parent / "gitvizz"
if str(gitvizz_path) not in sys.path:
    sys.path.insert(0, str(gitvizz_path))

from gitvizz.graph_generator import GraphGenerator

from documentation_generator.graph_doc_analyzer import GraphDocAnalyzer, DocTopic
from documentation_generator.mermaid_generator import MermaidGenerator
from documentation_generator.ai_client import LLMClient
from documentation_generator.structures import WikiStructure, WikiPage, WikiSection, Document
from documentation_generator.utils import save_wiki_files, download_repo, read_files_for_graph


class GraphAwareDocGenerator:
    """
    Documentation generator that uses code graph analysis.
    
    This generator understands your code structure through AST parsing
    and creates documentation based on actual code relationships, not
    just text search.
    """
    
    def __init__(
        self,
        api_key: str = None,
        provider: str = "gemini",
        model: str = None,
        temperature: float = 0.7,
        progress_callback: Callable[[str], None] = None,
        user=None
    ):
        """
        Initialize the graph-aware documentation generator.
        
        Args:
            api_key: API key for LLM provider
            provider: LLM provider (gemini, openai, anthropic, groq)
            model: Specific model to use
            temperature: LLM temperature
            progress_callback: Function to call with progress updates
            user: User object for API usage tracking
        """
        self.api_key = api_key
        self.provider = provider.lower()
        self.model = model
        self.temperature = temperature
        self.user = user
        
        self.ai_client = LLMClient(
            api_key=self.api_key,
            provider=self.provider,
            model=self.model,
            temperature=self.temperature,
            user=self.user
        )
        
        self.progress_callback = progress_callback or self._default_progress
        
        # State
        self.graph_generator: Optional[GraphGenerator] = None
        self.graph_analyzer: Optional[GraphDocAnalyzer] = None
        self.mermaid_gen: Optional[MermaidGenerator] = None
        self.repo_info: Dict[str, Any] = {}
    
    def _default_progress(self, message: str):
        """Default progress callback."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {message}")
    
    def generate_wiki(
        self,
        repo_url_or_path: str,
        output_dir: str = "./wiki_output",
        language: str = "en",
        max_pages: int = 10,
        github_token: str = None
    ) -> Dict[str, Any]:
        """
        Generate comprehensive documentation for a repository.
        
        Args:
            repo_url_or_path: Git URL, local path, or zip file path
            output_dir: Directory to save wiki files
            language: Output language (en, es, etc.)
            max_pages: Maximum number of pages to generate
            github_token: Optional GitHub token for private repos
            
        Returns:
            Dict with generation results and statistics
        """
        start_time = time.time()
        output_dir = Path(output_dir).resolve()
        
        self.progress_callback(f"Starting graph-aware wiki generation for: {repo_url_or_path}")
        
        # Step 1: Setup repository
        self.progress_callback("Setting up repository...")
        repo_root = self._setup_repository(repo_url_or_path, output_dir, github_token)
        
        if not repo_root:
            return {"status": "error", "message": "Failed to setup repository"}
        
        # Step 2: Parse code into graph
        self.progress_callback("Parsing codebase with AST analysis...")
        success = self._build_code_graph(repo_root)
        
        if not success:
            return {"status": "error", "message": "Failed to parse codebase"}
        
        # Step 3: Discover documentation topics from graph
        self.progress_callback("Discovering documentation topics from code structure...")
        topics = self.graph_analyzer.discover_documentation_topics(max_topics=max_pages)
        
        self.progress_callback(f"Found {len(topics)} documentation topics")
        
        # Step 4: Generate wiki structure
        self.progress_callback("Building wiki structure...")
        structure = self._build_wiki_structure(topics)
        
        # Step 5: Generate content for each page
        self.progress_callback("Generating page content...")
        generated_pages = self._generate_all_pages(structure, topics, language)
        
        # Step 6: Save files
        self.progress_callback("Saving documentation files...")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Clean existing output
        if output_dir.exists():
            for item in output_dir.iterdir():
                if item.is_file():
                    item.unlink()
        
        result = self._save_wiki(generated_pages, structure, output_dir)
        
        # Step 7: Cleanup
        self.progress_callback("Cleaning up...")
        self._cleanup(repo_root, output_dir)
        
        # Stats
        elapsed = time.time() - start_time
        stats = self.graph_analyzer.get_statistics() if self.graph_analyzer else {}
        
        result.update({
            "status": "success",
            "repository": repo_url_or_path,
            "pages_generated": len(generated_pages),
            "generation_time_seconds": round(elapsed, 2),
            "graph_stats": stats,
        })
        
        self.progress_callback(f"Wiki generated in {elapsed:.1f}s with {len(generated_pages)} pages")
        
        return result
    
    def _setup_repository(self, repo_url_or_path: str, output_dir: Path, 
                          github_token: str = None) -> Optional[Path]:
        """Setup repository for processing."""
        repo_path_str = str(repo_url_or_path)
        temp_repo = output_dir.parent / "temp_repo"
        
        try:
            if repo_path_str.lower().endswith('.zip'):
                # Handle zip file
                from documentation_generator.utils import setup_repository_from_zip
                setup_repository_from_zip(repo_path_str, str(temp_repo))
                self.repo_info = {
                    "owner": "local",
                    "repo": Path(repo_path_str).stem,
                    "url": repo_path_str,
                    "type": "zip"
                }
                return temp_repo
                
            elif repo_path_str.startswith('http'):
                # Handle Git URL
                download_repo(repo_path_str, str(temp_repo), github_token)
                parts = repo_path_str.rstrip('/').split('/')
                self.repo_info = {
                    "owner": parts[-2] if len(parts) >= 2 else "unknown",
                    "repo": parts[-1].replace('.git', '') if parts else "unknown",
                    "url": repo_path_str,
                    "type": "github"
                }
                return temp_repo
                
            else:
                # Handle local directory
                if Path(repo_path_str).exists():
                    self.repo_info = {
                        "owner": "local",
                        "repo": Path(repo_path_str).name,
                        "url": repo_path_str,
                        "type": "local"
                    }
                    return Path(repo_path_str)
                else:
                    self.progress_callback(f"❌ Path does not exist: {repo_path_str}")
                    return None
                    
        except Exception as e:
            self.progress_callback(f"Error setting up repository: {e}")
            return None
    
    def _build_code_graph(self, repo_root: Path) -> bool:
        """Build code graph using GitVizz."""
        try:
            # Read files for graph generation
            files = read_files_for_graph(str(repo_root))
            
            if not files:
                self.progress_callback("No parseable files found")
                return False
            
            self.progress_callback(f"   Found {len(files)} files to parse")
            
            # Create graph generator
            self.graph_generator = GraphGenerator(files)
            
            # Generate graph (parses all files)
            self.graph_generator.generate()
            
            self.progress_callback(
                f"Graph built: {len(self.graph_generator.all_nodes_data)} nodes, "
                f"{len(self.graph_generator.all_edges_data)} edges"
            )
            
            # Initialize analyzers
            self.graph_analyzer = GraphDocAnalyzer(self.graph_generator)
            self.mermaid_gen = MermaidGenerator(self.graph_analyzer.nx_graph)
            
            return True
            
        except Exception as e:
            self.progress_callback(f"Error building graph: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _build_wiki_structure(self, topics: List[DocTopic]) -> WikiStructure:
        """Build WikiStructure from discovered topics."""
        pages = []
        
        for topic in topics:
            page = WikiPage(
                id=topic.id,
                title=topic.title,
                file_paths=topic.primary_files,
                importance=topic.importance,
                related_pages=topic.related_topics
            )
            pages.append(page)
        
        # Create sections
        sections = []
        
        # Group by topic type
        overview_pages = [p.id for p in pages if any(t.topic_type == "overview" 
                         for t in topics if t.id == p.id)]
        component_pages = [p.id for p in pages if any(t.topic_type == "component" 
                          for t in topics if t.id == p.id)]
        api_pages = [p.id for p in pages if any(t.topic_type == "api" 
                    for t in topics if t.id == p.id)]
        
        if overview_pages:
            sections.append(WikiSection(id="overview", title="Overview", pages=overview_pages))
        if component_pages:
            sections.append(WikiSection(id="components", title="Components", pages=component_pages))
        if api_pages:
            sections.append(WikiSection(id="apis", title="APIs", pages=api_pages))
        
        return WikiStructure(
            title=f"{self.repo_info.get('repo', 'Repository')} Documentation",
            description=f"Auto-generated documentation for {self.repo_info.get('repo', 'this repository')}",
            pages=pages,
            sections=sections
        )
    
    def _generate_all_pages(self, structure: WikiStructure, topics: List[DocTopic],
                            language: str) -> List[WikiPage]:
        """Generate content for all pages."""
        generated_pages = []
        topic_map = {t.id: t for t in topics}
        
        # Calculate rate limiting based on provider
        rate_delay = 2 if self.provider in ["gemini", "groq"] else 1
        
        for i, page in enumerate(structure.pages):
            topic = topic_map.get(page.id)
            if not topic:
                continue
            
            # Rate limiting
            if i > 0:
                time.sleep(rate_delay)
            
            self.progress_callback(f"[{i+1}/{len(structure.pages)}] {page.title}")
            
            try:
                generated_page = self._generate_page_content(page, topic, language)
                generated_pages.append(generated_page)
            except Exception as e:
                self.progress_callback(f"Error generating page: {e}")
                # Add placeholder content
                page.content = f"# {page.title}\n\nDocumentation generation failed."
                generated_pages.append(page)
        
        return generated_pages
    
    def _generate_page_content(self, page: WikiPage, topic: DocTopic, 
                               language: str) -> WikiPage:
        """Generate content for a single page using graph context."""
        
        # Build the prompt with graph-aware context
        prompt = self._build_page_prompt(page, topic, language)
        
        # Generate content
        content = self.ai_client.generate_content(
            prompt=prompt,
            temperature=self.temperature,
            max_tokens=6000,
            progress_callback=lambda m: self.progress_callback(f"      {m}")
        )
        
        # Inject pre-generated Mermaid diagram if we have one
        if topic.mermaid_diagram and "```mermaid" not in content:
            # Add diagram after the first header
            lines = content.split("\n")
            insert_idx = 0
            for i, line in enumerate(lines):
                if line.startswith("# "):
                    insert_idx = i + 1
                    break
            
            diagram_block = f"\n\n```mermaid\n{topic.mermaid_diagram}\n```\n"
            lines.insert(insert_idx, diagram_block)
            content = "\n".join(lines)
        
        page.content = content
        page.mermaid_diagrams = [topic.mermaid_diagram] if topic.mermaid_diagram else []
        
        return page
    
    def _build_page_prompt(self, page: WikiPage, topic: DocTopic, language: str) -> str:
        """Build an LLM prompt with rich graph context."""
        
        repo_name = self.repo_info.get('repo', 'Repository')
        
        # Handle diagram fallback outside f-string to avoid backslash issues
        fallback_diagram = "flowchart TD\n    A[No diagram available]"
        diagram = topic.mermaid_diagram if topic.mermaid_diagram else fallback_diagram
        
        prompt = f"""You are an expert technical documentation writer.
Generate comprehensive documentation for the following code component.

# Repository: {repo_name}
# Documentation Topic: {page.title}
# Language: {language}

## Code Structure Analysis (from AST parsing):

{topic.llm_context}

## Pre-Generated Diagram

The following Mermaid diagram was generated from the actual code structure:

```mermaid
{diagram}
```

## Instructions

Generate a comprehensive Markdown documentation page for "{page.title}" that includes:

1. **Introduction**: Brief overview of this component's purpose and role
2. **Architecture**: Explain how the components work together (reference the diagram above)
3. **Key Components**: Document each major class/function with:
   - Purpose and responsibility
   - Important methods/parameters
   - Usage examples where applicable
4. **Relationships**: Explain how this component interacts with others
5. **Usage Guide**: Practical examples of using this component
6. **Best Practices**: Any patterns or recommendations

## Requirements

- Use proper Markdown formatting
- Start with `# {page.title}` as the main heading
- Include the Mermaid diagram provided above (don't generate new ones)
- Ground all explanations in the code structure analysis provided
- Be accurate - only describe what's actually in the code
- Keep explanations clear and practical

Generate the documentation now:
"""
        return prompt
    
    def _save_wiki(self, pages: List[WikiPage], structure: WikiStructure,
                   output_dir: Path) -> Dict[str, Any]:
        """Save wiki pages to files."""
        saved_files = []
        
        # Save each page
        for page in pages:
            if not page.content:
                continue
            
            # Create safe filename
            filename = f"{page.id}.md"
            filepath = output_dir / filename
            
            filepath.write_text(page.content, encoding="utf-8")
            saved_files.append(str(filepath))
        
        # Create index/README
        index_content = self._generate_index(pages, structure)
        index_path = output_dir / "README.md"
        index_path.write_text(index_content, encoding="utf-8")
        saved_files.append(str(index_path))
        
        return {
            "output_directory": str(output_dir),
            "files_saved": saved_files,
            "page_count": len(pages)
        }
    
    def _generate_index(self, pages: List[WikiPage], structure: WikiStructure) -> str:
        """Generate index/README page."""
        lines = [
            f"# {structure.title}",
            "",
            structure.description,
            "",
            "## Contents",
            ""
        ]
        
        # Group by section
        if structure.sections:
            for section in structure.sections:
                lines.append(f"### {section.title}")
                lines.append("")
                for page_id in section.pages:
                    page = next((p for p in pages if p.id == page_id), None)
                    if page:
                        lines.append(f"- [{page.title}]({page.id}.md)")
                lines.append("")
        else:
            # Just list all pages
            for page in pages:
                lines.append(f"- [{page.title}]({page.id}.md)")
        
        # Add generation info
        lines.extend([
            "",
            "---",
            "",
            f"*Generated by GitVizz Graph-Aware Documentation Generator*",
            f"*Generated at: {datetime.now().isoformat()}*"
        ])
        
        return "\n".join(lines)
    
    def _cleanup(self, repo_root: Path, output_dir: Path):
        """Clean up temporary files."""
        temp_repo = output_dir.parent / "temp_repo"
        
        # Only remove if it's our temp directory
        if temp_repo.exists() and repo_root == temp_repo:
            try:
                shutil.rmtree(temp_repo)
            except Exception as e:
                self.progress_callback(f"Cleanup warning: {e}")
    
    def _generate_file_mermaid(self, file_info: dict, context) -> str:
        """Generate a Mermaid diagram showing file dependencies."""
        lines = ["flowchart LR"]
        
        # Central node
        file_name = file_info["name"]
        lines.append(f'    {file_name}["{file_name}"]')
        
        # Add callers (left side)
        for i, caller in enumerate(context.callers[:4]):
            caller_id = f"caller_{i}"
            caller_name = caller.get("name", "unknown")[:20]
            lines.append(f'    {caller_id}["{caller_name}"] --> {file_name}')
        
        # Add callees (right side)
        for i, callee in enumerate(context.callees[:4]):
            callee_id = f"callee_{i}"
            callee_name = callee.get("name", "unknown")[:20]
            lines.append(f'    {file_name} --> {callee_id}["{callee_name}"]')
        
        # Style the central node
        lines.append(f'    style {file_name} fill:#f9f,stroke:#333,stroke-width:2px')
        
        return "\n".join(lines) if len(lines) > 2 else "flowchart LR\n    A[This file] --> B[Dependencies]"
    
    def generate_file_docs(
        self,
        repo_path: str,
        max_files: int = 20,
        files_per_page: int = 8,
    ) -> Dict[str, Any]:
        """
        Generate documentation using file-based approach with rich graph context.
        
        This is a simpler, more direct approach that:
        1. Parses code into graph
        2. Groups files by directory or graph clusters
        3. Generates documentation for each file with rich context
        
        Args:
            repo_path: Path to local repository
            max_files: Maximum total files to document
            files_per_page: Files per documentation page
            
        Returns:
            Dict with generated documentation and statistics
        """
        from collections import defaultdict
        
        self.progress_callback(f"Starting file-based documentation for: {repo_path}")
        
        # Step 1: Read files
        files = read_files_for_graph(repo_path)
        if not files:
            return {"status": "error", "message": "No parseable files found"}
        
        self.progress_callback(f"Found {len(files)} files")
        
        # Step 2: Build graph
        self.graph_generator = GraphGenerator(files)
        self.graph_generator.generate()
        self.graph_analyzer = GraphDocAnalyzer(self.graph_generator)
        self.mermaid_gen = MermaidGenerator(self.graph_analyzer.nx_graph)
        
        self.progress_callback(
            f"Graph: {len(self.graph_generator.all_nodes_data)} nodes, "
            f"{len(self.graph_generator.all_edges_data)} edges"
        )
        
        # Step 3: Build file info with importance
        file_info_list = []
        file_nodes_map = defaultdict(list)
        
        for node in self.graph_generator.all_nodes_data:
            file_path = node.get("file", "")
            if file_path:
                file_nodes_map[file_path].append(node)
        
        repo_root = Path(repo_path).resolve()
        for file_data in files:
            file_path = file_data["path"]
            nodes = file_nodes_map.get(file_path, [])
            
            # Calculate importance from graph
            importance = len(nodes)
            for node in nodes:
                node_id = node.get("id", "")
                if node_id in self.graph_analyzer.nx_graph:
                    importance += self.graph_analyzer.nx_graph.degree(node_id) * 0.5
            
            # Get relative path
            try:
                rel_path = Path(file_path).relative_to(repo_root)
            except:
                rel_path = Path(file_path).name
            
            file_info_list.append({
                "path": file_path,
                "relative": str(rel_path),
                "name": Path(file_path).stem,
                "content": file_data["content"],
                "nodes": nodes,
                "importance": importance
            })
        
        # Sort by importance
        file_info_list.sort(key=lambda x: -x["importance"])
        files_to_doc = file_info_list[:max_files]
        
        # Step 4: Generate documentation for each file
        generated_docs = {}
        
        # Calculate delay based on provider
        rate_delay = 5 if self.provider == "groq" else 2
        
        for i, file_info in enumerate(files_to_doc):
            self.progress_callback(f"[{i+1}/{len(files_to_doc)}] Documenting {file_info['name']}...")
            
            # Build rich context using graph_doc_analyzer
            context = self.graph_analyzer.build_file_context(
                file_info["path"],
                file_info["nodes"],
                file_info_list
            )
            
            # Generate Mermaid diagram for this file's relationships
            mermaid_diagram = self._generate_file_mermaid(file_info, context)
            
            # Build prompt with rich context
            callers_str = ", ".join([f"{c['name']} ({c['file']})" for c in context.callers[:5]]) or "None"
            callees_str = ", ".join([f"{c['name']} ({c['file']})" for c in context.callees[:5]]) or "None"
            siblings_str = ", ".join(context.cluster_siblings[:3]) or "Standalone"
            functions_str = ", ".join(context.exported_functions[:10]) or "Various code"
            
            code_preview = file_info["content"][:4000]
            
            prompt = f"""You are an expert technical documentation writer. Generate comprehensive documentation for this source file.

## File Information
- **Path:** `{file_info['relative']}`
- **Role in System:** {context.role.replace('_', ' ').title()}
- **Importance Score:** {context.importance_score:.0f}

## Graph Analysis (from AST parsing)
- **Called by:** {callers_str}
- **Calls into:** {callees_str}
- **Related files:** {siblings_str}
- **Exports:** {functions_str}

## Dependency Graph
```mermaid
{mermaid_diagram}
```

## Source Code Preview
```
{code_preview}
```

## Documentation Requirements
Generate comprehensive Markdown documentation including:

1. **# {file_info['name']}** - File title
2. **## Purpose** (2-3 sentences) - What this file does and its role in the system architecture
3. **## Key Components** - Document each major function/class with:
   - Purpose and responsibility
   - Key parameters and return types
   - Usage examples where applicable
4. **## Dependencies** - What this file imports and depends on
5. **## Usage** - How other parts of the codebase use this file (based on the "Called by" information)

Include the Mermaid diagram from above in your documentation. Focus on architectural understanding, not just code description."""

            # Retry logic for rate limits
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    doc_content = self.ai_client.generate_content(
                        prompt=prompt,
                        temperature=0.3,
                        max_tokens=3000,
                        progress_callback=lambda m: self.progress_callback(f"    {m}")
                    )
                    generated_docs[file_info["path"]] = {
                        "name": file_info["name"],
                        "relative": file_info["relative"],
                        "doc": doc_content,
                        "mermaid": mermaid_diagram,
                        "context": {
                            "role": context.role,
                            "importance": context.importance_score,
                            "callers": context.callers[:3],
                            "callees": context.callees[:3]
                        }
                    }
                    break  # Success, exit retry loop
                except Exception as e:
                    error_msg = str(e)
                    if "rate_limit" in error_msg.lower() or "429" in error_msg:
                        wait_time = (attempt + 1) * 10  # 10s, 20s, 30s
                        self.progress_callback(f"    Rate limited, waiting {wait_time}s...")
                        time.sleep(wait_time)
                        if attempt == max_retries - 1:
                            self.progress_callback(f"    Failed after {max_retries} retries")
                            error_doc = f"# {file_info['name']}\n\nDocumentation generation failed: {e}"
                            generated_docs[file_info["path"]] = {
                                "name": file_info["name"],
                                "relative": file_info["relative"],
                                "doc": error_doc,
                                "context": {"role": context.role}
                            }
                    else:
                        self.progress_callback(f"    Error: {e}")
                        error_doc = f"# {file_info['name']}\n\nDocumentation generation failed: {e}"
                        generated_docs[file_info["path"]] = {
                            "name": file_info["name"],
                            "relative": file_info["relative"],
                            "doc": error_doc,
                            "context": {"role": context.role}
                        }
                        break
            
            # Rate limit delay between files
            if i < len(files_to_doc) - 1:
                time.sleep(rate_delay)
        
        return {
            "status": "success",
            "files_documented": len(generated_docs),
            "total_files": len(files),
            "graph_stats": self.graph_analyzer.get_statistics(),
            "docs": generated_docs
        }


# Convenience function for backward compatibility
def generate_documentation(
    repo_url_or_path: str,
    output_dir: str = "./wiki_output",
    api_key: str = None,
    provider: str = "gemini",
    language: str = "en",
    **kwargs
) -> Dict[str, Any]:
    """
    Generate documentation for a repository.
    
    This is a convenience function that creates a GraphAwareDocGenerator
    and runs it.
    
    Args:
        repo_url_or_path: Repository to document
        output_dir: Where to save documentation
        api_key: LLM API key
        provider: LLM provider
        language: Output language
        **kwargs: Additional arguments passed to generator
        
    Returns:
        Generation results
    """
    generator = GraphAwareDocGenerator(
        api_key=api_key,
        provider=provider,
        **kwargs
    )
    
    return generator.generate_wiki(
        repo_url_or_path=repo_url_or_path,
        output_dir=output_dir,
        language=language
    )
