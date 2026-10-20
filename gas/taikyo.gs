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
  KAIYAKU_LOG_ID: '1PLLagMO8xALs1ry_fY4JxC7SCwncGygNEz_xhcCMK-M',
  COMPANY: '有限会社仁方大森マリーナー',
  COMPANY_TEL: '0823-27-7600',
  COMPANY_ADDR: '〒737-0821 広島県呉市三条4丁目7-20',
  // 見積書の作成者名（見積書のフッターに「見積作成者：〇〇」と記載）
  ESTIMATOR: 'エイホームトラスト株式会社',
  // 精算書の作成者名（精算書の下部に「精算書作成者：〇〇（担当：△△）」と記載）
  SETTLEMENT_CREATOR: 'エイホームトラスト株式会社',
  // 送付状（書類送付御案内）の差出人情報
  COMPANY_ZIP: '737-0821',
  COMPANY_ADDR_FULL: '広島県呉市三条4丁目7-20',
  COMPANY_FAX: '0823-27-7818',
  COMPANY_CONTACT: '大森',   // 送付状の担当者（空なら精算書の担当者を使用）

  // ---------------- 御請求書（適格請求書） ----------------
  // 発行者（請求書の右上に記載）。regNo は適格請求書発行事業者の登録番号（T＋13桁）
  INVOICE_ISSUER: {
    name: 'エイホームトラスト株式会社',
    regNo: 'T6240001052738',
    addr: '呉市三条3-3-5',
    tels: ['0823-32-6013', '090-7972-7516'],
    showLogo: true,   // 右上のロゴ（Eihometrast）。false で非表示
  },
  INVOICE_ITEM: '補修費',               // 品目名（原状回復費の借主負担分・税込）
  INVOICE_SUBJECT: '退去修繕清掃費用',   // 【諸条件】の「物件名 号室」の後ろに付く文言
  INVOICE_NOTES: [                      // 備考欄（先頭に「・」が付きます）
    'お振込み手数料はお客様負担でお願い致します。',
    'その他、特殊事項は別途相談になります。',
    '内訳は同封の清算書・原状回復見積書をご確認ください。',
  ],
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

  // ---------------- LINE通知（任意・未設定なら何もしません） ----------------
  // 設定手順は TAIKYO_SETUP.md「LINE通知の設定」を参照してください。
  LINE: {
    // ★チャネルアクセストークンはここには書かないでください（GitHubで公開されるため）。
    //   Apps Script の「プロジェクトの設定 → スクリプト プロパティ」に
    //   プロパティ名 LINE_CHANNEL_ACCESS_TOKEN で登録してください。
    //   （どうしても直接指定する場合のみ、下に記入。※非公開運用のときだけ）
    CHANNEL_ACCESS_TOKEN: '',
    // 社内用の送信先（グループID or ユーザーID）。すべての通知がここに届きます
    STAFF_TO: '',
    // 貸主ごとのグループID。設定した貸主の案件は、そのグループにも通知します
    // 例： 'エイホームトラスト株式会社': 'Cxxxxxxxxxxxxxxxx',
    OWNER_GROUPS: {},
    // 貸主グループへ送る通知の段階（社内には常に全段階を送ります）
    OWNER_STAGES: { tachiai: true, estimate: true, settlement: true, complete: true },
    // 貸主グループへ金額を含めるか（false なら物件名と進捗のみ）
    OWNER_INCLUDE_AMOUNT: true,
  },
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
    // LINEからのWebhook（グループID取得用）
    if (data && data.events && !data.action) return handleLineWebhook_(data);
    const action = data.action;
    if (action === 'newCase') return json_(createCase_(data));
    if (action === 'report') return json_(saveReport_(data));
    if (action === 'consent') return json_(saveConsent_(data));
    if (action === 'tachiai') return json_(saveTachiaiCombined_(data)); // 後方互換
    if (action === 'estimate') return json_(saveEstimate_(data));
    if (action === 'settlement') return json_(saveSettlement_(data));
    if (action === 'complete') return json_(saveComplete_(data));
    if (action === 'caseInfo') return json_(saveCaseInfo_(data));
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

// ================= LINE通知 =================
/** チャネルアクセストークンを取得
 *  安全のため「スクリプト プロパティ」を優先して読み込みます（コードには残しません）。 */
function lineToken_() {
  try {
    const v = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (v && v.trim()) return v.trim();
  } catch (e) {}
  return ((T_CONFIG.LINE || {}).CHANNEL_ACCESS_TOKEN || '').trim();
}

/** 送信先IDを取得（スクリプトプロパティ LINE_STAFF_TO があればそちらを優先） */
function lineStaffTo_() {
  try {
    const v = PropertiesService.getScriptProperties().getProperty('LINE_STAFF_TO');
    if (v && v.trim()) return v.trim();
  } catch (e) {}
  return ((T_CONFIG.LINE || {}).STAFF_TO || '').trim();
}

/** LINEへメッセージを送る
 *  宛先(to)を指定すれば そのグループ／個人へ、
 *  宛先が空なら「公式アカウントを友だち追加している全員」へ一斉送信します。
 *  → 宛先が空でも通知が届くので、グループIDの設定は必須ではありません。 */
function lineSend_(to, text) {
  const token = lineToken_();
  if (!token || !text) return false;
  const msg = { type: 'text', text: String(text).slice(0, 4900) };
  const url = to ? 'https://api.line.me/v2/bot/message/push'
                 : 'https://api.line.me/v2/bot/message/broadcast';
  const payload = to ? { to: to, messages: [msg] } : { messages: [msg] };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) Logger.log('LINE送信エラー(' + code + ')：' + res.getContentText());
    return code === 200;
  } catch (e) {
    Logger.log('LINE送信例外：' + e);
    return false;
  }
}

/** 案件の通知を、社内グループと（設定があれば）貸主グループへ送る
 *  stage: 'tachiai' | 'estimate' | 'settlement' | 'complete' */
function lineNotify_(stage, c, staffText, ownerText) {
  const cfg = T_CONFIG.LINE || {};
  if (!lineToken_()) return;
  // 社内へ（全段階）。宛先未設定なら友だち全員へ一斉送信
  lineSend_(lineStaffTo_(), staffText);
  // 貸主グループへ（設定された貸主・段階のみ）
  const owner = (c && c.owner) || '';
  const groups = cfg.OWNER_GROUPS || {};
  const stages = cfg.OWNER_STAGES || {};
  if (owner && groups[owner] && stages[stage]) {
    lineSend_(groups[owner], ownerText || staffText);
  }
}

/**
 * LINEからのWebhook受信
 * 公式アカウントをグループに招待した時点で、そのグループを通知先として自動登録します。
 * （利用者側の操作は「招待するだけ」。発言も、IDの控えも不要です）
 */
function handleLineWebhook_(body) {
  try {
    const events = (body && body.events) || [];
    events.forEach(function (ev) {
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '';
      if (!id) return;
      // 受信したIDは必ず控えておく（登録に失敗しても後から setLineToFromLast で設定できる）
      try {
        PropertiesService.getScriptProperties()
          .setProperty('LINE_LAST_SOURCE_ID', id)
          .setProperty('LINE_LAST_EVENT', ev.type + ' / ' + (src.type || '') + ' / ' + new Date());
      } catch (e2) {}
      // 招待された（join）／グループから発言があったとき、未登録なら通知先として登録
      if (ev.type === 'join' || ev.type === 'message' || ev.type === 'follow') {
        const props = PropertiesService.getScriptProperties();
        const cur = (props.getProperty('LINE_STAFF_TO') || '').trim();
        if (!cur) {
          props.setProperty('LINE_STAFF_TO', id);
          if (ev.replyToken) lineReply_(ev.replyToken,
            '✅ 通知先として登録しました。\n今後、退去精算の進捗をこのトークにお知らせします。');
          Logger.log('LINE通知先を登録しました：' + id);
        } else if (ev.type === 'join' && cur !== id) {
          // 既に別の通知先が登録済み（貸主グループなど）→ IDを案内するだけ
          if (ev.replyToken) lineReply_(ev.replyToken,
            'このトークのIDは次のとおりです。貸主グループとして登録する場合は担当者へお伝えください。\n' + id);
          Logger.log('別グループに招待されました：' + id);
        }
      }
    });
    return json_({ ok: true });
  } catch (e) {
    Logger.log('Webhook処理エラー：' + e);
    return json_({ ok: true }); // LINEには常に200を返す
  }
}

/** Webhookへの返信（招待時の確認メッセージ用） */
function lineReply_(replyToken, text) {
  const token = lineToken_();
  if (!token || !replyToken) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true,
    });
  } catch (e) {}
}

/** 現在の設定状況を確認する（診断用） */
function showLineTo() {
  const props = PropertiesService.getScriptProperties();
  const token = lineToken_();
  const to = lineStaffTo_();
  const last = props.getProperty('LINE_LAST_SOURCE_ID') || '';
  const lastEv = props.getProperty('LINE_LAST_EVENT') || '';
  Logger.log(
    '── LINE設定の状況 ──\n' +
    '1) トークン：' + (token ? '設定あり（末尾 ' + token.slice(-6) + '）' : '未設定') + '\n' +
    '2) 通知先ID：' + (to || '未登録（未設定なら友だち全員へ一斉送信）') + '\n' +
    '3) 最後に受信したLINEからの通信：' + (last ? (last + '\n   （' + lastEv + '）') : 'なし') + '\n' +
    '\n' +
    (last && !to
      ? '→ グループからの通信は届いています。関数「setLineToFromLast」を実行すると、\n' +
        '   そのグループを通知先として登録できます。'
      : (!last
        ? '→ LINEからの通信がまだ届いていません。\n' +
          '   ・Webhook URL が設定され「Webhookの利用」がオンか\n' +
          '   ・最新コードを「新バージョン」でデプロイ済みか\n' +
          '   ・デプロイのアクセス権が「全員」か\n' +
          '   をご確認のうえ、グループで何か発言してみてください。'
        : '→ 設定は完了しています。testLine で送信テストできます。'))
  );
}

/** 最後にLINEから受信したトーク（グループ）を、通知先として登録する
 *  自動登録がうまくいかなかったときの手動設定用です。 */
function setLineToFromLast() {
  const props = PropertiesService.getScriptProperties();
  const last = (props.getProperty('LINE_LAST_SOURCE_ID') || '').trim();
  if (!last) {
    Logger.log('LINEからの通信がまだ届いていません。\n' +
      'Webhookの設定を確認し、通知したいグループで何か発言してから、もう一度実行してください。');
    return;
  }
  props.setProperty('LINE_STAFF_TO', last);
  Logger.log('通知先として登録しました：' + last + '\n' +
    'testLine を実行して、そのグループに届くかご確認ください。');
}

/** 通知先IDを直接指定して登録する（IDが分かっている場合） */
function setLineTo(id) {
  const v = String(id || '').trim();
  if (!v) { Logger.log('IDを引数に指定してください。例： setLineTo("Cxxxxxxxx")'); return; }
  PropertiesService.getScriptProperties().setProperty('LINE_STAFF_TO', v);
  Logger.log('通知先として登録しました：' + v);
}

/** 通知先の登録を解除する（友だち全員への一斉送信に戻す） */
function clearLineTo() {
  PropertiesService.getScriptProperties().deleteProperty('LINE_STAFF_TO');
  Logger.log('通知先の登録を解除しました。以降は友だち全員への一斉送信になります。');
}

/** LINE通知のテスト（設定後にこの関数を実行して届くか確認） */
function testLine() {
  if (!lineToken_()) {
    Logger.log('チャネルアクセストークンが未設定です。\n' +
      '「プロジェクトの設定 → スクリプト プロパティ」に LINE_CHANNEL_ACCESS_TOKEN を登録してください。');
    return;
  }
  const to = lineStaffTo_();
  const ok = lineSend_(to, '【テスト送信】退去精算システムからのLINE通知です。');
  if (ok) {
    Logger.log(to
      ? '送信しました（宛先：' + to + '）。LINEをご確認ください。'
      : '送信しました（友だち追加している全員へ一斉送信）。LINEをご確認ください。\n' +
        '※特定のグループだけに送る場合は、公式アカウントをそのグループに招待してください。');
  } else {
    Logger.log('送信に失敗しました。実行ログのエラー内容をご確認ください。\n' +
      '「友だちが0人」の場合も送信できません。まず公式アカウントを friends に追加してください。');
  }
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

// ---------------- 案件の貸主・宛名（書類は作らずに保存） ----------------
/** 管理画面で貸主・宛名・敬称を選び直したときに、その場で案件へ保存する */
function saveCaseInfo_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  // upsertCase_ は見つからない案件を新規行として追加してしまうため、先に存在を確認する
  if (findRow_(progressSheet_(), caseId) < 0) return { ok: false, error: '案件が見つかりません。' };
  // 明示的な保存なので、貸主を「未選択」に戻したときは空で上書きする
  upsertCase_(caseId, { data: {
    owner: String(data.owner || '').trim(),
    toName: String(data.toName || '').trim(),
    toHonorific: String(data.toHonorific || '').trim(),
  } });
  return { ok: true };
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
/** 書類に印字する貸主名（未選択なら自社名）。貸主は管理画面の案件上部で選ぶ */
function ownerName_(data) { return String((data && data.owner) || '').trim() || T_CONFIG.COMPANY; }
/** 書類の宛名（法人契約なら会社名＋「御中」「殿」など）。未入力なら契約者名＋様 */
function addressee_(c, data) {
  const name = String((data && data.toName) || '').trim() || String((c && c.name) || '').trim();
  const hon = String((data && data.toHonorific) || '').trim() || '様';
  return name + '　' + hon;
}
/** 精算書の「精算書作成者：会社名（担当：人名）」。会社名が未設定なら従来どおり担当者名だけ */
function settlementCreator_(data) {
  const co = String(T_CONFIG.SETTLEMENT_CREATOR || '').trim();
  const staff = String((data && data.staff) || '').trim();
  if (!co) return staff ? '　精算書作成者：' + esc_(staff) : '';
  return '　精算書作成者：' + esc_(co) + (staff ? '（担当：' + esc_(staff) + '）' : '');
}
/** 案件に保存する貸主・宛名・敬称。貸主は入力があるときだけ（空で保存済みの貸主を消さない）、
 *  宛名・敬称は送られてきたときだけ保存する（宛名欄のない古い画面からの送信で消さないため） */
function infoPatch_(data) {
  const p = {};
  const o = String((data && data.owner) || '').trim();
  if (o) p.owner = o;
  if (data && data.toName !== undefined) p.toName = String(data.toName || '').trim();
  if (data && data.toHonorific !== undefined) p.toHonorific = String(data.toHonorific || '').trim();
  return p;
}
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
    '<div class="to">貸主様<br>' + esc_(ownerName_(data)) + ' 御中</div>' +
    '<table>' + infoRows + '</table>' +
    '<p class="note" style="margin-top:8px">退去時の室内確認の結果、原状回復に関わる主な箇所を写真にて記録しました。下記のとおりご確認をお願い申し上げます。</p>' +
    '<div style="margin-top:8px">' + (cards || '（写真なし）') + '</div>' +
    '<div class="foot">※本書は退去時の室内状況を記録した根拠資料です。原状回復費用の負担区分は、国土交通省「原状回復をめぐるトラブルとガイドライン」および賃貸借契約書に基づき、経年変化・通常損耗と借主の故意・過失等を勘案のうえ協議して決定いたします。<br>' +
    esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '</div></body></html>';
  const pdf = htmlToPdf_(html, '原状回復箇所報告書_' + label + '_' + dateStr + '.pdf');
  const file = caseFolder.createFile(pdf);

  upsertCase_(caseId, {
    name: c.name, kana: c.kana, bukken: c.bukken, room: c.room, reportUrl: file.getUrl(),
    data: Object.assign({ moveoutDate: data.moveoutDate || '', tachiaiDate: data.tachiaiDate || '', staffTachiai: data.staff || '',
            photoCount: photos.length, photoFolderUrl: caseFolder.getUrl(), tenancy: data.tenancy || '' }, infoPatch_(data)),
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
    '<div class="to">貸主様<br>' + esc_(ownerName_(data)) + ' 御中</div>' +
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
    data: Object.assign({ charges: ch, tachiaiDate: data.tachiaiDate || '', staffTachiai: data.staff || '' }, infoPatch_(data)),
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

  // LINE通知
  const label1 = c.bukken + ' ' + c.room + '（' + c.name + '様）';
  lineNotify_('tachiai', { owner: data.owner || caseOwner_(caseId) },
    '【退去立会い完了】' + label1 + '\n借主負担（確定分・税込）：' + fmtYen_(fixedTotal) + '\n次は修繕見積書の作成です。',
    '【退去立会い完了】' + label1 + '\n' + (T_CONFIG.LINE.OWNER_INCLUDE_AMOUNT ? '借主負担（確定分・税込）：' + fmtYen_(fixedTotal) + '\n' : '') + '立会いが完了しました。');

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
    '<div class="to">' + esc_(addressee_(c, data)) + '</div>' +
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
    '<div class="foot">見積作成者：' + esc_(T_CONFIG.ESTIMATOR) + '</div>' +
    '</body></html>';

  const label = caseLabel_(c);
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.estimate);
  const pdf = htmlToPdf_(html, '修繕見積書_' + label + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '.pdf');
  const file = folder.createFile(pdf);

  upsertCase_(caseId, {
    status: '見積済', estimateUrl: file.getUrl(),
    data: Object.assign({ estimateItems: items, estimateNote: data.note || '', estimateStaff: data.staff || '',
            tenantTotal: tenantTotal, ownerTotal: ownerTotal, estimateTotal: totalA }, infoPatch_(data)),
  });
  const label2 = c.bukken + ' ' + c.room + '（' + c.name + '様）';
  lineNotify_('estimate', { owner: caseOwner_(caseId) },
    '【修繕見積書 作成】' + label2 + '\n借主負担 合計（税込）：' + fmtYen_(tenantTotal) + '\n貸主負担 合計（税込）：' + fmtYen_(ownerTotal),
    '【修繕見積書 作成】' + label2 + (T_CONFIG.LINE.OWNER_INCLUDE_AMOUNT ? '\n借主負担（税込）：' + fmtYen_(tenantTotal) + '\n貸主負担（税込）：' + fmtYen_(ownerTotal) : ''));
  return { ok: true, caseId: caseId, estimateUrl: file.getUrl(), tenantTotal: tenantTotal };
}

// ---------------- ④ 修繕精算書 ----------------
function saveSettlement_(data) {
  const caseId = data.caseId;
  if (!caseId) return { ok: false, error: '案件IDがありません。' };
  const c = { name: data.name, bukken: data.bukken, room: data.room };
  const deposit = Number(data.deposit || 0);       // 預かり敷金
  const overpaidRent = Number(data.overpaidRent || 0); // 過払家賃（借主へお返しする分）
  const penalty = Number(data.penalty || 0);        // 違約金
  const unpaidRent = Number(data.unpaidRent || 0);  // 未納賃料等
  const restoreCost = Number(data.restoreCost || 0);// 原状回復費（借主負担）
  // お返しする分（敷金＋過払家賃）から、差引く分を控除する。プラス=返金 / マイナス=不足
  const balance = deposit + overpaidRent - penalty - unpaidRent - restoreCost;
  const refund = balance > 0 ? balance : 0;
  const shortage = balance < 0 ? -balance : 0;

  const bank = data.bank || {};
  const bankLine = [bank.name, bank.branch, bank.type, bank.number, bank.holder].filter(String).join('　');

  const html = docHead_() +
    '<div class="meta">作成日：' + today_() + '</div>' +
    '<h1>退 去 清 算 書</h1>' +
    '<div class="to">' + esc_(addressee_(c, data)) + '</div>' +
    '<table><tr><th style="width:22%">物件名</th><td>' + esc_(c.bukken) + '</td><th style="width:16%">号室</th><td>' + esc_(c.room) + '</td></tr>' +
    '<tr><th>入居期間</th><td>' + esc_(data.tenancy || '') + '</td><th>解約日</th><td>' + esc_(data.endDate || '') + '</td></tr>' +
    '<tr><th>退去後連絡先</th><td>' + esc_(normalizeTel_(data.contact || '')) + '</td><th>書類送付先</th><td>' + nl2br_(data.newAddress || '') + '</td></tr></table>' +
    '<table style="margin-top:10px">' +
    '<tr><th style="width:50%">預かり敷金</th><td class="right">' + fmtYen_(deposit) + '</td></tr>' +
    '<tr><th>過払家賃</th><td class="right">' + fmtYen_(overpaidRent) + '</td></tr>' +
    '<tr><th>違約金</th><td class="right">' + fmtYen_(penalty) + '</td></tr>' +
    '<tr><th>未納賃料等</th><td class="right">' + fmtYen_(unpaidRent) + '</td></tr>' +
    '<tr><th>原状回復費（借主負担・税込）</th><td class="right">' + fmtYen_(restoreCost) + '</td></tr>' +
    '<tr><th>' + (shortage > 0 ? '不足金額（ご請求）' : '返金額') + '</th><td class="right"><b>' + fmtYen_(shortage > 0 ? shortage : refund) + '</b></td></tr>' +
    '</table>' +
    '<table style="margin-top:10px"><tr><th style="width:22%">敷金返金口座</th><td>' + esc_(bankLine || '（後日ご連絡）') + '</td></tr></table>' +
    (data.note ? '<div class="foot">備考：' + esc_(data.note) + '</div>' : '') +
    '<div class="foot">貸主：' + esc_(ownerName_(data)) + '　（お問い合わせ：' + esc_(T_CONFIG.COMPANY) + '　TEL：' + esc_(T_CONFIG.COMPANY_TEL) + '）' +
    settlementCreator_(data) +
    '<br>' + (shortage > 0
      ? '不足金額を上記のとおりご請求いたします（別紙「御請求書」をご確認ください）。'
      : '預かり敷金から相殺のうえ、上記返金額を指定口座へお振込みいたします（振込手数料は差引かせていただきます）。') +
    '</div></body></html>';

  const label = caseLabel_(c);
  const dstamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.settlement);
  const pdf = htmlToPdf_(html, '修繕精算書_' + label + '_' + dstamp + '.pdf');
  const file = folder.createFile(pdf);

  // --- 御請求書（適格請求書）：不足＝請求額が発生した場合のみ ---
  let invoiceUrl = '';
  if (shortage > 0) {
    const amounts = { deposit: deposit, overpaidRent: overpaidRent, penalty: penalty,
                      unpaidRent: unpaidRent, restoreCost: restoreCost, shortage: shortage };
    invoiceUrl = buildInvoice_(caseId, c, data, amounts, dstamp, label).getUrl();
  }

  // --- 送付状（書類送付御案内）：見積書・清算書・（請求書）を郵送する際の同封案内 ---
  const coverUrl = buildCover_(caseId, c, data, shortage, dstamp, label).getUrl();

  upsertCase_(caseId, {
    status: '精算済', settlementUrl: file.getUrl(),
    data: Object.assign({ deposit: deposit, overpaidRent: overpaidRent, penalty: penalty, unpaidRent: unpaidRent, restoreCost: restoreCost,
            refund: refund, shortage: shortage, settlementStaff: data.staff || '',
            tenancy: data.tenancy || '', endDate: data.endDate || '', newAddress: data.newAddress || '', contact: data.contact || '',
            paymentDue: data.paymentDue || '', invoiceUrl: invoiceUrl, coverUrl: coverUrl }, infoPatch_(data)),
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
  const label3 = c.bukken + ' ' + c.room + '（' + c.name + '様）';
  const money3 = shortage > 0 ? '不足金額（ご請求）：' + fmtYen_(shortage) : '返金額：' + fmtYen_(refund);
  lineNotify_('settlement', { owner: data.owner || caseOwner_(caseId) },
    '【退去精算書 作成】' + label3 + '\n' + money3 + (invoiceUrl ? '\n御請求書を作成しました。' : '') + '\n送付状も作成済みです。',
    '【退去精算書 作成】' + label3 + (T_CONFIG.LINE.OWNER_INCLUDE_AMOUNT ? '\n' + money3 : ''));
  return { ok: true, caseId: caseId, settlementUrl: file.getUrl(), refund: refund, shortage: shortage,
           invoiceUrl: invoiceUrl, coverUrl: coverUrl };
}

/** 御請求書PDF（適格請求書）：原状回復費用などの不足額を借主へ請求。
 *  発行者は INVOICE_ISSUER（登録番号つき）、入金先は INVOICE_BANK。 */
function buildInvoice_(caseId, c, data, amounts, dstamp, label) {
  const folder = getOrCreateSubfolder_(parentFolder_(), T_CONFIG.SUBFOLDERS.invoice);
  return folder.createFile(htmlToPdf_(invoiceHtml_(caseId, c, data, amounts), '御請求書_' + label + '_' + dstamp + '.pdf'));
}

/** 適格請求書のHTML（エイホームトラストの請求書様式に合わせたレイアウト）。
 *  記載事項：①発行者名・登録番号（右上） ②取引年月日（右上の日付） ③取引内容（諸条件・品目）
 *  ④税率ごとの合計額と税率 ⑤税率ごとの消費税額（補修費の行） ⑥宛名 */
function invoiceHtml_(caseId, c, data, a) {
  const iss = T_CONFIG.INVOICE_ISSUER || {};
  const b = T_CONFIG.INVOICE_BANK;
  const num = function (v) { return Number(v || 0); };
  const restoreCost = num(a.restoreCost), penalty = num(a.penalty), unpaidRent = num(a.unpaidRent);
  const deposit = num(a.deposit), overpaidRent = num(a.overpaidRent);
  // 差引ご請求額と合計は同じ式から出す（2か所の金額が食い違わないように）
  const total = restoreCost + penalty + unpaidRent - deposit - overpaidRent;
  const ratePct = Math.round(Number(T_CONFIG.TAX_RATE || 0) * 100);
  // 税込額から消費税額を逆算。見積書と同じ四捨五入なので、見積書の借主負担の消費税額と一致する
  const tax = Math.round(restoreCost * ratePct / (100 + ratePct));

  // 品目：課税分 → 空行 → 充当額（赤字）の順。10行に満たない分は空行で埋める
  const rows = [];
  if (restoreCost > 0) {
    rows.push([T_CONFIG.INVOICE_ITEM || '補修費', '税込', fmtYen_(restoreCost)]);
    rows.push(['', '', '（内消費税額' + fmtYen_(tax) + '／税率' + ratePct + '%）']);
  }
  if (penalty > 0) rows.push(['違約金', '不課税', fmtYen_(penalty)]);
  if (unpaidRent > 0) rows.push(['未納賃料等', '非課税', fmtYen_(unpaidRent)]);
  rows.push(['', '', '']);
  if (deposit > 0) rows.push(['敷金充当額', '', fmtYen_(-deposit), true]);
  if (overpaidRent > 0) rows.push(['過払家賃充当額', '', fmtYen_(-overpaidRent), true]);
  // 品目は見本の様式と同じ14行（足りない分は空行）。行の高さを固定して、用紙上の位置がずれないようにする
  while (rows.length < 14) rows.push(['', '', '']);

  const LINE = 'border:1px solid #555;';
  const NB = 'border:none;padding:0;vertical-align:top;';
  const TH = LINE + 'background:#d9d9d9;height:7mm;padding:0 6px;font-weight:normal;text-align:center;font-size:12.5px;';
  const TD = LINE + 'height:7.6mm;padding:0 6px;text-align:center;font-size:12.5px;';
  const itemRows = rows.map(function (r) {
    return '<tr><td style="' + TD + '">' + (esc_(r[0]) || '&nbsp;') + '</td>' +
      '<td style="' + TD + '">' + (esc_(r[1]) || '&nbsp;') + '</td>' +
      '<td style="' + TD + (r[3] ? 'color:#dc2626;' : '') + '">' + (esc_(r[2]) || '&nbsp;') + '</td></tr>';
  }).join('');

  // 【諸条件】物件名・号室（数字だけなら「号室」を付ける）・件名
  const room = String(c.room || '').trim();
  const subject = [c.bukken, /^[0-9０-９]+$/.test(room) ? room + '号室' : room, T_CONFIG.INVOICE_SUBJECT]
    .map(function (s) { return String(s || '').trim(); }).filter(String).join('　');

  // 発行者（右上）：登録番号・名称・住所・電話・ロゴ
  const issLines = [];
  if (iss.regNo) issLines.push('登録番号　' + esc_(iss.regNo));
  issLines.push('<span style="font-size:14px;">' + esc_(iss.name || T_CONFIG.COMPANY) + '</span>');
  if (iss.addr) issLines.push(esc_(iss.addr));
  (iss.tels || []).forEach(function (t) { issLines.push('TEL：' + esc_(t)); });
  const logo = iss.showLogo
    ? '<div style="margin-top:1.5mm;"><img src="' + invoiceLogo_() + '" width="134" height="20" alt="Eihometrast"></div>' : '';

  // 宛名：長い会社名でも下線の上で1行に収まるよう、文字を少し小さくする
  const toText = addressee_(c, data);
  const toSize = toText.length <= 22 ? 16 : (toText.length <= 26 ? 14 : 12.5);

  // お支払い期日（2026-11-30 → 2026/11/30）
  const due = String(data.paymentDue || '').trim();
  const dueDisp = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due.replace(/-/g, '/') : due;

  const bankLines = ['金融機関名：' + esc_(b.bank), '支店名：' + esc_(b.branch), '口座種類：' + esc_(b.type),
    '口座番号：' + esc_(b.number), '口座名：' + esc_(b.holder)].join('<br>');
  const notes = (T_CONFIG.INVOICE_NOTES || []).map(function (s) { return '・' + esc_(s); }).join('<br>');
  const PAY_TH = LINE + 'height:5mm;padding:0 6px;font-weight:normal;text-align:center;font-size:12.5px;width:50%;';
  const PAY_TD = LINE + 'height:30mm;padding:1.5mm 2.5mm;vertical-align:top;font-size:12px;line-height:1.65;';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    // 用紙はA4。余白を指定しないと上端に詰まり、下が大きく空く（見本の様式と同じ配置にする）
    '@page{size:A4 portrait;margin:13mm 13mm 12mm 13mm;}' +
    'body{font-family:sans-serif;color:#111;font-size:12.5px;margin:0;}' +
    'table{border-collapse:collapse;}' +
    '</style></head><body>' +
    '<div style="padding-top:6mm;text-align:center;font-size:27px;letter-spacing:10px;line-height:1.2;">御 請 求 書</div>' +
    '<div style="margin-top:4.3mm;text-align:right;">' + today_() + '</div>' +
    '<table style="width:100%;margin-top:7.4mm;"><tr>' +
      '<td style="' + NB + 'width:56%;">' +
        '<table style="width:92%;"><tr><td style="border:none;border-bottom:2px solid #222;padding:0 4px 1.5mm;font-size:' + toSize + 'px;">' +
          esc_(toText) + '</td></tr></table>' +
        '<div style="margin-top:2.5mm;line-height:1.8;">【諸条件】<br>' + esc_(subject) + '</div>' +
        '<table style="width:82%;margin-top:6.5mm;border:2px solid #222;"><tr>' +
          '<td style="border:1px solid #222;background:#d9d9d9;height:8.4mm;padding:0 8px;font-size:11.5px;width:32%;">差引ご請求額</td>' +
          '<td style="border:1px solid #222;height:8.4mm;padding:0 8px;font-size:21px;font-weight:bold;text-align:center;">¥' +
            total.toLocaleString('ja-JP') + '</td>' +
        '</tr></table>' +
      '</td>' +
      '<td style="' + NB + 'width:44%;text-align:right;font-size:12px;line-height:1.4;padding-top:1mm;">' + issLines.join('<br>') + logo + '</td>' +
    '</tr></table>' +
    '<table style="width:100%;margin-top:3.8mm;">' +
      '<tr><th style="' + TH + 'width:40%;">品　目</th><th style="' + TH + 'width:22%;">適　用</th><th style="' + TH + 'width:38%;">金　額</th></tr>' +
      itemRows +
    '</table>' +
    '<table style="width:100%;"><tr><td style="' + NB + 'width:62%;"></td><td style="' + NB + 'width:38%;">' +
      '<table style="width:100%;"><tr>' +
        '<td style="' + LINE + 'border-top:none;background:#d9d9d9;height:7.7mm;padding:0 6px;width:30%;">合　計</td>' +
        '<td style="' + LINE + 'border-top:none;height:7.7mm;padding:0 6px;text-align:center;font-size:13px;font-weight:bold;">' + fmtYen_(total) + '</td>' +
      '</tr></table>' +
    '</td></tr></table>' +
    // 期日が無いときも同じ高さを取り、下の表の位置を変えない
    '<div style="margin:7mm 0 1mm 14mm;">' + (dueDisp ? 'お支払い期日　' + esc_(dueDisp) + ' まで' : '&nbsp;') + '</div>' +
    '<table style="width:100%;">' +
      '<tr><th style="' + PAY_TH + '">振込先</th><th style="' + PAY_TH + '">備考</th></tr>' +
      '<tr><td style="' + PAY_TD + '">' + bankLines + '</td><td style="' + PAY_TD + '">' + notes + '</td></tr>' +
    '</table>' +
    '<div style="text-align:right;font-size:9px;color:#999;margin-top:2mm;">案件ID：' + esc_(caseId) + '</div>' +
    '</body></html>';
}

/** 【動作確認用】サンプルの御請求書PDFを「御請求書」フォルダに作ります。
 *  Apps Script のエディタでこの関数を選んで「実行」→ 実行ログに出るURLで見た目を確認してください。
 *  （確認後、作られたテスト用PDFは削除してかまいません） */
function testInvoice() {
  const now = new Date();
  const due = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() + 2, 0), 'Asia/Tokyo', 'yyyy-MM-dd'); // 翌月末
  const c = { name: 'テスト 太郎', bukken: 'エイホームビル', room: '701' };
  const data = { toName: 'サンプル株式会社', toHonorific: '殿', paymentDue: due };
  const amounts = { restoreCost: 128535, penalty: 0, unpaidRent: 0, deposit: 72000, overpaidRent: 0 };
  const dstamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  const file = buildInvoice_('TEST', c, data, amounts, dstamp, 'テスト用');
  Logger.log('テスト用の御請求書を作成しました：' + file.getUrl());
}

/** 案件IDから貸主名を取り出す（進捗シートのデータJSONより） */
function caseOwner_(caseId) {
  try {
    const sheet = progressSheet_();
    const row = findRow_(sheet, caseId);
    if (row < 0) return '';
    const d = JSON.parse(sheet.getRange(row, PS_COL.json).getValue() || '{}');
    return d.owner || '';
  } catch (e) { return ''; }
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
      '<div class="toname">' + esc_(addressee_(c, data)) + '</div></div>';
    const env = isCopy
      ? '<div class="envwrap"><div class="env">' +
        (data.newAddress ? '<div>' + zipBreak_(data.newAddress) + '</div>' : '') +
        '<div class="envname">' + esc_(addressee_(c, data)) + '</div></div>' +
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
  const label4 = (data.bukken || '') + ' ' + (data.room || '') + '（' + (data.name || '') + '様）';
  lineNotify_('complete', { owner: caseOwner_(caseId) },
    '【退去精算 完了】' + label4 + '\n' + label + '（' + date + '）' + (data.confirmer ? '\n確認者：' + data.confirmer : ''),
    '【退去精算 完了】' + label4 + '\n' + label + '（' + date + '）');
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

/** 御請求書の右上に入れるロゴ（エイホームトラスト「Eihometrast」・JPEG 251×37px）。
 *  ロゴを差し替えるときは、画像を base64 にした文字列に置き換えてください */
function invoiceLogo_() {
  return 'data:image/jpeg;base64,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';
}
