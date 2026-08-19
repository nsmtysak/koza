/* Kōza v2 — お誘い
 *
 * 「来てください」と書かせない。
 * 行きたくなるのは、行く理由が相手の側にあるときだけ。
 * 型を変えて3案出し、選ぶのは本人。危うさも一緒に見せる。
 *
 * 送ったことは接点として残り、来店したかどうかで決着する。
 * その決着が、次の逆算（リードタイム・お越しになる割合・効く型）の材料になる。
 */
var Invite = (function () {
  'use strict';

  var cur = null;      // { customer, target_date, kind, result }

  function open(customerId, opts) {
    opts = opts || {};
    var c = Store.getCustomer(customerId);
    if (!c) { UI.toast('お客様が見つかりません', true); return; }

    // ほかの方の口座には、お誘いの画面そのものを開かせない
    if (!Store.canContactDirectly(c)) {
      UI.toast(Store.accountLabel(c) + 'です。こちらからのお誘いはしません', true);
      return;
    }

    cur = {
      customer: c,
      target_date: opts.target_date || '',
      kind: opts.kind === 'douhan' ? 'douhan' : 'visit',
      result: null
    };

    document.getElementById('invite-title').textContent =
      c.display_name + 'へ' + (cur.kind === 'douhan' ? 'の同伴のお誘い' : 'のお誘い');

    UI.show('invite');
    render();
  }

  function render() {
    var body = UI.clear(document.getElementById('invite-body'));
    if (!cur) return;

    body.appendChild(UI.aiNote('draft'));

    /* 狙う日 */
    var head = UI.el('div', 'form');
    var f = UI.el('label', 'f');
    f.appendChild(UI.el('span', null, 'お越しいただきたい日'));
    var d = UI.el('input');
    d.type = 'date';
    d.value = cur.target_date;
    d.addEventListener('change', function () { cur.target_date = d.value; });
    f.appendChild(d);
    head.appendChild(f);

    var kf = UI.el('div', 'f');
    kf.appendChild(UI.el('span', null, 'お誘いの種類'));
    kf.appendChild(UI.segmented(
      [{ value: 'visit', label: 'ご来店' }, { value: 'douhan', label: '同伴' }],
      cur.kind, function (v) { cur.kind = v; }));
    head.appendChild(kf);
    body.appendChild(head);

    /* 送ってよい相手か・送ってよい時間か。ここは売上より先に出す */
    var guard = Plan.contactGuard(cur.customer.id);
    if (!guard.ok) {
      var g = UI.el('div', 'banner-warn');
      g.appendChild(UI.el('h3', null, '間を置いたほうがよい方です'));
      g.appendChild(UI.el('p', null, guard.reason +
        '。重ねてお送りすると、しつこいという印象だけが残ります。'));
      body.appendChild(g);
    }
    var timeWarn = Plan.sendTimeWarning();
    if (timeWarn) {
      var tw = UI.el('div', 'banner-warn');
      tw.appendChild(UI.el('h3', null, 'お送りする時間にご注意ください'));
      tw.appendChild(UI.el('p', null, timeWarn));
      body.appendChild(tw);
    }

    /* この方について分かっていること。根拠を先に見せる */
    var lead = Plan.leadTime(cur.customer.id, cur.kind);
    var rate = Plan.comeRate(cur.customer.id);
    var st = Plan.bestStyle(cur.customer.id);
    var facts = UI.el('div', 'brief-summary');
    var lines = ['お声がけから平均 ' + lead.days + '日でお越しになります' +
      (lead.samples < 2 ? '（記録が少ないため目安です）' : '（記録' + lead.samples + '件）')];
    if (rate.samples >= 2) {
      lines.push('お誘いしてお越しになった割合は ' + Math.round(rate.rate * 100) + '%です（' + rate.came + '／' + rate.samples + '）');
    }
    if (st) lines.push('これまで効いた型は「' + (Store.INVITE_STYLES[st.style] || st.style) + '」です');
    lines.forEach(function (t) { facts.appendChild(UI.el('div', null, t)); });
    body.appendChild(facts);

    /* 口実 */
    var hooks = Insight.digest(cur.customer.id).open_hooks;
    if (hooks.length) {
      var hb = UI.el('div', 'block');
      hb.appendChild(UI.el('h3', 'sect', '起点にできること'));
      var ul = UI.el('ul', 'plain');
      hooks.slice(0, 5).forEach(function (h) { ul.appendChild(UI.el('li', null, h.text)); });
      hb.appendChild(ul);
      body.appendChild(hb);
    } else {
      body.appendChild(UI.el('p', 'help',
        'この方の会話の記録がまだありません。記録が増えるほど、お誘いはその方だけのものになります。'));
    }

    /* 生成 */
    if (!cur.result) {
      if (!Api.isConfigured()) {
        body.appendChild(UI.el('p', 'empty', 'AIの接続を入れると、お誘いの文をここで作れます。'));
      } else {
        var b = UI.el('button', 'primary full', '文面を3案つくる');
        b.type = 'button';
        b.addEventListener('click', generate);
        body.appendChild(b);
      }
    } else {
      drawResult(body, cur.result);
    }

    /* AIを使わずに、送ったことだけ残す道も用意する */
    var manual = UI.el('details', 'raw');
    manual.appendChild(UI.el('summary', null, '自分の言葉で送った場合はこちら'));
    var mw = UI.el('div', 'form');
    var ta = UI.el('textarea');
    ta.rows = 3;
    ta.placeholder = '送った文（覚えのために。空でも構いません）';
    mw.appendChild(ta);
    var sw = UI.el('div', 'f');
    sw.appendChild(UI.el('span', null, 'どの型で送りましたか'));
    var styleSel = UI.el('select');
    var blank = UI.el('option', null, '（選ばない）');
    blank.value = '';
    styleSel.appendChild(blank);
    Object.keys(Store.INVITE_STYLES).forEach(function (k) {
      var o = UI.el('option', null, Store.INVITE_STYLES[k]);
      o.value = k;
      styleSel.appendChild(o);
    });
    sw.appendChild(styleSel);
    mw.appendChild(sw);
    var mb = UI.el('button', 'ghost small', '送ったことを残す');
    mb.type = 'button';
    mb.addEventListener('click', function () {
      recordInvite(ta.value.trim(), styleSel.value);
    });
    mw.appendChild(mb);
    manual.appendChild(mw);
    body.appendChild(manual);
  }

  function generate() {
    UI.busy(true, 'お誘いの文を考えています…', {
      estimate: Store.estimateMs('invite', 24000),
      steps: ['前回のお話を拾っています…', '型を選んでいます…', '言い回しを整えています…']
    });
    Api.invite(cur.customer.id, { target_date: cur.target_date, kind: cur.kind })
      .then(function (d) {
        UI.busy(false);
        cur.result = d;
        render();
      })
      .catch(function (e) {
        UI.busy(false);
        UI.toast(e.message, true);
      });
  }

  function drawResult(body, r) {
    var block = UI.el('div', 'block');
    block.appendChild(UI.el('h3', 'sect', '3つの型で書きました'));

    (r.drafts || []).forEach(function (dr, i) {
      var n = i + 1;
      var card = UI.el('div', 'card draft-card' + (r.best === n ? ' is-best' : ''));

      var top = UI.el('div', 'card-top');
      top.appendChild(UI.el('div', 'card-name', dr.label || Store.INVITE_STYLES[dr.style] || ''));
      if (r.best === n) top.appendChild(UI.chip('おすすめ', 'gold'));
      card.appendChild(top);

      var txt = UI.el('div', 'draft');
      txt.appendChild(UI.el('div', 'txt', dr.text));
      card.appendChild(txt);

      if (dr.why) {
        var w = UI.el('p', 'card-body');
        w.textContent = '効く理由：' + dr.why;
        card.appendChild(w);
      }
      if (dr.risk) {
        // 危うさを隠すと、外したときに理由が分からなくなる
        var rk = UI.el('p', 'card-body risk');
        rk.textContent = '注意：' + dr.risk;
        card.appendChild(rk);
      }

      var acts = UI.el('div', 'card-acts');
      // 写すことと、送ったことにすることは別。押した時点では、まだ送っていない
      var justCopy = UI.el('button', 'ghost small', '文を写す');
      justCopy.type = 'button';
      justCopy.addEventListener('click', function () { copy(dr.text); });
      acts.appendChild(justCopy);

      var use = UI.el('button', 'primary small', '送りました');
      use.type = 'button';
      use.addEventListener('click', function () { recordInvite(dr.text, dr.style); });
      acts.appendChild(use);

      card.appendChild(acts);
      block.appendChild(card);
    });

    if (r.best_reason) block.appendChild(UI.el('p', 'help', 'おすすめの理由：' + r.best_reason));
    if (r.send_timing) block.appendChild(UI.el('p', 'help', '送る頃合い：' + r.send_timing));
    if (r.follow_up) block.appendChild(UI.el('p', 'help', 'お返事が無いとき：' + r.follow_up));

    var again = UI.el('button', 'ghost small full', '別の案を出す');
    again.type = 'button';
    again.addEventListener('click', function () { cur.result = null; generate(); });
    block.appendChild(again);

    body.appendChild(block);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        UI.toast('写しました。LINEに貼ってお送りください');
      }).catch(function () { UI.toast('長押しでコピーしてください', true); });
    } else {
      UI.toast('長押しでコピーしてください', true);
    }
  }

  /**
   * 送ったことを残す。ここが次の精度になる。
   * 狙う日が入っていれば、予定にも「狙う」で立てておく。
   */
  function recordInvite(text, style) {
    Store.addTouch({
      customer_id: cur.customer.id,
      kind: 'line',
      direction: 'sent',
      intent: 'invite',
      style: style || '',
      target_date: cur.target_date || null,
      title: cur.kind === 'douhan' ? '同伴のお誘い' : 'お誘い',
      note: text || ''
    });

    if (cur.target_date && !Store.appointmentsOn(cur.target_date).some(function (a) {
      return a.customer_id === cur.customer.id;
    })) {
      Store.addAppointment({
        date: cur.target_date,
        customer_id: cur.customer.id,
        kind: cur.kind,
        confidence: 'aiming',
        source: 'ai',
        note: 'お誘いを差し上げた'
      });
    }

    Store.clearDailyPlan();
    UI.toast(cur.target_date
      ? 'お誘いを残しました。' + UI.shortDate(cur.target_date) + 'の枠に「狙う」で立てています'
      : 'お誘いを残しました');
    UI.back('board');
    if (UI.current === 'board') Board.render();
    if (UI.current === 'home') Home.refresh();
  }

  function init() {
    document.getElementById('invite-back').addEventListener('click', function () { UI.back('board'); });
  }

  return { init: init, open: open };
})();
