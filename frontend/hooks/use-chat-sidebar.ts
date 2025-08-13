'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  getConversationHistory,
  getAvailableModels,
  getUserChatSessions,
  type AvailableModelsResponse,
  type ChatSessionListItem,
} from '@/utils/api';
import { useApiWithAuth } from '@/hooks/useApiWithAuth';
import { extractJwtToken } from '@/utils/token-utils';
import {
  createStreamingChatRequest,
  parseStreamingResponse,
  type StreamingChatRequest,
} from '@/lib/streaming-chat';
import type { DailyUsage } from '@/api-client/types.gen';
import { showToast } from '@/components/toaster';
import { fetchModelConfig, type ModelConfig } from '@/utils/model-config';

interface ContextSettings {
  scope: 'focused' | 'moderate' | 'comprehensive';
  includeFullContext: boolean;
  maxTokens: number;
  includeDependencies: boolean;
  traversalDepth: number;
  relevanceThreshold: number;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  context_used?: string | null;
  metadata?: Record<string, any> | null;
  context_metadata?: Record<string, any> | null;
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  currentChatId?: string;
  currentConversationId?: string;
}

interface ModelApiState {
  provider: string;
  model: string;
  temperature: number;
}

type ModelState = Partial<ModelApiState>;

export function useChatSidebar(
  repositoryIdentifier: string,
  userKeyPreferences: Record<string, boolean>,
  options?: { autoLoad?: boolean; repositoryBranch?: string },
) {
  const { data: session } = useSession();
  const router = useRouter();
  const { autoLoad = true } = options ?? {};

  // Wrap API calls with auth handling
  const getUserChatSessionsWithAuth = useApiWithAuth(getUserChatSessions);
  const getConversationHistoryWithAuth = useApiWithAuth(getConversationHistory);
  const getAvailableModelsWithAuth = useApiWithAuth(getAvailableModels);
  const [chatState, setChatState] = useState<ChatState>({
    messages: [],
    isLoading: false,
  });
  const [modelState, setModelState] = useState<ModelState>({});
  const [availableModels, setAvailableModels] = useState<AvailableModelsResponse>({
    providers: {},
    current_limits: {},
    user_has_keys: [],
  });
  const [chatHistory, setChatHistory] = useState<ChatSessionListItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [currentModelConfig, setCurrentModelConfig] = useState<ModelConfig | null>(null);
  const [isLoadingModelConfig, setIsLoadingModelConfig] = useState(false);

  const [useUserKeys, setUseUserKeys] = useState<Record<string, boolean>>(userKeyPreferences);
  const [contextSettings, setContextSettings] = useState<ContextSettings>({
    scope: 'moderate',
    includeFullContext: false,
    maxTokens: 4000,
    includeDependencies: true,
    traversalDepth: 2,
    relevanceThreshold: 0.3,
  });

  // Refs to prevent duplicate loads in React Strict Mode/dev and to avoid concurrent calls
  const isFetchingHistoryRef = useRef(false);
  const lastHistoryKeyRef = useRef<string | null>(null);
  const lastModelsTokenRef = useRef<string | null>(null);

  useEffect(() => {
    setUseUserKeys(userKeyPreferences);
  }, [userKeyPreferences]);

  // Load available models and chat history on mount or when auth/repo changes (with guards)
  useEffect(() => {
    if (!autoLoad) return;
    if (!session?.jwt_token) return;
    if (!repositoryIdentifier || repositoryIdentifier.trim() === '') {
      console.log('Skipping chat initialization: No repository identifier provided');
      return;
    }

    // Validate repository identifier format (should be owner/repo/branch)
    if (!repositoryIdentifier.includes('/')) {
      console.warn(
        'Repository identifier should be in owner/repo/branch format:',
        repositoryIdentifier,
      );
      return;
    }

    // Models: only load once per token
    if (lastModelsTokenRef.current !== session.jwt_token) {
      lastModelsTokenRef.current = session.jwt_token;
      loadAvailableModels();
    }

    // History: only load once per token+repository pair
    const historyKey = `${session.jwt_token}:${repositoryIdentifier}`;
    if (lastHistoryKeyRef.current !== historyKey) {
      lastHistoryKeyRef.current = historyKey;
      void loadChatHistory();
    }
  }, [autoLoad, session?.jwt_token, repositoryIdentifier]);

  const loadModelConfig = async (provider?: string, model?: string) => {
    const targetProvider = provider || modelState.provider;
    const targetModel = model || modelState.model;
    
    // Validate provider and model before making API call
    if (!targetProvider || !targetModel || 
        typeof targetProvider !== 'string' || typeof targetModel !== 'string' ||
        targetProvider.trim() === '' || targetModel.trim() === '') {
      console.log('Skipping model config load: invalid provider or model', { targetProvider, targetModel });
      return;
    }

    // Validate that provider is one of the valid providers
    const validProviders = ['openai', 'anthropic', 'gemini', 'groq'];
    if (!validProviders.includes(targetProvider)) {
      console.warn('Invalid provider for model config:', targetProvider);
      return;
    }
    
    setIsLoadingModelConfig(true);
    try {
      const config = await fetchModelConfig(targetProvider, targetModel);
      setCurrentModelConfig(config);
      
      // Auto-adjust context settings based on model capabilities
      if (config) {
        setContextSettings(prev => ({
          ...prev,
          maxTokens: Math.min(prev.maxTokens, Math.floor(config.max_tokens * 0.7)), // Use 70% of max context for repository content
        }));
      }
    } catch (error) {
      console.error('Failed to load model config:', error);
      setCurrentModelConfig(null);
    } finally {
      setIsLoadingModelConfig(false);
    }
  };

  const loadAvailableModels = async () => {
    if (!session?.jwt_token) return;

    try {
      const models = await getAvailableModelsWithAuth(extractJwtToken(session.jwt_token));
      setAvailableModels(models);

      // Set default model if current one is not available
      const providerKey = modelState.provider;
      const modelKey = modelState.model;
      const currentProviderModels = providerKey
        ? models.providers[providerKey as keyof typeof models.providers]
        : undefined;
      if (!providerKey || !modelKey || !currentProviderModels?.includes(modelKey as string)) {
        const firstProvider = Object.keys(models.providers)[0];
        const firstModel = firstProvider ? models.providers[firstProvider]?.[0] : undefined;
        if (firstProvider && firstModel) {
          setModelState((prev) => ({
            ...prev,
            provider: firstProvider,
            model: firstModel,
          }));
          // Load config for new model
          loadModelConfig(firstProvider, firstModel);
        }
      } else if (providerKey && modelKey) {
        // Load config for current model
        loadModelConfig(providerKey, modelKey);
      }
    } catch (error) {
      showToast.error('Failed to load available models');
    }
  };

  const loadChatHistory = async () => {
    if (!session?.jwt_token) return;
    if (!repositoryIdentifier || repositoryIdentifier.trim() === '') return;
    if (isFetchingHistoryRef.current) return;

    isFetchingHistoryRef.current = true;
    setIsLoadingHistory(true);
    try {
      const chatSessions = await getUserChatSessionsWithAuth(
        extractJwtToken(session.jwt_token),
        repositoryIdentifier,
      );
      if (chatSessions.success) {
        setChatHistory(chatSessions.sessions);
      } else {
        setChatHistory([]);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      showToast.error('Failed to load chat history');
      setChatHistory([]);
    } finally {
      setIsLoadingHistory(false);
      isFetchingHistoryRef.current = false;
    }
  };

  const sendMessage = async (
    content: string,
  ): Promise<{ daily_usage?: DailyUsage } | undefined> => {
    if (!session?.jwt_token || chatState.isLoading) return;

    // Check if repository identifier is valid - should be in owner/repo/branch format
    if (!repositoryIdentifier || repositoryIdentifier.trim() === '' || !repositoryIdentifier.includes('/')) {
      console.error(
        'Cannot send message: Repository identifier is invalid:',
        repositoryIdentifier,
      );
      throw new Error(
        'Repository not processed yet. Please wait for repository processing to complete before starting a chat.',
      );
    }

    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setChatState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
    }));

    try {
      // Determine appropriate temperature based on model
      let temperature = modelState.temperature;

      // O-series models (o1-preview, o1-mini, etc.) only support temperature=1
      if (
        modelState.model &&
        (modelState.model.startsWith('o1') || modelState.model.includes('o1'))
      ) {
        temperature = 1.0;
      } else if (temperature === undefined) {
        // Default temperature for other models
        temperature = 0.7;
      }

      const streamingRequest: StreamingChatRequest = {
        token: extractJwtToken(session.jwt_token),
        message: content,
        repository_id: repositoryIdentifier,
        repository_branch: options?.repositoryBranch,
        use_user: modelState.provider ? (useUserKeys[modelState.provider] ?? false) : false,
        chat_id: chatState.currentChatId,
        conversation_id: chatState.currentConversationId,
        provider: modelState.provider,
        model: modelState.model,
        temperature: temperature,
        context_mode: contextSettings.includeFullContext ? 'full' : 'smart',
        max_tokens: contextSettings.maxTokens,
      };

      const response = await createStreamingChatRequest(streamingRequest);

      let assistantMessage = '';
      let chatId = chatState.currentChatId;
      let conversationId = chatState.currentConversationId;
      let hasStartedResponse = false;
      let metadataReceived = false;
      let hasReceivedTokens = false;
      let dailyUsage: DailyUsage | null = null;

      // Add placeholder assistant message immediately
      setChatState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            role: 'assistant',
            content: '',
            timestamp: new Date(),
          },
        ],
      }));

      try {
        // Process streaming response
        for await (const chunk of parseStreamingResponse(response)) {
          console.log('Processing chunk:', chunk); // Debug log

          if (chunk.type === 'metadata') {
            // Extract chat and conversation IDs from metadata
            if (chunk.chat_id && chunk.conversation_id && !metadataReceived) {
              chatId = chunk.chat_id;
              conversationId = chunk.conversation_id;
              metadataReceived = true;

              // Update state with new IDs immediately
              setChatState((prev) => ({
                ...prev,
                currentChatId: chatId,
                currentConversationId: conversationId,
              }));
            }
          } else if (chunk.type === 'token') {
            hasReceivedTokens = true;
            hasStartedResponse = true;

            // Handle token content (can be empty string)
            if (chunk.content !== undefined) {
              assistantMessage += chunk.content;

              // Update the last assistant message with streaming content
              setChatState((prev) => {
                const newMessages = [...prev.messages];
                const lastMessage = newMessages[newMessages.length - 1];

                if (lastMessage?.role === 'assistant') {
                  newMessages[newMessages.length - 1] = {
                    ...lastMessage,
                    content: assistantMessage,
                  };
                }

                return {
                  ...prev,
                  messages: newMessages,
                  currentChatId: chatId || prev.currentChatId,
                  currentConversationId: conversationId || prev.currentConversationId,
                };
              });
            }
          } else if (chunk.type === 'complete') {
            console.log('Stream completed successfully');

            // Capture daily usage data
            if (chunk.daily_usage) {
              dailyUsage = chunk.daily_usage;
            }

            // Update the final assistant message with context metadata if available
            if (chunk.context_metadata) {
              setChatState((prev) => {
                const newMessages = [...prev.messages];
                const lastMessage = newMessages[newMessages.length - 1];

                if (lastMessage?.role === 'assistant') {
                  newMessages[newMessages.length - 1] = {
                    ...lastMessage,
                    context_metadata: chunk.context_metadata,
                  };
                }

                return {
                  ...prev,
                  messages: newMessages,
                };
              });
            }

            break;
          } else if (chunk.type === 'error') {
            const errorMessage = chunk.message || 'Streaming error occurred';
            const errorType = chunk.error_type || 'unknown';
            console.error('Streaming error:', errorMessage, 'Type:', errorType);

            // Handle API key errors by redirecting to API keys page
            if (errorType === 'no_api_key' || errorType === 'invalid_api_key') {
              showToast.error('API key required. Redirecting to API keys page...');
              setTimeout(() => {
                router.push('/api-keys');
              }, 2000);
              throw new Error('API key required. Please add your API key to continue.');
            }

            // Handle repository not found errors
            if (errorType === 'server_error' && errorMessage.includes('not found')) {
              throw new Error(
                'Repository not processed yet. Please process the repository first before chatting.',
              );
            }

            // Check for specific error types
            if (
              errorMessage.toLowerCase().includes('quota') ||
              errorMessage.toLowerCase().includes('limit') ||
              errorMessage.toLowerCase().includes('rate')
            ) {
              throw new Error(
                'API quota limit reached. Please try again later or use your own API key.',
              );
            } else if (errorMessage.toLowerCase().includes('authentication')) {
              throw new Error('Authentication failed. Please Provide your API key.');
            } else {
              throw new Error(errorMessage);
            }
          } else if (chunk.type === 'done') {
            console.log('Stream done');
            break;
          }
        }
      } catch (streamError) {
        console.error('Stream processing error:', streamError);
        throw streamError; // Re-throw to be caught by outer try-catch
      }

      // Check if we actually received any response
      if (!hasReceivedTokens && !hasStartedResponse) {
        throw new Error(
          'No response received from AI. This may be due to API quota limits or temporary service issues. Please try again later.',
        );
      }

      // Final state update
      setChatState((prev) => ({
        ...prev,
        currentChatId: chatId || prev.currentChatId,
        currentConversationId: conversationId || prev.currentConversationId,
        isLoading: false,
      }));

      console.log('Message sent successfully, refreshing chat history');
      // Refresh chat history after successful message
      await loadChatHistory();

      // Return daily usage data if available
      return dailyUsage ? { daily_usage: dailyUsage } : undefined;
    } catch (error) {
      console.error('Chat error:', error);

      let errorMessage = 'Failed to send message';
      if (error instanceof Error) {
        errorMessage = error.message;

        // Check if it's an API key error and redirect if needed
        if (errorMessage.toLowerCase().includes('api key required')) {
          // The redirect is already handled in the streaming error handler
          // Just show the error message here
        }
      }

      showToast.error(errorMessage);

      // Remove both user and assistant messages if there was an error
      setChatState((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2), // Remove last 2 messages (user + assistant placeholder)
        isLoading: false,
      }));
    }
  };

  const loadConversation = async (conversationId: string) => {
    if (!session?.jwt_token) return;

    setChatState((prev) => ({ ...prev, isLoading: true }));

    try {
      const conversation = await getConversationHistoryWithAuth(
        extractJwtToken(session.jwt_token),
        conversationId,
      );

      const messages: Message[] = conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp), // Ensure proper Date object
        context_used: msg.context_used,
        metadata: msg.metadata,
      }));

      setChatState({
        messages,
        isLoading: false,
        currentChatId: conversation.chat_id,
        currentConversationId: conversation.conversation_id,
      });

      showToast.success('Conversation loaded');
    } catch (error) {
      console.error('Failed to load conversation:', error);
      showToast.error('Failed to load conversation');
      setChatState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const loadConversationBySessionItem = async (sessionItem: ChatSessionListItem) => {
    await loadConversation(sessionItem.conversation_id);
  };

  const clearCurrentChat = () => {
    // This creates a completely new chat session
    setChatState({
      messages: [],
      isLoading: false,
      currentChatId: undefined,
      currentConversationId: undefined,
    });
    showToast.success('Started new chat');
  };

  const startNewConversation = () => {
    // Keep the same chat_id but clear conversation_id to start a new conversation thread
    setChatState((prev) => ({
      messages: [],
      isLoading: false,
      currentChatId: prev.currentChatId, // Keep the existing chat session
      // Clear conversationId - will be generated on first message of new conversation
      currentConversationId: undefined,
    }));
    showToast.success('Started new conversation');
  };

  const startNewChatSession = () => {
    // This creates a completely new chat session
    setChatState({
      messages: [],
      isLoading: false,
      // Clear both IDs - new session will be created by backend
      currentChatId: undefined,
      currentConversationId: undefined,
    });
    showToast.success('Started new chat session');
  };

  const setModel = (provider: string, model: string) => {
    setModelState((prev) => ({
      ...prev,
      provider,
      model,
    }));
    // Load configuration for the new model
    loadModelConfig(provider, model);
  };

  const refreshModels = async () => {
    await loadAvailableModels();
  };

  const refreshChatHistory = async () => {
    await loadChatHistory();
  };

  return {
    messages: chatState.messages,
    isLoading: chatState.isLoading,
    isLoadingHistory,
    currentModel: modelState,
    currentModelConfig,
    isLoadingModelConfig,
    availableModels,
    chatHistory,
    sendMessage,
    loadConversation,
    loadConversationBySessionItem, // New method specifically for session items
    clearCurrentChat, // Creates completely new chat session
    startNewConversation, // Starts new conversation in same chat session
    startNewChatSession, // Same as clearCurrentChat for backward compatibility
    setModel,
    refreshModels,
    refreshChatHistory, // New method to manually refresh chat history
    // Expose current session info for debugging
    currentChatId: chatState.currentChatId,
    currentConversationId: chatState.currentConversationId,
    useUserKeys,
    setUseUserKeys,
    // Context settings
    contextSettings,
    setContextSettings,
  };
}
