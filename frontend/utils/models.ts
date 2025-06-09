// for managing file uploads
export interface GitHubSourceData {
  repo_url: string;
  access_token?: string;
  branch?: string;
}

export type SourceData = GitHubSourceData | File | null;
export type SourceType = "github" | "zip" | null;

// for managing the state of the result data context
export interface State {
  output: string | null;
  outputMessage: string | null;
  sourceType: SourceType;
  sourceData: SourceData;
  loading: boolean;
  error: string | null;
}