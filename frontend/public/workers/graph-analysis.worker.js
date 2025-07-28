// Web Worker for heavy graph analysis computations
// This worker handles node metrics calculation and reference analysis off the main thread

let nodeCache = new Map();
let edgeCache = new Map();

// Calculate node metrics (connections, importance scores, etc.)
function calculateNodeMetrics(nodes, edges, maxDepth = 3) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const inDegreeMap = new Map();
  const outDegreeMap = new Map();
  const adjacencyList = new Map();

  // Initialize maps
  nodes.forEach(node => {
    inDegreeMap.set(node.id, 0);
    outDegreeMap.set(node.id, 0);
    adjacencyList.set(node.id, new Set());
  });

  // Process edges
  edges.forEach(edge => {
    const sourceId = edge.source;
    const targetId = edge.target;

    outDegreeMap.set(sourceId, (outDegreeMap.get(sourceId) || 0) + 1);
    inDegreeMap.set(targetId, (inDegreeMap.get(targetId) || 0) + 1);

    if (!adjacencyList.has(sourceId)) adjacencyList.set(sourceId, new Set());
    if (!adjacencyList.has(targetId)) adjacencyList.set(targetId, new Set());

    adjacencyList.get(sourceId).add(targetId);
    adjacencyList.get(targetId).add(sourceId);
  });

  // Find connected files for each node (optimized BFS)
  const getConnectedFiles = (nodeId, depth) => {
    const visited = new Set();
    const queue = [{ id: nodeId, currentDepth: 0 }];
    const connectedFiles = new Set();

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      const node = nodeMap.get(id);
      if (node?.file && id !== nodeId) {
        connectedFiles.add(node.file);
      }

      if (currentDepth < depth) {
        const neighbors = adjacencyList.get(id) || new Set();
        neighbors.forEach(neighborId => {
          if (!visited.has(neighborId)) {
            queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
          }
        });
      }
    }

    return Array.from(connectedFiles);
  };

  // Enhanced node metrics with performance scores
  return nodes.map(node => {
    const inDegree = inDegreeMap.get(node.id) || 0;
    const outDegree = outDegreeMap.get(node.id) || 0;
    const totalConnections = inDegree + outDegree;
    
    // Calculate importance score (centrality measure)
    const importanceScore = Math.log(totalConnections + 1) * 10;
    
    // Calculate connected files
    const connectedFiles = getConnectedFiles(node.id, maxDepth);
    
    return {
      ...node,
      inDegree,
      outDegree,
      totalConnections,
      importanceScore,
      connectedFiles,
      // Add performance-related metadata
      renderPriority: importanceScore > 15 ? 'high' : importanceScore > 5 ? 'medium' : 'low'
    };
  });
}

// Analyze node references efficiently
function analyzeNodeReferences(selectedNode, graphData, maxDepth = 3) {
  if (!selectedNode || !graphData) return [];

  const { nodes, edges } = graphData;
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  
  // Build adjacency lists for faster traversal
  const incomingEdges = new Map();
  const outgoingEdges = new Map();
  
  edges.forEach(edge => {
    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    if (!outgoingEdges.has(edge.source)) outgoingEdges.set(edge.source, []);
    
    incomingEdges.get(edge.target).push(edge);
    outgoingEdges.get(edge.source).push(edge);
  });

  // Find all connected nodes within maxDepth
  const connectedNodes = new Map();
  const visited = new Set();
  const queue = [{ nodeId: selectedNode.id, depth: 0, path: [] }];

  while (queue.length > 0) {
    const { nodeId, depth, path } = queue.shift();
    
    if (visited.has(nodeId) || depth > maxDepth) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Track how this node connects to selected node
    if (nodeId !== selectedNode.id) {
      connectedNodes.set(nodeId, {
        node,
        depth,
        path: [...path],
        connectionType: depth === 1 ? 'direct' : 'indirect'
      });
    }

    if (depth < maxDepth) {
      // Add outgoing connections
      const outgoing = outgoingEdges.get(nodeId) || [];
      outgoing.forEach(edge => {
        if (!visited.has(edge.target)) {
          queue.push({
            nodeId: edge.target,
            depth: depth + 1,
            path: [...path, { type: edge.relationship, from: nodeId, to: edge.target }]
          });
        }
      });

      // Add incoming connections
      const incoming = incomingEdges.get(nodeId) || [];
      incoming.forEach(edge => {
        if (!visited.has(edge.source)) {
          queue.push({
            nodeId: edge.source,
            depth: depth + 1,
            path: [...path, { type: edge.relationship, from: edge.source, to: nodeId }]
          });
        }
      });
    }
  }

  // Group by file and create reference analysis
  const fileReferences = new Map();

  connectedNodes.forEach(({ node, depth, path, connectionType }) => {
    if (!node.file) return;

    if (!fileReferences.has(node.file)) {
      fileReferences.set(node.file, {
        fileName: node.file.split('/').pop() || node.file,
        relativePath: node.file,
        totalUsages: 0,
        directUsages: 0,
        indirectUsages: 0,
        usages: [],
        maxDepth: 0
      });
    }

    const fileRef = fileReferences.get(node.file);
    fileRef.totalUsages++;
    fileRef.maxDepth = Math.max(fileRef.maxDepth, depth);

    if (connectionType === 'direct') {
      fileRef.directUsages++;
    } else {
      fileRef.indirectUsages++;
    }

    // Determine usage type from path
    const lastConnection = path[path.length - 1];
    const usageType = lastConnection ? 
      mapRelationshipToUsageType(lastConnection.type) : 'reference';

    fileRef.usages.push({
      type: usageType,
      line: node.start_line || 0,
      context: node.code || node.name || '',
      functionScope: determineFunctionScope(node),
      depth,
      connectionPath: path.map(p => p.type).join(' → ')
    });
  });

  return Array.from(fileReferences.values())
    .sort((a, b) => b.totalUsages - a.totalUsages); // Sort by usage frequency
}

// Helper function to map relationship types to usage types
function mapRelationshipToUsageType(relationship) {
  const typeMap = {
    'calls': 'call',
    'defines_function': 'definition',
    'defines_method': 'method',
    'defines_class': 'class',
    'imports_module': 'import',
    'imports_symbol': 'import',
    'inherits': 'inheritance',
    'references_symbol': 'reference'
  };
  
  return typeMap[relationship] || 'reference';
}

// Helper function to determine function scope
function determineFunctionScope(node) {
  if (node.category === 'method' && node.parent_id) {
    const className = node.parent_id.split('.').pop();
    return `${className}.${node.name}`;
  }
  
  if (node.category === 'function') {
    return node.name;
  }
  
  return null;
}

// Filter nodes for viewport (for virtualization)
function filterNodesForViewport(nodes, viewport, buffer = 100) {
  if (!viewport) return nodes;
  
  const { x, y, width, height, scale } = viewport;
  const adjustedBuffer = buffer / scale;
  
  return nodes.filter(node => {
    // Simple bounding box check (assumes node positions are available)
    if (!node.x || !node.y) return true; // Include nodes without positions
    
    return (
      node.x >= x - adjustedBuffer &&
      node.x <= x + width + adjustedBuffer &&
      node.y >= y - adjustedBuffer &&
      node.y <= y + height + adjustedBuffer
    );
  });
}

// Main message handler
self.onmessage = function(e) {
  const { type, data, requestId } = e.data;
  
  try {
    let result;
    
    switch (type) {
      case 'CALCULATE_NODE_METRICS':
        result = calculateNodeMetrics(data.nodes, data.edges, data.maxDepth);
        break;
        
      case 'ANALYZE_NODE_REFERENCES':
        result = analyzeNodeReferences(data.selectedNode, data.graphData, data.maxDepth);
        break;
        
      case 'FILTER_VIEWPORT_NODES':
        result = filterNodesForViewport(data.nodes, data.viewport, data.buffer);
        break;
        
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
    
    // Send result back to main thread
    self.postMessage({
      type: 'SUCCESS',
      requestId,
      result
    });
    
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      type: 'ERROR',
      requestId,
      error: error.message
    });
  }
};

// Send ready signal
self.postMessage({ type: 'READY' });