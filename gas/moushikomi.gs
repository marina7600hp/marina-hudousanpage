/**
 * ============================================================
 * 入居申込書（電子申込）バックエンド（Google Apps Script）
 * 有限会社仁方大森マリーナー
 *
 * 役割：
 *  1. moushikomi.html から送信された入居申込を受け付ける
 *  2. 「統一入居申込書」PDFを作成
 *  3. 4つの保証会社ごとの「審査申込転記シート」PDFを作成
 *       ・日本セーフティー株式会社
 *       ・全保連株式会社
 *       ・ナップ賃貸保証株式会社
 *       ・日本賃貸保証株式会社（JID）
 *     各社の申込書の項目名・項目順・選択肢のまま出力するので、
 *     各社所定の様式へそのまま転記（またはFAX送付）できます。
 *  4. Googleドライブへ保存（案件ごとのフォルダに整理）
 *  5. 「入居申込受付一覧」スプレッドシートへ全項目を記録
 *  6. 管理者へ通知メール（PDF添付）／申込者へ受付完了メール
 *
 * セットアップ手順は リポジトリの MOUSHIKOMI_SETUP.md を参照してください。
 * ============================================================
 */

const M_CONFIG = {
  // 通知メールの宛先
  NOTIFY_EMAIL: 'marina.oomori1@gmail.com',
  // 入居申込書PDFを保存するGoogleドライブのフォルダID
  // （MOUSHIKOMI_SETUP.md の手順で作成したフォルダのIDを貼り付けてください）
  FOLDER_ID: '',
  // 管理コンソール（moushikomi-kanri.html）のパスワード
  ADMIN_PASSWORD: 'marina2026',
  COMPANY: '有限会社仁方大森マリーナー',
  COMPANY_TEL: '0823-27-7600',
  COMPANY_FAX: '0823-27-7818',
  COMPANY_ZIP: '737-0821',
  COMPANY_ADDR: '広島県呉市三条4丁目7-20',
  LOG_SPREADSHEET_NAME: '入居申込受付一覧',
  MASTER_SPREADSHEET_NAME: '物件マスター',
  SENDER_NAME: '仁方大森マリーナー 入居申込フォーム',
  // 保存先サブフォルダ名
  SUBFOLDERS: {
    unified: '入居申込書',
    tenki: '保証会社転記シート',
    id: '本人確認書類',
    docs: '契約書類',
  },
};

/**
 * 対応する保証会社と、審査申込の送信先。
 *
 * email    … 審査申込をメールで送る場合の宛先
 * faxEmail … インターネットFAXサービス（メール送信でFAX送信できるサービス）の宛先
 *            例）03XXXXXXXX@fax.example.jp
 *            ※ Google Apps Script から電話回線のFAXを直接送ることはできません。
 *              FAXで送る場合は、インターネットFAXサービスの契約が必要です。
 *              未設定の場合は、FAX送付状つきPDFを作成して手動FAX用に保存します。
 * fax      … 各社の審査専用FAX番号（送付状に印字されます）
 */
const GUARANTORS = [
  { key: 'ns',  name: '日本セーフティー株式会社', short: '日本セーフティー',
    email: '', faxEmail: '', fax: '' },
  { key: 'zh',  name: '全保連株式会社',           short: '全保連',
    email: '', faxEmail: '', fax: '050-3000-2321' },
  { key: 'nap', name: 'ナップ賃貸保証株式会社',   short: 'ナップ賃貸保証',
    email: 'nap-shinsa@nap.co.jp', faxEmail: '', fax: '050-3802-2684' },
  { key: 'jid', name: '日本賃貸保証株式会社',     short: '日本賃貸保証(JID)',
    email: '', faxEmail: '', fax: '03-5620-2910' },
];

/** 申込のステータス */
const M_STATUS = ['受付', '審査依頼済', '審査承認', '審査否認', '契約書類作成済', '契約完了', 'キャンセル'];

/* ============================================================
 *  選択肢の読み替えマップ（統一フォーム → 各社の選択肢）
 * ========================================================== */

/** 雇用形態・職業 */
const MAP_EMPLOYMENT = {
  '公務員':               { ns: '公務員',             zh: '1. 公務員',       nap: '正社員',                          jid: '公務員' },
  '会社経営者':           { ns: '役員',               zh: '2. 会社経営者',   nap: '個人事業主',                      jid: '会社役員' },
  '役員':                 { ns: '役員',               zh: '3. 役員',         nap: '正社員',                          jid: '会社役員' },
  '正社員':               { ns: '正社員',             zh: '4. 正社員',       nap: '正社員',                          jid: '会社員' },
  '契約社員':             { ns: '契約社員',           zh: '5. 契約社員',     nap: '契約社員',                        jid: '会社員' },
  '派遣社員':             { ns: '派遣社員',           zh: '6. 派遣社員',     nap: '派遣社員',                        jid: '派遣' },
  '個人事業主（自営業）': { ns: '自営',               zh: '7. 個人事業主',   nap: '個人事業主',                      jid: '自営業' },
  '個人事業勤務':         { ns: '正社員',             zh: '8. 個人事業勤務', nap: '正社員',                          jid: '会社員' },
  'パート・アルバイト':   { ns: 'パート・アルバイト', zh: '9. アルバイト・パート', nap: 'パート/アルバイト',          jid: 'パート・アルバイト' },
  '学生':                 { ns: '学生',               zh: '10. 学生',        nap: '学生',                            jid: '学生' },
  '年金受給':             { ns: '年金受給',           zh: '11. 年金',        nap: '年金/国民・厚生・共済・遺族・障害', jid: '年金受給' },
  '生活保護受給':         { ns: '生活保護受給',       zh: '12. 生活保護受給（※受給証明書コピー要）', nap: '生活保護', jid: 'その他（生活保護受給）' },
  '失業保険受給':         { ns: '失業保険受給',       zh: '14. 無職',        nap: '無職(求職中含)',                  jid: '無職' },
  '無職（求職中を含む）': { ns: '無職',               zh: '14. 無職',        nap: '無職(求職中含)',                  jid: '無職' },
  'その他':               { ns: '－（該当なし・通信欄へ記載）', zh: '15. その他', nap: '他',                        jid: 'その他' },
};

/** 住居区分（全保連には該当欄なし） */
const MAP_RESIDENCE = {
  '自己所有（持家）':     { ns: '持家',           nap: '自己所有', jid: '自己所有' },
  '家族所有・親族同居':   { ns: '親族同居',       nap: '家族所有', jid: '賃貸・その他' },
  '賃貸':                 { ns: '賃貸',           nap: '賃貸',     jid: '賃貸・その他' },
  '社宅・寮':             { ns: '他（社宅・寮）', nap: '社宅',     jid: '社宅・寮' },
  'その他':               { ns: '他',             nap: '他',       jid: '賃貸・その他' },
};

/** 物件用途 */
const MAP_USE = {
  '住居用':         { ns: '住居',                     zh: '住居用',         nap: '居住用',       jid: '住居用' },
  '住居用（学生）': { ns: '住居',                     zh: '住居学生用',     nap: '居住用学生',   jid: '住居用(学生プラン)' },
  '事務所':         { ns: '事務所',                   zh: '事務所',         nap: '事務所',       jid: '事業用' },
  '店舗':           { ns: '店舗',                     zh: '店舗',           nap: '店舗',         jid: '事業用' },
  '倉庫':           { ns: 'その他（倉庫）',           zh: '倉庫',           nap: '倉庫等',       jid: '事業用' },
  'SOHO':           { ns: 'その他（SOHO）',           zh: '事務所',         nap: 'SOHO',         jid: '事業用' },
  '駐車場':         { ns: '駐車場',                   zh: '駐車場',         nap: '駐車場',       jid: '駐車場' },
  'トランクルーム': { ns: 'その他（トランクルーム）', zh: 'トランクルーム', nap: 'トランクルーム', jid: 'その他' },
  'コンテナ':       { ns: 'その他（コンテナ）',       zh: '倉庫',           nap: 'コンテナ',     jid: 'その他' },
  'その他':         { ns: 'その他',                   zh: '－（該当なし）', nap: '他',           jid: 'その他' },
};

/** 緊急連絡先の続柄（全保連は 親子／兄弟・姉妹／親族／その他 の4択） */
const MAP_RELATION_ZH = {
  '父': '親子', '母': '親子', '子': '親子',
  '兄弟・姉妹': '兄弟／姉妹',
  '配偶者': '親族', 'その他親族': '親族',
};

/** 統一フォームの値を各社の値へ読み替え */
function conv_(map, value, key) {
  if (!value) return '';
  const row = map[value];
  if (!row) return value;
  return row[key] || value;
}

/* ============================================================
 *  Web アプリのエンドポイント
 * ========================================================== */

/**
 * 管理コンソール（moushikomi-kanri.html）からのGET。
 * action なしでブラウザから開いた場合は稼働確認メッセージを返す。
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  if (!action) {
    return ContentService.createTextOutput('入居申込フォーム受付システムは稼働中です。');
  }
  try {
    if (p.pw !== M_CONFIG.ADMIN_PASSWORD) {
      return json_({ ok: false, error: 'パスワードが違います。' });
    }
    if (action === 'list') {
      return json_({ ok: true, cases: listCases_(), guarantors: guarantorInfo_() });
    }
    if (action === 'case') {
      return json_({ ok: true, data: getCase_(p.receiptNo) });
    }
    if (action === 'master') {
      return json_({ ok: true, master: listMaster_(), masterUrl: masterUrl_() });
    }
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** フォーム／管理コンソールからのPOST受付 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ---- 管理コンソールからの操作（パスワード必須） ----
    if (data.action) {
      if (data.pw !== M_CONFIG.ADMIN_PASSWORD) {
        return json_({ ok: false, error: 'パスワードが違います。' });
      }
      return handleAdmin_(data);
    }

    // ---- 以下、入居申込フォームからの送信 ----

    // ハニーポット（スパム対策）：非表示欄に入力があれば黙って成功を返す
    if (data.website) {
      return json_({ ok: true, receiptNo: '-' });
    }

    // 必須項目チェック
    const missing = checkRequired_(data);
    if (missing) {
      return json_({ ok: false, error: '必須項目が不足しています：' + missing });
    }

    const now = new Date();
    const receiptNo = 'M' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');

    // 保存先フォルダ（案件ごと）
    const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
    const caseName = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_' +
      safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName);
    const caseFolder = getOrCreateSubfolder_(parent, caseName);

    // 1) 統一入居申込書PDF
    const unifiedFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.unified);
    const unifiedPdf = buildUnifiedPdf_(data, receiptNo, now);
    const unifiedFile = unifiedFolder.createFile(unifiedPdf);

    // 2) 保証会社ごとの転記シートPDF（4社分をあらかじめ用意しておく）
    const tenkiFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.tenki);
    const tenkiFiles = GUARANTORS.map(function (g) {
      const blob = buildTenkiPdf_(g, data, receiptNo, now);
      return tenkiFolder.createFile(blob);
    });

    // 3) 本人確認書類（表面・裏面ほか）を保存
    let idFiles = [];
    try {
      idFiles = saveFiles_(caseFolder, data, receiptNo);
    } catch (err) {
      // 添付の保存に失敗しても申込自体は成立させる（通知メールで知らせる）
    }

    // 4) 契約書類（見積書・請求書・賃貸借契約書・鍵受領書）を自動作成
    let docFiles = [];
    let docError = '';
    try {
      docFiles = buildAllDocuments_(caseFolder, data, receiptNo, now);
    } catch (err) {
      docError = String(err);
    }

    // 5) 受付一覧スプレッドシートに記録
    let sheetError = '';
    try {
      appendLog_(data, receiptNo, now, unifiedFile.getUrl(),
        caseFolder.getUrl(), caseFolder.getId());
    } catch (err) {
      sheetError = String(err); // シート記録失敗でも受付自体は成立させる
    }

    // 6) 管理者へ通知メール（PDF添付）
    //    ※ 保証会社への審査依頼は自動送信しません。管理コンソールから
    //      担当者がどの保証会社に流すかを選んで送信します。
    try {
      sendNotifyMail_(data, receiptNo, now, unifiedFile, tenkiFiles, idFiles, docFiles,
        caseFolder, sheetError, docError);
    } catch (err) {
      // 通知メールの失敗は受付に影響させない
    }

    // 5) 申込者へ受付完了メール
    if (data.aEmail) {
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

/** 必須項目のチェック（不足があれば項目名を返す） */
function checkRequired_(data) {
  const need = [
    ['bukken', '物件名'], ['room', '号室'],
    ['aName', '申込者氏名'], ['aKana', '申込者フリガナ'],
    ['aBirth', '申込者生年月日'], ['aMobile', '申込者携帯電話'],
    ['eName', '緊急連絡先氏名'], ['eMobile', '緊急連絡先携帯電話'],
  ];
  const miss = need.filter(function (n) { return !data[n[0]]; }).map(function (n) { return n[1]; });
  return miss.length ? miss.join('、') : '';
}

/** 保証会社の一覧（管理コンソールのボタン表示用） */
function guarantorInfo_() {
  return GUARANTORS.map(function (g) {
    return {
      key: g.key, name: g.name, short: g.short, fax: g.fax,
      // 送信手段：メール／インターネットFAX／未設定（手動FAX用PDFのみ作成）
      canEmail: !!g.email, canFax: !!g.faxEmail,
    };
  });
}

/* ============================================================
 *  本人確認書類などの添付ファイル保存
 * ========================================================== */

/**
 * フォームから送られた data:URL 形式のファイルをドライブへ保存する。
 * 返り値は保存したファイルの配列（先頭が本人確認書類の表面）。
 */
function saveFiles_(caseFolder, data, receiptNo) {
  const list = data.files || [];
  if (!list.length) return [];
  const folder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.id);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');

  return list.map(function (f) {
    const m = String(f.dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    const bytes = Utilities.base64Decode(m[2]);
    const ext = (f.name && f.name.indexOf('.') >= 0) ? f.name.slice(f.name.lastIndexOf('.')) :
      (m[1] === 'application/pdf' ? '.pdf' : '.jpg');
    const name = stamp + '_' + safeName_(data.aName) + '_' + safeName_(f.role || '添付') + ext;
    const blob = Utilities.newBlob(bytes, m[1], name);
    return folder.createFile(blob);
  }).filter(function (f) { return f; });
}

/* ============================================================
 *  管理コンソールからの操作
 * ========================================================== */

function handleAdmin_(data) {
  const action = data.action;

  if (action === 'ping') {
    return json_({ ok: true, message: '接続できました。' });
  }

  // 保証会社へ審査依頼を送信（どの会社に流すかは担当者が選択）
  if (action === 'sendGuarantor') {
    return json_(sendToGuarantor_(data.receiptNo, data.guarantorKey, data.method, data.message));
  }

  // ステータス・審査結果の更新
  if (action === 'updateStatus') {
    updateStatus_(data.receiptNo, data.status, data.resultNote);
    return json_({ ok: true });
  }

  // 契約書類の再作成（物件マスターや金額を直したあとに使う）
  if (action === 'rebuildDocs') {
    const r = rebuildDocuments_(data.receiptNo, data.overrides || {});
    return json_(r);
  }

  // 物件マスターの登録・更新
  if (action === 'saveMaster') {
    saveMaster_(data.row || {});
    return json_({ ok: true });
  }

  return json_({ ok: false, error: 'unknown action: ' + action });
}

/**
 * 選択された保証会社へ審査依頼を送信する。
 * method: 'email' … メール送信 / 'fax' … インターネットFAX / 'manual' … 送付状PDFのみ作成
 */
function sendToGuarantor_(receiptNo, guarantorKey, method, message) {
  const g = GUARANTORS.filter(function (x) { return x.key === guarantorKey; })[0];
  if (!g) return { ok: false, error: '保証会社が特定できません。' };

  const c = getCase_(receiptNo);
  if (!c) return { ok: false, error: '申込が見つかりません：' + receiptNo };

  const caseFolder = DriveApp.getFolderById(c.folderId);
  const tenkiFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.tenki);
  const idFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.id);

  // 添付：該当社の転記シート＋本人確認書類一式
  const attachments = [];
  const it = tenkiFolder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(g.short) >= 0) attachments.push(f.getAs(MimeType.PDF));
  }
  const it2 = idFolder.getFiles();
  while (it2.hasNext()) attachments.push(it2.next().getBlob());

  if (!attachments.length) {
    return { ok: false, error: '添付する転記シートが見つかりません。' };
  }

  const subject = '【賃貸保証委託申込】' + c.bukken + ' ' + c.room + '／' + c.aName + ' 様（' + receiptNo + '）';
  const body = [
    g.name + '　審査ご担当者様',
    '',
    'いつもお世話になっております。' + M_CONFIG.COMPANY + 'でございます。',
    '下記のとおり賃貸保証委託のお申込みをいたしますので、ご審査のほどよろしくお願い申し上げます。',
    '',
    '───────────────────',
    '受付番号　　：' + receiptNo,
    '物件　　　　：' + c.bukken + '　' + c.room,
    '申込者　　　：' + c.aName + '　様',
    '月額賃料合計：' + yen_(c.rentTotal),
    '───────────────────',
    '',
    '【添付書類】',
    '　・賃貸保証委託申込書（転記シート）',
    '　・本人確認書類（表面・裏面）',
    '',
    (message ? message + '\n' : ''),
    'ご不明な点がございましたら下記までご連絡ください。',
    '',
    '――',
    M_CONFIG.COMPANY,
    '〒' + M_CONFIG.COMPANY_ZIP + '　' + M_CONFIG.COMPANY_ADDR,
    'TEL：' + M_CONFIG.COMPANY_TEL + '　FAX：' + M_CONFIG.COMPANY_FAX,
  ].filter(function (l) { return l !== ''; }).join('\n');

  let to = '';
  let how = '';
  if (method === 'fax') {
    if (!g.faxEmail) {
      return {
        ok: false,
        error: g.short + ' のインターネットFAX送信先が未設定です。' +
          'moushikomi.gs の GUARANTORS に faxEmail を設定するか、「送付状のみ作成」を選んで手動でFAX送信してください。'
      };
    }
    to = g.faxEmail;
    how = 'FAX（' + g.fax + '）';
  } else if (method === 'email') {
    if (!g.email) {
      return {
        ok: false,
        error: g.short + ' のメール送信先が未設定です。moushikomi.gs の GUARANTORS に email を設定してください。'
      };
    }
    to = g.email;
    how = 'メール（' + g.email + '）';
  }

  // FAX送付状PDFを作成（FAX送信時・手動送信時）
  if (method === 'fax' || method === 'manual') {
    const cover = buildFaxCoverPdf_(g, c, receiptNo, attachments.length, message);
    tenkiFolder.createFile(cover);
    attachments.unshift(cover);
  }

  if (method === 'manual') {
    updateStatus_(receiptNo, '審査依頼済', g.short + '：送付状PDFを作成（手動FAX）');
    return {
      ok: true,
      message: g.short + ' 宛のFAX送付状PDFを案件フォルダに作成しました。印刷して ' +
        (g.fax || '各社所定のFAX番号') + ' へ送信してください。'
    };
  }

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: body,
    name: M_CONFIG.COMPANY,
    attachments: attachments,
    replyTo: M_CONFIG.NOTIFY_EMAIL,
  });

  updateStatus_(receiptNo, '審査依頼済', g.short + '：' + how + ' で送信');
  return { ok: true, message: g.short + ' へ ' + how + ' で審査依頼を送信しました。' };
}

/** FAX送付状PDF */
function buildFaxCoverPdf_(g, c, receiptNo, attachCount, message) {
  const now = new Date();
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日') + '</div>' +
    '<h1>Ｆ Ａ Ｘ 送 信 票</h1>' +
    '<div class="sub">賃貸保証委託申込書 送付のご案内</div>' +
    '<table>' + rows_([
      ['送信先', esc_(g.name) + '　審査ご担当者様'],
      ['FAX番号', '<b>' + esc_(g.fax || '（各社所定の番号）') + '</b>'],
      ['送信元', esc_(M_CONFIG.COMPANY) + '<br>〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR)],
      ['TEL／FAX', esc_(M_CONFIG.COMPANY_TEL) + '　／　' + esc_(M_CONFIG.COMPANY_FAX)],
      ['送信日', Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm')],
      ['送信枚数', '本紙を含む <b>' + (attachCount + 1) + '</b> 枚'],
    ]) + '</table>' +
    '<div class="sec">お申込内容</div>' +
    '<table>' + rows_([
      ['受付番号', esc_(receiptNo)],
      ['物件名・号室', esc_(c.bukken) + '　' + esc_(c.room)],
      ['申込者', '<b>' + esc_(c.aName) + '</b>　様'],
      ['月額賃料合計', yen_(c.rentTotal)],
    ]) + '</table>' +
    '<div class="lead">' +
    'いつもお世話になっております。<br>' +
    '標記につきまして、賃貸保証委託のお申込みをいたします。ご審査のほどよろしくお願い申し上げます。<br>' +
    '本紙に続き、賃貸保証委託申込書（転記シート）および本人確認書類を送信いたします。' +
    (message ? '<br><br>' + esc_(message) : '') +
    '</div>' +
    '<div class="foot">本FAXの内容にお心当たりがない場合は、お手数ですが上記TELまでご連絡ください。</div>' +
    '</body></html>';

  const name = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_FAX送付状_' +
    safeName_(g.short) + '_' + safeName_(c.aName) + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF).setName(name);
}

/* ============================================================
 *  表示用のヘルパー
 * ========================================================== */

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

function safeName_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:\*\?"<>\|]/g, '_').slice(0, 40) || '無題';
}

/** 数値を「12,345円」に */
function yen_(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9\-]/g, ''), 10);
  return (isNaN(n) ? 0 : n).toLocaleString('en-US') + '円';
}

/** 数値をそのまま（カンマ区切り） */
function num_(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9\-]/g, ''), 10);
  return isNaN(n) ? '' : n.toLocaleString('en-US');
}

/** 「2024-04-01」→「2024年4月1日」 */
function jpDate_(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(s);
  return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
}

/** 「2024-04-01」→「4月1日」（全保連の申込日・入居日欄用） */
function mdDate_(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(s);
  return Number(m[2]) + '月' + Number(m[3]) + '日';
}

/** 西暦→和暦（日本セーフティーの T・S・H・R 欄用） */
function wareki_(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const v = y * 10000 + mo * 100 + d;
  let g = '', gy = 0;
  if (v >= 20190501) { g = 'R（令和）'; gy = y - 2018; }
  else if (v >= 19890108) { g = 'H（平成）'; gy = y - 1988; }
  else if (v >= 19261225) { g = 'S（昭和）'; gy = y - 1925; }
  else if (v >= 19120730) { g = 'T（大正）'; gy = y - 1911; }
  else { return ''; }
  return g + ' ' + gy + '年' + mo + '月' + d + '日';
}

/**
 * 選択肢を「☑ 選んだもの　☐ その他」の形で表示する。
 * 各社の申込用紙のチェック欄をそのまま再現し、転記ミスを防ぐ。
 */
function pick_(value, options) {
  const v = String(value == null ? '' : value).trim();
  return options.map(function (o) {
    return (o === v ? '<b>☑ ' + esc_(o) + '</b>' : '<span class="off">☐ ' + esc_(o) + '</span>');
  }).join('　');
}

/** チェックボックス（真偽値）を「☑／☐」で表示 */
function flag_(on, label) {
  return on ? '<b>☑ ' + esc_(label) + '</b>' : '<span class="off">☐ ' + esc_(label) + '</span>';
}

/** 未入力を「―」で埋める */
function or_(v, alt) {
  const s = String(v == null ? '' : v).trim();
  return s !== '' ? s : (alt || '<span class="off">―</span>');
}

/** 郵便番号を 737-0821 形式に */
function zip_(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  return s.length === 7 ? s.slice(0, 3) + '-' + s.slice(3) : String(v || '');
}

/** 〒 + 都道府県 + 住所 */
function addr_(z, pref, addr) {
  const parts = [];
  if (z) parts.push('〒' + zip_(z));
  const rest = (pref || '') + (addr || '');
  if (rest) parts.push(rest);
  return parts.join('　');
}

/* ============================================================
 *  PDF共通スタイル
 * ========================================================== */

function pdfStyle_() {
  return '<style>' +
    'body{font-family:"Noto Sans JP","Hiragino Sans",sans-serif;color:#111;font-size:11px;margin:18px 20px;}' +
    'h1{font-size:17px;text-align:center;letter-spacing:3px;margin:2px 0 2px;}' +
    '.sub{text-align:center;font-size:11px;color:#444;margin-bottom:10px;}' +
    '.meta{text-align:right;font-size:10px;color:#444;line-height:1.6;}' +
    '.lead{font-size:10.5px;color:#333;line-height:1.7;border:1px solid #999;background:#f6f6f6;padding:7px 9px;margin:8px 0 12px;}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:10px;}' +
    'th,td{border:1px solid #777;padding:5px 7px;font-size:10.5px;vertical-align:top;line-height:1.6;}' +
    'th{background:#eef2f4;width:23%;text-align:left;font-weight:bold;}' +
    'td.v{background:#fff;}' +
    '.sec{font-size:12px;font-weight:bold;color:#fff;background:#005f73;padding:4px 9px;margin:14px 0 5px;}' +
    '.sec.alt{background:#334155;}' +
    '.off{color:#999;}' +
    '.note{font-size:9.5px;color:#555;line-height:1.7;margin:6px 0 10px;}' +
    '.warn{font-size:10px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;padding:6px 8px;margin:8px 0;line-height:1.7;}' +
    '.foot{margin-top:14px;font-size:9.5px;color:#555;line-height:1.7;border-top:1px solid #ccc;padding-top:7px;}' +
    'table.people th{width:auto;text-align:center;background:#eef2f4;}' +
    'table.people td{text-align:left;}' +
    '</style>';
}

/** 行の配列 → <tr> 群（値にHTMLを含められる） */
function rows_(list) {
  return list.filter(function (r) { return r; }).map(function (r) {
    return '<tr><th>' + esc_(r[0]) + '</th><td class="v">' + (r[1] == null ? '' : r[1]) + '</td></tr>';
  }).join('');
}

/* ============================================================
 *  ① 統一入居申込書 PDF
 * ========================================================== */

function buildUnifiedPdf_(data, receiptNo, now) {
  const d = data;

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">受付番号：' + esc_(receiptNo) + '<br>' +
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm') + '</div>' +
    '<h1>入居申込書 兼 賃貸保証委託申込書</h1>' +
    '<div class="sub">' + esc_(M_CONFIG.COMPANY) + '</div>' +

    '<div class="lead">本書は、申込者がWebフォーム（入居申込フォーム）に入力・送信した内容をもとに自動作成された統一様式の入居申込書です。' +
    '申込者は、個人情報の保証会社への提供、個人信用情報機関への照会・登録、在籍確認等の連絡、反社会的勢力でないことの表明、' +
    'および記載内容が事実であることについて、フォーム上で同意のうえ送信しています。</div>' +

    '<div class="sec">1. お申込物件</div>' +
    '<table>' + rows_([
      ['申込日', jpDate_(d.applyDate)],
      ['入居希望日', d.moveInUndecided ? '未定' : jpDate_(d.moveInDate)],
      ['申込区分', esc_(d.applyKind) +
        (d.noArrears ? '　／　滞納なし' : '') + (d.leaseback ? '　／　リースバック' : '')],
      ['物件名（フリガナ）', esc_(d.bukkenKana)],
      ['物件名', esc_(d.bukken) + '　' + esc_(d.room) + (d.isKodate ? '（戸建）' : '')],
      ['物件所在地', esc_(addr_(d.bukkenZip, d.bukkenPref, d.bukkenAddr))],
      ['物件用途', esc_(d.use) + (d.useDetail ? '（' + esc_(d.useDetail) + '）' : '') +
        (d.kaigoDaycare ? '　介護施設：デイケア' : '') + (d.kaigoStay ? '　宿泊有' : '')],
      ['入居理由・転居理由', esc_(d.moveReason)],
    ]) + '</table>' +

    '<div class="sec alt">2. お家賃等（月額）</div>' +
    '<table>' + rows_([
      ['① 家賃', yen_(d.rent)],
      ['② 管理費・共益費', yen_(d.kanrihi)],
      ['③ 駐車場・トランクルーム', yen_(d.parking)],
      ['④ 水道料・町（区）費', yen_(d.suido)],
      ['⑤ 収納代行費用', yen_(d.shunou)],
      ['⑥ その他' + (d.otherFeeName ? '（' + d.otherFeeName + '）' : ''), yen_(d.otherFee)],
      ['月額賃料合計（①〜⑥）', '<b>' + yen_(d.rentTotal) + '</b>'],
      ['敷金・保証金', yen_(d.shikikin)],
      ['礼金', yen_(d.reikin)],
      ['敷引・償却', yen_(d.shikibiki)],
    ]) + '</table>' +

    '<div class="sec">3. 申込者（ご契約者）</div>' +
    '<table>' + rows_([
      ['フリガナ', esc_(d.aKana)],
      ['氏名', '<b>' + esc_(d.aName) + '</b>'],
      ['性別', esc_(d.aSex)],
      ['生年月日', jpDate_(d.aBirth) + '（' + esc_(d.aAge) + '歳）　' + esc_(wareki_(d.aBirth))],
      ['配偶者', esc_(d.aSpouse)],
      ['国籍', esc_(d.aNationality) + (d.aZairyu ? '　／　' + esc_(d.aZairyu) : '')],
      ['運転免許証番号', or_(esc_(d.aLicense))],
      ['現住所', esc_(addr_(d.aZip, d.aPref, d.aAddr))],
      ['現在のお住まい', esc_(d.aResidence) +
        (d.aResidenceYears ? '　居住 ' + esc_(d.aResidenceYears) + '年' + (d.aResidenceMonths ? esc_(d.aResidenceMonths) + 'ヶ月' : '') : '') +
        (parseInt(d.aCurRent || '0', 10) > 0 ? '　現家賃 ' + yen_(d.aCurRent) : '')],
      ['携帯電話', '<b>' + esc_(d.aMobile) + '</b>'],
      ['自宅電話', or_(esc_(d.aTel))],
      ['メールアドレス', esc_(d.aEmail)],
      ['健康保険', esc_(d.aHoken)],
      ['雇用形態・職業', esc_(d.aEmployment) + (d.aEmploymentOther ? '（' + esc_(d.aEmploymentOther) + '）' : '')],
      ['勤務先（学校）名称', esc_(d.aCompany)],
      ['勤務先所在地', esc_(addr_(d.aCompanyZip, d.aCompanyPref, d.aCompanyAddr))],
      ['勤務先電話番号', esc_(d.aCompanyTel)],
      ['部署・役職', or_(esc_(d.aDept))],
      ['業種・職種', esc_(d.aIndustry) + (d.aJobType ? '　／　' + esc_(d.aJobType) : '')],
      ['年収', num_(d.aIncomeYear) + ' 万円'],
      ['月収（手取）', num_(d.aIncomeMonth) + ' 万円'],
      ['勤続年数', esc_(d.aWorkYears) + '年' + (d.aWorkMonths ? esc_(d.aWorkMonths) + 'ヶ月' : '')],
      ['従業員数', d.aEmployees ? num_(d.aEmployees) + ' 人' : or_('')],
    ]) + '</table>' +

    '<div class="sec alt">4. ご入居者</div>' +
    '<table>' + rows_([
      ['入居形態', esc_(d.liveKind)],
      ['入居人数', '成人 ' + esc_(d.adults) + ' 人　／　未成年 ' + esc_(d.minors) + ' 人　／　合計 ' + esc_(d.totalPeople) + ' 人'],
    ]) + '</table>' +
    peopleTable_(d.kyoju) +

    '<div class="sec">5. 緊急連絡先</div>' +
    '<table>' + rows_([
      ['種別', esc_(d.eKind)],
      ['フリガナ', esc_(d.eKana)],
      ['氏名', '<b>' + esc_(d.eName) + '</b>'],
      ['続柄', esc_(d.eRelation)],
      ['性別', esc_(d.eSex)],
      ['生年月日', jpDate_(d.eBirth) + (d.eAge ? '（' + esc_(d.eAge) + '歳）' : '')],
      ['現住所', esc_(addr_(d.eZip, d.ePref, d.eAddr))],
      ['携帯電話', '<b>' + esc_(d.eMobile) + '</b>'],
      ['自宅電話', or_(esc_(d.eTel))],
      ['お住まいの区分', or_(esc_(d.eResidence))],
      ['国籍', or_(esc_(d.eNationality))],
      ['配偶者', or_(esc_(d.eSpouse))],
      ['お勤め先', or_(esc_(d.eCompany))],
    ]) + '</table>' +

    '<div class="sec alt">6. 連帯保証人（予定者）</div>' +
    (d.hasGuarantor === 'あり'
      ? '<table>' + rows_([
        ['フリガナ', esc_(d.gKana)],
        ['氏名', '<b>' + esc_(d.gName) + '</b>'],
        ['続柄', esc_(d.gRelation)],
        ['性別', esc_(d.gSex)],
        ['生年月日', jpDate_(d.gBirth) + (d.gAge ? '（' + esc_(d.gAge) + '歳）' : '') + '　' + esc_(wareki_(d.gBirth))],
        ['現住所', esc_(addr_(d.gZip, d.gPref, d.gAddr))],
        ['お住まいの区分', or_(esc_(d.gResidence))],
        ['国籍', or_(esc_(d.gNationality))],
        ['携帯電話', '<b>' + esc_(d.gMobile) + '</b>'],
        ['自宅電話', or_(esc_(d.gTel))],
        ['雇用形態・職業', esc_(d.gEmployment)],
        ['勤務先名称', esc_(d.gCompany)],
        ['勤務先所在地', esc_(addr_(d.gCompanyZip, d.gCompanyPref, d.gCompanyAddr))],
        ['勤務先電話番号', esc_(d.gCompanyTel)],
        ['業種・職種', esc_(d.gIndustry) + (d.gJobType ? '　／　' + esc_(d.gJobType) : '')],
        ['勤続年数', esc_(d.gWorkYears) + '年' + (d.gWorkMonths ? esc_(d.gWorkMonths) + 'ヶ月' : '')],
        ['年収', num_(d.gIncomeYear) + ' 万円'],
        ['月収（手取）', d.gIncomeMonth ? num_(d.gIncomeMonth) + ' 万円' : or_('')],
      ]) + '</table>'
      : '<table><tr><th>連帯保証人</th><td class="v">なし（保証人不要プラン）</td></tr></table>') +

    (d.note ? '<div class="sec">7. 通信欄</div><table><tr><td class="v">' + esc_(d.note) + '</td></tr></table>' : '') +

    '<div class="sec alt">同意事項・電子署名</div>' +
    '<table>' + rows_([
      ['同意状況', d.agreed
        ? '☑ 個人情報の提供　☑ 個人信用情報機関への照会・登録　☑ 在籍確認等の連絡<br>☑ 反社会的勢力でないことの表明　☑ 記載内容が事実であること'
        : '<b>未同意</b>'],
      ['電子署名（申込者）', '<b>' + esc_(d.signName) + '</b>'],
      ['署名日時', Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm')],
    ]) + '</table>' +

    '<div class="foot">' +
    '本書は、申込者本人がWebフォームに入力・送信した内容をもとに自動作成されたものです。フォーム送信をもって入居申込の受付が完了しています。<br>' +
    esc_(M_CONFIG.COMPANY) + '　〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR) +
    '　TEL：' + esc_(M_CONFIG.COMPANY_TEL) + '　FAX：' + esc_(M_CONFIG.COMPANY_FAX) +
    '</div></body></html>';

  const fileName = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_入居申込書_' +
    safeName_(d.bukken) + '_' + safeName_(d.room) + '_' + safeName_(d.aName) + '.pdf';

  return Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
}

/** 同居人の一覧テーブル */
function peopleTable_(list) {
  const ks = list || [];
  if (!ks.length) return '';
  return '<table class="people">' +
    '<tr><th>#</th><th>フリガナ</th><th>氏名</th><th>続柄</th><th>性別</th><th>生年月日</th><th>年齢</th>' +
    '<th>携帯電話</th><th>勤務先・学校</th><th>勤務先TEL</th><th>勤続</th><th>年収</th></tr>' +
    ks.map(function (k, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc_(k.kana) + '</td><td>' + esc_(k.name) + '</td>' +
        '<td>' + esc_(k.relation) + '</td><td>' + esc_(k.sex) + '</td><td>' + jpDate_(k.birth) + '</td>' +
        '<td>' + esc_(k.age) + '</td><td>' + esc_(k.tel) + '</td><td>' + esc_(k.company) + '</td>' +
        '<td>' + esc_(k.companyTel) + '</td><td>' + esc_(k.workYears) + '</td><td>' + esc_(k.income) + '</td></tr>';
    }).join('') + '</table>';
}

/* ============================================================
 *  ② 保証会社ごとの転記シート PDF
 * ========================================================== */

function buildTenkiPdf_(g, data, receiptNo, now) {
  let body = '';
  if (g.key === 'ns') body = tenkiNS_(data);
  else if (g.key === 'zh') body = tenkiZH_(data);
  else if (g.key === 'nap') body = tenkiNAP_(data);
  else body = tenkiJID_(data);

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + pdfStyle_() + '</head><body>' +
    '<div class="meta">受付番号：' + esc_(receiptNo) + '<br>' +
    '作成日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm') + '</div>' +
    '<h1>' + esc_(g.short) + '　審査申込 転記シート</h1>' +
    '<div class="sub">' + esc_(g.name) + '　賃貸保証委託申込書' +
    (g.fax ? '（審査FAX：' + esc_(g.fax) + '）' : '') + '</div>' +

    '<div class="lead">' +
    '統一入居申込書の内容を、<b>' + esc_(g.name) + 'の申込書の項目名・項目順</b>に並べ替えたものです。' +
    '各項目を同社所定の様式へそのまま転記してください。' +
    'チェック欄は <b>☑</b> が該当、<span class="off">☐</span> が非該当です。' +
    '<span class="off">―</span> は申込者の未入力項目です。' +
    '</div>' +

    body +

    '<div class="foot">' +
    '本シートは、申込者がWebフォームに入力した内容から自動生成した転記補助資料です。' +
    '各社の様式・選択肢は改定される場合がありますので、提出前に最新の申込書と照合してください。<br>' +
    esc_(M_CONFIG.COMPANY) + '　TEL：' + esc_(M_CONFIG.COMPANY_TEL) + '　FAX：' + esc_(M_CONFIG.COMPANY_FAX) +
    '</div></body></html>';

  const fileName = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_転記_' + safeName_(g.short) + '_' +
    safeName_(data.bukken) + '_' + safeName_(data.room) + '_' + safeName_(data.aName) + '.pdf';

  return Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
}

/* ---------- 日本セーフティー株式会社 ---------- */
function tenkiNS_(d) {
  const emp = conv_(MAP_EMPLOYMENT, d.aEmployment, 'ns');
  const gEmp = conv_(MAP_EMPLOYMENT, d.gEmployment, 'ns');
  const res = conv_(MAP_RESIDENCE, d.aResidence, 'ns');
  const gRes = conv_(MAP_RESIDENCE, d.gResidence, 'ns');
  const jobOpts = ['公務員', '役員', '正社員', '契約社員', '派遣社員', 'パート・アルバイト', '自営', '学生',
    '失業保険受給', '年金受給', '生活保護受給', '無職'];
  const ks = d.kyoju || [];

  return '<div class="sec">取扱店欄</div>' +
    '<table>' + rows_([
      ['取扱店NO.', or_(esc_(d.agentNo))],
      ['担当者', or_(esc_(d.agentStaff) || esc_(d.agentCompany))],
      ['TEL／FAX', esc_(M_CONFIG.COMPANY_TEL) + '　／　' + esc_(M_CONFIG.COMPANY_FAX)],
      ['申込日', jpDate_(d.applyDate)],
      ['申込区分', pick_(d.applyKind, ['新規申込', '入居中申込'])],
      ['入居予定日', d.moveInUndecided ? '未定' : jpDate_(d.moveInDate)],
      ['物件用途', pick_(conv_(MAP_USE, d.use, 'ns').replace(/（.*）/, ''), ['住居', '店舗', '事務所', '駐車場', 'その他']) +
        (conv_(MAP_USE, d.use, 'ns').indexOf('その他') === 0 ? '　→　' + esc_(conv_(MAP_USE, d.use, 'ns')) : '') +
        (d.useDetail ? '　' + esc_(d.useDetail) : '')],
      ['フリガナ（物件名）', esc_(d.bukkenKana)],
      ['物件名', esc_(d.bukken)],
      ['号室', esc_(d.room)],
      ['所在地', esc_(addr_(d.bukkenZip, d.bukkenPref, d.bukkenAddr))],
      ['仲介店名／TEL', or_(esc_(d.chukai)) + '　／　' + or_(esc_(d.chukaiTel))],
    ]) + '</table>' +

    '<div class="sec alt">賃料・一時金</div>' +
    '<table>' + rows_([
      ['礼金', yen_(d.reikin)],
      ['敷金（一括納付）', yen_(d.shikikin)],
      ['保証金（一括納付）', or_('')],
      ['解約引／償却', yen_(d.shikibiki)],
      ['月額賃料（税込）', yen_(d.rent)],
      ['管理費／共益費', yen_(d.kanrihi)],
      ['駐車場', yen_(d.parking)],
      ['合計（税込）月額保証対象額', '<b>' + yen_(d.rentTotal) + '</b>'],
      ['継続保証料 支払方法', pick_(d.planNSPay, ['月払い（弊社集金代行サービス利用必須）', '年払い'])],
      ['賃貸保証プラン', pick_(d.planNS, ['プラス1（保証人あり）', 'パートナー（保証人なし）']) +
        '<br><span class="note">※ 申込者の連帯保証人：' + esc_(d.hasGuarantor) + '</span>'],
      ['賃料支払日／支払方法', '毎月 ' + or_(esc_(d.payDay)) + ' 日　／　' + pick_(d.payMethod, ['振込', '口座振替', '持参'])],
    ]) + '</table>' +

    '<div class="sec">申込者</div>' +
    '<table>' + rows_([
      ['フリガナ', esc_(d.aKana)],
      ['氏名（※自署）', '<b>' + esc_(d.aName) + '</b>'],
      ['男／女', pick_(d.aSex, ['男', '女'])],
      ['現住所', esc_(addr_(d.aZip, d.aPref, d.aAddr))],
      ['現住所の区分', pick_(res.replace(/（.*）/, ''), ['持家', '賃貸', '親族同居', '他']) +
        (parseInt(d.aCurRent || '0', 10) > 0 ? '　家賃 ' + num_(Math.round(parseInt(d.aCurRent, 10) / 10000)) + '万円/月' : '')],
      ['生年月日（T・S・H）', esc_(wareki_(d.aBirth))],
      ['生年月日（西暦）', jpDate_(d.aBirth)],
      ['年齢', esc_(d.aAge) + ' 歳'],
      ['配偶者', pick_(d.aSpouse, ['有', '無'])],
      ['携帯TEL', '<b>' + esc_(d.aMobile) + '</b>'],
      ['自宅TEL', or_(esc_(d.aTel))],
      ['職業', pick_(emp, jobOpts)],
      ['健康保険', pick_(d.aHoken === '国民健康保険' ? '国民保険' : d.aHoken, ['社会保険', '国民保険', 'なし'])],
      ['転居理由', esc_(d.moveReason)],
      ['勤務先／学校名', esc_(d.aCompany)],
      ['所在地', esc_(addr_(d.aCompanyZip, d.aCompanyPref, d.aCompanyAddr))],
      ['勤務先TEL', esc_(d.aCompanyTel)],
      ['勤続年数', esc_(d.aWorkYears) + ' 年'],
      ['月収', '<b>' + num_(d.aIncomeMonth) + ' 万</b>'],
      ['業種', esc_(d.aIndustry)],
      ['職種', or_(esc_(d.aJobType))],
    ]) + '</table>' +

    '<div class="sec alt">入居者</div>' +
    '<table>' + rows_([
      ['区分', pick_(d.liveKind, ['申込者本人のみ', '申込者および同居人', '申込者以外'])],
      ['合計', esc_(d.totalPeople) + ' 名'],
    ]) + '</table>' +
    (ks.length ? '<table class="people">' +
      '<tr><th>#</th><th>フリガナ</th><th>氏名</th><th>男／女</th><th>続柄</th><th>生年月日（T・S・H・R）</th>' +
      '<th>年齢</th><th>携帯TEL</th><th>勤務先／学校名</th><th>TEL</th></tr>' +
      ks.slice(0, 3).map(function (k, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc_(k.kana) + '</td><td>' + esc_(k.name) + '</td>' +
          '<td>' + esc_(k.sex) + '</td><td>' + esc_(k.relation) + '</td><td>' + esc_(wareki_(k.birth)) + '</td>' +
          '<td>' + esc_(k.age) + '</td><td>' + esc_(k.tel) + '</td><td>' + esc_(k.company) + '</td><td>' + esc_(k.companyTel) + '</td></tr>';
      }).join('') + '</table>' +
      (ks.length > 3 ? '<div class="warn">同居人が4名以上のため、4人目以降は通信欄へ記入してください。</div>' : '')
      : '') +

    '<div class="sec">緊急連絡先<span style="font-weight:normal;font-size:10px;">（入居者以外のご親族・連帯保証人の有無に関わらず必須）</span></div>' +
    '<table>' + rows_([
      ['フリガナ', esc_(d.eKana)],
      ['氏名', '<b>' + esc_(d.eName) + '</b>'],
      ['男／女', pick_(d.eSex, ['男', '女'])],
      ['続柄', esc_(d.eRelation)],
      ['携帯TEL', '<b>' + esc_(d.eMobile) + '</b>'],
      ['自宅TEL', or_(esc_(d.eTel))],
      ['自宅住所', esc_(addr_(d.eZip, d.ePref, d.eAddr))],
    ]) + '</table>' +

    '<div class="sec alt">連帯保証人予定者</div>' +
    (d.hasGuarantor === 'あり'
      ? '<table>' + rows_([
        ['フリガナ', esc_(d.gKana)],
        ['氏名', '<b>' + esc_(d.gName) + '</b>'],
        ['男／女', pick_(d.gSex, ['男', '女'])],
        ['現住所', esc_(addr_(d.gZip, d.gPref, d.gAddr))],
        ['現住所の区分', pick_(gRes.replace(/（.*）/, ''), ['持家', '賃貸', '親族同居', '他'])],
        ['生年月日（T・S・H）', esc_(wareki_(d.gBirth))],
        ['年齢', esc_(d.gAge) + ' 歳'],
        ['続柄', esc_(d.gRelation)],
        ['携帯TEL', '<b>' + esc_(d.gMobile) + '</b>'],
        ['自宅TEL', or_(esc_(d.gTel))],
        ['職業', pick_(gEmp, ['公務員', '役員', '正社員', '契約社員', '派遣社員', 'パート・アルバイト', '自営', '年金受給'])],
        ['勤務先名称', esc_(d.gCompany)],
        ['所在地', esc_(addr_(d.gCompanyZip, d.gCompanyPref, d.gCompanyAddr))],
        ['勤務先TEL', esc_(d.gCompanyTel)],
        ['勤続年数', esc_(d.gWorkYears) + ' 年'],
        ['月収', d.gIncomeMonth ? num_(d.gIncomeMonth) + ' 万' : or_('')],
        ['業種', or_(esc_(d.gIndustry))],
        ['職種', or_(esc_(d.gJobType))],
      ]) + '</table>'
      : '<table><tr><th>連帯保証人予定者</th><td class="v">なし（「パートナー」プランをご検討ください）</td></tr></table>') +

    '<div class="sec">通信欄</div>' +
    '<table><tr><td class="v">' + or_(esc_(d.note)) +
    (ks.length > 3 ? '<br><b>【4人目以降の入居者】</b><br>' + ks.slice(3).map(function (k) {
      return esc_(k.name) + '（' + esc_(k.kana) + '）　続柄：' + esc_(k.relation) + '　' + jpDate_(k.birth);
    }).join('<br>') : '') + '</td></tr></table>' +

    '<div class="warn">本人確認書類の添付が必要です。記入漏れがないかご確認ください。</div>';
}

/* ---------- 全保連株式会社 ---------- */
function tenkiZH_(d) {
  const emp = conv_(MAP_EMPLOYMENT, d.aEmployment, 'zh');
  const use = conv_(MAP_USE, d.use, 'zh');
  const rel = MAP_RELATION_ZH[d.eRelation] || 'その他';
  const ks = d.kyoju || [];

  return '<div class="sec">協定会社様（審査回答書送付先）の情報</div>' +
    '<table>' + rows_([
      ['会社名', or_(esc_(d.agentCompany) || esc_(M_CONFIG.COMPANY))],
      ['担当', or_(esc_(d.agentStaff))],
      ['TEL／FAX', esc_(M_CONFIG.COMPANY_TEL) + '　／　' + esc_(M_CONFIG.COMPANY_FAX)],
      ['仲介会社名', or_(esc_(d.chukai))],
      ['仲介会社 TEL／FAX', or_(esc_(d.chukaiTel)) + '　／　' + or_(esc_(d.chukaiFax))],
    ]) + '</table>' +

    '<div class="sec alt">物件内容（代理店記入欄）</div>' +
    '<table>' + rows_([
      ['申込日', mdDate_(d.applyDate)],
      ['入居日', d.moveInUndecided ? pick_('未定', ['未定']) : mdDate_(d.moveInDate)],
      ['入居済', d.applyKind === '入居中申込'
        ? flag_(d.noArrears, '滞納無し') + '　' + flag_(d.leaseback, 'リースバック')
        : '<span class="off">―（新規申込）</span>'],
      ['フリガナ（物件名）', esc_(d.bukkenKana)],
      ['物件名', esc_(d.bukken)],
      ['号室', esc_(d.room) + '　' + flag_(d.isKodate, '戸建')],
      ['住所', esc_(addr_(d.bukkenZip, d.bukkenPref, d.bukkenAddr))],
      ['物件用途', pick_(use, ['住居用', '住居学生用', '住居火災保険', 'トランクルーム', '倉庫', '駐車場', '事務所', '店舗'])],
      ['店舗の場合→利用目的', or_(esc_(d.useDetail))],
      ['入居理由', esc_(d.moveReason)],
      ['介護施設の場合', flag_(d.kaigoDaycare, 'デイケア') + '　' + flag_(d.kaigoStay, '宿泊有')],
    ]) + '</table>' +

    '<table>' + rows_([
      ['① 家賃（賃料）', yen_(d.rent)],
      ['② 共益費・管理費', yen_(d.kanrihi)],
      ['③ 駐車場', yen_(d.parking)],
      ['④ 水道料・町（区）費', yen_(d.suido)],
      ['⑤ その他' + (d.otherFeeName ? '（' + d.otherFeeName + '）' : ''),
        yen_(String(parseInt(d.otherFee || '0', 10) + parseInt(d.shunou || '0', 10)))],
      ['⑥ 月額賃料', '<b>' + yen_(d.rentTotal) + '</b>'],
      ['敷金・保証金', yen_(d.shikikin)],
      ['礼金', yen_(d.reikin)],
      ['敷引（解約引き）', yen_(d.shikibiki)],
    ]) + '</table>' +

    '<div class="sec">申込者・賃借人 記入欄</div>' +
    '<table>' + rows_([
      ['姓 / Family name', '<b>' + esc_(d.aSei) + '</b>'],
      ['名 / Given name', '<b>' + esc_(d.aMei) + '</b>'],
      ['フリガナ', esc_(d.aSeiKana) + '　' + esc_(d.aMeiKana)],
      ['性別', pick_(d.aSex, ['男', '女', '無回答'])],
      ['生年月日 / Date of Birth', '西暦 ' + jpDate_(d.aBirth) + '　（' + esc_(d.aAge) + ' 歳）'],
      ['免許番号（お持ちの方）', or_(esc_(d.aLicense))],
      ['住所 / Address', esc_(addr_(d.aZip, d.aPref, d.aAddr))],
      ['メールアドレス', esc_(d.aEmail)],
      ['自宅電話 / Phone number', or_(esc_(d.aTel))],
      ['携帯電話 / Mobile number', '<b>' + esc_(d.aMobile) + '</b>'],
      ['勤務先名称 / Name of workplace', esc_(d.aCompany)],
      ['勤務先電話 / Workplace number', '<b>' + esc_(d.aCompanyTel) + '</b>'],
      ['勤務先住所 / Workplace address', esc_(addr_(d.aCompanyZip, d.aCompanyPref, d.aCompanyAddr))],
      ['雇用形態（○を付ける）', '<b>' + esc_(emp) + '</b><br>' +
        '<span class="note">1.公務員　2.会社経営者　3.役員　4.正社員　5.契約社員　6.派遣社員　7.個人事業主　8.個人事業勤務　' +
        '9.アルバイト・パート　10.学生　11.年金　12.生活保護受給　14.無職　15.その他</span>'],
      ['年収 / Annual income', '<b>' + num_(d.aIncomeYear) + ' 万円</b>'],
      ['勤続年数 / Work years', esc_(d.aWorkYears) + ' 年 ' + or_(esc_(d.aWorkMonths), '0') + ' ヶ月'],
      ['勤務先業種 / Type of work', esc_(d.aIndustry)],
      ['物件用途', esc_(use)],
      ['利用目的 / 入居事由', esc_(d.useDetail || d.moveReason)],
      ['入居人数（住居申込）', '成人 ' + esc_(d.adults) + ' 人　未成年 ' + esc_(d.minors) + ' 人'],
    ]) + '</table>' +

    (ks.length ? '<table class="people">' +
      '<tr><th>#</th><th>同居人／実入居者</th><th>フリガナ</th><th>氏名</th><th>続柄</th><th>生年月日（西暦）</th><th>携帯電話</th></tr>' +
      ks.slice(0, 2).map(function (k, i) {
        return '<tr><td>' + (i + 1) + '</td><td>☑ 同居人</td><td>' + esc_(k.kana) + '</td><td>' + esc_(k.name) + '</td>' +
          '<td>' + esc_(k.relation) + '</td><td>' + jpDate_(k.birth) + '</td><td>' + esc_(k.tel) + '</td></tr>';
      }).join('') + '</table>' +
      (ks.length > 2 ? '<div class="warn">同居人が3名以上のため、3人目以降は別紙での提出が必要です。<br>' +
        ks.slice(2).map(function (k) {
          return '・' + esc_(k.name) + '（' + esc_(k.kana) + '）　続柄：' + esc_(k.relation) + '　' + jpDate_(k.birth) + '　' + esc_(k.tel);
        }).join('<br>') + '</div>' : '')
      : '') +

    '<div class="sec alt">緊急連絡先</div>' +
    '<table>' + rows_([
      ['フリガナ', esc_(d.eKana)],
      ['氏名', '<b>' + esc_(d.eName) + '</b>'],
      ['続柄', pick_(rel, ['親子', '兄弟／姉妹', '親族', 'その他']) +
        '　<span class="note">（申込内容：' + esc_(d.eRelation) + '）</span>'],
      ['生年月日', '西暦 ' + jpDate_(d.eBirth) + (d.eAge ? '　（' + esc_(d.eAge) + ' 歳）' : '')],
      ['現住所', esc_(addr_(d.eZip, d.ePref, d.eAddr))],
      ['連絡先（自宅）', or_(esc_(d.eTel))],
      ['連絡先（携帯）', '<b>' + esc_(d.eMobile) + '</b>'],
    ]) + '</table>' +

    (d.note ? '<div class="sec">連絡事項</div><table><tr><td class="v">' + esc_(d.note) + '</td></tr></table>' : '') +

    '<div class="warn">' +
    '※ 物件内容と申込人記載の両方の送付が必要です（審査専用FAX：050-3000-2321）。<br>' +
    '※ 続柄・住所・連絡先はすべて記載必須です。外国籍の方は在留カードのコピーが必要です。' +
    (d.aNationality && d.aNationality !== '日本' ? '<br><b>→ 本申込は外国籍（' + esc_(d.aNationality) + '）です。在留カードのコピーを添付してください。</b>' : '') +
    '</div>';
}

/* ---------- ナップ賃貸保証株式会社 ---------- */
function tenkiNAP_(d) {
  const emp = conv_(MAP_EMPLOYMENT, d.aEmployment, 'nap');
  const gEmp = conv_(MAP_EMPLOYMENT, d.gEmployment, 'nap');
  const res = conv_(MAP_RESIDENCE, d.aResidence, 'nap');
  const eRes = conv_(MAP_RESIDENCE, d.eResidence, 'nap');
  const gRes = conv_(MAP_RESIDENCE, d.gResidence, 'nap');
  const use = conv_(MAP_USE, d.use, 'nap');
  const empOpts = ['正社員', '契約社員', '派遣社員', '学生', '年金/国民・厚生・共済・遺族・障害',
    '個人事業主', '無職(求職中含)', '生活保護', 'パート/アルバイト', '他'];
  const resOpts = ['自己所有', '家族所有', '賃貸', '社宅'];
  const ks = d.kyoju || [];
  const napOpts = d.napOptions || [];

  return '<div class="sec">加盟店様概要</div>' +
    '<table>' + rows_([
      ['会社名（商号）', or_(esc_(d.agentCompany) || esc_(M_CONFIG.COMPANY))],
      ['所在地', '〒' + esc_(M_CONFIG.COMPANY_ZIP) + '　' + esc_(M_CONFIG.COMPANY_ADDR)],
      ['TEL／FAX', esc_(M_CONFIG.COMPANY_TEL) + '　／　' + esc_(M_CONFIG.COMPANY_FAX)],
      ['ご担当者', or_(esc_(d.agentStaff))],
      ['申込日', jpDate_(d.applyDate)],
      ['入居希望日', d.moveInUndecided ? '未定' : jpDate_(d.moveInDate)],
      ['区分', pick_(d.applyKind === '新規申込' ? '新規' : '入居中', ['新規', '入居中'])],
      ['引越・申込理由', esc_(d.moveReason)],
    ]) + '</table>' +

    '<div class="sec alt">加盟店様ご記入欄</div>' +
    '<table>' + rows_([
      ['物件用途', pick_(use, ['居住用', '居住用学生', '事務所', '店舗', '倉庫等', 'SOHO', '駐車場', 'コンテナ', 'トランクルーム']) +
        '<br><span class="note">※ 事務所・店舗・倉庫等・SOHO は事業用補足資料が必要です。</span>'],
      ['物件名 フリガナ', esc_(d.bukkenKana)],
      ['物件名', esc_(d.bukken)],
      ['号室', esc_(d.room)],
      ['物件所在地', esc_(addr_(d.bukkenZip, d.bukkenPref, d.bukkenAddr))],
      ['敷金・保証金', yen_(d.shikikin)],
      ['収納代行', pick_(d.napShunou, ['有', '無'])],
      ['ナップ付帯商品',
        ['ナップ家財', 'ナップ駆付け', 'ナップ見守りセンサー', 'ナップ見守り電気'].map(function (o) {
          return flag_(napOpts.indexOf(o) >= 0, o.replace('ナップ', 'ﾅｯﾌﾟ'));
        }).join('　')],
      ['保証プラン', or_(esc_(d.planNAP)) +
        '<br><span class="note">居住用：安心／スタンダード／アシスト／学割V／学割（一括払型）　' +
        '事業用：事業用S／事業用A／事業用B／貸地／駐車場・コンテナ・トランク</span>'],
    ]) + '</table>' +

    '<table>' + rows_([
      ['① 家賃', yen_(d.rent)],
      ['② 管理費・共益費', yen_(d.kanrihi)],
      ['③ 駐車場', yen_(d.parking)],
      ['④ 収納代行費用', yen_(d.shunou)],
      ['⑤ ﾅｯﾌﾟ付帯商品費用', or_('')],
      ['⑥ その他' + (d.otherFeeName ? '（' + d.otherFeeName + '）' : ''),
        yen_(String(parseInt(d.otherFee || '0', 10) + parseInt(d.suido || '0', 10)))],
      ['賃料合計額（①＋②＋③＋④＋⑤＋⑥）', '<b>' + yen_(d.rentTotal) + '</b>'],
    ]) + '</table>' +

    '<div class="sec">お申込者様ご記入欄</div>' +
    '<table>' + rows_([
      ['ﾌﾘｶﾞﾅ', esc_(d.aKana)],
      ['氏名', '<b>' + esc_(d.aName) + '</b>'],
      ['性別', pick_(d.aSex, ['男', '女'])],
      ['配偶者', pick_(d.aSpouse, ['有', '無'])],
      ['国籍', esc_(d.aNationality)],
      ['住居区分', pick_(res, resOpts)],
      ['生年月日', jpDate_(d.aBirth) + '　（' + esc_(d.aAge) + ' 歳）'],
      ['現住所', esc_(addr_(d.aZip, d.aPref, d.aAddr))],
      ['携帯電話', '<b>' + esc_(d.aMobile) + '</b>'],
      ['自宅電話', or_(esc_(d.aTel))],
      ['勤務先情報：名称', esc_(d.aCompany)],
      ['勤務先情報：業種', esc_(d.aIndustry)],
      ['勤務先 TEL', '<b>' + esc_(d.aCompanyTel) + '</b>'],
      ['勤務先情報：住所', esc_(addr_(d.aCompanyZip, d.aCompanyPref, d.aCompanyAddr))],
      ['年収', '<b>' + num_(d.aIncomeYear) + ' 万円</b>'],
      ['勤続年数', esc_(d.aWorkYears) + ' 年 ' + or_(esc_(d.aWorkMonths), '0') + ' ヵ月'],
      ['雇用形態', pick_(emp, empOpts)],
    ]) + '</table>' +

    '<div class="sec alt">入居者（居住用）</div>' +
    (ks.length ? '<table class="people">' +
      '<tr><th>#</th><th>氏名</th><th>続柄</th><th>生年月日</th><th>電話番号</th><th>勤務先名称</th><th>勤続年数</th><th>年収</th></tr>' +
      ks.map(function (k, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc_(k.name) + '</td><td>' + esc_(k.relation) + '</td>' +
          '<td>' + jpDate_(k.birth) + '</td><td>' + esc_(k.tel) + '</td><td>' + esc_(k.company) + '</td>' +
          '<td>' + esc_(k.workYears) + '</td><td>' + esc_(k.income) + '</td></tr>';
      }).join('') + '</table>'
      : '<table><tr><th>入居者</th><td class="v">' + esc_(d.liveKind) + '（合計 ' + esc_(d.totalPeople) + ' 名）</td></tr></table>') +

    '<div class="sec">緊急連絡先</div>' +
    '<table>' + rows_([
      ['ﾌﾘｶﾞﾅ', esc_(d.eKana)],
      ['氏名', '<b>' + esc_(d.eName) + '</b>'],
      ['性別', pick_(d.eSex, ['男', '女'])],
      ['配偶者', pick_(d.eSpouse, ['有', '無'])],
      ['続柄', esc_(d.eRelation)],
      ['住居区分', pick_(eRes, resOpts)],
      ['生年月日', jpDate_(d.eBirth) + (d.eAge ? '　（' + esc_(d.eAge) + ' 歳）' : '')],
      ['現住所', esc_(addr_(d.eZip, d.ePref, d.eAddr))],
      ['携帯電話', '<b>' + esc_(d.eMobile) + '</b>'],
      ['自宅電話', or_(esc_(d.eTel))],
    ]) + '</table>' +

    '<div class="sec alt">連帯保証人</div>' +
    (d.hasGuarantor === 'あり'
      ? '<table>' + rows_([
        ['ﾌﾘｶﾞﾅ', esc_(d.gKana)],
        ['氏名', '<b>' + esc_(d.gName) + '</b>'],
        ['性別', pick_(d.gSex, ['男', '女'])],
        ['続柄', esc_(d.gRelation)],
        ['住居区分', pick_(gRes, resOpts)],
        ['生年月日', jpDate_(d.gBirth) + (d.gAge ? '　（' + esc_(d.gAge) + ' 歳）' : '')],
        ['現住所', esc_(addr_(d.gZip, d.gPref, d.gAddr))],
        ['携帯電話', '<b>' + esc_(d.gMobile) + '</b>'],
        ['自宅電話', or_(esc_(d.gTel))],
        ['勤務先情報：名称', esc_(d.gCompany)],
        ['勤務先情報：業種', or_(esc_(d.gIndustry))],
        ['勤務先 TEL', esc_(d.gCompanyTel)],
        ['勤務先情報：住所', esc_(addr_(d.gCompanyZip, d.gCompanyPref, d.gCompanyAddr))],
        ['年収', num_(d.gIncomeYear) + ' 万円'],
        ['勤続年数', esc_(d.gWorkYears) + ' 年 ' + or_(esc_(d.gWorkMonths), '0') + ' ヵ月'],
        ['雇用形態', pick_(gEmp, empOpts)],
      ]) + '</table>'
      : '<table><tr><th>連帯保証人</th><td class="v">なし</td></tr></table>') +

    (d.note ? '<div class="sec">連絡事項</div><table><tr><td class="v">' + esc_(d.note) + '</td></tr></table>' : '') +

    '<div class="warn">' +
    '※ 身分証を併せて提出してください。<br>' +
    '※ 申込者様・緊急連絡人様の連絡先、または勤務先へ在籍確認の連絡を行う場合があります。' +
    '</div>';
}

/* ---------- 日本賃貸保証株式会社（JID） ---------- */
function tenkiJID_(d) {
  const job = conv_(MAP_EMPLOYMENT, d.aEmployment, 'jid');
  const res = conv_(MAP_RESIDENCE, d.aResidence, 'jid');
  const use = conv_(MAP_USE, d.use, 'jid');
  const jobOpts = ['公務員', '会社員', '会社役員', '派遣', '自営業', '学生', 'パート・アルバイト', '年金受給', '無職', 'その他'];
  const ks = d.kyoju || [];

  // 毎月支払総額（①家賃＋②管理費共益費＋③駐車場ﾄﾗﾝｸﾙｰﾑ＋④その他）
  const jidOther = parseInt(d.otherFee || '0', 10) + parseInt(d.suido || '0', 10) + parseInt(d.shunou || '0', 10);
  const jidTotal = parseInt(d.rent || '0', 10) + parseInt(d.kanrihi || '0', 10) +
    parseInt(d.parking || '0', 10) + jidOther;

  const rate1 = parseFloat(d.jidRate1 || '0');
  const rate2 = parseFloat(d.jidRate2 || '0');
  const fee1 = rate1 > 0 ? Math.round(jidTotal * rate1 / 100) : 0;
  const fee2 = rate2 > 0 ? Math.round(jidTotal * rate2 / 100) : 0;

  return '<div class="sec">申込内容等（代理店記入欄）</div>' +
    '<table>' + rows_([
      ['物件用途', pick_(use, ['住居用', '住居用(学生プラン)', '事業用', '駐車場', 'その他'])],
      ['その他の場合', or_(esc_(d.useDetail))],
      ['フリガナ（物件名称）', esc_(d.bukkenKana)],
      ['物件名称', esc_(d.bukken)],
      ['号室', esc_(d.room)],
      ['所在地', esc_(addr_(d.bukkenZip, d.bukkenPref, d.bukkenAddr))],
    ]) + '</table>' +

    '<table>' + rows_([
      ['① 家賃', yen_(d.rent)],
      ['② 管理費・共益費', yen_(d.kanrihi)],
      ['③ 駐車場・ﾄﾗﾝｸﾙｰﾑ', yen_(d.parking)],
      ['④ その他' + (d.otherFeeName ? '（' + d.otherFeeName + '）' : ''), yen_(String(jidOther))],
      ['敷金または保証金', yen_(d.shikikin)],
      ['敷引または償却', yen_(d.shikibiki)],
      ['毎月支払総額（①＋②＋③＋④）', '<b>' + yen_(String(jidTotal)) + '</b>'],
    ]) + '</table>' +

    '<table>' + rows_([
      ['利用保証商品', or_(esc_(d.planJID)) +
        '<br><span class="note">JIDトリオ／JIDトリオA／JIDトリオB／JIDトリオTrust／JIDトリオTrust分割型／' +
        'JIDトリオTrust分割型アイプラス／JIDトリオN／JIDトリオN分割型／その他</span>'],
      ['保証委託契約年数', or_(esc_(d.jidYears)) + ' 年'],
      ['初回保証料率', rate1 > 0 ? '毎月支払総額の ' + rate1 + ' ％' : or_('')],
      ['初回保証料金額', fee1 > 0 ? yen_(String(fee1)) : or_('')],
      ['集送金手数料（税込）', or_('')],
      ['更新保証料率', rate2 > 0 ? '毎月支払総額の ' + rate2 + ' ％' : or_('')],
      ['更新保証料金額', fee2 > 0 ? yen_(String(fee2)) : or_('')],
    ]) + '</table>' +
    '<div class="note">※ 保証料金額（初回／更新）が最低保証料未満の場合は、規定の最低保証料を記入してください。</div>' +

    '<div class="sec alt">申込者様記入欄</div>' +
    '<table>' + rows_([
      ['フリガナ', esc_(d.aKana)],
      ['お名前', '<b>' + esc_(d.aName) + '</b>　<span class="note">※契約書にご捺印ください</span>'],
      ['自宅電話', or_(esc_(d.aTel))],
      ['携帯電話', '<b>' + esc_(d.aMobile) + '</b>'],
      ['ご住所', esc_(addr_(d.aZip, d.aPref, d.aAddr))],
      ['生年月日', jpDate_(d.aBirth) + '　（' + esc_(d.aAge) + ' 歳）'],
      ['性別', pick_(d.aSex, ['男', '女'])],
      ['国籍', esc_(d.aNationality)],
      ['お勤め先（学校）名称', esc_(d.aCompany)],
      ['電話番号', '<b>' + esc_(d.aCompanyTel) + '</b>'],
      ['所在地', esc_(addr_(d.aCompanyZip, d.aCompanyPref, d.aCompanyAddr))],
      ['社員数', d.aEmployees ? num_(d.aEmployees) + ' 人' : or_('')],
      ['月収（手取）', '<b>' + num_(d.aIncomeMonth) + ' 万円</b>'],
      ['勤続年数', esc_(d.aWorkYears) + ' 年 ' + or_(esc_(d.aWorkMonths), '0') + ' ヶ月'],
      ['転居理由', esc_(d.moveReason)],
      ['職業', pick_(job, jobOpts)],
      ['居住年数（入居中の場合）', or_(esc_(d.aResidenceYears)) + ' 年 ' + or_(esc_(d.aResidenceMonths), '0') + ' ヶ月'],
      ['お住い', pick_(res, ['自己所有', '社宅・寮', '賃貸・その他'])],
    ]) + '</table>' +

    '<div class="sec">入居者</div>' +
    '<table>' + rows_([
      ['入居人数', esc_(d.totalPeople) + ' 人'],
      ['入居形態', esc_(d.liveKind)],
    ]) + '</table>' +
    (ks.length ? '<table class="people">' +
      '<tr><th>#</th><th>フリガナ</th><th>お名前</th><th>携帯電話</th><th>生年月日</th><th>性別</th><th>続柄</th></tr>' +
      ks.slice(0, 2).map(function (k, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc_(k.kana) + '</td><td>' + esc_(k.name) + '</td>' +
          '<td>' + esc_(k.tel) + '</td><td>' + jpDate_(k.birth) + '（' + esc_(k.age) + '歳）</td>' +
          '<td>' + esc_(k.sex) + '</td><td>' + esc_(k.relation) + '</td></tr>';
      }).join('') + '</table>' +
      (ks.length > 2 ? '<div class="warn">入居者欄は2名分のため、3人目以降は「JIDへの連絡事項」欄へ記入してください。</div>' : '')
      : '') +

    '<div class="sec alt">緊急連絡先</div>' +
    '<table>' + rows_([
      ['種別', pick_(d.eKind, ['緊急連絡先のみ', '連帯保証人 兼 緊急連絡先', '親権者'])],
      ['申込者との関係', esc_(d.eRelation)],
      ['フリガナ', esc_(d.eKana)],
      ['お名前', '<b>' + esc_(d.eName) + '</b>'],
      ['自宅電話', or_(esc_(d.eTel))],
      ['携帯電話', '<b>' + esc_(d.eMobile) + '</b>'],
      ['ご住所', esc_(addr_(d.eZip, d.ePref, d.eAddr))],
      ['生年月日', jpDate_(d.eBirth) + (d.eAge ? '　（' + esc_(d.eAge) + ' 歳）' : '')],
      ['性別', pick_(d.eSex, ['男', '女'])],
      ['国籍', or_(esc_(d.eNationality))],
    ]) + '</table>' +
    '<div class="note">※ 緊急連絡先は原則、別世帯にお住いのお身内の方でお願いします。</div>' +

    (d.hasGuarantor === 'あり'
      ? '<div class="sec">連帯保証人（参考：統一申込書の内容）</div>' +
      '<table>' + rows_([
        ['フリガナ／お名前', esc_(d.gKana) + '　／　<b>' + esc_(d.gName) + '</b>'],
        ['続柄・性別', esc_(d.gRelation) + '　' + esc_(d.gSex)],
        ['生年月日', jpDate_(d.gBirth) + (d.gAge ? '　（' + esc_(d.gAge) + ' 歳）' : '')],
        ['ご住所', esc_(addr_(d.gZip, d.gPref, d.gAddr))],
        ['自宅電話／携帯電話', or_(esc_(d.gTel)) + '　／　<b>' + esc_(d.gMobile) + '</b>'],
        ['職業', conv_(MAP_EMPLOYMENT, d.gEmployment, 'jid')],
        ['お勤め先／電話番号', esc_(d.gCompany) + '　／　' + esc_(d.gCompanyTel)],
        ['月収（手取）', d.gIncomeMonth ? num_(d.gIncomeMonth) + ' 万円' : or_('')],
      ]) + '</table>' +
      '<div class="note">※ 連帯保証人を立てる場合、緊急連絡先の「種別」で「連帯保証人 兼 緊急連絡先」を選択するか、所定の連帯保証人用書面をご使用ください。</div>'
      : '') +

    '<div class="sec alt">代理店</div>' +
    '<table>' + rows_([
      ['代理店コード', or_(esc_(d.agentNo))],
      ['代理店名', or_(esc_(d.agentCompany) || esc_(M_CONFIG.COMPANY))],
      ['電話番号', esc_(M_CONFIG.COMPANY_TEL)],
      ['FAX番号', esc_(M_CONFIG.COMPANY_FAX)],
      ['担当者氏名', or_(esc_(d.agentStaff))],
      ['JIDへの連絡事項', or_(esc_(d.note)) +
        (ks.length > 2 ? '<br><b>【3人目以降の入居者】</b><br>' + ks.slice(2).map(function (k) {
          return esc_(k.name) + '（' + esc_(k.kana) + '）　続柄：' + esc_(k.relation) + '　' + jpDate_(k.birth);
        }).join('<br>') : '')],
    ]) + '</table>' +

    '<div class="warn">※ 代理店情報（代理店コード、代理店名等）を必ず記入してください。　審査FAX：03-5620-2910</div>';
}

/* ============================================================
 *  スプレッドシートへの記録
 * ========================================================== */

/** 記録する列の定義（見出し, データのキー） */
function logColumns_() {
  return [
    ['受付日時', null], ['受付番号', null],
    ['ステータス', null], ['審査依頼先', null], ['審査依頼日時', null], ['審査結果メモ', null],
    ['案件フォルダ', null], ['案件フォルダID', null], ['申込書PDF', null],
    ['申込日', 'applyDate'], ['入居希望日', 'moveInDate'], ['申込区分', 'applyKind'],
    ['物件名フリガナ', 'bukkenKana'], ['物件名', 'bukken'], ['号室', 'room'],
    ['物件〒', 'bukkenZip'], ['物件都道府県', 'bukkenPref'], ['物件住所', 'bukkenAddr'],
    ['物件用途', 'use'], ['利用目的', 'useDetail'], ['入居理由', 'moveReason'],
    ['家賃', 'rent'], ['管理費共益費', 'kanrihi'], ['駐車場', 'parking'], ['水道料町費', 'suido'],
    ['収納代行費', 'shunou'], ['その他費用', 'otherFee'], ['月額賃料合計', 'rentTotal'],
    ['敷金保証金', 'shikikin'], ['礼金', 'reikin'], ['敷引償却', 'shikibiki'],
    ['申込者姓', 'aSei'], ['申込者名', 'aMei'], ['申込者姓カナ', 'aSeiKana'], ['申込者名カナ', 'aMeiKana'],
    ['申込者氏名', 'aName'], ['申込者フリガナ', 'aKana'], ['性別', 'aSex'],
    ['生年月日', 'aBirth'], ['年齢', 'aAge'], ['配偶者', 'aSpouse'], ['国籍', 'aNationality'],
    ['在留資格期限', 'aZairyu'], ['免許番号', 'aLicense'],
    ['現住所〒', 'aZip'], ['現住所都道府県', 'aPref'], ['現住所', 'aAddr'],
    ['住居区分', 'aResidence'], ['居住年数', 'aResidenceYears'], ['居住ヶ月', 'aResidenceMonths'], ['現家賃', 'aCurRent'],
    ['携帯電話', 'aMobile'], ['自宅電話', 'aTel'], ['メール', 'aEmail'], ['健康保険', 'aHoken'],
    ['雇用形態', 'aEmployment'], ['雇用形態その他', 'aEmploymentOther'],
    ['勤務先名称', 'aCompany'], ['勤務先〒', 'aCompanyZip'], ['勤務先都道府県', 'aCompanyPref'],
    ['勤務先住所', 'aCompanyAddr'], ['勤務先TEL', 'aCompanyTel'], ['部署役職', 'aDept'],
    ['業種', 'aIndustry'], ['職種', 'aJobType'],
    ['年収(万)', 'aIncomeYear'], ['月収(万)', 'aIncomeMonth'],
    ['勤続年', 'aWorkYears'], ['勤続月', 'aWorkMonths'], ['従業員数', 'aEmployees'],
    ['入居形態', 'liveKind'], ['成人', 'adults'], ['未成年', 'minors'], ['入居人数計', 'totalPeople'],
    ['同居人', null],
    ['緊急種別', 'eKind'], ['緊急フリガナ', 'eKana'], ['緊急氏名', 'eName'], ['緊急続柄', 'eRelation'],
    ['緊急性別', 'eSex'], ['緊急生年月日', 'eBirth'], ['緊急年齢', 'eAge'],
    ['緊急〒', 'eZip'], ['緊急都道府県', 'ePref'], ['緊急住所', 'eAddr'],
    ['緊急携帯', 'eMobile'], ['緊急自宅TEL', 'eTel'], ['緊急住居区分', 'eResidence'],
    ['緊急国籍', 'eNationality'], ['緊急配偶者', 'eSpouse'], ['緊急勤務先', 'eCompany'],
    ['保証人有無', 'hasGuarantor'], ['保証人フリガナ', 'gKana'], ['保証人氏名', 'gName'],
    ['保証人続柄', 'gRelation'], ['保証人性別', 'gSex'], ['保証人生年月日', 'gBirth'], ['保証人年齢', 'gAge'],
    ['保証人〒', 'gZip'], ['保証人都道府県', 'gPref'], ['保証人住所', 'gAddr'],
    ['保証人住居区分', 'gResidence'], ['保証人国籍', 'gNationality'],
    ['保証人携帯', 'gMobile'], ['保証人自宅TEL', 'gTel'],
    ['保証人雇用形態', 'gEmployment'], ['保証人勤務先', 'gCompany'],
    ['保証人勤務先〒', 'gCompanyZip'], ['保証人勤務先都道府県', 'gCompanyPref'], ['保証人勤務先住所', 'gCompanyAddr'],
    ['保証人勤務先TEL', 'gCompanyTel'], ['保証人業種', 'gIndustry'], ['保証人職種', 'gJobType'],
    ['保証人勤続年', 'gWorkYears'], ['保証人勤続月', 'gWorkMonths'],
    ['保証人年収(万)', 'gIncomeYear'], ['保証人月収(万)', 'gIncomeMonth'],
    ['申込先保証会社', null],
    ['NSプラン', 'planNS'], ['NS継続保証料', 'planNSPay'], ['NAPプラン', 'planNAP'], ['JID商品', 'planJID'],
    ['NAP収納代行', 'napShunou'], ['NAP付帯商品', null],
    ['JID契約年数', 'jidYears'], ['JID初回料率', 'jidRate1'], ['JID更新料率', 'jidRate2'],
    ['取扱店', 'agentCompany'], ['担当者', 'agentStaff'], ['取扱店NO', 'agentNo'],
    ['仲介会社', 'chukai'], ['仲介TEL', 'chukaiTel'], ['仲介FAX', 'chukaiFax'],
    ['賃料支払日', 'payDay'], ['賃料支払方法', 'payMethod'],
    ['本人確認書類', 'idType'], ['添付点数', null],
    ['通信欄', 'note'], ['電子署名', 'signName'], ['同意', null],
  ];
}

/** 受付一覧スプレッドシートを取得（なければ作成） */
function logSheet_() {
  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  let file = null;
  const it = parent.getFilesByName(M_CONFIG.LOG_SPREADSHEET_NAME);
  if (it.hasNext()) file = it.next();

  let ss;
  if (file) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    ss = SpreadsheetApp.create(M_CONFIG.LOG_SPREADSHEET_NAME);
    const newFile = DriveApp.getFileById(ss.getId());
    parent.addFile(newFile);
    try { DriveApp.getRootFolder().removeFile(newFile); } catch (e) { /* 権限により失敗する場合がある */ }
  }
  return ss.getSheets()[0];
}

/** 見出し行 → 列番号（1始まり）の対応表 */
function headerIndex_(sheet) {
  const head = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const idx = {};
  head.forEach(function (h, i) { if (h) idx[String(h)] = i + 1; });
  return idx;
}

/** 申込の一覧（管理コンソール用・新しい順） */
function listCases_() {
  const sheet = logSheet_();
  if (sheet.getLastRow() < 2) return [];
  const idx = headerIndex_(sheet);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const get = function (row, name) {
    const i = idx[name];
    return i ? row[i - 1] : '';
  };
  return values.map(function (row, n) {
    return {
      rowNo: n + 2,
      receivedAt: String(get(row, '受付日時')),
      receiptNo: String(get(row, '受付番号')),
      status: String(get(row, 'ステータス') || '受付'),
      sentTo: String(get(row, '審査依頼先')),
      sentAt: String(get(row, '審査依頼日時')),
      resultNote: String(get(row, '審査結果メモ')),
      folderUrl: String(get(row, '案件フォルダ')),
      bukken: String(get(row, '物件名')),
      room: String(get(row, '号室')),
      aName: String(get(row, '申込者氏名')),
      aMobile: String(get(row, '携帯電話')),
      rentTotal: String(get(row, '月額賃料合計')),
      moveInDate: String(get(row, '入居希望日')),
    };
  }).reverse();
}

/** 1件の申込を取得（全項目） */
function getCase_(receiptNo) {
  const sheet = logSheet_();
  if (sheet.getLastRow() < 2) return null;
  const idx = headerIndex_(sheet);
  const col = idx['受付番号'];
  if (!col) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][col - 1]) === String(receiptNo)) {
      const obj = { rowNo: i + 2 };
      Object.keys(idx).forEach(function (h) { obj[h] = values[i][idx[h] - 1]; });
      // 書類作成などが参照しやすいよう、主要項目を英語キーでも持たせる
      logColumns_().forEach(function (c) {
        if (c[1] && idx[c[0]]) obj[c[1]] = values[i][idx[c[0]] - 1];
      });
      obj.folderId = String(obj['案件フォルダID'] || '');
      obj.folderUrl = String(obj['案件フォルダ'] || '');
      obj.aName = String(obj['申込者氏名'] || '');
      obj.bukken = String(obj['物件名'] || '');
      obj.room = String(obj['号室'] || '');
      obj.rentTotal = String(obj['月額賃料合計'] || '');
      obj.status = String(obj['ステータス'] || '受付');
      return obj;
    }
  }
  return null;
}

/** ステータス・審査依頼先の更新 */
function updateStatus_(receiptNo, status, resultNote) {
  if (status && M_STATUS.indexOf(status) < 0) {
    throw new Error('不明なステータスです：' + status);
  }
  const sheet = logSheet_();
  const c = getCase_(receiptNo);
  if (!c) throw new Error('申込が見つかりません：' + receiptNo);
  const idx = headerIndex_(sheet);
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  if (status && idx['ステータス']) sheet.getRange(c.rowNo, idx['ステータス']).setValue(status);
  if (resultNote != null && idx['審査結果メモ']) {
    const prev = String(c['審査結果メモ'] || '');
    sheet.getRange(c.rowNo, idx['審査結果メモ']).setValue(
      (prev ? prev + '\n' : '') + now + '　' + resultNote);
  }
  if (status === '審査依頼済') {
    if (idx['審査依頼日時']) sheet.getRange(c.rowNo, idx['審査依頼日時']).setValue(now);
    if (idx['審査依頼先'] && resultNote) {
      const prev = String(c['審査依頼先'] || '');
      const who = String(resultNote).split('：')[0];
      const list = prev ? prev.split('・') : [];
      if (list.indexOf(who) < 0) list.push(who);
      sheet.getRange(c.rowNo, idx['審査依頼先']).setValue(list.join('・'));
    }
  }
}

function appendLog_(data, receiptNo, now, pdfUrl, folderUrl, folderId) {
  const cols = logColumns_();
  const sheet = logSheet_();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cols.map(function (c) { return c[0]; }));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#e5f6f6');
  }

  const kyoju = (data.kyoju || []).map(function (k) {
    return k.name + '（' + k.kana + '／' + k.relation + '／' + k.birth + '／' + (k.tel || '') + '）';
  }).join(' / ');

  const row = cols.map(function (c) {
    if (c[1]) {
      const v = data[c[1]];
      return v == null ? '' : (Array.isArray(v) ? v.join('・') : v);
    }
    switch (c[0]) {
      case '受付日時': return Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      case '受付番号': return receiptNo;
      case 'ステータス': return '受付';
      case '案件フォルダ': return folderUrl;
      case '案件フォルダID': return folderId;
      case '申込書PDF': return pdfUrl;
      case '同居人': return kyoju;
      case '申込先保証会社': return (data.guaranteeCompanies || []).join('・') || '（担当者が選択）';
      case 'NAP付帯商品': return (data.napOptions || []).join('・');
      case '添付点数': return (data.files || []).length;
      case '同意': return data.agreed ? '同意済' : '未同意';
      default: return '';
    }
  });

  sheet.appendRow(row);
}

/* ============================================================
 *  メール送信
 * ========================================================== */

function sendNotifyMail_(data, receiptNo, now, unifiedFile, tenkiFiles, idFiles, docFiles,
                         caseFolder, sheetError, docError) {
  const d = data;
  const subject = '【入居申込】' + d.bukken + ' ' + d.room + '／' + d.aName + '　様（' + receiptNo + '）';

  const lines = [
    '入居申込フォームより新しいお申込みがありました。',
    '',
    '■ 受付番号：' + receiptNo,
    '■ 受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm'),
    '',
    '───────────────────',
    '【物件】' + d.bukken + '　' + d.room,
    '　用途：' + d.use,
    '　入居希望日：' + (d.moveInUndecided ? '未定' : jpDate_(d.moveInDate)),
    '　月額賃料合計：' + yen_(d.rentTotal),
    '',
    '【申込者】' + d.aName + '（' + d.aKana + '）　' + d.aSex + '　' + d.aAge + '歳',
    '　携帯：' + d.aMobile,
    '　メール：' + d.aEmail,
    '　勤務先：' + d.aCompany + '（' + d.aEmployment + '）',
    '　年収：' + num_(d.aIncomeYear) + '万円　月収：' + num_(d.aIncomeMonth) + '万円　勤続：' + d.aWorkYears + '年',
    '',
    '【入居】' + d.liveKind + '　合計 ' + d.totalPeople + '名',
    '【緊急連絡先】' + d.eName + '（' + d.eRelation + '）　' + d.eMobile,
    '【連帯保証人】' + (d.hasGuarantor === 'あり' ? d.gName + '（' + d.gRelation + '）　' + d.gMobile : 'なし'),
    '───────────────────',
    '',
    '■ 本人確認書類（' + (idFiles || []).length + '点）',
  ].concat((idFiles || []).map(function (f) { return '　・' + f.getName(); }))
    .concat([
      '',
      '■ 保証会社 転記シート（4社分を作成済み）',
    ])
    .concat(tenkiFiles.map(function (f) { return '　・' + f.getName(); }))
    .concat([
      '',
      '■ 契約書類（自動作成）',
    ])
    .concat((docFiles || []).length
      ? docFiles.map(function (f) { return '　・' + f.getName(); })
      : ['　（作成されていません' + (docError ? '：' + docError : '') + '）'])
    .concat([
      '',
      '───────────────────',
      '★ 保証会社への審査依頼は自動送信していません。',
      '　 管理コンソールから、どの保証会社に流すかを選んで送信してください。',
      '───────────────────',
      '',
      '■ 案件フォルダ：' + caseFolder.getUrl(),
      '■ 統一入居申込書：' + unifiedFile.getUrl(),
      '',
      d.note ? '■ 通信欄：\n' + d.note + '\n' : '',
      sheetError ? '※ スプレッドシートへの記録に失敗しました：' + sheetError : '',
      docError ? '※ 契約書類の作成に失敗しました：' + docError : '',
      '',
      '――',
      M_CONFIG.COMPANY + '　入居申込フォーム',
    ]);

  // 添付は統一申込書＋本人確認書類まで（転記シート・契約書類は案件フォルダから取得）
  const attachments = [unifiedFile.getAs(MimeType.PDF)]
    .concat((idFiles || []).map(function (f) { return f.getBlob(); }));

  MailApp.sendEmail({
    to: M_CONFIG.NOTIFY_EMAIL,
    subject: subject,
    body: lines.filter(function (l) { return l !== ''; }).join('\n'),
    name: M_CONFIG.SENDER_NAME,
    attachments: attachments,
  });
}

function sendReceiptMail_(data, receiptNo, now) {
  const d = data;
  const body = [
    d.aName + '　様',
    '',
    'この度は、' + M_CONFIG.COMPANY + 'へ入居のお申込みをいただき、誠にありがとうございます。',
    '下記の内容でお申込みを受け付けいたしました。',
    '',
    '───────────────────',
    '受付番号：' + receiptNo,
    '受付日時：' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm'),
    '',
    '物件名：' + d.bukken + '　' + d.room,
    '入居希望日：' + (d.moveInUndecided ? '未定' : jpDate_(d.moveInDate)),
    '月額賃料合計：' + yen_(d.rentTotal),
    '───────────────────',
    '',
    '今後の流れ',
    '　1. 賃貸保証会社による審査（通常2〜3営業日程度）',
    '　2. 審査結果のご連絡（担当者よりお電話またはメールにて）',
    '　3. 賃貸借契約の締結・ご入金',
    '',
    '＜ご提出いただいた書類＞',
    '　・' + (d.idType || '本人確認書類') + '（表面・裏面）',
    ((d.files || []).length > 2 ? '　・その他の添付書類　' + ((d.files || []).length - 2) + '点' : ''),
    '',
    '＜追加でお願いする場合がある書類＞',
    '　・収入を証明する書類（源泉徴収票・給与明細等）',
    (d.aEmployment === '生活保護受給' ? '　・生活保護受給証明書のコピー' : ''),
    '',
    '審査の過程で、ご本人さま・お勤め先・緊急連絡先の方へ確認のご連絡を差し上げる場合がございます。',
    'あらかじめご了承くださいますようお願いいたします。',
    '',
    '※ 本メールは送信専用です。ご返信いただいてもお答えできません。',
    '※ ご不明な点は下記までお問い合わせください。',
    '',
    '――',
    M_CONFIG.COMPANY,
    '〒' + M_CONFIG.COMPANY_ZIP + '　' + M_CONFIG.COMPANY_ADDR,
    'TEL：' + M_CONFIG.COMPANY_TEL + '（9:30〜17:00／日祝休）',
    'FAX：' + M_CONFIG.COMPANY_FAX,
  ].filter(function (l) { return l !== ''; }).join('\n');

  MailApp.sendEmail({
    to: d.aEmail,
    subject: '【' + M_CONFIG.COMPANY + '】入居申込を受け付けました（' + receiptNo + '）',
    body: body,
    name: M_CONFIG.SENDER_NAME,
  });
}

/* ============================================================
 *  ユーティリティ
 * ========================================================== */

/** サブフォルダを取得（なければ作成） */
function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ============================================================
 *  動作確認用（GASエディタから実行してください）
 * ========================================================== */

/**
 * サンプルデータで一式（統一申込書＋4社の転記シート）を生成し、
 * ドライブへ保存・メール送信までを確認します。
 */
function testMoushikomi() {
  const sample = {
    applyDate: '2026-08-03', moveInDate: '2026-09-01', moveInUndecided: false,
    applyKind: '新規申込', noArrears: false, leaseback: false,
    bukken: '○×ハイツ', bukkenKana: 'マルバツハイツ', room: '101', isKodate: false,
    bukkenZip: '7370821', bukkenPref: '広島県', bukkenAddr: '呉市三条4丁目7-20',
    use: '住居用', useDetail: '', kaigoDaycare: false, kaigoStay: false,
    moveReason: '転勤のため',
    rent: '50000', kanrihi: '3000', parking: '5000', suido: '1000', shunou: '330', otherFee: '0',
    otherFeeName: '', rentTotal: '59330',
    shikikin: '50000', reikin: '50000', shikibiki: '0',
    aSei: '大森', aMei: '太郎', aSeiKana: 'オオモリ', aMeiKana: 'タロウ',
    aName: '大森 太郎', aKana: 'オオモリ タロウ', aSex: '男',
    aBirth: '1990-05-15', aAge: '36', aSpouse: '有', aNationality: '日本', aZairyu: '',
    aLicense: '123456789012',
    aZip: '7370811', aPref: '広島県', aAddr: '呉市広古新開1-2-3',
    aResidence: '賃貸', aResidenceYears: '5', aResidenceMonths: '3', aCurRent: '45000',
    aMobile: '090-1234-5678', aTel: '0823-00-0000', aEmail: M_CONFIG.NOTIFY_EMAIL,
    aHoken: '社会保険', aEmployment: '正社員', aEmploymentOther: '',
    aCompany: '株式会社サンプル', aCompanyZip: '7300011', aCompanyPref: '広島県',
    aCompanyAddr: '広島市中区基町1-1', aCompanyTel: '082-000-0000', aDept: '営業部 主任',
    aIndustry: '建設業', aJobType: '営業',
    aIncomeYear: '450', aIncomeMonth: '28', aWorkYears: '8', aWorkMonths: '4', aEmployees: '120',
    liveKind: '申込者および同居人', adults: '2', minors: '1', totalPeople: '3',
    kyoju: [
      { kana: 'オオモリ ハナコ', name: '大森 花子', relation: '妻', sex: '女', birth: '1992-08-20', age: '33',
        tel: '090-2222-3333', company: '株式会社サンプル商事', companyTel: '082-111-1111', workYears: '5', income: '280' },
      { kana: 'オオモリ イチロウ', name: '大森 一郎', relation: '長男', sex: '男', birth: '2018-04-10', age: '8',
        tel: '', company: '呉市立○○小学校', companyTel: '', workYears: '', income: '' },
    ],
    eKind: '緊急連絡先のみ', eKana: 'オオモリ ジロウ', eName: '大森 次郎', eRelation: '父',
    eSex: '男', eBirth: '1962-03-03', eAge: '64',
    eZip: '7370051', ePref: '広島県', eAddr: '呉市中央1-1-1',
    eMobile: '090-9999-8888', eTel: '0823-11-1111',
    eResidence: '自己所有（持家）', eNationality: '日本', eSpouse: '有', eCompany: '無職',
    hasGuarantor: 'あり', gKana: 'オオモリ サブロウ', gName: '大森 三郎', gRelation: '兄弟・姉妹',
    gSex: '男', gBirth: '1988-11-11', gAge: '37',
    gZip: '7300012', gPref: '広島県', gAddr: '広島市中区上八丁堀1-1',
    gResidence: '自己所有（持家）', gNationality: '日本',
    gMobile: '090-7777-6666', gTel: '',
    gEmployment: '公務員', gCompany: '広島県庁',
    gCompanyZip: '7308511', gCompanyPref: '広島県', gCompanyAddr: '広島市中区基町10-52',
    gCompanyTel: '082-228-2111', gIndustry: '公務', gJobType: '事務',
    gWorkYears: '15', gWorkMonths: '0', gIncomeYear: '600', gIncomeMonth: '35',
    guaranteeCompanies: [],
    planNS: 'プラス1（保証人あり）', planNSPay: '月払い（集金代行サービス利用）',
    planNAP: 'スタンダード（年払型）', planJID: 'JIDトリオ',
    napShunou: '有', napOptions: ['ナップ家財'],
    jidYears: '2', jidRate1: '50', jidRate2: '10',
    agentCompany: M_CONFIG.COMPANY, agentStaff: '大森', agentNo: '001-004',
    chukai: '○○不動産株式会社', chukaiTel: '0823-99-9999', chukaiFax: '0823-99-9998',
    payDay: '27', payMethod: '口座振替',
    idType: '運転免許証', files: [],
    note: 'テスト送信です。',
    signName: '大森 太郎', agreed: true,
  };

  const now = new Date();
  const receiptNo = 'TEST' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');

  const parent = DriveApp.getFolderById(M_CONFIG.FOLDER_ID);
  const caseFolder = getOrCreateSubfolder_(parent, 'TEST_' + receiptNo);

  const unifiedFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.unified);
  const unifiedFile = unifiedFolder.createFile(buildUnifiedPdf_(sample, receiptNo, now));

  const tenkiFolder = getOrCreateSubfolder_(caseFolder, M_CONFIG.SUBFOLDERS.tenki);
  const tenkiFiles = GUARANTORS.map(function (g) {
    return tenkiFolder.createFile(buildTenkiPdf_(g, sample, receiptNo, now));
  });

  // 契約書類（見積書・請求書・賃貸借契約書・鍵受領書）
  let docFiles = [], docError = '';
  try {
    docFiles = buildAllDocuments_(caseFolder, sample, receiptNo, now);
  } catch (err) {
    docError = String(err);
  }

  appendLog_(sample, receiptNo, now, unifiedFile.getUrl(),
    caseFolder.getUrl(), caseFolder.getId());
  sendNotifyMail_(sample, receiptNo, now, unifiedFile, tenkiFiles, [], docFiles,
    caseFolder, '', docError);

  Logger.log('テスト完了：' + caseFolder.getUrl());
  if (docError) Logger.log('契約書類の作成エラー：' + docError);
}
