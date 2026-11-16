#!/usr/bin/env bash
# Adds clearly-marked DEMO data (not Reprobates canon) to dev-vault only, and commits it there by explicit path.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d dev-vault/.git ] || { echo "no dev-vault"; exit 1; }
case "$(git -C dev-vault remote)" in "") ;; *) echo "dev-vault has a remote; refusing"; exit 1;; esac
cp -R templates/demo/. dev-vault/Atlas/
paths=$(cd templates/demo && find . -type f | sed 's|^\./|Atlas/|')
( cd dev-vault && echo "$paths" | while read -r p; do git add -- "$p"; done && git commit -qm "atlas: demo data (not canon)" ) || true
echo "demo data seeded"
