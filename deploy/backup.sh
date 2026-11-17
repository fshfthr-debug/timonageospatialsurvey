#!/usr/bin/env bash
# Daily backup of the database and the uploads volume.
#
#   chmod +x deploy/backup.sh
#   sudo crontab -e
#   15 2 * * * /opt/sitetrackerpro/deploy/backup.sh >> /var/log/sitetrackerpro-backup.log 2>&1
#
# Keeps 14 days. Copy the folder somewhere else as well — a backup on the same
# disk as the database is not a backup.

set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/sitetrackerpro/deploy}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sitetrackerpro}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_NAME="${DB_NAME:-sitetrackerpro_v3_enhanced}"
DB_USER="${DB_USER:-sitetrackerpro}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%FT%TZ)] dumping database $DB_NAME"
docker compose --project-directory "$COMPOSE_DIR" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip -9 > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[$(date -u +%FT%TZ)] archiving uploads"
# Volume name is fixed by "name: sitetrackerpro" in docker-compose.yml.
docker run --rm \
  -v sitetrackerpro_uploads:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine:3 tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

find "$BACKUP_DIR" -maxdepth 1 -name '*.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date -u +%FT%TZ)] done: $(ls -1 "$BACKUP_DIR" | tail -2 | tr '\n' ' ')"
