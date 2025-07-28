import { useEffect, useRef, useCallback, useState } from 'react';
import type { GraphNode, GraphEdge } from '@/api-client/types.gen';
import type { CodeReference, GraphData } from '@/types/code-analysis';

interface WorkerMessage {
  type: 'SUCCESS' | 'ERROR' | 'READY';
  requestId?: string;
  result?: any;
  error?: string;
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export interface EnhancedGraphNode extends GraphNode {
  inDegree: number;
  outDegree: number;
  totalConnections: number;
  importanceScore: number;
  connectedFiles: string[];
  renderPriority: 'high' | 'medium' | 'low';
}

export interface ReferenceAnalysisResult {
  fileName: string;
  relativePath: string;
  totalUsages: number;
  directUsages: number;
  indirectUsages: number;
  maxDepth: number;
  usages: Array<{
    type: string;
    line: number;
    context: string;
    functionScope: string | null;
    depth: number;
    connectionPath: string;
  }>;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export function useGraphWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());
  const requestIdCounter = useRef(0);
  
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize worker
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const worker = new Worker('/workers/graph-analysis.worker.js');
    workerRef.current = worker;

    // Handle messages from worker
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, requestId, result, error } = e.data;

      if (type === 'READY') {
        setIsReady(true);
        return;
      }

      if (!requestId) return;

      const pendingRequest = pendingRequests.current.get(requestId);
      if (!pendingRequest) return;

      // Clean up request
      pendingRequests.current.delete(requestId);
      
      // Update loading state
      if (pendingRequests.current.size === 0) {
        setIsLoading(false);
      }

      // Handle response
      if (type === 'SUCCESS') {
        pendingRequest.resolve(result);
      } else if (type === 'ERROR') {
        pendingRequest.reject(new Error(error || 'Worker error'));
      }
    };

    worker.onerror = (error) => {
      console.error('Graph worker error:', error);
      setIsReady(false);
    };

    return () => {
      // Clean up pending requests
      pendingRequests.current.forEach(({ reject }) => {
        reject(new Error('Worker terminated'));
      });
      pendingRequests.current.clear();
      
      worker.terminate();
      workerRef.current = null;
      setIsReady(false);
    };
  }, []);

  // Clean up old requests periodically
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      const timeout = 30000; // 30 seconds

      pendingRequests.current.forEach((request, requestId) => {
        if (now - request.timestamp > timeout) {
          request.reject(new Error('Request timeout'));
          pendingRequests.current.delete(requestId);
        }
      });
    }, 10000); // Check every 10 seconds

    return () => clearInterval(cleanup);
  }, []);

  // Generic method to send tasks to worker
  const sendTask = useCallback((type: string, data: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current || !isReady) {
        reject(new Error('Worker not ready'));
        return;
      }

      const requestId = `${Date.now()}-${++requestIdCounter.current}`;
      
      // Store pending request
      pendingRequests.current.set(requestId, {
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Update loading state
      setIsLoading(true);

      // Send task to worker
      workerRef.current.postMessage({
        type,
        data,
        requestId
      });
    });
  }, [isReady]);

  // Calculate enhanced node metrics
  const calculateNodeMetrics = useCallback(
    async (nodes: GraphNode[], edges: GraphEdge[], maxDepth = 3): Promise<EnhancedGraphNode[]> => {
      return sendTask('CALCULATE_NODE_METRICS', { nodes, edges, maxDepth });
    },
    [sendTask]
  );

  // Analyze node references
  const analyzeNodeReferences = useCallback(
    async (
      selectedNode: CodeReference,
      graphData: GraphData,
      maxDepth = 3
    ): Promise<ReferenceAnalysisResult[]> => {
      return sendTask('ANALYZE_NODE_REFERENCES', { selectedNode, graphData, maxDepth });
    },
    [sendTask]
  );

  // Filter nodes for viewport (virtualization)
  const filterViewportNodes = useCallback(
    async (nodes: GraphNode[], viewport: Viewport, buffer = 100): Promise<GraphNode[]> => {
      return sendTask('FILTER_VIEWPORT_NODES', { nodes, viewport, buffer });
    },
    [sendTask]
  );

  // Batch multiple operations
  const batchOperations = useCallback(
    async (operations: Array<{ type: string; data: any }>) => {
      const promises = operations.map(({ type, data }) => sendTask(type, data));
      return Promise.all(promises);
    },
    [sendTask]
  );

  // Get worker performance stats
  const getWorkerStats = useCallback(() => {
    return {
      isReady,
      isLoading,
      pendingRequests: pendingRequests.current.size,
      workerExists: !!workerRef.current
    };
  }, [isReady, isLoading]);

  return {
    // Status
    isReady,
    isLoading,
    
    // Core operations
    calculateNodeMetrics,
    analyzeNodeReferences,
    filterViewportNodes,
    batchOperations,
    
    // Utilities
    getWorkerStats,
    
    // Advanced features for future use
    sendTask, // For custom worker tasks
  };
}