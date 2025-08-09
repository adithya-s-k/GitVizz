// agentic-chat.ts - Enhanced streaming chat with agentic features
export interface AgenticStreamingRequest {
  token: string;
  message: string;
  repository_id: string;
  use_user: boolean;
  chat_id?: string;
  conversation_id?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface AgenticStreamingChunk {
  event: 'token' | 'complete' | 'error' | 'agent_thinking' | 'tool_call_start' | 'tool_call_progress' | 'tool_call_result';
  token?: string;
  content?: string;
  error?: string;
  error_type?: string;
  chat_id?: string;
  conversation_id?: string;
  tool_name?: string;
  tool_result?: Record<string, any>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider?: string;
  model?: string;
}

export async function createAgenticChatRequest(request: AgenticStreamingRequest): Promise<Response> {
  const formData = new FormData();

  // Add required fields
  formData.append('token', request.token);
  formData.append('message', request.message);
  formData.append('repository_id', request.repository_id);
  formData.append('use_user', request.use_user.toString());

  // Add optional fields
  if (request.chat_id) formData.append('chat_id', request.chat_id);
  if (request.conversation_id) formData.append('conversation_id', request.conversation_id);
  if (request.provider) formData.append('provider', request.provider);
  if (request.model) formData.append('model', request.model);
  if (request.temperature !== undefined)
    formData.append('temperature', request.temperature.toString());
  if (request.max_tokens) formData.append('max_tokens', request.max_tokens.toString());

  // Make request to agentic endpoint
  const response = await fetch(`${'http://localhost:8003'}/api/backend-chat/agentic/stream`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
  }

  return response;
}

export async function* parseAgenticStreamingResponse(
  response: Response,
): AsyncGenerator<AgenticStreamingChunk, void, unknown> {
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
        if (!line.trim()) continue;

        try {
          const chunk: AgenticStreamingChunk = JSON.parse(line.trim());
          
          // Map old format to new format for compatibility
          if (chunk.event === 'token' || chunk.event === 'complete' || chunk.event === 'error') {
            yield chunk;
          } else {
            // Handle agentic-specific events
            yield chunk;
          }
        } catch (parseError) {
          console.warn('Failed to parse chunk:', line, parseError);
          // Continue processing other chunks
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      try {
        const chunk: AgenticStreamingChunk = JSON.parse(buffer.trim());
        yield chunk;
      } catch (parseError) {
        console.warn('Failed to parse final chunk:', buffer, parseError);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!hasReceivedData) {
    throw new Error('No data received from stream');
  }
}