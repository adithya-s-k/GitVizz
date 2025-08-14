from fastapi import APIRouter, Form, Depends
from fastapi.responses import StreamingResponse
from typing import Optional, Annotated
from middleware.auth_middleware import require_auth
from models.user import User
from schemas.chat_schemas import (
    ChatResponse, ConversationHistoryResponse, 
    ChatSessionResponse, ChatSettingsResponse,
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
    current_user: Annotated[User, Depends(require_auth)],
    message: Annotated[str, Form(description="User's message/question")],
    repository_id: Annotated[str, Form(description="Repository ID to chat about")],
    use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
    chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
    conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
    provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini, groq)")] = "openai",
    model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
    temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
    max_tokens: Annotated[Optional[int], Form(description="Maximum tokens for context (1-1000000)", ge=1, le=1000000)] = None,
    include_full_context: Annotated[bool, Form(description="Include full repository content as context")] = False,
    context_search_query: Annotated[Optional[str], Form(description="Specific search query for context retrieval")] = None
):
    return await chat_controller.process_chat_message(
        user=current_user,
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
    current_user: Annotated[User, Depends(require_auth)],
    message: Annotated[str, Form(description="User's message/question")],
    repository_id: Annotated[str, Form(description="Repository ID to chat about")],
    use_user: Annotated[bool, Form(description="Whether to use the user's saved API key")] = False,
    chat_id: Annotated[Optional[str], Form(description="Chat session ID (auto-generated if not provided)")] = None,
    conversation_id: Annotated[Optional[str], Form(description="Conversation thread ID (auto-generated if not provided)")] = None,
    provider: Annotated[str, Form(description="LLM provider (openai, anthropic, gemini, groq)")] = "openai",
    model: Annotated[str, Form(description="Model name")] = "gpt-3.5-turbo",
    temperature: Annotated[float, Form(description="Response randomness (0.0-2.0)", ge=0.0, le=2.0)] = 0.7,
    max_tokens: Annotated[Optional[int], Form(description="Maximum tokens for context (1-1000000)", ge=1, le=1000000)] = None,
    context_mode: Annotated[str, Form(description="Context mode: full, smart, or agentic")] = "smart",
    repository_branch: Annotated[Optional[str], Form(description="Repository branch for more precise matching")] = None
):
    print(f"repo identifier: {repository_id}")
    print(f"use user: {use_user}")
    print(f"chat id: {chat_id}")
    print(f"conversation id: {conversation_id}")
    print(f"provider: {provider}")
    print(f"model: {model}")
    print(f"temperature: {temperature}")
    print(f"max tokens: {max_tokens}")
    print(f"context mode: {context_mode}")
    return StreamingResponse(
        chat_controller.process_streaming_chat(
            user=current_user,
            message=message,
            repository_id=repository_id,
            use_user=use_user,
            chat_id=chat_id,
            conversation_id=conversation_id,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            context_mode=context_mode,
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
    current_user: Annotated[User, Depends(require_auth)]
):
    return await chat_controller.get_conversation_history(
        user=current_user,
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
    current_user: Annotated[User, Depends(require_auth)],
    repository_identifier: Annotated[str, Form(description="Repository identifier in format owner/repo/branch")]
):
    return await chat_controller.list_user_chat_sessions(user=current_user, repository_identifier=repository_identifier)

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
    current_user: Annotated[User, Depends(require_auth)]
):
    return await chat_controller.get_chat_session(
        user=current_user,
        chat_id=chat_id
    )


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
    current_user: Annotated[User, Depends(require_auth)],
    chat_id: Annotated[str, Form(description="Chat session ID to update")],
    title: Annotated[Optional[str], Form(description="New chat title")] = None,
    default_provider: Annotated[Optional[str], Form(description="Default LLM provider")] = None,
    default_model: Annotated[Optional[str], Form(description="Default model name")] = None,
    default_temperature: Annotated[Optional[float], Form(description="Default temperature (0.0-2.0)", ge=0.0, le=2.0)] = None
):
    return await chat_controller.update_chat_settings(
        user=current_user,
        chat_id=chat_id,
        title=title,
        default_provider=default_provider,
        default_model=default_model,
        default_temperature=default_temperature
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
    current_user: Annotated[User, Depends(require_auth)],
    repository_id: Annotated[str, Form(description="Repository ID to search")],
    query: Annotated[str, Form(description="Search query")],
    max_results: Annotated[int, Form(description="Maximum number of results (1-20)", ge=1, le=20)] = 5
):
    return await chat_controller.search_context(
        user=current_user,
        repository_id=repository_id,
        query=query,
        max_results=max_results
    )