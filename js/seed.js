/* Kōza v2 — お試しのデータ
 *
 * 本番前に、画面の見え方と手触りを確かめるためのもの。
 * 「50名いるとどう見えるか」は、3名では絶対に分からない。
 *
 * 作るのは、実際の使い方に近い形にしてある。
 *   - 口座がばらけている（自分／ママ／ほかの方／フリー）
 *   - 太いお客様と、たまにお越しになる方が混ざっている
 *   - お誘い → ご来店 の記録があるので、リードタイムと打率が出る
 *   - 外したお誘いも入れてある。全部当たっているデータは嘘になる
 *
 * ■ 会話は「筋書き」で続く
 *
 * ここがいちばん大事なところ。
 * 1回ごとに無関係な話題が並ぶだけのデータでは、このアプリの値打ちが確かめられない。
 * 「前回の話の続き」も「席で伺っておくこと」も、話が続いていて初めて意味を持つ。
 *
 * だから、お客様ごとに一本の筋書き（ご息女の受験、新しい現場、社長交代…）を持たせて、
 * ご来店のたびに一段ずつ進むようにしてある。
 *   1回目「受験が来年です」 → 2回目「来月に迫っています」 → 3回目「合格しました」
 * 前の回で開いた宿題が、あとの回で閉じる。閉じないまま残るものもある。
 * 実際のお客様との関係も、そういう形で進む。
 *
 * **お渡しする前に必ず「全部消す」を押すこと。**
 * 手順は DEPLOY.md に書いてある。
 */
var Seed = (function () {
  'use strict';

  /* 毎回同じデータが出るようにする。話が食い違わないため。
   * 掛け算が JS の安全整数を超えると桁が落ちて、出る値が偏る。
   * Math.imul を使って32ビットに収める。 */
  var seed = 20260817 >>> 0;
  function rnd() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function ri(min, max) { return min + Math.floor(rnd() * (max - min + 1)); }
  function chance(p) { return rnd() < p; }

  var SURNAMES = [
    ['田中', '健一'], ['佐藤', '浩之'], ['鈴木', '正明'], ['高橋', '隆司'], ['伊藤', '誠'],
    ['渡辺', '和彦'], ['山本', '剛'], ['中村', '英樹'], ['小林', '洋一'], ['加藤', '直樹'],
    ['吉田', '修'], ['山田', '拓也'], ['佐々木', '聡'], ['山口', '博'], ['松本', '大輔'],
    ['井上', '康夫'], ['木村', '隆之'], ['林', '秀樹'], ['斎藤', '義弘'], ['清水', '俊介'],
    ['山崎', '信也'], ['森本', '雅之'], ['池田', '淳'], ['橋本', '圭介'], ['阿部', '光男'],
    ['石川', '浩一'], ['山下', '勝'], ['中島', '良治'], ['石井', '達也'], ['小川', '浩二'],
    ['前田', '学'], ['岡田', '信一'], ['長谷川', '誠司'], ['藤田', '健太郎'], ['後藤', '武'],
    ['近藤', '幸雄'], ['村上', '智之'], ['遠藤', '裕一'], ['青木', '宏'], ['坂本', '善治'],
    ['福田', '充'], ['太田', '茂'], ['西村', '和也'], ['藤井', '克彦'], ['金子', '英二'],
    ['中川', '雅彦'], ['中野', '正人'], ['原田', '卓也'], ['田村', '庄一'], ['宮本', '康弘']
  ];

  var COMPANIES = [
    '大阪商事', '淀屋橋鋼材', '関西建機', '北浜製薬', '堂島物流',
    '阪神電設', '難波不動産', '中之島銀行', '天満興産', '梅田ホールディングス',
    '京橋精密', '心斎橋アパレル', '泉州化学', '河内食品', '摂津運輸',
    '和泉テクノ', '神戸海運', '京都繊維', '奈良機工', '滋賀電子'
  ];

  var TITLES = ['部長', '課長', '取締役', '代表取締役', '専務', '常務', '支店長', '次長', '係長', '顧問'];
  var DEPTS = ['営業部', '管理部', '技術部', '経営企画部', '購買部', '人事部', ''];

  var INTERESTS = ['ゴルフ', '日本酒', 'ワイン', '競馬', '釣り', '野球観戦', '落語', '茶道',
    'クラシック', '登山', 'カメラ', '将棋', '陶芸', '料理', 'ジャズ', '相撲', '歌舞伎', 'サウナ', '読書'];

  var DRINKS = ['芋焼酎 水割り', '麦焼酎 ロック', 'ハイボール', '赤ワイン', 'シャンパン', '日本酒 冷や', 'ビール'];
  var BOTTLES = ['響17年', '山崎12年', '白州', '森伊蔵', '村尾', 'バランタイン17年', 'ドンペリニヨン'];
  var FOODS = ['寿司', '焼肉', '天ぷら', 'フレンチ', '割烹', '鉄板焼き'];

  var LIKES = ['氷は少なめ', '濃いめの水割り', '奥の席', '静かめの音楽', '最初はビール',
    '乾き物より果物', 'おしぼりは熱め'];
  var DISLIKES = ['カラオケ', '香水の強い席', '長居', '大人数', '早い時間の来店'];

  var RELATIONS = ['奥様', 'ご息女', 'ご子息', 'お母様'];
  var PLACES = ['東京', '名古屋', '福岡', '北浜', '本町', '広島', '仙台', '金沢'];
  var SCHOOLS = ['京都', '神戸', '東京', '大阪市内'];
  var WHENS = ['来月', '再来月', '年明け', '春先'];

  /* ============================================================
   * 筋書き
   *
   * ご来店のたびに一段ずつ進む。
   *   talk  … その日に出た話（顧客カードの「前回の話」に出る）
   *   memo  … 帰り道に本人が吹き込んだ言葉（整理の材料）
   *   hook  … その日にできた宿題。次のお声がけの起点になる
   *   close … その日に片づいた宿題（前の回の hook を閉じる）
   * ============================================================ */

  var ARCS = [
    {
      key: 'juken', family: true,
      beats: [
        { talk: '{rel}の受験の話。{school}の学校を第一志望にされているとのこと。塾の送り迎えを奥様と分担されているそうで、「久しぶりに親らしいことをしている」と笑っておられた。',
          memo: '{rel}の受験の話。{school}の学校が第一志望らしい。塾の送り迎えを奥様と分担してるって。久しぶりに親らしいことしてるわ、って笑ってはった。',
          hook: '{rel}の受験' },
        { talk: '{rel}の受験が来月に迫っているとのこと。「本人よりこちらが落ち着かない」と。願掛けで好きな煙草を断っておられるそうです。',
          memo: '{rel}の受験、来月やって。本人よりこっちが落ち着かんって。願掛けで煙草やめてはるらしい。',
          hook: '{rel}の受験の結果' },
        { talk: '{rel}が第一志望に合格されたとのご報告。声が明らかに弾んでおられた。煙草も無事に解禁とのこと。お祝いをこちらでという話になった。',
          memo: '{rel}、第一志望受かったって！声がめっちゃ弾んでた。煙草も解禁やって。お祝いうちでやろかって話になった。',
          close: '{rel}の受験の結果', hook: '合格のお祝いの席' },
        { talk: '{rel}の入学式のお写真を見せていただいた。下宿の準備で{school}に何度も通われているとのこと。',
          memo: '{rel}の入学式の写真見せてもろた。下宿の準備で{school}に何回も行ってはるみたい。',
          close: '合格のお祝いの席' }
      ]
    },
    {
      key: 'genba',
      beats: [
        { talk: '{place}で新しい現場が始まるとのこと。着工は{when}で、ご自分が現場に入られる期間が長くなりそうだと。',
          memo: '{place}で新しい現場始まるって。着工は{when}。しばらく現場に張り付きになるらしい。',
          hook: '{place}の現場の着工' },
        { talk: '{place}の現場が着工したとのこと。人手の手配で苦労されている様子で、「若い子が続かない」と。しばらくお越しになる間隔が空くかもしれないと言っておられた。',
          memo: '{place}の現場、着工したって。人の手配が大変らしくて、若い子が続かへんって。しばらく来る間隔空くかもって。',
          close: '{place}の現場の着工', hook: '現場が落ち着く頃' },
        { talk: '{place}の現場が山を越えたとのこと。久しぶりにゆっくりされて、いつもより長くお座りになった。次の現場の話も少し出た。',
          memo: '{place}の現場、山越えたって。久しぶりにゆっくりしてはって、いつもより長かった。次の現場の話もちょっと出た。',
          close: '現場が落ち着く頃' },
        { talk: '次の現場が{place2}に決まったとのこと。今度は{n1}か月ほどの短期だと。前の現場の反省を活かして人を先に押さえたとおっしゃっていた。',
          memo: '次の現場{place2}に決まったって。今度は{n1}か月の短期。前の反省で人を先に押さえたらしい。',
          hook: '{place2}の現場' }
      ]
    },
    {
      key: 'compe',
      beats: [
        { talk: '{i}のコンペに出られる話。{when}に{place}のコースで、取引先の社長も一緒だとのこと。前回は最下位だったと苦笑いされていた。',
          memo: '{i}のコンペ出はるって。{when}に{place}のコース。取引先の社長も一緒らしい。前回ビリやったって苦笑いしてはった。',
          hook: '{i}のコンペ' },
        { talk: '{i}のコンペの結果を伺った。真ん中より少し上だったとのことで、ご満足の様子。道具を新調されたのが効いたと。',
          memo: '{i}のコンペ、真ん中より上やったって。満足そうやった。道具新しくしたのが効いたって。',
          close: '{i}のコンペ', hook: '新しい道具の話' },
        { talk: '新調された道具の話を詳しく伺った。次のコンペは{when}で、今度は上位を狙うとのこと。',
          memo: '新しい道具の話、詳しく聞いた。次のコンペは{when}。今度は上位狙うって。',
          close: '新しい道具の話', hook: '次のコンペ' }
      ]
    },
    {
      key: 'shousin',
      beats: [
        { talk: '社内の人事の話。{when}に動きがありそうだとのことで、ご自分の処遇についても含みのある言い方をされていた。',
          memo: '社内の人事の話。{when}に動きあるらしい。自分の処遇についても含みのある言い方してはった。',
          hook: '{when}の人事' },
        { talk: '昇進が決まったとのご報告。責任が増えるぶん、部下の面倒を見る時間が要るとおっしゃっていた。お祝いを申し上げた。',
          memo: '昇進決まったって！責任増えるぶん部下の面倒見る時間がいるって。お祝い言うといた。',
          close: '{when}の人事', hook: '昇進のお祝い' },
        { talk: '新しい立場になられてひと月。決裁の量に驚いておられた。部下を連れてこちらへ、という話が出た。',
          memo: '新しい立場になってひと月。決裁の量にびっくりしてはる。部下連れてうちに来る話出た。',
          close: '昇進のお祝い', hook: '部下の方をお連れになる話' }
      ]
    },
    {
      key: 'ryoko', family: true,
      beats: [
        { talk: 'ご結婚記念日のご旅行を計画されている話。{place}をお考えだが、宿がなかなか取れないとのこと。',
          memo: '結婚記念日の旅行の話。{place}考えてはるけど宿が取れへんらしい。',
          hook: 'ご記念日のご旅行' },
        { talk: '{place}へのご旅行に行ってこられた話。奥様がたいへん喜ばれたそうで、お土産の話を長くされていた。',
          memo: '{place}行ってきはった。奥様めっちゃ喜んでたって。お土産の話長かった。',
          close: 'ご記念日のご旅行', hook: '次はご家族全員での旅行' },
        { talk: '次はご家族全員でとお考えとのこと。ただ{rel}の予定が合わないそうで、{when}以降になりそうだと。',
          memo: '次は家族全員でって。{rel}の予定が合わへんくて{when}以降になりそうやって。' }
      ]
    },
    {
      key: 'karada',
      beats: [
        { talk: '健康診断で数値を指摘された話。しばらく節制されるとのことで、この日は水割りを薄めにお作りした。',
          memo: '健康診断で数値言われたって。しばらく節制するらしいから、今日は水割り薄めにした。',
          hook: '節制されている件' },
        { talk: '節制の成果が出て、体重が{n1}キロ落ちたとのこと。ただ「そろそろ反動が来そう」と笑っておられた。この日も薄めでお出しした。',
          memo: '節制の成果出て{n1}キロ落ちたって。そろそろ反動来そうって笑ってはった。今日も薄めで。',
          hook: '数値の再検査' },
        { talk: '再検査の結果が良かったとのこと。久しぶりに通常の濃さでお出しした。無理のない範囲でと申し上げた。',
          memo: '再検査の結果よかったって。久しぶりに普通の濃さで出した。無理せんようにって言うといた。',
          close: '数値の再検査' }
      ]
    },
    {
      key: 'shumi',
      beats: [
        { talk: '{i2}を始められた話。{y}年ぶりに新しいことを始めたそうで、道具を一式そろえたと嬉しそうにされていた。',
          memo: '{i2}始めはったって。{y}年ぶりに新しいこと始めたらしくて、道具一式そろえたって嬉しそうやった。',
          hook: '{i2}を始められた件' },
        { talk: '{i2}の進み具合を伺った。思ったより難しいとのことだが、続けておられる様子。{when}に発表の場があるとのこと。',
          memo: '{i2}の進み具合聞いた。思ったより難しいらしいけど続けてはる。{when}に発表の場あるって。',
          close: '{i2}を始められた件', hook: '{when}の発表' },
        { talk: '{i2}の発表を終えられたとのこと。写真を見せていただいた。次の目標もお決めになっている様子。',
          memo: '{i2}の発表終わったって。写真見せてもろた。次の目標も決めてはるみたい。',
          close: '{when}の発表' }
      ]
    },
    {
      key: 'settai',
      beats: [
        { talk: '{place}の取引先との商談の話。{when}に先方がこちらへ来られるそうで、接待の店をお探しとのこと。',
          memo: '{place}の取引先との商談の話。{when}に先方がこっち来はるらしくて、接待の店探してはる。',
          hook: '{when}のご接待' },
        { talk: 'ご接待の帰りにお立ち寄りくださった。先方に喜んでいただけたとのことで、ほっとされた様子。お連れの方は{f}がお好きだったと。',
          memo: '接待の帰りに寄ってくれはった。先方に喜んでもろたってほっとしてはった。連れの方は{f}が好きやったって。',
          close: '{when}のご接待', hook: '先方の再訪' },
        { talk: '先方との取引がまとまったとのご報告。次に来られるときは、こちらへお連れしたいとおっしゃっていた。',
          memo: '先方との取引まとまったって。次来はるときはうちに連れてきたいって言うてくれはった。',
          close: '先方の再訪', hook: '先方をお連れになる話' }
      ]
    },
    {
      key: 'shushoku', family: true,
      beats: [
        { talk: '{rel}の就職活動の話。志望されている業界がご自分と違うそうで、口を出さないようにしているとのこと。',
          memo: '{rel}の就活の話。志望してる業界が自分と違うらしくて、口出さんようにしてるって。',
          hook: '{rel}の就職活動' },
        { talk: '{rel}の内定が出たとのこと。{place}の会社で、来春から家を出られるそうです。「寂しいような、ほっとしたような」と。',
          memo: '{rel}の内定出たって。{place}の会社で来春から家出はるって。寂しいような、ほっとしたような、って。',
          close: '{rel}の就職活動', hook: '{rel}のご就職のお祝い' },
        { talk: '{rel}が家を出られたとのこと。ご夫婦二人の生活に戻って、かえって会話が増えたと。',
          memo: '{rel}、家出はったって。夫婦二人に戻って、かえって会話増えたらしい。',
          close: '{rel}のご就職のお祝い' }
      ]
    },
    {
      key: 'ie',
      beats: [
        { talk: 'ご自宅の建て替えを検討されている話。{n1}社から見積もりを取っておられるとのこと。',
          memo: '自宅の建て替え検討してるって。{n1}社から見積もり取ってるらしい。',
          hook: 'ご自宅の建て替え' },
        { talk: '建て替えの業者が決まったとのこと。着工までに仮住まいを探さねばならず、それが一番面倒だと。',
          memo: '建て替えの業者決まったって。着工までに仮住まい探さなあかんくて、それが一番面倒やって。',
          hook: '仮住まいのこと' },
        { talk: '仮住まいへの引っ越しを終えられたとのこと。荷物の多さに驚かれたそうで、しばらく落ち着かない日が続くと。',
          memo: '仮住まいに引っ越し終わったって。荷物の多さにびっくりしたらしい。しばらく落ち着かへんって。',
          close: '仮住まいのこと', hook: '新しいお住まいの完成' }
      ]
    }
  ];

  /* 筋書きの合間に挟む単発の話。毎回筋書きの話だけだと、かえって嘘くさい */
  var SIDE = [
    '{i}の話も少し。今年は{n1}回ほど行かれたとのこと。',
    '{co}の決算期の話。今期は堅調とのこと。',
    '{place2}へのご出張の話。{n1}日ほど留守にされるそうです。',
    'お好きな{f}の店の話。新しくできた店を教えていただいた。',
    '最近{i2}を再開されたとのこと。',
    'お知り合いの方の近況を伺った。',
    '',
    ''
  ];

  var OBSERVATIONS = [
    'ゴルフの話になってから、ご自分から話される時間が長くなった。',
    '価格を確認してから注文された。',
    'いつもより早めにお帰りになった。',
    'ご同席の方に何度も酒を勧めておられた。',
    '携帯を何度か確認されていた。',
    'お話しの途中で何度も時計をご覧になっていた。',
    'いつもより口数が多かった。',
    ''
  ];

  /* お誘いの文。会話の記録を起点にする形にしてある。
   * どなたにでも送れる文だけが並ぶと、このアプリの値打ちが確かめられない */
  var INVITE_TEXTS = {
    star: '先日伺った{hook}の件、その後いかがでしたか。またお聞かせいただければ嬉しく存じます。',
    info: '{b}が入りましたので、お知らせまで。',
    rely: '{i}のことで少しお知恵をお借りしたく、ご連絡いたしました。',
    choice: '今週でしたら木曜と金曜、どちらがご都合よろしいでしょうか。',
    meal: '一度伺ってみたい{f}のお店ができました。お時間が合えばぜひご一緒に。',
    report: '先日おっしゃっていた{i}のこと、少し調べてみました。ご無理のないときにでも。',
    deadline: 'お預かりしております{bt}が残り少なくなってまいりました。'
  };

  function mmdd(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** 筋書きの中で値が揺れないよう、お客様ごとに一度だけ決める */
  function makeCtx(c) {
    var kid = (c.family || []).filter(function (f) {
      return f.relation === 'ご息女' || f.relation === 'ご子息';
    })[0];
    var any = (c.family || [])[0];
    return {
      rel: (kid && kid.relation) || (any && any.relation) || 'ご家族',
      place: pick(PLACES),
      place2: pick(PLACES),
      school: pick(SCHOOLS),
      i: (c.interests || ['お仕事'])[0],
      i2: (c.interests || [])[1] || pick(INTERESTS),
      f: (c.prefs && c.prefs.food && c.prefs.food[0]) || pick(FOODS),
      b: pick(BOTTLES),
      co: c.company || '会社',
      when: pick(WHENS),
      n1: String(ri(2, 9)),
      y: String(ri(3, 20)),
      hook: '',
      bt: ''
    };
  }

  function fillT(tpl, ctx) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) {
      return ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : '';
    });
  }

  /* ---------- 本体 ---------- */

  function install() {
    var T = Store.today();
    var D = Store.addDays;

    Store.saveProfile({
      configured: true,
      my_role: 'kakari',
      shimei_system: 'eikyu',
      closing_day: 0,
      // 50名・平均24万なら月500万前後は届く。届いてしまうと逆算の見どころが出ないので、
      // 少し届かない目標にしてある。実際の目標は本人が入れる
      target_sales: 8000000,
      target_douhan: 10,
      douhan_quota_monthly: 10,
      douhan_timeout_min: 30,
      open_days: [1, 2, 3, 4, 5, 6],
      closed_on_holidays: true
    });
    Store.saveGoal(Store.periodOf(T).key, { sales: 8000000, douhan: 10 });

    var made = [];

    for (var n = 0; n < 50; n++) {
      var nm = SURNAMES[n];
      var company = COMPANIES[n % COMPANIES.length];

      /* 口座の割り振り。
       * ほかの方の口座が一定数ないと、「誘えない相手」の見え方を確かめられない。 */
      var owner = 'self';
      if (n % 9 === 4) owner = 'other';
      else if (n % 17 === 7) owner = 'mama';
      else if (n % 13 === 11) owner = 'free';

      /* 太さ。3割は太客、5割は並、2割は軽め */
      var tier = n % 10 < 3 ? 'futo' : (n % 10 < 8 ? 'regular' : 'light');
      var unit = tier === 'futo' ? ri(250000, 480000)
        : tier === 'regular' ? ri(90000, 200000) : ri(40000, 80000);
      var interval = tier === 'futo' ? ri(14, 25) : (tier === 'regular' ? ri(28, 45) : ri(55, 90));

      var interests = [];
      for (var k = 0; k < ri(2, 3); k++) {
        var it = pick(INTERESTS);
        if (interests.indexOf(it) < 0) interests.push(it);
      }

      var family = [];
      if (chance(0.7)) {
        var fc = ri(1, 2);
        for (var j = 0; j < fc; j++) {
          var rel = pick(RELATIONS);
          if (family.some(function (f) { return f.relation === rel; })) continue;
          family.push({
            relation: rel,
            name: '',
            note: rel === 'ご息女' || rel === 'ご子息' ? pick(['高校三年', '大学二年', '中学生', '社会人一年目']) : '',
            // 何名かは、直近にご家族のお誕生日が来るようにしておく
            birthday: chance(0.2) ? mmdd(ri(2, 9)) : ''
          });
        }
      }

      var likes = [];
      for (var L = 0; L < ri(1, 2); L++) {
        var lk = pick(LIKES);
        if (likes.indexOf(lk) < 0) likes.push(lk);
      }

      var c = Store.createCustomer({
        name: nm[0] + ' ' + nm[1],
        display_name: nm[0] + '様',
        kana: '',
        company: company,
        department: pick(DEPTS),
        title: pick(TITLES),
        mobile: '090-' + ri(1000, 9999) + '-' + ri(1000, 9999),
        account_owner: owner,
        account_owner_name: owner === 'other' ? pick(['あやか', 'れい', 'みゆき', 'さやか']) : '',
        relation_type: owner === 'self' ? 'kakari' : 'help',
        tier: tier,
        // 1割ほどは、直近にお誕生日が来る
        birthday: chance(0.12) ? mmdd(ri(1, 10)) : mmdd(ri(40, 300)),
        interests: interests,
        prefs: {
          drinks: [pick(DRINKS)], food: [pick(FOODS)], smoke: '', karaoke: [],
          likes: likes, dislikes: chance(0.35) ? [pick(DISLIKES)] : []
        },
        ng_topics: chance(0.2) ? [pick(['政治', '前の会社のこと', 'ご家庭のこと', '健康のこと'])] : [],
        family: family,
        gift_policy: { nenga: true, ochugen: tier === 'futo', oseibo: tier !== 'light' },
        first_met: D(T, -ri(90, 700)),
        memo: ''
      });

      /* 筋書きを1本割り当てる。ご家族が要る筋書きは、ご家族のいる方にだけ */
      var ctx = makeCtx(c);
      var pool = ARCS.filter(function (a) { return !a.family || family.length > 0; });
      var arc = pool[(n * 3 + 1) % pool.length];

      /* お預かりしているボトル。
       * 「そろそろ空きます」が無いと、期限を理由にしたお誘いが一度も出せない */
      if (owner === 'self' && chance(0.45)) {
        var remain = chance(0.35) ? 'low' : pick(['full', 'half', 'half']);
        Store.addBottle(c.id, {
          name: pick(BOTTLES),
          opened_at: D(T, -ri(20, 120)),
          remain: remain,
          note: ''
        });
        ctx.bt = Store.bottlesOf(c.id)[0].name;
      }

      made.push({ c: c, unit: unit, interval: interval, tier: tier, owner: owner, ctx: ctx, arc: arc });
    }

    /* ご来店とご連絡を、古いほうから時系列に積む。
     * こうしないと「誘い → 来店」の決着が正しくつかない */
    var events = [];

    made.forEach(function (m, idx) {
      var c = m.c;
      var count = m.tier === 'futo' ? ri(6, 11) : (m.tier === 'regular' ? ri(3, 6) : ri(1, 3));
      var day = -ri(2, 20);   // 直近の来店日
      var dates = [];
      for (var v = 0; v < count; v++) {
        dates.push(day);
        day -= m.interval + ri(-6, 8);
        if (day < -330) break;
      }
      dates.reverse();   // 古い順。筋書きはこの順に進む

      dates.forEach(function (off, i) {
        // 半分ほどは、お誘いを出してからお越しいただいたことにする
        if (i > 0 && chance(0.55)) {
          var lead = ri(2, 7);
          var st = pickStyle(m, i);
          events.push({
            at: off - lead, kind: 'invite', c: c, style: st,
            target: D(T, off), text: inviteText(st, m, i)
          });
        }
        events.push({ at: off, kind: 'visit', c: c, m: m, i: i, count: dates.length });
      });

      // 外したお誘い。全部当たっているデータは嘘になる
      if (m.owner === 'self' && chance(0.35)) {
        var off2 = -ri(30, 120);
        var st2 = pickStyle(m, 0);
        events.push({
          at: off2, kind: 'invite', c: c, style: st2,
          target: D(T, off2 + ri(3, 6)), text: inviteText(st2, m, 0), fail: true
        });
      }

      // 贈答の実績
      if (chance(0.5)) {
        events.push({ at: -ri(200, 300), kind: 'touch', c: c, tkind: 'nenga', note: '年賀状' });
      }
      if (m.tier === 'futo' && chance(0.6)) {
        events.push({ at: -ri(30, 60), kind: 'touch', c: c, tkind: 'ochugen', note: 'お中元' });
      }
    });

    events.sort(function (a, b) { return a.at - b.at; });

    events.forEach(function (e) {
      var date = D(T, e.at);

      if (e.kind === 'invite') {
        Store.addTouch({
          customer_id: e.c.id, date: date, kind: 'line', direction: 'sent',
          intent: 'invite', style: e.style, target_date: e.target,
          title: 'お誘い', note: e.text,
          result: e.fail ? 'missed' : null
        });
        return;
      }

      if (e.kind === 'touch') {
        Store.addTouch({
          customer_id: e.c.id, date: date, kind: e.tkind, direction: 'sent', note: e.note
        });
        return;
      }

      /* ご来店。addVisit が、直前のお誘いを自動で決着させる */
      var c = e.c, m = e.m, ctx = m.ctx;
      var attendees = [{ customer_id: c.id, role: 'shukyaku' }];

      // 法人接待。ときどき同じ会社の方をお連れになる
      if (chance(0.3)) {
        var mate = made.filter(function (x) {
          return x.c.id !== c.id && x.c.company === c.company;
        })[0];
        if (mate) attendees.push({ customer_id: mate.c.id, role: 'doukousha' });
      }

      var douhan = m.owner === 'self' && chance(0.22);

      /* 筋書きを一段進める。
       * ご来店の回数が筋書きより多いときは、最後の段のあとは単発の話でつなぐ */
      var beat = m.arc.beats[e.i] || null;
      var side = fillT(pick(SIDE), ctx);

      var talk = beat
        ? fillT(beat.talk, ctx) + (side ? ' ' + side : '')
        : (side || fillT('{i}の話で盛り上がった。今度ご一緒しましょうという話に。', ctx));

      var memo = beat
        ? '今日は' + c.display_name + 'が' +
          (attendees.length > 1 ? 'お二人で。' : 'お一人で。') +
          fillT(beat.memo, ctx) + ' ' + Math.round(m.unit / 10000) + '万くらい。'
        : '今日は' + c.display_name + '。' + (side || 'いつもの話。') + ' ' +
          Math.round(m.unit / 10000) + '万くらい。';

      /* 宿題。前の回で開いたものが、この回で閉じることがある */
      var hooks = [];
      if (beat && beat.close) {
        hooks.push({ text: fillT(beat.close, ctx), type: 'commitment', status: 'done' });
      }
      if (beat && beat.hook) {
        hooks.push({ text: fillT(beat.hook, ctx), type: 'family', status: 'open' });
      }
      if (chance(0.3)) {
        hooks.push({ text: fillT('{place2}へのご出張', ctx), type: 'work', status: 'open' });
      }

      // 最後のご来店で「次はいつ頃」の言質があると、逆算の見え方が確かめられる
      var isLast = e.i === e.count - 1;
      var hint = (isLast && chance(0.35))
        ? { timing: pick(['来月あたま', '再来週', '月末ごろ', '来週']), confidence: 'implied' }
        : {};

      Store.addVisit({
        date: date,
        attendees: attendees,
        my_role: m.owner === 'self' ? 'kakari' : 'help',
        douhan: douhan,
        kirikaeshi: douhan && chance(0.15),
        nominaoshi: chance(0.08),
        set_count: ri(1, 3),
        spend: Math.round(m.unit * (0.75 + rnd() * 0.5) / 1000) * 1000,
        bottle: chance(0.25) ? pick(BOTTLES) : '',
        topics: c.interests.slice(0, 1),
        topic_detail: talk,
        drinks: [{ item: pick(DRINKS), count: ri(1, 4) }],
        observation: pick(OBSERVATIONS),
        raw_memo: memo,
        hooks: hooks,
        next_visit_hint: hint,
        ai_structured: true
      });
    });

    /* この先2週間の予定。盤面が空だと逆算の見え方が分からない */
    var mine = made.filter(function (m) { return m.owner === 'self'; });
    [[0, 'confirmed', 'visit'], [1, 'confirmed', 'douhan'], [2, 'verbal', 'visit'],
     [3, 'confirmed', 'visit'], [5, 'verbal', 'douhan'], [6, 'confirmed', 'visit'],
     [8, 'aiming', 'visit'], [10, 'verbal', 'visit'], [12, 'confirmed', 'visit']]
      .forEach(function (spec, i) {
        var m = mine[(i * 7 + 3) % mine.length];
        if (!m) return;

        // 休みの日には予定を入れない。入っていると盤面が嘘になる
        var off = spec[0];
        for (var g = 0; g < 7 && Holiday.closedReason(D(T, off)); g++) off += 1;

        if (Store.appointmentsOn(D(T, off)).some(function (a) { return a.customer_id === m.c.id; })) return;
        Store.addAppointment({
          date: D(T, off),
          customer_id: m.c.id,
          kind: spec[2],
          confidence: spec[1],
          expected_spend: null,
          source: 'manual',
          note: ''
        });
      });

    /* 昨日・今日お送りしたばかりのお誘い。
     * 「今は間を置く方」がどう見えるかを確かめるために要る */
    mine.slice(10, 14).forEach(function (m, i) {
      Store.addTouch({
        customer_id: m.c.id, date: D(T, -i), kind: 'line', direction: 'sent',
        intent: 'invite', style: pickStyle(m, 0), target_date: D(T, ri(3, 6)),
        title: 'お誘い', note: inviteText('star', m, 0)
      });
    });

    Store.settleOverdueInvites();
    Store.closeStaleAppointments();
    Store.clearDailyPlan();

    return {
      customers: Store.activeCustomers().length,
      visits: Store.listVisits().length,
      touches: Store.listTouches().length,
      appointments: Store.openAppointments().length
    };
  }

  /** 誘いの型を選ぶ。期限型は、根拠になるボトルがある方にだけ */
  function pickStyle(m, beatIndex) {
    var base = ['star', 'info', 'rely', 'choice', 'meal', 'report'];
    if (m.ctx.bt) base.push('deadline');
    // 会話の記録があとにあるほど、話を起点にした型が選ばれやすいようにする
    if (beatIndex > 0) base.push('star', 'star');
    return pick(base);
  }

  /** お誘いの文。その方の筋書きから拾った宿題を起点にする */
  function inviteText(style, m, beatIndex) {
    var ctx = m.ctx;
    var beat = m.arc.beats[Math.max(0, beatIndex - 1)];
    ctx.hook = beat && beat.hook ? fillT(beat.hook, ctx) : fillT('{i}', ctx);
    return fillT(INVITE_TEXTS[style] || INVITE_TEXTS.info, ctx);
  }

  /** 全部消す。お渡しする前に必ず押していただく */
  function wipe() {
    ['profile', 'customers', 'visits', 'touches', 'briefs', 'appointments', 'goals', 'meta', 'daily',
     'timing', 'usage', 'night']
      .forEach(function (k) { localStorage.removeItem('koza2.' + k); });
    if (window.Blobs && Blobs.keys) {
      Blobs.keys().then(function (ks) { (ks || []).forEach(function (k) { Blobs.remove(k); }); })
        .catch(function () { /* 画像が無ければそれでよい */ });
    }
  }

  return { install: install, wipe: wipe };
})();
