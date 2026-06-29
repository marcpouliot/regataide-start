#!/usr/bin/env bash
set -euo pipefail

# Publication complète: commit local si nécessaire + push GitHub.
# Usage: ./publishall.sh "message de commit"

msg="${*:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: ./publishall.sh \"message de commit\""
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/premote.sh" "$msg"

echo "Publication complète terminée."
echo "Si GitHub Pages est activé: https://marcpouliot.github.io/regataide-start/"
