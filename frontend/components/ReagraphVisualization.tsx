'use client';

import type React from 'react';
import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import dynamic from 'next/dynamic';
import { generateGraphFromGithub, generateGraphFromZip } from '@/utils/api';
import type {
  GraphResponse,
  GraphNode as ApiGraphNode,
  GraphEdge as ApiGraphEdge,
} from '@/api-client/types.gen';
import { useResultData } from '@/context/ResultDataContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from 'next-auth/react';
import { useApiWithAuth } from '@/hooks/useApiWithAuth';
import {
  Network,
  FileText,
  Code,
  ActivityIcon as Function,
  Variable,
  Package,
  Layers,
  Eye,
  EyeOff,
  Menu,
  X,
} from 'lucide-react';
import { EnhancedAnalysisTab } from '@/components/EnhancedAnalysisTab';
import type { CodeReference, GraphData } from '@/types/code-analysis';

// Properly import GraphCanvas with Next.js SSR handling
const GraphCanvas = dynamic(() => import('reagraph').then((mod) => mod.GraphCanvas), {
  ssr: false,
  loading: () => <GraphLoadingComponent />,
});

// Memoized loading component
const GraphLoadingComponent = memo(() => (
  <div className="flex justify-center items-center h-full">
    <div className="flex flex-col items-center gap-4 p-8">
      <div className="w-8 h-8 sm:w-12 sm:h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      <div className="text-center space-y-2">
        <p className="text-xs sm:text-sm font-medium text-foreground">Loading Graph</p>
        <p className="text-xs text-muted-foreground">Analyzing code structure...</p>
      </div>
    </div>
  </div>
));
GraphLoadingComponent.displayName = 'GraphLoadingComponent';

// Define interfaces
interface GraphNode extends ApiGraphNode {
  line: number;
  inDegree?: number;
  outDegree?: number;
  connectedFiles?: string[];
}

type GraphEdge = ApiGraphEdge;

interface ApiResponse {
  html_url: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GitHubSourceData {
  repo_url: string;
  access_token?: string;
  branch?: string;
}

type SourceData = GitHubSourceData | File;

interface ReagraphVisualizationProps {
  setParentActiveTab: (tab: string) => void;
  onError?: (error: string) => void;
  onNodeClick?: (node: GraphNode) => void;
}

interface ReagraphNode {
  id: string;
  label: string;
  fill: string;
  size: number;
}

interface ReagraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface ReagraphData {
  nodes: ReagraphNode[];
  edges: ReagraphEdge[];
}

interface CategoryConfig {
  color: string;
  icon: typeof Network;
  label: string;
  description: string;
}

type NodeCategories = Record<string, CategoryConfig>;

interface CacheEntry {
  data: ApiResponse;
  timestamp: number;
}

// Cache and constants
const apiCache = new Map<string, CacheEntry>();
const CACHE_DURATION = 5 * 60 * 1000;

const COLOR_PALETTE = [
  '#F06292',
  '#64B5F6',
  '#81C784',
  '#FFD54F',
  '#BA68C8',
  '#FF8A65',
  '#90A4AE',
  '#A1887F',
  '#4DB6AC',
  '#9575CD',
];
const ICON_LIST = [Layers, Function, Code, Variable, Package, FileText, Network];

// Utility functions
const getDynamicNodeCategories = (() => {
  const cache = new Map<string, NodeCategories>();
  return (nodes: GraphNode[] = []): NodeCategories => {
    const cacheKey = nodes
      .map((n) => n.category || 'other')
      .sort()
      .join(',');
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    const categories: NodeCategories = {};
    let colorIdx = 0,
      iconIdx = 0;

    for (const node of nodes) {
      const key = node.category?.toLowerCase() || 'other';
      if (!categories[key]) {
        categories[key] = {
          color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length],
          icon: ICON_LIST[iconIdx % ICON_LIST.length],
          label: key.charAt(0).toUpperCase() + key.slice(1),
          description: `Nodes of type "${key}"`,
        };
        colorIdx++;
        iconIdx++;
      }
    }

    if (!categories['other']) {
      categories['other'] = {
        color: '#90A4AE',
        icon: Network,
        label: 'Other',
        description: 'Other code elements',
      };
    }

    cache.set(cacheKey, categories);
    return categories;
  };
})();

const calculateNodeMetrics = (nodes: GraphNode[], edges: GraphEdge[], maxDepth = 3) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();
  const adjacencyList = new Map<string, Set<string>>();

  nodes.forEach((node) => {
    inDegreeMap.set(node.id, 0);
    outDegreeMap.set(node.id, 0);
    adjacencyList.set(node.id, new Set());
  });

  edges.forEach((edge) => {
    const sourceId = edge.source;
    const targetId = edge.target;

    outDegreeMap.set(sourceId, (outDegreeMap.get(sourceId) || 0) + 1);
    inDegreeMap.set(targetId, (inDegreeMap.get(targetId) || 0) + 1);

    if (!adjacencyList.has(sourceId)) adjacencyList.set(sourceId, new Set());
    if (!adjacencyList.has(targetId)) adjacencyList.set(targetId, new Set());

    adjacencyList.get(sourceId)!.add(targetId);
    adjacencyList.get(targetId)!.add(sourceId);
  });

  const getConnectedFiles = (nodeId: string, depth: number): Set<string> => {
    const visited = new Set<string>();
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: nodeId, currentDepth: 0 }];
    const connectedFiles = new Set<string>();

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      const node = nodeMap.get(id);
      if (node?.file && id !== nodeId) {
        connectedFiles.add(node.file);
      }

      if (currentDepth < depth) {
        const neighbors = adjacencyList.get(id) || new Set();
        neighbors.forEach((neighborId) => {
          if (!visited.has(neighborId)) {
            queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
          }
        });
      }
    }

    return connectedFiles;
  };

  return nodes.map((node) => ({
    ...node,
    inDegree: inDegreeMap.get(node.id) || 0,
    outDegree: outDegreeMap.get(node.id) || 0,
    connectedFiles: Array.from(getConnectedFiles(node.id, maxDepth)),
  }));
};

const transformApiResponseMemo = (() => {
  const cache = new WeakMap<GraphResponse, ApiResponse>();
  return (response: GraphResponse): ApiResponse => {
    if (cache.has(response)) return cache.get(response)!;

    const transformedNodes: GraphNode[] = response.nodes.map((node) => ({
      ...node,
      line: node.start_line || 0,
    }));

    const nodesWithMetrics = calculateNodeMetrics(transformedNodes, response.edges);

    const result = {
      html_url: response.html_url ?? '',
      nodes: nodesWithMetrics,
      edges: response.edges,
    };

    cache.set(response, result);
    return result;
  };
})();

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_DURATION;
}

// Overview Tab Component with improved scroll
const OverviewTab = memo(
  ({
    categoryData,
  }: {
    categoryData: Array<{ key: string; config: CategoryConfig; count: number }>;
  }) => (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        <div className="p-3 sm:p-4 space-y-4 sm:space-y-6">
          <div className="space-y-3">
            <h3 className="text-xs sm:text-sm font-semibold text-foreground">Node Types</h3>
            <div className="space-y-2">
              {categoryData.map(({ key, config, count }) => {
                const Icon = config.icon;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 sm:gap-3 p-2 rounded-lg sm:rounded-xl hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: config.color }}
                      />
                      <Icon className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                          {config.label}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {config.description}
                        </p>
                      </div>
                    </div>
                    {count > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                      >
                        {count}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs sm:text-sm font-semibold text-foreground">Interaction</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-primary flex-shrink-0"></div>
                <span>Click nodes to view enhanced code analysis</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-primary flex-shrink-0"></div>
                <span>Drag to pan the graph</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-primary flex-shrink-0"></div>
                <span>Scroll to zoom in/out</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  ),
);
OverviewTab.displayName = 'OverviewTab';

// Main Component
export default function EnhancedReagraphVisualization({
  setParentActiveTab,
  onError,
  onNodeClick,
}: ReagraphVisualizationProps) {
  const {
    sourceType,
    sourceData,
    setSelectedFilePath,
    setSelectedFileLine,
    setCodeViewerSheetOpen,
  } = useResultData();
  const [graphData, setGraphData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'map'>('overview');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState('40vw');
  const [isResizing, setIsResizing] = useState(false);
  const { data: session } = useSession();

  const generateGraphFromGithubWithAuth = useApiWithAuth(generateGraphFromGithub);
  const generateGraphFromZipWithAuth = useApiWithAuth(generateGraphFromZip);

  const hasLoadedRef = useRef(false);
  const currentRequestKeyRef = useRef<string | null>(null);
  const analysisScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const isGitHubSourceData = useCallback((data: SourceData): data is GitHubSourceData => {
    return data !== null && typeof data === 'object' && 'repo_url' in data;
  }, []);

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

  useEffect(() => {
    if (!requestKey || !isClient) return;
    if (hasLoadedRef.current && currentRequestKeyRef.current === requestKey) return;

    const cachedEntry = apiCache.get(requestKey);
    if (cachedEntry && isCacheValid(cachedEntry)) {
      setGraphData(cachedEntry.data);
      hasLoadedRef.current = true;
      currentRequestKeyRef.current = requestKey;
      return;
    }

    let isCancelled = false;

    const fetchGraph = async () => {
      setLoading(true);
      setError(null);

      try {
        let data: GraphResponse;
        if (sourceType === 'github' && sourceData && isGitHubSourceData(sourceData)) {
          data = await generateGraphFromGithubWithAuth(sourceData, session?.jwt_token || '');
        } else if (sourceType === 'zip' && sourceData instanceof File) {
          data = await generateGraphFromZipWithAuth(sourceData, session?.jwt_token || '');
        } else {
          throw new Error('Invalid source type or data');
        }

        if (!isCancelled) {
          const transformedData = transformApiResponseMemo(data);
          apiCache.set(requestKey, {
            data: transformedData,
            timestamp: Date.now(),
          });
          setGraphData(transformedData);
          hasLoadedRef.current = true;
          currentRequestKeyRef.current = requestKey;
        }
      } catch (e) {
        if (!isCancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load graph data';
          setError(msg);
          onError?.(msg);
          setGraphData(null);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchGraph();
    return () => {
      isCancelled = true;
    };
  }, [
    requestKey,
    isClient,
    sourceType,
    sourceData,
    onError,
    isGitHubSourceData,
    generateGraphFromGithubWithAuth,
    generateGraphFromZipWithAuth,
    session?.jwt_token,
  ]);

  const nodeCategories = useMemo(
    () => getDynamicNodeCategories(graphData?.nodes),
    [graphData?.nodes],
  );

  const getNodeColor = useCallback(
    (category: string) =>
      nodeCategories[category?.toLowerCase()]?.color || nodeCategories['other'].color,
    [nodeCategories],
  );

  // Resize handlers
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

  interface ReaGraphGraphNode {
    id: string;
    label?: string;
    type?: string;
  }

  const handleNodeClick = useCallback(
    (node: ReaGraphGraphNode) => {
      const graphNode = graphData?.nodes.find((n) => n.id === node.id);
      if (graphNode) {
        setSelectedNode(graphNode);
        setActiveTab('analysis');
        setIsMobileSidebarOpen(true);
        onNodeClick?.(graphNode);

        // Scroll to top of analysis content after a brief delay
        setTimeout(() => {
          if (analysisScrollRef.current) {
            analysisScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }, 100);
      }
    },
    [graphData?.nodes, onNodeClick],
  );

  const handleOpenFile = useCallback(
    (filePath: string, line?: number) => {
      setSelectedFilePath?.(filePath);
      setSelectedFileLine?.(line || 1);
      setCodeViewerSheetOpen?.(true);
      setParentActiveTab?.('explorer');
      setIsMobileSidebarOpen(false);
    },
    [setSelectedFilePath, setSelectedFileLine, setCodeViewerSheetOpen, setParentActiveTab],
  );

  const reagraphData = useMemo((): ReagraphData | null => {
    if (!graphData?.nodes?.length) return null;
    return {
      nodes: graphData.nodes.map((node) => ({
        id: node.id,
        label: node.name,
        fill: getNodeColor(node.category),
        size: Math.max(8, Math.min(16, node.name.length * 0.6 + 6)),
      })),
      edges:
        graphData.edges?.map((edge, index) => ({
          id: `edge-${index}`,
          source: edge.source,
          target: edge.target,
          label: edge.relationship,
        })) || [],
    };
  }, [graphData?.nodes, graphData?.edges, getNodeColor]);

  const categoryData = useMemo(() => {
    if (!graphData?.nodes) return [];
    const categoryCount = graphData.nodes.reduce((acc, node) => {
      const category = node.category?.toLowerCase() || 'other';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(nodeCategories)
      .map(([key, config]) => ({ key, config, count: categoryCount[key] || 0 }))
      .filter((item) => item.count > 0 || item.key === 'other');
  }, [graphData?.nodes, nodeCategories]);

  const handleTryAgain = useCallback(() => {
    if (requestKey) apiCache.delete(requestKey);
    hasLoadedRef.current = false;
    currentRequestKeyRef.current = null;
    window.location.reload();
  }, [requestKey]);

  // Convert GraphNode to CodeReference for the analyzer
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

  // Convert ApiResponse to GraphData for the analyzer
  const analysisGraphData: GraphData | null = useMemo(() => {
    if (!graphData) return null;
    return {
      nodes: graphData.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        file: node.file || '',
        code: node.code || '',
        category: node.category || 'other',
        start_line: node.start_line ?? undefined,
        end_line: node.end_line ?? undefined,
      })),
      edges: graphData.edges,
    };
  }, [graphData]);

  if (!isClient) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="flex flex-col items-center gap-4 p-8">
          <div className="w-8 h-8 sm:w-12 sm:h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <div className="text-center space-y-2">
            <p className="text-xs sm:text-sm font-medium text-foreground">Initializing</p>
            <p className="text-xs text-muted-foreground">
              Setting up enhanced graph visualization...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="flex flex-col items-center gap-4 p-8">
          <div className="w-8 h-8 sm:w-12 sm:h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <div className="text-center space-y-2">
            <p className="text-xs sm:text-sm font-medium text-foreground">Analyzing Dependencies</p>
            <p className="text-xs text-muted-foreground">This may take a few moments...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-center space-y-4 p-8">
          <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-xl sm:rounded-2xl bg-red-50 dark:bg-red-950/20 flex items-center justify-center">
            <Network className="h-6 w-6 sm:h-8 sm:w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm sm:text-base font-medium text-foreground">
              Failed to Load Graph
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md">{error}</p>
          </div>
          <Button
            variant="outline"
            onClick={handleTryAgain}
            className="rounded-xl text-xs sm:text-sm"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!reagraphData || reagraphData.nodes.length === 0) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-center space-y-4 p-8">
          <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-xl sm:rounded-2xl bg-muted/50 flex items-center justify-center">
            <Network className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground/50" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm sm:text-base font-medium text-foreground">
              No Dependencies Found
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md">
              The repository may not have analyzable code structure or dependencies
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[70vh] w-full bg-background/60 backdrop-blur-xl rounded-xl sm:rounded-2xl overflow-hidden relative">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Overlay background, click to close */}
          <div
            className="flex-1 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
            style={{ minWidth: 0 }}
          />
          {/* Sidebar panel */}
          <div className="w-80 max-w-full h-full bg-background border-l border-border/30 shadow-xl relative z-10 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border/30 flex-shrink-0">
              <h3 className="font-semibold text-sm">Enhanced Analysis</h3>
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
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as 'overview' | 'analysis')}
                className="flex-1 flex flex-col h-full"
              >
                <div className="p-3 border-b border-border/30 flex-shrink-0">
                  <TabsList className="grid w-full grid-cols-2 bg-muted/30 backdrop-blur-sm rounded-xl">
                    <TabsTrigger
                      value="overview"
                      className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs"
                    >
                      <Network className="w-3 h-3 mr-1" />
                      Overview
                    </TabsTrigger>
                    <TabsTrigger
                      value="analysis"
                      className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs"
                    >
                      <Code className="w-3 h-3 mr-1" />
                      Analysis
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="flex-1 overflow-hidden">
                  <TabsContent value="overview" className="h-full m-0 p-0">
                    <OverviewTab categoryData={categoryData} />
                  </TabsContent>
                  <TabsContent value="analysis" className="h-full m-0 p-0">
                    <div className="h-full" ref={analysisScrollRef}>
                      {analysisGraphData && (
                        <EnhancedAnalysisTab
                          selectedNode={selectedCodeReference}
                          graphData={analysisGraphData}
                          onNodeSelect={(node) => {
                            const graphNode = graphData?.nodes.find((n) => n.id === node.id);
                            if (graphNode) {
                              setSelectedNode(graphNode);
                              onNodeClick?.(graphNode);
                            }
                          }}
                          onOpenFile={handleOpenFile}
                        />
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>
        </div>
      )}

      {/* Mobile View - Show message instead of graph */}
      <div className="lg:hidden flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
              <Network className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Desktop View Required</h3>
              <p className="text-sm text-muted-foreground">
                The dependency graph visualization is optimized for desktop screens. Use the
                analysis panel below for detailed code insights.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="rounded-xl"
            >
              <Menu className="h-4 w-4 mr-2" />
              Open Analysis Panel
            </Button>
          </div>
        </div>

        {/* Stats Badge for mobile */}
        <div className="absolute top-3 right-3">
          <Badge className="bg-background/90 backdrop-blur-sm border-border/60 text-foreground rounded-xl px-2 py-1 text-xs">
            {reagraphData.nodes.length}N • {reagraphData.edges.length}E
          </Badge>
        </div>
      </div>

      {/* Desktop Graph Canvas - Only show on lg and above */}
      <div className="hidden lg:block lg:flex-1 relative min-w-0">
        <div className="absolute inset-0 bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-sm">
          <GraphCanvas
            nodes={reagraphData.nodes}
            edges={reagraphData.edges}
            labelType="all"
            draggable={true}
            animated={true}
            layoutType="forceDirected2d"
            sizingType="centrality"
            onNodeClick={handleNodeClick}
          />
        </div>

        {/* Desktop Graph Controls */}
        <div className="absolute top-4 left-4 items-center gap-2">
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
          </TooltipProvider>
        </div>

        {/* Stats Badge for desktop */}
        <div className="absolute top-4 right-4">
          <Badge className="bg-background/90 backdrop-blur-sm border-border/60 text-foreground rounded-xl px-3 py-1 text-xs">
            {reagraphData.nodes.length} nodes • {reagraphData.edges.length} edges
          </Badge>
        </div>
      </div>

      {/* Desktop Sidebar */}
      {showSidebar && (
        <div
          className="hidden lg:flex border-l border-border/30 bg-background/40 backdrop-blur-sm flex-col relative hover:border-l-2 hover:border-primary/20 transition-all duration-200"
          style={{ width: typeof sidebarWidth === 'string' ? sidebarWidth : `${sidebarWidth}px` }}
        >
          {/* Resize Handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize group z-10 flex items-center justify-center"
            onMouseDown={handleMouseDown}
          >
            <div className="w-1 h-8 bg-border/40 rounded-full group-hover:bg-primary/60 transition-colors relative">
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
                <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
                <div className="w-0.5 h-0.5 bg-muted-foreground/40 rounded-full group-hover:bg-primary-foreground/80 transition-colors"></div>
              </div>
            </div>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <div className="bg-popover text-popover-foreground text-xs px-2 py-1 rounded-md shadow-md whitespace-nowrap">
                Drag to resize
              </div>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'overview' | 'analysis')}
            className="flex-1 flex flex-col h-full"
          >
            {/* Desktop Tab Navigation */}
            <div className="p-4 border-b border-border/30 flex-shrink-0">
              <TabsList className="grid w-full grid-cols-2 bg-muted/30 backdrop-blur-sm rounded-xl">
                <TabsTrigger
                  value="overview"
                  className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-sm"
                >
                  <Network className="w-4 h-4 mr-1.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="analysis"
                  className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-sm"
                >
                  <Code className="w-4 h-4 mr-1.5" />
                  Analysis
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Desktop Tab Content */}
            <div className="flex-1 overflow-hidden">
              <TabsContent value="overview" className="h-full m-0 p-0">
                <OverviewTab categoryData={categoryData} />
              </TabsContent>

              <TabsContent value="analysis" className="h-full m-0 p-0">
                <div className="h-full" ref={analysisScrollRef}>
                  {analysisGraphData && (
                    <EnhancedAnalysisTab
                      selectedNode={selectedCodeReference}
                      graphData={analysisGraphData}
                      onNodeSelect={(node) => {
                        const graphNode = graphData?.nodes.find((n) => n.id === node.id);
                        if (graphNode) {
                          setSelectedNode(graphNode);
                          onNodeClick?.(graphNode);
                        }
                      }}
                      onOpenFile={handleOpenFile}
                    />
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
