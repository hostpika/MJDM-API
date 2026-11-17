# MJDM v1.0 Launch Announcements & Media Pack

## 1. Product Hunt Launch

**Title:** MJDM — IDM-class download manager built in Rust for Windows & Linux  
**Tagline:** Accelerate your downloads up to 500% with zero bloat and zero-knowledge privacy.  
**Topics:** Windows, Linux, Developer Tools, Open Source, Productivity  

### Maker Comment:
> Hey Product Hunt! 👋
> 
> For more than two decades, Internet Download Manager (IDM) set the gold standard for multi-segment file downloading. But in 2026, many of us run modern 64-bit systems, dual-boot Linux, use high-DPI displays, and care deeply about privacy.
> 
> That’s why we built **MJDM** — a modern, IDM-class download accelerator engineered natively in Rust and Web technologies:
> 
> ⚡ **Up to 32 Parallel Streams:** Dynamically re-splits connections to completely saturate your broadband connection.  
> 🐧 **Cross-Platform:** Native support for Windows 10/11 and modern Linux (Debian, Ubuntu, Fedora, Arch, Flatpak).  
> 🌐 **Manifest V3 Browser Integration:** Seamless link interception and media sniffing for Chrome and Firefox with an instant *fail-open* guarantee.  
> 🛡️ **Zero-Knowledge Cloud Sync:** Sync your queues, categories, and settings across devices with client-side Argon2id + AES-256-GCM encryption. We never see your download links.  
> 💸 **Fair Regional Pricing:** Standard $24.95 lifetime, with full Purchasing Power Parity (৳999 BDT) for emerging markets.
> 
> We’d love to hear your thoughts, feature requests, and benchmarks in the comments below! 🚀

---

## 2. Hacker News Show HN

**Title:** Show HN: MJDM – IDM-class download accelerator written in Rust for Windows & Linux

### Body:
> Hi HN,
> 
> I built MJDM (https://mjdm.app), a high-performance native download manager designed to replace classic IDM without ads, telemetry, or proprietary lock-in.
> 
> **Why write another download manager in 2026?**
> 1. Most browsers open a single TCP stream per download, leaving Gigabit and high-latency links vastly underutilized.
> 2. Existing multi-threaded managers often suffer from UI bloat, lack Linux support, or bundle adware.
> 3. Cloud synchronization services typically store your personal download history on third-party servers.
> 
> **Architecture Highlights:**
> - **Core Engine:** Written in pure async Rust (Tokio/Reqwest). Supports up to 32 dynamic multi-segment ranges with sparse zero-fill on NTFS and fallocate on Linux.
> - **UI Shell:** Tauri 2 + React + TypeScript with zero runtime overhead and low RAM footprint (~40 MB).
> - **Browser Bridge:** A 1.2 MB companion binary (`mjdm-nmhost`) speaking native-endian JSON over stdin/stdout. It uses a strict *fail-open* invariant: if the desktop app is closed, downloads fall back to the browser in < 50 ms.
> - **Zero-Knowledge Sync:** E2EE using Argon2id for KDF, HKDF-SHA256, and AES-256-GCM. The cloud API only sees opaque blobs and HLC timestamps.
> 
> The desktop app is fully functional offline without any cloud dependency. Would love to hear your feedback on the architecture and performance!

---

## 3. Reddit Announcement (r/software, r/privacy, r/linux)

**Title:** [Release] MJDM 1.0 – A modern, lightweight IDM alternative for Windows & Linux (Rust-powered, 32-stream turbo, E2EE sync)

### Post Body:
> Hey everyone,
> 
> If you have been looking for a fast, modern alternative to Internet Download Manager that works properly on both Windows and Linux, check out MJDM (https://mjdm.app).
> 
> Key features:
> - 32 parallel TCP connection multi-segmenting
> - Chrome / Edge / Firefox extensions (Manifest V3)
> - Audio/Video media sniffer panel
> - Bandwidth speed limiter with token-bucket accuracy
> - Batch downloading & site grabber
> - CLI headless tool (`mjdm`) for scripts and servers
> - Zero telemetry, no ads, completely offline-first
> 
> Available as an NSIS installer and portable ZIP on Windows, and AppImage, .deb, .rpm, Flatpak, and AUR (`yay -S mjdm-bin`) on Linux.

---

## 4. Bangladeshi Tech Community Announcement (Bilingual)

**বাংলা:**
> আসসালামু আলাইকুম সবাইকে! 🇧🇩
> 
> যারা উইন্ডোজ বা লিনাক্সে দ্রুত ফাইল ডাউনলোডের জন্য দীর্ঘদিন ধরে একটি আধুনিক ও নির্ভরযোগ্য সফটওয়্যার খুঁজছিলেন, তাদের জন্য উন্মুক্ত হলো **MJDM (MJ Download Manager) v1.0**!
> 
> এটি সম্পূর্ণ রাস্টে (Rust) তৈরি একটি আধুনিক আইডিএম-মানের ডাউনলোড ম্যানেজার যা আপনার ইন্টারনেট লাইনের সর্বোচ্চ গতি (৩২টি সমান্তরাল স্ট্রিমে) নিশ্চিত করে।
> 
> প্রধান সুবিধাসমূহ:
> - উইন্ডোজ ও লিনাক্স উভয় অপারেটিং সিস্টেমে সরাসরি চলে
> - ক্রোম ও ফায়ারফক্স ব্রাউজারের জন্য দ্রুতগতির এক্সটেনশন
> - অটোমেটিক শিডিউলার ও স্পিড কন্ট্রোলার
> - কোনো বিজ্ঞাপন বা ট্র্যাকিং নেই
> - বিকাশ/নগদে লোকাল প্যারিটি প্রাইসিং (আজীবন লাইসেন্স মাত্র ৯৯৯ টাকা) এবং ১৪ দিনের ১০০% মানি-ব্যাক গ্যারান্টি!
> 
> ডাউনলোড করুন: https://mjdm.app
