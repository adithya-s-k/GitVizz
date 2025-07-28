import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { GraphNode, GraphEdge } from '@/api-client/types.gen';

interface GraphChunk {
  chunk_id: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_chunks: number;
  progress: number;
  is_final: boolean;
  metadata?: {
    total_nodes: number;
    total_edges: number;
    chunk_size: number;
  };
}

interface StreamingState {
  isLoading: boolean;
  isStreaming: boolean;
  progress: number;
  error: string | null;
  chunksReceived: number;
  totalChunks: number;
  nodesLoaded: number;
  edgesLoaded: number;
  estimatedTotal: {
    nodes: number;
    edges: number;
  };
}

interface StreamingGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  isComplete: boolean;
}

interface UseStreamingGraphOptions {
  chunk_size?: number;
  priority_nodes?: boolean;
  include_metadata?: boolean;
  auto_process_chunks?: boolean;
  max_concurrent_chunks?: number;
}

interface StreamRequest {
  repo_url?: string;
  branch?: string;
  access_token?: string;
  zip_file?: File;
}

export function useStreamingGraph(options: UseStreamingGraphOptions = {}) {
  const { data: session } = useSession();
  
  const [graphData, setGraphData] = useState<StreamingGraphData>({
    nodes: [],
    edges: [],
    nodeMap: new Map(),
    isComplete: false,
  });
  
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isLoading: false,
    isStreaming: false,
    progress: 0,
    error: null,
    chunksReceived: 0,
    totalChunks: 0,
    nodesLoaded: 0,
    edgesLoaded: 0,
    estimatedTotal: { nodes: 0, edges: 0 },
  });

  // Store chunks temporarily before processing
  const chunkQueue = useRef<GraphChunk[]>([]);
  const abortController = useRef<AbortController | null>(null);
  const processingChunks = useRef(false);

  const {
    chunk_size = 200,
    priority_nodes = true,
    include_metadata = true,
    auto_process_chunks = true,
    max_concurrent_chunks = 5,
  } = options;

  // Process chunks in batches to avoid overwhelming the UI
  const processChunkQueue = useCallback(async () => {
    if (processingChunks.current || chunkQueue.current.length === 0) return;
    
    processingChunks.current = true;
    
    try {
      const chunksToProcess = chunkQueue.current.splice(0, max_concurrent_chunks);
      
      setGraphData(prevData => {
        const newNodes = [...prevData.nodes];
        const newEdges = [...prevData.edges];
        const newNodeMap = new Map(prevData.nodeMap);
        
        // Merge all chunks
        chunksToProcess.forEach(chunk => {
          // Add new nodes
          chunk.nodes.forEach(node => {
            if (!newNodeMap.has(node.id)) {
              newNodes.push(node);
              newNodeMap.set(node.id, node);
            }
          });
          
          // Add new edges (check for duplicates)
          chunk.edges.forEach(edge => {
            const edgeKey = `${edge.source}-${edge.target}`;
            const existingEdge = newEdges.find(e => 
              e.source === edge.source && e.target === edge.target
            );
            if (!existingEdge) {
              newEdges.push(edge);
            }
          });
        });
        
        return {
          nodes: newNodes,
          edges: newEdges,
          nodeMap: newNodeMap,
          isComplete: prevData.isComplete,
        };
      });

      // Update streaming state
      setStreamingState(prev => ({
        ...prev,
        chunksReceived: prev.chunksReceived + chunksToProcess.length,
        nodesLoaded: graphData.nodes.length,
        edgesLoaded: graphData.edges.length,
      }));

      // Continue processing if there are more chunks
      if (chunkQueue.current.length > 0) {
        // Use requestAnimationFrame to yield to the browser
        requestAnimationFrame(() => {
          processingChunks.current = false;
          processChunkQueue();
        });
      } else {
        processingChunks.current = false;
      }
      
    } catch (error) {
      processingChunks.current = false;
      console.error('Error processing chunk queue:', error);
    }
  }, [max_concurrent_chunks, graphData.nodes.length, graphData.edges.length]);

  // Process a single chunk
  const processChunk = useCallback((chunk: GraphChunk) => {
    if (chunk.chunk_id === -1) {
      // Metadata chunk
      setStreamingState(prev => ({
        ...prev,
        totalChunks: chunk.total_chunks,
        estimatedTotal: chunk.metadata || prev.estimatedTotal,
      }));
      return;
    }

    // Add chunk to queue
    chunkQueue.current.push(chunk);
    
    // Update progress
    setStreamingState(prev => ({
      ...prev,
      progress: chunk.progress,
      totalChunks: chunk.total_chunks,
    }));

    // Process queue if auto-processing is enabled
    if (auto_process_chunks) {
      processChunkQueue();
    }

    // Check if this is the final chunk
    if (chunk.is_final) {
      setGraphData(prev => ({ ...prev, isComplete: true }));
      setStreamingState(prev => ({
        ...prev,
        isStreaming: false,
      }));
    }
  }, [auto_process_chunks, processChunkQueue]);

  // Start streaming graph data
  const startStreaming = useCallback(async (request: StreamRequest) => {
    if (!session?.jwt_token) {
      setStreamingState(prev => ({
        ...prev,
        error: 'No authentication token available',
      }));
      return;
    }

    // Reset state
    setGraphData({ nodes: [], edges: [], nodeMap: new Map(), isComplete: false });
    setStreamingState({
      isLoading: true,
      isStreaming: true,
      progress: 0,
      error: null,
      chunksReceived: 0,
      totalChunks: 0,
      nodesLoaded: 0,
      edgesLoaded: 0,
      estimatedTotal: { nodes: 0, edges: 0 },
    });
    
    chunkQueue.current = [];

    // Create abort controller for this request
    abortController.current = new AbortController();

    try {
      const response = await fetch('/api/graph/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          chunk_size,
          priority_nodes,
          include_metadata,
        }),
        signal: abortController.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      setStreamingState(prev => ({ ...prev, isLoading: false }));

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'complete') {
                setGraphData(prev => ({ ...prev, isComplete: true }));
                setStreamingState(prev => ({ ...prev, isStreaming: false }));
                break;
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Streaming error');
              } else {
                processChunk(data as GraphChunk);
              }
            } catch (parseError) {
              console.error('Error parsing chunk:', parseError);
            }
          }
        }
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled
        return;
      }
      
      console.error('Streaming error:', error);
      setStreamingState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown streaming error',
        isLoading: false,
        isStreaming: false,
      }));
    }
  }, [session?.jwt_token, chunk_size, priority_nodes, include_metadata, processChunk]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
      abortController.current = null;
    }
    
    setStreamingState(prev => ({
      ...prev,
      isStreaming: false,
      isLoading: false,
    }));
  }, []);

  // Clear all data
  const clearGraph = useCallback(() => {
    stopStreaming();
    setGraphData({ nodes: [], edges: [], nodeMap: new Map(), isComplete: false });
    setStreamingState({
      isLoading: false,
      isStreaming: false,
      progress: 0,
      error: null,
      chunksReceived: 0,
      totalChunks: 0,
      nodesLoaded: 0,
      edgesLoaded: 0,
      estimatedTotal: { nodes: 0, edges: 0 },
    });
    chunkQueue.current = [];
  }, [stopStreaming]);

  // Manually process remaining chunks
  const flushChunkQueue = useCallback(() => {
    return processChunkQueue();
  }, [processChunkQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return {
    // Graph data
    graphData,
    
    // Streaming state
    streamingState,
    
    // Control functions
    startStreaming,
    stopStreaming,
    clearGraph,
    flushChunkQueue,
    
    // Utility functions
    isReady: !streamingState.isLoading && !streamingState.isStreaming,
    hasData: graphData.nodes.length > 0,
    completionPercentage: Math.round(streamingState.progress * 100),
  };
}