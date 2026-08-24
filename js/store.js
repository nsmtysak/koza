/* Kōza v2 — データ層
 *
 * 6つの実体で回す。
 *   Customer     お客様そのもの（名刺・家族・趣味・嗜好）
 *   Visit        来歴。いつ誰と来て何を話したか
 *   Touch        接点。誘い・年賀状・お中元・LINE・電話など、来店以外の全部
 *   Appointment  来店予定。埋まっている枠と、狙っている枠
 *   Goal         月の目標。ここから逆算して今日やることが決まる
 *   Brief        AIが出した「次にこうする」と、その結果
 *
 * 目標 → 不足 → 埋めるべき枠 → 逆算した締切 → 今日の行動、が背骨。
 * 誘いは Touch に intent='invite' で残り、来店したかどうかで決着する。
 * その決着が次の逆算（リードタイム・来ていただける率）の精度になる。
 */
var Store = (function () {
  'use strict';

  var NS = 'koza2.';
  var K = {
    profile:      NS + 'profile',
    customers:    NS + 'customers',
    visits:       NS + 'visits',
    touches:      NS + 'touches',
    briefs:       NS + 'briefs',
    studies:      NS + 'studies',
    appointments: NS + 'appointments',
    goals:        NS + 'goals',
    api:          NS + 'api',
    meta:         NS + 'meta'
  };
  var SCHEMA_VERSION = 3;

  /* ---------- 基本 ---------- */

  /* 読み書きが失敗したことを、黙って飲み込まない。
   *
   * 以前は read も write も静かに諦めていた。そのせいで二つの壊れ方があった。
   *   一つ  保存できていないのに「残しました」と出て、一晩ぶんが消えた
   *   二つ  記録が読めなくなったとき、空として扱い、**次の保存で全部上書きした**
   * どちらも本人に気づく手立てが無い。**記録を預かる道具として、これが最悪の壊れ方である。**
   *
   * だから、失敗したら必ず画面に出す。そして**読めなかった鍵には書かない。** */
  var broken = {};      // 読めなくなった鍵。ここへの上書きは止める
  var told = {};        // 同じ知らせを何度も出さない

  /* 中身が変わった回数。
   * 逆算は重い（全お客様ぶんの間隔・割合・空き日を毎回数える）。
   * 一つの画面で三度も同じ計算をしていたので、変わっていない間は使い回す。
   * その「変わったかどうか」をここで数える。 */
  var rev = 0;
  function revision() { return rev; }

  function alarm(msg) {
    // Store は UI より先に読み込まれるので、あるときだけ使う
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg, true);
    else if (typeof window !== 'undefined' && window.alert) window.alert(msg);
  }

  function read(key, fallback) {
    // 一度読めなかった鍵は、読み直さない。画面を描くたびに同じ例外が積み上がる
    if (broken[key]) return fallback;

    var raw;
    try { raw = localStorage.getItem(key); }
    catch (e) {
      console.warn('読み込みに失敗:', key, e);
      broken[key] = true;
      return fallback;
    }
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      /* 中身が壊れている。**空として扱ってはいけない。**
       * 空のまま書き戻せば、読めなかっただけの記録が本当に消える。 */
      console.error('記録を読み取れません:', key, e);
      broken[key] = true;
      if (!told[key]) {
        told[key] = true;
        alarm('記録の一部を読み取れませんでした。新しく書き込むのを止めています。書き出しの控えから戻してください');
      }
      return fallback;
    }
  }

  function write(key, value) {
    if (broken[key]) {
      // 読めていないものの上に書かない。壊れた記録を確定させてしまう
      alarm('この記録は読み取れない状態です。上書きを止めました');
      return false;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      rev += 1;   // 中身が変わった。計算し直すべき目印
      return true;
    } catch (e) {
      console.error('保存に失敗:', key, e);
      // 容量が尽きたときがほとんど。黙って「残しました」と言わせない
      alarm('保存できませんでした。端末の空きが足りないおそれがあります。書き出してから、古い記録を整理してください');
      return false;
    }
  }

  function uid(p) {
    return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nowISO() { return new Date().toISOString(); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function daysBetween(isoA, isoB) {
    if (!isoA || !isoB) return null;
    var a = new Date(isoA + 'T00:00:00').getTime();
    var b = new Date(isoB + 'T00:00:00').getTime();
    return Math.round((b - a) / 86400000);
  }

  function toISO(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function weekdayOf(iso) {
    return ['日', '月', '火', '水', '木', '金', '土'][new Date(iso + 'T00:00:00').getDay()];
  }

  /* ---------- StoreProfile ---------- */

  var DEFAULT_PROFILE = {
    shimei_system: null,
    douhan_reward_type: null,
    douhan_reward_value: 0,
    douhan_reward_condition_sets: 0,
    douhan_quota_monthly: 0,
    my_role: null,
    /* 暗証番号。生のまま持たない（記録と同じ場所に置くと意味がないため）。
     * { salt, hash, algo } を入れる。null なら未設定。 */
    lock: null,
    lock_after_min: 3,       // 画面を離れてから、これだけ経ったら閉じる
    closing_day: 0,          // 締め日。0＝月末
    target_sales: 0,         // 月の目標（円）。0＝未設定
    target_douhan: 0,        // 月の同伴目標（本）

    /* 休み。法人のお客様が中心なので、企業が休む日は店も休む。
     * 空き枠として数えると、埋められるはずの日を数え間違える。
     *
     * 既定は土日休み。この街は土日祝と年末年始が休みで、
     * ひと月に出られるのは20日ほどというのが通例。
     * ここは逆算の分母なので、外れると組数も単価も全部ずれる。
     * 店によって違うので、設定画面で必ず確かめていただく。 */
    open_days: [1, 2, 3, 4, 5],      // 営業曜日（0＝日）。既定は土日休み
    closed_on_holidays: true,
    closed_newyear: true,
    newyear_from: '12-29', newyear_to: '01-03',
    closed_obon: true,
    obon_from: '08-13', obon_to: '08-16',
    closed_dates: [],        // 店の臨時の休み（YYYY-MM-DD）

    /* 本人が出ない日。店が開いていても、本人が出なければ枠にならない。
     * ここが無いと「埋められる日」を数え間違える。逆算の土台。 */
    off_days: [],            // 自分の休み（YYYY-MM-DD）
    workdays_per_month: 0,   // ひと月に出られる日数の目安

    /* お店の場所と、お食事に使える範囲。
     *
     * 同伴は、お食事のあとご一緒にお店へ向かって初めて成立する。
     * どれだけ評判のよいお店でも、**そこから店に入れなければ意味がない。**
     * だから探す範囲は「世の中で人気かどうか」ではなく、
     * **お食事を終えて、ご一緒に入店できる距離かどうか**で決まる。 */
    area: '',                // 店のある場所。本人が設定画面で入れる
    meal_area: '',           // お食事に使える範囲。歩いて戻れる町名を本人が入れる

    /* お店のきまり。
     * 同伴の入店締めとタイムアウトは持たない。
     * 店の数え方であって、アプリのどこでも使い道がなかった。
     * AIに渡すためだけに持っていて、それが文面へ漏れる経路になっていた。 */
    douhan_places: [],       // 同伴で使うお店。同じ店に続けてお連れしないため
    open_time: '', close_time: '',

    /* お客様への配慮。ここは店ではなく相手に合わせて動かす */
    quiet_from: 23,          // この時刻から翌 quiet_to 時までは送らない
    quiet_to: 9,
    cooldown_contact: 3,     // 前のご連絡から空ける日数
    cooldown_invite: 10,     // お返事待ちのお誘いを重ねない日数
    lead_default_visit: 4,   // 記録が足りないときのリードタイム
    lead_default_douhan: 5,
    configured: false
  };

  function getProfile() {
    return Object.assign({}, DEFAULT_PROFILE, read(K.profile, null) || {});
  }

  function saveProfile(patch) {
    var p = Object.assign(getProfile(), patch);
    write(K.profile, p);
    return p;
  }

  /* ---------- Customer ---------- */

  var DEFAULT_CUSTOMER = {
    name: '',                // 実名（名刺から）
    display_name: '',        // 呼び方「田中様」
    kana: '',
    company: '', department: '', title: '',
    phone: '', mobile: '', email: '', address: '',
    line: '',                // LINEの表示名。実際に毎日使う連絡手段はこれ
    card_image_id: null,
    photo_id: null,          // 顔写真。端末の中（IndexedDB）にのみ置く
    first_met: null,
    intro_by: null,          // 紹介してくれた顧客のid
    relation_type: null,     // kakari | help | other
    shimei_type: null,       // hon | jonai | free
    tier: null,              // futo | regular | light
    /* 口座 ＝ そのお客様がどなたのものか。
     * 永久指名制の店では、口座は信頼関係そのもの。
     * 他の方の口座のお客様に直接ご連絡するのは越境で、店の中で最も信を失う行為。
     * だからこのアプリは、口座によって出せる手を変える。 */
    account_owner: null,     // self | mama | other | free（未設定は自分の口座として扱う）
    account_owner_name: '',  // ほかの方の口座のとき、その方の呼び名
    birthday: '',            // MM-DD もしくは YYYY-MM-DD
    family: [],              // [{relation, name, note, birthday}]
    interests: [],           // 趣味・興味
    prefs: { drinks: [], food: [], smoke: '', karaoke: [], likes: [], dislikes: [] },
    /* お預かりしているボトル。
     * 「そろそろ空きます」は、この仕事でいちばん自然にお声がけできる理由。
     * 残量を持たないままAIに「残り少なくなってまいりました」と書かせるのは作り話になる。 */
    bottles: [],             // [{id, name, opened_at, remain, note}]
    ng_topics: [],
    avoid_pair: [],
    /* ご連絡を控える曜日（0＝日）。
     * 現場で起きた事故：ご在宅の日に送って、そのLINEを奥様に見られた。
     * 時刻を避けるだけでは防げない。曜日が要る。 */
    quiet_days: [],
    gift_policy: { nenga: true, ochugen: false, oseibo: false },
    memo: '',
    tags: [],

    /* いまの間柄。
     *
     * この街では、こちらの努力ではどうにもならない事情でお越しになれなくなる。
     * ご転勤、ご退職、お立場の変化、接待の枠そのものが無くなること——
     * 実際、企業の交際費は一度切られると習慣として戻らないと言われている。
     *
     * それでも全員を候補に並べ続けると、来られない方が「ご無沙汰な順」の上に居座り、
     * 本当に動くべき方が埋もれる。そして声をかけていない負い目だけが残る。
     *
     * **ただし、決めるのは本人。**機械は間隔を数えて尋ねるだけで、
     * 勝手に「この方はもう来ない」と判定してはいけない。
     *   null     お付き合いが続いている（既定）
     *   'paused' 事情があって、いまはお越しになれない（記念日と年賀は残す）
     *   'closed' 区切りがついた
     */
    standing: null,
    standing_reason: '',
    standing_at: null,

    archived: false
  };

  var STANDING = {
    paused: '事情があって、いまはお越しになれない',
    closed: '区切りがついた'
  };

  /* 「なぜ」を残さないと、半年後にただの放置と見分けがつかなくなる */
  var STANDING_REASONS = [
    'ご転勤・ご異動', 'ご退職・ご引退', 'お立場が変わった',
    '会社のご事情', 'ご体調', 'ご家庭のご事情', 'その他'
  ];

  /** こちらから動く先として数える方か */
  function isActiveRelation(c) {
    return !!c && !c.archived && !c.standing;
  }

  /** 記念日やご挨拶は続ける方か。区切りがついた方だけ外す */
  function keepsGreeting(c) {
    return !!c && !c.archived && c.standing !== 'closed';
  }

  function setStanding(customerId, standing, reason) {
    return updateCustomer(customerId, {
      standing: standing || null,
      standing_reason: standing ? (reason || '') : '',
      standing_at: standing ? today() : null
    });
  }

  function listCustomers() {
    return read(K.customers, []);
  }

  function activeCustomers() {
    return listCustomers().filter(function (c) { return !c.archived; });
  }

  function getCustomer(id) {
    var all = listCustomers();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* ---------- 口座 ----------
   * ここを間違えると、係の方の顔をつぶす。手を出してよい相手かどうかを必ず通す。
   */

  var ACCOUNT_LABELS = {
    self: '自分の口座',
    mama: 'ママの口座',
    other: 'ほかの方の口座',
    free: 'フリー'
  };

  /**
   * 自分の口座か。
   *
   * **未設定は「自分」ではない。**
   * 音声・名刺・同席者から自動で作られた方は、口座が分かっていない。
   * それを「自分の口座」として扱うと、ママや先輩のお客様に
   * こちらからご連絡してしまう。永久指名制の店では、それで店にいられなくなる。
   * 分からないものは、分からないまま止める。
   */
  function isMyAccount(c) {
    return !!c && c.account_owner === 'self';
  }

  /** 口座がまだ決まっていない方。声かけの対象にしてはいけない */
  function isAccountUnknown(c) {
    return !!c && !c.account_owner;
  }

  /**
   * こちらから直接ご連絡してよい方か。
   * 自分の口座とフリーだけ。**未設定は含めない。**
   */
  function canContactDirectly(c) {
    return !!c && (c.account_owner === 'self' || c.account_owner === 'free');
  }

  function accountLabel(c) {
    if (!c) return '';
    if (!c.account_owner) return '口座が未設定';
    if (c.account_owner === 'other' && c.account_owner_name) {
      return c.account_owner_name + 'さんの口座';
    }
    return ACCOUNT_LABELS[c.account_owner] || '';
  }

  /** 口座を決めていただきたい方 */
  function unknownAccountCustomers() {
    return activeCustomers().filter(isAccountUnknown);
  }

  /**
   * その来店が自分の売上になるか。
   * ほかの方・ママの口座の席は自分の売上ではない。
   * 未設定は、記録した本人の卓として数える（実績が消えるほうが実害が大きい）。
   */
  function isMyVisit(v) {
    // ヘルプで付いた席は、口座が誰であろうと自分の売上ではない
    if (v.my_role === 'help') return false;

    var att = v.attendees || [];
    if (!att.length) return true;
    var shukyaku = att.filter(function (a) { return a.role === 'shukyaku'; });
    var target = shukyaku.length ? shukyaku : att;
    return target.some(function (a) {
      var c = getCustomer(a.customer_id);
      if (!c) return true;
      return c.account_owner !== 'mama' && c.account_owner !== 'other';
    });
  }

  /** 表記ゆれに強めの突合。完全一致 → 姓一致＋会社一致 の順 */
  function matchCustomer(hint) {
    hint = hint || {};
    var all = activeCustomers();
    var key = (hint.name || '').trim();
    var disp = (hint.display_name || '').trim();
    var comp = (hint.company || '').trim();
    var i;

    for (i = 0; i < all.length; i++) {
      if (key && all[i].name === key) return all[i];
    }
    for (i = 0; i < all.length; i++) {
      if (disp && all[i].display_name === disp) return all[i];
    }
    // 「田中」だけ渡された場合：姓の前方一致。会社が分かれば併用する
    var surname = key || disp.replace(/(様|さん|氏)$/, '');
    if (!surname) return null;

    var hits = all.filter(function (c) {
      return (c.name && c.name.indexOf(surname) === 0) ||
             (c.display_name && c.display_name.indexOf(surname) === 0);
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1 && comp) {
      var byComp = hits.filter(function (c) { return c.company && c.company.indexOf(comp) >= 0; });
      if (byComp.length === 1) return byComp[0];
    }
    return null;   // 複数候補は呼び出し側で選ばせる
  }

  function candidates(surname) {
    if (!surname) return [];
    return activeCustomers().filter(function (c) {
      return (c.name && c.name.indexOf(surname) === 0) ||
             (c.display_name && c.display_name.indexOf(surname) === 0);
    });
  }

  function createCustomer(fields) {
    var c = Object.assign({}, DEFAULT_CUSTOMER, fields || {});
    c.prefs = Object.assign({}, DEFAULT_CUSTOMER.prefs, fields && fields.prefs || {});
    c.gift_policy = Object.assign({}, DEFAULT_CUSTOMER.gift_policy, fields && fields.gift_policy || {});
    c.id = uid('c');
    if (!c.display_name) {
      var base = (c.name || '').split(/[\s　]+/)[0];
      c.display_name = base ? base + '様' : 'お名前未登録';
    }
    if (!c.first_met) c.first_met = today();
    c.created_at = nowISO();
    c.updated_at = nowISO();

    var all = listCustomers();
    all.push(c);
    write(K.customers, all);
    return c;
  }

  function updateCustomer(id, patch) {
    var all = listCustomers();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        all[i] = Object.assign(all[i], patch, { updated_at: nowISO() });
        write(K.customers, all);
        return all[i];
      }
    }
    return null;
  }

  function deleteCustomer(id) {
    var c = getCustomer(id);
    if (c && c.card_image_id) Blobs.remove(c.card_image_id);
    if (c && c.photo_id) Blobs.remove(c.photo_id);
    write(K.customers, listCustomers().filter(function (x) { return x.id !== id; }));
    // 来歴からも外す
    var vs = read(K.visits, []).map(function (v) {
      v.attendees = (v.attendees || []).filter(function (a) { return a.customer_id !== id; });
      return v;
    }).filter(function (v) { return v.attendees.length > 0; });
    write(K.visits, vs);
    write(K.touches, read(K.touches, []).filter(function (t) { return t.customer_id !== id; }));
    write(K.briefs, read(K.briefs, []).filter(function (b) { return b.customer_id !== id; }));
    write(K.appointments, read(K.appointments, []).filter(function (a) { return a.customer_id !== id; }));
  }

  /**
   * AIが抽出したプロフィール項目を、重複させずに足す。
   * 記録するたびに顧客データベースが育つのがこのアプリの肝。
   */
  function enrichCustomer(id, add) {
    var c = getCustomer(id);
    if (!c || !add) return null;

    function mergeList(cur, incoming) {
      var out = (cur || []).slice();
      (incoming || []).forEach(function (v) {
        var s = String(v).trim();
        if (s && out.indexOf(s) === -1) out.push(s);
      });
      return out;
    }

    var patch = {};
    if (add.interests) patch.interests = mergeList(c.interests, add.interests);
    if (add.ng_topics) patch.ng_topics = mergeList(c.ng_topics, add.ng_topics);

    if (add.prefs) {
      var prefs = Object.assign({}, c.prefs);
      ['drinks', 'food', 'karaoke', 'likes', 'dislikes'].forEach(function (k) {
        if (add.prefs[k]) prefs[k] = mergeList(prefs[k], add.prefs[k]);
      });
      if (add.prefs.smoke) prefs.smoke = add.prefs.smoke;
      patch.prefs = prefs;
    }

    if (add.family && add.family.length) {
      var fam = (c.family || []).slice();
      add.family.forEach(function (f) {
        if (!f || !f.relation) return;
        var dup = fam.some(function (x) {
          return x.relation === f.relation && (x.name || '') === (f.name || '');
        });
        if (!dup) fam.push({ relation: f.relation, name: f.name || '', note: f.note || '', birthday: f.birthday || '' });
      });
      patch.family = fam;
    }

    ['company', 'department', 'title', 'birthday'].forEach(function (k) {
      if (add[k] && !c[k]) patch[k] = add[k];
    });

    if (Object.keys(patch).length === 0) return c;
    return updateCustomer(id, patch);
  }

  /* ---------- ボトル ---------- */

  var REMAIN = {
    full: 'まだ十分',
    half: '半分ほど',
    low: 'そろそろ空きます',
    empty: '空きました'
  };

  function bottlesOf(customerId) {
    var c = getCustomer(customerId);
    return ((c && c.bottles) || []).filter(function (b) { return b.remain !== 'empty'; });
  }

  function addBottle(customerId, fields) {
    var c = getCustomer(customerId);
    if (!c) return null;
    var b = {
      id: uid('b'),
      name: (fields.name || '').trim(),
      opened_at: fields.opened_at || today(),
      remain: REMAIN[fields.remain] ? fields.remain : 'full',
      note: fields.note || ''
    };
    if (!b.name) return null;
    var list = (c.bottles || []).slice();
    list.push(b);
    updateCustomer(customerId, { bottles: list });
    return b;
  }

  function updateBottle(customerId, bottleId, patch) {
    var c = getCustomer(customerId);
    if (!c) return null;
    var list = (c.bottles || []).map(function (b) {
      return b.id === bottleId ? Object.assign({}, b, patch) : b;
    });
    updateCustomer(customerId, { bottles: list });
    return list.filter(function (b) { return b.id === bottleId; })[0] || null;
  }

  function removeBottle(customerId, bottleId) {
    var c = getCustomer(customerId);
    if (!c) return;
    updateCustomer(customerId, {
      bottles: (c.bottles || []).filter(function (b) { return b.id !== bottleId; })
    });
  }

  /** そろそろ空くボトルをお預かりしている方。お声がけの理由になる */
  function customersWithLowBottle() {
    return activeCustomers().filter(function (c) {
      return (c.bottles || []).some(function (b) { return b.remain === 'low'; });
    });
  }

  /* ---------- Visit（来歴） ---------- */

  function listVisits() {
    var v = read(K.visits, []);
    v.sort(function (a, b) {
      if (a.date === b.date) return (b.created_at || '').localeCompare(a.created_at || '');
      return b.date.localeCompare(a.date);
    });
    return v;
  }

  function getVisit(id) {
    var all = read(K.visits, []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function addVisit(f) {
    var v = {
      id: uid('v'),
      date: f.date || today(),
      attendees: f.attendees || [],
      my_role: f.my_role || null,
      douhan: !!f.douhan,
      douhan_place: f.douhan_place || '',
      /* そのお店を、どちらが決めたか。
       *
       * ここが空のままだと、店名がいくら溜まっても好みの証拠にならない。
       * こちらが選んだ店と、その方が選ばれた店が混ざるからである。
       *   guest … お客様が行きたいとおっしゃった店。**これがその方の好みそのもの**
       *   self  … こちらでお選びした店
       * 分けて数えられて初めて、次の一軒を決める材料になる。 */
      place_by: f.place_by === 'guest' || f.place_by === 'self' ? f.place_by : '',
      set_count: typeof f.set_count === 'number' ? f.set_count : 0,
      kirikaeshi: !!f.kirikaeshi,
      nominaoshi: !!f.nominaoshi,
      spend: typeof f.spend === 'number' ? f.spend : null,   // 会計の概算（円）
      bottle: f.bottle || '',                                 // 入れてもらったボトル
      topics: f.topics || [],
      topic_detail: f.topic_detail || '',
      drinks: f.drinks || [],
      observation: f.observation || '',
      raw_memo: f.raw_memo || '',
      hooks: f.hooks || [],
      next_visit_hint: f.next_visit_hint || {},
      brief_id: f.brief_id || null,
      ai_structured: !!f.ai_structured,
      created_at: nowISO()
    };
    var all = read(K.visits, []);
    all.push(v);
    /* 保存できなければ、来歴を作ったことにしない。
     * ここで進んでしまうと「残しました」と出たのに何も残らない。 */
    if (!write(K.visits, all)) return null;

    // 来ていただけた。誘いと予定に決着をつける（逆算の精度はここで決まる）
    (v.attendees || []).forEach(function (a) {
      if (!a.customer_id) return;
      settleInvitesOnVisit(a.customer_id, v.date);
      closeAppointmentsFor(a.customer_id, v.date);
    });

    return v;
  }

  function updateVisit(id, patch) {
    var all = read(K.visits, []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        all[i] = Object.assign(all[i], patch, { updated_at: nowISO() });
        write(K.visits, all);
        return all[i];
      }
    }
    return null;
  }

  function deleteVisit(id) {
    var all = read(K.visits, []);
    var next = all.filter(function (v) { return v.id !== id; });
    if (next.length === all.length) return false;
    write(K.visits, next);
    return true;
  }

  /**
   * 口実を「済み」にする。
   *
   * 口実は来歴の中にある。記録を直せば中身も変わる（固定ではない）。
   * ただし一度使った口実が出続けると、同じ話を何度も振ることになる。
   * だから使い終わったものは閉じられるようにしてある。
   */
  function setHookStatus(visitId, index, status) {
    var all = read(K.visits, []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id !== visitId) continue;
      var h = (all[i].hooks || [])[index];
      if (!h) return null;
      h.status = status;
      h.closed_at = status === 'closed' ? nowISO() : null;
      write(K.visits, all);
      return h;
    }
    return null;
  }

  /**
   * その来歴について、お誘いと予定を決着させる。
   * addVisit は自分で呼ぶが、あとから同席者が付いた場合（整理でお名前が判明した等）は
   * updateVisit では走らないため、外から呼べるようにしてある。
   * ここが漏れると、来てくださった方に「お越しになりましたか」と聞き続けることになる。
   */
  function settleVisit(visitId) {
    var v = getVisit(visitId);
    if (!v) return 0;
    var n = 0;
    (v.attendees || []).forEach(function (a) {
      if (!a.customer_id) return;
      n += settleInvitesOnVisit(a.customer_id, v.date);
      n += closeAppointmentsFor(a.customer_id, v.date);
    });
    return n;
  }

  /* お客様ごとの索引。
   *
   * ここは一日に何百回も呼ばれる（間隔・割合・期待額・候補・段取り…）。
   * 以前は毎回、記録を全部読み直して並べ替えてから絞っていた。
   * 500件・100名になると、それだけで枠の画面が4秒かかっていた。
   * **開かれない画面は、無いのと同じ。**
   *
   * 記録が変わったときだけ作り直す（Store が版を数えている）。 */
  var vIndex = null, vIndexRev = -1;

  function visitsOf(customerId) {
    if (!vIndex || vIndexRev !== rev) {
      vIndex = {};
      listVisits().forEach(function (v) {
        (v.attendees || []).forEach(function (a) {
          if (!a.customer_id) return;
          if (!vIndex[a.customer_id]) vIndex[a.customer_id] = [];
          vIndex[a.customer_id].push(v);
        });
      });
      vIndexRev = rev;
    }
    // 呼び出し側が並べ替えても索引が崩れないよう、写しを返す
    return (vIndex[customerId] || []).slice();
  }

  /** よく一緒に来る人（共起回数順） */
  function companionsOf(customerId) {
    var count = {};
    visitsOf(customerId).forEach(function (v) {
      (v.attendees || []).forEach(function (a) {
        if (a.customer_id === customerId) return;
        count[a.customer_id] = (count[a.customer_id] || 0) + 1;
      });
    });
    return Object.keys(count).map(function (id) {
      return { customer: getCustomer(id), times: count[id] };
    }).filter(function (x) { return x.customer; })
      .sort(function (a, b) { return b.times - a.times; });
  }

  /** 来店間隔の平均（日）。2回以上来ている人だけ */
  function averageInterval(customerId) {
    var vs = visitsOf(customerId).map(function (v) { return v.date; }).sort();
    if (vs.length < 2) return null;
    var total = 0;
    for (var i = 1; i < vs.length; i++) total += daysBetween(vs[i - 1], vs[i]);
    return Math.round(total / (vs.length - 1));
  }

  /**
   * お金の集計。
   * 同席者が複数いる来店は、主客に寄せる（接待は主客が払うため）。
   * 主客が分からない場合だけ頭割りにする。
   */
  function moneyOf(customerId) {
    var total = 0, counted = 0, last = null, max = 0;
    var recent = [];

    visitsOf(customerId).forEach(function (v) {
      if (typeof v.spend !== 'number' || v.spend <= 0) return;
      var me = (v.attendees || []).filter(function (a) { return a.customer_id === customerId; })[0];
      if (!me) return;

      var shukyaku = (v.attendees || []).filter(function (a) { return a.role === 'shukyaku'; });
      var share;
      if (shukyaku.length > 0) {
        share = me.role === 'shukyaku' ? v.spend / shukyaku.length : 0;
      } else {
        share = v.spend / (v.attendees.length || 1);
      }
      if (share > 0) {
        total += share;
        counted += 1;
        if (share > max) max = share;
        recent.push({ date: v.date, amount: Math.round(share) });
        if (!last || v.date > last) last = v.date;
      }
    });

    recent.sort(function (a, b) { return b.date.localeCompare(a.date); });
    return {
      total: Math.round(total),
      visits_with_amount: counted,
      average: counted ? Math.round(total / counted) : null,
      max: Math.round(max),                 // これまでに出された最高額。単価の上限の目安
      recent: recent.slice(0, 5),           // 直近の推移。落ちてきているかが分かる
      last_date: last
    };
  }

  /** 全顧客の売上順。太客の判定に使う */
  function rankByMoney() {
    return activeCustomers().map(function (c) {
      return { customer: c, money: moneyOf(c.id) };
    }).filter(function (x) { return x.money.total > 0; })
      .sort(function (a, b) { return b.money.total - a.money.total; });
  }

  /* ---------- Touch（接点） ---------- */

  var TOUCH_KINDS = {
    nenga:    '年賀状',
    ochugen:  'お中元',
    oseibo:   'お歳暮',
    birthday: '誕生日',
    gift:     '贈り物',
    after:    'アフター',
    okuri:    '送り',
    line:     'LINE',
    phone:    '電話',
    mail:     'メール',
    letter:   '手紙・礼状',
    other:    'その他'
  };

  function listTouches() {
    return read(K.touches, []).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  var tIndex = null, tIndexRev = -1;

  function touchesOf(customerId) {
    if (!tIndex || tIndexRev !== rev) {
      tIndex = {};
      listTouches().forEach(function (t) {
        if (!t.customer_id) return;
        if (!tIndex[t.customer_id]) tIndex[t.customer_id] = [];
        tIndex[t.customer_id].push(t);
      });
      tIndexRev = rev;
    }
    return (tIndex[customerId] || []).slice();
  }

  /* 誘いの型は無くした。
   *
   * 型は「文の型」であって、文を書かなくなった以上は使い道がない。
   * 打率を貯めても、それで文が変わらなければ、本人には何も返らない。
   * 古い記録に style が入っているものは、そのまま置いておく。読まないだけ。 */

  function addTouch(f) {
    var t = {
      id: uid('t'),
      customer_id: f.customer_id,
      date: f.date || today(),
      kind: f.kind || 'other',
      direction: f.direction || 'sent',
      title: f.title || '',
      note: f.note || '',
      response: f.response || null,
      responded_at: f.responded_at || null,
      // ここから下は「誘い」のときだけ使う
      intent: f.intent || null,          // invite（お誘い）/ keep（関係の維持）/ null
      target_date: f.target_date || null, // 来ていただきたい日
      result: f.result || null,          // came / missed / superseded
      settled_at: null,
      created_at: nowISO()
    };
    var all = read(K.touches, []);
    all.push(t);
    write(K.touches, all);
    return t;
  }

  function updateTouch(id, patch) {
    var all = read(K.touches, []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        all[i] = Object.assign(all[i], patch);
        write(K.touches, all);
        return all[i];
      }
    }
    return null;
  }

  function deleteTouch(id) {
    write(K.touches, read(K.touches, []).filter(function (t) { return t.id !== id; }));
  }

  /** その年に、その種類を送ったか */
  function sentIn(customerId, kind, year) {
    return touchesOf(customerId).some(function (t) {
      return t.kind === kind && t.direction === 'sent' && t.date.slice(0, 4) === String(year);
    });
  }

  /* ---------- 誘いの決着 ----------
   * 誘って来ていただけたのか、来ていただけなかったのか。
   * ここが埋まらないと、リードタイムも「呼べば来てくださる率」も出ない。
   * つまり逆算の精度は、この決着がすべて。だから自動でつける。
   */

  var INVITE_WINDOW = 21;   // 誘ってから何日以内の来店を「効いた」とみなすか

  function openInvites(customerId) {
    return touchesOf(customerId).filter(function (t) {
      return t.intent === 'invite' && !t.result;
    });
  }

  /** 来店が記録されたとき、その前の誘いを「効いた」にする */
  function settleInvitesOnVisit(customerId, visitDate) {
    var all = read(K.touches, []);
    var mine = all.filter(function (t) {
      if (t.customer_id !== customerId || t.intent !== 'invite') return false;
      if (t.result === 'came' || t.result === 'superseded') return false;
      /* **本人が「お越しにならなかった」と答えたものは、二度と触らない。**
       * ここを開けておくと、あとから自分でお越しになった一晩が、
       * 効かなかったお誘いの手柄に付け替えられる。
       * そうして水増しされた「お声がけから来た組数」は、いずれ現場の実感と合わなくなり、
       * 数字そのものが読まれなくなる。 */
      if (t.result === 'missed') return false;
      // 確認待ちのものは、来店が入れば「効いた」に戻す（遅れて記録されただけ）
      var gap = daysBetween(t.date, visitDate);
      return gap !== null && gap >= 0 && gap <= INVITE_WINDOW;
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });

    if (!mine.length) return 0;

    // 直近の1件が効いたとみなす。それより前の未決着は二重に数えない
    mine.forEach(function (t, i) {
      t.result = i === 0 ? 'came' : 'superseded';
      t.came_date = i === 0 ? visitDate : null;
      t.settled_at = nowISO();
    });
    write(K.touches, all);
    return mine.length;
  }

  /**
   * 期日を過ぎた誘いを閉じる。
   *
   * **勝手に「来なかった」にはしない。**
   * 記録は3日分まとめて入ることがある。その途中で自動的に missed にすると、
   * 来てくださった方が「来なかった」として残り、
   * 「この方は誘っても来ない」という間違った数字が根拠になってしまう。
   * 間違ったまま確信を持って間違い続けるのが、いちばん質が悪い。
   *
   * だから、期日を過ぎたものは 'asking'（確認待ち）にして本人に聞く。
   * 数えるのは、本人が答えたものだけ。
   */
  function settleOverdueInvites() {
    var all = read(K.touches, []);
    var t0 = today();
    var changed = 0;
    all.forEach(function (t) {
      if (t.intent !== 'invite' || t.result) return;
      var limit = t.target_date ? addDays(t.target_date, 3) : addDays(t.date, INVITE_WINDOW);
      if (t0 > limit) { t.result = 'asking'; t.settled_at = nowISO(); changed += 1; }
    });
    if (changed) write(K.touches, all);
    return changed;
  }

  /** 確認待ちのお誘い。本人に「お越しになりましたか」と聞く */
  function invitesAwaitingAnswer() {
    return listTouches().filter(function (t) {
      return t.intent === 'invite' && t.result === 'asking';
    });
  }

  /** 本人の答えで決着させる */
  function answerInvite(touchId, came) {
    return updateTouch(touchId, {
      result: came ? 'came' : 'missed',
      came_date: came ? today() : null,
      settled_at: nowISO()
    });
  }

  /* ---------- Appointment（来店予定 ＝ 枠） ---------- */

  /* 3つは、確からしさの段階ではなく**別々の状態**である。
   *
   *   確定       日にちが決まった。その日の枠である
   *   日程調整   お越しになるお話はいただいた。**日はまだ無い**
   *   お返事待ち こちらからお誘いした。返事がまだ
   *
   * 以前は「お約束」「狙う」と呼んでいた。
   * 「お約束」は何を約束したのか分からず、「狙う」は
   *   ・札  ＝ すでにお誘いした方
   *   ・下段＝ まだ誰にも声をかけていない方
   * の**逆の意味で二重に**使っていた。 */
  var CONFIDENCE = { confirmed: '確定', verbal: '日程調整', aiming: 'お返事待ち' };

  /* 見込みに入れてよいのは確定だけ。
   *
   * 以前は日程調整に0.6を掛けて足していた。誰も測っていない数字である。
   * 高く見て動かなかった月は取り返せない。低く見た月は、その晩に一組多く
   * お迎えするだけで済む。**この2つは釣り合っていない。**
   * それに0.6を掛けると「同伴 予定1.6回」になる。そんなものは無い。 */
  var CONFIDENCE_WEIGHT = { confirmed: 1, verbal: 0, aiming: 0 };

  function listAppointments() {
    return read(K.appointments, []).sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
  }

  function openAppointments() {
    return listAppointments().filter(function (a) { return !a.closed; });
  }

  /* その日の枠に並ぶもの。
   *
   * **日程調整は日を持たない。**「近いうちに行くよ」を特定の日に置くと、
   * 盤面ではその日に来ると約束したように見える。
   * 古い記録には日が入っているので、ここで落とす（消しはしない）。 */
  function appointmentsOn(date) {
    return openAppointments().filter(function (a) {
      return a.confidence !== 'verbal' && a.date === date;
    });
  }

  /** 日をお決めいただく方。日付を持たないので、盤面とは別に置く */
  function schedulingAppointments() {
    return openAppointments().filter(function (a) { return a.confidence === 'verbal'; });
  }

  function appointmentsOf(customerId) {
    return listAppointments().filter(function (a) { return a.customer_id === customerId; });
  }

  /* 次の予定。**日程調整は含めない。**
   * 含めると、その方は「今日声をかける人」の一覧から消える。
   * 日が決まっていないのだから、いちばん声をかけるべき方である。 */
  function nextAppointmentOf(customerId) {
    var t0 = today();
    return appointmentsOf(customerId).filter(function (a) {
      return !a.closed && a.confidence !== 'verbal' && a.date >= t0;
    })[0] || null;
  }

  /** その方に、日待ちのお話があるか */
  function schedulingOf(customerId) {
    return appointmentsOf(customerId).filter(function (a) {
      return !a.closed && a.confidence === 'verbal';
    })[0] || null;
  }

  function addAppointment(f) {
    // 日程調整は日を持たない。ここで落としておかないと、盤面の日に現れる
    var conf = CONFIDENCE[f.confidence] ? f.confidence : 'verbal';
    var a = {
      id: uid('a'),
      date: conf === 'verbal' ? '' : (f.date || ''),
      customer_id: f.customer_id || null,
      kind: f.kind === 'douhan' ? 'douhan' : 'visit',
      time: f.time || '',       // 待ち合わせ・ご来店の時刻
      place: f.place || '',     // 同伴のお食事の店
      place_by: f.place_by === 'guest' || f.place_by === 'self' ? f.place_by : '',
      confidence: conf,
      expected_spend: typeof f.expected_spend === 'number' ? f.expected_spend : null,
      note: f.note || '',
      source: f.source || 'manual',     // manual / voice / ai
      closed: false,
      result: null,                     // came / no / moved
      created_at: nowISO()
    };
    var all = read(K.appointments, []);
    all.push(a);
    write(K.appointments, all);
    return a;
  }

  function updateAppointment(id, patch) {
    var all = read(K.appointments, []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        all[i] = Object.assign(all[i], patch, { updated_at: nowISO() });
        // 直して日程調整に戻したときも、日を残さない
        if (all[i].confidence === 'verbal') all[i].date = '';
        write(K.appointments, all);
        return all[i];
      }
    }
    return null;
  }

  function deleteAppointment(id) {
    write(K.appointments, read(K.appointments, []).filter(function (a) { return a.id !== id; }));
  }

  /** 来店が記録されたら、その日の予定を閉じる */
  function closeAppointmentsFor(customerId, date) {
    var all = read(K.appointments, []);
    var hit = 0;
    all.forEach(function (a) {
      if (a.closed || a.customer_id !== customerId) return;

      /* 日程調整には日が無い。お越しになった時点で、その話は済んでいる。
       * ここを抜かすと、来ていただいたあとも「日を決めていただく」に
       * 残り続け、二度目のお願いをすることになる。 */
      if (!a.date) {
        a.closed = true; a.result = 'came'; a.closed_at = nowISO();
        hit += 1;
        return;
      }

      var gap = daysBetween(a.date, date);
      if (gap !== null && gap >= -1 && gap <= 2) {
        a.closed = true; a.result = 'came'; a.closed_at = nowISO();
        hit += 1;
      }
    });
    if (hit) write(K.appointments, all);
    return hit;
  }

  /**
   * 過ぎた予定を片付ける。
   * こちらも勝手に「来なかった」にはしない。記録が遅れているだけかもしれない。
   * 7日過ぎたものだけ、盤面から下ろす（結果は unknown のまま残す）。
   *
   * **日付の無いもの（日程調整）を巻き込まないこと。**
   * '' はどの日付より小さいので、素直に書くと入れた直後に消える。
   * 代わりに、伺ってから90日たったものを下ろす。
   * 三月も前の「また行くよ」を、まだ生きている話として数えない。
   */
  function closeStaleAppointments() {
    var all = read(K.appointments, []);
    var t0 = today();
    var changed = 0;
    all.forEach(function (a) {
      if (a.closed) return;
      if (!a.date) {
        var age = (Date.now() - new Date(a.created_at || nowISO()).getTime()) / 86400000;
        if (age > 90) {
          a.closed = true; a.result = 'unknown'; a.closed_at = nowISO(); changed += 1;
        }
        return;
      }
      if (a.date < addDays(t0, -7)) {
        a.closed = true; a.result = 'unknown'; a.closed_at = nowISO(); changed += 1;
      }
    });
    if (changed) write(K.appointments, all);
    return changed;
  }

  /* ---------- Goal（月の目標と締め日） ---------- */

  /**
   * 締め日から、その日が属する期間を出す。
   * closing_day が 0 なら暦の月。20 なら「前月21日〜当月20日」。
   */
  function periodOf(iso) {
    var p = getProfile();
    var cd = parseInt(p.closing_day, 10) || 0;
    var d = new Date((iso || today()) + 'T00:00:00');
    var y = d.getFullYear(), m = d.getMonth(), day = d.getDate();

    if (!cd) {
      var start = new Date(y, m, 1);
      var end = new Date(y, m + 1, 0);
      return { start: toISO(start), end: toISO(end), key: toISO(start).slice(0, 7), label: (m + 1) + '月' };
    }
    // 締め日を含む月を、その期間の名前にする
    var endMonth = day <= cd ? m : m + 1;
    var e = new Date(y, endMonth, Math.min(cd, new Date(y, endMonth + 1, 0).getDate()));
    var s = new Date(e.getFullYear(), e.getMonth() - 1, 1);
    s = new Date(e.getFullYear(), e.getMonth() - 1,
      Math.min(cd, new Date(e.getFullYear(), e.getMonth(), 0).getDate()));
    s.setDate(s.getDate() + 1);
    return {
      start: toISO(s), end: toISO(e),
      key: toISO(e).slice(0, 7),
      label: (e.getMonth() + 1) + '月（' + cd + '日締め）'
    };
  }

  function getGoal(key) {
    var goals = read(K.goals, {});
    var p = getProfile();
    var g = goals[key] || {};
    return {
      key: key,
      sales: typeof g.sales === 'number' ? g.sales : (parseInt(p.target_sales, 10) || 0),
      douhan: typeof g.douhan === 'number' ? g.douhan : (parseInt(p.target_douhan, 10) || 0)
    };
  }

  function saveGoal(key, patch) {
    var goals = read(K.goals, {});
    goals[key] = Object.assign(getGoal(key), patch);
    delete goals[key].key;
    write(K.goals, goals);
    return getGoal(key);
  }

  /** 期間内の来店（売上の実績を出すため。個人配分ではなく総額で見る） */
  function visitsBetween(startISO, endISO) {
    return listVisits().filter(function (v) { return v.date >= startISO && v.date <= endISO; });
  }

  /* ---------- Brief（AI提案とその結果） ---------- */

  /**
   * その方とお食事に行ったお店。
   *
   * **記録するだけでは、ノートと変わらない。**
   * 分けて数えて初めて、次の一軒を決める材料になる。
   *
   *   お客様が選ばれた店 … その方の好みそのもの。回を重ねるほど確かになる
   *   こちらが選んだ店　 … 当たり外れがある。好みの証拠にはならない
   *   直近の店　　　　　 … 続けて同じ店にお連れしない
   *
   * 同伴は「日・お店・待ち合わせの時刻」の3つが決まって初めて成立する。
   * 店が決まらない誘いは必ずもう一往復し、往復が増えるほど流れる。
   * **その場で決めきれること**が、そのまま同伴の数になる。
   */
  function placesOf(customerId) {
    var byGuest = {}, bySelf = {}, recent = [];

    visitsOf(customerId).forEach(function (v) {
      var p = (v.douhan_place || '').trim();
      if (!p) return;

      /* そのお店は**主客のもの**である。
       * ご同行された方の記録にも同じ来店が入るが、
       * お店を選んだのはその方ではない。混ぜると軸が読めなくなる。 */
      var me = (v.attendees || []).filter(function (a) { return a.customer_id === customerId; })[0];
      if (me && me.role === 'doukousha') return;

      if (recent.length < 3) recent.push({ place: p, date: v.date, by: v.place_by || '' });
      if (v.place_by === 'guest') byGuest[p] = (byGuest[p] || 0) + 1;
      else if (v.place_by === 'self') bySelf[p] = (bySelf[p] || 0) + 1;
    });

    // 予定に入っているだけで、まだ行っていないお店も「直近」に数える
    listAppointments().forEach(function (a) {
      if (a.customer_id !== customerId || a.closed) return;
      var p = (a.place || '').trim();
      if (p && !recent.some(function (r) { return r.place === p; })) {
        recent.unshift({ place: p, date: a.date, by: a.place_by || '' });
      }
    });

    function toList(m) {
      return Object.keys(m).map(function (k) { return { place: k, times: m[k] }; })
        .sort(function (a, b) { return b.times - a.times; });
    }

    return {
      by_guest: toList(byGuest),
      by_self: toList(bySelf),
      recent: recent.slice(0, 3)
    };
  }

  /* ---------- 分野の手引き ----------
   *
   * 一度取ったものは残す。同じ分野で毎回AIを叩くのは無駄だし、
   * 覚えるものは繰り返し読むものだから、手元に置いておく意味がある。
   *
   * ここにはお客様の情報が入らない。分野の一般知識だけである。
   * だから書き出しても差し支えないし、消えても誰も困らない。
   */
  function listStudies() {
    return read(K.studies, []).sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  function getStudy(topic) {
    var t = String(topic || '').trim();
    return listStudies().filter(function (s) { return s.topic === t; })[0] || null;
  }

  function saveStudy(topic, data) {
    var all = read(K.studies, []).filter(function (s) { return s.topic !== topic; });
    all.push({
      id: uid('st'),
      topic: topic,
      now: data.now || [],
      basics: data.basics || [],
      questions: data.questions || [],
      pitfalls: data.pitfalls || [],
      deeper: data.deeper || '',
      created_at: nowISO()
    });
    write(K.studies, all);
    return getStudy(topic);
  }

  function removeStudy(topic) {
    write(K.studies, read(K.studies, []).filter(function (s) { return s.topic !== topic; }));
  }

  /**
   * どの分野を勉強すると効くか。
   *
   * 50人ぶんの趣味を全部さらうことはできない。だから順番をつける。
   *   - 近くお会いする方の分野を先に
   *   - 同じ分野に何人もいれば、その分だけ効く
   * ここは端末の中で数えるだけ。AIは要らない。
   */
  function studyTopics() {
    var soon = {};
    openAppointments().forEach(function (a) {
      if (a.customer_id) soon[a.customer_id] = true;
    });

    var map = {};
    activeCustomers().forEach(function (c) {
      (c.interests || []).forEach(function (t) {
        var key = String(t).trim();
        if (!key) return;
        if (!map[key]) map[key] = { topic: key, people: [], soon: 0 };
        map[key].people.push(c);
        if (soon[c.id]) map[key].soon += 1;
      });
    });

    return Object.keys(map).map(function (k) {
      var m = map[k];
      m.study = getStudy(k);
      return m;
    }).sort(function (a, b) {
      if (a.soon !== b.soon) return b.soon - a.soon;          // 近く会う方が先
      if (a.people.length !== b.people.length) return b.people.length - a.people.length;
      return a.topic.localeCompare(b.topic, 'ja');
    });
  }

  function listBriefs() {
    return read(K.briefs, []).sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  function getBrief(id) {
    var all = read(K.briefs, []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function briefsOf(customerId) {
    return listBriefs().filter(function (b) { return b.customer_id === customerId; });
  }

  function latestBrief(customerId) {
    return briefsOf(customerId)[0] || null;
  }

  function addBrief(f) {
    var b = {
      id: uid('b'),
      customer_id: f.customer_id,
      created_at: nowISO(),
      based_on_visits: f.based_on_visits || [],
      summary: f.summary || '',
      talk_points: f.talk_points || [],
      confirm_points: f.confirm_points || [],
      cautions: f.cautions || [],
      hospitality: f.hospitality || [],       // その席でする手当て
      offer: f.offer || [],                   // さりげなくお勧めできるもの（単価）
      trust_risks: f.trust_risks || [],       // 信を落としかねない点
      seed_questions: f.seed_questions || [], // 次の口実になる質問
      meal: f.meal || null,                   // お食事にお誘いするなら、どういうお店か
      timing: f.timing || '',
      outcome: null            // 来店後に埋める
    };
    var all = read(K.briefs, []);
    all.push(b);
    write(K.briefs, all);
    return b;
  }

  /** 提案がどう効いたかを記録する。ここがスパイラルの折り返し点 */
  function recordOutcome(briefId, outcome) {
    var all = read(K.briefs, []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === briefId) {
        all[i].outcome = Object.assign({
          visited: false, used_points: [], missed_points: [], rating: null, note: ''
        }, outcome, { recorded_at: nowISO() });
        write(K.briefs, all);
        return all[i];
      }
    }
    return null;
  }

  /* ---------- 今日の一手（AIの返事を日付で持ち回す） ---------- */

  function getDailyPlan() {
    var p = read(NS + 'daily', null);
    if (!p || p.date !== today()) return null;
    return p;
  }

  function saveDailyPlan(data) {
    write(NS + 'daily', { date: today(), created_at: nowISO(), data: data });
  }

  function clearDailyPlan() { localStorage.removeItem(NS + 'daily'); }

  /* ---------- API設定 ---------- */

  function getApiConfig() { return read(K.api, { gas_url: '', token: '' }); }
  function saveApiConfig(c) {
    write(K.api, { gas_url: (c.gas_url || '').trim(), token: (c.token || '').trim() });
  }

  /* ---------- かかった時間 ----------
   * AIの返事は端からは進み具合が見えない。せめて「あとどれくらいか」は出したい。
   * 実測を残しておいて、次からはその中央値を目安に使う。
   * 端末も回線も人によって違うので、決め打ちの秒数より本人の実測のほうが当たる。
   */

  function recordTiming(kind, ms) {
    if (!ms || ms < 300 || ms > 300000) return;
    var t = read(NS + 'timing', {});
    var a = t[kind] || [];
    a.push(Math.round(ms));
    t[kind] = a.slice(-7);
    write(NS + 'timing', t);
  }

  /** その処理にかかる見込み（ミリ秒）。実測が2件たまるまでは既定値 */
  function estimateMs(kind, fallback) {
    var a = (read(NS + 'timing', {})[kind] || []).slice().sort(function (x, y) { return x - y; });
    if (a.length < 2) return fallback || 30000;
    return a[Math.floor(a.length / 2)];
  }

  /* ---------- AIをどれだけ使ったか ----------
   * クレジットの減り方は、推測ではなく実測で見せる。
   * 「思ったより早くなくなる」がいちばん困るので、月ごとに積んでおく。
   */

  // 1Mトークンあたりの単価（米ドル）。2026年8月時点。変わったらここだけ直す
  var PRICE = {
    'claude-sonnet-5':   { in: 3, out: 15 },
    'claude-haiku-4-5':  { in: 1, out: 5 }
  };
  var PRICE_DEFAULT = { in: 3, out: 15 };   // 分からない型番は高いほうで見積もる

  /* 安いほう（haiku）で動かしている用途。gas/Code.gs の model('fast') と揃える。
   * ここがずれると、画面に出る額だけが実際の何倍にもなる。 */
  var FAST_MODES = ['structure', 'card', 'hooks'];

  function usageMonth(iso) { return (iso || today()).slice(0, 7); }

  function recordUsage(mode, u) {
    if (!u || (!u.in && !u.out)) return;
    var all = read(NS + 'usage', {});
    var m = usageMonth();
    var mon = all[m] || { calls: 0, in: 0, out: 0, by: {} };
    mon.calls += 1;
    mon.in += (u.in || 0);
    mon.out += (u.out || 0);
    var b = mon.by[mode] || { calls: 0, in: 0, out: 0 };
    b.calls += 1; b.in += (u.in || 0); b.out += (u.out || 0);
    mon.by[mode] = b;
    mon.model = u.model || mon.model || '';
    all[m] = mon;

    // 3か月ぶんだけ残す。それ以上は見返さない
    Object.keys(all).sort().slice(0, -3).forEach(function (k) { delete all[k]; });
    write(NS + 'usage', all);
  }

  /** 今月ぶんの利用量と、おおよその費用（円） */
  function usageThisMonth(yenPerUsd) {
    var mon = read(NS + 'usage', {})[usageMonth()];
    if (!mon) return null;
    var rate = yenPerUsd || 155;

    var usd = 0;
    Object.keys(mon.by).forEach(function (k) {
      var p = PRICE[FAST_MODES.indexOf(k) >= 0 ? 'claude-haiku-4-5' : 'claude-sonnet-5'] || PRICE_DEFAULT;
      usd += (mon.by[k].in / 1e6) * p.in + (mon.by[k].out / 1e6) * p.out;
    });

    return {
      month: usageMonth(), calls: mon.calls, in: mon.in, out: mon.out,
      by: mon.by, usd: usd, yen: Math.round(usd * rate)
    };
  }

  /* ---------- メタ ---------- */

  function getMeta() { return read(K.meta, { last_export_at: null, schema_version: SCHEMA_VERSION }); }
  function markExported() {
    var m = getMeta();
    m.last_export_at = nowISO();
    write(K.meta, m);
  }

  function exportOverdue() {
    var m = getMeta();
    if (listVisits().length === 0) return false;
    if (!m.last_export_at) return true;
    var days = (Date.now() - new Date(m.last_export_at).getTime()) / 86400000;
    return days >= 7;
  }

  /* ---------- 書き出し / 読み込み ---------- */

  function exportAll(withImages) {
    var base = {
      app: 'koza',
      schema_version: SCHEMA_VERSION,
      exported_at: nowISO(),
      profile: getProfile(),
      customers: listCustomers(),
      visits: read(K.visits, []),
      touches: read(K.touches, []),
      briefs: read(K.briefs, []),
      studies: read(K.studies, []),
      appointments: read(K.appointments, []),
      goals: read(K.goals, {})
    };
    if (!withImages) return Promise.resolve(base);
    return Blobs.exportAll().then(function (imgs) {
      base.images = imgs;
      return base;
    });
  }

  function exportToFile(withImages) {
    return exportAll(withImages).then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'koza-' + today() + (withImages ? '-画像あり' : '') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      markExported();
      return data;
    });
  }

  function importAll(data) {
    if (!data || data.app !== 'koza') throw new Error('Kōzaの書き出しファイルではないようです');

    var added = { customers: 0, visits: 0, touches: 0, briefs: 0, appointments: 0 };

    function merge(key, incoming, label) {
      var cur = read(key, []);
      var seen = {};
      cur.forEach(function (x) { seen[x.id] = true; });
      (incoming || []).forEach(function (x) {
        if (!x || !x.id || seen[x.id]) return;
        cur.push(x); seen[x.id] = true; added[label] += 1;
      });
      write(key, cur);
    }

    merge(K.customers, data.customers, 'customers');
    merge(K.visits, data.visits, 'visits');
    merge(K.touches, data.touches, 'touches');
    merge(K.briefs, data.briefs, 'briefs');
    merge(K.studies, data.studies, 'studies');
    merge(K.appointments, data.appointments, 'appointments');

    if (data.goals) write(K.goals, Object.assign(read(K.goals, {}), data.goals));

    if (!getProfile().configured && data.profile) write(K.profile, data.profile);

    if (data.images && data.images.length) Blobs.importAll(data.images);

    return added;
  }

  /* ---------- 使用状況（中身を含まない） ---------- */

  function usageStats() {
    var visits = listVisits();
    var days = {};
    var ai = 0, recent = 0;
    var weekAgo = Date.now() - 7 * 86400000;
    visits.forEach(function (v) {
      days[v.date] = true;
      if (v.ai_structured) ai += 1;
      if (v.created_at && new Date(v.created_at).getTime() >= weekAgo) recent += 1;
    });
    var dates = Object.keys(days).sort();
    var briefs = listBriefs();
    var invites = listTouches().filter(function (t) { return t.intent === 'invite'; });
    return {
      invite_count: invites.length,
      invite_settled: invites.filter(function (t) { return t.result === 'came' || t.result === 'missed'; }).length,
      invite_came: invites.filter(function (t) { return t.result === 'came'; }).length,
      appointment_count: openAppointments().length,
      visit_count: visits.length,
      customer_count: activeCustomers().length,
      touch_count: listTouches().length,
      brief_count: briefs.length,
      brief_used: briefs.filter(function (b) { return b.outcome; }).length,
      recorded_days: dates.length,
      recent_7days: recent,
      ai_structured: ai,
      first_date: dates[0] || null,
      last_date: dates[dates.length - 1] || null,
      last_export_at: getMeta().last_export_at
    };
  }

  return {
    uid: uid, today: today, daysBetween: daysBetween, revision: revision,
    addDays: addDays, weekdayOf: weekdayOf, toISO: toISO,
    TOUCH_KINDS: TOUCH_KINDS,
    ACCOUNT_LABELS: ACCOUNT_LABELS, isMyAccount: isMyAccount,
    isAccountUnknown: isAccountUnknown, unknownAccountCustomers: unknownAccountCustomers,
    canContactDirectly: canContactDirectly, accountLabel: accountLabel, isMyVisit: isMyVisit,
    CONFIDENCE: CONFIDENCE, CONFIDENCE_WEIGHT: CONFIDENCE_WEIGHT,

    listAppointments: listAppointments, openAppointments: openAppointments,
    appointmentsOn: appointmentsOn, appointmentsOf: appointmentsOf,
    nextAppointmentOf: nextAppointmentOf,
    addAppointment: addAppointment, updateAppointment: updateAppointment,
    deleteAppointment: deleteAppointment, closeStaleAppointments: closeStaleAppointments,

    periodOf: periodOf, getGoal: getGoal, saveGoal: saveGoal, visitsBetween: visitsBetween,
    openInvites: openInvites, settleOverdueInvites: settleOverdueInvites,
    invitesAwaitingAnswer: invitesAwaitingAnswer, answerInvite: answerInvite,

    getProfile: getProfile, saveProfile: saveProfile,

    listCustomers: listCustomers, activeCustomers: activeCustomers,
    STANDING: STANDING, STANDING_REASONS: STANDING_REASONS,
    isActiveRelation: isActiveRelation, keepsGreeting: keepsGreeting, setStanding: setStanding,
    getCustomer: getCustomer, matchCustomer: matchCustomer, candidates: candidates,
    createCustomer: createCustomer, updateCustomer: updateCustomer,
    deleteCustomer: deleteCustomer, enrichCustomer: enrichCustomer,

    listVisits: listVisits, getVisit: getVisit, addVisit: addVisit,
    updateVisit: updateVisit, deleteVisit: deleteVisit,
    setHookStatus: setHookStatus, settleVisit: settleVisit,
    REMAIN: REMAIN, bottlesOf: bottlesOf, addBottle: addBottle,
    updateBottle: updateBottle, removeBottle: removeBottle,
    customersWithLowBottle: customersWithLowBottle,
    visitsOf: visitsOf, companionsOf: companionsOf, averageInterval: averageInterval,
    moneyOf: moneyOf, rankByMoney: rankByMoney,

    listTouches: listTouches, touchesOf: touchesOf, addTouch: addTouch,
    updateTouch: updateTouch, deleteTouch: deleteTouch, sentIn: sentIn,

    listBriefs: listBriefs, getBrief: getBrief, briefsOf: briefsOf,
    listStudies: listStudies, getStudy: getStudy, saveStudy: saveStudy,
    removeStudy: removeStudy, studyTopics: studyTopics, placesOf: placesOf,
    schedulingAppointments: schedulingAppointments, schedulingOf: schedulingOf,
    latestBrief: latestBrief, addBrief: addBrief, recordOutcome: recordOutcome,

    getDailyPlan: getDailyPlan, saveDailyPlan: saveDailyPlan, clearDailyPlan: clearDailyPlan,
    getApiConfig: getApiConfig, saveApiConfig: saveApiConfig,
    recordTiming: recordTiming, estimateMs: estimateMs,
    recordUsage: recordUsage, usageThisMonth: usageThisMonth,
    getMeta: getMeta, markExported: markExported, exportOverdue: exportOverdue,
    exportAll: exportAll, exportToFile: exportToFile, importAll: importAll,
    usageStats: usageStats
  };
})();
