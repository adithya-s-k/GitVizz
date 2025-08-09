'use client';

import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Send,
  History,
  Key,
  Bot,
  Loader2,
  X,
  Plus,
  Settings,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ExternalLink,
  Brain,
  Zap,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatHistory } from './chat-history';
import { ChatMessage } from './chat-message';
import { AgenticChatMessage } from './agentic-message';
import { ModelSelector } from './model-selector';
import { ContextIndicator, ContextMetadata } from './context-indicator';
import { ContextControls } from './context-controls';
import { useChatSidebar } from '@/hooks/use-chat-sidebar';
import { useAgenticChat } from '@/hooks/use-agentic-chat';

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryId: string;
  repositoryName: string;
  userKeyPreferences?: Record<string, boolean>; // New prop for user key preferences
}

export function ChatSidebar({
  isOpen,
  onClose,
  repositoryId,
  repositoryName,
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
  } = useChatSidebar(repositoryId, userKeyPreferences, {
    autoLoad: isOpen && Boolean(repositoryId),
  }); // Pass preferences to hook

  // Agentic chat functionality
  const {
    messages: agenticMessages,
    toolCalls: agenticToolCalls,
    isLoading: isAgenticLoading,
    streamingContent: agenticStreamingContent,
    sendMessage: sendAgenticMessage,
    clearChat: clearAgenticChat,
  } = useAgenticChat(repositoryId);

  const [input, setInput] = useState('');
  const [useAgenticMode, setUseAgenticMode] = useState(true); // Default to agentic mode
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showContextControls, setShowContextControls] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState('40vw');
  const [isResizing, setIsResizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const currentMessages = useAgenticMode ? agenticMessages : messages;
  const currentIsLoading = useAgenticMode ? isAgenticLoading : isLoading;
  
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [currentMessages, agenticStreamingContent]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!input.trim() || currentIsLoading) return;

    const message = input.trim();
    setInput('');

    if (useAgenticMode) {
      await sendAgenticMessage(message, currentModel?.model, currentModel?.provider);
    } else {
      await sendMessage(message);
    }
  };

  const handleClearChat = () => {
    if (useAgenticMode) {
      clearAgenticChat();
    } else {
      clearCurrentChat();
    }
  };

  const toggleChatMode = () => {
    setUseAgenticMode(!useAgenticMode);
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

  const hasActiveChat = currentMessages.length > 0;

  // Get user keys info for display
  const userHasKeys = availableModels?.user_has_keys || [];
  const activeUserKeys = userHasKeys.filter((key) => userKeyPreferences[key] !== false);

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
        )}
        style={{ width: typeof sidebarWidth === 'string' ? sidebarWidth : `${sidebarWidth}px` }}
      >
        {/* Resize Handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize group z-10 flex items-center justify-center hover:bg-primary/5 transition-colors"
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

        {/* Header - Prominent and Clean */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent" />
          <div className="relative flex items-center justify-between p-6 border-b border-border/30">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                {isLoading && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-base text-foreground">Repository Chat</h2>
                  {useAgenticMode && (
                    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Agentic
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                  {repositoryName}
                </p>
                <div className="flex items-center gap-2">
                  {hasActiveChat && (
                    <Badge variant="secondary" className="text-xs">
                      {currentMessages.length} messages
                    </Badge>
                  )}
                  {activeUserKeys.length > 0 && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                    >
                      {activeUserKeys.length} key{activeUserKeys.length !== 1 ? 's' : ''} active
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-xl hover:bg-muted/50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Quick Actions - Collapsible for Focus */}
        <div className="border-b border-border/30">
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between p-4 h-auto rounded-none hover:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span className="text-sm font-medium">Chat Settings</span>
                </div>
                {showSettings ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4 space-y-4">
              {/* Agentic Mode Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Agentic Mode</span>
                    {useAgenticMode && <Badge variant="secondary" className="text-xs">Beta</Badge>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleChatMode}
                    className="h-6 w-12 p-0 rounded-full relative bg-muted"
                  >
                    {useAgenticMode ? (
                      <>
                        <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-purple-500 rounded-full transition-all duration-200" />
                        <Zap className="h-3 w-3 text-white relative z-10" />
                      </>
                    ) : (
                      <>
                        <div className="absolute right-0.5 top-0.5 w-5 h-5 bg-gray-400 rounded-full transition-all duration-200" />
                        <Bot className="h-3 w-3 text-white relative z-10" />
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {useAgenticMode 
                    ? "AI uses tools and multi-stage reasoning for better answers"
                    : "Standard chat mode"
                  }
                </p>
              </div>

              <Separator />

              {/* Model Selector */}
              <div className="space-y-3">
                <ModelSelector
                  currentModel={currentModel}
                  availableModels={availableModels}
                  onModelChange={setModel}
                  onRefresh={refreshModels}
                />
              </div>

              {/* API Keys Status */}
              {userHasKeys.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">API Keys</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleApiKeysClick}
                        className="text-xs h-6 px-2"
                      >
                        Manage
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {activeUserKeys.length > 0 ? (
                        <>
                          <span className="text-green-600 dark:text-green-400">
                            {activeUserKeys.length} user key{activeUserKeys.length !== 1 ? 's' : ''}{' '}
                            active
                          </span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {activeUserKeys.map((key) => (
                              <Badge
                                key={key}
                                variant="outline"
                                className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                              >
                                {key}
                              </Badge>
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Using system keys (rate limited)
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHistory(true)}
                  className="justify-start"
                >
                  <History className="h-4 w-4 mr-2" />
                  History
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApiKeysClick}
                  className="justify-start"
                >
                  <Key className="h-4 w-4 mr-2" />
                  API Keys
                </Button>
              </div>

              {/* Chat Management */}
              {hasActiveChat && (
                <>
                  <Separator />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearChat}
                    className="w-full justify-start"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Start New Chat
                  </Button>
                </>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Context Controls Section */}
          <Collapsible open={showContextControls} onOpenChange={setShowContextControls}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between p-4 h-auto rounded-none hover:bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  <span className="text-sm font-medium">Smart Context</span>
                  <Badge variant="outline" className="text-xs">
                    {contextSettings.scope}
                  </Badge>
                </div>
                {showContextControls ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4">
              <ContextControls
                settings={contextSettings}
                onSettingsChange={setContextSettings}
                disabled={isLoading}
                isProcessing={isLoading}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Messages Area - Primary Focus */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ScrollArea
            ref={scrollAreaRef}
            className="flex-1"
            style={{ height: 'calc(100vh - 280px)' }}
          >
            <div className="px-3 py-10 space-y-4 pb-4 w-full">
              {currentMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center space-y-6 px-4">
                  <div className="relative">
                    <div className={cn(
                      "w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br flex items-center justify-center border",
                      useAgenticMode 
                        ? "from-purple-600/20 to-purple-600/10 border-purple-600/20" 
                        : "from-primary/20 to-primary/10 border-primary/20"
                    )}>
                      {useAgenticMode ? (
                        <Zap className="h-8 w-8 text-purple-600" />
                      ) : (
                        <Sparkles className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
                  </div>
                  <div className="space-y-3 max-w-[280px]">
                    <h3 className="font-semibold text-lg text-foreground">
                      {useAgenticMode ? "Agentic AI Ready!" : "Ready to help!"}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {useAgenticMode 
                        ? "I'll use multiple search tools and reasoning steps to give you comprehensive answers about this repository."
                        : "Ask me anything about this repository - code structure, functionality, best practices, or specific implementations."
                      }
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {useAgenticMode ? (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          Multi-Tool Search
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Reasoning Steps
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Smart Context
                        </Badge>
                      </>
                    ) : (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          Code Analysis
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Architecture
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Documentation
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {useAgenticMode ? (
                    // Agentic Messages
                    currentMessages.map((message, index) => (
                      <AgenticChatMessage
                        key={`agentic-${index}-${message.timestamp.getTime()}`}
                        message={message}
                        toolCalls={agenticToolCalls}
                        isStreaming={currentIsLoading && index === currentMessages.length - 1}
                      />
                    ))
                  ) : (
                    // Regular Messages
                    currentMessages.map((message, index) => (
                      <div
                        key={`regular-${index}-${message.timestamp.getTime()}`}
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
                    ))
                  )}

                  {/* Show streaming content for agentic mode */}
                  {useAgenticMode && agenticStreamingContent && (
                    <AgenticChatMessage
                      message={{
                        role: 'assistant',
                        content: agenticStreamingContent,
                        timestamp: new Date(),
                      }}
                      isStreaming={true}
                    />
                  )}

                  {currentIsLoading && (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/30 border border-border/30 mx-1">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                        useAgenticMode ? "bg-purple-600/10" : "bg-primary/10"
                      )}>
                        {useAgenticMode ? (
                          <Brain className="h-4 w-4 animate-pulse text-purple-600" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                      </div>
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {useAgenticMode ? "AI is reasoning..." : "AI is thinking..."}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {useAgenticMode ? "Using tools to analyze your question" : "Analyzing your question"}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Input Area - Always Visible and Prominent */}
        <div className="border-t border-border/30 bg-background/80 backdrop-blur-sm">
          <div className="p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={useAgenticMode 
                    ? "Ask anything - I'll use tools to find the best answer..."
                    : "Ask about the repository..."
                  }
                  disabled={currentIsLoading}
                  className="pr-12 h-11 rounded-xl border-border/50 focus:border-primary/50 focus:ring-primary/20"
                />
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!input.trim() || currentIsLoading}
                size="icon"
                className={cn(
                  "h-11 w-11 rounded-xl disabled:opacity-50",
                  useAgenticMode 
                    ? "bg-purple-600 hover:bg-purple-700" 
                    : "bg-primary hover:bg-primary/90"
                )}
              >
                {currentIsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : useAgenticMode ? (
                  <Zap className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
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
      </div>
    </>
  );
}
