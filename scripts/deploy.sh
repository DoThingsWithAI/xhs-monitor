#!/usr/bin/env bash
# XHS Monitor - Ubuntu single VPS deployment entrypoint
# Usage: sudo bash scripts/deploy.sh [doctor|prepare|install-docker|deploy|update|backup|status]
# Default command: deploy
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
COMPOSE_FILE="${REPO_DIR}/deploy/compose.yaml"
ENV_FILE="${REPO_DIR}/.env"
ENV_EXAMPLE="${REPO_DIR}/.env.example"
PROJECT_NAME="xhs-monitor"
DEFAULT_DATA_DIR="/var/lib/xhs-monitor"
APP_UID=10001
APP_GID=10001

log()  { printf '[xhs-monitor] %s\n' "$*"; }
warn() { printf '[xhs-monitor] WARNING: %s\n' "$*" >&2; }
die()  { printf '[xhs-monitor] ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Usage: sudo bash scripts/deploy.sh <command>
  doctor          Non-destructive Ubuntu/Docker/Compose and repo check
  prepare         Initialize .env (never overwrite) and persistent data directory
  install-docker  Explicit opt-in install from Docker's official Ubuntu apt repository
  deploy          Deploy / redeploy this project's web, worker and caddy containers
  update          Fast-forward git pull then run deployment (no hard reset)
  backup          Consistent online SQLite backup to /var/backups/xhs-monitor/
  status          List this project's Compose containers
  schedule        Install/enable daily 08:00 GitHub auto-update (systemd)
  schedule-status Show next scheduled run and recent outcome
  unschedule      Stop daily auto-updates (does NOT stop application)
  help            Print this help

Default command is "deploy". Application sources exist; production deployment still requires
a valid domain, free HTTP(S) ports, working Docker and a successful Chromium smoke check.
HELP
}
require_root() { [[ "$(id -u)" -eq 0 ]] || die "Run with sudo/root (no actions performed)."; }
check_os() {
  [[ -r /etc/os-release ]] || die "Cannot detect operating system."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == ubuntu ]] || die "Only Ubuntu is supported (detected: ${ID:-unknown})."
  case "${VERSION_ID:-}" in
    22.04|24.04|26.04) ;;
    *) die "Unsupported Ubuntu ${VERSION_ID:-unknown}; supported: 22.04, 24.04, 26.04." ;;
  esac
  case "$(uname -m)" in
    x86_64|aarch64) ;;
    *) die "Unsupported architecture: $(uname -m)." ;;
  esac
  log "Detected Ubuntu ${VERSION_ID} / $(uname -m) / $(uname -r)"
}
has_docker() { command -v docker >/dev/null 2>&1; }
has_compose() { has_docker && docker compose version >/dev/null 2>&1; }
require_docker() {
  has_docker || die "Docker not installed. First run: sudo bash scripts/deploy.sh install-docker"
  has_compose || die "Docker Compose v2 plugin missing. Install it using the official Docker apt repository; existing Docker was NOT modified."
  docker info >/dev/null 2>&1 || die "Docker daemon unavailable. Check 'systemctl status docker' and Docker access."
}
data_dir() {
  local path="${XHS_DATA_DIR:-}"
  if [[ -z "${path}" && -f "${ENV_FILE}" ]]; then
    path="$(awk -F= '$1=="XHS_DATA_DIR" {print substr($0, index($0,"=")+1); exit}' "${ENV_FILE}")"
  fi
  path="${path:-${DEFAULT_DATA_DIR}}"
  [[ "${path}" == /* ]] || die "XHS_DATA_DIR must be an absolute path."
  [[ "${path}" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die "XHS_DATA_DIR contains unsupported characters."
  [[ "${path}" != *..* ]] || die "XHS_DATA_DIR cannot contain '..'."
  case "${path%/}" in
    ""|/|/etc|/root|/home|/opt|/var|/var/lib|/usr|/tmp) die "XHS_DATA_DIR is too broad / unsafe." ;;
  esac
  printf '%s\n' "${path%/}"
}
initialize_env() {
  if [[ -e "${ENV_FILE}" ]]; then
    [[ ! -L "${ENV_FILE}" ]] || die ".env must not be a symlink."
    log "Keeping existing .env (not overwritten)."
  else
    [[ -f "${ENV_EXAMPLE}" ]] || die "Missing .env.example; cannot prepare deployment."
    install -m 0600 "${ENV_EXAMPLE}" "${ENV_FILE}"
    log "Created .env from .env.example; edit secrets and domain before production deployment."
  fi
  chmod 0600 "${ENV_FILE}"
  # Generate a random session secret only when the setting has not been defined.
  # A future app implementation must consume SESSION_SECRET without echoing it.
  if ! grep -q '^SESSION_SECRET=' "${ENV_FILE}"; then
    command -v python3 >/dev/null 2>&1 || die "Install python3 to generate the SESSION_SECRET."
    local secret
    secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
    printf 'SESSION_SECRET=%s\n' "${secret}" >>"${ENV_FILE}"
    log "Generated private SESSION_SECRET in .env (value hidden)."
  fi
}
validate_app_env() {
  local domain
  domain="$(awk -F= '$1=="APP_DOMAIN" {print substr($0, index($0,"=")+1); exit}' "${ENV_FILE}")"
  [[ -n "${domain}" && "${domain}" != "CHANGE_ME" ]] || die "Set APP_DOMAIN to your own DNS name in .env before deployment."
  grep -Eq '^SESSION_SECRET=.{40,}$' "${ENV_FILE}" || die "SESSION_SECRET missing or too short."
}
prepare_data_dir() {
  local dir; dir="$(data_dir)"
  [[ ! -L "${dir}" ]] || die "Refusing symlink data directory: ${dir}"
  if [[ ! -e "${dir}" ]]; then
    install -d -m 0770 "${dir}"
    chown "${APP_UID}:${APP_GID}" "${dir}"
    log "Created persistent data directory ${dir} (UID/GID ${APP_UID}:${APP_GID})."
  else
    [[ -d "${dir}" ]] || die "Data directory path is not a directory: ${dir}"
    log "Keeping existing persistent data directory ${dir} (no ownership changes)."
  fi
  log "Ensure future web/worker containers run with a compatible UID/GID and mount this directory locally."
}
doctor() {
  check_os
  log "Repository: ${REPO_DIR}"
  if has_docker; then docker --version; else warn "Docker is not installed."; fi
  if has_compose; then docker compose version; else warn "Docker Compose v2 not available."; fi
  [[ -f "${ENV_EXAMPLE}" ]] && log ".env.example: found" || warn ".env.example: missing"
  [[ -f "${ENV_FILE}" ]] && log ".env: found (content not displayed)" || warn ".env: missing"
  [[ -f "${COMPOSE_FILE}" ]] && log "Compose file: found" || warn "Compose file: not yet implemented"
  [[ -d "${REPO_DIR}/apps/web" ]] && log "Web app: found" || warn "Web app: not yet implemented"
  [[ -d "${REPO_DIR}/apps/worker" ]] && log "Worker app: found" || warn "Worker app: not yet implemented"
  command -v free >/dev/null 2>&1 && free -h | head -n 2 || true
  log "Doctor complete; warnings are not deployment success."
}
install_docker() {
  require_root
  check_os
  if has_docker; then
    if has_compose; then log "Docker and Compose already installed; nothing changed."; return; fi
    die "Docker exists but Compose is missing; refusing to replace a running Docker installation. Install docker-compose-plugin for your existing engine manually."
  fi
  local pkg
  for pkg in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -qx "install ok installed"; then
      die "Conflicting package ${pkg} exists. No package removed; review Docker's official migration instructions manually."
    fi
  done
  log "Installing official Docker Engine + Compose plugin. No existing Docker packages are removed."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  local codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "${codename}" ]] || die "Unable to determine Ubuntu codename."
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  require_docker
  log "Docker installed. Next: sudo bash scripts/deploy.sh prepare"
}
compose() { docker compose -p "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"; }
require_app_sources() {
  [[ -f "${COMPOSE_FILE}" ]] || die "deploy/compose.yaml not yet implemented. PRD exists, but application is NOT ready to deploy."
  [[ -d "${REPO_DIR}/apps/web" ]] || die "apps/web is missing; refusing fake deployment."
  [[ -d "${REPO_DIR}/apps/worker" ]] || die "apps/worker is missing; refusing fake deployment."
}
check_services() {
  local s services
  compose config --quiet
  services="$(compose config --services)"
  for s in web worker caddy; do
    printf '%s\n' "${services}" | grep -Fxq "${s}" || die "Compose service ${s} missing."
  done
}
sqlite_backup() {
  command -v python3 >/dev/null 2>&1 || die "Python3 is required for an online SQLite backup."
  local dir src stamp dest backup_dir
  dir="$(data_dir)"
  src="${dir}/xhs-monitor.sqlite"
  [[ -f "${src}" && ! -L "${src}" ]] || die "SQLite file absent or unsafe: ${src}. No backup created."
  backup_dir="/var/backups/xhs-monitor"
  install -d -m 0700 "${backup_dir}"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dest="${backup_dir}/xhs-monitor-${stamp}.sqlite"
  python3 - "${src}" "${dest}" <<'PY'
import os, sqlite3, sys
source, destination = sys.argv[1:3]
temp = destination + ".tmp"
try:
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30) as src:
        with sqlite3.connect(temp, timeout=30) as dst:
            src.backup(dst, pages=128, sleep=0.1)
            result = dst.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise RuntimeError(f"Backup integrity_check failed: {result}")
    os.chmod(temp, 0o600)
    os.replace(temp, destination)
except BaseException:
    if os.path.exists(temp):
        os.remove(temp)
    raise
PY
  log "Verified online backup: ${dest}"
  warn "Backups remain on this VPS. Copy an encrypted backup off-site; no remote backups are configured."
}
deploy() {
  require_root
  check_os
  require_app_sources
  require_docker
  initialize_env
  validate_app_env
  prepare_data_dir
  check_services
  log "Preflight: build web+worker images BEFORE replacing running containers..."
  compose build web worker
  log "Preflight: run tests against a temporary SQLite DB (never production)..."
  compose run --rm --no-deps -e DB_PATH=/tmp/xhs-monitor-preflight.sqlite worker npm test
  log "Preflight: verify non-root Chromium with a local test page..."
  compose run --rm --no-deps worker npm run worker:smoke
  if [[ -f "$(data_dir)/xhs-monitor.sqlite" ]]; then
    log "Existing SQLite database detected; making consistent backup before restart."
    sqlite_backup
  fi
  log "Starting ONLY Compose project ${PROJECT_NAME}..."
  compose up -d --no-build --wait --wait-timeout 180
  compose ps
  log "Containers healthy; browser smoke test passed."
  if [[ "${XHS_SCHEDULED_RUN:-0}" != 1 ]]; then
    if [[ "${XHS_DISABLE_AUTO_UPDATE:-0}" != 1 ]]; then
      install_auto_update_timer
    else
      log "Auto-update disabled by XHS_DISABLE_AUTO_UPDATE=1."
    fi
    if [[ -d "${REPO_DIR}/.git" ]]; then
      install -d -m 0700 "${STATE_DIR}"
      git -C "${REPO_DIR}" rev-parse HEAD >"${STATE_DIR}/last-success-sha"
      chmod 0600 "${STATE_DIR}/last-success-sha"
    fi
  fi
  log "Deployment complete. Real sales collection still needs an approved data source."
}
update() {
  require_root
  exec env XHS_UPDATE_FORCE=1 bash "${REPO_DIR}/scripts/auto-update.sh"
}
status() {
  [[ -f "${COMPOSE_FILE}" && -f "${ENV_FILE}" ]] || die "Compose file or .env missing; nothing deployed yet."
  require_docker
  compose ps
}

TIMER_SERVICE="xhs-monitor-auto-update.service"
TIMER_UNIT="xhs-monitor-auto-update.timer"
STATE_DIR="/var/lib/xhs-monitor-deploy"

auto_update_timezone() {
  local timezone
  timezone="$(awk -F= '$1=="AUTO_DEPLOY_TIMEZONE" {print substr($0, index($0, "=")+1); exit}' "${ENV_FILE}" 2>/dev/null || true)"
  timezone="${timezone:-Asia/Shanghai}"
  [[ "${timezone}" =~ ^[A-Za-z][A-Za-z0-9_+.-]*(/[A-Za-z0-9_+.-]+)*$ ]] ||
    die "Invalid AUTO_DEPLOY_TIMEZONE format (example: Asia/Shanghai)."
  [[ -f "/usr/share/zoneinfo/${timezone}" ]] || die "Unknown timezone: ${timezone}"
  printf '%s\n' "${timezone}"
}

install_auto_update_timer() {
  require_root
  check_os
  command -v systemctl >/dev/null || die "systemctl missing: schedule installation needs systemd."
  command -v systemd-analyze >/dev/null || die "systemd-analyze missing."
  [[ -f "${ENV_FILE}" ]] || die ".env missing. Run prepare first."
  [[ -d "${REPO_DIR}/.git" ]] || die "Daily GitHub updates require a git clone."
  [[ "${REPO_DIR}" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "Unsupported characters in checkout path."
  [[ -f "${REPO_DIR}/deploy/systemd/${TIMER_SERVICE}" ]] || die "Service template missing."
  [[ -f "${REPO_DIR}/deploy/systemd/${TIMER_UNIT}" ]] || die "Timer template missing."
  local timezone temp_service temp_timer
  timezone="$(auto_update_timezone)"
  systemd-analyze calendar "*-*-* 08:00:00 ${timezone}" >/dev/null ||
    die "systemd rejected the schedule / timezone."
  temp_service="$(mktemp)"
  temp_timer="$(mktemp)"
  sed "s|@REPO_DIR@|${REPO_DIR}|g" "${REPO_DIR}/deploy/systemd/${TIMER_SERVICE}" >"${temp_service}"
  sed "s|@AUTO_DEPLOY_TIMEZONE@|${timezone}|g" "${REPO_DIR}/deploy/systemd/${TIMER_UNIT}" >"${temp_timer}"
  install -m 0644 "${temp_service}" "/etc/systemd/system/${TIMER_SERVICE}"
  install -m 0644 "${temp_timer}" "/etc/systemd/system/${TIMER_UNIT}"
  rm -f "${temp_service}" "${temp_timer}"
  systemd-analyze verify "/etc/systemd/system/${TIMER_SERVICE}" "/etc/systemd/system/${TIMER_UNIT}" ||
    die "systemd unit verification failed."
  systemctl daemon-reload
  systemctl enable --now "${TIMER_UNIT}"
  log "Enabled automatic updates at 08:00 ${timezone} every day (with reboot catch-up)."
  systemctl list-timers "${TIMER_UNIT}" --no-pager
}

auto_update_status() {
  require_root
  systemctl list-timers "${TIMER_UNIT}" --all --no-pager || true
  systemctl is-enabled "${TIMER_UNIT}" || true
  systemctl is-active "${TIMER_UNIT}" || true
  if [[ -f "${STATE_DIR}/last-status" ]]; then
    log "Last run: $(cat "${STATE_DIR}/last-status")"
  else
    log "No completed scheduled update recorded yet."
  fi
  log "Logs: journalctl -u ${TIMER_SERVICE} --since today --no-pager"
}

disable_auto_update_timer() {
  require_root
  systemctl disable --now "${TIMER_UNIT}" || true
  rm -f "/etc/systemd/system/${TIMER_UNIT}" "/etc/systemd/system/${TIMER_SERVICE}"
  systemctl daemon-reload
  log "Disabled XHS Monitor auto-updates; application containers were not stopped."
}

main() {
  local cmd="${1:-deploy}"
  [[ "$#" -le 1 ]] || die "One command at a time. Run 'help' for usage."
  case "${cmd}" in
    help|-h|--help) usage ;;
    doctor) doctor ;;
    prepare) require_root; check_os; initialize_env; prepare_data_dir; log "Host configuration prepared; no containers were started." ;;
    install-docker) install_docker ;;
    deploy) deploy ;;
    update) update ;;
    backup) require_root; check_os; sqlite_backup ;;
    status) status ;;
    schedule) install_auto_update_timer ;;
    schedule-status) auto_update_status ;;
    unschedule) disable_auto_update_timer ;;
    *) usage; die "Unknown command: ${cmd}" ;;
  esac
}
main "$@"