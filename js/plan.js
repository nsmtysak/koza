/* Kōza v2 — 逆算エンジン
 *
 * このアプリの中心。「今日誰に声をかけるか」ではなく、
 * 「締め日に目標へ届かせるために、どの日を埋めるか。そのために今日何をするか」を出す。
 *
 * 順番はこう。
 *   1. 目標 − 実績 − 見込み ＝ 不足額
 *   2. 不足を埋めるには何日分の枠が要るか
 *   3. どの日を埋めるか（空いている日・その方が来やすい曜日・締めに間に合うか）
 *   4. その日に来ていただくには、いつ声をかけるか（＝リードタイム分だけ手前）
 *   5. 手前の日が今日なら、それが今日の仕事
 *
 * 数字はすべてここで出す。AIには渡すだけで、計算はさせない。
 * 「なぜ今日この人なのか」を本人に説明できないと、このアプリは使われない。
 */
var Plan = (function () {
  'use strict';

  var HORIZON = 14;            // 先を見る日数

  /* 数字は全部お店の設定から取る。店ごとに違うものを決め打ちにしない */
  function num(key, fallback) {
    var v = parseInt(Store.getProfile()[key], 10);
    return isFinite(v) ? v : fallback;
  }

  function leadDefault(kind) {
    return kind === 'douhan' ? num('lead_default_douhan', 5) : num('lead_default_visit', 4);
  }

  /**
   * 今このお客様にご連絡してよいか。
   * だめなときは理由を返す。黙って候補から消すと、本人が理由を分からないまま迷う。
   */
  function contactGuard(customerId) {
    var t0 = Store.today();
    var touches = Store.touchesOf(customerId).filter(function (t) { return t.direction === 'sent'; });

    var lastInvite = touches.filter(function (t) { return t.intent === 'invite'; })[0];
    if (lastInvite) {
      var sinceInvite = Store.daysBetween(lastInvite.date, t0);
      if (sinceInvite !== null && sinceInvite < num('cooldown_invite', 10) && !lastInvite.result) {
        return {
          ok: false,
          reason: sinceInvite === 0 ? '今日お誘いを差し上げたばかりです'
            : sinceInvite + '日前にお誘いしています。お返事を待ちます'
        };
      }
    }

    var last = touches[0];
    if (last) {
      var since = Store.daysBetween(last.date, t0);
      if (since !== null && since < num('cooldown_contact', 3)) {
        return { ok: false, reason: since === 0 ? '今日ご連絡したばかりです' : since + '日前にご連絡しています' };
      }
    }

    /* ひと月に何通まで。
     *
     * 間隔を空けるだけでは足りない。型を変えても、続けば「量」そのものが伝わる。
     *   受け手「型を変えても、3通が短期間に続けば量自体がサインになる。
     *           2通目の時点で、今週は何か仕掛けてきてるなと切り替わる」
     *   送り手「間隔が詰まれば、よく構ってくる店という印象は生まれる」
     * 3日おきに送れば月に10通届く。それは多すぎる。 */
    var cap = num('max_contacts_month', 3);
    if (cap > 0) {
      var recent = touches.filter(function (t) {
        var d = Store.daysBetween(t.date, t0);
        return d !== null && d >= 0 && d < 30;
      }).length;
      if (recent >= cap) {
        return {
          ok: false,
          reason: 'この30日で' + recent + '回ご連絡しています。少し間を置きます'
        };
      }
    }

    return { ok: true, reason: '' };
  }

  /** 今、ご連絡を送ってよい時間帯か */
  function sendTimeWarning() {
    var h = new Date().getHours();
    var from = num('quiet_from', 23), to = num('quiet_to', 9);
    var quiet = from <= to ? (h >= from && h < to) : (h >= from || h < to);
    if (!quiet) return '';
    return '今は' + h + '時です。この時間のご連絡は、ご家庭のある方には特にご迷惑になります。' +
      '下書きだけ用意して、' + to + '時以降にお送りになるほうが安全です。';
  }

  /**
   * その日に鉢合わせると困る方がいないか。
   * 顔を合わせてはいけない間柄は、この仕事では珍しくない。
   */
  function clashOn(date, customerId) {
    var c = Store.getCustomer(customerId);
    if (!c) return null;
    var out = [];

    Store.appointmentsOn(date).forEach(function (a) {
      if (!a.customer_id || a.customer_id === customerId) return;
      var other = Store.getCustomer(a.customer_id);
      if (!other) return;

      if ((c.avoid_pair || []).indexOf(other.id) >= 0 ||
          (other.avoid_pair || []).indexOf(c.id) >= 0) {
        out.push({ customer: other, why: '顔を合わせない方が良い間柄として登録されています' });
        return;
      }
      // 同業・同じ会社の方が重なると、双方が気を遣うことになる
      if (c.company && other.company && c.company === other.company) {
        out.push({ customer: other, why: '同じ会社の方です（' + c.company + '）' });
      }
    });

    return out.length ? out : null;
  }

  /* ---------- その方についての推定 ---------- */

  /** 声をかけてから、実際にお見えになるまでの日数 */
  function leadTime(customerId, kind) {
    var samples = Store.touchesOf(customerId).filter(function (t) {
      return t.intent === 'invite' && t.result === 'came' && t.came_date;
    }).map(function (t) {
      return Store.daysBetween(t.date, t.came_date);
    }).filter(function (n) { return n !== null && n >= 0 && n <= 30; });

    if (samples.length >= 2) {
      var sum = samples.reduce(function (a, b) { return a + b; }, 0);
      return { days: Math.max(1, Math.round(sum / samples.length)), samples: samples.length };
    }
    return { days: leadDefault(kind), samples: samples.length };
  }

  /** 誘って来ていただける割合。記録が少ないうちは断定しない */
  function comeRate(customerId) {
    var inv = Store.touchesOf(customerId).filter(function (t) { return t.intent === 'invite'; });
    var came = inv.filter(function (t) { return t.result === 'came'; }).length;
    var missed = inv.filter(function (t) { return t.result === 'missed'; }).length;
    // 'asking'（確認待ち）は数えない。本人が答えたものだけを根拠にする
    var n = came + missed;
    // 標本が少ないうちは 0% や 100% と言い切らない
    return { rate: (came + 1) / (n + 2), came: came, missed: missed, samples: n };
  }

  /** ご来店の多い曜日 */
  function weekdayPattern(customerId) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    Store.visitsOf(customerId).forEach(function (v) {
      counts[new Date(v.date + 'T00:00:00').getDay()] += 1;
    });
    var top = -1, best = 0;
    counts.forEach(function (n, i) { if (n > best) { best = n; top = i; } });
    return { counts: counts, top: best >= 2 ? top : -1, total: counts.reduce(function (a, b) { return a + b; }, 0) };
  }

  /** その方に効いた誘い方 */
  function styleStats(customerId) {
    var out = {};
    var src = customerId ? Store.touchesOf(customerId) : Store.listTouches();
    src.forEach(function (t) {
      if (t.intent !== 'invite' || !t.style) return;
      if (!out[t.style]) out[t.style] = { tried: 0, came: 0 };
      if (t.result === 'came' || t.result === 'missed') {
        out[t.style].tried += 1;
        if (t.result === 'came') out[t.style].came += 1;
      }
    });
    return out;
  }

  /**
   * 直近に使った誘いの型。
   *
   * 効いた型を繰り返すと、ほどなくテンプレだと気づかれる。
   * 現場の評価でも、送り手と受け手の両方から同じ指摘が出た。
   *   受け手「在庫の話が続くと、今月ノルマが足りないのかと勘繰る」
   *   送り手「型の使い回しがばれた瞬間、40人分の信頼が同時に揺らぐ」
   *
   * 成功率だけを見て型を選ぶと、当たった型に寄っていって自分で自分を壊す。
   * だから直近の型は事実として持っておき、避ける材料にする。
   */
  function recentStyles(customerId, n) {
    return Store.touchesOf(customerId)
      .filter(function (t) { return t.intent === 'invite' && t.style; })
      .slice(0, n || 2)
      .map(function (t) { return t.style; });
  }

  /**
   * 変わったかもしれない兆し。
   *
   * 段取りと準備は別々のお願いなので、放っておくと言うことが食い違う。
   * 実際そうなった。段取りが「関心が薄れているかも」と警戒を出しているのに、
   * 準備は同じ来店に一杯乗せる提案をしていた。
   *   「同じアプリの中で言っていることが噛み合っていない」（現場の評価より）
   *
   * だから兆しはここで一度だけ計算して、両方に同じものを渡す。
   * 解釈はしない。**気づいたことを並べるだけ。**
   * 会計が下がったのは、離れかけているのかもしれないし、
   * その日たまたま急いでおられただけかもしれない。決めるのは本人。
   */
  /* お帰りを急いでおられた、という趣旨の記録だけを拾う。
   * 「お酒を勧めておられた」のような、ただの観察は兆しではない。
   * ここを広く取ると、ほとんどの方に兆しが立って、勧める機能が死ぬ。 */
  var HURRY = ['早め', '時計', '急い', '短く', '慌た', '落ち着かな', '口数が少な', '浮かな'];

  function watchSigns(customerId) {
    var out = [];
    var m = Store.moneyOf(customerId);
    var last = Store.visitsOf(customerId)[0];

    // お会計が、いつもの8割を下回った。記録が3回以上ある方だけ
    if (m.average && m.recent.length >= 3 && m.recent[0].amount) {
      var amt = m.recent[0].amount;
      if (amt < m.average * 0.8) {
        out.push('前回のお会計が' + Math.round(amt / 10000) + '万円。' +
          'これまでの平均は' + Math.round(m.average / 10000) + '万円です');
      }
    }

    // お急ぎだった気配。当てはまる言葉があるときだけ
    var obs = (last && last.observation) || '';
    if (obs && HURRY.some(function (k) { return obs.indexOf(k) >= 0; })) {
      out.push('前回のご様子：' + obs);
    }
    return out;
  }

  function bestStyle(customerId) {
    function pick(stats, minTried) {
      var best = null;
      Object.keys(stats).forEach(function (k) {
        var s = stats[k];
        if (s.tried < minTried) return;
        var r = s.came / s.tried;
        if (!best || r > best.rate) best = { style: k, rate: r, tried: s.tried };
      });
      return best;
    }
    return pick(styleStats(customerId), 2) || pick(styleStats(null), 3) || null;
  }

  /** 全体の平均単価。個人の記録が無いときの当てにする */
  function overallAverage() {
    var vals = Store.listVisits().map(function (v) { return v.spend; })
      .filter(function (n) { return typeof n === 'number' && n > 0; });
    if (!vals.length) return 0;
    return Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
  }

  /** その方がお見えになったときの見込み額 */
  function expectedSpend(customerId) {
    var m = Store.moneyOf(customerId);
    if (m.average) return m.average;
    return overallAverage();
  }

  /* ---------- 目標に対して今どこにいるか ---------- */

  function progress() {
    var t0 = Store.today();
    var period = Store.periodOf(t0);
    var goal = Store.getGoal(period.key);
    var visits = Store.visitsBetween(period.start, t0);

    // 自分の口座のご来店だけを実績に数える。ヘルプで付いた席は自分の売上ではない
    var actual = 0, douhanDone = 0, helpVisits = 0;
    visits.forEach(function (v) {
      if (!Store.isMyVisit(v)) { helpVisits += 1; return; }
      if (typeof v.spend === 'number' && v.spend > 0) actual += v.spend;
      if (v.douhan) douhanDone += 1;
    });

    // これから先の予定を、確度で割り引いて見込みに入れる
    var booked = 0, bookedCount = 0, douhanBooked = 0, aiming = 0;
    Store.openAppointments().forEach(function (a) {
      if (a.date < t0 || a.date > period.end) return;
      var ac = a.customer_id ? Store.getCustomer(a.customer_id) : null;
      if (ac && (ac.account_owner === 'mama' || ac.account_owner === 'other')) return;

      /* 「狙う」は見込みに入れない。
       * こちらが誘っただけの予定を見込みに積むと、20人に声をかけただけで
       * 20人分が売上に乗る。画面では届いているのに、締めてみたら足りない。
       * 店に「今月いけます」と言ってしまってからでは遅い。 */
      if (a.confidence === 'aiming') { aiming += 1; return; }

      var w = Store.CONFIDENCE_WEIGHT[a.confidence] || 0.5;
      var amt = typeof a.expected_spend === 'number' && a.expected_spend > 0
        ? a.expected_spend
        : (a.customer_id ? expectedSpend(a.customer_id) : overallAverage());
      booked += amt * w;
      bookedCount += 1;
      if (a.kind === 'douhan') douhanBooked += w;
    });
    booked = Math.round(booked);

    var forecast = actual + booked;
    var gap = goal.sales ? Math.max(0, goal.sales - forecast) : 0;
    var daysLeft = Math.max(0, Store.daysBetween(t0, period.end)) + 1;
    var avg = overallAverage();

    return {
      period: period,
      goal: goal,
      actual: actual,
      visits: visits.length,
      help_visits: helpVisits,
      booked: booked,
      booked_count: bookedCount,
      aiming_count: aiming,   // 狙っているだけの数。見込みには入れていない
      forecast: forecast,
      gap: gap,
      pace: goal.sales ? Math.round(forecast / goal.sales * 100) : null,
      days_left: daysLeft,
      average_spend: avg,
      // 不足を埋めるのに、あと何組お迎えすればよいか
      need_visits: gap && avg ? Math.ceil(gap / avg) : 0,
      douhan: { target: goal.douhan, done: douhanDone, booked: Math.round(douhanBooked * 10) / 10 }
    };
  }

  /* ---------- 14日の盤面 ---------- */

  function isOpenDay(iso) {
    return !Holiday.closedReason(iso);
  }

  function board(days) {
    var t0 = Store.today();
    var period = Store.periodOf(t0);
    var out = [];

    for (var i = 0; i < (days || HORIZON); i++) {
      var date = Store.addDays(t0, i);
      var apts = Store.appointmentsOn(date).map(function (a) {
        return { appointment: a, customer: a.customer_id ? Store.getCustomer(a.customer_id) : null };
      });

      var expected = 0;
      apts.forEach(function (x) {
        // 「狙う」は上の帯でも数えていない。ここだけ数えると食い違う
        if (x.appointment.confidence === 'aiming') return;
        var w = Store.CONFIDENCE_WEIGHT[x.appointment.confidence] || 0.5;
        var amt = typeof x.appointment.expected_spend === 'number' && x.appointment.expected_spend > 0
          ? x.appointment.expected_spend
          : (x.customer ? expectedSpend(x.customer.id) : overallAverage());
        expected += amt * w;
      });

      var closed = Holiday.closedReason(date);

      out.push({
        date: date,
        weekday: Store.weekdayOf(date),
        offset: i,
        open: !closed,
        closed_reason: closed,
        in_period: date <= period.end,
        items: apts,
        douhan: apts.some(function (x) { return x.appointment.kind === 'douhan'; }),
        expected: Math.round(expected),
        empty: apts.length === 0
      });
    }
    return out;
  }

  /* ---------- どの日に、誰を、いつ誘うか ---------- */

  /** その方をその日にお誘いしてよいか */
  function slotAllowed(customer, date) {
    var apts = Store.appointmentsOn(date);
    var already = apts.some(function (a) { return a.customer_id === customer.id; });
    if (already) return false;
    // 顔を合わせない方が良い相手が既に入っている日は外す
    var avoid = customer.avoid_pair || [];
    if (avoid.length && apts.some(function (a) { return avoid.indexOf(a.customer_id) >= 0; })) return false;
    return true;
  }

  function slotScore(customer, day, lead) {
    var s = 0;
    if (!day.open) return -1;
    if (day.offset < lead) return -1;                 // 間に合わない
    s += day.items.length === 0 ? 30 : (day.items.length === 1 ? 12 : 0);
    var wp = weekdayPattern(customer.id);
    var wd = new Date(day.date + 'T00:00:00').getDay();
    if (wp.top === wd) s += 22;
    else if (wp.counts[wd] > 0) s += 8;
    s += Math.max(0, 14 - day.offset);                // 締めまでに効く日を先に
    if (!day.in_period) s -= 25;                      // 締めをまたぐと今月には効かない
    return s;
  }

  /**
   * 声かけ候補ごとに「狙う日」と「声をかける締切」を出す。
   * ここが「今日のお客様づくりは今日ではない」の中身。
   */
  function candidates(limit) {
    var t0 = Store.today();
    var days = board(HORIZON);
    var reasons = {};
    Insight.callList().forEach(function (x) { reasons[x.customer.id] = x; });

    var out = [];
    var held = [];      // 今は間を置くべき方

    Store.activeCustomers().forEach(function (c) {
      // ほかの方の口座には、こちらから誘いをかけない。
      // 越境は係の方の顔をつぶし、店の中で最も信を失う。ここは例外を作らない。
      if (!Store.canContactDirectly(c)) return;

      // すでに予定が入っている方は、誘う対象ではない（当日の準備の対象）
      if (Store.nextAppointmentOf(c.id)) return;

      // 間を置かずに重ねてご連絡しない。しつこいと思われたら終わり
      var guard = contactGuard(c.id);
      if (!guard.ok) { held.push({ customer: c, reason: guard.reason }); return; }

      var lead = leadTime(c.id, 'visit');
      var rate = comeRate(c.id);
      var amt = expectedSpend(c.id);
      var wp = weekdayPattern(c.id);

      // 行ける日を点数順に持っておく。あとで日をばらけさせるために使う
      var slots = [];
      days.forEach(function (d) {
        if (!slotAllowed(c, d.date)) return;
        var s = slotScore(c, d, lead.days);
        if (s < 0) return;
        slots.push({ day: d, score: s });
      });
      if (!slots.length) return;
      slots.sort(function (a, b) { return b.score - a.score; });

      var hooks = Insight.digest(c.id).open_hooks.slice(0, 4).map(function (h) { return h.text; });
      var r = reasons[c.id];
      var last = Store.visitsOf(c.id)[0] || null;

      out.push({
        customer: c,
        reason: r ? r.reason : null,
        slots: slots,
        target_date: null,
        target_weekday: '',
        contact_by: null,
        urgency: 'soon',
        lead: lead,
        come_rate: rate,
        expected_spend: amt,
        weekday_top: wp.top,
        best_style: bestStyle(c.id),
        hooks: hooks,
        last_visit: last ? last.date : null,
        last_topic: last ? last.topic_detail : '',
        days_since: last ? Store.daysBetween(last.date, t0) : null,
        average_interval: Store.averageInterval(c.id),
        visit_count: Store.visitsOf(c.id).length,
        // 期待値。この方に声をかけると、いくら見込めるか
        value: Math.round(amt * rate.rate)
      });
    });

    /* 狙う日を割り振る。
     * 全員を同じ日に寄せると、その日だけ満席で他が空のままになる。
     * 期待値の高い方から、空いている日を先に取っていく。 */
    out.sort(function (a, b) { return b.value - a.value; });

    var used = {};
    Store.openAppointments().forEach(function (a) {
      if (a.date >= t0) used[a.date] = (used[a.date] || 0) + 1;
    });

    var PER_DAY = 2;   // 1日に自分がお迎えできる組数の目安
    out.forEach(function (x) {
      var chosen = null;
      for (var i = 0; i < x.slots.length; i++) {
        var d = x.slots[i].day.date;
        if ((used[d] || 0) < PER_DAY) { chosen = x.slots[i]; break; }
      }
      // どこも埋まっているなら、いちばん空いている日に寄せる。
      // 第一希望に積み上げると、その日だけ十数名になって使いものにならない
      if (!chosen) {
        x.slots.forEach(function (s) {
          var n = used[s.day.date] || 0;
          if (!chosen || n < (used[chosen.day.date] || 0)) chosen = s;
        });
      }
      used[chosen.day.date] = (used[chosen.day.date] || 0) + 1;

      x.target_date = chosen.day.date;
      x.target_weekday = chosen.day.weekday;
      x.contact_by = Store.addDays(chosen.day.date, -x.lead.days);
      x.urgency = x.contact_by < t0 ? 'late' : (x.contact_by === t0 ? 'today' : 'soon');
      delete x.slots;
    });

    // 締切が近く、期待値の高い方から
    var rank = { late: 0, today: 1, soon: 2 };
    out.sort(function (a, b) {
      if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
      return b.value - a.value;
    });

    lastHeld = held;
    return limit ? out.slice(0, limit) : out;
  }

  var lastHeld = [];
  function heldBack() { return lastHeld; }

  /**
   * 不足額を埋めるための組み合わせ。
   * 期待値の高い方から順に枠へ入れて、不足が消えるところで止める。
   */
  function fillPlan() {
    var p = progress();
    var cands = candidates();
    var taken = {};
    var chosen = [];
    var sum = 0;

    cands.forEach(function (x) {
      if (p.gap && sum >= p.gap) return;
      if (taken[x.target_date] && taken[x.target_date] >= 2) return;
      taken[x.target_date] = (taken[x.target_date] || 0) + 1;
      chosen.push(x);
      sum += x.value;
    });

    return {
      progress: p,
      chosen: chosen,
      expected: sum,
      covers_gap: !p.gap || sum >= p.gap,
      today: chosen.filter(function (x) { return x.urgency === 'today' || x.urgency === 'late'; }),
      soon: chosen.filter(function (x) { return x.urgency === 'soon'; })
    };
  }

  /**
   * お礼がまだの方。
   *
   * 永久指名制の店では、口座は信頼の積み上げそのもの。
   * 来ていただいた翌日に一言あるかどうかで、次があるかが決まる。
   * ここは売上の逆算より前に置く。目先の一組より、信頼のほうが高くつく。
   */
  function aftercare() {
    var t0 = Store.today();
    var seen = {};
    var out = [];

    Store.listVisits().forEach(function (v) {
      var since = Store.daysBetween(v.date, t0);
      if (since === null || since < 1 || since > 3) return;

      (v.attendees || []).forEach(function (a) {
        if (!a.customer_id || seen[a.customer_id]) return;
        var c = Store.getCustomer(a.customer_id);
        if (!c) return;
        seen[a.customer_id] = true;

        // ほかの方の口座には、こちらからお礼を送らない（係の方の仕事）
        if (!Store.canContactDirectly(c)) return;

        var thanked = Store.touchesOf(c.id).some(function (t) {
          return t.date >= v.date && t.direction === 'sent' && t.intent !== 'invite' &&
            ['line', 'phone', 'letter', 'mail'].indexOf(t.kind) >= 0;
        });
        if (thanked) return;

        out.push({
          customer: c,
          visit: v,
          days: since,
          role: a.role,
          kind: 'thanks',
          topic: v.topic_detail || '',
          bottle: v.bottle || '',
          douhan: !!v.douhan
        });
      });

      /* ご紹介いただいた方へのお礼。
       * 連れてきてくださった方に何も言わないのが、いちばん角が立つ。
       * ご本人より先に、紹介者にお礼を差し上げるのが筋。 */
      (v.attendees || []).forEach(function (a) {
        var c = Store.getCustomer(a.customer_id);
        if (!c || !c.intro_by) return;
        var isFirst = Store.visitsOf(c.id).slice(-1)[0];
        if (!isFirst || isFirst.id !== v.id) return;      // 初回のご来店のときだけ

        var by = Store.getCustomer(c.intro_by);
        if (!by || seen['intro_' + by.id]) return;
        if (!Store.canContactDirectly(by)) return;
        seen['intro_' + by.id] = true;

        out.push({
          customer: by,
          visit: v,
          days: since,
          kind: 'intro',
          topic: c.display_name + 'をご紹介いただいた',
          bottle: '',
          douhan: false
        });
      });
    });

    return out.sort(function (a, b) { return a.days - b.days; });
  }

  /**
   * 同伴の逆算。
   *
   * 同伴は目標を数えているだけだった。「あと4本足りない」で終わっていて、
   * 「では誰を誘うのか」が無かった。
   * 同伴は単価も上がり、報酬も付き、しかも枠が1日1組しか取れない。
   * 数えるだけなら、目標を持つ意味がない。
   */
  function douhanPlan() {
    var p = progress();
    var need = Math.max(0, p.douhan.target - p.douhan.done - Math.floor(p.douhan.booked));
    if (!p.douhan.target) return { target: 0, need: 0, candidates: [] };

    var t0 = Store.today();
    var days = board(HORIZON);

    // 同伴に応じてくださった実績のある方を先に。次に、よくお越しになる方
    var list = Store.activeCustomers().filter(function (c) {
      if (!Store.canContactDirectly(c)) return false;
      if (Store.nextAppointmentOf(c.id)) return false;
      return contactGuard(c.id).ok;
    }).map(function (c) {
      var visits = Store.visitsOf(c.id);
      var douhans = visits.filter(function (v) { return v.douhan; }).length;
      var lead = leadTime(c.id, 'douhan');
      return {
        customer: c,
        douhan_count: douhans,
        visit_count: visits.length,
        lead: lead,
        expected_spend: expectedSpend(c.id),
        // 同伴の実績がある方は、また応じてくださる見込みが高い
        score: douhans * 40 + Math.min(visits.length, 10) * 4 + (expectedSpend(c.id) / 50000)
      };
    }).filter(function (x) { return x.douhan_count > 0 || x.visit_count >= 3; });

    list.sort(function (a, b) { return b.score - a.score; });

    // 同伴の枠は1日1組。すでに同伴が入っている日は外す
    var taken = {};
    days.forEach(function (d) { if (d.douhan) taken[d.date] = true; });

    list.slice(0, 8).forEach(function (x) {
      var slot = null;
      for (var i = 0; i < days.length; i++) {
        var d = days[i];
        if (!d.open || taken[d.date]) continue;
        if (d.offset < x.lead.days) continue;
        if (!d.in_period) break;          // 締めを過ぎると今月の本数にならない
        slot = d; break;
      }
      if (slot) { taken[slot.date] = true; x.target_date = slot.date; x.target_weekday = slot.weekday; }
      x.contact_by = slot ? Store.addDays(slot.date, -x.lead.days) : null;
      x.urgency = !x.contact_by ? 'none'
        : (x.contact_by < t0 ? 'late' : (x.contact_by === t0 ? 'today' : 'soon'));
    });

    return {
      target: p.douhan.target,
      done: p.douhan.done,
      booked: p.douhan.booked,
      need: need,
      days_left: p.days_left,
      candidates: list.slice(0, 6).filter(function (x) { return x.target_date; })
    };
  }

  /**
   * 締めまでの残り。
   * 残り3日と残り20日で同じ手を出すのは、逆算とは言わない。
   */
  function phase() {
    var p = progress();
    var open = 0;
    for (var i = 0; i < p.days_left; i++) {
      if (isOpenDay(Store.addDays(Store.today(), i))) open += 1;
    }
    return {
      days_left: p.days_left,
      open_days_left: open,          // 出られる日は何日あるか
      final: p.days_left <= 5,       // 追い込み
      // いま声をかけて締めまでに間に合う最長のリードタイム
      max_lead: Math.max(0, p.days_left - 1)
    };
  }

  /**
   * 場内でのご指名を狙える方。
   *
   * 新しい口座は、ここからしか生まれない。
   * ヘルプで付いた席で気に入っていただき、場内指名になり、自分の口座に育つ。
   * これまで文言があるだけで、実体が無かった。
   */
  function jonaiCandidates() {
    var out = [];
    Store.activeCustomers().forEach(function (c) {
      // すでに自分の口座なら、育てる相手ではない
      if (c.account_owner === 'self') return;

      var visits = Store.visitsOf(c.id);
      var withMe = visits.filter(function (v) { return v.my_role === 'help'; }).length;
      if (withMe < 2) return;

      var last = visits[0];
      out.push({
        customer: c,
        times: withMe,
        total: visits.length,
        last_visit: last ? last.date : null,
        last_topic: last ? last.topic_detail : '',
        // フリーの方は直接お声がけもできる。ほかの方の口座は店内だけ
        can_contact: Store.canContactDirectly(c),
        account: Store.accountLabel(c)
      });
    });
    return out.sort(function (a, b) { return b.times - a.times; });
  }

  /** 今日お会いする方 */
  function todaysGuests() {
    return Store.appointmentsOn(Store.today()).map(function (a) {
      return { appointment: a, customer: a.customer_id ? Store.getCustomer(a.customer_id) : null };
    }).filter(function (x) { return x.customer; });
  }

  /**
   * ご来店の予定はあるが、ほかの方の口座の方。
   * こちらから誘う相手ではないが、店内でのお相手は自分の仕事。
   * 係の方を立てながら、次にご指名いただける下地をつくる。
   */
  function guestsOfOthers(days) {
    var t0 = Store.today();
    var end = Store.addDays(t0, days || 7);
    return Store.openAppointments().filter(function (a) {
      if (!a.customer_id || a.date < t0 || a.date > end) return false;
      return !Store.canContactDirectly(Store.getCustomer(a.customer_id));
    }).map(function (a) {
      return { appointment: a, customer: Store.getCustomer(a.customer_id) };
    }).filter(function (x) { return x.customer; });
  }

  /** 数日以内にお会いする方（会う前の準備が要る） */
  function upcomingGuests(days) {
    var t0 = Store.today();
    var end = Store.addDays(t0, days || 3);
    return Store.openAppointments().filter(function (a) {
      return a.date >= t0 && a.date <= end && a.customer_id;
    }).map(function (a) {
      return { appointment: a, customer: Store.getCustomer(a.customer_id) };
    }).filter(function (x) { return x.customer; });
  }

  return {
    HORIZON: HORIZON,
    leadTime: leadTime, comeRate: comeRate, weekdayPattern: weekdayPattern,
    styleStats: styleStats, bestStyle: bestStyle, recentStyles: recentStyles,
    watchSigns: watchSigns,
    expectedSpend: expectedSpend, overallAverage: overallAverage,
    progress: progress, board: board, candidates: candidates, fillPlan: fillPlan,
    aftercare: aftercare, guestsOfOthers: guestsOfOthers,
    douhanPlan: douhanPlan, phase: phase, jonaiCandidates: jonaiCandidates,
    contactGuard: contactGuard, sendTimeWarning: sendTimeWarning,
    clashOn: clashOn, heldBack: heldBack,
    todaysGuests: todaysGuests, upcomingGuests: upcomingGuests,
    isOpenDay: isOpenDay
  };
})();
