#!/usr/bin/env bash
set -euo pipefail

# Commit local si nécessaire, puis push vers GitHub.
# Usage: ./premote.sh "message de commit"

msg="${*:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: ./premote.sh \"message de commit\""
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Erreur: ce dossier n'est pas un dépôt git."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Erreur: aucun remote 'origin'."
  echo "Exemple: git remote add origin https://github.com/marcpouliot/regataide-start.git"
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "Aucun nouveau changement local à committer."
else
  git commit -m "$msg"
  echo "Commit local créé: $msg"
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "Erreur: impossible de déterminer la branche courante."
  exit 1
fi

git push -u origin "$branch"
echo "Push GitHub terminé sur origin/$branch"
