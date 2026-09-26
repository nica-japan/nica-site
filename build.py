#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NPO法人 NICA サイトの静的ページ生成スクリプト。

  python3 build.py

content.py に入っている本文を読み込み、共通のヘッダー・ナビゲーション・
フッターを付けて HTML ファイルを書き出す。出力はリポジトリ直下なので、
GitHub Pages の「ブランチのルート」をそのまま公開設定にできる。
"""

from pathlib import Path
import html
import re

import content

ROOT = Path(__file__).parent
SITE_NAME = "NPO法人 NICA（ナイカ）"
SITE_SUB = "特定非営利活動法人 日本インクルーシブ・クリエーターズ協会"
BASE_URL = "https://www.nica-japan.jp"

# ヘッダーのメニュー。項目を増やしすぎると読み上げでも目視でも探しにくいので、
# 「寄付のお願い」はここには置かず、フッターと本文中のリンクから辿る。
NAV = [
    ("", "ホーム"),
    ("mission/", "ミッション"),
    ("about/", "NICAとは"),
    ("braille-block/", "コード化点字ブロック"),
    ("activities/", "活動報告"),
    ("contact/", "お問い合わせ"),
]

# フッターはヘッダーの繰り返しにせず、ヘッダーにない「寄付のお願い」と、
# 長いページの末尾から戻るためのリンクだけに絞る。
FOOTER_NAV = [
    ("donate/", "寄付のお願い"),
    ("contact/", "お問い合わせ"),
    ("#top", "ページの先頭へ戻る"),
]


def rel(from_slug: str) -> str:
    """出力先から見たサイトルートへの相対パス。"""
    depth = len([p for p in from_slug.split("/") if p])
    return "../" * depth if depth else "./"


def nav_html(slug: str, base=None, items_src=None) -> str:
    base = base if base is not None else rel(slug)
    items = []
    for href, label in (items_src if items_src is not None else NAV):
        if href.startswith("#"):
            # ページ内リンク（先頭へ戻る）はそのまま使う
            url, attr = href, ""
        else:
            # 現在地の判定（トップだけは完全一致）
            current = slug == href
            attr = ' aria-current="page"' if current else ""
            url = base + href if href else base
        items.append(
            f'      <li><a href="{url}"{attr}>{label}</a></li>'
        )
    return "\n".join(items)


def crumbs_html(slug: str, trail, base=None) -> str:
    """trail: [(href, label), ...] 末尾は現在ページ（リンクなし）。"""
    if not trail:
        return ""
    base = base if base is not None else rel(slug)
    lis = [f'<li><a href="{base}">ホーム</a></li>']
    for i, (href, label) in enumerate(trail):
        last = i == len(trail) - 1
        if last:
            lis.append(f'<li><span aria-current="page">{label}</span></li>')
        else:
            lis.append(f'<li><a href="{base}{href}">{label}</a></li>')
    return (
        '  <nav class="crumbs" aria-label="現在位置">\n'
        "    <ol>\n      " + "\n      ".join(lis) + "\n    </ol>\n  </nav>\n"
    )


TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="{base}assets/style.css">
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>

<header class="site-header" id="top">
  <div class="wrap">
    <p class="site-title"><a href="{base}">NPO法人 <span class="en">NICA</span>（ナイカ）</a></p>
    <p class="site-sub">{sitesub}</p>
    <nav class="nav" aria-label="メインメニュー">
      <ul>
{nav}
      </ul>
    </nav>
  </div>
</header>

<div class="wrap">
{crumbs}</div>

<main id="main" class="wrap page">
{body}
</main>

<footer class="site-footer">
  <div class="wrap">
    <h2>{sitesub}</h2>
    <address>
      〒120-0046　東京都足立区小台2-3-21-1005<br>
      メール：<a href="mailto:contact@nica-japan.jp">contact@nica-japan.jp</a>
    </address>
    <nav class="footer-nav" aria-label="フッターメニュー">
      <ul>
{fnav}
      </ul>
    </nav>
    <p class="copyright">© {SITE_NAME}</p>
  </div>
</footer>
</body>
</html>
"""


def render(slug: str, title: str, desc: str, body: str, trail=None,
           base=None, out=None) -> None:
    base = base if base is not None else rel(slug)
    full_title = title if slug == "" else f"{title}｜{SITE_NAME}"
    page = TEMPLATE.format(
        title=html.escape(full_title),
        desc=html.escape(desc),
        base=base,
        sitesub=SITE_SUB,
        nav=nav_html(slug, base),
        fnav=nav_html(slug, base, FOOTER_NAV),
        crumbs=crumbs_html(slug, trail or [], base),
        body=body.rstrip(),
        SITE_NAME=SITE_NAME,
    )
    if out is None:
        out = ROOT / slug / "index.html" if slug else ROOT / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print("  ", out.relative_to(ROOT))


def sitemap(slugs) -> None:
    urls = "\n".join(
        f"  <url><loc>{BASE_URL}/{s}</loc></url>" for s in slugs
    )
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}\n</urlset>\n",
        encoding="utf-8",
    )


def main() -> None:
    print("ページを生成します:")
    slugs = []
    for p in content.PAGES:
        render(p["slug"], p["title"], p["desc"], p["body"], p.get("trail"))
        slugs.append(p["slug"])

    # 404ページ。GitHub Pages がどの階層のURLに対しても返すため、
    # リンクはルートからの絶対パスにする。
    render(
        "",
        "ページが見つかりません",
        "お探しのページは見つかりませんでした。",
        content.NOT_FOUND,
        base="/",
        out=ROOT / "404.html",
    )

    sitemap(slugs)
    print(f"完了: {len(slugs)} ページ + 404 + sitemap.xml")


if __name__ == "__main__":
    main()
