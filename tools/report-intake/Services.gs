/**
 * 活動報告の受付 — 外部サービスとのやりとり。
 *   写真：Google ドライブ
 *   説明文：Claude（Anthropic API）
 *   保存：GitHub
 *   下書き：Google スプレッドシート
 *   連絡：メール
 */

var REPO = 'nica-japan/nica-site';
var BRANCH = 'main';
var SITE = 'https://www.nica-japan.jp';

/** 設定値。スクリプト プロパティを優先し、なければ Config.local.gs の LOCAL を使う。 */
function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && typeof LOCAL !== 'undefined' && LOCAL[key]) v = LOCAL[key];
  if (!v) throw new Error('設定値 ' + key + ' がありません');
  return v;
}

/* =====================================================================
 * 写真
 * ===================================================================== */

/**
 * アップロードされた写真から、長辺 1280px の JPEG を作る。
 * Google ドライブの縮小画像を使うので、向きは正しく直り、HEIC にも対応する。
 * 念のため、撮影情報もバイト単位で取り除く（Lib.gs）。
 */
function shrinkPhoto_(fileId) {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  // アップロード直後は縮小画像がまだできていないことがあるので、少し待って再試行する
  for (var i = 0; i < 10; i++) {
    var meta = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=thumbnailLink',
      { headers: auth, muteHttpExceptions: true });
    if (meta.getResponseCode() === 200) {
      var link = JSON.parse(meta.getContentText()).thumbnailLink;
      if (link) {
        var url = /=s\d+$/.test(link) ? link.replace(/=s\d+$/, '=s1280') : link + '=s1280';
        var img = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true });
        if (img.getResponseCode() === 200) {
          var jpeg = img.getBlob().getAs(MimeType.JPEG).getBytes();
          var clean = stripJpegMetadata(jpeg).map(function (v) { return v > 127 ? v - 256 : v; });
          return Utilities.newBlob(clean, MimeType.JPEG);
        }
      }
    }
    Utilities.sleep(3000);
  }
  throw new Error('写真の縮小版を作れませんでした（ファイル ' + fileId + '）');
}

/* =====================================================================
 * 写真の説明文（Claude）
 * ===================================================================== */

var ALT_SYSTEM = [
  'あなたは NPO法人 NICA（日本インクルーシブ・クリエーターズ協会）のウェブサイトに載せる、写真の説明文を書く担当です。',
  'NICA は視覚に障害のある人と共に、コード化点字ブロックの普及、体験会、講演、インクルーシブ・ワークショップ、朗読会などを行っています。',
  'サイトの読者には、スクリーンリーダーの音声で閲覧する、視覚に障害のある人が多くいます。投稿者自身も目が見えないことがあり、',
  'あなたの説明文で「どの写真を送ったか」を確かめます。',
  '',
  '写真1枚について、次の2つを書いてください。',
  '',
  'alt（説明文）',
  '- 写真を見られない人が内容を思い浮かべられるように、重要なものから順に具体的に書く（場所、人の動き、物、雰囲気）',
  '- 看板、チラシ、スライドの見出しなど、写真の中に読める文字があれば書き起こす',
  '- 白杖、点字ブロック、コード化点字ブロック、誘導マット、弱視体験メガネ、アイマスクなど、視覚障害に関わる道具は正しい名前で書く',
  '- 人の年齢・性別・容姿は、活動の内容に関わる場合を除いて推測しない。名前は報告文や補足に書かれていて、写真の人物と確実に結びつく場合だけ使う',
  '- 写っていないことを報告文から補って書かない。判別できないものは書かない',
  '- 「写真」「画像」で書き始めない（読み上げソフトが先に画像だと伝えるため）。ただし4枚組やチラシのように、形式そのものが大事なときは書いてよい',
  '- です・ます調で2〜4文、全体で80〜200字程度',
  '',
  'caption（見出し）',
  '- 写真の下に表示する短い見出し。20〜40字程度で、体言止めにする',
].join('\n');

var ALT_SCHEMA = {
  type: 'object',
  properties: {
    alt: { type: 'string', description: '読み上げ用の説明文' },
    caption: { type: 'string', description: '写真の下に出す短い見出し' },
  },
  required: ['alt', 'caption'],
  additionalProperties: false,
};

/**
 * 写真の説明文と見出しを作る。うまくいかなければ null を返す
 * （その場合、投稿者が確認ページで自分で書く。空のままでは公開できない）。
 */
function describePhoto_(jpegBlob, body, note, index, total) {
  var text = [
    '活動報告の本文：', body, '',
    '投稿者からの写真についての補足：', note || '（なし）', '',
    '写真 ' + total + ' 枚のうち ' + index + ' 枚目です。この写真の alt と caption を書いてください。',
  ].join('\n');
  var payload = {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    // 安全判定で断られたとき、推奨の別モデルで自動的にやり直す
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ALT_SCHEMA },
    },
    system: ALT_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg',
          data: Utilities.base64Encode(jpegBlob.getBytes()) } },
        { type: 'text', text: text },
      ],
    }],
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': prop_('ANTHROPIC_API_KEY'),
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var res;
    try {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    } catch (err) {
      console.warn('説明文の作成：通信できませんでした（' + attempt + '回目）', err);
      Utilities.sleep(5000 * attempt);
      continue;
    }
    var code = res.getResponseCode();
    if (code === 429 || code === 529 || code >= 500) {   // 混雑・一時的な障害は待ってやり直す
      console.warn('説明文の作成：HTTP ' + code + '（' + attempt + '回目）');
      Utilities.sleep(5000 * attempt);
      continue;
    }
    if (code !== 200) {
      console.error('説明文の作成：HTTP ' + code, res.getContentText());
      return null;
    }
    var data = JSON.parse(res.getContentText());
    if (data.stop_reason !== 'end_turn') {               // refusal・max_tokens など
      console.warn('説明文の作成：stop_reason=' + data.stop_reason, JSON.stringify(data.stop_details || {}));
      return null;
    }
    var out = data.content.filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('');
    try {
      var parsed = JSON.parse(out);
      return { alt: String(parsed.alt || ''), caption: String(parsed.caption || '') };
    } catch (err) {
      console.error('説明文の作成：結果を読み取れませんでした', out);
      return null;
    }
  }
  return null;
}

/* =====================================================================
 * GitHub への保存
 * ===================================================================== */

function gh_(method, path, body) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + prop_('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: body ? JSON.stringify(body) : null,
    muteHttpExceptions: true,
  });
  var text = res.getContentText();
  return { code: res.getResponseCode(), json: text ? JSON.parse(text) : null };
}

function ghOk_(r, what) {
  if (r.code < 200 || r.code >= 300) {
    throw new Error('GitHub：' + what + 'に失敗しました（HTTP ' + r.code + '）'
      + (r.json && r.json.message ? ' ' + r.json.message : ''));
  }
  return r.json;
}

/** フォルダ内のファイル名の一覧。フォルダがなければ空。 */
function listNames_(dir) {
  var r = gh_('get', '/contents/' + dir + '?ref=' + BRANCH);
  if (r.code === 404) return [];
  return ghOk_(r, 'ファイル一覧の取得').map(function (f) { return f.name; });
}

/**
 * 複数のファイルを1つのコミットで保存する。
 * makeFiles() は保存するファイルを返す関数。途中で別の変更が入ったときは
 * 最新の状態から作り直してやり直す（連番がぶつからないように）。
 */
function commitFiles_(makeFiles, message) {
  for (var attempt = 1; attempt <= 3; attempt++) {
    var head = ghOk_(gh_('get', '/git/ref/heads/' + BRANCH), '最新状態の取得').object.sha;
    var baseTree = ghOk_(gh_('get', '/git/commits/' + head), 'コミットの取得').tree.sha;
    var made = makeFiles();
    var tree = made.files.map(function (f) {
      var blob = ghOk_(gh_('post', '/git/blobs', { content: f.base64, encoding: 'base64' }), 'ファイルの送信');
      return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
    });
    var newTree = ghOk_(gh_('post', '/git/trees', { base_tree: baseTree, tree: tree }), 'フォルダ構成の作成').sha;
    var commit = ghOk_(gh_('post', '/git/commits', { message: message, tree: newTree, parents: [head] }), 'コミットの作成').sha;
    var upd = gh_('patch', '/git/refs/heads/' + BRANCH, { sha: commit, force: false });
    if (upd.code === 200) return { sha: commit, made: made };
    if (upd.code !== 422) ghOk_(upd, '反映');
    console.warn('保存：先に別の変更が入ったため、やり直します（' + attempt + '回目）');
  }
  throw new Error('GitHub：何度試しても保存できませんでした');
}

/* =====================================================================
 * 下書き（スプレッドシート）
 * ===================================================================== */

var DRAFT_COLUMNS = ['id', 'token', 'status', 'createdAt', 'email', 'date', 'body', 'note',
  'photos', 'publishedAt', 'path', 'commit'];

function draftSheet_() {
  return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName('drafts');
}

function createDraft_(d) {
  var draft = {
    id: Utilities.getUuid(),
    token: makeToken(Utilities.getUuid),
    status: 'draft',
    createdAt: new Date(),
    email: d.email, date: d.date, body: d.body, note: d.note || '',
    photos: d.photos,
  };
  draftSheet_().appendRow([draft.id, draft.token, draft.status, draft.createdAt, draft.email,
    draft.date, draft.body, draft.note, JSON.stringify(draft.photos), '', '', '']);
  return draft;
}

function findDraft_(id) {
  if (!id) return null;
  var rows = draftSheet_().getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) {
    if (rows[r][0] === id) {
      var d = { row: r + 1 };
      DRAFT_COLUMNS.forEach(function (c, i) { d[c] = rows[r][i]; });
      d.photos = d.photos ? JSON.parse(d.photos) : [];
      // スプレッドシートが日付を Date 型に変えてしまう場合に備える
      if (d.date instanceof Date) d.date = Utilities.formatDate(d.date, 'Asia/Tokyo', 'yyyy-MM-dd');
      return d;
    }
  }
  return null;
}

function updateDraft_(d, fields) {
  var sh = draftSheet_();
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    sh.getRange(d.row, DRAFT_COLUMNS.indexOf(k) + 1).setValue(k === 'photos' ? JSON.stringify(v) : v);
  });
}

/* =====================================================================
 * メール
 * ===================================================================== */

function webAppUrl_(d) {
  return prop_('WEBAPP_URL') + '?id=' + encodeURIComponent(d.id) + '&t=' + encodeURIComponent(d.token);
}

function draftSummary_(d) {
  var lines = ['活動の日付：' + dateLabel(parseIsoDate(d.date)), '', '活動の内容：', d.body];
  d.photos.forEach(function (p, i) {
    lines.push('', '写真 ' + (i + 1) + ' の説明：', p.alt || '（作成できませんでした。確認ページで書いてください）');
    if (p.caption) lines.push('写真 ' + (i + 1) + ' の見出し：' + p.caption);
  });
  return lines.join('\n');
}

function sendDraftMail_(d) {
  var url = webAppUrl_(d);
  var missing = d.photos.some(function (p) { return !p.alt; });
  var body = [
    '活動報告の下書きができました。',
    '',
    missing
      ? '写真の説明文を作れなかったものがあります。確認ページで説明を書いてから公開してください。'
      : '写真の説明文は AI が作りました。内容が写真と合っているか確かめてください。',
    '',
    '下のリンクを開くと確認ページが表示されます。',
    '内容を直すこともできます。問題がなければ「この内容で公開する」を押してください。',
    '',
    '確認して公開する：',
    url,
    '',
    '――――――――――',
    draftSummary_(d),
    '――――――――――',
    '',
    'このリンクは14日間有効です。公開するまでサイトには載りません。',
  ].join('\n');
  MailApp.sendEmail({
    to: d.email,
    subject: '【NICA】活動報告の下書きができました（' + dateLabel(parseIsoDate(d.date)) + '）',
    body: body,
    name: 'NICA 活動報告',
  });
}

function sendPublishedMails_(d, url, commitSha) {
  var label = dateLabel(parseIsoDate(d.date));
  MailApp.sendEmail({
    to: d.email,
    subject: '【NICA】活動報告を公開しました（' + label + '）',
    body: ['活動報告を公開しました。1〜2分でサイトに表示されます。', '', url, '', 'ご投稿ありがとうございました。'].join('\n'),
    name: 'NICA 活動報告',
  });
  notify_('活動報告が公開されました（' + label + '）', [
    '投稿者：' + d.email, '掲載ページ：' + url,
    'コミット：https://github.com/' + REPO + '/commit/' + commitSha, '',
    draftSummary_(d),
  ].join('\n'));
}

/** 管理者（鬼頭）への連絡。 */
function notify_(subject, body) {
  try {
    MailApp.sendEmail({ to: prop_('NOTIFY_EMAIL'), subject: '【NICA受付】' + subject, body: body, name: 'NICA 活動報告' });
  } catch (err) {
    console.error('管理者への連絡に失敗しました', err);
  }
}
