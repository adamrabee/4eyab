#!/usr/bin/env bash
# Local backup for HISSATI — does NOT contact GitHub or any remote.
# Produces:
#   1) a git bundle (full history, restorable with `git clone hissati-<ts>.bundle`)
#   2) a tar.gz snapshot of the working tree incl. uncommitted changes
#      (excludes node_modules, .next, secrets, DB volumes)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${BACKUP_DIR:-$ROOT/backups}"
TS="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
cd "$ROOT"

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git bundle create "$OUT/hissati-$TS.bundle" --all
  git bundle verify "$OUT/hissati-$TS.bundle" >/dev/null
  echo "bundle: $OUT/hissati-$TS.bundle"
fi

tar --exclude='./node_modules' --exclude='./.next' --exclude='./backups' \
    --exclude='./.git' --exclude='./supabase/volumes/data' --exclude='./supabase/volumes/storage' \
    --exclude='./.env' --exclude='./.env.local' --exclude='./.env.*.local' --exclude='./supabase/.env' \
    -czf "$OUT/hissati-src-$TS.tar.gz" .
echo "snapshot: $OUT/hissati-src-$TS.tar.gz"

# keep the 5 most recent of each
ls -1t "$OUT"/hissati-*.bundle 2>/dev/null | tail -n +6 | xargs -r rm -f
ls -1t "$OUT"/hissati-src-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
