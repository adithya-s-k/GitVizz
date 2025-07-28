import type {
  CodeReference,
  GraphData,
  DeadCodeResult,
  CyclicDependency,
  CodeHealthMetrics,
} from '@/types/code-analysis';

/**
 * Comprehensive dead code analysis utilities
 * All algorithms run client-side for instant feedback
 */

/**
 * Detect unused functions - functions that are never called and not exported
 */
export function detectUnusedFunctions(graphData: GraphData): DeadCodeResult[] {
  const calledFunctions = new Set<string>();
  const exportedFunctions = new Set<string>();
  const importedFunctions = new Set<string>();
  
  // Analyze edges to find called, exported, and imported functions
  graphData.edges.forEach(edge => {
    const relationship = edge.relationship?.toLowerCase() || '';
    
    if (relationship.includes('call') || relationship.includes('invoke')) {
      calledFunctions.add(edge.target);
    }
    
    if (relationship.includes('export')) {
      exportedFunctions.add(edge.source);
    }
    
    if (relationship.includes('import')) {
      importedFunctions.add(edge.target);
    }
  });
  
  // Find entry points (main functions, exported functions, etc.)
  const entryPoints = findEntryPoints(graphData);
  entryPoints.forEach(entryId => {
    calledFunctions.add(entryId);
  });
  
  // Identify unused functions
  const unusedFunctions = graphData.nodes
    .filter(node => {
      if (node.category !== 'function' && node.category !== 'method') {
        return false;
      }
      
      const isUsed = calledFunctions.has(node.id) || 
                    exportedFunctions.has(node.id) || 
                    importedFunctions.has(node.id);
      
      return !isUsed;
    })
    .map(node => {
      const suggestions = generateUnusedFunctionSuggestions(node, graphData);
      
      return {
        type: 'unused_function' as const,
        node,
        reason: `Function '${node.name}' is never called and not exported`,
        confidence: calculateUnusedConfidence(node, graphData),
        suggestions,
      };
    });
  
  return unusedFunctions;
}

/**
 * Find unreachable code - code that cannot be reached from any entry point
 */
export function findUnreachableCode(graphData: GraphData): DeadCodeResult[] {
  const reachableNodes = new Set<string>();
  const entryPoints = findEntryPoints(graphData);
  
  // BFS from all entry points to mark reachable code
  const queue = [...entryPoints];
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    
    if (reachableNodes.has(currentId)) continue;
    reachableNodes.add(currentId);
    
    // Add all nodes this one can reach
    graphData.edges
      .filter(edge => edge.source === currentId)
      .forEach(edge => {
        if (!reachableNodes.has(edge.target)) {
          queue.push(edge.target);
        }
      });
  }
  
  // Find unreachable nodes
  const unreachableNodes = graphData.nodes
    .filter(node => !reachableNodes.has(node.id))
    .filter(node => node.category !== 'external_symbol') // Exclude external symbols
    .map(node => ({
      type: 'unreachable_code' as const,
      node,
      reason: `Code is not reachable from any entry point`,
      confidence: 0.8,
      suggestions: [
        'Consider removing this code if it\'s truly unused',
        'Check if this should be exported or called from somewhere',
        'Verify if this is a utility function that should be accessible',
      ],
    }));
  
  return unreachableNodes;
}

/**
 * Detect unused imports
 */
export function detectUnusedImports(graphData: GraphData): DeadCodeResult[] {
  const importedSymbols = new Map<string, CodeReference>();
  const usedSymbols = new Set<string>();
  
  // Find all imported symbols
  graphData.edges.forEach(edge => {
    if (edge.relationship?.includes('import')) {
      const targetNode = graphData.nodes.find(n => n.id === edge.target);
      if (targetNode) {
        importedSymbols.set(edge.target, targetNode);
      }
    }
  });
  
  // Find which imported symbols are actually used
  graphData.edges.forEach(edge => {
    if (edge.relationship?.includes('call') || 
        edge.relationship?.includes('reference')) {
      usedSymbols.add(edge.target);
    }
  });
  
  // Also check for usage in code content
  graphData.nodes.forEach(node => {
    if (node.code) {
      importedSymbols.forEach((importedNode, importId) => {
        if (node.code.includes(importedNode.name)) {
          usedSymbols.add(importId);
        }
      });
    }
  });
  
  // Find unused imports
  const unusedImports: DeadCodeResult[] = [];
  importedSymbols.forEach((importedNode, importId) => {
    if (!usedSymbols.has(importId)) {
      unusedImports.push({
        type: 'unused_import',
        node: importedNode,
        reason: `Import '${importedNode.name}' is never used`,
        confidence: 0.9,
        suggestions: [
          'Remove this unused import statement',
          'Check if the import name is correct',
          'Verify if the imported symbol should be used somewhere',
        ],
      });
    }
  });
  
  return unusedImports;
}

/**
 * Find orphaned modules - modules that are not imported or referenced
 */
export function findOrphanedModules(graphData: GraphData): DeadCodeResult[] {
  const referencedModules = new Set<string>();
  const entryModules = new Set<string>();
  
  // Find modules that are imported or referenced
  graphData.edges.forEach(edge => {
    if (edge.relationship?.includes('import') || 
        edge.relationship?.includes('require')) {
      const targetNode = graphData.nodes.find(n => n.id === edge.target);
      if (targetNode?.category === 'module') {
        referencedModules.add(edge.target);
      }
    }
  });
  
  // Identify entry modules (main, index, etc.)
  graphData.nodes
    .filter(node => node.category === 'module')
    .forEach(module => {
      const fileName = module.file.split('/').pop()?.toLowerCase() || '';
      if (fileName.includes('main') || 
          fileName.includes('index') || 
          fileName.includes('app') ||
          fileName.includes('entry')) {
        entryModules.add(module.id);
      }
    });
  
  // Find orphaned modules
  const orphanedModules = graphData.nodes
    .filter(node => node.category === 'module')
    .filter(node => !referencedModules.has(node.id) && !entryModules.has(node.id))
    .map(node => ({
      type: 'orphaned_module' as const,
      node,
      reason: `Module '${node.name}' is not imported or referenced anywhere`,
      confidence: 0.7,
      suggestions: [
        'Consider removing this module if it\'s truly unused',
        'Check if this module should be imported somewhere',
        'Verify if this is a standalone utility module',
      ],
    }));
  
  return orphanedModules;
}

/**
 * Detect cyclic dependencies using DFS
 */
export function detectCyclicDependencies(graphData: GraphData): CyclicDependency[] {
  const cycles: CyclicDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const visitedCycles = new Set<string>(); // Avoid duplicate cycles
  
  function dfs(nodeId: string, path: string[]): boolean {
    if (recursionStack.has(nodeId)) {
      // Found a cycle
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        const cyclePath = [...path.slice(cycleStart), nodeId];
        const cycleKey = cyclePath.sort().join('->');
        
        if (!visitedCycles.has(cycleKey)) {
          visitedCycles.add(cycleKey);
          
          const cycleNodes = cyclePath.map(id => 
            graphData.nodes.find(n => n.id === id)!
          ).filter(Boolean);
          
          if (cycleNodes.length > 1) {
            cycles.push({
              path: cyclePath,
              nodes: cycleNodes,
              severity: calculateCycleSeverity(cycleNodes),
              description: generateCycleDescription(cycleNodes),
            });
          }
        }
      }
      return true;
    }
    
    if (visited.has(nodeId)) return false;
    
    visited.add(nodeId);
    recursionStack.add(nodeId);
    
    // Check all outgoing edges
    const outgoingEdges = graphData.edges.filter(edge => edge.source === nodeId);
    
    for (const edge of outgoingEdges) {
      // Only consider certain relationship types for cycle detection
      const relationship = edge.relationship?.toLowerCase() || '';
      if (relationship.includes('import') || 
          relationship.includes('depend') || 
          relationship.includes('call')) {
        
        if (dfs(edge.target, [...path, nodeId])) {
          // Continue to find all cycles, don't return early
        }
      }
    }
    
    recursionStack.delete(nodeId);
    return false;
  }
  
  // Check all nodes as potential cycle starts
  graphData.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  });
  
  return cycles;
}

/**
 * Calculate comprehensive code health metrics
 */
export function analyzeCodeHealth(graphData: GraphData): CodeHealthMetrics {
  const deadCode = detectUnusedFunctions(graphData);
  const unreachableCode = findUnreachableCode(graphData);
  const unusedImports = detectUnusedImports(graphData);
  const orphanedModules = findOrphanedModules(graphData);
  const cyclicDependencies = detectCyclicDependencies(graphData);
  
  const allDeadCode = [...deadCode, ...unreachableCode, ...orphanedModules];
  const complexityScore = calculateComplexityScore(graphData);
  const totalIssues = allDeadCode.length + cyclicDependencies.length + unusedImports.length;
  
  // Calculate overall code quality score (0-100)
  const codeQualityScore = calculateCodeQualityScore({
    totalNodes: graphData.nodes.length,
    totalIssues,
    cyclicDependencies: cyclicDependencies.length,
    complexityScore,
  });
  
  return {
    deadCode: allDeadCode,
    cyclicDependencies,
    unusedImports,
    complexityScore,
    codeQualityScore,
    totalIssues,
  };
}

// Helper functions

function findEntryPoints(graphData: GraphData): string[] {
  const entryPoints: string[] = [];
  
  // Look for common entry point patterns
  graphData.nodes.forEach(node => {
    const name = node.name.toLowerCase();
    const file = node.file.toLowerCase();
    
    // Main functions
    if (name === 'main' || name === 'index' || name === 'app') {
      entryPoints.push(node.id);
    }
    
    // Entry files
    if (file.includes('main.') || file.includes('index.') || 
        file.includes('app.') || file.includes('entry.')) {
      entryPoints.push(node.id);
    }
    
    // Exported functions are potential entry points
    const isExported = graphData.edges.some(edge => 
      edge.source === node.id && edge.relationship?.includes('export')
    );
    if (isExported) {
      entryPoints.push(node.id);
    }
  });
  
  // If no entry points found, consider all modules as potential entry points
  if (entryPoints.length === 0) {
    graphData.nodes
      .filter(node => node.category === 'module')
      .forEach(node => entryPoints.push(node.id));
  }
  
  return entryPoints;
}

function calculateUnusedConfidence(node: CodeReference, graphData: GraphData): number {
  let confidence = 0.9; // Base confidence
  
  // Lower confidence for small functions (might be utilities)
  if (node.code && node.code.length < 50) {
    confidence -= 0.2;
  }
  
  // Lower confidence for functions with generic names
  const genericNames = ['utils', 'helper', 'utility', 'common', 'shared'];
  if (genericNames.some(name => node.name.toLowerCase().includes(name))) {
    confidence -= 0.3;
  }
  
  // Higher confidence if function is large and complex
  if (node.code && node.code.length > 200) {
    confidence += 0.1;
  }
  
  return Math.max(0.1, Math.min(1.0, confidence));
}

function generateUnusedFunctionSuggestions(
  node: CodeReference, 
  graphData: GraphData
): string[] {
  const suggestions = ['Consider removing this unused function'];
  
  // Check if it looks like a utility function
  const utilityKeywords = ['util', 'helper', 'common', 'shared'];
  if (utilityKeywords.some(keyword => 
    node.name.toLowerCase().includes(keyword) || 
    node.file.toLowerCase().includes(keyword)
  )) {
    suggestions.push('This might be a utility function - verify it\'s truly unused');
  }
  
  // Check for similar function names
  const similarFunctions = graphData.nodes.filter(n => 
    n.id !== node.id && 
    n.category === 'function' &&
    levenshteinDistance(n.name.toLowerCase(), node.name.toLowerCase()) <= 2
  );
  
  if (similarFunctions.length > 0) {
    suggestions.push('Check if this should be called instead of similar functions');
  }
  
  return suggestions;
}

function calculateCycleSeverity(nodes: CodeReference[]): 'low' | 'medium' | 'high' {
  const cycleLength = nodes.length;
  
  if (cycleLength <= 2) return 'low';
  if (cycleLength <= 4) return 'medium';
  return 'high';
}

function generateCycleDescription(nodes: CodeReference[]): string {
  const nodeNames = nodes.map(n => n.name).join(' → ');
  return `Circular dependency: ${nodeNames}`;
}

function calculateComplexityScore(graphData: GraphData): number {
  const totalNodes = graphData.nodes.length;
  const totalEdges = graphData.edges.length;
  
  if (totalNodes === 0) return 0;
  
  // Calculate average connections per node
  const avgConnections = totalEdges / totalNodes;
  
  // Normalize to 0-100 scale (higher is more complex)
  return Math.min(100, Math.round(avgConnections * 10));
}

function calculateCodeQualityScore(metrics: {
  totalNodes: number;
  totalIssues: number;
  cyclicDependencies: number;
  complexityScore: number;
}): number {
  const { totalNodes, totalIssues, cyclicDependencies, complexityScore } = metrics;
  
  if (totalNodes === 0) return 100;
  
  // Base score
  let score = 100;
  
  // Deduct points for issues
  const issueRatio = totalIssues / totalNodes;
  score -= issueRatio * 50; // Max 50 point deduction for issues
  
  // Deduct points for cyclic dependencies
  score -= cyclicDependencies * 5; // 5 points per cycle
  
  // Deduct points for high complexity
  score -= Math.max(0, complexityScore - 50) * 0.5; // Deduct for complexity > 50
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Utility function for string similarity
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}