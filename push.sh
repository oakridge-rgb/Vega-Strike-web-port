#!/usr/bin/env bash
# Creates the GitHub repo "Vega-Strike-web-port" and pushes this project.
#
# Usage:
#   GH_TOKEN=<token> ./push.sh      # or paste the token when prompted
#
# The token is used in memory only: never written to disk, never echoed,
# never stored in .git/config.
set -euo pipefail

REPO_NAME="Vega-Strike-web-port"
REPO_DESC="Clean-room browser port of the Vega Strike space sim (GPL) - trade, fight, upgrade in the Gemini sector; single self-contained HTML, authentic GPL game data"

if [ -n "${GH_TOKEN:-}" ]; then
  TOKEN="$GH_TOKEN"
else
  printf "Paste a GitHub token (input hidden): "
  read -rs TOKEN
  echo
fi
[ -n "$TOKEN" ] || { echo "No token given."; exit 1; }

auth() { curl -s -H "Authorization: Bearer $TOKEN" \
              -H "Accept: application/vnd.github+json" "$@"; }

LOGIN=$(auth https://api.github.com/user | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('login') or '')")
[ -n "$LOGIN" ] || { echo "Token rejected by GitHub (check scope/expiry)."; exit 1; }
echo "Authenticated as: $LOGIN"

STATUS=$(auth -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$LOGIN/$REPO_NAME")
if [ "$STATUS" = "200" ]; then
  echo "Repo already exists: $LOGIN/$REPO_NAME"
else
  echo "Creating repo $LOGIN/$REPO_NAME ..."
  auth -X POST https://api.github.com/user/repos \
    -d "{\"name\":\"$REPO_NAME\",\"description\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$REPO_DESC"),\"private\":false,\"auto_init\":false}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('created:', d.get('full_name') or d.get('message','error'))"
fi

git push --no-verify "https://x-access-token:${TOKEN}@github.com/${LOGIN}/${REPO_NAME}.git" HEAD:main

echo
echo "Done. Repo: https://github.com/$LOGIN/$REPO_NAME"
