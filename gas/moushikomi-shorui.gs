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
 *  2. 入居申込を受け付けたときに、下記4点の書類を自動作成する
 *       ① 見積書（初期費用のお見積り）
 *       ② 請求書（初期費用のご請求）
 *       ③ 賃貸借契約書（物件ごとの雛形から差込。紙でのやりとり用にPDF出力）
 *       ④ 鍵受領書
 *  3. 管理コンソールから、金額を修正して書類を作り直す
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
];

/** 賃貸借契約書の雛形で使える差込タグ */
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

function buildEstimatePdf_(data, master, cost, receiptNo, now) {
  const limit = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

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

function buildInvoicePdf_(data, master, cost, receiptNo, now) {
  // 支払期限：入居予定日の前日、なければ発行から14日後
  let due = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (data.moveInDate && !data.moveInUndecided) {
    const mm = String(data.moveInDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) due = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]) - 1);
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
    // ---- 物件ごとの雛形（Googleドキュメント）から差込 ----
    let tmp = null;
    try {
      const src = DriveApp.getFileById(docId);
      tmp = src.makeCopy('__作成中_' + name.replace('.pdf', ''), workFolder);
      const doc = DocumentApp.openById(tmp.getId());
      const body = doc.getBody();
      Object.keys(values).forEach(function (tag) {
        // {{ }} は正規表現のメタ文字を含まないためそのまま置換できる
        body.replaceText(escapeRegex_(tag), String(values[tag] == null ? '' : values[tag]));
      });
      // ヘッダー・フッターにも同じ差込を行う
      ['getHeader', 'getFooter'].forEach(function (fn) {
        const sec = doc[fn]();
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
      throw new Error('契約書雛形の差込に失敗しました（DocID：' + docId + '）：' + err);
    }
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

/* ============================================================
 *  ④ 鍵受領書
 * ========================================================== */

function buildKeyReceiptPdf_(data, master, receiptNo, now) {
  const m = master || {};
  const kagiType = m['鍵種別'] || '玄関錠';
  const kagiCount = m['鍵本数'] || '';

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
    '<table>' +
    '<tr><th style="width:34%">鍵の種別</th><th style="width:16%;text-align:center">本数</th><th>鍵番号・備考</th></tr>' +
    '<tr><td>' + esc_(kagiType) + '</td><td style="text-align:center;font-size:13px;font-weight:bold">' +
    (kagiCount ? esc_(kagiCount) + ' 本' : '　　　本') + '</td><td></td></tr>' +
    '<tr><td>　</td><td style="text-align:center">　　　本</td><td></td></tr>' +
    '<tr><td>　</td><td style="text-align:center">　　　本</td><td></td></tr>' +
    '</table>' +
    '<div class="note">※ 空欄は鍵の引渡し時にご記入ください（メールボックス錠・駐輪場錠・共用部錠など）。</div>' +

    '<div class="sec">受領者</div>' +
    '<table>' + rows_([
      ['受領日', '　　　　　年　　　月　　　日'],
      ['住所', esc_(addr_(data.aZip, data.aPref, data.aAddr))],
      ['氏名', '<b>' + esc_(data.aName) + '</b>　　　　　　　　　　　　　　　　　　㊞'],
      ['電話番号', esc_(data.aMobile)],
    ]) + '</table>' +

    '<div class="sec alt">引渡し担当者（' + esc_(M_CONFIG.COMPANY) + '）</div>' +
    '<table>' + rows_([
      ['引渡日', '　　　　　年　　　月　　　日'],
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

/* ============================================================
 *  書類の一括作成
 * ========================================================== */

/**
 * 見積書・請求書・賃貸借契約書・鍵受領書を作成して案件フォルダへ保存する。
 * 物件マスターに該当物件があれば、その条件・費用・契約書雛形を使用する。
 */
function buildAllDocuments_(caseFolder, data, receiptNo, now, overrides) {
  const master = findMaster_(data.bukken, data.room);
  const cost = buildCostItems_(data, master, overrides);
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.docs);

  const files = [];
  files.push(folder.createFile(buildEstimatePdf_(data, master, cost, receiptNo, now)));
  files.push(folder.createFile(buildInvoicePdf_(data, master, cost, receiptNo, now)));

  // 契約書は雛形の差込に失敗しても、他の書類は残す
  try {
    files.push(folder.createFile(buildLeasePdf_(data, master, cost, receiptNo, now, folder)));
  } catch (err) {
    folder.createFile(Utilities.newBlob(
      '賃貸借契約書の作成に失敗しました。\n' + String(err) +
      '\n\n物件マスターの「契約書雛形DocID」をご確認ください。',
      'text/plain', '★賃貸借契約書_作成エラー.txt'));
  }

  files.push(folder.createFile(buildKeyReceiptPdf_(data, master, receiptNo, now)));
  return files;
}

/**
 * 管理コンソールから書類を作り直す。
 * overrides で金額を上書きできる（例：{ chukaiFee: 55000, kasaiFee: 20000 }）。
 */
function rebuildDocuments_(receiptNo, overrides) {
  const c = getCase_(receiptNo);
  if (!c) return { ok: false, error: '申込が見つかりません：' + receiptNo };
  if (!c.folderId) return { ok: false, error: '案件フォルダIDが記録されていません。' };

  const caseFolder = DriveApp.getFolderById(c.folderId);
  const now = new Date();

  // 受付一覧の記録から、書類作成に必要な項目を組み立てる
  const data = caseToData_(c);
  const files = buildAllDocuments_(caseFolder, data, receiptNo, now, overrides);

  updateStatus_(receiptNo, '契約書類作成済', '契約書類を再作成（' + files.length + '点）');
  return {
    ok: true,
    message: '契約書類を作り直しました（' + files.length + '点）。',
    files: files.map(function (f) { return { name: f.getName(), url: f.getUrl() }; }),
  };
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
