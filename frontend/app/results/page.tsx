"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReagraphVisualization from "@/components/ReagraphVisualization";

import {
  Download,
  Copy,
  Network,
  Code2,
  FileText,
  ArrowLeft,
  ExternalLink,
  CheckCircle,
  Share,
  Github,
  Folder,
  Info,
  X,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { CodeViewer } from "@/components/CodeViewer";
import { cn } from "@/lib/utils";
import { useResultData } from "@/context/ResultDataContext";
import { showToast } from "@/components/ui/toaster";

export default function ResultsPage() {
  const router = useRouter();
  const {
    output,
    error,
    outputMessage,
    sourceType,
    sourceData,
    loading,
  } = useResultData();

  const [activeTab, setActiveTab] = useState("structure");
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // popup state for full-screen code explorer
  const [isExpanded, setIsExpanded] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close expanded view
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    // Add escape key handler
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscKey)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscKey)
    }
  }, [isExpanded])

  // Show toast messages for error/outputMessage
  useEffect(() => {
    if (error) showToast.error(error);
  }, [error]);
  useEffect(() => {
    if (outputMessage) showToast.success(outputMessage);
  }, [outputMessage]);

  // Redirect if no output (no results)
  useEffect(() => {
    if (!output && !loading) {
      router.replace("/");
    }
  }, [output, loading, router]);

  // Helper to get repository name from sourceData
  const getRepoName = () => {
    if (
      sourceType === "github" &&
      sourceData &&
      typeof sourceData === "object" &&
      "repo_url" in sourceData &&
      typeof (sourceData as any).repo_url === "string"
    ) {
      try {
        const url = new URL((sourceData as any).repo_url);
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length >= 2) {
          return `${pathParts[0]}/${pathParts[1]}`;
        }
      } catch (e) { }
      return (sourceData as any).repo_url;
    }
    if (sourceType === "zip" && sourceData && "name" in sourceData) {
      return (sourceData as any).name;
    }
    return "Repository";
  };

  // Copy/download handlers
  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      showToast.error("Failed to copy");
    }
  };
  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "repository-structure.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || !output) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6 p-12 rounded-3xl bg-background/80 backdrop-blur-2xl border border-border/50 shadow-xl">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
          <div className="text-center space-y-2">
            <h3 className="font-medium text-foreground">Loading Results</h3>
            <p className="text-sm text-muted-foreground">Please wait while we prepare your analysis...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Gradient */}
      <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

      {/* Back Button */}
      <div className="fixed top-6 left-6 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/")}
          className="h-10 w-10 rounded-2xl bg-background/90 backdrop-blur-xl border-border/60 shadow-md hover:bg-background hover:shadow-lg transition-all duration-300"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Repo Badge */}
      <div className="fixed top-6 left-20 z-50 flex items-center">
        <div className="flex items-center gap-2 bg-background/90 backdrop-blur-xl rounded-2xl px-4 py-2 border border-border/60 shadow-md">
          <Github className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{getRepoName()}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full hover:bg-muted/50"
            onClick={() => setShowInfo(!showInfo)}
          >
            <Info className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Status Badge */}
      <div className="fixed top-6 right-6 z-50">
        <Badge className="bg-green-50/90 text-green-700 border-green-200/60 dark:bg-green-950/90 dark:text-green-300 dark:border-green-800/60 rounded-2xl px-4 py-2 backdrop-blur-xl shadow-md flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          <span>Analysis Complete</span>
        </Badge>
      </div>

      {/* Info Panel */}
      {showInfo && (
        <div className="fixed top-20 left-6 z-50 max-w-md">
          <div className="bg-background/95 backdrop-blur-xl rounded-2xl border border-border/60 shadow-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Repository Details</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full hover:bg-muted/50"
                onClick={() => setShowInfo(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Source:</span>
                <span>{sourceType === "github" ? "GitHub Repository" : "ZIP Archive"}</span>
              </div>
              {/* You can add more info here if you store it in context */}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-12 space-y-4">
          <div className="inline-block bg-primary/5 backdrop-blur-sm px-6 py-2 rounded-2xl border border-primary/10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Analysis Results</h1>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <div className="flex justify-center relative">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-muted/30 -z-10"></div>
            <TabsList className="bg-background backdrop-blur-xl border border-border/60 rounded-2xl p-2 shadow-lg min-h-[60px] relative z-10">
              <TabsTrigger value="structure" className="rounded-xl px-8 py-3 text-sm font-semibold transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md hover:bg-muted/50 flex items-center gap-3 min-w-[140px] justify-center">
                <FileText className="h-5 w-5" />
                <span>Structure</span>
              </TabsTrigger>
              <TabsTrigger value="graph" className="rounded-xl px-8 py-3 text-sm font-semibold transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md hover:bg-muted/50 flex items-center gap-3 min-w-[140px] justify-center">
                <Network className="h-5 w-5" />
                <span>Graph</span>
              </TabsTrigger>
              <TabsTrigger value="explorer" className="rounded-xl px-8 py-3 text-sm font-semibold transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md hover:bg-muted/50 flex items-center gap-3 min-w-[140px] justify-center">
                <Code2 className="h-5 w-5" />
                <span>Explorer</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-[75vh] relative">
            <div
              className={cn(
                "absolute top-0 left-1/2 w-[2px] h-4 bg-primary transition-all duration-300",
                activeTab === "structure"
                  ? "-translate-x-[140px]"
                  : activeTab === "graph"
                    ? "translate-x-0"
                    : "translate-x-[140px]",
              )}
            />

            {/* Structure Tab */}
            <TabsContent value="structure" className="mt-0 h-full animate-in fade-in-50 duration-300">
              <div className="bg-background/60 backdrop-blur-xl border border-border/50 rounded-3xl shadow-sm overflow-hidden h-[75vh]">
                <div className="px-8 py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                  <div className="flex items-start justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-primary/10">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold tracking-tight text-foreground">Repository Structure</h2>
                          <p className="text-sm text-muted-foreground mt-1">
                            Structured text output optimized for AI processing
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        className="rounded-xl border-border/50 hover:bg-muted/50 transition-colors duration-200"
                      >
                        {copied ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                            <span className="text-green-600">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownload}
                        className="rounded-xl border-border/50 hover:bg-muted/50 transition-colors duration-200"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="p-8 flex-1 h-full">
                  <div className="bg-muted/30 backdrop-blur-sm rounded-2xl border border-border/30 overflow-hidden h-full">
                    <ScrollArea className="h-full">
                      <pre className="p-8 text-sm font-mono leading-relaxed whitespace-pre-wrap text-foreground/90">
                        {output}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Graph Tab */}
            <TabsContent value="graph" className="mt-0 h-full animate-in fade-in-50 duration-300">
              <div className="bg-background/60 backdrop-blur-xl border border-border/50 rounded-3xl shadow-sm overflow-hidden h-[75vh]">
                <div className="px-8 py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                  <div className="flex items-start justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-primary/10">
                          <Network className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold tracking-tight text-foreground">Dependency Graph</h2>
                          <p className="text-sm text-muted-foreground mt-1">
                            Interactive visualization of code relationships and dependencies
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled className="rounded-xl border-border/50 opacity-50">
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                      <Button variant="outline" size="sm" disabled className="rounded-xl border-border/50 opacity-50">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Expand
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 h-full">
                  <div className="h-full p-4">
                    {sourceType && sourceData ? (
                      <div className="h-full rounded-2xl overflow-hidden bg-muted/20 border border-border/30">
                        <ReagraphVisualization
                          setParentActiveTab={setActiveTab}
                          onError={(msg) => showToast.error(msg)}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center space-y-4 p-8">
                          <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center">
                            <Network className="h-6 w-6 text-muted-foreground/50" />
                          </div>
                          <div className="space-y-2">
                            <h3 className="font-medium text-foreground">No Graph Data Available</h3>
                            <p className="text-sm text-muted-foreground max-w-sm">
                              Graph visualization requires processed source data to display relationships
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Code Explorer Tab */}
            <TabsContent value="explorer" className="mt-0 h-full animate-in fade-in-50 duration-300">
              <div className="bg-background/60 backdrop-blur-xl border border-border/50 rounded-3xl shadow-sm overflow-hidden h-[75vh]">
                {/* Section Header */}
                <div className="px-8 py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-2xl bg-primary/10">
                        <Code2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-foreground">Code Explorer</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          Browse repository structure with syntax highlighting and file navigation
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsExpanded(true)}
                      className="rounded-xl border-border/50 hover:bg-muted/50 transition-colors duration-200"
                    >
                      <Maximize2 className="h-4 w-4 mr-2" />
                      Expand View
                    </Button>
                  </div>
                </div>

                {/* Explorer Content */}
                <div className="flex-1 p-4 h-full overflow-hidden">
                  <CodeViewer />
                  {/* <div className="h-full bg-red-300 rounded-2xl bg-muted/20 border border-border/30">
                  </div> */}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </main>

      {/* Bottom Gradient */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />

      {/* Floating Action Menu */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          size="icon"
          className="h-12 w-12 rounded-2xl bg-primary hover:bg-primary/90 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
        >
          <Share className="h-5 w-5" />
        </Button>
      </div>


      {/* Expanded View Popup */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md p-8">
          <div
            ref={popupRef}
            className="w-[90vw] h-[85vh] bg-background rounded-3xl border border-border/50 shadow-2xl flex flex-col animate-in fade-in-50 zoom-in-95 duration-300"
          >
            {/* Popup Header */}
            <div className="px-8 py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-primary/10">
                    <Code2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">Code Explorer</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {getRepoName()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsExpanded(false)}
                  className="rounded-xl border-border/50 hover:bg-muted/50 transition-colors duration-200"
                >
                  <Minimize2 className="h-4 w-4 mr-2" />
                  Minimize
                </Button>
              </div>
            </div>

            {/* Popup Content */}
            <div className="flex-1 p-6 overflow-hidden">
              <div className="h-full rounded-2xl overflow-hidden bg-muted/20 border border-border/30">
                <CodeViewer />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}