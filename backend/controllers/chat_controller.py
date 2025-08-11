import json
import os
from fastapi import HTTPException, Form
from typing import Optional, AsyncGenerator, Annotated
import uuid
import time
from datetime import datetime, timedelta, timezone
import logging
from beanie import BeanieObjectId
from models.chat import ChatSession, Conversation, UserApiKey
from models.repository import Repository
from models.user import User
from utils.llm_utils import llm_service
from utils.file_utils import file_manager
from utils.jwt_utils import get_current_user
from utils.repo_utils import extract_zip_contents, smart_filter_files, format_repo_contents, cleanup_temp_files
from utils.repo_utils import find_user_repository
from utils.graph_utils import GraphUtils
from utils.react_agent import get_react_agent
from schemas.chat_schemas import (
    ChatResponse, ConversationHistoryResponse, 
    ChatSessionResponse, ApiKeyResponse,
    AvailableModelsResponse, ChatSettingsResponse,
    ContextSearchResponse, MessageResponse, StreamChatResponse, ChatSessionListItem, ChatSessionListResponse
)

# Set up logging
logger = logging.getLogger(__name__)

class ChatController:
    """Controller for handling chat-related operations"""
    
    async def get_or_create_chat_session(
        self, 
        user: User, 
        repository_id: str,
        repository_branch: Optional[str] = None,
        chat_id: Optional[str] = None
    ) -> ChatSession:
        """Get existing chat session or create a new one"""
        
        # Find repository using utility function
        repository = await find_user_repository(repository_id, user, repository_branch)
        
        if chat_id:
            # Try to find existing chat session with fetch_links to get full repository
            chat_session = await ChatSession.find_one(
                ChatSession.chat_id == chat_id,
                ChatSession.user.id == BeanieObjectId(user.id),
                ChatSession.repository.id == repository.id,
                fetch_links=True  # This ensures repository is fully loaded
            )
            if chat_session:
                # Additional safety check - if repository is still a Link, fetch it manually
                if hasattr(chat_session.repository, 'id') and not hasattr(chat_session.repository, 'file_paths'):
                    chat_session.repository = await Repository.get(chat_session.repository.id)
                return chat_session
        
        # Create new chat session
        new_chat_id = chat_id or str(uuid.uuid4())
        chat_session = ChatSession(
            user=user,
            repository=repository,
            chat_id=new_chat_id,
            title=f"Chat about {repository.repo_name}"
        )
        await chat_session.save()
        return chat_session
    
    
    def generate_conversation_title(self, message: str) -> str:
        """Generate a meaningful and unique title for a conversation based on the user's query"""
        # Use the user's query (message) as the base for the title
        base_title = message.strip()

        # Truncate to a reasonable length for display
        if len(base_title) > 50:
            base_title = base_title[:47] + "..."

        # Add a short unique suffix using a portion of a UUID
        unique_suffix = str(uuid.uuid4())[:8]
        return f"{base_title} [{unique_suffix}]"

    async def get_repository_context(
        self, 
        repository: Repository, 
        context_search_query: Optional[str] = None,
        user_query: Optional[str] = None,
        max_context_tokens: int = 8000,
        scope_preference: str = "moderate"
    ) -> tuple[str, dict]:
        """
        Get repository context for LLM processing by processing the locally stored ZIP file
        
        Args:
            repository: Repository object with file_paths containing ZIP location
            include_full_context: Whether to include full repository content
            context_search_query: Specific search query for context retrieval
            user_query: User's query for context
            max_context_tokens: Maximum tokens for context
            scope_preference: Context scope preference
            
        Returns:
            Tuple of (context_text, context_metadata)
        """
        temp_dirs_to_cleanup = []
        
        try:
            # First try to load from cached text file if it exists
            if repository.file_paths and repository.file_paths.text:
                try:
                    cached_content = await file_manager.load_text_content(repository.file_paths.text)
                    if cached_content:
                        logger.info(f"Using cached text content for repository {repository.repo_name}")
                        context_metadata = {
                            "source": "cached_text",
                            "repository_id": str(repository.id),
                            "repository_name": repository.repo_name,
                            "content_length": len(cached_content),
                            "scope": scope_preference,
                            "search_query": context_search_query
                        }
                        
                        # Truncate if too long (rough token estimation: 1 token ≈ 4 characters)
                        estimated_tokens = len(cached_content) // 4
                        if estimated_tokens > max_context_tokens:
                            char_limit = max_context_tokens * 4
                            cached_content = cached_content[:char_limit] + "\n\n... (content truncated due to length)"
                            context_metadata["truncated"] = True
                            context_metadata["truncated_at_tokens"] = max_context_tokens
                        
                        return cached_content, context_metadata
                except Exception as e:
                    logger.warning(f"Failed to load cached text content: {e}, falling back to ZIP processing")
            
            # If no cached text or failed to load, process the ZIP file
            if not repository.file_paths or not repository.file_paths.zip:
                return "", {
                    "source": "error", 
                    "error": "No ZIP file path available in repository",
                    "repository_id": str(repository.id),
                    "repository_name": repository.repo_name
                }
            
            zip_file_path = repository.file_paths.zip
            logger.info(f"Processing ZIP file for repository context: {zip_file_path}")
            
            # Check if ZIP file exists
            if not os.path.exists(zip_file_path):
                return "", {
                    "source": "error",
                    "error": f"ZIP file not found at path: {zip_file_path}",
                    "repository_id": str(repository.id),
                    "repository_name": repository.repo_name
                }
            
            # Extract ZIP contents
            extracted_files, temp_extract_dir = extract_zip_contents(zip_file_path)
            temp_dirs_to_cleanup.append(temp_extract_dir)
            
            if not extracted_files:
                return "", {
                    "source": "error",
                    "error": "No files found in ZIP archive",
                    "repository_id": str(repository.id),
                    "repository_name": repository.repo_name
                }
            
            # Filter files to include only relevant source code files
            filtered_files = smart_filter_files(extracted_files, temp_extract_dir)
            
            if not filtered_files:
                return "", {
                    "source": "error",
                    "error": "No relevant source files found after filtering",
                    "repository_id": str(repository.id),
                    "repository_name": repository.repo_name
                }
            
            # Format repository contents into LLM-friendly text
            context_text = format_repo_contents(filtered_files)
            
            context_metadata = {
                "source": "zip_processed",
                "repository_id": str(repository.id),
                "repository_name": repository.repo_name,
                "content_length": len(context_text),
                "scope": scope_preference,
                "search_query": context_search_query,
                "files_processed": len(filtered_files),
                "zip_path": zip_file_path
            }
            
            # Truncate if too long (rough token estimation: 1 token ≈ 4 characters)
            estimated_tokens = len(context_text) // 4
            if estimated_tokens > max_context_tokens:
                char_limit = max_context_tokens * 4
                context_text = context_text[:char_limit] + "\n\n... (content truncated due to length)"
                context_metadata["truncated"] = True
                context_metadata["truncated_at_tokens"] = max_context_tokens
            
            logger.info(f"Successfully processed repository context: {len(filtered_files)} files, {len(context_text)} characters")
            return context_text, context_metadata
            
        except Exception as e:
            logger.error(f"Error processing repository context: {e}")
            return "", {
                "source": "error",
                "error": str(e),
                "repository_id": str(repository.id),
                "repository_name": repository.repo_name
            }
        finally:
            # Clean up temporary directories
            if temp_dirs_to_cleanup:
                cleanup_temp_files(temp_dirs_to_cleanup)

    async def load_repository_graph(self, repository: Repository) -> Optional[GraphUtils]:
        """Load graph data for repository if available"""
        try:
            if not repository.file_paths or not repository.file_paths.graph:
                logger.warning(f"No graph file available for repository {repository.repo_name}")
                return None
            
            graph_file_path = repository.file_paths.graph
            if not os.path.exists(graph_file_path):
                logger.warning(f"Graph file not found: {graph_file_path}")
                return None
            
            graph_utils = GraphUtils()
            if graph_utils.load_graph_from_file(graph_file_path):
                logger.info(f"Successfully loaded graph for {repository.repo_name}")
                return graph_utils
            else:
                logger.error(f"Failed to load graph from {graph_file_path}")
                return None
                
        except Exception as e:
            logger.error(f"Error loading repository graph: {e}")
            return None

    async def get_api_key_for_request(self, user: User, provider: str, use_user: bool = False) -> Optional[str]:
        """
        Get API key for the request, handling both user and system keys
        
        Args:
            user: User object
            provider: LLM provider (openai, anthropic, gemini, groq)
            use_user: Whether to use user's API key
            
        Returns:
            API key string or None if not available
        """
        try:
            return await llm_service.get_api_key(provider, user, use_user)
        except ValueError:
            # No user API key found
            return None
        except Exception as e:
            logger.error(f"Error getting API key for {provider}: {e}")
            return None
    
    async def process_chat_message(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        message: Annotated[str, Form(description="User's message/question")],
        repository_id: Annotated[str, Form(description="Repository ID to chat about")],
        use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
        repository_branch: Annotated[Optional[str], Form(description="Repository branch for more precise matching")] = None,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
        provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini)")] = "openai",
        model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
        temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
        max_tokens: Annotated[Optional[int], Form(description="Maximum tokens in response (1-4000)", ge=1, le=4000)] = None,
        context_search_query: Annotated[Optional[str], Form(description="Specific search query for context retrieval")] = None,
        scope_preference: Annotated[str, Form(description="Context scope preference: focused, moderate, or comprehensive")] = "moderate"
    ) -> ChatResponse:
        """Process a chat message and generate AI response"""
        
        start_time = time.time()
        
        try:
            # Authenticate user
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            # Get or create chat session
            chat_session = await self.get_or_create_chat_session(
                user, 
                repository_id,
                repository_branch,
                chat_id
            )
            
            # Generate conversation ID if not provided
            conversation_id = conversation_id or str(uuid.uuid4())
            
            # Get or create conversation
            conversation = await Conversation.find_one(
                Conversation.conversation_id == conversation_id,
                Conversation.user.id == user.id
            )
            
            if not conversation:
                conversation = Conversation(
                    user=user,
                    repository=chat_session.repository,
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id,
                    title=self.generate_conversation_title(message),
                    model_provider=provider,
                    model_name=model,
                    temperature=temperature,
                    max_tokens=max_tokens
                )
                await conversation.save()
            
            # Add user message to conversation
            conversation.add_message("user", message)
            
            # Get repository context with intelligent selection
            context, context_metadata = await self.get_repository_context(
                chat_session.repository,
                context_search_query,
                user_query=message,
                max_context_tokens=max_tokens or 8000,
                scope_preference=scope_preference
            )
            
            # Prepare messages for LLM with intelligent context window management
            recent_messages = conversation.messages[-20:]  # Get more recent context
            messages = []
            total_chars = 0
            max_context_chars = 8000  # Roughly 2000 tokens
            
            # Include messages from newest to oldest until we hit context limit
            for msg in reversed(recent_messages):
                msg_content = f"{msg.role}: {msg.content}"
                if total_chars + len(msg_content) > max_context_chars and messages:
                    break
                messages.insert(0, {"role": msg.role, "content": msg.content})
                total_chars += len(msg_content)
            
            # Generate AI response using the new LLM service
            try:
                # Prepare system prompt with repository context
                system_prompt = f"""You are an AI assistant specialized in code analysis and repository exploration. You have access to the complete codebase and can help with:
- Code explanation and documentation
- Architecture understanding
- Bug identification and debugging
- Implementation suggestions
- Best practices recommendations

Repository: {chat_session.repository.repo_name}
Branch: {chat_session.repository.branch}

Repository Context:
{context}

Provide detailed, accurate responses based on the repository content. Reference specific files and line numbers when relevant."""

                llm_response = await llm_service.generate(
                    messages=messages,
                    model=model,
                    provider=provider,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=False,
                    user=user,
                    use_user_key=use_user
                )
                
                if not llm_response.success:
                    # Check if it's an API key error
                    error_type = "server_error"
                    if "api key" in llm_response.error.lower() or "no user api key found" in llm_response.error.lower():
                        error_type = "no_api_key"
                    
                    return ChatResponse(
                        success=False,
                        error=llm_response.error,
                        error_type=error_type,
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    )
                
            except Exception as e:
                # Handle API key errors specifically
                error_type = "server_error"
                error_message = str(e)
                if "no user api key found" in error_message.lower() or "invalid api key" in error_message.lower():
                    error_type = "no_api_key"
                
                return ChatResponse(
                    success=False,
                    error=error_message,
                    error_type=error_type,
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                )
            
            # Add AI response to conversation
            conversation.add_message(
                "assistant", 
                llm_response.content,
                context_used=context[:500] + "..." if len(context) > 500 else context,
                metadata=llm_response.usage or {}
            )
            
            # Update conversation metadata
            if llm_response.usage:
                conversation.total_tokens_used += llm_response.usage.get("total_tokens", 0)
            
            await conversation.save()
            
            # Calculate response time
            response_time = time.time() - start_time
            
            # Prepare daily usage info
            daily_usage = {
                "requests_used": chat_session.daily_requests_count,
                "requests_limit": 50 if not chat_session.use_own_key else -1,
                "reset_date": (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
            }
            
            return ChatResponse(
                success=True,
                chat_id=chat_session.chat_id,
                conversation_id=conversation_id,
                ai_response=llm_response.content,
                context_used=context[:500] + "..." if len(context) > 500 else context,
                context_metadata=context_metadata,
                usage=llm_response.usage,
                model_used=llm_response.model,
                provider=llm_response.provider,
                response_time=response_time,
                daily_usage=daily_usage
            )
            
        except Exception as e:
            return ChatResponse(
                success=False,
                error=str(e),
                error_type="server_error",
                chat_id=chat_id or "",
                conversation_id=conversation_id or ""
            )
    
    async def process_streaming_chat(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        message: Annotated[str, Form(description="User's message/question")],
        repository_id: Annotated[str, Form(description="Repository ID to chat about")],
        use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
        repository_branch: Annotated[Optional[str], Form(description="Repository branch for more precise matching")] = None,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
        provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini)")] = "openai",
        model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
        temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
        max_tokens: Annotated[Optional[int], Form(description="Maximum tokens in response (1-4000)", ge=1, le=4000)] = None,
        context_search_query: Annotated[Optional[str], Form(description="Specific search query for context retrieval")] = None,
        scope_preference: Annotated[str, Form(description="Context scope preference: focused, moderate, or comprehensive")] = "moderate"
    ) -> AsyncGenerator[str, None]:
        """Process a chat message with streaming response - yields JSON strings"""
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
            
            # Get or create chat session
            chat_session = await self.get_or_create_chat_session(
                user, 
                repository_id,
                repository_branch,
                chat_id
            )
            
            # Generate conversation ID if not provided
            conversation_id = conversation_id or str(uuid.uuid4())
            
            # EARLY API KEY VALIDATION - Check if user has valid API key when use_user=True
            if use_user:
                try:
                    api_key = await self.get_api_key_for_request(user, provider, use_user=True)
                    if not api_key:
                        yield json.dumps(StreamChatResponse(
                            event="error",
                            error=f"No valid API key found for {provider}. Please add your API key or disable 'use own key' option.",
                            error_type="no_api_key",
                            provider=provider,
                            model=model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        return
                except Exception as e:
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=str(e),
                        error_type="invalid_api_key",
                        provider=provider,
                        model=model,
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    ).model_dump()) + "\n"
                    return
            
            # Get or create conversation - fetch with links to ensure repository is loaded
            conversation = await Conversation.find_one(
                Conversation.conversation_id == conversation_id,
                Conversation.user.id == BeanieObjectId(user.id),
                fetch_links=True  # Ensure linked objects are fully loaded
            )
            
            if not conversation:
                conversation = Conversation(
                    user=user,
                    repository=chat_session.repository,
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id,
                    title=self.generate_conversation_title(message),
                    model_provider=provider,
                    model_name=model,
                    temperature=temperature,
                    max_tokens=max_tokens
                )
                await conversation.save()
            else:
                # Ensure repository is fully loaded if it's a Link
                if hasattr(conversation.repository, 'id') and not hasattr(conversation.repository, 'file_paths'):
                    conversation.repository = await Repository.get(conversation.repository.id)
            
            # Add user message to conversation
            conversation.add_message("user", message)
            
            # Get repository context - use the repository from chat_session which we know is fully loaded
            context, context_metadata = await self.get_repository_context(
                chat_session.repository,
                context_search_query,
                user_query=message,
                max_context_tokens=max_tokens or 8000,
                scope_preference=scope_preference
            )
            
            # Prepare messages for LLM with intelligent context window management
            recent_messages = conversation.messages[-20:]  # Get more recent context
            messages = []
            total_chars = 0
            max_context_chars = 8000  # Roughly 2000 tokens
            
            # Include messages from newest to oldest until we hit context limit
            for msg in reversed(recent_messages):
                msg_content = f"{msg.role}: {msg.content}"
                if total_chars + len(msg_content) > max_context_chars and messages:
                    break
                messages.insert(0, {"role": msg.role, "content": msg.content})
                total_chars += len(msg_content)
            
            # Generate streaming response using the new LLM service
            try:
                # Prepare system prompt with repository context
                system_prompt = f"""You are an AI assistant specialized in code analysis and repository exploration. You have access to the complete codebase and can help with:
- Code explanation and documentation
- Architecture understanding
- Bug identification and debugging
- Implementation suggestions
- Best practices recommendations

Repository: {chat_session.repository.repo_name}
Branch: {chat_session.repository.branch}

Repository Context:
{context}

Provide detailed, accurate responses based on the repository content. Reference specific files and line numbers when relevant."""

                response_generator = await llm_service.generate(
                    messages=messages,
                    model=model,
                    provider=provider,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                    user=user,
                    use_user_key=use_user
                )
            except Exception as e:
                # Handle API key errors specifically
                error_type = "server_error"
                error_message = str(e)
                if "no user api key found" in error_message.lower() or "invalid api key" in error_message.lower():
                    error_type = "no_api_key"
                
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error=error_message,
                    error_type=error_type,
                    provider=provider,
                    model=model,
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                return
            
            # Handle response based on type
            if hasattr(response_generator, '__aiter__'):
                # It's an async generator
                response_content = ""
                final_usage = None
                
                async for chunk in response_generator:
                    if chunk.type == "token":
                        token_content = chunk.content or ""
                        response_content += token_content
                        
                        # Yield token event with all required fields
                        yield json.dumps(StreamChatResponse(
                            event="token",
                            token=token_content,
                            provider=chunk.provider or provider,
                            model=chunk.model or model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif chunk.type == "complete":
                        final_usage = chunk.usage or {}
                        
                        # Add AI response to conversation
                        conversation.add_message(
                            "assistant", 
                            response_content,
                            context_used=context[:500] + "..." if len(context) > 500 else context,
                            metadata=final_usage
                        )
                        
                        # Update conversation metadata
                        if final_usage:
                            conversation.total_tokens_used += final_usage.get("total_tokens", 0)
                        
                        await conversation.save()
                        
                        # Yield complete event with all required fields
                        yield json.dumps(StreamChatResponse(
                            event="complete",
                            provider=chunk.provider or provider,
                            model=chunk.model or model,
                            usage=final_usage,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id,
                            context_metadata=context_metadata
                        ).model_dump()) + "\n"
                        
                    elif chunk.type == "error":
                        yield json.dumps(StreamChatResponse(
                            event="error",
                            error=chunk.error or "Unknown error",
                            error_type="server_error",
                            provider=chunk.provider or provider,
                            model=chunk.model or model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        break
                        
            else:
                # It's a regular response (error case)
                if hasattr(response_generator, 'success') and not response_generator.success:
                    error_type = "server_error"
                    if "api key" in response_generator.error.lower() or "no user api key found" in response_generator.error.lower():
                        error_type = "no_api_key"
                    
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=response_generator.error or "Unknown error",
                        error_type=error_type,
                        provider=provider,
                        model=model,
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    ).model_dump()) + "\n"
                    
        except Exception as e:
            # Include chat_id and conversation_id in error response if available
            error_response = StreamChatResponse(
                event="error",
                error=str(e),
                error_type="server_error"
            )
            
            # Try to include IDs if they exist
            try:
                if 'chat_session' in locals():
                    error_response.chat_id = chat_session.chat_id
                if 'conversation_id' in locals():
                    error_response.conversation_id = conversation_id
            except Exception:
                pass
                
            yield json.dumps(error_response.model_dump()) + "\n"
            
    async def list_user_chat_sessions(
        self,
        jwt_token: Annotated[str, Form(description="JWT authentication token")],
        repo_id: Annotated[str, Form(description="Repository ID")]
    ) -> ChatSessionListResponse:
        try:
            user = await get_current_user(jwt_token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            user_object_id = BeanieObjectId(user.id)
            
            # Find repository using utility function
            try:
                repository = await find_user_repository(repo_id, user)
            except HTTPException:
                # Repository not found, return empty list
                return ChatSessionListResponse(
                    success=True,
                    sessions=[],
                    total_sessions=0
                )
            
            # Get all chat sessions for this repository
            chat_sessions = await ChatSession.find(
                ChatSession.user.id == user_object_id,
                ChatSession.is_active,
                ChatSession.repository.id == repository.id
            ).sort(-ChatSession.updated_at).to_list()

            # For each chat session, find the most recent conversation (if any)
            conversation_map = {}
            for session in chat_sessions:
                conversations = await Conversation.find(
                    Conversation.chat_id == session.chat_id,
                    Conversation.user.id == user_object_id
                ).sort(-Conversation.updated_at).limit(1).to_list()
                
                conversation = conversations[0] if conversations else None
                if conversation:
                    conversation_map[session.chat_id] = conversation.conversation_id
            
            # Only include sessions that have conversations (since conversation_id is required)
            sessions = []
            for session in chat_sessions:
                conversation_id = conversation_map.get(session.chat_id)
                if conversation_id:  # Only include if conversation exists
                    sessions.append(ChatSessionListItem(
                        chat_id=session.chat_id,
                        conversation_id=conversation_id,
                        title=session.title
                    ))
            
            return ChatSessionListResponse(
                success=True,
                sessions=sessions
            )
            
        except HTTPException:
            # Re-raise HTTP exceptions as-is
            raise
        except ValueError as e:
            # Handle invalid ObjectId or other value errors
            raise HTTPException(status_code=400, detail=f"Invalid request data: {str(e)}")
        except Exception as e:
            # Log the actual error for debugging
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
    async def get_conversation_history(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        conversation_id: Annotated[str, Form(description="Conversation ID to retrieve")]
    ) -> ConversationHistoryResponse:
        """Get full conversation history"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            conversation = await Conversation.find_one(
                Conversation.conversation_id == conversation_id,
                Conversation.user.id == BeanieObjectId(user.id)
            )
            
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")
            
            # Convert messages to response format
            messages_response = [
                MessageResponse(
                    role=msg.role,
                    content=msg.content,
                    timestamp=msg.timestamp,
                    context_used=msg.context_used,
                    metadata=msg.metadata
                )
                for msg in conversation.messages
            ]
            
            return ConversationHistoryResponse(
                chat_id=conversation.chat_id,
                conversation_id=conversation.conversation_id,
                title=conversation.title,
                messages=messages_response,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                total_tokens_used=conversation.total_tokens_used,
                model_provider=conversation.model_provider,
                model_name=conversation.model_name
            )
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    async def get_chat_session(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        chat_id: Annotated[str, Form(description="Chat session ID to retrieve")]
    ) -> ChatSessionResponse:
        """Get chat session details with recent conversations"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            # Fetch with linked repository included
            chat_session = await ChatSession.find_one(
                ChatSession.chat_id == chat_id,
                ChatSession.user.id == BeanieObjectId(user.id),
                fetch_links=True  # This will fetch the linked repository
            )
            
            if not chat_session:
                raise HTTPException(status_code=404, detail="Chat session not found")
            
            # Double-check that repository is fully loaded
            if hasattr(chat_session.repository, 'id') and not hasattr(chat_session.repository, 'repo_name'):
                chat_session.repository = await Repository.get(chat_session.repository.id)
            
            # Get conversations
            conversations = await Conversation.find(
                Conversation.chat_id == chat_id,
                Conversation.user.id == BeanieObjectId(user.id),  # Add user filter for security
                sort=(-Conversation.updated_at)
            ).to_list()
            
            # Prepare conversation responses
            recent_conversations = []
            for conv in conversations:
                messages_response = [
                    MessageResponse(
                        role=msg.role,
                        content=msg.content,
                        timestamp=msg.timestamp,
                        context_used=msg.context_used,
                        metadata=msg.metadata
                    )
                    for msg in conv.messages
                ]
                recent_conversations.append(
                    ConversationHistoryResponse(
                        chat_id=conv.chat_id,
                        conversation_id=conv.conversation_id,
                        title=conv.title,
                        messages=messages_response,
                        created_at=conv.created_at,
                        updated_at=conv.updated_at,
                        total_tokens_used=conv.total_tokens_used,
                        model_provider=conv.model_provider,
                        model_name=conv.model_name
                    )
                )
            
            # Determine daily limit
            daily_limit = 50
            if chat_session.use_own_key:
                daily_limit = -1  # Unlimited
            
            return ChatSessionResponse(
                chat_id=chat_session.chat_id,
                title=chat_session.title,
                repository_name=chat_session.repository.repo_name,  # Now this will work
                repository_id=str(chat_session.repository.id),  # Convert to string
                created_at=chat_session.created_at,
                updated_at=chat_session.updated_at,
                is_active=chat_session.is_active,
                default_model_provider=chat_session.default_model_provider,
                default_model_name=chat_session.default_model_name,
                use_own_key=chat_session.use_own_key,
                daily_requests_count=chat_session.daily_requests_count,
                daily_limit=daily_limit,
                recent_conversations=recent_conversations
            )
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        
    
    async def verify_user_api_key(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        provider: Annotated[str, Form(description="Provider name (openai, anthropic, gemini)")],
        api_key: Annotated[str, Form(description="API key to verify")]
    ) -> dict:
        """Verify API key without saving it"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            # Validate provider
            valid_providers = ["openai", "anthropic", "gemini"]
            if provider not in valid_providers:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid provider. Valid providers: {', '.join(valid_providers)}"
                )
            
            # Verify the API key
            is_valid = llm_service.verify_api_key(provider, api_key)
            
            response = {
                "success": True,
                "provider": provider,
                "is_valid": is_valid,
                "message": "API key is valid" if is_valid else "API key is invalid"
            }
            
            # Optionally get available models if key is valid
            if is_valid:
                try:
                    available_models = llm_service.get_valid_models_for_provider(provider, api_key)
                    response["available_models"] = available_models[:10]  # Limit to first 10 models
                except Exception as e:
                    logger.warning(f"Could not fetch models for {provider}: {e}")
                    response["available_models"] = []
            
            return response
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def save_user_api_key(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        provider: Annotated[str, Form(description="Provider name (openai, anthropic, gemini)")],
        api_key: Annotated[str, Form(description="API key")],
        key_name: Annotated[Optional[str], Form(description="Friendly name for the key")] = None,
        verify_key: Annotated[bool, Form(description="Whether to verify the key before saving")] = True
    ) -> ApiKeyResponse:
        """Save or update user API key with optional verification"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            # Validate provider
            valid_providers = ["openai", "anthropic", "gemini"]
            if provider not in valid_providers:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid provider. Valid providers: {', '.join(valid_providers)}"
                )
            
            # Save key with verification
            user_key = await llm_service.save_user_api_key(
                user,
                provider,
                api_key,
                verify=verify_key
            )
            # Set key_name if provided (the new service doesn't use key_name parameter)
            if key_name and hasattr(user_key, 'key_name'):
                user_key.key_name = key_name
                await user_key.save()
            
            return ApiKeyResponse(
                success=True,
                message="API key saved successfully",
                provider=provider,
                key_name=user_key.key_name,
                created_at=user_key.created_at
            )
            
        except Exception as e:
            return ApiKeyResponse(
                success=False,
                message=str(e),
                provider=provider
            )
    
    async def get_available_models(
        self,
        token: Annotated[str, Form(description="JWT authentication token")]
    ) -> AvailableModelsResponse:
        """Get available models with user's key status"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            # Get user's keys
            user_keys = await UserApiKey.find(
                UserApiKey.user.id == BeanieObjectId(user.id),
                UserApiKey.is_active
            ).to_list()
            
            user_has_keys = [key.provider for key in user_keys]
            
            # Get available models
            models = llm_service.get_available_models()
            
            # Get current limits based on user's tier
            # (In a real app, you'd get this from user profile)
            current_limits = {
                "free": 10,
                "premium": 50,
                "unlimited": -1
            }
            
            return AvailableModelsResponse(
                providers=models,
                current_limits=current_limits,
                user_has_keys=user_has_keys
            )
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    async def update_chat_settings(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        chat_id: Annotated[str, Form(description="Chat session ID to update")],
        title: Annotated[Optional[str], Form(description="New chat title")] = None,
        default_provider: Annotated[Optional[str], Form(description="Default LLM provider")] = None,
        default_model: Annotated[Optional[str], Form(description="Default model name")] = None,
        default_temperature: Annotated[Optional[float], Form(description="Default temperature (0.0-2.0)", ge=0.0, le=2.0)] = None
    ) -> ChatSettingsResponse:
        """Update chat session settings"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            chat_session = await ChatSession.find_one(
                ChatSession.chat_id == chat_id,
                ChatSession.user.id == BeanieObjectId(user.id)
            )
            
            if not chat_session:
                raise HTTPException(status_code=404, detail="Chat session not found")
            
            # Update fields
            updated_fields = {}
            if title is not None:
                chat_session.title = title
                updated_fields["title"] = title
                
            if default_provider is not None:
                chat_session.default_model_provider = default_provider
                updated_fields["default_model_provider"] = default_provider
                
            if default_model is not None:
                chat_session.default_model_name = default_model
                updated_fields["default_model_name"] = default_model
                
            if default_temperature is not None:
                chat_session.default_temperature = default_temperature
                updated_fields["default_temperature"] = default_temperature
                
            if updated_fields:
                chat_session.updated_at = datetime.now(timezone.utc)
                await chat_session.save()
            
            return ChatSettingsResponse(
                success=True,
                message="Settings updated successfully",
                settings=updated_fields
            )
            
        except Exception as e:
            return ChatSettingsResponse(
                success=False,
                message=str(e)
            )
    
    async def process_react_agent_chat(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        message: Annotated[str, Form(description="User's message/question")],
        repository_id: Annotated[str, Form(description="Repository ID to chat about")],
        repository_branch: Annotated[Optional[str], Form(description="Repository branch for more precise matching")] = None,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
        max_iterations: Annotated[int, Form(description="Maximum agent iterations (1-10)", ge=1, le=10)] = 5
    ) -> AsyncGenerator[str, None]:
        """Process chat message using ReAct agent with streaming response"""
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
            
            # Get or create chat session
            chat_session = await self.get_or_create_chat_session(
                user, 
                repository_id,
                repository_branch,
                chat_id
            )
            
            # Generate conversation ID if not provided
            conversation_id = conversation_id or str(uuid.uuid4())
            
            # Get or create conversation
            conversation = await Conversation.find_one(
                Conversation.conversation_id == conversation_id,
                Conversation.user.id == BeanieObjectId(user.id),
                fetch_links=True
            )
            
            if not conversation:
                conversation = Conversation(
                    user=user,
                    repository=chat_session.repository,
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id,
                    title=f"Agent: {self.generate_conversation_title(message)}",
                    model_provider="mixed",  # Agent uses multiple models
                    model_name="react_agent",
                    temperature=0.3,
                    max_tokens=2000
                )
                await conversation.save()
            
            # Add user message to conversation
            conversation.add_message("user", message)
            
            # Load repository graph data
            graph_utils = await self.load_repository_graph(chat_session.repository)
            
            if not graph_utils:
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error="Repository graph data not available. ReAct agent requires graph analysis.",
                    error_type="no_graph_data",
                    chat_id=chat_session.chat_id,
                    conversation_id=conversation_id
                ).model_dump()) + "\n"
                return
            
            # Initialize ReAct agent
            agent = get_react_agent(graph_utils)
            agent.max_iterations = max_iterations
            
            # Process query with streaming
            full_response = ""
            async for agent_chunk in agent.process_query_streaming(message):
                # Convert agent response to chat stream format
                if agent_chunk.type == "reasoning":
                    yield json.dumps(StreamChatResponse(
                        event="agent_reasoning",
                        token=f"🤔 {agent_chunk.content}",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id,
                        metadata={
                            "iteration": agent_chunk.iteration,
                            "confidence": agent_chunk.confidence
                        }
                    ).model_dump()) + "\n"
                
                elif agent_chunk.type == "action":
                    yield json.dumps(StreamChatResponse(
                        event="agent_action",
                        token=f"🔍 {agent_chunk.content}",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id,
                        metadata={
                            "iteration": agent_chunk.iteration,
                            "action": agent_chunk.action
                        }
                    ).model_dump()) + "\n"
                
                elif agent_chunk.type == "observation":
                    yield json.dumps(StreamChatResponse(
                        event="agent_observation",
                        token=f"👁️ {agent_chunk.content[:200]}...",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id,
                        metadata={
                            "iteration": agent_chunk.iteration,
                            "action_result": agent_chunk.action_result
                        }
                    ).model_dump()) + "\n"
                
                elif agent_chunk.type == "complete":
                    full_response = agent_chunk.content
                    
                    # Add AI response to conversation
                    conversation.add_message(
                        "assistant",
                        full_response,
                        context_used="ReAct Agent Exploration",
                        metadata={
                            "agent_type": "react",
                            "iterations": agent_chunk.iteration,
                            "confidence": agent_chunk.confidence
                        }
                    )
                    await conversation.save()
                    
                    # Stream the final response token by token
                    for token in full_response.split():
                        yield json.dumps(StreamChatResponse(
                            event="token",
                            token=token + " ",
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id,
                            provider="react_agent",
                            model="react_agent"
                        ).model_dump()) + "\n"
                    
                    # Final completion event
                    yield json.dumps(StreamChatResponse(
                        event="complete",
                        provider="react_agent",
                        model="react_agent",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id,
                        metadata={
                            "agent_type": "react",
                            "iterations_used": agent_chunk.iteration,
                            "confidence": agent_chunk.confidence
                        }
                    ).model_dump()) + "\n"
                
                elif agent_chunk.type == "error":
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=agent_chunk.error,
                        error_type="agent_error",
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    ).model_dump()) + "\n"
                    break
                    
        except Exception as e:
            logger.error(f"Error in ReAct agent chat: {e}")
            yield json.dumps(StreamChatResponse(
                event="error",
                error=str(e),
                error_type="server_error",
                chat_id=chat_id or "",
                conversation_id=conversation_id or ""
            ).model_dump()) + "\n"

    async def search_context(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        repository_id: Annotated[str, Form(description="Repository ID to search")],
        query: Annotated[str, Form(description="Search query")],
        max_results: Annotated[int, Form(description="Maximum number of results (1-20)", ge=1, le=20)] = 5
    ) -> ContextSearchResponse:
        """Search repository context"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            repository = await find_user_repository(repository_id, user)
            
            # Load repository content
            content = await file_manager.load_text_content(repository.file_paths.text)
            if not content:
                return ContextSearchResponse(
                    success=False,
                    results=[],
                    total_found=0,
                    query_used=query
                )
            
            # Simple search implementation
            lines = content.split('\n')
            results = []
            for i, line in enumerate(lines):
                if query.lower() in line.lower():
                    # Capture surrounding context
                    start = max(0, i - 1)
                    end = min(len(lines), i + 2)
                    context = "\n".join(lines[start:end])
                    
                    results.append({
                        "line_number": i + 1,
                        "content": line,
                        "context": context
                    })
                    if len(results) >= max_results:
                        break
            
            return ContextSearchResponse(
                success=True,
                results=results,
                total_found=len(results),
                query_used=query
            )
            
        except Exception:
            return ContextSearchResponse(
                success=False,
                results=[],
                total_found=0,
                query_used=query
            )


# Global instance
chat_controller = ChatController()