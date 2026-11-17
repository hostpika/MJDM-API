# Changelog

All notable changes to the MJDM (MJ Download Manager) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-16 — General Availability Release

### Added
- **Multi-Segment Turbo Engine (`mjdm-engine`):**
  - Dynamic splitting of downloads into up to 32 concurrent TCP streams.
  - Low-overhead pre-allocation with NTFS sparse zero-fill and Linux `fallocate`.
  - Crash-resilient part-file assembly and SHA-256 integrity verification.
  - HTTP/1.1, HTTP/2, HTTPS, and SOCKS5/HTTP proxy support with connection pooling.
- **Classic IDM-Class Desktop UI (`desktop`):**
  - High-performance virtualized download list handling 10,000+ items smoothly at 60 FPS.
  - Native Windows 10/11 & Linux theming (Light/Dark themes, high-contrast mode).
  - Rich toolbar, category sidebar, and detailed download progress modal dialogs.
  - Full bilingual localization: 100% native English and Bengali (বাংলা) resource bundles.
- **Browser Extension & Native Bridge (`extension`):**
  - Manifest V3 browser integration for Google Chrome, Mozilla Firefox, Microsoft Edge, Brave, and Opera.
  - Ultra-fast 1.2 MB Rust companion binary (`mjdm-nmhost`) communicating via stdio IPC.
  - Strict *fail-open* architecture: browser resumes downloads within 50 ms if desktop app is offline.
  - Single-purpose policy compliance (§8.9) with zero remote analytics.
- **Media Pipeline & Sniffer (`crates/mjdm-media`):**
  - In-browser floating video & audio sniffer overlay with multi-resolution selection (1080p, 720p, audio-only).
  - HLS (`.m3u8`) and MPEG-DASH (`.mpd`) stream parsing and segment downloading.
  - Dynamic muxing of separated video/audio streams via isolated FFmpeg sidecar.
- **Queues, Scheduler & Speed Limiter (`crates/mjdm-scheduler`):**
  - Multi-queue management (Download Later, Work, Night-owl scheduler).
  - Bandwidth limiter powered by Token-Bucket algorithm (accurate to ±5%).
  - Post-completion actions (Sleep, Hibernate, Shutdown) with 30-second user-cancellable countdown.
- **BitTorrent & Magnet Links (`crates/mjdm-torrent`):**
  - Fully integrated BitTorrent 1.0/2.0 protocol engine powered by `librqbit`.
  - Sequential downloading mode for immediate video preview while downloading.
  - Per-torrent bandwidth allocation and DHT/PEX peer discovery.
- **Headless CLI & Local JSON-RPC API (`crates/mjdm-cli`, `crates/mjdm-ipc`):**
  - Headless CLI (`mjdm add`, `mjdm list`, `mjdm pause`, `mjdm resume`, `mjdm daemon`).
  - Local JSON-RPC 2.0 server over Windows Named Pipes (`\\.\pipe\mjdm-rpc`) and Linux Unix Sockets.
  - Server-Sent Events (SSE) real-time event streaming for custom automation scripts.
- **Zero-Knowledge Cloud Sync (`crates/mjdm-sync`, `backend`):**
  - End-to-end encrypted (E2EE) cross-device synchronization for settings, categories, rules, and queues.
  - Argon2id key derivation, HKDF-SHA256, and AES-256-GCM envelope encryption with AAD.
  - 16-character Crockford Base32 Emergency Recovery Key (`XXXX-XXXX-XXXX-XXXX`).
  - Zero plaintext server guarantee: URLs, filenames, and authentication cookies are never sent to the cloud.
- **Marketing, Documentation & Packaging:**
  - Modern Next.js 15 marketing site (`frontend/website`) with bilingual EN/BN switch and interactive speed benchmark.
  - Comprehensive documentation portal (`/docs`) with Quickstart, CLI syntax, RPC API, and Troubleshooting.
  - Complete packaging manifests: Windows NSIS installer, Portable ZIP, Winget, Scoop, Debian `.deb`, AppImage, Fedora `.rpm`, Arch AUR (`mjdm-bin`), Flatpak, and Chocolatey.
  - Merchant of Record (Polar / Lemon Squeezy) tax compliance and regional Bangladesh PPP pricing (৳999 BDT).

### Security
- Audited zero-knowledge architecture with zero plaintext URLs in server databases or application logs.
- Memory-safe Rust implementation with zero `unwrap()` panics in production engine crates.
- Strict type-safety across frontend and monorepo packages with zero `any` or `@ts-ignore`.
