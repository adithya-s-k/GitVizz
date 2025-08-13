import json
import os
from fastapi import HTTPException, Form
from typing import Optional, AsyncGenerator, Annotated
import uuid
import time
from datetime import datetime, timedelta, timezone
import logging
from beanie import BeanieObjectId
from models.chat import ChatSession, Conversation
from models.repository import Repository
from models.user import User
from utils.llm_utils import llm_service
from utils.file_utils import file_manager
from utils.jwt_utils import get_current_user
from utils.repo_utils import extract_zip_contents, smart_filter_files, format_repo_contents, cleanup_temp_files
from utils.repo_utils import find_user_repository
from schemas.chat_schemas import (
    ChatResponse, ConversationHistoryResponse, 
    ChatSessionResponse,
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
        
        # Validate repository_id
        if not repository_id or repository_id.strip() == "":
            raise HTTPException(
                status_code=400, 
                detail="Repository ID is required for chat sessions"
            )
        
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
        scope_preference: str = "moderate",
        model: str = "gpt-4o-mini",
        provider: str = "openai"
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
                        
                        # Use intelligent token-aware truncation for cached content
                        from utils.langchain_llm_service import langchain_service
                        actual_tokens = langchain_service.count_tokens_approximately(cached_content)
                        context_metadata["actual_tokens"] = actual_tokens
                        context_metadata["model_used_for_counting"] = model
                        
                        if actual_tokens > max_context_tokens:
                            logger.info(f"Cached content exceeds limit: {actual_tokens} > {max_context_tokens}, truncating...")
                            
                            # Calculate the proportion to keep
                            keep_ratio = max_context_tokens / actual_tokens
                            char_limit = int(len(cached_content) * keep_ratio * 0.9)  # Use 90% to be safe
                            
                            cached_content = cached_content[:char_limit] + "\n\n... (content truncated due to token limit)"
                            final_tokens = langchain_service.count_tokens_approximately(cached_content)
                            
                            context_metadata.update({
                                "truncated": True,
                                "truncated_at_tokens": max_context_tokens,
                                "final_tokens": final_tokens,
                                "truncation_ratio": keep_ratio
                            })
                        
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
            
            # Use intelligent token-aware truncation with LangChain utilities
            from utils.langchain_llm_service import langchain_service
            
            # Format repository contents into LLM-friendly text
            context_text = format_repo_contents(filtered_files)
            
            # Count actual tokens using LangChain's approximate counting
            actual_tokens = langchain_service.count_tokens_approximately(context_text)
            
            context_metadata = {
                "source": "zip_processed",
                "repository_id": str(repository.id),
                "repository_name": repository.repo_name,
                "content_length": len(context_text),
                "actual_tokens": actual_tokens,
                "max_context_tokens": max_context_tokens,
                "scope": scope_preference,
                "search_query": context_search_query,
                "files_processed": len(filtered_files),
                "zip_path": zip_file_path,
                "model_used_for_counting": model
            }
            
            # Intelligent truncation if content exceeds token limit
            if actual_tokens > max_context_tokens:
                logger.info(f"Context exceeds limit: {actual_tokens} > {max_context_tokens}, truncating...")
                
                # Calculate the proportion to keep
                keep_ratio = max_context_tokens / actual_tokens
                char_limit = int(len(context_text) * keep_ratio * 0.9)  # Use 90% to be safe
                
                # Try to truncate at natural boundaries (file boundaries)
                lines = context_text.split('\n')
                truncated_lines = []
                current_chars = 0
                
                for line in lines:
                    if current_chars + len(line) + 1 > char_limit:
                        break
                    truncated_lines.append(line)
                    current_chars += len(line) + 1
                
                context_text = '\n'.join(truncated_lines)
                context_text += "\n\n... (content truncated due to token limit)"
                
                # Update token count after truncation
                final_tokens = langchain_service.count_tokens_approximately(context_text)
                context_metadata.update({
                    "truncated": True,
                    "truncated_at_tokens": max_context_tokens,
                    "final_tokens": final_tokens,
                    "truncation_ratio": keep_ratio
                })
            
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
        repository_identifier: Annotated[str, Form(description="Repository identifier in format owner/repo/branch")],
        use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
        provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini, groq)")] = "openai",
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
                repository_identifier,
                None,  # No separate branch parameter needed with new identifier format
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
                scope_preference=scope_preference,
                model=model,
                provider=provider
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
        repository_id: Annotated[str, Form(description="Repository identifier in format owner/repo/branch")],
        use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
        chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
        conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
        provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini, groq)")] = "openai",
        model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
        temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
        max_tokens: Annotated[Optional[int], Form(description="Maximum tokens in response (1-4000)", ge=1, le=4000)] = None,
        context_mode: Annotated[str, Form(description="Context mode: full, smart, or agentic")] = "smart"
    ) -> AsyncGenerator[str, None]:
        """Process a chat message with streaming response - yields JSON strings"""
        try:
            # Validate required parameters early
            if not repository_id or repository_id.strip() == "":
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error="Repository identifier is required for chat",
                    error_type="validation_error"
                ).model_dump()) + "\n"
                return
            
            if not message or message.strip() == "":
                yield json.dumps(StreamChatResponse(
                    event="error",
                    error="Message cannot be empty",
                    error_type="validation_error"
                ).model_dump()) + "\n"
                return
            
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
                None,  # No separate branch parameter needed with new identifier format
                chat_id
            )
            
            # Generate conversation ID if not provided
            conversation_id = conversation_id or str(uuid.uuid4())
            
            # EARLY API KEY VALIDATION - Using improved LangChain service
            try:
                from utils.langchain_llm_service import langchain_service
                
                # Check if provider is available and test API key access
                available_providers = langchain_service.get_available_providers()
                if provider not in available_providers:
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=f"Provider {provider} not available. Available: {', '.join(available_providers)}. Install required packages.",
                        error_type="provider_unavailable",
                        provider=provider,
                        model=model,
                        chat_id=chat_session.chat_id,
                        conversation_id=conversation_id
                    ).model_dump()) + "\n"
                    return
                
                # Test API key access early
                try:
                    await langchain_service.get_api_key_with_fallback(provider, user, use_user)
                except ValueError as e:
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=str(e),
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
                    error=f"Service initialization error: {str(e)}",
                    error_type="service_error",
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
            
            # Get repository context based on the selected mode
            context, context_metadata = await self.get_repository_context_by_mode(
                chat_session.repository,
                context_mode,
                user_query=message,
                max_context_tokens=max_tokens or 8000,
                model=model,
                provider=provider
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
            
            # Generate streaming response using the new LangGraph service
            try:
                from utils.langgraph_chat_service import langgraph_chat_service
                
                # Use LangGraph for advanced chat orchestration
                response_generator = langgraph_chat_service.stream_chat_response(
                    user_query=message,
                    repository_id=repository_id,
                    user=user,
                    model=model,
                    provider=provider,
                    thread_id=f"{chat_session.chat_id}_{conversation_id}",
                    repository_context=context,
                    context_metadata=context_metadata
                )
            except Exception as e:
                # Handle API key and quota errors specifically
                error_type = "server_error"
                error_message = str(e)
                if "no user api key found" in error_message.lower() or "invalid api key" in error_message.lower():
                    error_type = "no_api_key"
                elif "quota" in error_message.lower() or "rate limit" in error_message.lower():
                    error_type = "quota_exceeded"
                elif "invalid model" in error_message.lower():
                    error_type = "invalid_model"
                
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
            
            # Handle LangGraph streaming response
            response_content = ""
            final_usage = {}
            
            async for json_chunk in response_generator:
                try:
                    # Parse the JSON chunk
                    chunk_data = json.loads(json_chunk.strip())
                    event_type = chunk_data.get("event")
                    
                    if event_type == "progress":
                        # Yield progress events
                        yield json.dumps(StreamChatResponse(
                            event="progress",
                            progress_step=chunk_data.get("step"),
                            provider=provider,
                            model=model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif event_type == "reasoning":
                        # Yield reasoning traces for o1/o3 models
                        yield json.dumps(StreamChatResponse(
                            event="reasoning",
                            reasoning=chunk_data.get("reasoning"),
                            provider=provider,
                            model=model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif event_type == "token":
                        token_content = chunk_data.get("token", "")
                        response_content += token_content
                        
                        # Yield token event
                        yield json.dumps(StreamChatResponse(
                            event="token",
                            token=token_content,
                            provider=provider,
                            model=model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        
                    elif event_type == "complete":
                        # Save conversation and yield completion
                        conversation.add_message(
                            "assistant",
                            response_content,
                            context_used=context[:500] + "..." if len(context) > 500 else context,
                            metadata=final_usage
                        )
                        
                        if final_usage:
                            conversation.total_tokens_used += final_usage.get("total_tokens", 0)
                        
                        await conversation.save()
                        
                        yield json.dumps(StreamChatResponse(
                            event="complete",
                            provider=provider,
                            model=model,
                            usage=final_usage,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id,
                            context_metadata=context_metadata
                        ).model_dump()) + "\n"
                        
                    elif event_type == "error":
                        yield json.dumps(StreamChatResponse(
                            event="error",
                            error=chunk_data.get("error", "Unknown error"),
                            error_type="server_error",
                            provider=provider,
                            model=model,
                            chat_id=chat_session.chat_id,
                            conversation_id=conversation_id
                        ).model_dump()) + "\n"
                        break
                        
                except json.JSONDecodeError:
                    # Skip malformed JSON
                    continue
                except Exception as chunk_error:
                    # Handle individual chunk errors
                    yield json.dumps(StreamChatResponse(
                        event="error",
                        error=f"Chunk processing error: {str(chunk_error)}",
                        error_type="processing_error",
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
        repository_identifier: Annotated[str, Form(description="Repository identifier in format owner/repo/branch")]
    ) -> ChatSessionListResponse:
        try:
            user = await get_current_user(jwt_token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            user_object_id = BeanieObjectId(user.id)
            
            # Find repository using utility function
            try:
                repository = await find_user_repository(repository_identifier, user)
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
                ChatSession.is_active == True,
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
    
    async def search_context(
        self,
        token: Annotated[str, Form(description="JWT authentication token")],
        repository_identifier: Annotated[str, Form(description="Repository identifier in format owner/repo/branch")],
        query: Annotated[str, Form(description="Search query")],
        max_results: Annotated[int, Form(description="Maximum number of results (1-20)", ge=1, le=20)] = 5
    ) -> ContextSearchResponse:
        """Search repository context"""
        try:
            user = await get_current_user(token)
            if not user:
                raise HTTPException(status_code=401, detail="Invalid JWT token")
            
            repository = await find_user_repository(repository_identifier, user)
            
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

    async def get_repository_context_by_mode(
        self,
        repository,
        context_mode: str,
        user_query: str,
        max_context_tokens: int = 8000,
        model: str = "gpt-4o-mini",
        provider: str = "openai"
    ) -> tuple[str, dict]:
        """Get repository context based on the selected mode"""
        
        if context_mode == "full":
            # Full context mode - include entire repository
            return await self.get_full_repository_context(
                repository,
                max_context_tokens,
                model=model
            )
        elif context_mode == "smart":
            # Smart context mode - use AI-powered retrieval (existing logic)
            return await self.get_repository_context(
                repository,
                context_search_query=user_query,
                user_query=user_query,
                max_context_tokens=max_context_tokens,
                scope_preference="moderate",
                model=model,
                provider=provider
            )
        elif context_mode == "agentic":
            # Agentic context mode - multi-step reasoning (not implemented yet)
            # For now, fallback to smart mode with comprehensive scope
            return await self.get_repository_context(
                repository,
                context_search_query=user_query,
                user_query=user_query,
                max_context_tokens=max_context_tokens,
                scope_preference="comprehensive",
                model=model,
                provider=provider
            )
        else:
            # Default to smart mode
            return await self.get_repository_context(
                repository,
                context_search_query=user_query,
                user_query=user_query,
                max_context_tokens=max_context_tokens,
                scope_preference="moderate",
                model=model,
                provider=provider
            )

    async def get_full_repository_context(
        self,
        repository,
        max_context_tokens: int = 8000,
        model: str = "gpt-4o-mini"
    ) -> tuple[str, dict]:
        """Get full repository context by extracting and including all files from ZIP"""
        temp_dirs_to_cleanup = []
        
        try:
            # Check if we have a ZIP file to extract from
            if not repository.file_paths or not repository.file_paths.zip:
                return "No ZIP file available for full context extraction.", {"context_type": "full", "files_included": 0}
            
            zip_file_path = repository.file_paths.zip
            
            # Check if ZIP file exists
            if not os.path.exists(zip_file_path):
                return f"ZIP file not found at path: {zip_file_path}", {"context_type": "full", "files_included": 0}
            
            # Extract ZIP contents using repo_utils function
            extracted_files, temp_extract_dir = extract_zip_contents(zip_file_path)
            temp_dirs_to_cleanup.append(temp_extract_dir)
            
            if not extracted_files:
                return "No files found in ZIP archive.", {"context_type": "full", "files_included": 0}
            
            # Filter files to include only relevant source code files
            filtered_files = smart_filter_files(extracted_files, temp_extract_dir)
            
            if not filtered_files:
                return "No relevant source files found after filtering.", {"context_type": "full", "files_included": 0}
            
            # Use intelligent token counting with LangChain
            from utils.langchain_llm_service import langchain_service
            
            context_parts = []
            files_included = 0
            current_tokens = 0
            
            # Sort files by importance (e.g., README files first, then main source files)
            def get_file_priority(file_info):
                file_path = file_info["path"].lower()
                if "readme" in file_path:
                    return 0
                elif file_path.endswith(('.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs')):
                    return 1
                elif file_path.endswith(('.json', '.yaml', '.yml', '.xml')):
                    return 2
                elif file_path.endswith(('.md', '.txt', '.rst')):
                    return 3
                else:
                    return 4
            
            sorted_files = sorted(filtered_files, key=get_file_priority)
            
            # Process files until we hit the token limit
            for file_info in sorted_files:
                try:
                    file_path = file_info["path"]
                    full_path = file_info["full_path"]
                    
                    # Read file content
                    try:
                        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                    except UnicodeDecodeError:
                        # Try with different encoding for binary files
                        with open(full_path, 'r', encoding='latin-1') as f:
                            content = f.read()
                    
                    # Create file section
                    file_section = f"\n=== File: {file_path} ===\n{content}\n"
                    
                    # Check if adding this file would exceed token limit
                    file_section_tokens = langchain_service.count_tokens_approximately(file_section)
                    
                    if current_tokens + file_section_tokens > max_context_tokens and context_parts:
                        # Calculate how much content we can fit in remaining tokens
                        remaining_tokens = max_context_tokens - current_tokens
                        if remaining_tokens > 100:  # Only include if we have reasonable space
                            # Estimate how much content we can fit
                            approx_chars_per_token = len(file_section) / file_section_tokens
                            max_content_chars = int(remaining_tokens * approx_chars_per_token * 0.8)  # Use 80% to be safe
                            
                            if max_content_chars > 200:  # Minimum reasonable content size
                                truncated_content = content[:max_content_chars-100] + "\n... (truncated due to token limit)"
                                file_section = f"\n=== File: {file_path} ===\n{truncated_content}\n"
                                context_parts.append(file_section)
                                files_included += 1
                                current_tokens += langchain_service.count_tokens_approximately(file_section)
                        break
                    
                    context_parts.append(file_section)
                    files_included += 1
                    current_tokens += file_section_tokens
                    
                except Exception as e:
                    logger.warning(f"Could not read file {file_path}: {e}")
                    # Add a placeholder for files that couldn't be read
                    file_section = f"\n=== File: {file_path} ===\n[Could not read file: {e}]\n"
                    file_section_tokens = langchain_service.count_tokens_approximately(file_section)
                    
                    if current_tokens + file_section_tokens <= max_context_tokens:
                        context_parts.append(file_section)
                        files_included += 1
                        current_tokens += file_section_tokens
                    continue
            
            context = "".join(context_parts)
            if not context:
                context = "No file content could be extracted from the repository."
            
            # Get final accurate token count
            final_tokens = langchain_service.count_tokens_approximately(context)
            
            metadata = {
                "context_type": "full",
                "files_included": files_included,
                "total_files_available": len(filtered_files),
                "actual_tokens": final_tokens,
                "max_context_tokens": max_context_tokens,
                "content_length": len(context),
                "zip_path": zip_file_path,
                "extraction_successful": True,
                "model_used_for_counting": model
            }
            
            logger.info(f"Full context extracted: {files_included} files, {len(context)} characters, {final_tokens} tokens")
            return context, metadata
            
        except Exception as e:
            logger.error(f"Error getting full repository context: {e}")
            return f"Error loading repository context: {str(e)}", {"context_type": "full", "error": str(e)}
        finally:
            # Clean up temporary directories
            if temp_dirs_to_cleanup:
                cleanup_temp_files(temp_dirs_to_cleanup)


# Global instance
chat_controller = ChatController()