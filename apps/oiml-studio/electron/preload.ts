const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the APIs without exposing the entire Node.js API
contextBridge.exposeInMainWorld('electronAPI', {
  // File system
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  fileExists: (filePath: string) => ipcRenderer.invoke('file-exists', filePath),
  resolvePackagePath: (packagePath: string) => ipcRenderer.invoke('resolve-package-path', packagePath),
  // Persistent storage
  saveSelectedFolder: (folderPath: string) => ipcRenderer.invoke('save-selected-folder', folderPath),
  loadSelectedFolder: () => ipcRenderer.invoke('load-selected-folder'),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addRecentProject: (folderPath: string) => ipcRenderer.invoke('add-recent-project', folderPath),
  clearRecentProjects: () => ipcRenderer.invoke('clear-recent-projects'),
  runCommand: (command: string, cwd: string) => ipcRenderer.invoke('run-command', command, cwd),
  // File operations
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  mkdir: (dirPath: string) => ipcRenderer.invoke('mkdir', dirPath),
  rmdir: (dirPath: string) => ipcRenderer.invoke('rmdir', dirPath),
  // File watching
  watchFolder: (folderPath: string) => ipcRenderer.invoke('watch-folder', folderPath),
  stopWatching: () => ipcRenderer.invoke('stop-watching'),
  onFileChanged: (callback: (data: { event: string; path: string; folderPath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { event: string; path: string; folderPath: string }) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[Preload] Error in callback:`, error);
      }
    };
    ipcRenderer.on('file-changed', handler);
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('file-changed', handler);
    };
  },
  removeFileChangedListener: () => {
    ipcRenderer.removeAllListeners('file-changed');
  },
  fetchLinearIssue: (issueId: string) => ipcRenderer.invoke('fetch-linear-issue', issueId),
  // Linear access token management
  saveLinearAccessToken: (token: string) => ipcRenderer.invoke('save-linear-access-token', token),
  getLinearAccessToken: () => ipcRenderer.invoke('get-linear-access-token'),
  // OpenAI API key management
  saveOpenAIApiKey: (apiKey: string) => ipcRenderer.invoke('save-openai-api-key', apiKey),
  getOpenAIApiKey: () => ipcRenderer.invoke('get-openai-api-key'),
  callOpenAI: (messages: Array<{ role: string; content: string }>, model?: string) => ipcRenderer.invoke('call-openai', messages, model),
  // Update handling
  ipcRenderer: {
    send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
      ipcRenderer.on(channel, callback);
      return () => ipcRenderer.removeListener(channel, callback);
    },
    removeListener: (channel: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
      ipcRenderer.removeListener(channel, callback);
    },
  },
});

