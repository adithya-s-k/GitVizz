import { useState, useEffect, useCallback, useRef } from 'react';
import type { EnhancedGraphNode } from './useGraphWorker';

interface CodeOutline {
  fileName: string;
  filePath: string;
  language: string;
  size: number;
  lineCount: number;
  functions: Array<{
    name: string;
    line: number;
    type: 'function' | 'method' | 'class';
  }>;
  imports: string[];
  exports: string[];
}

interface CodeContext {
  outline: CodeOutline | null;
  fullContent: string | null;
  syntaxHighlighted: string | null;
  references: Array<{
    file: string;
    line: number;
    context: string;
    type: 'import' | 'call' | 'reference';
  }> | null;
}

interface LoadingState {
  isLoadingOutline: boolean;
  isLoadingContent: boolean;
  isLoadingReferences: boolean;
  error: string | null;
}

interface UseProgressiveCodeLoadingOptions {
  autoLoadContent?: boolean;
  autoLoadReferences?: boolean;
  contentDelay?: number;
  referencesDelay?: number;
  maxFileSize?: number; // In bytes
  enableSyntaxHighlighting?: boolean;
}

export function useProgressiveCodeLoading(
  node: EnhancedGraphNode | null,
  options: UseProgressiveCodeLoadingOptions = {}
) {
  const {
    autoLoadContent = true,
    autoLoadReferences = false,
    contentDelay = 200,
    referencesDelay = 500,
    maxFileSize = 1024 * 1024, // 1MB default
    enableSyntaxHighlighting = true,
  } = options;

  const [codeContext, setCodeContext] = useState<CodeContext>({
    outline: null,
    fullContent: null,
    syntaxHighlighted: null,
    references: null,
  });

  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoadingOutline: false,
    isLoadingContent: false,
    isLoadingReferences: false,
    error: null,
  });

  // Cache to avoid re-loading the same file content
  const contentCache = useRef<Map<string, CodeContext>>(new Map());
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Generate cache key for the node
  const getCacheKey = useCallback((node: EnhancedGraphNode): string => {
    return `${node.file}-${node.start_line}-${node.end_line}`;
  }, []);

  // Extract file language from extension
  const getFileLanguage = useCallback((filePath: string): string => {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'bash',
      'yml': 'yaml',
      'yaml': 'yaml',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'md': 'markdown',
      'sql': 'sql',
    };
    
    return languageMap[extension] || 'text';
  }, []);

  // Parse code content to generate outline
  const generateCodeOutline = useCallback((content: string, filePath: string): CodeOutline => {
    const lines = content.split('\n');
    const language = getFileLanguage(filePath);
    
    const outline: CodeOutline = {
      fileName: filePath.split('/').pop() || filePath,
      filePath,
      language,
      size: content.length,
      lineCount: lines.length,
      functions: [],
      imports: [],
      exports: [],
    };

    // Simple parsing for common patterns (this could be enhanced with proper AST parsing)
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      const lineNumber = index + 1;

      // Function patterns
      if (language === 'javascript' || language === 'typescript') {
        // Function declarations
        const funcMatch = trimmedLine.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (funcMatch) {
          outline.functions.push({
            name: funcMatch[1],
            line: lineNumber,
            type: 'function'
          });
        }

        // Arrow functions
        const arrowMatch = trimmedLine.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
        if (arrowMatch) {
          outline.functions.push({
            name: arrowMatch[1],
            line: lineNumber,
            type: 'function'
          });
        }

        // Class methods
        const methodMatch = trimmedLine.match(/^(?:async\s+)?(\w+)\s*\(/);
        if (methodMatch && !trimmedLine.includes('function') && !trimmedLine.includes('=')) {
          outline.functions.push({
            name: methodMatch[1],
            line: lineNumber,
            type: 'method'
          });
        }

        // Class declarations
        const classMatch = trimmedLine.match(/^(?:export\s+)?class\s+(\w+)/);
        if (classMatch) {
          outline.functions.push({
            name: classMatch[1],
            line: lineNumber,
            type: 'class'
          });
        }

        // Imports
        const importMatch = trimmedLine.match(/^import\s+.*\s+from\s+['"](.*)['"]/);
        if (importMatch) {
          outline.imports.push(importMatch[1]);
        }

        // Exports
        if (trimmedLine.startsWith('export')) {
          outline.exports.push(trimmedLine);
        }
      } else if (language === 'python') {
        // Python function definitions
        const funcMatch = trimmedLine.match(/^def\s+(\w+)/);
        if (funcMatch) {
          outline.functions.push({
            name: funcMatch[1],
            line: lineNumber,
            type: 'function'
          });
        }

        // Python class definitions
        const classMatch = trimmedLine.match(/^class\s+(\w+)/);
        if (classMatch) {
          outline.functions.push({
            name: classMatch[1],
            line: lineNumber,
            type: 'class'
          });
        }

        // Python imports
        const importMatch = trimmedLine.match(/^(?:from\s+\w+\s+)?import\s+(.*)/);
        if (importMatch) {
          outline.imports.push(importMatch[1]);
        }
      }
    });

    return outline;
  }, [getFileLanguage]);

  // Load file outline (fast operation)
  const loadCodeOutline = useCallback(async (filePath: string): Promise<CodeOutline> => {
    setLoadingState(prev => ({ ...prev, isLoadingOutline: true, error: null }));

    try {
      // In a real implementation, this would be an API call
      // For now, we'll simulate with the node's existing code content
      const content = node?.code || '';
      const outline = generateCodeOutline(content, filePath);
      
      setLoadingState(prev => ({ ...prev, isLoadingOutline: false }));
      return outline;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load outline';
      setLoadingState(prev => ({ 
        ...prev, 
        isLoadingOutline: false, 
        error: errorMessage 
      }));
      throw error;
    }
  }, [node?.code, generateCodeOutline]);

  // Load full file content (slower operation)
  const loadFullContent = useCallback(async (filePath: string, signal?: AbortSignal): Promise<string> => {
    setLoadingState(prev => ({ ...prev, isLoadingContent: true, error: null }));

    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (signal?.aborted) {
        throw new Error('Request cancelled');
      }

      // In a real implementation, this would fetch the full file content
      // For now, we'll use the node's code or simulate larger content
      const content = node?.code || `// Full content for ${filePath}\n// This would be loaded from the server\n\n${node?.code || ''}`;
      
      // Check file size limit
      if (content.length > maxFileSize) {
        throw new Error(`File size (${content.length} bytes) exceeds limit (${maxFileSize} bytes)`);
      }

      setLoadingState(prev => ({ ...prev, isLoadingContent: false }));
      return content;
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled') {
        return ''; // Don't update error state for cancelled requests
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to load content';
      setLoadingState(prev => ({ 
        ...prev, 
        isLoadingContent: false, 
        error: errorMessage 
      }));
      throw error;
    }
  }, [node?.code, maxFileSize]);

  // Apply syntax highlighting (client-side)
  const applySyntaxHighlighting = useCallback(async (content: string, language: string): Promise<string> => {
    if (!enableSyntaxHighlighting) return content;

    try {
      // Simulate syntax highlighting delay
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // In a real implementation, this would use a syntax highlighting library
      // For now, we'll return the content with basic formatting
      return content;
    } catch (error) {
      console.warn('Syntax highlighting failed:', error);
      return content;
    }
  }, [enableSyntaxHighlighting]);

  // Load references (slowest operation)
  const loadReferences = useCallback(async (
    nodeId: string, 
    signal?: AbortSignal
  ): Promise<CodeContext['references']> => {
    setLoadingState(prev => ({ ...prev, isLoadingReferences: true, error: null }));

    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (signal?.aborted) {
        throw new Error('Request cancelled');
      }

      // In a real implementation, this would search for references
      const mockReferences: NonNullable<CodeContext['references']> = [
        {
          file: 'src/utils/helper.js',
          line: 15,
          context: `import { ${node?.name} } from './module';`,
          type: 'import'
        },
        {
          file: 'src/components/Component.jsx',
          line: 42,
          context: `const result = ${node?.name}(data);`,
          type: 'call'
        }
      ];

      setLoadingState(prev => ({ ...prev, isLoadingReferences: false }));
      return mockReferences;
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled') {
        return null;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to load references';
      setLoadingState(prev => ({ 
        ...prev, 
        isLoadingReferences: false, 
        error: errorMessage 
      }));
      throw error;
    }
  }, [node?.name]);

  // Cancel all pending requests
  const cancelRequests = useCallback(() => {
    abortControllers.current.forEach(controller => controller.abort());
    abortControllers.current.clear();
  }, []);

  // Main effect to load code context progressively
  useEffect(() => {
    if (!node?.file) {
      setCodeContext({
        outline: null,
        fullContent: null,
        syntaxHighlighted: null,
        references: null,
      });
      return;
    }

    const cacheKey = getCacheKey(node);
    
    // Check cache first
    const cached = contentCache.current.get(cacheKey);
    if (cached) {
      setCodeContext(cached);
      return;
    }

    // Cancel any pending requests
    cancelRequests();

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllers.current.set(cacheKey, abortController);

    const loadProgressively = async () => {
      try {
        // Step 1: Load outline immediately (fast)
        const outline = await loadCodeOutline(node.file);
        setCodeContext(prev => ({ ...prev, outline }));

        if (abortController.signal.aborted) return;

        // Step 2: Load full content after delay (if enabled)
        if (autoLoadContent) {
          const contentTimer = setTimeout(async () => {
            try {
              const fullContent = await loadFullContent(node.file, abortController.signal);
              if (abortController.signal.aborted) return;

              let syntaxHighlighted: string | null = null;
              if (enableSyntaxHighlighting) {
                syntaxHighlighted = await applySyntaxHighlighting(fullContent, outline.language);
              }

              setCodeContext(prev => ({ 
                ...prev, 
                fullContent, 
                syntaxHighlighted 
              }));
            } catch (error) {
              console.error('Error loading content:', error);
            }
          }, contentDelay);

          // Clean up timer if component unmounts
          const cleanup = () => clearTimeout(contentTimer);
          abortController.signal.addEventListener('abort', cleanup);
        }

        // Step 3: Load references after longer delay (if enabled)
        if (autoLoadReferences) {
          const referencesTimer = setTimeout(async () => {
            try {
              const references = await loadReferences(node.id, abortController.signal);
              if (abortController.signal.aborted) return;

              setCodeContext(prev => ({ ...prev, references }));
              
              // Cache the complete context
              const completeContext = { outline, fullContent: null, syntaxHighlighted: null, references };
              contentCache.current.set(cacheKey, completeContext);
            } catch (error) {
              console.error('Error loading references:', error);
            }
          }, referencesDelay);

          // Clean up timer if component unmounts
          const cleanup = () => clearTimeout(referencesTimer);
          abortController.signal.addEventListener('abort', cleanup);
        }

      } catch (error) {
        console.error('Error in progressive loading:', error);
      }
    };

    loadProgressively();

    // Cleanup function
    return () => {
      abortController.abort();
      abortControllers.current.delete(cacheKey);
    };
  }, [
    node,
    getCacheKey,
    autoLoadContent,
    autoLoadReferences,
    contentDelay,
    referencesDelay,
    loadCodeOutline,
    loadFullContent,
    loadReferences,
    applySyntaxHighlighting,
    enableSyntaxHighlighting,
    cancelRequests
  ]);

  // Manual loading functions
  const loadContentManually = useCallback(async () => {
    if (!node?.file) return;
    
    try {
      const content = await loadFullContent(node.file);
      const outline = codeContext.outline || await loadCodeOutline(node.file);
      
      let syntaxHighlighted: string | null = null;
      if (enableSyntaxHighlighting) {
        syntaxHighlighted = await applySyntaxHighlighting(content, outline.language);
      }

      setCodeContext(prev => ({ 
        ...prev, 
        fullContent: content, 
        syntaxHighlighted 
      }));
    } catch (error) {
      console.error('Manual content loading failed:', error);
    }
  }, [node, loadFullContent, loadCodeOutline, applySyntaxHighlighting, codeContext.outline, enableSyntaxHighlighting]);

  const loadReferencesManually = useCallback(async () => {
    if (!node) return;
    
    try {
      const references = await loadReferences(node.id);
      setCodeContext(prev => ({ ...prev, references }));
    } catch (error) {
      console.error('Manual references loading failed:', error);
    }
  }, [node, loadReferences]);

  // Clear cache function
  const clearCache = useCallback(() => {
    contentCache.current.clear();
  }, []);

  return {
    codeContext,
    loadingState,
    
    // Manual control
    loadContentManually,
    loadReferencesManually,
    cancelRequests,
    clearCache,
    
    // Utility
    isReady: !loadingState.isLoadingOutline,
    hasContent: !!codeContext.fullContent,
    hasReferences: !!codeContext.references,
    cacheSize: contentCache.current.size,
  };
}