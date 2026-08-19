/* Kōza v2 — 声かけ候補の算出
 *
 * ここはAIに投げない。端末の中で計算する。理由は2つ。
 *   1. 「なぜ今この人なのか」を1行で言い切れないと使われない。
 *      計算式で出していれば、根拠が必ず説明できる。
 *   2. 毎日開くたびにAPIを叩くのは無駄。判定に必要なのは日付と回数だけ。
 *
 * AIの出番は、候補が決まったあとの「会う前の準備」（api.brief）。
 */
var Insight = (function () {
  'use strict';

  function daysSince(iso) {
    if (!iso) return null;
    return Store.daysBetween(iso, Store.today());
  }

  /** MM-DD または YYYY-MM-DD から、次に来る記念日までの日数 */
  function daysUntilAnniversary(md) {
    if (!md) return null;
    var m = String(md).match(/(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    if (target < today) target = new Date(now.getFullYear() + 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    return Math.round((target - today) / 86400000);
  }

  /**
   * その来店の口実が、この方のものと言えるか。
   * 「また来る」と言ったのは主客であって、連れてこられた同行者ではない。
   * 同行者に主客の約束を紐づけると、声かけ候補が水増しされて信用を失う。
   */
  /* 同じ宿題が別の日にも記録されることがある。
   * 「仙台へのご出張」が2つ並ぶと、2回言われたように見えて、
   * お誘いの文もその調子で書かれる。同じ言葉のものは1つにまとめる。 */
  function dedupeHooks(list) {
    var seen = {};
    return (list || []).filter(function (h) {
      var k = String(h.text || '').trim();
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function hooksFor(visit, customerId) {
    var attendees = visit.attendees || [];
    var mine = attendees.filter(function (a) { return a.customer_id === customerId; })[0];
    if (!mine) return [];

    var hasShukyaku = attendees.some(function (a) { return a.role === 'shukyaku'; });

    // どの来歴の何番目かを持たせる。「済み」にするときに要る
    return (visit.hooks || []).map(function (h, i) {
      return Object.assign({}, h, { visit_id: visit.id, index: i });
    }).filter(function (h) {
      if (h.customer_id) return h.customer_id === customerId;   // AIが特定できた場合
      if (attendees.length === 1) return true;                  // お一人なら迷いようがない

      /* 複数名の卓で、誰の話か決まらないもの。
       *
       * ここを「全員のもの」にすると、同席のAさんが話したご息女の受験が、
       * Bさんの宿題として残る。そのままお誘いの文の起点になれば、
       * 身に覚えのない話を振ることになり、記録違いが一発で露呈する。
       *
       * 現場の評価でも、いちばん重い指摘はここだった。
       * 「文面の巧拙よりずっと深刻。間違った客の話を別の客に送りかねない」
       *
       * 分からないものは、誰のものにもしない。取りこぼすほうがまだ安い。 */
      if (!hasShukyaku) return false;
      return mine.role === 'shukyaku';                          // 既定は主客のもの
    });
  }

  /** 贈答の時期かどうか。日本の一般的な時期に寄せてある */
  function giftSeason() {
    var now = new Date();
    var m = now.getMonth() + 1, d = now.getDate();
    if (m === 12 || (m === 1 && d <= 7)) {
      return { kind: 'nenga', label: '年賀状', year: m === 12 ? now.getFullYear() + 1 : now.getFullYear() };
    }
    if ((m === 6 && d >= 15) || m === 7) {
      return { kind: 'ochugen', label: 'お中元', year: now.getFullYear() };
    }
    if (m === 11 || (m === 12 && d <= 20)) {
      return { kind: 'oseibo', label: 'お歳暮', year: now.getFullYear() };
    }
    return null;
  }

  /**
   * 声かけ候補。1人につき一番強い理由だけを返す。
   * 理由を並べると読む気が失せるので、必ず1行に絞る。
   */
  function callList(limit) {
    var out = [];
    var season = giftSeason();
    var ranked = Store.rankByMoney();
    var topIds = {};
    ranked.slice(0, Math.max(3, Math.ceil(ranked.length * 0.2))).forEach(function (r) {
      topIds[r.customer.id] = true;
    });

    Store.activeCustomers().forEach(function (c) {
      // ほかの方の口座には、こちらから声をかけない
      if (!Store.canContactDirectly(c)) return;

      var visits = Store.visitsOf(c.id);
      var last = visits[0] || null;
      var since = last ? daysSince(last.date) : null;
      var avg = Store.averageInterval(c.id);
      var reasons = [];

      // ① 約束が未回収
      visits.slice(0, 4).forEach(function (v) {
        hooksFor(v, c.id).forEach(function (h) {
          if (h.type === 'commitment' && h.status !== 'closed') {
            reasons.push({
              score: 100 + Math.min(since || 0, 60),
              text: '「' + h.text + '」と言われたまま',
              tag: '約束'
            });
          }
        });
      });

      // ② 次回の見込みを過ぎた
      if (last && last.next_visit_hint && last.next_visit_hint.timing) {
        var t = String(last.next_visit_hint.timing);
        var ym = t.match(/(\d{4})-(\d{2})/);
        if (ym) {
          var due = new Date(parseInt(ym[1], 10), parseInt(ym[2], 10) - 1, t.indexOf('下旬') >= 0 ? 25 : (t.indexOf('中旬') >= 0 ? 15 : 5));
          var over = Math.round((new Date() - due) / 86400000);
          if (over > 0) {
            reasons.push({ score: 95 + Math.min(over, 40), text: t + 'と伺っていた頃を過ぎた', tag: '見込み' });
          }
        }
      }

      // ③ 来店間隔が個人の平均を超えた
      if (avg && since && since > avg * 1.3) {
        reasons.push({
          score: 80 + Math.min(Math.round((since - avg) / 2), 40),
          text: 'いつもは' + avg + '日ほどの間隔が、今日で' + since + '日',
          tag: '間隔'
        });
      }

      // ④ 誕生日が近い
      var bd = daysUntilAnniversary(c.birthday);
      if (bd !== null && bd <= 10) {
        reasons.push({ score: 90 - bd, text: bd === 0 ? '今日がお誕生日' : 'お誕生日まであと' + bd + '日', tag: '誕生日' });
      }
      (c.family || []).forEach(function (f) {
        var fd = daysUntilAnniversary(f.birthday);
        if (fd !== null && fd <= 7) {
          reasons.push({ score: 70 - fd, text: (f.name || f.relation) + '様のお誕生日まであと' + fd + '日', tag: '家族' });
        }
      });

      /* ⑤ お預かりしているボトルが、そろそろ空く。
       * 作り話でない口実として、これがいちばん強い */
      (c.bottles || []).forEach(function (b) {
        if (b.remain !== 'low') return;
        reasons.push({
          score: 88,
          text: 'お預かりの' + b.name + 'が、そろそろ空きます',
          tag: 'ボトル'
        });
      });

      // ⑥ 贈答の時期で、今年まだ出していない
      if (season && c.gift_policy && c.gift_policy[season.kind]) {
        if (!Store.sentIn(c.id, season.kind, season.year)) {
          reasons.push({ score: 75, text: season.label + 'をまだお出ししていない', tag: '贈答' });
        }
      }

      // ⑥ 時限のある話題（出張・入院・受験など）
      visits.slice(0, 3).forEach(function (v) {
        hooksFor(v, c.id).forEach(function (h) {
          if (h.status === 'closed') return;
          if (['family', 'health', 'work', 'event'].indexOf(h.type) >= 0) {
            reasons.push({ score: 55 + Math.min(since || 0, 25), text: h.text + 'について伺える', tag: '話題' });
          }
        });
      });

      // ⑦ 売上上位なのに間が空いている
      if (topIds[c.id] && since && since >= 21) {
        reasons.push({ score: 85, text: 'よくしてくださる方だが' + since + '日空いている', tag: '大切' });
      }

      // ⑧ 一度も来ていない（名刺だけ登録された人）
      if (!last) {
        var met = daysSince(c.first_met);
        if (met !== null && met >= 7 && met <= 90) {
          reasons.push({ score: 60, text: '名刺を頂いてから' + met + '日、まだ一度も', tag: '初回' });
        }
      }

      if (!reasons.length) return;
      reasons.sort(function (a, b) { return b.score - a.score; });

      out.push({
        customer: c,
        reason: reasons[0],
        other_count: reasons.length - 1,
        last_visit: last ? last.date : null,
        days_since: since
      });
    });

    out.sort(function (a, b) { return b.reason.score - a.reason.score; });
    return limit ? out.slice(0, limit) : out;
  }

  /** 贈答のやること。今の時期に該当するものだけ */
  function giftTasks() {
    var season = giftSeason();
    if (!season) return null;
    var pending = [], done = [];
    Store.activeCustomers().forEach(function (c) {
      if (!c.gift_policy || !c.gift_policy[season.kind]) return;
      (Store.sentIn(c.id, season.kind, season.year) ? done : pending).push(c);
    });
    return { season: season, pending: pending, done: done };
  }

  /** 顧客カードとブリーフの材料。AIに渡す形もこれに揃える */
  function digest(customerId) {
    var c = Store.getCustomer(customerId);
    if (!c) return null;
    var visits = Store.visitsOf(customerId);
    var money = Store.moneyOf(customerId);

    return {
      customer: c,
      visits: visits,
      visit_count: visits.length,
      last_visit: visits[0] || null,
      days_since: visits[0] ? daysSince(visits[0].date) : null,
      average_interval: Store.averageInterval(customerId),
      money: money,
      companions: Store.companionsOf(customerId),
      touches: Store.touchesOf(customerId),
      open_hooks: dedupeHooks(visits.slice(0, 5).reduce(function (acc, v) {
        hooksFor(v, customerId).forEach(function (h) { if (h.status !== 'closed') acc.push(h); });
        return acc;
      }, [])),
      last_brief: Store.latestBrief(customerId)
    };
  }

  return {
    hooksFor: hooksFor,
    callList: callList,
    giftTasks: giftTasks,
    giftSeason: giftSeason,
    digest: digest,
    daysSince: daysSince,
    daysUntilAnniversary: daysUntilAnniversary
  };
})();
