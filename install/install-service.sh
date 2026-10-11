#!/usr/bin/env bash
#
# Install the DayDesk helper as a launchd user agent so it starts at login.
#
# Optional — the helper runs fine from `npm start --workspace=helper`. This just
# means you stop thinking about it.
#
# Usage:   ./install/install-service.sh
# Remove:  ./install/install-service.sh --uninstall

set -euo pipefail

LABEL="com.daydesk.helper"
PLIST_NAME="${LABEL}.plist"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${AGENTS_DIR}/${PLIST_NAME}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="${REPO_ROOT}/helper"
HELPER_ENTRY="${HELPER_DIR}/dist/main.js"
LOG_DIR="${HOME}/.daydesk/logs"

uninstall() {
  if [[ -f "${TARGET_PLIST}" ]]; then
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm -f "${TARGET_PLIST}"
    echo "Removed ${TARGET_PLIST}"
  else
    echo "Not installed — nothing to remove."
  fi
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# launchd gets a minimal environment and cannot use a shell-managed shim, so the
# plist must record an absolute interpreter path. A version-managed node (nvm,
# asdf, volta) or a conda node breaks this agent the moment you switch or prune
# versions — so prefer a stable interpreter when one is new enough.
MIN_MAJOR=22

is_unstable() {
  case "$1" in
    *"/.nvm/"* | *"/.asdf/"* | *"/.volta/"* | *conda* | *mamba*) return 0 ;;
    *) return 1 ;;
  esac
}

node_major() {
  "$1" -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0
}

usable() {
  [[ -x "$1" ]] && [[ "$(node_major "$1")" -ge "${MIN_MAJOR}" ]]
}

if [[ -n "${DAYDESK_NODE:-}" ]]; then
  # Explicit override always wins, but still has to be able to run the helper.
  NODE_PATH="${DAYDESK_NODE}"
  if ! usable "${NODE_PATH}"; then
    echo "error: DAYDESK_NODE=${NODE_PATH} is not executable or is older than Node ${MIN_MAJOR}." >&2
    exit 1
  fi
else
  NODE_PATH="$(command -v node || true)"
  if [[ -z "${NODE_PATH}" ]]; then
    echo "error: node is not on PATH." >&2
    exit 1
  fi

  if is_unstable "${NODE_PATH}"; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
      if usable "${candidate}"; then
        echo "note: ${NODE_PATH} is version-managed, which would break this agent"
        echo "      whenever you switch or prune node versions."
        echo "      Using ${candidate} ($("${candidate}" --version)) instead."
        NODE_PATH="${candidate}"
        break
      fi
    done
  fi
fi

if ! usable "${NODE_PATH}"; then
  echo "error: ${NODE_PATH} is older than Node ${MIN_MAJOR}, which the helper requires." >&2
  echo "       Install a newer node, or point at one explicitly:" >&2
  echo "         DAYDESK_NODE=/path/to/node ./install/install-service.sh" >&2
  exit 1
fi

if is_unstable "${NODE_PATH}"; then
  echo "warning: ${NODE_PATH} is version-managed and no stable Node ${MIN_MAJOR}+ was found." >&2
  echo "         This agent will break if you switch or prune node versions." >&2
fi

if [[ ! -f "${HELPER_ENTRY}" ]]; then
  echo "error: ${HELPER_ENTRY} is missing. Build first:" >&2
  echo "       npm run build --workspace=helper" >&2
  exit 1
fi

mkdir -p "${AGENTS_DIR}" "${LOG_DIR}"

sed \
  -e "s|__NODE_PATH__|${NODE_PATH}|g" \
  -e "s|__HELPER_ENTRY__|${HELPER_ENTRY}|g" \
  -e "s|__HELPER_DIR__|${HELPER_DIR}|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  "${REPO_ROOT}/install/${PLIST_NAME}" > "${TARGET_PLIST}"

# bootout first so re-running this script reloads rather than erroring.
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${TARGET_PLIST}"

echo "Installed ${TARGET_PLIST}"
echo "  node:   ${NODE_PATH}"
echo "  entry:  ${HELPER_ENTRY}"
echo "  logs:   ${LOG_DIR}/helper.log"
echo
echo "Status:  launchctl print gui/$(id -u)/${LABEL} | head -20"
echo "Remove:  ./install/install-service.sh --uninstall"
