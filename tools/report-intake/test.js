// 活動報告の受付 — Lib.gs の検査。
//   node tools/report-intake/test.js
// 外部サービスには接続しない。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Lib.gs'), 'utf8'), ctx);
const L = ctx.module.exports;

// vm の中で作られた配列・オブジェクトは別の領域に属するため、値で比べる
const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

t('HTML の特殊文字を無害化する', () => {
  assert.strictEqual(L.escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

t('[文言](URL) がリンクに化けない', () => {
  assert.strictEqual(L.escapeHtml('[こちら](https://x.jp)'), '&#91;こちら](https://x.jp)');
});

t('空行で段落を分け、段落内の改行はつなぐ', () => {
  same(
    L.splitParagraphs('一行目\n二行目\n\n\n三段落目\r\n'),
    ['一行目二行目', '三段落目']);
});

t('英単語どうしの改行には空白を入れる', () => {
  same(L.splitParagraphs('Hello\nWorld\n日本\n語'), ['Hello World日本語']);
});

t('空白だけの入力は段落なし', () => {
  same(L.splitParagraphs(' \n\n \n'), []);
});

t('日付の解析（存在しない日付を弾く）', () => {
  same(L.parseIsoDate('2026-10-20'), { y: 2026, m: 10, d: 20 });
  assert.strictEqual(L.parseIsoDate('2026-02-30'), null);
  assert.strictEqual(L.parseIsoDate('20261020'), null);
});

t('表示用の日付', () => {
  assert.strictEqual(L.dateLabel({ y: 2026, m: 3, d: 5 }), '2026年3月5日');
});

t('連番は同じ日付の最大値 +1', () => {
  const dt = { y: 2026, m: 10, d: 20 };
  assert.strictEqual(L.nextSeq([], dt), 1);
  assert.strictEqual(L.nextSeq(['2026-10-20-01.json', '2026-10-20-03.json', '2026-10-21-09.json',
    '2026-10-00-05.json'], dt), 4);
});

t('保存先のパス', () => {
  const p = L.entryPaths({ y: 2027, m: 1, d: 9 }, 2, 2);
  assert.strictEqual(p.entry, 'data/activities/2027/2027-01-09-02.json');
  same(p.photos,
    ['report-2027-01-09-02-1.jpg', 'report-2027-01-09-02-2.jpg']);
});

t('写真の説明文が空なら公開させない', () => {
  const errs = L.validateDraft({ date: '2026-10-20', body: '内容', photos: [{ alt: '説明', caption: '' }, { alt: ' ', caption: '' }] });
  assert.strictEqual(errs.length, 1);
  assert.ok(errs[0].includes('2枚目'));
  assert.strictEqual(L.validateDraft({ date: '2026-10-20', body: 'x', photos: [] }).length, 0);
  assert.strictEqual(L.validateDraft({ date: 'x', body: ' ', photos: [] }).length, 2);
});

t('合言葉は64文字の16進数', () => {
  const tok = L.makeToken(() => require('crypto').randomUUID());
  assert.match(tok, /^[0-9a-f]{64}$/);
});

t('保存する JSON の形', () => {
  const json = L.buildEntry({
    date: '2026-10-20',
    body: '体験会を開きました。\n\n参加者は "20名" & <盛況> でした。',
    photos: [{ alt: ' 白杖を持つ人 ', caption: '体験会の様子' }],
  }, ['report-2026-10-20-01-1.jpg']);
  const e = JSON.parse(json);
  assert.strictEqual(e.date, '2026年10月20日');
  same(e.body, ['体験会を開きました。', '参加者は &quot;20名&quot; &amp; &lt;盛況&gt; でした。']);
  same(e.photos, [{ file: 'report-2026-10-20-01-1.jpg', alt: '白杖を持つ人', caption: '体験会の様子' }]);
  assert.ok(json.endsWith('}\n'));
});

t('写真なしなら photos 欄を作らない', () => {
  const e = JSON.parse(L.buildEntry({ date: '2026-10-20', body: 'a', photos: [] }, []));
  assert.strictEqual('photos' in e, false);
});

t('JPEG から位置情報を取り除き、画像は壊さない', () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nica-'));
  const src = path.join(dir, 'in.jpg'), dst = path.join(dir, 'out.jpg');
  // 位置情報・XMP・コメント・ICC 付きの写真を Pillow で作る
  execFileSync('python3', ['-c', `
from PIL import Image, ImageCms
im = Image.new("RGB", (320, 240))
for x in range(320):
    for y in range(240): im.putpixel((x, y), (x % 256, y % 256, (x+y) % 256))
ex = Image.Exif(); ex[0x8825] = {1: "N", 2: (35.0, 41.0, 0.0)}; ex[0x0110] = "iPhone"
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
im.save("${src}", "JPEG", quality=95, exif=ex, icc_profile=icc,
        xmp=b"<x:xmpmeta><rdf:Description exif:GPSLatitude='35,41'/></x:xmpmeta>", comment=b"secret")
`]);
  const input = fs.readFileSync(src);
  assert.ok(input.includes('iPhone') && input.includes('GPSLatitude') && input.includes('secret'), '前提：入力に撮影情報がある');
  const out = Buffer.from(L.stripJpegMetadata(input));
  fs.writeFileSync(dst, out);
  assert.ok(!out.includes('iPhone') && !out.includes('GPSLatitude') && !out.includes('secret') && !out.includes('Exif'),
    '撮影情報が残っていない');
  const check = execFileSync('python3', ['-c', `
from PIL import Image
a, b = Image.open("${src}"), Image.open("${dst}")
print(len(b.getexif()), b.size == a.size, list(a.getdata()) == list(b.getdata()), "icc_profile" in b.info)
`]).toString().trim();
  assert.strictEqual(check, '0 True True True', 'EXIF 0件・寸法同じ・画素が完全一致・色情報は保持');
  // Apps Script の符号付きバイトでも同じ結果になる
  const signed = Array.from(input, v => (v > 127 ? v - 256 : v));
  assert.deepStrictEqual(Buffer.from(L.stripJpegMetadata(signed)), out);
  assert.throws(() => L.stripJpegMetadata([0x89, 0x50, 0x4E, 0x47]), /JPEG 形式ではありません/);
});

console.log(`\n${n} 件すべて成功`);
