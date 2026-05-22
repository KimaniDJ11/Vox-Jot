#!/usr/bin/env bash

set -euo pipefail

APP_NAME="Vox Jot"
APP_PATH="/Applications/${APP_NAME}.app"

echo "Closing running ${APP_NAME} instances..."
/usr/bin/osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
/usr/bin/pkill -x "vox_jot" >/dev/null 2>&1 || true

# Terminate speech sidecars if any
pids=()
while IFS= read -r pid; do
  [[ -n "${pid}" ]] || continue
  command="$(/bin/ps -p "${pid}" -ww -o command= 2>/dev/null || true)"
  cwd="$(/usr/sbin/lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -n 1)"

  case "${command}" in
    *"mlx_audio.server"*|*"-m runtime.app"*|*"runtime/engine_worker.py"*)
      if [[ "${cwd}" == *"/Vox Jot/"* ]] || [[ "${cwd}" == *"/com.iriedinamik.voxjot/"* ]] || [[ "${command}" == *"/com.iriedinamik.voxjot/"* ]]; then
        pids+=("${pid}")
      fi
      ;;
  esac
done < <(/usr/bin/pgrep -f "mlx_audio.server|-m runtime.app|runtime/engine_worker.py" 2>/dev/null || true)

if [[ "${#pids[@]}" -gt 0 ]]; then
  echo "Stopping Vox Jot speech sidecars: ${pids[*]}"
  /bin/kill "${pids[@]}" >/dev/null 2>&1 || true
  /bin/sleep 1
  /bin/kill -9 "${pids[@]}" >/dev/null 2>&1 || true
fi

echo "Waiting for app to terminate..."
for _ in {1..10}; do
  if ! /usr/bin/pgrep -x "vox_jot" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.5
done

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Installed app not found at ${APP_PATH}." >&2
  echo "Please build it first with: bun run mac:update-installed-app" >&2
  exit 1
fi

echo "Reopening ${APP_NAME}..."
/usr/bin/open -a "${APP_PATH}"
echo "Restart complete!"
