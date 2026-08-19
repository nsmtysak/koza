/* Kōza v2 — GASプロキシ経由でClaude APIを呼ぶ
 * APIキーはGASのスクリプトプロパティにのみ置く。ここが知るのはURLと合言葉だけ。
 *
 * 6つの用途がある。
 *   structure  話し言葉 → 来歴＋プロフィール追記＋来店予定の候補
 *   card       名刺の画像 → 顧客情報
 *   brief      これまでの履歴 → 会う前の準備と、次の口実を作る質問
 *   plan       目標・不足・盤面 → 今日と数日先にやること（逆算）
 *   drafts     その段取りで送る文だけ。plan と分けて待ち時間を半分にしている
 *   invite     会話の記録 → お誘いの文面を型ごとに3案
 */
var Api = (function () {
  'use strict';

  function isConfigured() {
    var c = Store.getApiConfig();
    return !!(c.gas_url && c.token);
  }

  function post(payload, timeoutMs) {
    var cfg = Store.getApiConfig();
    if (!cfg.gas_url || !cfg.token) return Promise.reject(new Error('AI接続が未設定です'));

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 90000) : null;
    var t0 = Date.now();

    return fetch(cfg.gas_url, {
      method: 'POST',
      // GASはプリフライトを返せないので、単純リクエストに保つ
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: cfg.token }, payload)),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('通信に失敗しました（' + res.status + '）');
      return res.text();
    }).then(function (text) {
      var json;
      try { json = JSON.parse(text); }
      catch (e) { throw new Error('返事の形式が想定と違います。URLと公開設定をご確認ください'); }
      if (!json.ok) throw new Error(json.error || '処理に失敗しました');
      // 次に待たせるときの目安に使う。失敗した回は数えない
      Store.recordTiming(payload.mode, Date.now() - t0);
      if (json.usage) Store.recordUsage(payload.mode, json.usage);
      return json.data;
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('時間内に返事がありませんでした');
      throw err;
    });
  }

  function ping() { return post({ mode: 'ping' }, 20000); }

  /* ---------- 音声・文章 → 来歴 ---------- */

  function structure(rawText) {
    /* すでに記録してあることも一緒に渡す。
     * これが無いと、AIは「趣味に相撲を追加」を、既に相撲が入っている方にも出す。
     * 的外れな候補が続くと、正しい候補まで読み飛ばされる。そうなると機能ごと死ぬ。 */
    var known = Store.activeCustomers().slice(0, 300).map(function (c) {
      return {
        id: c.id, name: c.display_name, real: c.name || '', company: c.company || '',
        known_interests: (c.interests || []).slice(0, 8),
        known_family: (c.family || []).map(function (f) { return f.relation; }),
        known_drinks: ((c.prefs || {}).drinks || []).slice(0, 4),
        known_foods: ((c.prefs || {}).food || []).slice(0, 4)
      };
    });

    return post({
      mode: 'structure',
      text: rawText,
      today: Store.today(),
      known: known,
      context: contextForAi()
    }, 120000);
  }

  /* ---------- 名刺 → 顧客 ---------- */

  function readCard(dataUrl) {
    var m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return Promise.reject(new Error('画像の形式が読み取れません'));
    return post({ mode: 'card', media_type: m[1], image: m[2] }, 120000);
  }

  /* ---------- 逆算した段取り ----------
   * 目標・不足・盤面・各方のリードタイムは、すべて端末で計算する。
   * 根拠が説明できないものは使われないし、毎日開くたびにAPIを叩くのも無駄だから。
   * AIに任せるのは「その数字を前にして、今日と数日先に何をするか」の判断と言葉。
   */
  function weekPlan() {
    var f = Plan.fillPlan();
    var p = f.progress;
    var guests = Plan.todaysGuests();
    var after = Plan.aftercare();

    if (!f.chosen.length && !guests.length && !after.length) {
      return Promise.resolve({ headline: '', gap_comment: '', today: [], soon: [], skip: [], note: '' });
    }

    var gifts = Insight.giftTasks();

    // 盤面は文章にして渡す。表のままだと読み違えられる
    var boardText = Plan.board(14).map(function (d) {
      var who = d.items.map(function (x) {
        return (x.customer ? x.customer.display_name : '（未定）') +
          '（' + (Store.CONFIDENCE[x.appointment.confidence] || '') +
          (x.appointment.kind === 'douhan' ? '・同伴' : '') + '）';
      }).join('、');
      return '- ' + d.date + '（' + d.weekday + '）' +
        (!d.open ? ' 休み' : (who ? ' ' + who : ' 空き')) +
        (d.in_period ? '' : ' ※締め後');
    }).join('\n');

    var payload = {
      mode: 'plan',
      want_draft: false,   // 文面は planDrafts で別に取る。先に段取りを見せたい
      today: Store.today(),
      weekday: Store.weekdayOf(Store.today()),
      context: contextForAi(),
      gift_season: gifts ? { label: gifts.season.label, pending: gifts.pending.length } : null,
      board_text: boardText,
      progress: {
        period_label: p.period.label,
        period_start: p.period.start,
        period_end: p.period.end,
        goal_sales: p.goal.sales,
        actual: p.actual,
        booked: p.booked,
        forecast: p.forecast,
        gap: p.gap,
        days_left: p.days_left,
        average_spend: p.average_spend,
        need_visits: p.need_visits,
        open_days_left: Plan.phase().open_days_left,
        final: Plan.phase().final,
        max_lead: Plan.phase().max_lead,
        douhan_need: Plan.douhanPlan().need,
        douhan_target: p.douhan.target,
        douhan_done: p.douhan.done,
        douhan_booked: p.douhan.booked
      },
      // お礼は売上の逆算より先。信頼のほうが高くつく
      aftercare: after.map(function (a) {
        return {
          id: a.customer.id,
          name: a.customer.display_name,
          days: a.days,
          visit_date: a.visit.date,
          douhan: a.douhan,
          topic: a.topic,
          bottle: a.bottle,
          ng_topics: (a.customer.ng_topics || []).slice(0, 4)
        };
      }),
      today_guests: guests.map(function (g) {
        var last = Store.visitsOf(g.customer.id)[0];
        return {
          id: g.customer.id,
          name: g.customer.display_name,
          confidence: Store.CONFIDENCE[g.appointment.confidence] || '',
          kind: g.appointment.kind,
          account: g.customer.account_owner || 'self',
          last_topic: last ? last.topic_detail : '',
          interests: (g.customer.interests || []).slice(0, 4),
          ng_topics: (g.customer.ng_topics || []).slice(0, 4)
        };
      }),
      candidates: f.chosen.slice(0, 12).map(function (x) {
        return {
          id: x.customer.id,
          name: x.customer.display_name,
          computed_reason: x.reason ? x.reason.text : '',
          tag: x.reason ? x.reason.tag : '',
          target_date: x.target_date,
          target_weekday: x.target_weekday,
          contact_by: x.contact_by,
          urgency: x.urgency,
          lead_days: x.lead.days,
          lead_samples: x.lead.samples,
          come_rate: Math.round(x.come_rate.rate * 100),
          come_samples: x.come_rate.samples,
          expected_spend: x.expected_spend,
          days_since: x.days_since,
          average_interval: x.average_interval,
          visit_count: x.visit_count,
          best_style: x.best_style ? x.best_style.style : '',
          // 直近に使った型。続けて同じ手を出すと、まずテンプレだと気づかれる
          recent_styles: Plan.recentStyles(x.customer.id, 2),
          // 段取りと準備で言うことが食い違わないよう、同じ計算を両方に渡す
          watch_signs: Plan.watchSigns(x.customer.id),
          hooks: x.hooks,
          last_topic: x.last_topic,
          interests: (x.customer.interests || []).slice(0, 5),
          ng_topics: (x.customer.ng_topics || []).slice(0, 5)
        };
      })
    };

    return post(payload, 180000);
  }

  /* ---------- 送る文だけを、あとから ----------
   *
   * 段取りと文面をひとつのお願いにまとめると、返事が出そろうまで1分近く待たされる。
   * 出勤前に1分も画面を見つめる人はいない。
   *
   * だから分けた。
   *   誰に・何を・なぜ今日か  ← 先に出す。判断はここで足りる
   *   送る文                  ← 読んでいる間に、うしろで用意する
   * 段取りの見出しが出るまでが半分になる。文はその20秒後に埋まる。
   */
  function planDrafts(items) {
    var want = (items || []).filter(function (it) {
      return it.action === 'line' || it.action === 'douhan' || it.action === 'thanks';
    });
    if (!want.length) return Promise.resolve({ drafts: [] });

    var byId = {};
    Plan.fillPlan().chosen.forEach(function (x) { byId[x.customer.id] = x; });
    var afterById = {};
    Plan.aftercare().forEach(function (a) { afterById[a.customer.id] = a; });

    var people = want.map(function (it) {
      var c = Store.getCustomer(it.id);
      if (!c) return null;
      var x = byId[it.id], a = afterById[it.id];
      return {
        id: c.id,
        name: c.display_name,
        action: it.action,
        style: it.style || '',
        target_date: it.target_date || '',
        target_weekday: it.target_date ? Store.weekdayOf(it.target_date) : '',
        why_now: it.why_now || '',
        reason: it.reason || '',
        best_style: (x && x.best_style) ? x.best_style.style : '',
        recent_styles: Plan.recentStyles(c.id, 2),
        hooks: x ? x.hooks : [],
        last_topic: x ? x.last_topic : (a ? a.topic : ''),
        days_since: x ? x.days_since : null,
        visit_count: x ? x.visit_count : null,
        interests: (c.interests || []).slice(0, 5),
        ng_topics: (c.ng_topics || []).slice(0, 5),
        thanks: a ? { days: a.days, douhan: a.douhan, bottle: a.bottle, visit_date: a.visit.date } : null
      };
    }).filter(Boolean);

    if (!people.length) return Promise.resolve({ drafts: [] });

    return post({
      mode: 'drafts',
      today: Store.today(),
      context: contextForAi(),
      people: people
    }, 120000);
  }

  /* ---------- お誘いの文面 ----------
   * 型を変えて3案。「なぜこの型か」と「この型の危うさ」つき。選ぶのは本人。
   */
  function invite(customerId, opts) {
    opts = opts || {};
    var c = Store.getCustomer(customerId);
    if (!c) return Promise.reject(new Error('お客様が見つかりません'));

    var d = Insight.digest(customerId);
    var style = Plan.bestStyle(customerId);

    var past = Store.touchesOf(customerId).filter(function (t) { return t.intent === 'invite'; })
      .slice(0, 6).map(function (t) {
        return {
          date: t.date,
          style: t.style,
          result: t.result,
          text: (t.note || '').slice(0, 120)
        };
      });

    return post({
      mode: 'invite',
      today: Store.today(),
      context: contextForAi(),
      kind: opts.kind === 'douhan' ? 'douhan' : 'visit',
      target_date: opts.target_date || '',
      target_weekday: opts.target_date ? Store.weekdayOf(opts.target_date) : '',
      best_style: style ? style.style : '',
      recent_styles: Plan.recentStyles(customerId, 2),
      customer: {
        display_name: c.display_name,
        title: c.title,
        relation_type: c.relation_type,
        birthday: c.birthday,
        family: c.family,
        interests: c.interests,
        prefs: c.prefs,
        ng_topics: c.ng_topics,
        memo: c.memo,
        bottles: (c.bottles || []).filter(function (b) { return b.remain !== 'empty'; })
          .map(function (b) { return { name: b.name, remain: Store.REMAIN[b.remain] || b.remain, since: b.opened_at }; })
      },
      hooks: (d.open_hooks || []).slice(0, 6),
      recent_visits: d.visits.slice(0, 4).map(function (v) {
        return { date: v.date, topic_detail: v.topic_detail, douhan: v.douhan, bottle: v.bottle };
      }),
      past_invites: past
    }, 150000);
  }

  /* ---------- 会う前の準備 ---------- */

  function brief(customerId, purpose) {
    var d = Insight.digest(customerId);
    if (!d) return Promise.reject(new Error('お客様が見つかりません'));

    // 送るのは分析に要る範囲だけ。電話番号や住所は送らない
    var c = d.customer;
    var payload = {
      mode: 'brief',
      purpose: purpose || 'visit',
      today: Store.today(),
      context: contextForAi(),
      // 誰の口座かで、出せる手がまるで違う
      account_owner: c.account_owner || 'unknown',
      customer: {
        display_name: c.display_name,
        title: c.title, company_kind: c.company ? '法人' : '',
        relation_type: c.relation_type, shimei_type: c.shimei_type,
        birthday: c.birthday,
        family: c.family, interests: c.interests, prefs: c.prefs,
        ng_topics: c.ng_topics, memo: c.memo,
        bottles: (c.bottles || []).filter(function (b) { return b.remain !== 'empty'; })
          .map(function (b) { return { name: b.name, remain: Store.REMAIN[b.remain] || b.remain, since: b.opened_at }; })
      },
      stats: {
        visit_count: d.visit_count,
        days_since: d.days_since,
        average_interval: d.average_interval,
        total_spend: d.money.total,
        average_spend: d.money.average,
        max_spend: d.money.max,          // これまでに出された最高額
        recent_spend: d.money.recent      // 直近の推移。落ちてきていれば手当てが要る
      },
      recent_visits: d.visits.slice(0, 6).map(function (v) {
        return {
          date: v.date, my_role: v.my_role, douhan: v.douhan,
          set_count: v.set_count, spend: v.spend,
          topic_detail: v.topic_detail, observation: v.observation,
          drinks: v.drinks, hooks: v.hooks,
          with: (v.attendees || []).map(function (a) {
            var x = Store.getCustomer(a.customer_id);
            return x ? x.display_name + '（' + (a.role === 'shukyaku' ? '主客' : '同行') + '）' : '';
          }).filter(Boolean)
        };
      }),
      touches: d.touches.slice(0, 12).map(function (t) {
        return { date: t.date, kind: Store.TOUCH_KINDS[t.kind] || t.kind, direction: t.direction, note: t.note };
      }),
      open_hooks: d.open_hooks,
      // 段取り側と同じ計算。ここがずれると、2つの画面が別のことを言い出す
      watch_signs: Plan.watchSigns(customerId),
      // 前回の提案とその結果。ここが螺旋の折り返し
      last_brief: d.last_brief ? {
        created_at: d.last_brief.created_at,
        talk_points: d.last_brief.talk_points,
        outcome: d.last_brief.outcome
      } : null
    };

    return post(payload, 180000);
  }

  function contextForAi() {
    var p = Store.getProfile();
    return {
      my_role: p.my_role,
      douhan_timeout_min: p.douhan_timeout_min,
      douhan_deadline: p.douhan_deadline,
      douhan_reward_type: p.douhan_reward_type,
      douhan_quota_monthly: p.douhan_quota_monthly,
      shimei_system: p.shimei_system,
      quiet_from: p.quiet_from,
      quiet_to: p.quiet_to
    };
  }

  /* ---------- AI無しでも止まらないための最小形 ---------- */

  function offlineStructure() {
    return {
      visit_date: Store.today(),
      customers: [],
      my_role: null,
      douhan: false, kirikaeshi: false, nominaoshi: false,
      set_count: 0, spend: null, bottle: '',
      topics: [], topic_detail: '', drinks: [],
      next_visit_hint: { timing: '', confidence: 'none' },
      hooks: [], observation: '', appointments: [], profile_updates: [],
      _offline: true
    };
  }

  /* ---------- 設定の受け渡し ---------- */

  function b64urlEncode(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return decodeURIComponent(escape(atob(t)));
  }

  function buildSetupLink() {
    var c = Store.getApiConfig();
    if (!c.gas_url || !c.token) throw new Error('先にURLと合言葉を入れてください');
    return location.origin + location.pathname + '#s=' +
      b64urlEncode(JSON.stringify({ u: c.gas_url, t: c.token }));
  }

  function consumeSetupLink() {
    var h = location.hash || '';
    if (h.indexOf('#s=') !== 0) return false;
    try {
      var d = JSON.parse(b64urlDecode(h.slice(3)));
      if (!d.u || !d.t) return false;
      Store.saveApiConfig({ gas_url: d.u, token: d.t });
      history.replaceState(null, '', location.pathname + location.search);
      return true;
    } catch (e) {
      history.replaceState(null, '', location.pathname + location.search);
      return false;
    }
  }

  return {
    isConfigured: isConfigured,
    ping: ping,
    structure: structure,
    readCard: readCard,
    brief: brief,
    weekPlan: weekPlan,
    planDrafts: planDrafts,
    invite: invite,
    offlineStructure: offlineStructure,
    buildSetupLink: buildSetupLink,
    consumeSetupLink: consumeSetupLink
  };
})();
