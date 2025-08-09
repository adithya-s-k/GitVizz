import os
from typing import Optional, Dict, List, Any, Tuple, AsyncGenerator, Union
from cryptography.fernet import Fernet
from datetime import datetime
from models.chat import UserApiKey, ChatSession
from models.user import User
from beanie import BeanieObjectId
import asyncio
import httpx
import json

# Lazy import LiteLLM to avoid Pydantic compatibility issues
_litellm = None
_litellm_import_error = None

def get_litellm():
    """Lazy import of LiteLLM with error handling"""
    global _litellm, _litellm_import_error
    
    if _litellm is not None:
        return _litellm
    
    if _litellm_import_error is not None:
        raise _litellm_import_error
    
    try:
        import litellm
        _litellm = litellm
        return _litellm
    except Exception as e:
        _litellm_import_error = e
        raise e


class LLMService:
    """Service for handling LLM operations with multiple providers"""

    def __init__(self):
        self.encryption_key = os.getenv("ENCRYPTION_KEY", Fernet.generate_key())
        self.cipher_suite = Fernet(self.encryption_key)

        # Default API keys from environment
        self.default_keys = {
            "openai": os.getenv("OPENAI_API_KEY"),
            "anthropic": os.getenv("ANTHROPIC_API_KEY"),
            "gemini": os.getenv("GEMINI_API_KEY"),
        }

        # Daily limits for users without their own keys
        self.daily_limits = {
            "free": 10,  # Free tier users
            "premium": 50,  # Premium users
            "unlimited": -1,  # Users with their own keys
        }

        # Provider to model mapping for verification
        self.provider_models = {
            "openai": ["gpt-3.5-turbo", "gpt-4", "gpt-4o-mini"],
            "anthropic": ["claude-3-haiku-20240307", "claude-3-sonnet-20240229", "claude-3-opus-20240229"],
            "gemini": ["gemini-pro", "gemini-1.5-pro", "gemini-2.0-flash-exp"]
        }

        # Model configurations
        self.model_configs = {
            "openai": {
                "gpt-4.1": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4.1-mini": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4.1-nano": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "o4-mini": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "o3-mini": {
                    "max_tokens": 32000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "o3": {
                    "max_tokens": 32000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "o1-mini": {
                    "max_tokens": 32000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "o1-preview": {
                    "max_tokens": 32000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4o-mini": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4o-mini-2024-07-18": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4o": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4o-2024-08-06": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4o-2024-05-13": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "gpt-4-turbo": {
                    "max_tokens": 128000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
            },
            "anthropic": {
                "claude-4": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-opus-4-20250514": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-sonnet-4-20250514": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3.7": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3-7-sonnet-20250219": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3.5": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3-5-sonnet-20240620": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3-haiku-20240307": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3-opus-20240229": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
                "claude-3-sonnet-20240229": {
                    "max_tokens": 200000,
                    "cost_per_1k": 0.0,  # Pricing not specified
                    "rate_limit": "Variable",
                    "daily_limit": "Variable",
                },
            },
            "gemini": {
                "gemini-1.5-flash": {
                    "max_tokens": 1000000,
                    "cost_per_1k": 0.0,  # Free tier
                    "rate_limit": "15 requests/minute",
                    "daily_limit": "1500 requests/day",
                },
                "gemini-2.0-flash": {
                    "max_tokens": 1000000,
                    "cost_per_1k": 0.0,  # Free tier
                    "rate_limit": "15 requests/minute",
                    "daily_limit": "1500 requests/day",
                },
            },
        }

    def encrypt_api_key(self, api_key: str) -> str:
        """Encrypt API key for secure storage"""
        return self.cipher_suite.encrypt(api_key.encode()).decode()

    def decrypt_api_key(self, encrypted_key: str) -> str:
        """Decrypt API key for usage"""
        return self.cipher_suite.decrypt(encrypted_key.encode()).decode()

    async def save_user_api_key(
        self, user: User, provider: str, api_key: str, key_name: Optional[str] = None, verify_key: bool = True
    ) -> UserApiKey:
        """Save encrypted user API key with optional verification"""
        
        # Verify the API key before saving if requested
        if verify_key:
            is_valid = self.verify_api_key(provider, api_key)
            if not is_valid:
                raise ValueError(f"Invalid API key for {provider}. Please check your key and try again.")
        
        encrypted_key = self.encrypt_api_key(api_key)

        # Check if key already exists for this provider
        existing_key = await UserApiKey.find_one(
            UserApiKey.user.id == BeanieObjectId(user.id),
            UserApiKey.provider == provider,
            UserApiKey.is_active == True,
        )

        if existing_key:
            existing_key.encrypted_key = encrypted_key
            existing_key.key_name = key_name
            existing_key.updated_at = datetime.utcnow()
            await existing_key.save()
            return existing_key
        else:
            new_key = UserApiKey(
                user=user,
                provider=provider,
                encrypted_key=encrypted_key,
                key_name=key_name,
            )
            await new_key.save()
            return new_key

    async def get_user_api_key(self, user: User, provider: str) -> Optional[str]:
        """Get decrypted user API key"""
        user_key = await UserApiKey.find_one(
            UserApiKey.user.id == BeanieObjectId(user.id),
            UserApiKey.provider == provider,
            UserApiKey.is_active == True,
        )

        if user_key:
            try:
                return self.decrypt_api_key(user_key.encrypted_key)
            except Exception as e:
                print(f"Error decrypting API key: {e}")
                return None
        return None

    async def get_api_key_for_request(
        self, user: User, provider: str, use_user: bool
    ) -> Optional[str]:
        """Get API key to use for the request (user's or default)"""
        # First try check if use_user = true
        if use_user:
            user_key = await self.get_user_api_key(user, provider)

            if user_key:
                return user_key
            else:
                # If use_user is True but no valid user key found, raise an error
                raise Exception(
                    f"No valid API key found for {provider}. Please add your API key or disable 'use own key' option."
                )

        # Fall back to default key only if use_user is False
        return self.default_keys.get(provider)

    def get_model_name_for_provider(self, provider: str, model: str) -> str:
        """Get the correct model name for litellm"""
        model_mapping = {
            "openai": model,
            "anthropic": f"claude-3-{model}"
            if not model.startswith("claude")
            else model,
            "gemini": f"gemini/{model}" if not model.startswith("gemini/") else model,
        }
        return model_mapping.get(provider, model)

    async def check_rate_limit(
        self, user: User, chat_session: ChatSession, user_tier: str = None
    ) -> Tuple[bool, str]:
        """Check if user can make a request based on rate limits"""
        if chat_session.use_own_key:
            return True, "Using own API key"

        # Get user tier from user object if not provided
        if user_tier is None:
            user_tier = getattr(user, "user_tier", "free")

        daily_limit = self.daily_limits.get(user_tier, self.daily_limits["free"])
        if daily_limit == -1:  # Unlimited
            return True, "Unlimited usage"

        # Use user's rate limiting, not chat_session's
        user.reset_daily_count_if_needed()

        if user.daily_requests_count >= daily_limit:
            return (
                False,
                f"Daily limit of {daily_limit} requests reached. Please upgrade or add your own API key.",
            )

        return True, f"Rate limit OK ({user.daily_requests_count}/{daily_limit})"

    def prepare_messages_for_llm(
        self, messages: List[Dict], context: Optional[str] = None
    ) -> List[Dict]:
        """Prepare messages for LLM with context injection"""
        llm_messages = []

        # Add system message with context if provided
        if context:
            system_message = {
                "role": "system",
                "content": f"""You are a helpful AI assistant that answers questions about code repositories. 
Use the following repository context to answer user questions accurately and helpfully.

Repository Context:
{context}

Instructions:
- Answer based on the provided repository context
- If the question cannot be answered from the context, say so clearly
- Be specific and reference relevant files/functions when possible
- Keep responses concise but informative""",
            }
            llm_messages.append(system_message)

        # Add conversation messages
        for msg in messages:
            if msg["role"] in ["user", "assistant"]:
                llm_messages.append({"role": msg["role"], "content": msg["content"]})

        return llm_messages

    async def generate_response(
        self,
        user: User,
        use_user: bool,
        chat_session: ChatSession,
        messages: List[Dict],
        context: Optional[str] = None,
        provider: str = "openai",
        model: str = "gpt-3.5-turbo",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
    ) -> Union[Dict[str, Any], AsyncGenerator[Dict, None]]:
        """Generate response with optional streaming support"""

        try:
            # Check rate limits only if use_user is False (i.e., using default/shared key)
            if not use_user:
                can_proceed, rate_limit_msg = await self.check_rate_limit(
                    user, chat_session
                )
                if not can_proceed:
                    error_response = {
                        "success": False,
                        "error": rate_limit_msg,
                        "error_type": "rate_limit",
                    }
                    if stream:

                        async def error_generator():
                            yield error_response

                        return error_generator()
                    return error_response

            # Get API key
            api_key = await self.get_api_key_for_request(
                user, provider, use_user=use_user
            )
            if not api_key:
                error_response = {
                    "success": False,
                    "error": f"No API key available for {provider}",
                    "error_type": "no_api_key",
                }
                if stream:

                    async def error_generator():
                        yield error_response

                    return error_generator()
                return error_response

            # Prepare messages
            llm_messages = self.prepare_messages_for_llm(messages, context)

            # Get model name for provider
            model_name = self.get_model_name_for_provider(provider, model)

            # Return appropriate response type
            if stream:
                return self._generate_streaming_response(
                    api_key=api_key,
                    model_name=model_name,
                    messages=llm_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    provider=provider,
                    chat_session=chat_session,
                    user=user,
                )
            else:
                return await self._generate_non_streaming_response(
                    api_key=api_key,
                    model_name=model_name,
                    messages=llm_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    provider=provider,
                    chat_session=chat_session,
                    user=user,
                )

        except Exception as e:
            error_type = self._get_error_type(e)
            error_response = {
                "success": False,
                "error": str(e),
                "error_type": error_type,
            }
            if stream:

                async def error_generator():
                    yield error_response

                return error_generator()
            return error_response

    async def _generate_non_streaming_response(
        self,
        api_key: str,
        model_name: str,
        messages: List[Dict],
        temperature: float,
        max_tokens: Optional[int],
        provider: str,
        chat_session: ChatSession,
        user: User,
    ) -> Dict[str, Any]:
        """Generate non-streaming response"""
        litellm = get_litellm()
        response = await litellm.acompletion(
            model=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=120,
            api_key=api_key,
        )

        response_content = response.choices[0].message.content
        usage = response.usage

        # Update request count
        user.increment_request_count()
        await user.save()

        return {
            "success": True,
            "content": response_content,
            "usage": {
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
            },
            "model_used": model_name,
            "provider": provider,
        }

    async def _generate_streaming_response(
        self,
        api_key: str,
        model_name: str,
        messages: List[Dict],
        temperature: float,
        max_tokens: Optional[int],
        provider: str,
        chat_session: ChatSession,
        user: User,
    ) -> AsyncGenerator[Dict, None]:
        """Generate streaming response"""
        request_attempted = False
        try:
            # Start streaming request
            litellm = get_litellm()
            response = await litellm.acompletion(
                model=model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=120,
                stream=True,
                api_key=api_key,
            )
            request_attempted = True

            # Stream responses
            async for chunk in response:
                if chunk.choices[0].delta.content:
                    yield {
                        "type": "token",
                        "token": chunk.choices[0].delta.content,
                        "provider": provider,
                        "model": model_name,
                    }

            # Final status message
            yield {"type": "complete", "provider": provider, "model": model_name}

            # Update request count after successful stream
            user.increment_request_count()
            await user.save()

        except Exception as e:
            error_type = self._get_error_type(e)
            # Handle partial completion
            if request_attempted:
                chat_session.increment_request_count()
                await chat_session.save()

            yield {
                "type": "error",
                "error": str(e),
                "error_type": error_type,
                "provider": provider,
                "model": model_name,
            }

    def _get_error_type(self, error: Exception) -> str:
        """Classify error types"""
        error_msg = str(error).lower()
        if "rate limit" in error_msg:
            return "provider_rate_limit"
        elif "quota" in error_msg:
            return "quota_exceeded"
        elif "unauthorized" in error_msg or "invalid" in error_msg:
            return "invalid_api_key"
        elif "timeout" in error_msg:
            return "timeout"
        return "unknown"

    def get_available_models(self) -> Dict[str, List[str]]:
        """Get available models for each provider"""
        return {
            provider: list(models.keys())
            for provider, models in self.model_configs.items()
        }

    def get_model_info(self, provider: str, model: str) -> Optional[Dict]:
        """Get information about a specific model"""
        return self.model_configs.get(provider, {}).get(model)

    def verify_api_key(self, provider: str, api_key: str, model: str = None) -> bool:
        """Verify if an API key is valid for a specific provider using standalone verifier."""
        try:
            from utils.api_key_verifier import api_key_verifier
            return api_key_verifier.verify_api_key(provider, api_key)
        except Exception as e:
            print(f"Error verifying API key for {provider}: {e}")
            return False

    def get_valid_models_for_provider(self, provider: str, api_key: str) -> List[str]:
        """Get a list of valid models for a specific provider."""
        try:
            from utils.api_key_verifier import api_key_verifier
            return api_key_verifier.get_valid_models_for_provider(provider, api_key)
        except Exception as e:
            print(f"Error getting valid models for {provider}: {e}")
            return []

    async def generate_response_with_functions(
        self,
        user: User,
        use_user: bool,
        messages: List[Dict],
        functions: List[Dict],
        provider: str = "openai",
        model: str = "gpt-4",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = True
    ) -> AsyncGenerator[Dict, None]:
        """Generate response with function calling support"""
        
        try:
            litellm = get_litellm()
            
            # Get API key
            api_key = await self.get_api_key_for_request(user, provider, use_user)
            if not api_key:
                yield {"type": "error", "error": f"No API key available for {provider}"}
                return
                
            # Get the correct model name
            model_name = self.get_model_name_for_provider(provider, model)
            
            # Prepare LiteLLM parameters
            litellm_params = {
                "model": model_name,
                "messages": messages,
                "api_key": api_key,
                "temperature": temperature,
                "stream": stream,
                "functions": functions if provider == "openai" else None,
                "tools": [{"type": "function", "function": func} for func in functions] if provider != "openai" else None
            }
            
            if max_tokens:
                litellm_params["max_tokens"] = max_tokens
                
            # Make the completion call
            response = await litellm.acompletion(**litellm_params)
            
            if stream:
                async for chunk in response:
                    # Process streaming chunks
                    if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                        choice = chunk.choices[0]
                        delta = choice.delta
                        
                        # Handle function calls
                        if hasattr(delta, 'function_call') and delta.function_call:
                            if delta.function_call.name:
                                yield {
                                    "type": "function_call_start",
                                    "function_name": delta.function_call.name
                                }
                            if delta.function_call.arguments:
                                yield {
                                    "type": "function_call_arguments", 
                                    "arguments": delta.function_call.arguments
                                }
                        
                        # Handle tool calls (newer format)
                        elif hasattr(delta, 'tool_calls') and delta.tool_calls:
                            for tool_call in delta.tool_calls:
                                if hasattr(tool_call, 'function'):
                                    if tool_call.function.name:
                                        yield {
                                            "type": "function_call_start",
                                            "function_name": tool_call.function.name
                                        }
                                    if tool_call.function.arguments:
                                        yield {
                                            "type": "function_call_arguments",
                                            "arguments": tool_call.function.arguments
                                        }
                        
                        # Handle regular content
                        elif hasattr(delta, 'content') and delta.content:
                            yield {
                                "type": "token",
                                "token": delta.content
                            }
                        
                        # Handle completion
                        if choice.finish_reason:
                            if choice.finish_reason == "function_call":
                                yield {"type": "function_call_end"}
                            elif choice.finish_reason == "stop":
                                yield {
                                    "type": "complete",
                                    "usage": getattr(chunk, 'usage', {})
                                }
            else:
                # Non-streaming response
                if hasattr(response, 'choices') and len(response.choices) > 0:
                    choice = response.choices[0]
                    
                    if hasattr(choice, 'message') and hasattr(choice.message, 'function_call'):
                        # Function call response
                        yield {
                            "type": "function_call_start",
                            "function_name": choice.message.function_call.name
                        }
                        yield {
                            "type": "function_call_arguments",
                            "arguments": choice.message.function_call.arguments
                        }
                        yield {"type": "function_call_end"}
                    else:
                        # Regular response
                        content = choice.message.content if hasattr(choice.message, 'content') else ""
                        yield {
                            "type": "token",
                            "token": content
                        }
                        yield {
                            "type": "complete",
                            "usage": getattr(response, 'usage', {})
                        }
                        
        except Exception as e:
            yield {
                "type": "error",
                "error": str(e),
                "error_type": "llm_error"
            }


# Global instance
llm_service = LLMService()
