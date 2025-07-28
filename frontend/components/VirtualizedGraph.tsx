'use client';

import React, { 
  useRef, 
  useEffect, 
  useState, 
  useCallback, 
  useMemo,
  MouseEvent,
  WheelEvent 
} from 'react';
import type { GraphNode, GraphEdge } from '@/api-client/types.gen';
import type { EnhancedGraphNode } from '@/hooks/useGraphWorker';

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

interface NodePosition {
  x: number;
  y: number;
}

interface VirtualizedGraphProps {
  nodes: EnhancedGraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: EnhancedGraphNode) => void;
  onNodeHover?: (node: EnhancedGraphNode | null) => void;
  highlightedNodes?: Set<string>;
  selectedNodeId?: string | null;
  width?: number;
  height?: number;
  className?: string;
}

interface RenderedNode extends EnhancedGraphNode {
  position: NodePosition;
  screenX: number;
  screenY: number;
  isVisible: boolean;
  renderRadius: number;
}

interface RenderedEdge extends GraphEdge {
  sourcePos: NodePosition;
  targetPos: NodePosition;
  isVisible: boolean;
}

const NODE_COLORS = {
  module: '#10b981',
  class: '#0ea5e9', 
  method: '#f59e0b',
  function: '#f97316',
  external_symbol: '#a3a3a3',
  directory: '#6b7280',
  default: '#6b7280',
};

const NODE_SIZES = {
  high: 12,
  medium: 8,
  low: 6,
};

export function VirtualizedGraph({
  nodes,
  edges,
  onNodeClick,
  onNodeHover,
  highlightedNodes = new Set(),
  selectedNodeId,
  width = 800,
  height = 600,
  className = '',
}: VirtualizedGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const isMouseDownRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  
  const [viewport, setViewport] = useState<Viewport>({
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    scale: 1,
  });

  const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Initialize node positions using a simple force-directed layout
  const initializeNodePositions = useCallback(() => {
    if (nodes.length === 0) return;

    const positions = new Map<string, NodePosition>();
    const centerX = 0;
    const centerY = 0;
    
    // Simple circular layout for initial positioning
    const radius = Math.min(width, height) * 0.3;
    const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1);
    
    nodes.forEach((node, index) => {
      // Important nodes get positions closer to center
      const importance = node.importanceScore || 0;
      const distanceMultiplier = Math.max(0.3, 1 - importance / 50);
      
      const angle = index * angleStep;
      const distance = radius * distanceMultiplier;
      
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * distance + (Math.random() - 0.5) * 50,
        y: centerY + Math.sin(angle) * distance + (Math.random() - 0.5) * 50,
      });
    });

    setNodePositions(positions);
  }, [nodes, width, height]);

  // Apply simple force-directed layout simulation
  const updateNodePositions = useCallback(() => {
    if (nodes.length === 0 || edges.length === 0) return;

    setNodePositions(currentPositions => {
      const newPositions = new Map(currentPositions);
      const forces = new Map<string, { fx: number; fy: number }>();
      
      // Initialize forces
      nodes.forEach(node => {
        forces.set(node.id, { fx: 0, fy: 0 });
      });

      // Repulsion forces between all nodes
      nodes.forEach(nodeA => {
        const posA = newPositions.get(nodeA.id);
        if (!posA) return;

        nodes.forEach(nodeB => {
          if (nodeA.id === nodeB.id) return;
          
          const posB = newPositions.get(nodeB.id);
          if (!posB) return;

          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0 && distance < 200) {
            const repulsionForce = 100 / (distance * distance);
            const forceA = forces.get(nodeA.id)!;
            forceA.fx += (dx / distance) * repulsionForce;
            forceA.fy += (dy / distance) * repulsionForce;
          }
        });
      });

      // Attraction forces for connected nodes
      edges.forEach(edge => {
        const sourcePos = newPositions.get(edge.source);
        const targetPos = newPositions.get(edge.target);
        
        if (!sourcePos || !targetPos) return;

        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          const attractionForce = Math.min(distance * 0.01, 2);
          
          const sourceForce = forces.get(edge.source)!;
          const targetForce = forces.get(edge.target)!;
          
          sourceForce.fx += (dx / distance) * attractionForce;
          sourceForce.fy += (dy / distance) * attractionForce;
          targetForce.fx -= (dx / distance) * attractionForce;
          targetForce.fy -= (dy / distance) * attractionForce;
        }
      });

      // Apply forces with damping
      const damping = 0.8;
      forces.forEach((force, nodeId) => {
        const currentPos = newPositions.get(nodeId);
        if (!currentPos) return;

        newPositions.set(nodeId, {
          x: currentPos.x + force.fx * damping,
          y: currentPos.y + force.fy * damping,
        });
      });

      return newPositions;
    });
  }, [nodes, edges]);

  // Calculate visible nodes and edges based on viewport
  const visibleElements = useMemo(() => {
    const visibleNodes: RenderedNode[] = [];
    const visibleEdges: RenderedEdge[] = [];
    
    const buffer = 50; // Render buffer outside viewport
    const minX = viewport.x - buffer;
    const maxX = viewport.x + viewport.width + buffer;
    const minY = viewport.y - buffer;
    const maxY = viewport.y + viewport.height + buffer;

    // Process nodes
    nodes.forEach(node => {
      const position = nodePositions.get(node.id);
      if (!position) return;

      const screenX = (position.x - viewport.x) * viewport.scale;
      const screenY = (position.y - viewport.y) * viewport.scale;
      
      const isVisible = position.x >= minX && position.x <= maxX && 
                       position.y >= minY && position.y <= maxY;

      if (isVisible || highlightedNodes.has(node.id) || selectedNodeId === node.id) {
        const renderPriority = node.renderPriority || 'low';
        const baseSize = NODE_SIZES[renderPriority];
        const renderRadius = highlightedNodes.has(node.id) ? baseSize * 1.5 : baseSize;

        visibleNodes.push({
          ...node,
          position,
          screenX,
          screenY,
          isVisible,
          renderRadius,
        });
      }
    });

    // Process edges (only for visible nodes)
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    
    edges.forEach(edge => {
      const sourceVisible = visibleNodeIds.has(edge.source);
      const targetVisible = visibleNodeIds.has(edge.target);
      
      if (sourceVisible || targetVisible) {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);
        
        if (sourcePos && targetPos) {
          visibleEdges.push({
            ...edge,
            sourcePos,
            targetPos,
            isVisible: sourceVisible && targetVisible,
          });
        }
      }
    });

    return { visibleNodes, visibleEdges };
  }, [nodes, edges, nodePositions, viewport, highlightedNodes, selectedNodeId]);

  // Render the graph to canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set high DPI scaling
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // Render edges first (behind nodes)
    ctx.lineWidth = 1;
    visibleElements.visibleEdges.forEach(edge => {
      if (!edge.isVisible) return;

      const sourceX = (edge.sourcePos.x - viewport.x) * viewport.scale;
      const sourceY = (edge.sourcePos.y - viewport.y) * viewport.scale;
      const targetX = (edge.targetPos.x - viewport.x) * viewport.scale;
      const targetY = (edge.targetPos.y - viewport.y) * viewport.scale;

      // Skip if edge is outside viewport
      if ((sourceX < -50 && targetX < -50) || 
          (sourceX > width + 50 && targetX > width + 50) ||
          (sourceY < -50 && targetY < -50) ||
          (sourceY > height + 50 && targetY > height + 50)) {
        return;
      }

      ctx.strokeStyle = '#e5e7eb';
      ctx.globalAlpha = 0.6;
      
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
    });

    // Render nodes
    ctx.globalAlpha = 1;
    visibleElements.visibleNodes.forEach(node => {
      const isHighlighted = highlightedNodes.has(node.id);
      const isSelected = selectedNodeId === node.id;
      const isHovered = hoveredNodeId === node.id;
      
      const color = NODE_COLORS[node.category as keyof typeof NODE_COLORS] || NODE_COLORS.default;
      
      // Node background
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.screenX, node.screenY, node.renderRadius, 0, 2 * Math.PI);
      ctx.fill();

      // Node border for selected/highlighted/hovered
      if (isSelected || isHighlighted || isHovered) {
        ctx.strokeStyle = isSelected ? '#3b82f6' : isHighlighted ? '#10b981' : '#6b7280';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
      }

      // Node label (only for important nodes or when zoomed in)
      if (viewport.scale > 0.8 && (node.renderPriority === 'high' || isHighlighted || isSelected)) {
        ctx.fillStyle = '#1f2937';
        ctx.font = `${Math.max(10, 12 * viewport.scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const labelY = node.screenY + node.renderRadius + 15;
        const maxLabelWidth = 100;
        let label = node.name;
        
        // Truncate long labels
        if (ctx.measureText(label).width > maxLabelWidth) {
          while (ctx.measureText(label + '...').width > maxLabelWidth && label.length > 0) {
            label = label.slice(0, -1);
          }
          label += '...';
        }
        
        ctx.fillText(label, node.screenX, labelY);
      }
    });

    ctx.scale(1/dpr, 1/dpr);
  }, [visibleElements, viewport, highlightedNodes, selectedNodeId, hoveredNodeId, width, height]);

  // Handle mouse events
  const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    isMouseDownRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const currentMousePos = { x: e.clientX, y: e.clientY };
    
    if (isMouseDownRef.current) {
      const dx = currentMousePos.x - lastMousePosRef.current.x;
      const dy = currentMousePos.y - lastMousePosRef.current.y;
      
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setIsDragging(true);
        
        setViewport(prev => ({
          ...prev,
          x: prev.x - dx / prev.scale,
          y: prev.y - dy / prev.scale,
        }));
      }
    } else {
      // Handle node hover
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      let hoveredNode: EnhancedGraphNode | null = null;
      
      // Find hovered node
      for (const node of visibleElements.visibleNodes) {
        const distance = Math.sqrt(
          Math.pow(mouseX - node.screenX, 2) + Math.pow(mouseY - node.screenY, 2)
        );
        
        if (distance <= node.renderRadius + 2) {
          hoveredNode = node;
          break;
        }
      }
      
      const newHoveredId = hoveredNode?.id || null;
      if (newHoveredId !== hoveredNodeId) {
        setHoveredNodeId(newHoveredId);
        onNodeHover?.(hoveredNode);
      }
    }
    
    lastMousePosRef.current = currentMousePos;
  }, [visibleElements.visibleNodes, hoveredNodeId, onNodeHover]);

  const handleMouseUp = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging && !isMouseDownRef.current) return;
    
    isMouseDownRef.current = false;
    
    if (!isDragging) {
      // Handle click
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Find clicked node
      for (const node of visibleElements.visibleNodes) {
        const distance = Math.sqrt(
          Math.pow(mouseX - node.screenX, 2) + Math.pow(mouseY - node.screenY, 2)
        );
        
        if (distance <= node.renderRadius + 2) {
          onNodeClick?.(node);
          break;
        }
      }
    }
    
    setIsDragging(false);
  }, [isDragging, visibleElements.visibleNodes, onNodeClick]);

  const handleWheel = useCallback((e: WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(3, viewport.scale * scaleFactor));
    
    // Zoom towards mouse position
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const worldX = viewport.x + mouseX / viewport.scale;
    const worldY = viewport.y + mouseY / viewport.scale;
    
    setViewport(prev => ({
      ...prev,
      scale: newScale,
      x: worldX - mouseX / newScale,
      y: worldY - mouseY / newScale,
    }));
  }, [viewport]);

  // Initialize positions when nodes change
  useEffect(() => {
    if (nodes.length > 0 && nodePositions.size === 0) {
      initializeNodePositions();
    }
  }, [nodes, nodePositions.size, initializeNodePositions]);

  // Run physics simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const runSimulation = () => {
      updateNodePositions();
      animationFrameRef.current = requestAnimationFrame(runSimulation);
    };

    // Run simulation for first few seconds
    animationFrameRef.current = requestAnimationFrame(runSimulation);
    
    const stopSimulation = setTimeout(() => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }, 3000); // Run for 3 seconds

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      clearTimeout(stopSimulation);
    };
  }, [nodes.length, updateNodePositions]);

  // Render loop
  useEffect(() => {
    const renderLoop = () => {
      render();
      requestAnimationFrame(renderLoop);
    };
    
    const renderFrame = requestAnimationFrame(renderLoop);
    
    return () => cancelAnimationFrame(renderFrame);
  }, [render]);

  // Set up canvas size and DPI
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`cursor-${isDragging ? 'grabbing' : hoveredNodeId ? 'pointer' : 'grab'} ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      style={{ 
        width,
        height,
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
      }}
    />
  );
}