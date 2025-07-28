'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Activity,
  Search,
  GitBranch,
  BarChart3,
  Network,
  Target,
  RefreshCw,
  Download,
  Share2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DependencyTree } from './DependencyTree';
import { CodeHealthDashboard } from './CodeHealthDashboard';
import { AdvancedSearch } from './AdvancedSearch';
import { MiniNetworkViewer } from './MiniNetworkViewer';
import { CodeReferenceAnalyzer } from './code-reference-analyzer';
import { ImpactAnalysisPanel } from './ImpactAnalysisPanel';
import type { GraphData, CodeReference, CodeHealthMetrics } from '@/types/code-analysis';
import { analyzeCodeHealth } from '@/utils/dead-code-analyzer';

interface EnhancedAnalysisTabProps {
  graphData: GraphData;
  selectedNode?: CodeReference;
  onNodeSelect: (node: CodeReference) => void;
  onOpenFile: (filePath: string, line?: number) => void;
}

interface QuickStatsProps {
  graphData: GraphData;
  codeHealth: CodeHealthMetrics;
}

function QuickStats({ graphData, codeHealth }: QuickStatsProps) {
  const stats = useMemo(() => {
    const totalNodes = graphData.nodes.length;
    const totalEdges = graphData.edges.length;
    const avgConnections = totalNodes > 0 ? Math.round((totalEdges / totalNodes) * 10) / 10 : 0;

    const nodesByCategory = graphData.nodes.reduce((acc, node) => {
      acc[node.category] = (acc[node.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const healthScore = codeHealth.codeQualityScore;
    const issueCount = codeHealth.totalIssues;

    return {
      totalNodes,
      totalEdges,
      avgConnections,
      nodesByCategory,
      healthScore,
      issueCount,
      topCategories: Object.entries(nodesByCategory)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3),
    };
  }, [graphData, codeHealth]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 min-w-0">
      <Card className="min-w-0 py-0">
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Nodes</p>
              <p className="text-lg sm:text-xl font-bold truncate">{stats.totalNodes}</p>
            </div>
            <div className="p-1 bg-blue-50 dark:bg-blue-950/20 rounded flex-shrink-0">
              <Activity className="w-3 h-3 text-blue-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 py-0">
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Health</p>
              <p className="text-lg sm:text-xl font-bold truncate">{stats.healthScore}%</p>
            </div>
            <div
              className={`p-1 rounded flex-shrink-0 ${
                stats.healthScore >= 80
                  ? 'bg-green-50 dark:bg-green-950/20'
                  : stats.healthScore >= 60
                  ? 'bg-yellow-50 dark:bg-yellow-950/20'
                  : 'bg-red-50 dark:bg-red-950/20'
              }`}
            >
              {stats.healthScore >= 80 ? (
                <CheckCircle className="w-3 h-3 text-green-600" />
              ) : (
                <AlertCircle
                  className={`w-3 h-3 ${
                    stats.healthScore >= 60 ? 'text-yellow-600' : 'text-red-600'
                  }`}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 py-0">
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Issues</p>
              <p className="text-lg sm:text-xl font-bold truncate">{stats.issueCount}</p>
            </div>
            <div
              className={`p-1 rounded flex-shrink-0 ${
                stats.issueCount === 0
                  ? 'bg-green-50 dark:bg-green-950/20'
                  : stats.issueCount <= 5
                  ? 'bg-yellow-50 dark:bg-yellow-950/20'
                  : 'bg-red-50 dark:bg-red-950/20'
              }`}
            >
              <BarChart3
                className={`w-3 h-3 ${
                  stats.issueCount === 0
                    ? 'text-green-600'
                    : stats.issueCount <= 5
                    ? 'text-yellow-600'
                    : 'text-red-600'
                }`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 py-0">
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Connections</p>
              <p className="text-lg sm:text-xl font-bold truncate">{stats.avgConnections}</p>
            </div>
            <div className="p-1 bg-purple-50 dark:bg-purple-950/20 rounded flex-shrink-0">
              <Network className="w-3 h-3 text-purple-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface TabHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
}

function TabHeader({ title, description, actions }: TabHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EnhancedAnalysisTab({
  graphData,
  selectedNode,
  onNodeSelect,
  onOpenFile,
}: EnhancedAnalysisTabProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null);

  // Analyze code health
  const codeHealth = useMemo(() => {
    setIsAnalyzing(true);
    try {
      const result = analyzeCodeHealth(graphData);
      setLastAnalyzed(new Date());
      return result;
    } finally {
      setTimeout(() => setIsAnalyzing(false), 500); // Brief loading state
    }
  }, [graphData]);

  const handleRefreshAnalysis = useCallback(() => {
    // In a real implementation, this would re-fetch or re-analyze the data
    setLastAnalyzed(new Date());
  }, []);

  const handleExportData = useCallback(() => {
    const dataToExport = {
      summary: {
        totalNodes: graphData.nodes.length,
        totalEdges: graphData.edges.length,
        healthScore: codeHealth.codeQualityScore,
        totalIssues: codeHealth.totalIssues,
        analyzedAt: lastAnalyzed,
      },
      codeHealth,
      selectedNode,
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code-analysis-report.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [graphData, codeHealth, selectedNode, lastAnalyzed]);

  const tabConfig = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <Activity className="w-4 h-4" />,
      description: 'High-level code health metrics and summary',
    },
    {
      id: 'search',
      label: 'Search',
      icon: <Search className="w-4 h-4" />,
      description: 'Advanced search with filtering capabilities',
      badge: graphData.nodes.length,
    },
    {
      id: 'dependencies',
      label: 'Dependencies',
      icon: <GitBranch className="w-4 h-4" />,
      description: 'Interactive dependency tree visualization',
      badge: selectedNode ? 'Selected' : null,
    },
    {
      id: 'health',
      label: 'Health',
      icon: <BarChart3 className="w-4 h-4" />,
      description: 'Detailed code health analysis and issues',
      badge: codeHealth.totalIssues > 0 ? codeHealth.totalIssues : null,
    },
    {
      id: 'network',
      label: 'Network',
      icon: <Network className="w-4 h-4" />,
      description: 'Mini network view of relationships',
      badge: selectedNode ? 'Active' : null,
    },
    {
      id: 'references',
      label: 'References',
      icon: <Search className="w-4 h-4" />,
      description: 'Code reference analysis for selected node',
      badge: selectedNode ? 'Ready' : null,
    },
    {
      id: 'impact',
      label: 'Impact',
      icon: <Target className="w-4 h-4" />,
      description: 'Impact analysis for potential changes',
      badge: selectedNode ? 'Available' : null,
    },
  ];

  const globalActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefreshAnalysis}
        disabled={isAnalyzing}
        className="h-8"
      >
        <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
      </Button>
      <Button variant="outline" size="sm" onClick={handleExportData} className="h-8">
        <Download className="w-3 h-3" />
      </Button>
      <Button variant="outline" size="sm" className="h-8">
        <Share2 className="w-3 h-3" />
      </Button>
    </>
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Compact Header */}
      <div className="flex-shrink-0 p-2 sm:p-3 border-b border-border/20 bg-background/50 backdrop-blur-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate">Code Analysis</h2>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Comprehensive analysis of code structure, health, and relationships
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">{globalActions}</div>
          </div>

          {lastAnalyzed && (
            <p className="text-xs text-muted-foreground">
              Last analyzed: {lastAnalyzed.toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Compact Stats */}
      <div className="flex-shrink-0 p-2 sm:p-3 border-b border-border/20">
        <div className="overflow-x-auto">
          <QuickStats graphData={graphData} codeHealth={codeHealth} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          {/* Compact Multi-Row Tab Navigation */}
          <div className="flex-shrink-0 px-2 sm:px-3 pt-2">
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 sm:gap-0">
              {tabConfig.map((tab) => (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab(tab.id)}
                  className="h-8 px-2 py-1 text-xs justify-start gap-1 rounded-md"
                >
                  {tab.icon}
                  <span className="hidden sm:inline truncate">{tab.label}</span>
                  <span className="sm:hidden truncate">{tab.label}</span>
                  {tab.badge && typeof tab.badge === 'number' && tab.badge > 0 && (
                    <Badge variant="destructive" className="h-3 px-1 text-xs ml-auto">
                      {tab.badge}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="overview" className="h-full mt-0 overflow-hidden">
              <div className="h-full flex flex-col overflow-hidden">
                <div className="flex-shrink-0 p-2 border-b border-border/20">
                  <TabHeader
                    title="Analysis Overview"
                    description="High-level metrics and code health summary"
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <CodeHealthDashboard
                    graphData={graphData}
                    onNodeSelect={(nodeId) => {
                      const node = graphData.nodes.find((n) => n.id === nodeId);
                      if (node) onNodeSelect(node);
                    }}
                    onOpenFile={onOpenFile}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="search" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                <AdvancedSearch
                  graphData={graphData}
                  onNodeSelect={onNodeSelect}
                  onOpenFile={onOpenFile}
                />
              </div>
            </TabsContent>

            <TabsContent value="dependencies" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                {selectedNode ? (
                  <DependencyTree
                    selectedNode={selectedNode}
                    graphData={graphData}
                    onNodeSelect={onNodeSelect}
                    onOpenFile={onOpenFile}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center p-4">
                    <div className="text-center">
                      <GitBranch className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
                      <h3 className="text-base font-medium mb-2">Select a Node</h3>
                      <p className="text-sm text-muted-foreground max-w-xs">
                        Choose a node from the graph to explore its dependency tree
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="health" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                <CodeHealthDashboard
                  graphData={graphData}
                  onNodeSelect={(nodeId) => {
                    const node = graphData.nodes.find((n) => n.id === nodeId);
                    if (node) onNodeSelect(node);
                  }}
                  onOpenFile={onOpenFile}
                />
              </div>
            </TabsContent>

            <TabsContent value="network" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                {selectedNode ? (
                  <MiniNetworkViewer
                    selectedNode={selectedNode}
                    graphData={graphData}
                    onNodeSelect={onNodeSelect}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center p-4">
                    <div className="text-center">
                      <Network className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
                      <h3 className="text-base font-medium mb-2">Select a Node</h3>
                      <p className="text-sm text-muted-foreground max-w-xs">
                        Choose a node to visualize its network relationships
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="references" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                <CodeReferenceAnalyzer
                  selectedNode={selectedNode || undefined}
                  graphData={graphData}
                  onOpenFile={onOpenFile}
                />
              </div>
            </TabsContent>

            <TabsContent value="impact" className="h-full mt-0 overflow-hidden">
              <div className="h-full overflow-hidden">
                <ImpactAnalysisPanel
                  selectedNode={selectedNode}
                  graphData={graphData}
                  onNodeSelect={onNodeSelect}
                  onOpenFile={onOpenFile}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
