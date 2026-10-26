/**
 * 活動報告の受付 — 外部サービスに依存しない処理。
 *
 * ここの関数は Google Apps Script と Node.js の両方で動く。
 * Node.js では tools/report-intake/test.js から読み込んで検査している。
 */

/** HTML として安全な文字列にする。サイトの本文は HTML として扱われるため。 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // [文言](URL) はサイト側でリンクに変換される記法。投稿された文章が
    // 意図せずリンクになり、ビルドの検査で止まるのを防ぐ
    .replace(/\[/g, '&#91;');
}

/**
 * 入力された文章を段落の配列にする。
 * 空行で段落を分け、段落内の改行はつなげる。日本語同士はそのまま、
 * 英数字同士の境目だけ空白を入れる。
 */
function splitParagraphs(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); })
        .filter(function (l) { return l; });
      var out = '';
      lines.forEach(function (line) {
        if (out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(line)) {
          out += ' ';
        }
        out += line;
      });
      return out;
    })
    .filter(function (p) { return p; });
}

/** "2026-10-20" → {y: 2026, m: 10, d: 20}。不正なら null。 */
function parseIsoDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y: y, m: mo, d: d };
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** サイトに表示する日付。 */
function dateLabel(dt) {
  return dt.y + '年' + dt.m + '月' + dt.d + '日';
}

/**
 * その日付で次に使う連番を決める。
 * names は data/activities/<年>/ にあるファイル名の一覧。
 */
function nextSeq(names, dt) {
  var prefix = dt.y + '-' + pad2(dt.m) + '-' + pad2(dt.d) + '-';
  var max = 0;
  names.forEach(function (name) {
    if (name.indexOf(prefix) === 0) {
      var n = parseInt(name.slice(prefix.length, prefix.length + 2), 10);
      if (n > max) max = n;
    }
  });
  return max + 1;
}

/** 保存先のパスを決める。 */
function entryPaths(dt, seq, photoCount) {
  var stem = dt.y + '-' + pad2(dt.m) + '-' + pad2(dt.d) + '-' + pad2(seq);
  var photos = [];
  for (var i = 1; i <= photoCount; i++) {
    photos.push('report-' + stem + '-' + i + '.jpg');
  }
  return {
    entry: 'data/activities/' + dt.y + '/' + stem + '.json',
    photos: photos,
  };
}

/**
 * サイトに保存する JSON を作る。
 * draft = {date, body, photos: [{alt, caption}]}（いずれも入力されたままの文字列）
 */
function buildEntry(draft, photoNames) {
  var dt = parseIsoDate(draft.date);
  var entry = {
    date: dateLabel(dt),
    body: splitParagraphs(draft.body).map(escapeHtml),
  };
  if (photoNames.length) {
    entry.photos = draft.photos.map(function (p, i) {
      return {
        file: photoNames[i],
        alt: escapeHtml(p.alt.trim()),
        caption: escapeHtml(p.caption.trim()),
      };
    });
  }
  return JSON.stringify(entry, null, 2) + '\n';
}

/**
 * 公開してよい状態かを確かめる。問題があれば、本人に見せる文の配列を返す。
 * 写真の説明文が空のまま公開されることを防ぐのが一番の目的。
 */
function validateDraft(draft) {
  var errors = [];
  if (!parseIsoDate(draft.date)) {
    errors.push('活動の日付が正しくありません。');
  }
  if (!splitParagraphs(draft.body).length) {
    errors.push('活動の内容が空です。');
  }
  (draft.photos || []).forEach(function (p, i) {
    if (!String(p.alt || '').trim()) {
      errors.push((i + 1) + '枚目の写真の説明文が空です。目の見えない方に写真の内容を伝えるために必要です。');
    }
  });
  return errors;
}

/** 推測されにくい合言葉を作る。 */
function makeToken(randomHex) {
  return randomHex().replace(/-/g, '') + randomHex().replace(/-/g, '');
}

/**
 * JPEG から撮影情報を取り除く（位置情報・機種・撮影者名など）。
 *
 * 公開リポジトリに一度入った写真は履歴から消せないため、ここで確実に落とす。
 * 残すのは画像の表示に必要な部分と、色の再現に使う ICC プロファイルだけ。
 *   捨てる：APP1（Exif・XMP）、APP3〜APP13・APP15（IPTC など）、COM（コメント）
 *   残す　：APP0（JFIF）、APP2（ICC）、APP14（Adobe）、画像データそのもの
 *
 * bytes は数値の配列（Apps Script では -128〜127、Node.js では 0〜255）。
 * 戻り値は 0〜255 の数値の配列。
 */
function stripJpegMetadata(bytes) {
  function b(i) { return bytes[i] & 0xFF; }
  if (bytes.length < 4 || b(0) !== 0xFF || b(1) !== 0xD8) {
    throw new Error('JPEG 形式ではありません');
  }
  var out = [0xFF, 0xD8];
  var i = 2;
  while (i < bytes.length) {
    if (b(i) !== 0xFF) throw new Error('JPEG の構造が読み取れません（位置 ' + i + '）');
    if (b(i + 1) === 0xFF) { i++; continue; }            // 詰め物の 0xFF
    var marker = b(i + 1);
    if (marker === 0xD9) { out.push(0xFF, 0xD9); break; } // 終わり
    if (marker === 0xDA) {                                // 画像データの始まり。残りをそのまま写す
      for (var k = i; k < bytes.length; k++) out.push(b(k));
      break;
    }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      out.push(0xFF, marker); i += 2; continue;           // 長さを持たない印
    }
    var len = (b(i + 2) << 8) | b(i + 3);
    var drop = marker === 0xE1 || marker === 0xFE ||
      (marker >= 0xE3 && marker <= 0xEF && marker !== 0xEE);
    if (!drop) {
      for (var j = i; j < i + 2 + len; j++) out.push(b(j));
    }
    i += 2 + len;
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    escapeHtml: escapeHtml, splitParagraphs: splitParagraphs,
    parseIsoDate: parseIsoDate, dateLabel: dateLabel, nextSeq: nextSeq,
    entryPaths: entryPaths, buildEntry: buildEntry, validateDraft: validateDraft,
    makeToken: makeToken, stripJpegMetadata: stripJpegMetadata,
  };
}
