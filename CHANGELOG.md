# Changelog

## 1.0.5

- added a first-run startup preferences modal for close-to-tray, launch-on-boot, and restore-on-boot behavior
- tightened single-instance behavior so relaunching the app brings the existing window forward
- cleaned up the legacy `electron.app.Electron` startup entry left by old development builds
- improved packaging to prefer a working system `libusb-1.0.dll` before older local copies
- updated Windows installer packaging to ship the known-good backend/DLL combination

