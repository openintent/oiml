export interface UpdateStatus {
  status: "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  version?: string;
  releaseNotes?: string;
  progress?: number;
  speed?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface ElectronAPI {
  selectFolder: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  readDirectory: (dirPath: string) => Promise<{
    success: boolean;
    entries?: Array<{ name: string; isDirectory: boolean; path: string }>;
    error?: string;
  }>;
  fileExists: (filePath: string) => Promise<boolean>;
  resolvePackagePath: (packagePath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveSelectedFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  loadSelectedFolder: () => Promise<string | null>;
  getRecentProjects: () => Promise<{ success: boolean; projects?: string[]; error?: string }>;
  addRecentProject: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  clearRecentProjects: () => Promise<{ success: boolean; error?: string }>;
  runCommand: (
    command: string,
    cwd: string
  ) => Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  mkdir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  rmdir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  watchFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  stopWatching: () => Promise<{ success: boolean; error?: string }>;
  onFileChanged: (callback: (data: { event: string; path: string; folderPath: string }) => void) => (() => void) | void;
  removeFileChangedListener: () => void;
  fetchLinearIssue: (issueId: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  saveLinearAccessToken: (token: string) => Promise<{ success: boolean; error?: string }>;
  getLinearAccessToken: () => Promise<{ success: boolean; token?: string | null; error?: string }>;
  saveOpenAIApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  getOpenAIApiKey: () => Promise<{ success: boolean; apiKey?: string | null; error?: string }>;
  callOpenAI: (
    messages: Array<{ role: string; content: string }>,
    model?: string
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  ipcRenderer?: {
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) => () => void;
    removeListener: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
