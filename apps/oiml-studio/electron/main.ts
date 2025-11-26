// Check for LINEAR_ACCESS_TOKEN in system environment variables
// This reads from the user's local machine environment (shell, system settings, etc.)

const { join } = require('path');
const { existsSync } = require('fs');

// Calculate app root - main.js is at apps/oiml-studio/electron/main.js
// So __dirname = apps/oiml-studio/electron, go up one level
const appRoot = join(__dirname, '..'); // apps/oiml-studio

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { readFile, readdir, writeFile, mkdir, rm } = require('fs/promises');
const { spawn, fork, execSync } = require('child_process');
const chokidar = require('chokidar');
const https = require('https');
const http = require('http');
const { readdirSync, statSync } = require('fs');
import Store from 'electron-store';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { update } from './update.js';
import { LinearClient } from '@linear/sdk';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Next.js server process for production
let nextServerProcess: any = null;
const NEXT_PORT = 3000;

// Helper function to kill any process using port 3000
function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      // Windows: Find and kill process using the port
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const lines = result.split('\n').filter((line: string) => line.includes('LISTENING'));
      lines.forEach((line: string) => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } catch (e) {
            // Process might already be dead, ignore
          }
        }
      });
    } else {
      // macOS/Linux: Find and kill process using the port
      const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' });
      const pids = result.trim().split('\n').filter((pid: string) => pid);
      pids.forEach((pid: string) => {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch (e) {
          // Process might already be dead, ignore
        }
      });
    }
  } catch (e) {
    // No process found on port, which is fine
  }
}

// Helper function to cleanup Next.js server process
function cleanupNextServer(): void {
  if (nextServerProcess) {
    try {
      // Try graceful shutdown first
      nextServerProcess.kill('SIGTERM');
      
      // Force kill after 2 seconds if still running
      setTimeout(() => {
        if (nextServerProcess && !nextServerProcess.killed) {
          nextServerProcess.kill('SIGKILL');
        }
      }, 2000);
    } catch (error) {
      console.error('[Electron] Error killing Next.js server:', error);
    }
    nextServerProcess = null;
  }
}

// Helper function to recursively find server.js
function findServerFile(dir: string, maxDepth: number = 5, currentDepth: number = 0): string | null {
  if (currentDepth >= maxDepth) return null;
  
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === 'server.js') {
          return fullPath;
        } else if (stat.isDirectory() && entry !== 'node_modules' && !entry.startsWith('.')) {
          const found = findServerFile(fullPath, maxDepth, currentDepth + 1);
          if (found) return found;
        }
      } catch {
        // Skip entries we can't access
        continue;
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return null;
}

// Initialize electron-store
const store = new Store<{ selectedFolder: string; recentProjects: string[]; linearAccessToken?: string; openaiApiKey?: string }>({
  name: 'oiml-builder-config',
  defaults: {
    selectedFolder: '',
    recentProjects: [],
    linearAccessToken: undefined,
    openaiApiKey: undefined,
  },
});

let mainWindow: BrowserWindowType | null = null;
let splashWindow: BrowserWindowType | null = null;
let fileWatcher: ReturnType<typeof chokidar.watch> | null = null;

// Helper function to wait for port to be available
function waitForPortAvailable(port: number, maxWaitMs: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkPort = () => {
      try {
        // Try to find processes using the port
        if (process.platform === 'win32') {
          const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' });
          if (result.trim().length === 0) {
            resolve();
            return;
          }
        } else {
          const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: 'pipe' });
          if (result.trim().length === 0) {
            resolve();
            return;
          }
        }
        
        // Port still in use, check if we've exceeded max wait time
        if (Date.now() - startTime >= maxWaitMs) {
          resolve(); // Proceed anyway, the server might handle it
          return;
        }
        
        // Check again in 200ms
        setTimeout(checkPort, 200);
      } catch (e) {
        // No process found on port, which means it's available
        resolve();
      }
    };
    checkPort();
  });
}

// Start Next.js standalone server in production
async function startNextServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up any existing server process first
    cleanupNextServer();
    
    // Kill any process using port 3000 before starting
    killProcessOnPort(NEXT_PORT);
    
    // Wait for port to be released, then start the server
    waitForPortAvailable(NEXT_PORT, 3000).then(() => {
      setTimeout(() => {
      // Find the standalone server
      // Next.js standalone preserves the workspace structure, so server.js is nested
      let serverFile: string | null = null;
    
    if (isDev) {
      // In development, try to find server.js in the standalone directory
      const devStandalone = join(appRoot, '.next', 'standalone');
      // Search for server.js recursively
      const possibleDevPaths = [
        join(devStandalone, 'server.js'),
        join(devStandalone, 'apps', 'oiml-studio', 'server.js'),
        join(devStandalone, 'Developer', 'oiml', 'apps', 'oiml-studio', 'server.js'),
      ];
      serverFile = possibleDevPaths.find(p => existsSync(p)) || possibleDevPaths[0];
    } else {
      // In packaged app, .next/standalone is in extraResources (outside app.asar)
      // so it's accessible at process.resourcesPath/.next/standalone
      const basePath = process.resourcesPath;
      
      if (!basePath) {
        const errorMsg = `process.resourcesPath is undefined. This might indicate a packaging issue.`;
        console.error('[Electron]', errorMsg);
        console.error('[Electron] __dirname:', __dirname);
        console.error('[Electron] app.getAppPath():', app.getAppPath());
        reject(new Error(errorMsg));
        return;
      }
      
      const standaloneDir = join(basePath, '.next', 'standalone');
      
      // First check if standalone directory exists
      if (!existsSync(standaloneDir)) {
        const errorMsg = `Standalone directory not found at: ${standaloneDir}\n\nMake sure you've built the app with 'output: standalone' in next.config.ts`;
        console.error('[Electron]', errorMsg);
        console.error('[Electron] Base path:', basePath);
        console.error('[Electron] Checking if .next exists:', existsSync(join(basePath, '.next')));
        if (existsSync(join(basePath, '.next'))) {
          try {
            const { readdirSync } = require('fs');
            const nextContents = readdirSync(join(basePath, '.next'));
            console.error('[Electron] Contents of .next directory:', nextContents);
          } catch (e) {
            console.error('[Electron] Error reading .next directory:', e);
          }
        }
        reject(new Error(errorMsg));
        return;
      }
      
      // Try common paths first
      const possiblePaths = [
        join(standaloneDir, 'server.js'),
        join(standaloneDir, 'apps', 'oiml-studio', 'server.js'),
        join(standaloneDir, 'Developer', 'oiml', 'apps', 'oiml-studio', 'server.js'),
      ];
      
      // Try exact paths first
      serverFile = possiblePaths.find(p => existsSync(p)) || null;
      
      // If not found, recursively search the standalone directory
      if (!serverFile) {
        serverFile = findServerFile(standaloneDir);
      }
      
      // If still not found, provide helpful error
      if (!serverFile) {
        const searchedPaths = [
          ...possiblePaths,
          '(recursive search in standalone directory)'
        ];
        const errorMsg = `Next.js server not found. Searched paths:\n${searchedPaths.map(p => `  - ${p}`).join('\n')}\n\nMake sure you've built the app with 'output: standalone' in next.config.ts`;
        console.error('[Electron]', errorMsg);
        console.error('[Electron] Standalone directory exists:', existsSync(standaloneDir));
        if (existsSync(standaloneDir)) {
          try {
            const { readdirSync } = require('fs');
            const contents = readdirSync(standaloneDir);
            console.error('[Electron] Contents of standalone directory:', contents.slice(0, 10));
          } catch (e) {
            console.error('[Electron] Error reading standalone directory:', e);
          }
        }
        reject(new Error(errorMsg));
        return;
      }
    }
    
    const standalonePath = serverFile ? join(serverFile, '..') : '';
    
    if (!serverFile || !existsSync(serverFile)) {
      const searchedPaths = isDev 
        ? [
            join(appRoot, '.next', 'standalone', 'server.js'),
            join(appRoot, '.next', 'standalone', 'apps', 'oiml-studio', 'server.js'),
            join(appRoot, '.next', 'standalone', 'Developer', 'oiml', 'apps', 'oiml-studio', 'server.js'),
          ]
        : [
            join(process.resourcesPath || '', '.next', 'standalone', 'server.js'),
            join(process.resourcesPath || '', '.next', 'standalone', 'apps', 'oiml-studio', 'server.js'),
            join(process.resourcesPath || '', '.next', 'standalone', 'Developer', 'oiml', 'apps', 'oiml-studio', 'server.js'),
          ];
      
      const errorMsg = `Next.js server not found. Searched paths:\n${searchedPaths.map(p => `  - ${p}`).join('\n')}\n\nMake sure you've built the app with 'output: standalone' in next.config.ts`;
      console.error('[Electron]', errorMsg);
      console.error('[Electron] process.resourcesPath:', process.resourcesPath);
      console.error('[Electron] __dirname:', __dirname);
      reject(new Error(errorMsg));
      return;
    }
    
    // Set PORT environment variable
    process.env.PORT = String(NEXT_PORT);
    
    // Start the server
    const serverDir = serverFile ? join(serverFile, '..') : '';
    
    // Find node_modules directory in standalone structure
    // Next.js standalone puts node_modules at the standalone root
    let nodeModulesPath: string | null = null;
    if (!isDev) {
      // In packaged app, node_modules is at process.resourcesPath/.next/standalone/Developer/oiml/node_modules
      // (pnpm structure preserves workspace layout)
      const possibleNodeModulesPaths = [
        join(process.resourcesPath, '.next', 'standalone', 'Developer', 'oiml', 'node_modules'),
        join(process.resourcesPath, '.next', 'standalone', 'node_modules'),
        join(serverDir, '..', '..', '..', 'node_modules'), // From apps/oiml-studio/server.js -> ../../node_modules
        join(serverDir, '..', '..', 'node_modules'),
        join(serverDir, '..', 'node_modules'),
      ];
      
      for (const path of possibleNodeModulesPaths) {
        if (existsSync(path)) {
          nodeModulesPath = path;
          break;
        }
      }
      
      if (!nodeModulesPath) {
        console.error('[Electron] Could not find node_modules! Searched paths:');
        possibleNodeModulesPaths.forEach(p => {
          console.error(`  - ${p} (exists: ${existsSync(p)})`);
        });
      }
    } else {
      // In dev, use the app root node_modules
      nodeModulesPath = join(appRoot, 'node_modules');
    }
    
    // Build NODE_PATH to include node_modules and pnpm structure
    const nodePathParts: string[] = [];
    if (nodeModulesPath && existsSync(nodeModulesPath)) {
      nodePathParts.push(nodeModulesPath);
      // Also add parent directory for pnpm's .pnpm structure
      const parentDir = join(nodeModulesPath, '..');
      if (existsSync(parentDir)) {
        nodePathParts.push(parentDir);
      }
    }
    // Always include serverDir for relative requires
    if (serverDir) {
      nodePathParts.push(serverDir);
    }
    // Also include the standalone root directory
    if (!isDev && process.resourcesPath) {
      const standaloneRoot = join(process.resourcesPath, '.next', 'standalone');
      if (existsSync(standaloneRoot)) {
        nodePathParts.push(standaloneRoot);
      }
    }
    
    const nodePath = nodePathParts.join(process.platform === 'win32' ? ';' : ':');
    
    // Next.js standalone expects .next/static to be relative to the server directory
    // Create a symlink if needed (for packaged apps)
    if (!isDev) {
      const staticSource = join(process.resourcesPath, '.next', 'static');
      const staticTarget = join(serverDir, '.next', 'static');
      const staticTargetDir = join(serverDir, '.next');
      
      if (existsSync(staticSource) && !existsSync(staticTarget)) {
        try {
          // Ensure .next directory exists in server directory
          const { mkdirSync } = require('fs');
          if (!existsSync(staticTargetDir)) {
            mkdirSync(staticTargetDir, { recursive: true });
          }
          // Create symlink
          const { symlinkSync } = require('fs');
          symlinkSync(staticSource, staticTarget, 'dir');
        } catch (error: any) {
          console.warn('[Electron] Could not create symlink for static files:', error.message);
          // Continue anyway - Next.js might find it another way
        }
      }
      
      // Next.js standalone expects public folder to be relative to the server directory
      // Create a symlink for public folder if needed (for packaged apps)
      const publicSource = join(process.resourcesPath, 'public');
      const publicTarget = join(serverDir, 'public');
      
      if (existsSync(publicSource) && !existsSync(publicTarget)) {
        try {
          const { symlinkSync } = require('fs');
          symlinkSync(publicSource, publicTarget, 'dir');
        } catch (error: any) {
          console.warn('[Electron] Could not create symlink for public folder:', error.message);
          // Try copying instead if symlink fails
          try {
            const { cpSync } = require('fs');
            cpSync(publicSource, publicTarget, { recursive: true });
          } catch (copyError: any) {
            console.warn('[Electron] Could not copy public folder:', copyError.message);
          }
        }
      }
    }
    
    // Use fork instead of spawn - fork uses the same Node.js runtime as Electron
    // This avoids the ENOENT error when 'node' is not in PATH
    // fork automatically uses Electron's bundled Node.js
    // Capture stdout/stderr to see what's failing, but use 'pipe' instead of 'inherit' to avoid EPIPE
    let serverOutput = '';
    let serverError = '';
    
    const serverEnv: Record<string, string> = {
      ...process.env,
      PORT: String(NEXT_PORT),
      NODE_ENV: 'production',
    };
    
    // Set NODE_PATH to help Node.js find modules in the standalone structure
    if (nodePath) {
      serverEnv.NODE_PATH = nodePath;
    }
    
    nextServerProcess = fork(serverFile, [], {
      cwd: serverDir,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // Capture stdout/stderr, ignore stdin, keep IPC
      detached: false,
    });
    
    // Capture stdout
    if (nextServerProcess.stdout) {
      nextServerProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        serverOutput += output;
      });
    }
    
    // Capture stderr
    if (nextServerProcess.stderr) {
      nextServerProcess.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        serverError += output;
        console.error('[Next.js Server Error]', output.trim());
      });
    }
    
    // Handle process errors gracefully
    nextServerProcess.on('error', (error: Error) => {
      console.error('[Electron] Failed to start Next.js server:', error);
      console.error('[Electron] Server output:', serverOutput);
      console.error('[Electron] Server error:', serverError);
      reject(new Error(`Failed to start Next.js server: ${error.message}\n\nServer output:\n${serverOutput}\n\nServer error:\n${serverError}`));
    });
    
    nextServerProcess.on('exit', (code: number | null, signal: string | null) => {
      if (code !== null && code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
        const errorMsg = `Next.js server exited with code ${code}${signal ? `, signal ${signal}` : ''}`;
        console.error(`[Electron] ${errorMsg}`);
        console.error('[Electron] Server output:', serverOutput);
        console.error('[Electron] Server error:', serverError);
        reject(new Error(`${errorMsg}\n\nServer output:\n${serverOutput}\n\nServer error:\n${serverError}`));
      }
    });
    
    // Wait for server to be ready with timeout
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds max (60 * 500ms)
    let resolved = false;
    
    const checkServer = () => {
      if (resolved) return; // Don't check again if already resolved
      
      attempts++;
      const req = http.get(`http://localhost:${NEXT_PORT}`, (res: any) => {
        if (resolved) return;
        resolved = true;
        resolve();
      });
      
      req.on('error', (err: any) => {
        if (resolved) return;
        
        if (attempts >= maxAttempts) {
          console.error('[Electron] Timeout waiting for Next.js server');
          reject(new Error(`Next.js server did not start within ${maxAttempts * 500}ms`));
          return;
        }
        // Server not ready yet, check again
        setTimeout(checkServer, 500);
      });
      
      req.on('timeout', () => {
        req.destroy();
        if (resolved) return;
        
        if (attempts >= maxAttempts) {
          console.error('[Electron] Timeout waiting for Next.js server');
          reject(new Error(`Next.js server did not start within ${maxAttempts * 500}ms`));
          return;
        }
        setTimeout(checkServer, 500);
      });
      
      req.setTimeout(1000);
    };
    
    // Start checking after a short delay
    setTimeout(checkServer, 1000);
      }, 500); // Wait 500ms before starting server after port is available
    });
  });
}

// Create splash/loading window
function createSplashWindow() {
  const loadingHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>OIML Studio</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: #0a0a0a;
            color: #ffffff;
            overflow: hidden;
          }
          .loading-container {
            text-align: center;
            padding: 2rem;
          }
          .logo-image {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            display: block;
          }
          .logo-text {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            color: #ffffff;
            letter-spacing: -0.02em;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: #ffffff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 1rem;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .message {
            font-size: 0.875rem;
            color: rgba(255, 255, 255, 0.6);
            margin-top: 0.5rem;
            font-weight: 400;
          }
        </style>
      </head>
      <body>
        <div class="loading-container">
          <svg class="logo-image" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="256" cy="256" r="50" fill="white"/>
            <circle cx="256" cy="140" r="32" fill="white"/>
            <line x1="256" y1="206" x2="256" y2="172" stroke="white" stroke-width="16" stroke-linecap="round"/>
            <circle cx="356" cy="190" r="32" fill="white"/>
            <line x1="296" y1="226" x2="324" y2="206" stroke="white" stroke-width="16" stroke-linecap="round"/>
            <circle cx="356" cy="322" r="32" fill="white"/>
            <line x1="296" y1="286" x2="324" y2="306" stroke="white" stroke-width="16" stroke-linecap="round"/>
            <circle cx="256" cy="372" r="32" fill="white"/>
            <line x1="256" y1="306" x2="256" y2="340" stroke="white" stroke-width="16" stroke-linecap="round"/>
            <circle cx="156" cy="322" r="32" fill="white"/>
            <line x1="216" y1="286" x2="188" y2="306" stroke="white" stroke-width="16" stroke-linecap="round"/>
            <circle cx="156" cy="190" r="32" fill="white"/>
            <line x1="216" y1="226" x2="188" y2="206" stroke="white" stroke-width="16" stroke-linecap="round"/>
          </svg>
          <div class="logo-text">OIML Studio</div>
          <div class="spinner"></div>
        </div>
      </body>
    </html>
  `;

  try {
    splashWindow = new BrowserWindow({
      width: 400,
      height: 400,
      frame: false,
      transparent: false,
      backgroundColor: '#0a0a0a',
      center: true,
      resizable: false,
      alwaysOnTop: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      }
    });

    if (splashWindow) {
      splashWindow.loadURL(`data:text/html,${encodeURIComponent(loadingHtml)}`);
      splashWindow.once('ready-to-show', () => {
        if (splashWindow) {
          splashWindow.show();
        }
      });
    }
  } catch (error) {
    console.error('[Electron] Error creating splash window:', error);
  }
}

function createWindow() {
  // In production, electron-builder packages electron/**/* files together
  // so preload.js is in the same directory as main.js (accessible via __dirname)
  const preloadPath = join(__dirname, 'preload.js');

  try {
    mainWindow = new BrowserWindow({
      width: 1350,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      titleBarStyle: 'hidden',
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: existsSync(preloadPath) ? preloadPath : undefined,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        enableRemoteModule: false,
      }
    });
    
    if (!mainWindow) {
      console.error('[Electron] Failed to create window');
      return;
    }
  } catch (error) {
    console.error('[Electron] Error creating window:', error);
    return;
  }
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      // Close splash window once main window is ready
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
    }
  });

  if (!mainWindow) {
    console.error('[Electron] Failed to create window');
    return;
  }

  // Log errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] Failed to load:', {
      errorCode,
      errorDescription,
      validatedURL,
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      const errorHtml = `
        <html>
          <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
            <h1 style="color: #ef4444;">Load Error</h1>
            <p><strong>URL:</strong> ${validatedURL}</p>
            <p><strong>Error:</strong> ${errorDescription} (${errorCode})</p>
            <p style="color: rgba(255, 255, 255, 0.6);">Check the DevTools console and terminal for more details.</p>
          </body>
        </html>
      `;
      mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event: any, details: any) => {
    console.error('[Electron] Render process gone:', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Electron] Window unresponsive');
  });

  // Handle external links - open in larger window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only handle external URLs (not localhost)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const externalWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
        }
      });
      externalWindow.loadURL(url);
      return { action: 'deny' }; // Prevent default behavior, we handle it ourselves
    }
    return { action: 'allow' }; // Allow local windows
  });

  if (!mainWindow) {
    return;
  }

  if (isDev) {
    // In development, connect to Next.js dev server
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL('http://localhost:3000').catch((err) => {
          console.error('[Electron] Error loading dev URL:', err);
        });
      }
    }, 500);
  } else {
    // In production, start Next.js server and wait for it
    startNextServer()
      .then(() => {
        const url = `http://localhost:${NEXT_PORT}`;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(url).catch((error) => {
            console.error('[Electron] Error loading URL:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
              const errorHtml = `
                <html>
                  <head><title>Error</title></head>
                  <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
                    <h1 style="color: #ef4444;">Error Loading Page</h1>
                    <p><strong>Message:</strong> ${error.message}</p>
                    <p style="margin-top: 20px; color: rgba(255, 255, 255, 0.6);">Check the terminal/console for more details.</p>
                  </body>
                </html>
              `;
              mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
            }
          });
        }
      })
      .catch((error) => {
        console.error('[Electron] Failed to start Next.js server:', error);
        // Close splash and show error in main window
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          const errorHtml = `
            <html>
              <head><title>Error</title></head>
              <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
                <h1 style="color: #ef4444;">Error Starting Server</h1>
                <p><strong>Message:</strong> ${error.message}</p>
                <p style="margin-top: 20px; color: rgba(255, 255, 255, 0.6); white-space: pre-wrap;">Check the terminal/console for more details.</p>
                <p style="margin-top: 20px; font-size: 12px; color: rgba(255, 255, 255, 0.4);">If you're seeing this, the app was launched by double-clicking. Try running the app from terminal using scripts/run-packaged.sh to see detailed logs.</p>
              </body>
            </html>
          `;
          mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`).catch((err) => {
            console.error('[Electron] Error loading error page:', err);
          });
        }
      });
  }

  mainWindow.on('closed', () => {
    // Stop watching when window closes
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }
    
    // Cleanup server process when window closes
    cleanupNextServer();
    
    // Also kill any process on port 3000 to ensure it's released
    killProcessOnPort(NEXT_PORT);
    
    mainWindow = null;
  });
}

// IPC handlers - Register these before app.whenReady()
ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      properties: ['openDirectory'],
    });
    return result;
  } catch (error) {
    console.error('Error in select-folder handler:', error);
    return { canceled: true, filePaths: [] };
  }
});

ipcMain.handle('read-file', async (_event: unknown, filePath: string) => {
  try {
    const content = await readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('read-directory', async (_event: unknown, dirPath: string) => {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return {
      success: true,
      entries: entries.map((entry: { name: string; isDirectory: () => boolean }) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: join(dirPath, entry.name),
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('file-exists', async (_event: unknown, filePath: string) => {
  return existsSync(filePath);
});

ipcMain.handle('resolve-package-path', async (_event: unknown, packagePath: string) => {
  try {
    // Use require.resolve to resolve the package path to actual file system path
    const resolvedPath = require.resolve(packagePath);
    return { success: true, path: resolvedPath };
  } catch (error) {
    console.error('Error resolving package path:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('save-selected-folder', async (_event: unknown, folderPath: string) => {
  try {
    (store as any).set('selectedFolder', folderPath);
    return { success: true };
  } catch (error) {
    console.error('Error saving selected folder:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('load-selected-folder', async () => {
  try {
    const savedFolder = (store as any).get('selectedFolder', '') as string;
    return savedFolder || null;
  } catch (error) {
    console.error('Error loading selected folder:', error);
    return null;
  }
});

ipcMain.handle('get-recent-projects', async () => {
  try {
    const recentProjects = (store as any).get('recentProjects', []) as string[];
    return { success: true, projects: recentProjects };
  } catch (error) {
    console.error('Error loading recent projects:', error);
    return { success: false, error: (error as Error).message, projects: [] };
  }
});

ipcMain.handle('add-recent-project', async (_event: unknown, folderPath: string) => {
  try {
    const recentProjects = (store as any).get('recentProjects', []) as string[];
    // Remove if already exists and add to front
    const filtered = recentProjects.filter((p: string) => p !== folderPath);
    const updated = [folderPath, ...filtered].slice(0, 5); // Keep max 5 recent projects
    (store as any).set('recentProjects', updated);
    return { success: true };
  } catch (error) {
    console.error('Error adding recent project:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('clear-recent-projects', async () => {
  try {
    (store as any).set('recentProjects', []);
    return { success: true };
  } catch (error) {
    console.error('Error clearing recent projects:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('run-command', async (_event: unknown, command: string, cwd: string) => {
  try {
    return new Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>((resolve) => {
      const childProcess = spawn(command, [], {
        shell: true,
        cwd: cwd,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          resolve({ success: false, error: stderr || `Command exited with code ${code}`, stdout, stderr });
        }
      });

      childProcess.on('error', (error: Error) => {
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('Error running command:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('write-file', async (_event: unknown, filePath: string, content: string) => {
  try {
    await writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('mkdir', async (_event: unknown, dirPath: string) => {
  try {
    await mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rmdir', async (_event: unknown, dirPath: string) => {
  try {
    await rm(dirPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// File watching handlers
ipcMain.handle('watch-folder', async (_event: unknown, folderPath: string) => {
  try {
    // Stop existing watcher if any
    if (fileWatcher) {
      await fileWatcher.close();
      fileWatcher = null;
    }

    if (!folderPath) {
      return { success: true };
    }

    const intentsPath = join(folderPath, '.oiml', 'intents');
    
    // Check if intents directory exists
    if (!existsSync(intentsPath)) {
      return { success: true }; // No error, just nothing to watch
    }
    
    // Create watcher for the intents directory (recursive to watch subdirectories)
    // Watch the directory and filter for YAML files in the event handler
    // Use polling on macOS as a fallback since native watching can be unreliable
    const usePolling = process.platform === 'darwin'; // macOS
    
    // Try watching with a glob pattern for YAML files specifically
    // This might work better than watching the directory
    const yamlPattern = join(intentsPath, '**', '*.yaml');
    
    fileWatcher = chokidar.watch([yamlPattern, join(intentsPath, '**', '*.yml')], {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false, // Track existing files so we can verify watcher is working
      usePolling: true, // Force polling on macOS
      interval: 500, // Poll every 500ms
      binaryInterval: 500,
      // Remove awaitWriteFinish to see changes immediately
      // awaitWriteFinish: {
      //   stabilityThreshold: 200,
      //   pollInterval: 50
      // }
    });

    // Handle file changes specifically - this is the main handler
    fileWatcher.on('change', (path: string, stats?: any) => {
      // Only watch for changes to YAML files
      if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        // Send event to renderer process
        if (mainWindow && !mainWindow.isDestroyed()) {
          const eventData = {
            event: 'change',
            path,
            folderPath
          };
          try {
            mainWindow.webContents.send('file-changed', eventData);
          } catch (err) {
            console.error(`[File Watcher] Error sending event:`, err);
          }
        }
      }
    });

    fileWatcher.on('ready', () => {
      // Test polling by manually checking a file's mtime periodically
      let lastMtimes: Map<string, number> = new Map();
      const testPolling = setInterval(() => {
        try {
          const fs = require('fs');
          const path = require('path');
          const files = fs.readdirSync(intentsPath, { withFileTypes: true, recursive: true });
          files.forEach((file: any) => {
            if (file.isFile() && (file.name.endsWith('.yaml') || file.name.endsWith('.yml'))) {
              const fullPath = path.join(file.path || intentsPath, file.name);
              try {
                const stats = fs.statSync(fullPath);
                const currentMtime = stats.mtimeMs;
                const lastMtime = lastMtimes.get(fullPath);
                if (lastMtime && currentMtime !== lastMtime) {
                  // Manually trigger the change handler
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('file-changed', {
                      event: 'change',
                      path: fullPath,
                      folderPath
                    });
                  }
                }
                lastMtimes.set(fullPath, currentMtime);
              } catch (e) {
                // Ignore errors
              }
            }
          });
        } catch (e) {
          // Ignore errors
        }
      }, 1000); // Check every second
      
      // Store interval so we can clear it later
      (fileWatcher as any)._manualPollingInterval = testPolling;
    });

    fileWatcher.on('add', (path: string) => {
      // File added
    });

    fileWatcher.on('unlink', (path: string) => {
      // File removed
    });

    fileWatcher.on('error', (error: Error) => {
      console.error(`[File Watcher] ✗ Watcher error:`, error);
    });

    fileWatcher.on('error', (error: Error) => {
      console.error('File watcher error:', error);
    });

    return { success: true };
  } catch (error) {
    console.error('Error setting up file watcher:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('stop-watching', async () => {
  try {
    if (fileWatcher) {
      // Clear manual polling interval if it exists
      if ((fileWatcher as any)._manualPollingInterval) {
        clearInterval((fileWatcher as any)._manualPollingInterval);
      }
      await fileWatcher.close();
      fileWatcher = null;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Helper function to get Linear access token from env or store
function getLinearAccessToken(): string | null {
  // First, try system environment variable
  if (process.env.LINEAR_ACCESS_TOKEN) {
    return process.env.LINEAR_ACCESS_TOKEN;
  }
  // Fallback to Electron Store
  const storedToken = (store as any).get('linearAccessToken') as string | undefined;
  if (storedToken) {
    return storedToken;
  }
  return null;
}

// Helper function to get OpenAI API key from env or store
function getOpenAIApiKey(): string | null {
  // First, try system environment variable
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  // Fallback to Electron Store
  const storedKey = (store as any).get('openaiApiKey') as string | undefined;
  // Only return if key exists and is not undefined/null/empty string
  if (storedKey && storedKey.trim() !== '') {
    return storedKey;
  }
  return null;
}

// IPC handlers for Linear access token management
ipcMain.handle('save-linear-access-token', async (_event: unknown, token: string) => {
  try {
    if (token === '') {
      // Delete the key from store if empty string is provided
      (store as any).delete('linearAccessToken');
    } else {
      (store as any).set('linearAccessToken', token);
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving Linear access token:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-linear-access-token', async () => {
  try {
    // Only return the stored value, not environment variables
    // This is for UI display - env vars will still be used for API calls
    const storedToken = (store as any).get('linearAccessToken') as string | undefined;
    // Only return if token exists and is not empty
    if (storedToken && storedToken.trim() !== '') {
      return { success: true, token: storedToken };
    }
    return { success: true, token: null };
  } catch (error) {
    console.error('Error getting Linear access token:', error);
    return { success: false, error: (error as Error).message };
  }
});

// IPC handlers for OpenAI API key management
ipcMain.handle('save-openai-api-key', async (_event: unknown, apiKey: string) => {
  try {
    if (apiKey === '') {
      // Delete the key from store if empty string is provided
      (store as any).delete('openaiApiKey');
    } else {
      (store as any).set('openaiApiKey', apiKey);
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving OpenAI API key:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-openai-api-key', async () => {
  try {
    // Only return the stored value, not environment variables
    // This is for UI display - env vars will still be used for API calls
    const storedKey = (store as any).get('openaiApiKey') as string | undefined;
    // Only return if key exists and is not empty
    if (storedKey && storedKey.trim() !== '') {
      return { success: true, apiKey: storedKey };
    }
    return { success: true, apiKey: null };
  } catch (error) {
    console.error('Error getting OpenAI API key:', error);
    return { success: false, error: (error as Error).message };
  }
});

// Function to parse acceptance criteria from description (same as Linear package)
function parseAcceptanceCriteria(description: string | null): string[] {
  if (!description) return [];

  const lines = description.split('\n');
  const acceptanceCriteria: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Check for various list formats
    const isBulletPoint = /^[-*•]\s/.test(trimmedLine);
    const isNumberedList = /^\d+\.\s/.test(trimmedLine);
    const isLetteredList = /^[a-zA-Z]\.\s/.test(trimmedLine);
    const isAcceptanceCriteria =
      /acceptance criteria/i.test(trimmedLine) || /ac:/i.test(trimmedLine) || /acceptance criteria:/i.test(trimmedLine);

    // If we find "acceptance criteria" header, start collecting
    if (isAcceptanceCriteria) {
      continue; // Skip the header line itself
    }

    // If line starts with bullet, number, or letter, it's likely an AC item
    if (isBulletPoint || isNumberedList || isLetteredList) {
      // Remove the bullet/number/letter and clean up
      const cleanItem = trimmedLine
        .replace(/^[-*•]\s/, '')
        .replace(/^\d+\.\s/, '')
        .replace(/^[a-zA-Z]\.\s/, '');
      if (cleanItem) {
        acceptanceCriteria.push(cleanItem);
      }
    }
  }

  return acceptanceCriteria;
}

// Linear API handler - uses Linear SDK directly instead of external HTTP service
ipcMain.handle('fetch-linear-issue', async (_event: unknown, issueId: string) => {
  try {
    const apiKey = getLinearAccessToken();
    if (!apiKey) {
      console.error('[Linear API] LINEAR_ACCESS_TOKEN not found in environment or store');
      return { 
        success: false, 
        error: 'Linear access token is not configured. Please set LINEAR_ACCESS_TOKEN as a system environment variable, or enter it in the app settings.' 
      };
    }

    const client = new LinearClient({
      apiKey: apiKey,
    });

    // Get specific issue by ID
    const issue = await client.issue(issueId);
    const state = await issue.state;

    // Parse acceptance criteria from description
    const acceptanceCriteriaArr = parseAcceptanceCriteria(issue.description || null);
    const now = new Date().toISOString();

    // Compose raw AC string
    //const rawAC = acceptanceCriteriaArr.length > 0 ? acceptanceCriteriaArr.map(ac => `- ${ac}`).join('\n') : '';
    // Compose parsed AC array
    const parsedAC = acceptanceCriteriaArr.map((ac) => ({
      text: ac,
      status: 'untested',
    }));

    // Compose response object
    const { id, identifier, title, description, url } = issue;

    const issueData = {
      id,
      key: identifier,
      title,
      url,
      description,
      status: state?.name || '',
      source: 'linear',
      ac: parsedAC,
      lastSyncedAt: now,
    };

    return { success: true, data: issueData };
  } catch (error) {
    console.error('Error fetching Linear issue:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// OpenAI API handler - keeps API key secure in main process
ipcMain.handle('call-openai', async (_event: unknown, messages: Array<{ role: string; content: string }>, model: string = 'gpt-4') => {
  try {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      console.error('[OpenAI API] OPENAI_API_KEY not found in environment or store');
      return { 
        success: false, 
        error: 'OpenAI API key is not configured. Please set OPENAI_API_KEY as a system environment variable, or enter it in the app settings.' 
      };
    }

    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model: model,
        messages: messages,
      });

      const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(data);
              resolve({ success: true, data: parsedData });
            } catch (parseError) {
              resolve({ success: false, error: 'Failed to parse response' });
            }
          } else {
            try {
              const errorData = JSON.parse(data);
              resolve({ success: false, error: errorData.error?.message || `HTTP ${res.statusCode}` });
            } catch {
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage}` });
            }
          }
        });
      });

      req.on('error', (error: Error) => {
        resolve({ success: false, error: error.message });
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught Exception:', error);
  // Try to show error in window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    const errorHtml = `
      <html>
        <head><title>Fatal Error</title></head>
        <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
          <h1 style="color: #ef4444;">Fatal Error</h1>
          <p><strong>Message:</strong> ${error.message}</p>
          <pre style="background: #0a0a0a; color: rgba(255, 255, 255, 0.8); padding: 10px; overflow: auto; font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px;">${error.stack || ''}</pre>
        </body>
      </html>
    `;
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
    mainWindow.show();
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Electron] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.whenReady().then(async () => {
  // Create splash window first
  createSplashWindow();

  // Create main window (but don't show it yet)
  createWindow();

  // Initialize auto-updater after window is created
  if (mainWindow) {
    await update(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Create splash window first
      createSplashWindow();
      // Then create main window
      createWindow();
      // Initialize auto-updater for new window
      if (mainWindow) {
        update(mainWindow).catch(err => {
          console.error('[Electron] Error initializing updater:', err);
        });
      }
    }
  });
}).catch((error: Error) => {
  console.error('[Electron] Error in app.whenReady():', error);
});

// Cleanup Next.js server on quit
app.on('will-quit', () => {
  cleanupNextServer();
  // Also kill any process on port 3000 as a safety measure
  killProcessOnPort(NEXT_PORT);
});

// Also cleanup on before-quit (fires before will-quit)
app.on('before-quit', () => {
  cleanupNextServer();
});

app.on('window-all-closed', () => {
  // Quit the app completely when all windows are closed (including on macOS)
  // This prevents white screen issues when reopening the app
  app.quit();
});
