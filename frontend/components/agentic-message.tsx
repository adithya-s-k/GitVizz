'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Bot, 
  User, 
  Copy, 
  Check, 
  Clock, 
  Code, 
  FileText, 
  Brain, 
  Search, 
  Cog, 
  CheckCircle, 
  XCircle, 
  ChevronDown, 
  ChevronRight,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from 'next-themes';

export interface AgenticMessage {
  role: 'user' | 'assistant' | 'system' | 'agent_thinking' | 'tool_call';
  content: string;
  timestamp: Date;
  tool_name?: string;
  tool_result?: Record<string, any>;
  metadata?: Record<string, unknown> | null;
}

interface AgenticToolCall {
  tool_name: string;
  status: 'in_progress' | 'completed' | 'error';
  parameters?: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  timestamp: Date;
}

interface AgenticChatMessageProps {
  message: AgenticMessage;
  toolCalls?: AgenticToolCall[];
  isStreaming?: boolean;
}

export function AgenticChatMessage({ message, toolCalls, isStreaming }: AgenticChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [showToolDetails, setShowToolDetails] = useState(false);
  const { theme } = useTheme();
  const isUser = message.role === 'user';
  const isAgent = message.role === 'agent_thinking';
  const isToolCall = message.role === 'tool_call';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getToolIcon = (toolName?: string) => {
    switch (toolName) {
      case 'search_api_routes':
        return <Search className="h-4 w-4" />;
      case 'search_code_by_keywords':
        return <Code className="h-4 w-4" />;
      case 'get_file_structure':
        return <FileText className="h-4 w-4" />;
      default:
        return <Cog className="h-4 w-4" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  // Agent thinking message
  if (isAgent) {
    return (
      <div className="flex gap-3 mb-4">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300 mb-1">
              <Brain className="h-3 w-3" />
              Agent Thinking
              {isStreaming && (
                <div className="flex gap-1">
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse delay-100"></div>
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse delay-200"></div>
                </div>
              )}
            </div>
            <p className="text-sm text-blue-700 dark:text-blue-300">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  // Tool call message
  if (isToolCall) {
    return (
      <div className="flex gap-3 mb-4">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            {getToolIcon(message.tool_name)}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  {getToolIcon(message.tool_name)}
                  {message.tool_name || 'Tool Call'}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {formatTime(message.timestamp)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-2">{message.content}</p>
              
              {message.tool_result && (
                <Collapsible>
                  <CollapsibleTrigger
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowToolDetails(!showToolDetails)}
                  >
                    {showToolDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    View Details
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className="bg-muted rounded p-2 text-xs font-mono max-h-32 overflow-y-auto">
                      <pre>{JSON.stringify(message.tool_result, null, 2)}</pre>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Regular user or assistant message
  return (
    <div className={cn("flex gap-3 mb-4", isUser && "justify-end")}>
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
        </div>
      )}
      
      <div className={cn("flex-1 min-w-0 max-w-[85%]", isUser && "max-w-[70%]")}>
        <div
          className={cn(
            "rounded-lg p-4 relative group",
            isUser
              ? "bg-primary text-primary-foreground ml-auto"
              : "bg-muted/50 border border-border/50"
          )}
        >
          {/* Tool calls summary */}
          {toolCalls && toolCalls.length > 0 && !isUser && (
            <div className="mb-3 space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Zap className="h-3 w-3" />
                Used {toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''}
              </div>
              <div className="flex flex-wrap gap-1">
                {toolCalls.map((tool, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="text-xs flex items-center gap-1"
                  >
                    {getStatusIcon(tool.status)}
                    {tool.tool_name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {/* Message content */}
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const isInline = !match;
                  
                  return !isInline ? (
                    <SyntaxHighlighter
                      style={theme === 'dark' ? oneDark : oneLight}
                      language={match[1]}
                      PreTag="div"
                      className="rounded-md"
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Copy button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>

          {/* Timestamp */}
          <div className="text-xs text-muted-foreground mt-2 opacity-70">
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
        </div>
      )}
    </div>
  );
}