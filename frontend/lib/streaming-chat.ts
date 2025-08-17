// streaming-chat.ts
import type { DailyUsage } from '@/api-client/types.gen';

export interface StreamingChatRequest {
  token: string;
  message: string;
  repository_id: string;
  repository_branch?: string;
  use_user: boolean;
  chat_id?: string;
  conversation_id?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  context_mode?: string;
}

export interface StreamingChunk {
  type: 'token' | 'metadata' | 'error' | 'done' | 'complete' | 'progress' | 'function_call' | 'function_complete';
  content?: string;
  chat_id?: string;
  conversation_id?: string;
  message?: string;
  error_type?: string;
  delta?: {
    content?: string;
  };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider?: string;
  model?: string;
  context_metadata?: Record<string, unknown>;
  daily_usage?: DailyUsage;
  // Progress events
  step?: string;
  // Function call events
  function_name?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  status?: string;
  function_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status?: string;
  }>;
  tools_used?: number;
}

export async function createStreamingChatRequest(request: StreamingChatRequest): Promise<Response> {
  // Create form data as expected by the API
  const formData = new FormData();

  // Add all required fields (no token in body)
  formData.append('message', request.message);
  formData.append('repository_id', request.repository_id);
  formData.append('use_user', request.use_user.toString());

  // Add optional fields
  if (request.repository_branch) formData.append('repository_branch', request.repository_branch);
  if (request.chat_id) formData.append('chat_id', request.chat_id);
  if (request.conversation_id) formData.append('conversation_id', request.conversation_id);
  if (request.provider) formData.append('provider', request.provider);
  if (request.model) formData.append('model', request.model);
  if (request.temperature !== undefined)
    formData.append('temperature', request.temperature.toString());
  if (request.max_tokens) formData.append('max_tokens', request.max_tokens.toString());

  if (request.context_mode) {
    formData.append('context_mode', request.context_mode);
  }

  // Make the request to your backend with Authorization header
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8003';
  const response = await fetch(`${backendUrl}/api/backend-chat/chat/stream`, {
    method: 'POST',
    headers: {
      'Authorization': request.token, // Token already contains "Bearer "
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
  }

  return response;
}

export async function* parseStreamingResponse(
  response: Response,
): AsyncGenerator<StreamingChunk, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream available');

  const decoder = new TextDecoder();
  let buffer = '';
  let hasReceivedData = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      hasReceivedData = true;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const data = JSON.parse(trimmedLine);
          console.log('Received streaming data:', data); // Debug log

          // Map backend events to our StreamingChunk format
          switch (data.event) {
            case 'progress':
              yield {
                type: 'progress',
                step: data.step,
                message: data.message,
              };
              break;

            case 'function_call':
              yield {
                type: 'function_call',
                function_name: data.function_name,
                arguments: data.arguments,
                status: data.status || 'started',
                message: data.message,
              };
              break;

            case 'function_complete':
              yield {
                type: 'function_complete',
                function_name: data.function_name,
                result: data.result,
                status: data.status || 'completed',
                message: data.message,
              };
              break;

            case 'token':
              // First token in the stream contains metadata
              if (data.chat_id && data.conversation_id) {
                yield {
                  type: 'metadata',
                  chat_id: data.chat_id,
                  conversation_id: data.conversation_id,
                  provider: data.provider,
                  model: data.model,
                };
              }

              // Always yield the token content
              if (data.content !== undefined || data.token !== undefined) {
                // Check for undefined instead of truthy
                yield {
                  type: 'token',
                  content: data.content || data.token, // Can be empty string
                  chat_id: data.chat_id,
                  conversation_id: data.conversation_id,
                };
              }
              break;

            case 'complete':
              yield {
                type: 'complete',
                chat_id: data.chat_id,
                conversation_id: data.conversation_id,
                usage: data.usage,
                provider: data.provider,
                model: data.model,
                daily_usage: data.daily_usage,
                function_calls: data.function_calls,
                tools_used: data.tools_used,
              };
              yield { type: 'done' }; // Signal end
              break;

            case 'error':
              yield {
                type: 'error',
                message: data.error || 'Unknown error',
                error_type: data.error_type || 'unknown',
                chat_id: data.chat_id,
                conversation_id: data.conversation_id,
              };
              return; // Stop processing on error

            default:
              console.warn('Unknown event type:', data.event, data);
          }
        } catch (parseError) {
          console.warn('Failed to parse JSON chunk:', trimmedLine, parseError);
          // Don't yield error for parse failures, just log and continue
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        console.log('Processing final buffer:', data);

        if (data.event === 'token' && data.token !== undefined) {
          yield {
            type: 'token',
            content: data.token,
            chat_id: data.chat_id,
            conversation_id: data.conversation_id,
          };
        } else if (data.event === 'complete') {
          yield {
            type: 'complete',
            chat_id: data.chat_id,
            conversation_id: data.conversation_id,
            usage: data.usage,
            daily_usage: data.daily_usage,
          };
        }
      } catch (parseError) {
        console.warn('Failed to parse final buffer:', buffer, parseError);
      }
    }

    // Only yield done if we haven't already
    if (hasReceivedData) {
      yield { type: 'done' };
    } else {
      // If no data was received at all, this might indicate a quota limit or other issue
      throw new Error(
        'No data received from streaming response - this may indicate a quota limit or API issue',
      );
    }
  } catch (error) {
    console.error('Streaming error:', error);
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : 'Streaming failed',
    };
  } finally {
    reader.releaseLock();
  }
}
