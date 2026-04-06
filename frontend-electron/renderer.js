const state = {
  assetPath: null,
  assetName: null,
  rotation: 0,
  deviceInfo: null,
  lcdPoweredOff: false,
  lastBrightness: 100,
  gallery: [],
  galleryPage: 1,
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
  searchQuery: '',
  searchNextCursor: null,
  searchCursorHistory: [],
  searchPage: 1,
  searchBusy: false,
  searchSessionOpen: false,
  detectionBusy: false,
  detectionPoller: null,
  lastDetectionLabel: 'Waiting for first scan.',
  deployBusy: false,
  deployProgressValue: 0,
  appMeta: null,
  settings: null,
  searchPreviewItem: null,
  galleryModalSelectedPath: null,
  firstRunSaving: false
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
  searchSession: document.getElementById('search-session'),
  searchSessionTitle: document.getElementById('search-session-title'),
  searchCloseButton: document.getElementById('search-close-button'),
  searchStatus: document.getElementById('search-status'),
  searchPagination: document.getElementById('search-pagination'),
  searchPrevButton: document.getElementById('search-prev-button'),
  searchPageLabel: document.getElementById('search-page-label'),
  searchNextButton: document.getElementById('search-next-button'),
  searchResults: document.getElementById('search-results'),
  searchPreviewModal: document.getElementById('search-preview-modal'),
  closeSearchPreviewButton: document.getElementById('close-search-preview-button'),
  searchPreviewTitle: document.getElementById('search-preview-title'),
  searchPreviewMeta: document.getElementById('search-preview-meta'),
  searchPreviewImage: document.getElementById('search-preview-image'),
  recoverButton: document.getElementById('recover-button'),
  editButton: document.getElementById('edit-button'),
  writeButton: document.getElementById('write-button'),
  rotateButton: document.getElementById('rotate-button'),
  rotationLabel: document.getElementById('rotation-label'),
  selectedName: document.getElementById('selected-name'),
  galleryStrip: document.getElementById('gallery-strip'),
  galleryPagination: document.getElementById('gallery-pagination'),
  galleryDeleteButton: document.getElementById('gallery-delete-button'),
  galleryPrevButton: document.getElementById('gallery-prev-button'),
  galleryPageLabel: document.getElementById('gallery-page-label'),
  galleryNextButton: document.getElementById('gallery-next-button'),
  galleryModal: document.getElementById('gallery-modal'),
  galleryModalSelectButton: document.getElementById('gallery-modal-select-button'),
  galleryModalDeleteButton: document.getElementById('gallery-modal-delete-button'),
  closeGalleryButton: document.getElementById('close-gallery-button'),
  galleryModalMeta: document.getElementById('gallery-modal-meta'),
  galleryModalGrid: document.getElementById('gallery-modal-grid'),
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
  zoomOutButton: document.getElementById('zoom-out-button'),
  zoomInButton: document.getElementById('zoom-in-button'),
  editorZoomLabel: document.getElementById('editor-zoom-label'),
  appVersion: document.getElementById('app-version')
  ,
  settingsButton: document.getElementById('settings-button'),
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsButton: document.getElementById('close-settings-button'),
  closeSettingsFooterButton: document.getElementById('close-settings-footer-button'),
  settingLaunchAtLogin: document.getElementById('setting-launch-at-login'),
  settingMinimizeToTray: document.getElementById('setting-minimize-to-tray'),
  settingStartHidden: document.getElementById('setting-start-hidden'),
  settingRestoreLastGif: document.getElementById('setting-restore-last-gif'),
  firstRunModal: document.getElementById('first-run-modal'),
  firstRunCloseToTray: document.getElementById('first-run-close-to-tray'),
  firstRunCloseApp: document.getElementById('first-run-close-app'),
  firstRunLaunchAtLogin: document.getElementById('first-run-launch-at-login'),
  firstRunRestoreLastGif: document.getElementById('first-run-restore-last-gif'),
  firstRunContinueButton: document.getElementById('first-run-continue-button')
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

function setDraftZoom(nextZoom) {
  if (!state.draftTransform) {
    return;
  }

  state.draftTransform.zoom = Math.min(3, Math.max(1, Number(nextZoom.toFixed(2))));
  updateZoomLabel(state.draftTransform.zoom);
  syncEditorTransform();
}

function nudgeDraftZoom(delta) {
  if (!state.draftTransform) {
    return;
  }

  setDraftZoom(state.draftTransform.zoom + delta);
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

function syncSearchSessionUI() {
  const open = state.searchSessionOpen;
  els.searchSession.classList.toggle('hidden', !open);
  els.searchSession.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (!open) {
    return;
  }

  if (state.searchBusy) {
    els.searchSessionTitle.textContent = 'Searching...';
    return;
  }

  if (state.searchQuery) {
    els.searchSessionTitle.textContent = `Results for "${state.searchQuery}"`;
  } else {
    els.searchSessionTitle.textContent = 'Results';
  }
}

function setSearchSessionOpen(open) {
  state.searchSessionOpen = Boolean(open);
  syncSearchSessionUI();
}

function updateSearchPagination() {
  const shouldShow = state.searchSessionOpen && (state.searchPage > 1 || Boolean(state.searchNextCursor));
  els.searchPagination.classList.toggle('hidden', !shouldShow);
  els.searchPagination.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  els.searchPageLabel.textContent = `Page ${state.searchPage}`;
  els.searchPrevButton.disabled = state.searchBusy || !state.searchSessionOpen || state.searchPage <= 1;
  els.searchNextButton.disabled = state.searchBusy || !state.searchSessionOpen || !state.searchNextCursor;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Unknown size';
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function searchResultMetaLabel(item) {
  const resolution = item.dimensions ? `${item.dimensions[0]} x ${item.dimensions[1]}` : 'GIF';
  const sizeLabel = formatBytes(item.sizeBytes);
  return `${resolution} | ${sizeLabel}`;
}

function searchCompressionLabel(item) {
  const limit = state.appMeta?.deviceMaxGifBytes || 20 * 1024 * 1024;
  if ((item.sizeBytes || 0) <= limit) {
    return null;
  }
  return `Over 20 MB, will be compressed on deploy`;
}

function openSearchPreview(item) {
  state.searchPreviewItem = item;
  els.searchPreviewTitle.textContent = item.title;
  const compressionLabel = searchCompressionLabel(item);
  els.searchPreviewMeta.textContent = compressionLabel
    ? `${searchResultMetaLabel(item)} | ${compressionLabel}`
    : searchResultMetaLabel(item);
  els.searchPreviewImage.src = item.downloadUrl || item.previewUrl;
  els.searchPreviewImage.alt = item.title;
  els.searchPreviewModal.classList.remove('hidden');
  els.searchPreviewModal.setAttribute('aria-hidden', 'false');
}

function closeSearchPreview() {
  state.searchPreviewItem = null;
  els.searchPreviewModal.classList.add('hidden');
  els.searchPreviewModal.setAttribute('aria-hidden', 'true');
  els.searchPreviewImage.removeAttribute('src');
}

function syncSettingsUI() {
  if (!state.settings) {
    return;
  }

  els.settingLaunchAtLogin.checked = Boolean(state.settings.launchAtLogin);
  els.settingMinimizeToTray.checked = Boolean(state.settings.minimizeToTray);
  els.settingStartHidden.checked = Boolean(state.settings.startHiddenOnLaunch);
  els.settingRestoreLastGif.checked = Boolean(state.settings.restoreLastGifOnStartup);
  const startupDependentDisabled = !state.settings.launchAtLogin;
  els.settingStartHidden.disabled = startupDependentDisabled;
  els.settingRestoreLastGif.disabled = startupDependentDisabled;
}

function openSettings() {
  syncSettingsUI();
  els.settingsModal.classList.remove('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
  els.settingsModal.setAttribute('aria-hidden', 'true');
}

function syncFirstRunUI() {
  const settings = state.settings || {};
  const minimizeToTray = settings.minimizeToTray !== false;
  els.firstRunCloseToTray.checked = minimizeToTray;
  els.firstRunCloseApp.checked = !minimizeToTray;
  els.firstRunLaunchAtLogin.checked = Boolean(settings.launchAtLogin);
  els.firstRunRestoreLastGif.checked = Boolean(settings.restoreLastGifOnStartup);
  els.firstRunRestoreLastGif.disabled = !els.firstRunLaunchAtLogin.checked;
  if (els.firstRunRestoreLastGif.disabled) {
    els.firstRunRestoreLastGif.checked = false;
  }
  els.firstRunContinueButton.disabled = state.firstRunSaving;
}

function openFirstRunModal() {
  syncFirstRunUI();
  els.firstRunModal.classList.remove('hidden');
  els.firstRunModal.setAttribute('aria-hidden', 'false');
}

function closeFirstRunModal() {
  els.firstRunModal.classList.add('hidden');
  els.firstRunModal.setAttribute('aria-hidden', 'true');
}

async function updateSetting(patch, successMessage) {
  state.settings = await window.krakenApp.updateSettings(patch);
  syncSettingsUI();
  syncFirstRunUI();
  if (successMessage) {
    setStatus(successMessage);
    showToast(successMessage);
  }
}

async function completeFirstRunSetup() {
  if (state.firstRunSaving) {
    return;
  }

  state.firstRunSaving = true;
  syncFirstRunUI();

  const minimizeToTray = els.firstRunCloseToTray.checked;
  const launchAtLogin = els.firstRunLaunchAtLogin.checked;
  const restoreLastGifOnStartup = launchAtLogin && els.firstRunRestoreLastGif.checked;
  const startHiddenOnLaunch = launchAtLogin && minimizeToTray;

  try {
    await updateSetting({
      minimizeToTray,
      launchAtLogin,
      startHiddenOnLaunch,
      restoreLastGifOnStartup,
      onboardingComplete: true
    }, 'Startup preferences saved.');
    closeFirstRunModal();
  } finally {
    state.firstRunSaving = false;
    syncFirstRunUI();
  }
}

function getGalleryPageSize() {
  return state.appMeta?.galleryPageSize || 6;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function syncGalleryPageToSelection() {
  if (!state.assetPath) {
    return;
  }
  const selectedIndex = state.gallery.findIndex((item) => item.path === state.assetPath);
  if (selectedIndex === -1) {
    return;
  }
  state.galleryPage = Math.floor(selectedIndex / getGalleryPageSize()) + 1;
}

function updateGalleryPagination(totalItems = state.gallery.length) {
  const pageSize = getGalleryPageSize();
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  state.galleryPage = Math.min(totalPages, Math.max(1, state.galleryPage));
  const shouldShow = totalPages > 1;
  els.galleryPagination.classList.toggle('hidden', !shouldShow);
  els.galleryPagination.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  els.galleryPageLabel.textContent = `Page ${state.galleryPage} / ${totalPages}`;
  els.galleryPrevButton.disabled = state.galleryPage <= 1;
  els.galleryNextButton.disabled = state.galleryPage >= totalPages;
}

function selectedGalleryItem() {
  return state.gallery.find((item) => item.path === state.assetPath) || null;
}

function selectedGalleryModalItem() {
  return state.gallery.find((item) => item.path === state.galleryModalSelectedPath) || null;
}

function updateGalleryActions() {
  const disabled = !selectedGalleryItem() || state.deployBusy;
  els.galleryDeleteButton.disabled = disabled;
  const modalDisabled = !selectedGalleryModalItem() || state.deployBusy;
  els.galleryModalDeleteButton.disabled = modalDisabled;
  els.galleryModalSelectButton.disabled = modalDisabled;
}

function setStatus(message) {
  els.statusLine.textContent = message;
}

function setDeployProgress(value, message, variant = 'active') {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const nextValue = variant === 'active'
    ? Math.max(state.deployProgressValue, clamped)
    : Math.max(state.deployProgressValue, clamped);
  state.deployProgressValue = nextValue;
  const track = els.deployProgress.querySelector('.deploy-progress-track');
  els.deployProgress.classList.remove('hidden', 'is-complete', 'is-error');
  els.deployProgress.classList.toggle('is-complete', variant === 'complete');
  els.deployProgress.classList.toggle('is-error', variant === 'error');
  els.deployProgress.setAttribute('aria-hidden', 'false');
  els.deployProgressLabel.textContent = message;
  els.deployProgressValue.textContent = `${nextValue}%`;
  els.deployProgressFill.style.width = `${nextValue}%`;
  track?.setAttribute('aria-valuenow', String(nextValue));
}

function resetDeployProgress() {
  state.deployProgressValue = 0;
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
  els.rotateButton.disabled = !state.assetPath || state.deployBusy;
  els.editButton.disabled = !state.assetPath || state.deployBusy;
  els.writeButton.disabled = !connected || !state.assetPath || state.deployBusy;
  updateGalleryActions();
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
  syncGalleryPageToSelection();
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
  updateGalleryActions();
}

function renderGallery() {
  els.galleryStrip.innerHTML = '';
  updateGalleryPagination();

  const pageSize = getGalleryPageSize();
  const startIndex = (state.galleryPage - 1) * pageSize;
  const visibleItems = state.gallery.slice(startIndex, startIndex + pageSize);

  for (const item of visibleItems) {
    const wrapper = document.createElement('div');
    wrapper.className = `gallery-item ${item.path === state.assetPath ? 'active' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    const img = document.createElement('img');
    img.src = `${toFileUrl(item.path)}?t=${item.modified}`;
    img.alt = item.displayName || item.name;
    button.appendChild(img);
    button.addEventListener('click', async () => {
      await setSelectedAsset(item.path, item.displayName || item.name);
      renderGallery();
    });

    const label = document.createElement('span');
    const displayName = item.displayName || item.name;
    label.textContent = displayName.length > 14 ? `${displayName.slice(0, 12)}...` : displayName;

    wrapper.appendChild(button);
    wrapper.appendChild(label);
    els.galleryStrip.appendChild(wrapper);
  }

  updateGalleryActions();
}

function renderGalleryModal() {
  els.galleryModalGrid.innerHTML = '';
  const itemCount = state.gallery.length;
  els.galleryModalMeta.textContent = itemCount === 1
    ? '1 GIF in your local app gallery.'
    : `${itemCount} GIFs in your local app gallery.`;

  for (const item of state.gallery) {
    const wrapper = document.createElement('div');
    wrapper.className = `gallery-modal-item ${item.path === state.galleryModalSelectedPath ? 'active' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Select ${item.displayName || item.name}`);
    button.addEventListener('click', () => {
      state.galleryModalSelectedPath = item.path;
      renderGalleryModal();
    });

    const img = document.createElement('img');
    img.src = `${toFileUrl(item.path)}?t=${item.modified}`;
    img.alt = item.displayName || item.name;
    button.appendChild(img);

    const label = document.createElement('span');
    label.textContent = item.displayName || item.name;

    wrapper.appendChild(button);
    wrapper.appendChild(label);
    els.galleryModalGrid.appendChild(wrapper);
  }

  updateGalleryActions();
}

function openGalleryModal() {
  state.galleryModalSelectedPath = state.assetPath;
  renderGalleryModal();
  els.galleryModal.classList.remove('hidden');
  els.galleryModal.setAttribute('aria-hidden', 'false');
  updateGalleryActions();
}

function closeGalleryModal() {
  els.galleryModal.classList.add('hidden');
  els.galleryModal.setAttribute('aria-hidden', 'true');
  state.galleryModalSelectedPath = null;
  updateGalleryActions();
}

async function deleteSelectedAsset() {
  const selectedItem = els.galleryModal.classList.contains('hidden')
    ? selectedGalleryItem()
    : selectedGalleryModalItem();
  if (!selectedItem || state.deployBusy) {
    return;
  }
  await window.krakenApp.deleteAsset(selectedItem.path);
  if (state.assetPath === selectedItem.path) {
    await setSelectedAsset(null, null);
  }
  if (state.galleryModalSelectedPath === selectedItem.path) {
    state.galleryModalSelectedPath = null;
  }
  await refreshGallery();
  showToast(`Deleted ${selectedItem.displayName || selectedItem.name}.`);
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
    els.rotationLabel.textContent = `Current rotation: ${state.rotation} deg`;
    return;
  }

  const preset = await window.krakenApp.getPreset(assetPath);
  state.transform = {
    zoom: preset?.zoom || 1,
    panX: preset?.panX || 0,
    panY: preset?.panY || 0
  };
  state.rotation = preset?.rotation || 0;
  els.rotationLabel.textContent = `Current rotation: ${state.rotation} deg`;
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
  updateGalleryPagination(nextGallery.length);

  if (state.assetPath) {
    const stillExists = await window.krakenApp.assetExists(state.assetPath);
    if (!stillExists) {
      await setSelectedAsset(null, null);
    }
  }

  renderGallery();
  if (!els.galleryModal.classList.contains('hidden')) {
    renderGalleryModal();
  }
}

function renderSearchResults() {
  els.searchResults.innerHTML = '';
  updateSearchPagination();

  if (state.searchResults.length === 0) {
    return;
  }

  for (const item of state.searchResults) {
    const card = document.createElement('div');
    card.className = 'search-result';
    card.addEventListener('click', (event) => {
      if (event.target.closest('button.primary-button')) {
        return;
      }
      openSearchPreview(item);
    });

    const previewButton = document.createElement('button');
    previewButton.className = 'search-result-preview';
    previewButton.type = 'button';
    previewButton.setAttribute('aria-label', `Preview ${item.title}`);
    previewButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openSearchPreview(item);
    });

    const thumb = document.createElement('img');
    thumb.src = item.previewUrl;
    thumb.alt = item.title;

    const previewHint = document.createElement('span');
    previewHint.className = 'search-result-preview-hint';
    previewHint.textContent = 'Preview';

    previewButton.appendChild(thumb);
    previewButton.appendChild(previewHint);

    const meta = document.createElement('div');
    meta.className = 'search-result-meta';

    const title = document.createElement('p');
    title.className = 'search-result-title';
    title.textContent = item.title;

    const dims = document.createElement('span');
    dims.className = 'search-result-dims';
    dims.textContent = searchResultMetaLabel(item);

    const compressionNote = document.createElement('span');
    compressionNote.className = 'search-result-note';
    const compressionLabel = searchCompressionLabel(item);
    if (compressionLabel) {
      compressionNote.textContent = compressionLabel;
    }

    const action = document.createElement('button');
    action.className = 'primary-button compact-button';
    action.textContent = 'Add';
    action.addEventListener('click', async (event) => {
      event.stopPropagation();
      action.disabled = true;
      action.textContent = 'Adding...';
      try {
        const downloaded = await window.krakenApp.downloadSearchResult({
          url: item.downloadUrl,
          title: item.title
        });
        await refreshGallery();
        await setSelectedAsset(downloaded.path, downloaded.displayName || downloaded.name);
        renderGallery();
        showToast(
          downloaded.alreadyExists
            ? `${downloaded.displayName || downloaded.name} already downloaded!`
            : `Added ${downloaded.displayName || downloaded.name} to the gallery.`
        );
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        action.disabled = false;
        action.textContent = 'Add';
      }
    });

    meta.appendChild(title);
    meta.appendChild(dims);
    if (compressionLabel) {
      meta.appendChild(compressionNote);
    }
    card.appendChild(previewButton);
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

async function runSearch({ cursor = '', direction = 'fresh' } = {}) {
  const query = els.searchInput.value.trim();
  if (!query || state.searchBusy) {
    return;
  }

  state.searchQuery = query;
  setSearchSessionOpen(true);
  state.searchBusy = true;
  syncSearchSessionUI();
  els.searchButton.disabled = true;
  els.searchPrevButton.disabled = true;
  els.searchNextButton.disabled = true;
  if (direction === 'fresh') {
    setSearchStatus(`Searching KLIPY for "${query}"...`);
  }

  try {
    const response = await window.krakenApp.searchGifs({ query, cursor });
    if (direction === 'fresh') {
      state.searchCursorHistory = [];
      state.searchPage = 1;
    } else if (direction === 'next') {
      state.searchCursorHistory.push(cursor);
      state.searchPage += 1;
    } else if (direction === 'prev') {
      state.searchPage = Math.max(1, state.searchPage - 1);
    }

    state.searchResults = response.results || [];
    for (const item of state.searchResults) {
      item.sizeBytes = item.sizeBytes || 0;
    }
    state.searchNextCursor = response.nextCursor || null;
    renderSearchResults();
    setSearchStatus(
      state.searchResults.length > 0
        ? `Showing ${state.searchResults.length} KLIPY GIFs for "${query}".`
        : `No GIFs found for "${query}".`
    );
  } catch (error) {
    state.searchResults = [];
    state.searchNextCursor = null;
    renderSearchResults();
    setSearchStatus(error.message);
    showToast(error.message, 'error');
  } finally {
    state.searchBusy = false;
    els.searchButton.disabled = false;
    updateSearchPagination();
    syncSearchSessionUI();
  }
}

async function writeCurrentAsset(options = {}) {
  if (!state.assetPath || !state.deviceInfo || state.deployBusy) {
    return false;
  }

  const {
    initialStatus,
    successStatus,
    suppressSuccessToast = false,
    suppressErrorToast = false,
    rethrowOnError = false
  } = options;

  state.deployBusy = true;
  resetDeployProgress();
  setDeviceControlState(Boolean(state.deviceInfo));
  setDeployProgress(2, `Starting deploy for ${state.assetName}...`);
  setStatus(initialStatus || `Preparing ${state.assetName} for the LCD...`);

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
    setStatus(successStatus || result.message || `${state.assetName} deployed successfully.`);
    if (!suppressSuccessToast) {
      showToast(result.message || 'GIF deployed to LCD.');
    }
    return true;
  } catch (error) {
    const previousValue = Number.parseInt(els.deployProgressValue.textContent, 10) || 0;
    setDeployProgress(Math.max(previousValue, 1), error.message || 'Write failed.', 'error');
    setStatus('Write failed.');
    if (!suppressErrorToast) {
      showToast(error.message, 'error');
    }
    if (rethrowOnError) {
      throw error;
    }
    return false;
  } finally {
    state.deployBusy = false;
    setDeviceControlState(Boolean(state.deviceInfo));
  }
}

async function restoreLastGifOnStartupIfNeeded() {
  if (!state.appMeta?.launchedOnStartup || !state.settings?.restoreLastGifOnStartup || !state.assetPath) {
    return;
  }

  setStatus('Waiting for Kraken device to restore the last GIF...');
  const maxAttempts = 12;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!state.deviceInfo) {
      await detectDevice({ silent: true });
    }

    if (state.deviceInfo) {
      try {
        const restored = await writeCurrentAsset({
          initialStatus: `Restoring ${state.assetName} after startup...`,
          successStatus: `${state.assetName} restored after startup.`,
          suppressSuccessToast: true,
          suppressErrorToast: true,
          rethrowOnError: true
        });
        if (restored) {
          return;
        }
      } catch {}
    }

    if (attempt < maxAttempts) {
      await delay(3000);
    }
  }

  setStatus('Startup restore skipped. The Kraken device was not ready.');
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
  const step = event.shiftKey ? 0.01 : 0.03;
  nudgeDraftZoom(event.deltaY < 0 ? step : -step);
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
  state.appMeta = await window.krakenApp.getAppMeta();
  state.settings = await window.krakenApp.getSettings();
  els.appVersion.textContent = `v${state.appMeta.version}`;
  syncSettingsUI();
  syncFirstRunUI();
  if (!state.settings?.onboardingComplete) {
    openFirstRunModal();
  }
  await detectDevice();
  await refreshGallery();
  await restoreLastDeployedAsset();
  await restoreLastGifOnStartupIfNeeded();

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
  await setSelectedAsset(picked.path, picked.displayName || picked.name);
  renderGallery();
  showToast(
    picked.alreadyExists
      ? `${picked.displayName || picked.name} already downloaded!`
      : `Added ${picked.displayName || picked.name} to the gallery.`
  );
});

els.browseButton.addEventListener('click', openGalleryModal);
els.galleryPrevButton.addEventListener('click', () => {
  if (state.galleryPage <= 1) {
    return;
  }
  state.galleryPage -= 1;
  renderGallery();
});
els.galleryNextButton.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(state.gallery.length / getGalleryPageSize()));
  if (state.galleryPage >= totalPages) {
    return;
  }
  state.galleryPage += 1;
  renderGallery();
});
els.galleryDeleteButton.addEventListener('click', async () => {
  try {
    await deleteSelectedAsset();
  } catch (error) {
    showToast(error.message, 'error');
  }
});
els.galleryModalDeleteButton.addEventListener('click', async () => {
  try {
    await deleteSelectedAsset();
  } catch (error) {
    showToast(error.message, 'error');
  }
});
els.galleryModalSelectButton.addEventListener('click', async () => {
  const selectedItem = selectedGalleryModalItem();
  if (!selectedItem) {
    return;
  }
  await setSelectedAsset(selectedItem.path, selectedItem.displayName || selectedItem.name);
  renderGallery();
  closeGalleryModal();
});

els.searchButton.addEventListener('click', runSearch);
els.searchCloseButton.addEventListener('click', () => {
  setSearchSessionOpen(false);
  updateSearchPagination();
});
els.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    runSearch();
  }
});
els.searchPrevButton.addEventListener('click', () => {
  if (state.searchBusy || state.searchPage <= 1) {
    return;
  }
  const previousCursor = state.searchPage <= 2
    ? ''
    : state.searchCursorHistory[state.searchCursorHistory.length - 2] || '';
  state.searchCursorHistory = state.searchCursorHistory.slice(0, -1);
  runSearch({ cursor: previousCursor, direction: 'prev' }).catch(() => {});
});
els.searchNextButton.addEventListener('click', () => {
  if (state.searchBusy || !state.searchNextCursor) {
    return;
  }
  runSearch({ cursor: state.searchNextCursor, direction: 'next' }).catch(() => {});
});
els.closeSearchPreviewButton.addEventListener('click', closeSearchPreview);
els.searchPreviewModal.addEventListener('click', (event) => {
  if (event.target === els.searchPreviewModal) {
    closeSearchPreview();
  }
});
els.closeGalleryButton.addEventListener('click', closeGalleryModal);

els.writeButton.addEventListener('click', writeCurrentAsset);
els.editButton.addEventListener('click', openEditor);
els.deviceTag.addEventListener('click', openCompatibility);
els.detectDeviceButton.addEventListener('click', () => {
  detectDevice().catch(() => {});
});

els.recoverButton.addEventListener('click', async () => {
  try {
    const result = await window.krakenApp.recoverLiquid();
    setStatus(result.message || 'Display restored.');
    showToast(result.message || 'Display restored.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.rotateButton.addEventListener('click', async () => {
  state.rotation = (state.rotation + 90) % 360;
  els.rotationLabel.textContent = `Current rotation: ${state.rotation} deg`;
  syncPreviewTransform();
  syncEditorTransform();
  await saveCurrentPreset();
  setStatus('Rotation updated. Click Deploy to write the updated image to the LCD.');
});

els.settingsButton.addEventListener('click', openSettings);
els.closeSettingsButton.addEventListener('click', closeSettings);
els.closeSettingsFooterButton.addEventListener('click', closeSettings);
els.settingLaunchAtLogin.addEventListener('change', async (event) => {
  try {
    await updateSetting(
      { launchAtLogin: event.target.checked },
      event.target.checked ? 'Launch on startup enabled.' : 'Launch on startup disabled.'
    );
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message, 'error');
  }
});
els.settingMinimizeToTray.addEventListener('change', async (event) => {
  try {
    await updateSetting(
      { minimizeToTray: event.target.checked },
      event.target.checked ? 'Close-to-tray enabled.' : 'Close-to-tray disabled.'
    );
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message, 'error');
  }
});
els.settingStartHidden.addEventListener('change', async (event) => {
  try {
    await updateSetting(
      { startHiddenOnLaunch: event.target.checked },
      event.target.checked ? 'Startup tray launch enabled.' : 'Startup tray launch disabled.'
    );
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message, 'error');
  }
});
els.settingRestoreLastGif.addEventListener('change', async (event) => {
  try {
    await updateSetting(
      { restoreLastGifOnStartup: event.target.checked },
      event.target.checked ? 'Startup GIF restore enabled.' : 'Startup GIF restore disabled.'
    );
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message, 'error');
  }
});
els.firstRunLaunchAtLogin.addEventListener('change', () => {
  syncFirstRunUI();
});
els.firstRunContinueButton.addEventListener('click', () => {
  completeFirstRunSetup().catch((error) => {
    state.firstRunSaving = false;
    syncFirstRunUI();
    showToast(error.message, 'error');
  });
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
els.zoomOutButton.addEventListener('click', () => {
  nudgeDraftZoom(-0.03);
});
els.zoomInButton.addEventListener('click', () => {
  nudgeDraftZoom(0.03);
});
els.closeCompatibilityButton.addEventListener('click', closeCompatibility);
els.editorCanvas.addEventListener('wheel', onEditorWheel, { passive: false });
els.editorCanvas.addEventListener('pointerdown', onEditorPointerDown);
window.addEventListener('focus', () => {
  refreshGallery().catch(() => {});
});
window.addEventListener('pointermove', onEditorPointerMove);
window.addEventListener('pointerup', onEditorPointerUp);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeEditor();
    closeCompatibility();
    closeSettings();
    closeSearchPreview();
    closeGalleryModal();
  }
});

boot();
