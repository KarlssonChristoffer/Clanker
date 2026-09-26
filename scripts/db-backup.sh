#!/usr/bin/env bash
# Nightly Postgres backup for the Clanker stack (clanker-db container) with rotation.
#
#   daily/   one custom-format dump per day, the newest KEEP_DAILY are kept   (default 7)
#   weekly/  a hard-linked copy made on WEEKLY_DAY, the newest KEEP_WEEKLY kept (default 4)
#
# Usage (from anywhere):  scripts/db-backup.sh
# Restore one file:       docker exec -i clanker-db pg_restore -U clanker -d clanker_discord --clean --if-exists --no-owner < FILE
#
# Environment (all optional; POSTGRES_* are also read from the repo .env):
#   BACKUP_DIR      target directory                        (default /var/backups/clanker)
#   PG_CONTAINER    postgres container name                 (default clanker-db)
#   POSTGRES_USER   database role                           (default clanker)
#   BACKUP_DBS      space-separated database names          (default "$POSTGRES_DB $POSTGRES_EXTRA_DB")
#   KEEP_DAILY      daily dumps to keep                     (default 7)
#   KEEP_WEEKLY     weekly dumps to keep                    (default 4)
#   WEEKLY_DAY      ISO weekday for the weekly copy, 1=Mon  (default 7 = Sunday)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pick up POSTGRES_* from the repo .env without exporting everything else in it.
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      POSTGRES_USER | POSTGRES_DB | POSTGRES_EXTRA_DB)
        value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
        [[ -z "${!key:-}" ]] && printf -v "$key" '%s' "$value"
        ;;
    esac
  done < <(grep -E '^(POSTGRES_USER|POSTGRES_DB|POSTGRES_EXTRA_DB)=' "$REPO_ROOT/.env" || true)
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/clanker}"
PG_CONTAINER="${PG_CONTAINER:-clanker-db}"
POSTGRES_USER="${POSTGRES_USER:-clanker}"
POSTGRES_DB="${POSTGRES_DB:-clanker_discord}"
POSTGRES_EXTRA_DB="${POSTGRES_EXTRA_DB:-clanker_devtools}"
BACKUP_DBS="${BACKUP_DBS:-$POSTGRES_DB $POSTGRES_EXTRA_DB}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
WEEKLY_DAY="${WEEKLY_DAY:-7}"

log() { printf '%s db-backup: %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
chmod 700 "$BACKUP_DIR"

# One run at a time (cron + manual run overlapping).
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || fail "another backup is already running"

docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -qx true \
  || fail "container $PG_CONTAINER is not running"

stamp="$(date +%Y-%m-%d_%H%M)"
today_iso_weekday="$(date +%u)"
status=0

# Remove all but the newest N files matching a glob (names sort chronologically).
prune() {
  local keep="$1"; shift
  local files=()
  mapfile -t files < <(ls -1 "$@" 2>/dev/null | sort -r)
  if ((${#files[@]} > keep)); then
    for f in "${files[@]:keep}"; do
      rm -f -- "$f"
      log "pruned $(basename "$f")"
    done
  fi
}

for db in $BACKUP_DBS; do
  exists="$(docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$db'" 2>/dev/null || true)"
  if [[ "$exists" != "1" ]]; then
    log "skip $db (database does not exist)"
    continue
  fi

  target="$BACKUP_DIR/daily/${db}_${stamp}.dump"
  tmp="$target.partial"
  log "dumping $db -> $target"
  if ! docker exec "$PG_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$db" -Fc >"$tmp"; then
    rm -f -- "$tmp"
    log "ERROR: pg_dump failed for $db" >&2
    status=1
    continue
  fi
  # Sanity check: the archive must have a readable table of contents.
  if ! docker exec -i "$PG_CONTAINER" pg_restore -l <"$tmp" >/dev/null; then
    rm -f -- "$tmp"
    log "ERROR: dump for $db is not a readable archive" >&2
    status=1
    continue
  fi
  mv -- "$tmp" "$target"
  chmod 600 "$target"
  log "ok $db ($(du -h "$target" | cut -f1))"

  if [[ "$today_iso_weekday" == "$WEEKLY_DAY" ]]; then
    ln -f -- "$target" "$BACKUP_DIR/weekly/$(basename "$target")"
    log "weekly copy for $db"
  fi

  prune "$KEEP_DAILY" "$BACKUP_DIR"/daily/"${db}"_*.dump
  prune "$KEEP_WEEKLY" "$BACKUP_DIR"/weekly/"${db}"_*.dump
done

exit "$status"
