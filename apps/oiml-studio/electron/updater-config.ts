const pkg = require('electron-updater');
const { autoUpdater } = pkg;

// Configuration for different environments
const config = {
  development: {
    enabled: false,
    provider: 'github' as const,
    owner: 'openintent',
    repo: 'oiml',
    private: false,
    releaseType: 'release' as const,
  },
  production: {
    enabled: true,
    provider: 'github' as const,
    owner: 'openintent',
    repo: 'oiml',
    private: false,
    releaseType: 'release' as const,
  },
};

// Get current environment
const isDev = process.env.NODE_ENV === 'development';
const isElectronDev = process.env.VITE_DEV_SERVER_URL;
const currentConfig = isDev || isElectronDev ? config.development : config.production;

// Configure auto-updater
export function configureAutoUpdater() {
  if (!currentConfig.enabled) {
    return;
  }

  // Set update server URL for GitHub releases
  if (currentConfig.provider === 'github') {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: currentConfig.owner,
      repo: currentConfig.repo,
      private: currentConfig.private,
      releaseType: currentConfig.releaseType,
    });
  }

  // Configure auto-updater behavior
  autoUpdater.autoDownload = false; // Don't auto-download, let user choose
  autoUpdater.autoInstallOnAppQuit = true; // Install on app quit if update is ready
  autoUpdater.logger = console;

  // Set update channel and allow prereleases
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  // Set request headers for better compatibility
  autoUpdater.requestHeaders = {
    'User-Agent': 'OIML-Studio-AutoUpdater',
  };
}

// Get current configuration
export function getUpdaterConfig() {
  return currentConfig;
}

// Check if updates are enabled
export function isUpdaterEnabled() {
  return currentConfig.enabled;
}

