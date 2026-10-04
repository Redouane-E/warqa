#!/usr/bin/env bash
# Warqa for macOS: double-click this file to start the Warqa studio in your browser.
# First time: macOS may say it cannot verify the file. Right-click it → Open → Open
# (or System Settings → Privacy & Security → Open Anyway). See launchers/README.md.
# Options for the curious: --check (dry run), --docker, --node, --help.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/lib/warqa-launch.sh"

if [ ! -f "$LIB" ]; then
  echo "Missing file: $LIB"
  echo "Download the whole Warqa folder again. · Téléchargez à nouveau tout le dossier Warqa. · نزّل مجلد «ورقة» كاملًا من جديد."
  [ -t 0 ] && read -r -p "Press Enter to close. " _
  exit 1
fi

exec /bin/bash "$LIB" "$@"
