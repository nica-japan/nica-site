#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ロゴから、サイトで使う各種の画像を作り直す。

  python3 make_brand.py

元になるのは assets/img/logo-source.png（団体のロゴ）。
ロゴを差し替えたときだけ実行する（Pillow が必要）。

作られるもの
  assets/img/logo.png / logo.webp   ヘッダーに置くロゴ
  assets/favicon.png                ブラウザのタブのアイコン
  assets/apple-touch-icon.png       iPhone のホーム画面のアイコン
  assets/og-image.png               LINE や SNS に貼ったときの画像
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "img" / "logo-source.png"

NAVY, YELLOW, WHITE, SOFT = "#1c2630", "#f2b705", "#ffffff", "#c8d0d8"
BOLD = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
LIGHT = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"

VISION = "誰もがその人らしく生きられる社会"
DESCRIPTION = [
    "視覚に障害のある方々と共に、見えない壁を見つけ、",
    "やさしさに変える活動をしています。",
]
SUBTITLE = "特定非営利活動法人 日本インクルーシブ・クリエーターズ協会"


def trimmed_logo() -> Image.Image:
    """ロゴの周りの透明な余白を落とす。"""
    im = Image.open(SOURCE).convert("RGBA")
    return im.crop(im.split()[3].getbbox())


def square(logo: Image.Image, size: int, bg=None, pad: float = 0.0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    inner = round(size * (1 - pad * 2))
    r = logo.copy()
    r.thumbnail((inner, inner), Image.LANCZOS)
    canvas.paste(r, ((size - r.width) // 2, (size - r.height) // 2), r)
    return canvas


def make_og(logo: Image.Image) -> None:
    """LINE や SNS に貼ったときに出る画像（1200×630）。

    どのページを貼っても同じこの1枚が出る。上からロゴと団体名、正式名称、
    目指している社会、活動の説明の順に、上下の区切り線で並べる。
    """
    W, H = 1200, 630
    MARGIN = 88
    RIGHT = W - MARGIN
    RULE = "#3d4753"

    og = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(og)
    d.rectangle([0, 0, W, 14], fill=YELLOW)

    def put(x, y, txt, font, fill):
        right = d.textbbox((x, y), txt, font=font)[2]
        if right > RIGHT:
            print(f"  ※ はみ出し注意（右端 {right} > {RIGHT}）: {txt}")
        d.text((x, y), txt, font=font, fill=fill)

    # --- ロゴと団体名 ---
    mark = logo.copy()
    mark.thumbnail((188, 188), Image.LANCZOS)
    mark_y = 54
    og.paste(mark, (MARGIN, mark_y), mark)

    f_name = ImageFont.truetype(BOLD, 78)
    name = "NPO法人 NICA"
    box = d.textbbox((0, 0), name, font=f_name)
    name_y = mark_y + (mark.height - (box[3] - box[1])) // 2 - box[1]
    put(MARGIN + mark.width + 40, name_y, name, f_name, WHITE)

    # --- 正式名称 ---
    put(MARGIN, mark_y + mark.height + 26, SUBTITLE,
        ImageFont.truetype(LIGHT, 30), SOFT)

    # --- 目指している社会。上下を線ではさむ ---
    d.line([MARGIN, 358, RIGHT, 358], fill=RULE, width=2)
    put(MARGIN, 388, VISION, ImageFont.truetype(BOLD, 52), WHITE)
    d.line([MARGIN, 470, RIGHT, 470], fill=RULE, width=2)

    # --- 活動の説明 ---
    f_desc = ImageFont.truetype(LIGHT, 30)
    for i, row in enumerate(DESCRIPTION):
        put(MARGIN, 500 + i * 44, row, f_desc, SOFT)

    og.save(ASSETS / "og-image.png")


def main() -> None:
    logo = trimmed_logo()
    print(f"元のロゴ: {SOURCE.name} → 余白を除いて {logo.size}")

    header = square(logo, 192)
    header.save(ASSETS / "img" / "logo.png", optimize=True)
    header.save(ASSETS / "img" / "logo.webp", quality=92, method=6)

    # タブのアイコンは背景を透明にして、明るいタブでも暗いタブでも見えるようにする
    square(logo, 64).save(ASSETS / "favicon.png", optimize=True)

    # iOS は透明部分を黒く塗るので、白地に載せる
    square(logo, 180, bg=(255, 255, 255, 255), pad=0.06).save(
        ASSETS / "apple-touch-icon.png", optimize=True
    )

    make_og(logo)

    for name in ("img/logo.png", "img/logo.webp", "favicon.png",
                 "apple-touch-icon.png", "og-image.png"):
        p = ASSETS / name
        print(f"  {name}: {p.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
