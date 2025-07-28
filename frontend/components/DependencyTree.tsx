'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Activity, 
         ExternalLink, Copy, Check, Search, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { 
  CodeReference, 
  GraphData, 
  DependencyTreeNode, 
  DeadCodeResult 
} from '@/types/code-analysis';
import { analyzeCodeHealth } from '@/utils/dead-code-analyzer';

interface DependencyTreeProps {
  selectedNode: CodeReference;
  graphData: GraphData;
  maxDepth?: number;
  onNodeSelect: (node: CodeReference) => void;
  onOpenFile: (filePath: string, line?: number) => void;
}

interface TreeViewProps {
  nodes: DependencyTreeNode[];
  level: number;
  onToggle: (nodeId: string) => void;
  onNodeSelect: (node: CodeReference) => void;
  onOpenFile: (filePath: string, line?: number) => void;
  searchTerm: string;
  deadCodeMap: Map<string, DeadCodeResult>;
}

export function DependencyTree({
  selectedNode,
  graphData,
  maxDepth = 4,
  onNodeSelect,
  onOpenFile,
}: DependencyTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([selectedNode.id]));
  const [viewMode, setViewMode] = useState<'incoming' | 'outgoing' | 'both'>('both');
  const [searchTerm, setSearchTerm] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'functions' | 'modules' | 'classes'>('all');

  // Analyze code health for highlighting issues
  const codeHealth = useMemo(() => {
    return analyzeCodeHealth(graphData);
  }, [graphData]);

  const deadCodeMap = useMemo(() => {
    const map = new Map<string, DeadCodeResult>();
    codeHealth.deadCode.forEach(result => {
      map.set(result.node.id, result);
    });
    return map;
  }, [codeHealth]);

  // Build dependency tree structure
  const dependencyTree = useMemo(() => {
    const visited = new Set<string>();
    const nodeMap = new Map(graphData.nodes.map(node => [node.id, node]));

    function buildTree(
      nodeId: string, 
      depth: number, 
      relationship: string = 'root'
    ): DependencyTreeNode | null {
      if (depth > maxDepth || visited.has(`${nodeId}-${depth}`)) return null;
      
      visited.add(`${nodeId}-${depth}`);
      const node = nodeMap.get(nodeId);
      if (!node) return null;

      // Get connected edges based on view mode
      let relevantEdges = graphData.edges.filter(edge => {
        if (viewMode === 'incoming') {
          return edge.target === nodeId;
        } else if (viewMode === 'outgoing') {
          return edge.source === nodeId;
        } else {
          return edge.source === nodeId || edge.target === nodeId;
        }
      });

      // Apply type filter
      if (filterType !== 'all') {
        const targetCategory = filterType === 'functions' ? ['function', 'method'] :
                             filterType === 'modules' ? ['module'] :
                             filterType === 'classes' ? ['class'] : [];
        
        relevantEdges = relevantEdges.filter(edge => {
          const targetNodeId = edge.source === nodeId ? edge.target : edge.source;
          const targetNode = nodeMap.get(targetNodeId);
          return targetNode && targetCategory.includes(targetNode.category);
        });
      }

      const children: DependencyTreeNode[] = [];
      
      if (depth < maxDepth) {
        relevantEdges.forEach(edge => {
          const childNodeId = edge.source === nodeId ? edge.target : edge.source;
          const childRelationship = edge.relationship || 'connected';
          
          if (childNodeId !== nodeId) {
            const childTree = buildTree(childNodeId, depth + 1, childRelationship);
            if (childTree) {
              children.push(childTree);
            }
          }
        });
      }

      // Calculate complexity score for this node
      const nodeConnections = graphData.edges.filter(
        edge => edge.source === nodeId || edge.target === nodeId
      ).length;

      return {
        id: nodeId,
        node,
        relationship,
        depth,
        children: children.sort((a, b) => {
          // Sort by importance: dead code last, then by connection count
          const aDeadCode = deadCodeMap.has(a.id) ? 1 : 0;
          const bDeadCode = deadCodeMap.has(b.id) ? 1 : 0;
          
          if (aDeadCode !== bDeadCode) return aDeadCode - bDeadCode;
          
          const aConnections = graphData.edges.filter(
            e => e.source === a.id || e.target === a.id
          ).length;
          const bConnections = graphData.edges.filter(
            e => e.source === b.id || e.target === b.id
          ).length;
          
          return bConnections - aConnections;
        }),
        isExpanded: expandedNodes.has(nodeId),
        hasDeadCode: deadCodeMap.has(nodeId),
        complexityScore: Math.min(nodeConnections * 5, 100), // Scale to 0-100
      };
    }

    const tree = buildTree(selectedNode.id, 0);
    return tree ? [tree] : [];
  }, [selectedNode, graphData, maxDepth, viewMode, expandedNodes, filterType, deadCodeMap]);

  // Filter tree based on search term
  const filteredTree = useMemo(() => {
    if (!searchTerm) return dependencyTree;

    function filterNodes(nodes: DependencyTreeNode[]): DependencyTreeNode[] {
      return nodes.filter(treeNode => {
        const matchesSearch = 
          treeNode.node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          treeNode.node.file.toLowerCase().includes(searchTerm.toLowerCase()) ||
          treeNode.relationship.toLowerCase().includes(searchTerm.toLowerCase());

        // If this node matches, include it
        if (matchesSearch) return true;

        // If any child matches, include this node too
        const filteredChildren = filterNodes(treeNode.children);
        if (filteredChildren.length > 0) {
          treeNode.children = filteredChildren;
          return true;
        }

        return false;
      });
    }

    return filterNodes(dependencyTree);
  }, [dependencyTree, searchTerm]);

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allNodeIds = new Set<string>();
    
    function collectIds(nodes: DependencyTreeNode[]) {
      nodes.forEach(node => {
        allNodeIds.add(node.id);
        collectIds(node.children);
      });
    }
    
    collectIds(dependencyTree);
    setExpandedNodes(allNodeIds);
  }, [dependencyTree]);

  const handleCollapseAll = useCallback(() => {
    setExpandedNodes(new Set([selectedNode.id]));
  }, [selectedNode.id]);


  const stats = useMemo(() => {
    let totalNodes = 0;
    let deadCodeCount = 0;
    let maxDepthReached = 0;

    function countNodes(nodes: DependencyTreeNode[]) {
      nodes.forEach(node => {
        totalNodes++;
        if (node.hasDeadCode) deadCodeCount++;
        maxDepthReached = Math.max(maxDepthReached, node.depth);
        countNodes(node.children);
      });
    }

    countNodes(dependencyTree);

    return {
      totalNodes,
      deadCodeCount,
      maxDepthReached,
      healthScore: totalNodes > 0 ? Math.round((1 - deadCodeCount / totalNodes) * 100) : 100,
    };
  }, [dependencyTree]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header */}
      <div className="flex-shrink-0 p-2 border-b border-border/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{stats.totalNodes} nodes</span>
            <span>D: {stats.maxDepthReached + 1}</span>
            <span>H: {stats.healthScore}%</span>
            {stats.deadCodeCount > 0 && (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{stats.deadCodeCount}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExpandAll}
              className="h-6 px-2 text-xs"
            >
              <span className="hidden sm:inline">Expand</span>
              <span className="sm:hidden">+</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCollapseAll}
              className="h-6 px-2 text-xs"
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Compact Controls */}
      <div className="flex-shrink-0 p-2 border-b border-border/20 space-y-2">
        {/* View Mode and Search */}
        <div className="flex gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="flex-1">
            <TabsList className="grid w-full grid-cols-3 bg-muted/30 h-6">
              <TabsTrigger value="incoming" className="text-xs px-1">
                In
              </TabsTrigger>
              <TabsTrigger value="outgoing" className="text-xs px-1">
                Out
              </TabsTrigger>
              <TabsTrigger value="both" className="text-xs px-1">
                Both
              </TabsTrigger>
            </TabsList>
          </Tabs>
          
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-2 py-1 text-xs bg-background/80 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="all">All</option>
            <option value="functions">Funcs</option>
            <option value="modules">Mods</option>
            <option value="classes">Class</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs bg-background/80 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-2">
            {filteredTree.length > 0 ? (
              <TreeView
                nodes={filteredTree}
                level={0}
                onToggle={handleToggle}
                onNodeSelect={onNodeSelect}
                onOpenFile={onOpenFile}
                searchTerm={searchTerm}
                deadCodeMap={deadCodeMap}
              />
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-xl bg-muted/30 flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-2">No dependencies found</h3>
                <p className="text-xs text-muted-foreground">
                  Try adjusting your search terms or filters
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Copy Success Toast */}
      {copySuccess && (
        <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm z-50">
          <Check className="w-4 h-4" />
          Path copied to clipboard
        </div>
      )}
    </div>
  );
}

function TreeView({
  nodes,
  level,
  onToggle,
  onNodeSelect,
  onOpenFile,
  searchTerm,
  deadCodeMap,
}: TreeViewProps) {
  const handleCopyPath = useCallback(async (node: CodeReference) => {
    try {
      await navigator.clipboard.writeText(`${node.file}:${node.start_line || 1}`);
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  }, []);

  return (
    <div className="space-y-1">
      {nodes.map((treeNode) => (
        <div key={`${treeNode.id}-${level}`} className="group">
          <div
            className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors ${
              level === 0 ? 'bg-primary/5 border border-primary/20' : ''
            }`}
            style={{ paddingLeft: `${level * 20 + 12}px` }}
          >
            {/* Expand/Collapse Button */}
            {treeNode.children.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(treeNode.id);
                }}
              >
                {treeNode.isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </Button>
            )}

            {/* Node Icon */}
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              treeNode.hasDeadCode ? 'bg-amber-500' :
              treeNode.node.category === 'function' ? 'bg-blue-500' :
              treeNode.node.category === 'class' ? 'bg-green-500' :
              treeNode.node.category === 'module' ? 'bg-purple-500' :
              'bg-gray-500'
            }`} />

            {/* Node Content */}
            <div 
              className="flex-1 min-w-0 flex items-center gap-2"
              onClick={() => onNodeSelect(treeNode.node)}
            >
              <span className="text-sm font-medium truncate">
                {highlightSearchTerm(treeNode.node.name, searchTerm)}
              </span>

              <Badge variant="outline" className="text-xs px-1 py-0">
                {treeNode.node.category}
              </Badge>

              {treeNode.relationship !== 'root' && (
                <Badge variant="secondary" className="text-xs px-1 py-0">
                  {treeNode.relationship}
                </Badge>
              )}

              {treeNode.hasDeadCode && (
                <Badge variant="destructive" className="text-xs px-1 py-0">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Issue
                </Badge>
              )}

              {(treeNode.complexityScore ?? 0) > 50 && (
                <Badge variant="outline" className="text-xs px-1 py-0 text-amber-600">
                  Complex
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFile(treeNode.node.file, treeNode.node.start_line);
                }}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyPath(treeNode.node);
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Dead Code Details */}
          {treeNode.hasDeadCode && treeNode.isExpanded && (
            <div className="ml-8 mt-1 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="text-xs text-amber-800 dark:text-amber-200">
                <div className="font-medium mb-1">Code Issue Detected:</div>
                <div>{deadCodeMap.get(treeNode.id)?.reason}</div>
                {deadCodeMap.get(treeNode.id)?.suggestions && (
                  <div className="mt-1 text-amber-700 dark:text-amber-300">
                    Suggestion: {deadCodeMap.get(treeNode.id)?.suggestions?.[0]}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Render Children */}
          {treeNode.isExpanded && treeNode.children.length > 0 && (
            <TreeView
              nodes={treeNode.children}
              level={level + 1}
              onToggle={onToggle}
              onNodeSelect={onNodeSelect}
              onOpenFile={onOpenFile}
              searchTerm={searchTerm}
              deadCodeMap={deadCodeMap}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function highlightSearchTerm(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm) return text;

  const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'));
  return parts.map((part, index) =>
    part.toLowerCase() === searchTerm.toLowerCase() ? (
      <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">
        {part}
      </mark>
    ) : (
      part
    )
  );
}