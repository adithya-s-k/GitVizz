"use client"

import type { JSX } from "react"
import { useState, useEffect, useRef } from "react"
import Editor from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { useTheme } from "next-themes"
import {
  Folder,
  File,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  CopyCheck,
  Search,
  Expand,
  MinusCircle,
  FolderOpen,
  X,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { useResultData } from "@/context/ResultDataContext"

interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  content?: string
  children?: FileNode[]
}

interface CodeViewerProps {
  className?: string
}

export function CodeViewer({ className }: CodeViewerProps) {
  // Use repoContent from context
  const { output: repoContent, selectedFilePath, selectedFileLine, setSelectedFilePath } = useResultData()
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>("")
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<"explorer" | "search">("explorer")
  const { theme } = useTheme()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const explorerRef = useRef<HTMLDivElement>(null)

  // Parse repository structure from formatted text
  useEffect(() => {
    if (repoContent) {
      try {
        const tree = parseRepositoryStructure(repoContent)
        setFileTree(tree)
        // Auto-expand first level directories for better UX
        const firstLevelDirs = tree.filter((node) => node.type === "directory").map((node) => node.path)
        setExpandedFolders(new Set(firstLevelDirs))
      } catch (error) {
        console.error("Error parsing repo structure:", error)
      }
    }
  }, [repoContent])

  // Function to handle editor mount
  const handleEditorDidMount = (editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }

  const parseRepositoryStructure = (text: string): FileNode[] => {
    const tree: FileNode[] = []
    const rootMap: Record<string, FileNode> = {}

    // Extract files and their content
    const fileContentSections = text.split("---\nFile:").slice(1)

    // Process each file
    fileContentSections.forEach((section) => {
      const firstNewlineIndex = section.indexOf("\n")
      const filePath = section.substring(0, firstNewlineIndex).trim()
      const content = section.substring(section.indexOf("\n---\n") + 5).trim()

      // Create file hierarchy
      const pathParts = filePath.split("/")
      let currentPath = ""
      let parentPath = ""

      // Create directory nodes
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i]
        parentPath = currentPath
        currentPath = currentPath ? `${currentPath}/${part}` : part

        if (!rootMap[currentPath]) {
          const dirNode: FileNode = {
            name: part,
            path: currentPath,
            type: "directory",
            children: [],
          }
          rootMap[currentPath] = dirNode

          if (parentPath) {
            rootMap[parentPath].children = rootMap[parentPath].children || []
            rootMap[parentPath].children!.push(dirNode)
          } else {
            tree.push(dirNode)
          }
        }
      }

      // Create file node
      const fileName = pathParts[pathParts.length - 1]
      const fileNode: FileNode = {
        name: fileName,
        path: filePath,
        type: "file",
        content: content,
      }

      if (currentPath) {
        rootMap[currentPath].children = rootMap[currentPath].children || []
        rootMap[currentPath].children!.push(fileNode)
      } else {
        tree.push(fileNode)
      }
    })

    return tree
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }

  const expandAllFolders = () => {
    const allPaths = new Set<string>()

    // Recursive function to collect all directory paths
    const collectDirPaths = (nodes: FileNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "directory") {
          allPaths.add(node.path)
          if (node.children) {
            collectDirPaths(node.children)
          }
        }
      })
    }

    collectDirPaths(fileTree)
    setExpandedFolders(allPaths)
  }

  const collapseAllFolders = () => {
    setExpandedFolders(new Set())
  }

  const handleFileSelect = (file: FileNode) => {
    setSelectedFile(file)
  }

  const copyFileContent = (file: FileNode) => {
    if (file.content) {
      navigator.clipboard.writeText(file.content)
      setCopyStatus((prev) => ({ ...prev, [file.path]: true }))
      setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [file.path]: false }))
      }, 2000)
    }
  }

  const copyAllContent = () => {
    const allContent = getAllContent(fileTree)
    navigator.clipboard.writeText(allContent)
    setCopyStatus((prev) => ({ ...prev, all: true }))
    setTimeout(() => {
      setCopyStatus((prev) => ({ ...prev, all: false }))
    }, 2000)
  }

  const getAllContent = (nodes: FileNode[]): string => {
    let content = ""
    nodes.forEach((node) => {
      if (node.type === "file" && node.content) {
        content += `// File: ${node.path}\n${node.content}\n\n`
      } else if (node.type === "directory" && node.children) {
        content += getAllContent(node.children)
      }
    })
    return content
  }

  const copyFolderContent = (folderNode: FileNode) => {
    const folderContent = getFolderContent(folderNode)
    navigator.clipboard.writeText(folderContent)
    setCopyStatus((prev) => ({ ...prev, [folderNode.path]: true }))
    setTimeout(() => {
      setCopyStatus((prev) => ({ ...prev, [folderNode.path]: false }))
    }, 2000)
  }

  const getFolderContent = (folderNode: FileNode): string => {
    let content = `// Folder: ${folderNode.path}\n\n`

    const processNode = (node: FileNode) => {
      if (node.type === "file" && node.content) {
        content += `// File: ${node.path}\n${node.content}\n\n`
      } else if (node.type === "directory" && node.children) {
        node.children.forEach(processNode)
      }
    }

    if (folderNode.children) {
      folderNode.children.forEach(processNode)
    }

    return content
  }

  // Determine language based on file extension
  const getLanguage = (filePath: string): string => {
    const fileExtension = filePath.split(".").pop()?.toLowerCase() || ""
    const languageMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      yml: "yaml",
      yaml: "yaml",
      sh: "shell",
      bash: "shell",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      go: "go",
      rb: "ruby",
      php: "php",
      rust: "rust",
      rs: "rust",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
    }

    return languageMap[fileExtension] || "plaintext"
  }

  // Get file statistics
  const getFileStats = () => {
    let totalFiles = 0
    let totalDirs = 0
    let totalLines = 0

    const countNodes = (nodes: FileNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "file") {
          totalFiles++
          if (node.content) {
            totalLines += node.content.split("\n").length
          }
        } else {
          totalDirs++
          if (node.children) {
            countNodes(node.children)
          }
        }
      })
    }

    countNodes(fileTree)
    return { totalFiles, totalDirs, totalLines }
  }

  // Filter files by search term
  const filterFilesBySearch = (nodes: FileNode[]): FileNode[] => {
    if (!searchTerm) return []

    const results: FileNode[] = []
    const searchLower = searchTerm.toLowerCase()

    const searchNodes = (nodeList: FileNode[]) => {
      nodeList.forEach((node) => {
        if (node.name.toLowerCase().includes(searchLower)) {
          results.push(node)
        }
        if (node.type === "file" && node.content && node.content.toLowerCase().includes(searchLower)) {
          if (!results.includes(node)) {
            results.push(node)
          }
        }
        if (node.type === "directory" && node.children) {
          searchNodes(node.children)
        }
      })
    }

    searchNodes(nodes)
    return results
  }

  // Auto-select file and expand folders when selectedFilePath changes
  useEffect(() => {
    if (!selectedFilePath || !fileTree.length) return

    // Helper to find file node and collect parent paths
    const findFileAndParents = (
      nodes: FileNode[],
      targetPath: string,
      parents: string[] = []
    ): { file: FileNode | null; parentPaths: string[] } => {
      for (const node of nodes) {
        if (node.type === "file" && node.path === targetPath) {
          return { file: node, parentPaths: [...parents] }
        }
        if (node.type === "directory" && node.children) {
          const result = findFileAndParents(node.children, targetPath, [...parents, node.path])
          if (result.file) return result
        }
      }
      return { file: null, parentPaths: [] }
    }

    const { file, parentPaths } = findFileAndParents(fileTree, selectedFilePath)
    if (file) {
      setSelectedFile(file)
      setActiveTab("explorer") // Switch to explorer tab so user sees the file
      setExpandedFolders((prev) => {
        const newSet = new Set(prev)
        parentPaths.forEach((p) => newSet.add(p))
        return newSet
      })
      // Optionally scroll to file in explorer
      setTimeout(() => {
        if (explorerRef.current) {
          const el = explorerRef.current.querySelector(`[data-file-path="${file.path}"]`)
          if (el && "scrollIntoView" in el) {
            (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" })
          }
        }
      }, 100)
      // Clear selectedFilePath to avoid future collision
      setTimeout(() => setSelectedFilePath(null), 200)
    }
  }, [selectedFilePath, fileTree, setSelectedFilePath])

  const renderTree = (nodes: FileNode[], level = 0): JSX.Element[] => {
    return nodes
      .sort((a, b) => {
        // Sort directories first, then files
        if (a.type === "directory" && b.type === "file") return -1
        if (a.type === "file" && b.type === "directory") return 1
        return a.name.localeCompare(b.name)
      })
      .map((node) => {
        const isExpanded = expandedFolders.has(node.path)
        const isSelected = selectedFile?.path === node.path

        if (node.type === "directory") {
          return (
            <div key={node.path}>
              <div
                className={cn(
                  "flex items-center py-2 px-3 cursor-pointer hover:bg-muted/50 rounded-xl group transition-all duration-200",
                  level > 0 && "ml-3",
                )}
                onClick={() => toggleFolder(node.path)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-muted-foreground" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0" />
                )}
                <span className="text-sm font-medium truncate flex-grow">{node.name}</span>
                <div className="flex items-center gap-1">
                  {node.children && (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 rounded-full">
                      {node.children.length}
                    </Badge>
                  )}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-lg hover:bg-background/80"
                            onClick={(e) => {
                              e.stopPropagation()
                              copyFolderContent(node)
                            }}
                            aria-label="Copy folder content"
                          >
                            {copyStatus[node.path] ? (
                              <CopyCheck className="w-3 h-3 text-green-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy Folder Content</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
              {isExpanded && node.children && (
                <div className="ml-2 border-l border-border/30 pl-2 mt-1">{renderTree(node.children, level + 1)}</div>
              )}
            </div>
          )
        } else {
          return (
            <div
              key={node.path}
              className="group"
              data-file-path={node.path}
            >
              <div
                className={cn(
                  "flex items-center py-2 px-3 cursor-pointer hover:bg-muted/50 rounded-xl transition-all duration-200",
                  level > 0 && "ml-3",
                  isSelected && "bg-primary/10 text-primary border border-primary/20",
                )}
                onClick={() => handleFileSelect(node)}
              >
                <File className="w-4 h-4 mr-2 flex-shrink-0 text-muted-foreground" />
                <span className="text-sm truncate flex-grow">{node.name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {node.content && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 rounded-md">
                      {node.content.split("\n").length}L
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-lg hover:bg-background/80"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyFileContent(node)
                    }}
                    aria-label="Copy file content"
                  >
                    {copyStatus[node.path] ? (
                      <CopyCheck className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      })
  }

  const renderSearchResults = () => {
    const results = filterFilesBySearch(fileTree)
    if (results.length === 0) {
      return (
        <div className="p-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
            <Search className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium text-foreground">No results found</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting your search terms</p>
        </div>
      )
    }

    return (
      <div className="space-y-1 p-2">
        {results.map((file) => (
          <div
            key={file.path}
            className="p-3 cursor-pointer hover:bg-muted/50 rounded-xl flex items-center transition-all duration-200 group"
            onClick={() => handleFileSelect(file)}
          >
            {file.type === "file" ? (
              <File className="w-4 h-4 mr-3 text-muted-foreground flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 mr-3 text-blue-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground truncate">{file.path}</p>
            </div>
            {file.type === "file" && file.content && (
              <Badge variant="outline" className="text-xs px-1.5 py-0.5 rounded-md ml-2">
                {file.content.split("\n").length}L
              </Badge>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex h-full bg-background/60 backdrop-blur-xl rounded-2xl overflow-hidden", className)}>
      {/* Enhanced File Explorer Sidebar */}
      <div className="w-80 flex flex-col border-r border-border/30 bg-background/40 backdrop-blur-sm">
        {/* Simplified Tab Navigation */}
        <div className="flex-shrink-0 p-3 border-b border-border/30">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "explorer" | "search")}>
            <TabsList className="grid w-full grid-cols-2 bg-muted/30 backdrop-blur-sm rounded-xl">
              <TabsTrigger
                value="explorer"
                className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Folder className="w-4 h-4 mr-1.5" />
                Explorer
              </TabsTrigger>
              <TabsTrigger
                value="search"
                className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Search className="w-4 h-4 mr-1.5" />
                Search
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "explorer" | "search")}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <TabsContent value="explorer" className="flex-1 flex flex-col overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden">
              {/* Explorer Actions */}
              <div className="flex-shrink-0 p-3 border-b border-border/30 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">PROJECT FILES</span>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={expandAllFolders}>
                          <Expand className="w-3 h-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Expand All</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={collapseAllFolders}>
                          <MinusCircle className="w-3 h-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Collapse All</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={copyAllContent}>
                          {copyStatus.all ? (
                            <CopyCheck className="w-3 h-3 text-green-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy All Content</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              {/* File Tree*/}
              <div className="flex-1 overflow-y-auto overflow-x-hidden" ref={explorerRef}>
                {fileTree.length > 0 ? (
                  <div className="p-2">{renderTree(fileTree)}</div>
                ) : (
                  <div className="p-4 text-center">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                      <FileText className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No files to display</p>
                    <p className="text-xs text-muted-foreground mt-1">Upload a repository to get started</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="search" className="flex-1 flex flex-col overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden">
              {/* Search Input */}
              <div className="flex-shrink-0 p-3 border-b border-border/30">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search files and content..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-muted/50 border border-border/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-lg"
                      onClick={() => setSearchTerm("")}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Search Results - With proper scrolling */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {searchTerm ? (
                  renderSearchResults()
                ) : (
                  <div className="p-4 text-center">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                      <Search className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Search through files</p>
                    <p className="text-xs text-muted-foreground mt-1">Type to search file names and content</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            {/* File Header */}
            <div className="flex-shrink-0 p-4 border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 rounded-lg bg-primary/10 flex-shrink-0">
                    <File className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{selectedFile.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs px-2 py-1 rounded-lg">
                    {getLanguage(selectedFile.path)}
                  </Badge>
                  {selectedFile.content && (
                    <Badge variant="secondary" className="text-xs px-2 py-1 rounded-lg">
                      {selectedFile.content.split("\n").length} lines
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 text-xs rounded-lg"
                    onClick={() => copyFileContent(selectedFile)}
                  >
                    {copyStatus[selectedFile.path] ? (
                      <>
                        <CopyCheck className="w-3 h-3 text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1 bg-background/20 overflow-hidden">
              <Editor
                height="100%"
                language={getLanguage(selectedFile.path)}
                value={selectedFile.content}
                theme={theme === "dark" ? "vs-dark" : "light"}
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  fontSize: 14,
                  lineNumbers: "on",
                  renderLineHighlight: "all",
                  scrollbar: {
                    useShadows: true,
                    verticalHasArrows: true,
                    horizontalHasArrows: true,
                    vertical: "visible",
                    horizontal: "visible",
                  },
                  padding: { top: 16, bottom: 16 },
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  renderWhitespace: "selection",
                }}
                onMount={handleEditorDidMount}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-4 p-8">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center">
                <Code className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium text-foreground">Select a file to view</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Choose a file from the explorer to view its contents with syntax highlighting
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
