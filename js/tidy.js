/* Kōza v2 — 整理
 *
 * 深夜に入れた卓を、AIが組み立て直す。
 *
 * 前の版は「1卓ずつ確認画面」だった。確認画面を消したのではなく、朝へ動かしただけ。
 * 5卓なら朝に14項目の画面を5回。25卓たまれば誰も押さない。
 * 押さない督促が毎朝いちばん上に出続けるのが、いちばん人を遠ざける。
 *
 * だからここは、
 *   - 全部まとめてAIに投げ、結果を**一覧で**見せる
 *   - 「全部これでよい」を1回押せば終わり
 *   - おかしい卓だけタップして直す
 *   - **整理せずに確定にする逃げ道も用意する**（整理は必須ではない）
 */
var Tidy = (function () {
  'use strict';

  var results = [];   // [{ visit, data, error, take }]
  var busy = false;

  function open() {
    var pending = Record.pending();
    if (!pending.length) { UI.toast('整理するものはありません'); return; }

    results = pending.map(function (v) { return { visit: v, data: null, error: null, take: true }; });
    UI.show('tidy');
    render();

    if (Api.isConfigured()) run();
  }

  /* ---------- AIにまとめて投げる ---------- */

  function run() {
    if (busy) return;
    busy = true;
    var i = 0;

    function step() {
      // 未処理の先頭を探す
      while (i < results.length && (results[i].data || results[i].error)) i++;
      if (i >= results.length) { busy = false; render(); return; }

      var r = results[i];
      setProgress('整理しています…（' + (i + 1) + ' / ' + results.length + '）');

      Api.structure(r.visit.raw_memo || r.visit.topic_detail || '')
        .then(function (d) { r.data = d; })
        .catch(function (e) { r.error = e.message; })
        .then(function () { render(); step(); });
    }
    step();
  }

  function setProgress(text) {
    var el = document.getElementById('tidy-progress');
    el.textContent = text || '';
    el.hidden = !text;
  }

  /* ---------- 画面 ---------- */

  function render() {
    var body = UI.clear(document.getElementById('tidy-body'));
    var done = results.filter(function (r) { return r.data || r.error; }).length;

    if (!Api.isConfigured()) {
      var n = UI.el('div', 'banner-warn');
      n.appendChild(UI.el('h3', null, 'AIの接続がありません'));
      n.appendChild(UI.el('p', null, '中身の組み立てはできませんが、記録はすでに残っています。下のボタンで確定にできます。'));
      body.appendChild(n);
    }

    if (Api.isConfigured()) body.appendChild(UI.aiNote('content'));

    results.forEach(function (r, i) { body.appendChild(cardFor(r, i)); });

    var act = UI.el('div', 'actions col');

    var take = results.filter(function (r) { return r.take && r.data; }).length;
    var all = UI.el('button', 'primary',
      take ? '全部これでよい（' + take + '卓）' : '確定にする（' + results.length + '卓）');
    all.type = 'button';
    all.disabled = busy;
    all.addEventListener('click', approveAll);
    act.appendChild(all);

    // 逃げ道。整理は必須ではない
    var skip = UI.el('button', 'ghost', '整理しないまま確定にする');
    skip.type = 'button';
    skip.addEventListener('click', function () {
      if (!UI.confirmAsk('AIの組み立てを使わず、入力したままで確定にします。\n記録は残ります。よろしいですか。')) return;
      results.forEach(function (r) { Store.updateVisit(r.visit.id, { ai_structured: true }); });
      finish('確定にしました');
    });
    act.appendChild(skip);

    act.appendChild(UI.el('p', 'help',
      '整理しなくても、お名前・金額・同伴・一言はすでに残っています。' +
      '整理でできるのは、ご家族や趣味の書き足しと、次のご来店の拾い出しです。'));

    body.appendChild(act);
    setProgress(busy ? '整理しています…（' + done + ' / ' + results.length + '）' : '');
  }

  function cardFor(r, i) {
    var v = r.visit;
    var card = UI.el('div', 'card tidy-card' + (r.take ? '' : ' is-off'));

    var top = UI.el('div', 'card-top');

    var cb = UI.el('input');
    cb.type = 'checkbox';
    cb.className = 'tidy-cb';
    cb.checked = r.take;
    cb.disabled = !r.data;
    cb.addEventListener('change', function () { r.take = cb.checked; render(); });
    top.appendChild(cb);

    var names = (v.attendees || []).map(function (a) {
      var c = Store.getCustomer(a.customer_id);
      return c ? c.display_name : '';
    }).filter(Boolean);
    top.appendChild(UI.el('div', 'card-name',
      (names.join('・') || '（お名前なし）') + '　' + UI.shortDate(v.date)));
    if (typeof v.spend === 'number' && v.spend > 0) {
      top.appendChild(UI.el('span', 'card-meta', UI.yen(v.spend)));
    }
    card.appendChild(top);

    if (!r.data && !r.error) {
      card.appendChild(UI.el('p', 'card-body', busy ? '待っています…' : '—'));
      return card;
    }
    if (r.error) {
      var e = UI.el('p', 'card-body');
      e.style.color = 'var(--danger)';
      e.textContent = '組み立てられませんでした（' + r.error + '）。入力したままで残ります。';
      card.appendChild(e);
      return card;
    }

    var d = r.data;
    if (d.topic_detail) card.appendChild(UI.el('p', 'talk', d.topic_detail));

    // 拾ったものを短く。詳しくは開いて直す
    var picked = [];
    (d.hooks || []).forEach(function (h) { picked.push('口実：' + h.text); });
    (d.appointments || []).forEach(function (a) {
      if (a.date) picked.push('次の予定：' + UI.shortDate(a.date) + (a.kind === 'douhan' ? '・同伴' : ''));
    });
    (d.profile_updates || []).forEach(function (u) {
      var bits = (u.interests || []).concat((u.family || []).map(function (f) { return f.relation; }));
      if (bits.length) picked.push('書き足し：' + bits.join('、'));
    });

    if (picked.length) {
      var box = UI.el('div', 'hook-box');
      picked.slice(0, 5).forEach(function (t) { box.appendChild(UI.el('div', 'hook-i', '・' + t)); });
      card.appendChild(box);
    }

    var acts = UI.el('div', 'card-acts');
    var edit = UI.el('button', 'ghost small', 'この卓を直す');
    edit.type = 'button';
    edit.addEventListener('click', function () { Record.openTidyOne(v, d, backFromEdit(i)); });
    acts.appendChild(edit);
    card.appendChild(acts);

    return card;
  }

  /**
   * その話がどなたのものか。名前が返ってきたときだけ、席にいる方から探す。
   * **見つからなければ null。**取り違えるより、取りこぼすほうがよい。
   */
  function hookOwner(h, attendees) {
    var nm = (h.customer || '').trim();
    if (!nm) return null;
    var m = Store.matchCustomer({ display_name: nm, name: nm });
    if (!m) return null;
    var here = (attendees || []).some(function (a) { return a.customer_id === m.id; });
    return here ? m.id : null;
  }

  /** 1卓だけ直したあと、一覧に戻る */
  function backFromEdit(i) {
    return function () {
      results.splice(i, 1);
      if (!results.length) { finish('整理が終わりました'); return; }
      UI.show('tidy');
      render();
    };
  }

  /* ---------- 取り込む ---------- */

  function approveAll() {
    var n = 0;
    results.forEach(function (r) {
      if (r.take && r.data) { apply(r.visit, r.data); n += 1; }
      else Store.updateVisit(r.visit.id, { ai_structured: true });
    });
    finish(n ? n + '卓ぶん取り込みました' : '確定にしました');
  }

  /**
   * AIの結果を来歴に当てる。
   * **深夜に本人が入れた事実（金額・同伴・ボトル・セット・日付）は上書きしない。**
   * AIが読み違えても、本人の入力が勝つ。
   */
  function apply(v, d) {
    var attendees = (v.attendees || []).slice();
    var known = {};
    attendees.forEach(function (a) { known[a.customer_id] = true; });

    (d.customers || []).forEach(function (c) {
      var nm = (c.name || '').trim();
      if (!nm) return;
      var m = Store.matchCustomer({ display_name: nm, name: nm, company: c.company });
      var id = m ? m.id : Store.createCustomer({
        name: nm,
        display_name: /(様|さん)$/.test(nm) ? nm.replace(/さん$/, '様') : nm + '様',
        company: c.company || '',
        first_met: v.date
      }).id;
      if (known[id]) return;
      known[id] = true;
      attendees.push({ customer_id: id, role: c.role === 'doukousha' ? 'doukousha' : 'shukyaku' });
    });

    Store.updateVisit(v.id, {
      attendees: attendees,
      topics: d.topics || v.topics,
      topic_detail: d.topic_detail || v.topic_detail,
      // 話にお店が出ていれば拾う。深夜に入れた分（予定からの引き継ぎ）は上書きしない
      douhan_place: v.douhan_place || d.douhan_place || '',
      place_by: v.place_by || d.place_by || '',
      drinks: (d.drinks || []).length ? d.drinks : v.drinks,
      hooks: (d.hooks || []).map(function (h) {
        return { text: h.text, type: h.type, status: 'open', by: h.by || '',
                 customer_id: hookOwner(h, attendees) };
      }),
      next_visit_hint: d.next_visit_hint && d.next_visit_hint.timing ? d.next_visit_hint : v.next_visit_hint,
      ai_structured: true
    });

    // 同席者が後から付いた卓でも、お誘いと予定が決着するようにする
    Store.settleVisit(v.id);

    // プロフィールへの書き足し
    (d.profile_updates || []).forEach(function (u) {
      var nm = (u.customer || '').trim();
      var m = nm ? Store.matchCustomer({ display_name: nm, name: nm }) : null;
      var id = m ? m.id : (attendees[0] || {}).customer_id;
      if (!id) return;
      Store.enrichCustomer(id, u);
    });

    // 次のご来店
    (d.appointments || []).forEach(function (a) {
      if (!a || !a.date) return;
      var nm = (a.customer || '').trim();
      var m = nm ? Store.matchCustomer({ display_name: nm, name: nm }) : null;
      var id = m ? m.id : (attendees[0] || {}).customer_id;
      if (!id) return;
      if (Store.appointmentsOn(a.date).some(function (x) { return x.customer_id === id; })) return;
      Store.addAppointment({
        date: a.date, customer_id: id,
        kind: a.kind === 'douhan' ? 'douhan' : 'visit',
        confidence: a.confidence === 'confirmed' ? 'confirmed' : 'verbal',
        source: 'voice', note: a.note || ''
      });
    });
  }

  function finish(msg) {
    results = [];
    busy = false;
    Store.clearDailyPlan();
    UI.show('home', { replace: true });
    Home.refresh();
    UI.toast(msg);
  }

  function init() {
    document.getElementById('tidy-back').addEventListener('click', function () {
      if (busy) { UI.toast('整理の途中です。少しお待ちください', true); return; }
      results = [];
      UI.back('home');
      Home.refresh();
    });
  }

  return { init: init, open: open };
})();
