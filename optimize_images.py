#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""assets/img/ の画像を軽くして、WebP 版と寸法の一覧を作る。

  python3 optimize_images.py

画像を追加・差し替えたときだけ実行する（Pillow が必要）。
結果は assets/img/manifest.json に書き出され、content.py がこれを読んで
img 要素に width / height を入れる。寸法が入っていると、読み込み中に
文字が飛び跳ねるのを防げる。
"""

import json
from pathlib import Path

from PIL import Image

IMG_DIR = Path(__file__).parent / "assets" / "img"
MAX_WIDTH = 1280        # これより横に大きい画像は縮小する
JPEG_QUALITY = 82
WEBP_QUALITY = 80


def main() -> None:
    manifest = {}
    total_before = total_after = 0

    for src in sorted(IMG_DIR.glob("*.jpg")):
        before = src.stat().st_size
        im = Image.open(src)
        im = im.convert("RGB")

        if im.width > MAX_WIDTH:
            h = round(im.height * MAX_WIDTH / im.width)
            im = im.resize((MAX_WIDTH, h), Image.LANCZOS)

        im.save(src, "JPEG", quality=JPEG_QUALITY, optimize=True,
                progressive=True)
        webp = src.with_suffix(".webp")
        im.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)

        total_before += before
        total_after += webp.stat().st_size
        manifest[src.name] = {
            "width": im.width,
            "height": im.height,
            "jpg": src.name,
            "webp": webp.name,
        }
        print(f"  {src.name}: {before//1024}KB -> "
              f"JPEG {src.stat().st_size//1024}KB / "
              f"WebP {webp.stat().st_size//1024}KB")

    (IMG_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    pct = round((1 - total_after / total_before) * 100)
    print(f"合計 {total_before//1024}KB -> WebP {total_after//1024}KB"
          f"（{pct}% 削減。WebP に対応しない古い環境には JPEG を返す）")


if __name__ == "__main__":
    main()
