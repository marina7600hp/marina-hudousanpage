/**
 * ============================================================
 * 退去精算ワークフロー バックエンド（Google Apps Script）
 * 有限会社仁方大森マリーナー
 *
 * 段階：
 *   解約フォーム（別GAS: kaiyaku.gs）
 *     ↓
 *   ① 退去立会い：原状回復箇所の写真＋借主負担費用に電子署名で同意
 *       → 原状回復箇所報告書PDF（写真・根拠資料）
 *       → 退去立会い同意書PDF（費用・署名）
 *     ↓
 *   ② 修繕見積書：品目×数量×単価×借主負担率で算出 → 修繕見積書PDF
 *     ↓
 *   ③ 修繕精算書：敷金・原状回復費から返金額を算出 → 修繕精算書PDF
 *
 * 保存先（親フォルダ配下に自動作成・段階別に分離）：
 *   原状回復箇所報告書 / 退去立会い同意書 / 修繕見積書 / 修繕精算書
 * 進捗は「退去精算_進捗管理」スプレッドシートで管理し、
 * 管理画面（taikyo.html）から段階を進めます。
 *
 * セットアップは TAIKYO_SETUP.md を参照してください。
 * ============================================================
 */

const T_CONFIG = {
  // 通知メールの宛先
  NOTIFY_EMAIL: 'marina.oomori1@gmail.com',
  // 退去精算ワークフローの親フォルダID
  // https://drive.google.com/drive/folders/1EYL6CpLSXe6dU2oKPXzPUgLqiDYdJfi1
  PARENT_FOLDER_ID: '1EYL6CpLSXe6dU2oKPXzPUgLqiDYdJfi1',
  // （任意）解約フォームの「解約通知受付一覧」スプレッドシートID。
  // 設定すると、管理画面で解約済みの案件を取り込んで立会いを開始できます。
  // 空欄の場合は管理画面で手入力して案件を作成します。
  KAIYAKU_LOG_ID: '',
  COMPANY: '有限会社仁方大森マリーナー',
  COMPANY_TEL: '0823-27-7600',
  COMPANY_ADDR: '呉市仁方',
  PROGRESS_SHEET_NAME: '退去精算_進捗管理',
  SENDER_NAME: '仁方大森マリーナー 退去精算',
  SUBFOLDERS: {
    report: '原状回復箇所報告書',
    consent: '退去立会い同意書',
    estimate: '修繕見積書',
    settlement: '修繕精算書',
  },
  // 費用の初期値（税込・円）※管理画面で個別に変更可
  DEFAULT_CLEANING: 44000,   // 室内清掃費
  DEFAULT_AC: 11000,         // エアコン洗浄費（1台）
  DEFAULT_TATAMI: 5000,      // 畳表替え（1枚）
  DEFAULT_CROSS_UNIT: 1800,  // クロス㎡単価（税別）
  TAX_RATE: 0.10,
};

/** 管理画面からのGET（案件一覧の取得） */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'list') {
      return json_({ ok: true, cases: listCases_(), importable: importableCases_() });
    }
    if (action === 'ping') {
      return json_({ ok: true, message: '退去精算ワークフローは稼働中です。' });
    }
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** 管理画面からのPOST（各段階の登録） */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'newCase') return json_(createCase_(data));
    if (action === 'tachiai') return json_(saveTachiai_(data));
    if (action === 'estimate') return json_(saveEstimate_(data));
    if (action === 'settlement') return json_(saveSettlement_(data));
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------- フォルダ・シート ----------------
function parentFolder_() { return DriveApp.getFolderById(T_CONFIG.PARENT_FOLDER_ID); }

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 進捗管理スプレッドシート（親フォルダ内に自動作成） */
function progressSheet_() {
  const parent = parentFolder_();
  let ss;
  const it = parent.getFilesByName(T_CONFIG.PROGRESS_SHEET_NAME);
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(T_CONFIG.PROGRESS_SHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(parent);
  }
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '案件ID', '更新日時', '状態', '氏名', 'フリガナ', '物件名', '部屋番号',
      'データJSON', '原状回復報告書URL', '立会い同意書URL', '見積書URL', '精算書URL',
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

const PS_COL = { id: 1, updated: 2, status: 3, name: 4, kana: 5, bukken: 6, room: 7,
  json: 8, reportUrl: 9, consentUrl: 10, estimateUrl: 11, settlementUrl: 12 };

/** 案件一覧を取得 */
function listCases_() {
  const sheet = progressSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, 12).getValues();
  return values.map(function (r) {
    let d = {};
    try { d = r[PS_COL.json - 1] ? JSON.parse(r[PS_COL.json - 1]) : {}; } catch (e) {}
    return {
      id: r[PS_COL.id - 1],
      updated: r[PS_COL.updated - 1] ? Utilities.formatDate(new Date(r[PS_COL.updated - 1]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
      status: r[PS_COL.status - 1],
      name: r[PS_COL.name - 1], kana: r[PS_COL.kana - 1],
      bukken: r[PS_COL.bukken - 1], room: r[PS_COL.room - 1],
      data: d,
      reportUrl: r[PS_COL.reportUrl - 1], consentUrl: r[PS_COL.consentUrl - 1],
      estimateUrl: r[PS_COL.estimateUrl - 1], settlementUrl: r[PS_COL.settlementUrl - 1],
    };
  }).reverse(); // 新しい順
}

/** 解約フォームの受付一覧から、まだ取り込んでいない管理物件案件を返す */
function importableCases_() {
  if (!T_CONFIG.KAIYAKU_LOG_ID) return [];
  let ss;
  try { ss = SpreadsheetApp.openById(T_CONFIG.KAIYAKU_LOG_ID); } catch (e) { return []; }
  const sheet = ss.getSheets()[0];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, 12).getValues();
  const existing = {};
  listCases_().forEach(function (c) { if (c.data && c.data.receiptNo) existing[c.data.receiptNo] = true; });
  const out = [];
  rows.forEach(function (r) {
    // kaiyaku.gs の列: 受付日時,受付番号,種別,物件名,部屋,氏名,フリガナ,電話,メール,解約日,...
    const receiptNo = r[1], kind = r[2];
    if (kind !== '管理物件') return; // 立会いは管理物件のみ
    if (existing[receiptNo]) return;
    out.push({
      receiptNo: receiptNo, bukken: r[3], room: r[4], name: r[5], kana: r[6],
      tel: r[7], email: r[8], endDate: r[9],
    });
  });
  return out;
}

function findRow_(sheet, caseId) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(caseId)) return i + 2;
  return -1;
}

function upsertCase_(caseId, patch) {
  const sheet = progressSheet_();
  let row = findRow_(sheet, caseId);
  const now = new Date();
  if (row < 0) {
    sheet.appendRow([caseId, now, patch.status || '解約受付', patch.name || '', patch.kana || '',
      patch.bukken || '', patch.room || '', JSON.stringify(patch.data || {}),
      patch.reportUrl || '', patch.consentUrl || '', patch.estimateUrl || '', patch.settlementUrl || '']);
    return;
  }
  sheet.getRange(row, PS_COL.updated).setValue(now);
  const map = { status: PS_COL.status, name: PS_COL.name, kana: PS_COL.kana, bukken: PS_COL.bukken,
    room: PS_COL.room, reportUrl: PS_COL.reportUrl, consentUrl: PS_COL.consentUrl,
    estimateUrl: PS_COL.estimateUrl, settlementUrl: PS_COL.settlementUrl };
  Object.keys(map).forEach(function (k) {
    if (patch[k] !== undefined && patch[k] !== '') sheet.getRange(row, map[k]).setValue(patch[k]);
  });
  if (patch.data !== undefined) {
    // 既存データにマージ
    let cur = {};
    try { cur = JSON.parse(sheet.getRange(row, PS_COL.json).getValue() || '{}'); } catch (e) {}
    const merged = Object.assign(cur, patch.data);
    sheet.getRange(row, PS_COL.json).setValue(JSON.stringify(merged));
  }
}

// ---------------- ① 案件作成 ----------------
function createCase_(data) {
  const caseId = data.receiptNo || ('T' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss'));
  upsertCase_(caseId, {
    status: '解約受付',
    name: data.name || '', kana: data.kana || '',
    bukken: data.bukken || '', room: data.room || '',
    data: {
      receiptNo: data.receiptNo || '', tel: data.tel || '', email: data.email || '',
      endDate: data.endDate || '',
    },
  });
  return { ok: true, caseId: caseId };
}

// ---------------- 共通ユーティリティ ----------------
function fmtYen_(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeName_(s) { return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim(); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年M月d日'); }
function caseLabel_(c) { return safeName_(c.bukken) + '_' + safeName_(c.room) + '_' + safeName_(c.name); }

/** data URL (image/xxx;base64,....) を Blob に変換 */
function dataUrlToBlob_(dataUrl, filename) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[2]);
  return Utilities.newBlob(bytes, m[1], filename);
}

function htmlToPdf_(html, filename) {
  return Utilities.newBlob(html, MimeType.HTML, filename).getAs(MimeType.PDF).setName(filename);
}

function docHead_(title) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:sans-serif;color:#111;font-size:12px;margin:22px;}' +
    'h1{font-size:19px;text-align:center;letter-spacing:4px;margin:4px 0 2px;}' +
    '.sub{text-align:center;font-size:11px;color:#555;margin-bottom:14px;}' +
    '.meta{text-align:right;font-size:11px;color:#333;}' +
    '.to{font-size:13px;margin:10px 0 4px;font-weight:bold;}' +
    'table{width:100%;border-collapse:collapse;margin-top:6px;}' +
    'th,td{border:1px solid #666;padding:6px 8px;font-size:11.5px;vertical-align:top;}' +
    'th{background:#f0f0f0;text-align:left;font-weight:bold;}' +
    '.right{text-align:right;} .center{text-align:center;}' +
    '.foot{margin-top:14px;font-size:10.5px;color:#555;line-height:1.6;}' +
    '.sign{margin-top:12px;border:1px solid #666;padding:10px;}' +
    '.sign img{height:70px;} .note{font-size:10.5px;color:#444;line-height:1.7;}' +
    '.photo{width:48%;display:inline-block;vertical-align:top;margin:1%;box-sizing:border-box;}' +
    '.photo img{width:100%;border:1px solid #999;}' +
    '.photo .cap{font-size:10.5px;padding:3px 2px;}' +
    '</style></head><body>';
}

// ---------------- ② 退去立会い（写真＋署名） ----------------
function saveTachiai_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, kana: data.kana, bukken: data.bukken, room: data.room };
  const parent = parentFolder_();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  const label = caseLabel_(c);

  // --- 原状回復箇所報告書：写真をフォルダに保存＋報告書PDF ---
  const reportRoot = getOrCreateSubfolder_(parent, T_CONFIG.SUBFOLDERS.report);
  const caseFolder = reportRoot.createFolder(label + '_' + dateStr);
  const photos = data.photos || [];
  let photoHtml = '';
  photos.forEach(function (p, i) {
    const blob = dataUrlToBlob_(p.dataUrl, label + '_' + (i + 1) + '.jpg');
    if (blob) caseFolder.createFile(blob);
    photoHtml += '<div class="photo"><img src="' + p.dataUrl + '">' +
      '<div class="cap">No.' + (i + 1) + '　' + esc_(p.label || '') +
      (p.memo ? '<br>' + esc_(p.memo) : '') + '</div></div>';
  });
  const reportHtml = docHead_() +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<div class="meta">作成日：' + today_() + '</div>' +
    '<h1>原状回復箇所報告書</h1>' +
    '<div class="sub">退去立会いにて撮影・記録</div>' +
    '<table><tr><th style="width:22%">物件名</th><td>' + esc_(c.bukken) + '</td>' +
    '<th style="width:14%">部屋番号</th><td>' + esc_(c.room) + '</td></tr>' +
    '<tr><th>退去者（借主）</th><td>' + esc_(c.name) + '</td>' +
    '<th>写真枚数</th><td>' + photos.length + '枚</td></tr></table>' +
    '<div style="margin-top:10px">' + (photoHtml || '（写真なし）') + '</div>' +
    '<div class="foot">本報告書は退去立会い時に撮影した原状回復箇所の記録であり、修繕費用の根拠資料です。<br>' +
    esc_(T_CONFIG.COMPANY) + '</div></body></html>';
  const reportPdf = htmlToPdf_(reportHtml, '原状回復箇所報告書_' + label + '_' + dateStr + '.pdf');
  const reportFile = caseFolder.createFile(reportPdf);

  // --- 退去立会い同意書：費用＋電子署名 ---
  const ch = data.charges || {};
  const rows = [];
  if (Number(ch.cleaning) > 0) rows.push(['室内清掃費（借主負担）', fmtYen_(ch.cleaning)]);
  if (Number(ch.acCount) > 0) rows.push(['エアコン洗浄費（借主負担）', fmtYen_(ch.acUnit) + ' × ' + Number(ch.acCount) + '台 ＝ ' + fmtYen_(Number(ch.acUnit) * Number(ch.acCount))]);
  if (Number(ch.tatamiCount) > 0) rows.push(['畳表替え費用（借主負担）', fmtYen_(ch.tatamiUnit) + ' × ' + Number(ch.tatamiCount) + '枚 ＝ ' + fmtYen_(Number(ch.tatamiUnit) * Number(ch.tatamiCount))]);
  const fixedTotal = (Number(ch.cleaning) || 0) + (Number(ch.acUnit) || 0) * (Number(ch.acCount) || 0) + (Number(ch.tatamiUnit) || 0) * (Number(ch.tatamiCount) || 0);
  let chargeRows = rows.map(function (r) { return '<tr><th style="width:45%">' + esc_(r[0]) + '</th><td class="right">' + esc_(r[1]) + '</td></tr>'; }).join('');
  chargeRows += '<tr><th>上記の借主負担 合計（確定分）</th><td class="right"><b>' + fmtYen_(fixedTotal) + '</b></td></tr>';

  const crossNote = ch.crossAgree
    ? '・クロス（壁紙）の借主負担補修が生じた場合は、㎡単価 ' + fmtYen_(ch.crossUnit || T_CONFIG.DEFAULT_CROSS_UNIT) + '（税別）を基準に実測のうえ精算することに同意します。'
    : '';
  const otherNote = ch.otherNote ? '・' + esc_(ch.otherNote) : '';

  const consentHtml = docHead_() +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<div class="meta">立会い日：' + today_() + '</div>' +
    '<h1>退去立会い同意書</h1>' +
    '<div class="to">貸主様<br>' + esc_(T_CONFIG.COMPANY) + ' 御中</div>' +
    '<table><tr><th style="width:22%">物件名</th><td>' + esc_(c.bukken) + '</td>' +
    '<th style="width:14%">部屋番号</th><td>' + esc_(c.room) + '</td></tr></table>' +
    '<p class="note" style="margin-top:10px">私は、退去立会いにおいて下記の借主負担費用を確認し、支払うことに同意いたします。</p>' +
    '<table>' + chargeRows + '</table>' +
    '<div class="note" style="margin-top:8px">' +
    (crossNote ? crossNote + '<br>' : '') +
    (otherNote ? otherNote + '<br>' : '') +
    '・上記のほか、契約内容および原状回復に関する借主負担部分を負担することに同意します。' +
    '</div>' +
    '<div class="sign">' +
    '<div>令和　　年　　月　　日　　　立会い日：' + today_() + '</div>' +
    '<div style="margin-top:6px">氏名（署名）：' +
    (data.signature ? '<br><img src="' + data.signature + '">' : '＿＿＿＿＿＿＿＿') + '</div>' +
    (data.signerName ? '<div style="margin-top:4px">署名者：' + esc_(data.signerName) + '</div>' : '') +
    '</div>' +
    '<div class="foot">立会い会社：' + esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) +
    '<br>本書は退去立会い時に借主が電子的に署名し同意したものです。</div></body></html>';
  const consentFolder = getOrCreateSubfolder_(parent, T_CONFIG.SUBFOLDERS.consent);
  const consentPdf = htmlToPdf_(consentHtml, '退去立会い同意書_' + label + '_' + dateStr + '.pdf');
  const consentFile = consentFolder.createFile(consentPdf);

  // 進捗更新（費用は見積へ引き継ぐ）
  upsertCase_(caseId, {
    status: '立会い済', name: c.name, kana: c.kana, bukken: c.bukken, room: c.room,
    reportUrl: reportFile.getUrl(), consentUrl: consentFile.getUrl(),
    data: { charges: ch, tachiaiDate: today_(), photoCount: photos.length,
            photoFolderUrl: caseFolder.getUrl() },
  });

  // 通知メール
  try {
    MailApp.sendEmail({
      to: T_CONFIG.NOTIFY_EMAIL,
      subject: '【退去立会い完了】' + c.bukken + ' ' + c.room + '（' + c.name + '様）',
      body: '退去立会いが完了しました。\n物件：' + c.bukken + ' ' + c.room + '\n借主：' + c.name +
        '様\n借主負担（確定分）：' + fmtYen_(fixedTotal) + '\n\n原状回復箇所報告書：' + reportFile.getUrl() +
        '\n退去立会い同意書：' + consentFile.getUrl() + '\n\n次は修繕見積書を作成してください。',
      name: T_CONFIG.SENDER_NAME,
    });
  } catch (e) {}

  return { ok: true, caseId: caseId, reportUrl: reportFile.getUrl(), consentUrl: consentFile.getUrl() };
}

// ---------------- ③ 修繕見積書 ----------------
function saveEstimate_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, bukken: data.bukken, room: data.room };
  const items = data.items || [];
  let subA = 0, tenantSum = 0;
  const trs = items.map(function (it) {
    const amount = Number(it.qty || 0) * Number(it.unitPrice || 0);
    const rate = Number(it.burdenRate || 0);
    const tenant = Math.round(amount * rate / 100);
    subA += amount; tenantSum += tenant;
    return '<tr><td>' + esc_(it.name) + '</td><td class="right">' + Number(it.qty || 0) + '</td>' +
      '<td class="center">' + esc_(it.unit || '') + '</td><td class="right">' + fmtYen_(it.unitPrice) + '</td>' +
      '<td class="right">' + fmtYen_(amount) + '</td><td class="right">' + rate + '%</td>' +
      '<td class="right">' + fmtYen_(tenant) + '</td></tr>';
  }).join('');
  const taxA = Math.round(subA * T_CONFIG.TAX_RATE);
  const totalA = subA + taxA;
  const tenantTax = Math.round(tenantSum * T_CONFIG.TAX_RATE);
  const tenantTotal = tenantSum + tenantTax;
  const ownerTotal = totalA - tenantTotal;

  const html = docHead_() +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<div class="meta">作成日：' + today_() + '</div>' +
    '<h1>御 見 積 書</h1>' +
    '<div class="to">' + esc_(c.name) + ' 様</div>' +
    '<div class="sub">' + esc_(c.bukken) + ' ' + esc_(c.room) + '　退去修繕費用</div>' +
    '<table><tr><th>品目</th><th class="right">数量</th><th class="center">単位</th><th class="right">単価</th>' +
    '<th class="right">金額</th><th class="right">借主負担率</th><th class="right">借主負担額</th></tr>' +
    trs +
    '<tr><th colspan="4" class="right">小計</th><td class="right">' + fmtYen_(subA) + '</td><td></td><td class="right">' + fmtYen_(tenantSum) + '</td></tr>' +
    '<tr><th colspan="4" class="right">消費税（' + (T_CONFIG.TAX_RATE * 100) + '%）</th><td class="right">' + fmtYen_(taxA) + '</td><td></td><td class="right">' + fmtYen_(tenantTax) + '</td></tr>' +
    '<tr><th colspan="4" class="right">合計（税込）</th><td class="right"><b>' + fmtYen_(totalA) + '</b></td><td></td><td class="right"><b>' + fmtYen_(tenantTotal) + '</b></td></tr>' +
    '</table>' +
    '<table style="margin-top:8px"><tr><th style="width:50%">貸主負担 合計（税込）</th><td class="right">' + fmtYen_(ownerTotal) + '</td></tr>' +
    '<tr><th>借主負担 合計（税込）</th><td class="right"><b>' + fmtYen_(tenantTotal) + '</b></td></tr></table>' +
    (data.note ? '<div class="foot">【諸条件】' + esc_(data.note) + '</div>' : '') +
    '<div class="foot">' + esc_(T_CONFIG.COMPANY) + '　' + esc_(T_CONFIG.COMPANY_ADDR) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '</div>' +
    '</body></html>';

  const label = caseLabel_(c);
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.estimate);
  const pdf = htmlToPdf_(html, '修繕見積書_' + label + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '.pdf');
  const file = folder.createFile(pdf);

  upsertCase_(caseId, {
    status: '見積済', estimateUrl: file.getUrl(),
    data: { estimateItems: items, estimateNote: data.note || '',
            tenantTotal: tenantTotal, ownerTotal: ownerTotal, estimateTotal: totalA },
  });
  return { ok: true, caseId: caseId, estimateUrl: file.getUrl(), tenantTotal: tenantTotal };
}

// ---------------- ④ 修繕精算書 ----------------
function saveSettlement_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, bukken: data.bukken, room: data.room };
  const deposit = Number(data.deposit || 0);       // 預かり敷金
  const penalty = Number(data.penalty || 0);        // 違約金
  const unpaidRent = Number(data.unpaidRent || 0);  // 未納賃料等
  const restoreCost = Number(data.restoreCost || 0);// 原状回復費（借主負担）
  const balance = deposit - penalty - unpaidRent - restoreCost; // プラス=返金 / マイナス=不足
  const refund = balance > 0 ? balance : 0;
  const shortage = balance < 0 ? -balance : 0;

  const bank = data.bank || {};
  const bankLine = [bank.name, bank.branch, bank.type, bank.number, bank.holder].filter(String).join('　');

  const html = docHead_() +
    '<div class="meta">作成日：' + today_() + '</div>' +
    '<h1>退 去 清 算 書</h1>' +
    '<div class="to">' + esc_(c.name) + ' 様</div>' +
    '<table><tr><th style="width:22%">物件名</th><td>' + esc_(c.bukken) + '</td><th style="width:16%">号室</th><td>' + esc_(c.room) + '</td></tr>' +
    '<tr><th>入居期間</th><td>' + esc_(data.tenancy || '') + '</td><th>解約日</th><td>' + esc_(data.endDate || '') + '</td></tr>' +
    '<tr><th>退去後連絡先</th><td>' + esc_(data.contact || '') + '</td><th>書類送付先</th><td>' + esc_(data.newAddress || '') + '</td></tr></table>' +
    '<table style="margin-top:10px">' +
    '<tr><th style="width:50%">預かり敷金</th><td class="right">' + fmtYen_(deposit) + '</td></tr>' +
    '<tr><th>違約金</th><td class="right">' + fmtYen_(penalty) + '</td></tr>' +
    '<tr><th>未納賃料等</th><td class="right">' + fmtYen_(unpaidRent) + '</td></tr>' +
    '<tr><th>原状回復費（借主負担・税込）</th><td class="right">' + fmtYen_(restoreCost) + '</td></tr>' +
    '<tr><th>' + (shortage > 0 ? '不足金額（ご請求）' : '返金額') + '</th><td class="right"><b>' + fmtYen_(shortage > 0 ? shortage : refund) + '</b></td></tr>' +
    '</table>' +
    '<table style="margin-top:10px"><tr><th style="width:22%">敷金返金口座</th><td>' + esc_(bankLine || '（後日ご連絡）') + '</td></tr></table>' +
    (data.note ? '<div class="foot">備考：' + esc_(data.note) + '</div>' : '') +
    '<div class="foot">貸主：' + esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) +
    '<br>' + (shortage > 0 ? '不足金額を上記のとおりご請求いたします。' : '預かり敷金から相殺のうえ、上記返金額を指定口座へお振込みいたします。') +
    '（振込手数料は差引かせていただきます）</div></body></html>';

  const label = caseLabel_(c);
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.settlement);
  const pdf = htmlToPdf_(html, '修繕精算書_' + label + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '.pdf');
  const file = folder.createFile(pdf);

  upsertCase_(caseId, {
    status: '精算済', settlementUrl: file.getUrl(),
    data: { deposit: deposit, penalty: penalty, unpaidRent: unpaidRent, restoreCost: restoreCost,
            refund: refund, shortage: shortage },
  });
  try {
    MailApp.sendEmail({
      to: T_CONFIG.NOTIFY_EMAIL,
      subject: '【退去精算完了】' + c.bukken + ' ' + c.room + '（' + c.name + '様）',
      body: '退去精算が完了しました。\n' + (shortage > 0 ? '不足金額（ご請求）：' + fmtYen_(shortage) : '返金額：' + fmtYen_(refund)) +
        '\n\n修繕精算書：' + file.getUrl(),
      name: T_CONFIG.SENDER_NAME,
    });
  } catch (e) {}
  return { ok: true, caseId: caseId, settlementUrl: file.getUrl(), refund: refund, shortage: shortage };
}

/**
 * 動作テスト：エディタでこの関数を実行すると、親フォルダに各サブフォルダと
 * 進捗シートが作成され、テスト案件と各PDFが生成されます。初回は権限承認が必要です。
 */
function testTaikyo() {
  const r1 = createCase_({ name: 'テスト 太郎', kana: 'テスト タロウ', bukken: 'テストハイツ', room: '101', endDate: '2026年8月31日' });
  const id = r1.caseId;
  saveTachiai_({ caseId: id, name: 'テスト 太郎', kana: 'テスト タロウ', bukken: 'テストハイツ', room: '101',
    charges: { cleaning: 44000, acUnit: 11000, acCount: 1, tatamiUnit: 5000, tatamiCount: 0, crossAgree: true, crossUnit: 1800, otherNote: '' },
    photos: [], signature: '', signerName: 'テスト 太郎' });
  saveEstimate_({ caseId: id, name: 'テスト 太郎', bukken: 'テストハイツ', room: '101',
    items: [{ name: 'クロス張替え LDK', qty: 20, unit: '㎡', unitPrice: 1400, burdenRate: 50 },
            { name: 'ハウスクリーニング', qty: 1, unit: '式', unitPrice: 42000, burdenRate: 100 },
            { name: 'エアコン洗浄', qty: 1, unit: '台', unitPrice: 11000, burdenRate: 100 }], note: '' });
  saveSettlement_({ caseId: id, name: 'テスト 太郎', bukken: 'テストハイツ', room: '101',
    tenancy: '2024.4.1〜2026.8.31', endDate: '2026年8月31日', deposit: 70000, penalty: 0,
    unpaidRent: 0, restoreCost: 60000, bank: { name: 'テスト銀行', branch: 'テスト支店', type: '普通', number: '1234567', holder: 'テスト タロウ' } });
  Logger.log('テスト完了。案件ID: ' + id);
}
