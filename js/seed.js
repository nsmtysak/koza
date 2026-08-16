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

  var RELATIONS = ['奥様', 'ご息女', 'ご子息', 'お母様'];

  var TOPICS = [
    '{i}の話で盛り上がった。今度ご一緒しましょうという話に。',
    'ご{r}の{ev}の話。{when}に控えているとのこと。',
    '{c}の決算期の話。今期は堅調とのこと。',
    '来月の{place}へのご出張の話。{d}日ほど留守にされるとのこと。',
    'ご接待で{f}に行かれた話。次はこちらでという話になった。',
    '{i}を始めて{y}年になるとのこと。道具の話を伺った。',
    '新しい現場が{place}で始まった話。しばらく忙しくなるとのこと。',
    'ご{r}の進学の話。{place}の学校を検討されているとのこと。'
  ];
  /* ご家族の続柄に合う出来事だけを選ぶ。
   * 「お母様の入学」のような文が混ざると、見た瞬間に嘘だと分かってしまう */
  var EVENTS_BY_REL = {
    'ご息女': ['受験', '入学', '就職', '発表会', 'ご結婚'],
    'ご子息': ['受験', '入学', '就職', '部活の大会'],
    '奥様': ['お誕生日', 'ご旅行', '習い事の発表会'],
    'お母様': ['通院', '米寿のお祝い', 'ご旅行'],
    'ご家族': ['ご旅行', 'お祝いごと']
  };
  function eventFor(c) {
    var rel = (c.family[0] && c.family[0].relation) || 'ご家族';
    return pick(EVENTS_BY_REL[rel] || EVENTS_BY_REL['ご家族']);
  }
  var PLACES = ['東京', '名古屋', '福岡', '北浜', '本町', '広島', '仙台'];
  var WHENS = ['来月', '再来月', '年明け', '春先'];

  var OBSERVATIONS = [
    'ゴルフの話になってから、ご自分から話される時間が長くなった。',
    '価格を確認してから注文された。',
    'いつもより早めにお帰りになった。',
    'ご同席の方に何度も酒を勧めておられた。',
    '携帯を何度か確認されていた。',
    ''
  ];

  var INVITE_TEXTS = {
    star: '先日伺った{i}の件、その後いかがでしたか。またお聞かせいただければ嬉しいです。',
    deadline: '頂いていた{b}が残り少なくなってまいりました。お知らせまで。',
    info: '{b}が入りましたので、お知らせまで。',
    rely: '{i}のことで、少しお知恵をお借りしたくご連絡いたしました。',
    choice: '今週でしたら木曜と金曜、どちらがご都合よろしいでしょうか。',
    meal: '一度伺ってみたい{f}のお店ができました。お時間が合えばぜひ。',
    report: '本日から新しいお酒が入りました。ご無理のないときにでも。'
  };

  var STYLES = ['star', 'deadline', 'info', 'rely', 'choice', 'meal', 'report'];

  function fill(tpl, c) {
    return tpl
      .replace('{i}', (c.interests || ['お仕事'])[0])
      .replace('{c}', c.company || '会社')
      .replace('ご{r}', (c.family[0] && c.family[0].relation) || 'ご家族')
      .replace('{ev}', eventFor(c))
      .replace('{when}', pick(WHENS))
      .replace('{place}', pick(PLACES))
      .replace('{f}', pick(FOODS))
      .replace('{b}', pick(BOTTLES))
      .replace('{d}', String(ri(3, 10)))
      .replace('{y}', String(ri(3, 20)));
  }

  function mmdd(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- 本体 ---------- */

  function install() {
    var T = Store.today();
    var D = Store.addDays;

    Store.saveProfile({
      configured: true,
      store_name: '西家',
      my_role: 'kakari',
      shimei_system: 'eikyu',
      closing_day: 0,
      // 50名・平均24万なら月500万前後は届く。届いてしまうと逆算の見どころが出ないので、
      // 少し届かない目標にしてある。実際の目標は本人が入れる
      target_sales: 8000000,
      target_douhan: 10,
      douhan_quota_monthly: 10,
      set_duration_min: 60,
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
      for (var k = 0; k < ri(1, 3); k++) {
        var it = pick(INTERESTS);
        if (interests.indexOf(it) < 0) interests.push(it);
      }

      var family = [];
      if (chance(0.65)) {
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
        prefs: { drinks: [pick(DRINKS)], food: [pick(FOODS)], smoke: '', karaoke: [], likes: [], dislikes: [] },
        ng_topics: chance(0.15) ? [pick(['政治', '前の会社のこと', 'ご家庭のこと'])] : [],
        family: family,
        gift_policy: { nenga: true, ochugen: tier === 'futo', oseibo: tier !== 'light' },
        first_met: D(T, -ri(90, 700)),
        memo: ''
      });
      made.push({ c: c, unit: unit, interval: interval, tier: tier, owner: owner });
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
      dates.reverse();

      dates.forEach(function (off, i) {
        // 半分ほどは、お誘いを出してからお越しいただいたことにする
        if (i > 0 && chance(0.55)) {
          var lead = ri(2, 7);
          var style = pick(STYLES);
          events.push({
            at: off - lead, kind: 'invite', c: c, style: style,
            target: D(T, off), text: fill(INVITE_TEXTS[style], c)
          });
        }
        events.push({ at: off, kind: 'visit', c: c, m: m, i: i, count: count });
      });

      // 外したお誘い。全部当たっているデータは嘘になる
      if (m.owner === 'self' && chance(0.35)) {
        var off2 = -ri(30, 120);
        var st2 = pick(STYLES);
        events.push({
          at: off2, kind: 'invite', c: c, style: st2,
          target: D(T, off2 + ri(3, 6)), text: fill(INVITE_TEXTS[st2], c), fail: true
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
      var c = e.c, m = e.m;
      var attendees = [{ customer_id: c.id, role: 'shukyaku' }];

      // 法人接待。ときどき同じ会社の方をお連れになる
      if (chance(0.3)) {
        var mate = made.filter(function (x) {
          return x.c.id !== c.id && x.c.company === c.company;
        })[0];
        if (mate) attendees.push({ customer_id: mate.c.id, role: 'doukousha' });
      }

      var douhan = m.owner === 'self' && chance(0.22);
      var topic = fill(pick(TOPICS), c);
      var hooks = [];
      if (chance(0.5)) {
        // 「ご息女」「奥様」には既に敬称が入っている。重ねない
        var rel = (c.family[0] && c.family[0].relation) || 'ご家族';
        hooks.push({ text: rel + 'の' + eventFor(c) + 'のこと', type: 'family', status: 'open' });
      }
      if (chance(0.4)) {
        hooks.push({ text: pick(WHENS) + 'にまた伺う', type: 'commitment', status: 'open' });
      }
      if (chance(0.3)) {
        hooks.push({ text: pick(PLACES) + 'へのご出張', type: 'work', status: 'open' });
      }

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
        topic_detail: topic,
        drinks: [{ item: pick(DRINKS), count: ri(1, 4) }],
        observation: pick(OBSERVATIONS),
        raw_memo: '今日は' + c.display_name + 'が' + (attendees.length > 1 ? 'お二人で' : 'お一人で') +
          '。' + topic + ' ' + Math.round(m.unit / 10000) + '万くらい。',
        hooks: hooks,
        next_visit_hint: {},
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
        intent: 'invite', style: pick(STYLES), target_date: D(T, ri(3, 6)),
        title: 'お誘い', note: fill(INVITE_TEXTS.info, m.c)
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

  /** 全部消す。お渡しする前に必ず押していただく */
  function wipe() {
    ['profile', 'customers', 'visits', 'touches', 'briefs', 'appointments', 'goals', 'meta', 'daily']
      .forEach(function (k) { localStorage.removeItem('koza2.' + k); });
    if (window.Blobs && Blobs.keys) {
      Blobs.keys().then(function (ks) { (ks || []).forEach(function (k) { Blobs.remove(k); }); })
        .catch(function () { /* 画像が無ければそれでよい */ });
    }
  }

  return { install: install, wipe: wipe };
})();
