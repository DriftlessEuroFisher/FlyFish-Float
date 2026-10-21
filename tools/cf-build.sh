#!/usr/bin/env bash
# Cloudflare Pages build command: `bash tools/cf-build.sh`, output directory `dist`.
#
# This is not a build step. Nothing is transformed or minified. It is the
# publish list: it copies the public app files into dist/ so private repo
# material (supabase/*.sql, tools/, .github/, README-type files) is never
# served. Any new top-level file or folder the app loads must be added to the
# cp line below, or it will 404 on the live site.
#
# index.html is the homepage (served at /), app.html the map (served at /app),
# img/ the homepage's screenshots.
#
# worker/ is not copied: it is the Worker script (wrangler.jsonc "main"),
# which wrangler bundles itself, js/postmd.js included. The news pages it
# builds load css/home.css and css/news.css from here, so those are checked.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist && mkdir dist
cp -R index.html app.html admin.html manifest.json sw.js _headers css js icons img data dist/

for f in dist/index.html dist/app.html dist/css/home.css dist/css/news.css dist/js/postmd.js dist/js/home-news.js dist/js/rivers-data.js; do
  if [ ! -f "$f" ]; then
    echo "cf-build: $f is missing, refusing to publish" >&2
    exit 1
  fi
done
echo "cf-build: dist/ ready"
