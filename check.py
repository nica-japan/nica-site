#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""書き出した HTML の構造を検査する。

  python3 check.py

見出しの順序、alt、リンク文言など、スクリーンリーダー利用時に
問題になりやすい点を機械的に確認する。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
VAGUE = {"コチラ", "こちら", "リンクはコチラ", "動画はコチラ", "ここ", "詳細", "more"}


def main() -> int:
    files = sorted(ROOT.rglob("index.html")) + [ROOT / "404.html"]
    problems = []
    decorative = []

    for f in files:
        s = f.read_text(encoding="utf-8")
        name = f.relative_to(ROOT)

        if s.count("<h1") != 1:
            problems.append(f"{name}: h1 が {s.count('<h1')} 個ある")
        if 'lang="ja"' not in s:
            problems.append(f"{name}: html に lang 属性がない")
        for tag in ("<main", "<header", "<footer", "<nav"):
            if tag not in s:
                problems.append(f"{name}: {tag} 要素がない")

        for m in re.finditer(r"<img\b[^>]*>", s):
            if 'alt="' not in m.group(0):
                problems.append(f"{name}: alt 属性のない画像がある")
            elif re.search(r'alt=""', m.group(0)):
                # alt="" は「装飾なので読み上げ不要」という意思表示。
                # 説明が別にあるか目視で確かめられるよう件数だけ出す。
                decorative.append(str(name))

        for m in re.finditer(r"<iframe\b[^>]*>", s):
            if 'title="' not in m.group(0):
                problems.append(f"{name}: title のない iframe がある")

        levels = [int(x) for x in re.findall(r"<h([1-6])[ >]", s)]
        for a, b in zip(levels, levels[1:]):
            if b > a + 1:
                problems.append(f"{name}: 見出しが h{a} から h{b} に飛んでいる")

        for m in re.finditer(r"<a [^>]*>(.*?)</a>", s, re.S):
            txt = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            if not txt:
                problems.append(f"{name}: 文言のないリンクがある")
            elif txt in VAGUE:
                problems.append(f"{name}: あいまいなリンク文言「{txt}」")

    print(f"検査したファイル: {len(files)}")
    if decorative:
        print(f"（装飾扱い alt=\"\" の画像: {len(decorative)}件 "
              f"— {', '.join(sorted(set(decorative)))}）")
    if problems:
        print("\n".join("  - " + p for p in problems))
        return 1
    print("指摘なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
