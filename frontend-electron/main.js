const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
let appConfig = {};
try {
  appConfig = require('./app-config');
} catch {
  appConfig = {};
}

const SOURCE_ROOT = path.join(__dirname, '..');
const RUNTIME_ROOT = app.isPackaged ? process.resourcesPath : SOURCE_ROOT;
const ELECTRON_DATA_DIR = app.getPath('userData');
const GALLERY_DIR = path.join(ELECTRON_DATA_DIR, 'gifs');
const UPLOADS_DIR = path.join(GALLERY_DIR, 'uploads');
const GALLERY_METADATA_PATH = path.join(ELECTRON_DATA_DIR, 'gallery-metadata.json');
const PRESETS_PATH = path.join(ELECTRON_DATA_DIR, 'gif-presets.json');
const APP_STATE_PATH = path.join(ELECTRON_DATA_DIR, 'app-state.json');
const WINDOW_ICON_PATH = path.join(
  __dirname,
  'assets',
  process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'
);
const GALLERY_PAGE_SIZE = 6;
const SEARCH_PAGE_SIZE = 4;
const DEVICE_MAX_GIF_BYTES = 20 * 1024 * 1024;
const KLIPY_API_KEY = process.env.KLIPY_API_KEY || appConfig.klipyApiKey || '';
const KLIPY_CLIENT_KEY = process.env.KLIPY_CLIENT_KEY || appConfig.klipyClientKey || 'kraken-unleashed';
const RUST_BACKEND_DIR = app.isPackaged
  ? path.join(RUNTIME_ROOT, 'backend')
  : path.join(SOURCE_ROOT, 'backend-rust');
const RUST_MANIFEST_PATH = path.join(SOURCE_ROOT, 'backend-rust', 'Cargo.toml');
const RUST_BINARY_NAME = process.platform === 'win32'
  ? 'kraken-unleashed-backend.exe'
  : 'kraken-unleashed-backend';
const STARTUP_ARG = 'startup-launch';
const LEGACY_STARTUP_ARG = '--startup';
const APP_USER_MODEL_ID = 'com.cesarsk.krakenunleashed';
const STARTUP_SHORTCUT_NAME = 'Kraken Unleashed.lnk';
const DEFAULT_SETTINGS = {
  launchAtLogin: false,
  minimizeToTray: true,
  startHiddenOnLaunch: true,
  restoreLastGifOnStartup: false
};
let bridgeQueue = Promise.resolve();
let mainWindow = null;
let tray = null;
let selectedBridge = null;
let isQuitting = false;
let currentSettings = null;
const DEPLOY_PROGRESS_EVENT = 'app:deploy-progress';

function getProcessArgs() {
  return process.argv.slice(1);
}

function wasLaunchedOnStartup() {
  const args = getProcessArgs();
  return args.includes(STARTUP_ARG) || args.includes(LEGACY_STARTUP_ARG);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(ELECTRON_DATA_DIR);
app.setPath('sessionData', ELECTRON_DATA_DIR);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function rustBinaryCandidates() {
  const envBinary = process.env.KRAKEN_RUST_BACKEND_BIN;
  const candidates = [];
  if (envBinary) {
    candidates.push(envBinary);
  }

  if (app.isPackaged) {
    candidates.push(path.join(RUST_BACKEND_DIR, RUST_BINARY_NAME));
  } else {
    candidates.push(path.join(RUST_BACKEND_DIR, 'target', 'debug', RUST_BINARY_NAME));
    candidates.push(path.join(RUST_BACKEND_DIR, 'target-runtime', 'debug', RUST_BINARY_NAME));
    candidates.push(path.join(RUST_BACKEND_DIR, 'target-stage', 'debug', RUST_BINARY_NAME));
    candidates.push(path.join(RUST_BACKEND_DIR, 'bin', RUST_BINARY_NAME));
    candidates.push(path.join(RUST_BACKEND_DIR, 'target', 'release', RUST_BINARY_NAME));
    candidates.push(path.join(SOURCE_ROOT, 'dist-resources', 'backend', RUST_BINARY_NAME));
  }
  return candidates;
}

function firstExistingPath(paths) {
  return paths.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

function resolveBridge() {
  if (selectedBridge) {
    return selectedBridge;
  }

  const rustBinaryPath = firstExistingPath(rustBinaryCandidates());

  if (rustBinaryPath) {
    selectedBridge = {
      label: 'rust',
      command: rustBinaryPath,
      args: [],
      env: {
        ...process.env,
        KRAKEN_APP_ROOT: SOURCE_ROOT,
        KRAKEN_USER_DATA_DIR: ELECTRON_DATA_DIR,
        KRAKEN_BACKEND_IMPL: 'native'
      }
    };
    return selectedBridge;
  }

  const backendHint = app.isPackaged
    ? `Packaged Rust backend helper not found in ${RUST_BACKEND_DIR}.`
    : `Rust backend helper not found. Build or stage ${RUST_MANIFEST_PATH} first.`;
  throw new Error(backendHint);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function readPresets() {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writePresets(presets) {
  fs.writeFileSync(PRESETS_PATH, JSON.stringify(presets, null, 2));
}

function readGalleryMetadata() {
  try {
    return JSON.parse(fs.readFileSync(GALLERY_METADATA_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeGalleryMetadata(metadata) {
  fs.writeFileSync(GALLERY_METADATA_PATH, JSON.stringify(metadata, null, 2));
}

function readAppState() {
  try {
    return JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAppState(nextState) {
  fs.writeFileSync(APP_STATE_PATH, JSON.stringify(nextState, null, 2));
  return nextState;
}

function cleanDisplayName(name, fallback = 'Untitled GIF') {
  const normalized = String(name || '')
    .replace(/\.[^.]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function fileBufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function findGalleryItemByDigest(digest) {
  if (!digest) {
    return null;
  }
  const metadata = readGalleryMetadata();
  const match = Object.entries(metadata).find(([, entry]) => entry?.digest === digest);
  if (!match) {
    return null;
  }
  const [assetPath] = match;
  return assetExists(assetPath)
    ? {
        path: assetPath,
        displayName: metadata[assetPath]?.displayName || cleanDisplayName(path.parse(assetPath).name),
        alreadyExists: true
      }
    : null;
}

function findGalleryItemBySourceUrl(sourceUrl) {
  if (!sourceUrl) {
    return null;
  }
  const metadata = readGalleryMetadata();
  const match = Object.entries(metadata).find(([, entry]) => entry?.sourceUrl === sourceUrl);
  if (!match) {
    return null;
  }
  const [assetPath] = match;
  return assetExists(assetPath)
    ? {
        path: assetPath,
        displayName: metadata[assetPath]?.displayName || cleanDisplayName(path.parse(assetPath).name),
        alreadyExists: true
      }
    : null;
}

function getStoredSettings() {
  const appState = readAppState();
  return {
    ...DEFAULT_SETTINGS,
    ...(appState.settings || {})
  };
}

function getLoginItemEnabled(fallback = false) {
  if (process.platform !== 'win32') {
    return fallback;
  }

  return fs.existsSync(getStartupShortcutPath());
}

function getStartupShortcutPath() {
  const appDataDir = process.env.APPDATA || app.getPath('appData');
  return path.join(
    appDataDir,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    STARTUP_SHORTCUT_NAME
  );
}

function getStartupShortcutArgs() {
  if (app.isPackaged) {
    return STARTUP_ARG;
  }

  return `"${SOURCE_ROOT}" ${STARTUP_ARG}`;
}

function quoteForPowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writeStartupShortcut(shortcutPath) {
  const targetPath = process.execPath;
  const argumentsValue = getStartupShortcutArgs();
  const workingDirectory = app.isPackaged ? path.dirname(process.execPath) : SOURCE_ROOT;
  const iconLocation = `${WINDOW_ICON_PATH},0`;
  const script = [
    '$WshShell = New-Object -ComObject WScript.Shell',
    `$Shortcut = $WshShell.CreateShortcut(${quoteForPowerShell(shortcutPath)})`,
    `$Shortcut.TargetPath = ${quoteForPowerShell(targetPath)}`,
    `$Shortcut.Arguments = ${quoteForPowerShell(argumentsValue)}`,
    `$Shortcut.WorkingDirectory = ${quoteForPowerShell(workingDirectory)}`,
    `$Shortcut.Description = ${quoteForPowerShell('Launch Kraken Unleashed at Windows startup')}`,
    `$Shortcut.IconLocation = ${quoteForPowerShell(iconLocation)}`,
    '$Shortcut.Save()'
  ].join('; ');

  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

function getCurrentSettings() {
  if (currentSettings) {
    return currentSettings;
  }

  const storedSettings = getStoredSettings();
  currentSettings = {
    ...storedSettings,
    launchAtLogin: getLoginItemEnabled(storedSettings.launchAtLogin)
  };
  return currentSettings;
}

function persistSettings(nextSettings) {
  const appState = readAppState();
  writeAppState({
    ...appState,
    settings: nextSettings
  });
}

function applyLaunchAtLogin(enabled) {
  if (process.platform !== 'win32') {
    return;
  }

  const startupShortcutPath = getStartupShortcutPath();
  if (!enabled) {
    try {
      if (fs.existsSync(startupShortcutPath)) {
        fs.unlinkSync(startupShortcutPath);
      }
    } catch {}
    return;
  }

  ensureDir(path.dirname(startupShortcutPath));
  writeStartupShortcut(startupShortcutPath);
  if (!fs.existsSync(startupShortcutPath)) {
    throw new Error('Could not create the Windows startup shortcut.');
  }
}

function refreshStartupShortcutIfNeeded() {
  if (process.platform !== 'win32') {
    return;
  }
  const settings = getCurrentSettings();
  if (!settings.launchAtLogin) {
    return;
  }
  const startupShortcutPath = getStartupShortcutPath();
  if (!fs.existsSync(startupShortcutPath)) {
    return;
  }

  try {
    writeStartupShortcut(startupShortcutPath);
  } catch {}
}

function updateSettings(patch) {
  const nextSettings = {
    ...getCurrentSettings(),
    ...patch
  };
  if (Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin')) {
    applyLaunchAtLogin(Boolean(nextSettings.launchAtLogin));
  }
  nextSettings.launchAtLogin = getLoginItemEnabled(false);
  currentSettings = nextSettings;
  persistSettings(nextSettings);
  refreshTrayMenu();
  return nextSettings;
}

function shouldStartHidden() {
  const settings = getCurrentSettings();
  return wasLaunchedOnStartup() && settings.startHiddenOnLaunch;
}

function assetExists(assetPath) {
  try {
    return Boolean(assetPath) && fs.existsSync(assetPath);
  } catch {
    return false;
  }
}

function enqueueBridge(args, options = {}) {
  const job = bridgeQueue.then(() => runBridge(args, options));
  bridgeQueue = job.catch(() => {});
  return job;
}

function runBridge(args, options = {}) {
  return new Promise((resolve, reject) => {
    let bridge;
    try {
      bridge = options.bridge || resolveBridge();
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(bridge.command, [...bridge.args, ...args], {
      cwd: app.isPackaged ? RUNTIME_ROOT : SOURCE_ROOT,
      windowsHide: true,
      env: bridge.env
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let resultPayload = null;
    let sawStructuredStdout = false;

    function handleStructuredLine(line) {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      stdout += `${trimmed}\n`;

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return;
      }

      sawStructuredStdout = true;

      if (payload?.type === 'progress') {
        options.onProgress?.(payload);
        return;
      }

      if (payload?.type === 'result') {
        resultPayload = payload.payload ?? {};
        return;
      }

      resultPayload = payload;
    }

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleStructuredLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to start ${bridge.label} backend: ${error.message}`));
    });
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        handleStructuredLine(stdoutBuffer);
      }

      const output = stdout.trim();
      if (code !== 0) {
        reject(new Error((stderr || output || 'Bridge command failed').trim()));
        return;
      }

      if (resultPayload !== null) {
        resolve(resultPayload);
        return;
      }

      if (sawStructuredStdout) {
        resolve({});
        return;
      }

      try {
        resolve(output ? JSON.parse(output) : {});
      } catch {
        reject(new Error(`Invalid bridge response: ${output}`));
      }
    });
  });
}

function collectGalleryItems(dirPath, items = []) {
  const galleryMetadata = readGalleryMetadata();
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectGalleryItems(fullPath, items);
      continue;
    }

    items.push({
      name: entry.name,
      displayName: galleryMetadata[fullPath]?.displayName || cleanDisplayName(entry.name),
      path: fullPath,
      type: path.extname(entry.name).toLowerCase(),
      modified: fs.statSync(fullPath).mtimeMs
    });
  }

  return items;
}

function listGalleryItems() {
  ensureDir(GALLERY_DIR);
  const supported = new Set(['.gif']);
  return collectGalleryItems(GALLERY_DIR)
    .filter((entry) => supported.has(entry.type))
    .sort((a, b) => b.modified - a.modified);
}

function getPreset(assetPath) {
  const presets = readPresets();
  return presets[assetPath] || null;
}

function savePreset(assetPath, preset) {
  const presets = readPresets();
  presets[assetPath] = preset;
  writePresets(presets);
  return preset;
}

async function searchKlipy(request) {
  if (!KLIPY_API_KEY) {
    throw new Error('KLIPY search is not configured. Set KLIPY_API_KEY to enable in-app GIF search.');
  }

  const searchPayload = typeof request === 'string'
    ? { query: request }
    : (request || {});
  const query = String(searchPayload.query || '').trim();
  const cursor = String(searchPayload.cursor || '').trim();
  if (!query) {
    throw new Error('Search query is required.');
  }

  const params = new URLSearchParams({
    key: KLIPY_API_KEY,
    client_key: KLIPY_CLIENT_KEY,
    q: query,
    limit: String(SEARCH_PAGE_SIZE),
    media_filter: 'gif,tinygif',
    contentfilter: 'medium'
  });
  if (cursor) {
    params.set('pos', cursor);
  }

  const response = await fetch(`https://api.klipy.com/v2/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`KLIPY search failed with status ${response.status}`);
  }

  const apiPayload = await response.json();
  const results = (apiPayload.results || []).map((item) => {
    const gif = item.media_formats?.gif;
    const tinygif = item.media_formats?.tinygif || gif;
    return {
      id: item.id,
      title: item.content_description || item.title || 'Untitled GIF',
      previewUrl: tinygif?.url || gif?.url,
      downloadUrl: gif?.url,
      dimensions: gif?.dims || tinygif?.dims || null,
      sizeBytes: gif?.size || tinygif?.size || 0
    };
  }).filter((item) => item.previewUrl && item.downloadUrl);

  return {
    results,
    nextCursor: apiPayload.next || null,
    pageSize: SEARCH_PAGE_SIZE,
    deviceMaxGifBytes: DEVICE_MAX_GIF_BYTES
  };
}

async function downloadSearchResult({ url, title }) {
  ensureDir(UPLOADS_DIR);
  const existingByUrl = findGalleryItemBySourceUrl(url);
  if (existingByUrl) {
    return {
      path: existingByUrl.path,
      name: path.basename(existingByUrl.path),
      displayName: existingByUrl.displayName
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GIF download failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = fileBufferSha256(buffer);
  const existingByDigest = findGalleryItemByDigest(digest);
  if (existingByDigest) {
    return {
      path: existingByDigest.path,
      name: path.basename(existingByDigest.path),
      displayName: existingByDigest.displayName
    };
  }

  const fileName = `${Date.now()}-${sanitizeFileName(title || 'klipy-result')}.gif`;
  const targetPath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(targetPath, buffer);
  const metadata = readGalleryMetadata();
  metadata[targetPath] = {
    displayName: cleanDisplayName(title, 'Klipy GIF'),
    digest,
    sourceUrl: url
  };
  writeGalleryMetadata(metadata);

  return {
    path: targetPath,
    name: path.basename(targetPath),
    displayName: metadata[targetPath].displayName,
    alreadyExists: false
  };
}

function copyIntoGallery(sourcePath) {
  ensureDir(UPLOADS_DIR);
  const buffer = fs.readFileSync(sourcePath);
  const digest = fileBufferSha256(buffer);
  const existing = findGalleryItemByDigest(digest);
  if (existing) {
    return existing;
  }

  const parsed = path.parse(sourcePath);
  const targetPath = path.join(UPLOADS_DIR, `${Date.now()}-${parsed.base.replace(/\s+/g, '-')}`);
  fs.writeFileSync(targetPath, buffer);
  const metadata = readGalleryMetadata();
  metadata[targetPath] = {
    displayName: cleanDisplayName(parsed.name),
    digest
  };
  writeGalleryMetadata(metadata);
  return {
    path: targetPath,
    displayName: metadata[targetPath].displayName,
    alreadyExists: false
  };
}

function deleteGalleryAsset(assetPath) {
  if (!assetPath) {
    throw new Error('Asset path is required.');
  }
  if (!assetExists(assetPath)) {
    throw new Error('GIF not found.');
  }

  fs.unlinkSync(assetPath);

  const galleryMetadata = readGalleryMetadata();
  if (galleryMetadata[assetPath]) {
    delete galleryMetadata[assetPath];
    writeGalleryMetadata(galleryMetadata);
  }

  const presets = readPresets();
  if (presets[assetPath]) {
    delete presets[assetPath];
    writePresets(presets);
  }

  const appState = readAppState();
  if (appState.lastDeployedAssetPath === assetPath) {
    delete appState.lastDeployedAssetPath;
    delete appState.lastDeployedAssetName;
    delete appState.lastDeployedAt;
    writeAppState(appState);
  }

  return {
    path: assetPath
  };
}

function showMainWindow() {
  const window = createWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.setSkipTaskbar(false);
  window.show();
  window.focus();
  return window;
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
  }
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? 'Hide Kraken Unleashed' : 'Show Kraken Unleashed',
      click: () => {
        if (mainWindow && mainWindow.isVisible()) {
          hideMainWindow();
        } else {
          showMainWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Launch On Startup',
      type: 'checkbox',
      checked: getCurrentSettings().launchAtLogin,
      click: (menuItem) => {
        updateSettings({ launchAtLogin: menuItem.checked });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(WINDOW_ICON_PATH);
  tray.setToolTip('Kraken Unleashed');
  tray.on('double-click', () => {
    showMainWindow();
  });
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });
  refreshTrayMenu();
  return tray;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 1020,
    minHeight: 680,
    show: !shouldStartHidden(),
    skipTaskbar: shouldStartHidden(),
    icon: WINDOW_ICON_PATH,
    backgroundColor: '#17181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    refreshTrayMenu();
  });

  mainWindow.on('minimize', (event) => {
    if (!getCurrentSettings().minimizeToTray) {
      return;
    }
    event.preventDefault();
    hideMainWindow();
    refreshTrayMenu();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting || !getCurrentSettings().minimizeToTray) {
      return;
    }
    event.preventDefault();
    hideMainWindow();
    refreshTrayMenu();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('show', refreshTrayMenu);
  mainWindow.on('hide', refreshTrayMenu);
  return mainWindow;
}

ipcMain.handle('app:get-device-info', async () => enqueueBridge(['info']));
ipcMain.handle('app:get-app-meta', async () => ({
  version: app.getVersion(),
  galleryPageSize: GALLERY_PAGE_SIZE,
  searchPageSize: SEARCH_PAGE_SIZE,
  deviceMaxGifBytes: DEVICE_MAX_GIF_BYTES,
  launchedOnStartup: wasLaunchedOnStartup()
}));
ipcMain.handle('app:get-settings', async () => getCurrentSettings());
ipcMain.handle('app:update-settings', async (_event, patch) => updateSettings(patch || {}));
ipcMain.handle('app:set-brightness', async (_event, value) =>
  enqueueBridge(['brightness', String(value)])
);
ipcMain.handle('app:recover-liquid', async () => enqueueBridge(['recover']));
ipcMain.handle('app:list-gallery', async () => listGalleryItems());
ipcMain.handle('app:get-app-state', async () => readAppState());
ipcMain.handle('app:save-app-state', async (_event, nextState) =>
  writeAppState({ ...readAppState(), ...nextState })
);
ipcMain.handle('app:asset-exists', async (_event, assetPath) => assetExists(assetPath));
ipcMain.handle('app:delete-asset', async (_event, assetPath) => deleteGalleryAsset(assetPath));
ipcMain.handle('app:open-gallery-folder', async () => {
  ensureDir(GALLERY_DIR);
  return shell.openPath(GALLERY_DIR);
});
ipcMain.handle('app:pick-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'GIF Files', extensions: ['gif'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const storedAsset = selectedPath.startsWith(GALLERY_DIR)
    ? {
        path: selectedPath,
        displayName: cleanDisplayName(path.parse(selectedPath).name)
      }
    : copyIntoGallery(selectedPath);

  return {
    path: storedAsset.path,
    name: path.basename(storedAsset.path),
    displayName: storedAsset.displayName,
    alreadyExists: Boolean(storedAsset.alreadyExists)
  };
});
ipcMain.handle('app:get-preset', async (_event, assetPath) => getPreset(assetPath));
ipcMain.handle('app:save-preset', async (_event, assetPath, preset) =>
  savePreset(assetPath, preset)
);
ipcMain.handle('app:search-gifs', async (_event, query) => searchKlipy(query));
ipcMain.handle('app:download-search-result', async (_event, payload) =>
  downloadSearchResult(payload)
);
ipcMain.handle('app:write-asset', async (event, payload) => {
  const {
    assetPath,
    rotation = 0,
    zoom = 1,
    panX = 0,
    panY = 0
  } = payload || {};
  if (!assetPath) {
    throw new Error('Selected GIF path is missing.');
  }

  event.sender.send(DEPLOY_PROGRESS_EVENT, {
    value: 11,
    message: 'Launching device writer...'
  });
  return enqueueBridge([
    'write',
    assetPath,
    String(rotation),
    String(zoom),
    String(panX),
    String(panY)
  ], {
    bridge: resolveBridge(),
    onProgress: (progress) => {
      event.sender.send(DEPLOY_PROGRESS_EVENT, progress);
    }
  });
});

app.on('second-instance', (_event, argv) => {
  const launchedFromStartup = argv.includes(STARTUP_ARG) || argv.includes(LEGACY_STARTUP_ARG);
  if (launchedFromStartup && getCurrentSettings().startHiddenOnLaunch) {
    return;
  }
  showMainWindow();
});

app.whenReady().then(() => {
  getCurrentSettings();
  refreshStartupShortcutIfNeeded();
  createTray();
  createWindow();
  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (isQuitting || !getCurrentSettings().minimizeToTray)) {
    app.quit();
  }
});
