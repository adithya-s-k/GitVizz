'use client';

import type React from 'react';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useResultData } from '@/context/ResultDataContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { useSession } from 'next-auth/react';
import {
  Network,
  Code,
  Eye,
  EyeOff,
  Menu,
  X,
  Zap,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';

// Import our optimized components and hooks
import { VirtualizedGraph } from '@/components/VirtualizedGraph';
import { EnhancedAnalysisTab } from '@/components/EnhancedAnalysisTab';
import { useStreamingGraph } from '@/hooks/useStreamingGraph';
import { useGraphWorker, type EnhancedGraphNode } from '@/hooks/useGraphWorker';
import { useOptimizedGraph } from '@/hooks/useOptimizedGraph';

import type { CodeReference, GraphData } from '@/types/code-analysis';

interface OptimizedReagraphVisualizationProps {
  setParentActiveTab: (tab: string) => void;
  onError?: (error: string) => void;
  onNodeClick?: (node: EnhancedGraphNode) => void;
}

interface GitHubSourceData {
  repo_url: string;
  access_token?: string;
  branch?: string;
}

type SourceData = GitHubSourceData | File;

// Enhanced loading component with progress
const StreamingLoadingComponent = ({ 
  progress, 
  chunksReceived, 
  totalChunks,
  nodesLoaded 
}: {
  progress: number;
  chunksReceived: number;
  totalChunks: number;
  nodesLoaded: number;
}) => (
  <div className="flex justify-center items-center h-full">
    <div className="flex flex-col items-center gap-4 p-8 max-w-sm">
      <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      <div className="text-center space-y-3 w-full">
        <p className="text-sm font-medium text-foreground">Streaming Graph Data</p>
        <Progress value={progress} className="w-full" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Progress: {Math.round(progress)}%</p>
          <p>Chunks: {chunksReceived}/{totalChunks}</p>
          <p>Nodes loaded: {nodesLoaded.toLocaleString()}</p>
        </div>
      </div>
    </div>
  </div>
);

export default function OptimizedReagraphVisualization({
  setParentActiveTab,
  onError,
  onNodeClick,
}: OptimizedReagraphVisualizationProps) {
  const {
    sourceType,
    sourceData,
    setSelectedFilePath,
    setSelectedFileLine,
    setCodeViewerSheetOpen,
  } = useResultData();

  const { data: session } = useSession();
  
  // State management
  const [selectedNode, setSelectedNode] = useState<EnhancedGraphNode | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis'>('overview');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [useVirtualizedRenderer, setUseVirtualizedRenderer] = useState(true);

  // Enhanced hooks
  const streamingGraph = useStreamingGraph({
    chunk_size: 150,
    priority_nodes: true,
    include_metadata: true,
    auto_process_chunks: true,
  });

  const graphWorker = useGraphWorker();
  const [enhancedNodes, setEnhancedNodes] = useState<EnhancedGraphNode[]>([]);
  const [isProcessingNodes, setIsProcessingNodes] = useState(false);

  // Optimized graph operations
  const optimizedGraph = useOptimizedGraph(enhancedNodes, streamingGraph.graphData.edges);

  // Refs for performance
  const hasLoadedRef = useRef(false);
  const currentRequestKeyRef = useRef<string | null>(null);

  // Determine if source data is GitHub
  const isGitHubSourceData = useCallback((data: SourceData): data is GitHubSourceData => {
    return data !== null && typeof data === 'object' && 'repo_url' in data;
  }, []);

  // Generate request key for caching
  const requestKey = useMemo(() => {
    if (!sourceType || !sourceData) return null;
    if (sourceType === 'github' && isGitHubSourceData(sourceData)) {
      return `github-${sourceData.repo_url}-${sourceData.access_token || ''}`;
    }
    if (sourceType === 'zip' && sourceData instanceof File) {
      return `zip-${sourceData.name}-${sourceData.size}-${sourceData.lastModified}`;
    }
    return null;
  }, [sourceType, sourceData, isGitHubSourceData]);

  // Process raw nodes with worker when new data arrives
  useEffect(() => {
    if (!streamingGraph.graphData.nodes.length || !graphWorker.isReady || isProcessingNodes) {
      return;
    }

    setIsProcessingNodes(true);

    graphWorker.calculateNodeMetrics(
      streamingGraph.graphData.nodes,
      streamingGraph.graphData.edges,
      3
    ).then((processed) => {
      setEnhancedNodes(processed);
      setIsProcessingNodes(false);
    }).catch((error) => {
      console.error('Error processing nodes:', error);
      setIsProcessingNodes(false);
      onError?.(error.message);
    });
  }, [
    streamingGraph.graphData.nodes,
    streamingGraph.graphData.edges,
    graphWorker.isReady,
    isProcessingNodes,
    graphWorker,
    onError
  ]);

  // Start loading graph data
  useEffect(() => {
    if (!requestKey || !session?.jwt_token) return;
    if (hasLoadedRef.current && currentRequestKeyRef.current === requestKey) return;

    const loadGraphData = async () => {
      streamingGraph.clearGraph();

      try {
        if (sourceType === 'github' && sourceData && isGitHubSourceData(sourceData)) {
          await streamingGraph.startStreaming({
            repo_url: sourceData.repo_url,
            branch: sourceData.branch || 'main',
            access_token: sourceData.access_token,
          });
        } else if (sourceType === 'zip' && sourceData instanceof File) {
          await streamingGraph.startStreaming({
            zip_file: sourceData,
          });
        } else {
          throw new Error('Invalid source type or data');
        }

        hasLoadedRef.current = true;
        currentRequestKeyRef.current = requestKey;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to load graph data';
        onError?.(msg);
      }
    };

    loadGraphData();
  }, [
    requestKey,
    session?.jwt_token,
    sourceType,
    sourceData,
    isGitHubSourceData,
    streamingGraph,
    onError,
  ]);

  // Handle node selection with optimized lookup
  const handleNodeClick = useCallback(
    (node: EnhancedGraphNode) => {
      setSelectedNode(node);
      setActiveTab('analysis');
      setIsMobileSidebarOpen(true);
      onNodeClick?.(node);
      
      // Use optimized graph selection
      optimizedGraph.handleNodeSelect(node.id);
    },
    [onNodeClick, optimizedGraph]
  );

  // Handle file opening
  const handleOpenFile = useCallback(
    (filePath: string, line?: number) => {
      setSelectedFilePath?.(filePath);
      setSelectedFileLine?.(line || 1);
      setCodeViewerSheetOpen?.(true);
      setParentActiveTab?.('explorer');
      setIsMobileSidebarOpen(false);
    },
    [setSelectedFilePath, setSelectedFileLine, setCodeViewerSheetOpen, setParentActiveTab]
  );

  // Retry functionality
  const handleTryAgain = useCallback(() => {
    hasLoadedRef.current = false;
    currentRequestKeyRef.current = null;
    streamingGraph.clearGraph();
    setEnhancedNodes([]);
    setSelectedNode(null);
    optimizedGraph.clearSelection();
  }, [streamingGraph, optimizedGraph]);

  // Toggle renderer
  const toggleRenderer = useCallback(() => {
    setUseVirtualizedRenderer(prev => !prev);
  }, []);

  // Convert enhanced node to CodeReference for analyzer
  const selectedCodeReference: CodeReference | null = useMemo(() => {
    if (!selectedNode) return null;
    return {
      id: selectedNode.id,
      name: selectedNode.name,
      file: selectedNode.file || '',
      code: selectedNode.code || '',
      category: selectedNode.category || 'other',
      start_line: selectedNode.start_line ?? undefined,
      end_line: selectedNode.end_line ?? undefined,
    };
  }, [selectedNode]);

  // Convert graph data for analyzer
  const analysisGraphData: GraphData | null = useMemo(() => {
    if (!streamingGraph.graphData.nodes.length) return null;
    return {
      nodes: streamingGraph.graphData.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        file: node.file || '',
        code: node.code || '',
        category: node.category || 'other',
        start_line: node.start_line ?? undefined,
        end_line: node.end_line ?? undefined,
      })),
      edges: streamingGraph.graphData.edges,
    };
  }, [streamingGraph.graphData]);

  // Calculate display statistics
  const graphStats = useMemo(() => ({
    totalNodes: enhancedNodes.length,
    totalEdges: streamingGraph.graphData.edges.length,
    visibleNodes: enhancedNodes.filter(n => optimizedGraph.isNodeHighlighted(n.id) || !optimizedGraph.highlightedNodes.size).length,
    highlightedNodes: optimizedGraph.highlightedNodes.size,
  }), [enhancedNodes, streamingGraph.graphData.edges, optimizedGraph]);

  // Render loading state
  if (streamingGraph.streamingState.isStreaming || isProcessingNodes) {
    return (
      <StreamingLoadingComponent
        progress={streamingGraph.streamingState.progress * 100}
        chunksReceived={streamingGraph.streamingState.chunksReceived}
        totalChunks={streamingGraph.streamingState.totalChunks}
        nodesLoaded={streamingGraph.streamingState.nodesLoaded}
      />
    );
  }

  // Render error state
  if (streamingGraph.streamingState.error) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-center space-y-4 p-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 dark:bg-red-950/20 flex items-center justify-center">
            <Network className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-medium text-foreground">Failed to Load Graph</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {streamingGraph.streamingState.error}
            </p>
          </div>
          <Button variant="outline" onClick={handleTryAgain} className="rounded-xl">
            <RotateCcw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Render empty state
  if (!enhancedNodes.length) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-center space-y-4 p-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center">
            <Network className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-medium text-foreground">No Dependencies Found</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              The repository may not have analyzable code structure or dependencies
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[70vh] w-full bg-background/60 backdrop-blur-xl rounded-2xl overflow-hidden relative">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div className="w-80 max-w-full h-full bg-background border-l border-border/30 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h3 className="font-semibold text-sm">Graph Analysis</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="h-8 w-8 rounded-lg"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <div className="p-3 border-b border-border/30">
                  <TabsList className="grid w-full grid-cols-2 bg-muted/30 backdrop-blur-sm rounded-xl">
                    <TabsTrigger value="overview" className="rounded-lg text-xs">
                      <Network className="w-3 h-3 mr-1" />
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="analysis" className="rounded-lg text-xs">
                      <Code className="w-3 h-3 mr-1" />
                      Analysis
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="analysis" className="h-full m-0 p-0">
                  {analysisGraphData && (
                    <EnhancedAnalysisTab
                      selectedNode={selectedCodeReference}
                      graphData={analysisGraphData}
                      onNodeSelect={(node) => {
                        const enhancedNode = processedGraphData?.nodes.find((n) => n.id === node.id);
                        if (enhancedNode) {
                          setSelectedNode(enhancedNode);
                          onNodeClick?.(enhancedNode);
                        }
                      }}
                      onOpenFile={handleOpenFile}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      )}

      {/* Main Graph Area */}
      <div className="flex-1 relative min-w-0">
        <div className="absolute inset-0 bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-sm">
          <VirtualizedGraph
            nodes={enhancedNodes}
            edges={streamingGraph.graphData.edges}
            onNodeClick={handleNodeClick}
            onNodeHover={(node) => {/* Handle hover if needed */}}
            highlightedNodes={optimizedGraph.highlightedNodes}
            selectedNodeId={optimizedGraph.selectedNodeId}
            width={800}
            height={600}
            className="w-full h-full"
          />
        </div>

        {/* Graph Controls */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl bg-background/90 backdrop-blur-sm border-border/60"
                  onClick={() => setShowSidebar(!showSidebar)}
                >
                  {showSidebar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl bg-background/90 backdrop-blur-sm border-border/60"
                  onClick={toggleRenderer}
                >
                  <Zap className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {useVirtualizedRenderer ? 'Using Optimized Renderer' : 'Using Standard Renderer'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Enhanced Stats Badge */}
        <div className="absolute top-4 right-4">
          <Badge className="bg-background/90 backdrop-blur-sm border-border/60 text-foreground rounded-xl px-3 py-1 text-xs">
            {graphStats.totalNodes}N • {graphStats.totalEdges}E
            {graphStats.highlightedNodes > 0 && ` • ${graphStats.highlightedNodes} highlighted`}
          </Badge>
        </div>

        {/* Mobile View Message */}
        <div className="lg:hidden absolute bottom-4 left-4 right-4">
          <div className="bg-background/90 backdrop-blur-sm rounded-xl p-4 border border-border/30">
            <p className="text-sm text-muted-foreground text-center">
              Tap nodes to analyze • Use analysis panel for detailed insights
            </p>
            <Button
              variant="outline"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="w-full mt-2 rounded-xl"
            >
              <Menu className="h-4 w-4 mr-2" />
              Open Analysis Panel
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop Sidebar */}
      {showSidebar && (
        <div className="hidden lg:flex w-96 border-l border-border/30 bg-background/40 backdrop-blur-sm flex-col">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <div className="p-4 border-b border-border/30">
              <TabsList className="grid w-full grid-cols-2 bg-muted/30 backdrop-blur-sm rounded-xl">
                <TabsTrigger value="overview" className="rounded-lg text-sm">
                  <Network className="w-4 h-4 mr-1.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="analysis" className="rounded-lg text-sm">
                  <Code className="w-4 h-4 mr-1.5" />
                  Analysis
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="overview" className="h-full m-0 p-4">
                <ScrollArea className="h-full">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Performance Stats</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted/30 p-2 rounded-lg">
                          <div className="font-medium">{graphStats.totalNodes}</div>
                          <div className="text-muted-foreground">Nodes</div>
                        </div>
                        <div className="bg-muted/30 p-2 rounded-lg">
                          <div className="font-medium">{graphStats.totalEdges}</div>
                          <div className="text-muted-foreground">Edges</div>
                        </div>
                      </div>
                    </div>

                    {/* Graph worker stats */}
                    {graphWorker.isReady && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Optimization Status</h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Web Worker: Active</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span>Virtualized Rendering: {useVirtualizedRenderer ? 'On' : 'Off'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span>Streaming: Complete</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="analysis" className="h-full m-0 p-0">
                {analysisGraphData && (
                  <EnhancedAnalysisTab
                    selectedNode={selectedCodeReference}
                    graphData={analysisGraphData}
                    onNodeSelect={(node) => {
                      const enhancedNode = processedGraphData?.nodes.find((n) => n.id === node.id);
                      if (enhancedNode) {
                        setSelectedNode(enhancedNode);
                        onNodeClick?.(enhancedNode);
                      }
                    }}
                    onOpenFile={handleOpenFile}
                  />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}