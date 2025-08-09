'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { 
  createAgenticChatRequest, 
  parseAgenticStreamingResponse,
  type AgenticStreamingRequest,
  type AgenticStreamingChunk
} from '@/lib/agentic-chat';
import { showToast } from '@/components/toaster';
import type { AgenticMessage, AgenticToolCall } from '@/components/agentic-message';

interface AgenticChatState {
  messages: AgenticMessage[];
  toolCalls: AgenticToolCall[];
  isLoading: boolean;
  currentChatId?: string;
  currentConversationId?: string;
  streamingContent: string;
  currentTool?: string;
}

export function useAgenticChat(repositoryId: string) {
  const { data: session } = useSession();
  const [chatState, setChatState] = useState<AgenticChatState>({
    messages: [],
    toolCalls: [],
    isLoading: false,
    streamingContent: '',
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const sendAgenticMessage = async (message: string, model?: string, provider?: string) => {
    if (!session?.jwt_token || !message.trim()) return;

    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Add user message
    const userMessage: AgenticMessage = {
      role: 'user',
      content: message.trim(),
      timestamp: new Date(),
    };

    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
      streamingContent: '',
      toolCalls: [],
    }));

    try {
      const request: AgenticStreamingRequest = {
        token: session.jwt_token,
        message: message.trim(),
        repository_id: repositoryId,
        use_user: false, // Default to system keys for now
        chat_id: chatState.currentChatId,
        conversation_id: chatState.currentConversationId,
        provider: provider || 'openai',
        model: model || 'gpt-4',
        temperature: 0.7,
      };

      const response = await createAgenticChatRequest(request);
      let assistantContent = '';
      let currentToolCall: Partial<AgenticToolCall> | null = null;
      let currentToolCalls: AgenticToolCall[] = [];

      for await (const chunk of parseAgenticStreamingResponse(response)) {
        if (abortControllerRef.current?.signal.aborted) {
          break;
        }

        switch (chunk.event) {
          case 'agent_thinking':
            // Add thinking message
            const thinkingMessage: AgenticMessage = {
              role: 'agent_thinking',
              content: chunk.content || '',
              timestamp: new Date(),
            };
            setChatState(prev => ({
              ...prev,
              messages: [...prev.messages.slice(0, -1), thinkingMessage, ...prev.messages.slice(-1)],
            }));
            break;

          case 'tool_call_start':
            // Start new tool call
            currentToolCall = {
              tool_name: chunk.tool_name || 'unknown',
              status: 'in_progress',
              timestamp: new Date(),
            };
            
            const toolStartMessage: AgenticMessage = {
              role: 'tool_call',
              content: chunk.content || `Calling ${chunk.tool_name}...`,
              timestamp: new Date(),
              tool_name: chunk.tool_name,
            };
            
            setChatState(prev => ({
              ...prev,
              messages: [...prev.messages.slice(0, -1), toolStartMessage, ...prev.messages.slice(-1)],
            }));
            break;

          case 'tool_call_progress':
            // Update tool call progress
            if (currentToolCall && chunk.content) {
              setChatState(prev => {
                const updatedMessages = [...prev.messages];
                const lastMessage = updatedMessages[updatedMessages.length - 2]; // -2 because user message is at -1
                if (lastMessage && lastMessage.role === 'tool_call') {
                  lastMessage.content = chunk.content || lastMessage.content;
                }
                return { ...prev, messages: updatedMessages };
              });
            }
            break;

          case 'tool_call_result':
            // Complete tool call
            if (currentToolCall) {
              const completedTool: AgenticToolCall = {
                ...currentToolCall,
                status: chunk.tool_result?.success ? 'completed' : 'error',
                result: chunk.tool_result,
                error: !chunk.tool_result?.success ? chunk.tool_result?.error : undefined,
              } as AgenticToolCall;
              
              currentToolCalls.push(completedTool);
              currentToolCall = null;

              // Update the tool call message
              setChatState(prev => {
                const updatedMessages = [...prev.messages];
                const lastToolMessage = updatedMessages[updatedMessages.length - 2];
                if (lastToolMessage && lastToolMessage.role === 'tool_call') {
                  lastToolMessage.content = chunk.content || 'Tool completed';
                  lastToolMessage.tool_result = chunk.tool_result;
                }
                return { ...prev, messages: updatedMessages, toolCalls: currentToolCalls };
              });
            }
            break;

          case 'token':
            // Add token to assistant response
            if (chunk.token) {
              assistantContent += chunk.token;
              setChatState(prev => ({
                ...prev,
                streamingContent: assistantContent,
              }));
            }
            break;

          case 'complete':
            // Finalize assistant message
            const assistantMessage: AgenticMessage = {
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
            };

            setChatState(prev => ({
              ...prev,
              messages: [...prev.messages.slice(0, -1), assistantMessage],
              isLoading: false,
              streamingContent: '',
              currentChatId: chunk.chat_id || prev.currentChatId,
              currentConversationId: chunk.conversation_id || prev.currentConversationId,
            }));
            break;

          case 'error':
            showToast.error('Chat Error', chunk.error || 'Unknown error occurred');
            setChatState(prev => ({
              ...prev,
              isLoading: false,
              streamingContent: '',
            }));
            break;
        }
      }
    } catch (error) {
      console.error('Agentic chat error:', error);
      showToast.error('Connection Error', 'Failed to send message');
      setChatState(prev => ({
        ...prev,
        isLoading: false,
        streamingContent: '',
      }));
    }
  };

  const clearChat = () => {
    setChatState({
      messages: [],
      toolCalls: [],
      isLoading: false,
      streamingContent: '',
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    messages: chatState.messages,
    toolCalls: chatState.toolCalls,
    isLoading: chatState.isLoading,
    streamingContent: chatState.streamingContent,
    sendMessage: sendAgenticMessage,
    clearChat,
  };
}