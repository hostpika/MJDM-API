# MJDM Cloud Sync — E2EE Privacy Review & Cryptographic Audit

**Document:** `docs/security/privacy-review-e2ee.md`  
**Phase:** `P11-T07` (Cloud Sync E2EE)  
**Date:** 2026-11-16  
**Status:** ✅ Verified & Approved  
**Constitution:** `MJDM-Master-Plan.md` §12.8, §13.4, §14  

---

## 1. Executive Summary

MJDM's Cloud Sync architecture is strictly **Zero-Knowledge** and **End-to-End Encrypted (E2EE)**.  
The download engine, desktop application, and browser extensions operate **offline-first**. When cloud sync is enabled by the user, client state is encrypted on the local device using **AES-256-GCM** with authenticated key derivation before transmission over TLS to the cloud API (`backend`).

The server never sees, parses, or stores plaintext download URLs, file names, destination folders, file contents, browser cookies, or authentication passwords.

---

## 2. Server Metadata vs. Client Zero-Knowledge Boundary

Honest and transparent demarcation of what the server knows versus what remains strictly opaque:

| Field | Visible to Cloud Server? | Encryption / Opaque State | Purpose / Justification |
|---|---|---|---|
| **Download URLs** | ❌ **NEVER** | Encrypted inside client blob | Protected under Zero-Knowledge guarantee |
| **Downloaded File Content** | ❌ **NEVER** | Never uploaded to cloud | Stored only on local client filesystem |
| **Local Folder Paths** | ❌ **NEVER** | Encrypted inside client blob | Protected under Zero-Knowledge guarantee |
| **Site Credentials & Passwords** | ❌ **NEVER** | Encrypted inside client blob | Protected under Zero-Knowledge guarantee |
| **Browser Cookies** | ❌ **NEVER** | Filtered and excluded from sync | Never synchronized across cloud |
| **Account ID** | ✅ Yes | Plaintext UUID | Identity binding and authorization |
| **Collection Domain** | ✅ Yes | Enum string (`settings`, `categories`...) | Selective sync and routing |
| **Record UUID** | ✅ Yes | Opaque UUIDv7 / UUIDv4 | Record identity for LWW upsert |
| **Hybrid Logical Clock (HLC)** | ✅ Yes | Monotonic timestamp/counter string | Distributed conflict resolution |
| **Encrypted Blob Payload** | ✅ Yes (Ciphertext only) | AES-256-GCM + Base64 envelope | Opaque storage for delta sync |
| **Blob Byte Size** | ✅ Yes | Integer (max 65,536 bytes) | Quota and rate-limit enforcement |

---

## 3. Cryptographic Invariants & Tamper-Proofing

1. **Associated Authenticated Data (AAD) Cryptographic Binding:**
   Every record ciphertext envelope binds AAD:
   $$\text{AAD} = \text{account\_id} \parallel \text{collection} \parallel \text{record\_id} \parallel \text{schema\_version}$$
   If a compromised server or attacker modifies any record metadata, swaps collections, or moves a record across accounts, AES-256-GCM authentication fails immediately (`CryptoError::AuthenticationFailed`).

2. **Master Key & Passphrase Security:**
   - 256-bit symmetric Master Key generated locally on client using cryptographically secure random entropy.
   - Wrapped via Argon2id / PBKDF2-HMAC-SHA256 Key Encryption Key (KEK).
   - 128-bit emergency recovery key formatted using Crockford Base32 (`XXXX-XXXX-XXXX-XXXX`) for zero-server recovery.
   - Sensitive key memory is automatically scrubbed on drop (`zeroize::Zeroize`).

3. **Storage Quotas & Denial-of-Service Defense:**
   - Per-record size limit: $\le 64\text{ KiB}$ (65,536 bytes).
   - Per-account record count: $\le 20,000\text{ records}$.
   - Per-account storage volume: $\le 5\text{ MiB}$ (5,242,880 bytes).
   - Pull page limit: $\le 500\text{ records}$ or $1\text{ MiB}$ cumulative per page.

---

## 4. GDPR Article 17 (Right to Erasure) & Cloud Data Purge

- `DELETE /v1/sync`: Instantly wipes all user sync records (`sync_records`) and cryptographic account setup metadata (`sync_accounts`).
- `DELETE /v1/account`: Cascades through all activations, registered devices, licenses, and sync blobs, leaving zero customer residue.
- Automated tests in `backend/test/privacy-audit.test.ts` verify zero lingering records post-deletion.

---

## 5. Automated Verification Evidence

- `backend/test/privacy-audit.test.ts`: Scans serialized server responses and storage dumps for sensitive test URLs, private intranet hosts, and credentials. **Found count: 0.**
- `crates/mjdm-sync/tests/multi_device_simulation.rs`: Verifies that tampering with AAD or attempting decryption with an unauthenticated key rejects safely without state corruption or panics.
