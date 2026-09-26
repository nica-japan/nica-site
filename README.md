# NPO法人 NICA（ナイカ）ウェブサイト

現行サイト <https://www.nica-japan.jp>（WordPress）の内容を、WordPress を使わない
静的サイトとして作り直したもの。JavaScript は使っていない。

## 構成

```
build.py             ページを書き出すスクリプト
content.py           載せる文章。ふだん直すのはこのファイルだけ
check.py             書き出した HTML の構造を検査する
serve.py             手元で確認するためのサーバー
optimize_images.py   画像を軽くして WebP を作る（画像を足したときだけ）
assets/style.css     デザイン
assets/img/          画像と manifest.json（寸法の一覧）
index.html ほか      build.py が書き出した公開用ファイル（直接編集しない）
```

## 更新のしかた

1. `content.py` の文章を直す
2. 次を実行して HTML を作り直す

```bash
python3 build.py
```

3. 手元で確認する（<http://localhost:8000> が開く）

```bash
python3 serve.py
```

`serve.py` はブラウザにキャッシュさせないので、`build.py` で作り直したら
再読み込みするだけで反映される。`python3 -m http.server` を使うと古い表示が
残ることがある。

4. 問題なければコミットして push する

`index.html` などの HTML は毎回すべて作り直されるので、直接編集しても
次の `python3 build.py` で消える。必ず `content.py` の側を直すこと。

## ページ構成

| URL | 内容 |
| --- | --- |
| `/` | トップ。団体の紹介と各ページへの入口、最近の活動3件 |
| `/mission/` | ミッション |
| `/about/` | NICAとは。取り組み例、法人概要 |
| `/braille-block/` | コード化点字ブロックの仕組みと特徴 |
| `/braille-block/events/` | 体験会・実証実験の記録 |
| `/braille-block/videos/` | 紹介動画 |
| `/activities/` | 活動報告の目次（年ごと） |
| `/activities/2026/` 〜 `/activities/2018-2021/` | 年ごとの活動記録 |
| `/donate/` | 寄付のお願いと振込先 |
| `/contact/` | お問い合わせ |

旧サイトでは1ページに詰め込まれていた「コード化点字ブロック」「活動報告」を、
スクリーンリーダーで読む人の負担を減らすため上記のように分割している。

## アクセシビリティで気をつけていること

- 見出しは h1 → h2 → h3 の順に並べ、飛ばさない。1ページに h1 はひとつ
- 「本文へスキップ」リンクを各ページの先頭に置いている
- 画像にはすべて内容を説明した `alt` を書く（旧サイトは未設定だった）
- リンクの文言だけで行き先が分かるようにする。「コチラ」は使わない。
  外部サイトへのリンクには「（外部サイト）」「（YouTube）」を添える
- 文字と背景の色のコントラストは WCAG AA（4.5:1）以上。ダークモードにも対応
- キーボード操作時のフォーカス枠を必ず表示する
- 動画は `youtube-nocookie.com` で埋め込み、Cookie 同意バナーを不要にしている
- JavaScript なしで全ページが読める（唯一の例外は下記「旧URLからの転送」）

`build.py` 実行後に次のコマンドで構造を検査できる（現在は指摘ゼロ）。

```bash
python3 check.py
```

## 表示を軽くするためにしていること

- 画像は WebP と JPEG の両方を持ち、`<picture>` で対応している方を返す（約36%削減）
- すべての画像に `width` / `height` を入れ、読み込み中に文字が飛び跳ねないようにしている
- 画像は `loading="lazy"`。画面に入るまで読み込まない
- 紹介動画は、再生ボタンを押すまで YouTube へ通信しない。サムネイルは自前で持ち、
  `<details>` で包んでいるので JavaScript は不要。Cookie 同意バナーも要らない
- 画像を差し替えたら `python3 optimize_images.py` を実行する
  （Pillow が必要：`pip3 install Pillow`）

## 旧URLからの転送

旧サイトは `/?page_id=3` のようなアドレスだった。これが外部記事や配布資料に
残っているため、転送しないとリンクが切れる。

| 旧アドレス | 新アドレス |
| --- | --- |
| `/?page_id=181` | `/about/` |
| `/?page_id=3` | `/braille-block/` |
| `/?page_id=195` | `/activities/` |
| `/?page_id=9` | `/contact/` |

静的なホスティングは「?」以降を見分けられないので、**トップページに小さな
転送スクリプトを置いている**（`content.py` の `OLD_URL_REDIRECT`）。
サイトの中で JavaScript を使っているのはここだけで、無効でもトップページが
表示されるだけで壊れない。

Cloudflare を使う場合は、管理画面の Redirect Rules に同じ対応表を入れておくと、
JavaScript が無効な環境でも転送される。条件は
`http.request.uri.query contains "page_id=3"` のように書く。

## 検索・共有まわり

- 各ページに `canonical` と OGP（`og:title` / `og:description` / `og:image`）を設定済み。
  LINE や Facebook に貼るとタイトル・説明・画像が表示される
- 共有画像は `assets/og-image.png`（1200×630）。作り直す手順はこのファイルの
  コミット履歴を参照
- `favicon.svg`（点字ブロックの点を模した図案）と `apple-touch-icon.png`
- `robots.txt` と `sitemap.xml` は `build.py` が自動生成する
- 404 ページには `noindex` を入れてあるので検索結果には出ない

## 公開（GitHub Pages）

1. GitHub にリポジトリを作って push する
2. Settings → Pages → Source を「Deploy from a branch」、ブランチを `main`、
   フォルダを `/ (root)` にする
3. 独自ドメインを使う場合は Settings → Pages の Custom domain に
   `www.nica-japan.jp` を入れ、DNS を GitHub Pages に向ける
   （`CNAME` ファイルは GitHub 側が自動で作る）

## 旧サイトから引き継ぐときに気づいた点

本文は原則そのまま使っているが、次の箇所は確認が必要。

- **年の記載がない項目**：活動報告の「6月　TEAM EXPO2025共創チャレンジ…」は
  旧サイトに年が書かれていない。前後関係から 2022 年として配置している
- **並び順**：旧サイトでは「2024年2月」が 2024 年の先頭に、「2021年12月」が
  「2020年1月」の後ろに置かれていた。新サイトでは日付の新しい順に並べ直した
- **誤字と思われる箇所**（原文のままにしてある）
  - コード化点字ブロック：「母国語で案内するができます」
  - 体験会の記録：「ニューロダイバーシティプロジェクトクト」→「プロジェクト」に修正済み
- **チラシ画像**：チラシと社内報は文字が画像になっているため、読み上げでは
  `alt` の説明しか伝わらない。重要な情報は本文にも文字で書くのが望ましい
- **SNS リンク**：旧サイトのヘッダー・フッターにあった Facebook / Twitter /
  Instagram / Yelp のリンクは WordPress の初期設定のまま（例: facebook.com/wordpress）
  だったため、新サイトには載せていない。実際のアカウントがあれば追加する
