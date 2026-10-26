#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""assets/img/ の画像を軽くして、WebP 版と寸法の一覧を作る。

  python3 optimize_images.py         まだ WebP がない画像だけを処理する
  python3 optimize_images.py --all   すべての画像を処理し直す（差し替えたとき）

Pillow が必要。GitHub Actions でもビルドのたびに実行される。
すでに処理済みの画像は触らないので、何度実行しても画質は落ちない。

結果は assets/img/manifest.json に書き出され、content.py がこれを読んで
img 要素に width / height を入れる。寸法が入っていると、読み込み中に
文字が飛び跳ねるのを防げる。

撮影場所などの EXIF 情報は書き出し時に取り除かれる。写真の向きは
EXIF の回転指定に従って直してから保存する。
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMG_DIR = Path(__file__).parent / "assets" / "img"
MANIFEST = IMG_DIR / "manifest.json"
MAX_WIDTH = 1280        # これより横に大きい画像は縮小する
JPEG_QUALITY = 82
WEBP_QUALITY = 80


def process(src: Path) -> dict:
    before = src.stat().st_size
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")

    if im.width > MAX_WIDTH:
        h = round(im.height * MAX_WIDTH / im.width)
        im = im.resize((MAX_WIDTH, h), Image.LANCZOS)

    # exif を渡さずに保存するので、位置情報などは残らない
    im.save(src, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    webp = src.with_suffix(".webp")
    im.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)

    print(f"  {src.name}: {before//1024}KB -> "
          f"JPEG {src.stat().st_size//1024}KB / "
          f"WebP {webp.stat().st_size//1024}KB")
    return {"width": im.width, "height": im.height,
            "jpg": src.name, "webp": webp.name}


def main() -> None:
    redo_all = "--all" in sys.argv
    old = {}
    if MANIFEST.exists():
        old = json.loads(MANIFEST.read_text(encoding="utf-8"))

    manifest = {}
    done = 0
    for src in sorted(IMG_DIR.glob("*.jpg")):
        webp = src.with_suffix(".webp")
        if not redo_all and src.name in old and webp.exists():
            manifest[src.name] = old[src.name]
            continue
        manifest[src.name] = process(src)
        done += 1

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"処理した画像: {done} 件（全 {len(manifest)} 件）")


if __name__ == "__main__":
    main()
