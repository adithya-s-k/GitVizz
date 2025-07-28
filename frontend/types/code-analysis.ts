export interface CodeReference {
  id: string;
  name: string;
  file: string;
  code: string;
  category: string;
  start_line?: number;
  end_line?: number;
}

export interface GraphData {
  nodes: CodeReference[];
  edges: Array<{
    source: string;
    target: string;
    relationship?: string;
  }>;
}

export interface Usage {
  line: number;
  column: number;
  type: 'call' | 'import' | 'method' | 'property' | 'constructor' | 'export';
  context: string;
  fullContext: string;
  functionScope?: string;
  usagePattern: string;
}

export interface ReferenceFile {
  file: string;
  fileName: string;
  relativePath: string;
  usages: Usage[];
  totalUsages: number;
  referencingNodes: CodeReference[];
}

export interface ReferenceChain {
  depth: number;
  node: CodeReference;
  usages: Usage[];
  children: ReferenceChain[];
}

export interface CodeReferenceProps {
  selectedNode: CodeReference;
  graphData: GraphData;
  maxDepth?: number;
  onOpenFile: (filePath: string, line?: number) => void;
}

// Enhanced analysis types
export interface DeadCodeResult {
  type: 'unused_function' | 'unreachable_code' | 'unused_import' | 'orphaned_module';
  node: CodeReference;
  reason: string;
  confidence: number; // 0-1 confidence score
  suggestions?: string[];
}

export interface CyclicDependency {
  path: string[]; // Node IDs forming the cycle
  nodes: CodeReference[];
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface CodeHealthMetrics {
  deadCode: DeadCodeResult[];
  cyclicDependencies: CyclicDependency[];
  unusedImports: DeadCodeResult[];
  complexityScore: number;
  codeQualityScore: number; // Overall score 0-100
  totalIssues: number;
}

export interface RelationshipSummary {
  calls: { count: number; examples: CodeReference[] };
  calledBy: { count: number; examples: CodeReference[] };
  imports: { count: number; examples: CodeReference[] };
  exports: { count: number; examples: CodeReference[] };
  totalConnections: number;
}

export interface DependencyTreeNode {
  id: string;
  node: CodeReference;
  relationship: string;
  depth: number;
  children: DependencyTreeNode[];
  isExpanded: boolean;
  hasDeadCode?: boolean;
  complexityScore?: number;
}

export interface SearchFilter {
  nodeTypes: string[];
  relationshipTypes: string[];
  codeHealthFilters: string[];
  fileTypes: string[];
  showDeadCode: boolean;
  showCyclicDeps: boolean;
  directOnly: boolean;
}

export interface ImpactAnalysis {
  affectedFiles: string[];
  impactedFunctions: CodeReference[];
  riskLevel: 'low' | 'medium' | 'high';
  breakingChangeRisk: number; // 0-1
  reasons: string[];
}
