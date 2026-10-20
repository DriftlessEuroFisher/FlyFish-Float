#!/usr/bin/env python3
"""Local dev server that answers URLs the way the live site does.

Cloudflare (Workers static assets) serves foo.html at /foo and redirects
/foo.html to /foo, so the map is at /app and the homepage at /.
`python3 -m http.server` does neither, and /app 404s under it. Stdlib only.

    python3 tools/devserver.py [port]        (default $PORT, else 8950)
"""
import http.server, os, sys
from urllib.parse import urlsplit, urlunsplit, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def send_head(self):
        u = urlsplit(self.path)
        p = u.path
        if p.endswith(".html"):                    # /x.html -> /x, /index.html -> /
            clean = p[:-len("index.html")] if p.endswith("/index.html") else p[:-len(".html")]
            self.send_response(307)
            self.send_header("Location", urlunsplit(("", "", clean, u.query, "")))
            self.end_headers()
            return None
        disk = os.path.join(ROOT, unquote(p).lstrip("/"))
        if not p.endswith("/") and not os.path.exists(disk) and os.path.isfile(disk + ".html"):
            self.path = urlunsplit(("", "", p + ".html", u.query, ""))   # /app -> app.html
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")   # an edit shows on the next reload
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", 8950))
    print(f"Serving {ROOT} at http://localhost:{port}/ (map at /app)", flush=True)
    http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
