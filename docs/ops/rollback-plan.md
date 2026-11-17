# MJDM Disaster Recovery & Rollback Playbook

**Effective:** Production GA Release  
**Review Frequency:** Bi-annual  

## 1. Incident Severity Classification
- **Sev-1 (Critical Emergency):** Critical data loss bug, unhandled remote crash affecting > 5% of users, or security/private key compromise. Immediate rollback required.
- **Sev-2 (Major Bug):** Browser interception failure, broken cloud sync delta convergence, or payment activation outage. Rollback or hotfix within 4 hours.
- **Sev-3 (Minor Bug):** UI cosmetic defect, typo, or edge-case locale format error. Queued for next scheduled minor release.

---

## 2. Desktop Application Rollback Procedure

If a newly deployed desktop version (`v1.0.X`) contains a critical regression:

### Step 1: Halt Auto-Update Distribution
Immediately set the rollout percentage of the bad release to 0% via the admin API:
```bash
curl -X POST https://api.mjdm.app/v1/admin/releases/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.1",
    "action": "halt_and_revert",
    "fallbackVersion": "1.0.0"
  }'
```

### Step 2: Demote Release Feed
Update `https://api.mjdm.app/v1/updates/:target/:arch/:currentVersion` so that querying clients receive the known-stable previous release payload.

### Step 3: Publish Hotfix Patch
Build and release `v1.0.2` containing the reverted commit with high priority, bypassing canary stages once validated through automated CI/CD suites.

---

## 3. Cryptographic Key Compromise Procedure (`ADR-013`)

If the Minisign release signing private key is suspected of compromise:
1. **Immediate Revocation Notice:** Post an official signed revocation alert to `https://mjdm.app/security/key-revocation.txt` and GitHub security advisories.
2. **Rotate Public Key in Update Feed:** Publish an emergency update manifest signed by a backup hardware security key (HSM).
3. **Blacklist Compromised Key:** Modern desktop clients automatically reject update packages signed by the revoked public key fingerprint.

---

## 4. Cloud API & Database Rollback Procedure

### Zero-Downtime Blue-Green Deployment Rollback
If the new cloud-api container exhibits unexpected latency or errors:
```bash
# Shift traffic immediately back to blue (stable) container cluster
docker service update --image registry.mjdm.app/cloud-api:1.0.0-stable mjdm_cloud_api
```

### Database Migration Rollback
1. Execute the down migration:
```bash
npm run typeorm migration:revert
# or
node dist/database/migrate.js --down
```
2. Restore from snapshot if schema corruption occurred:
```bash
/opt/mjdm/tools/ops/restore-db.sh /var/backups/mjdm/mjdm_backup_pre_deploy.sql.gz
```
