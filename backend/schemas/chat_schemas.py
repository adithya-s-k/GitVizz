# chat_schemas.py
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any, Union, Literal
from datetime import datetime
from enum import Enum


class StreamEventType(str, Enum):
    """Enumeration for streaming event types"""
    TOKEN = "token"
    COMPLETE = "complete"
    ERROR = "error"
    AGENT_THINKING = "agent_thinking"
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_PROGRESS = "tool_call_progress"
    TOOL_CALL_RESULT = "tool_call_result"


class ModelProvider(str, Enum):
    """Supported LLM providers"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


# Base Models
class BaseResponse(BaseModel):
    """Base response model with common fields"""
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    error_type: Optional[str] = None


class TokenUsage(BaseModel):
    """Token usage information"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class DailyUsage(BaseModel):
    """Daily usage tracking"""
    requests_used: int
    requests_limit: int  # -1 for unlimited
    reset_date: str


# Message Models
class MessageResponse(BaseModel):
    """Response model for individual messages"""
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime
    context_used: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# Streaming Models
class StreamChatResponse(BaseModel):
    """Response model for streaming chat events"""
    event: StreamEventType = Field(..., description="Type of streaming event")
    token: Optional[str] = Field(None, description="Token content for 'token' events")
    error: Optional[str] = Field(None, description="Error message for 'error' events")
    error_type: Optional[str] = Field(None, description="Type of error for 'error' events")
    usage: Optional[TokenUsage] = Field(None, description="Token usage for 'complete' events")
    provider: Optional[ModelProvider] = Field(None, description="Provider name for all events")
    model: Optional[str] = Field(None, description="Model name for all events")
    chat_id: Optional[str] = Field(None, description="Chat session ID")
    conversation_id: Optional[str] = Field(None, description="Conversation thread ID")
    context_metadata: Optional[Dict[str, Any]] = Field(None, description="Smart context selection metadata")
    
    # Agentic features
    content: Optional[str] = Field(None, description="General content for thinking/progress events")
    tool_name: Optional[str] = Field(None, description="Name of tool being called")
    tool_result: Optional[Dict[str, Any]] = Field(None, description="Result from tool execution")


# Chat Request Models
class ChatRequest(BaseModel):
    """Request model for chat messages"""
    token: str = Field(..., description="JWT authentication token")
    message: str = Field(..., description="User's message/question")
    repository_id: str = Field(..., description="Repository ID to chat about")
    chat_id: Optional[str] = Field(None, description="Chat session ID (auto-generated if not provided)")
    conversation_id: Optional[str] = Field(None, description="Conversation thread ID (auto-generated if not provided)")
    
    # Model settings
    provider: ModelProvider = Field(ModelProvider.OPENAI, description="LLM provider")
    model: str = Field("gpt-3.5-turbo", description="Model name")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Response randomness")
    max_tokens: Optional[int] = Field(None, ge=1, le=4000, description="Maximum tokens in response")
    
    # Context settings
    include_full_context: bool = Field(False, description="Include full repository content as context")
    context_search_query: Optional[str] = Field(None, description="Specific search query for context retrieval")
    scope_preference: str = Field("moderate", description="Context scope preference: focused, moderate, or comprehensive")

    @validator('provider', pre=True)
    def validate_provider(cls, v):
        if isinstance(v, str):
            valid_providers = ["openai", "anthropic", "gemini"]
            if v not in valid_providers:
                raise ValueError(f"Invalid provider. Valid providers: {', '.join(valid_providers)}")
        return v


# Chat Response Models
class ChatResponse(BaseResponse):
    """Response model for non-streaming chat interactions"""
    # Chat identifiers
    chat_id: str
    conversation_id: str
    
    # Response content
    ai_response: Optional[str] = None
    context_used: Optional[str] = None
    
    # Context metadata
    context_metadata: Optional[Dict[str, Any]] = Field(None, description="Smart context selection metadata")
    
    # Metadata
    usage: Optional[TokenUsage] = None
    model_used: Optional[str] = None
    provider: Optional[ModelProvider] = None
    response_time: Optional[float] = Field(None, description="Response time in seconds")


# Conversation Models
class ConversationHistoryRequest(BaseModel):
    """Request model for conversation history"""
    token: str = Field(..., description="JWT authentication token")
    conversation_id: str = Field(..., description="Conversation ID to retrieve")


class ConversationHistoryResponse(BaseModel):
    """Response model for conversation history"""
    chat_id: str
    conversation_id: str
    title: Optional[str] = None
    messages: List[MessageResponse]
    created_at: datetime
    updated_at: datetime
    total_tokens_used: int = 0
    model_provider: ModelProvider
    model_name: str

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# Chat Session Models
class ChatSessionRequest(BaseModel):
    """Request model for chat session retrieval"""
    token: str = Field(..., description="JWT authentication token")
    chat_id: str = Field(..., description="Chat session ID to retrieve")


class ChatSessionResponse(BaseModel):
    """Response model for chat session information"""
    chat_id: str
    title: Optional[str] = None
    repository_name: str
    repository_id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = True
    
    # Default settings
    default_model_provider: ModelProvider = ModelProvider.OPENAI
    default_model_name: str = "gpt-3.5-turbo"
    default_temperature: float = Field(0.7, ge=0.0, le=2.0)
    use_own_key: bool = False
    
    # Rate limiting
    daily_requests_count: int = 0
    daily_limit: int = 50
    
    # Recent conversations
    recent_conversations: List[ConversationHistoryResponse] = []

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# API Key Models
class ApiKeyRequest(BaseModel):
    """Request model for saving API keys"""
    token: str = Field(..., description="JWT authentication token")
    provider: ModelProvider = Field(..., description="Provider name")
    api_key: str = Field(..., description="API key")
    key_name: Optional[str] = Field(None, description="Friendly name for the key")

    @validator('provider', pre=True)
    def validate_provider(cls, v):
        if isinstance(v, str):
            valid_providers = ["openai", "anthropic", "gemini"]
            if v not in valid_providers:
                raise ValueError(f"Invalid provider. Valid providers: {', '.join(valid_providers)}")
        return v


class ApiKeyResponse(BaseResponse):
    """Response model for API key operations"""
    provider: ModelProvider
    key_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# Available Models Models
class AvailableModelsRequest(BaseModel):
    """Request model for available models"""
    token: str = Field(..., description="JWT authentication token")


class AvailableModelsResponse(BaseModel):
    """Response model for available models"""
    providers: Dict[str, List[str]]
    current_limits: Dict[str, int]
    user_has_keys: List[str]  # Providers for which user has their own keys


# Chat Settings Models
class ChatSettingsRequest(BaseModel):
    """Request model for updating chat settings"""
    token: str = Field(..., description="JWT authentication token")
    chat_id: str = Field(..., description="Chat session ID to update")
    title: Optional[str] = Field(None, description="New chat title")
    default_provider: Optional[ModelProvider] = Field(None, description="Default LLM provider")
    default_model: Optional[str] = Field(None, description="Default model name")
    default_temperature: Optional[float] = Field(None, ge=0.0, le=2.0, description="Default temperature")

    @validator('default_provider', pre=True)
    def validate_provider(cls, v):
        if v is not None and isinstance(v, str):
            valid_providers = ["openai", "anthropic", "gemini"]
            if v not in valid_providers:
                raise ValueError(f"Invalid provider. Valid providers: {', '.join(valid_providers)}")
        return v


class ChatSettingsResponse(BaseResponse):
    """Response model for chat settings"""
    settings: Optional[Dict[str, Any]] = None


# Context Search Models
class ContextSearchRequest(BaseModel):
    """Request model for context search"""
    token: str = Field(..., description="JWT authentication token")
    repository_id: str = Field(..., description="Repository ID to search")
    query: str = Field(..., description="Search query")
    max_results: int = Field(5, ge=1, le=20, description="Maximum number of results")


class ContextSearchResult(BaseModel):
    """Individual search result"""
    line_number: int
    content: str
    context: str


class ContextSearchResponse(BaseResponse):
    """Response model for context search"""
    results: List[ContextSearchResult] = []
    total_found: int = 0
    query_used: str


# Streaming Request Models
class StreamingChatRequest(BaseModel):
    """Request model for streaming chat messages"""
    token: str = Field(..., description="JWT authentication token")
    message: str = Field(..., description="User's message/question")
    repository_id: str = Field(..., description="Repository ID to chat about")
    chat_id: Optional[str] = Field(None, description="Chat session ID (auto-generated if not provided)")
    conversation_id: Optional[str] = Field(None, description="Conversation thread ID (auto-generated if not provided)")
    
    # Model settings
    provider: ModelProvider = Field(ModelProvider.OPENAI, description="LLM provider")
    model: str = Field("gpt-3.5-turbo", description="Model name")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Response randomness")
    max_tokens: Optional[int] = Field(None, ge=1, le=4000, description="Maximum tokens in response")
    
    # Context settings
    include_full_context: bool = Field(False, description="Include full repository content as context")
    context_search_query: Optional[str] = Field(None, description="Specific search query for context retrieval")
    scope_preference: str = Field("moderate", description="Context scope preference: focused, moderate, or comprehensive")

    @validator('provider', pre=True)
    def validate_provider(cls, v):
        if isinstance(v, str):
            valid_providers = ["openai", "anthropic", "gemini"]
            if v not in valid_providers:
                raise ValueError(f"Invalid provider. Valid providers: {', '.join(valid_providers)}")
        return v


# Union Types for Response Handling
ChatResponseType = Union[ChatResponse, StreamChatResponse]

# Form Data Models (for FastAPI Form handling)
class ChatFormData(BaseModel):
    """Form data model for chat endpoints"""
    token: str
    message: str
    repository_id: str
    chat_id: Optional[str] = None
    conversation_id: Optional[str] = None
    provider: str = "openai"
    model: str = "gpt-3.5-turbo"
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    include_full_context: bool = False
    context_search_query: Optional[str] = None
    scope_preference: str = "moderate"


class StreamingChatFormData(BaseModel):
    """Form data model for streaming chat endpoints"""
    token: str
    message: str
    repository_id: str
    chat_id: Optional[str] = None
    conversation_id: Optional[str] = None
    provider: str = "openai"
    model: str = "gpt-3.5-turbo"
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    include_full_context: bool = False
    context_search_query: Optional[str] = None
    scope_preference: str = "moderate"


class ConversationHistoryFormData(BaseModel):
    """Form data model for conversation history endpoints"""
    token: str
    conversation_id: str


class ChatSessionFormData(BaseModel):
    """Form data model for chat session endpoints"""
    token: str
    chat_id: str


class ApiKeyFormData(BaseModel):
    """Form data model for API key endpoints"""
    token: str
    provider: str
    api_key: str
    key_name: Optional[str] = None


class AvailableModelsFormData(BaseModel):
    """Form data model for available models endpoints"""
    token: str


class ChatSettingsFormData(BaseModel):
    """Form data model for chat settings endpoints"""
    token: str
    chat_id: str
    title: Optional[str] = None
    default_provider: Optional[str] = None
    default_model: Optional[str] = None
    default_temperature: Optional[float] = None


class ContextSearchFormData(BaseModel):
    """Form data model for context search endpoints"""
    token: str
    repository_id: str
    query: str
    max_results: int = 5


# Validation Models
class ChatValidationError(BaseModel):
    """Validation error model for chat operations"""
    field: str
    message: str
    code: str


class ChatValidationResponse(BaseResponse):
    """Response model for validation errors"""
    validation_errors: List[ChatValidationError] = []


# Health Check Models
class HealthCheckResponse(BaseModel):
    """Health check response model"""
    status: str
    timestamp: datetime
    version: str
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
        
class ChatSessionListItem(BaseModel):
    """Basic chat session info for listing"""
    chat_id: str
    conversation_id: str
    title: str

class ChatSessionListResponse(BaseModel):
    """Response for listing chat sessions"""
    success: bool
    sessions: List[ChatSessionListItem]