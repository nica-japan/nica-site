/**
 * NICA 活動報告の受付（Google Apps Script）
 *
 * 流れ
 *   1. 理事がフォームに日付・本文・写真を入れて送信 → onFormSubmit
 *      写真を縮小し撮影情報を除去 → Claude が説明文を作成 → 下書きを保存
 *      → 投稿者に「下書きができました」とメール
 *   2. 投稿者がメールのリンクから確認ページ（doGet）を開き、見直して［公開］→ doPost
 *      → GitHub の nica-site に保存 → GitHub Actions がビルドしてサイトに掲載
 *
 * 設定値
 *   秘密の値はスクリプト プロパティに置く。設定用ページ（?setup=合言葉）から入力する。
 *     GITHUB_TOKEN       nica-site の Contents を読み書きできるトークン
 *     ANTHROPIC_API_KEY  写真の説明文を作るための API キー
 *   それ以外は Config.local.gs の LOCAL に置く（公開リポジトリには含めない）。
 *     ALLOWED_EMAILS     投稿を受け付けるメールアドレス（カンマ区切り）
 *     NOTIFY_EMAIL       公開やエラーを知らせる先
 *     WEBAPP_URL         ウェブアプリの URL（/exec で終わるもの）
 *     SETUP_TOKEN        設定用ページの合言葉
 *   setup が自動で書き込むもの：FORM_ID, SHEET_ID, FOLDER_ID
 */

var MAX_PHOTOS = 5;          // フォームの「最大ファイル数」の選択肢（1・5・10）に合わせる
var DRAFT_DAYS = 14;

/* =====================================================================
 * 初期設定
 * ===================================================================== */

/**
 * フォーム・下書き表・写真フォルダ・送信時の自動処理を用意する。
 * 何度実行しても、すでにあるものは作り直さない。
 * 設定用ページから呼ばれるほか、エディタで setup を実行してもよい。
 */
function setup() {
  var r = setupResources_();
  console.log('フォーム（編集）：' + r.formEditUrl);
  console.log('フォーム（回答）：' + r.formUrl);
  console.log('下書きの一覧　　：' + r.sheetUrl);
  return r;
}

function setupResources_() {
  var props = PropertiesService.getScriptProperties();

  var form;
  if (props.getProperty('FORM_ID')) {
    form = FormApp.openById(props.getProperty('FORM_ID'));
  } else {
    form = FormApp.create('NICA 活動報告の投稿');
    form.setDescription([
      'ホームページの「活動報告」に載せる内容を送ってください。',
      '送信すると、数分後に下書きがメールで届きます。内容を確認して「公開」を押すまで、サイトには載りません。',
    ].join('\n'));
    form.setCollectEmail(true);
    form.setAllowResponseEdits(false);
    form.setShowLinkToRespondAgain(true);
    form.setConfirmationMessage('送信しました。数分後に、下書きをメールでお送りします。');
    form.addDateItem()
      .setTitle('活動の日付')
      .setHelpText('活動を行った日を選んでください。')
      .setRequired(true);
    form.addParagraphTextItem()
      .setTitle('活動の内容')
      .setHelpText('何を、どこで、どなたと行ったかを書いてください。段落を分けたいときは、空いた行をはさんでください。')
      .setRequired(true);
    form.addParagraphTextItem()
      .setTitle('写真についての補足（任意）')
      .setHelpText('写真の説明文を作るときの参考にします。例：「左から本間、川口」「ステージで朗読しているところ」');
    props.setProperty('FORM_ID', form.getId());
  }

  // 回答できる人を、投稿を受け付ける人だけに限る（個人の Gmail を含む）。
  // 1件ずつ追加し、Google アカウントでないアドレスなどで失敗しても他は登録する
  var added = [], failed = [], readers;
  if (form.supportsAdvancedResponderPermissions()) {
    allowedEmails_().forEach(function (email) {
      try { form.addPublishedReader(email); added.push(email); }
      catch (err) { failed.push(email + '（' + (err.message || err) + '）'); }
    });
    readers = added.join('、') || 'なし';
    if (failed.length) readers += ' ／ 追加できなかった：' + failed.join('、');
  } else {
    form.setRequireLogin(false);
    readers = 'リンクを知っている全員';
  }
  try { form.setPublished(true); } catch (err) { console.warn('フォームを公開できませんでした', err); }

  var ss;
  if (props.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('NICA 活動報告の下書き');
    var sheet = ss.getSheets()[0];
    sheet.setName('drafts');
    sheet.appendRow(DRAFT_COLUMNS);
    sheet.setFrozenRows(1);
    props.setProperty('SHEET_ID', ss.getId());
  }

  if (!props.getProperty('FOLDER_ID')) {
    props.setProperty('FOLDER_ID', DriveApp.createFolder('NICA 活動報告の写真（下書き）').getId());
  }

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'onFormSubmit';
  });
  if (!hasTrigger) ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();

  var hasUpload = form.getItems().some(function (it) { return it.getType() === FormApp.ItemType.FILE_UPLOAD; });
  return {
    formEditUrl: form.getEditUrl(),
    formUrl: form.getPublishedUrl(),
    sheetUrl: ss.getUrl(),
    readers: readers,
    readersOk: failed.length === 0,
    hasUpload: hasUpload,
  };
}

function allowedEmails_() {
  return prop_('ALLOWED_EMAILS').toLowerCase().split(',')
    .map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

/* =====================================================================
 * 1. フォームが送信されたとき
 * ===================================================================== */

function onFormSubmit(e) {
  var email = String(e.response.getRespondentEmail() || '').trim().toLowerCase();
  if (allowedEmails_().indexOf(email) < 0) {
    notify_('許可されていないアドレスからの投稿を受け付けませんでした', 'アドレス：' + (email || '（不明）'));
    return;
  }

  try {
    var ans = readAnswers_(e.response);
    var folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
    var ids = ans.fileIds.slice(0, MAX_PHOTOS);
    var photos = ids.map(function (id, i) {
      var jpeg = shrinkPhoto_(id);
      var saved = folder.createFile(jpeg.setName(Utilities.getUuid() + '.jpg'));
      var desc = describePhoto_(jpeg, ans.body, ans.note, i + 1, ids.length);
      return { fileId: saved.getId(), alt: desc ? desc.alt : '', caption: desc ? desc.caption : '' };
    });
    var draft = createDraft_({ email: email, date: ans.date, body: ans.body, note: ans.note, photos: photos });
    sendDraftMail_(draft);
    if (ans.fileIds.length > MAX_PHOTOS) {
      notify_('写真が多すぎたため、一部を使いませんでした', email + ' から ' + ans.fileIds.length + ' 枚の写真。先頭の ' + MAX_PHOTOS + ' 枚だけを使いました。');
    }
  } catch (err) {
    console.error(err);
    notify_('活動報告の受付でエラーが起きました', '投稿者：' + email + '\n\n' + (err.stack || err));
    MailApp.sendEmail({
      to: email,
      subject: '【NICA】活動報告を受け付けられませんでした',
      body: '申し訳ありません。活動報告の受付中に問題が起きました。\n担当者に連絡が届いていますので、しばらくお待ちください。',
      name: 'NICA 活動報告',
    });
  }
}

function readAnswers_(response) {
  var out = { date: '', body: '', note: '', fileIds: [] };
  response.getItemResponses().forEach(function (ir) {
    var item = ir.getItem();
    var type = item.getType();
    var v = ir.getResponse();
    if (type === FormApp.ItemType.DATE) out.date = v;                       // "YYYY-MM-DD"
    else if (type === FormApp.ItemType.FILE_UPLOAD) out.fileIds = out.fileIds.concat(v);
    else if (item.getTitle().indexOf('補足') >= 0) out.note = v;
    else if (type === FormApp.ItemType.PARAGRAPH_TEXT) out.body = v;
  });
  return out;
}

/* =====================================================================
 * 2. 確認ページ
 * ===================================================================== */

function doGet(e) {
  var p0 = e.parameter || {};
  if ('setup' in p0) return setupPage_(p0.setup, null);
  var d = checkDraft_(p0);
  if (d.page) return d.page;
  return previewPage_(d, []);
}

function doPost(e) {
  var p = e.parameter || {};
  if (p.action === 'setup') return handleSetup_(p);
  // 二度押しや同時操作で二重に公開されないよう、1件ずつ処理する
  var lock = LockService.getScriptLock();
  lock.waitLock(120000);
  try {
    var d = checkDraft_(p);
    if (d.page) return d.page;

    if (p.action === 'cancel') {
      updateDraft_(d, { status: 'cancelled' });
      return messagePage_('下書きを取り消しました', ['この報告はサイトに載りません。'], null);
    }

    d.date = String(p.date || '');
    d.body = String(p.body || '');
    d.photos = d.photos.map(function (ph, i) {
      return { fileId: ph.fileId, alt: String(p['alt' + i] || ''), caption: String(p['caption' + i] || '') };
    });
    var errors = validateDraft(d);
    if (errors.length) return previewPage_(d, errors);

    var dt = parseIsoDate(d.date);
    var result = commitFiles_(function () {
      var seq = nextSeq(listNames_('data/activities/' + dt.y), dt);
      var paths = entryPaths(dt, seq, d.photos.length);
      var files = [{ path: paths.entry,
        base64: Utilities.base64Encode(buildEntry(d, paths.photos), Utilities.Charset.UTF_8) }];
      d.photos.forEach(function (ph, i) {
        files.push({ path: 'assets/img/' + paths.photos[i],
          base64: Utilities.base64Encode(DriveApp.getFileById(ph.fileId).getBlob().getBytes()) });
      });
      return { files: files, entry: paths.entry };
    }, '活動報告を追加（' + dateLabel(dt) + '）');

    updateDraft_(d, { status: 'published', publishedAt: new Date(), path: result.made.entry,
      commit: result.sha, date: d.date, body: d.body, photos: d.photos });
    var url = SITE + '/activities/' + dt.y + '/';
    sendPublishedMails_(d, url, result.sha);
    return messagePage_('公開しました', [
      '1〜2分でサイトに表示されます。',
      '公開のお知らせをメールでもお送りしました。',
    ], { href: url, text: dt.y + '年の活動報告を見る' });
  } catch (err) {
    console.error(err);
    notify_('活動報告の公開でエラーが起きました', (p.id || '') + '\n\n' + (err.stack || err));
    return messagePage_('公開できませんでした', [
      '申し訳ありません。公開の途中で問題が起きました。',
      '担当者に連絡が届いていますので、しばらくお待ちください。',
    ], null);
  } finally {
    lock.releaseLock();
  }
}

/** 下書きの存在・合言葉・状態を確かめる。問題があれば d.page に表示するページを入れて返す。 */
function checkDraft_(p) {
  var d = findDraft_(p.id);
  if (!d || d.token !== p.t) {
    return { page: messagePage_('下書きが見つかりません',
      ['リンクが途中で切れていないか、メールをもう一度ご確認ください。'], null) };
  }
  if (d.status === 'published') {
    var y = String(d.date).slice(0, 4);
    return { page: messagePage_('この報告は公開済みです', [],
      { href: SITE + '/activities/' + y + '/', text: y + '年の活動報告を見る' }) };
  }
  if (d.status === 'cancelled') {
    return { page: messagePage_('この下書きは取り消し済みです', ['もう一度投稿する場合は、フォームから送ってください。'], null) };
  }
  if (new Date().getTime() - new Date(d.createdAt).getTime() > DRAFT_DAYS * 86400000) {
    return { page: messagePage_('この下書きは有効期限が切れました',
      ['お手数ですが、もう一度フォームから送ってください。'], null) };
  }
  return d;
}

function previewPage_(d, errors) {
  var t = HtmlService.createTemplateFromFile('Preview');
  t.d = d;
  t.errors = errors;
  t.action = prop_('WEBAPP_URL');
  t.photos = d.photos.map(function (ph) {
    var blob = DriveApp.getFileById(ph.fileId).getBlob();
    return { alt: ph.alt, caption: ph.caption,
      src: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) };
  });
  return t.evaluate().setTitle('活動報告の下書き｜NICA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function messagePage_(title, lines, link) {
  var t = HtmlService.createTemplateFromFile('Message');
  t.title = title;
  t.lines = lines;
  t.link = link;
  return t.evaluate().setTitle(title + '｜NICA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* =====================================================================
 * 設定用ページ（?setup=合言葉）
 *   秘密の値を入力し、動作を確かめ、必要なものを用意する。
 *   トークンの期限が来たときも、ここから貼り替える。
 * ===================================================================== */

function setupPage_(token, result) {
  if (!token || token !== prop_('SETUP_TOKEN')) {
    return messagePage_('ページが見つかりません', [], null);
  }
  var props = PropertiesService.getScriptProperties();
  var t = HtmlService.createTemplateFromFile('Setup');
  t.action = prop_('WEBAPP_URL');
  t.token = token;
  t.hasGithub = !!props.getProperty('GITHUB_TOKEN');
  t.hasAnthropic = !!props.getProperty('ANTHROPIC_API_KEY');
  t.result = result;
  return t.evaluate().setTitle('設定｜NICA 活動報告の受付')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function handleSetup_(p) {
  if (!p.token || p.token !== prop_('SETUP_TOKEN')) {
    return messagePage_('ページが見つかりません', [], null);
  }
  var props = PropertiesService.getScriptProperties();
  if (String(p.github || '').trim()) props.setProperty('GITHUB_TOKEN', String(p.github).trim());
  if (String(p.anthropic || '').trim()) props.setProperty('ANTHROPIC_API_KEY', String(p.anthropic).trim());

  var checks = [];
  checks.push(checkGithub_());
  checks.push(checkAnthropic_());
  var res = null;
  try {
    res = setupResources_();
    checks.push({ ok: true, name: 'フォーム・下書き表・写真フォルダ・自動処理', detail: '用意できました' });
    checks.push({ ok: res.readersOk, name: '回答できる人', detail: res.readers });
  } catch (err) {
    checks.push({ ok: false, name: 'フォームなどの用意', detail: String(err.message || err) });
  }
  return setupPage_(p.token, { checks: checks, res: res });
}

function checkGithub_() {
  var name = 'GitHub トークン';
  if (!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')) {
    return { ok: false, name: name, detail: '未入力です' };
  }
  try {
    var r = gh_('get', '/contents/data/activities?ref=' + BRANCH);
    if (r.code === 200) return { ok: true, name: name, detail: 'nica-site を読めました（書き込みは初回の公開で確かめます）' };
    return { ok: false, name: name, detail: 'HTTP ' + r.code + '（期限切れ・承認待ち・権限不足の可能性）' };
  } catch (err) {
    return { ok: false, name: name, detail: String(err.message || err) };
  }
}

function checkAnthropic_() {
  var name = 'Anthropic API キー';
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, name: name, detail: '未入力です' };
  try {
    // モデル一覧の取得は課金されない
    var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21' }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) return { ok: true, name: name, detail: '使えることを確かめました' };
    return { ok: false, name: name, detail: 'HTTP ' + r.getResponseCode() + '（キーが正しくない可能性）' };
  } catch (err) {
    return { ok: false, name: name, detail: String(err.message || err) };
  }
}
