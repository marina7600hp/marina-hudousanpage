/**
 * ============================================================
 * 解約通知フォーム バックエンド（Google Apps Script）
 * 有限会社仁方大森マリーナー
 *
 * 役割：
 *  1. kaiyaku.html から送信された解約通知を受け付ける
 *  2. 解約通知書PDFを作成し、指定のGoogleドライブフォルダに保存
 *     （フォルダ内に「管理物件」「月極駐車場」サブフォルダを自動作成）
 *  3. 管理者（NOTIFY_EMAIL）へ通知メールを送信（PDF添付）
 *  4. 入居者がメールアドレスを入力していれば受付完了メールを自動返信
 *  5. フォルダ内のスプレッドシート「解約通知受付一覧」に記録
 *
 * セットアップ手順は リポジトリの KAIYAKU_SETUP.md を参照してください。
 * ============================================================
 */

const CONFIG = {
  // 通知メールの宛先
  NOTIFY_EMAIL: 'marina.oomori1@gmail.com',
  // 解約通知書PDFを保存するGoogleドライブのフォルダID
  // https://drive.google.com/drive/folders/12oWf9kT9Iozl8DOWpTmnvbUKO4iPS_Nw
  FOLDER_ID: '12oWf9kT9Iozl8DOWpTmnvbUKO4iPS_Nw',
  COMPANY: '有限会社仁方大森マリーナー',
  COMPANY_TEL: '0823-27-7600',
  LOG_SPREADSHEET_NAME: '解約通知受付一覧',
  // 解約通知書PDFを入れるサブフォルダ名（管理物件／月極駐車場 の各フォルダ内に作成）
  NOTICE_SUBFOLDER: '解約通知書',
  SENDER_NAME: '仁方大森マリーナー 解約通知フォーム',
};

/** 退去時の注意事項（管理物件のみ・PDFに記載され、契約者はフォームで同意済み） */
const KANRI_TERMS = [
  '立会日は荷物が無い状態で行います。',
  '退去に伴い出るゴミ等は外に放置せず、責任を持って処分して下さい。残存物とみなし撤去費用を頂戴する場合があります。',
  '設備品の取扱説明書ファイルは立会日にご返却お願い致します。',
  '入居キーは貸主が処分致しますので複製した入居キーもご返却をお願い致します。',
  '退去月の賃料は月割り計算と致します。',
  '入居期間に関わらず貸主が指定した清掃業者による清掃を借主負担により必須で行います。',
  '特殊清掃が必要な場合は別途費用を請求致します。',
  'その他、契約事項に従い原状回復費用の借主負担部分を借主が負担致します。クロス張替え1,900円/㎡（税別）と致します。残材処理費は処理費用により借主負担分を請求致します。',
];

/** 動作確認用（ブラウザでウェブアプリURLを開くと表示される） */
function doGet() {
  return ContentService.createTextOutput('解約通知フォーム受付システムは稼働中です。');
}

/** フォームからのPOST受付 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ハニーポット（スパム対策）：非表示欄に入力があれば黙って成功を返す
    if (data.website) {
      return json_({ ok: true, receiptNo: '-' });
    }

    // 必須項目チェック
    if (!data.name || !data.tel || !data.bukken || !data.room || !data.endDate) {
      return json_({ ok: false, error: '必須項目が不足しています。' });
    }

    const isParking = data.type === 'parking';
    const now = new Date();
    const receiptNo = (isParking ? 'P' : 'K') + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');

    // 1) PDF作成 → ドライブ保存
    const pdf = buildPdf_(data, receiptNo, now);
    const parent = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    // 「管理物件（または月極駐車場）」→「解約通知書」フォルダに保存
    const kindFolder = getOrCreateSubfolder_(parent, isParking ? '月極駐車場' : '管理物件');
    const sub = getOrCreateSubfolder_(kindFolder, CONFIG.NOTICE_SUBFOLDER);
    const file = sub.createFile(pdf);

    // 2) 受付一覧スプレッドシートに記録
    let sheetError = '';
    try {
      appendLog_(parent, data, receiptNo, now, file.getUrl());
    } catch (err) {
      sheetError = String(err); // シート記録失敗でも受付自体は成立させる
    }

    // 3) 管理者へ通知メール（PDF添付）
    sendNotifyMail_(data, receiptNo, now, file, sheetError);

    // 4) 入居者へ受付完了メール（メールアドレスがある場合のみ）
    if (data.email) {
      try {
        sendReceiptMail_(data, receiptNo, now);
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

/** サブフォルダを取得（なければ作成） */
function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 金額の整形 */
function fmtYen_(n) {
  return Number(n).toLocaleString('ja-JP') + '円（税込）';
}

/** yyyy-mm-dd → yyyy年M月d日 */
function fmtDateJa_(s) {
  if (!s) return '';
  const p = String(s).split('-');
  if (p.length !== 3) return s;
  return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
}

/** 電話番号を整形
 *  ・先頭0が失われている場合は復元（スプレッドシートで数値化されたケース）
 *  ・携帯／IP／フリーダイヤルはハイフン区切りに整形
 *  ・固定電話は市外局番の桁数が地域で異なり自動判別できないため、入力のまま
 */
function formatTel_(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // 全角数字・全角ハイフンを半角へ
  s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
       .replace(/[－ー―‐]/g, '-');
  const d = s.replace(/[^0-9]/g, '');
  if (!d) return s;
  // 先頭0の復元（9〜10桁で0始まりでない＝数値化で欠落したとみなす）
  const num = (/^[0-9]{9,10}$/.test(d) && d.charAt(0) !== '0') ? '0' + d : d;
  // 携帯・IP電話（11桁）
  if (/^(070|080|090|050)\d{8}$/.test(num)) return num.slice(0, 3) + '-' + num.slice(3, 7) + '-' + num.slice(7);
  // フリーダイヤル
  if (/^0120\d{6}$/.test(num)) return '0120-' + num.slice(4, 7) + '-' + num.slice(7);
  if (/^0800\d{7}$/.test(num)) return '0800-' + num.slice(4, 7) + '-' + num.slice(7);
  // 固定電話：ハイフン入力済みならそのまま、未入力なら先頭0を復元した数字を返す
  return /-/.test(s) ? s : num;
}

// ================= LINE通知 =================
// トークン・送信先は「プロジェクトの設定 → スクリプト プロパティ」に登録します。
//   LINE_CHANNEL_ACCESS_TOKEN … チャネルアクセストークン
//   LINE_STAFF_TO             … 通知先のグループID
// どちらも未設定なら、LINE通知は行いません（メール通知のみ）。
function lineProp_(key) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return v ? v.trim() : '';
  } catch (e) { return ''; }
}

/** LINEへ通知（未設定なら何もしない） */
function lineSend_(text) {
  const token = lineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const to = lineProp_('LINE_STAFF_TO');
  if (!token || !to || !text) return false;
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) Logger.log('LINE送信エラー：' + res.getContentText());
    return res.getResponseCode() === 200;
  } catch (e) {
    Logger.log('LINE送信例外：' + e);
    return false;
  }
}

/** LINE通知のテスト（設定後に実行して届くか確認） */
function testLine() {
  if (!lineProp_('LINE_CHANNEL_ACCESS_TOKEN')) { Logger.log('LINE_CHANNEL_ACCESS_TOKEN が未設定です。'); return; }
  if (!lineProp_('LINE_STAFF_TO')) { Logger.log('LINE_STAFF_TO（通知先グループID）が未設定です。'); return; }
  Logger.log(lineSend_('【テスト送信】解約通知フォームからのLINE通知です。') ? '送信しました。' : '送信に失敗しました。');
}

/** ファイル名に使えない文字を除去 */
function safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim();
}

/** 銀行口座の1行表記 */
function bankLine_(bank) {
  if (!bank) return '';
  return [bank.name, bank.branch, bank.type, bank.number, bank.holder].filter(String).join(' ');
}

/** エアコン洗浄代の1行表記（例：通常12,100円×2台／お掃除機能付き19,800円×1台） */
function acLine_(data) {
  const parts = [];
  if (Number(data.acNormal) > 0) {
    parts.push('通常' + Number(data.acNormalUnit || 12100).toLocaleString('ja-JP') + '円×' + Number(data.acNormal) + '台');
  }
  if (Number(data.acAuto) > 0) {
    parts.push('お掃除機能付き' + Number(data.acAutoUnit || 19800).toLocaleString('ja-JP') + '円×' + Number(data.acAuto) + '台');
  }
  return parts.join('／');
}

/** 通知内容を [ラベル, 値] の配列にまとめる（PDF・メール共用） */
function buildRows_(data, isParking) {
  const rows = [
    ['ご契約者名', data.name + (data.kana ? '（' + data.kana + '）' : '')],
    ['お電話番号', formatTel_(data.tel)],
    ['メールアドレス', data.email || '（未入力）'],
    [isParking ? '駐車場名' : '物件名', data.bukken],
    ['貸主', data.owner || ''],
    [isParking ? '区画番号' : '部屋番号', data.room],
    [isParking ? '解約日（利用終了日）' : '解約日（退去予定日）', fmtDateJa_(data.endDate)],
  ];
  if (!isParking) {
    rows.push(['退去時室内清掃代', data.fee ? fmtYen_(data.fee) : '別途ご案内']);
    const ac = acLine_(data);
    if (ac) rows.push(['エアコン洗浄代', ac]);
    if (data.feeTotal) {
      rows.push(['清掃代等 合計', fmtYen_(data.feeTotal) + (data.fee ? '' : '（室内清掃代 別途）')]);
    }
    rows.push(['清掃代への承諾', data.agreeCleaning ? '承諾済み' : '（金額別途案内）']);
    if (data.tachiai) rows.push(['退去立会い希望日時', data.tachiai]);
    if (data.newAddress) rows.push(['転居先住所', data.newAddress]);
  }
  if (data.reason) rows.push(['解約理由', data.reason]);
  if (data.car) rows.push(['ご契約車両', [data.car.model, data.car.number].filter(String).join(' ')]);
  if (data.bank) rows.push(['返金先口座', bankLine_(data.bank)]);
  if (data.note) rows.push(['備考', data.note]);
  if (!isParking) rows.push(['退去時注意事項', data.agreeTerms ? '同意済み' : '－']);
  rows.push(['個人情報の取扱い', data.agreePrivacy ? '同意済み' : '－']);
  rows.push(['書面による通知の代替', data.agreeWritten ? '同意済み（本フォームを書面による解約通知と同等として取り扱う）' : '－']);
  return rows;
}

/** HTMLエスケープ */
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 解約通知書PDFの作成 */
function buildPdf_(data, receiptNo, now) {
  const isParking = data.type === 'parking';
  const title = isParking ? '解約通知書（月極駐車場）' : '解約通知書（賃貸物件）';
  const rows = buildRows_(data, isParking);

  const trs = rows.map(function (r) {
    return '<tr><th>' + esc_(r[0]) + '</th><td>' + esc_(r[1]) + '</td></tr>';
  }).join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:sans-serif;color:#111;font-size:12px;margin:24px;}' +
    'h1{font-size:20px;text-align:center;letter-spacing:6px;margin:8px 0 4px;}' +
    '.sub{text-align:center;font-size:11px;color:#555;margin-bottom:18px;}' +
    '.meta{text-align:right;font-size:11px;color:#333;margin-bottom:4px;}' +
    '.to{font-size:13px;margin:14px 0 6px;}' +
    '.lead{font-size:12px;margin:6px 0 14px;}' +
    'table{width:100%;border-collapse:collapse;}' +
    'th,td{border:1px solid #666;padding:7px 10px;font-size:12px;vertical-align:top;}' +
    'th{background:#f0f0f0;width:32%;text-align:left;font-weight:bold;}' +
    '.terms{margin-top:14px;}' +
    '.terms-title{font-weight:bold;font-size:12px;margin-bottom:4px;}' +
    '.terms ul{margin:0;padding-left:18px;}' +
    '.terms li{font-size:10.5px;line-height:1.7;}' +
    '.foot{margin-top:18px;font-size:10.5px;color:#555;line-height:1.6;}' +
    '</style></head><body>' +
    '<div class="meta">受付番号：' + esc_(receiptNo) + '</div>' +
    '<div class="meta">通知日（受付日時）：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm') + '</div>' +
    '<h1>解約通知書</h1>' +
    '<div class="sub">' + esc_(title) + '</div>' +
    '<div class="to">貸主様<br>' + esc_(data.owner || CONFIG.COMPANY) + ' 御中</div>' +
    '<div class="lead">私は、下記のとおり賃貸借契約を解約することを通知いたします。<br>' +
    '本通知は、契約書に「解約は書面により通知する」旨の定めがある場合においても、当該書面による解約通知に代わるものとして、' +
    '借主（契約者）の同意のもと電磁的方法（Webフォーム）により行ったものであり、本書（電磁的記録）を書面による解約通知と同等のものとして取り扱います。</div>' +
    '<table>' + trs + '</table>' +
    (isParking ? '' :
      '<div class="terms"><div class="terms-title">退去時の注意事項（契約者同意済み）</div><ul>' +
      KANRI_TERMS.map(function (t) { return '<li>' + esc_(t) + '</li>'; }).join('') +
      '</ul></div>') +
    '<div class="foot">' +
    '本書は、契約者がWebフォーム（解約通知フォーム）に入力・送信した内容をもとに自動作成されたものです。<br>' +
    'フォーム送信をもって解約通知の受付が完了しています。<br>' +
    esc_(CONFIG.COMPANY) + '　TEL：' + esc_(CONFIG.COMPANY_TEL) +
    '</div>' +
    '</body></html>';

  // ファイル名：受付年月日_物件名_号室_名前
  const fileName = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.name) + '.pdf';

  return Utilities.newBlob(html, MimeType.HTML, fileName)
    .getAs(MimeType.PDF)
    .setName(fileName);
}

/** 受付一覧スプレッドシートに追記（フォルダ内に自動作成） */
function appendLog_(parent, data, receiptNo, now, pdfUrl) {
  const isParking = data.type === 'parking';
  let ss;
  const it = parent.getFilesByName(CONFIG.LOG_SPREADSHEET_NAME);
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(CONFIG.LOG_SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(parent);
  }
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '受付日時', '受付番号', '種別', '物件名/駐車場名', '部屋/区画', '契約者名', 'フリガナ',
      '電話番号', 'メール', '解約日', '室内清掃代', 'エアコン洗浄代', '清掃代等合計',
      '解約理由', '立会い希望', '転居先', '返金先口座', '車両', '備考',
      '個人情報同意', '注意事項同意', '書面通知同意', 'PDFリンク', '貸主',
    ]);
    sheet.setFrozenRows(1);
  }
  // 電話番号・部屋番号は数値化されると先頭の0が消えるため、列の書式をテキストにしておく
  try {
    sheet.getRange(1, 5, sheet.getMaxRows(), 1).setNumberFormat('@'); // 部屋/区画
    sheet.getRange(1, 8, sheet.getMaxRows(), 1).setNumberFormat('@'); // 電話番号
  } catch (e) {}
  sheet.appendRow([
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    receiptNo,
    isParking ? '月極駐車場' : '管理物件',
    data.bukken, String(data.room), data.name, data.kana || '',
    formatTel_(data.tel), data.email || '', fmtDateJa_(data.endDate),
    !isParking && data.fee ? Number(data.fee) : '',
    !isParking ? acLine_(data) : '',
    !isParking && data.feeTotal ? Number(data.feeTotal) : '',
    data.reason || '', data.tachiai || '', data.newAddress || '',
    bankLine_(data.bank),
    data.car ? [data.car.model, data.car.number].filter(String).join(' ') : '',
    data.note || '',
    data.agreePrivacy ? '同意' : '',
    !isParking ? (data.agreeTerms ? '同意' : '') : '',
    data.agreeWritten ? '同意' : '',
    pdfUrl,
    data.owner || '',
  ]);
}

/** 管理者への通知メール */
function sendNotifyMail_(data, receiptNo, now, file, sheetError) {
  const isParking = data.type === 'parking';
  const kind = isParking ? '月極駐車場' : '管理物件';
  const subject = '【解約通知受付/' + kind + '】' + data.bukken + ' ' + data.room + '（' + data.name + '様）';

  const rows = buildRows_(data, isParking);
  const lines = rows.map(function (r) { return '■' + r[0] + '：' + r[1]; }).join('\n');

  const body =
    '解約通知フォームから新しい解約通知を受け付けました。\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '受付番号：' + receiptNo + '\n' +
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '\n' +
    '種別　　：' + kind + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    lines + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '▼解約通知書PDF（ドライブ保存済み）\n' + file.getUrl() + '\n' +
    (sheetError ? '\n※受付一覧シートへの記録に失敗しました：' + sheetError + '\n' : '');

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: subject,
    body: body,
    attachments: [file.getBlob()],
    name: CONFIG.SENDER_NAME,
  });

  // メール通知と連動してLINEにも通知（未設定なら何もしません）
  const isParking2 = data.type === 'parking';
  lineSend_(
    '【解約通知を受付】' + kind + '\n' +
    data.bukken + ' ' + data.room + '（' + data.name + '様）\n' +
    '解約日：' + fmtDateJa_(data.endDate) + '\n' +
    (data.owner ? '貸主：' + data.owner + '\n' : '') +
    (!isParking2 && data.feeTotal ? '清掃代等 合計：' + fmtYen_(data.feeTotal) + '\n' : '') +
    (data.tachiai ? '立会い希望：' + data.tachiai + '\n' : '') +
    '受付番号：' + receiptNo + '\n' +
    '解約通知書：' + file.getUrl()
  );
}

/** 入居者への受付完了メール（自動返信） */
function sendReceiptMail_(data, receiptNo, now) {
  const isParking = data.type === 'parking';
  const subject = '【受付完了】解約通知を受け付けました（受付番号：' + receiptNo + '）';
  const totalFee = !isParking ? Number(data.feeTotal || data.fee || 0) : 0;
  const feeLine = totalFee
    ? '退去時清掃代等：' + fmtYen_(totalFee) + (data.fee ? '' : '（室内清掃代 別途）') + '\n'
    : '';

  const body =
    data.name + ' 様\n\n' +
    'この度は解約のご連絡をいただきありがとうございます。\n' +
    '下記のとおり解約通知を受け付けました。本メールをもちまして解約通知のお手続きは完了です。\n' +
    '本通知は、ご同意のとおり契約書に定める「書面による解約通知」に代わるものとしてお取り扱いいたします。\n' +
    '内容確認のうえ、担当者よりご連絡いたします。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '受付番号　　　：' + receiptNo + '\n' +
    '受付日時　　　：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + '\n' +
    (isParking ? '駐車場名' : '物件名') + '　　　：' + data.bukken + '　' + data.room + '\n' +
    '解約日　　　　：' + fmtDateJa_(data.endDate) + '\n' +
    feeLine +
    '━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    'ご不明な点は下記までお問い合わせください。\n' +
    CONFIG.COMPANY + '\n' +
    'TEL：' + CONFIG.COMPANY_TEL + '\n';

  MailApp.sendEmail({
    to: data.email,
    subject: subject,
    body: body,
    name: CONFIG.SENDER_NAME,
  });
}

/**
 * ============================================================
 * 【既存データの修復】受付一覧の電話番号を直す
 *
 * すでに保存済みの行で、先頭の「0」が消えてしまった電話番号
 * （例：9043549597）を「09043549597」に戻し、
 * 携帯番号などはハイフン区切りに整形します。
 * 部屋番号の先頭0も同様に文字列へ戻します。
 *
 * 使い方：エディタで関数「fixTelColumn」を選んで「実行」するだけ。
 * 何度実行しても問題ありません。
 * ============================================================
 */
function fixTelColumn() {
  const parent = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = parent.getFilesByName(CONFIG.LOG_SPREADSHEET_NAME);
  if (!it.hasNext()) { Logger.log('受付一覧が見つかりませんでした。'); return; }
  const sheet = SpreadsheetApp.open(it.next()).getSheets()[0];
  const last = sheet.getLastRow();
  if (last < 2) { Logger.log('データ行がありません。'); return; }

  // 列をテキスト書式にしてから書き戻す（再び数値化されるのを防ぐ）
  const telRange = sheet.getRange(2, 8, last - 1, 1);   // H列：電話番号
  const roomRange = sheet.getRange(2, 5, last - 1, 1);  // E列：部屋/区画
  telRange.setNumberFormat('@');
  roomRange.setNumberFormat('@');

  const tels = telRange.getValues();
  const rooms = roomRange.getValues();
  let fixedTel = 0, fixedRoom = 0;

  for (let i = 0; i < tels.length; i++) {
    const before = String(tels[i][0] == null ? '' : tels[i][0]);
    if (!before) continue;
    const after = formatTel_(before);
    if (after !== before) { fixedTel++; Logger.log('電話番号 ' + before + ' → ' + after); }
    tels[i][0] = after;
  }
  for (let i = 0; i < rooms.length; i++) {
    const v = rooms[i][0];
    if (v === '' || v == null) continue;
    // 数値として保存されている部屋番号を文字列へ（先頭0の欠落があれば元に戻せないが型は揃える）
    if (typeof v === 'number') { fixedRoom++; rooms[i][0] = String(v); }
  }
  telRange.setValues(tels);
  roomRange.setValues(rooms);
  Logger.log('完了：電話番号 ' + fixedTel + '件、部屋番号 ' + fixedRoom + '件を修正しました。');
}

/**
 * ============================================================
 * 動作テスト用：エディタ上でこの関数を実行すると、
 * ドライブフォルダへのアクセス確認・テストPDF作成・テストメール送信を行います。
 * 初回実行時に権限の承認画面が表示されるので「許可」してください。
 * ============================================================
 */
function testSetup() {
  const sample = {
    type: 'kanri',
    fee: 33000,
    acNormal: 2,
    acAuto: 1,
    acNormalUnit: 12100,
    acAutoUnit: 19800,
    feeTotal: 33000 + 12100 * 2 + 19800 * 1,
    name: 'テスト 太郎',
    kana: 'テスト タロウ',
    tel: '090-0000-0000',
    email: '',
    bukken: 'テストハイツ',
    room: '101',
    endDate: '2026-08-31',
    tachiai: '第1候補：2026年8月30日 10:00　／　第2候補：2026年8月30日 14:00',
    reason: '住み替え',
    newAddress: '呉市テスト町1-2-3',
    bank: { name: 'テスト銀行', branch: 'テスト支店', type: '普通', number: '1234567', holder: 'テスト タロウ' },
    car: null,
    note: 'これはテスト送信です。',
    agreeCleaning: true,
    agreeTerms: true,
    agreePrivacy: true,
    agreeWritten: true,
  };
  const now = new Date();
  const receiptNo = 'TEST' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const pdf = buildPdf_(sample, receiptNo, now);
  const parent = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const sub = getOrCreateSubfolder_(getOrCreateSubfolder_(parent, '管理物件'), CONFIG.NOTICE_SUBFOLDER);
  const file = sub.createFile(pdf);
  appendLog_(parent, sample, receiptNo, now, file.getUrl());
  sendNotifyMail_(sample, receiptNo, now, file, '');
  Logger.log('テスト完了。PDF: ' + file.getUrl());
}
