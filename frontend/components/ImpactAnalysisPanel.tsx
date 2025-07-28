'use client';

import { useState, useMemo, useCallback } from 'react';
import { 
  AlertTriangle, 
  CheckCircle, 
  FileText, 
  Zap, 
  Shield,
  Target,
  TrendingUp,
  Info,
  ExternalLink,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { 
  GraphData, 
  CodeReference, 
  ImpactAnalysis 
} from '@/types/code-analysis';
import { 
  generateImpactReport, 
  analyzeBulkImpact, 
  analyzeNodeImpact 
} from '@/utils/impact-analyzer';

interface ImpactAnalysisPanelProps {
  selectedNode?: CodeReference;
  graphData: GraphData;
  onNodeSelect: (node: CodeReference) => void;
  onOpenFile: (filePath: string, line?: number) => void;
}

interface ImpactSummaryProps {
  analysis: ImpactAnalysis;
  targetNode: CodeReference;
  changeType: string;
}

function ImpactSummary({ analysis, targetNode, changeType }: ImpactSummaryProps) {
  const riskColor = analysis.riskLevel === 'high' ? 'text-red-600' :
                   analysis.riskLevel === 'medium' ? 'text-yellow-600' : 
                   'text-green-600';

  const riskBgColor = analysis.riskLevel === 'high' ? 'bg-red-50 dark:bg-red-950/20' :
                     analysis.riskLevel === 'medium' ? 'bg-yellow-50 dark:bg-yellow-950/20' : 
                     'bg-green-50 dark:bg-green-950/20';

  return (
    <Card className={`border-l-4 ${
      analysis.riskLevel === 'high' ? 'border-l-red-500' :
      analysis.riskLevel === 'medium' ? 'border-l-yellow-500' :
      'border-l-green-500'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${riskBgColor}`}>
                {analysis.riskLevel === 'high' ? (
                  <AlertTriangle className={`w-4 h-4 ${riskColor}`} />
                ) : analysis.riskLevel === 'medium' ? (
                  <Info className={`w-4 h-4 ${riskColor}`} />
                ) : (
                  <CheckCircle className={`w-4 h-4 ${riskColor}`} />
                )}
              </div>
              <h4 className="font-semibold text-sm">Impact Analysis</h4>
              <Badge 
                variant={analysis.riskLevel === 'high' ? 'destructive' : 
                        analysis.riskLevel === 'medium' ? 'secondary' : 'outline'}
                className="text-xs"
              >
                {analysis.riskLevel.toUpperCase()} RISK
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground mb-3">
              {changeType === 'delete' ? 'Deleting' : 
               changeType === 'refactor' ? 'Refactoring' : 'Modifying'}{' '}
              <code className="bg-muted px-1 rounded">{targetNode.name}</code>{' '}
              would affect <strong>{analysis.affectedFiles.length} files</strong> and{' '}
              <strong>{analysis.impactedFunctions.length} functions</strong>.
            </p>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Breaking Change Risk</span>
                <span className="font-medium">{Math.round(analysis.breakingChangeRisk * 100)}%</span>
              </div>
              <Progress 
                value={analysis.breakingChangeRisk * 100} 
                className="h-2"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ImpactMetricsProps {
  analysis: ImpactAnalysis;
}

function ImpactMetrics({ analysis }: ImpactMetricsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Affected Files</p>
              <p className="text-2xl font-bold">{analysis.affectedFiles.length}</p>
            </div>
            <div className="p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Impacted Functions</p>
              <p className="text-2xl font-bold">{analysis.impactedFunctions.length}</p>
            </div>
            <div className="p-2 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
              <Zap className="w-4 h-4 text-purple-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Risk Level</p>
              <p className="text-lg font-bold capitalize">{analysis.riskLevel}</p>
            </div>
            <div className={`p-2 rounded-lg ${
              analysis.riskLevel === 'high' ? 'bg-red-50 dark:bg-red-950/20' :
              analysis.riskLevel === 'medium' ? 'bg-yellow-50 dark:bg-yellow-950/20' :
              'bg-green-50 dark:bg-green-950/20'
            }`}>
              <Shield className={`w-4 h-4 ${
                analysis.riskLevel === 'high' ? 'text-red-600' :
                analysis.riskLevel === 'medium' ? 'text-yellow-600' :
                'text-green-600'
              }`} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Break Risk</p>
              <p className="text-2xl font-bold">{Math.round(analysis.breakingChangeRisk * 100)}%</p>
            </div>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
              <TrendingUp className="w-4 h-4 text-amber-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ImpactAnalysisPanel({
  selectedNode,
  graphData,
  onNodeSelect,
  onOpenFile,
}: ImpactAnalysisPanelProps) {
  const [changeType, setChangeType] = useState<'modify' | 'delete' | 'refactor'>('modify');
  const [copySuccess, setCopySuccess] = useState(false);

  // Generate impact analysis
  const impactReport = useMemo(() => {
    if (!selectedNode) return null;
    return generateImpactReport(selectedNode, graphData, changeType);
  }, [selectedNode, graphData, changeType]);

  const handleCopyPath = useCallback(async (node: CodeReference) => {
    try {
      await navigator.clipboard.writeText(`${node.file}:${node.start_line || 1}`);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  }, []);

  const handleRefreshAnalysis = useCallback(() => {
    // In a real implementation, this would re-fetch or recalculate the analysis
    // For now, it's just a placeholder
  }, []);

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <Target className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Node Selected</h3>
          <p className="text-muted-foreground">
            Select a node to analyze the impact of potential changes
          </p>
        </div>
      </div>
    );
  }

  if (!impactReport) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-primary mb-4" />
          <h3 className="text-lg font-medium mb-2">Analyzing Impact</h3>
          <p className="text-muted-foreground">
            Calculating potential impact of changes...
          </p>
        </div>
      </div>
    );
  }

  const { analysis, mitigationStrategies, summary } = impactReport;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-border/20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Impact Analysis</h3>
            <p className="text-sm text-muted-foreground">
              Analyze potential impact of changes to {selectedNode.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={changeType} onValueChange={(value: any) => setChangeType(value)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="modify">Modify</SelectItem>
                <SelectItem value="refactor">Refactor</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAnalysis}
              className="h-8"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Change Type Info */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {selectedNode.category}
          </Badge>
          <code className="bg-muted px-2 py-1 rounded text-xs">{selectedNode.name}</code>
          <span className="text-xs text-muted-foreground">→</span>
          <Badge variant="secondary" className="text-xs">
            {changeType}
          </Badge>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6">
            {/* Impact Summary */}
            <ImpactSummary 
              analysis={analysis} 
              targetNode={selectedNode} 
              changeType={changeType} 
            />

            {/* Metrics */}
            <ImpactMetrics analysis={analysis} />

            {/* Summary Text */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{summary}</p>
              </CardContent>
            </Card>

            {/* Affected Files */}
            {analysis.affectedFiles.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Affected Files ({analysis.affectedFiles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {analysis.affectedFiles.map((filePath, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm hover:bg-muted cursor-pointer group"
                        onClick={() => onOpenFile(filePath)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <code className="truncate">{filePath.split('/').pop()}</code>
                          <span className="text-muted-foreground text-xs truncate">
                            {filePath.replace(filePath.split('/').pop() || '', '')}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFile(filePath);
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Impacted Functions */}
            {analysis.impactedFunctions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Impacted Functions ({analysis.impactedFunctions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {analysis.impactedFunctions.map((func, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer group"
                        onClick={() => onNodeSelect(func)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${
                            func.category === 'function' ? 'bg-blue-500' :
                            func.category === 'class' ? 'bg-green-500' :
                            func.category === 'module' ? 'bg-purple-500' :
                            'bg-gray-500'
                          }`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="font-medium text-sm truncate">{func.name}</code>
                              <Badge variant="outline" className="text-xs">
                                {func.category}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {func.file.split('/').pop()}
                              {func.start_line && `:${func.start_line}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFile(func.file, func.start_line);
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyPath(func);
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Risk Factors */}
            {analysis.reasons.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Risk Factors
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {analysis.reasons.map((reason, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 flex-shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Mitigation Strategies */}
            {mitigationStrategies.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Mitigation Strategies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {mitigationStrategies.map((strategy, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{strategy}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
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