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
  LICENSE_NO: '広島県知事(3)第10326号',
  SENDER_NAME: '仁方大森マリーナー 駐車場申込フォーム',

  // 保存先サブフォルダ名（親フォルダ内に自動作成されます）
  APP_SUBFOLDER: '申込書',
  ID_SUBFOLDER: '本人確認書類',

  // スプレッドシート名
  LOG_SPREADSHEET_NAME: '駐車場申込受付一覧',
  MASTER_SPREADSHEET_NAME: '月極駐車場マスター',
};

/**
 * ============================================================
 * 駐車場マスターの初期値
 * ※ 初回だけこの内容でスプレッドシートが作られます。
 *    以後の賃料変更は「月極駐車場マスター」シートを直接編集してください
 *    （このコードを書き換える必要はありません）。
 * ============================================================
 */
const MASTER_HEADERS = [
  'ID', '駐車場名', 'プラン名', '月額賃料(税込)', '保証金区分', '保証金・敷金', '仲介手数料(税込)', '表示順', '有効',
];

const MASTER_DEFAULTS = [
  ['omori5',        '大森第5ビル駐車場',       '',            16000, '保証料', 16550, 0, 10, 'TRUE'],
  ['omori5-2f',     '大森第5ビル駐車場2F',     '',             8800, '保証料', 16550, 0, 20, 'TRUE'],
  ['kure-nishi',    '呉駅前西中央駐車場',       '',            18000, '敷金',   18000, 0, 30, 'TRUE'],
  ['sanjo4',        '三条4丁目大森駐車場',      '',            15000, '保証料', 15550, 0, 40, 'TRUE'],
  ['matsugaoka',    '松ヶ丘中谷ガレージ',       '',             5000, '保証料',  5550, 0, 50, 'TRUE'],
  ['eihome',        'エイホームビル駐車場',     '',            18000, '保証料', 18550, 0, 60, 'TRUE'],
  ['eihome-bike-a', 'エイホームビルバイクガレージ', '125cc以下',  2000, '保証料',  2550, 0, 70, 'TRUE'],
  ['eihome-bike-b', 'エイホームビルバイクガレージ', '125cc超え',  2500, '保証料',  3050, 0, 80, 'TRUE'],
  ['eihome-bike-c', 'エイホームビルバイクガレージ', '400cc超え',  3500, '保証料',  4050, 0, 90, 'TRUE'],
];

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
  return ContentService.createTextOutput('月極駐車場申込フォーム受付システムは稼働中です。');
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

    // 2) 申込書PDFを作成 → ドライブ保存
    const pdf = m_buildPdf_(data, receiptNo, now, dateStr + '_' + label + '.pdf');
    const appFolder = m_getOrCreateSubfolder_(parent, M_CONFIG.APP_SUBFOLDER);
    const file = appFolder.createFile(pdf);

    // 3) 受付一覧スプレッドシートに記録
    let sheetError = '';
    try {
      m_appendLog_(parent, data, receiptNo, now, file.getUrl(), idFolderUrl);
    } catch (err) {
      sheetError = String(err); // シート記録に失敗しても受付自体は成立させる
    }

    // 4) 管理者へ通知メール（PDF添付）
    m_sendNotifyMail_(data, receiptNo, now, file, idFolderUrl, sheetError);

    // 5) 申込者へ受付完了メール（メールアドレスがある場合のみ）
    if (data.email) {
      try {
        m_sendReceiptMail_(data, receiptNo, now);
      } catch (err) {
        // 自動返信の失敗は受付に影響させない
      }
    }

    return json_({ ok: true, receiptNo: receiptNo });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
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
  }
  return sheet;
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

/** 電話番号を全角→半角に直し、先頭の0が消えないよう整形 */
function m_tel_(v) {
  if (v === '' || v === null || v === undefined) return '';
  let s = String(v).trim()
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－ー―‐]/g, '-');
  if (/^\d{10,11}$/.test(s)) {
    if (/^0[789]0\d{8}$/.test(s)) return s.slice(0, 3) + '-' + s.slice(3, 7) + '-' + s.slice(7);   // 携帯
    if (/^0120\d{6}$/.test(s)) return '0120-' + s.slice(4, 7) + '-' + s.slice(7);
    if (/^0800\d{7}$/.test(s)) return '0800-' + s.slice(4, 7) + '-' + s.slice(7);
    if (s.length === 10) {
      // 固定電話：市外局番が分かるものだけ整形し、それ以外はそのまま返す
      if (/^0[36]/.test(s)) return s.slice(0, 2) + '-' + s.slice(2, 6) + '-' + s.slice(6);         // 東京・大阪
      if (/^082[0-9]/.test(s) && !/^082[019]/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6); // 呉(0823)など
      if (/^082/.test(s)) return s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6);           // 広島市(082)
    }
  }
  return s;
}

/** ファイル名に使えない文字を置き換え */
function m_safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim() || '未入力';
}

function m_esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** data URL (image/xxx;base64,....) を Blob に変換 */
function m_dataUrlToBlob_(dataUrl, filename) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[2]);
  return Utilities.newBlob(bytes, m[1], filename);
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
 *  申込書PDF（エクセル様式どおりに転記）
 * ============================================================ */

function m_pdfStyle_() {
  return '<style>' +
    'body{font-family:sans-serif;color:#111;font-size:11.5px;margin:20px;}' +
    'h1{font-size:19px;text-align:center;letter-spacing:5px;margin:2px 0 2px;font-weight:bold;}' +
    '.meta{text-align:right;font-size:10px;color:#444;line-height:1.6;}' +
    'table.form{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:8px;}' +
    'table.form th,table.form td{border:1px solid #333;padding:5px 6px;font-size:11px;' +
    '  vertical-align:middle;word-break:break-all;line-height:1.5;}' +
    'table.form th{background:#f1f1f1;font-weight:bold;text-align:center;}' +
    'table.form th.sec{background:#e2e2e2;font-size:11px;letter-spacing:2px;writing-mode:horizontal-tb;}' +
    'table.form th.lbl{text-align:left;}' +
    'table.form td{background:#fff;}' +
    'td.val{font-size:11.5px;}' +
    '.agree{margin-top:12px;font-size:11.5px;line-height:2.0;}' +
    '.agree .box{display:inline-block;border:1px solid #333;width:12px;height:12px;text-align:center;' +
    '  line-height:12px;font-size:10px;margin-right:6px;}' +
    '.sign{margin-top:14px;font-size:12px;line-height:2.2;}' +
    '.sign .row{margin-left:8px;}' +
    '.sign .name{display:inline-block;min-width:220px;border-bottom:1px solid #333;padding:0 6px 2px;}' +
    '.broker{margin-top:16px;font-size:11.5px;line-height:1.9;}' +
    '.foot{margin-top:14px;font-size:9.5px;color:#555;line-height:1.7;border-top:1px solid #ccc;padding-top:8px;}' +
    '.idpage{page-break-before:always;}' +
    '.idtitle{font-size:14px;font-weight:bold;margin:6px 0 10px;letter-spacing:2px;}' +
    '.idcard{margin-bottom:14px;}' +
    '.idcard .cap{font-size:11px;font-weight:bold;margin-bottom:4px;}' +
    '.idcard img{width:88%;border:1px solid #999;}' +
    '</style>';
}

/** 共通：駐車場ブロック（3行） */
function m_lotRows_(data) {
  const depLabel = data.depositLabel || '保証料';
  return '' +
    '<tr>' +
    '<th class="sec" rowspan="3">駐<br>車<br>場</th>' +
    '<th class="lbl" colspan="2">利用開始日</th>' +
    '<td class="val" colspan="9">' + m_esc_(m_dateJa_(data.startDate)) + '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="lbl" colspan="2">駐車場名</th>' +
    '<td class="val" colspan="5">' + m_esc_(m_lotLabel_(data)) + '</td>' +
    '<th>区画</th>' +
    '<td class="val" colspan="3">' + m_esc_(data.spot || '') + '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="lbl" colspan="2">月額賃料1台</th>' +
    '<td class="val" colspan="2">' + m_esc_(m_yen_(data.rent)) + '</td>' +
    '<th colspan="2">' + m_esc_(depLabel) + '</th>' +
    '<td class="val" colspan="2">' + m_esc_(m_yen_(data.deposit)) + '</td>' +
    '<th colspan="2">仲介手数料(税込)</th>' +
    '<td class="val">' + m_esc_(m_yen_(data.brokerFee)) + '</td>' +
    '</tr>';
}

/** 共通：緊急連絡先ブロック（3行） */
function m_emgRows_(data) {
  return '' +
    '<tr>' +
    '<th class="sec" rowspan="3">緊急<br>連絡先</th>' +
    '<th class="lbl" colspan="2">氏　名</th>' +
    '<td class="val" colspan="3">' + m_esc_(data.emgName || '') +
    (data.emgKana ? '<br><span style="font-size:9.5px;color:#555">' + m_esc_(data.emgKana) + '</span>' : '') + '</td>' +
    '<th>続柄</th>' +
    '<td class="val">' + m_esc_(data.emgRel || '') + '</td>' +
    '<th>生年月日</th>' +
    '<td class="val" colspan="3">' + m_esc_(m_dateJa_(data.emgBirth)) + '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="lbl" colspan="2">住　所</th>' +
    '<td class="val" colspan="9">' + m_esc_(m_addr_(data.emgZip, data.emgAddr)) + '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="lbl" colspan="2">連絡先電話</th>' +
    '<td class="val" colspan="3">' + m_esc_(m_tel_(data.emgTel)) + '</td>' +
    '<th colspan="2">勤務先名</th>' +
    '<td class="val" colspan="4">' + m_esc_(data.emgWork || '') + '</td>' +
    '</tr>';
}

/** 共通：利用車両ブロック（2行） */
function m_carRows_(data) {
  return '' +
    '<tr>' +
    '<th class="sec" rowspan="2">利用<br>車両</th>' +
    '<th class="lbl" colspan="2">メーカー</th>' +
    '<td class="val" colspan="3">' + m_esc_(data.carMaker || '') + '</td>' +
    '<th>車　種</th>' +
    '<td class="val" colspan="3">' + m_esc_(data.carModel || '') + '</td>' +
    '<th>色</th>' +
    '<td class="val">' + m_esc_(data.carColor || '') + '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="lbl" colspan="2">登録ナンバー</th>' +
    '<td class="val" colspan="9">' + m_esc_(data.carNumber || '') + '</td>' +
    '</tr>';
}

/** 個人：申込人ブロック（7行） */
function m_kojinRows_(data) {
  return '' +
    '<tr>' +
    '<th class="sec" rowspan="7">申<br>込<br>人</th>' +
    '<th class="lbl" colspan="2">フリガナ</th>' +
    '<td class="val" colspan="9">' + m_esc_(data.kana || '') + '</td>' +
    '</tr>' +
    '<tr><th class="lbl" colspan="2">氏　名</th>' +
    '<td class="val" colspan="9" style="font-size:13px;font-weight:bold">' + m_esc_(data.name || '') + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">生年月日</th>' +
    '<td class="val" colspan="9">' + m_esc_(m_dateJa_(data.birth)) + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">住　所</th>' +
    '<td class="val" colspan="9">' + m_esc_(m_addr_(data.zip, data.address)) + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">連絡先</th>' +
    '<th>携帯</th><td class="val" colspan="3">' + m_esc_(m_tel_(data.mobile)) + '</td>' +
    '<th>メール</th><td class="val" colspan="4">' + m_esc_(data.email || '') + '</td></tr>' +
    '<tr><th class="lbl" colspan="2" rowspan="2">勤務先</th>' +
    '<th>名称</th><td class="val" colspan="3">' + m_esc_(data.workName || '') + '</td>' +
    '<th>電話</th><td class="val" colspan="4">' + m_esc_(m_tel_(data.workTel)) + '</td></tr>' +
    '<tr><th>所在地</th><td class="val" colspan="8">' + m_esc_(data.workAddr || '') + '</td></tr>';
}

/** 法人：申込法人ブロック（8行） */
function m_houjinRows_(data) {
  return '' +
    '<tr>' +
    '<th class="sec" rowspan="8">申<br>込<br>法<br>人</th>' +
    '<th class="lbl" colspan="2">フリガナ</th>' +
    '<td class="val" colspan="9">' + m_esc_(data.corpKana || '') + '</td>' +
    '</tr>' +
    '<tr><th class="lbl" colspan="2">法人名</th>' +
    '<td class="val" colspan="9" style="font-size:13px;font-weight:bold">' + m_esc_(data.corpName || '') + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">所在地</th>' +
    '<td class="val" colspan="9">' + m_esc_(m_addr_(data.corpZip, data.corpAddr)) + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">フリガナ</th>' +
    '<td class="val" colspan="4">' + m_esc_(data.repKana || '') + '</td>' +
    '<th>フリガナ</th><td class="val" colspan="4">' + m_esc_(data.staffKana || '') + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">代表者様名</th>' +
    '<td class="val" colspan="4">' + m_esc_(data.repName || '') + '</td>' +
    '<th>担当者様名</th><td class="val" colspan="4">' + m_esc_(data.staffName || '') + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">法人連絡先</th>' +
    '<th>TEL</th><td class="val" colspan="3">' + m_esc_(m_tel_(data.corpTel)) + '</td>' +
    '<th>FAX</th><td class="val" colspan="4">' + m_esc_(m_tel_(data.corpFax)) + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">担当者様連絡先</th>' +
    '<th>携帯</th><td class="val" colspan="3">' + m_esc_(m_tel_(data.staffMobile)) + '</td>' +
    '<th>部署TEL</th><td class="val" colspan="4">' + m_esc_(m_tel_(data.staffDeptTel)) + '</td></tr>' +
    '<tr><th class="lbl" colspan="2">メール</th>' +
    '<td class="val" colspan="9">' + m_esc_(data.email || '') + '</td></tr>';
}

/** 免許証ページ（画像がある場合のみ） */
function m_idPage_(data) {
  if (!data.licFront && !data.licBack) return '';
  let html = '<div class="idpage"><div class="idtitle">本人確認書類（運転免許証）</div>';
  if (data.licFront) {
    html += '<div class="idcard"><div class="cap">表面</div><img src="' + data.licFront + '"></div>';
  }
  if (data.licBack) {
    html += '<div class="idcard"><div class="cap">裏面</div><img src="' + data.licBack + '"></div>';
  }
  html += '<div class="foot">本画像は申込者本人がフォームからアップロードしたものです。' +
    '本人確認以外の目的には使用しません。</div></div>';
  return html;
}

/** 申込書PDFの作成 */
function m_buildPdf_(data, receiptNo, now, fileName) {
  const isCorp = data.kind === 'houjin';
  const title = isCorp ? '月 極 駐 車 場 利 用 申 込 書（法 人）' : '月 極 駐 車 場 利 用 申 込 書（個 人）';
  const applicantLabel = isCorp ? '申込法人名' : '申込人氏名';
  const applicant = isCorp ? (data.corpName || '') : (data.name || '');
  const applyDate = data.applyDate ? m_dateJa_(data.applyDate)
    : Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日');

  // 先頭1列＝区分（駐車場／申込人 等）、残り11列＝項目・値の共通グリッド
  const cols = '<colgroup><col style="width:7%">' +
    new Array(12).join('<col style="width:8.45%">') +
    '</colgroup>';

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' + m_pdfStyle_() + '</head><body>' +
    '<div class="meta">受付番号：' + m_esc_(receiptNo) + '<br>' +
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm') + '</div>' +
    '<h1>' + m_esc_(title) + '</h1>' +
    '<table class="form">' + cols +
    m_lotRows_(data) +
    (isCorp ? m_houjinRows_(data) : m_kojinRows_(data)) +
    m_emgRows_(data) +
    m_carRows_(data) +
    (data.note ?
      '<tr><th class="sec">備考</th><th class="lbl" colspan="2">ご要望等</th>' +
      '<td class="val" colspan="9">' + m_esc_(data.note) + '</td></tr>' : '') +
    '</table>' +

    '<div class="agree">' +
    '<div><span class="box">' + (data.agreePrivacy ? '✓' : '') + '</span>' +
    '個人情報の第三者機関への提供について同意' + (isCorp ? '致します。' : 'します。') + '</div>' +
    '<div><span class="box">' + (data.agreeTruth ? '✓' : '') + '</span>' +
    '上記記載事項に相違なく申し込みをいたします。</div>' +
    '</div>' +

    '<div class="sign">' +
    '<div class="row">' + m_esc_(applyDate) + '</div>' +
    '<div class="row">' + applicantLabel + '　<span class="name">' + m_esc_(applicant) + '</span></div>' +
    '</div>' +

    '<div class="broker">' +
    '媒介業者名：' + m_esc_(M_CONFIG.COMPANY_SHORT) + '<br>' +
    '免許番号：' + m_esc_(M_CONFIG.LICENSE_NO) +
    '</div>' +

    '<div class="foot">' +
    '本書は、申込者がWebフォーム（月極駐車場利用申込フォーム）に入力・送信した内容をもとに自動作成されたものです。<br>' +
    '申込者は送信時に上記各項目へ同意しており、フォームの送信をもって記名押印に代えるものとして取り扱います。<br>' +
    m_esc_(M_CONFIG.COMPANY) + '　TEL：' + m_esc_(M_CONFIG.COMPANY_TEL) +
    '</div>' +

    m_idPage_(data) +
    '</body></html>';

  return Utilities.newBlob(html, MimeType.HTML, fileName)
    .getAs(MimeType.PDF)
    .setName(fileName);
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
  '免許証', '個人情報同意', '記載事項同意', '備考', '申込書PDF', '本人確認書類フォルダ',
];

function m_appendLog_(parent, data, receiptNo, now, pdfUrl, idFolderUrl) {
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
    pdfUrl, idFolderUrl || '',
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
  if (data.note) rows.push(['備考', data.note]);
  return rows.filter(function (r) { return String(r[1]).trim() !== ''; });
}

/** 管理者への通知メール */
function m_sendNotifyMail_(data, receiptNo, now, file, idFolderUrl, sheetError) {
  const isCorp = data.kind === 'houjin';
  const applicant = isCorp ? data.corpName : data.name;
  const subject = '【駐車場申込】' + m_lotLabel_(data) + ' ' + (data.spot || '') +
    '（' + applicant + (isCorp ? ' 御中' : ' 様') + '）';

  const lines = m_buildRows_(data).map(function (r) { return '■' + r[0] + '：' + r[1]; }).join('\n');

  const body =
    '月極駐車場の利用申込を受け付けました。\n\n' +
    '受付番号：' + receiptNo + '\n' +
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '\n' +
    '------------------------------------------\n' +
    lines + '\n' +
    '------------------------------------------\n\n' +
    '▼申込書PDF（ドライブに保存済み）\n' + file.getUrl() + '\n' +
    (idFolderUrl ? '\n▼運転免許証（表・裏）\n' + idFolderUrl + '\n' : '\n※運転免許証の画像は添付されていません。\n') +
    (sheetError ? '\n※受付一覧への記録に失敗しました：' + sheetError + '\n' : '') +
    '\n' + M_CONFIG.COMPANY + '\n';

  MailApp.sendEmail({
    to: M_CONFIG.NOTIFY_EMAIL,
    subject: subject,
    body: body,
    attachments: [file.getAs(MimeType.PDF)],
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

  const lot = master[0] || { name: 'テスト駐車場', plan: '', rent: 16000, depositLabel: '保証料', deposit: 16550, brokerFee: 0 };
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
  };

  const receiptNo = 'TEST' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const fileName = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_テスト申込書.pdf';
  const pdf = m_buildPdf_(data, receiptNo, now, fileName);
  const file = m_getOrCreateSubfolder_(parent, M_CONFIG.APP_SUBFOLDER).createFile(pdf);
  Logger.log('テストPDF：' + file.getUrl());

  m_appendLog_(parent, data, receiptNo, now, file.getUrl(), '');
  m_sendNotifyMail_(data, receiptNo, now, file, '', '');
  Logger.log('テスト通知メールを ' + M_CONFIG.NOTIFY_EMAIL + ' へ送信しました。');
}
