import type {
  CodeReference,
  GraphData,
  ImpactAnalysis,
} from '@/types/code-analysis';

/**
 * Comprehensive impact analysis utilities
 * Analyzes the potential impact of changes to a code node
 */

/**
 * Analyzes the potential impact of modifying or removing a node
 */
export function analyzeNodeImpact(
  targetNode: CodeReference,
  graphData: GraphData,
  changeType: 'modify' | 'delete' | 'refactor' = 'modify'
): ImpactAnalysis {
  const impactedFunctions: CodeReference[] = [];
  const affectedFiles = new Set<string>();
  const reasons: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let breakingChangeRisk = 0;

  // Find all nodes that depend on the target node
  const dependentNodes = findDependentNodes(targetNode, graphData);
  
  // Analyze direct dependencies
  dependentNodes.direct.forEach(node => {
    impactedFunctions.push(node);
    affectedFiles.add(node.file);
    
    // Increase risk based on dependency type and node importance
    const connectionCount = graphData.edges.filter(
      edge => edge.source === node.id || edge.target === node.id
    ).length;
    
    if (connectionCount > 10) {
      breakingChangeRisk += 0.3;
      reasons.push(`${node.name} is highly connected (${connectionCount} connections)`);
    }
    
    if (node.category === 'module' || node.category === 'class') {
      breakingChangeRisk += 0.4;
      reasons.push(`${node.name} is a ${node.category} with structural importance`);
    }
  });

  // Analyze indirect dependencies (2-3 levels deep)
  dependentNodes.indirect.forEach(node => {
    if (!impactedFunctions.some(f => f.id === node.id)) {
      impactedFunctions.push(node);
      affectedFiles.add(node.file);
    }
    
    // Lower risk for indirect dependencies
    breakingChangeRisk += 0.1;
  });

  // Analyze exports - if this node is exported, external impact is higher
  const isExported = graphData.edges.some(edge => 
    edge.source === targetNode.id && 
    edge.relationship?.toLowerCase().includes('export')
  );
  
  if (isExported) {
    breakingChangeRisk += 0.5;
    reasons.push(`${targetNode.name} is exported and may be used externally`);
  }

  // Analyze imports - if this node imports many things, changes might cascade
  const importCount = graphData.edges.filter(edge => 
    edge.target === targetNode.id && 
    edge.relationship?.toLowerCase().includes('import')
  ).length;
  
  if (importCount > 5) {
    breakingChangeRisk += 0.2;
    reasons.push(`${targetNode.name} has many imports (${importCount}) that could be affected`);
  }

  // Check for circular dependencies involving this node
  const circularDeps = findCircularDependencies(targetNode, graphData);
  if (circularDeps.length > 0) {
    breakingChangeRisk += 0.3;
    reasons.push(`${targetNode.name} is involved in ${circularDeps.length} circular dependencies`);
  }

  // Adjust risk based on change type
  switch (changeType) {
    case 'delete':
      breakingChangeRisk *= 1.5; // Deletion is riskier
      break;
    case 'refactor':
      breakingChangeRisk *= 1.2; // Refactoring has moderate risk
      break;
    case 'modify':
      // Base risk
      break;
  }

  // Determine risk level
  if (breakingChangeRisk >= 1.0) {
    riskLevel = 'high';
  } else if (breakingChangeRisk >= 0.5) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Cap breaking change risk at 1.0
  breakingChangeRisk = Math.min(breakingChangeRisk, 1.0);

  return {
    affectedFiles: Array.from(affectedFiles),
    impactedFunctions,
    riskLevel,
    breakingChangeRisk,
    reasons,
  };
}

/**
 * Finds nodes that depend on the target node (direct and indirect)
 */
function findDependentNodes(
  targetNode: CodeReference,
  graphData: GraphData
): { direct: CodeReference[]; indirect: CodeReference[] } {
  const direct: CodeReference[] = [];
  const indirect: CodeReference[] = [];
  const visited = new Set<string>();

  // Find direct dependencies
  const directEdges = graphData.edges.filter(edge => edge.target === targetNode.id);
  directEdges.forEach(edge => {
    const sourceNode = graphData.nodes.find(n => n.id === edge.source);
    if (sourceNode && !visited.has(sourceNode.id)) {
      direct.push(sourceNode);
      visited.add(sourceNode.id);
    }
  });

  // Find indirect dependencies (BFS from direct dependencies)
  const queue = [...direct.map(n => n.id)];
  const indirectVisited = new Set(visited);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    
    const dependentEdges = graphData.edges.filter(edge => edge.target === currentId);
    dependentEdges.forEach(edge => {
      const sourceNode = graphData.nodes.find(n => n.id === edge.source);
      if (sourceNode && !indirectVisited.has(sourceNode.id)) {
        indirect.push(sourceNode);
        indirectVisited.add(sourceNode.id);
        queue.push(sourceNode.id);
      }
    });
  }

  return { direct, indirect };
}

/**
 * Finds circular dependencies involving the target node
 */
function findCircularDependencies(
  targetNode: CodeReference,
  graphData: GraphData
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): void {
    if (recursionStack.has(nodeId)) {
      // Found a cycle
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycles.push([...cycle, nodeId]);
      }
      return;
    }

    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Follow outgoing edges
    const outgoingEdges = graphData.edges.filter(edge => edge.source === nodeId);
    outgoingEdges.forEach(edge => {
      // Only consider dependency-creating relationships
      const relationship = edge.relationship?.toLowerCase() || '';
      if (relationship.includes('import') || 
          relationship.includes('depend') || 
          relationship.includes('call')) {
        dfs(edge.target, [...path, nodeId]);
      }
    });

    recursionStack.delete(nodeId);
  }

  dfs(targetNode.id, []);
  
  // Filter cycles that actually involve the target node
  return cycles.filter(cycle => cycle.includes(targetNode.id));
}

/**
 * Analyzes the impact of changes across multiple nodes
 */
export function analyzeBulkImpact(
  targetNodes: CodeReference[],
  graphData: GraphData,
  changeType: 'modify' | 'delete' | 'refactor' = 'modify'
): ImpactAnalysis {
  const allImpacts = targetNodes.map(node => 
    analyzeNodeImpact(node, graphData, changeType)
  );

  // Merge all impacts
  const affectedFiles = new Set<string>();
  const impactedFunctions = new Map<string, CodeReference>();
  const allReasons: string[] = [];
  let maxBreakingChangeRisk = 0;

  allImpacts.forEach(impact => {
    impact.affectedFiles.forEach(file => affectedFiles.add(file));
    impact.impactedFunctions.forEach(func => impactedFunctions.set(func.id, func));
    allReasons.push(...impact.reasons);
    maxBreakingChangeRisk = Math.max(maxBreakingChangeRisk, impact.breakingChangeRisk);
  });

  // Determine overall risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (maxBreakingChangeRisk >= 1.0) {
    riskLevel = 'high';
  } else if (maxBreakingChangeRisk >= 0.5) {
    riskLevel = 'medium';
  }

  return {
    affectedFiles: Array.from(affectedFiles),
    impactedFunctions: Array.from(impactedFunctions.values()),
    riskLevel,
    breakingChangeRisk: maxBreakingChangeRisk,
    reasons: [...new Set(allReasons)], // Remove duplicates
  };
}

/**
 * Suggests mitigation strategies based on impact analysis
 */
export function suggestMitigationStrategies(
  impact: ImpactAnalysis,
  targetNode: CodeReference
): string[] {
  const strategies: string[] = [];

  if (impact.riskLevel === 'high') {
    strategies.push('Consider phased rollout with feature flags');
    strategies.push('Create comprehensive test coverage before changes');
    strategies.push('Plan for potential rollback scenarios');
  }

  if (impact.breakingChangeRisk > 0.7) {
    strategies.push('Implement deprecation warnings before removal');
    strategies.push('Provide migration guide for affected consumers');
  }

  if (impact.affectedFiles.length > 10) {
    strategies.push('Consider breaking change into smaller increments');
    strategies.push('Use automated refactoring tools where possible');
  }

  if (impact.impactedFunctions.length > 20) {
    strategies.push('Create adapter or wrapper functions to maintain compatibility');
    strategies.push('Coordinate with teams owning affected functions');
  }

  // Default strategies
  if (strategies.length === 0) {
    strategies.push('Run existing test suite to verify no regressions');
    strategies.push('Review affected code for potential improvements');
  }

  return strategies;
}

/**
 * Generates impact analysis report
 */
export function generateImpactReport(
  targetNode: CodeReference,
  graphData: GraphData,
  changeType: 'modify' | 'delete' | 'refactor' = 'modify'
): {
  analysis: ImpactAnalysis;
  mitigationStrategies: string[];
  summary: string;
} {
  const analysis = analyzeNodeImpact(targetNode, graphData, changeType);
  const mitigationStrategies = suggestMitigationStrategies(analysis, targetNode);
  
  const summary = generateImpactSummary(analysis, targetNode, changeType);

  return {
    analysis,
    mitigationStrategies,
    summary,
  };
}

function generateImpactSummary(
  impact: ImpactAnalysis,
  targetNode: CodeReference,
  changeType: string
): string {
  const riskText = impact.riskLevel === 'high' ? 'HIGH RISK' :
                   impact.riskLevel === 'medium' ? 'MEDIUM RISK' : 'LOW RISK';
  
  const changeText = changeType === 'delete' ? 'Deleting' :
                     changeType === 'refactor' ? 'Refactoring' : 'Modifying';

  return `${changeText} ${targetNode.name} (${targetNode.category}) carries ${riskText}. ` +
         `This change would affect ${impact.affectedFiles.length} files and ${impact.impactedFunctions.length} functions, ` +
         `with a ${Math.round(impact.breakingChangeRisk * 100)}% chance of breaking changes.`;
}