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
  COMPANY_ADDR: '〒737-0821 広島県呉市三条4丁目7-20',
  // 送付状（書類送付御案内）の差出人情報
  COMPANY_ZIP: '737-0821',
  COMPANY_ADDR_FULL: '広島県呉市三条4丁目7-20',
  COMPANY_FAX: '0823-27-7818',
  COMPANY_CONTACT: '大森',   // 送付状の担当者（空なら精算書作成者を使用）
  // 御請求書の入金先口座（原状回復費用の請求分の着金先）
  INVOICE_BANK: {
    bank: 'もみじ銀行',
    branch: '呉中央支店',
    type: '普通預金',
    number: '3113449',
    holder: 'エイホームトラスト株式会社',
  },
  PROGRESS_SHEET_NAME: '退去精算_進捗管理',
  SENDER_NAME: '仁方大森マリーナー 退去精算',
  SUBFOLDERS: {
    report: '原状回復箇所報告書',
    consent: '退去立会い同意書',
    estimate: '修繕見積書',
    settlement: '修繕精算書',
    invoice: '御請求書',
    cover: '送付状',
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
    if (action === 'report') return json_(saveReport_(data));
    if (action === 'consent') return json_(saveConsent_(data));
    if (action === 'tachiai') return json_(saveTachiaiCombined_(data)); // 後方互換
    if (action === 'estimate') return json_(saveEstimate_(data));
    if (action === 'settlement') return json_(saveSettlement_(data));
    if (action === 'complete') return json_(saveComplete_(data));
    if (action === 'deleteCase') return json_(deleteCase_(data));
    if (action === 'dismissImport') return json_(dismissImport_(data));
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
  const rows = sheet.getRange(2, 1, last - 1, Math.max(13, sheet.getLastColumn())).getValues();
  const existing = {};
  listCases_().forEach(function (c) { if (c.data && c.data.receiptNo) existing[c.data.receiptNo] = true; });
  // 一度削除／非表示にした受付番号は再表示しない
  getDismissed_().forEach(function (rn) { existing[rn] = true; });
  const out = [];
  rows.forEach(function (r) {
    // kaiyaku.gs の列: 受付日時,受付番号,種別,物件名,部屋,氏名,フリガナ,電話,メール,解約日,室内清掃代,エアコン洗浄代,清掃代等合計,...
    const receiptNo = r[1], kind = r[2];
    if (kind !== '管理物件') return; // 立会いは管理物件のみ
    if (existing[receiptNo]) return;
    const ac = parseAcLine_(r[11]);
    out.push({
      receiptNo: receiptNo, bukken: r[3], room: r[4], name: r[5], kana: r[6],
      tel: normalizeTel_(r[7]), email: r[8], endDate: r[9],
      // 解約フォームで選ばれた金額（立会い同意書へ引き継ぐ）
      cleaning: Number(r[10]) || 0,
      acNormalUnit: ac.normalUnit, acNormalCount: ac.normalCount,
      acAutoUnit: ac.autoUnit, acAutoCount: ac.autoCount,
      owner: String(r[22] == null ? '' : r[22]).trim(),  // 貸主（23列目）
    });
  });
  return out;
}

/** 解約フォームの「エアコン洗浄代」テキストから通常/お掃除機能付きの単価・台数を取り出す
 *  例: "通常12,100円×2台／お掃除機能付き19,800円×1台" */
function parseAcLine_(s) {
  s = String(s || '');
  const out = { normalUnit: 12100, normalCount: 0, autoUnit: 19800, autoCount: 0 };
  const m1 = s.match(/通常([\d,]+)円×(\d+)台/);
  if (m1) { out.normalUnit = Number(m1[1].replace(/,/g, '')); out.normalCount = Number(m1[2]); }
  const m2 = s.match(/お掃除機能付き([\d,]+)円×(\d+)台/);
  if (m2) { out.autoUnit = Number(m2[1].replace(/,/g, '')); out.autoCount = Number(m2[2]); }
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
  const info = {
    receiptNo: data.receiptNo || '', tel: data.tel || '', email: data.email || '',
    endDate: data.endDate || '', owner: data.owner || '',
  };
  // 解約フォームで選ばれた金額を、立会い同意書の初期値（charges）として引き継ぐ
  const cleaning = Number(data.cleaning || 0);
  const acN = Number(data.acNormalCount || 0), acA = Number(data.acAutoCount || 0);
  if (cleaning > 0 || acN > 0 || acA > 0) {
    info.charges = {
      cleaning: cleaning > 0 ? cleaning : T_CONFIG.DEFAULT_CLEANING,
      acUnit: Number(data.acNormalUnit || 12100), acCount: acN,
      ac2Unit: Number(data.acAutoUnit || 19800), ac2Count: acA,
      tatamiUnit: T_CONFIG.DEFAULT_TATAMI, tatamiCount: 0,
      crossAgree: true, crossUnit: T_CONFIG.DEFAULT_CROSS_UNIT,
      fromKaiyaku: true,
    };
  }
  upsertCase_(caseId, {
    status: '解約受付',
    name: data.name || '', kana: data.kana || '',
    bukken: data.bukken || '', room: data.room || '',
    data: info,
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
/** 'yyyy-mm-dd' → 'yyyy年M月d日'（それ以外はそのまま返す） */
function fmtD_(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日') : String(s);
}

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

// ---------------- ①-A 原状回復箇所報告書（写真） ----------------
function saveReport_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, kana: data.kana, bukken: data.bukken, room: data.room };
  const parent = parentFolder_();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  const timeStr = Utilities.formatDate(now, 'Asia/Tokyo', 'HHmmss');
  const label = caseLabel_(c);

  // 写真をフォルダに保存（作成のたびにフォルダを分けて、追加写真にも対応）
  const reportRoot = getOrCreateSubfolder_(parent, T_CONFIG.SUBFOLDERS.report);
  const caseFolder = reportRoot.createFolder(label + '_' + dateStr + '_' + timeStr);
  const photos = data.photos || [];
  let cards = '';
  photos.forEach(function (p, i) {
    const blob = dataUrlToBlob_(p.dataUrl, label + '_' + (i + 1) + '.jpg');
    if (blob) caseFolder.createFile(blob);
    const badge = p.type ? '<span style="display:inline-block;background:#0891b2;color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:4px">' + esc_(p.type) + '</span>' : '';
    cards += '<div class="photo"><img src="' + p.dataUrl + '">' +
      '<div class="cap"><b>No.' + (i + 1) + '</b>　' + esc_(p.label || '（箇所未記入）') + badge +
      (p.memo ? '<br>' + esc_(p.memo) : '') + '</div></div>';
  });
  const infoRows =
    '<tr><th style="width:18%">物件名</th><td>' + esc_(c.bukken) + '</td><th style="width:14%">部屋番号</th><td>' + esc_(c.room) + '</td></tr>' +
    '<tr><th>入居者氏名</th><td>' + esc_(c.name) + ' 様</td><th>入居期間</th><td>' + esc_(data.tenancy || '') + '</td></tr>' +
    '<tr><th>退去日</th><td>' + esc_(fmtD_(data.moveoutDate)) + '</td><th>立会確認日</th><td>' + esc_(fmtD_(data.tachiaiDate) || today_()) + '</td></tr>' +
    '<tr><th>立会担当者</th><td>' + esc_(data.staff || '') + '</td><th>写真枚数</th><td>' + photos.length + '枚</td></tr>';
  const html = docHead_() +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<div class="meta">作成日：' + today_() + '</div>' +
    '<h1>原状回復箇所報告書</h1>' +
    '<div class="sub">退去時の室内確認・原状回復に関わる箇所の記録</div>' +
    '<div class="to">貸主様<br>' + esc_(T_CONFIG.COMPANY) + ' 御中</div>' +
    '<table>' + infoRows + '</table>' +
    '<p class="note" style="margin-top:8px">退去時の室内確認の結果、原状回復に関わる主な箇所を写真にて記録しました。下記のとおりご確認をお願い申し上げます。</p>' +
    '<div style="margin-top:8px">' + (cards || '（写真なし）') + '</div>' +
    '<div class="foot">※本書は退去時の室内状況を記録した根拠資料です。原状回復費用の負担区分は、国土交通省「原状回復をめぐるトラブルとガイドライン」および賃貸借契約書に基づき、経年変化・通常損耗と借主の故意・過失等を勘案のうえ協議して決定いたします。<br>' +
    esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '</div></body></html>';
  const pdf = htmlToPdf_(html, '原状回復箇所報告書_' + label + '_' + dateStr + '.pdf');
  const file = caseFolder.createFile(pdf);

  upsertCase_(caseId, {
    name: c.name, kana: c.kana, bukken: c.bukken, room: c.room, reportUrl: file.getUrl(),
    data: { moveoutDate: data.moveoutDate || '', tachiaiDate: data.tachiaiDate || '', staffTachiai: data.staff || '',
            photoCount: photos.length, photoFolderUrl: caseFolder.getUrl(), tenancy: data.tenancy || '' },
  });
  return { ok: true, caseId: caseId, reportUrl: file.getUrl() };
}

// ---------------- ①-B 退去立会い同意書（費用＋署名） ----------------
function saveConsent_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, kana: data.kana, bukken: data.bukken, room: data.room };
  const parent = parentFolder_();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  const label = caseLabel_(c);
  const tachiaiDisp = fmtD_(data.tachiaiDate) || today_();

  const ch = data.charges || {};
  const rows = [];
  const acLabel = (Number(ch.ac2Count) > 0 || Number(ch.acCount) > 0) ? 'エアコン洗浄費・通常（借主負担）' : 'エアコン洗浄費（借主負担）';
  if (Number(ch.cleaning) > 0) rows.push(['室内清掃費（借主負担）', fmtYen_(ch.cleaning) + '（税込）']);
  if (Number(ch.acCount) > 0) rows.push([acLabel, fmtYen_(ch.acUnit) + ' × ' + Number(ch.acCount) + '台 ＝ ' + fmtYen_(Number(ch.acUnit) * Number(ch.acCount)) + '（税込）']);
  if (Number(ch.ac2Count) > 0) rows.push(['エアコン洗浄費・お掃除機能付き（借主負担）', fmtYen_(ch.ac2Unit) + ' × ' + Number(ch.ac2Count) + '台 ＝ ' + fmtYen_(Number(ch.ac2Unit) * Number(ch.ac2Count)) + '（税込）']);
  if (Number(ch.tatamiCount) > 0) rows.push(['畳表替え費用（借主負担）', fmtYen_(ch.tatamiUnit) + ' × ' + Number(ch.tatamiCount) + '枚 ＝ ' + fmtYen_(Number(ch.tatamiUnit) * Number(ch.tatamiCount)) + '（税込）']);
  // その他の借主負担費用（その場で金額確定）
  const otherItems = (ch.otherItems || []).filter(function (x) { return x && x.name && Number(x.amount) > 0; });
  let otherSum = 0;
  otherItems.forEach(function (x) { otherSum += Number(x.amount); rows.push([esc_(x.name) + '（借主負担）', fmtYen_(x.amount) + '（税込）']); });
  const fixedTotal = (Number(ch.cleaning) || 0) + (Number(ch.acUnit) || 0) * (Number(ch.acCount) || 0) +
    (Number(ch.ac2Unit) || 0) * (Number(ch.ac2Count) || 0) + (Number(ch.tatamiUnit) || 0) * (Number(ch.tatamiCount) || 0) + otherSum;
  let chargeRows = rows.map(function (r) { return '<tr><th style="width:45%">' + esc_(r[0]) + '</th><td class="right">' + esc_(r[1]) + '</td></tr>'; }).join('');
  chargeRows += '<tr><th>上記の借主負担 合計（確定分・税込）</th><td class="right"><b>' + fmtYen_(fixedTotal) + '（税込）</b></td></tr>';

  const crossNote = ch.crossAgree
    ? '・クロス（壁紙）の借主負担補修が生じた場合は、㎡単価 ' + fmtYen_(ch.crossUnit || T_CONFIG.DEFAULT_CROSS_UNIT) + '（税別）を基準に実測のうえ精算することに同意します。'
    : '';
  const otherNote = ch.otherNote ? '・' + esc_(ch.otherNote) : '';

  // 後日見積となる原状回復箇所（選択項目）→「後日見積のうえ支払うことを約束」
  const laterItems = (ch.laterItems || []).filter(String);
  let laterBlock = '';
  if (laterItems.length) {
    laterBlock =
      '<p class="note" style="margin-top:12px">下記の箇所について、借主負担の原状回復が必要であることを確認しました。' +
      'これらの費用は<b>後日見積のうえ、確定した金額を支払うことを約束</b>いたします。</p>' +
      '<table><tr><th>後日見積となる原状回復箇所（借主負担）</th></tr>' +
      laterItems.map(function (li) { return '<tr><td>・' + esc_(li) + '</td></tr>'; }).join('') +
      '</table>';
  }

  const consentHtml = docHead_() +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<div class="meta">立会い日：' + tachiaiDisp + '</div>' +
    '<h1>退去立会い同意書</h1>' +
    '<div class="to">貸主様<br>' + esc_(T_CONFIG.COMPANY) + ' 御中</div>' +
    '<table><tr><th style="width:22%">物件名</th><td>' + esc_(c.bukken) + '</td>' +
    '<th style="width:14%">部屋番号</th><td>' + esc_(c.room) + '</td></tr>' +
    (data.staff ? '<tr><th>立会担当者</th><td colspan="3">' + esc_(data.staff) + '</td></tr>' : '') + '</table>' +
    '<p class="note" style="margin-top:10px">私は、退去立会いにおいて下記の借主負担費用（金額はすべて消費税込み）を確認し、支払うことに同意いたします。</p>' +
    '<table>' + chargeRows + '</table>' +
    laterBlock +
    '<div class="note" style="margin-top:8px">' +
    (crossNote ? crossNote + '<br>' : '') +
    (otherNote ? otherNote + '<br>' : '') +
    '・上記のほか、契約内容および原状回復に関する借主負担部分を負担することに同意します。' +
    '</div>' +
    '<div class="sign">' +
    '<div>立会い日：' + tachiaiDisp + '</div>' +
    '<div style="margin-top:6px">氏名（署名）：' +
    (data.signature ? '<br><img src="' + data.signature + '">' : '＿＿＿＿＿＿＿＿') + '</div>' +
    (data.signerName ? '<div style="margin-top:4px">署名者：' + esc_(data.signerName) + '</div>' : '') +
    '</div>' +
    '<div class="foot">立会い会社：' + esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) +
    (data.staff ? '　立会担当者：' + esc_(data.staff) : '') +
    '<br>本書は退去立会い時に借主が電子的に署名し同意したものです。</div></body></html>';
  const consentFolder = getOrCreateSubfolder_(parent, T_CONFIG.SUBFOLDERS.consent);
  const consentPdf = htmlToPdf_(consentHtml, '退去立会い同意書_' + label + '_' + dateStr + '.pdf');
  const consentFile = consentFolder.createFile(consentPdf);

  // 進捗更新（費用は見積へ引き継ぐ）
  upsertCase_(caseId, {
    status: '立会い済', name: c.name, kana: c.kana, bukken: c.bukken, room: c.room,
    consentUrl: consentFile.getUrl(),
    data: { charges: ch, tachiaiDate: data.tachiaiDate || '', staffTachiai: data.staff || '' },
  });

  // 通知メール
  try {
    MailApp.sendEmail({
      to: T_CONFIG.NOTIFY_EMAIL,
      subject: '【退去立会い同意書】' + c.bukken + ' ' + c.room + '（' + c.name + '様）',
      body: '退去立会い同意書を作成しました。\n物件：' + c.bukken + ' ' + c.room + '\n借主：' + c.name +
        '様\n借主負担（確定分・税込）：' + fmtYen_(fixedTotal) +
        '\n\n退去立会い同意書：' + consentFile.getUrl() + '\n\n次は修繕見積書を作成してください。',
      name: T_CONFIG.SENDER_NAME,
    });
  } catch (e) {}

  return { ok: true, caseId: caseId, consentUrl: consentFile.getUrl() };
}

// 後方互換：旧「tachiai」アクション（報告書＋同意書を続けて作成）
function saveTachiaiCombined_(data) {
  const r = saveReport_(data);
  const s = saveConsent_(data);
  return { ok: (r.ok !== false && s.ok !== false), caseId: data.caseId, reportUrl: r.reportUrl, consentUrl: s.consentUrl };
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
    '<div class="foot">' + esc_(T_CONFIG.COMPANY) + '　' + esc_(T_CONFIG.COMPANY_ADDR) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) +
    (data.staff ? '　見積作成者：' + esc_(data.staff) : '') + '</div>' +
    '</body></html>';

  const label = caseLabel_(c);
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.estimate);
  const pdf = htmlToPdf_(html, '修繕見積書_' + label + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '.pdf');
  const file = folder.createFile(pdf);

  upsertCase_(caseId, {
    status: '見積済', estimateUrl: file.getUrl(),
    data: { estimateItems: items, estimateNote: data.note || '', estimateStaff: data.staff || '',
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
    '<tr><th>退去後連絡先</th><td>' + esc_(normalizeTel_(data.contact || '')) + '</td><th>書類送付先</th><td>' + nl2br_(data.newAddress || '') + '</td></tr></table>' +
    '<table style="margin-top:10px">' +
    '<tr><th style="width:50%">預かり敷金</th><td class="right">' + fmtYen_(deposit) + '</td></tr>' +
    '<tr><th>違約金</th><td class="right">' + fmtYen_(penalty) + '</td></tr>' +
    '<tr><th>未納賃料等</th><td class="right">' + fmtYen_(unpaidRent) + '</td></tr>' +
    '<tr><th>原状回復費（借主負担・税込）</th><td class="right">' + fmtYen_(restoreCost) + '</td></tr>' +
    '<tr><th>' + (shortage > 0 ? '不足金額（ご請求）' : '返金額') + '</th><td class="right"><b>' + fmtYen_(shortage > 0 ? shortage : refund) + '</b></td></tr>' +
    '</table>' +
    '<table style="margin-top:10px"><tr><th style="width:22%">敷金返金口座</th><td>' + esc_(bankLine || '（後日ご連絡）') + '</td></tr></table>' +
    (data.note ? '<div class="foot">備考：' + esc_(data.note) + '</div>' : '') +
    '<div class="foot">貸主：' + esc_(data.owner || T_CONFIG.COMPANY) + '　（お問い合わせ：' + esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '）' +
    (data.staff ? '　精算書作成者：' + esc_(data.staff) : '') +
    '<br>' + (shortage > 0 ? '不足金額を上記のとおりご請求いたします。' : '預かり敷金から相殺のうえ、上記返金額を指定口座へお振込みいたします。') +
    '（振込手数料は差引かせていただきます）</div></body></html>';

  const label = caseLabel_(c);
  const dstamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.settlement);
  const pdf = htmlToPdf_(html, '修繕精算書_' + label + '_' + dstamp + '.pdf');
  const file = folder.createFile(pdf);

  // --- 御請求書（不足＝請求額が発生した場合のみ） ---
  let invoiceUrl = '';
  if (shortage > 0) {
    invoiceUrl = buildInvoice_(caseId, c, data, shortage, dstamp, label).getUrl();
  }

  // --- 送付状（書類送付御案内）：見積書・清算書・（請求書）を郵送する際の同封案内 ---
  const coverUrl = buildCover_(caseId, c, data, shortage, dstamp, label).getUrl();

  upsertCase_(caseId, {
    status: '精算済', settlementUrl: file.getUrl(),
    data: { deposit: deposit, penalty: penalty, unpaidRent: unpaidRent, restoreCost: restoreCost,
            refund: refund, shortage: shortage, settlementStaff: data.staff || '',
            tenancy: data.tenancy || '', endDate: data.endDate || '', newAddress: data.newAddress || '', contact: data.contact || '', owner: data.owner || '',
            paymentDue: data.paymentDue || '', invoiceUrl: invoiceUrl, coverUrl: coverUrl },
  });
  try {
    MailApp.sendEmail({
      to: T_CONFIG.NOTIFY_EMAIL,
      subject: '【退去精算完了】' + c.bukken + ' ' + c.room + '（' + c.name + '様）',
      body: '退去精算が完了しました。\n' + (shortage > 0 ? '不足金額（ご請求）：' + fmtYen_(shortage) : '返金額：' + fmtYen_(refund)) +
        '\n\n修繕精算書：' + file.getUrl() +
        (invoiceUrl ? '\n御請求書：' + invoiceUrl : '') +
        '\n送付状（書類送付御案内）：' + coverUrl,
      name: T_CONFIG.SENDER_NAME,
    });
  } catch (e) {}
  return { ok: true, caseId: caseId, settlementUrl: file.getUrl(), refund: refund, shortage: shortage,
           invoiceUrl: invoiceUrl, coverUrl: coverUrl };
}

/** 御請求書PDF（原状回復費用の不足額を借主に請求／入金先=INVOICE_BANK） */
function buildInvoice_(caseId, c, data, shortage, dstamp, label) {
  const b = T_CONFIG.INVOICE_BANK;
  const bankRows =
    '<tr><th style="width:28%">金融機関</th><td>' + esc_(b.bank) + '</td></tr>' +
    '<tr><th>支店名</th><td>' + esc_(b.branch) + '</td></tr>' +
    '<tr><th>口座</th><td>' + esc_(b.type) + '　No.' + esc_(b.number) + '</td></tr>' +
    '<tr><th>口座名義人</th><td>' + esc_(b.holder) + '</td></tr>';
  const due = data.paymentDue ? fmtD_(data.paymentDue) : '';
  const html = docHead_() +
    '<div class="meta">請求日：' + today_() + '</div>' +
    '<div class="meta">案件ID：' + esc_(caseId) + '</div>' +
    '<h1>御 請 求 書</h1>' +
    '<div class="to">' + esc_(c.name) + ' 様</div>' +
    (data.newAddress ? '<div class="note">送付先：' + nl2br_(data.newAddress) + '</div>' : '') +
    '<p class="note" style="margin-top:8px">下記のとおり、退去に伴う原状回復費用の借主ご負担分（敷金充当後の不足額）をご請求申し上げます。</p>' +
    '<table style="margin-top:6px"><tr><th style="width:28%">物件名</th><td>' + esc_(c.bukken) + '　' + esc_(c.room) + '</td></tr>' +
    '<tr><th>ご請求金額（税込）</th><td class="right"><b style="font-size:15px">' + fmtYen_(shortage) + '</b></td></tr>' +
    (due ? '<tr><th>お支払期限</th><td>' + esc_(due) + '</td></tr>' : '') +
    '</table>' +
    '<p class="note" style="margin-top:10px">下記口座へお振込みくださいますようお願い申し上げます。（振込手数料はご負担願います）</p>' +
    '<table>' + bankRows + '</table>' +
    '<div class="foot">※内訳は同封の「退去清算書」および「原状回復見積書」をご確認ください。<br>' +
    esc_(T_CONFIG.COMPANY) + '　〒' + esc_(T_CONFIG.COMPANY_ZIP) + '　' + esc_(T_CONFIG.COMPANY_ADDR_FULL) +
    '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '</div></body></html>';
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.invoice);
  return folder.createFile(htmlToPdf_(html, '御請求書_' + label + '_' + dstamp + '.pdf'));
}

/** 電話番号の先頭0が失われた場合に復元
 *  （スプレッドシートに保存される際に数値化され「09012345678」→「9012345678」となるため） */
function normalizeTel_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^[0-9]{9,10}$/.test(s) && s.charAt(0) !== '0') return '0' + s;
  return s;
}

/** 改行をそのまま表示（<br>へ変換） */
function nl2br_(s) {
  return esc_(String(s == null ? '' : s)).replace(/\r\n?|\n/g, '<br>');
}

/** 封筒貼り付け用の宛名住所を整形
 *  ・入力に改行があれば、その改行をそのまま反映（4行・5行など自由）
 *  ・改行がない場合のみ、郵便番号（〒123-4567）の後で自動改行 */
function zipBreak_(addr) {
  const s = String(addr || '').replace(/\r\n?/g, '\n').trim();
  if (s.indexOf('\n') >= 0) {
    return s.split('\n').map(function (line, i) {
      const t = esc_(line.trim());
      return (i === 0 && /^〒?\s*\d{3}-?\d{4}$/.test(line.trim())) ? '<span class="zip">' + t + '</span>' : t;
    }).join('<br>');
  }
  const m = s.match(/^(〒?\s*\d{3}-?\d{4})[\s　]*(.*)$/);
  if (!m || !m[2]) return esc_(s);
  return '<span class="zip">' + esc_(m[1]) + '</span><br>' + esc_(m[2]);
}

/** 送付状PDF（書類送付御案内）
 *  A4を上下半分に分け、上＝送付用／下＝控え。控えの左下に封筒貼り付け用の宛名を配置。 */
function buildCover_(caseId, c, data, shortage, dstamp, label) {
  const contact = T_CONFIG.COMPANY_CONTACT || data.staff || '';
  const docs = ['原状回復見積書', '清算書'];
  if (shortage > 0) docs.push('御請求書');
  const listRows = docs.map(function (d, i) {
    return '<tr><td class="n">' + (i + 1) + '.</td><td>' + esc_(d) + '</td><td class="b">1部</td></tr>';
  }).join('');

  const tp = String(T_CONFIG.COMPANY_TEL).split('-');
  const tel = 'TEL（' + tp[0] + '）' + tp.slice(1).join('-');
  const fp = String(T_CONFIG.COMPANY_FAX).split('-');
  const fax = 'FAX（' + fp[0] + '）' + fp.slice(1).join('-');
  const sender =
    '<div class="from"><div class="cname">' + esc_(T_CONFIG.COMPANY) + '</div>' +
    '〒' + esc_(T_CONFIG.COMPANY_ZIP) + '　' + esc_(T_CONFIG.COMPANY_ADDR_FULL) + '<br>' +
    tel + '　　' + fax + (contact ? '<br>担　当　　' + esc_(contact) : '') + '</div>';
  const body =
    '<p class="greet">毎々格別の御高配に預かり厚く御礼申し述べます。<br>' +
    '下記の通り茲許同封送付致しましたので御査収の程願い上げます。</p>' +
    '<div class="ki">記</div>' +
    '<table class="list">' + listRows + '</table>' +
    '<div class="ijou">以上</div>';

  function letter(isCopy) {
    const to =
      '<div class="to">' +
      // 控えの上部住所は1行にまとめる（正確な改行は下の封筒貼り付け用で表現）
      (isCopy && data.newAddress ? '<div class="toaddr">' + esc_(String(data.newAddress).replace(/\s*\r?\n\s*/g, '　').trim()) + '</div>' : '') +
      '<div class="toname">' + esc_(c.name) + '　様</div></div>';
    const env = isCopy
      ? '<div class="envwrap"><div class="env">' +
        (data.newAddress ? '<div>' + zipBreak_(data.newAddress) + '</div>' : '') +
        '<div class="envname">' + esc_(c.name) + '　様</div></div>' +
        '<div class="envnote">← 封筒貼り付け用</div></div>'
      : '';
    return '<div class="half' + (isCopy ? ' copy' : '') + '">' +
      '<div class="date">' + today_() + '</div>' +
      '<div class="title">書 類 送 付 御 案 内' + (isCopy ? '（控え）' : '') + '</div>' +
      '<div class="head">' + to + sender + '</div>' +
      body + env + '</div>';
  }

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '@page{size:A4 portrait;margin:8mm;}' +
    'body{font-family:sans-serif;color:#111;font-size:12px;margin:0;}' +
    '.half{height:133mm;box-sizing:border-box;padding:5mm 7mm;position:relative;overflow:hidden;}' +
    '.date{text-align:right;font-size:11px;}' +
    '.title{text-align:center;font-size:18px;font-weight:bold;letter-spacing:6px;margin:2mm 0 6mm;}' +
    '.copy{padding-top:3.5mm;} .copy .title{margin:1mm 0 3mm;font-size:16px;} .copy .greet{margin:2.5mm 0 1mm;line-height:1.6;}' +
    '.copy .list td{padding:2px 6px;} .copy .head{gap:6mm;}' +
    '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm;}' +
    '.to{width:50%;padding-top:4mm;}' +
    '.to .toaddr{font-size:11px;margin-bottom:3px;}' +
    '.to .toname{font-size:14px;font-weight:bold;border-bottom:1px solid #333;padding-bottom:4px;}' +
    '.from{width:46%;font-size:11px;line-height:1.7;}' +
    '.from .cname{font-size:13px;font-weight:bold;text-align:center;margin-bottom:2px;}' +
    '.greet{font-size:12px;margin:6mm 0 2mm;line-height:1.9;}' +
    '.ki{text-align:center;font-weight:bold;margin:1mm 0 2mm;}' +
    '.list{width:78%;margin:0 auto;border-collapse:collapse;}' +
    '.list td{border-bottom:1px dotted #333;padding:3px 6px;font-size:12px;}' +
    '.list td.n{width:8%;} .list td.b{width:16%;text-align:right;}' +
    '.ijou{text-align:right;font-size:11px;margin-top:5px;}' +
    '.cut{border-top:1px dashed #666;text-align:center;font-size:10px;color:#666;padding-top:1mm;}' +
    '.envwrap{display:flex;align-items:center;gap:4mm;margin-top:2mm;}' +
    // 封筒貼り付け用の宛名：横60mm×縦35mm（実寸）
    '.env{border:1px dashed #333;width:70mm;height:40mm;box-sizing:border-box;padding:3mm 4mm;font-size:12.5px;line-height:1.5;overflow:hidden;}' +
    '.env .zip{display:inline-block;margin-bottom:1px;}' +
    '.env .envname{font-weight:bold;font-size:14px;line-height:1.4;margin-top:4px;}' +
    '.envnote{font-size:10px;color:#555;}' +
    '</style></head><body>' +
    letter(false) +
    '<div class="cut">- - - - - - - - - - - - - - - - - - - - - - ✂ ここで切り取り、下半分を控えとしてください - - - - - - - - - - - - - - - - - - - - - -</div>' +
    letter(true) +
    '</body></html>';
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.cover);
  return folder.createFile(htmlToPdf_(html, '送付状_書類送付御案内_' + label + '_' + dstamp + '.pdf'));
}

// ---------------- 案件の削除（一覧＝進捗シートから削除） ----------------
// ドライブに保存済みのPDF・写真は残します（誤削除防止のため）。
function deleteCase_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const sheet = progressSheet_();
  const row = findRow_(sheet, caseId);
  if (row < 0) return { ok: false, error: '案件が見つかりません。' };
  // 解約フォーム由来の案件は、削除後に「未取込」として再表示されないよう除外リストへ
  let receiptNo = '';
  try {
    const d = JSON.parse(sheet.getRange(row, PS_COL.json).getValue() || '{}');
    receiptNo = d.receiptNo || '';
  } catch (e) {}
  if (!receiptNo && /^[KP]\d{14}$/.test(String(caseId))) receiptNo = String(caseId);
  if (receiptNo) addDismissed_(receiptNo);
  sheet.deleteRow(row);
  return { ok: true, caseId: caseId };
}

/** 取り込み候補から除外する（解約フォーム由来の案件を非表示にする） */
function dismissImport_(data) {
  const receiptNo = data.receiptNo;
  if (!receiptNo) return { ok: false, error: '受付番号がありません。' };
  addDismissed_(receiptNo);
  return { ok: true, receiptNo: receiptNo };
}

const DISMISSED_KEY = 'dismissedReceiptNos';
function getDismissed_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function addDismissed_(receiptNo) {
  try {
    const list = getDismissed_();
    if (list.indexOf(receiptNo) < 0) {
      list.push(receiptNo);
      PropertiesService.getScriptProperties().setProperty(DISMISSED_KEY, JSON.stringify(list));
    }
  } catch (e) {}
}

// ---------------- ⑤ 入金・完了（着金／返金振込の完了日で終了） ----------------
function saveComplete_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const type = data.completionType; // 'refund'（返金振込）／'shortage'（着金）
  const date = data.completionDate || today_();
  const label = type === 'shortage' ? '着金完了' : '返金振込完了';
  upsertCase_(caseId, {
    status: '完了',
    data: { completionType: type, completionDate: date, completionLabel: label,
            confirmer: data.confirmer || '', invoiceMailDate: data.invoiceMailDate || '' },
  });
  try {
    MailApp.sendEmail({
      to: T_CONFIG.NOTIFY_EMAIL,
      subject: '【退去精算 完了】' + (data.bukken || '') + ' ' + (data.room || '') + '（' + (data.name || '') + '様）',
      body: label + 'を記録しました（' + date + '）。この案件は完了です。' +
        (data.invoiceMailDate ? '\n請求書郵送日：' + data.invoiceMailDate : '') +
        (data.confirmer ? '\n確認者：' + data.confirmer : ''),
      name: T_CONFIG.SENDER_NAME,
    });
  } catch (e) {}
  return { ok: true, caseId: caseId, status: '完了', completionDate: date, completionLabel: label };
}

/**
 * 動作テスト：エディタでこの関数を実行すると、親フォルダに各サブフォルダと
 * 進捗シートが作成され、テスト案件と各PDFが生成されます。初回は権限承認が必要です。
 */
function testTaikyo() {
  const r1 = createCase_({ name: 'テスト 太郎', kana: 'テスト タロウ', bukken: 'テストハイツ', room: '101', endDate: '2026年8月31日' });
  const id = r1.caseId;
  saveReport_({ caseId: id, name: 'テスト 太郎', kana: 'テスト タロウ', bukken: 'テストハイツ', room: '101',
    moveoutDate: '2026-08-31', tachiaiDate: '2026-08-30', staff: '担当 花子', tenancy: '2024.4.1〜2026.8.31',
    photos: [] });
  saveConsent_({ caseId: id, name: 'テスト 太郎', kana: 'テスト タロウ', bukken: 'テストハイツ', room: '101',
    tachiaiDate: '2026-08-30', staff: '担当 花子',
    charges: { cleaning: 44000, acUnit: 11000, acCount: 1, tatamiUnit: 5000, tatamiCount: 0, crossAgree: true, crossUnit: 1800, otherNote: '', laterItems: ['柱損傷', '網戸破け'] },
    signature: '', signerName: 'テスト 太郎' });
  saveEstimate_({ caseId: id, name: 'テスト 太郎', bukken: 'テストハイツ', room: '101',
    items: [{ name: 'クロス張替え LDK', qty: 20, unit: '㎡', unitPrice: 1400, burdenRate: 50 },
            { name: 'ハウスクリーニング', qty: 1, unit: '式', unitPrice: 42000, burdenRate: 100 },
            { name: 'エアコン洗浄', qty: 1, unit: '台', unitPrice: 11000, burdenRate: 100 }], note: '', staff: '見積 次郎' });
  saveSettlement_({ caseId: id, name: 'テスト 太郎', bukken: 'テストハイツ', room: '101',
    tenancy: '2024.4.1〜2026.8.31', endDate: '2026年8月31日', deposit: 70000, penalty: 0,
    unpaidRent: 0, restoreCost: 60000, staff: '精算 三郎', bank: { name: 'テスト銀行', branch: 'テスト支店', type: '普通', number: '1234567', holder: 'テスト タロウ' } });
  saveComplete_({ caseId: id, name: 'テスト 太郎', bukken: 'テストハイツ', room: '101',
    completionType: 'refund', completionDate: '2026-09-05', confirmer: '確認 四郎', invoiceMailDate: '' });
  Logger.log('テスト完了。案件ID: ' + id);
}
