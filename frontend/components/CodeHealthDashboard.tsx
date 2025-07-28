'use client';

import { useMemo, useState } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  TrendingDown, 
  TrendingUp,
  FileText,
  Zap,
  AlertCircle,
  Info,
  X
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { 
  GraphData, 
  CodeHealthMetrics, 
  DeadCodeResult, 
  CyclicDependency 
} from '@/types/code-analysis';
import { analyzeCodeHealth } from '@/utils/dead-code-analyzer';

interface CodeHealthDashboardProps {
  graphData: GraphData;
  onNodeSelect?: (nodeId: string) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
}

interface MetricCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'stable';
  color?: 'green' | 'yellow' | 'red' | 'blue';
  subtitle?: string;
}

function MetricCard({ title, value, icon, trend, color = 'blue', subtitle }: MetricCardProps) {
  const colorClasses = {
    green: 'text-green-600 bg-green-50 dark:bg-green-950/20',
    yellow: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20',
    red: 'text-red-600 bg-red-50 dark:bg-red-950/20',
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950/20',
  };

  return (
    <Card className="relative">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{value}</p>
              {trend && (
                <div className={`flex items-center ${
                  trend === 'up' ? 'text-red-500' : 
                  trend === 'down' ? 'text-green-500' : 
                  'text-gray-500'
                }`}>
                  {trend === 'up' && <TrendingUp className="w-3 h-3" />}
                  {trend === 'down' && <TrendingDown className="w-3 h-3" />}
                </div>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface IssueListProps {
  title: string;
  issues: DeadCodeResult[];
  icon: React.ReactNode;
  color: string;
  onNodeSelect?: (nodeId: string) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
}

function IssueList({ title, issues, icon, color, onNodeSelect, onOpenFile }: IssueListProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (issues.length === 0) return null;

  return (
    <div className="border border-border rounded-lg bg-card">
      {/* Custom Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`p-1 rounded ${color} flex-shrink-0`}>
            {icon}
          </div>
          <span className="text-sm font-medium truncate">{title}</span>
          <Badge variant="secondary" className="text-xs h-4 px-1 flex-shrink-0">
            {issues.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="h-6 w-6 p-0 flex-shrink-0"
        >
          {collapsed ? <Info className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </Button>
      </div>
      
      {/* Custom Content */}
      {!collapsed && (
        <div className="p-2">
          <div className="max-h-24 overflow-y-auto">
            <div className="space-y-1">
              {issues.map((issue, index) => (
                <div
                  key={`${issue.node.id}-${index}`}
                  className="p-1.5 border border-border rounded hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => onNodeSelect?.(issue.node.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Single compact line with all info */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="font-mono font-medium truncate max-w-[80px]">
                          {issue.node.name}
                        </span>
                        <Badge variant="outline" className="text-xs h-3 px-1">
                          {issue.node.category}
                        </Badge>
                        <span className="text-muted-foreground">•</span>
                        <code className="bg-muted px-1 rounded text-xs">
                          {issue.node.file.split('/').pop()}
                        </code>
                        {issue.node.start_line && (
                          <span className="text-muted-foreground">:{issue.node.start_line}</span>
                        )}
                        <span className={`ml-auto px-1 rounded text-xs ${
                          issue.confidence > 0.8 ? 'bg-red-100 text-red-800 dark:bg-red-950/30' :
                          issue.confidence > 0.6 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-950/30'
                        }`}>
                          {Math.round(issue.confidence * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Action button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFile?.(issue.node.file, issue.node.start_line);
                      }}
                    >
                      <FileText className="w-2.5 h-2.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CycleDependencyListProps {
  cycles: CyclicDependency[];
  onNodeSelect?: (nodeId: string) => void;
}

function CyclicDependencyList({ cycles, onNodeSelect }: CycleDependencyListProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (cycles.length === 0) return null;

  return (
    <div className="border border-border rounded-lg bg-card">
      {/* Custom Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-1 rounded bg-red-50 text-red-600 dark:bg-red-950/20 flex-shrink-0">
            <Activity className="w-3 h-3" />
          </div>
          <span className="text-sm font-medium truncate">Circular Dependencies</span>
          <Badge variant="destructive" className="text-xs h-4 px-1 flex-shrink-0">
            {cycles.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="h-6 w-6 p-0 flex-shrink-0"
        >
          {collapsed ? <Info className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </Button>
      </div>
      
      {/* Custom Content */}
      {!collapsed && (
        <div className="p-2">
          <div className="max-h-28 overflow-y-auto">
            <div className="space-y-1">
              {cycles.map((cycle, index) => (
                <div
                  key={index}
                  className="p-1.5 border border-border rounded bg-red-50/50 dark:bg-red-950/10"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <Badge 
                      variant={
                        cycle.severity === 'high' ? 'destructive' :
                        cycle.severity === 'medium' ? 'secondary' :
                        'outline'
                      }
                      className="text-xs h-3 px-1"
                    >
                      {cycle.severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {cycle.nodes.length} nodes
                    </span>
                    <span className="text-xs text-muted-foreground truncate flex-1 ml-2">
                      {cycle.description}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1 text-xs flex-wrap">
                    {cycle.nodes.slice(0, 4).map((node, nodeIndex) => (
                      <div key={node.id} className="flex items-center gap-1">
                        <code 
                          className="bg-muted px-1 rounded text-xs cursor-pointer hover:bg-muted/80 transition-colors"
                          onClick={() => onNodeSelect?.(node.id)}
                        >
                          {node.name.length > 12 ? `${node.name.slice(0, 12)}...` : node.name}
                        </code>
                        {nodeIndex < Math.min(cycle.nodes.length, 4) - 1 && (
                          <span className="text-muted-foreground">→</span>
                        )}
                      </div>
                    ))}
                    {cycle.nodes.length > 4 && (
                      <span className="text-xs text-muted-foreground">
                        +{cycle.nodes.length - 4} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CodeHealthDashboard({ 
  graphData, 
  onNodeSelect, 
  onOpenFile 
}: CodeHealthDashboardProps) {
  const codeHealth = useMemo(() => {
    return analyzeCodeHealth(graphData);
  }, [graphData]);

  const metrics = useMemo(() => {
    const totalNodes = graphData.nodes.length;
    const totalEdges = graphData.edges.length;
    const avgConnections = totalNodes > 0 ? Math.round((totalEdges / totalNodes) * 10) / 10 : 0;

    // Categorize issues by type
    const issuesByType = codeHealth.deadCode.reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || []).concat(issue);
      return acc;
    }, {} as Record<string, DeadCodeResult[]>);

    return {
      totalNodes,
      totalEdges,
      avgConnections,
      issuesByType,
      healthScore: {
        value: codeHealth.codeQualityScore,
        color: codeHealth.codeQualityScore >= 80 ? 'green' : 
               codeHealth.codeQualityScore >= 60 ? 'yellow' : 'red',
        trend: codeHealth.totalIssues === 0 ? 'stable' : 'up'
      },
      complexity: {
        value: codeHealth.complexityScore,
        color: codeHealth.complexityScore <= 30 ? 'green' : 
               codeHealth.complexityScore <= 60 ? 'yellow' : 'red'
      }
    };
  }, [graphData, codeHealth]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-2 sm:p-3 space-y-3 sm:space-y-4">
            {/* Overview Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                title="Health Score"
                value={`${metrics.healthScore.value}%`}
                icon={<CheckCircle className="w-4 h-4" />}
                color={metrics.healthScore.color}
                trend={metrics.healthScore.trend}
                subtitle={
                  metrics.healthScore.value >= 80 ? 'Excellent' :
                  metrics.healthScore.value >= 60 ? 'Good' :
                  metrics.healthScore.value >= 40 ? 'Fair' : 'Needs attention'
                }
              />
              
              <MetricCard
                title="Total Issues"
                value={codeHealth.totalIssues}
                icon={<AlertTriangle className="w-4 h-4" />}
                color={codeHealth.totalIssues === 0 ? 'green' : 
                       codeHealth.totalIssues <= 5 ? 'yellow' : 'red'}
                subtitle={`${codeHealth.cyclicDependencies.length} cycles`}
              />
              
              <MetricCard
                title="Complexity"
                value={metrics.complexity.value}
                icon={<Zap className="w-4 h-4" />}
                color={metrics.complexity.color}
                subtitle={`${metrics.avgConnections} avg connections`}
              />
              
              <MetricCard
                title="Code Coverage"
                value={`${Math.round((graphData.nodes.length - codeHealth.deadCode.length) / graphData.nodes.length * 100)}%`}
                icon={<FileText className="w-4 h-4" />}
                color={
                  codeHealth.deadCode.length === 0 ? 'green' :
                  codeHealth.deadCode.length <= graphData.nodes.length * 0.1 ? 'yellow' : 'red'
                }
                subtitle="Active code"
              />
            </div>

            {/* Health Score Progress */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Overall Health Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Code Quality Score</span>
                    <span className="font-medium">{codeHealth.codeQualityScore}%</span>
                  </div>
                  <Progress 
                    value={codeHealth.codeQualityScore} 
                    className="h-2"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Dead Code:</span>
                    <span className="ml-2 font-medium">{codeHealth.deadCode.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unused Imports:</span>
                    <span className="ml-2 font-medium">{codeHealth.unusedImports.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Circular Deps:</span>
                    <span className="ml-2 font-medium">{codeHealth.cyclicDependencies.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Nodes:</span>
                    <span className="ml-2 font-medium">{graphData.nodes.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Issue Details Tabs */}
            {codeHealth.totalIssues > 0 && (
              <Tabs defaultValue="dead-code" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="dead-code">
                    Dead Code ({codeHealth.deadCode.length})
                  </TabsTrigger>
                  <TabsTrigger value="unused-imports">
                    Unused Imports ({codeHealth.unusedImports.length})
                  </TabsTrigger>
                  <TabsTrigger value="cycles">
                    Cycles ({codeHealth.cyclicDependencies.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="dead-code" className="space-y-4">
                  <IssueList
                    title="Unused Functions"
                    issues={metrics.issuesByType.unused_function || []}
                    icon={<AlertTriangle className="w-4 h-4" />}
                    color="bg-red-50 text-red-600 dark:bg-red-950/20"
                    onNodeSelect={onNodeSelect}
                    onOpenFile={onOpenFile}
                  />
                  
                  <IssueList
                    title="Unreachable Code"
                    issues={metrics.issuesByType.unreachable_code || []}
                    icon={<AlertCircle className="w-4 h-4" />}
                    color="bg-amber-50 text-amber-600 dark:bg-amber-950/20"
                    onNodeSelect={onNodeSelect}
                    onOpenFile={onOpenFile}
                  />
                  
                  <IssueList
                    title="Orphaned Modules"
                    issues={metrics.issuesByType.orphaned_module || []}
                    icon={<FileText className="w-4 h-4" />}
                    color="bg-blue-50 text-blue-600 dark:bg-blue-950/20"
                    onNodeSelect={onNodeSelect}
                    onOpenFile={onOpenFile}
                  />
                </TabsContent>

                <TabsContent value="unused-imports" className="space-y-4">
                  <IssueList
                    title="Unused Imports"
                    issues={codeHealth.unusedImports}
                    icon={<FileText className="w-4 h-4" />}
                    color="bg-purple-50 text-purple-600 dark:bg-purple-950/20"
                    onNodeSelect={onNodeSelect}
                    onOpenFile={onOpenFile}
                  />
                </TabsContent>

                <TabsContent value="cycles" className="space-y-4">
                  <CyclicDependencyList
                    cycles={codeHealth.cyclicDependencies}
                    onNodeSelect={onNodeSelect}
                  />
                </TabsContent>
              </Tabs>
            )}

            {/* No Issues State */}
            {codeHealth.totalIssues === 0 && (
              <Card>
                <CardContent className="p-6 text-center">
                  <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Excellent Code Health!</h3>
                  <p className="text-muted-foreground">
                    No dead code, unused imports, or circular dependencies detected.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}