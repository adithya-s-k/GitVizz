from fastapi import APIRouter, Form
from fastapi.responses import StreamingResponse
from typing import Optional, Annotated
from schemas.chat_schemas import (
    ChatResponse, ConversationHistoryResponse, 
    ChatSessionResponse, ApiKeyResponse,
    AvailableModelsResponse, ChatSettingsResponse,
    ContextSearchResponse, ChatSessionListResponse
)
from controllers.chat_controller import chat_controller
from schemas.response_schemas import ErrorResponse

router = APIRouter(prefix="/backend-chat")

# Chat endpoint (non-streaming)
@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="Process chat message",
    description="Process a user's chat message and return an AI-generated response",
    response_description="AI response and conversation metadata",
    responses={
        200: {
            "model": ChatResponse,
            "description": "Successful response with AI-generated content"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Repository or chat session not found"
        },
        429: {
            "model": ErrorResponse,
            "description": "Rate limit exceeded"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def process_chat_message(
    token: Annotated[str, Form(description="JWT authentication token")],
    message: Annotated[str, Form(description="User's message/question")],
    repository_id: Annotated[str, Form(description="Repository ID to chat about")],
    use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
    chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
    conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
    provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini)")] = "openai",
    model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
    temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
    max_tokens: Annotated[Optional[int], Form(description="Maximum tokens in response (1-4000)", ge=1, le=4000)] = None,
    include_full_context: Annotated[bool, Form(description="Include full repository content as context")] = False,
    context_search_query: Annotated[Optional[str], Form(description="Specific search query for context retrieval")] = None
):
    return await chat_controller.process_chat_message(
        token=token,
        message=message,
        repository_id=repository_id,
        use_user=use_user,
        chat_id=chat_id,
        conversation_id=conversation_id,
        provider=provider,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        include_full_context=include_full_context,
        context_search_query=context_search_query
    )

# Streaming chat endpoint
@router.post(
    "/chat/stream",
    summary="Stream chat response",
    description="Process a chat message with streaming token-by-token response",
    response_description="Stream of chat events (tokens, completion, errors)",
    responses={
        200: {
            "description": "Successful streaming response",
            "content": {"application/x-ndjson": {}}
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Repository or chat session not found"
        },
        429: {
            "model": ErrorResponse,
            "description": "Rate limit exceeded"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def stream_chat_response(
    token: Annotated[str, Form(description="JWT authentication token")],
    message: Annotated[str, Form(description="User's message/question")],
    repository_id: Annotated[str, Form(description="Repository ID to chat about")],
    use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
    chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
    conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
    provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini)")] = "openai",
    model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
    temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
    max_tokens: Annotated[Optional[int], Form(description="Maximum tokens in response (1-4000)", ge=1, le=4000)] = None,
    context_search_query: Annotated[Optional[str], Form(description="Specific search query for context retrieval")] = None,
    scope_preference: Annotated[str, Form(description="Context scope preference: focused, moderate, or comprehensive")] = "moderate"
):
    return StreamingResponse(
        chat_controller.process_streaming_chat(
            token=token,
            message=message,
            repository_id=repository_id,
            use_user=use_user,
            chat_id=chat_id,
            conversation_id=conversation_id,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            context_search_query=context_search_query,
            scope_preference=scope_preference
        ),
        media_type="application/x-ndjson"
    )

# Conversation history endpoint
@router.post(
    "/conversations/{conversation_id}",
    response_model=ConversationHistoryResponse,
    summary="Get conversation history",
    description="Retrieve the full message history of a conversation",
    response_description="List of messages in the conversation",
    responses={
        200: {
            "model": ConversationHistoryResponse,
            "description": "Successful retrieval of conversation history"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Conversation not found"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def get_conversation_history(
    conversation_id: str,
    token: Annotated[str, Form(description="JWT authentication token")]
):
    return await chat_controller.get_conversation_history(
        token=token,
        conversation_id=conversation_id
    )

# List user's chat sessions endpoint
@router.post(
    "/sessions",
    response_model=ChatSessionListResponse,
    summary="List user's chat sessions",
    description="Retrieve all chat session IDs and titles for the authenticated user",
    response_description="List of user's chat sessions with basic info",
    responses={
        200: {
            "model": ChatSessionListResponse,
            "description": "Successful retrieval of chat sessions"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def list_user_chat_sessions(
    jwt_token: Annotated[str, Form(description="JWT authentication token")],
    repo_id: Annotated[str,Form(description="Repository ID")]
):
    return await chat_controller.list_user_chat_sessions(jwt_token=jwt_token, repo_id=repo_id)

# Chat session endpoint
@router.post(
    "/sessions/{chat_id}",
    response_model=ChatSessionResponse,
    summary="Get chat session details",
    description="Retrieve details of a chat session including recent conversations",
    response_description="Chat session metadata and recent conversations",
    responses={
        200: {
            "model": ChatSessionResponse,
            "description": "Successful retrieval of chat session"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Chat session not found"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def get_chat_session(
    chat_id: str,
    token: Annotated[str, Form(description="JWT authentication token")]
):
    return await chat_controller.get_chat_session(
        token=token,
        chat_id=chat_id
    )

# API key verification endpoint
@router.post(
    "/keys/verify",
    response_model=dict,
    summary="Verify API key",
    description="Verify if an API key is valid for a specific provider without saving it",
    response_description="Verification result with details",
    responses={
        200: {
            "description": "API key verification result"
        },
        400: {
            "model": ErrorResponse,
            "description": "Invalid provider specified"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def verify_user_api_key(
    token: Annotated[str, Form(description="JWT authentication token")],
    provider: Annotated[str, Form(description="Provider name (openai, anthropic, gemini)")],
    api_key: Annotated[str, Form(description="API key to verify")]
):
    return await chat_controller.verify_user_api_key(
        token=token,
        provider=provider,
        api_key=api_key
    )

# API key save endpoint
@router.post(
    "/keys/save",
    response_model=ApiKeyResponse,
    summary="Save user API key",
    description="Save or update an encrypted API key for a specific provider with verification",
    response_description="Confirmation of key save operation",
    responses={
        200: {
            "model": ApiKeyResponse,
            "description": "API key saved successfully"
        },
        400: {
            "model": ErrorResponse,
            "description": "Invalid provider or API key specified"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def save_user_api_key(
    token: Annotated[str, Form(description="JWT authentication token")],
    provider: Annotated[str, Form(description="Provider name (openai, anthropic, gemini)")],
    api_key: Annotated[str, Form(description="API key")],
    key_name: Annotated[Optional[str], Form(description="Friendly name for the key")] = None,
    verify_key: Annotated[bool, Form(description="Whether to verify the key before saving")] = True
):
    return await chat_controller.save_user_api_key(
        token=token,
        provider=provider,
        api_key=api_key,
        key_name=key_name,
        verify_key=verify_key
    )

# Available models endpoint
@router.post(
    "/models",
    response_model=AvailableModelsResponse,
    summary="Get available LLM models",
    description="Retrieve list of available models per provider and user's API key status",
    response_description="List of available models and user's key status",
    responses={
        200: {
            "model": AvailableModelsResponse,
            "description": "Successful retrieval of available models"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def get_available_models(
    token: Annotated[str, Form(description="JWT authentication token")]
):
    return await chat_controller.get_available_models(token=token)

# Chat settings endpoint
@router.post(
    "/settings",
    response_model=ChatSettingsResponse,
    summary="Update chat settings",
    description="Update settings for a chat session (title, default model, etc.)",
    response_description="Confirmation of settings update",
    responses={
        200: {
            "model": ChatSettingsResponse,
            "description": "Settings updated successfully"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Chat session not found"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def update_chat_settings(
    token: Annotated[str, Form(description="JWT authentication token")],
    chat_id: Annotated[str, Form(description="Chat session ID to update")],
    title: Annotated[Optional[str], Form(description="New chat title")] = None,
    default_provider: Annotated[Optional[str], Form(description="Default LLM provider")] = None,
    default_model: Annotated[Optional[str], Form(description="Default model name")] = None,
    default_temperature: Annotated[Optional[float], Form(description="Default temperature (0.0-2.0)", ge=0.0, le=2.0)] = None
):
    return await chat_controller.update_chat_settings(
        token=token,
        chat_id=chat_id,
        title=title,
        default_provider=default_provider,
        default_model=default_model,
        default_temperature=default_temperature
    )

# ReAct Agent streaming chat endpoint
@router.post(
    "/chat/react-agent",
    summary="Stream ReAct agent chat response",
    description="Process a chat message using intelligent ReAct agent that explores the codebase systematically",
    response_description="Stream of agent reasoning, actions, observations and final response",
    responses={
        200: {
            "description": "Successful streaming agent response",
            "content": {"application/x-ndjson": {}}
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Repository not found or no graph data available"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def react_agent_chat(
    token: Annotated[str, Form(description="JWT authentication token")],
    message: Annotated[str, Form(description="User's message/question")],
    repository_id: Annotated[str, Form(description="Repository ID to chat about")],
    repository_branch: Annotated[Optional[str], Form(description="Repository branch for more precise matching")] = None,
    chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
    conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
    max_iterations: Annotated[int, Form(description="Maximum agent iterations (1-10)", ge=1, le=10)] = 5
):
    return StreamingResponse(
        chat_controller.process_react_agent_chat(
            token=token,
            message=message,
            repository_id=repository_id,
            repository_branch=repository_branch,
            chat_id=chat_id,
            conversation_id=conversation_id,
            max_iterations=max_iterations
        ),
        media_type="application/x-ndjson"
    )

# Context search endpoint
@router.post(
    "/context/search",
    response_model=ContextSearchResponse,
    summary="Search repository context",
    description="Search repository content for relevant context based on query",
    response_description="Search results from repository content",
    responses={
        200: {
            "model": ContextSearchResponse,
            "description": "Successful context search"
        },
        401: {
            "model": ErrorResponse,
            "description": "Unauthorized - Invalid JWT token"
        },
        404: {
            "model": ErrorResponse,
            "description": "Repository not found"
        },
        500: {
            "model": ErrorResponse,
            "description": "Internal server error"
        }
    }
)
async def search_context(
    token: Annotated[str, Form(description="JWT authentication token")],
    repository_id: Annotated[str, Form(description="Repository ID to search")],
    query: Annotated[str, Form(description="Search query")],
    max_results: Annotated[int, Form(description="Maximum number of results (1-20)", ge=1, le=20)] = 5
):
    return await chat_controller.search_context(
        token=token,
        repository_id=repository_id,
        query=query,
        max_results=max_results
    )