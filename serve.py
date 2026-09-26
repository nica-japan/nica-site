#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""手元で確認するための簡易サーバー。

  python3 serve.py          # http://localhost:8000
  python3 serve.py 8080     # ポートを指定する

ブラウザにキャッシュさせないので、build.py で作り直した内容が
再読み込みするだけで反映される。公開用ではなく確認用。
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # アクセスログは簡潔に
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"http://localhost:{port} で確認できます（Ctrl+C で終了）")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
