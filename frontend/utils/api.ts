// API utilities for interacting with the backend using Hey-API generated SDK

import { getAuthClient, apiClient } from './client-config';
import {
  generateTextEndpointApiRepoGenerateTextPost,
  generateGraphEndpointApiRepoGenerateGraphPost,
  generateStructureEndpointApiRepoGenerateStructurePost,
  loginUserApiBackendAuthLoginPost,
  processChatMessageApiBackendChatChatPost,
  streamChatResponseApiBackendChatChatStreamPost,
  getConversationHistoryApiBackendChatConversationsConversationIdPost,
  getChatSessionApiBackendChatSessionsChatIdPost,
  updateChatSettingsApiBackendChatSettingsPost,
  searchContextApiBackendChatContextSearchPost,
  listUserChatSessionsApiBackendChatSessionsPost,
  generateWikiApiDocumentationGenerateWikiPost,
  getWikiStatusApiDocumentationWikiStatusPost,
  listRepositoryDocsApiDocumentationRepositoryDocsPost,
  isWikiGeneratedApiDocumentationIsWikiGeneratedPost,
  verifyApiKeyBackendEnhanced,
  saveApiKeyBackendEnhanced,
  getUserApiKeysBackendEnhanced,
  deleteUserApiKeyBackendEnhanced,
  getAvailableModelsBackendEnhanced,
  getModelConfigBackendEnhanced,
} from '../api-client/sdk.gen';

import type {
  GraphResponse,
  StructureResponse,
  LoginResponse,
  ChatResponse,
  ChatSessionResponse,
  ConversationHistoryResponse,
  ApiKeyResponse,
  AvailableModelsResponse,
  ChatSettingsResponse,
  ContextSearchResponse,
  TextResponse,
  ChatSessionListResponse,
  ChatSessionListItem,
  IsWikiGeneratedApiDocumentationIsWikiGeneratedPostResponse,
} from '../api-client/types.gen';

// Types for convenience
export interface RepoRequest {
  repo_url?: string;
  branch?: string;
  access_token?: string;
  jwt_token?: string;
  zip_file?: File;
}

export type {
  ConversationHistoryResponse,
  AvailableModelsResponse,
  ChatSessionListResponse,
  ChatSessionResponse,
  ChatSessionListItem,
};

export interface ChatRequest {
  token: string;
  message: string;
  repository_id: string;
  use_user?: boolean;
  chat_id?: string;
  conversation_id?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  context_search_query?: string;
  scope_preference?: string;
}

export interface ApiKeyRequest {
  token: string;
  provider: string;
  api_key: string;
  key_name?: string;
}

// Enum for operation types
export enum OperationType {
  TEXT = 'text',
  GRAPH = 'graph',
  STRUCTURE = 'structure',
}

// Type mapping for responses
type ResponseMap = {
  [OperationType.TEXT]: TextResponse;
  [OperationType.GRAPH]: GraphResponse;
  [OperationType.STRUCTURE]: StructureResponse;
};

// Type mapping for API functions
type ApiFunctionMap = {
  [OperationType.TEXT]: typeof generateTextEndpointApiRepoGenerateTextPost;
  [OperationType.GRAPH]: typeof generateGraphEndpointApiRepoGenerateGraphPost;
  [OperationType.STRUCTURE]: typeof generateStructureEndpointApiRepoGenerateStructurePost;
};

/**
 * Helper function to extract owner and repo from GitHub URL
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const urlObj = new URL(url.toLowerCase());
    if (!urlObj.hostname.includes('github.com')) {
      return null;
    }
    
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/, ''), // Remove .git suffix if present
      };
    }
  } catch (error) {
    console.warn('Invalid GitHub URL:', url);
  }
  return null;
}

/**
 * Get all branches for a GitHub repository
 */
export async function getRepositoryBranches(
  repoUrl: string, 
  accessToken?: string
): Promise<string[]> {
  const repoInfo = parseGitHubUrl(repoUrl);
  if (!repoInfo) {
    return []; // fallback for non-GitHub URLs
  }

  try {
    const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches`;
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'gitvizz-app',
    };

    if (accessToken && accessToken.trim() && accessToken !== 'string') {
      headers['Authorization'] = `token ${accessToken}`;
    }

    const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10000) });
    
    if (response.ok) {
      const branches = await response.json();
      return branches.map((branch: any) => branch.name).sort((a: string, b: string) => {
        // Sort so that common default branches appear first
        const commonBranches = ['main', 'master', 'develop', 'dev'];
        const aIndex = commonBranches.indexOf(a);
        const bIndex = commonBranches.indexOf(b);
        
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      });
    } else {
      console.warn(`Could not fetch branches for ${repoUrl}`);
      return [];
    }
  } catch (error) {
    console.warn(`Error getting branches for ${repoUrl}:`, error);
    return [];
  }
}

/**
 * Get the default branch for a GitHub repository
 */
export async function getRepositoryDefaultBranch(
  repoUrl: string, 
  accessToken?: string
): Promise<string> {
  const repoInfo = parseGitHubUrl(repoUrl);
  if (!repoInfo) {
    return 'main'; // fallback for non-GitHub URLs
  }

  try {
    const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'gitvizz-app',
    };

    if (accessToken && accessToken.trim() && accessToken !== 'string') {
      headers['Authorization'] = `token ${accessToken}`;
    }

    const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10000) });
    
    if (response.ok) {
      const data = await response.json();
      return data.default_branch || 'main';
    } else {
      console.warn(`Could not fetch default branch for ${repoUrl}, using 'main' as fallback`);
      return 'main';
    }
  } catch (error) {
    console.warn(`Error getting default branch for ${repoUrl}:`, error);
    return 'main';
  }
}

/**
 * Validate if a specific branch exists in the repository
 */
export async function validateBranchExists(
  repoUrl: string, 
  branch: string, 
  accessToken?: string
): Promise<boolean> {
  const repoInfo = parseGitHubUrl(repoUrl);
  if (!repoInfo) {
    return false; // fallback for non-GitHub URLs
  }

  try {
    const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${branch}`;
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'gitvizz-app',
    };

    if (accessToken && accessToken.trim() && accessToken !== 'string') {
      headers['Authorization'] = `token ${accessToken}`;
    }

    const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch (error) {
    console.warn(`Error validating branch ${branch} for ${repoUrl}:`, error);
    return false;
  }
}

/**
 * Resolve the branch to use for a repository
 * Priority:
 * 1. If requested branch exists, use it
 * 2. If requested branch doesn't exist, fall back to default branch
 * 3. If no requested branch, use repository's default branch
 */
export async function resolveBranch(
  repoUrl: string, 
  requestedBranch?: string, 
  accessToken?: string
): Promise<string> {
  if (!repoUrl || !repoUrl.includes('github.com')) {
    return requestedBranch || 'main';
  }

  try {
    // If a specific branch was requested, check if it exists
    if (requestedBranch && requestedBranch !== 'main' && requestedBranch.trim()) {
      const branchExists = await validateBranchExists(repoUrl, requestedBranch, accessToken);
      if (branchExists) {
        console.log(`Using requested branch '${requestedBranch}' for ${repoUrl}`);
        return requestedBranch;
      } else {
        console.warn(`Requested branch '${requestedBranch}' not found, falling back to default branch`);
      }
    }

    // Get the repository's default branch
    const defaultBranch = await getRepositoryDefaultBranch(repoUrl, accessToken);
    console.log(`Using default branch '${defaultBranch}' for ${repoUrl}`);
    return defaultBranch;
  } catch (error) {
    console.error(`Error resolving branch for ${repoUrl}:`, error);
    return requestedBranch || 'main';
  }
}

// API function mapping
const API_FUNCTIONS: ApiFunctionMap = {
  [OperationType.TEXT]: generateTextEndpointApiRepoGenerateTextPost,
  [OperationType.GRAPH]: generateGraphEndpointApiRepoGenerateGraphPost,
  [OperationType.STRUCTURE]: generateStructureEndpointApiRepoGenerateStructurePost,
};

// Error messages mapping
const ERROR_MESSAGES = {
  [OperationType.TEXT]: {
    repo: 'Failed to fetch repository',
    zip: 'Failed to process zip file',
  },
  [OperationType.GRAPH]: {
    repo: 'Failed to generate graph from GitHub repository',
    zip: 'Failed to generate graph from ZIP file',
  },
  [OperationType.STRUCTURE]: {
    repo: 'Failed to generate structure from GitHub repository',
    zip: 'Failed to generate structure from ZIP file',
  },
};

/**
 * Generic function to handle all API operations (text, graph, structure)
 * for both GitHub repos and ZIP files
 */
async function executeOperation<T extends OperationType>(
  operationType: T,
  request: RepoRequest,
): Promise<ResponseMap[T]> {
  try {
    // Resolve the branch to use if it's a GitHub repo
    let resolvedBranch = request.branch || 'main';
    if (request.repo_url && request.repo_url.includes('github.com')) {
      resolvedBranch = await resolveBranch(request.repo_url, request.branch, request.access_token);
    }

    // Prepare the request data with resolved branch
    const requestData = {
      repo_url: request.repo_url || null,
      branch: resolvedBranch,
      access_token: request.access_token || null,
      jwt_token: request.jwt_token || null,
      zip_file: request.zip_file || null,
    };

    // Get the appropriate API function
    const apiFunction = API_FUNCTIONS[operationType];

    // Execute the API call with proper options structure
    const response = await apiFunction({
      body: requestData,
    });

    // Handle errors
    if (response.error) {
      const errorMessage = extractErrorMessage(response.error, operationType, request.zip_file);
      throw new Error(errorMessage);
    }

    // Validate response data
    if (!response.data) {
      throw new Error('No data received from server');
    }

    return response.data as ResponseMap[T];
  } catch (error) {
    handleApiError(error, operationType, request.zip_file);
    throw error; // This won't execute but TypeScript needs it
  }
}

/**
 * Extract error message from API response
 */
function extractErrorMessage(error: any, operationType: OperationType, isZipFile?: File): string {
  if (typeof error === 'string') {
    // Check for branch-related errors
    if (error.includes('Failed to download ZIP') && error.includes('Status: 404')) {
      return 'Repository branch not found. Please check if the branch exists or try using the repository\'s default branch.';
    }
    return error;
  }

  if (error?.detail) {
    if (typeof error.detail === 'string') {
      // Check for branch-related errors in detail
      if (error.detail.includes('Failed to download ZIP') && error.detail.includes('Status: 404')) {
        return 'Repository branch not found. Please check if the branch exists or try using the repository\'s default branch.';
      }
      return error.detail;
    }
    if (Array.isArray(error.detail)) {
      const errorMessages = error.detail.map((err: any) => err.msg || err.message || String(err));
      const joinedMessage = errorMessages.join(', ');
      
      // Check for branch-related errors in joined messages
      if (joinedMessage.includes('Failed to download ZIP') && joinedMessage.includes('Status: 404')) {
        return 'Repository branch not found. Please check if the branch exists or try using the repository\'s default branch.';
      }
      return joinedMessage;
    }
  }

  return ERROR_MESSAGES[operationType][isZipFile ? 'zip' : 'repo'];
}

/**
 * Handle API errors with proper error types
 */
function handleApiError(error: any, operationType: OperationType, isZipFile?: File): never {
  if (isTokenExpiredError(error)) {
    throw new TokenExpiredError();
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(ERROR_MESSAGES[operationType][isZipFile ? 'zip' : 'repo']);
}

// =============================================================================
// REPOSITORY OPERATIONS
// =============================================================================

/**
 * Generate LLM-friendly text from a GitHub repository
 */
export async function fetchGithubRepo(repoRequest: RepoRequest): Promise<TextResponse> {
  const response = await executeOperation(OperationType.TEXT, repoRequest);
  return {
    text_content: response.text_content || '',
    repo_id: response.repo_id || '',
    filename_suggestion: response.filename_suggestion,
  };
}

/**
 * Generate graph from GitHub repository
 */
export async function generateGraphFromGithub(repoRequest: RepoRequest): Promise<GraphResponse> {
  return executeOperation(OperationType.GRAPH, repoRequest);
}

/**
 * Generate structure from GitHub repository
 */
export async function generateStructureFromGithub(
  repoRequest: RepoRequest,
): Promise<StructureResponse> {
  return executeOperation(OperationType.STRUCTURE, repoRequest);
}

/**
 * Upload and process local ZIP file to generate text
 */
export async function uploadLocalZip(file: File, jwt_token: string): Promise<TextResponse> {
  const response = await executeOperation(OperationType.TEXT, {
    zip_file: file,
    jwt_token,
    branch: 'main',
  });
  return {
    text_content: response.text_content || '',
    repo_id: response.repo_id || '',
    filename_suggestion: response.filename_suggestion,
  };
}

/**
 * Generate graph from uploaded ZIP file
 */
export async function generateGraphFromZip(file: File, jwt_token: string): Promise<GraphResponse> {
  return executeOperation(OperationType.GRAPH, {
    zip_file: file,
    jwt_token,
    branch: 'main',
  });
}

/**
 * Generate structure from uploaded ZIP file
 */
export async function generateStructureFromZip(
  file: File,
  jwt_token: string,
): Promise<StructureResponse> {
  return executeOperation(OperationType.STRUCTURE, {
    zip_file: file,
    jwt_token,
    branch: 'main',
  });
}

/**
 * Get filename suggestion from repository
 */
export async function getFilenameSuggestion(repoRequest: RepoRequest): Promise<string> {
  const response = await executeOperation(OperationType.TEXT, repoRequest);
  return response.filename_suggestion || 'repository.txt';
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

/**
 * Get JWT token for authenticated user
 */
export async function getJwtToken(access_token: string): Promise<LoginResponse> {
  try {
    const authClient = getAuthClient();
    const response = await loginUserApiBackendAuthLoginPost({
      client: authClient,
      body: { access_token },
    });

    if (response.error) {
      const errorMessage = extractErrorMessage(response.error, OperationType.TEXT);
      throw new Error(errorMessage);
    }

    if (!response.data) {
      throw new Error('No authentication data received');
    }

    return response.data;
  } catch (error) {
    if (isTokenExpiredError(error)) {
      throw new TokenExpiredError();
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to get JWT token');
  }
}

/**
 * Refresh JWT token using refresh token
 */
export async function refreshJwtToken(refresh_token: string): Promise<{ access_token: string; expires_in: number }> {
  try {
    const authClient = getAuthClient();
    const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/backend-auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new TokenExpiredError();
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to refresh token');
    }

    const data = await response.json();
    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
    };
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw error;
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to refresh JWT token');
  }
}

// =============================================================================
// CHAT OPERATIONS
// =============================================================================

/**
 * Send a chat message and get response
 */
export async function sendChatMessage(chatRequest: ChatRequest): Promise<ChatResponse> {
  try {
    const response = await processChatMessageApiBackendChatChatPost({
      body: {
        token: chatRequest.token,
        message: chatRequest.message,
        repository_id: chatRequest.repository_id,
        use_user: chatRequest.use_user || false,
        chat_id: chatRequest.chat_id || null,
        conversation_id: chatRequest.conversation_id || null,
        provider: chatRequest.provider || 'openai',
        model: chatRequest.model || 'gpt-3.5-turbo',
        temperature: chatRequest.temperature || 0.7,
        max_tokens: chatRequest.max_tokens || null,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No chat response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Stream chat response
 */
export async function streamChatResponse(chatRequest: ChatRequest): Promise<Response> {
  try {
    const response = await streamChatResponseApiBackendChatChatStreamPost({
      body: {
        token: chatRequest.token,
        message: chatRequest.message,
        repository_id: chatRequest.repository_id,
        use_user: chatRequest.use_user || false,
        chat_id: chatRequest.chat_id || null,
        conversation_id: chatRequest.conversation_id || null,
        provider: chatRequest.provider || 'openai',
        model: chatRequest.model || 'gpt-3.5-turbo',
        temperature: chatRequest.temperature || 0.7,
        max_tokens: chatRequest.max_tokens || null,
      },
    });

    // For streaming, we return the raw response
    return response as any;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get list of user's chat sessions
 */
export async function getUserChatSessions(
  jwt_token: string,
  repository_identifier: string,
): Promise<ChatSessionListResponse> {
  try {
    const response = await listUserChatSessionsApiBackendChatSessionsPost({
      body: { jwt_token, repository_identifier },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No chat sessions data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get conversation history
 */
export async function getConversationHistory(
  token: string,
  conversationId: string,
): Promise<ConversationHistoryResponse> {
  try {
    const response = await getConversationHistoryApiBackendChatConversationsConversationIdPost({
      path: { conversation_id: conversationId },
      body: { token },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No conversation history received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get chat session details
 */
export async function getChatSession(token: string, chatId: string): Promise<ChatSessionResponse> {
  try {
    const response = await getChatSessionApiBackendChatSessionsChatIdPost({
      path: { chat_id: chatId },
      body: { token },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No chat session data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Verify user API key without saving
 */
export async function verifyApiKey(verifyRequest: {
  token: string;
  provider: string;
  api_key: string;
}): Promise<{
  success: boolean;
  provider: string;
  is_valid: boolean;
  message: string;
  available_models?: string[];
  model_configs?: Array<{
    name: string;
    max_tokens: number;
    max_output_tokens: number;
    supports_function_calling: boolean;
    supports_vision: boolean;
    is_reasoning_model: boolean;
    knowledge_cutoff: string | null;
  }>;
}> {
  try {
    const response = await verifyApiKeyBackendEnhanced({
      body: {
        token: verifyRequest.token,
        provider: verifyRequest.provider,
        api_key: verifyRequest.api_key,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No verification data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Save user API key (now with automatic verification by default)
 */
export async function saveApiKey(apiKeyRequest: ApiKeyRequest): Promise<ApiKeyResponse> {
  try {
    const response = await saveApiKeyBackendEnhanced({
      body: {
        token: apiKeyRequest.token,
        provider: apiKeyRequest.provider,
        api_key: apiKeyRequest.api_key,
        key_name: apiKeyRequest.key_name || null,
        verify_key: true, // Always verify by default
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No save response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get available models
 */
export async function getAvailableModels(token: string): Promise<AvailableModelsResponse> {
  try {
    const response = await getAvailableModelsBackendEnhanced({
      body: { token },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No models data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get user's saved API keys (without exposing actual keys)
 */
export async function getUserApiKeys(token: string): Promise<{
  success: boolean;
  keys: Array<{
    id: string;
    provider: string;
    key_name: string | null;
    created_at: string;
    updated_at: string;
    is_active: boolean;
  }>;
  total_keys: number;
}> {
  try {
    const response = await getUserApiKeysBackendEnhanced({
      body: { token },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No API keys data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Delete user's API key for a specific provider
 */
export async function deleteUserApiKey(
  token: string,
  provider: string,
  keyId?: string
): Promise<{
  success: boolean;
  message: string;
  provider: string;
  deleted_at: string;
}> {
  try {
    const response = await deleteUserApiKeyBackendEnhanced({
      body: {
        token,
        provider,
        key_id: keyId || null,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No delete response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get detailed available models with configurations
 */
export async function getDetailedAvailableModels(token: string, provider?: string): Promise<{
  success: boolean;
  providers: string[];
  models: Record<string, string[]>;
  detailed_models: Record<string, Array<{
    name: string;
    max_tokens: number;
    max_output_tokens: number;
    supports_function_calling: boolean;
    supports_vision: boolean;
    is_reasoning_model: boolean;
    knowledge_cutoff: string | null;
    cost_per_1M_input: number;
    cost_per_1M_output: number;
  }>>;
  user_has_keys: string[];
  total_models: number;
}> {
  try {
    const response = await getAvailableModelsBackendEnhanced({
      body: {
        token,
        provider: provider || null,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No detailed models data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get model configuration for a specific model
 */
export async function getModelConfig(
  provider: string,
  model: string
): Promise<{
  success: boolean;
  provider: string;
  model: string;
  config: {
    max_tokens: number;
    max_output_tokens: number;
    cost_per_1M_input: number;
    cost_per_1M_output: number;
    cost_per_1M_cached_input: number;
    supports_function_calling: boolean;
    supports_vision: boolean;
    knowledge_cutoff: string | null;
    is_reasoning_model: boolean;
  };
}> {
  try {
    const response = await getModelConfigBackendEnhanced({
      path: { provider, model },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No model config data received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
    throw error; // Add explicit throw since handleApiError doesn't return never in this context
  }
}

// =============================================================================
// CHAT SETTINGS
// =============================================================================

/**
 * Update chat settings
 */
export async function updateChatSettings(
  token: string,
  chatId: string,
  settings: {
    title?: string;
    default_provider?: string;
    default_model?: string;
    default_temperature?: number;
  },
): Promise<ChatSettingsResponse> {
  try {
    const response = await updateChatSettingsApiBackendChatSettingsPost({
      body: {
        token,
        chat_id: chatId,
        title: settings.title || null,
        default_provider: settings.default_provider || null,
        default_model: settings.default_model || null,
        default_temperature: settings.default_temperature || null,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No settings response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

// =============================================================================
// CONTEXT SEARCH
// =============================================================================

/**
 * Search repository context
 */
export async function searchContext(
  token: string,
  repositoryId: string,
  query: string,
  maxResults: number = 5,
): Promise<ContextSearchResponse> {
  try {
    const response = await searchContextApiBackendChatContextSearchPost({
      body: {
        token,
        repository_id: repositoryId,
        query,
        max_results: Math.min(Math.max(maxResults, 1), 20), // Ensure between 1-20
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No search results received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

// =============================================================================
// UTILITY FUNCTIONS AND ERROR HANDLING
// =============================================================================

export class TokenExpiredError extends Error {
  constructor(message = 'Token expired') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

function isTokenExpiredError(error: any): boolean {
  if (!error) return false;
  const msg = typeof error === 'string' ? error : error?.message || error?.toString();
  return (
    msg?.toLowerCase().includes('token has expired') ||
    msg?.toLowerCase().includes('jwt expired') ||
    msg?.toLowerCase().includes('expired token') ||
    msg?.toLowerCase().includes('unauthorized')
  );
}

// =============================================================================
// WIKI DOCUMENTATION OPERATIONS
// =============================================================================
/**
 * Generate wiki documentation for a repository
 * Starts the process of generating wiki documentation. The task runs in the background.
 */
export async function generateWikiDocumentation(
  jwt_token: string,
  repository_url: string,
  language: string = 'en',
  comprehensive: boolean = true,
  provider: string,
  model?: string,
  temperature?: number,
): Promise<any> {
  try {
    const response = await generateWikiApiDocumentationGenerateWikiPost({
      body: {
        jwt_token,
        repository_url,
        language,
        comprehensive,
        provider_name: provider,
        model_name: model,
        temperature,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No wiki generation response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Get wiki generation status
 * Retrieves the current status of a wiki generation task using the provided task ID.
 */
export async function getWikiGenerationStatus(jwt_token: string, repo_id: string): Promise<any> {
  try {
    const response = await getWikiStatusApiDocumentationWikiStatusPost({
      body: {
        jwt_token,
        repo_id,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No wiki status response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * List repository documentation files
 * Lists all documentation files for a specific repository with parsed content.
 */
export async function getRepositoryDocumentation(jwt_token: string, repo_id: string): Promise<any> {
  try {
    const response = await listRepositoryDocsApiDocumentationRepositoryDocsPost({
      body: {
        jwt_token,
        repo_id,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No repository documentation response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Is wiki documentation generated?
 * Checks if wiki documentation has been generated for a specific repository.
 */
export async function isWikiGenerated(
  jwt_token: string,
  repo_id: string,
): Promise<IsWikiGeneratedApiDocumentationIsWikiGeneratedPostResponse> {
  console.log(jwt_token);
  try {
    const response = await isWikiGeneratedApiDocumentationIsWikiGeneratedPost({
      body: {
        jwt_token,
        repo_id,
      },
    });

    if (response.error) {
      throw new Error(extractErrorMessage(response.error, OperationType.TEXT));
    }

    if (!response.data) {
      throw new Error('No wiki generation status response received');
    }

    return response.data;
  } catch (error) {
    handleApiError(error, OperationType.TEXT);
  }
}

/**
 * Cancel wiki documentation generation
 */
export async function cancelWikiGeneration(jwt_token: string, task_id: string): Promise<any> {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';
    const formData = new FormData();
    formData.append('jwt_token', jwt_token);
    
    const response = await fetch(`${backendUrl}/api/documentation/cancel-generation/${task_id}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel generation: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}

// =============================================================================
// UNIVERSAL PROCESSING FUNCTION
// =============================================================================

/**
 * Universal function that can handle any operation type and source (repo/zip)
 * Usage examples:
 *   - processRepository('text', { repo_url: 'https://github.com/user/repo', jwt_token: 'xxx' })
 *   - processRepository('graph', { zip_file: file, jwt_token: 'xxx' })
 */
export async function processRepository<T extends OperationType>(
  operationType: T,
  request: RepoRequest,
): Promise<ResponseMap[T]> {
  return executeOperation(operationType, request);
}
