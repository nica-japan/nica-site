# NPO法人 NICA（ナイカ）ウェブサイト

<https://www.nica-japan.jp> のソースです。JavaScript を使わない静的サイトで、
`content.py` に書いた文章から `build.py` が HTML を書き出します。

## 構成

```
build.py             ページを書き出すスクリプト
content.py           載せる文章。ふだん直すのはこのファイルだけ
check.py             書き出した HTML の構造を検査する
serve.py             手元で確認するためのサーバー
optimize_images.py   画像を軽くして WebP を作る（画像を足したときだけ）
make_brand.py        ロゴからアイコンと共有画像を作る（ロゴを変えたときだけ）
assets/              デザイン、画像
index.html ほか      build.py が書き出した公開用ファイル（直接編集しない）
```

## 更新のしかた

1. `content.py` の文章を直す
2. HTML を作り直す

```bash
python3 build.py
```

3. 手元で確認する（<http://localhost:8000>）

```bash
python3 serve.py
```

4. 構造を検査する

```bash
python3 check.py
```

5. 問題なければコミットして push する

HTML は毎回すべて作り直されるので、直接編集しても次の `build.py` で消えます。
必ず `content.py` の側を直してください。

## ページ構成

| URL | 内容 |
| --- | --- |
| `/` | トップ |
| `/mission/` | ミッション |
| `/about/` | NICAとは。取り組み例、法人概要 |
| `/braille-block/` | コード化点字ブロックの仕組みと特徴 |
| `/braille-block/events/` | 体験会・実証実験（年ごと） |
| `/braille-block/videos/` | 紹介動画 |
| `/activities/` | 活動報告（年ごと） |
| `/donate/` | 寄付のお願い |
| `/contact/` | お問い合わせ |

1ページが長くなりすぎないよう、記録の多いページは年ごとに分けています。
記録は月ごとの見出しにまとめ、月が4つ以上あるページには
`grouped_records()` が冒頭に目次を付けます。

## 編集するときに守ること

- 団体名の書き分け。**文章・ページ名・メニューでは「ナイカ」**と書く。読み上げ
  ソフトが「NICA」を「ニカ」と読んでしまうため。`NICA` のままにするのは、
  ヘッダーのロゴ、フッターの著作権表示、`<title>` のサイト名部分、共有カードの
  設定（`SHARE_TITLE` など）、法人概要の正式名称（NPO法人 N I C A）の5か所
- 見出しは h1 → h2 → h3 の順に並べ、飛ばさない。1ページに h1 はひとつ
- 画像には内容を説明した `alt` を書く。装飾目的のものは `alt=""`
- リンクは文言だけで行き先が分かるようにする。「こちら」は使わない。
  外部サイトへは `ext()`、YouTube へは `yt()` を使うと注記が付く
- 区切り記号などを CSS の `content` で文字として出さない。
  読み上げソフトが拾ってしまうため、線や図形で描く
- 画像を足したら `python3 optimize_images.py`、
  ロゴを変えたら `python3 make_brand.py` を実行する

`check.py` が見出しの順序、`alt`、リンク文言などを機械的に確認します。

## 切り替えまでの間、旧サイトの更新を取りこぼさない

独自ドメインへ切り替えるまで、旧サイト（www.nica-japan.jp）は更新され続ける。
移行後に追記された活動報告や書き換えられた文章を取りこぼさないよう、
前回の確認時からの変更を調べるスクリプトを用意している。

```bash
python3 check_source.py
```

変更があれば `content.py` に反映し、`build.py` で作り直したうえで、
記録を更新してコミットする。

```bash
python3 check_source.py --update
```

記録は `source-snapshot.json`。切り替えが済んだら、このスクリプトと
記録ファイルは削除してよい。

## 以前のアドレスからの転送

以前は `/?page_id=3` の形式でした。外部の記事や資料に残っているため、
トップページの小さなスクリプトで新しいアドレスへ転送しています
（`content.py` の `OLD_URL_REDIRECT`）。サイトで JavaScript を使っているのは
ここだけで、無効でもトップページが表示されるだけです。

| 以前 | 現在 |
| --- | --- |
| `/?page_id=181` | `/about/` |
| `/?page_id=3` | `/braille-block/` |
| `/?page_id=195` | `/activities/` |
| `/?page_id=9` | `/contact/` |

Cloudflare を使う場合は、管理画面の Redirect Rules に同じ対応表を入れると
JavaScript が無効な環境でも転送されます。

## 検索・共有

- 共有カード（LINE や SNS に貼ったときの表示）はどのページでも同じ内容です。
  画像は `assets/og-image.png`、文言は `build.py` の `SHARE_TITLE` と `SHARE_DESC`
- ページごとの `<title>` と `meta description` は検索結果に使うため別に持っています
- `robots.txt` と `sitemap.xml` は `build.py` が自動生成します

## 公開（GitHub Pages）

Settings → Pages で Source を「Deploy from a branch」、ブランチ `main`、
フォルダ `/ (root)` に設定します。独自ドメインは Custom domain に入力し、
DNS を GitHub Pages に向けます。

### 公開先のアドレスについて

`og:image` や `canonical` は絶対アドレスで書く必要があります。ここが実際の
公開先と食い違うと、LINE や SNS に貼ったときに画像を取得できず、カードに
画像が出ません。

独自ドメインに切り替わるまでの仮公開では、公開先を指定して作ります。

```bash
NICA_BASE_URL=https://nica-japan.github.io/nica-site python3 build.py
```

独自ドメインに切り替えたら、指定なしで作り直してコミットします。

```bash
python3 build.py
```
