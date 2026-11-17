# Third-Party Open Source Licenses & Notices

MJDM utilizes open-source libraries and frameworks. We are deeply grateful to the open-source community.

## 1. Rust Core Engine & Crates
The following open-source Rust crates are incorporated into the desktop engine and native companion:
- **reqwest** (Apache-2.0 / MIT) — Async HTTP client library.
- **tokio** (MIT) — Asynchronous runtime for Rust.
- **tauri** (Apache-2.0 / MIT) — Desktop application framework.
- **ring** / **aes-gcm** / **argon2** (ISC / Apache-2.0 / MIT) — Cryptographic primitives and KDFs.
- **sqlx** / **rusqlite** (Apache-2.0 / MIT) — Embedded database driver.
- **serde** / **serde_json** (Apache-2.0 / MIT) — High-performance serialization framework.
- **librqbit** (Apache-2.0) — BitTorrent protocol engine.

## 2. Frontend & Web Applications
- **React** (MIT) — User interface library by Meta Open Source.
- **Next.js** (MIT) — React web framework by Vercel.
- **Tailwind CSS** (MIT) — Utility-first CSS framework.
- **Lucide Icons** (ISC) — Modern, lightweight open-source icon suite.
- **Zustand** (MIT) — Minimalist state management for React.
- **WXT** (MIT) — Next-gen Web Extension framework.

## 3. Sidecars & External Tools
- **FFmpeg** (LGPL v2.1+ / v3.0) — If installed by the user, FFmpeg runs in an isolated subprocess sidecar without static linking.
- **yt-dlp** (Unlicense) — Optional user-configured extractor running as a separate standalone subprocess.
