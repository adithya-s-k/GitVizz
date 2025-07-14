"use client";

import { useState, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Github,
  Upload,
  GitBranch,
  Lock,
  Info,
  Zap,
  ArrowRight,
  CheckCircle,
  X,
  Settings,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchGithubRepo, uploadLocalZip } from "@/utils/api";
import { useResultData } from "@/context/ResultDataContext";
import {
  SupportedLanguages,
  type Language,
} from "@/components/supported-languages";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useApiWithAuth } from "@/hooks/useApiWithAuth";

const SUPPORTED_LANGUAGES: Language[] = [
  { name: "Python", supported: true },
  { name: "JavaScript", supported: true },
  { name: "TypeScript", supported: true },
  { name: "Ruby", supported: false },
  { name: "Java", supported: false },
  { name: "Go", supported: false },
  { name: "Rust", supported: false },
];

export function RepoTabs() {
  // use session
  const { data: session } = useSession();

  // custom function to handle API calls with authentication
  const fetchGithubRepoWithAuth = useApiWithAuth(fetchGithubRepo);
  const uploadLocalZipWithAuth = useApiWithAuth(uploadLocalZip);

  // Form state
  const [repoUrl, setRepoUrl] = useState("");
  const [accessToken, setAccessToken] = useState(session?.accessToken || "");
  const [branch, setBranch] = useState("main");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ResultDataContext
  const {
    setOutput,
    loading,
    setLoading,
    setError,
    setSourceType,
    setSourceData,
    setOutputMessage,
    setCurrentRepoId,
  } = useResultData();

  // Router for navigation
  const router = useRouter();

  // GitHub form submit
  const handleGitHubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) {
      setError("Please enter a repository URL");
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    setOutputMessage(null);

    try {
      const requestData = {
        repo_url: repoUrl.trim(),
        access_token: accessToken.trim() || undefined,
        branch: branch.trim() || "main",
        jwt_token: session?.jwt_token || undefined,
      };
      const { text_content: formattedText, repo_id } =
        await fetchGithubRepoWithAuth(requestData);
      setCurrentRepoId(repo_id);
      setOutput(formattedText);
      setSourceType("github");
      setSourceData(requestData);
      setOutputMessage("Repository analysis successful!");
      // Navigate to results page
      router.push("/results");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to analyze repository.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ZIP upload submit
  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipFile) {
      setError("Please select a ZIP file");
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    setOutputMessage(null);

    try {
      const { text_content: text, repo_id } = await uploadLocalZipWithAuth(
        zipFile,
        session?.jwt_token || ""
      );
      setCurrentRepoId(repo_id);
      setOutput(text);
      setSourceType("zip");
      setSourceData(zipFile);
      setOutputMessage("ZIP file processed successfully!");
      // Navigate to results page
      router.push("/results");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to process ZIP file.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setZipFile(e.dataTransfer.files[0]);
      setError(null);
    }
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setZipFile(e.target.files[0]);
      setError(null);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Main Form Section */}
      <div className="space-y-6 sm:space-y-8">
        <Tabs defaultValue="github" className="space-y-6 sm:space-y-8">
          {/* Tab Navigation */}
          <div className="flex justify-center">
            <TabsList className="bg-background/80 backdrop-blur-xl border border-border/60 rounded-2xl p-1 sm:p-2 shadow-lg min-h-[50px] sm:min-h-[60px] w-full sm:w-auto">
              <TabsTrigger
                value="github"
                className="rounded-xl px-3 sm:px-8 py-2 sm:py-3 text-xs sm:text-sm font-semibold transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md hover:bg-muted/50 flex items-center gap-2 sm:gap-3 min-w-[120px] sm:min-w-[160px] justify-center"
              >
                <Github className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden xs:inline">GitHub Repository</span>
                <span className="xs:hidden">GitHub</span>
              </TabsTrigger>
              <TabsTrigger
                value="upload"
                className="rounded-xl px-3 sm:px-8 py-2 sm:py-3 text-xs sm:text-sm font-semibold transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md hover:bg-muted/50 flex items-center gap-2 sm:gap-3 min-w-[120px] sm:min-w-[160px] justify-center"
              >
                <Upload className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden xs:inline">ZIP Upload</span>
                <span className="xs:hidden">Upload</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* GitHub Tab */}
          <TabsContent
            value="github"
            className="animate-in fade-in-50 duration-300"
          >
            <div className="bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl sm:rounded-3xl shadow-sm overflow-hidden">
              {/* Section Header */}
              <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                <div className="flex items-center gap-3">
                  <div className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-primary/10">
                    <Github className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold tracking-tight">
                      GitHub Repository
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                      Enter a GitHub repository URL to analyze its structure and
                      generate insights
                    </p>
                  </div>
                </div>
              </div>

              {/* Form Content */}
              <div className="p-4 sm:p-8">
                <form
                  onSubmit={handleGitHubSubmit}
                  className="space-y-4 sm:space-y-6"
                >
                  {/* Repository URL */}
                  <div className="space-y-2 sm:space-y-3">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="repo-url"
                        className="flex items-center gap-2 text-sm font-medium"
                      >
                        <GitBranch className="h-4 w-4 text-primary" />
                        Repository URL
                      </Label>
                      <SupportedLanguages languages={SUPPORTED_LANGUAGES} />
                    </div>
                    <Input
                      id="repo-url"
                      placeholder="https://github.com/username/repository"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      className="h-10 sm:h-12 rounded-xl border-border/50 bg-background/50 backdrop-blur-sm text-sm sm:text-base"
                      required
                    />
                  </div>

                  {/* Advanced Options Toggle */}
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="rounded-xl text-muted-foreground hover:text-foreground text-xs sm:text-sm"
                    >
                      <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                      Advanced Options
                      <ArrowRight
                        className={cn(
                          "h-3 w-3 sm:h-4 sm:w-4 ml-2 transition-transform",
                          showAdvanced && "rotate-90"
                        )}
                      />
                    </Button>
                  </div>

                  {/* Progressive Disclosure - Advanced Options */}
                  {showAdvanced && (
                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:space-y-3">
                          <Label
                            htmlFor="access-token"
                            className="flex items-center gap-2 text-sm font-medium"
                          >
                            <Lock className="h-4 w-4 text-primary" />
                            Access Token (Optional)
                          </Label>
                          <Input
                            id="access-token"
                            type="text"
                            placeholder="ghp_xxxxxxxxxxxx"
                            value={accessToken}
                            onChange={(e) => setAccessToken(e.target.value)}
                            className="h-10 sm:h-12 rounded-xl border-border/50 bg-background/50 backdrop-blur-sm text-sm sm:text-base"
                          />
                        </div>
                        <div className="space-y-2 sm:space-y-3">
                          <Label
                            htmlFor="branch"
                            className="text-sm font-medium"
                          >
                            Branch
                          </Label>
                          <Input
                            id="branch"
                            placeholder="main"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="h-10 sm:h-12 rounded-xl border-border/50 bg-background/50 backdrop-blur-sm text-sm sm:text-base"
                          />
                        </div>
                      </div>

                      {/* Info Panel */}
                      <div className="bg-muted/30 backdrop-blur-sm rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-border/30">
                        <div className="flex items-start gap-3">
                          <div className="p-1.5 rounded-full bg-blue-500/10 flex-shrink-0">
                            <Info className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500" />
                          </div>
                          <div className="space-y-1 flex-1 min-w-0">
                            <p className="text-xs sm:text-sm font-medium">
                              Privacy & Security
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Your access token is stored locally and never
                              shared with our servers. No special scopes needed
                              for public repositories.{" "}
                              <a
                                href="https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline hover:no-underline"
                              >
                                How to create a GitHub token
                              </a>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={loading || !repoUrl.trim()}
                    className="w-full h-10 sm:h-12 text-sm sm:text-base rounded-xl bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-[1.02]"
                    size="lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        <span className="hidden xs:inline">
                          Analyze Repository
                        </span>
                        <span className="xs:hidden">Analyze</span>
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>
              </div>
            </div>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent
            value="upload"
            className="animate-in fade-in-50 duration-300"
          >
            <div className="bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl sm:rounded-3xl shadow-sm overflow-hidden">
              {/* Section Header */}
              <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                <div className="flex items-center gap-3">
                  <div className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-primary/10">
                    <Upload className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold tracking-tight">
                      ZIP File Upload
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                      Upload a ZIP file containing your project to analyze its
                      structure
                    </p>
                  </div>
                </div>
              </div>

              {/* Form Content */}
              <div className="p-4 sm:p-8">
                <form
                  onSubmit={handleZipSubmit}
                  className="space-y-4 sm:space-y-6"
                >
                  {/* Drop Zone Header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Upload File</span>
                    <SupportedLanguages languages={SUPPORTED_LANGUAGES} />
                  </div>

                  {/* Drop Zone */}
                  <div
                    className={cn(
                      "relative border-2 border-dashed rounded-xl sm:rounded-2xl p-6 sm:p-12 text-center transition-all duration-300",
                      dragActive
                        ? "border-primary bg-primary/5 scale-[1.02]"
                        : "border-border/50 hover:border-primary/50 hover:bg-muted/20"
                    )}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip"
                      onChange={handleFileInput}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="space-y-3 sm:space-y-4">
                      <div className="mx-auto w-12 h-12 sm:w-16 sm:h-16 bg-primary/10 rounded-xl sm:rounded-2xl flex items-center justify-center">
                        <Upload className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                      </div>
                      <div className="space-y-1 sm:space-y-2">
                        <p className="text-sm sm:text-lg font-medium">
                          {dragActive
                            ? "Drop your ZIP file here"
                            : "Click to browse or drag and drop"}
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          Supports ZIP files up to 100MB
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* File Preview */}
                  {zipFile && (
                    <div className="bg-muted/30 backdrop-blur-sm rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-border/30 animate-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 sm:p-2 bg-green-500/10 rounded-lg sm:rounded-xl flex-shrink-0">
                          <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm sm:text-base truncate">
                            {zipFile.name}
                          </p>
                          <p className="text-xs sm:text-sm text-muted-foreground">
                            {(zipFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Badge className="bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20 text-xs">
                          Ready
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setZipFile(null)}
                          className="h-6 w-6 sm:h-8 sm:w-8 rounded-full hover:bg-muted/50 flex-shrink-0"
                        >
                          <X className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={loading || !zipFile}
                    className="w-full h-10 sm:h-12 text-sm sm:text-base rounded-xl bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-[1.02]"
                    size="lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        <span className="hidden xs:inline">
                          Process ZIP File
                        </span>
                        <span className="xs:hidden">Process</span>
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
