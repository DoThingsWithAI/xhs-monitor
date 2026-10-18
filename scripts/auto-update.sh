#!/usr/bin/env bash
# Ubuntu host job: daily fast-forward + validated Compose deployment.
# Called by xhs-monitor-auto-update.timer, or manually by deploy.sh update.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
STATE_DIR="/var/lib/xhs-monitor-deploy"
LOCK_FILE="/run/lock/xhs-monitor-auto-update.lock"
EXPECTED_REMOTE="DoThingsWithAI/xhs-monitor"
log() { printf '[xhs-auto-update] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Must run as root (systemd service runs as root)."
command -v flock >/dev/null || die "flock not available (install util-linux)."
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "Another deployment/update holds the lock; skipping overlapping run."
  exit 0
fi

install -d -m 0700 "${STATE_DIR}"
write_state() {
  local content="$1" target="$2" tmp
  tmp="$(mktemp "${STATE_DIR}/.state-XXXXXX")"
  printf '%s\n' "${content}" >"${tmp}"
  chmod 0600 "${tmp}"
  mv -f -- "${tmp}" "${STATE_DIR}/${target}"
}
on_error() {
  local rc="$1"
  write_state "failed $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=${rc}" "last-status"
  log "FAILED (exit=${rc}); check: journalctl -u xhs-monitor-auto-update.service -n 100 --no-pager" >&2
}
trap 'rc=$?; if [[ "${rc}" -ne 0 ]]; then on_error "${rc}"; fi' EXIT

[[ -d "${REPO_DIR}/.git" ]] || die "Not a Git checkout: ${REPO_DIR}"
command -v git >/dev/null || die "git is missing."
command -v docker >/dev/null || die "Docker is missing."
docker compose version >/dev/null || die "Docker Compose v2 is missing."
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable."
[[ -f "${REPO_DIR}/.env" ]] || die "Missing .env; first complete initial deployment."
[[ "$(git -C "${REPO_DIR}" branch --show-current)" == main ]] || die "Only main branch can auto-update."
[[ -z "$(git -C "${REPO_DIR}" status --porcelain --untracked-files=no)" ]] ||
  die "Tracked local changes exist; refusing to overwrite them."

remote="$(git -C "${REPO_DIR}" remote get-url origin)"
case "${remote}" in
  "https://github.com/${EXPECTED_REMOTE}"|"https://github.com/${EXPECTED_REMOTE}.git"|"git@github.com:${EXPECTED_REMOTE}.git"|"git@github.com:${EXPECTED_REMOTE}") ;;
  *) die "Git origin does not match expected ${EXPECTED_REMOTE}; refusing untrusted update." ;;
esac

log "Checking origin/main for new commits (no credentials are printed)..."
git -C "${REPO_DIR}" fetch --quiet --no-tags origin refs/heads/main
remote_sha="$(git -C "${REPO_DIR}" rev-parse FETCH_HEAD)"
local_sha="$(git -C "${REPO_DIR}" rev-parse HEAD)"
git -C "${REPO_DIR}" merge-base --is-ancestor "${local_sha}" "${remote_sha}" ||
  die "Remote main is not a fast-forward; no reset or force pull will occur."

last_deployed="$(cat "${STATE_DIR}/last-success-sha" 2>/dev/null || true)"
if [[ "${remote_sha}" == "${local_sha}" && "${last_deployed}" == "${local_sha}" &&
      "${XHS_UPDATE_FORCE:-0}" != 1 ]]; then
  log "No new commit; deployed version ${local_sha:0:12} already current. No rebuild or restart."
  write_state "unchanged $(date -u +%Y-%m-%dT%H:%M:%SZ) ${local_sha}" "last-status"
  exit 0
fi

if [[ "${remote_sha}" != "${local_sha}" ]]; then
  log "Fast-forward ${local_sha:0:12} -> ${remote_sha:0:12}"
  git -C "${REPO_DIR}" merge --ff-only "${remote_sha}"
else
  log "Rechecking current commit ${local_sha:0:12} (not marked successfully deployed, or manual forced run)."
fi

# The updated deploy.sh does preflight builds/tests BEFORE restarting containers.
# No git reset/force checkout; failed upgrades stay visible and retry next morning.
XHS_SCHEDULED_RUN=1 bash "${REPO_DIR}/scripts/deploy.sh" deploy

deployed_sha="$(git -C "${REPO_DIR}" rev-parse HEAD)"
write_state "${deployed_sha}" "last-success-sha"
write_state "success $(date -u +%Y-%m-%dT%H:%M:%SZ) ${deployed_sha}" "last-status"
log "Deployment verified at ${deployed_sha:0:12}."
