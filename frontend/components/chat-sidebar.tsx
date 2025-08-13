'use client';

import React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Send,
  History,
  Key,
  Bot,
  Loader2,
  X,
  Plus,
  ChevronDown,
  Sparkles,
  Brain,
  AlertTriangle,
  Database,
  Zap,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatHistory } from './chat-history';
import { ChatMessage } from './chat-message';
import { ModelSelector } from './model-selector';
import { ContextIndicator, ContextMetadata } from './context-indicator';
import { ApiKeyModal } from './api-key-modal';
import { useChatSidebar } from '@/hooks/use-chat-sidebar';
import { useApiKeyValidation } from '@/hooks/use-api-key-validation';

type ContextMode = 'full' | 'smart' | 'agentic';

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryIdentifier: string; // Format: owner/repo/branch
  repositoryName: string;
  repositoryBranch?: string;
  userKeyPreferences?: Record<string, boolean>;
}

interface LoadingState {
  stage: 'initializing' | 'processing' | 'thinking' | 'generating';
  message: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

export function ChatSidebar({
  isOpen,
  onClose,
  repositoryIdentifier,
  repositoryName,
  repositoryBranch = 'main',
  userKeyPreferences = {},
}: ChatSidebarProps) {
  const router = useRouter();
  const {
    messages,
    isLoading,
    currentModel,
    availableModels,
    chatHistory,
    sendMessage,
    loadConversation,
    clearCurrentChat,
    setModel,
    refreshModels,
    isLoadingHistory,
    contextSettings,
    setContextSettings,
  } = useChatSidebar(repositoryIdentifier, userKeyPreferences, {
    autoLoad: isOpen && Boolean(repositoryIdentifier),
    repositoryBranch,
  });

  const apiKeyValidation = useApiKeyValidation();

  // UI State
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState('42vw');
  const [isResizing, setIsResizing] = useState(false);
  // Remove unused lastDailyUsage state - daily usage is handled in the hook

  // Context Mode State
  const [contextMode, setContextMode] = useState<ContextMode>('full');
  const [loadingState, setLoadingState] = useState<LoadingState>({
    stage: 'initializing',
    message: 'Starting conversation...',
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Context mode configurations
  const contextModeConfig = {
    full: {
      label: 'Full Context',
      description: 'Include entire repository content',
      icon: Database,
      color:
        'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
      available: true,
    },
    smart: {
      label: 'Smart Context',
      description: 'AI-powered retrieval for relevant code',
      icon: Brain,
      color:
        'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
      available: false,
    },
    agentic: {
      label: 'Agentic Context',
      description: 'Multi-step reasoning with tool usage',
      icon: Zap,
      color:
        'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
      available: false,
    },
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Update loading state based on isLoading and context mode
  useEffect(() => {
    if (isLoading) {
      // Set a single, stable loading state instead of cycling animations
      setLoadingState({
        stage: 'thinking',
        message: contextMode === 'full' 
          ? 'Processing repository context and generating response...' 
          : 'Analyzing code and crafting response...'
      });
    }
  }, [isLoading, contextMode]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // Check if repository identifier is valid before proceeding
    if (!repositoryIdentifier || repositoryIdentifier.trim() === '' || !repositoryIdentifier.includes('/')) {
      // Repository identifier should be in format: owner/repo/branch
      return;
    }

    // Check for API keys before sending message
    const canProceed = await apiKeyValidation.checkApiKeysBeforeAction();
    if (!canProceed) return;

    // Show warning for unavailable context modes
    if (!contextModeConfig[contextMode].available) {
      // For now, fallback to full mode (which is available)
      setContextMode('full');
    }

    const message = input.trim();
    setInput('');

    try {
      // Update context settings based on mode
      const modeContextSettings = {
        ...contextSettings,
        includeFullContext: contextMode === 'full',
        scope: (contextMode === 'full' ? 'comprehensive' : 'moderate') as
          | 'focused'
          | 'moderate'
          | 'comprehensive',
      };

      setContextSettings(modeContextSettings);

      const response = await sendMessage(message);
      // Daily usage is handled in the hook itself
      console.log('Message sent successfully', response);
    } catch {
      // sendMessage already handles errors
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidthPx = window.innerWidth - e.clientX;
      const minWidthPx = 320;
      const minWidthVw = (minWidthPx / window.innerWidth) * 100;
      const maxWidthVw = 100;
      let newWidthVw = (newWidthPx / window.innerWidth) * 100;
      if (newWidthVw < minWidthVw) newWidthVw = minWidthVw;
      if (newWidthVw > maxWidthVw) newWidthVw = maxWidthVw;
      setSidebarWidth(`${newWidthVw}vw`);
    },
    [isResizing],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleApiKeysClick = () => {
    router.push('/api-keys');
  };

  const hasActiveChat = messages.length > 0;

  // Get user keys info for display
  const userHasKeys = availableModels?.user_has_keys || [];
  const activeUserKeys = userHasKeys.filter((key) => userKeyPreferences[key] !== false);

  // Check if repository is ready for chat
  const isRepositoryReady = repositoryIdentifier && repositoryIdentifier.trim() !== '' && repositoryIdentifier.includes('/');

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full bg-background/95 backdrop-blur-xl border-l border-border/50 shadow-2xl z-50 transition-all duration-300 ease-out flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          // Responsive width: full width on mobile, variable on larger screens
          'w-full sm:w-auto',
        )}
        style={{
          width:
            typeof window !== 'undefined' && window.innerWidth >= 640
              ? typeof sidebarWidth === 'string'
                ? sidebarWidth
                : `${sidebarWidth}px`
              : '100%',
        }}
      >
        {/* Resize Handle - Only on larger screens */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize group z-10 items-center justify-center hover:bg-primary/5 transition-colors hidden sm:flex"
          onMouseDown={handleMouseDown}
        >
          <div className="w-1 h-8 bg-border/40 rounded-full group-hover:bg-primary/60 transition-colors relative">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
              <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
              <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
              <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
            </div>
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="bg-popover text-popover-foreground text-xs px-2 py-1 rounded-md shadow-md whitespace-nowrap">
              Drag to resize
            </div>
          </div>
        </div>

        {/* Header with Quick Actions */}
        <div className="border-b border-border/30">
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                {isLoading && (
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" />
                )}
              </div>
              <div>
                <h2 className="font-medium text-xs text-foreground">AI Assistant</h2>
                <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                  {repositoryName}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6 rounded hover:bg-muted/50"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Quick Actions Row */}
          <div className="px-3 pb-3 flex items-center justify-between gap-2">
            <div className="flex gap-2 flex-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(true)}
                className="h-7 text-xs flex-1"
              >
                <History className="h-3 w-3 mr-1" />
                History
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleApiKeysClick}
                className="h-7 text-xs flex-1"
              >
                <Key className="h-3 w-3 mr-1" />
                API Keys
              </Button>
            </div>

            {/* Status Indicators */}
            <div className="flex items-center gap-2">
              {hasActiveChat && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  {messages.length}
                </Badge>
              )}
              {activeUserKeys.length > 0 ? (
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                    {activeUserKeys.length}
                  </span>
                </div>
              ) : (
                <AlertTriangle className="h-3 w-3 text-orange-500" />
              )}
            </div>
          </div>
        </div>

        {/* Messages Area - Primary Focus */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ScrollArea
            ref={scrollAreaRef}
            className="flex-1"
            style={{ height: 'calc(100vh - 280px)' }}
          >
            <div className="px-4 py-6 space-y-6 pb-4 w-full">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[350px] text-center space-y-8 px-6">
                  <div className="relative">
                    <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 flex items-center justify-center border border-blue-200/50 dark:border-blue-800/50 shadow-lg">
                      <Sparkles className="h-10 w-10 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse shadow-sm" />
                  </div>
                  <div className="space-y-4 max-w-[320px]">
                    <div>
                      <h3 className="font-semibold text-xl text-gray-900 dark:text-gray-100">Ready to help!</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                        Ask me anything about <span className="font-medium text-blue-600 dark:text-blue-400">{repositoryName}</span> - code structure, functionality, best practices, or specific implementations.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <Badge variant="secondary" className="text-xs px-3 py-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                      Code Analysis
                    </Badge>
                    <Badge variant="secondary" className="text-xs px-3 py-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800">
                      Architecture
                    </Badge>
                    <Badge variant="secondary" className="text-xs px-3 py-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800">
                      Documentation
                    </Badge>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <div
                      key={`${index}-${message.timestamp.getTime()}`}
                      className="w-full space-y-2"
                    >
                      <ChatMessage message={message} />
                      {/* Show context indicator for assistant messages with context metadata */}
                      {message.role === 'assistant' && message.context_metadata && (
                        <div className="ml-2 mr-1">
                          <ContextIndicator
                            contextMetadata={message.context_metadata as ContextMetadata}
                            className="text-xs"
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  {isLoading && (
                    <div className="mx-1 p-4 rounded-2xl bg-gradient-to-r from-purple-50/80 to-blue-50/80 dark:from-purple-950/30 dark:to-blue-950/30 border border-purple-200/50 dark:border-purple-800/50 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/50 dark:to-blue-900/50 flex items-center justify-center border border-purple-200/50 dark:border-purple-700/50">
                            <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" />
                        </div>
                        <div className="space-y-2 min-w-0 flex-1">
                          <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                            {loadingState.message}
                          </p>
                          <div className="flex items-center gap-2">
                            <div className="h-1 bg-gradient-to-r from-purple-200 to-blue-200 dark:from-purple-800 dark:to-blue-800 rounded-full overflow-hidden flex-1">
                              <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse w-3/4" />
                            </div>
                            <span className="text-xs text-purple-600 dark:text-purple-400">Thinking...</span>
                          </div>
                          {loadingState.functionCall && (
                            <div className="mt-2 p-2 rounded-md bg-orange-50/80 dark:bg-orange-950/30 border border-orange-200/50 dark:border-orange-800/50">
                              <div className="flex items-center gap-1.5">
                                <Cpu className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                                <span className="text-xs font-medium text-orange-800 dark:text-orange-200">
                                  Calling: {loadingState.functionCall.name}
                                </span>
                              </div>
                              <div className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                {Object.keys(loadingState.functionCall.args).length > 0 &&
                                  `Args: ${Object.keys(loadingState.functionCall.args).join(', ')}`}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Input and Controls Area */}
        <div className="border-t border-border/30 bg-background/95 backdrop-blur-sm">
          <div className="p-3 space-y-3">
            {/* Context Mode Selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Context Mode
              </label>

              <Select
                value={contextMode}
                onValueChange={(value: ContextMode) => setContextMode(value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <div className="flex items-center gap-2 flex-1">
                    {React.createElement(contextModeConfig[contextMode].icon, {
                      className: 'h-3 w-3',
                    })}
                    <SelectValue />
                    {!contextModeConfig[contextMode].available && (
                      <Badge variant="secondary" className="text-[9px] h-3 px-1 ml-auto">
                        Soon
                      </Badge>
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(contextModeConfig).map(([key, config]) => {
                    // const IconComponent = config.icon;
                    return (
                      <SelectItem key={key} value={key} disabled={!config.available}>
                        <div className="flex items-center gap-2">
                          {/* <IconComponent className="h-3.5 w-3.5" /> */}
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{config.label}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {config.description}
                            </span>
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Model Selection Accordion - Open by Default */}
            <Collapsible defaultOpen>
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between h-8 text-xs hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="h-3 w-3" />
                    <span>AI Model</span>
                    <Badge variant="secondary" className="text-[9px] h-3 px-1">
                      {currentModel?.model || 'Select'}
                    </Badge>
                  </div>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3">
                <ModelSelector
                  currentModel={currentModel}
                  availableModels={availableModels}
                  onModelChange={setModel}
                  onRefresh={refreshModels}
                />

                {/* New Chat Button */}
                {hasActiveChat && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearCurrentChat}
                    className="w-full h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    New Chat
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Input Row */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={
                    !isRepositoryReady 
                      ? "Repository processing..." 
                      : `Ask about ${repositoryName}...`
                  }
                  disabled={isLoading || !contextModeConfig[contextMode].available || !isRepositoryReady}
                  className="h-9 text-sm rounded-lg border-border/50 focus:border-primary/50 focus:ring-primary/20 disabled:opacity-60"
                />
                {!contextModeConfig[contextMode].available && (
                  <div className="absolute inset-y-0 right-2 flex items-center">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      Coming Soon
                    </Badge>
                  </div>
                )}
                {!isRepositoryReady && (
                  <div className="absolute inset-y-0 right-2 flex items-center">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-orange-50 text-orange-700 border-orange-200">
                      Processing
                    </Badge>
                  </div>
                )}
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!input.trim() || isLoading || !contextModeConfig[contextMode].available || !isRepositoryReady}
                size="icon"
                className="h-9 w-9 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 flex-shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Chat History Dialog */}
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[80vh] m-4">
              <div className="p-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Chat History</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowHistory(false)}
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="p-6">
                <ChatHistory
                  history={chatHistory}
                  onLoadConversation={loadConversation}
                  onClose={() => setShowHistory(false)}
                  isLoading={isLoadingHistory}
                />
              </div>
            </div>
          </div>
        )}

        {/* API Key Modal */}
        <ApiKeyModal
          isOpen={apiKeyValidation.showApiKeyModal}
          onClose={() => apiKeyValidation.setShowApiKeyModal(false)}
          userHasKeys={apiKeyValidation.userHasKeys}
          availableProviders={apiKeyValidation.availableProviders}
        />
      </div>
    </>
  );
}
