#!/bin/sh
# Publishes a standalone copy of the worker form at https://td-kadry.vercel.app (Vercel project td-kadry, team twoja-decyzja).
# Backup address for clients whose operator blocks docgenerator.td-group.pl. Run after every change of the form's files.
set -e
cd "$(dirname "$0")/.."
D=$(mktemp -d)
mkdir -p "$D/vendor"
cp formularz-pracownika.html "$D/index.html"
cp formularz-pracownika.html formularz-pracownika.js stawki.js supabase-config.js urzedy.js logo.png rodo.html "$D/"
cp vendor/supabase-2.117.3.js "$D/vendor/"
cat > "$D/vercel.json" <<'JSON'
{ "cleanUrls": false, "headers": [ { "source": "/(.*)", "headers": [
  { "key": "X-Content-Type-Options", "value": "nosniff" }, { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
  { "key": "X-Frame-Options", "value": "DENY" }, { "key": "X-Robots-Tag", "value": "noindex" } ] } ] }
JSON
(cd "$D" && vercel deploy --prod --yes --scope twoja-decyzja --name td-kadry >/dev/null)
rm -rf "$D"
curl -s -o /dev/null -w "td-kadry.vercel.app %{http_code}\n" https://td-kadry.vercel.app/
