'use client';

import { useMemo, useState, useCallback } from 'react';
import { Network, Eye, EyeOff, Maximize2, RotateCcw, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { 
  GraphData, 
  CodeReference, 
  RelationshipSummary 
} from '@/types/code-analysis';

interface MiniNetworkViewerProps {
  selectedNode: CodeReference;
  graphData: GraphData;
  onNodeSelect: (node: CodeReference) => void;
  maxDepth?: number;
}

interface NetworkNode {
  id: string;
  node: CodeReference;
  x: number;
  y: number;
  level: number;
  importance: number;
  relationships: string[];
}

interface NetworkEdge {
  source: string;
  target: string;
  relationship: string;
  strength: number;
}

export function MiniNetworkViewer({
  selectedNode,
  graphData,
  onNodeSelect,
  maxDepth = 2,
}: MiniNetworkViewerProps) {
  const [viewDepth, setViewDepth] = useState(maxDepth);
  const [showLabels, setShowLabels] = useState(true);
  const [showRelationships, setShowRelationships] = useState(true);
  const [highlightConnected, setHighlightConnected] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build network data focused on selected node
  const networkData = useMemo(() => {
    const visited = new Set<string>();
    const nodes = new Map<string, NetworkNode>();
    const edges: NetworkEdge[] = [];

    // Add center node
    nodes.set(selectedNode.id, {
      id: selectedNode.id,
      node: selectedNode,
      x: 0,
      y: 0,
      level: 0,
      importance: 10,
      relationships: [],
    });

    // BFS to build network up to viewDepth
    const queue: { nodeId: string; level: number }[] = [{ nodeId: selectedNode.id, level: 0 }];
    visited.add(selectedNode.id);

    while (queue.length > 0) {
      const { nodeId, level } = queue.shift()!;
      
      if (level >= viewDepth) continue;

      // Find connected edges
      const connectedEdges = graphData.edges.filter(
        edge => edge.source === nodeId || edge.target === nodeId
      );

      connectedEdges.forEach(edge => {
        const connectedNodeId = edge.source === nodeId ? edge.target : edge.source;
        const connectedNode = graphData.nodes.find(n => n.id === connectedNodeId);
        
        if (!connectedNode) return;

        // Add edge
        edges.push({
          source: edge.source,
          target: edge.target,
          relationship: edge.relationship || 'connected',
          strength: 1,
        });

        // Add connected node if not already added
        if (!visited.has(connectedNodeId)) {
          visited.add(connectedNodeId);
          
          // Calculate importance based on connections
          const connectionCount = graphData.edges.filter(
            e => e.source === connectedNodeId || e.target === connectedNodeId
          ).length;
          
          const importance = Math.min(connectionCount, 10);
          
          // Calculate position in a circle around center
          const existingAtLevel = Array.from(nodes.values()).filter(n => n.level === level + 1);
          const angleStep = (Math.PI * 2) / Math.max(6, connectedEdges.length);
          const angle = existingAtLevel.length * angleStep;
          const radius = (level + 1) * 100;
          
          nodes.set(connectedNodeId, {
            id: connectedNodeId,
            node: connectedNode,
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            level: level + 1,
            importance,
            relationships: [edge.relationship || 'connected'],
          });

          // Add to queue for next level
          if (level + 1 < viewDepth) {
            queue.push({ nodeId: connectedNodeId, level: level + 1 });
          }
        } else {
          // Update existing node's relationships
          const existingNode = nodes.get(connectedNodeId);
          if (existingNode && !existingNode.relationships.includes(edge.relationship || 'connected')) {
            existingNode.relationships.push(edge.relationship || 'connected');
          }
        }
      });
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }, [selectedNode, graphData, viewDepth]);

  // Calculate relationship summary
  const relationshipSummary = useMemo(() => {
    const summary: RelationshipSummary = {
      calls: { count: 0, examples: [] },
      calledBy: { count: 0, examples: [] },
      imports: { count: 0, examples: [] },
      exports: { count: 0, examples: [] },
      totalConnections: 0,
    };

    networkData.edges.forEach(edge => {
      const relationship = edge.relationship.toLowerCase();
      
      if (edge.source === selectedNode.id) {
        // Outgoing relationships
        if (relationship.includes('call') || relationship.includes('invoke')) {
          summary.calls.count++;
          const targetNode = graphData.nodes.find(n => n.id === edge.target);
          if (targetNode && summary.calls.examples.length < 3) {
            summary.calls.examples.push(targetNode);
          }
        }
        if (relationship.includes('export')) {
          summary.exports.count++;
          const targetNode = graphData.nodes.find(n => n.id === edge.target);
          if (targetNode && summary.exports.examples.length < 3) {
            summary.exports.examples.push(targetNode);
          }
        }
      } else if (edge.target === selectedNode.id) {
        // Incoming relationships
        if (relationship.includes('call') || relationship.includes('invoke')) {
          summary.calledBy.count++;
          const sourceNode = graphData.nodes.find(n => n.id === edge.source);
          if (sourceNode && summary.calledBy.examples.length < 3) {
            summary.calledBy.examples.push(sourceNode);
          }
        }
        if (relationship.includes('import')) {
          summary.imports.count++;
          const sourceNode = graphData.nodes.find(n => n.id === edge.source);
          if (sourceNode && summary.imports.examples.length < 3) {
            summary.imports.examples.push(sourceNode);
          }
        }
      }
    });

    summary.totalConnections = networkData.nodes.length - 1; // Exclude center node

    return summary;
  }, [networkData, selectedNode.id, graphData.nodes]);

  const handleNodeClick = useCallback((node: NetworkNode) => {
    onNodeSelect(node.node);
  }, [onNodeSelect]);

  const getNodeColor = useCallback((node: NetworkNode, isHovered: boolean) => {
    if (node.id === selectedNode.id) return '#3b82f6'; // Primary blue
    if (isHovered) return '#f59e0b'; // Amber
    if (highlightConnected && hoveredNode === selectedNode.id) return '#10b981'; // Green
    
    switch (node.node.category) {
      case 'function': return '#8b5cf6'; // Purple
      case 'class': return '#ef4444'; // Red
      case 'module': return '#06b6d4'; // Cyan
      default: return '#6b7280'; // Gray
    }
  }, [selectedNode.id, highlightConnected, hoveredNode]);

  const getEdgeColor = useCallback((edge: NetworkEdge) => {
    const relationship = edge.relationship.toLowerCase();
    if (relationship.includes('call')) return '#3b82f6';
    if (relationship.includes('import')) return '#10b981';
    if (relationship.includes('export')) return '#f59e0b';
    return '#6b7280';
  }, []);

  const svgViewBox = useMemo(() => {
    if (networkData.nodes.length === 0) return "0 0 400 300";
    
    const padding = 50;
    const minX = Math.min(...networkData.nodes.map(n => n.x)) - padding;
    const maxX = Math.max(...networkData.nodes.map(n => n.x)) + padding;
    const minY = Math.min(...networkData.nodes.map(n => n.y)) - padding;
    const maxY = Math.max(...networkData.nodes.map(n => n.y)) + padding;
    
    const width = maxX - minX || 400;
    const height = maxY - minY || 300;
    
    return `${minX} ${minY} ${width} ${height}`;
  }, [networkData.nodes]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-border/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Network View</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <Maximize2 className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <Share2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Depth: {viewDepth}</label>
            <div className="w-32">
              <Slider
                value={[viewDepth]}
                onValueChange={([value]) => setViewDepth(value)}
                max={4}
                min={1}
                step={1}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="labels"
                checked={showLabels}
                onCheckedChange={setShowLabels}
                size="sm"
              />
              <label htmlFor="labels" className="text-sm">Labels</label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="relationships"
                checked={showRelationships}
                onCheckedChange={setShowRelationships}
                size="sm"
              />
              <label htmlFor="relationships" className="text-sm">Relations</label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="highlight"
                checked={highlightConnected}
                onCheckedChange={setHighlightConnected}
                size="sm"
              />
              <label htmlFor="highlight" className="text-sm">Highlight</label>
            </div>
          </div>
        </div>
      </div>

      {/* Network Visualization */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 p-4">
          <Card className="h-full">
            <CardContent className="p-4 h-full">
              <svg
                viewBox={svgViewBox}
                className="w-full h-full"
                style={{ background: 'var(--background)' }}
              >
                {/* Define gradients and patterns */}
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path
                      d="M 20 0 L 0 0 0 20"
                      fill="none"
                      stroke="var(--border)"
                      strokeOpacity="0.1"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>

                {/* Grid background */}
                <rect
                  width="100%"
                  height="100%"
                  fill="url(#grid)"
                />

                {/* Edges */}
                {networkData.edges.map((edge, index) => {
                  const sourceNode = networkData.nodes.find(n => n.id === edge.source);
                  const targetNode = networkData.nodes.find(n => n.id === edge.target);
                  
                  if (!sourceNode || !targetNode) return null;

                  return (
                    <g key={`edge-${index}`}>
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={getEdgeColor(edge)}
                        strokeWidth="2"
                        strokeOpacity="0.6"
                        markerEnd="url(#arrowhead)"
                      />
                      {showRelationships && (
                        <text
                          x={(sourceNode.x + targetNode.x) / 2}
                          y={(sourceNode.y + targetNode.y) / 2}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--muted-foreground)"
                          className="pointer-events-none"
                        >
                          {edge.relationship}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Arrow marker */}
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 10 3.5, 0 7"
                      fill="var(--muted-foreground)"
                      fillOpacity="0.6"
                    />
                  </marker>
                </defs>

                {/* Nodes */}
                {networkData.nodes.map((node) => {
                  const isCenter = node.id === selectedNode.id;
                  const isHovered = hoveredNode === node.id;
                  const radius = isCenter ? 12 : 8 + (node.importance / 2);
                  
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => handleNodeClick(node)}
                    >
                      {/* Node circle */}
                      <circle
                        r={radius}
                        fill={getNodeColor(node, isHovered)}
                        stroke={isCenter ? '#ffffff' : 'transparent'}
                        strokeWidth={isCenter ? '3' : '0'}
                        className="transition-all duration-200"
                        style={{
                          filter: isHovered ? 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))' : 'none',
                          transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                        }}
                      />
                      
                      {/* Node label */}
                      {showLabels && (
                        <text
                          y={radius + 16}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--foreground)"
                          className="pointer-events-none font-medium"
                        >
                          {node.node.name.length > 12 
                            ? `${node.node.name.slice(0, 12)}...` 
                            : node.node.name}
                        </text>
                      )}
                      
                      {/* Category badge */}
                      {isHovered && (
                        <text
                          y={-radius - 8}
                          textAnchor="middle"
                          fontSize="8"
                          fill="var(--muted-foreground)"
                          className="pointer-events-none"
                        >
                          {node.node.category}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Relationship Summary */}
      <div className="flex-shrink-0 p-4 border-t border-border/20">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Relationship Summary</h4>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Calls</span>
                <Badge variant="outline" className="h-5 px-2">
                  {relationshipSummary.calls.count}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Called By</span>
                <Badge variant="outline" className="h-5 px-2">
                  {relationshipSummary.calledBy.count}
                </Badge>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Imports</span>
                <Badge variant="outline" className="h-5 px-2">
                  {relationshipSummary.imports.count}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Exports</span>
                <Badge variant="outline" className="h-5 px-2">
                  {relationshipSummary.exports.count}
                </Badge>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border/20">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Total Connections</span>
              <Badge variant="secondary" className="h-5 px-2">
                {relationshipSummary.totalConnections}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}