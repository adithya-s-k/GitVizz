"""
Agentic LangGraph Chat Service with GitVizz Tools
Advanced chat system with streaming, memory, GitVizz-powered tools, and repository context analysis
"""

import json
import asyncio
from typing import Dict, List, Any, AsyncGenerator, Optional, TypedDict, Annotated
from datetime import datetime
from operator import add


# LangGraph imports
try:
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.prebuilt import ToolNode
    from langchain_core.messages import (
        HumanMessage,
        AIMessage,
        SystemMessage,
        BaseMessage,
        ToolMessage,
    )
    from langchain_core.tools import tool

    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False
    print("⚠️ LangGraph not available - using fallback implementation")

# Import our services
from utils.langchain_llm_service import langchain_service
from utils.gitvizz_tools import gitvizz_tools_service
from models.repository import Repository


class AgenticChatState(TypedDict):
    """State for the agentic chat workflow"""

    messages: Annotated[List[BaseMessage], add]
    repository_context: str
    user_query: str
    repository_id: str
    repository_zip_path: str
    context_metadata: Dict[str, Any]
    analysis_type: str
    current_response: str
    streaming_enabled: bool
    provider: str
    model: str
    user_id: str
    tools_used: List[str]
    tool_results: Dict[str, Any]
    conversation_id: Optional[str]
    chat_id: Optional[str]


class AgenticLangGraphChatService:
    """Advanced agentic chat service using LangGraph with GitVizz tools"""

    def __init__(self):
        self.langgraph_available = LANGGRAPH_AVAILABLE
        if LANGGRAPH_AVAILABLE:
            self.memory = MemorySaver()
            self.graphs = {}  # Cache for different repository graphs

    def _build_agentic_chat_graph(
        self, repository_id: str, zip_file_path: str
    ) -> StateGraph:
        """Build the LangGraph workflow for agentic chat processing"""
        if not LANGGRAPH_AVAILABLE:
            return None

        # Get GitVizz tools for this repository
        gitvizz_tools = gitvizz_tools_service.create_tools(repository_id, zip_file_path)
        tool_node = ToolNode(gitvizz_tools)

        # Create the state graph
        workflow = StateGraph(AgenticChatState)

        # Add nodes
        workflow.add_node("analyze_query", self._analyze_query_node)
        workflow.add_node("agent", self._agent_node)
        workflow.add_node("tools", tool_node)
        workflow.add_node("finalize_response", self._finalize_response_node)

        # Add edges
        workflow.add_edge("analyze_query", "agent")
        workflow.add_conditional_edges(
            "agent",
            self._should_continue_or_finish,
            {"tools": "tools", "finish": "finalize_response"},
        )
        workflow.add_edge("tools", "agent")
        workflow.add_edge("finalize_response", END)

        # Set entry point
        workflow.set_entry_point("analyze_query")

        return workflow.compile(checkpointer=self.memory)

    async def _analyze_query_node(self, state: AgenticChatState) -> AgenticChatState:
        """Analyze the user query to determine the best approach"""
        user_query = state["user_query"]

        # Enhanced analysis based on GitVizz capabilities
        analysis_type = "general"
        if any(
            keyword in user_query.lower()
            for keyword in ["structure", "architecture", "organization", "overview"]
        ):
            analysis_type = "architecture"
        elif any(
            keyword in user_query.lower()
            for keyword in ["find", "search", "locate", "where is", "show me"]
        ):
            analysis_type = "search"
        elif any(
            keyword in user_query.lower()
            for keyword in ["quality", "issues", "problems", "refactor", "improve"]
        ):
            analysis_type = "quality"
        elif any(
            keyword in user_query.lower()
            for keyword in [
                "dependency",
                "dependencies",
                "flow",
                "connection",
                "relates",
            ]
        ):
            analysis_type = "dependencies"
        elif any(
            keyword in user_query.lower()
            for keyword in ["security", "vulnerable", "safe", "risk"]
        ):
            analysis_type = "security"
        elif any(
            keyword in user_query.lower()
            for keyword in ["test", "testing", "coverage", "unit test"]
        ):
            analysis_type = "testing"
        elif any(
            keyword in user_query.lower()
            for keyword in ["statistics", "metrics", "stats", "count", "how many"]
        ):
            analysis_type = "statistics"
        elif any(
            keyword in user_query.lower()
            for keyword in ["bug", "error", "fix", "debug", "issue"]
        ):
            analysis_type = "debugging"
        elif any(
            keyword in user_query.lower()
            for keyword in ["implement", "add", "create", "build", "develop"]
        ):
            analysis_type = "implementation"
        elif any(
            keyword in user_query.lower()
            for keyword in ["explain", "how", "what", "why", "understand"]
        ):
            analysis_type = "explanation"

        state["analysis_type"] = analysis_type
        state["tools_used"] = []
        state["tool_results"] = {}

        return state

    async def _agent_node(self, state: AgenticChatState) -> AgenticChatState:
        """Main agent node that decides whether to use tools or provide final response"""
        try:
            # Get or create LLM with tools
            gitvizz_tools = gitvizz_tools_service.create_tools(
                state["repository_id"], state["repository_zip_path"]
            )

            chat_model = await langchain_service.get_chat_model(
                model=state["model"],
                user=None,  # We'll need to handle user context differently
                use_user_key=True,
                temperature=0.7,
            )

            print(f"[DEBUG] Using model: {state['model']}")
            print(
                f"[DEBUG] Model supports tool calling: {hasattr(chat_model, 'bind_tools')}"
            )

            # Bind tools to the model
            llm_with_tools = chat_model.bind_tools(gitvizz_tools)
            print(f"[DEBUG] Tools bound: {len(gitvizz_tools)} tools")

            # Prepare system message with context about available tools
            system_prompt = f"""You are an AI assistant specialized in code analysis and repository exploration. You MUST use the appropriate GitVizz tools to analyze the repository before providing any response.

Repository ID: {state["repository_id"]}
Analysis Type: {state["analysis_type"]}
Tools Used So Far: {', '.join(state["tools_used"]) if state["tools_used"] else "None"}

MANDATORY TOOL USAGE RULES:
- For architecture/structure questions: ALWAYS use analyze_code_structure first
- For finding/searching code: ALWAYS use search_code_patterns 
- For quality/issues questions: ALWAYS use find_code_quality_issues
- For dependency questions: ALWAYS use analyze_dependencies_and_flow
- For security/testing: ALWAYS use find_security_and_testing_insights
- For statistics/metrics: ALWAYS use get_repository_statistics

Available Tools:
- analyze_code_structure: For understanding overall architecture and organization
- search_code_patterns: For finding specific implementations or code patterns  
- find_code_quality_issues: For identifying potential problems and improvements
- analyze_dependencies_and_flow: For understanding component relationships
- find_security_and_testing_insights: For security and testing analysis
- get_repository_statistics: For comprehensive metrics and statistics

IMPORTANT: You MUST call the appropriate tool(s) based on the user's query BEFORE providing any textual response. Do not provide analysis without first using tools to gather data from the repository."""

            # Get all messages from state - this preserves conversation history
            current_messages = state.get("messages", [])
            print(f"[DEBUG] Current messages count: {len(current_messages)}")
            for i, msg in enumerate(current_messages):
                print(f"[DEBUG] Message {i}: {type(msg)} - {getattr(msg, 'content', 'No content')[:100]}")
            
            # Build message history starting with system prompt
            messages = [SystemMessage(content=system_prompt)]
            
            # Add existing conversation history (excluding system messages)
            for msg in current_messages:
                if not isinstance(msg, SystemMessage):
                    try:
                        messages.append(msg)
                    except Exception as msg_error:
                        print(f"[DEBUG] Error adding message {type(msg)}: {msg_error}")
                        continue
            
            # If this is the first message in the conversation, add the user query
            if not current_messages:
                messages.append(HumanMessage(content=state["user_query"]))
            
            # Check and trim context if needed to fit model limits
            try:
                max_context_tokens = langchain_service.get_max_context_tokens(state["model"])
                max_output_tokens = langchain_service.get_max_output_tokens_for_model(state["model"])
                available_tokens = max_context_tokens - max_output_tokens - 1000  # Safety buffer
                
                # Count current tokens
                current_tokens = langchain_service.count_tokens_approximately(messages)
                print(f"[DEBUG] Current tokens: {current_tokens}, Available: {available_tokens}")
                
                if current_tokens > available_tokens:
                    print(f"[DEBUG] Context too large: {current_tokens} > {available_tokens}, trimming...")
                    # Trim messages to fit, keeping system prompt and recent messages
                    try:
                        messages = langchain_service.trim_messages_to_fit(messages, available_tokens)
                        print(f"[DEBUG] After trimming: {langchain_service.count_tokens_approximately(messages)} tokens")
                    except Exception as trim_error:
                        print(f"[DEBUG] Trimming failed: {trim_error}, using original messages")
            except Exception as e:
                print(f"[DEBUG] Error in context management: {e}, proceeding without trimming")

            # Get response from LLM
            response = await llm_with_tools.ainvoke(messages)

            # Debug logging
            print(f"[DEBUG] LLM Response type: {type(response)}")
            print(f"[DEBUG] Has tool_calls: {hasattr(response, 'tool_calls')}")
            if hasattr(response, "tool_calls"):
                print(f"[DEBUG] Tool calls: {response.tool_calls}")
            print(f"[DEBUG] Response content: {response.content[:200]}...")

            # Append the new response to existing messages
            updated_messages = current_messages + [response]

            return {**state, "messages": updated_messages}

        except Exception as e:
            # Create error response
            error_response = AIMessage(
                content=f"I encountered an error while processing your request: {str(e)}"
            )
            current_messages = state.get("messages", [])
            return {**state, "messages": current_messages + [error_response]}

    async def _finalize_response_node(
        self, state: AgenticChatState
    ) -> AgenticChatState:
        """Finalize the response after all tool usage"""
        # This node can be used for any final processing
        return state

    def _should_continue_or_finish(self, state: AgenticChatState) -> str:
        """Determine whether to continue with tools or finish"""
        messages = state["messages"]
        last_message = messages[-1]

        print(f"[DEBUG] Checking if should continue...")
        print(f"[DEBUG] Last message type: {type(last_message)}")
        print(
            f"[DEBUG] Has tool_calls attribute: {hasattr(last_message, 'tool_calls')}"
        )

        if hasattr(last_message, "tool_calls"):
            print(f"[DEBUG] Tool calls: {last_message.tool_calls}")
            print(
                f"[DEBUG] Tool calls length: {len(last_message.tool_calls) if last_message.tool_calls else 0}"
            )

        # Check if the last message has tool calls
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            print("[DEBUG] → Going to tools")
            return "tools"

        print("[DEBUG] → Going to finish")
        return "finish"

    async def get_or_create_graph(self, repository_id: str, zip_file_path: str):
        """Get or create graph for the repository"""
        graph_key = f"{repository_id}:{zip_file_path}"

        if graph_key not in self.graphs:
            self.graphs[graph_key] = self._build_agentic_chat_graph(
                repository_id, zip_file_path
            )

        return self.graphs[graph_key]

    # async def stream_agentic_chat_response(
    #     self,
    #     user_query: str,
    #     repository: Repository,
    #     user: Any,
    #     model: str = "gpt-4o-mini",
    #     provider: str = "openai",
    #     thread_id: Optional[str] = None,
    #     conversation_id: Optional[str] = None,
    #     chat_id: Optional[str] = None
    # ) -> AsyncGenerator[str, None]:
    #     """Stream agentic chat response with GitVizz tools as JSON strings for FastAPI"""

    #     if not self.langgraph_available:
    #         async for chunk in self._fallback_streaming(user_query, user, model, provider):
    #             yield chunk
    #         return

    #     try:
    #         # Get repository ZIP path
    #         zip_file_path = repository.file_paths.zip if repository.file_paths else None
    #         if not zip_file_path:
    #             yield json.dumps({
    #                 "event": "error",
    #                 "error": "No ZIP file available for GitVizz analysis",
    #                 "error_type": "no_zip_file"
    #             }) + "\n"
    #             return

    #         # Get or create the graph for this repository
    #         graph = await self.get_or_create_graph(str(repository.id), zip_file_path)
    #         if not graph:
    #             yield json.dumps({
    #                 "event": "error",
    #                 "error": "Unable to create analysis graph",
    #                 "error_type": "graph_creation_failed"
    #             }) + "\n"
    #             return

    #         # Prepare initial state
    #         initial_state = AgenticChatState(
    #             messages=[],
    #             repository_context="",
    #             user_query=user_query,
    #             repository_id=str(repository.id),
    #             repository_zip_path=zip_file_path,
    #             context_metadata={},
    #             analysis_type="",
    #             current_response="",
    #             streaming_enabled=True,
    #             provider=provider,
    #             model=model,
    #             user_id=str(user.id),
    #             tools_used=[],
    #             tool_results={},
    #             conversation_id=conversation_id,
    #             chat_id=chat_id
    #         )

    #         # Configure thread for memory
    #         config = {"configurable": {"thread_id": thread_id or f"chat_{chat_id}"}}

    #         yield json.dumps({
    #             "event": "progress",
    #             "step": "initializing",
    #             "message": "Starting agentic analysis..."
    #         }) + "\n"

    #         # Store function calls to include in final message
    #         current_function_calls = []
    #         accumulated_response = ""

    #         # Use astream_events for detailed streaming
    #         async for event in graph.astream_events(initial_state, config, version="v2"):
    #             event_type = event.get("event")
    #             event_name = event.get("name", "")

    #             if event_type == "on_chain_start":
    #                 if "analyze_query" in event_name:
    #                     yield json.dumps({
    #                         "event": "progress",
    #                         "step": "analyzing_query",
    #                         "message": "Analyzing your query to determine the best approach..."
    #                     }) + "\n"
    #                 elif "agent" in event_name:
    #                     yield json.dumps({
    #                         "event": "progress",
    #                         "step": "thinking",
    #                         "message": "AI agent is thinking about your request..."
    #                     }) + "\n"
    #                 elif "tools" in event_name:
    #                     yield json.dumps({
    #                         "event": "progress",
    #                         "step": "using_tools",
    #                         "message": "Using GitVizz tools for code analysis..."
    #                     }) + "\n"

    #             elif event_type == "on_tool_start":
    #                 tool_name = event.get("name", "unknown_tool")
    #                 tool_input = event.get("data", {}).get("input", {})

    #                 # Ensure tool_input is JSON serializable
    #                 try:
    #                     serializable_input = dict(tool_input) if tool_input else {}
    #                 except (TypeError, ValueError):
    #                     serializable_input = {"input": str(tool_input)} if tool_input else {}

    #                 # Store function call info
    #                 function_call = {
    #                     "name": tool_name,
    #                     "arguments": serializable_input,
    #                     "status": "running"
    #                 }
    #                 current_function_calls.append(function_call)

    #                 yield json.dumps({
    #                     "event": "function_call",
    #                     "function_name": tool_name,
    #                     "arguments": serializable_input,
    #                     "status": "started",
    #                     "message": f"🔧 Using {tool_name.replace('_', ' ').title()}..."
    #                 }) + "\n"

    #             elif event_type == "on_tool_end":
    #                 tool_name = event.get("name", "unknown_tool")
    #                 tool_output = event.get("data", {}).get("output", "")

    #                 # Extract string content from tool output (handle ToolMessage objects)
    #                 if hasattr(tool_output, 'content'):
    #                     result_content = str(tool_output.content)
    #                 elif isinstance(tool_output, dict):
    #                     result_content = str(tool_output)
    #                 else:
    #                     result_content = str(tool_output)

    #                 # Update function call with result
    #                 for func_call in current_function_calls:
    #                     if func_call["name"] == tool_name and func_call.get("status") == "running":
    #                         func_call["result"] = result_content
    #                         func_call["status"] = "completed"
    #                         break

    #                 # Truncate result for streaming
    #                 truncated_result = result_content[:200] + ("..." if len(result_content) > 200 else "")

    #                 yield json.dumps({
    #                     "event": "function_complete",
    #                     "function_name": tool_name,
    #                     "result": truncated_result,
    #                     "status": "completed",
    #                     "message": f"✅ Completed {tool_name.replace('_', ' ').title()}"
    #                 }) + "\n"

    #             elif event_type == "on_chat_model_stream":
    #                 # Stream LLM tokens
    #                 chunk = event.get("data", {}).get("chunk")
    #                 if chunk and hasattr(chunk, 'content') and chunk.content:
    #                     accumulated_response += chunk.content
    #                     yield json.dumps({
    #                         "event": "token",
    #                         "token": chunk.content
    #                     }) + "\n"

    #             elif event_type == "on_chain_end":
    #                 if "finalize_response" in event_name:
    #                     yield json.dumps({
    #                         "event": "progress",
    #                         "step": "finalizing",
    #                         "message": "Finalizing response..."
    #                     }) + "\n"

    #         # Final completion with function calls
    #         # Ensure all function call data is JSON serializable
    #         serializable_function_calls = []
    #         for func_call in current_function_calls:
    #             serializable_call = {
    #                 "name": func_call.get("name", "unknown"),
    #                 "status": func_call.get("status", "unknown"),
    #                 "arguments": func_call.get("arguments", {})
    #             }

    #             # Handle result serialization
    #             result = func_call.get("result")
    #             if result:
    #                 if hasattr(result, 'content'):
    #                     serializable_call["result"] = str(result.content)
    #                 elif isinstance(result, dict):
    #                     serializable_call["result"] = str(result)
    #                 else:
    #                     serializable_call["result"] = str(result)

    #             serializable_function_calls.append(serializable_call)

    #         yield json.dumps({
    #             "event": "complete",
    #             "message": "Agentic analysis completed",
    #             "response": accumulated_response,
    #             "function_calls": serializable_function_calls,
    #             "tools_used": len(serializable_function_calls)
    #         }) + "\n"

    #     except Exception as e:
    #         error_msg = str(e)
    #         event_data = {"event": "error", "error": error_msg}

    #         # Add specific error handling
    #         if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
    #             event_data["error_type"] = "quota_exceeded"
    #             event_data["suggestion"] = "API quota limit reached. Please try again later or use your own API key."
    #         elif "api key" in error_msg.lower() or "unauthorized" in error_msg.lower():
    #             event_data["error_type"] = "no_api_key"
    #             event_data["suggestion"] = "No valid API key found. Please add your API key in settings."
    #         elif "gitvizz" in error_msg.lower():
    #             event_data["error_type"] = "gitvizz_error"
    #             event_data["suggestion"] = "Error with GitVizz analysis. The repository may not be supported."
    #         else:
    #             event_data["error_type"] = "server_error"

    #         yield json.dumps(event_data) + "\n"

    async def stream_agentic_chat_response(
        self,
        user_query: str,
        repository: Repository,
        user: Any,
        model: str = "gpt-4o-mini",
        provider: str = "openai",
        thread_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        chat_id: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream agentic chat response with GitVizz tools as JSON strings for FastAPI"""

        if not self.langgraph_available:
            async for chunk in self._fallback_streaming(
                user_query, user, model, provider
            ):
                yield chunk
            return

        try:
            zip_file_path = repository.file_paths.zip if repository.file_paths else None
            if not zip_file_path:
                yield json.dumps(
                    {
                        "event": "error",
                        "error": "No ZIP file available for GitVizz analysis",
                    }
                ) + "\n"
                return

            graph = await self.get_or_create_graph(str(repository.id), zip_file_path)
            if not graph:
                yield json.dumps(
                    {"event": "error", "error": "Unable to create analysis graph"}
                ) + "\n"
                return

            initial_state = AgenticChatState(
                messages=[],
                user_query=user_query,
                repository_id=str(repository.id),
                repository_zip_path=zip_file_path,
                provider=provider,
                model=model,
                user_id=str(user.id),
                repository_context="",
                context_metadata={},
                analysis_type="",
                current_response="",
                streaming_enabled=True,
                tools_used=[],
                tool_results={},
                conversation_id=conversation_id,
                chat_id=chat_id,
            )

            config = {"configurable": {"thread_id": thread_id or f"chat_{chat_id}"}}

            yield json.dumps(
                {
                    "event": "progress",
                    "step": "initializing",
                    "message": "Starting agentic analysis...",
                }
            ) + "\n"

            accumulated_response = ""
            tool_execution_started = False

            async for event in graph.astream_events(
                initial_state, config, version="v2"
            ):
                event_type = event.get("event")
                event_name = event.get("name", "")

                if event_type == "on_chain_start":
                    if "agent" in event_name:
                        yield json.dumps(
                            {
                                "event": "progress",
                                "step": "thinking",
                                "message": "Agent is thinking...",
                            }
                        ) + "\n"

                elif event_type == "on_tool_start":
                    tool_execution_started = True
                    tool_name = event.get("name", "unknown_tool")
                    tool_input = event.get("data", {}).get("input", {})

                    yield json.dumps(
                        {
                            "event": "function_call",
                            "function_name": tool_name,
                            "arguments": (
                                tool_input
                                if isinstance(tool_input, dict)
                                else {"input": str(tool_input)}
                            ),
                            "status": "calling",
                            "message": f"🔧 Using {tool_name.replace('_', ' ').title()}...",
                        }
                    ) + "\n"

                elif event_type == "on_tool_end":
                    # =========================================================
                    # THIS IS THE FIX: Add a small delay
                    # This gives the frontend time to render the "calling" state
                    # before the "complete" state arrives.
                    # =========================================================
                    await asyncio.sleep(0.5)

                    tool_name = event.get("name", "unknown_tool")
                    tool_output = event.get("data", {}).get("output", "")
                    
                    # Handle different types of tool output
                    if isinstance(tool_output, list):
                        # If it's a list, join the elements
                        tool_output_str = " ".join(str(item) for item in tool_output)
                    elif hasattr(tool_output, 'content'):
                        # If it's a message object with content
                        tool_output_str = str(tool_output.content)
                    else:
                        # Default to string conversion
                        tool_output_str = str(tool_output)
                    
                    truncated_result = (
                        tool_output_str[:250] + "..."
                        if len(tool_output_str) > 250
                        else tool_output_str
                    )

                    yield json.dumps(
                        {
                            "event": "function_complete",
                            "function_name": tool_name,
                            "result": truncated_result,
                            "status": "complete",
                            "message": f"✅ Completed {tool_name.replace('_', ' ').title()}",
                        }
                    ) + "\n"

                elif event_type == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        # Only stream tokens for the final response (after tools have been executed)
                        # This prevents streaming the intermediate AI message that just calls tools
                        if tool_execution_started:
                            # Handle different content types from newer models
                            chunk_content = chunk.content
                            if isinstance(chunk_content, list):
                                # Extract text content from structured format
                                text_content = ""
                                for item in chunk_content:
                                    if isinstance(item, dict) and item.get("type") == "text":
                                        text_content += item.get("text", "")
                                chunk_content = text_content
                            elif not isinstance(chunk_content, str):
                                chunk_content = str(chunk_content)
                            
                            if chunk_content:  # Only process if we have actual text content
                                accumulated_response += chunk_content
                                yield json.dumps(
                                    {
                                        "event": "token",
                                        "content": chunk_content,
                                        "chat_id": chat_id,
                                        "conversation_id": conversation_id,
                                        "provider": provider,
                                        "model": model,
                                    }
                                ) + "\n"

            yield json.dumps(
                {
                    "event": "complete",
                    "message": "Agentic analysis completed",
                    "response": accumulated_response,
                    "chat_id": chat_id,
                    "conversation_id": conversation_id,
                    "provider": provider,
                    "model": model,
                    "usage": {},
                }
            ) + "\n"

        except asyncio.CancelledError:
            # Handle cancellation gracefully
            print("[DEBUG] Agentic chat stream was cancelled")
            yield json.dumps(
                {"event": "error", "error": "Request was cancelled", "error_type": "cancelled"}
            ) + "\n"
        except Exception as e:
            import traceback
            error_msg = str(e)
            error_traceback = traceback.format_exc()
            print(f"[DEBUG] Agentic chat error: {error_msg}")
            print(f"[DEBUG] Full traceback:\n{error_traceback}")
            
            # Check for specific error types
            if "can only concatenate str" in error_msg:
                yield json.dumps(
                    {"event": "error", "error": "Tool result processing error", "error_type": "tool_result_error", "details": error_msg}
                ) + "\n"
            else:
                yield json.dumps(
                    {"event": "error", "error": error_msg, "error_type": "server_error"}
                ) + "\n"

    async def _fallback_streaming(
        self, user_query: str, user: Any, model: str, provider: str
    ) -> AsyncGenerator[str, None]:
        """Fallback streaming when LangGraph is not available"""
        try:
            yield json.dumps(
                {
                    "event": "progress",
                    "step": "fallback_mode",
                    "message": "Using fallback mode (LangGraph not available)",
                }
            ) + "\n"

            # Use simple streaming with LangChain
            chat_model = await langchain_service.get_chat_model(
                model=model, user=user, temperature=0.7
            )

            messages = [HumanMessage(content=user_query)]

            async for chunk in chat_model.astream(messages):
                if chunk.content:
                    yield json.dumps({"event": "token", "token": chunk.content}) + "\n"

            yield json.dumps({"event": "complete"}) + "\n"

        except Exception as e:
            yield json.dumps(
                {"event": "error", "error": str(e), "error_type": "fallback_error"}
            ) + "\n"


# Global instance
agentic_chat_service = AgenticLangGraphChatService()
