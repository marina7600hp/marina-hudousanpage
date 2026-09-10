/* ===================================================================
 * bukken-portals.js  ―  各ポータルサイトへの「対応表」
 *
 * ★ 各社から入稿仕様書をもらったら、編集するのはこのファイルだけです。
 *   物件マスター（bukken-schema.js）や画面（bukken.html）は触りません。
 *
 * -------------------------------------------------------------------
 * 【書き方】
 *
 *   columns: [
 *     { header: '物件名',  from: 'buildingName' },   ← 相手の列名 : こちらの項目キー
 *     { header: '賃料',    from: 'chinryo' },
 *     { header: '所在地',  from: function (v) { return v.pref + v.city + v.town; } },
 *     { header: '掲載区分', value: '1' },            ← 常に固定の値を入れる場合
 *   ]
 *
 *   header … 相手のCSVの列名（仕様書のとおりに、一字一句そのまま書いてください）
 *   from   … bukken-schema.js の key。関数にすると複数項目を組み立てられます。
 *   value  … 全物件に共通の固定値を入れたいとき
 *
 *   ready  … false の間はCSVボタンが押せません。対応表を書き終えたら true に。
 *   encoding … 'sjis'（Shift_JIS）か 'utf8'。日本のポータルは sjis 指定が多いです。
 *              仕様書に「文字コード」の記載があるはずなので、それに合わせてください。
 *   newline  … 'crlf' か 'lf'。指定がなければ crlf のままで問題ありません。
 *
 * -------------------------------------------------------------------
 * 【各社に問い合わせる内容】そのままコピーしてお使いいただけます。
 *
 *   「自社で管理している物件データを御社サイトへ掲載するにあたり、
 *     1件ずつ手入力するのではなく、まとめて登録したいと考えております。
 *     つきましては下記についてご教示ください。
 *       ① CSV等での一括入稿（一括アップロード）に対応していますか
 *       ② 対応している場合、入稿仕様書（列名の一覧・文字コード・
 *          必須項目・コード表）をいただけますか
 *       ③ API等でのデータ連携に対応していますか
 *       ④ 他社の不動産業務システムからのコンバート入稿に対応していますか
 *          （対応している場合、対応システム名の一覧）」
 *
 *   ④ が「対応あり」で、その中に御社がお使いのシステムが含まれていれば、
 *   そちら経由が一番手間がかかりません。
 * =================================================================== */

window.BUKKEN_PORTALS = {

  /* ================= 自社マスター（常に使えます） ================= */
  master: {
    label: '自社マスター（全項目）',
    ready: true,
    encoding: 'utf8',
    note: 'すべての項目をそのまま書き出します。スプレッドシートでの保管や、'
        + 'パソコンを買い替えるときのバックアップにお使いください。',
    columns: 'ALL'      // ← 全項目を自動で出力する特別な指定
  },

  /* ================= スーモ ================= */
  suumo: {
    label: 'スーモ',
    ready: false,                    // ← 仕様書が届いたら true に変更
    encoding: 'sjis',
    note: '入稿仕様書を受け取りしだい、下の columns を埋めてください。',
    columns: [
      /* ↓↓↓ ここから下は「こう書きます」という見本です。 ↓↓↓
         実際の列名は必ず仕様書に合わせて書き換えてください。
         不要な行は削除、足りない行は追加してください。

      { header: '物件名',       from: 'buildingName' },
      { header: '物件名カナ',   from: 'buildingNameKana' },
      { header: '建物種別',     from: 'buildingType' },
      { header: '所在地',       from: function (v) {
          return v.pref + v.city + v.town + (v.showBanchi === '公開する' ? v.banchi : '');
        } },
      { header: '沿線',         from: 'line1' },
      { header: '駅',           from: 'sta1' },
      { header: '徒歩分数',     from: 'walk1' },
      { header: '賃料',         from: 'chinryo' },
      { header: '管理費',       from: 'kanrihi' },
      { header: '敷金',         from: 'shikikinYen' },
      { header: '礼金',         from: 'reikinYen' },
      { header: '間取り',       from: 'madori' },
      { header: '専有面積',     from: 'area' },
      { header: '築年月',       from: 'builtYm' },
      { header: '所在階',       from: 'floor' },
      { header: '設備',         from: function (v) {
          return [v.setsubiKitchen, v.setsubiBath, v.setsubiRoom,
                  v.setsubiSecurity, v.setsubiNet, v.setsubiBuilding]
                 .filter(function (x) { return x; }).join('・');
        } },
      { header: '取引態様',     from: 'torihikiTaiyo' },
      { header: 'キャッチコピー', from: 'catchCopy' },
      { header: '備考',         from: 'appeal' },

         ↑↑↑ ここまで見本 ↑↑↑ */
    ]
  },

  /* ================= スマイミー ================= */
  sumaimy: {
    label: 'スマイミー',
    ready: false,
    encoding: 'sjis',
    note: '入稿仕様書を受け取りしだい、columns を埋めてください。'
        + '一括入稿に対応していない場合は、右の「転記ビュー」をお使いください。',
    columns: []
  },

  /* ================= きまるーむ ================= */
  kimaroom: {
    label: 'きまるーむ',
    ready: false,
    encoding: 'sjis',
    note: '入稿仕様書を受け取りしだい、columns を埋めてください。'
        + '一括入稿に対応していない場合は、右の「転記ビュー」をお使いください。',
    columns: []
  }
};
