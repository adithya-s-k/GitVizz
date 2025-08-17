'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Bot,
  User,
  Copy,
  Check,
  Clock,
  Code,
  Cpu,
  Zap,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from 'next-themes';

// Helper component for collapsible tool results
function CollapsibleToolResult({ result }: { result: unknown }) {
  const [isOpen, setIsOpen] = useState(false);
  const resultString = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  return (
    <div className="space-y-1 mt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-green-600 dark:text-green-400" />
          <span className="text-xs font-medium text-green-700 dark:text-green-300">Result:</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="h-6 px-1 text-xs"
        >
          {isOpen ? 'Hide' : 'Show'}
          {isOpen ? (
            <ChevronUp className="h-3 w-3 ml-1" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-1" />
          )}
        </Button>
      </div>
      {isOpen && (
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-2 text-xs">
          <pre className="whitespace-pre-wrap text-green-800 dark:text-green-200">
            {resultString}
          </pre>
        </div>
      )}
    </div>
  );
}

interface FunctionCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'calling' | 'complete' | 'error';
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  context_used?: string | null;
  metadata?: Record<string, unknown> | null;
  function_calls?: FunctionCall[];
  reasoning?: string | null;
  is_reasoning_model?: boolean;
  isLoading?: boolean;
}

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // This flag identifies messages that are ONLY for displaying tool calls
  const isToolCallMessage =
    !isUser && !message.content && message.function_calls && message.function_calls.length > 0;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-4 w-max-full">
        <div className="bg-muted/50 text-muted-foreground text-xs px-3 py-1 rounded-full border border-border/30">
          {message.content}
        </div>
      </div>
    );
  }

  // Render a unique, simplified UI for tool call messages
  if (isToolCallMessage) {
    return (
      <div className="group flex gap-3 w-full mb-4">
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center border shadow-sm bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700">
            <Bot className="h-4 w-4" />
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-2 max-w-[85%]">
          {message.function_calls?.map((call, index) => {
            const getStatusIcon = () => {
              switch (call.status) {
                case 'calling':
                  return (
                    <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
                  );
                case 'complete':
                  return <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />;
                case 'error':
                  return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
                default:
                  return <Cpu className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
              }
            };
            const getColors = () => {
              switch (call.status) {
                case 'calling':
                  return {
                    border: 'border-blue-200 dark:border-blue-800',
                    bg: 'bg-blue-50 dark:bg-blue-950/20',
                    text: 'text-blue-800 dark:text-blue-200',
                    icon: 'text-blue-600 dark:text-blue-400',
                  };
                case 'complete':
                  return {
                    border: 'border-green-200 dark:border-green-800',
                    bg: 'bg-green-50 dark:bg-green-950/20',
                    text: 'text-green-800 dark:text-green-200',
                    icon: 'text-green-600 dark:text-green-400',
                  };
                case 'error':
                  return {
                    border: 'border-red-200 dark:border-red-800',
                    bg: 'bg-red-50 dark:bg-red-950/20',
                    text: 'text-red-800 dark:text-red-200',
                    icon: 'text-red-600 dark:text-red-400',
                  };
                default:
                  return {
                    border: 'border-orange-200 dark:border-orange-800',
                    bg: 'bg-orange-50 dark:bg-orange-950/20',
                    text: 'text-orange-800 dark:text-orange-200',
                    icon: 'text-orange-600 dark:text-orange-400',
                  };
              }
            };
            const colors = getColors();

            const getToolDisplayName = (toolName: string) => {
              const toolDisplayNames: Record<string, string> = {
                analyze_code_structure: 'Code Structure Analysis',
                search_code_patterns: 'Pattern Search',
                find_code_quality_issues: 'Quality Analysis',
                analyze_dependencies_and_flow: 'Dependency Analysis',
                find_security_and_testing_insights: 'Security & Testing',
                get_repository_statistics: 'Repository Statistics',
              };
              return toolDisplayNames[toolName] || toolName.replace(/_/g, ' ');
            };

            const getToolDescription = (toolName: string, args: Record<string, unknown>) => {
              const descriptions: Record<string, (args: Record<string, unknown>) => string> = {
                analyze_code_structure: (args) =>
                  args.query ? `Analyzing: "${args.query}"` : 'Analyzing overall code structure',
                search_code_patterns: (args) => `Searching for: "${args.pattern}"`,
                find_code_quality_issues: () => 'Identifying code quality issues',
                analyze_dependencies_and_flow: (args) => {
                  if (args.start_component && args.end_component) {
                    return `Tracing flow: ${args.start_component} → ${args.end_component}`;
                  }
                  return args.start_component
                    ? `Analyzing from: ${args.start_component}`
                    : 'Analyzing dependencies';
                },
                find_security_and_testing_insights: () => 'Scanning for security & testing gaps',
                get_repository_statistics: () => 'Collecting repository metrics',
              };
              return descriptions[toolName]?.(args) || 'Processing...';
            };

            return (
              <div key={index} className={cn('border rounded-lg p-3', colors.bg, colors.border)}>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">{getStatusIcon()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-sm font-medium', colors.text)}>
                        {getToolDisplayName(call.name)}
                      </span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', colors.bg)}>
                        {call.status === 'calling'
                          ? 'Running...'
                          : call.status === 'complete'
                            ? 'Done'
                            : 'Called'}
                      </span>
                    </div>
                    <p className={cn('text-xs opacity-75', colors.text)}>
                      {getToolDescription(call.name, call.arguments)}
                    </p>
                    {Object.keys(call.arguments).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(call.arguments).map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2 text-xs">
                            <span className={cn('font-medium opacity-60', colors.text)}>
                              {key}:
                            </span>
                            <span className={cn('opacity-80 break-words', colors.text)}>
                              {typeof value === 'string' ? value : JSON.stringify(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {call.result != null && <CollapsibleToolResult result={call.result} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Default rendering for user messages and final assistant text responses
  return (
    <div className={cn('group flex gap-3 w-full mb-6', isUser && 'flex-row-reverse')}>
      <div className="flex-shrink-0">
        <div
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center border shadow-sm relative',
            isUser
              ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white border-blue-300'
              : 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : message.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
          {!isUser && message.isLoading && (
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" />
          )}
        </div>
      </div>

      <div
        className={cn('flex-1 min-w-0 space-y-3 max-w-full', isUser && 'flex flex-col items-end')}
      >
        <div
          className={cn(
            'relative w-full rounded-2xl px-4 py-3 shadow-sm border overflow-hidden',
            isUser
              ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white border-blue-300 rounded-tr-lg max-w-[85%]'
              : 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 rounded-tl-lg',
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : message.isLoading && !message.content ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none w-full">
              <ReactMarkdown
                components={{
                  code(props: any) {
                    const { inline, className, children } = props;
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                      <div className="relative group/code my-3 w-full">
                        <div className="flex items-center justify-between bg-muted/50 px-3 py-2 rounded-t-lg border-b border-border/30">
                          <div className="flex items-center gap-2">
                            <Code className="h-3 w-3" />
                            <span className="text-xs font-medium">{match[1]}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard.writeText(String(children))}
                            className="h-6 px-2 opacity-0 group-hover/code:opacity-100 transition-opacity"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="overflow-x-auto w-full">
                          <SyntaxHighlighter
                            style={theme === 'dark' ? oneDark : oneLight}
                            language={match[1]}
                            PreTag="div"
                            className="!mt-0 !rounded-t-none !text-xs !w-full"
                            customStyle={{
                              margin: 0,
                              padding: '12px',
                              fontSize: '11px',
                              lineHeight: '1.4',
                              width: '100%',
                              minWidth: '0',
                              overflow: 'auto',
                            }}
                            codeTagProps={{
                              style: {
                                fontSize: '11px',
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                whiteSpace: 'pre',
                                wordBreak: 'normal',
                                overflowWrap: 'normal',
                              },
                            }}
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        </div>
                      </div>
                    ) : (
                      <code
                        className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded text-xs font-mono border border-border/30 break-all"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p: ({ children }) => (
                    <p className="text-sm leading-relaxed mb-3 last:mb-0 break-words w-full">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="text-sm space-y-1 ml-4 mb-3 break-words w-full">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="text-sm space-y-1 ml-4 mb-3 break-words w-full">{children}</ol>
                  ),
                  li: ({ children }) => <li className="break-words">{children}</li>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div
          className={cn(
            'flex items-center gap-3 px-1 opacity-0 group-hover:opacity-100 transition-all duration-200',
            isUser && 'justify-end',
          )}
        >
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{formatTime(message.timestamp)}</span>
          </div>
          {!isUser && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-3 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1.5 text-green-600" />
                  <span className="text-green-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1.5" />
                  Copy
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
