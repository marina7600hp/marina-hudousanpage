/* ===================================================================
 * bukken-schema.js  ―  賃貸物件マスターの項目定義
 *
 * この1ファイルが「物件情報の正本（マスター）」です。
 * ここに項目を足せば、入力フォーム・転記ビュー・CSV出力の
 * すべてに自動で反映されます（画面side の編集は不要）。
 *
 * type の種類
 *   text      … 1行の文字入力
 *   textarea  … 複数行の文字入力
 *   number    … 数値（単位は unit に書く）
 *   select    … プルダウン（options に選択肢）
 *   checkgroup… 複数選択（options に選択肢。CSVには「・」区切りで出力）
 *   month     … 年月（例 2018-04）
 *   date      … 年月日
 *
 * 補足
 *   required:true … 未入力だと保存時に赤く警告します
 *   calc          … 他の項目から自動計算する場合の関数
 * =================================================================== */

window.BUKKEN_SCHEMA = [

  /* ---------------- 管理情報（自社用。ポータルには出しません） ------------- */
  {
    group: '管理情報',
    note: '社内で物件を管理するための欄です。ポータルサイトへの掲載項目ではありません。',
    fields: [
      { key: 'bukkenNo',    label: '物件管理番号', type: 'text', required: true, placeholder: '例）M-0001' },
      { key: 'status',      label: '掲載ステータス', type: 'select', required: true,
        options: ['募集中', '申込あり', '成約', '掲載停止'], def: '募集中' },
      { key: 'torihikiTaiyo', label: '取引態様', type: 'select', required: true,
        options: ['貸主', '代理', '専属専任媒介', '専任媒介', '一般媒介'] },
      { key: 'motozuke',    label: '元付会社', type: 'text', placeholder: '自社物件なら「自社」' },
      { key: 'shanaiMemo',  label: '社内メモ', type: 'textarea', placeholder: '鍵の場所、オーナー様のご意向など' }
    ]
  },

  /* ---------------- 建物 ------------------------------------------------- */
  {
    group: '建物',
    fields: [
      { key: 'buildingName',     label: '建物名', type: 'text', required: true, placeholder: '例）マリーナーハイツ' },
      { key: 'buildingNameKana', label: '建物名カナ', type: 'text', placeholder: '例）マリーナーハイツ' },
      { key: 'buildingType',     label: '建物種別', type: 'select', required: true,
        options: ['アパート', 'マンション', '一戸建て', 'テラスハウス', '店舗・事務所', 'その他'] },
      { key: 'structure',        label: '構造', type: 'select',
        options: ['木造', '軽量鉄骨', '重量鉄骨', '鉄骨造', 'RC（鉄筋コンクリート）', 'SRC（鉄骨鉄筋コンクリート）', 'ブロック', 'その他'] },
      { key: 'floorsAbove',      label: '地上何階建', type: 'number', unit: '階' },
      { key: 'floorsBelow',      label: '地下何階建', type: 'number', unit: '階' },
      { key: 'totalUnits',       label: '総戸数', type: 'number', unit: '戸' },
      { key: 'builtYm',          label: '築年月', type: 'month', required: true, hint: '新築の場合は完成予定year月' },
      { key: 'isNew',            label: '新築', type: 'select', options: ['', '新築', '築浅'], def: '' },
      { key: 'kanrinin',         label: '管理人', type: 'select',
        options: ['', '常駐', '日勤', '巡回', '無'], def: '' }
    ]
  },

  /* ---------------- 所在地 ----------------------------------------------- */
  {
    group: '所在地',
    fields: [
      { key: 'zip',       label: '郵便番号', type: 'text', placeholder: '例）737-0132' },
      { key: 'pref',      label: '都道府県', type: 'text', required: true, def: '広島県' },
      { key: 'city',      label: '市区町村', type: 'text', required: true, placeholder: '例）呉市' },
      { key: 'town',      label: '町名・丁目', type: 'text', required: true, placeholder: '例）仁方大歳町' },
      { key: 'banchi',    label: '番地', type: 'text', placeholder: '例）1-2-3' },
      { key: 'showBanchi',label: '番地の公開', type: 'select',
        options: ['公開する', '非公開（町名まで）'], def: '公開する' },
      { key: 'roomNo',    label: '部屋番号', type: 'text', placeholder: '例）201' },
      { key: 'showRoomNo',label: '部屋番号の公開', type: 'select',
        options: ['公開する', '非公開'], def: '非公開' }
    ]
  },

  /* ---------------- 交通 ------------------------------------------------- */
  {
    group: '交通',
    note: 'ポータルサイトは3路線まで登録できることが多いため、3つ分ご用意しています。',
    fields: [
      { key: 'line1', label: '路線1', type: 'text', placeholder: '例）JR呉線' },
      { key: 'sta1',  label: '駅1',   type: 'text', placeholder: '例）仁方' },
      { key: 'walk1', label: '駅1 徒歩', type: 'number', unit: '分' },
      { key: 'bus1',      label: '駅1 バス乗車', type: 'number', unit: '分', hint: 'バス利用の場合のみ' },
      { key: 'busStop1',  label: '駅1 バス停名', type: 'text' },
      { key: 'busWalk1',  label: '駅1 バス停から徒歩', type: 'number', unit: '分' },
      { key: 'line2', label: '路線2', type: 'text' },
      { key: 'sta2',  label: '駅2',   type: 'text' },
      { key: 'walk2', label: '駅2 徒歩', type: 'number', unit: '分' },
      { key: 'line3', label: '路線3', type: 'text' },
      { key: 'sta3',  label: '駅3',   type: 'text' },
      { key: 'walk3', label: '駅3 徒歩', type: 'number', unit: '分' },
      { key: 'otherAccess', label: 'その他の交通', type: 'text', placeholder: '例）呉ICより車で15分' }
    ]
  },

  /* ---------------- 部屋 ------------------------------------------------- */
  {
    group: '部屋',
    fields: [
      { key: 'floor',      label: '所在階', type: 'number', unit: '階', required: true },
      { key: 'madori',     label: '間取り', type: 'select', required: true,
        options: ['1R', '1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '3LDK', '4K', '4DK', '4LDK', '5K以上', 'その他'] },
      { key: 'madoriDetail', label: '間取り内訳', type: 'text', placeholder: '例）洋6・和4.5・DK4' },
      { key: 'area',       label: '専有面積', type: 'number', unit: '㎡', required: true, step: '0.01' },
      { key: 'balconyArea',label: 'バルコニー面積', type: 'number', unit: '㎡', step: '0.01' },
      { key: 'direction',  label: '向き', type: 'select',
        options: ['', '南', '南東', '東', '北東', '北', '北西', '西', '南西'], def: '' },
      { key: 'genkyo',     label: '現況', type: 'select', required: true,
        options: ['空室', '居住中', '未完成', '未定'], def: '空室' },
      { key: 'nyukyoKa',   label: '入居可能日', type: 'select', required: true,
        options: ['即入居可', '相談', '期日指定'], def: '即入居可' },
      { key: 'nyukyoDate', label: '入居可能日（期日指定の場合）', type: 'date' }
    ]
  },

  /* ---------------- 費用 ------------------------------------------------- */
  {
    group: '費用',
    note: '敷金・礼金は「ヶ月」で入れると円が自動計算されます。サイトによって月数と金額のどちらを求められるか異なるため、両方持たせています。',
    fields: [
      { key: 'chinryo',      label: '賃料', type: 'number', unit: '円', required: true, placeholder: '例）45000' },
      { key: 'kanrihi',      label: '管理費・共益費', type: 'number', unit: '円', def: '0' },
      { key: 'shikikinM',    label: '敷金', type: 'number', unit: 'ヶ月', step: '0.5' },
      { key: 'shikikinYen',  label: '敷金（円）', type: 'number', unit: '円',
        calc: function (v) { return v.shikikinM && v.chinryo ? Math.round(v.shikikinM * v.chinryo) : ''; } },
      { key: 'reikinM',      label: '礼金', type: 'number', unit: 'ヶ月', step: '0.5' },
      { key: 'reikinYen',    label: '礼金（円）', type: 'number', unit: '円',
        calc: function (v) { return v.reikinM && v.chinryo ? Math.round(v.reikinM * v.chinryo) : ''; } },
      { key: 'hoshokin',     label: '保証金', type: 'number', unit: '円' },
      { key: 'shikibiki',    label: '敷引・償却', type: 'text', placeholder: '例）1ヶ月 / 30%' },
      { key: 'koshinryo',    label: '更新料', type: 'text', placeholder: '例）新賃料の1ヶ月' },
      { key: 'chukaiTesuryo',label: '仲介手数料', type: 'text', placeholder: '例）賃料の1ヶ月＋消費税' },
      { key: 'parkingUmu',   label: '駐車場', type: 'select',
        options: ['空有', '空無', '近隣にあり', '無'], def: '空有' },
      { key: 'parkingFee',   label: '駐車場料金', type: 'number', unit: '円/月' },
      { key: 'kagiKokan',    label: '鍵交換費', type: 'number', unit: '円' },
      { key: 'kasaiHoken',   label: '火災保険', type: 'text', placeholder: '例）要・2年 15,000円' },
      { key: 'hoshoGaisha',  label: '保証会社', type: 'text', placeholder: '例）要・ナップ賃貸保証' },
      { key: 'hoshoRyo',     label: '保証料', type: 'text', placeholder: '例）賃料の50%（初回）' },
      { key: 'otherIchiji',  label: 'その他一時金', type: 'text' },
      { key: 'otherGetsugaku', label: 'その他月額費用', type: 'text', placeholder: '例）町内会費 500円' }
    ]
  },

  /* ---------------- 契約条件 --------------------------------------------- */
  {
    group: '契約条件',
    fields: [
      { key: 'keiyakuType',   label: '契約種別', type: 'select',
        options: ['普通借家', '定期借家'], def: '普通借家' },
      { key: 'keiyakuKikan',  label: '契約期間', type: 'text', def: '2年' },
      { key: 'pet',       label: 'ペット', type: 'select', options: ['不可', '相談', '可'], def: '不可' },
      { key: 'gakki',     label: '楽器', type: 'select', options: ['不可', '相談', '可'], def: '不可' },
      { key: 'jimusho',   label: '事務所使用', type: 'select', options: ['不可', '相談', '可'], def: '不可' },
      { key: 'futari',    label: '二人入居', type: 'select', options: ['不可', '相談', '可'], def: '相談' },
      { key: 'share',     label: 'ルームシェア', type: 'select', options: ['不可', '相談', '可'], def: '不可' },
      { key: 'kourei',    label: '高齢者', type: 'select', options: ['不可', '相談', '可'], def: '相談' },
      { key: 'gakusei',   label: '学生', type: 'select', options: ['不可', '相談', '可'], def: '可' },
      { key: 'houjin',    label: '法人契約', type: 'select', options: ['不可', '相談', '可'], def: '可' },
      { key: 'gaikoku',   label: '外国人', type: 'select', options: ['不可', '相談', '可'], def: '相談' },
      { key: 'kodomo',    label: '子供', type: 'select', options: ['不可', '相談', '可'], def: '可' },
      { key: 'kitsuen',   label: '喫煙', type: 'select', options: ['不可', '相談', '可'], def: '相談' }
    ]
  },

  /* ---------------- 設備・条件 ------------------------------------------- */
  {
    group: '設備・条件',
    note: '当てはまるものにチェックを入れてください。CSVには「・」区切りで出力されます。',
    fields: [
      { key: 'setsubiKitchen', label: 'キッチン', type: 'checkgroup', options:
        ['システムキッチン', 'ガスコンロ設置可', 'ガスコンロ2口', 'ガスコンロ3口以上', 'IHクッキングヒーター', 'カウンターキッチン', '給湯', '冷蔵庫あり'] },
      { key: 'setsubiBath',    label: 'バス・トイレ', type: 'checkgroup', options:
        ['バス・トイレ別', '追焚機能', '浴室乾燥機', '温水洗浄便座', '独立洗面台', '洗面化粧台', 'シャワー', '脱衣所'] },
      { key: 'setsubiRoom',    label: '室内設備', type: 'checkgroup', options:
        ['エアコン', 'フローリング', '室内洗濯機置場', '屋外洗濯機置場', 'バルコニー', '床暖房', 'ウォークインクローゼット', '収納あり', '押入', 'クッションフロア', '下駄箱', '洗濯機置場あり'] },
      { key: 'setsubiSecurity',label: 'セキュリティ', type: 'checkgroup', options:
        ['オートロック', 'TVモニタ付インターホン', 'インターホン', '防犯カメラ', 'ディンプルキー', '管理人あり'] },
      { key: 'setsubiNet',     label: '通信', type: 'checkgroup', options:
        ['インターネット無料', 'インターネット対応', '光ファイバー', 'CATV', 'BSアンテナ', 'CSアンテナ'] },
      { key: 'setsubiBuilding',label: '建物・共用', type: 'checkgroup', options:
        ['エレベーター', '駐輪場', 'バイク置場', '敷地内ゴミ置場', '宅配ボックス', '専用庭', 'ロフト'] },
      { key: 'setsubiPosition',label: '位置・条件', type: 'checkgroup', options:
        ['2階以上', '角部屋', '最上階', '南向き', '東南角部屋', '1階', '駐車場2台以上可'] },
      { key: 'gasType',        label: 'ガス', type: 'select',
        options: ['', '都市ガス', 'プロパンガス', 'ガスなし（オール電化）'], def: '' }
    ]
  },

  /* ---------------- 紹介文・画像 ----------------------------------------- */
  {
    group: '紹介文・画像',
    note: '画像は各サイトの管理画面から直接アップロードしてください。ここにはファイル名だけ控えておきます。',
    fields: [
      { key: 'catchCopy', label: 'キャッチコピー', type: 'text', maxlength: 40,
        placeholder: '例）JR仁方駅 徒歩5分・海が見える角部屋' },
      { key: 'appeal',    label: '物件PR・備考', type: 'textarea',
        placeholder: '例）2023年に室内full面リフォーム済み。追焚機能付きの広めのお風呂が自慢です。' },
      { key: 'imgGaikan', label: '外観写真 ファイル名', type: 'text', placeholder: '例）M-0001_gaikan.jpg' },
      { key: 'imgMadori', label: '間取り図 ファイル名', type: 'text', placeholder: '例）M-0001_madori.jpg' },
      { key: 'imgRoom',   label: '室内写真 ファイル名', type: 'textarea',
        placeholder: '1行に1つずつ（例）\nM-0001_yoshitsu.jpg\nM-0001_kitchen.jpg' }
    ]
  }
];
