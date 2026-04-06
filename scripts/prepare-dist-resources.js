const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend-rust');
const DIST_RESOURCES_DIR = path.join(ROOT_DIR, '.dist-resources', 'backend');
const SOURCE_ICON_PNG_PATH = path.join(ROOT_DIR, 'assets', 'app_icon.png');
const WINDOWS_ICON_PNG_PATH = SOURCE_ICON_PNG_PATH;
const WINDOWS_ICON_ICO_PATH = path.join(ROOT_DIR, 'assets', 'app_icon.ico');
const BACKEND_BINARY_NAME = process.platform === 'win32'
  ? 'kraken-unleashed-backend.exe'
  : 'kraken-unleashed-backend';
const BACKEND_PROFILE = process.env.KRAKEN_PACKAGE_BACKEND_PROFILE || 'debug';
const BACKEND_BINARY_PATH = path.join(BACKEND_DIR, 'target', BACKEND_PROFILE, BACKEND_BINARY_NAME);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function resolveLibusbPath() {
  const candidates = [
    process.env.KRAKEN_LIBUSB_DLL,
    process.env.WINDIR ? path.join(process.env.WINDIR, 'System32', 'libusb-1.0.dll') : null,
    path.join(ROOT_DIR, 'libusb-1.0.dll'),
    path.join(BACKEND_DIR, 'libusb-1.0.dll'),
    path.join(BACKEND_DIR, 'bin', 'libusb-1.0.dll')
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readPngDimensions(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Expected a PNG file at ${WINDOWS_ICON_PNG_PATH}`);
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function syncWindowsIconFromPng() {
  if (!fs.existsSync(WINDOWS_ICON_PNG_PATH)) {
    return;
  }

  const pngBuffer = fs.readFileSync(WINDOWS_ICON_PNG_PATH);
  const { width, height } = readPngDimensions(pngBuffer);
  const icoHeader = Buffer.alloc(6 + 16);

  // ICONDIR
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type = icon
  icoHeader.writeUInt16LE(1, 4); // image count

  // ICONDIRENTRY
  icoHeader.writeUInt8(width >= 256 ? 0 : width, 6);
  icoHeader.writeUInt8(height >= 256 ? 0 : height, 7);
  icoHeader.writeUInt8(0, 8); // palette colors
  icoHeader.writeUInt8(0, 9); // reserved
  icoHeader.writeUInt16LE(1, 10); // color planes
  icoHeader.writeUInt16LE(32, 12); // bits per pixel
  icoHeader.writeUInt32LE(pngBuffer.length, 14); // image size
  icoHeader.writeUInt32LE(22, 18); // image offset

  fs.writeFileSync(WINDOWS_ICON_ICO_PATH, Buffer.concat([icoHeader, pngBuffer]));
  console.log(`Synced Windows icon ${WINDOWS_ICON_ICO_PATH} from ${WINDOWS_ICON_PNG_PATH}`);
}

syncWindowsIconFromPng();

const cargoArgs = ['build', '--manifest-path', path.join('backend-rust', 'Cargo.toml')];
if (BACKEND_PROFILE !== 'debug') {
  cargoArgs.splice(1, 0, '--profile', BACKEND_PROFILE);
}

run('cargo', cargoArgs);

if (!fs.existsSync(BACKEND_BINARY_PATH)) {
  console.error(`Missing Rust backend ${BACKEND_PROFILE} binary at ${BACKEND_BINARY_PATH}`);
  process.exit(1);
}

ensureCleanDir(DIST_RESOURCES_DIR);
fs.copyFileSync(BACKEND_BINARY_PATH, path.join(DIST_RESOURCES_DIR, BACKEND_BINARY_NAME));

const libusbPath = resolveLibusbPath();
if (libusbPath) {
  copyIfPresent(libusbPath, path.join(DIST_RESOURCES_DIR, 'libusb-1.0.dll'));
  console.log(`Bundled libusb from ${libusbPath}`);
} else {
  console.log('No libusb-1.0.dll found. Packaged builds will rely on the WinUSB fallback unless the DLL is supplied.');
}

console.log(`Prepared packaged backend resources in ${DIST_RESOURCES_DIR}`);
