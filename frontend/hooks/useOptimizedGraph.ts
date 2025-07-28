import { useMemo, useCallback, useState, useRef } from 'react';
import type { GraphEdge } from '@/api-client/types.gen';
import type { EnhancedGraphNode } from './useGraphWorker';

interface GraphLookupMaps {
  nodeMap: Map<string, EnhancedGraphNode>;
  edgeMap: Map<string, GraphEdge>;
  incomingEdges: Map<string, GraphEdge[]>;
  outgoingEdges: Map<string, GraphEdge[]>;
  fileNodeMap: Map<string, EnhancedGraphNode[]>;
  categoryNodeMap: Map<string, EnhancedGraphNode[]>;
}

interface ConnectedNodeResult {
  connectedNodeIds: Set<string>;
  connectionPaths: Map<string, string[]>;
  connectionDepths: Map<string, number>;
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  averageConnections: number;
  maxConnections: number;
  fileCount: number;
  categoryStats: Record<string, number>;
}

export function useOptimizedGraph(nodes: EnhancedGraphNode[], edges: GraphEdge[]) {
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // Memoized lookup maps for O(1) access
  const lookupMaps = useMemo((): GraphLookupMaps => {
    const nodeMap = new Map<string, EnhancedGraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    const incomingEdges = new Map<string, GraphEdge[]>();
    const outgoingEdges = new Map<string, GraphEdge[]>();
    const fileNodeMap = new Map<string, EnhancedGraphNode[]>();
    const categoryNodeMap = new Map<string, EnhancedGraphNode[]>();

    // Build node maps
    nodes.forEach((node, index) => {
      nodeMap.set(node.id, node);
      
      // Group by file
      if (node.file) {
        if (!fileNodeMap.has(node.file)) {
          fileNodeMap.set(node.file, []);
        }
        fileNodeMap.get(node.file)!.push(node);
      }
      
      // Group by category
      const category = node.category || 'unknown';
      if (!categoryNodeMap.has(category)) {
        categoryNodeMap.set(category, []);
      }
      categoryNodeMap.get(category)!.push(node);
    });

    // Build edge maps
    edges.forEach((edge, index) => {
      const edgeId = `${edge.source}-${edge.target}-${index}`;
      edgeMap.set(edgeId, edge);
      
      // Build adjacency lists
      if (!incomingEdges.has(edge.target)) {
        incomingEdges.set(edge.target, []);
      }
      if (!outgoingEdges.has(edge.source)) {
        outgoingEdges.set(edge.source, []);
      }
      
      incomingEdges.get(edge.target)!.push(edge);
      outgoingEdges.get(edge.source)!.push(edge);
    });

    return {
      nodeMap,
      edgeMap,
      incomingEdges,
      outgoingEdges,
      fileNodeMap,
      categoryNodeMap,
    };
  }, [nodes, edges]);

  // O(1) node lookup
  const getNode = useCallback(
    (nodeId: string): EnhancedGraphNode | undefined => {
      return lookupMaps.nodeMap.get(nodeId);
    },
    [lookupMaps.nodeMap]
  );

  // O(1) edge lookup by source and target
  const getEdges = useCallback(
    (sourceId: string, targetId: string): GraphEdge[] => {
      const outgoing = lookupMaps.outgoingEdges.get(sourceId) || [];
      return outgoing.filter(edge => edge.target === targetId);
    },
    [lookupMaps.outgoingEdges]
  );

  // Get all nodes in a specific file
  const getNodesByFile = useCallback(
    (filePath: string): EnhancedGraphNode[] => {
      return lookupMaps.fileNodeMap.get(filePath) || [];
    },
    [lookupMaps.fileNodeMap]
  );

  // Get all nodes of a specific category
  const getNodesByCategory = useCallback(
    (category: string): EnhancedGraphNode[] => {
      return lookupMaps.categoryNodeMap.get(category) || [];
    },
    [lookupMaps.categoryNodeMap]
  );

  // Efficient connected nodes finder with BFS
  const getConnectedNodes = useCallback(
    (nodeId: string, maxDepth = 2): ConnectedNodeResult => {
      const connected = new Set<string>();
      const connectionPaths = new Map<string, string[]>();
      const connectionDepths = new Map<string, number>();
      const visited = new Set<string>();
      
      // BFS queue with path tracking
      const queue: Array<{
        id: string;
        depth: number;
        path: string[];
      }> = [{ id: nodeId, depth: 0, path: [] }];

      while (queue.length > 0) {
        const { id, depth, path } = queue.shift()!;
        
        if (visited.has(id) || depth > maxDepth) continue;
        visited.add(id);
        
        if (id !== nodeId) {
          connected.add(id);
          connectionPaths.set(id, [...path]);
          connectionDepths.set(id, depth);
        }

        if (depth < maxDepth) {
          // Add outgoing connections
          const outgoing = lookupMaps.outgoingEdges.get(id) || [];
          outgoing.forEach(edge => {
            if (!visited.has(edge.target)) {
              queue.push({
                id: edge.target,
                depth: depth + 1,
                path: [...path, edge.relationship || 'connected']
              });
            }
          });

          // Add incoming connections
          const incoming = lookupMaps.incomingEdges.get(id) || [];
          incoming.forEach(edge => {
            if (!visited.has(edge.source)) {
              queue.push({
                id: edge.source,
                depth: depth + 1,
                path: [...path, `${edge.relationship || 'connected'} (reverse)`]
              });
            }
          });
        }
      }

      return { connectedNodeIds: connected, connectionPaths, connectionDepths };
    },
    [lookupMaps.incomingEdges, lookupMaps.outgoingEdges]
  );

  // Optimized node selection with highlighting
  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;

      setSelectedNodeId(nodeId);
      
      // Get connected nodes for highlighting (limit depth for performance)
      const { connectedNodeIds } = getConnectedNodes(nodeId, 1);
      connectedNodeIds.add(nodeId); // Include selected node
      
      setHighlightedNodes(connectedNodeIds);
    },
    [getNode, getConnectedNodes]
  );

  // Clear selection and highlighting
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setHighlightedNodes(new Set());
  }, []);

  // Advanced search functionality
  const searchNodes = useCallback(
    (query: string, options: {
      searchInCode?: boolean;
      searchInFiles?: boolean;
      categories?: string[];
      maxResults?: number;
    } = {}): EnhancedGraphNode[] => {
      const {
        searchInCode = true,
        searchInFiles = true,
        categories = [],
        maxResults = 50
      } = options;

      const queryLower = query.toLowerCase();
      const results: EnhancedGraphNode[] = [];

      for (const node of nodes) {
        if (results.length >= maxResults) break;

        // Category filter
        if (categories.length > 0 && !categories.includes(node.category || '')) {
          continue;
        }

        let matches = false;

        // Search in node name
        if (node.name.toLowerCase().includes(queryLower)) {
          matches = true;
        }

        // Search in file path
        if (!matches && searchInFiles && node.file?.toLowerCase().includes(queryLower)) {
          matches = true;
        }

        // Search in code content
        if (!matches && searchInCode && node.code?.toLowerCase().includes(queryLower)) {
          matches = true;
        }

        if (matches) {
          results.push(node);
        }
      }

      // Sort by relevance (importance score and name match priority)
      return results.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().includes(queryLower) ? 1 : 0;
        const bNameMatch = b.name.toLowerCase().includes(queryLower) ? 1 : 0;
        
        if (aNameMatch !== bNameMatch) {
          return bNameMatch - aNameMatch; // Name matches first
        }
        
        return (b.importanceScore || 0) - (a.importanceScore || 0); // Then by importance
      });
    },
    [nodes]
  );

  // Get graph statistics
  const graphStats = useMemo((): GraphStats => {
    const categoryStats: Record<string, number> = {};
    let totalConnections = 0;
    let maxConnections = 0;

    nodes.forEach(node => {
      const category = node.category || 'unknown';
      categoryStats[category] = (categoryStats[category] || 0) + 1;
      
      const connections = node.totalConnections || 0;
      totalConnections += connections;
      maxConnections = Math.max(maxConnections, connections);
    });

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      averageConnections: nodes.length > 0 ? totalConnections / nodes.length : 0,
      maxConnections,
      fileCount: lookupMaps.fileNodeMap.size,
      categoryStats,
    };
  }, [nodes, edges, lookupMaps.fileNodeMap.size]);

  // Get nodes by importance (for progressive rendering)
  const getNodesByImportance = useCallback(
    (minImportance = 0, limit?: number): EnhancedGraphNode[] => {
      let filtered = nodes.filter(node => (node.importanceScore || 0) >= minImportance);
      
      // Sort by importance descending
      filtered.sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));
      
      if (limit) {
        filtered = filtered.slice(0, limit);
      }
      
      return filtered;
    },
    [nodes]
  );

  // Check if a node is highlighted
  const isNodeHighlighted = useCallback(
    (nodeId: string): boolean => {
      return highlightedNodes.has(nodeId);
    },
    [highlightedNodes]
  );

  // Check if a node is selected
  const isNodeSelected = useCallback(
    (nodeId: string): boolean => {
      return selectedNodeId === nodeId;
    },
    [selectedNodeId]
  );

  return {
    // Lookup functions (O(1) operations)
    getNode,
    getEdges,
    getNodesByFile,
    getNodesByCategory,
    getConnectedNodes,
    
    // Selection and highlighting
    selectedNodeId,
    highlightedNodes,
    handleNodeSelect,
    clearSelection,
    isNodeHighlighted,
    isNodeSelected,
    
    // Search and filtering
    searchNodes,
    getNodesByImportance,
    
    // Statistics and metadata
    graphStats,
    lookupMaps,
  };
}