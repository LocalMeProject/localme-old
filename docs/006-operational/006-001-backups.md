---
id: repo:localme/operational/backups
parent: repo:localme/operational
title: Backups
level: repo
kind: runbook
domains:
  - data
keywords:
  - backup
  - restore
  - snapshot
---

# Backups

The platform includes a built-in backup CLI to snapshot and restore data. It safely dumps data whether using SQLite (`VACUUM INTO`) or Postgres (`pg_dump`).

## Commands

```bash
npm run backup                       # Snapshot and prune past retention limit (30 days)
npm run backup -- --list             # List available backups on disk
npm run backup -- --verify <file>    # Verify the integrity of a snapshot archive
npm run backup -- --restore <file>   # Restore a snapshot to the database
npm run backup -- --dir /mnt/backups --db file:/var/lib/localme/localme.db
```

Backups are designed to be run manually or triggered via systemd/cron jobs externally.
