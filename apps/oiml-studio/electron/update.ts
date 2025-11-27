import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { configureAutoUpdater, isUpdaterEnabled } from "./updater-config.js";

const pkg = require("electron-updater");
const { autoUpdater } = pkg;

// Type definitions for electron-updater events
interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface UpdateCheckResult {
  version?: string;
  releaseNotes?: string;
}

interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export async function update(win: BrowserWindow) {
  // Configure auto-updater
  configureAutoUpdater();

  // Skip auto-updater if not enabled
  if (!isUpdaterEnabled()) {
    return;
  }

  // Set up event handlers
  autoUpdater.on("checking-for-update", () => {
    const status = { status: "checking" };
    win.webContents.send("update-status", status);
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    const status = {
      status: "available",
      version: info.version,
      releaseNotes: info.releaseNotes
    };
    win.webContents.send("update-status", status);

    // No dialog - let the user interact with the popup notification
  });

  autoUpdater.on("update-not-available", () => {
    win.webContents.send("update-status", { status: "not-available" });
  });

  autoUpdater.on("error", (err: Error) => {
    console.error("❌ [AutoUpdater] Error:", err);
    win.webContents.send("update-status", {
      status: "error",
      error: err.message
    });

    // No dialog - let the user see the error in the popup notification
  });

  autoUpdater.on("download-progress", (progressObj: ProgressInfo) => {
    win.webContents.send("update-status", {
      status: "downloading",
      progress: progressObj.percent,
      speed: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    win.webContents.send("update-status", {
      status: "downloaded",
      version: info.version
    });

    // Auto-install the update after a short delay to let user see the notification
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 2000); // 2 second delay
  });

  // Handle IPC messages from renderer
  ipcMain.on("update-now", () => {
    autoUpdater.downloadUpdate();
  });

  ipcMain.on("install-update", () => {
    autoUpdater.quitAndInstall();
  });

  // Check for updates on startup (with a small delay to let the app load)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error("❌ [AutoUpdater] Failed to check for updates:", err);
    });
  }, 3000);

  // Set up periodic update checks (every 4 hours)
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        console.error("❌ [AutoUpdater] Failed to check for updates:", err);
      });
    },
    1000 * 20
    //4 * 60 * 60 * 1000
  );
}
