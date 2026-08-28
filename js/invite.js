/* Kōza v2 — 話のきっかけ
 *
 * **文は出さない。**
 *
 * ここは以前「お誘いの文を3案つくる」画面だった。その形はやめた。
 *
 * 理由は二つある。
 *
 * 一つ。文を書かせると、機械の内側にあるものが必ず漏れる。
 *   一度目　同伴の条件が文面に混ざった
 *   二度目　こちらの空き枠から逆算した日付が、二十本すべての文末に入った
 * 穴を一つずつ塞いでも三度目が来る。**渡さないものは漏れない。**
 *
 * 二つ。現場が、この形を否定していた。
 *   「コピペしたような文章で誰にでも当てはまる内容を送るとブロックされる率が高かった」
 *   「来てくれる人は普段ラインはあまりしない」
 * 文を量産する道具は、現場の失敗そのものだった。
 *
 * だからこの画面が出すのは、**何から話しかけられるか**だけ。
 * 言い回しも、日取りも、締めの一言も出さない。そこからは本人の仕事である。
 * 彼女には十七年分の付き合いがあり、機械には無い。
 *
 * 送ったことは接点として残り、来店したかどうかで決着する。
 * その決着が、次の逆算（リードタイム・お越しになる割合）の材料になる。
 */
var Invite = (function () {
  'use strict';

  var cur = null;      // { customer, target_date, kind, result }

  function open(customerId, opts) {
    opts = opts || {};
    var c = Store.getCustomer(customerId);
    if (!c) { UI.toast('お客様が見つかりません', true); return; }

    // ほかの方の口座には、この画面そのものを開かせない
    if (!Store.canContactDirectly(c)) {
      UI.toast(Store.accountLabel(c) + 'です。こちらからのお誘いはしません', true);
      return;
    }

    cur = {
      customer: c,
      target_date: opts.target_date || '',
      kind: opts.kind === 'douhan' ? 'douhan' : 'visit',
      result: null,
      sent: null      // 残した直後だけ入る。取り消しに使う
    };

    document.getElementById('invite-title').textContent = c.display_name + 'への話のきっかけ';

    UI.show('invite');
    render();
  }

  function render() {
    var body = UI.clear(document.getElementById('invite-body'));
    if (!cur) return;

    /* 送ってよい相手か・送ってよい時間か。ここは何より先に出す */
    var guard = Plan.contactGuard(cur.customer.id);
    if (!guard.ok) {
      var g = UI.el('div', 'banner-warn');
      g.appendChild(UI.el('h3', null, '間を置いたほうがよい方です'));
      g.appendChild(UI.el('p', null, guard.reason +
        '。重ねてお送りすると、しつこいという印象だけが残ります。'));
      body.appendChild(g);
    }
    /* 止めはしない。事実だけ置いて、動くかどうかは本人が決める */
    var notes = Plan.contactNotes(cur.customer.id);
    if (notes.length) {
      var nb = UI.el('div', 'block');
      nb.appendChild(UI.el('h3', 'sect', '知っておいていただきたいこと'));
      var nl = UI.el('ul', 'plain');
      notes.forEach(function (t) { nl.appendChild(UI.el('li', null, t)); });
      nb.appendChild(nl);
      body.appendChild(nb);
    }

    body.appendChild(facts());
    body.appendChild(openHooks());

    /* きっかけ。ここだけがAIの仕事 */
    if (!cur.result) {
      if (!Api.isConfigured()) {
        body.appendChild(UI.el('p', 'empty',
          'AIの接続を入れると、どれから切り出すのが自然かを並べ替えられます。'));
      } else {
        var b = UI.el('button', 'primary full', '話のきっかけを挙げてもらう');
        b.type = 'button';
        b.addEventListener('click', generate);
        body.appendChild(b);
      }
    } else {
      drawResult(body, cur.result);
    }

    body.appendChild(recordBlock());
  }

  /* ---------- この方について分かっていること ----------
   * ここは端末の中だけで組める。AIは要らず、速く、費用もかからない。 */
  function facts() {
    var d = Insight.digest(cur.customer.id);
    var lead = Plan.leadTime(cur.customer.id, cur.kind);
    var rate = Plan.comeRate(cur.customer.id);

    var wrap = UI.el('div', 'brief-summary');
    var lines = [];

    if (d && d.visit_count) {
      lines.push(d.visit_count + '回目のお付き合いです' +
        (d.days_since !== null ? '。前回から' + d.days_since + '日' : ''));
    }
    lines.push('お声がけから平均 ' + lead.days + '日でお越しになります' +
      (lead.samples < 2 ? '（記録が少ないため目安です）' : '（記録' + lead.samples + '件）'));
    if (rate.samples >= 2) {
      lines.push('お誘いしてお越しになった割合は ' + Math.round(rate.rate * 100) +
        '%です（' + rate.came + '／' + rate.samples + '）');
    }
    var sv = Plan.selfVisitRate(cur.customer.id);
    if (sv.total >= 3) {
      lines.push('お声がけなしでのご来店は ' + sv.self + '／' + sv.total + '回です' +
        // 半分より多ければ、送らなくてもいらっしゃる方。手数は別の方に使える
        (sv.self * 2 > sv.total ? '（ご自分でいらっしゃる方です）' : ''));
    }

    lines.forEach(function (t) { wrap.appendChild(UI.el('div', null, t)); });
    return wrap;
  }

  /* ---------- 記録から拾った、まだ閉じていない話 ----------
   * AIを呼ばなくても、ここまでは出ている。 */
  function openHooks() {
    var hooks = Insight.digest(cur.customer.id).open_hooks;
    var block = UI.el('div', 'block');
    if (!hooks.length) {
      block.appendChild(UI.el('p', 'help',
        'この方の会話の記録がまだありません。記録が増えるほど、きっかけはその方だけのものになります。'));
      return block;
    }
    block.appendChild(UI.el('h3', 'sect', '記録に残っている、続きのある話'));
    var ul = UI.el('ul', 'plain');
    hooks.slice(0, 6).forEach(function (h) { ul.appendChild(UI.el('li', null, h.text)); });
    block.appendChild(ul);
    return block;
  }

  function generate() {
    UI.busy(true, '記録を読んでいます…', {
      estimate: Store.estimateMs('hooks', 9000),
      steps: ['前回までのお話を拾っています…', '切り出しやすい順に並べています…']
    });
    Api.hooks(cur.customer.id)
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
    block.appendChild(UI.aiNote('hooks'));

    var starters = r.starters || [];
    if (!starters.length) {
      block.appendChild(UI.el('p', 'empty',
        r.note || '記録からは、いま切り出せる題材が見つかりませんでした。'));
    } else {
      block.appendChild(UI.el('h3', 'sect', '話のきっかけ'));
    }

    starters.forEach(function (s, i) {
      var n = i + 1;
      var card = UI.el('div', 'card' + (r.best === n ? ' is-best' : ''));

      var top = UI.el('div', 'card-top');
      top.appendChild(UI.el('div', 'card-name', s.topic || ''));
      if (r.best === n) top.appendChild(UI.chip('いちばん自然', 'gold'));
      card.appendChild(top);

      if (s.basis) {
        var ba = UI.el('p', 'card-body whole');
        ba.textContent = s.basis;
        card.appendChild(ba);
      }
      if (s.why) {
        var w = UI.el('p', 'card-body whole');
        w.textContent = s.why;
        card.appendChild(w);
      }
      block.appendChild(card);
    });

    /* 触れないほうがよいこと。ここを外すと一度で信を失う */
    if ((r.avoid || []).length) {
      var av = UI.el('div', 'banner-warn');
      av.appendChild(UI.el('h3', null, '触れないほうがよいこと'));
      (r.avoid || []).forEach(function (a) {
        av.appendChild(UI.el('p', null, a.topic + ' ── ' + a.reason));
      });
      block.appendChild(av);
    }

    if (starters.length && r.note) block.appendChild(UI.el('p', 'help', r.note));

    var again = UI.el('button', 'ghost small full', 'もう一度挙げてもらう');
    again.type = 'button';
    again.addEventListener('click', function () { cur.result = null; generate(); });
    block.appendChild(again);

    body.appendChild(block);
  }

  /* ---------- 送ったことを残す ----------
   *
   * 型は選ばせない。文を書かなくなった以上、型は残しても使い道がない。
   * 残すのは「いつ・誰に送ったか」と「狙う日」だけ。
   * ここが次の逆算（リードタイム・お越しになる割合）の材料になる。
   */
  function recordBlock() {
    var wrap = UI.el('details', 'raw');
    wrap.appendChild(UI.el('summary', null, 'お送りしたら、ここに残す'));

    /* 残したあとは、画面を閉じずにここへ結果を出す。
     * 以前は残した瞬間に前の画面へ戻していたので、
     * 押し間違いに気づいたときには戻る先が無かった。 */
    if (cur.sent) {
      wrap.open = true;
      var done = UI.el('div', 'block');
      done.appendChild(UI.el('p', null, cur.sent.appointment_id
        ? '残しました。' + UI.shortDate(cur.sent.date) + 'の枠に「お返事待ち」で立てています'
        : '残しました'));
      var un = UI.el('button', 'ghost small undo', '取り消す');
      un.type = 'button';
      un.addEventListener('click', function () {
        Store.undoSent(cur.sent);
        cur.sent = null;
        UI.toast('取り消しました');
        render();
      });
      done.appendChild(un);
      var back = UI.el('button', 'ghost small', '枠に戻る');
      back.type = 'button';
      back.addEventListener('click', function () {
        UI.back('board');
        if (UI.current === 'board') Board.render();
        if (UI.current === 'home') Home.refresh();
      });
      done.appendChild(back);
      wrap.appendChild(done);
      return wrap;
    }

    var form = UI.el('div', 'form');
    form.appendChild(UI.el('p', 'help',
      '送った事実だけを残します。これが次の「お声がけから何日で来ていただけるか」になります。'));

    /* 狙う日は本人の段取り。お客様に出す日ではない */
    var f = UI.el('label', 'f');
    f.appendChild(UI.el('span', null, 'お越しいただけたら、と思う日（任意）'));
    var d = UI.el('input');
    d.type = 'date';
    d.value = cur.target_date;
    d.addEventListener('change', function () { cur.target_date = d.value; });
    f.appendChild(d);
    f.appendChild(UI.el('span', 'help', 'ご自分の予定に「お返事待ち」で立てるためのものです。相手にお伝えする日ではありません。'));
    form.appendChild(f);

    var kf = UI.el('div', 'f');
    kf.appendChild(UI.el('span', null, 'どちらのお話でしたか'));
    kf.appendChild(UI.segmented(
      [{ value: 'visit', label: 'ご来店' }, { value: 'douhan', label: '同伴' }],
      cur.kind, function (v) { cur.kind = v; }));
    form.appendChild(kf);

    var ta = UI.el('textarea');
    ta.rows = 3;
    ta.placeholder = '送った文（覚えのために。空でも構いません）';
    form.appendChild(ta);

    var mb = UI.el('button', 'primary small', '送ったことを残す');
    mb.type = 'button';
    mb.addEventListener('click', function () { recordInvite(ta.value.trim()); });
    form.appendChild(mb);

    wrap.appendChild(form);
    return wrap;
  }

  /**
   * 送ったことを残す。ここが次の精度になる。
   * 狙う日が入っていれば、予定にも「狙う」で立てておく。
   */
  function recordInvite(text) {
    cur.sent = Store.recordSent({
      customer_id: cur.customer.id,
      intent: 'invite',
      target_date: cur.target_date || null,
      kind: cur.kind,
      source: 'manual',
      title: cur.kind === 'douhan' ? '同伴のお誘い' : 'お誘い',
      note: text || ''
    });

    // 画面は閉じない。取り消せる先を残しておく
    UI.toast('残しました');
    render();
  }

  function init() {
    document.getElementById('invite-back').addEventListener('click', function () { UI.back('board'); });
  }

  return { init: init, open: open };
})();
