'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  X, 
  FileText, 
  Code, 
  Package,
  Zap,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { 
  GraphData, 
  CodeReference, 
  SearchFilter,
  DeadCodeResult 
} from '@/types/code-analysis';
import { analyzeCodeHealth } from '@/utils/dead-code-analyzer';

interface AdvancedSearchProps {
  graphData: GraphData;
  onNodeSelect: (node: CodeReference) => void;
  onOpenFile: (filePath: string, line?: number) => void;
}

interface SearchResult {
  node: CodeReference;
  score: number;
  matches: string[];
  hasDeadCode: boolean;
  connectionCount: number;
}

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

function FilterSection({ title, children, defaultExpanded = false }: FilterSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        className="w-full justify-between h-auto p-2 font-medium text-sm"
        onClick={() => setExpanded(!expanded)}
      >
        {title}
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </Button>
      {expanded && (
        <div className="pl-2 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function AdvancedSearch({ 
  graphData, 
  onNodeSelect, 
  onOpenFile 
}: AdvancedSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFiltersPanelOpen, setIsFiltersPanelOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  
  const [filters, setFilters] = useState<SearchFilter>({
    nodeTypes: [],
    relationshipTypes: [],
    codeHealthFilters: [],
    fileTypes: [],
    showDeadCode: false,
    showCyclicDeps: false,
    directOnly: false,
  });

  // Analyze code health for filtering
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

  const cyclicNodeIds = useMemo(() => {
    const ids = new Set<string>();
    codeHealth.cyclicDependencies.forEach(cycle => {
      cycle.nodes.forEach(node => ids.add(node.id));
    });
    return ids;
  }, [codeHealth]);

  // Get available filter options from data
  const filterOptions = useMemo(() => {
    const nodeTypes = new Set<string>();
    const relationshipTypes = new Set<string>();
    const fileExtensions = new Set<string>();

    graphData.nodes.forEach(node => {
      nodeTypes.add(node.category);
      const ext = node.file.split('.').pop()?.toLowerCase();
      if (ext) fileExtensions.add(ext);
    });

    graphData.edges.forEach(edge => {
      if (edge.relationship) {
        relationshipTypes.add(edge.relationship);
      }
    });

    return {
      nodeTypes: Array.from(nodeTypes).sort(),
      relationshipTypes: Array.from(relationshipTypes).sort(),
      fileTypes: Array.from(fileExtensions).sort(),
    };
  }, [graphData]);

  // Search and filter logic
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() && Object.values(filters).every(f => 
      Array.isArray(f) ? f.length === 0 : !f
    )) {
      return [];
    }

    let results: SearchResult[] = graphData.nodes.map(node => {
      let score = 0;
      const matches: string[] = [];

      // Text search scoring
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        
        // Name match (highest priority)
        if (node.name.toLowerCase().includes(query)) {
          score += 10;
          matches.push('name');
        }
        
        // File path match
        if (node.file.toLowerCase().includes(query)) {
          score += 5;
          matches.push('file');
        }
        
        // Code content match
        if (node.code && node.code.toLowerCase().includes(query)) {
          score += 3;
          matches.push('code');
        }
        
        // Category match
        if (node.category.toLowerCase().includes(query)) {
          score += 2;
          matches.push('category');
        }
      } else {
        score = 1; // Base score when only using filters
      }

      // Connection count for relevance
      const connectionCount = graphData.edges.filter(
        edge => edge.source === node.id || edge.target === node.id
      ).length;

      return {
        node,
        score,
        matches,
        hasDeadCode: deadCodeMap.has(node.id),
        connectionCount,
      };
    });

    // Apply filters
    results = results.filter(result => {
      const { node } = result;

      // Node type filter
      if (filters.nodeTypes.length > 0 && !filters.nodeTypes.includes(node.category)) {
        return false;
      }

      // File type filter
      if (filters.fileTypes.length > 0) {
        const ext = node.file.split('.').pop()?.toLowerCase();
        if (!ext || !filters.fileTypes.includes(ext)) {
          return false;
        }
      }

      // Relationship type filter
      if (filters.relationshipTypes.length > 0) {
        const hasMatchingRelationship = graphData.edges.some(edge => {
          const isConnected = edge.source === node.id || edge.target === node.id;
          return isConnected && edge.relationship && 
                 filters.relationshipTypes.includes(edge.relationship);
        });
        if (!hasMatchingRelationship) {
          return false;
        }
      }

      // Code health filters
      if (filters.showDeadCode && !result.hasDeadCode) {
        return false;
      }

      if (filters.showCyclicDeps && !cyclicNodeIds.has(node.id)) {
        return false;
      }

      // Health-based filters
      if (filters.codeHealthFilters.includes('high-complexity')) {
        if (result.connectionCount < 10) return false;
      }

      if (filters.codeHealthFilters.includes('low-usage')) {
        if (result.connectionCount > 2) return false;
      }

      if (filters.codeHealthFilters.includes('orphaned')) {
        if (result.connectionCount > 0) return false;
      }

      return true;
    });

    // Sort by relevance score and connection count
    results.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.connectionCount - a.connectionCount;
    });

    return results.slice(0, 100); // Limit results for performance
  }, [searchQuery, filters, graphData, deadCodeMap, cyclicNodeIds]);

  const updateFilter = useCallback((
    filterType: keyof SearchFilter,
    value: string | boolean,
    action: 'add' | 'remove' | 'set' = 'set'
  ) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      
      if (typeof value === 'boolean') {
        (newFilters[filterType] as boolean) = value;
      } else {
        const currentArray = newFilters[filterType] as string[];
        
        if (action === 'add' && !currentArray.includes(value)) {
          (newFilters[filterType] as string[]) = [...currentArray, value];
        } else if (action === 'remove') {
          (newFilters[filterType] as string[]) = currentArray.filter(item => item !== value);
        }
      }
      
      return newFilters;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({
      nodeTypes: [],
      relationshipTypes: [],
      codeHealthFilters: [],
      fileTypes: [],
      showDeadCode: false,
      showCyclicDeps: false,
      directOnly: false,
    });
    setSearchQuery('');
  }, []);

  const handleCopyPath = useCallback(async (node: CodeReference) => {
    try {
      await navigator.clipboard.writeText(`${node.file}:${node.start_line || 1}`);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  }, []);

  const activeFilterCount = useMemo(() => {
    return filters.nodeTypes.length + 
           filters.relationshipTypes.length + 
           filters.codeHealthFilters.length + 
           filters.fileTypes.length +
           (filters.showDeadCode ? 1 : 0) +
           (filters.showCyclicDeps ? 1 : 0) +
           (filters.directOnly ? 1 : 0);
  }, [filters]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Search Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Compact Search Header */}
        <div className="flex-shrink-0 p-2 sm:p-3 border-b border-border/20">
          <div className="space-y-2">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search nodes by name, file, or content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {searchResults.length} results
                {activeFilterCount > 0 && (
                  <span className="ml-2">
                    ({activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="h-6 text-xs px-2"
                  >
                    <X className="w-3 h-3" />
                    <span className="hidden sm:inline ml-1">Clear</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFiltersPanelOpen(!isFiltersPanelOpen)}
                  className="h-6 px-2"
                >
                  <Filter className="w-3 h-3" />
                  <span className="hidden sm:inline ml-1">Filters</span>
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-1 h-3 px-1 text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3 sm:p-4 space-y-3">
              {searchResults.length === 0 && (searchQuery || activeFilterCount > 0) && (
                <div className="text-center py-6 sm:py-8">
                  <Search className="w-8 h-8 sm:w-12 sm:h-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-base sm:text-lg font-medium mb-2">No results found</h3>
                  <p className="text-sm text-muted-foreground mb-4 px-4">
                    Try adjusting your search query or filters
                  </p>
                  <Button variant="outline" size="sm" onClick={clearAllFilters}>
                    Clear filters
                  </Button>
                </div>
              )}

              {searchResults.length === 0 && !searchQuery && activeFilterCount === 0 && (
                <div className="text-center py-8">
                  <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium mb-2">Start searching</h3>
                  <p className="text-muted-foreground">
                    Enter a search query or apply filters to find nodes
                  </p>
                </div>
              )}

              {searchResults.map((result, index) => (
                <Card
                  key={`${result.node.id}-${index}`}
                  className="hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => onNodeSelect(result.node)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-mono font-medium text-sm truncate">
                            {result.node.name}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {result.node.category}
                          </Badge>
                          {result.matches.length > 0 && (
                            <div className="flex gap-1">
                              {result.matches.map(match => (
                                <Badge
                                  key={match}
                                  variant="secondary" 
                                  className="text-xs bg-primary/10 text-primary"
                                >
                                  {match}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {result.node.file.split('/').pop()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {result.connectionCount} connections
                          </span>
                          {result.node.start_line && (
                            <span>Line {result.node.start_line}</span>
                          )}
                        </div>

                        {/* Issue indicators */}
                        <div className="flex items-center gap-2">
                          {result.hasDeadCode && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Dead Code
                            </Badge>
                          )}
                          {cyclicNodeIds.has(result.node.id) && (
                            <Badge variant="outline" className="text-xs text-amber-600">
                              <Code className="w-3 h-3 mr-1" />
                              Circular Dep
                            </Badge>
                          )}
                          {result.connectionCount > 15 && (
                            <Badge variant="outline" className="text-xs text-blue-600">
                              <Package className="w-3 h-3 mr-1" />
                              High Usage
                            </Badge>
                          )}
                        </div>

                        {/* Code preview for code matches */}
                        {result.matches.includes('code') && result.node.code && (
                          <div className="mt-3 p-2 bg-muted/50 rounded text-xs font-mono">
                            <div className="text-muted-foreground mb-1">Code snippet:</div>
                            <div className="truncate">
                              {result.node.code.slice(0, 200)}
                              {result.node.code.length > 200 && '...'}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFile(result.node.file, result.node.start_line);
                          }}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPath(result.node);
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Filters Panel */}
      {isFiltersPanelOpen && (
        <div className="w-72 sm:w-80 border-l border-border/20 bg-background/50 backdrop-blur-sm flex-shrink-0 overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-border/20">
            <div className="flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-semibold">Filters</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFiltersPanelOpen(false)}
                className="h-7 w-7 sm:h-8 sm:w-8 p-0"
              >
                <X className="w-3 h-3 sm:w-4 sm:h-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="h-full">
            <div className="p-3 sm:p-4 space-y-4">
              {/* Node Types */}
              <FilterSection title="Node Types" defaultExpanded>
                <div className="space-y-2">
                  {filterOptions.nodeTypes.map(type => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`node-${type}`}
                        checked={filters.nodeTypes.includes(type)}
                        onCheckedChange={(checked) => {
                          updateFilter('nodeTypes', type, checked ? 'add' : 'remove');
                        }}
                      />
                      <label
                        htmlFor={`node-${type}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
              </FilterSection>

              <Separator />

              {/* File Types */}
              <FilterSection title="File Types">
                <div className="space-y-2">
                  {filterOptions.fileTypes.map(type => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`file-${type}`}
                        checked={filters.fileTypes.includes(type)}
                        onCheckedChange={(checked) => {
                          updateFilter('fileTypes', type, checked ? 'add' : 'remove');
                        }}
                      />
                      <label
                        htmlFor={`file-${type}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        .{type}
                      </label>
                    </div>
                  ))}
                </div>
              </FilterSection>

              <Separator />

              {/* Code Health */}
              <FilterSection title="Code Health">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="dead-code"
                      checked={filters.showDeadCode}
                      onCheckedChange={(checked) => {
                        updateFilter('showDeadCode', checked as boolean);
                      }}
                    />
                    <label htmlFor="dead-code" className="text-sm font-medium">
                      Show Dead Code
                    </label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="cyclic-deps"
                      checked={filters.showCyclicDeps}
                      onCheckedChange={(checked) => {
                        updateFilter('showCyclicDeps', checked as boolean);
                      }}
                    />
                    <label htmlFor="cyclic-deps" className="text-sm font-medium">
                      Show Circular Dependencies
                    </label>
                  </div>

                  {['high-complexity', 'low-usage', 'orphaned'].map(filter => (
                    <div key={filter} className="flex items-center space-x-2">
                      <Checkbox
                        id={filter}
                        checked={filters.codeHealthFilters.includes(filter)}
                        onCheckedChange={(checked) => {
                          updateFilter('codeHealthFilters', filter, checked ? 'add' : 'remove');
                        }}
                      />
                      <label htmlFor={filter} className="text-sm font-medium">
                        {filter.split('-').map(word => 
                          word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')}
                      </label>
                    </div>
                  ))}
                </div>
              </FilterSection>

              <Separator />

              {/* Relationships */}
              <FilterSection title="Relationships">
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {filterOptions.relationshipTypes.map(type => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`rel-${type}`}
                        checked={filters.relationshipTypes.includes(type)}
                        onCheckedChange={(checked) => {
                          updateFilter('relationshipTypes', type, checked ? 'add' : 'remove');
                        }}
                      />
                      <label
                        htmlFor={`rel-${type}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 truncate"
                      >
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
              </FilterSection>
            </div>
          </ScrollArea>
        </div>
      )}

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