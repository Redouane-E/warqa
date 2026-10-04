#!/usr/bin/env bash
# Print the CHANGELOG.md section of one version, without its heading, for the GitHub Release body.
#   .github/scripts/release-notes.sh v0.1.0            # or 0.1.0
#   .github/scripts/release-notes.sh v0.1.0 CHANGELOG.md
# Exits with an error if the version has no section or the section is empty.
set -euo pipefail

version="${1:?usage: release-notes.sh <tag or version> [changelog]}"
version="${version#v}"
file="${2:-CHANGELOG.md}"

[ -f "$file" ] || {
  echo "error: $file not found" >&2
  exit 1
}

notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT

# Keep a Changelog: sections start with "## [x.y.z]"; link definitions ("[x.y.z]: https://…") end the file.
awk -v v="$version" '
  /^## \[/ {
    if (found) exit
    if (index($0, "## [" v "]") == 1) found = 1
    next
  }
  found && /^\[[^]]+\]: / { exit }
  found { lines[++n] = $0 }
  END {
    first = 1
    while (first <= n && lines[first] ~ /^[[:space:]]*$/) first++
    last = n
    while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
    for (i = first; i <= last; i++) print lines[i]
  }
' "$file" >"$notes"

if [ ! -s "$notes" ]; then
  echo "error: no entry for $version in $file (add a '## [$version] - YYYY-MM-DD' section)" >&2
  exit 1
fi
cat "$notes"
