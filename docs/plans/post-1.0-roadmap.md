# MJDM Post-1.0 Roadmap & Engineering Backlog

**Reference:** Master Plan §3.3 & §16.4  
**Date:** November 16, 2026  
**Status:** Approved  

---

## 1. Post-1.0 Strategic Vision

With the completion and general availability of **v1.0.0**, the core IDM-class engine, Tauri desktop app, browser extension, and zero-knowledge E2EE cloud sync are fully established.

The post-1.0 cycle follows a disciplined two-track process:
1. **First 30 Days (Stabilization & Patching):** Weekly patch releases (`v1.0.1`, `v1.0.2`), crash triage, Store submission follow-ups (CWS, AMO, Edge), and community feedback response.
2. **Feature Releases (v1.1 – v1.5):** Architectural enhancements, new platform targets, and advanced cloud integrations.

---

## 2. Release Milestones (v1.1 to v1.5)

### Milestone v1.1: Native macOS Universal Port
- **Scope:**
  - Port Tauri desktop shell to macOS (Universal binary: Apple Silicon arm64 + Intel x86_64).
  - Apple Developer ID codesigning and automated `notarytool` notarization in GitHub Actions CI.
  - Native Cocoa menu bar integration, dark/light theme alignment, and Command-key shortcuts.
  - Safari browser extension using WebExtension to Native App bridge.
- **Estimated Effort:** 3 weeks.

### Milestone v1.2: Mobile PWA & iOS / Android Companion
- **Scope:**
  - Progressive Web App (PWA) remote controller with touch-first UI (`desktop/remote-ui`).
  - QR-code instant local network pairing using Ed25519 handshake.
  - Push notifications via Web Push API for download completion and disk space warnings.
  - Android/iOS share target: send links directly from mobile browsers to home desktop.
- **Estimated Effort:** 3 weeks.

### Milestone v1.3: E2EE Remote Relay
- **Scope:**
  - Secure remote control outside the local area network without requiring public router port forwarding or dynamic DNS.
  - WebRTC / TLS encrypted relay tunnel with end-to-end authentication.
  - Zero relay visibility: relay server only forwards opaque encrypted ciphertext packets.
- **Estimated Effort:** 4 weeks.

### Milestone v1.4: BYO-Storage (Bring Your Own Storage) Sync
- **Scope:**
  - Alternative to MJDM-hosted cloud sync for users with private infrastructure.
  - WebDAV target support (Nextcloud, ownCloud, Synology NAS).
  - Google Drive, Dropbox, and Amazon S3 encrypted bucket destination targets.
- **Estimated Effort:** 3 weeks.

### Milestone v1.5: Sandboxed Plugin SDK & Custom Site Resolvers
- **Scope:**
  - Extensible plugin architecture for custom video extractors and protected file hosts.
  - WebAssembly (Wasm) or sandboxed Python runtime preventing unauthorized file system or network access.
  - Community plugin repository with cryptographic signature verification.
- **Estimated Effort:** 4 weeks.

---

## 3. Backlog Priorities & Tracking

| Feature ID | Feature Name | Target Milestone | Priority | Risk Profile |
|---|---|---|---|---|
| `POST-01` | macOS Universal Binary + Notarization | `v1.1` | P1 | Low (Tauri supports macOS natively) |
| `POST-02` | Mobile Remote PWA + QR Pairing | `v1.2` | P2 | Low (Local JSON-RPC already active) |
| `POST-03` | E2EE Remote Tunnel Relay | `v1.3` | P2 | Medium (WebRTC NAT traversal) |
| `POST-04` | WebDAV & S3 Cloud Targets | `v1.4` | P3 | Low (Standard protocols) |
| `POST-05` | Sandboxed Wasm/Python Plugin SDK | `v1.5` | P3 | Medium (Security sandboxing invariant) |
