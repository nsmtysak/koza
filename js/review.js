/* Kōza v2 — 締めの振り返り
 *
 * このアプリを使い続けるかどうかは、ここで決まる。
 *
 * 「なんとなく効いている気がする」では、人は使うのをやめる。
 * 効いているなら数字で言えるはずで、言えないなら効いていない。
 * だから、いいところだけでなく、外した数もそのまま出す。
 *
 * 数え方はひとつだけ守る。
 *   **お声がけのあとにお越しになった分だけを「提案から」と呼ぶ。**
 * ご自分の力で呼んだご来店まで混ぜたら、この画面はただのお世辞になる。
 */
var Review = (function () {
  'use strict';

  /* ---------- 集計 ---------- */

  /** その来店で、その方に寄せられる金額（moneyOf と同じ寄せ方） */
  function shareOf(v, customerId) {
    if (typeof v.spend !== 'number' || v.spend <= 0) return 0;
    var att = v.attendees || [];
    var me = att.filter(function (a) { return a.customer_id === customerId; })[0];
    if (!me) return 0;
    var shukyaku = att.filter(function (a) { return a.role === 'shukyaku'; });
    if (shukyaku.length > 0) return me.role === 'shukyaku' ? v.spend / shukyaku.length : 0;
    return v.spend / (att.length || 1);
  }

  function inPeriod(iso, p) { return !!iso && iso >= p.start && iso <= p.end; }

  /**
   * ひと月ぶんの答え合わせ。
   * 締め日の設定に合わせた期間で切る（月末締めとは限らない）。
   */
  function of(anyDateInPeriod) {
    var p = Store.periodOf(anyDateInPeriod || Store.today());
    var goal = Store.getGoal(p.key);
    var t0 = Store.today();

    /* --- 売上と来店 --- */
    var visits = Store.visitsBetween(p.start, p.end);
    var actual = 0, mine = 0, help = 0, douhanDone = 0;
    visits.forEach(function (v) {
      if (!Store.isMyVisit(v)) { help += 1; return; }
      mine += 1;
      if (typeof v.spend === 'number' && v.spend > 0) actual += v.spend;
      if (v.douhan) douhanDone += 1;
    });

    /* --- どなたに支えられた月だったか ---
     *
     * 顧客管理でいちばん多い落とし方が、これだと言われている。
     *   「太客のみを管理し、新規開拓を怠る。太客が離れた時に収入が急減する」
     * このアプリは口座を越えないので、新規の入り口はもともと狭い。
     * だからせめて、いま何割をどなたに預けているかは見えているほうがよい。
     *
     * **評価はしない。危ないとも言わない。割合だけを置く。**判断は本人のもの。 */
    var byCustomer = {};
    visits.forEach(function (v) {
      if (!Store.isMyVisit(v)) return;
      (v.attendees || []).forEach(function (a) {
        var amt = shareOf(v, a.customer_id);
        if (amt > 0) byCustomer[a.customer_id] = (byCustomer[a.customer_id] || 0) + amt;
      });
    });
    var top = Object.keys(byCustomer).map(function (id) {
      return { customer: Store.getCustomer(id), amount: byCustomer[id] };
    }).filter(function (x) { return x.customer; })
      .sort(function (a, b) { return b.amount - a.amount; });

    var topSum = top.slice(0, 3).reduce(function (n, x) { return n + x.amount; }, 0);
    var lean = {
      list: top.slice(0, 3),
      share: actual > 0 ? Math.round(topSum / actual * 100) : 0,
      people: top.length
    };

    /* --- お誘いの決着 --- */
    var sent = 0, came = 0, missed = 0, asking = 0;
    var credited = [];

    Store.listTouches().forEach(function (t) {
      if (t.intent !== 'invite') return;
      if (!inPeriod(t.date, p)) return;
      sent += 1;

      if (t.result === 'came') {
        came += 1;
        // お越しになった日の来店から、その方のぶんを拾う
        var amount = 0, when = t.came_date || null;
        if (when) {
          Store.visitsBetween(when, when).forEach(function (v) {
            if (!Store.isMyVisit(v)) return;
            amount += shareOf(v, t.customer_id);
          });
        }
        credited.push({
          customer: Store.getCustomer(t.customer_id),
          date: when,
          amount: Math.round(amount)
        });
      } else if (t.result === 'missed') {
        missed += 1;
      } else if (t.result === 'asking') {
        asking += 1;
      }
    });

    var creditedSpend = credited.reduce(function (n, x) { return n + x.amount; }, 0);
    credited.sort(function (a, b) { return b.amount - a.amount; });

    /* --- 準備を使ったか、当たっていたか --- */
    var made = 0, rated = 0, helpful = 0;
    Store.listBriefs().forEach(function (b) {
      if (!inPeriod((b.created_at || '').slice(0, 10), p)) return;
      made += 1;
      if (b.outcome && b.outcome.rating) {
        rated += 1;
        if (b.outcome.rating >= 2) helpful += 1;
      }
    });

    /* --- 記録が続いたか。ここが崩れると来月の提案が当たらない --- */
    var days = {};
    visits.forEach(function (v) { days[v.date] = true; });
    var last = t0 < p.end ? t0 : p.end;
    var elapsed = Math.max(1, (Store.daysBetween(p.start, last) || 0) + 1);

    /* --- 今月はじめてお会いした方 --- */
    var fresh = Store.activeCustomers().filter(function (c) {
      return inPeriod(c.first_met || '', p);
    });

    return {
      period: p,
      closed: t0 > p.end,
      goal: goal,
      sales: {
        actual: actual,
        pct: goal.sales ? Math.round(actual / goal.sales * 100) : null,
        reached: !!goal.sales && actual >= goal.sales,
        short: goal.sales ? Math.max(0, goal.sales - actual) : 0
      },
      visits: { mine: mine, help: help, days: Object.keys(days).length, elapsed: elapsed },
      invites: {
        sent: sent, came: came, missed: missed, asking: asking,
        settled: came + missed,
        rate: (came + missed) ? Math.round(came / (came + missed) * 100) : null
      },
      credited: { count: credited.length, spend: creditedSpend, list: credited },
      lean: lean,
      briefs: { made: made, rated: rated, helpful: helpful },
      douhan: { target: goal.douhan || 0, done: douhanDone },
      newcomers: fresh.length
    };
  }

  /** 直前に締まった期間。締まって5日以内のときだけ返す（今日の画面で報せるため） */
  function justClosed() {
    var t0 = Store.today();
    var prev = Store.periodOf(Store.addDays(Store.periodOf(t0).start, -1));
    var since = Store.daysBetween(prev.end, t0);
    if (since === null || since < 1 || since > 5) return null;
    return prev;
  }

  /* ---------- 画面 ---------- */

  function open(anyDateInPeriod) {
    render(of(anyDateInPeriod));
    UI.show('review');
  }

  function render(r) {
    document.getElementById('review-title').textContent = r.period.label + 'の答え合わせ';
    var body = UI.clear(document.getElementById('review-body'));

    if (!r.closed) {
      body.appendChild(UI.el('p', 'help',
        'まだ締め日前です（' + UI.shortDate(r.period.end) + '締め）。ここまでの分を出しています。'));
    }

    headline(body, r);
    salesBlock(body, r);
    creditBlock(body, r);
    leanBlock(body, r);
    habitBlock(body, r);
    nextBlock(body, r);
    switcher(body, r);
  }

  /** いちばん上。ここだけ読めば足りるように */
  function headline(body, r) {
    var box = UI.el('div', 'brief-summary');

    if (!r.invites.sent) {
      box.appendChild(UI.el('div', null,
        r.period.label + 'は、アプリからのお声がけの記録がありませんでした。'));
      box.appendChild(UI.el('p', 'help',
        '実際にお送りしたあとで「送りました」を押していただかないと、何が効いたのかを数えられません。'));
      body.appendChild(box);
      return;
    }

    box.appendChild(UI.el('div', null, 'Kōzaのお声がけから'));

    var g = UI.el('div', 'review-nums');
    num(g, 'お声がけ', r.invites.sent, '件');
    num(g, 'お越しになった', r.credited.count, '組');
    if (r.credited.spend) num(g, 'そのお会計', UI.yen(r.credited.spend), '');
    box.appendChild(g);

    box.appendChild(UI.el('p', 'help',
      'お声がけを差し上げたあとにお越しになった分だけを数えています。' +
      'ご自分でお決めになっていたご来店は入れていません。'));
    body.appendChild(box);
  }

  function num(parent, label, value, unit) {
    var d = UI.el('div', 'review-num');
    d.appendChild(UI.el('span', 'rn-label', label));
    var v = UI.el('span', 'rn-value', String(value));
    if (unit) v.appendChild(UI.el('small', null, unit));
    d.appendChild(v);
    parent.appendChild(d);
  }

  function salesBlock(body, r) {
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '売上'));
    var ul = UI.el('ul', 'brief-list');

    if (r.goal.sales) {
      ul.appendChild(UI.el('li', null,
        '目標 ' + UI.yen(r.goal.sales) + '　実績 ' + UI.yen(r.sales.actual) +
        '（' + r.sales.pct + '%）' + (r.sales.reached ? '　達成' : '')));
      if (!r.sales.reached && r.closed) {
        ul.appendChild(UI.el('li', 'caution', UI.yen(r.sales.short) + '足りませんでした。'));
      }
    } else {
      ul.appendChild(UI.el('li', null, '実績 ' + UI.yen(r.sales.actual) + '（目標は設定していません）'));
    }

    ul.appendChild(UI.el('li', null,
      'ご自分の席 ' + r.visits.mine + '組' + (r.visits.help ? '　ヘルプ ' + r.visits.help + '組' : '')));

    if (r.douhan.target) {
      ul.appendChild(UI.el('li', r.douhan.done >= r.douhan.target ? null : 'caution',
        '同伴 ' + r.douhan.done + ' / ' + r.douhan.target + '回'));
    }
    if (r.newcomers) {
      ul.appendChild(UI.el('li', null, 'はじめてお会いした方 ' + r.newcomers + '名'));
    }
    s.appendChild(ul);
    body.appendChild(s);
  }

  /** 誰が来てくださったのか。お名前で見えないと実感にならない */
  function creditBlock(body, r) {
    if (!r.invites.sent) return;
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'お声がけの結果'));

    var ul = UI.el('ul', 'brief-list');
    if (r.invites.rate !== null) {
      ul.appendChild(UI.el('li', null,
        '決着した ' + r.invites.settled + '件のうち、' + r.invites.came +
        '件でお越しいただけました（' + r.invites.rate + '%）。'));
    }
    if (r.invites.asking) {
      ul.appendChild(UI.el('li', 'caution',
        r.invites.asking + '件が「お越しになりましたか」のまま、お答えを待っています。' +
        'ここが埋まらないと、来月の見立てがぶれます。'));
    }
    s.appendChild(ul);

    if (r.credited.list.length) {
      var cards = UI.el('div', 'cards');
      r.credited.list.forEach(function (x) {
        if (!x.customer) return;
        var row = UI.el('div', 'gift-row');
        row.appendChild(UI.el('span', 'gname', x.customer.display_name));
        // 金額が0の方もいる（同行者としてのご来店など）。空白を残さない
        row.appendChild(UI.el('span', 'gwhen',
          [x.date ? UI.shortDate(x.date) : '', x.amount ? UI.yen(x.amount) : '']
            .filter(String).join('　')));
        cards.appendChild(row);
      });
      s.appendChild(cards);
    }
    body.appendChild(s);
  }

  /**
   * どなたに支えられた月だったか。
   *
   * **ここに評価語を書かない。**「偏っています」「危険です」とは言わない。
   * 割合を置くだけにして、どうするかは本人に返す。
   * 採点はしない、というのがこのアプリの決まりごとである。
   */
  function leanBlock(body, r) {
    if (!r.lean.list.length || !r.lean.share) return;
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'どなたに支えられた月か'));
    s.appendChild(UI.el('p', 'help',
      'この期間にお会いしたのは ' + r.lean.people + '名。' +
      'そのうち上のお三方で、売上の ' + r.lean.share + '% です。'));
    var ul = UI.el('ul', 'brief-list');
    r.lean.list.forEach(function (x) {
      ul.appendChild(UI.el('li', null, x.customer.display_name + '　' + UI.yen(Math.round(x.amount))));
    });
    s.appendChild(ul);
    body.appendChild(s);
  }

  /** 続いたかどうか。ここが崩れていれば、来月の提案は当たらない */
  function habitBlock(body, r) {
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '記録の続き方'));
    var ul = UI.el('ul', 'brief-list');
    ul.appendChild(UI.el('li', null,
      r.visits.elapsed + '日のうち、' + r.visits.days + '日ぶんの記録が残っています。'));
    if (r.briefs.made) {
      ul.appendChild(UI.el('li', null,
        '会う前の準備 ' + r.briefs.made + '回' +
        (r.briefs.rated ? '　うち ' + r.briefs.helpful + '回が「役に立った・まあまあ」' : '')));
      if (!r.briefs.rated) {
        ul.appendChild(UI.el('li', 'caution',
          '準備の当たり外れを一度も記録していません。ここを押していただくと、次の準備が変わります。'));
      }
    }
    s.appendChild(ul);
    body.appendChild(s);
  }

  /** 来月へ持ち越すこと。振り返って終わりにしない */
  function nextBlock(body, r) {
    var todo = [];

    if (r.invites.asking) {
      todo.push('お答えを待っているお誘い ' + r.invites.asking + '件に、来た・来ないを入れる。');
    }
    if (!r.invites.sent) {
      todo.push('お送りしたら「送りました」を押す。押さないと、何も学習しません。');
    } else if (r.invites.rate !== null && r.invites.rate < 40) {
      todo.push('お越しいただけた率が ' + r.invites.rate + '%です。' +
        '切り出し方を変えてみる。');
    }
    if (r.douhan.target && r.douhan.done < r.douhan.target) {
      todo.push('同伴が ' + (r.douhan.target - r.douhan.done) + '回足りませんでした。' +
        '枠は1日1組しか取れないので、月の前半から入れる。');
    }
    if (r.visits.days < Math.round(r.visits.elapsed * 0.4)) {
      todo.push('記録が残っていない日が目立ちます。お名前と金額だけでも残すと、来月の逆算が効きます。');
    }
    if (!todo.length) todo.push('大きな穴はありません。この形を続けてください。');

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '来月へ'));
    var ul = UI.el('ul', 'brief-list');
    todo.forEach(function (t) { ul.appendChild(UI.el('li', 'hosp', t)); });
    s.appendChild(ul);
    body.appendChild(s);
  }

  /** 前の月へ戻れるように */
  function switcher(body, r) {
    var act = UI.el('div', 'actions col');
    var prev = Store.periodOf(Store.addDays(r.period.start, -1));
    var b = UI.el('button', 'ghost', prev.label + 'を見る');
    b.type = 'button';
    b.addEventListener('click', function () { open(prev.end); });
    act.appendChild(b);

    if (r.period.key !== Store.periodOf(Store.today()).key) {
      var now = UI.el('button', 'ghost', '今月に戻る');
      now.type = 'button';
      now.addEventListener('click', function () { open(Store.today()); });
      act.appendChild(now);
    }
    body.appendChild(act);
  }

  function init() {
    document.getElementById('review-back').addEventListener('click', function () { UI.back('board'); });
  }

  return { init: init, of: of, open: open, justClosed: justClosed };
})();
