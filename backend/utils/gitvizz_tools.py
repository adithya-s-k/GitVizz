"""
GitVizz Tools for Agentic Chat
Provides LangGraph tools powered by GitVizz for intelligent code analysis
"""

import json
import os
import tempfile
import zipfile
from typing import Dict, List, Any, Optional
from langchain_core.tools import tool

try:
    from gitvizz import GraphGenerator, GraphSearchTool
    GITVIZZ_AVAILABLE = True
except ImportError:
    GITVIZZ_AVAILABLE = False
    print("⚠️ GitVizz not available - tools will return mock responses")

from utils.repo_utils import extract_zip_contents, cleanup_temp_files


class GitVizzToolsService:
    """Service providing GitVizz-powered tools for code analysis"""
    
    def __init__(self):
        self.gitvizz_available = GITVIZZ_AVAILABLE
        self.graph_generators = {}  # Cache for graph generators by repository
    
    async def get_or_create_graph(self, repository_id: str, zip_file_path: str) -> Optional[GraphGenerator]:
        """Get or create a GitVizz graph for the repository"""
        if not self.gitvizz_available:
            return None
        
        print(f"[GitVizz] Getting graph for repository: {repository_id}")
        
        # Check cache first
        if repository_id in self.graph_generators:
            print(f"[GitVizz] Using cached graph for repository: {repository_id}")
            return self.graph_generators[repository_id]
        
        try:
            # Extract ZIP contents to temporary directory
            if not os.path.exists(zip_file_path):
                print(f"[GitVizz] ZIP file not found: {zip_file_path}")
                return None
            
            print(f"[GitVizz] Extracting ZIP: {zip_file_path}")
            extracted_files, temp_extract_dir = extract_zip_contents(zip_file_path)
            
            if not extracted_files:
                print("[GitVizz] No files extracted from ZIP")
                return None
            
            print(f"[GitVizz] Creating GraphGenerator from: {temp_extract_dir}")
            print(f"[GitVizz] Extracted {len(extracted_files)} files")
            
            # Create GitVizz GraphGenerator from extracted directory
            graph_generator = GraphGenerator.from_source(temp_extract_dir)
            
            # Cache the graph generator
            self.graph_generators[repository_id] = graph_generator
            
            # Don't clean up immediately - GitVizz might need the files for analysis
            # Store temp dir path for later cleanup if needed
            graph_generator._temp_extract_dir = temp_extract_dir
            
            return graph_generator
            
        except Exception as e:
            print(f"Error creating GitVizz graph: {str(e)}")
            return None
    
    def create_tools(self, repository_id: str, zip_file_path: str):
        """Create GitVizz-powered tools for a specific repository"""
        
        @tool
        async def analyze_code_structure(query: str = "") -> str:
            """
            Analyze the overall code structure and architecture of the repository.
            Use this tool to understand the high-level organization of the codebase.
            
            Args:
                query: Optional specific focus area (e.g., "authentication", "database", "api")
            """
            print(f"🔍 Analyzing code structure for repository: {repository_id}")
            print(f"📝 Query focus: {query or 'general overview'}")
            
            if not self.gitvizz_available:
                return "GitVizz not available - using mock analysis"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for analysis"
                
                search = GraphSearchTool(graph)
                
                # Get high-level architecture information
                entry_points = search.find_entry_points()
                dependency_layers = search.get_dependency_layers()
                high_connectivity = search.get_high_connectivity_nodes(min_connections=3)
                
                # If user provided a specific query, do targeted search
                if query.strip():
                    targeted_results = search.fuzzy_search(query, max_results=10)
                    analysis_subgraphs = [entry_points, dependency_layers, high_connectivity, targeted_results]
                else:
                    analysis_subgraphs = [entry_points, dependency_layers, high_connectivity]
                
                # Combine all analyses
                combined_analysis = GraphSearchTool.combine_subgraphs(*analysis_subgraphs)
                
                # Generate LLM-ready context
                analysis_report = GraphSearchTool.build_llm_context(
                    combined_analysis,
                    context_type="architecture",
                    include_code=True,
                    max_code_length=300
                )
                
                return f"Code Structure Analysis:\n{analysis_report}"
                
            except Exception as e:
                return f"Error during code structure analysis: {str(e)}"
        
        @tool
        async def search_code_patterns(pattern: str, similarity_threshold: float = 0.7) -> str:
            """
            Search for specific code patterns, functions, classes, or concepts in the repository.
            Use this tool to find specific implementations or understand how certain features work.
            
            Args:
                pattern: The pattern to search for (e.g., "authentication", "database connection", "API endpoint")
                similarity_threshold: How closely results should match the pattern (0.0-1.0)
            """
            print(f"🔍 Searching code patterns: '{pattern}' with similarity {similarity_threshold}")
            
            if not self.gitvizz_available:
                return f"GitVizz not available - would search for pattern: {pattern}"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for pattern search"
                
                search = GraphSearchTool(graph)
                
                # Perform fuzzy search with specified threshold
                pattern_results = search.fuzzy_search(
                    pattern, 
                    similarity_threshold=similarity_threshold,
                    max_results=15,
                    depth=2
                )
                
                # Generate detailed context about the found patterns
                pattern_report = GraphSearchTool.build_llm_context(
                    pattern_results,
                    context_type="analysis",
                    include_code=True,
                    max_code_length=400
                )
                
                return f"Code Pattern Search Results for '{pattern}':\n{pattern_report}"
                
            except Exception as e:
                return f"Error during pattern search: {str(e)}"
        
        @tool
        async def find_code_quality_issues() -> str:
            """
            Identify potential code quality issues like circular dependencies, anti-patterns, 
            and unused code. Use this tool to get recommendations for code improvements.
            """
            print(f"🔍 Analyzing code quality issues for repository: {repository_id}")
            
            if not self.gitvizz_available:
                return "GitVizz not available - using mock quality analysis"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for quality analysis"
                
                search = GraphSearchTool(graph)
                
                # Find various quality issues
                god_classes = search.find_anti_patterns("god_class")
                circular_deps = search.find_circular_dependencies()
                unused_code = search.find_unused_code()
                interface_violations = search.find_interface_violations()
                
                # Combine all quality issues
                quality_issues = GraphSearchTool.combine_subgraphs(
                    god_classes, circular_deps, unused_code, interface_violations
                )
                
                # Generate comprehensive quality report
                quality_report = GraphSearchTool.build_llm_context(
                    quality_issues,
                    context_type="review",
                    include_code=True,
                    max_code_length=200
                )
                
                return f"Code Quality Analysis:\n{quality_report}"
                
            except Exception as e:
                return f"Error during quality analysis: {str(e)}"
        
        @tool
        async def analyze_dependencies_and_flow(start_component: str = "", end_component: str = "") -> str:
            """
            Analyze dependencies and data flow between components in the codebase.
            Use this tool to understand how different parts of the code interact.
            
            Args:
                start_component: Starting component/function name (optional)
                end_component: Target component/function name (optional)
            """
            print(f"🔍 Analyzing dependencies and flow from '{start_component}' to '{end_component}'")
            
            if not self.gitvizz_available:
                return f"GitVizz not available - would analyze flow from {start_component} to {end_component}"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for dependency analysis"
                
                search = GraphSearchTool(graph)
                analyses = []
                
                # If specific components are provided, trace paths between them
                if start_component and end_component:
                    # First find the actual node IDs that match the component names
                    start_results = search.fuzzy_search(start_component, max_results=5)
                    end_results = search.fuzzy_search(end_component, max_results=5)
                    
                    analyses.extend([start_results, end_results])
                    
                    # Try to find paths between them
                    try:
                        if start_results.all_nodes_data and end_results.all_nodes_data:
                            start_node = start_results.all_nodes_data[0]["id"]
                            end_node = end_results.all_nodes_data[0]["id"]
                            path_analysis = search.find_paths(start_node, end_node, max_paths=3)
                            analyses.append(path_analysis)
                    except:
                        pass  # Path finding might fail, continue with other analyses
                
                elif start_component:
                    # Analyze neighbors and data flow from start component
                    component_results = search.fuzzy_search(start_component, max_results=5, depth=2)
                    analyses.append(component_results)
                    
                    if component_results.all_nodes_data:
                        start_node = component_results.all_nodes_data[0]["id"]
                        data_flow = search.find_data_flow(start_node)
                        analyses.append(data_flow)
                
                else:
                    # General dependency analysis
                    external_deps = search.find_external_dependencies()
                    layers = search.get_dependency_layers()
                    analyses.extend([external_deps, layers])
                
                # Combine all dependency analyses
                if analyses:
                    dependency_analysis = GraphSearchTool.combine_subgraphs(*analyses)
                else:
                    # Fallback to general dependency analysis
                    dependency_analysis = search.get_dependency_layers()
                
                # Generate dependency report
                dependency_report = GraphSearchTool.build_llm_context(
                    dependency_analysis,
                    context_type="analysis",
                    include_code=True,
                    max_code_length=300
                )
                
                return f"Dependency & Flow Analysis:\n{dependency_report}"
                
            except Exception as e:
                return f"Error during dependency analysis: {str(e)}"
        
        @tool
        async def find_security_and_testing_insights() -> str:
            """
            Identify potential security hotspots and areas that may need better test coverage.
            Use this tool to understand security considerations and testing gaps.
            """
            print(f"🔍 Analyzing security and testing aspects for repository: {repository_id}")
            
            if not self.gitvizz_available:
                return "GitVizz not available - using mock security/testing analysis"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for security/testing analysis"
                
                search = GraphSearchTool(graph)
                
                # Find security and testing related issues
                security_hotspots = search.find_security_hotspots()
                test_gaps = search.find_test_coverage_gaps()
                entry_points = search.find_entry_points()  # Important for security analysis
                
                # Combine security and testing analyses
                security_testing_analysis = GraphSearchTool.combine_subgraphs(
                    security_hotspots, test_gaps, entry_points
                )
                
                # Generate security/testing report
                security_report = GraphSearchTool.build_llm_context(
                    security_testing_analysis,
                    context_type="security",
                    include_code=True,
                    max_code_length=250
                )
                
                return f"Security & Testing Analysis:\n{security_report}"
                
            except Exception as e:
                return f"Error during security/testing analysis: {str(e)}"
        
        @tool
        async def get_repository_statistics() -> str:
            """
            Get comprehensive statistics about the repository including complexity metrics,
            file counts, and overall codebase health indicators.
            """
            print(f"📊 Getting repository statistics for: {repository_id}")
            
            if not self.gitvizz_available:
                return "GitVizz not available - using mock statistics"
            
            try:
                graph = await self.get_or_create_graph(repository_id, zip_file_path)
                if not graph:
                    return "Unable to generate code graph for statistics"
                
                search = GraphSearchTool(graph)
                
                # Get comprehensive statistics
                stats = search.get_statistics()
                
                # Format statistics in a readable way
                stats_report = f"""
Repository Statistics and Metrics:

📁 **File & Code Metrics:**
- Total Nodes: {stats.get('total_nodes', 0)}
- Total Edges: {stats.get('total_edges', 0)}
- Average Connectivity: {stats.get('avg_connectivity', 0):.2f}

🏗️ **Architecture Metrics:**
- Classes: {stats.get('node_types', {}).get('class', 0)}
- Functions: {stats.get('node_types', {}).get('function', 0)}
- Methods: {stats.get('node_types', {}).get('method', 0)}
- Modules: {stats.get('node_types', {}).get('module', 0)}

🔗 **Relationship Metrics:**
- Inheritance relationships: {stats.get('relationship_types', {}).get('inherits', 0)}
- Function calls: {stats.get('relationship_types', {}).get('calls', 0)}
- Import relationships: {stats.get('relationship_types', {}).get('imports_module', 0)}

⚡ **Complexity Indicators:**
- High connectivity nodes: {stats.get('high_connectivity_count', 0)}
- Circular dependencies: {stats.get('circular_deps_count', 0)}
- Potential god classes: {stats.get('anti_patterns', {}).get('god_class', 0)}

📈 **Health Score:** {stats.get('health_score', 'N/A')}
"""
                
                return stats_report.strip()
                
            except Exception as e:
                return f"Error getting repository statistics: {str(e)}"
        
        # Return all the tools
        return [
            analyze_code_structure,
            search_code_patterns,
            find_code_quality_issues,
            analyze_dependencies_and_flow,
            find_security_and_testing_insights,
            get_repository_statistics
        ]


# Global service instance
gitvizz_tools_service = GitVizzToolsService()
