#!/usr/bin/env bash
# Warqa for Linux: run this file to start the Warqa studio in your browser.
#   From a terminal:      ./launchers/warqa-linux.sh
#   From a file manager:  right-click → "Run as a Program" (or "Execute").
# Options: --check (dry run), --docker, --node, --help. See launchers/README.md.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
LIB="$HERE/lib/warqa-launch.sh"

# Started from a file manager without a terminal? Reopen in one so the messages can be read.
if [ ! -t 1 ] && [ -z "${WARQA_IN_TERMINAL:-}" ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
  export WARQA_IN_TERMINAL=1
  for term in x-terminal-emulator gnome-terminal konsole xfce4-terminal mate-terminal tilix kitty alacritty xterm; do
    command -v "$term" >/dev/null 2>&1 || continue
    case "$term" in
      gnome-terminal) exec gnome-terminal -- bash "$SELF" "$@" ;;
      xfce4-terminal | mate-terminal) exec "$term" -x bash "$SELF" "$@" ;;
      kitty) exec kitty bash "$SELF" "$@" ;;
      *) exec "$term" -e bash "$SELF" "$@" ;;
    esac
  done
fi

if [ ! -f "$LIB" ]; then
  echo "Missing file: $LIB"
  echo "Download the whole Warqa folder again. · Téléchargez à nouveau tout le dossier Warqa. · نزّل مجلد «ورقة» كاملًا من جديد."
  [ -t 0 ] && read -r -p "Press Enter to close. " _
  exit 1
fi

exec bash "$LIB" "$@"
