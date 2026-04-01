<p align="center">
  <img src="./assets/readme-banner.svg" alt="Kraken Unleashed banner" width="100%" />
</p>

<h1 align="center">Kraken Unleashed</h1>

<p align="center">
  Push GIFs directly to supported Kraken LCD coolers from a fast native desktop app.
</p>

<p align="center">
  Windows-native device control | Placement editor | Signed Windows releases
</p>

<p align="center">
  <a href="https://github.com/Cesarsk/kraken-unleashed/releases">Download for Windows</a>
  |
  <a href="#supported-devices">Supported Devices</a>
  |
  <a href="#build-from-source">Build From Source</a>
</p>

Kraken Unleashed is a desktop app for writing animated GIFs straight to supported Kraken LCD coolers. It focuses on the part that matters: detect the screen, line up the asset properly, deploy it cleanly, and recover fast if the display gets stuck.

This project is independent and is not affiliated with or endorsed by NZXT.

## Why People Use It

- direct GIF deployment over USB
- native detection of supported LCD devices
- brightness control, display shutdown, and recovery actions
- per-GIF zoom, pan, and rotation presets
- a local gallery workflow that stays simple

## What You Can Do Today

- upload a GIF and keep it in a local gallery
- preview and fine-tune how it sits inside the LCD circle
- rotate the display output before deployment
- write the GIF directly to the cooler LCD
- restore the display if the screen needs a clean reset

Current status:

- platform target: Windows
- media support today: GIF only
- native backend actions: `info`, `brightness`, `recover`, and `write`

## Download

If you just want to use the app, grab the latest Windows build from GitHub releases:

- [Latest Releases](https://github.com/Cesarsk/kraken-unleashed/releases)

Release builds package the Electron app together with the Rust backend helper. Official release artifacts are intended to be signed through the repository release pipeline.

## Supported Devices

Validated in this app:

- `Kraken Elite RGB 2024` / `Kraken Elite V2` (`PID 0x3012`)

Also listed in the compatibility view:

- `Kraken Elite 2023` (`PID 0x300C`) - supported backend path
- `Kraken Z3` (`PID 0x3008`) - legacy support path

More device support is planned, and community validation is welcome.

## Workflow

1. Launch the app and let it detect the connected LCD.
2. Upload a GIF and select it from the local gallery.
3. Open the editor to adjust zoom, pan, and rotation.
4. Deploy the prepared GIF to the display.
5. Use `Restore Liquid Screen` if the LCD needs a clean reset.

## Build From Source

### Requirements

- Windows
- Node.js with `npm`
- Rust toolchain with `cargo`
- a supported Kraken LCD connected over USB

For release packaging, use Node.js `22.x` so the Electron packaging toolchain matches CI.

### Run the app locally

From the repo root:

```bash
npm install
npm run backend:stage
npm start
```

`npm run backend:stage` builds the Rust helper and stages it where Electron will find it first.

### Build a packaged Windows app

From the repo root:

```bash
npm install
npm run dist:win
```

This produces Windows release artifacts in `dist/` and bundles the Rust backend into the packaged app under `resources/backend/`.

## Development Notes

The app prefers a compiled Rust backend helper for device-facing operations. The helper currently exposes these native commands:

- `info` - detect a supported Kraken LCD and report resolution details
- `brightness` - set LCD brightness from `0` to `100`
- `recover` - switch the screen back to the liquid display mode
- `write` - prepare and transfer a GIF directly to the device

Useful commands while developing:

```bash
cargo build --manifest-path backend-rust/Cargo.toml
cargo build --release --manifest-path backend-rust/Cargo.toml
npm run backend:stage
npm run dist:win
```

You can also point Electron at a custom helper binary with:

```bash
set KRAKEN_RUST_BACKEND_BIN=C:\full\path\to\kraken-unleashed-backend.exe
```

## Safety Notes

- this app writes directly to the LCD device over USB
- use it at your own risk
- keep competing control software closed while deploying
- non-GIF modes are not implemented yet, even if they appear in the roadmap

## Release Pipeline

GitHub Actions automation is defined in [`.github/workflows/release.yml`](./.github/workflows/release.yml) and [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

- every merge to `main` builds the Windows installer, generates `SHA256SUMS.txt`, and updates the rolling `edge` prerelease on GitHub
- pushing a tag like `v1.0.0` builds the same installer assets and publishes a stable GitHub release for that tag
- the workflow validates that a stable tag matches the `package.json` version before publishing
- pull requests into `main` are validated by CI before release flow changes land

If you add a repository secret named `VT_API_KEY`, the release workflow also uploads the generated Windows installer to VirusTotal and attaches a scan summary to the workflow run.

## Trust And Signing

Free code signing is provided by [SignPath.io](https://about.signpath.io/), with a certificate from [SignPath Foundation](https://signpath.org/).

### Roles

- Committer and reviewer: [Cesarsk](https://github.com/Cesarsk)
- Approver: [Cesarsk](https://github.com/Cesarsk)

### Scope

Only official release artifacts built from the source code in this repository and published through this project's release process are eligible for signing.

### Privacy

Privacy policy: [PRIVACY.md](./PRIVACY.md)

## Versioning

Stable releases follow SemVer:

- `v1.0.1` for fixes and packaging-only updates
- `v1.1.0` for new user-facing features or support for more devices without breaking existing flows
- `v2.0.0` for breaking changes in packaging, CLI behavior, config layout, or compatibility expectations

Recommended release model:

- `main` stays releasable and publishes the rolling `edge` prerelease automatically
- stable releases happen only when `package.json` is intentionally bumped and a matching `vX.Y.Z` tag is created
- GitHub release assets should include the installer, metadata files, and `SHA256SUMS.txt` so users can verify what they install

## Roadmap

- SignalRGB integration
- CLI support for scripted usage and automation
- loop controls to help organize and fine-tune perfect seamless GIF loops
- more modes beyond GIF-only, including slideshow, web integration, clock, text, and music mode
- broader cooler model support, with community contributions welcome for adding and validating more devices

## Contributing

Contributions are welcome, especially for expanding cooler support.

If you want to add or validate a new model, include as much of this as you can:

- exact cooler model name
- USB `VID` and `PID`
- detected screen resolution
- whether detection, brightness, recovery, and GIF deploy all work
- logs, screenshots, or short notes about anything unusual

Hardware validation from real devices is especially useful.

## License

Licensed under `AGPL-3.0-only`. See [LICENSE](./LICENSE).
