"""
Minimal LLM Service - Thin wrapper around LiteLLM
Handles API key management, model selection, and basic LLM operations
"""

import os
import json
from typing import Optional, Dict, List, Any, AsyncGenerator, Union
from cryptography.fernet import Fernet
from datetime import datetime, timezone
from pydantic import BaseModel


# Model Configuration Schema
class ModelConfig(BaseModel):
    """Configuration for a specific model"""
    max_tokens: int
    max_output_tokens: int
    cost_per_1M_input: float
    cost_per_1M_output: float
    cost_per_1M_cached_input: Optional[float] = None
    supports_function_calling: bool
    supports_vision: bool
    knowledge_cutoff: str
    is_reasoning_model: bool

# Response Models
class LLMResponse(BaseModel):
    """Standard response for LLM calls"""
    success: bool
    content: Optional[str] = None
    structured_data: Optional[Dict[str, Any]] = None
    function_calls: Optional[List[Dict[str, Any]]] = None
    usage: Optional[Dict[str, Any]] = None
    model: str
    provider: str
    error: Optional[str] = None


class LLMStreamResponse(BaseModel):
    """Streaming response for LLM calls"""
    type: str  # token, complete, error, function_call
    content: Optional[str] = None
    function_call: Optional[Dict[str, Any]] = None
    structured_data: Optional[Dict[str, Any]] = None
    usage: Optional[Dict[str, Any]] = None
    model: str
    provider: str
    error: Optional[str] = None


class LLMService:
    """Minimal LLM Service - Thin wrapper around LiteLLM"""
    
    def __init__(self):
        # API key encryption
        self.encryption_key = os.getenv("ENCRYPTION_KEY", Fernet.generate_key())
        self.cipher_suite = Fernet(self.encryption_key)
        
        # Default API keys from environment
        self.default_keys = {
            "openai": os.getenv("OPENAI_API_KEY"),
            "anthropic": os.getenv("ANTHROPIC_API_KEY"), 
            "gemini": os.getenv("GEMINI_API_KEY"),
            "groq": os.getenv("GROQ_API_KEY"),
        }
        
        # Comprehensive model configurations
        self.model_configs = {
            "openai": {
                "gpt-5": ModelConfig(
                    max_tokens=272000,
                    max_output_tokens=128000,
                    cost_per_1M_input=1.25,
                    cost_per_1M_output=10.00,
                    cost_per_1M_cached_input=0.125,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-10-24",
                    is_reasoning_model=True,
                ),
                "gpt-5-mini": ModelConfig(
                    max_tokens=272000,
                    max_output_tokens=128000,
                    cost_per_1M_input=0.25,
                    cost_per_1M_output=2.00,
                    cost_per_1M_cached_input=0.025,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-06-24",
                    is_reasoning_model=True,
                ),
                "gpt-5-nano": ModelConfig(
                    max_tokens=400000,
                    max_output_tokens=128000,
                    cost_per_1M_input=0.05,
                    cost_per_1M_output=0.40,
                    cost_per_1M_cached_input=0.005,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-05-31",
                    is_reasoning_model=True,
                ),
                "gpt-5-chat": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=16384,
                    cost_per_1M_input=1.25,
                    cost_per_1M_output=10.00,
                    cost_per_1M_cached_input=0.125,
                    supports_function_calling=False,
                    supports_vision=False,
                    knowledge_cutoff="2024-10-24",
                    is_reasoning_model=True,
                ),
                "gpt-4.1": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=4096,
                    cost_per_1M_input=1.00,
                    cost_per_1M_output=4.00,
                    supports_function_calling=True,
                    supports_vision=False,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "gpt-4.1-mini": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=4096,
                    cost_per_1M_input=0.20,
                    cost_per_1M_output=0.80,
                    supports_function_calling=True,
                    supports_vision=False,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "gpt-4.1-nano": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=4096,
                    cost_per_1M_input=0.05,
                    cost_per_1M_output=0.20,
                    supports_function_calling=True,
                    supports_vision=False,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "o4-mini": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=32000,
                    cost_per_1M_input=0.55,
                    cost_per_1M_output=2.20,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-10",
                    is_reasoning_model=True,
                ),
                "o3-mini": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=32000,
                    cost_per_1M_input=0.55,
                    cost_per_1M_output=2.20,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-10",
                    is_reasoning_model=True,
                ),
                "o3": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=32000,
                    cost_per_1M_input=1.00,
                    cost_per_1M_output=4.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-10",
                    is_reasoning_model=True,
                ),
                "gpt-4o-mini": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=16384,
                    cost_per_1M_input=0.075,
                    cost_per_1M_output=0.30,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2023-10",
                    is_reasoning_model=False,
                ),
                "gpt-4o-mini-2024-07-18": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=16384,
                    cost_per_1M_input=0.075,
                    cost_per_1M_output=0.30,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2023-10",
                    is_reasoning_model=False,
                ),
                "gpt-4o": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=16384,
                    cost_per_1M_input=1.25,
                    cost_per_1M_output=5.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2023-10",
                    is_reasoning_model=False,
                ),
                "gpt-4-turbo": ModelConfig(
                    max_tokens=128000,
                    max_output_tokens=4096,
                    cost_per_1M_input=5.00,
                    cost_per_1M_output=15.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2023-04",
                    is_reasoning_model=False,
                ),
            },
            "anthropic": {
                "claude-4": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=32000,
                    cost_per_1M_input=3.00,
                    cost_per_1M_output=15.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-03",
                    is_reasoning_model=False,
                ),
                "claude-opus-4-20250514": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=32000,
                    cost_per_1M_input=15.00,
                    cost_per_1M_output=75.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-03",
                    is_reasoning_model=False,
                ),
                "claude-sonnet-4-20250514": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=64000,
                    cost_per_1M_input=3.00,
                    cost_per_1M_output=15.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-03",
                    is_reasoning_model=False,
                ),
                "claude-3.7": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=128000,
                    cost_per_1M_input=3.00,
                    cost_per_1M_output=15.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-02",
                    is_reasoning_model=True,
                ),
                # "claude-3.5": ModelConfig(
                #     max_tokens=200000,
                #     max_output_tokens=8192,
                #     cost_per_1M_input=3.00,
                #     cost_per_1M_output=15.00,
                #     supports_function_calling=True,
                #     supports_vision=True,
                #     knowledge_cutoff="2024-04",
                #     is_reasoning_model=False,
                # ),  
                "claude-3-5-sonnet-20241022": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=8192,
                    cost_per_1M_input=3.00,
                    cost_per_1M_output=15.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "claude-3-5-haiku-20241022": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=8192,
                    cost_per_1M_input=1.00,
                    cost_per_1M_output=5.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-07",
                    is_reasoning_model=False,
                ),
                "claude-3-opus-20240229": ModelConfig(
                    max_tokens=200000,
                    max_output_tokens=4096,
                    cost_per_1M_input=15.00,
                    cost_per_1M_output=75.00,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2023-08",
                    is_reasoning_model=False,
                ),
            },
            "gemini": {
                "gemini-2.5-pro": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.30,
                    cost_per_1M_output=2.50,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-01",
                    is_reasoning_model=True,
                ),
                "gemini-2.5-flash": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.30,
                    cost_per_1M_output=2.50,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-01",
                    is_reasoning_model=True,
                ),
                "gemini-2.5-flash-lite": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.10,
                    cost_per_1M_output=0.40,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-01",
                    is_reasoning_model=False,
                ),
                "gemini-2.0-flash": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.10,
                    cost_per_1M_output=0.40,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-06",
                    is_reasoning_model=False,
                ),
                "gemini-2.0-flash-exp": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.10,
                    cost_per_1M_output=0.40,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-06",
                    is_reasoning_model=False,
                ),
                "gemini-2.0-flash-lite": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=65536,
                    cost_per_1M_input=0.10,
                    cost_per_1M_output=0.40,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-06",
                    is_reasoning_model=False,
                ),
                "gemini-1.5-pro": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=8192,
                    cost_per_1M_input=3.50,
                    cost_per_1M_output=10.50,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "gemini-1.5-flash": ModelConfig(
                    max_tokens=1000000,
                    max_output_tokens=8192,
                    cost_per_1M_input=0.075,
                    cost_per_1M_output=0.30,
                    supports_function_calling=True,
                    supports_vision=True,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
            },
            "groq": {
                "llama-3.3-70b-versatile": ModelConfig(
                    max_tokens=32768,
                    max_output_tokens=8192,
                    cost_per_1M_input=0.59,
                    cost_per_1M_output=0.79,
                    supports_function_calling=True,
                    supports_vision=False,
                    knowledge_cutoff="2024-12",
                    is_reasoning_model=False,
                ),
                "llama-3.1-8b-instant": ModelConfig(
                    max_tokens=131072,
                    max_output_tokens=8192,
                    cost_per_1M_input=0.05,
                    cost_per_1M_output=0.08,
                    supports_function_calling=True,
                    supports_vision=False,
                    knowledge_cutoff="2024-07",
                    is_reasoning_model=False,
                ),
                "llama3-70b-8192": ModelConfig(
                    max_tokens=8192,
                    max_output_tokens=8192,
                    cost_per_1M_input=0.59,
                    cost_per_1M_output=0.79,
                    supports_function_calling=False,
                    supports_vision=False,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
                "llama3-8b-8192": ModelConfig(
                    max_tokens=8192,
                    max_output_tokens=8192,
                    cost_per_1M_input=0.05,
                    cost_per_1M_output=0.08,
                    supports_function_calling=False,
                    supports_vision=False,
                    knowledge_cutoff="2024-04",
                    is_reasoning_model=False,
                ),
            },
        }
        
        # Model to provider mapping - automatically detect provider from model name
        self.model_to_provider = {}
        for provider, models in self.model_configs.items():
            for model_name in models.keys():
                self.model_to_provider[model_name] = provider
        
        # Model mapping for LiteLLM
        self.model_mapping = {
            "openai": lambda model: model,
            "anthropic": lambda model: model,  # Anthropic models use exact names
            "gemini": lambda model: f"gemini/{model}" if not model.startswith("gemini/") else model,
            "groq": lambda model: f"groq/{model}" if not model.startswith("groq/") else model,
        }
    
    def get_litellm(self):
        """Lazy import LiteLLM"""
        try:
            import litellm
            return litellm
        except ImportError:
            raise ImportError("LiteLLM is required. Install with: pip install litellm")
    
    # API Key Management
    def encrypt_api_key(self, api_key: str) -> str:
        """Encrypt API key for secure storage"""
        return self.cipher_suite.encrypt(api_key.encode()).decode()
    
    def decrypt_api_key(self, encrypted_key: str) -> str:
        """Decrypt API key for usage"""
        return self.cipher_suite.decrypt(encrypted_key.encode()).decode()
    
    async def save_user_api_key(self, user, provider: str, api_key: str, verify: bool = True):
        """Save encrypted user API key with verification"""
        if verify and not self.verify_api_key(provider, api_key):
            raise ValueError(f"Invalid API key for {provider}")
        
        from models.chat import UserApiKey
        from beanie import BeanieObjectId
        
        encrypted_key = self.encrypt_api_key(api_key)
        
        # Update or create user API key
        existing_key = await UserApiKey.find_one(
            UserApiKey.user.id == BeanieObjectId(user.id),
            UserApiKey.provider == provider,
            UserApiKey.is_active == True
        )
        
        if existing_key:
            existing_key.encrypted_key = encrypted_key
            existing_key.updated_at = datetime.now(timezone.utc)
            await existing_key.save()
            return existing_key
        else:
            new_key = UserApiKey(
                user=user,
                provider=provider,
                encrypted_key=encrypted_key
            )
            await new_key.save()
            return new_key
    
    async def get_user_api_key(self, user, provider: str) -> Optional[str]:
        """Get decrypted user API key"""
        from models.chat import UserApiKey
        from beanie import BeanieObjectId
        
        user_key = await UserApiKey.find_one(
            UserApiKey.user.id == BeanieObjectId(user.id),
            UserApiKey.provider == provider,
            UserApiKey.is_active == True
        )
        
        if user_key:
            try:
                return self.decrypt_api_key(user_key.encrypted_key)
            except:
                return None
        return None
    
    async def get_api_key(self, provider: str, user=None, use_user_key: bool = False) -> str:
        """Get API key for request (user's or system)"""
        if use_user_key and user:
            user_key = await self.get_user_api_key(user, provider)
            if user_key:
                return user_key
            raise ValueError(f"No user API key found for {provider}")
        
        system_key = self.default_keys.get(provider)
        if not system_key:
            raise ValueError(f"No system API key configured for {provider}")
        
        return system_key
    
    def verify_api_key(self, provider: str, api_key: str) -> bool:
        """Verify API key is valid"""
        try:
            from utils.api_key_verifier import api_key_verifier
            return api_key_verifier.verify_api_key(provider, api_key)
        except:
            return False
    
    def detect_provider_from_model(self, model: str) -> str:
        """Automatically detect provider from model name"""
        # Check direct mapping first
        if model in self.model_to_provider:
            return self.model_to_provider[model]
        
        # Fallback: detect from model name patterns
        if model.startswith(("gpt-", "o1-", "o3-", "o4-")):
            return "openai"
        elif model.startswith("claude-") or "claude" in model.lower():
            return "anthropic"  
        elif model.startswith("gemini-") or "gemini" in model.lower():
            return "gemini"
        elif any(pattern in model.lower() for pattern in ["llama", "mixtral", "groq"]):
            return "groq"
        
        # Default fallback
        return "openai"
    
    def get_model_name(self, provider: str, model: str) -> str:
        """Get LiteLLM-compatible model name"""
        mapper = self.model_mapping.get(provider, lambda x: x)
        return mapper(model)
    
    # Core LLM Operations
    async def generate(
        self,
        messages: List[Dict[str, str]],
        model: str = "gpt-4o-mini", 
        provider: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        functions: Optional[List[Dict]] = None,
        function_call: Optional[str] = None,
        response_format: Optional[Dict] = None,
        user=None,
        use_user_key: bool = False,
        api_key: Optional[str] = None
    ) -> Union[LLMResponse, AsyncGenerator[LLMStreamResponse, None]]:
        """
        Main LLM generation method
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model name (provider auto-detected from model)
            provider: Optional provider override (openai, anthropic, gemini, groq)  
            system_prompt: Optional system prompt to prepend
            temperature: Response randomness (0.0-2.0)
            max_tokens: Maximum tokens to generate
            stream: Whether to stream response
            functions: Function schemas for function calling
            function_call: Function calling mode
            response_format: Structured output format
            user: User object for API key lookup
            use_user_key: Whether to use user's API key
            api_key: Direct API key to use (bypasses user/system key lookup)
            
        Returns:
            LLMResponse or AsyncGenerator of LLMStreamResponse
        """
        try:
            # Auto-detect provider if not specified
            if not provider:
                provider = self.detect_provider_from_model(model)
            
            # Get API key - use provided key or fallback to get_api_key
            if not api_key:
                api_key = await self.get_api_key(provider, user, use_user_key)
            
            # Prepare messages
            llm_messages = messages.copy()
            if system_prompt:
                llm_messages.insert(0, {"role": "system", "content": system_prompt})
            
            # Get LiteLLM model name
            model_name = self.get_model_name(provider, model)
            
            # Prepare LiteLLM kwargs
            kwargs = {
                "model": model_name,
                "messages": llm_messages,
                "api_key": api_key,
                "stream": stream
            }
            
            # Only add temperature for non-reasoning models
            if not self._is_openai_reasoning_model(provider, model):
                kwargs["temperature"] = temperature
            
            if max_tokens:
                # Use max_completion_tokens for OpenAI reasoning models (o1, o3, etc.)
                if self._is_openai_reasoning_model(provider, model):
                    kwargs["max_completion_tokens"] = max_tokens
                else:
                    kwargs["max_tokens"] = max_tokens
            if functions:
                # Convert functions to tools format for LiteLLM
                kwargs["tools"] = functions
            if function_call:
                kwargs["tool_choice"] = function_call
            if response_format:
                kwargs["response_format"] = response_format
            
            litellm = self.get_litellm()
            
            if stream:
                return self._stream_generate(litellm, kwargs, provider, model)
            else:
                return await self._generate(litellm, kwargs, provider, model)
                
        except Exception as e:
            if stream:
                return self._error_stream(str(e), provider, model)
            return LLMResponse(
                success=False,
                error=str(e),
                model=model,
                provider=provider
            )
    
    async def _generate(self, litellm, kwargs, provider: str, model: str) -> LLMResponse:
        """Non-streaming generation"""
        response = await litellm.acompletion(**kwargs)
        
        choice = response.choices[0]
        message = choice.message
        
        # Extract content
        content = getattr(message, 'content', None)
        
        # Extract function calls (tool calls)
        function_calls = None
        if hasattr(message, 'tool_calls') and message.tool_calls:
            function_calls = [{
                "name": call.function.name,
                "arguments": call.function.arguments,
                "id": getattr(call, 'id', None)
            } for call in message.tool_calls]
        elif hasattr(message, 'function_call') and message.function_call:
            # Legacy function_call support
            function_calls = [{
                "name": message.function_call.name,
                "arguments": message.function_call.arguments
            }]
        
        # Extract structured data
        structured_data = None
        if content and kwargs.get("response_format"):
            try:
                structured_data = json.loads(content)
            except json.JSONDecodeError:
                pass
        
        # Extract usage
        usage = None
        if hasattr(response, 'usage'):
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }
        
        return LLMResponse(
            success=True,
            content=content,
            structured_data=structured_data,
            function_calls=function_calls,
            usage=usage,
            model=model,
            provider=provider
        )
    
    async def _stream_generate(self, litellm, kwargs, provider: str, model: str) -> AsyncGenerator[LLMStreamResponse, None]:
        """Streaming generation"""
        response = await litellm.acompletion(**kwargs)
        accumulated_content = ""
        
        async for chunk in response:
            delta = chunk.choices[0].delta
            
            # Handle content tokens
            if hasattr(delta, 'content') and delta.content:
                accumulated_content += delta.content
                yield LLMStreamResponse(
                    type="token",
                    content=delta.content,
                    model=model,
                    provider=provider
                )
            
            # Handle function calls
            if hasattr(delta, 'function_call') and delta.function_call:
                yield LLMStreamResponse(
                    type="function_call",
                    function_call={
                        "name": delta.function_call.name,
                        "arguments": delta.function_call.arguments
                    },
                    model=model,
                    provider=provider
                )
            
            # Handle tool calls
            if hasattr(delta, 'tool_calls') and delta.tool_calls:
                for tool_call in delta.tool_calls:
                    yield LLMStreamResponse(
                        type="function_call",
                        function_call={
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments,
                            "id": tool_call.id
                        },
                        model=model,
                        provider=provider
                    )
        
        # Handle structured output
        structured_data = None
        if accumulated_content and kwargs.get("response_format"):
            try:
                structured_data = json.loads(accumulated_content)
            except json.JSONDecodeError:
                pass
        
        # Final completion
        yield LLMStreamResponse(
            type="complete",
            content=accumulated_content,
            structured_data=structured_data,
            model=model,
            provider=provider
        )
    
    async def _error_stream(self, error: str, provider: str, model: str) -> AsyncGenerator[LLMStreamResponse, None]:
        """Error response for streaming"""
        yield LLMStreamResponse(
            type="error",
            error=error,
            model=model,
            provider=provider
        )
    
    # Convenience methods
    async def chat(self, message: str, **kwargs) -> LLMResponse:
        """Simple chat method"""
        messages = [{"role": "user", "content": message}]
        return await self.generate(messages, **kwargs)
    
    async def complete(self, prompt: str, **kwargs) -> LLMResponse:
        """Simple completion method"""
        messages = [{"role": "user", "content": prompt}]
        return await self.generate(messages, **kwargs)
    
    def get_available_models(self) -> Dict[str, List[str]]:
        """Get available models per provider"""
        return {
            provider: list(models.keys())
            for provider, models in self.model_configs.items()
        }
    
    def get_model_config(self, provider: str, model: str) -> Optional[ModelConfig]:
        """Get configuration for a specific model"""
        return self.model_configs.get(provider, {}).get(model)
    
    def get_max_context_length(self, provider: str, model: str) -> int:
        """Get maximum context length for a model"""
        config = self.get_model_config(provider, model)
        return config.max_tokens if config else 0
    
    def get_max_output_tokens(self, provider: str, model: str) -> int:
        """Get maximum output tokens for a model"""
        config = self.get_model_config(provider, model)
        return config.max_output_tokens if config else 0
    
    def supports_function_calling(self, provider: str, model: str) -> bool:
        """Check if model supports function calling"""
        config = self.get_model_config(provider, model)
        return config.supports_function_calling if config else False
    
    def supports_vision(self, provider: str, model: str) -> bool:
        """Check if model supports vision/images"""
        config = self.get_model_config(provider, model)
        return config.supports_vision if config else False
    
    def is_reasoning_model(self, provider: str, model: str) -> bool:
        """Check if model is a reasoning model (like o1)"""
        config = self.get_model_config(provider, model)
        return config.is_reasoning_model if config else False
    
    def _is_openai_reasoning_model(self, provider: str, model: str) -> bool:
        """Check if model is an OpenAI reasoning model that requires special parameter handling"""
        return (provider == "openai" and 
                any(pattern in model.lower() for pattern in ["o1-", "o3-", "o4-", "gpt-5"]))
    
    def get_cost_per_million_tokens(self, provider: str, model: str) -> Dict[str, float]:
        """Get cost per million tokens for input and output"""
        config = self.get_model_config(provider, model)
        if not config:
            return {"input": 0.0, "output": 0.0}
        
        cost_info = {
            "input": config.cost_per_1M_input,
            "output": config.cost_per_1M_output
        }
        
        if config.cost_per_1M_cached_input:
            cost_info["cached_input"] = config.cost_per_1M_cached_input
            
        return cost_info
    
    def get_models_with_feature(self, feature: str) -> Dict[str, List[str]]:
        """Get models that support a specific feature (function_calling, vision, reasoning)"""
        result = {}
        
        for provider, models in self.model_configs.items():
            matching_models = []
            for model_name, config in models.items():
                if feature == "function_calling" and config.supports_function_calling:
                    matching_models.append(model_name)
                elif feature == "vision" and config.supports_vision:
                    matching_models.append(model_name)
                elif feature == "reasoning" and config.is_reasoning_model:
                    matching_models.append(model_name)
            
            if matching_models:
                result[provider] = matching_models
                
        return result
    
    def get_valid_models_for_provider(self, provider: str, api_key: str = None) -> List[str]:
        """Get valid models for a provider (used by chat controller)"""
        return list(self.model_configs.get(provider, {}).keys())


# Global instance
llm_service = LLMService()