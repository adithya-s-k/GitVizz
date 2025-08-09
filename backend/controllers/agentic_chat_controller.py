# agentic_chat_controller.py
import json
import logging
import time
import uuid
from typing import AsyncGenerator, Dict, List, Optional, Any
from fastapi import HTTPException, Form
from typing_extensions import Annotated
from datetime import datetime, timezone

from models.chat import ChatSession, Conversation
from models.repository import Repository
from models.user import User
from utils.llm_utils import llm_service
from utils.jwt_utils import get_current_user
from services.agentic_search_tools import AgenticSearchTools
from services.graph_search_service import graph_search_service
from schemas.chat_schemas import StreamChatResponse

logger = logging.getLogger(__name__)

class AgenticChatController:
    """Agentic chat controller with multi-stage retrieval and function calling"""
    
    def __init__(self):
        self.active_sessions: Dict[str, Dict] = {}
    
    async def process_agentic_streaming_chat(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        message: Annotated[str, Form(description="User's message/question")],
        repository_id: Annotated[str, Form(description="Repository ID to chat about")],
        use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID")] = None,
        provider: Annotated[str, Form(description="LLM provider")] = "openai",
        model: Annotated[str, Form(description="Model name")] = "gpt-4",
        temperature: Annotated[float, Form(description="Response randomness", ge=0.0, le=2.0)] = 0.7,
        max_tokens: Annotated[Optional[int], Form(description="Maximum tokens", ge=1, le=8000)] = None
    ) -> AsyncGenerator[str, None]:
        """Process chat with agentic multi-stage retrieval"""
        
        session_id = str(uuid.uuid4())
        logger.info(f"🤖 Starting agentic chat session: {session_id}")
        
        try:
            # Authenticate user
            user = await get_current_user(token)
            if not user:
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error="Invalid JWT token",
                    error_type="authentication_error"
                ).model_dump()) + "\n"
                return
            
            # Get or create chat session (reuse from original controller)
            from controllers.chat_controller import chat_controller
            chat_session = await chat_controller.get_or_create_chat_session(
                user, repository_id, chat_id
            )
            
            # Generate conversation ID
            conversation_id = conversation_id or str(uuid.uuid4())
            
            # Yield initial status
            yield json.dumps(StreamChatResponse(
                event="agent_thinking", 
                content="🤖 Analyzing your query and planning search strategy...",
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
            
            # Initialize agentic session
            session_data = {
                "session_id": session_id,
                "user_query": message,
                "repository": chat_session.repository,
                "search_tools": None,
                "context_built": [],
                "function_calls": [],
                "thinking_steps": []
            }
            
            # Load graph data and initialize tools
            try:
                graph_data = await graph_search_service.load_graph_data(chat_session.repository)
                session_data["search_tools"] = AgenticSearchTools(chat_session.repository, graph_data)
                
                yield json.dumps(StreamChatResponse(
                    event="agent_thinking",
                    content="✅ Repository analysis tools loaded. Starting intelligent search...",
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                
            except Exception as e:
                logger.error(f"Error loading graph data: {e}")
                yield json.dumps(StreamChatResponse(
                    event="agent_thinking",
                    content="⚠️ Using fallback search mode (limited graph data)",
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                
                session_data["search_tools"] = AgenticSearchTools(chat_session.repository, None)
            
            self.active_sessions[session_id] = session_data
            
            # Start agentic processing
            async for chunk in self._process_agentic_query(
                session_id, user, use_user, chat_session, conversation_id, 
                provider, model, temperature, max_tokens
            ):
                yield chunk
                
        except Exception as e:
            logger.error(f"❌ Error in agentic chat: {e}")
            yield json.dumps(StreamChatResponse(
                event="error",
                error=str(e),
                error_type="server_error"
            ).model_dump()) + "\n"
        
        finally:
            # Clean up session
            if session_id in self.active_sessions:
                del self.active_sessions[session_id]
    
    async def _process_agentic_query(
        self, 
        session_id: str,
        user: User,
        use_user: bool,
        chat_session: ChatSession,
        conversation_id: str,
        provider: str,
        model: str,
        temperature: float,
        max_tokens: Optional[int]
    ) -> AsyncGenerator[str, None]:
        """Core agentic processing with deterministic plan execution"""
        
        session = self.active_sessions[session_id]
        search_tools = session["search_tools"]
        user_query = session["user_query"]
        
        # Create execution plan (list of tools to call in order)
        execution_plan = await self._create_execution_plan(user_query)
        
        # Log the execution plan for debugging
        logger.info(f"📋 EXECUTION PLAN CREATED:")
        logger.info(f"   User query: '{user_query}'")
        logger.info(f"   Query analysis: {user_query.lower()}")
        logger.info(f"   Plan steps ({len(execution_plan)}): {execution_plan}")
        
        yield json.dumps(StreamChatResponse(
            event="agent_thinking",
            content=f"📋 Created execution plan with {len(execution_plan)} steps: {', '.join(execution_plan)}",
            chat_id=chat_session.chat_id,
            conversation_id=conversation_id
        ).model_dump()) + "\n"
        
        # Execute each tool in the plan deterministically
        collected_results = []
        for step_num, tool_name in enumerate(execution_plan, 1):
            yield json.dumps(StreamChatResponse(
                event="agent_thinking",
                content=f"🔧 Step {step_num}/{len(execution_plan)}: Executing {tool_name}",
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
            
            # Execute the tool
            async for chunk in self._execute_planned_tool(
                tool_name, user_query, session, chat_session.chat_id, conversation_id
            ):
                yield chunk
            
            # Get the result from the last function call
            if session["function_calls"]:
                latest_result = session["function_calls"][-1]
                collected_results.append(latest_result)
        
        yield json.dumps(StreamChatResponse(
            event="agent_thinking",
            content=f"✅ Completed all {len(execution_plan)} planned steps. Synthesizing comprehensive answer...",
            chat_id=chat_session.chat_id,
            conversation_id=conversation_id
        ).model_dump()) + "\n"
        
        # Now synthesize the final answer using all collected results
        try:
            # Log synthesis input for debugging
            logger.info(f"📝 STARTING FINAL SYNTHESIS:")
            logger.info(f"   User query: {user_query}")
            logger.info(f"   Collected results count: {len(collected_results)}")
            for i, result in enumerate(collected_results):
                tool_name = result.get("function_name", "unknown")
                success = result.get("result", {}).get("success", False)
                logger.info(f"   Result {i+1}: {tool_name} - {'✅ Success' if success else '❌ Failed'}")
            
            final_answer = await self._synthesize_final_answer(user_query, collected_results)
            
            # Log the final answer length and preview
            logger.info(f"📝 SYNTHESIS COMPLETE:")
            logger.info(f"   Final answer length: {len(final_answer)} characters")
            logger.info(f"   Answer preview: {final_answer[:200]}{'...' if len(final_answer) > 200 else ''}")
            
            # Stream the final answer
            for word in final_answer.split():
                yield json.dumps(StreamChatResponse(
                    event="token",
                    token=word + " ",
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
            
            # Send completion
            yield json.dumps(StreamChatResponse(
                event="complete",
                provider=provider,
                model=model,
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
                
        except Exception as e:
            logger.error(f"❌ Error in final synthesis: {e}")
            yield json.dumps(StreamChatResponse(
                event="error",
                error=str(e),
                error_type="synthesis_error",
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
    
    async def _stream_function_calling_conversation(
        self,
        messages: List[Dict[str, str]],
        function_definitions: List[Dict[str, Any]],
        session: Dict[str, Any],
        user: User,
        use_user: bool,
        chat_session: ChatSession,
        provider: str,
        model: str,
        temperature: float,
        max_tokens: Optional[int],
        conversation_id: str
    ) -> AsyncGenerator[str, None]:
        """Handle the function calling conversation loop"""
        
        max_iterations = 5  # Prevent infinite loops
        iteration = 0
        full_response = ""
        
        while iteration < max_iterations:
            iteration += 1
            logger.info(f"🔄 Function calling iteration {iteration}")
            
            try:
                # Call LLM with function calling capability
                llm_response = llm_service.generate_response_with_functions(
                    user=user,
                    use_user=use_user,
                    messages=messages,
                    functions=function_definitions,
                    provider=provider,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True
                )
                
                # Process the streaming response
                current_function_call = None
                current_arguments = ""
                
                async for chunk in llm_response:
                    chunk_type = chunk.get("type", "")
                    
                    if chunk_type == "function_call_start":
                        current_function_call = chunk.get("function_name")
                        current_arguments = ""
                        
                        # Check for duplicate function calls to prevent loops (check all previous calls)
                        all_previous_calls = [call["function_name"] for call in session["function_calls"]]
                        if current_function_call in all_previous_calls:
                            logger.warning(f"⚠️ Duplicate function call detected: {current_function_call} (already called)")
                            yield json.dumps(StreamChatResponse(
                                event="agent_thinking",
                                content=f"⚠️ Skipping duplicate call to {current_function_call} - using previous results instead.",
                                chat_id=chat_session.chat_id,
                                conversation_id=conversation_id
                            ).model_dump()) + "\n"
                            current_function_call = None  # Skip this call
                            continue
                        
                        yield json.dumps(StreamChatResponse(
                            event="tool_call_start",
                            content=f"🔧 Calling tool: {current_function_call}",
                            tool_name=current_function_call,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif chunk_type == "function_call_arguments":
                        current_arguments += chunk.get("arguments", "")
                        
                    elif chunk_type == "function_call_end":
                        # Execute the function call (only if not marked as duplicate)
                        if current_function_call and current_arguments:
                            async for func_chunk in self._execute_and_stream_function_call(
                                current_function_call, current_arguments, 
                                session, chat_session.chat_id, conversation_id
                            ):
                                yield func_chunk
                        elif current_function_call is None:
                            # This was a duplicate call that was skipped
                            yield json.dumps(StreamChatResponse(
                                event="tool_call_result",
                                content="✅ Using previous results to avoid redundancy",
                                tool_name="skip_duplicate",
                                chat_id=chat_session.chat_id,
                                conversation_id=conversation_id
                            ).model_dump()) + "\n"
                            
                    elif chunk_type == "token":
                        # Regular response token
                        token_content = chunk.get("token", "")
                        full_response += token_content
                        
                        yield json.dumps(StreamChatResponse(
                            event="token",
                            token=token_content,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif chunk_type == "complete":
                        # Check if we have function calls to process
                        recent_calls = [call for call in session["function_calls"] if call not in [msg.get("name") for msg in messages if msg.get("role") == "function"]]
                        
                        if recent_calls and iteration < max_iterations:
                            # Add function results to conversation and continue
                            latest_call = session["function_calls"][-1]
                            function_result = json.dumps(latest_call["result"], indent=2)[:1000]  # Limit size
                            messages.append({
                                "role": "function", 
                                "name": latest_call["function_name"],
                                "content": function_result
                            })
                            logger.info(f"🔄 Added function result for {latest_call['function_name']}, continuing...")
                            break  # Continue to next iteration
                        else:
                            # Check if we have a good response or need to force synthesis
                            if not full_response.strip() and session["function_calls"]:
                                # If no response content but we have function calls, force final synthesis
                                logger.info("🔄 Forcing final synthesis from function call results...")
                                messages.append({
                                    "role": "user",
                                    "content": f"You have completed the search plan for '{session['user_query']}'. Based on the function call results above, provide your comprehensive final answer. Do NOT call any more tools - just synthesize the information you gathered."
                                })
                                break  # One more iteration for synthesis
                            
                            # Send completion
                            logger.info(f"🏁 Completing after {iteration} iterations with {len(session['function_calls'])} function calls")
                            yield json.dumps(StreamChatResponse(
                                event="complete",
                                provider=provider,
                                model=model,
                                usage=chunk.get("usage", {}),
                                chat_id=chat_session.chat_id,
                                conversation_id=conversation_id
                            ).model_dump()) + "\n"
                            return
                            
                    elif chunk_type == "error":
                        yield json.dumps(StreamChatResponse(
                            event="error",
                            error=chunk.get("error", "Unknown error"),
                            error_type="llm_error",
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        return
                
                # If we get here, we need another iteration
                if len(session["function_calls"]) == 0:
                    # No function calls were made, we're done
                    break
                    
            except Exception as e:
                logger.error(f"❌ Error in function calling iteration {iteration}: {e}")
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error=f"Error in function calling: {str(e)}",
                    error_type="function_calling_error",
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                return
        
        # If we exhausted max iterations without a response, provide fallback answer
        if iteration >= max_iterations:
            yield json.dumps(StreamChatResponse(
                event="agent_thinking",
                content="⚠️ Reached maximum search iterations. Synthesizing results...",
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
            
            # Create a comprehensive fallback response based on function call results
            if session["function_calls"]:
                fallback_content = await self._synthesize_fallback_response(session["user_query"], session["function_calls"])
                
                # Stream the fallback response
                for word in fallback_content.split():
                    yield json.dumps(StreamChatResponse(
                        event="token",
                        token=word + " ",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    ).model_dump()) + "\n"
        
        # Final completion
        yield json.dumps(StreamChatResponse(
            event="complete",
            provider=provider,
            model=model,
            chat_id=chat_session.chat_id,
            conversation_id=conversation_id
        ).model_dump()) + "\n"
    
    async def _synthesize_fallback_response(self, user_query: str, function_calls: List[Dict[str, Any]]) -> str:
        """Synthesize a comprehensive response based on function call results"""
        if not function_calls:
            return "I apologize, but I wasn't able to gather information to answer your question. Please try rephrasing your query."
        
        query_lower = user_query.lower()
        
        # Analyze what types of information we gathered
        routes_data = []
        code_matches = []
        file_structure = None
        functions_classes = []
        file_contents = []
        dependencies = []
        smart_search_results = []
        
        # Extract and categorize results from function calls
        for call in function_calls:
            func_name = call.get("function_name", "")
            result = call.get("result", {})
            
            if not result.get("success"):
                continue
                
            if func_name == "search_api_routes":
                routes_data.extend(result.get("results", []))
            elif func_name == "search_code_by_keywords":
                code_matches.extend(result.get("results", []))
            elif func_name == "get_file_structure":
                file_structure = result
            elif func_name == "search_functions_and_classes":
                functions_classes.extend(result.get("results", []))
            elif func_name == "explore_file_contents":
                file_contents.extend(result.get("files", []))
            elif func_name == "explore_dependencies":
                dependencies.extend(result.get("traversals", []))
            elif func_name == "smart_context_search":
                smart_search_results.extend(result.get("results", []))
        
        # Build response based on query intent and available data
        if any(term in query_lower for term in ['routes', 'endpoints', 'api']):
            return self._synthesize_routes_response(routes_data, code_matches, file_structure)
        elif any(term in query_lower for term in ['about', 'overview', 'what is', 'describe', 'purpose']):
            return self._synthesize_overview_response(file_structure, functions_classes, file_contents, routes_data)
        elif any(term in query_lower for term in ['functions', 'classes', 'methods', 'code structure']):
            return self._synthesize_code_structure_response(functions_classes, file_structure, code_matches)
        elif any(term in query_lower for term in ['dependencies', 'imports', 'modules', 'packages']):
            return self._synthesize_dependencies_response(dependencies, file_contents, code_matches)
        elif any(term in query_lower for term in ['files', 'structure', 'organization', 'layout']):
            return self._synthesize_file_structure_response(file_structure, code_matches)
        else:
            # Generic comprehensive response
            return self._synthesize_generic_response(
                user_query, routes_data, code_matches, file_structure, 
                functions_classes, smart_search_results
            )
    
    def _synthesize_routes_response(self, routes_data: List, code_matches: List, file_structure: Dict = None) -> str:
        """Synthesize response specifically for routes/API endpoints queries"""
        response_parts = ["# API Routes and Endpoints\n"]
        
        if routes_data:
            response_parts.append(f"Found **{len(routes_data)} API routes** in the repository:\n")
            
            # Group routes by file
            routes_by_file = {}
            for route in routes_data:
                file_path = route.get("file_path", "Unknown")
                if file_path not in routes_by_file:
                    routes_by_file[file_path] = []
                routes_by_file[file_path].append(route)
            
            for file_path, file_routes in routes_by_file.items():
                response_parts.append(f"\n## {file_path}")
                for route in file_routes:
                    method = route.get("method", "Unknown")
                    path = route.get("path", route.get("route_pattern", "Unknown"))
                    function_name = route.get("function_name", "")
                    line_number = route.get("line_number", "")
                    
                    route_desc = f"- **{method}** `{path}`"
                    if function_name:
                        route_desc += f" → `{function_name}()`"
                    if line_number:
                        route_desc += f" (line {line_number})"
                    
                    response_parts.append(route_desc)
        
        # Add additional code matches if found
        if code_matches:
            additional_routes = [match for match in code_matches if any(
                term in match.get("content", "").lower() 
                for term in ["@app.route", "@router", "router.", "fastapi", "endpoint"]
            )]
            
            if additional_routes:
                response_parts.append(f"\n## Additional Route Patterns Found")
                response_parts.append(f"Found {len(additional_routes)} additional route-related code snippets:")
                
                for match in additional_routes[:5]:  # Limit to 5 most relevant
                    file_path = match.get("file_path", "Unknown")
                    line_number = match.get("line_number", "")
                    content = match.get("content", "").strip()[:100] + "..." if len(match.get("content", "")) > 100 else match.get("content", "").strip()
                    
                    response_parts.append(f"- `{file_path}:{line_number}` - {content}")
        
        if not routes_data and not code_matches:
            response_parts.append("No API routes were found in the repository. This might be:")
            response_parts.append("- A library or utility project without web endpoints")
            response_parts.append("- Using a framework I don't recognize")
            response_parts.append("- Routes defined in configuration files")
        
        return "\n".join(response_parts)
    
    def _synthesize_overview_response(self, file_structure: Dict, functions_classes: List, file_contents: List, routes_data: List) -> str:
        """Synthesize a comprehensive repository overview"""
        response_parts = ["# Repository Overview\n"]
        
        # Basic structure info
        if file_structure:
            total_files = file_structure.get("total_files", 0)
            total_dirs = file_structure.get("total_directories", 0)
            main_dirs = file_structure.get("directories", [])[:5]  # Top 5 directories
            
            response_parts.append(f"This repository contains **{total_files} files** across **{total_dirs} directories**.")
            
            if main_dirs:
                response_parts.append(f"\n## Project Structure")
                response_parts.append("Main directories:")
                for dir_info in main_dirs:
                    dir_name = dir_info.get("name", "Unknown")
                    file_count = len(dir_info.get("files", []))
                    response_parts.append(f"- `{dir_name}/` ({file_count} files)")
        
        # Identify project type based on files and routes
        project_type = self._identify_project_type(file_contents, routes_data, file_structure)
        if project_type:
            response_parts.append(f"\n## Project Type")
            response_parts.append(project_type)
        
        # Key functions and classes
        if functions_classes:
            response_parts.append(f"\n## Key Components")
            response_parts.append(f"Found **{len(functions_classes)} functions/classes**:")
            
            # Group by type and show most important ones
            main_functions = [f for f in functions_classes if any(
                term in f.get("name", "").lower() 
                for term in ["main", "app", "server", "init", "start", "run"]
            )][:3]
            
            if main_functions:
                response_parts.append("\n**Main Components:**")
                for func in main_functions:
                    func_name = func.get("name", "Unknown")
                    func_type = func.get("type", "function")
                    file_path = func.get("file_path", "")
                    response_parts.append(f"- `{func_name}` ({func_type}) in `{file_path}`")
        
        # API endpoints if available
        if routes_data:
            response_parts.append(f"\n## API Endpoints")
            response_parts.append(f"This appears to be a web application with **{len(routes_data)} API endpoints**.")
        
        return "\n".join(response_parts)
    
    def _synthesize_code_structure_response(self, functions_classes: List, file_structure: Dict, code_matches: List = None) -> str:
        """Synthesize response about code structure and organization"""
        response_parts = ["# Code Structure Analysis\n"]
        
        if functions_classes:
            # Categorize by type
            functions = [f for f in functions_classes if f.get("type") == "function"]
            classes = [f for f in functions_classes if f.get("type") == "class"]
            
            response_parts.append(f"Found **{len(functions)} functions** and **{len(classes)} classes**:")
            
            if classes:
                response_parts.append(f"\n## Classes ({len(classes)})")
                for cls in classes[:10]:  # Top 10 classes
                    name = cls.get("name", "Unknown")
                    file_path = cls.get("file_path", "")
                    line_number = cls.get("line_number", "")
                    response_parts.append(f"- `{name}` in `{file_path}:{line_number}`")
            
            if functions:
                response_parts.append(f"\n## Functions ({len(functions)})")
                for func in functions[:10]:  # Top 10 functions
                    name = func.get("name", "Unknown")
                    file_path = func.get("file_path", "")
                    line_number = func.get("line_number", "")
                    response_parts.append(f"- `{name}` in `{file_path}:{line_number}`")
        
        # File organization
        if file_structure:
            response_parts.append(f"\n## File Organization")
            directories = file_structure.get("directories", [])
            if directories:
                for dir_info in directories[:8]:  # Top 8 directories
                    dir_name = dir_info.get("name", "Unknown")
                    files = dir_info.get("files", [])
                    file_types = {}
                    for file_info in files:
                        ext = file_info.get("name", "").split(".")[-1] if "." in file_info.get("name", "") else "no_ext"
                        file_types[ext] = file_types.get(ext, 0) + 1
                    
                    if file_types:
                        types_str = ", ".join([f"{count} {ext}" for ext, count in list(file_types.items())[:3]])
                        response_parts.append(f"- `{dir_name}/`: {types_str}")
        
        return "\n".join(response_parts)
    
    def _synthesize_dependencies_response(self, dependencies: List, file_contents: List, code_matches: List = None) -> str:
        """Synthesize response about dependencies and imports"""
        response_parts = ["# Dependencies Analysis\n"]
        
        # Look for dependency files in file contents
        dep_files = []
        for file_info in file_contents:
            file_name = file_info.get("name", "").lower()
            if any(dep_file in file_name for dep_file in ["requirements.txt", "package.json", "pipfile", "pyproject.toml"]):
                dep_files.append(file_info)
        
        if dep_files:
            response_parts.append("## External Dependencies")
            for dep_file in dep_files:
                file_name = dep_file.get("name", "")
                content = dep_file.get("content", "")
                response_parts.append(f"\n**{file_name}:**")
                
                # Parse dependency content based on file type
                if "package.json" in file_name:
                    response_parts.append("JavaScript/Node.js project dependencies")
                elif "requirements.txt" in file_name or "pipfile" in file_name:
                    response_parts.append("Python project dependencies")
                elif "pyproject.toml" in file_name:
                    response_parts.append("Python project with modern packaging")
                
                # Show first few dependencies
                lines = content.split('\n')[:10]
                for line in lines:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        response_parts.append(f"- {line}")
        
        # Import patterns from code matches
        import_matches = [match for match in code_matches if any(
            term in match.get("content", "").lower() 
            for term in ["import ", "from ", "require(", "#include"]
        )]
        
        if import_matches:
            response_parts.append(f"\n## Import Patterns")
            response_parts.append(f"Found {len(import_matches)} import statements:")
            
            # Show unique import patterns
            unique_imports = set()
            for match in import_matches[:20]:  # Limit to 20
                content = match.get("content", "").strip()
                if content not in unique_imports:
                    unique_imports.add(content)
                    file_path = match.get("file_path", "")
                    response_parts.append(f"- `{content}` in `{file_path}`")
        
        return "\n".join(response_parts)
    
    def _synthesize_file_structure_response(self, file_structure: Dict, code_matches: List = None) -> str:
        """Synthesize response about file structure and organization"""
        response_parts = ["# File Structure\n"]
        
        if file_structure:
            total_files = file_structure.get("total_files", 0)
            total_dirs = file_structure.get("total_directories", 0)
            
            response_parts.append(f"The repository contains **{total_files} files** in **{total_dirs} directories**:")
            
            directories = file_structure.get("directories", [])
            for dir_info in directories:
                dir_name = dir_info.get("name", "Unknown")
                files = dir_info.get("files", [])
                
                response_parts.append(f"\n## `{dir_name}/` ({len(files)} files)")
                
                # Group files by extension
                file_types = {}
                for file_info in files:
                    file_name = file_info.get("name", "")
                    ext = file_name.split(".")[-1] if "." in file_name else "no_ext"
                    if ext not in file_types:
                        file_types[ext] = []
                    file_types[ext].append(file_name)
                
                # Show file types
                for ext, file_list in file_types.items():
                    if len(file_list) <= 3:
                        response_parts.append(f"- **{ext}**: {', '.join(file_list)}")
                    else:
                        response_parts.append(f"- **{ext}**: {', '.join(file_list[:3])}, ... (+{len(file_list)-3} more)")
        
        return "\n".join(response_parts)
    
    def _synthesize_generic_response(self, user_query: str, routes_data: List, code_matches: List, 
                                    file_structure: Dict, functions_classes: List, smart_search_results: List) -> str:
        """Synthesize a generic comprehensive response based on available data"""
        response_parts = [f"# Analysis Results for: {user_query}\n"]
        
        # Summary of what we found
        findings = []
        if routes_data:
            findings.append(f"{len(routes_data)} API routes")
        if functions_classes:
            findings.append(f"{len(functions_classes)} functions/classes")
        if code_matches:
            findings.append(f"{len(code_matches)} code matches")
        if smart_search_results:
            findings.append(f"{len(smart_search_results)} contextual matches")
        
        if findings:
            response_parts.append(f"Found: {', '.join(findings)}\n")
        
        # Show most relevant results
        if smart_search_results:
            response_parts.append("## Most Relevant Results")
            for result in smart_search_results[:5]:
                file_path = result.get("file_path", "Unknown")
                content = result.get("content", "")[:200] + "..." if len(result.get("content", "")) > 200 else result.get("content", "")
                response_parts.append(f"- `{file_path}`: {content}")
        
        # Add code matches if available
        if code_matches and not smart_search_results:
            response_parts.append("## Code Matches")
            for match in code_matches[:5]:
                file_path = match.get("file_path", "Unknown")
                line_number = match.get("line_number", "")
                content = match.get("content", "").strip()[:150] + "..." if len(match.get("content", "")) > 150 else match.get("content", "").strip()
                response_parts.append(f"- `{file_path}:{line_number}` - {content}")
        
        # Add basic structure info
        if file_structure and not any([routes_data, code_matches, smart_search_results]):
            response_parts.append("## Repository Structure")
            total_files = file_structure.get("total_files", 0)
            total_dirs = file_structure.get("total_directories", 0)
            response_parts.append(f"Repository contains {total_files} files across {total_dirs} directories.")
        
        if not any([routes_data, code_matches, functions_classes, smart_search_results, file_structure]):
            return f"I searched for information related to '{user_query}' but couldn't find specific relevant results. Please try a more specific query or check if the repository contains the information you're looking for."
        
        return "\n".join(response_parts)
    
    def _identify_project_type(self, file_contents: List, routes_data: List, file_structure: Dict) -> str:
        """Identify the project type based on available information"""
        project_indicators = []
        
        # Check for specific files
        for file_info in file_contents:
            file_name = file_info.get("name", "").lower()
            if file_name == "package.json":
                project_indicators.append("JavaScript/Node.js project")
            elif file_name in ["requirements.txt", "setup.py", "pyproject.toml"]:
                project_indicators.append("Python project")
            elif file_name == "cargo.toml":
                project_indicators.append("Rust project")
            elif file_name == "go.mod":
                project_indicators.append("Go project")
        
        # Check for web framework indicators
        if routes_data:
            project_indicators.append("Web application with API endpoints")
        
        # Check directory structure
        if file_structure:
            directories = [d.get("name", "") for d in file_structure.get("directories", [])]
            if "frontend" in directories and "backend" in directories:
                project_indicators.append("Full-stack application")
            elif "src" in directories:
                project_indicators.append("Source-organized project")
        
        return " • ".join(project_indicators) if project_indicators else "General software project"
    
    async def _execute_and_stream_function_call(
        self,
        function_name: str,
        arguments: str,
        session: Dict[str, Any],
        chat_id: str,
        conversation_id: str
    ) -> AsyncGenerator[str, None]:
        """Execute a function call and stream the results"""
        
        try:
            # Parse arguments
            args = json.loads(arguments)
            
            yield json.dumps(StreamChatResponse(
                event="tool_call_progress",
                content=f"📝 Parameters: {json.dumps(args, indent=2)[:200]}{'...' if len(json.dumps(args)) > 200 else ''}",
                tool_name=function_name,
                chat_id=chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
            
            # Execute the function
            search_tools = session["search_tools"]
            result = await search_tools.call_function(function_name, args)
            
            # Store the function call and result
            function_call_record = {
                "function_name": function_name,
                "arguments": args,
                "result": result,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            session["function_calls"].append(function_call_record)
            
            # Stream the result
            if result.get("success"):
                result_summary = self._format_tool_result_summary(function_name, result)
                yield json.dumps(StreamChatResponse(
                    event="tool_call_result",
                    content=f"✅ {result_summary}",
                    tool_name=function_name,
                    tool_result=result,
                    chat_id=chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
            else:
                yield json.dumps(StreamChatResponse(
                    event="tool_call_result",
                    content=f"❌ Tool call failed: {result.get('error', 'Unknown error')}",
                    tool_name=function_name,
                    tool_result=result,
                    chat_id=chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                
        except Exception as e:
            logger.error(f"❌ Error executing function {function_name}: {e}")
            yield json.dumps(StreamChatResponse(
                event="tool_call_result",
                content=f"❌ Error executing {function_name}: {str(e)}",
                tool_name=function_name,
                chat_id=chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
    
    def _format_tool_result_summary(self, function_name: str, result: Dict[str, Any]) -> str:
        """Format a brief summary of tool results for streaming"""
        
        if function_name == "search_api_routes":
            count = len(result.get("results", []))
            return f"Found {count} API routes and endpoints"
            
        elif function_name == "search_code_by_keywords":
            count = len(result.get("results", []))
            keywords = result.get("search_keywords", [])
            return f"Found {count} code matches for keywords: {', '.join(keywords[:3])}"
            
        elif function_name == "get_file_structure":
            dirs = result.get("total_directories", 0)
            files = result.get("total_files", 0)
            return f"Retrieved file structure: {dirs} directories, {files} files"
            
        elif function_name == "search_functions_and_classes":
            count = len(result.get("results", []))
            return f"Found {count} functions/classes"
            
        elif function_name == "explore_file_contents":
            count = len(result.get("files", []))
            return f"Explored {count} files in detail"
            
        elif function_name == "explore_dependencies":
            count = len(result.get("traversals", []))
            return f"Mapped dependencies for {count} components"
            
        elif function_name == "smart_context_search":
            count = result.get("total_results", 0)
            strategies = len(result.get("strategies_used", []))
            return f"Smart search completed using {strategies} strategies, found {count} relevant items"
            
        else:
            return f"Completed {function_name}"
    
    async def _create_execution_plan(self, user_query: str) -> List[str]:
        """Create a deterministic list of tools to execute based on query analysis"""
        query_lower = user_query.lower()
        
        # Analyze query intent and return ordered list of tools to execute
        if any(term in query_lower for term in ['routes', 'endpoints', 'api']):
            return [
                "search_api_routes",
                "search_code_by_keywords",  # Will search for route patterns
                "get_file_structure"  # Fallback to understand project structure
            ]
        
        elif any(term in query_lower for term in ['about', 'overview', 'what is', 'describe', 'purpose', 'what does']):
            return [
                "get_file_structure",
                "search_functions_and_classes",
                "explore_file_contents"
            ]
        
        elif any(term in query_lower for term in ['functions', 'classes', 'methods', 'code structure']):
            return [
                "search_functions_and_classes",
                "get_file_structure",
                "smart_context_search"
            ]
        
        elif any(term in query_lower for term in ['dependencies', 'imports', 'modules', 'packages']):
            return [
                "explore_file_contents",
                "search_code_by_keywords",
                "explore_dependencies"
            ]
        
        elif any(term in query_lower for term in ['files', 'structure', 'organization', 'layout']):
            return [
                "get_file_structure",
                "search_code_by_keywords"
            ]
        
        elif any(term in query_lower for term in ['framework', 'technology', 'tech stack', 'built with']):
            return [
                "get_file_structure",
                "explore_file_contents",
                "search_code_by_keywords"
            ]
        
        else:
            # Generic plan
            return [
                "smart_context_search",
                "get_file_structure",
                "search_functions_and_classes"
            ]
    
    async def _execute_planned_tool(
        self, 
        tool_name: str, 
        user_query: str,
        session: Dict[str, Any],
        chat_id: str,
        conversation_id: str
    ) -> AsyncGenerator[str, None]:
        """Execute a single tool from the execution plan"""
        
        yield json.dumps(StreamChatResponse(
            event="tool_call_start",
            content=f"🔧 Calling tool: {tool_name}",
            tool_name=tool_name,
            chat_id=chat_id,
            conversation_id=conversation_id
        ).model_dump()) + "\n"
        
        try:
            search_tools = session["search_tools"]
            
            # Determine arguments based on tool and query, with access to previous results
            args = self._get_tool_arguments(tool_name, user_query, session.get("function_calls", []))
            
            yield json.dumps(StreamChatResponse(
                event="tool_call_progress",
                content=f"📝 Parameters: {json.dumps(args, indent=2)[:200]}...",
                tool_name=tool_name,
                chat_id=chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
            
            # Execute the tool
            result = await search_tools.call_function(tool_name, args)
            
            # Log detailed function call result for debugging
            logger.info(f"🔍 FUNCTION CALL RESULT for {tool_name}:")
            logger.info(f"   Arguments: {json.dumps(args, indent=2)}")
            logger.info(f"   Success: {result.get('success', False)}")
            if result.get("success"):
                # Log key result metrics
                if "results" in result:
                    logger.info(f"   Results count: {len(result.get('results', []))}")
                    if result.get('results'):
                        logger.info(f"   Sample result keys: {list(result['results'][0].keys()) if result['results'] else 'none'}")
                if "total_files" in result:
                    logger.info(f"   Total files: {result.get('total_files')}")
                if "total_directories" in result:
                    logger.info(f"   Total directories: {result.get('total_directories')}")
                if "files" in result:
                    logger.info(f"   Files explored: {len(result.get('files', []))}")
                # Log first 500 chars of result for debugging
                result_preview = json.dumps(result, indent=2)[:500]
                logger.info(f"   Result preview: {result_preview}{'...' if len(json.dumps(result)) > 500 else ''}")
            else:
                logger.error(f"   Error: {result.get('error', 'Unknown error')}")
            
            # Store the function call and result
            function_call_record = {
                "function_name": tool_name,
                "arguments": args,
                "result": result,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            session["function_calls"].append(function_call_record)
            
            # Stream the result
            if result.get("success"):
                result_summary = self._format_tool_result_summary(tool_name, result)
                yield json.dumps(StreamChatResponse(
                    event="tool_call_result",
                    content=f"✅ {result_summary}",
                    tool_name=tool_name,
                    tool_result=result,
                    chat_id=chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
            else:
                yield json.dumps(StreamChatResponse(
                    event="tool_call_result",
                    content=f"❌ Tool call failed: {result.get('error', 'Unknown error')}",
                    tool_name=tool_name,
                    tool_result=result,
                    chat_id=chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                
        except Exception as e:
            logger.error(f"❌ Error executing planned tool {tool_name}: {e}")
            yield json.dumps(StreamChatResponse(
                event="tool_call_result",
                content=f"❌ Error executing {tool_name}: {str(e)}",
                tool_name=tool_name,
                chat_id=chat_id,
                conversation_id=conversation_id
            ).model_dump()) + "\n"
    
    def _get_tool_arguments(self, tool_name: str, user_query: str, previous_results: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Generate appropriate arguments for each tool based on the query"""
        query_lower = user_query.lower()
        
        if tool_name == "search_api_routes":
            return {}  # No arguments needed
        
        elif tool_name == "search_code_by_keywords":
            # Extract keywords from query or use defaults based on query type
            if any(term in query_lower for term in ['routes', 'endpoints', 'api']):
                return {"keywords": ["@app.route", "router", "FastAPI", "@router", "endpoint"], "limit": 10}
            elif any(term in query_lower for term in ['framework', 'technology']):
                return {"keywords": ["import", "package.json", "requirements.txt", "framework", "React", "Vue", "Angular"], "limit": 10}
            else:
                # Extract meaningful keywords from query
                words = [word for word in user_query.split() if len(word) > 3]
                return {"keywords": words[:5], "limit": 10}  # Use first 5 meaningful words
        
        elif tool_name == "get_file_structure":
            return {"max_depth": 3, "show_files": True}
        
        elif tool_name == "search_functions_and_classes":
            if any(term in query_lower for term in ['main', 'entry', 'start']):
                return {"name_patterns": ["main", "app", "server", "__init__"], "limit": 15}
            else:
                # Use more specific patterns instead of "*" to get better results
                return {"name_patterns": ["def ", "class ", "function", "async def"], "limit": 50}
        
        elif tool_name == "explore_file_contents":
            # Use smarter file discovery based on previous results
            target_files = []
            
            # If we have previous file structure results, use them to find actual files
            if previous_results:
                for result in previous_results:
                    if result.get("function_name") == "get_file_structure":
                        file_structure = result.get("result", {})
                        if file_structure.get("success"):
                            # Extract actual file names from the structure
                            structure = file_structure.get("structure", {})
                            self._extract_important_files_from_structure(structure, target_files)
                            
            # Fallback to common important files if we couldn't extract from structure
            if not target_files:
                target_files = [
                    "README.md", "readme.md", "README.txt", 
                    "setup.py", "pyproject.toml", "requirements.txt",
                    "server.py", "main.py", "app.py", "__init__.py",
                    "package.json", "Dockerfile", ".env.example",
                    "LICENSE", "CHANGELOG.md"
                ]
            
            # Limit to most important files
            return {"file_paths": target_files[:15], "max_lines_per_file": 50}
        
        elif tool_name == "explore_dependencies":
            return {"start_nodes": ["main", "app", "index"], "max_depth": 2}
        
        elif tool_name == "smart_context_search":
            return {"user_intent": user_query, "context_type": "overview"}
        
        else:
            return {}
    
    def _extract_important_files_from_structure(self, structure: Dict[str, Any], target_files: List[str]) -> None:
        """Extract important files from file structure recursively"""
        
        important_extensions = {'.py', '.md', '.txt', '.json', '.toml', '.yml', '.yaml', '.env'}
        important_names = {'README', 'LICENSE', 'CHANGELOG', 'setup.py', 'main.py', 'app.py', 
                          'server.py', 'requirements.txt', 'pyproject.toml', 'package.json', 'Dockerfile'}
        
        def extract_files_recursive(struct_dict: Dict[str, Any], path_prefix: str = ""):
            for name, info in struct_dict.items():
                current_path = f"{path_prefix}/{name}" if path_prefix else name
                
                if isinstance(info, dict):
                    if info.get("type") == "directory":
                        # Recurse into directory but limit depth
                        if len(path_prefix.split('/')) < 3:  # Limit depth to avoid too deep recursion
                            files = info.get("files", [])
                            for file_info in files:
                                file_name = file_info.get("name", "")
                                file_path = f"{current_path}/{file_name}" if current_path != "." else file_name
                                
                                # Check if this is an important file
                                if (any(file_name.endswith(ext) for ext in important_extensions) or 
                                    any(important_name.lower() in file_name.lower() for important_name in important_names)):
                                    if file_path not in target_files:
                                        target_files.append(file_path)
        
        extract_files_recursive(structure)
        
        # Ensure we have some common files even if not found in structure
        common_fallbacks = ["README.md", "server.py", "main.py", "requirements.txt"]
        for fallback in common_fallbacks:
            if fallback not in target_files:
                target_files.append(fallback)
    
    async def _synthesize_final_answer(self, user_query: str, collected_results: List[Dict[str, Any]]) -> str:
        """Synthesize final comprehensive answer using LLM with all collected tool results"""
        
        if not collected_results:
            return "I wasn't able to gather any information to answer your question. Please try a different query."
        
        # Prepare context from all tool results
        context_parts = []
        for result in collected_results:
            tool_name = result.get("function_name", "unknown")
            tool_result = result.get("result", {})
            
            if tool_result.get("success"):
                context_parts.append(f"**{tool_name.upper()} RESULTS:**")
                context_parts.append(json.dumps(tool_result, indent=2)[:1500])  # Limit context size
                context_parts.append("\n")
        
        full_context = "\n".join(context_parts)
        
        # Use LLM to synthesize final answer
        synthesis_prompt = f"""You are an expert code repository analyst. Based on the search results below, provide a comprehensive answer to the user's question.

USER QUESTION: {user_query}

SEARCH RESULTS:
{full_context}

INSTRUCTIONS:
1. Analyze all the search results above
2. Synthesize a comprehensive, well-structured answer
3. Use markdown formatting with headers and bullet points
4. Be specific and cite information from the results
5. If no relevant information was found, explain what the repository appears to be instead
6. Focus on directly answering the user's question

Provide your comprehensive analysis:"""
        
        # Use LLM to synthesize the final answer
        try:
            # Use the existing LLM service to generate the final answer
            from models.user import User
            
            # Create a simple messages array for the LLM
            messages = [
                {"role": "system", "content": "You are an expert code repository analyst. Provide comprehensive, well-structured answers based on search results."},
                {"role": "user", "content": synthesis_prompt}
            ]
            
            # For now, use a simple synthesis without calling external LLM
            # This avoids the complexity of user management in synthesis phase
            logger.info("📝 Synthesizing final answer from collected results...")
            return await self._synthesize_fallback_response(user_query, collected_results)
            
        except Exception as e:
            logger.error(f"❌ Error in LLM synthesis: {e}")
            return await self._synthesize_fallback_response(user_query, collected_results)
    
    async def _create_search_plan(self, user_query: str, search_tools = None) -> str:
        """Create a strategic search plan based on the user query"""
        query_lower = user_query.lower()
        
        # Analyze query intent and create targeted plan
        if any(term in query_lower for term in ['routes', 'endpoints', 'api']):
            return f"""
PLAN FOR ROUTES/ENDPOINTS QUERY:
1. Call search_api_routes() to find all route definitions and API endpoints
2. Call search_code_by_keywords(["@app.route", "router", "FastAPI", "@router"]) to find additional route patterns
3. Synthesize a comprehensive answer listing all routes with their HTTP methods, paths, and locations

EXPECTED OUTCOME: Complete list of all API routes, endpoints, and HTTP methods in the repository.
"""
        
        elif any(term in query_lower for term in ['about', 'overview', 'what is', 'describe', 'purpose', 'what does']):
            return f"""
PLAN FOR REPOSITORY OVERVIEW QUERY:
1. Call get_file_structure() to understand the project layout and main directories
2. Call search_functions_and_classes(["main", "app", "server", "__init__"]) to find entry points
3. Call explore_file_contents(["README.md", "setup.py", "package.json", "pyproject.toml"]) to get project metadata
4. Synthesize a comprehensive overview including: purpose, tech stack, main components, and architecture

EXPECTED OUTCOME: Complete overview of what the repository does, its technology stack, and main components.
"""
        
        elif any(term in query_lower for term in ['functions', 'classes', 'methods', 'code structure']):
            return f"""
PLAN FOR CODE STRUCTURE QUERY:
1. Call get_file_structure() to understand the project organization
2. Call search_functions_and_classes(["*"]) to find main functions and classes
3. Call smart_context_search("code architecture and main components") to get architectural insights
4. Synthesize findings about the codebase structure, main classes, and key functions

EXPECTED OUTCOME: Detailed breakdown of code structure, main classes, functions, and architectural patterns.
"""
        
        elif any(term in query_lower for term in ['dependencies', 'imports', 'modules', 'packages']):
            return f"""
PLAN FOR DEPENDENCIES QUERY:
1. Call explore_file_contents(["requirements.txt", "package.json", "Pipfile", "pyproject.toml"]) to find dependencies
2. Call search_code_by_keywords(["import", "from", "require"]) to find import patterns
3. Call explore_dependencies(["main entry points"]) to map dependency relationships
4. Synthesize information about external dependencies and internal module relationships

EXPECTED OUTCOME: Complete list of dependencies, imports, and module relationships.
"""
        
        elif any(term in query_lower for term in ['files', 'structure', 'organization', 'layout']):
            return f"""
PLAN FOR FILE STRUCTURE QUERY:
1. Call get_file_structure() to get detailed directory and file layout
2. Call search_code_by_keywords(["__init__", "main", "setup"]) to find important entry points
3. Synthesize information about project organization, main directories, and file purposes

EXPECTED OUTCOME: Clear breakdown of project file structure and organization.
"""
        
        elif any(term in query_lower for term in ['search', 'find', 'look for']) and len(query_lower.split()) > 2:
            # Extract search terms
            search_terms = [word for word in user_query.split() if len(word) > 3 and word.lower() not in ['search', 'find', 'look', 'for', 'the', 'all', 'any']]
            return f"""
PLAN FOR SEARCH QUERY:
1. Call search_code_by_keywords({search_terms[:3]}) to find code containing the search terms
2. Call search_functions_and_classes({search_terms[:3]}) to find matching functions/classes
3. Call smart_context_search("{user_query}") for intelligent contextual search
4. Synthesize all findings to provide comprehensive search results

EXPECTED OUTCOME: All relevant code, functions, and context related to the search terms.
"""
        
        else:
            # Generic plan for unclear queries
            return f"""
PLAN FOR GENERAL REPOSITORY QUERY:
1. Call smart_context_search("{user_query}") to intelligently analyze the query
2. Call get_file_structure() to provide repository context
3. Based on smart search results, call one additional relevant tool if needed
4. Synthesize findings to provide the most helpful answer possible

EXPECTED OUTCOME: Best possible answer based on intelligent analysis of the query.
"""


# Global instance
agentic_chat_controller = AgenticChatController()