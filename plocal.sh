#!/usr/bin/env bash
set -euo pipefail

# Commit local seulement.
# Usage: ./plocal.sh "message de commit"

msg="${*:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: ./plocal.sh \"message de commit\""
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Erreur: ce dossier n'est pas un dépôt git."
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "Rien à committer localement."
  exit 0
fi

git commit -m "$msg"
echo "Commit local créé: $msg"
