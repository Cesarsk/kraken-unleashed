const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
const PRESETS_PATH = path.join(ELECTRON_DATA_DIR, 'gif-presets.json');
const APP_STATE_PATH = path.join(ELECTRON_DATA_DIR, 'app-state.json');
const WINDOW_ICON_PATH = path.join(
  __dirname,
  'assets',
  process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'
);
const GALLERY_LIMIT = 10;
const SEARCH_PAGE_SIZE = 4;
const KLIPY_API_KEY = process.env.KLIPY_API_KEY || appConfig.klipyApiKey || '';
const KLIPY_CLIENT_KEY = process.env.KLIPY_CLIENT_KEY || appConfig.klipyClientKey || 'kraken-unleashed';
const RUST_BACKEND_DIR = app.isPackaged
  ? path.join(RUNTIME_ROOT, 'backend')
  : path.join(SOURCE_ROOT, 'backend-rust');
const RUST_MANIFEST_PATH = path.join(SOURCE_ROOT, 'backend-rust', 'Cargo.toml');
const RUST_BINARY_NAME = process.platform === 'win32'
  ? 'kraken-unleashed-backend.exe'
  : 'kraken-unleashed-backend';
let bridgeQueue = Promise.resolve();
let mainWindow = null;
let selectedBridge = null;
const DEPLOY_PROGRESS_EVENT = 'app:deploy-progress';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(ELECTRON_DATA_DIR);
app.setPath('sessionData', ELECTRON_DATA_DIR);

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
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectGalleryItems(fullPath, items);
      continue;
    }

    items.push({
      name: entry.name,
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
    .sort((a, b) => b.modified - a.modified)
    .slice(0, GALLERY_LIMIT);
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
      dimensions: gif?.dims || tinygif?.dims || null
    };
  }).filter((item) => item.previewUrl && item.downloadUrl);

  return {
    results,
    nextCursor: apiPayload.next || null,
    pageSize: SEARCH_PAGE_SIZE
  };
}

async function downloadSearchResult({ url, title }) {
  ensureDir(UPLOADS_DIR);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GIF download failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const fileName = `${Date.now()}-${sanitizeFileName(title || 'klipy-result')}.gif`;
  const targetPath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

  return {
    path: targetPath,
    name: path.basename(targetPath)
  };
}

function copyIntoGallery(sourcePath) {
  ensureDir(UPLOADS_DIR);
  const parsed = path.parse(sourcePath);
  const targetPath = path.join(UPLOADS_DIR, `${Date.now()}-${parsed.base.replace(/\s+/g, '-')}`);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
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
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  return mainWindow;
}

ipcMain.handle('app:get-device-info', async () => enqueueBridge(['info']));
ipcMain.handle('app:get-app-meta', async () => ({
  version: app.getVersion(),
  galleryLimit: GALLERY_LIMIT,
  searchPageSize: SEARCH_PAGE_SIZE
}));
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
  const storedPath = selectedPath.startsWith(GALLERY_DIR)
    ? selectedPath
    : copyIntoGallery(selectedPath);

  return {
    path: storedPath,
    name: path.basename(storedPath)
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
