const state = {
  assetPath: null,
  assetName: null,
  rotation: 0,
  deviceInfo: null,
  lcdPoweredOff: false,
  lastBrightness: 100,
  gallery: [],
  transform: {
    zoom: 1,
    panX: 0,
    panY: 0
  },
  draftTransform: null,
  editorDragging: false,
  dragStart: null,
  galleryPoller: null,
  brightnessTimer: null,
  searchResults: [],
  searchBusy: false,
  detectionBusy: false,
  detectionPoller: null,
  lastDetectionLabel: 'Waiting for first scan.',
  deployBusy: false
};

const compatibilityCatalog = [
  {
    pid: 0x3012,
    name: 'Kraken Elite RGB 2024 / Kraken Elite V2',
    status: 'validated'
  },
  {
    pid: 0x300c,
    name: 'Kraken Elite 2023',
    status: 'supported'
  },
  {
    pid: 0x3008,
    name: 'Kraken Z3',
    status: 'legacy'
  }
];

const els = {
  deviceTag: document.getElementById('device-tag'),
  statusLine: document.getElementById('status-line'),
  brightnessSlider: document.getElementById('brightness-slider'),
  displayPowerButton: document.getElementById('display-power-button'),
  uploadButton: document.getElementById('upload-button'),
  browseButton: document.getElementById('browse-button'),
  searchInput: document.getElementById('search-input'),
  searchButton: document.getElementById('search-button'),
  freeBrowserButton: document.getElementById('free-browser-button'),
  searchStatus: document.getElementById('search-status'),
  searchResults: document.getElementById('search-results'),
  compatibilityButton: document.getElementById('compatibility-button'),
  recoverButton: document.getElementById('recover-button'),
  editButton: document.getElementById('edit-button'),
  writeButton: document.getElementById('write-button'),
  rotateButton: document.getElementById('rotate-button'),
  rotationLabel: document.getElementById('rotation-label'),
  selectedName: document.getElementById('selected-name'),
  galleryStrip: document.getElementById('gallery-strip'),
  previewImage: document.getElementById('preview-image'),
  previewPlaceholder: document.getElementById('preview-placeholder'),
  editorModal: document.getElementById('editor-modal'),
  closeEditorButton: document.getElementById('close-editor-button'),
  cancelEditorButton: document.getElementById('cancel-editor-button'),
  saveEditorButton: document.getElementById('save-editor-button'),
  resetEditorButton: document.getElementById('reset-editor-button'),
  deployProgress: document.getElementById('deploy-progress'),
  deployProgressLabel: document.getElementById('deploy-progress-label'),
  deployProgressValue: document.getElementById('deploy-progress-value'),
  deployProgressFill: document.getElementById('deploy-progress-fill'),
  compatibilityModal: document.getElementById('compatibility-modal'),
  closeCompatibilityButton: document.getElementById('close-compatibility-button'),
  detectDeviceButton: document.getElementById('detect-device-button'),
  detectedDeviceTitle: document.getElementById('detected-device-title'),
  compatibilityDetectionStatus: document.getElementById('compatibility-detection-status'),
  compatibilityGrid: document.getElementById('compatibility-grid'),
  editorCanvas: document.getElementById('editor-canvas'),
  editorImage: document.getElementById('editor-image'),
  editorZoomLabel: document.getElementById('editor-zoom-label')
};

function toFileUrl(filePath) {
  return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

function applyTransform(element, transform, scaleBase = 1) {
  const translateX = transform.panX * 42;
  const translateY = transform.panY * 42;
  element.style.transform = `translate(calc(-50% + ${translateX}%), calc(-50% + ${translateY}%)) scale(${scaleBase * transform.zoom}) rotate(${-state.rotation}deg)`;
}

function updateZoomLabel(value) {
  els.editorZoomLabel.textContent = `${Math.round(value * 100)}%`;
}

function syncPreviewTransform() {
  if (!state.assetPath) {
    return;
  }
  applyTransform(els.previewImage, state.transform);
}

function syncEditorTransform() {
  if (!state.draftTransform) {
    return;
  }
  applyTransform(els.editorImage, state.draftTransform);
}

function showToast(message, variant = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function setSearchStatus(message) {
  els.searchStatus.textContent = message;
}

function setStatus(message) {
  els.statusLine.textContent = message;
}

function setDeployProgress(value, message, variant = 'active') {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const track = els.deployProgress.querySelector('.deploy-progress-track');
  els.deployProgress.classList.remove('hidden', 'is-complete', 'is-error');
  els.deployProgress.classList.toggle('is-complete', variant === 'complete');
  els.deployProgress.classList.toggle('is-error', variant === 'error');
  els.deployProgress.setAttribute('aria-hidden', 'false');
  els.deployProgressLabel.textContent = message;
  els.deployProgressValue.textContent = `${clamped}%`;
  els.deployProgressFill.style.width = `${clamped}%`;
  track?.setAttribute('aria-valuenow', String(clamped));
}

function resetDeployProgress() {
  const track = els.deployProgress.querySelector('.deploy-progress-track');
  els.deployProgress.classList.add('hidden');
  els.deployProgress.classList.remove('is-complete', 'is-error');
  els.deployProgress.setAttribute('aria-hidden', 'true');
  els.deployProgressLabel.textContent = 'Ready to deploy.';
  els.deployProgressValue.textContent = '0%';
  els.deployProgressFill.style.width = '0%';
  track?.setAttribute('aria-valuenow', '0');
}

function setDeviceTag(label, variant = 'checking') {
  els.deviceTag.textContent = label;
  els.deviceTag.className = `device-tag device-tag--${variant}`;
}

function setDeviceControlState(connected) {
  els.brightnessSlider.disabled = !connected || state.lcdPoweredOff;
  els.displayPowerButton.disabled = !connected;
  els.displayPowerButton.textContent = state.lcdPoweredOff ? 'Wake LCD' : 'Shutdown LCD';
  els.recoverButton.disabled = !connected;
  els.rotateButton.disabled = !connected || !state.assetPath || state.deployBusy;
  els.editButton.disabled = !connected || !state.assetPath || state.deployBusy;
  els.writeButton.disabled = !connected || !state.assetPath || state.deployBusy;
}

async function setBrightness(value) {
  const result = await window.krakenApp.setBrightness(value);
  if (value > 0) {
    state.lastBrightness = value;
    state.lcdPoweredOff = false;
  }
  setDeviceControlState(Boolean(state.deviceInfo));
  return result;
}

async function toggleDisplayPower() {
  if (!state.deviceInfo) {
    return;
  }

  const nextValue = state.lcdPoweredOff ? Math.max(state.lastBrightness, 20) : 0;
  try {
    const result = await setBrightness(nextValue);
    state.lcdPoweredOff = nextValue === 0;
    els.brightnessSlider.value = String(nextValue);
    setDeviceControlState(Boolean(state.deviceInfo));
    setStatus(result.message || (state.lcdPoweredOff ? 'LCD shut down.' : `Brightness set to ${nextValue}%.`));
    showToast(state.lcdPoweredOff ? 'LCD shut down.' : 'LCD powered back on.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function statusStyle(status) {
  if (status === 'validated') {
    return { card: 'compatibility-card--good', label: 'VALIDATED' };
  }
  if (status === 'supported') {
    return { card: 'compatibility-card--good', label: 'SUPPORTED' };
  }
  return { card: 'compatibility-card--warn', label: 'LEGACY' };
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderCompatibility() {
  const detectedPid = state.deviceInfo?.pid;
  els.compatibilityGrid.innerHTML = '';

  for (const entry of compatibilityCatalog) {
    const style = statusStyle(entry.status);
    const isDetected = detectedPid === entry.pid;
    const card = document.createElement('div');
    card.className = `compatibility-card ${style.card} ${isDetected ? 'compatibility-card--detected' : ''}`.trim();

    const title = document.createElement('h3');
    title.textContent = entry.name;

    const info = document.createElement('p');
    info.textContent = `PID ${`0x${entry.pid.toString(16)}`}`;

    const meta = document.createElement('div');
    meta.className = 'compatibility-meta';

    const statusBadge = document.createElement('span');
    statusBadge.className = `compatibility-badge ${isDetected ? 'compatibility-badge--active' : ''}`.trim();
    statusBadge.textContent = isDetected ? 'DETECTED' : style.label;
    meta.appendChild(statusBadge);

    card.appendChild(title);
    card.appendChild(info);
    card.appendChild(meta);
    els.compatibilityGrid.appendChild(card);
  }
}

function updateDetectionUI() {
  if (state.deviceInfo) {
    setDeviceTag(`${state.deviceInfo.name} | ${state.deviceInfo.pidHex}`, 'good');
    els.detectedDeviceTitle.textContent = `${state.deviceInfo.name} detected`;
    els.compatibilityDetectionStatus.textContent = `${state.deviceInfo.pidHex} at ${state.deviceInfo.resolution.width}x${state.deviceInfo.resolution.height}. Last scan: ${state.lastDetectionLabel}`;
    setStatus(`Detected ${state.deviceInfo.name}. Ready for GIF deploys.`);
  } else {
    setDeviceTag('No compatible device detected', 'warn');
    els.detectedDeviceTitle.textContent = 'No compatible Kraken LCD detected';
    els.compatibilityDetectionStatus.textContent = `${state.lastDetectionLabel} Make sure the cooler is connected and other USB control software is closed.`;
    setStatus('No compatible Kraken detected. Connect the device and run detection again.');
  }

  setDeviceControlState(Boolean(state.deviceInfo));
  renderCompatibility();
}

async function detectDevice({ silent = false } = {}) {
  if (state.detectionBusy) {
    return;
  }

  state.detectionBusy = true;
  els.detectDeviceButton.disabled = true;
  if (!silent) {
    els.compatibilityDetectionStatus.textContent = 'Scanning USB interfaces for a compatible Kraken LCD...';
  }

  try {
    const info = await window.krakenApp.getDeviceInfo();
    state.deviceInfo = info;
    state.lastDetectionLabel = formatTime(new Date());
    state.lcdPoweredOff = Number(els.brightnessSlider.value) === 0 && state.lcdPoweredOff;
  } catch (error) {
    state.deviceInfo = null;
    state.lastDetectionLabel = `${formatTime(new Date())} - ${error.message}`;
    if (!silent) {
      showToast(error.message, 'error');
    }
  } finally {
    state.detectionBusy = false;
    els.detectDeviceButton.disabled = false;
    updateDetectionUI();
  }
}

async function setSelectedAsset(assetPath, assetName) {
  const isSameAsset = state.assetPath === assetPath;
  state.assetPath = assetPath;
  state.assetName = assetName;
  if (!isSameAsset) {
    await loadPresetForAsset(assetPath);
  }
  els.selectedName.textContent = assetName || 'Nothing selected yet';

  if (!assetPath) {
    els.previewImage.style.display = 'none';
    els.previewPlaceholder.style.display = 'grid';
    setDeviceControlState(Boolean(state.deviceInfo));
    return;
  }

  els.previewImage.src = `${toFileUrl(assetPath)}?t=${Date.now()}`;
  els.previewImage.style.display = 'block';
  els.previewPlaceholder.style.display = 'none';
  syncPreviewTransform();
  setDeviceControlState(Boolean(state.deviceInfo));
}

function renderGallery() {
  els.galleryStrip.innerHTML = '';

  for (const item of state.gallery) {
    const wrapper = document.createElement('div');
    wrapper.className = `gallery-item ${item.path === state.assetPath ? 'active' : ''}`;

    const button = document.createElement('button');
    const img = document.createElement('img');
    img.src = `${toFileUrl(item.path)}?t=${item.modified}`;
    img.alt = item.name;
    button.appendChild(img);
    button.addEventListener('click', async () => {
      await setSelectedAsset(item.path, item.name);
      renderGallery();
    });

    const label = document.createElement('span');
    label.textContent = item.name.length > 14 ? `${item.name.slice(0, 12)}...` : item.name;

    wrapper.appendChild(button);
    wrapper.appendChild(label);
    els.galleryStrip.appendChild(wrapper);
  }
}

async function restoreLastDeployedAsset() {
  const appState = await window.krakenApp.getAppState();
  const assetPath = appState?.lastDeployedAssetPath;
  if (!assetPath) {
    return;
  }

  const exists = await window.krakenApp.assetExists(assetPath);
  if (!exists) {
    return;
  }

  await setSelectedAsset(assetPath, appState.lastDeployedAssetName || assetPath.split(/[/\\]/).pop());
  renderGallery();
}

async function loadPresetForAsset(assetPath) {
  if (!assetPath) {
    state.transform = { zoom: 1, panX: 0, panY: 0 };
    state.rotation = 0;
    els.rotationLabel.textContent = `${state.rotation} deg`;
    return;
  }

  const preset = await window.krakenApp.getPreset(assetPath);
  state.transform = {
    zoom: preset?.zoom || 1,
    panX: preset?.panX || 0,
    panY: preset?.panY || 0
  };
  state.rotation = preset?.rotation || 0;
  els.rotationLabel.textContent = `${state.rotation} deg`;
}

async function saveCurrentPreset() {
  if (!state.assetPath) {
    return;
  }

  await window.krakenApp.savePreset(state.assetPath, {
    zoom: state.transform.zoom,
    panX: state.transform.panX,
    panY: state.transform.panY,
    rotation: state.rotation
  });
}

async function refreshGallery() {
  const nextGallery = await window.krakenApp.listGallery();
  state.gallery = nextGallery;

  if (state.assetPath) {
    const stillExists = await window.krakenApp.assetExists(state.assetPath);
    if (!stillExists) {
      await setSelectedAsset(null, null);
    }
  }

  renderGallery();
}

function renderSearchResults() {
  els.searchResults.innerHTML = '';

  if (state.searchResults.length === 0) {
    return;
  }

  for (const item of state.searchResults) {
    const card = document.createElement('div');
    card.className = 'search-result';

    const thumb = document.createElement('img');
    thumb.src = item.previewUrl;
    thumb.alt = item.title;

    const meta = document.createElement('div');
    meta.className = 'search-result-meta';

    const title = document.createElement('p');
    title.className = 'search-result-title';
    title.textContent = item.title;

    const dims = document.createElement('span');
    dims.className = 'search-result-dims';
    dims.textContent = item.dimensions ? `${item.dimensions[0]} x ${item.dimensions[1]}` : 'GIF';

    const action = document.createElement('button');
    action.className = 'primary-button compact-button';
    action.textContent = 'Add';
    action.addEventListener('click', async () => {
      action.disabled = true;
      action.textContent = 'Adding...';
      try {
        const downloaded = await window.krakenApp.downloadSearchResult({
          url: item.downloadUrl,
          title: item.title
        });
        await refreshGallery();
        await setSelectedAsset(downloaded.path, downloaded.name);
        renderGallery();
        showToast(`Added ${downloaded.name} to the gallery.`);
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        action.disabled = false;
        action.textContent = 'Add';
      }
    });

    meta.appendChild(title);
    meta.appendChild(dims);
    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(action);
    els.searchResults.appendChild(card);
  }
}

function buildPreparedGifName(assetName) {
  const baseName = (assetName || 'prepared.gif').replace(/\.gif$/i, '');
  return `${baseName}-device-ready.gif`;
}

async function buildPreparedGifPayload() {
  if (!state.assetPath || !state.deviceInfo) {
    throw new Error('A selected GIF and detected device are required before deploy.');
  }

  setDeployProgress(6, 'Collecting deploy settings...');
  return {
    assetPath: state.assetPath,
    assetName: state.assetName,
    rotation: state.rotation,
    zoom: state.transform.zoom,
    panX: state.transform.panX,
    panY: state.transform.panY
  };
}

async function runSearch() {
  const query = els.searchInput.value.trim();
  if (!query || state.searchBusy) {
    return;
  }

  state.searchBusy = true;
  els.searchButton.disabled = true;
  setSearchStatus(`Searching KLIPY for "${query}"...`);

  try {
    state.searchResults = await window.krakenApp.searchGifs(query);
    renderSearchResults();
    setSearchStatus(
      state.searchResults.length > 0
        ? `Found ${state.searchResults.length} GIFs for "${query}".`
        : `No GIFs found for "${query}".`
    );
  } catch (error) {
    state.searchResults = [];
    renderSearchResults();
    setSearchStatus(error.message);
    showToast(error.message, 'error');
  } finally {
    state.searchBusy = false;
    els.searchButton.disabled = false;
  }
}

async function writeCurrentAsset() {
  if (!state.assetPath || !state.deviceInfo || state.deployBusy) {
    return;
  }

  state.deployBusy = true;
  setDeviceControlState(Boolean(state.deviceInfo));
  setDeployProgress(2, `Starting deploy for ${state.assetName}...`);
  setStatus(`Preparing ${state.assetName} for the LCD...`);

  try {
    const preparedPayload = await buildPreparedGifPayload();
    setDeployProgress(10, 'Handing deploy to backend...');
    setStatus(`Deploying ${state.assetName} to the LCD...`);
    const result = await window.krakenApp.writeAsset(preparedPayload);
    setDeployProgress(100, result.message || `${state.assetName} deployed successfully.`, 'complete');
    await window.krakenApp.saveAppState({
      lastDeployedAssetPath: state.assetPath,
      lastDeployedAssetName: state.assetName,
      lastDeployedAt: new Date().toISOString()
    });
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    setStatus(result.message || `${state.assetName} deployed successfully.`);
    showToast(result.message || 'GIF deployed to LCD.');
  } catch (error) {
    const previousValue = Number.parseInt(els.deployProgressValue.textContent, 10) || 0;
    setDeployProgress(Math.max(previousValue, 1), error.message || 'Write failed.', 'error');
    setStatus('Write failed.');
    showToast(error.message, 'error');
  } finally {
    state.deployBusy = false;
    setDeviceControlState(Boolean(state.deviceInfo));
  }
}

window.krakenApp.onDeployProgress((payload) => {
  if (!state.deployBusy || !payload) {
    return;
  }

  setDeployProgress(payload.value ?? 0, payload.message || 'Deploying GIF...');
});

function openEditor() {
  if (!state.assetPath) {
    return;
  }
  state.draftTransform = { ...state.transform };
  els.editorImage.src = `${toFileUrl(state.assetPath)}?t=${Date.now()}`;
  updateZoomLabel(state.draftTransform.zoom);
  syncEditorTransform();
  els.editorModal.classList.remove('hidden');
  els.editorModal.setAttribute('aria-hidden', 'false');
}

function closeEditor() {
  els.editorModal.classList.add('hidden');
  els.editorModal.setAttribute('aria-hidden', 'true');
  state.editorDragging = false;
  state.dragStart = null;
}

function openCompatibility() {
  els.compatibilityModal.classList.remove('hidden');
  els.compatibilityModal.setAttribute('aria-hidden', 'false');
  detectDevice({ silent: true }).catch(() => {});
}

function closeCompatibility() {
  els.compatibilityModal.classList.add('hidden');
  els.compatibilityModal.setAttribute('aria-hidden', 'true');
}

function onEditorWheel(event) {
  if (!state.draftTransform) {
    return;
  }
  event.preventDefault();
  const nextZoom = state.draftTransform.zoom + (event.deltaY < 0 ? 0.08 : -0.08);
  state.draftTransform.zoom = Math.min(3, Math.max(1, Number(nextZoom.toFixed(2))));
  updateZoomLabel(state.draftTransform.zoom);
  syncEditorTransform();
}

function clampPan(value) {
  return Math.max(-1, Math.min(1, value));
}

function onEditorPointerDown(event) {
  if (!state.draftTransform) {
    return;
  }
  state.editorDragging = true;
  state.dragStart = {
    x: event.clientX,
    y: event.clientY,
    panX: state.draftTransform.panX,
    panY: state.draftTransform.panY
  };
  els.editorCanvas.classList.add('dragging');
}

function onEditorPointerMove(event) {
  if (!state.editorDragging || !state.dragStart || !state.draftTransform) {
    return;
  }
  const dx = event.clientX - state.dragStart.x;
  const dy = event.clientY - state.dragStart.y;
  state.draftTransform.panX = clampPan(state.dragStart.panX + dx / 180);
  state.draftTransform.panY = clampPan(state.dragStart.panY + dy / 180);
  syncEditorTransform();
}

function onEditorPointerUp() {
  state.editorDragging = false;
  state.dragStart = null;
  els.editorCanvas.classList.remove('dragging');
}

function resetDraftTransform() {
  if (!state.draftTransform) {
    return;
  }
  state.draftTransform = { zoom: 1, panX: 0, panY: 0 };
  updateZoomLabel(state.draftTransform.zoom);
  syncEditorTransform();
}

async function boot() {
  renderCompatibility();
  resetDeployProgress();
  setDeviceControlState(false);
  await detectDevice();
  await refreshGallery();
  await restoreLastDeployedAsset();

  state.galleryPoller = window.setInterval(() => {
    refreshGallery().catch(() => {});
  }, 2500);

  state.detectionPoller = window.setInterval(() => {
    detectDevice({ silent: true }).catch(() => {});
  }, 8000);
}

els.uploadButton.addEventListener('click', async () => {
  const picked = await window.krakenApp.pickFile();
  if (!picked) {
    return;
  }
  await refreshGallery();
  await setSelectedAsset(picked.path, picked.name);
  renderGallery();
});

els.browseButton.addEventListener('click', async () => {
  await window.krakenApp.openGalleryFolder();
});

els.searchButton.addEventListener('click', runSearch);
els.freeBrowserButton.addEventListener('click', async () => {
  await window.krakenApp.openGifBrowser(els.searchInput.value.trim());
});
els.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    runSearch();
  }
});

els.writeButton.addEventListener('click', writeCurrentAsset);
els.editButton.addEventListener('click', openEditor);
els.compatibilityButton.addEventListener('click', openCompatibility);
els.detectDeviceButton.addEventListener('click', () => {
  detectDevice().catch(() => {});
});

els.recoverButton.addEventListener('click', async () => {
  try {
    const result = await window.krakenApp.recoverLiquid();
    setStatus(result.message || 'Liquid screen restored.');
    showToast(result.message || 'Liquid screen restored.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.rotateButton.addEventListener('click', async () => {
  state.rotation = (state.rotation + 90) % 360;
  els.rotationLabel.textContent = `${state.rotation} deg`;
  syncPreviewTransform();
  syncEditorTransform();
  await saveCurrentPreset();
  setStatus(`Rotation set to ${state.rotation} deg. Click Deploy to write the updated image to the LCD.`);
});

els.brightnessSlider.addEventListener('input', async (event) => {
  const value = Number(event.target.value);
  state.lastBrightness = value > 0 ? value : state.lastBrightness;
  state.lcdPoweredOff = false;
  setDeviceControlState(Boolean(state.deviceInfo));
  setStatus(`Updating brightness to ${value}%...`);
  window.clearTimeout(state.brightnessTimer);
  state.brightnessTimer = window.setTimeout(async () => {
    try {
      const result = await setBrightness(value);
      setStatus(result.message || `Brightness set to ${value}%.`);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }, 180);
});

els.displayPowerButton.addEventListener('click', () => {
  toggleDisplayPower().catch(() => {});
});

els.closeEditorButton.addEventListener('click', closeEditor);
els.cancelEditorButton.addEventListener('click', closeEditor);
els.saveEditorButton.addEventListener('click', () => {
  if (state.draftTransform) {
    state.transform = { ...state.draftTransform };
    syncPreviewTransform();
  }
  saveCurrentPreset().catch(() => {});
  closeEditor();
});
els.resetEditorButton.addEventListener('click', resetDraftTransform);
els.closeCompatibilityButton.addEventListener('click', closeCompatibility);
els.editorCanvas.addEventListener('wheel', onEditorWheel, { passive: false });
els.editorCanvas.addEventListener('pointerdown', onEditorPointerDown);
window.addEventListener('focus', () => {
  refreshGallery().catch(() => {});
});
window.addEventListener('pointermove', onEditorPointerMove);
window.addEventListener('pointerup', onEditorPointerUp);

boot();
