/**
 * ============================================================
 * 月極駐車場 利用申込フォーム バックエンド（Google Apps Script）
 * 有限会社仁方大森マリーナー
 *
 * 役割：
 *  1. moushikomi.html から送信された申込内容を受け付ける
 *  2. エクセル様式（個人／法人）どおりの「月極駐車場利用申込書」PDFを作成し、
 *     指定のGoogleドライブフォルダに保存
 *  3. 運転免許証（表・裏）の画像をドライブに保存し、申込書PDFにも添付
 *  4. 管理者（NOTIFY_EMAIL）へ通知メールを送信（PDF添付）
 *  5. 申込者がメールを入力していれば受付完了メールを自動返信
 *  6. フォルダ内のスプレッドシート「駐車場申込受付一覧」に記録
 *  7. 駐車場・賃料の「マスター」をスプレッドシートで管理し、
 *     リンク作成ページ・申込フォームへ配信する（賃料改定はシート編集だけで反映）
 *
 * セットアップ手順は リポジトリの MOUSHIKOMI_SETUP.md を参照してください。
 * ============================================================
 */

const M_CONFIG = {
  // 通知メールの宛先
  NOTIFY_EMAIL: 'marina.oomori1@gmail.com',
  // 申込書PDF・本人確認書類を保存するGoogleドライブのフォルダID
  // https://drive.google.com/drive/folders/1ABCiNBAH840DjxNnR3YXjQCkWAaz098-
  FOLDER_ID: '1ABCiNBAH840DjxNnR3YXjQCkWAaz098-',
  COMPANY: '有限会社仁方大森マリーナー',
  COMPANY_SHORT: '(有)仁方大森マリーナー',
  COMPANY_TEL: '0823-27-7600',
  COMPANY_FAX: '0823-27-7818',
  COMPANY_ZIP: '737-0821',
  COMPANY_ADDR: '広島県呉市三条4丁目7-20',
  COMPANY_CONTACT: '大森',
  LICENSE_NO: '広島県知事(3)第10326号',
  SENDER_NAME: '仁方大森マリーナー 駐車場申込フォーム',

  // 保存先サブフォルダ名（親フォルダ内に自動作成されます）
  APP_SUBFOLDER: '申込書',
  ID_SUBFOLDER: '本人確認書類',

  // スプレッドシート名
  LOG_SPREADSHEET_NAME: '駐車場申込受付一覧',
  MASTER_SPREADSHEET_NAME: '月極駐車場マスター',

  // 保証会社（ナップ賃貸保証）の申込書を入れるサブフォルダ名
  GUARANTOR_SUBFOLDER: '保証委託申込書',

  // ---- 申込書のひな形（エクセル様式をGoogleスプレッドシートにしたもの） ----
  // このフォルダに、下の2つの名前でひな形を置いてください（MOUSHIKOMI_SETUP.md 参照）
  TEMPLATE_SUBFOLDER: 'テンプレート',
  TEMPLATE_PARK: '月極駐車場利用申込書',
  TEMPLATE_NAP: '入居申込書兼賃貸保証委託申込書',
  // ひな形の中の、使うシート名
  TEMPLATE_PARK_SHEET_KOJIN: '個人',
  TEMPLATE_PARK_SHEET_HOUJIN: '法人 ',
  TEMPLATE_NAP_SHEET: '入居申込書（個人用）',
};

/**
 * 保証会社（ナップ賃貸保証）の連絡先。
 * ※申込書に印字される連絡先・注意事項・選択肢は、すべてひな形（エクセル様式）側に
 *   入っています。ここはメール本文などで使う参考情報です。
 */
const NAP = {
  NAME: 'ナップ賃貸保証株式会社',
  TEL: '0570-055-722',
  FAX: '050-3802-2684',
  MAIL: 'nap-shinsa@nap.co.jp',
};

/**
 * ============================================================
 * 駐車場マスターの初期値
 * ※ 初回だけこの内容でスプレッドシートが作られます。
 *    以後の賃料変更は「月極駐車場マスター」シートを直接編集してください
 *    （このコードを書き換える必要はありません）。
 * ============================================================
 */
// ※「保証会社」列を TRUE にすると、その駐車場は保証会社（ナップ賃貸保証）の
//   「入居申込書兼賃貸保証委託申込書」も自動で作成し、フォームに審査用の入力欄が増えます。
const MASTER_HEADERS = [
  'ID', '駐車場名', 'プラン名', '月額賃料(税込)', '保証金区分', '保証金・敷金', '仲介手数料(税込)', '表示順', '有効', '保証会社', '所在地',
];

const MASTER_DEFAULTS = [
  ['omori5',        '大森第5ビル駐車場',       '',            16000, '保証料', 16550, 0, 10, 'TRUE', 'TRUE',  ''],
  ['omori5-2f',     '大森第5ビル駐車場2F',     '',             8800, '保証料', 16550, 0, 20, 'TRUE', 'TRUE',  ''],
  ['kure-nishi',    '呉駅前西中央駐車場',       '',            18000, '敷金',   18000, 0, 30, 'TRUE', 'FALSE', ''],
  ['sanjo4',        '三条4丁目大森駐車場',      '',            15000, '保証料', 15550, 0, 40, 'TRUE', 'TRUE',  ''],
  ['matsugaoka',    '松ヶ丘中谷ガレージ',       '',             5000, '保証料',  5550, 0, 50, 'TRUE', 'TRUE',  ''],
  ['eihome',        'エイホームビル駐車場',     '',            18000, '保証料', 18550, 0, 60, 'TRUE', 'FALSE', ''],
  ['eihome-bike-a', 'エイホームビルバイクガレージ', '125cc以下',  2000, '保証料',  2550, 0, 70, 'TRUE', 'FALSE', ''],
  ['eihome-bike-b', 'エイホームビルバイクガレージ', '125cc超え',  2500, '保証料',  3050, 0, 80, 'TRUE', 'FALSE', ''],
  ['eihome-bike-c', 'エイホームビルバイクガレージ', '400cc超え',  3500, '保証料',  4050, 0, 90, 'TRUE', 'FALSE', ''],
];

/** 既存のマスターに「保証会社」列を足すとき、TRUE を入れる駐車場のID */
const GUARANTOR_DEFAULT_IDS = ['omori5', 'omori5-2f', 'sanjo4', 'matsugaoka'];

/* ============================================================
 *  エントリポイント
 * ============================================================ */

/** GET：マスター配信＆稼働確認 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'master') {
    try {
      // masterUrl は、リンク作成ページから「賃料マスターを編集」で開くためのURL
      return json_({ ok: true, items: getMaster_(), masterUrl: masterSheet_().getParent().getUrl() });
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  if (action === 'selftest') {
    return ContentService.createTextOutput(m_selfTest_()).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput(
    '月極駐車場申込フォーム受付システムは稼働中です。\n' +
    '設定の点検は、このURLの末尾に ?action=selftest を付けて開いてください。');
}

/** POST：申込の受付 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ハニーポット（スパム対策）：非表示欄に入力があれば黙って成功を返す
    if (data.website) {
      return json_({ ok: true, receiptNo: '-' });
    }

    const isCorp = data.kind === 'houjin';
    const applicant = isCorp ? data.corpName : data.name;

    // 必須項目チェック
    if (!applicant || !data.lotName || !data.startDate) {
      return json_({ ok: false, error: '必須項目が不足しています。' });
    }

    // マスターに登録された物件所在地を補う（保証委託申込書の「物件所在地」に使用）
    try {
      const masterItem = getMasterItem_(data.lotId);
      if (masterItem && masterItem.addr && !data.lotAddr) data.lotAddr = masterItem.addr;
    } catch (e) { /* マスターが読めなくても受付は続行 */ }

    const now = new Date();
    const receiptNo = (isCorp ? 'HM' : 'KM') + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
    const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
    const label = m_safeName_(data.lotName) + '_' + m_safeName_(data.spot || '区画未定') + '_' + m_safeName_(applicant);
    const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');

    // 1) 運転免許証の画像をドライブへ保存
    let idFolderUrl = '';
    const idFiles = [];
    if (data.licFront || data.licBack) {
      const idRoot = m_getOrCreateSubfolder_(parent, M_CONFIG.ID_SUBFOLDER);
      const caseFolder = idRoot.createFolder(dateStr + '_' + label);
      [['licFront', '表'], ['licBack', '裏']].forEach(function (pair) {
        const blob = m_dataUrlToBlob_(data[pair[0]], dateStr + '_' + label + '_運転免許証' + pair[1] + '.jpg');
        if (blob) idFiles.push(caseFolder.createFile(blob));
      });
      idFolderUrl = caseFolder.getUrl();
    }

    // 2) 申込書を作成（エクセル様式のひな形をコピーして転記）
    //    ここで失敗しても、申込内容そのものは必ず記録・通知します
    //    （申込者に入力し直しをお願いしなくて済むように）
    const problems = [];
    let file = null;
    try {
      file = m_fillTemplate_(
        M_CONFIG.TEMPLATE_PARK,
        isCorp ? M_CONFIG.TEMPLATE_PARK_SHEET_HOUJIN : M_CONFIG.TEMPLATE_PARK_SHEET_KOJIN,
        m_parkValues_(data, now),
        dateStr + '_' + label,
        m_getOrCreateSubfolder_(parent, M_CONFIG.APP_SUBFOLDER));
    } catch (err) {
      problems.push('月極駐車場利用申込書の作成に失敗：' + (err && err.message ? err.message : String(err)));
    }

    // 2-2) 保証会社を利用する駐車場は、保証委託申込書も作成
    //      （マスターの「保証会社」列が TRUE の場合のみ。個人の申込に限ります）
    let napFile = null;
    if (!isCorp && m_useGuarantor_(data)) {
      try {
        napFile = m_fillTemplate_(
          M_CONFIG.TEMPLATE_NAP,
          M_CONFIG.TEMPLATE_NAP_SHEET,
          m_napValues_(data, now),
          dateStr + '_' + label + '_保証委託申込書',
          m_getOrCreateSubfolder_(parent, M_CONFIG.GUARANTOR_SUBFOLDER));
      } catch (err) {
        problems.push('保証委託申込書の作成に失敗：' + (err && err.message ? err.message : String(err)));
      }
    }

    // 3) 受付一覧スプレッドシートに記録
    let sheetError = problems.join(' / ');
    try {
      m_appendLog_(parent, data, receiptNo, now, file ? file.getUrl() : '', idFolderUrl,
        napFile ? napFile.getUrl() : '');
    } catch (err) {
      sheetError = (sheetError ? sheetError + ' / ' : '') + '受付一覧への記録に失敗：' + String(err);
    }

    // 4) 管理者へ通知メール（申込内容は本文に全部入るので、書類が作れなくても内容は届きます）
    try {
      m_sendNotifyMail_(data, receiptNo, now, file, idFolderUrl, sheetError, napFile, idFiles);
    } catch (err) {
      // メール送信に失敗しても、受付一覧には残っています
    }

    // 5) 申込者へ受付完了メール（メールアドレスがある場合のみ）
    if (data.email) {
      try {
        m_sendReceiptMail_(data, receiptNo, now);
      } catch (err) {
        // 自動返信の失敗は受付に影響させない
      }
    }

    // 申込は受け付けできています。書類作成につまずいた場合は warning で知らせます
    return json_({ ok: true, receiptNo: receiptNo, warning: problems.join(' / ') });
  } catch (err) {
    return json_({ ok: false, error: (err && err.message ? err.message : String(err)) });
  }
}

/** JSONレスポンス */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 *  駐車場マスター
 * ============================================================ */

/** マスターのスプレッドシートを取得（なければ初期値で作成） */
function masterSheet_() {
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const it = parent.getFilesByName(M_CONFIG.MASTER_SPREADSHEET_NAME);
  let ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(M_CONFIG.MASTER_SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(parent);
  }
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MASTER_HEADERS);
    MASTER_DEFAULTS.forEach(function (r) { sheet.appendRow(r); });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, MASTER_HEADERS.length).setFontWeight('bold').setBackground('#e5f6f6');
    sheet.getRange(2, 4, sheet.getMaxRows(), 1).setNumberFormat('#,##0');
    sheet.getRange(2, 6, sheet.getMaxRows(), 2).setNumberFormat('#,##0');
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 110);
  } else {
    m_migrateMaster_(sheet);
  }
  return sheet;
}

/**
 * 以前のバージョンで作られたマスターに、後から増えた列（末尾）を足す。
 * すでにある行・金額はそのまま残ります（列が増えるだけです）。
 */
function m_migrateMaster_(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  const last = sheet.getLastRow();

  MASTER_HEADERS.forEach(function (name, i) {
    if (header.indexOf(name) >= 0) return;
    const col = i + 1;
    sheet.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#e5f6f6');
    // 「保証会社」は、既定の4駐車場だけ TRUE を入れておく
    if (name === '保証会社' && last >= 2) {
      const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      const vals = ids.map(function (r) {
        return [GUARANTOR_DEFAULT_IDS.indexOf(String(r[0]).trim()) >= 0 ? 'TRUE' : 'FALSE'];
      });
      sheet.getRange(2, col, vals.length, 1).setValues(vals);
    }
  });
}

/** マスターを配列で取得（有効な行のみ・表示順） */
function getMaster_() {
  const sheet = masterSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, MASTER_HEADERS.length).getValues();
  const items = [];
  values.forEach(function (r) {
    const id = String(r[0]).trim();
    const name = String(r[1]).trim();
    if (!id || !name) return;
    const active = String(r[8]).trim().toUpperCase();
    if (active === 'FALSE' || active === '×' || active === '無効') return;
    items.push({
      id: id,
      name: name,
      plan: String(r[2] || '').trim(),
      rent: m_num_(r[3]),
      depositLabel: String(r[4] || '保証料').trim(),
      deposit: m_num_(r[5]),
      brokerFee: m_num_(r[6]),
      order: m_num_(r[7]),
      useGuarantor: ['TRUE', '○', '有', '利用', 'YES', '1'].indexOf(String(r[9]).trim().toUpperCase()) >= 0,
      addr: String(r[10] || '').trim(),
    });
  });
  items.sort(function (a, b) { return (a.order || 9999) - (b.order || 9999); });
  return items;
}

/** マスターの1件をIDで取得（見つからなければ null） */
function getMasterItem_(id) {
  if (!id) return null;
  const items = getMaster_();
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i];
  }
  return null;
}

/**
 * 駐車場マスターをスプレッドシートで開くためのURLをログに出します。
 * （GASエディタで実行 → 実行ログに出たURLを開いて賃料を編集してください）
 */
function openMaster() {
  const sheet = masterSheet_();
  const url = sheet.getParent().getUrl();
  Logger.log('駐車場マスター：' + url);
  return url;
}

/* ============================================================
 *  小さなヘルパー
 * ============================================================ */

function m_getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function m_num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function m_yen_(n) {
  return Number(n || 0).toLocaleString('ja-JP') + '円';
}

/** 'yyyy-mm-dd' → 'yyyy年M月d日'（それ以外はそのまま返す） */
function m_dateJa_(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? (m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日') : String(s);
}

// 市外局番が3桁の地域
const M_AREA3 = ['011','015','017','018','019','022','023','024','025','026','027','028','029',
  '042','043','044','045','046','047','048','049','052','053','054','055','058','059',
  '072','073','075','076','077','078','079','082','083','084','086','087','088','089',
  '092','093','095','096','097','098','099'];
// M_AREA3 と頭3桁が重なる「市外局番4桁」の地域（例：082=広島市 に対して 0823=呉市）。
// 中国・四国を網羅。他地域を追加する場合はここに足してください。
const M_AREA4 = ['0820','0823','0824','0826','0827','0829',
  '0833','0834','0835','0836','0837','0838',
  '0845','0846','0847','0848',
  '0863','0865','0866','0867','0868','0869',
  '0875','0877','0879',
  '0880','0883','0884','0885','0887','0889',
  '0892','0893','0894','0895','0896','0897','0898'];

/**
 * 電話番号を全角→半角に直し、ハイフンが無ければ補う。
 * ※フォームから届く値は入力時にハイフン済みなので、ここは保険（手入力・旧データ用）です。
 * すでにハイフンが入っている場合はそのまま返します。
 */
function m_tel_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const s = String(v).trim()
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－ー―‐]/g, '-');
  if (!/^\d{10,11}$/.test(s)) return s;   // ハイフン入り・桁数が想定外のものは触らない

  function cut(a, b) {
    return [s.slice(0, a), s.slice(a, a + b), s.slice(a + b)]
      .filter(function (x) { return x !== ''; }).join('-');
  }
  // 0800 は携帯の 080 と頭が重なるため、携帯より先に判定する
  if (/^0120/.test(s)) return cut(4, 3);                           // フリーダイヤル
  if (/^0800/.test(s)) return cut(4, 3);
  if (/^(0[789]0|050)/.test(s)) return cut(3, 4);                 // 携帯・IP電話
  if (/^0[36]/.test(s)) return cut(2, 4);                          // 東京・大阪
  if (M_AREA4.indexOf(s.slice(0, 4)) >= 0) return cut(4, 2);       // 市外局番4桁（3桁と重なるもの）
  if (M_AREA3.indexOf(s.slice(0, 3)) >= 0) return cut(3, 3);       // 市外局番3桁
  if (/^0/.test(s)) return cut(4, 2);                              // その他の固定電話
  return s;
}

/** ファイル名に使えない文字を置き換え */
function m_safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim() || '未入力';
}

/** data URL (image/xxx;base64,....) を Blob に変換 */
function m_dataUrlToBlob_(dataUrl, filename) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[2]);
  return Utilities.newBlob(bytes, m[1], filename);
}

/**
 * この申込が保証会社（ナップ賃貸保証）を利用するかどうか。
 * マスターの「保証会社」列を正とし、マスターに無いID（その他の駐車場）は
 * フォームから届いた値を使います。
 */
function m_useGuarantor_(data) {
  try {
    const item = getMasterItem_(data.lotId);
    if (item) return !!item.useGuarantor;
  } catch (e) { /* マスターが読めない場合はフォームの値で判断 */ }
  return !!data.useGuarantor;
}

/** 駐車場名（プラン名があれば併記） */
function m_lotLabel_(data) {
  return data.lotName + (data.lotPlan ? '（' + data.lotPlan + '）' : '');
}

/** 住所（郵便番号があれば先頭に付ける） */
function m_addr_(zip, addr) {
  const z = String(zip || '').trim();
  const a = String(addr || '').trim();
  if (!a) return '';
  return z ? ('〒' + z + '　' + a) : a;
}

/* ============================================================
 *  受付一覧スプレッドシート
 * ============================================================ */

const LOG_HEADERS = [
  '受付日時', '受付番号', '個人/法人', '駐車場名', 'プラン', '区画', '利用開始日',
  '月額賃料(税込)', '保証金区分', '保証金・敷金', '仲介手数料(税込)',
  '申込者名', 'フリガナ', '生年月日', '郵便番号', '住所', '携帯', 'メール',
  '勤務先/代表者', '勤務先電話/担当者', '勤務先所在地/法人TEL',
  '緊急連絡先氏名', '続柄', '緊急連絡先電話', '緊急連絡先住所',
  'メーカー', '車種', '色', '登録ナンバー',
  '免許証', '個人情報同意', '記載事項同意', '備考', '申込書', '本人確認書類フォルダ', '保証委託申込書',
];

function m_appendLog_(parent, data, receiptNo, now, pdfUrl, idFolderUrl, napUrl) {
  const isCorp = data.kind === 'houjin';
  let ss;
  const it = parent.getFilesByName(M_CONFIG.LOG_SPREADSHEET_NAME);
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(M_CONFIG.LOG_SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(parent);
  }
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold').setBackground('#e5f6f6');
  }
  // 区画・電話番号は数値化されると先頭の0が消えるため、列の書式をテキストに固定
  try {
    [6, 15, 17, 20, 24, 29].forEach(function (col) {
      sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
  } catch (e) {}

  const licNote = [data.licFront ? '表' : '', data.licBack ? '裏' : ''].filter(String).join('・') || '未提出';

  sheet.appendRow([
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    receiptNo,
    isCorp ? '法人' : '個人',
    data.lotName || '', data.lotPlan || '', String(data.spot || ''), m_dateJa_(data.startDate),
    m_num_(data.rent), data.depositLabel || '', m_num_(data.deposit), m_num_(data.brokerFee),
    isCorp ? (data.corpName || '') : (data.name || ''),
    isCorp ? (data.corpKana || '') : (data.kana || ''),
    isCorp ? '' : m_dateJa_(data.birth),
    String(isCorp ? (data.corpZip || '') : (data.zip || '')),
    isCorp ? (data.corpAddr || '') : (data.address || ''),
    m_tel_(isCorp ? data.staffMobile : data.mobile),
    data.email || '',
    isCorp ? (data.repName || '') : (data.workName || ''),
    isCorp ? (data.staffName || '') : m_tel_(data.workTel),
    isCorp ? m_tel_(data.corpTel) : (data.workAddr || ''),
    data.emgName || '', data.emgRel || '', m_tel_(data.emgTel), m_addr_(data.emgZip, data.emgAddr),
    data.carMaker || '', data.carModel || '', data.carColor || '', String(data.carNumber || ''),
    licNote,
    data.agreePrivacy ? '同意' : '',
    data.agreeTruth ? '同意' : '',
    data.note || '',
    pdfUrl, idFolderUrl || '', napUrl || '',
  ]);
}

/* ============================================================
 *  メール
 * ============================================================ */

/** 通知メール・確認画面で使う「項目：値」の一覧 */
function m_buildRows_(data) {
  const isCorp = data.kind === 'houjin';
  const rows = [
    ['区分', isCorp ? '法人' : '個人'],
    ['駐車場名', m_lotLabel_(data)],
    ['区画', data.spot || '（未定）'],
    ['利用開始日', m_dateJa_(data.startDate)],
    ['月額賃料1台', m_yen_(data.rent) + '（税込）'],
    [(data.depositLabel || '保証料'), m_yen_(data.deposit)],
    ['仲介手数料(税込)', m_yen_(data.brokerFee)],
  ];
  if (isCorp) {
    rows.push(['法人名', data.corpName || '']);
    rows.push(['フリガナ', data.corpKana || '']);
    rows.push(['所在地', m_addr_(data.corpZip, data.corpAddr)]);
    rows.push(['代表者様名', data.repName || '']);
    rows.push(['担当者様名', data.staffName || '']);
    rows.push(['法人TEL / FAX', m_tel_(data.corpTel) + (data.corpFax ? ' / ' + m_tel_(data.corpFax) : '')]);
    rows.push(['担当者携帯', m_tel_(data.staffMobile)]);
    rows.push(['所属部署TEL', m_tel_(data.staffDeptTel)]);
  } else {
    rows.push(['氏名', data.name || '']);
    rows.push(['フリガナ', data.kana || '']);
    rows.push(['生年月日', m_dateJa_(data.birth)]);
    rows.push(['住所', m_addr_(data.zip, data.address)]);
    rows.push(['携帯', m_tel_(data.mobile)]);
    rows.push(['勤務先', [data.workName, m_tel_(data.workTel), data.workAddr].filter(String).join(' / ')]);
  }
  rows.push(['メール', data.email || '']);
  rows.push(['緊急連絡先', [data.emgName, data.emgRel ? '（' + data.emgRel + '）' : '',
    m_tel_(data.emgTel)].filter(String).join(' ')]);
  rows.push(['緊急連絡先住所', m_addr_(data.emgZip, data.emgAddr)]);
  rows.push(['緊急連絡先勤務先', data.emgWork || '']);
  rows.push(['利用車両', [data.carMaker, data.carModel, data.carColor].filter(String).join(' / ')]);
  rows.push(['登録ナンバー', data.carNumber || '']);
  rows.push(['運転免許証', [data.licFront ? '表面' : '', data.licBack ? '裏面' : '']
    .filter(String).join('・') || '未提出']);
  if (!isCorp && m_useGuarantor_(data)) {
    rows.push(['― 保証会社審査用 ―', '（ナップ賃貸保証）']);
    rows.push(['性別／配偶者', [data.sex, data.spouse ? '配偶者' + data.spouse : ''].filter(String).join('／')]);
    rows.push(['国籍', data.nationality || '']);
    rows.push(['住居区分', data.housing || '']);
    rows.push(['自宅電話', m_tel_(data.homeTel)]);
    rows.push(['勤務先 業種', data.workType || '']);
    rows.push(['年収', data.income ? Number(data.income).toLocaleString('ja-JP') + '万円' : '']);
    rows.push(['勤続年数', m_tenure_(data)]);
    rows.push(['雇用形態', data.employ || '']);
    rows.push(['緊急連絡先 性別／住居区分', [data.emgSex, data.emgHousing].filter(String).join('／')]);
    rows.push(['引越・申込理由', data.napReason || '']);
  }
  if (data.note) rows.push(['備考', data.note]);
  return rows.filter(function (r) { return String(r[1]).trim() !== ''; });
}

/** 管理者への通知メール */
function m_sendNotifyMail_(data, receiptNo, now, file, idFolderUrl, sheetError, napFile, idFiles) {
  const isCorp = data.kind === 'houjin';
  const applicant = isCorp ? data.corpName : data.name;
  const subject = '【駐車場申込' + (napFile ? '／保証会社' : '') + (sheetError ? '／要確認' : '') + '】' +
    m_lotLabel_(data) + ' ' + (data.spot || '') +
    '（' + applicant + (isCorp ? ' 御中' : ' 様') + '）';

  const lines = m_buildRows_(data).map(function (r) { return '■' + r[0] + '：' + r[1]; }).join('\n');

  const body =
    '月極駐車場の利用申込を受け付けました。\n\n' +
    '受付番号：' + receiptNo + '\n' +
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '\n' +
    '------------------------------------------\n' +
    lines + '\n' +
    '------------------------------------------\n\n' +
    (file
      ? '▼月極駐車場利用申込書（スプレッドシート・そのまま修正できます）\n' + file.getUrl() + '\n'
      : '※月極駐車場利用申込書は自動作成できませんでした（下記の理由をご確認ください）。\n' +
        '　お手数ですが、上記の内容をもとに手入力でご作成ください。\n') +
    (napFile ? '\n▼入居申込書兼賃貸保証委託申込書（ナップ賃貸保証へ提出／スプレッドシート）\n' +
      napFile.getUrl() + '\n' : '') +
    (idFolderUrl ? '\n▼運転免許証（表・裏）\n' + idFolderUrl + '\n' : '\n※運転免許証の画像は添付されていません。\n') +
    (sheetError ? '\n⚠ うまくいかなかった処理があります：\n　' + sheetError + '\n' +
      '　ウェブアプリのURLに ?action=selftest を付けて開くと、原因を確認できます。\n' : '') +
    '\n' + M_CONFIG.COMPANY + '\n';

  // 添付：申込書のPDF（印刷・確認用）と、運転免許証の画像
  const attachments = [];
  [file, napFile].forEach(function (f) {
    if (!f) return;
    try { attachments.push(f.getAs(MimeType.PDF).setName(f.getName() + '.pdf')); }
    catch (e) { /* PDF書き出しに失敗しても、本文のリンクから開けます */ }
  });
  (idFiles || []).forEach(function (f) {
    try { attachments.push(f.getBlob()); } catch (e) {}
  });

  MailApp.sendEmail({
    to: M_CONFIG.NOTIFY_EMAIL,
    subject: subject,
    body: body,
    attachments: attachments,
    name: M_CONFIG.SENDER_NAME,
  });
}

/** 申込者への受付完了メール */
function m_sendReceiptMail_(data, receiptNo, now) {
  const isCorp = data.kind === 'houjin';
  const applicant = isCorp ? (data.corpName + ' ご担当者' + (data.staffName ? '　' + data.staffName : '') + ' 様')
    : (data.name + ' 様');

  const body =
    applicant + '\n\n' +
    'このたびは月極駐車場のお申し込みをいただき、誠にありがとうございます。\n' +
    '下記の内容でお申し込みを受け付けいたしました。\n\n' +
    '受付番号　　　：' + receiptNo + '\n' +
    '受付日時　　　：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '\n' +
    '駐車場名　　　：' + m_lotLabel_(data) + '\n' +
    '区画　　　　　：' + (data.spot || '（弊社にて決定のうえご連絡いたします）') + '\n' +
    '利用開始日　　：' + m_dateJa_(data.startDate) + '\n' +
    '月額賃料1台　 ：' + m_yen_(data.rent) + '（税込）\n' +
    (data.depositLabel || '保証料') + '　　　　：' + m_yen_(data.deposit) + '\n' +
    '仲介手数料　　：' + m_yen_(data.brokerFee) + '（税込）\n\n' +
    '内容を確認のうえ、審査結果と今後のお手続きについて弊社よりご連絡いたします。\n' +
    '※本メールは送信専用です。ご不明な点はお電話にてお問い合わせください。\n\n' +
    '------------------------------------------\n' +
    M_CONFIG.COMPANY + '\n' +
    'TEL：' + M_CONFIG.COMPANY_TEL + '\n' +
    '免許番号：' + M_CONFIG.LICENSE_NO + '\n';

  MailApp.sendEmail({
    to: data.email,
    subject: '【受付完了】月極駐車場 利用申込（受付番号：' + receiptNo + '）',
    body: body,
    name: M_CONFIG.SENDER_NAME,
  });
}

/* ============================================================
 *  動作確認用
 * ============================================================ */

/**
 * 初回セットアップ／動作確認。
 * GASエディタでこの関数を実行すると、
 *  ・駐車場マスターのスプレッドシートを作成（初期値入り）
 *  ・テスト申込書PDFをドライブに保存
 *  ・通知メールを1通送信
 *  ・受付一覧スプレッドシートを作成
 * まで一気に確認できます（テストPDF・テスト行は削除してOKです）。
 */
function testSetup() {
  const master = getMaster_();
  Logger.log('駐車場マスター：' + master.length + '件');
  Logger.log(JSON.stringify(master, null, 2));
  Logger.log('マスターのURL：' + masterSheet_().getParent().getUrl());

  const lot = master[0] || { id: 'test', name: 'テスト駐車場', plan: '', rent: 16000,
    depositLabel: '保証料', deposit: 16550, brokerFee: 0, useGuarantor: true, addr: '' };
  const now = new Date();
  const data = {
    kind: 'kojin',
    lotName: lot.name, lotPlan: lot.plan, spot: 'A-1',
    rent: lot.rent, depositLabel: lot.depositLabel, deposit: lot.deposit, brokerFee: lot.brokerFee,
    startDate: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'),
    kana: 'テスト タロウ', name: 'テスト太郎', birth: '1985-04-01',
    zip: '737-0821', address: '広島県呉市三条4丁目7-20',
    mobile: '09012345678', email: '',
    workName: 'テスト株式会社', workTel: '0823-27-7600', workAddr: '広島県呉市',
    emgName: 'テスト花子', emgKana: 'テスト ハナコ', emgRel: '配偶者',
    emgBirth: '1987-05-05', emgZip: '737-0821', emgAddr: '広島県呉市三条4丁目7-20',
    emgTel: '0823277600', emgWork: 'テスト商事',
    carMaker: 'トヨタ', carModel: 'アクア', carColor: '白', carNumber: '広島 300 あ 12-34',
    agreePrivacy: true, agreeTruth: true, note: 'これはテスト送信です。',
    // 保証会社（ナップ賃貸保証）の審査項目
    lotId: lot.id, lotAddr: lot.addr, useGuarantor: !!lot.useGuarantor,
    sex: '男', spouse: '有', nationality: '日本', housing: '賃貸', homeTel: '0823277600',
    workType: '製造業', employ: '正社員', income: 450, tenureY: 7, tenureM: 2,
    emgSex: '女', emgHousing: '家族所有', emgHomeTel: '',
    napReason: 'テスト（転勤のため）',
  };

  const receiptNo = 'TEST' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');

  const file = m_fillTemplate_(M_CONFIG.TEMPLATE_PARK, M_CONFIG.TEMPLATE_PARK_SHEET_KOJIN,
    m_parkValues_(data, now), dateStr + '_テスト申込書',
    m_getOrCreateSubfolder_(parent, M_CONFIG.APP_SUBFOLDER));
  Logger.log('テスト申込書（スプレッドシート）：' + file.getUrl());

  // 保証会社を利用する駐車場なら、保証委託申込書も作成
  let napFile = null;
  if (m_useGuarantor_(data)) {
    napFile = m_fillTemplate_(M_CONFIG.TEMPLATE_NAP, M_CONFIG.TEMPLATE_NAP_SHEET,
      m_napValues_(data, now), dateStr + '_テスト保証委託申込書',
      m_getOrCreateSubfolder_(parent, M_CONFIG.GUARANTOR_SUBFOLDER));
    Logger.log('テスト保証委託申込書（スプレッドシート）：' + napFile.getUrl());
  } else {
    Logger.log('この駐車場は保証会社を利用しない設定のため、保証委託申込書は作成しませんでした。');
  }

  m_appendLog_(parent, data, receiptNo, now, file.getUrl(), '', napFile ? napFile.getUrl() : '');
  m_sendNotifyMail_(data, receiptNo, now, file, '', '', napFile, []);
  Logger.log('テスト通知メールを ' + M_CONFIG.NOTIFY_EMAIL + ' へ送信しました。');
}

/**
 * ひな形がきちんと置けているかだけを確かめる関数。
 * GASエディタで実行すると、見つかったひな形とシート名を実行ログに出します。
 */
function checkTemplates() {
  [[M_CONFIG.TEMPLATE_PARK, [M_CONFIG.TEMPLATE_PARK_SHEET_KOJIN, M_CONFIG.TEMPLATE_PARK_SHEET_HOUJIN]],
   [M_CONFIG.TEMPLATE_NAP, [M_CONFIG.TEMPLATE_NAP_SHEET]]].forEach(function (pair) {
    try {
      const f = m_findTemplate_(pair[0]);
      const ss = SpreadsheetApp.open(f);
      const names = ss.getSheets().map(function (sh) { return sh.getName(); });
      Logger.log('✅ ' + pair[0] + '：見つかりました。シート＝「' + names.join('」「') + '」');
      pair[1].forEach(function (need) {
        if (!m_sheetByName_(ss, need)) {
          Logger.log('　⚠ シート「' + need + '」が見つかりません。M_CONFIG のシート名を実物に合わせてください。');
        }
      });
    } catch (err) {
      Logger.log('❌ ' + pair[0] + '：' + err.message);
    }
  });
}

/* ============================================================
 *  申込書の作成（エクセル様式のテンプレートに転記）
 *
 *  ドライブの「テンプレート」フォルダに置いた
 *   ・月極駐車場利用申込書
 *   ・入居申込書兼賃貸保証委託申込書
 *  （どちらもGoogleスプレッドシート形式）をコピーし、
 *  セルに値を入れるだけです。**様式は一切変更しません。**
 *  でき上がりもスプレッドシートなので、そのまま手直しできます。
 *
 *  セットアップは MOUSHIKOMI_SETUP.md を参照してください。
 * ============================================================ */

/**
 * ひな形を名前で探す。
 * ・ファイル名の末尾の「.xlsx」は無視するので、変換後の名前を直す必要はありません
 * ・エクセルのまま置かれている場合は、何をすればよいかを具体的に伝えます
 */
function m_findTemplate_(name) {
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const tplFolder = m_getOrCreateSubfolder_(parent, M_CONFIG.TEMPLATE_SUBFOLDER);
  const want = m_baseName_(name);
  let excel = null;   // 同じ名前のエクセルが見つかった場合の控え

  const it = tplFolder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (m_baseName_(f.getName()) !== want) continue;
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return f;
    excel = f;
  }

  if (excel) {
    throw new Error('ひな形「' + want + '」はエクセル形式のままです。ドライブでこのファイルを開き、' +
      'メニューの「ファイル」→「Google スプレッドシートとして保存」を実行してください' +
      '（変換後のファイル名は「' + want + '.xlsx」のままで構いません）。');
  }
  throw new Error('ひな形「' + want + '」が、ドライブの「' + M_CONFIG.TEMPLATE_SUBFOLDER +
    '」フォルダにありません。MOUSHIKOMI_SETUP.md の「2.5」の手順でご用意ください。');
}

/** ファイル名から末尾の拡張子を取り除く（前後の空白も落とす） */
function m_baseName_(name) {
  return String(name == null ? '' : name).trim().replace(/\.(xlsx|xlsm|xls)$/i, '').trim();
}

/**
 * テンプレートをコピーして値を流し込む。
 * values は { 'A1': '値', 'B2': { check: '駐車場' } } の形。
 * check を指定した場合は、そのセルの「□ラベル」を「☑ラベル」に変えるだけです
 * （元の選択肢の文字はそのまま残ります）。
 */
function m_fillTemplate_(templateName, keepSheet, values, outName, folder) {
  const copy = m_findTemplate_(templateName).makeCopy(outName, folder);
  const ss = SpreadsheetApp.open(copy);

  // 目的のシートを先に確保する（シート名の前後の空白は無視して探します）
  const sheet = m_sheetByName_(ss, keepSheet);
  if (!sheet) {
    const names = ss.getSheets().map(function (sh) { return '「' + sh.getName() + '」'; }).join('、');
    copy.setTrashed(true);
    throw new Error('ひな形「' + templateName + '」にシート「' + keepSheet + '」がありません。' +
      '（あるシート：' + names + '）M_CONFIG のシート名を実物に合わせてください。');
  }

  // 使わないシート（法人用・記入例など）は削除して、1枚の申込書にする
  ss.getSheets().forEach(function (sh) {
    if (sh.getSheetId() !== sheet.getSheetId()) ss.deleteSheet(sh);
  });

  Object.keys(values).forEach(function (addr) {
    const v = values[addr];
    if (v === null || v === undefined) return;
    const range = sheet.getRange(addr);
    if (typeof v === 'object' && v.check) {
      range.setValue(m_check_(range.getValue(), v.check));
    } else {
      range.setValue(v);
    }
  });
  SpreadsheetApp.flush();
  return copy;
}

/** シートを名前で探す（前後の空白は無視。ひな形のシート名が「法人 」のように末尾に空白を持つため） */
function m_sheetByName_(ss, name) {
  const target = String(name).trim();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim() === target) return sheets[i];
  }
  return null;
}

/** 「□ラベル」を「☑ラベル」にする（他の選択肢はそのまま） */
function m_check_(text, label) {
  const s = String(text == null ? '' : text);
  if (s.indexOf('□' + label) >= 0) return s.split('□' + label).join('☑' + label);
  if (s.indexOf('□ ' + label) >= 0) return s.split('□ ' + label).join('☑ ' + label);
  return s;
}

/* ---------------- 値を組み立てるための小道具 ---------------- */

/** 'yyyy-mm-dd' を年・月・日に分解 */
function m_dParts_(s) {
  const m = String(s == null ? '' : s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : null;
}

/** 4桁の年を、1桁ずつ4つのセルに入れる（テンプレートの枠に合わせるため） */
function m_putYear_(out, cells, year) {
  const y = String(year || '');
  cells.forEach(function (c, i) { out[c] = y.charAt(i) || ''; });
}

/** 月・日を、10の位／1の位の2セルに入れる */
function m_put2_(out, cells, n) {
  const s = String(n || '');
  if (!s) { out[cells[0]] = ''; out[cells[1]] = ''; return; }
  out[cells[0]] = s.length >= 2 ? s.charAt(0) : '';
  out[cells[1]] = s.slice(-1);
}

/** 郵便番号を1文字ずつセルに入れる（上3桁・下4桁） */
function m_putZip_(out, cells3, cells4, zip) {
  const d = String(zip || '').replace(/[^0-9]/g, '');
  cells3.forEach(function (c, i) { out[c] = d.charAt(i) || ''; });
  cells4.forEach(function (c, i) { out[c] = d.charAt(3 + i) || ''; });
}

/** 住所を「都道府県（名前だけ）」と「それ以降」に分ける */
function m_splitAddr_(a) {
  const s = String(a || '').trim();
  const m = s.match(/^(.+?)([都道府県])(.*)$/);
  return m ? { pref: m[1], rest: m[3].trim() } : { pref: '', rest: s };
}

/** 勤続年数を「○年　　○ヵ月」に */
function m_tenure_(data) {
  const y = m_num_(data.tenureY);
  const m = m_num_(data.tenureM);
  if (!y && !m) return '';
  return (y ? y + '年' : '') + '　　' + (m ? m + 'ヵ月' : '');
}

/* ============================================================
 *  ① 月極駐車場利用申込書（個人／法人）へのセル対応
 *     ※セル番地はテンプレートの様式に合わせています。
 *       様式を差し替えた場合はここを直してください。
 * ============================================================ */

function m_parkValues_(data, now) {
  const isCorp = data.kind === 'houjin';
  const out = {};
  const start = m_dParts_(data.startDate);
  const apply = m_dParts_(data.applyDate) ||
    m_dParts_(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'));

  // ---- 駐車場 ----
  m_putYear_(out, ['K3', 'L3', 'M3', 'N3'], start ? start.y : '');
  m_put2_(out, ['Q3', 'R3'], start ? start.m : '');
  m_put2_(out, ['U3', 'V3'], start ? start.d : '');
  out.I4 = m_lotLabel_(data);
  out.AB4 = data.spot || '';
  const comma = function (n) { return Number(m_num_(n)).toLocaleString('ja-JP'); };
  out.I5 = comma(data.rent);
  out.O5 = data.depositLabel || '敷金';      // 「敷金」か「保証料」か
  out.T5 = comma(data.deposit);
  out.Z6 = comma(data.brokerFee);

  if (!isCorp) {
    // ---- 申込人（個人） ----
    const b = m_dParts_(data.birth);
    out.I8 = data.kana || '';
    out.I9 = data.name || '';
    m_putYear_(out, ['K10', 'L10', 'M10', 'N10'], b ? b.y : '');
    m_put2_(out, ['Q10', 'R10'], b ? b.m : '');
    m_put2_(out, ['U10', 'V10'], b ? b.d : '');
    out.I11 = m_addr_(data.zip, data.address);
    out.M12 = m_tel_(data.mobile);
    out.M13 = data.workName || '';
    out.Y13 = m_tel_(data.workTel);
    out.M14 = data.workAddr || '';
  } else {
    // ---- 申込法人（法人シート） ----
    out.I8 = data.corpKana || '';
    out.I9 = data.corpName || '';
    // S10/S11 は「フリガナ」「担当者様名」のラベル。値は X列に入れる
    out.I10 = data.repKana || '';
    out.X10 = data.staffKana || '';
    out.I11 = data.repName || '';
    out.X11 = data.staffName || '';
    out.M12 = m_tel_(data.corpTel);
    out.Y12 = m_tel_(data.corpFax);
    out.M13 = m_tel_(data.staffMobile);
    out.Y13 = m_tel_(data.staffDeptTel);
  }

  // ---- 緊急連絡先／利用車両／申込日（個人と法人で行がずれる） ----
  const R = isCorp
    ? { name: 'I14', by: 'X14', bm: 'AB14', bd: 'AE14', addr: 'I15', tel: 'I16', work: 'X16',
        maker: 'I18', model: 'S18', color: 'AB18', number: 'I19',
        ay: ['G23', 'H23', 'I23', 'J23'], am: ['M23', 'N23'], ad: ['Q23', 'R23'], sign: 'Q24' }
    : { name: 'I15', by: 'X15', bm: 'AB15', bd: 'AE15', addr: 'I16', tel: 'I17', work: 'X17',
        maker: 'I19', model: 'S19', color: 'AB19', number: 'I20',
        ay: ['G23', 'H23', 'I23', 'J23'], am: ['M23', 'N23'], ad: ['Q23', 'R23'], sign: 'P24' };

  const eb = m_dParts_(data.emgBirth);
  out[R.name] = data.emgName || '';
  out[R.by] = eb ? eb.y : '';
  out[R.bm] = eb ? eb.m : '';
  out[R.bd] = eb ? eb.d : '';
  out[R.addr] = m_addr_(data.emgZip, data.emgAddr);
  out[R.tel] = m_tel_(data.emgTel);
  out[R.work] = data.emgWork || '';

  out[R.maker] = data.carMaker || '';
  out[R.model] = data.carModel || '';
  out[R.color] = data.carColor || '';
  out[R.number] = data.carNumber || '';

  m_putYear_(out, R.ay, apply ? apply.y : '');
  m_put2_(out, R.am, apply ? apply.m : '');
  m_put2_(out, R.ad, apply ? apply.d : '');
  out[R.sign] = isCorp ? (data.corpName || '') : (data.name || '');

  return out;
}

/* ============================================================
 *  ② 入居申込書兼賃貸保証委託申込書（個人用）へのセル対応
 *     ナップ賃貸保証の様式。チェック欄は「□」を「☑」に変えるだけで、
 *     選択肢の文字も罫線もそのまま残ります。
 * ============================================================ */

function m_napValues_(data, now) {
  const out = {};
  const apply = m_dParts_(data.applyDate) ||
    m_dParts_(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'));
  const start = m_dParts_(data.startDate);

  // ---- 加盟店様概要 ----
  out.I5 = M_CONFIG.COMPANY;
  out.I7 = '〒' + M_CONFIG.COMPANY_ZIP + '　' + M_CONFIG.COMPANY_ADDR;
  out.I9 = 'TEL　' + M_CONFIG.COMPANY_TEL;
  out.R9 = 'FAX　' + M_CONFIG.COMPANY_FAX;
  out.I11 = M_CONFIG.COMPANY_CONTACT;
  out.V11 = ((data.licFront ? 1 : 0) + (data.licBack ? 1 : 0) + 1) + '枚';
  out.AI9 = { check: '新規' };
  out.AI11 = data.napReason || '';
  m_putYear_(out, ['AI5', 'AJ5', 'AK5', 'AL5'], apply ? apply.y : '');
  out.AO5 = apply ? apply.m : '';
  out.AR5 = apply ? apply.d : '';
  m_putYear_(out, ['AI7', 'AJ7', 'AK7', 'AL7'], start ? start.y : '');
  out.AO7 = start ? start.m : '';
  out.AR7 = start ? start.d : '';

  // ---- 加盟店様ご記入欄（物件・賃料・保証プラン） ----
  out.E14 = { check: '駐車場' };                    // 物件用途
  out.E17 = m_lotLabel_(data);                      // 物件名
  out.X16 = data.spot || '';                        // 号室（区画）
  const la = m_splitAddr_(data.lotAddr);
  m_putZip_(out, ['F19', 'G19', 'H19'], ['J19', 'K19', 'L19', 'M19'], data.lotZip);
  out.E20 = la.pref;
  out.M20 = la.rest;
  out.E22 = (data.depositLabel || '保証料') + '　' + m_yen_(data.deposit);
  out.P22 = { check: '無' };                        // 収納代行
  out.N26 = { check: '駐車場/ｺﾝﾃﾅ/ﾄﾗﾝｸ' };          // 保証プラン（事業用）
  out.AL16 = m_num_(data.rent);                     // ① 家賃（②〜⑥は空欄、合計は数式のまま）

  // ---- お申込者様ご記入欄 ----
  const b = m_dParts_(data.birth);
  out.E34 = data.kana || '';
  out.E35 = data.name || '';
  out.W34 = data.sex || '';
  out.Z34 = data.spouse || '';
  out.AC34 = data.nationality || '';
  if (data.housing) out.AG34 = { check: data.housing };
  out.AM34 = b ? (b.y + '年\n' + b.m + '月' + b.d + '日') : '';
  m_putZip_(out, ['F37', 'G37', 'H37'], ['J37', 'K37', 'L37', 'M37'], data.zip);
  const ha = m_splitAddr_(data.address);
  out.E38 = ha.pref;
  out.L38 = ha.rest;
  out.AI37 = m_tel_(data.mobile);
  out.AI39 = m_tel_(data.homeTel);

  out.E41 = data.workName || '';
  out.AB41 = data.workType || '';
  out.AI41 = m_tel_(data.workTel);
  const wa = m_splitAddr_(data.workAddr);
  out.E44 = wa.pref;
  out.L44 = wa.rest;
  out.AF43 = data.income ? (Number(data.income).toLocaleString('ja-JP') + '万円') : '万円';
  out.AM43 = m_tenure_(data) || '年　　ヵ月';

  // 雇用形態（該当する□のセルだけ☑にする）
  const EMPLOY_CELL = {
    '正社員': 'E46', '契約社員': 'L46', '派遣社員': 'S46', '学生': 'Z46', '年金': 'AG46',
    '個人事業主': 'E47', '無職(求職中含)': 'L47', '生活保護': 'S47',
    'パート/アルバイト': 'Z47', 'その他': 'AG47',
  };
  if (EMPLOY_CELL[data.employ]) out[EMPLOY_CELL[data.employ]] = '☑';

  // ---- 緊急連絡先 ----
  const eb = m_dParts_(data.emgBirth);
  out.E54 = data.emgKana || '';
  out.E55 = data.emgName || '';
  out.W54 = data.emgSex || '';
  out.AC54 = data.emgRel || '';
  if (data.emgHousing) out.AG54 = { check: data.emgHousing };
  out.AM54 = eb ? (eb.y + '年\n' + eb.m + '月' + eb.d + '日') : '';
  m_putZip_(out, ['F57', 'G57', 'H57'], ['J57', 'K57', 'L57', 'M57'], data.emgZip);
  const ea = m_splitAddr_(data.emgAddr);
  out.E58 = ea.pref;
  out.L58 = ea.rest;
  out.AI57 = m_tel_(data.emgTel);
  out.AI59 = m_tel_(data.emgHomeTel);

  // 連帯保証人欄は、保証会社による保証のため空欄のままにします
  return out;
}

/* ============================================================
 *  設定の点検（ブラウザで ?action=selftest を開くだけで確認できます）
 * ============================================================ */

/** 保存先・ひな形・マスターがそろっているかを順に確かめて、文章で返す */
function m_selfTest_() {
  const L = [];
  L.push('月極駐車場申込フォーム 設定点検');
  L.push('実行日時：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));
  L.push('====================================');

  // 1) 保存先フォルダ
  let parent = null;
  try {
    parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
    L.push('✅ 保存先フォルダ：' + parent.getName());
  } catch (err) {
    L.push('❌ 保存先フォルダを開けません（M_CONFIG.FOLDER_ID を確認してください）');
    L.push('   ' + String(err));
    return L.join('\n');
  }

  // 2) ひな形（ここでつまずくケースがいちばん多いので、詳しく出します）
  const tpl = [
    [M_CONFIG.TEMPLATE_PARK, [M_CONFIG.TEMPLATE_PARK_SHEET_KOJIN, M_CONFIG.TEMPLATE_PARK_SHEET_HOUJIN]],
    [M_CONFIG.TEMPLATE_NAP, [M_CONFIG.TEMPLATE_NAP_SHEET]],
  ];
  const tplFolder = m_getOrCreateSubfolder_(parent, M_CONFIG.TEMPLATE_SUBFOLDER);
  L.push('');
  L.push('■ ひな形フォルダ「' + M_CONFIG.TEMPLATE_SUBFOLDER + '」の中身');
  const it = tplFolder.getFiles();
  let any = false;
  while (it.hasNext()) {
    const f = it.next();
    const isSheet = f.getMimeType() === MimeType.GOOGLE_SHEETS;
    L.push('   ・' + f.getName() +
      (isSheet ? '　→ スプレッドシート（このまま使えます）'
               : '　→ エクセルのままです。開いて「ファイル」→「Google スプレッドシートとして保存」を実行してください'));
    any = true;
  }
  if (!any) {
    L.push('   （空です）');
    L.push('   ※ ここに2つのひな形を置いてください。MOUSHIKOMI_SETUP.md の「2.5」をご覧ください。');
  }

  L.push('');
  tpl.forEach(function (pair) {
    try {
      const f = m_findTemplate_(pair[0]);
      const ss = SpreadsheetApp.open(f);
      const names = ss.getSheets().map(function (sh) { return sh.getName(); });
      L.push('✅ ' + pair[0] + '：OK　シート＝「' + names.join('」「') + '」');
      pair[1].forEach(function (need) {
        if (!m_sheetByName_(ss, need)) {
          L.push('   ⚠ シート「' + need + '」が見つかりません');
        }
      });
    } catch (err) {
      L.push('❌ ' + pair[0] + '：' + (err && err.message ? err.message : String(err)));
    }
  });

  // 3) マスター
  L.push('');
  try {
    const items = getMaster_();
    L.push('✅ 月極駐車場マスター：' + items.length + '件');
    items.forEach(function (i) {
      L.push('   ・' + i.name + (i.plan ? '（' + i.plan + '）' : '') +
        '　賃料' + i.rent + '　' + i.depositLabel + i.deposit +
        (i.useGuarantor ? '　[保証会社あり]' : '') +
        (i.addr ? '' : '　※所在地が未入力'));
    });
  } catch (err) {
    L.push('❌ 月極駐車場マスター：' + String(err));
  }

  // 4) メール送信の残り回数
  L.push('');
  try {
    L.push('✅ 本日あと送信できるメール数：' + MailApp.getRemainingDailyQuota() + '通');
  } catch (err) {
    L.push('⚠ メール送信数を取得できません：' + String(err));
  }

  L.push('');
  L.push('❌ や ⚠ が出ている項目を直すと、フォームからの送信が通るようになります。');
  return L.join('\n');
}
