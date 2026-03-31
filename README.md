<p align="center">
  <img src="./assets/readme-banner.svg" alt="Kraken Unleashed banner" width="100%" />
</p>

<h1 align="center">Kraken Unleashed</h1>

<p align="center">
  Direct GIF deployment for supported NZXT Kraken LCD coolers, without CAM.
</p>

<p align="center">
  Windows-native device control | Electron desktop UI | Rust backend helper
</p>

Kraken Unleashed is an independent desktop app for pushing animated GIFs straight to supported NZXT Kraken LCD displays. It handles detection, previewing, placement, and deploy from a local desktop workflow instead of going through vendor software.

This project is not affiliated with or endorsed by NZXT. Keep NZXT CAM closed while using it.

## Highlights

- direct GIF deploys to supported Kraken LCDs over USB
- native device detection from the desktop app
- brightness control, LCD shutdown, and restore-liquid recovery actions
- placement editor with saved zoom, pan, and rotation presets per GIF
- local gallery workflow for uploaded and downloaded assets
- optional KLIPY-powered search with a GIFCities browser fallback

## Current Status

- platform target: Windows
- media support today: GIF only
- native backend actions: `info`, `brightness`, `recover`, and `write`
- validated hardware: `Kraken Elite RGB 2024` / `Kraken Elite V2` (`PID 0x3012`)

The app currently prepares device-ready GIFs locally, stages them in `.electron-data`, then writes them to the LCD through the Rust helper.

## Supported Devices

Validated in this app:

- `Kraken Elite RGB 2024` / `Kraken Elite V2` (`PID 0x3012`)

Also listed in the compatibility view:

- `Kraken Elite 2023` (`PID 0x300C`) - supported path in the backend
- `Kraken Z3` (`PID 0x3008`) - legacy support path

## Quick Start

### Requirements

- Windows
- Node.js with `npm`
- Rust toolchain with `cargo`
- a supported Kraken LCD connected over USB

### Run the app

From the repo root:

```bash
npm install
npm run backend:stage
npm start
```

`npm run backend:stage` builds the Rust helper and places it where Electron can find it first.

## How To Use

1. Launch the app with NZXT CAM closed.
2. Let the app detect the connected LCD.
3. Upload a GIF or search/download one into the local gallery.
4. Open the editor to adjust zoom, pan, and rotation.
5. Click `Deploy` to let the Rust backend prepare and write the GIF to the display.

If the screen gets stuck, use `Restore Liquid Screen` from the app.

## GIF Search

In-app search uses `KLIPY` when an API key is available.

Windows example:

```bash
set KLIPY_API_KEY=your_key_here
npm start
```

Optional variables:

- `KLIPY_API_KEY` - enables in-app search
- `KLIPY_CLIENT_KEY` - overrides the client key sent to KLIPY

Without a KLIPY key, the `Free Browser` button opens a GIFCities search in your browser.

KLIPY integration note:

- KLIPY's official guidance is to use `api.klipy.com`, configure a `KLIPY_API_KEY`, and include KLIPY attribution in the UI.

## Backend Notes

The Electron app prefers a compiled Rust backend helper. The helper currently exposes these native commands:

- `info` - detect a supported Kraken LCD and report resolution details
- `brightness` - set LCD brightness from `0` to `100`
- `recover` - switch the screen back to the liquid display mode
- `write` - prepare and transfer a GIF directly to the device

Useful commands while developing:

```bash
cargo build --manifest-path backend-rust/Cargo.toml
cargo build --release --manifest-path backend-rust/Cargo.toml
npm run backend:stage
```

You can also point Electron at a custom helper binary with:

```bash
set KRAKEN_RUST_BACKEND_BIN=C:\full\path\to\kraken-unleashed-backend.exe
```

## Project Layout

- `frontend-electron/` - Electron main process, preload bridge, renderer UI, and app assets
- `backend-rust/` - native Windows backend helper used for detection and device writes
- `gifs/` - local GIF library
- `gifs/uploads/` - imported and search-downloaded GIFs
- `.electron-data/` - cached app state and presets

## Safety Notes

- this app writes directly to the LCD device over USB
- use it at your own risk
- keep vendor control software closed while deploying
- non-GIF modes are not implemented yet, even if the roadmap includes them

## Roadmap

- SignalRGB integration
- loop controls to help organize and fine-tune perfect seamless GIF loops
- more modes beyond GIF-only, including slideshow, web integration, clock, text, and music mode

## License

Licensed under `AGPL-3.0-only`. See [LICENSE](./LICENSE).
