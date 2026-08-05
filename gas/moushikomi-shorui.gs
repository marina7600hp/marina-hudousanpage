/**
 * ============================================================
 * 契約書類の自動作成（Google Apps Script）
 * 有限会社仁方大森マリーナー
 *
 * moushikomi.gs と同じGASプロジェクトに配置してください。
 *
 * 役割：
 *  1. 「物件マスター」スプレッドシートで、物件ごとの条件・費用・
 *     賃貸借契約書の雛形（Googleドキュメント）を登録・管理する
 *  2. 申込を受け付けたときに、見積書を作成する
 *  3. 保証会社の審査に通過したあと、管理コンソールから次の書類を作成する
 *       ① 重要事項説明書（物件ごとの雛形から差込）
 *       ② 賃貸借契約書（物件ごとの雛形から差込。紙でのやりとり用にPDF出力）
 *       ③ 見積書・請求書
 *       ④ 鍵受領書（実際の鍵の写真つき）
 *
 * 書類の体裁について：
 *  契約書類は位置ずれ・改行ずれ・文字化けを避けるため、
 *  Googleドキュメントの雛形から差し込んでPDF化する方式を標準とします。
 *  雛形が未登録の書類は、内蔵の標準レイアウト（HTML→PDF）で作成しますが、
 *  これは雛形をご用意いただくまでの仮の出力です。
 *
 * 賃貸借契約書の雛形について：
 *  ・物件ごとに Googleドキュメント で雛形を作り、そのドキュメントIDを
 *    物件マスターの「契約書雛形DocID」列に登録します。
 *  ・雛形の中に {{契約者氏名}} のような差込タグを書いておくと、
 *    申込内容で置き換えたうえでPDF化します（タグ一覧は LEASE_TAGS 参照）。
 *  ・雛形が未登録の物件は、内蔵の標準レイアウトで契約書を作成します。
 *
 * セットアップ手順は リポジトリの MOUSHIKOMI_SETUP.md を参照してください。
 * ============================================================
 */

/** 物件マスターの列定義（見出し → 説明） */
const MASTER_COLUMNS = [
  '物件コード', '物件名', '物件名フリガナ', '号室',
  '〒', '都道府県', '住所', '物件用途', '構造', '床面積',
  '家賃', '管理費共益費', '駐車場', '水道料町費',
  '敷金保証金', '礼金', '敷引償却',
  '契約期間(年)', '更新料', '賃料支払日', '支払方法',
  '貸主名', '貸主住所', '貸主TEL', '管理会社',
  '仲介手数料', '火災保険料', '鍵交換費用', '室内清掃費', 'その他初期費用', 'その他初期費用名目',
  '保証会社', '保証プラン', '初回保証料率(%)',
  '鍵種別', '鍵本数',
  '振込先銀行', '振込先支店', '口座種別', '口座番号', '口座名義',
  '契約書雛形DocID', '特約事項', '備考',
  // ここから重要事項説明書（宅建業法第35条書面）用の項目
  '重説雛形DocID', '取引態様', '免許証番号', '宅地建物取引士氏名', '宅地建物取引士登録番号',
  '建築時期', '登記_所有権', '登記_所有権以外の権利', '法令に基づく制限', '私道に関する負担',
  '飲用水', '電気', 'ガス', '排水', '石綿使用調査', '耐震診断',
  '造成宅地防災区域', '土砂災害警戒区域', '津波災害警戒区域', '水害ハザードマップ',
  '設備の整備状況', '用途その他の利用制限', '敷金等の精算に関する事項',
  '管理委託先商号', '管理委託先登録番号', '管理委託先住所', '管理委託先TEL',
  '契約終了時の金銭の清算', '契約の解除', '損害賠償額の予定・違約金', '支払金・預り金の保全措置',
];

/**
 * 書類の雛形（Googleドキュメント）のドキュメントID。
 *
 * 全物件で共通の様式を使う書類はここに登録します。
 * 空欄のままなら、内蔵の標準レイアウトで作成されます。
 *
 * 賃貸借契約書と重要事項説明書は物件ごとに様式が異なるため、
 * 物件マスターの「契約書雛形DocID」「重説雛形DocID」に登録してください。
 */
const DOC_TEMPLATES = {
  estimate: '',    // 見積書の雛形DocID
  invoice: '',     // 請求書の雛形DocID
  keyReceipt: '',  // 鍵受領書の雛形DocID
};

/** 賃貸借契約書・重要事項説明書などの雛形で使える差込タグ */
const LEASE_TAGS = [
  '{{契約日}}', '{{契約者氏名}}', '{{契約者フリガナ}}', '{{契約者生年月日}}', '{{契約者住所}}',
  '{{契約者電話}}', '{{契約者携帯}}', '{{契約者勤務先}}', '{{契約者勤務先電話}}',
  '{{物件名}}', '{{号室}}', '{{物件所在地}}', '{{物件用途}}', '{{構造}}', '{{床面積}}',
  '{{家賃}}', '{{管理費共益費}}', '{{駐車場}}', '{{月額賃料合計}}',
  '{{敷金}}', '{{礼金}}', '{{敷引}}',
  '{{契約始期}}', '{{契約終期}}', '{{契約期間}}', '{{更新料}}',
  '{{賃料支払日}}', '{{支払方法}}', '{{振込先}}',
  '{{貸主名}}', '{{貸主住所}}', '{{貸主電話}}', '{{管理会社}}',
  '{{緊急連絡先氏名}}', '{{緊急連絡先続柄}}', '{{緊急連絡先電話}}', '{{緊急連絡先住所}}',
  '{{連帯保証人氏名}}', '{{連帯保証人住所}}', '{{連帯保証人電話}}',
  '{{同居人一覧}}', '{{保証会社}}', '{{鍵種別}}', '{{鍵本数}}', '{{特約事項}}',
  // 重要事項説明書で使うタグ
  '{{取引態様}}', '{{免許証番号}}', '{{宅地建物取引士氏名}}', '{{宅地建物取引士登録番号}}',
  '{{建築時期}}', '{{設備の整備状況}}', '{{用途その他の利用制限}}',
  // 見積書・請求書・鍵受領書で使うタグ
  '{{発行日}}', '{{受付番号}}', '{{明細}}', '{{合計}}', '{{支払期限}}', '{{有効期限}}',
  '{{鍵明細}}', '{{鍵合計本数}}', '{{引渡日}}',
];

/* ============================================================
 *  物件マスター
 * ========================================================== */

/** 物件マスターのシートを取得（なければ作成し、見出しを書き込む） */
function masterSheet_() {
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  let file = null;
  const it = parent.getFilesByName(M_CONFIG.MASTER_SPREADSHEET_NAME);
  if (it.hasNext()) file = it.next();

  let ss;
  if (file) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    ss = SpreadsheetApp.create(M_CONFIG.MASTER_SPREADSHEET_NAME);
    const newFile = DriveApp.getFileById(ss.getId());
    parent.addFile(newFile);
    try { DriveApp.getRootFolder().removeFile(newFile); } catch (e) { /* 権限により失敗する場合がある */ }
  }

  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MASTER_COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, MASTER_COLUMNS.length).setFontWeight('bold').setBackground('#e5f6f6');
    // 差込タグの説明を別シートに残しておく
    const help = ss.insertSheet('雛形タグ一覧');
    help.appendRow(['賃貸借契約書の雛形（Googleドキュメント）で使える差込タグ']);
    help.appendRow(['タグをそのまま雛形に書いておくと、申込内容に置き換わります。']);
    help.appendRow(['']);
    LEASE_TAGS.forEach(function (t) { help.appendRow([t]); });
  }
  return sheet;
}

/** 物件マスターのスプレッドシートURL */
function masterUrl_() {
  return masterSheet_().getParent().getUrl();
}

/** 物件マスターの全行を取得 */
function listMaster_() {
  const sheet = masterSheet_();
  if (sheet.getLastRow() < 2) return [];
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values.map(function (row, n) {
    const o = { rowNo: n + 2 };
    head.forEach(function (h, i) { if (h) o[String(h)] = row[i]; });
    return o;
  }).filter(function (o) { return o['物件名']; });
}

/**
 * 申込内容に対応する物件マスターの行を探す。
 * 物件名（＋号室）の一致で判定し、見つからなければ null。
 */
function findMaster_(bukken, room) {
  const norm = function (s) { return String(s == null ? '' : s).replace(/[\s　]/g, '').toLowerCase(); };
  const list = listMaster_();
  const b = norm(bukken), r = norm(room);
  // 物件名＋号室が一致
  let hit = list.filter(function (m) {
    return norm(m['物件名']) === b && norm(m['号室']) === r;
  })[0];
  if (hit) return hit;
  // 号室が空欄（＝棟全体の登録）で物件名が一致
  hit = list.filter(function (m) {
    return norm(m['物件名']) === b && norm(m['号室']) === '';
  })[0];
  return hit || null;
}

/** 物件マスターの登録・更新（管理コンソールから） */
function saveMaster_(row) {
  const sheet = masterSheet_();
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  // 並び順はシートの見出し行に合わせる（列を足しても崩れないように）
  const values = head.map(function (h) {
    return row[String(h)] == null ? '' : row[String(h)];
  });

  // 既存行（物件名＋号室が一致）があれば上書き、なければ追加
  const norm = function (s) { return String(s == null ? '' : s).replace(/[\s　]/g, '').toLowerCase(); };
  const iName = head.indexOf('物件名') + 1;
  const iRoom = head.indexOf('号室') + 1;
  if (iName > 0 && sheet.getLastRow() >= 2) {
    const cur = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < cur.length; i++) {
      if (norm(cur[i][iName - 1]) === norm(row['物件名']) &&
          norm(cur[i][iRoom - 1]) === norm(row['号室'])) {
        sheet.getRange(i + 2, 1, 1, values.length).setValues([values]);
        return;
      }
    }
  }
  sheet.appendRow(values);
}

/* ============================================================
 *  金額の計算（初期費用）
 * ========================================================== */

const n_ = function (v) {
  const x = parseInt(String(v == null ? '' : v).replace(/[^0-9\-]/g, ''), 10);
  return isNaN(x) ? 0 : x;
};

/** その月の日数 */
function daysInMonth_(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * 初期費用の明細を組み立てる。
 * 物件マスターがあればマスターの費用（仲介手数料・火災保険料など）を使う。
 * overrides で個別に上書きできる（管理コンソールから金額を直す場合）。
 */
function buildCostItems_(data, master, overrides) {
  const o = overrides || {};
  const m = master || {};
  const pick = function (key, fallback) {
    return o[key] != null && o[key] !== '' ? n_(o[key]) : n_(fallback);
  };

  const rent = pick('rent', data.rent);
  const kanri = pick('kanrihi', data.kanrihi);
  const parking = pick('parking', data.parking);
  const suido = pick('suido', data.suido);
  const monthly = rent + kanri + parking + suido;

  const items = [];

  // 日割家賃（入居日が月の途中の場合）＋翌月分の前家賃
  let nissu = 0, nissuAmount = 0, nissuLabel = '';
  if (data.moveInDate && !data.moveInUndecided) {
    const mm = String(data.moveInDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) {
      const y = Number(mm[1]), mo = Number(mm[2]), d = Number(mm[3]);
      const dim = daysInMonth_(y, mo);
      nissu = dim - d + 1;
      if (nissu < dim) {
        nissuAmount = Math.round(monthly * nissu / dim);
        nissuLabel = mo + '月分（' + d + '日〜' + dim + '日／' + nissu + '日分）';
      }
    }
  }

  if (nissuAmount > 0) {
    items.push({ name: '日割賃料　' + nissuLabel, amount: nissuAmount, note: '月額 ' + monthly.toLocaleString('en-US') + '円 ÷ 当月日数 × ' + nissu + '日' });
  }

  items.push({ name: '前家賃（１ヶ月分）', amount: monthly, note: '家賃・管理費共益費・駐車場等を含む' });
  items.push({ name: '敷金・保証金', amount: pick('shikikin', data.shikikin), note: '' });
  items.push({ name: '礼金', amount: pick('reikin', data.reikin), note: '' });
  items.push({ name: '仲介手数料', amount: pick('chukaiFee', m['仲介手数料']), note: '' });
  items.push({ name: '火災保険料', amount: pick('kasaiFee', m['火災保険料']), note: '' });
  items.push({ name: '鍵交換費用', amount: pick('kagiFee', m['鍵交換費用']), note: '' });
  items.push({ name: '室内清掃費', amount: pick('cleaningFee', m['室内清掃費']), note: '' });

  // 保証委託料（初回）：マスターの料率があれば月額賃料合計から計算
  let hoshoRate = o.hoshoRate != null && o.hoshoRate !== '' ? parseFloat(o.hoshoRate) : parseFloat(m['初回保証料率(%)'] || '0');
  if (isNaN(hoshoRate)) hoshoRate = 0;
  const hosho = o.hoshoFee != null && o.hoshoFee !== ''
    ? n_(o.hoshoFee)
    : (hoshoRate > 0 ? Math.round(monthly * hoshoRate / 100) : 0);
  items.push({
    name: '賃貸保証委託料（初回）', amount: hosho,
    note: hoshoRate > 0 ? '月額賃料合計の ' + hoshoRate + '％' : ''
  });

  const otherName = o.otherName || m['その他初期費用名目'] || 'その他';
  items.push({ name: otherName, amount: pick('otherCost', m['その他初期費用']), note: '' });

  const list = items.filter(function (i) { return i.amount > 0; });
  const total = list.reduce(function (s, i) { return s + i.amount; }, 0);
  return { items: list, total: total, monthly: monthly };
}

/* ============================================================
 *  書類の共通パーツ
 * ========================================================== */

/** 会社の署名ブロック */
function issuerBlock_() {
  return '<div style="text-align:right;font-size:10.5px;line-height:1.8;margin-top:6px;">' +
    '<b>' + esc_(M_CONFIG.COMPANY) + '</b><br>' +
    '〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR) + '<br>' +
    'TEL：' + esc_(M_CONFIG.COMPANY_TEL) + '　FAX：' + esc_(M_CONFIG.COMPANY_FAX) +
    '</div>';
}

/** 明細テーブル */
function costTable_(cost) {
  return '<table>' +
    '<tr><th style="width:52%">項目</th><th style="width:20%;text-align:right">金額</th><th style="width:28%">摘要</th></tr>' +
    cost.items.map(function (i) {
      return '<tr><td>' + esc_(i.name) + '</td>' +
        '<td style="text-align:right">' + yen_(String(i.amount)) + '</td>' +
        '<td style="font-size:9.5px;color:#555">' + esc_(i.note) + '</td></tr>';
    }).join('') +
    '<tr><td style="background:#eef2f4;font-weight:bold">合　計</td>' +
    '<td style="background:#eef2f4;text-align:right;font-weight:bold;font-size:13px">' + yen_(String(cost.total)) + '</td>' +
    '<td style="background:#eef2f4"></td></tr>' +
    '</table>';
}

/** 振込先 */
function bankBlock_(master) {
  const m = master || {};
  if (!m['振込先銀行']) return '';
  return '<div class="sec alt">お振込先</div><table>' + rows_([
    ['金融機関', esc_(m['振込先銀行']) + '　' + esc_(m['振込先支店'] || '') + '支店'],
    ['口座種別・番号', esc_(m['口座種別'] || '普通') + '　' + esc_(m['口座番号'] || '')],
    ['口座名義', esc_(m['口座名義'] || '')],
  ]) + '</table>' +
    '<div class="note">※ 振込手数料はお客様のご負担でお願いいたします。</div>';
}

/* ============================================================
 *  ① 見積書
 * ========================================================== */

/**
 * 見積書・請求書・鍵受領書の雛形へ差し込む値。
 * 契約書と同じタグに加えて、明細や日付のタグを足したもの。
 */
function docValues_(data, master, cost, receiptNo, now, extra) {
  const values = leaseValues_(data, master, cost, now);
  values['{{発行日}}'] = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日');
  values['{{受付番号}}'] = receiptNo;
  if (cost) {
    values['{{明細}}'] = cost.items.map(function (i) {
      return i.name + '\t' + yen_(String(i.amount));
    }).join('\n');
    values['{{合計}}'] = yen_(String(cost.total));
  }
  const m = master || {};
  ['取引態様', '免許証番号', '宅地建物取引士氏名', '宅地建物取引士登録番号',
    '建築時期', '設備の整備状況', '用途その他の利用制限'].forEach(function (k) {
    values['{{' + k + '}}'] = m[k] || '';
  });
  Object.keys(extra || {}).forEach(function (k) { values[k] = extra[k]; });
  return values;
}

function buildEstimatePdf_(data, master, cost, receiptNo, now, workFolder) {
  const limit = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  if (DOC_TEMPLATES.estimate) {
    const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_見積書_' +
      safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
    return mergeDocTemplate_(DOC_TEMPLATES.estimate,
      docValues_(data, master, cost, receiptNo, now, {
        '{{有効期限}}': Utilities.formatDate(limit, 'Asia/Tokyo', 'yyyy年M月d日'),
      }), name, workFolder, '見積書の雛形', { 明細: costRows_(cost) });
  }

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">見積番号：' + esc_(receiptNo) + '-E<br>' +
    '発行日：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日') + '</div>' +
    '<h1>御 見 積 書</h1>' +
    '<div class="sub">賃貸借契約 初期費用</div>' +
    '<div style="font-size:13px;margin:10px 0 4px;"><b>' + esc_(data.aName) + '</b>　様</div>' +
    issuerBlock_() +
    '<div class="lead">下記のとおりお見積り申し上げます。<br>' +
    'お見積有効期限：' + Utilities.formatDate(limit, 'Asia/Tokyo', 'yyyy年M月d日') + '</div>' +

    '<div class="sec">お申込物件</div>' +
    '<table>' + rows_([
      ['物件名・号室', '<b>' + esc_(data.bukken) + '　' + esc_(data.room) + '</b>'],
      ['所在地', esc_(addr_(data.bukkenZip, data.bukkenPref, data.bukkenAddr))],
      ['入居予定日', data.moveInUndecided ? '未定' : jpDate_(data.moveInDate)],
      ['月額賃料合計', yen_(String(cost.monthly)) + '（家賃・管理費共益費・駐車場等を含む）'],
    ]) + '</table>' +

    '<div class="sec alt">初期費用のお見積り</div>' +
    costTable_(cost) +

    '<div class="note">' +
    '※ 本見積書は概算です。契約内容の変更・入居日の変更等により金額が変わる場合があります。<br>' +
    '※ 賃貸保証委託料は、保証会社の審査結果によりプラン・料率が変更となる場合があります。<br>' +
    '※ 上記のほか、退去時に原状回復費用が発生する場合があります。' +
    '</div>' +
    '</body></html>';

  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_見積書_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/* ============================================================
 *  ② 請求書
 * ========================================================== */

function buildInvoicePdf_(data, master, cost, receiptNo, now, workFolder) {
  // 支払期限：入居予定日の前日、なければ発行から14日後
  let due = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (data.moveInDate && !data.moveInUndecided) {
    const mm = String(data.moveInDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) due = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]) - 1);
  }

  if (DOC_TEMPLATES.invoice) {
    const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_請求書_' +
      safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
    return mergeDocTemplate_(DOC_TEMPLATES.invoice,
      docValues_(data, master, cost, receiptNo, now, {
        '{{支払期限}}': Utilities.formatDate(due, 'Asia/Tokyo', 'yyyy年M月d日'),
      }), name, workFolder, '請求書の雛形', { 明細: costRows_(cost) });
  }

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">請求番号：' + esc_(receiptNo) + '-I<br>' +
    '発行日：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日') + '</div>' +
    '<h1>御 請 求 書</h1>' +
    '<div class="sub">賃貸借契約 初期費用</div>' +
    '<div style="font-size:13px;margin:10px 0 4px;"><b>' + esc_(data.aName) + '</b>　様</div>' +
    issuerBlock_() +

    '<div style="border:2px solid #005f73;padding:9px 12px;margin:12px 0;text-align:center;">' +
    '<span style="font-size:12px;">ご請求金額（税込）</span><br>' +
    '<span style="font-size:22px;font-weight:bold;letter-spacing:1px;">' + yen_(String(cost.total)) + '</span><br>' +
    '<span style="font-size:11px;">お支払期限：' +
    Utilities.formatDate(due, 'Asia/Tokyo', 'yyyy年M月d日') + '</span>' +
    '</div>' +

    '<div class="sec">対象物件</div>' +
    '<table>' + rows_([
      ['物件名・号室', '<b>' + esc_(data.bukken) + '　' + esc_(data.room) + '</b>'],
      ['所在地', esc_(addr_(data.bukkenZip, data.bukkenPref, data.bukkenAddr))],
      ['入居予定日', data.moveInUndecided ? '未定' : jpDate_(data.moveInDate)],
      ['契約者', esc_(data.aName) + '　様'],
    ]) + '</table>' +

    '<div class="sec alt">ご請求明細</div>' +
    costTable_(cost) +
    bankBlock_(master) +

    '<div class="note">' +
    '※ お支払期限までにご入金をお願いいたします。<br>' +
    '※ ご入金の確認をもって、鍵のお引渡しとさせていただきます。<br>' +
    '※ 本請求書の内容にご不明な点がございましたら、上記までご連絡ください。' +
    '</div>' +
    '</body></html>';

  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_請求書_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/* ============================================================
 *  ③ 賃貸借契約書
 * ========================================================== */

/** 差込タグ → 値 の対応表 */
function leaseValues_(data, master, cost, now) {
  const m = master || {};
  const years = parseInt(m['契約期間(年)'] || '2', 10) || 2;

  // 契約始期＝入居予定日（未定なら発行日）／契約終期＝始期＋契約年数−1日
  let start = now;
  if (data.moveInDate && !data.moveInUndecided) {
    const mm = String(data.moveInDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) start = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]));
  }
  const end = new Date(start.getFullYear() + years, start.getMonth(), start.getDate() - 1);
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月d日'); };

  const bank = m['振込先銀行']
    ? m['振込先銀行'] + ' ' + (m['振込先支店'] || '') + '支店　' + (m['口座種別'] || '普通') +
      ' ' + (m['口座番号'] || '') + '　' + (m['口座名義'] || '')
    : '';

  const kyoju = (data.kyoju || []).map(function (k) {
    return k.name + '（' + k.relation + '／' + jpDate_(k.birth) + '）';
  }).join('、');

  return {
    '{{契約日}}': fmt(now),
    '{{契約者氏名}}': data.aName || '',
    '{{契約者フリガナ}}': data.aKana || '',
    '{{契約者生年月日}}': jpDate_(data.aBirth),
    '{{契約者住所}}': addr_(data.aZip, data.aPref, data.aAddr),
    '{{契約者電話}}': data.aTel || '',
    '{{契約者携帯}}': data.aMobile || '',
    '{{契約者勤務先}}': data.aCompany || '',
    '{{契約者勤務先電話}}': data.aCompanyTel || '',
    '{{物件名}}': data.bukken || '',
    '{{号室}}': data.room || '',
    '{{物件所在地}}': addr_(data.bukkenZip, data.bukkenPref, data.bukkenAddr),
    '{{物件用途}}': data.use || '',
    '{{構造}}': m['構造'] || '',
    '{{床面積}}': m['床面積'] || '',
    '{{家賃}}': yen_(data.rent),
    '{{管理費共益費}}': yen_(data.kanrihi),
    '{{駐車場}}': yen_(data.parking),
    '{{月額賃料合計}}': yen_(String(cost.monthly)),
    '{{敷金}}': yen_(data.shikikin),
    '{{礼金}}': yen_(data.reikin),
    '{{敷引}}': yen_(data.shikibiki),
    '{{契約始期}}': fmt(start),
    '{{契約終期}}': fmt(end),
    '{{契約期間}}': years + '年間',
    '{{更新料}}': m['更新料'] ? yen_(m['更新料']) : '',
    '{{賃料支払日}}': (m['賃料支払日'] || data.payDay || '') ? ('毎月 ' + (m['賃料支払日'] || data.payDay) + ' 日') : '',
    '{{支払方法}}': m['支払方法'] || data.payMethod || '',
    '{{振込先}}': bank,
    '{{貸主名}}': m['貸主名'] || '',
    '{{貸主住所}}': m['貸主住所'] || '',
    '{{貸主電話}}': m['貸主TEL'] || '',
    '{{管理会社}}': m['管理会社'] || M_CONFIG.COMPANY,
    '{{緊急連絡先氏名}}': data.eName || '',
    '{{緊急連絡先続柄}}': data.eRelation || '',
    '{{緊急連絡先電話}}': data.eMobile || '',
    '{{緊急連絡先住所}}': addr_(data.eZip, data.ePref, data.eAddr),
    '{{連帯保証人氏名}}': data.hasGuarantor === 'あり' ? (data.gName || '') : '',
    '{{連帯保証人住所}}': data.hasGuarantor === 'あり' ? addr_(data.gZip, data.gPref, data.gAddr) : '',
    '{{連帯保証人電話}}': data.hasGuarantor === 'あり' ? (data.gMobile || '') : '',
    '{{同居人一覧}}': kyoju,
    '{{保証会社}}': m['保証会社'] || '',
    '{{鍵種別}}': m['鍵種別'] || '',
    '{{鍵本数}}': m['鍵本数'] || '',
    '{{特約事項}}': m['特約事項'] || '',
  };
}

/**
 * 賃貸借契約書PDFを作成する。
 * 物件マスターに雛形DocIDがあればそれを差込印刷し、なければ内蔵レイアウトを使う。
 */
function buildLeasePdf_(data, master, cost, receiptNo, now, workFolder) {
  const m = master || {};
  const docId = String(m['契約書雛形DocID'] || '').trim();
  const values = leaseValues_(data, master, cost, now);
  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_賃貸借契約書_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';

  if (docId) {
    return mergeDocTemplate_(docId, values, name, workFolder, '契約書雛形DocID',
      { 同居人: kyojuRows_(data) });
  }

  // ---- 雛形が未登録の場合：内蔵の標準レイアウト ----
  const v = function (k) { return esc_(values[k] || ''); };
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<h1>建物賃貸借契約書</h1>' +
    '<div class="sub">' + v('{{物件名}}') + '　' + v('{{号室}}') + '</div>' +

    '<div class="lead">' +
    '賃貸人（以下「甲」という。）と賃借人（以下「乙」という。）は、下記の建物について、' +
    '次のとおり賃貸借契約を締結する。' +
    '</div>' +

    '<div class="sec">第１条（賃貸借の目的物）</div>' +
    '<table>' + rows_([
      ['名称・号室', '<b>' + v('{{物件名}}') + '　' + v('{{号室}}') + '</b>'],
      ['所在地', v('{{物件所在地}}')],
      ['用途', v('{{物件用途}}')],
      ['構造・床面積', v('{{構造}}') + '　' + v('{{床面積}}')],
    ]) + '</table>' +

    '<div class="sec alt">第２条（契約期間）</div>' +
    '<table>' + rows_([
      ['契約期間', v('{{契約始期}}') + '　から　' + v('{{契約終期}}') + '　まで（' + v('{{契約期間}}') + '）'],
      ['更新料', or_(v('{{更新料}}'))],
    ]) + '</table>' +
    '<div class="note">※ 本契約は、期間満了の際に甲乙協議のうえ更新することができる。</div>' +

    '<div class="sec">第３条（賃料等）</div>' +
    '<table>' + rows_([
      ['賃料', v('{{家賃}}')],
      ['管理費・共益費', v('{{管理費共益費}}')],
      ['駐車場使用料', v('{{駐車場}}')],
      ['月額合計', '<b>' + v('{{月額賃料合計}}') + '</b>'],
      ['支払期日', or_(v('{{賃料支払日}}'))],
      ['支払方法', or_(v('{{支払方法}}'))],
      ['振込先', or_(v('{{振込先}}'))],
    ]) + '</table>' +

    '<div class="sec alt">第４条（敷金等）</div>' +
    '<table>' + rows_([
      ['敷金・保証金', v('{{敷金}}')],
      ['礼金', v('{{礼金}}')],
      ['敷引・償却', v('{{敷引}}')],
    ]) + '</table>' +
    '<div class="note">※ 敷金は、乙の債務の担保として甲が預かり、明渡し完了後、未払賃料および原状回復費用等を控除して返還する。</div>' +

    '<div class="sec">第５条（入居者）</div>' +
    '<table>' + rows_([
      ['契約者（乙）', '<b>' + v('{{契約者氏名}}') + '</b>'],
      ['同居人', or_(v('{{同居人一覧}}'), 'なし')],
    ]) + '</table>' +

    '<div class="sec alt">第６条（禁止事項）</div>' +
    '<div style="font-size:10.5px;line-height:1.9;padding:0 4px;">' +
    '乙は、甲の書面による承諾を得ることなく、次の行為をしてはならない。<br>' +
    '　(1) 賃借権の譲渡または転貸<br>' +
    '　(2) 本物件の増改築・模様替え・造作の設置<br>' +
    '　(3) 契約書記載の入居者以外の者を居住させること<br>' +
    '　(4) 犬・猫等の動物の飼育（別途承諾のある場合を除く）<br>' +
    '　(5) 危険物の持込み、近隣の迷惑となる行為<br>' +
    '　(6) 反社会的勢力に本物件を利用させること' +
    '</div>' +

    '<div class="sec">第７条（原状回復）</div>' +
    '<div style="font-size:10.5px;line-height:1.9;padding:0 4px;">' +
    '乙は、本契約が終了したときは、本物件を原状に回復して甲に明け渡さなければならない。' +
    '通常の使用に伴い生じた損耗および経年変化を除く汚損・毀損については、乙の負担において回復するものとする。' +
    '</div>' +

    '<div class="sec alt">第８条（賃貸保証・連帯保証人）</div>' +
    '<table>' + rows_([
      ['賃貸保証会社', or_(v('{{保証会社}}'))],
      ['連帯保証人', v('{{連帯保証人氏名}}') ? v('{{連帯保証人氏名}}') + '　' + v('{{連帯保証人住所}}') + '　' + v('{{連帯保証人電話}}') : 'なし（保証会社利用）'],
      ['緊急連絡先', v('{{緊急連絡先氏名}}') + '（' + v('{{緊急連絡先続柄}}') + '）　' + v('{{緊急連絡先電話}}')],
    ]) + '</table>' +

    (values['{{特約事項}}']
      ? '<div class="sec">第９条（特約事項）</div>' +
        '<div style="font-size:10.5px;line-height:1.9;padding:0 4px;">' + esc_(values['{{特約事項}}']) + '</div>'
      : '') +

    '<div class="sec alt">署名・記名押印</div>' +
    '<div class="lead">本契約の成立を証するため本書２通を作成し、甲乙記名押印のうえ各１通を保有する。<br>' +
    '契約日：' + v('{{契約日}}') + '</div>' +

    '<table>' +
    '<tr><th style="width:14%">賃貸人（甲）</th><td class="v" style="height:66px;">' +
    '住所：' + or_(v('{{貸主住所}}')) + '<br>氏名：' + or_(v('{{貸主名}}')) +
    '　　　　　　　　　　　　　　　　　　　　㊞<br>TEL：' + or_(v('{{貸主電話}}')) + '</td></tr>' +
    '<tr><th>管理会社</th><td class="v">' + v('{{管理会社}}') + '　TEL：' + esc_(M_CONFIG.COMPANY_TEL) + '</td></tr>' +
    '<tr><th>賃借人（乙）</th><td class="v" style="height:66px;">' +
    '住所：' + v('{{契約者住所}}') + '<br>氏名：' + v('{{契約者氏名}}') +
    '　　　　　　　　　　　　　　　　　　　　㊞<br>TEL：' + v('{{契約者携帯}}') + '</td></tr>' +
    (v('{{連帯保証人氏名}}')
      ? '<tr><th>連帯保証人</th><td class="v" style="height:66px;">' +
        '住所：' + v('{{連帯保証人住所}}') + '<br>氏名：' + v('{{連帯保証人氏名}}') +
        '　　　　　　　　　　　　　　　　　　　　㊞<br>TEL：' + v('{{連帯保証人電話}}') + '</td></tr>'
      : '') +
    '</table>' +

    '<div class="warn">' +
    'この契約書は、物件マスターに雛形（Googleドキュメント）が未登録のため、標準レイアウトで作成しています。<br>' +
    '物件ごとの契約書式をお使いになる場合は、物件マスターの「契約書雛形DocID」欄にドキュメントIDを登録してください。' +
    '</div>' +
    '</body></html>';

  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/** replaceText 用に正規表現のメタ文字をエスケープ */
function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 見積書・請求書の明細行 */
function costRows_(cost) {
  return ((cost && cost.items) || []).map(function (i) {
    return { 項目: i.name, 金額: yen_(String(i.amount)), 摘要: i.note || '' };
  }).concat([{ 項目: '合　計', 金額: yen_(String((cost && cost.total) || 0)), 摘要: '' }]);
}

/** 鍵受領書の鍵明細行 */
function keyRows_(list) {
  return (list || []).map(function (k) {
    return { 種別: k.type || '', 本数: (k.count || '') + ' 本', 備考: k.no || '' };
  });
}

/** 契約書・重説の同居人行 */
function kyojuRows_(data) {
  return ((data && data.kyoju) || []).map(function (k) {
    return { 氏名: k.name || '', フリガナ: k.kana || '', 続柄: k.relation || '', 生年月日: jpDate_(k.birth) };
  });
}

/**
 * 雛形の表の中にある「見出し行」を、データの件数だけ複製して差し込む。
 *
 * 使い方：雛形（Googleドキュメント）の表に、次のような行を1行だけ用意します。
 *   ｜{{明細.項目}}｜{{明細.金額}}｜{{明細.摘要}}｜
 * この関数が、その行をデータの件数ぶん複製し、セルごとに値を入れます。
 * データが0件のときは、その行を削除します。
 *
 * marker … '明細' のような接頭辞
 * rows   … [{ 項目:'礼金', 金額:'50,000円', 摘要:'' }, …]
 */
function expandTableRows_(body, marker, rows) {
  const tag = '{{' + marker + '.';
  const tables = body.getTables();

  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    let tmplIdx = -1;
    for (let r = 0; r < table.getNumRows(); r++) {
      if (table.getRow(r).getText().indexOf(tag) >= 0) { tmplIdx = r; break; }
    }
    if (tmplIdx < 0) continue;

    const tmplRow = table.getRow(tmplIdx);
    const list = rows || [];

    // 雛形行を複製して、下に挿し込んでいく
    list.forEach(function (item, i) {
      const copy = tmplRow.copy();
      for (let c = 0; c < copy.getNumCells(); c++) {
        const cell = copy.getCell(c);
        Object.keys(item).forEach(function (k) {
          cell.replaceText(escapeRegex_(tag + k + '}}'), String(item[k] == null ? '' : item[k]));
        });
        // 使われなかったタグは空にする
        cell.replaceText(escapeRegex_(tag) + '[^}]*\\}\\}', '');
      }
      table.insertTableRow(tmplIdx + 1 + i, copy);
    });

    // 雛形行そのものは削除する
    table.removeRow(tmplIdx);
    return;
  }
}

/**
 * Googleドキュメントの雛形をコピーし、差込タグを置き換えてPDFにする。
 * 賃貸借契約書と重要事項説明書で共用する。
 */
function mergeDocTemplate_(docId, values, name, workFolder, fieldLabel, tables) {
  let tmp = null;
  try {
    const src = DriveApp.getFileById(docId);
    tmp = src.makeCopy('__作成中_' + name.replace('.pdf', ''), workFolder);
    const doc = DocumentApp.openById(tmp.getId());

    // 明細などの繰り返し行を先に展開する（行数が可変の表）
    Object.keys(tables || {}).forEach(function (marker) {
      expandTableRows_(doc.getBody(), marker, tables[marker]);
    });

    const targets = [doc.getBody(), doc.getHeader(), doc.getFooter()];
    targets.forEach(function (sec) {
      if (!sec) return;
      Object.keys(values).forEach(function (tag) {
        sec.replaceText(escapeRegex_(tag), String(values[tag] == null ? '' : values[tag]));
      });
    });
    doc.saveAndClose();
    const pdf = DriveApp.getFileById(tmp.getId()).getAs(MimeType.PDF).setName(name);
    tmp.setTrashed(true);
    return pdf;
  } catch (err) {
    if (tmp) { try { tmp.setTrashed(true); } catch (e) { /* 無視 */ } }
    throw new Error('雛形の差込に失敗しました（' + fieldLabel + '：' + docId + '）：' + err);
  }
}

/* ============================================================
 *  ④ 重要事項説明書（宅建業法第35条書面）
 * ========================================================== */

/**
 * 重要事項説明書PDFを作成する。
 * 賃貸借契約書と同じく、物件マスターに雛形DocIDがあれば差込印刷し、
 * なければ内蔵の標準レイアウトで作成する。
 *
 * ※ 本書は宅地建物取引士が記名し、説明を行う法定書面です。
 *   自動作成されるのはあくまで下書きですので、必ず宅地建物取引士が
 *   内容を確認・補記のうえ記名してからご使用ください。
 */
function buildJuusetsuPdf_(data, master, cost, receiptNo, now, workFolder) {
  const m = master || {};
  const docId = String(m['重説雛形DocID'] || '').trim();
  const values = leaseValues_(data, master, cost, now);
  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_重要事項説明書_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';

  // 重説だけで使う差込タグを足す
  const extra = {
    '{{取引態様}}': m['取引態様'] || '',
    '{{免許証番号}}': m['免許証番号'] || '',
    '{{宅地建物取引士氏名}}': m['宅地建物取引士氏名'] || '',
    '{{宅地建物取引士登録番号}}': m['宅地建物取引士登録番号'] || '',
    '{{建築時期}}': m['建築時期'] || '',
    '{{設備の整備状況}}': m['設備の整備状況'] || '',
    '{{用途その他の利用制限}}': m['用途その他の利用制限'] || '',
  };
  Object.keys(extra).forEach(function (k) { values[k] = extra[k]; });

  if (docId) {
    return mergeDocTemplate_(docId, values, name, workFolder, '重説雛形DocID',
      { 同居人: kyojuRows_(data) });
  }

  const v = function (k) { return esc_(values[k] || ''); };
  const mv = function (k) { return or_(esc_(m[k] || '')); };

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日') + '</div>' +
    '<h1>重要事項説明書</h1>' +
    '<div class="sub">（賃貸借契約用）　' + v('{{物件名}}') + '　' + v('{{号室}}') + '</div>' +

    '<div class="lead">' +
    'この書面は、宅地建物取引業法第35条の規定に基づき、賃貸借契約の締結前に、' +
    '借主となろうとする方に対して説明すべき重要な事項を記載したものです。' +
    '内容を十分にご理解いただいたうえで、賃貸借契約をご締結ください。' +
    '</div>' +

    '<div class="sec">説明を受ける方</div>' +
    '<table>' + rows_([
      ['氏名', '<b>' + v('{{契約者氏名}}') + '</b>　様'],
      ['住所', v('{{契約者住所}}')],
    ]) + '</table>' +

    '<div class="sec alt">宅地建物取引業者・宅地建物取引士</div>' +
    '<table>' + rows_([
      ['取引態様', mv('取引態様')],
      ['商号', esc_(M_CONFIG.COMPANY)],
      ['免許証番号', mv('免許証番号')],
      ['所在地', '〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR)],
      ['電話番号', esc_(M_CONFIG.COMPANY_TEL)],
      ['宅地建物取引士 氏名', mv('宅地建物取引士氏名') + '　　　　　　　　　　　　　㊞'],
      ['宅地建物取引士 登録番号', mv('宅地建物取引士登録番号')],
    ]) + '</table>' +

    '<div class="sec">Ⅰ　対象となる宅地または建物に関する事項</div>' +
    '<table>' + rows_([
      ['名称・号室', '<b>' + v('{{物件名}}') + '　' + v('{{号室}}') + '</b>'],
      ['所在地', v('{{物件所在地}}')],
      ['種類・構造', v('{{構造}}')],
      ['床面積', v('{{床面積}}')],
      ['建築時期', mv('建築時期')],
      ['登記記録／所有権に関する事項', mv('登記_所有権')],
      ['登記記録／所有権以外の権利', mv('登記_所有権以外の権利')],
      ['法令に基づく制限', mv('法令に基づく制限')],
      ['私道に関する負担', mv('私道に関する負担')],
    ]) + '</table>' +

    '<table>' + rows_([
      ['飲用水の供給施設', mv('飲用水')],
      ['電気の供給施設', mv('電気')],
      ['ガスの供給施設', mv('ガス')],
      ['排水施設', mv('排水')],
    ]) + '</table>' +

    '<table>' + rows_([
      ['石綿（アスベスト）使用調査の内容', mv('石綿使用調査')],
      ['耐震診断の内容', mv('耐震診断')],
      ['造成宅地防災区域内か否か', mv('造成宅地防災区域')],
      ['土砂災害警戒区域内か否か', mv('土砂災害警戒区域')],
      ['津波災害警戒区域内か否か', mv('津波災害警戒区域')],
      ['水害ハザードマップにおける所在地', mv('水害ハザードマップ')],
    ]) + '</table>' +
    '<div class="note">※ 各区域の該当有無、ハザードマップ上の位置については、説明時に市区町村の公表資料をご提示のうえご説明します。</div>' +

    '<div class="sec alt">Ⅱ　取引条件に関する事項</div>' +
    '<table>' + rows_([
      ['借賃（賃料）', v('{{家賃}}')],
      ['管理費・共益費', v('{{管理費共益費}}')],
      ['駐車場使用料', v('{{駐車場}}')],
      ['月額合計', '<b>' + v('{{月額賃料合計}}') + '</b>'],
      ['賃料の支払時期・方法', or_(v('{{賃料支払日}}')) + '　' + or_(v('{{支払方法}}'))],
      ['敷金・保証金', v('{{敷金}}')],
      ['礼金', v('{{礼金}}')],
      ['敷引・償却', v('{{敷引}}')],
      ['契約期間', v('{{契約始期}}') + '　から　' + v('{{契約終期}}') + '　まで（' + v('{{契約期間}}') + '）'],
      ['更新および更新料', or_(v('{{更新料}}'))],
      ['用途その他の利用の制限', mv('用途その他の利用制限')],
      ['設備の整備状況', mv('設備の整備状況')],
      ['敷金等の精算に関する事項', mv('敷金等の精算に関する事項')],
      ['契約終了時における金銭の清算', mv('契約終了時の金銭の清算')],
      ['契約の解除に関する事項', mv('契約の解除')],
      ['損害賠償額の予定・違約金', mv('損害賠償額の予定・違約金')],
      ['支払金・預り金の保全措置', mv('支払金・預り金の保全措置')],
    ]) + '</table>' +

    '<div class="sec">Ⅲ　管理の委託先</div>' +
    '<table>' + rows_([
      ['商号（名称）', or_(esc_(m['管理委託先商号'] || M_CONFIG.COMPANY))],
      ['登録番号', mv('管理委託先登録番号')],
      ['主たる事務所の所在地', or_(esc_(m['管理委託先住所'] || M_CONFIG.COMPANY_ADDR))],
      ['電話番号', or_(esc_(m['管理委託先TEL'] || M_CONFIG.COMPANY_TEL))],
    ]) + '</table>' +

    '<div class="sec alt">Ⅳ　賃貸保証（家賃債務保証）に関する事項</div>' +
    '<table>' + rows_([
      ['保証会社', or_(v('{{保証会社}}'))],
      ['連帯保証人', v('{{連帯保証人氏名}}') ? v('{{連帯保証人氏名}}') : 'なし（保証会社利用）'],
    ]) + '</table>' +

    (values['{{特約事項}}']
      ? '<div class="sec">Ⅴ　特約事項</div>' +
        '<div style="font-size:10.5px;line-height:1.9;padding:0 4px;">' + esc_(values['{{特約事項}}']) + '</div>'
      : '') +

    '<div class="sec alt">説明および受領の確認</div>' +
    '<div class="lead">' +
    '私は、宅地建物取引士から本書面に記載された重要事項について説明を受け、本書面を受領しました。<br>' +
    '説明日：　　　　　年　　　月　　　日' +
    '</div>' +
    '<table>' +
    '<tr><th style="width:20%">説明を受けた方</th><td class="v" style="height:60px;">' +
    '住所：' + v('{{契約者住所}}') + '<br>氏名：' + v('{{契約者氏名}}') +
    '　　　　　　　　　　　　　　　　　　　　㊞</td></tr>' +
    '<tr><th>説明した宅地建物取引士</th><td class="v" style="height:60px;">' +
    '登録番号：' + mv('宅地建物取引士登録番号') + '<br>氏名：' + mv('宅地建物取引士氏名') +
    '　　　　　　　　　　　　　　　　　　　　㊞</td></tr>' +
    '</table>' +

    '<div class="warn">' +
    '<b>本書は自動作成された下書きです。</b>宅地建物取引業法上、重要事項の説明は宅地建物取引士が' +
    '取引士証を提示して行い、本書面に記名する必要があります。<br>' +
    '空欄（<span class="off">―</span>）の項目は物件マスターに未登録です。' +
    'ご使用前に必ず宅地建物取引士が内容を確認し、不足事項を補記してください。' +
    (docId ? '' : '<br>物件ごとの書式をお使いの場合は、物件マスターの「重説雛形DocID」にドキュメントIDを登録してください。') +
    '</div>' +
    '</body></html>';

  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/* ============================================================
 *  ⑤ 鍵受領書（実際の鍵の写真つき）
 * ========================================================== */

function buildKeyReceiptPdf_(data, master, receiptNo, now, keys, keyPhotos, handoverDate, workFolder) {
  const m = master || {};
  const kagiType = m['鍵種別'] || '玄関錠';
  const kagiCount = m['鍵本数'] || '';
  const list = (keys || []).filter(function (k) { return k && (k.type || k.count); });

  if (DOC_TEMPLATES.keyReceipt) {
    const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_鍵受領書_' +
      safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
    const total = list.reduce(function (s, k) { return s + (parseInt(k.count || '0', 10) || 0); }, 0);
    // ※ 雛形を使う場合、鍵の写真はPDFへ差し込めないため、
    //   写真は案件フォルダの「鍵」フォルダに保存したものをご利用ください。
    return mergeDocTemplate_(DOC_TEMPLATES.keyReceipt,
      docValues_(data, master, null, receiptNo, now, {
        '{{鍵明細}}': list.map(function (k) {
          return (k.type || '') + '\t' + (k.count || '') + '本' + (k.no ? '\t' + k.no : '');
        }).join('\n'),
        '{{鍵合計本数}}': total ? total + ' 本' : '',
        '{{引渡日}}': handoverDate ? jpDate_(handoverDate) : '',
      }), name, workFolder, '鍵受領書の雛形', { 鍵: keyRows_(list) });
  }

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">整理番号：' + esc_(receiptNo) + '-K</div>' +
    '<h1>鍵 受 領 書</h1>' +
    '<div class="sub">' + esc_(data.bukken) + '　' + esc_(data.room) + '</div>' +

    '<div style="font-size:12px;margin:14px 0 8px;">' + esc_(M_CONFIG.COMPANY) + '　御中</div>' +

    '<div class="lead">' +
    '私は、下記の物件につき、下記のとおり鍵を確かに受領いたしました。<br>' +
    '鍵の紛失・破損の際は、直ちに貴社へご連絡いたします。また、退去の際は、受領した本数を' +
    '（合鍵を作成した場合は合鍵も含めて）すべて返却いたします。' +
    '</div>' +

    '<div class="sec">対象物件</div>' +
    '<table>' + rows_([
      ['物件名・号室', '<b>' + esc_(data.bukken) + '　' + esc_(data.room) + '</b>'],
      ['所在地', esc_(addr_(data.bukkenZip, data.bukkenPref, data.bukkenAddr))],
      ['入居予定日', data.moveInUndecided ? '未定' : jpDate_(data.moveInDate)],
    ]) + '</table>' +

    '<div class="sec alt">受領する鍵</div>' +
    keyTable_(keys, kagiType, kagiCount) +
    keyPhotoBlock_(keyPhotos) +

    '<div class="sec">受領者</div>' +
    '<table>' + rows_([
      ['受領日', handoverDate ? jpDate_(handoverDate) : '　　　　　年　　　月　　　日'],
      ['住所', esc_(addr_(data.aZip, data.aPref, data.aAddr))],
      ['氏名', '<b>' + esc_(data.aName) + '</b>　　　　　　　　　　　　　　　　　　㊞'],
      ['電話番号', esc_(data.aMobile)],
    ]) + '</table>' +

    '<div class="sec alt">引渡し担当者（' + esc_(M_CONFIG.COMPANY) + '）</div>' +
    '<table>' + rows_([
      ['引渡日', handoverDate ? jpDate_(handoverDate) : '　　　　　年　　　月　　　日'],
      ['担当者', or_(esc_(data.agentStaff)) + '　　　　　　　　　　　　　　　　　　㊞'],
    ]) + '</table>' +

    '<div class="foot">' +
    esc_(M_CONFIG.COMPANY) + '　〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR) +
    '　TEL：' + esc_(M_CONFIG.COMPANY_TEL) + '　FAX：' + esc_(M_CONFIG.COMPANY_FAX) +
    '</div></body></html>';

  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_鍵受領書_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/** 受領する鍵の一覧表（未登録なら記入用の空欄を出す） */
function keyTable_(keys, defType, defCount) {
  const list = (keys || []).filter(function (k) { return k && (k.type || k.count); });
  let body;
  if (list.length) {
    body = list.map(function (k) {
      return '<tr><td>' + esc_(k.type || '') + '</td>' +
        '<td style="text-align:center;font-size:13px;font-weight:bold">' +
        (k.count ? esc_(k.count) + ' 本' : '　　　本') + '</td>' +
        '<td>' + esc_(k.no || '') + '</td></tr>';
    }).join('');
  } else {
    body = '<tr><td>' + esc_(defType) + '</td>' +
      '<td style="text-align:center;font-size:13px;font-weight:bold">' +
      (defCount ? esc_(defCount) + ' 本' : '　　　本') + '</td><td></td></tr>' +
      '<tr><td>　</td><td style="text-align:center">　　　本</td><td></td></tr>' +
      '<tr><td>　</td><td style="text-align:center">　　　本</td><td></td></tr>';
  }
  const total = list.reduce(function (s, k) { return s + (parseInt(k.count || '0', 10) || 0); }, 0);

  return '<table>' +
    '<tr><th style="width:34%">鍵の種別</th><th style="width:16%;text-align:center">本数</th><th>鍵番号・備考</th></tr>' +
    body +
    (total > 0
      ? '<tr><td style="background:#eef2f4;font-weight:bold">合　計</td>' +
        '<td style="background:#eef2f4;text-align:center;font-weight:bold;font-size:14px">' + total + ' 本</td>' +
        '<td style="background:#eef2f4"></td></tr>'
      : '') +
    '</table>' +
    (list.length ? '' :
      '<div class="note">※ 空欄は鍵の引渡し時にご記入ください（メールボックス錠・駐輪場錠・共用部錠など）。</div>');
}

/** 実際に引き渡す鍵の写真（PDFへ埋め込む） */
function keyPhotoBlock_(photos) {
  const list = photos || [];
  if (!list.length) return '';
  // ※ display:flex は GAS の HTML→PDF 変換で崩れるため、表組みで並べる
  const cells = list.map(function (p) {
    return '<td style="width:33%;text-align:center;vertical-align:top;">' +
      '<img src="' + p.src + '" style="max-width:100%;max-height:200px;">' +
      '<div style="font-size:9px;color:#555;">' + esc_(p.caption || '') + '</div></td>';
  });
  const trs = [];
  for (let i = 0; i < cells.length; i += 3) {
    trs.push('<tr>' + cells.slice(i, i + 3).join('') + '</tr>');
  }
  return '<div class="sec">引き渡す鍵の写真</div>' +
    '<table>' + trs.join('') + '</table>' +
    '<div class="note">※ 上記の写真は、引渡し時に実際にお渡しした鍵を撮影したものです。退去時はこの本数をすべてご返却ください。</div>';
}

/* ============================================================
 *  書類の作成
 *
 *  お申込みの流れに合わせて、2段階で作成します。
 *    受付時       → 見積書（初期費用をお客様へ提示するため）
 *    審査に通過後 → 重要事項説明書・賃貸借契約書・請求書・鍵受領書
 * ========================================================== */

/** 受付時：見積書だけを作成する */
function buildEstimateOnly_(caseFolder, data, receiptNo, now, overrides) {
  const master = findMaster_(data.bukken, data.room);
  const cost = buildCostItems_(data, master, overrides);
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.docs);
  return folder.createFile(buildEstimatePdf_(data, master, cost, receiptNo, now, folder));
}

/**
 * 審査通過後：重要事項説明書・賃貸借契約書・請求書・鍵受領書を作成する。
 * 見積書も金額を反映して作り直す。
 */
function buildContractDocuments_(receiptNo, overrides) {
  const c = getCase_(receiptNo);
  if (!c) return { ok: false, error: '申込が見つかりません：' + receiptNo };
  if (!c.folderId) return { ok: false, error: '案件フォルダIDが記録されていません。' };

  const caseFolder = DriveApp.getFolderById(c.folderId);
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.docs);
  const now = new Date();
  const data = caseToData_(c);
  const master = findMaster_(data.bukken, data.room);
  const cost = buildCostItems_(data, master, overrides);

  const made = [];
  const errors = [];

  const add = function (label, fn) {
    try {
      made.push(folder.createFile(fn()));
    } catch (err) {
      errors.push(label + '：' + err);
    }
  };

  add('見積書', function () { return buildEstimatePdf_(data, master, cost, receiptNo, now, folder); });
  add('重要事項説明書', function () { return buildJuusetsuPdf_(data, master, cost, receiptNo, now, folder); });
  add('賃貸借契約書', function () { return buildLeasePdf_(data, master, cost, receiptNo, now, folder); });
  add('請求書', function () { return buildInvoicePdf_(data, master, cost, receiptNo, now, folder); });

  const keys = readKeys_(c);
  add('鍵受領書', function () {
    return buildKeyReceiptPdf_(data, master, receiptNo, now,
      keys.keys, keyPhotos_(caseFolder), keys.handoverDate, folder);
  });

  if (made.length) {
    updateStatus_(receiptNo, '契約書類作成済', '契約書類を作成（' + made.length + '点）');
  }

  return {
    ok: made.length > 0,
    message: made.length
      ? '契約書類を作成しました（' + made.length + '点）。' +
        (errors.length ? '\n\n次の書類は作成できませんでした：\n' + errors.join('\n') : '')
      : '書類を作成できませんでした。\n' + errors.join('\n'),
    error: made.length ? '' : errors.join(' / '),
    files: made.map(function (f) { return { name: f.getName(), url: f.getUrl() }; }),
  };
}

/* ---------- 鍵の情報と写真 ---------- */

/** 受付一覧に保存された鍵情報を読み出す */
function readKeys_(c) {
  try {
    const o = JSON.parse(String(c['鍵情報'] || '{}'));
    return {
      keys: (o && o.keys) || [],
      handoverDate: (o && o.handoverDate) || '',
    };
  } catch (e) {
    return { keys: [], handoverDate: '' };
  }
}

/** 案件フォルダの「鍵」フォルダにある写真を、PDF埋め込み用に読み込む */
function keyPhotos_(caseFolder) {
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.keys);
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const blob = f.getBlob();
    const type = blob.getContentType() || '';
    if (type.indexOf('image/') !== 0) continue;
    out.push({
      caption: f.getName().replace(/\.[^.]+$/, ''),
      src: 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes()),
    });
  }
  return out;
}

/**
 * 鍵の情報と写真を登録し、鍵受領書を作り直す。
 * keys  … [{ type:'玄関錠', count:'3', no:'A-123' }, …]
 * files … [{ name, mimeType, dataUrl }, …]（管理コンソールから撮影・選択した写真）
 */
function saveKeys_(receiptNo, keys, files, handoverDate) {
  const c = getCase_(receiptNo);
  if (!c) return { ok: false, error: '申込が見つかりません：' + receiptNo };
  if (!c.folderId) return { ok: false, error: '案件フォルダIDが記録されていません。' };

  const caseFolder = DriveApp.getFolderById(c.folderId);
  const keyFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.keys);
  const data = caseToData_(c);
  const now = new Date();
  const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');

  // 写真を保存
  let saved = 0;
  (files || []).forEach(function (f, i) {
    const m = String(f.dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return;
    const ext = m[1] === 'application/pdf' ? '.pdf' : '.jpg';
    const label = f.caption || ('鍵' + (i + 1));
    const name = stamp + '_' + safeName_(data.bukken) + '_' + safeName_(data.room) + '_' +
      safeName_(label) + ext;
    keyFolder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name));
    saved++;
  });

  // 鍵情報をシートへ保存
  const sheet = logSheet_();
  const idx = headerIndex_(sheet);
  if (idx['鍵情報']) {
    sheet.getRange(c.rowNo, idx['鍵情報']).setValue(JSON.stringify({
      keys: keys || [], handoverDate: handoverDate || '',
    }));
  }

  // 鍵受領書を作り直す
  const master = findMaster_(data.bukken, data.room);
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.docs);
  const file = folder.createFile(buildKeyReceiptPdf_(
    data, master, receiptNo, now, keys || [], keyPhotos_(caseFolder), handoverDate, folder));

  appendMemo_(receiptNo, '鍵受領書を作成（写真 ' + saved + '点）');

  return {
    ok: true,
    message: '鍵受領書を作成しました。（写真 ' + saved + ' 点を保存しました）',
    fileUrl: file.getUrl(),
    fileName: file.getName(),
  };
}

/**
 * 管理コンソールから書類を作り直す。
 * overrides で金額を上書きできる（例：{ chukaiFee: 55000, kasaiFee: 20000 }）。
 */
function rebuildDocuments_(receiptNo, overrides) {
  return buildContractDocuments_(receiptNo, overrides);
}

/** 受付一覧の1行 → 書類作成用のデータ */
function caseToData_(c) {
  const d = {};
  // 日付列はスプレッドシート上で Date 型になっていることがあるので yyyy-MM-dd に戻す
  logColumns_().forEach(function (col) {
    if (!col[1]) return;
    const raw = c[col[0]];
    if (raw instanceof Date) {
      d[col[1]] = Utilities.formatDate(raw, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      d[col[1]] = raw == null ? '' : String(raw);
    }
  });
  d.moveInUndecided = !d.moveInDate;
  d.aName = String(c['申込者氏名'] || '');
  d.aKana = String(c['申込者フリガナ'] || '');
  d.kyoju = [];
  const kyojuText = String(c['同居人'] || '');
  if (kyojuText) {
    d.kyoju = kyojuText.split(' / ').map(function (s) {
      const m = s.match(/^(.*?)（(.*?)／(.*?)／(.*?)／(.*?)）$/);
      return m ? { name: m[1], kana: m[2], relation: m[3], birth: m[4], tel: m[5] } : { name: s };
    });
  }
  return d;
}

/* ============================================================
 *  動作確認用
 * ========================================================== */

/** 物件マスターを作成し、サンプル行を1件登録します。 */
function testCreateMaster() {
  saveMaster_({
    '物件コード': 'SAMPLE-101',
    '物件名': '○×ハイツ', '物件名フリガナ': 'マルバツハイツ', '号室': '101',
    '〒': '737-0821', '都道府県': '広島県', '住所': '呉市三条4丁目7-20',
    '物件用途': '住居用', '構造': '木造２階建', '床面積': '42.5㎡',
    '家賃': 50000, '管理費共益費': 3000, '駐車場': 5000, '水道料町費': 1000,
    '敷金保証金': 50000, '礼金': 50000, '敷引償却': 0,
    '契約期間(年)': 2, '更新料': 50000, '賃料支払日': 27, '支払方法': '口座振替',
    '貸主名': '大森 花子', '貸主住所': '広島県呉市中央1-1-1', '貸主TEL': '0823-00-0000',
    '管理会社': M_CONFIG.COMPANY,
    '仲介手数料': 55000, '火災保険料': 20000, '鍵交換費用': 16500, '室内清掃費': 0,
    'その他初期費用': 0, 'その他初期費用名目': '',
    '保証会社': '日本セーフティー', '保証プラン': 'パートナー（保証人なし）', '初回保証料率(%)': 50,
    '鍵種別': 'ディンプルキー（玄関錠）', '鍵本数': 3,
    '振込先銀行': 'もみじ銀行', '振込先支店': '呉中央', '口座種別': '普通',
    '口座番号': '3113449', '口座名義': 'エイホームトラスト株式会社',
    '契約書雛形DocID': '',
    '特約事項': '本物件は禁煙とする。ペットの飼育は不可とする。',
    '備考': 'テスト用のサンプル行です。',
  });
  Logger.log('物件マスターにサンプル行を登録しました。');
}

/** サンプル申込で書類4点を作成します（testMoushikomi のデータを利用）。 */
function testBuildDocuments() {
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const now = new Date();
  const receiptNo = 'TESTDOC' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const caseFolder = getOrCreateSubfolder_(parent, 'TEST_' + receiptNo);

  const data = {
    bukken: '○×ハイツ', room: '101',
    bukkenZip: '7370821', bukkenPref: '広島県', bukkenAddr: '呉市三条4丁目7-20',
    use: '住居用', moveInDate: '2026-09-15', moveInUndecided: false,
    rent: '50000', kanrihi: '3000', parking: '5000', suido: '1000',
    shikikin: '50000', reikin: '50000', shikibiki: '0',
    aName: '大森 太郎', aKana: 'オオモリ タロウ', aBirth: '1990-05-15',
    aZip: '7370811', aPref: '広島県', aAddr: '呉市広古新開1-2-3',
    aMobile: '090-1234-5678', aTel: '0823-00-0000',
    aCompany: '株式会社サンプル', aCompanyTel: '082-000-0000',
    eName: '大森 次郎', eRelation: '父', eMobile: '090-9999-8888',
    eZip: '7370051', ePref: '広島県', eAddr: '呉市中央1-1-1',
    hasGuarantor: 'なし', agentStaff: '大森',
    kyoju: [{ name: '大森 花子', kana: 'オオモリ ハナコ', relation: '妻', birth: '1992-08-20' }],
    payDay: '27', payMethod: '口座振替',
  };

  const files = buildAllDocuments_(caseFolder, data, receiptNo, now);
  Logger.log('作成しました：' + caseFolder.getUrl());
  files.forEach(function (f) { Logger.log('　・' + f.getName()); });
}
