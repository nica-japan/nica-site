#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""旧サイト（www.nica-japan.jp）が前回の確認から変わっていないか調べる。

  python3 check_source.py            前回の記録と比べて、変わった箇所を表示する
  python3 check_source.py --update   いまの旧サイトの内容を記録し直す

新サイトに切り替えるまでの間、旧サイトは更新され続ける。移行後に追記された
活動報告や、書き換えられた文章を取りこぼさないために使う。

使い方の流れ
  1. このスクリプトを実行して、変わった箇所を確認する
  2. content.py に反映して build.py で作り直す
  3. --update で記録を更新し、記録ファイルも一緒にコミットする
"""

import difflib
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
SNAPSHOT = ROOT / "source-snapshot.json"

# 旧サイトのページ。切り替えが済んだら、このスクリプトごと削除してよい。
SOURCE_PAGES = {
    "トップ（ミッション）": "https://www.nica-japan.jp/",
    "NICAとは": "https://www.nica-japan.jp/?page_id=181",
    "コード化点字ブロック": "https://www.nica-japan.jp/?page_id=3",
    "活動報告": "https://www.nica-japan.jp/?page_id=195",
    "お問い合わせ": "https://www.nica-japan.jp/?page_id=9",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def paragraphs(html: str) -> list:
    """本文を段落の一覧にする。見た目の違いで差分が出ないよう整える。"""
    m = re.search(r"<article.*?</article>", html, re.S)
    body = m.group(0) if m else html
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", body, flags=re.S)
    body = re.sub(r"<br\s*/?>", "\n", body)

    out = []
    for chunk in re.split(r"</?(?:p|h1|h2|h3|li|div|figcaption)[^>]*>", body):
        text = re.sub(r"<[^>]+>", "", chunk)
        text = (text.replace("&amp;", "&").replace("&nbsp;", " ")
                    .replace("&lt;", "<").replace("&gt;", ">"))
        text = unicodedata.normalize("NFKC", text)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 8:
            out.append(text)
    return out


def collect() -> dict:
    data = {}
    for name, url in SOURCE_PAGES.items():
        try:
            data[name] = paragraphs(fetch(url))
        except urllib.error.URLError as e:
            print(f"  ※ {name} を取得できませんでした: {e}")
            data[name] = None
    return data


def show_diff(name: str, before: list, after: list) -> bool:
    """1ページ分の差分を表示する。違いがあれば True を返す。"""
    changed = False
    matcher = difflib.SequenceMatcher(None, before, after, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        changed = True
        if tag in ("replace", "delete"):
            for line in before[i1:i2]:
                print(f"    − 旧: {line[:110]}")
        if tag in ("replace", "insert"):
            for line in after[j1:j2]:
                print(f"    ＋ 新: {line[:110]}")
    return changed


def main() -> int:
    update = "--update" in sys.argv
    now = collect()

    if not SNAPSHOT.exists():
        SNAPSHOT.write_text(
            json.dumps(now, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"記録を作成しました: {SNAPSHOT.name}")
        print("次回以降、この内容と比べて変わった箇所を表示します。")
        return 0

    before = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    print("旧サイトを前回の記録と比べます")
    print("=" * 62)
    any_changed = False
    for name in SOURCE_PAGES:
        after = now.get(name)
        if after is None:          # 取得できなかったページは飛ばす
            continue
        old = before.get(name) or []
        print(f"\n■ {name}")
        if show_diff(name, old, after):
            any_changed = True
        else:
            print("    変更なし")

    print()
    print("=" * 62)
    if any_changed:
        print("旧サイトに変更があります。content.py に反映してください。")
        print("反映が済んだら python3 check_source.py --update で記録を更新します。")
    else:
        print("前回の記録から変わっていません。")

    if update:
        SNAPSHOT.write_text(
            json.dumps(now, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"記録を更新しました: {SNAPSHOT.name}")
        return 0

    return 1 if any_changed else 0


if __name__ == "__main__":
    sys.exit(main())
