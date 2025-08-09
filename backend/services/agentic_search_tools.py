# agentic_search_tools.py
import re
import logging
from typing import Dict, List, Optional, Any

from models.repository import Repository
from utils.file_utils import file_manager
from utils.graph_function_tools import GraphFunctionTools
from schemas.graph_schemas import GraphData

logger = logging.getLogger(__name__)

class AgenticSearchTools:
    """Enhanced search tools for agentic chat system with function calling"""
    
    def __init__(self, repository: Repository, graph_data: Optional[GraphData] = None):
        self.repository = repository
        self.graph_data = graph_data
        self.graph_tools = GraphFunctionTools(graph_data) if graph_data else None
        
    def get_function_definitions(self) -> List[Dict[str, Any]]:
        """Get OpenAI function calling definitions for all available tools"""
        
        functions = [
            {
                "name": "search_code_by_keywords",
                "description": "Search for code containing specific keywords or patterns. Great for finding implementations, API calls, or specific functionality.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Keywords to search for in code"
                        },
                        "file_types": {
                            "type": "array", 
                            "items": {"type": "string"},
                            "description": "File extensions to limit search to (e.g., ['.py', '.js'])"
                        },
                        "case_sensitive": {
                            "type": "boolean",
                            "default": False,
                            "description": "Whether search should be case sensitive"
                        },
                        "limit": {
                            "type": "integer", 
                            "default": 10,
                            "description": "Maximum number of results to return"
                        }
                    },
                    "required": ["keywords"]
                }
            },
            {
                "name": "search_api_routes",
                "description": "Specifically search for API routes, endpoints, and route definitions. Use this when user asks about routes, endpoints, or API structure.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "route_patterns": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Patterns to search for (e.g., ['@app.route', 'router.', 'app.get', 'app.post'])"
                        },
                        "include_methods": {
                            "type": "boolean",
                            "default": True,
                            "description": "Include HTTP methods (GET, POST, etc.) in results"
                        }
                    },
                    "required": []
                }
            },
            {
                "name": "get_file_structure", 
                "description": "Get the repository file and directory structure. Useful for understanding project layout.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_depth": {
                            "type": "integer",
                            "default": 3,
                            "description": "Maximum directory depth to show"
                        },
                        "show_files": {
                            "type": "boolean", 
                            "default": True,
                            "description": "Whether to show files or just directories"
                        }
                    }
                }
            },
            {
                "name": "search_functions_and_classes",
                "description": "Search for specific functions, classes, or methods by name or pattern.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name_patterns": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Function/class name patterns to search for"
                        },
                        "node_types": {
                            "type": "array",
                            "items": {"type": "string", "enum": ["function", "class", "method", "module"]},
                            "description": "Types of nodes to search for"
                        },
                        "limit": {
                            "type": "integer",
                            "default": 15,
                            "description": "Maximum number of results"
                        }
                    },
                    "required": ["name_patterns"]
                }
            },
            {
                "name": "explore_file_contents",
                "description": "Get detailed contents of specific files. Use when you need to examine specific files in detail.",
                "parameters": {
                    "type": "object", 
                    "properties": {
                        "file_paths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Paths of files to examine"
                        },
                        "include_line_numbers": {
                            "type": "boolean",
                            "default": True,
                            "description": "Whether to include line numbers"
                        },
                        "max_lines_per_file": {
                            "type": "integer",
                            "default": 100,
                            "description": "Maximum lines to return per file"
                        }
                    },
                    "required": ["file_paths"]
                }
            },
            {
                "name": "explore_dependencies",
                "description": "Explore relationships and dependencies between code components.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_nodes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Starting node names or IDs to explore from"
                        },
                        "relationship_types": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Types of relationships to follow (e.g., ['calls', 'imports', 'inherits'])"
                        },
                        "max_depth": {
                            "type": "integer",
                            "default": 2, 
                            "description": "Maximum depth to explore"
                        }
                    },
                    "required": ["start_nodes"]
                }
            },
            {
                "name": "smart_context_search",
                "description": "Perform an intelligent search based on user intent. Use this for complex or ambiguous queries.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_intent": {
                            "type": "string",
                            "description": "Description of what the user is looking for"
                        },
                        "context_type": {
                            "type": "string",
                            "enum": ["overview", "implementation", "usage", "debugging"],
                            "description": "Type of context needed"
                        },
                        "focus_areas": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Specific areas to focus on (e.g., ['authentication', 'routing', 'database'])"
                        }
                    },
                    "required": ["user_intent"]
                }
            }
        ]
        
        return functions
    
    async def search_code_by_keywords(self, keywords: List[str], file_types: Optional[List[str]] = None, 
                                    case_sensitive: bool = False, limit: int = 10) -> Dict[str, Any]:
        """Search for code containing specific keywords"""
        logger.info(f"🔍 Searching code for keywords: {keywords}")
        
        results = []
        
        if not self.graph_tools:
            return {"success": False, "error": "Graph data not available", "results": []}
        
        try:
            for keyword in keywords:
                # Search in code content
                matches = self.graph_tools.search_by_code_content(keyword, limit=max(5, limit // len(keywords)))
                
                for match in matches:
                    result = {
                        "keyword": keyword,
                        "node_id": match.get("id"),
                        "node_name": match.get("name"),
                        "node_type": match.get("category"),
                        "file_path": match.get("file"),
                        "line_range": f"{match.get('start_line', 0)}-{match.get('end_line', 0)}",
                        "relevance": match.get("relevance_score", 0.5),
                        "code_snippet": match.get("code_snippet", "").strip()[:300]
                    }
                    results.append(result)
            
            # Sort by relevance and limit
            results = sorted(results, key=lambda x: x["relevance"], reverse=True)[:limit]
            
            logger.info(f"✅ Found {len(results)} code matches")
            return {
                "success": True,
                "results": results,
                "total_found": len(results),
                "search_keywords": keywords
            }
            
        except Exception as e:
            logger.error(f"❌ Error in code search: {e}")
            return {"success": False, "error": str(e), "results": []}
    
    async def search_api_routes(self, route_patterns: Optional[List[str]] = None, 
                              include_methods: bool = True) -> Dict[str, Any]:
        """Search specifically for API routes and endpoints"""
        logger.info("🛣️ Searching for API routes")
        
        # Default route patterns for common frameworks
        if not route_patterns:
            route_patterns = [
                "@app.route",
                "app.get", "app.post", "app.put", "app.delete", "app.patch",
                "router.get", "router.post", "router.put", "router.delete",
                "include_router",
                "APIRouter",
                "FastAPI",
                "Blueprint",
                "@api.route",
                "app.include_router"
            ]
        
        all_results = []
        
        # Search for each route pattern
        for pattern in route_patterns:
            keyword_results = await self.search_code_by_keywords([pattern], limit=20)
            if keyword_results["success"]:
                for result in keyword_results["results"]:
                    result["route_pattern"] = pattern
                    result["is_route_definition"] = True
                all_results.extend(keyword_results["results"])
        
        # Also search for HTTP methods if requested
        if include_methods:
            http_methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]
            for method in http_methods:
                method_results = await self.search_code_by_keywords([f'"{method}"', f"'{method}'"], limit=10)
                if method_results["success"]:
                    for result in method_results["results"]:
                        result["http_method"] = method
                        result["is_method_usage"] = True
                    all_results.extend(method_results["results"])
        
        # Remove duplicates and sort by relevance
        seen_nodes = set()
        unique_results = []
        for result in all_results:
            node_key = f"{result.get('file_path')}:{result.get('line_range')}"
            if node_key not in seen_nodes:
                seen_nodes.add(node_key)
                unique_results.append(result)
        
        unique_results = sorted(unique_results, key=lambda x: x.get("relevance", 0), reverse=True)[:20]
        
        logger.info(f"✅ Found {len(unique_results)} route-related matches")
        return {
            "success": True,
            "results": unique_results,
            "total_found": len(unique_results),
            "route_patterns_used": route_patterns
        }
    
    async def get_file_structure(self, max_depth: int = 3, show_files: bool = True) -> Dict[str, Any]:
        """Get repository file and directory structure"""
        logger.info(f"📁 Getting file structure (depth: {max_depth}, files: {show_files})")
        
        try:
            if not self.graph_tools:
                return {"success": False, "error": "Graph data not available"}
            
            # Get all nodes and organize by file path
            all_nodes = []
            for node in self.graph_data.nodes if self.graph_data else []:
                if node.file and len(node.file.strip()) > 0:
                    all_nodes.append({
                        "file_path": node.file,
                        "node_name": node.name,
                        "node_type": node.category
                    })
            
            # Organize into directory structure
            file_tree = {}
            files_by_dir = {}
            
            for node in all_nodes:
                file_path = node["file_path"]
                path_parts = file_path.split("/")
                
                # Track directory
                dir_path = "/".join(path_parts[:-1]) if len(path_parts) > 1 else "."
                if dir_path not in files_by_dir:
                    files_by_dir[dir_path] = []
                
                if show_files:
                    files_by_dir[dir_path].append({
                        "name": path_parts[-1],
                        "type": "file",
                        "nodes": [{"name": node["node_name"], "type": node["node_type"]}]
                    })
            
            # Build tree structure
            directories = sorted(files_by_dir.keys())
            for dir_path in directories:
                if dir_path.count("/") <= max_depth:
                    file_tree[dir_path] = {
                        "type": "directory",
                        "files": files_by_dir[dir_path][:10]  # Limit files per directory
                    }
            
            logger.info(f"✅ Built file structure with {len(file_tree)} directories")
            return {
                "success": True,
                "structure": file_tree,
                "total_directories": len(file_tree),
                "total_files": sum(len(info["files"]) for info in file_tree.values())
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting file structure: {e}")
            return {"success": False, "error": str(e)}
    
    async def search_functions_and_classes(self, name_patterns: List[str], 
                                          node_types: Optional[List[str]] = None, 
                                          limit: int = 15) -> Dict[str, Any]:
        """Search for functions, classes, and methods"""
        logger.info(f"🔍 Searching for functions/classes: {name_patterns}")
        
        if not node_types:
            node_types = ["function", "class", "method", "module"]
        
        results = []
        
        try:
            if not self.graph_tools:
                return {"success": False, "error": "Graph data not available"}
            
            for pattern in name_patterns:
                # Search by name pattern
                from schemas.graph_schemas import GetNodesByNamePatternParams
                params = GetNodesByNamePatternParams(pattern=f"*{pattern}*", limit=limit)
                matches = self.graph_tools.get_nodes_by_name_pattern(params)
                
                for match in matches:
                    if match.get("category") in node_types:
                        result = {
                            "pattern": pattern,
                            "node_id": match.get("id"),
                            "name": match.get("name"),
                            "type": match.get("category"),
                            "file_path": match.get("file"),
                            "line_range": f"{match.get('start_line', 0)}-{match.get('end_line', 0)}",
                            "code_preview": (match.get("code") or "")[:200]
                        }
                        results.append(result)
            
            # Remove duplicates and limit
            seen_nodes = set()
            unique_results = []
            for result in results:
                node_key = result["node_id"]
                if node_key not in seen_nodes:
                    seen_nodes.add(node_key)
                    unique_results.append(result)
            
            unique_results = unique_results[:limit]
            
            logger.info(f"✅ Found {len(unique_results)} function/class matches")
            return {
                "success": True,
                "results": unique_results,
                "total_found": len(unique_results),
                "name_patterns": name_patterns,
                "node_types_searched": node_types
            }
            
        except Exception as e:
            logger.error(f"❌ Error searching functions/classes: {e}")
            return {"success": False, "error": str(e), "results": []}
    
    async def explore_file_contents(self, file_paths: List[str], 
                                  include_line_numbers: bool = True, 
                                  max_lines_per_file: int = 100) -> Dict[str, Any]:
        """Get detailed contents of specific files"""
        logger.info(f"📖 Exploring file contents: {file_paths}")
        
        results = []
        
        try:
            # Load full repository text content
            full_content = await file_manager.load_text_content(self.repository.file_paths.text)
            if not full_content:
                return {"success": False, "error": "Repository content not available"}
            
            # Split content by files (this is a simplified approach)
            # In a real implementation, you'd want more sophisticated file parsing
            for file_path in file_paths:
                file_content = self._extract_file_content_from_full_text(full_content, file_path)
                
                if file_content:
                    lines = file_content.split('\n')
                    if len(lines) > max_lines_per_file:
                        lines = lines[:max_lines_per_file]
                        truncated = True
                    else:
                        truncated = False
                    
                    if include_line_numbers:
                        numbered_lines = [f"{i+1:4d}: {line}" for i, line in enumerate(lines)]
                        content = '\n'.join(numbered_lines)
                    else:
                        content = '\n'.join(lines)
                    
                    results.append({
                        "file_path": file_path,
                        "content": content,
                        "line_count": len(lines),
                        "truncated": truncated,
                        "character_count": len(content)
                    })
                else:
                    results.append({
                        "file_path": file_path,
                        "content": None,
                        "error": "File not found in repository content"
                    })
            
            logger.info(f"✅ Explored {len(results)} files")
            return {
                "success": True,
                "files": results,
                "total_files": len(results)
            }
            
        except Exception as e:
            logger.error(f"❌ Error exploring file contents: {e}")
            return {"success": False, "error": str(e), "files": []}
    
    def _extract_file_content_from_full_text(self, full_content: str, file_path: str) -> Optional[str]:
        """Extract specific file content from full repository text (simplified)"""
        # This is a simplified implementation
        # Look for file markers in the content
        file_markers = [
            f"File: {file_path}",
            f"# {file_path}",
            f"## {file_path}",
            file_path
        ]
        
        lines = full_content.split('\n')
        start_idx = None
        
        # Find start of file
        for i, line in enumerate(lines):
            if any(marker in line for marker in file_markers):
                start_idx = i
                break
        
        if start_idx is None:
            return None
        
        # Find end of file (next file marker or end)
        end_idx = len(lines)
        for i in range(start_idx + 1, len(lines)):
            line = lines[i]
            if any(marker in line for marker in ["File: ", "# ", "## "] if not any(fm in line for fm in file_markers)):
                end_idx = i
                break
        
        return '\n'.join(lines[start_idx:end_idx])
    
    async def explore_dependencies(self, start_nodes: List[str], 
                                 relationship_types: Optional[List[str]] = None, 
                                 max_depth: int = 2) -> Dict[str, Any]:
        """Explore relationships and dependencies between components"""
        logger.info(f"🕸️ Exploring dependencies from: {start_nodes}")
        
        if not relationship_types:
            relationship_types = ["calls", "imports", "inherits", "references"]
        
        try:
            if not self.graph_tools:
                return {"success": False, "error": "Graph data not available"}
            
            all_traversals = []
            
            for start_node in start_nodes:
                # Find the node first
                from schemas.graph_schemas import GetNodesByNamePatternParams, TraverseDependenciesParams
                
                # Try to find node by name
                search_params = GetNodesByNamePatternParams(pattern=f"*{start_node}*", limit=5)
                matching_nodes = self.graph_tools.get_nodes_by_name_pattern(search_params)
                
                if matching_nodes:
                    # Use the first match
                    node_id = matching_nodes[0]["id"]
                    
                    # Traverse dependencies
                    traverse_params = TraverseDependenciesParams(
                        node_id=node_id,
                        depth=max_depth,
                        follow_relationships=relationship_types
                    )
                    
                    traversal_result = self.graph_tools.traverse_dependencies(traverse_params)
                    traversal_result["start_node"] = start_node
                    traversal_result["start_node_id"] = node_id
                    all_traversals.append(traversal_result)
            
            logger.info(f"✅ Explored dependencies for {len(all_traversals)} nodes")
            return {
                "success": True,
                "traversals": all_traversals,
                "relationship_types_used": relationship_types,
                "max_depth": max_depth
            }
            
        except Exception as e:
            logger.error(f"❌ Error exploring dependencies: {e}")
            return {"success": False, "error": str(e), "traversals": []}
    
    async def smart_context_search(self, user_intent: str, 
                                 context_type: str = "overview", 
                                 focus_areas: Optional[List[str]] = None) -> Dict[str, Any]:
        """Perform intelligent search based on user intent"""
        logger.info(f"🧠 Smart context search - Intent: {user_intent}")
        
        results = {"search_strategy": [], "combined_results": []}
        
        try:
            # Analyze intent and determine search strategy
            intent_lower = user_intent.lower()
            
            # Strategy 1: If asking about routes/endpoints
            if any(term in intent_lower for term in ['route', 'endpoint', 'api', 'path']):
                results["search_strategy"].append("api_routes")
                route_results = await self.search_api_routes()
                if route_results["success"]:
                    results["combined_results"].extend(route_results["results"])
            
            # Strategy 2: If asking about specific functions/classes
            if any(term in intent_lower for term in ['function', 'class', 'method', 'implement']):
                results["search_strategy"].append("functions_classes")
                # Extract potential names from intent
                words = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', user_intent)
                meaningful_words = [w for w in words if len(w) > 3 and w.lower() not in ['what', 'are', 'all', 'the', 'this', 'that', 'with', 'from']]
                
                if meaningful_words:
                    func_results = await self.search_functions_and_classes(meaningful_words[:5])
                    if func_results["success"]:
                        results["combined_results"].extend(func_results["results"])
            
            # Strategy 3: General keyword search
            if context_type == "implementation":
                results["search_strategy"].append("keyword_search")
                # Extract key terms from user intent
                key_terms = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', user_intent)
                filtered_terms = [term for term in key_terms if len(term) > 3]
                
                if filtered_terms:
                    keyword_results = await self.search_code_by_keywords(filtered_terms[:3])
                    if keyword_results["success"]:
                        results["combined_results"].extend(keyword_results["results"])
            
            # Strategy 4: File structure for overview
            if context_type == "overview":
                results["search_strategy"].append("file_structure")
                structure_results = await self.get_file_structure()
                if structure_results["success"]:
                    results["file_structure"] = structure_results["structure"]
            
            logger.info(f"✅ Smart search completed with {len(results['search_strategy'])} strategies")
            return {
                "success": True,
                "user_intent": user_intent,
                "context_type": context_type,
                "strategies_used": results["search_strategy"],
                "results": results["combined_results"][:20],  # Limit results
                "file_structure": results.get("file_structure"),
                "total_results": len(results["combined_results"])
            }
            
        except Exception as e:
            logger.error(f"❌ Error in smart context search: {e}")
            return {"success": False, "error": str(e)}
    
    async def call_function(self, function_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Call a function by name with parameters - used by the agentic controller"""
        
        function_map = {
            "search_code_by_keywords": self.search_code_by_keywords,
            "search_api_routes": self.search_api_routes,
            "get_file_structure": self.get_file_structure,
            "search_functions_and_classes": self.search_functions_and_classes,
            "explore_file_contents": self.explore_file_contents,
            "explore_dependencies": self.explore_dependencies,
            "smart_context_search": self.smart_context_search
        }
        
        if function_name not in function_map:
            return {"success": False, "error": f"Unknown function: {function_name}"}
        
        try:
            result = await function_map[function_name](**parameters)
            return result
        except Exception as e:
            logger.error(f"❌ Error calling {function_name}: {e}")
            return {"success": False, "error": str(e)}