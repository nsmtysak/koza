/* Kōza v2 — 会う前の準備（AI）
 *
 * 螺旋の要はここ。
 *   これまでの来歴 → 準備 → 実際に会う → 結果を記録 → 次の準備に効く
 * 結果を記録しないと、次の準備が前と同じものになる。だから必ず聞く。
 */
var Brief = (function () {
  'use strict';

  var currentId = null;

  function generate(customerId, purpose) {
    if (!Api.isConfigured()) {
      UI.toast('AIの接続が必要です。設定から入れてください', true);
      return;
    }
    UI.busy(true, purpose === 'contact' ? '連絡の言葉を考えています…' : '前回までを読み返しています…');

    Api.brief(customerId, purpose).then(function (d) {
      UI.busy(false);
      var b = Store.addBrief({
        customer_id: customerId,
        based_on_visits: Store.visitsOf(customerId).slice(0, 6).map(function (v) { return v.id; }),
        summary: d.summary || '',
        talk_points: d.talk_points || [],
        confirm_points: d.confirm_points || [],
        cautions: d.cautions || [],
        hospitality: d.hospitality || [],
        offer: d.offer || [],
        trust_risks: d.trust_risks || [],
        seed_questions: d.seed_questions || [],
        message_drafts: d.message_drafts || [],
        timing: d.timing || ''
      });
      show(b.id);
    }).catch(function (err) {
      UI.busy(false);
      UI.toast(err.message, true);
    });
  }

  function show(briefId) {
    var b = Store.getBrief(briefId);
    if (!b) { UI.toast('準備が見つかりません', true); return; }
    currentId = briefId;

    var c = Store.getCustomer(b.customer_id);
    document.getElementById('brief-title').textContent = c ? c.display_name + 'に会う前に' : '会う前に';

    var body = UI.clear(document.getElementById('brief-body'));

    // 口座が違う方は、まずそこを断る。ここを見落とすと係の方の顔をつぶす
    if (c && !Store.isMyAccount(c)) {
      var acc = UI.el('div', 'banner-warn');
      acc.appendChild(UI.el('h3', null, Store.accountLabel(c)));
      acc.appendChild(UI.el('p', null, c.account_owner === 'free'
        ? 'フリーのお客様です。店内でのお相手から、場内でのご指名につなげます。'
        : 'こちらからご連絡は差し上げません。係の方を立てて、店内でのお相手に徹します。'));
      body.appendChild(acc);
    }

    if (b.summary) {
      body.appendChild(UI.el('div', 'brief-summary', b.summary));
    }

    // 今日その席でする手当て。次があるかは、ここで決まる
    section(body, '今日して差し上げること', b.hospitality, 'hosp');
    renderOffer(body, b);
    section(body, '話せること', b.talk_points);
    section(body, '確かめたいこと', b.confirm_points);
    renderSeeds(body, b);
    section(body, '信を落としかねないこと', b.trust_risks, 'caution');
    section(body, '気をつけること', b.cautions, 'caution');

    if (b.timing) {
      var t = UI.el('div', 'brief-sec');
      t.appendChild(UI.el('h3', null, 'お声がけの頃合い'));
      var ul = UI.el('ul', 'brief-list');
      ul.appendChild(UI.el('li', null, b.timing));
      t.appendChild(ul);
      body.appendChild(t);
    }

    if ((b.message_drafts || []).length) {
      var m = UI.el('div', 'brief-sec');
      m.appendChild(UI.el('h3', null, 'お送りする言葉の案'));
      b.message_drafts.forEach(function (d) {
        var box = UI.el('div', 'draft');
        box.appendChild(UI.el('div', 'tone', d.tone || ''));
        box.appendChild(UI.el('div', 'txt', d.text || ''));
        var copy = UI.el('button', 'ghost small copy', 'この文をコピー');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(d.text).then(function () { UI.toast('コピーしました'); })
              .catch(function () { UI.toast('長押しでコピーしてください', true); });
          } else {
            UI.toast('長押しでコピーしてください', true);
          }
        });
        box.appendChild(copy);
        m.appendChild(box);
      });
      body.appendChild(m);
    }

    renderOutcome(body, b);

    var act = UI.el('div', 'actions col');
    var rec = UI.el('button', 'primary', 'この方の来歴を記録する');
    rec.type = 'button';
    rec.addEventListener('click', function () {
      Record.open({ prefill: (c ? c.display_name : '') + 'が', brief_id: b.id });
    });
    act.appendChild(rec);

    var toPerson = UI.el('button', 'ghost', 'お客様のページへ');
    toPerson.type = 'button';
    toPerson.addEventListener('click', function () { People.openPerson(b.customer_id); });
    act.appendChild(toPerson);

    body.appendChild(act);
    UI.show('brief');
  }

  function section(parent, title, items, cls) {
    if (!items || !items.length) return;
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, title));
    var ul = UI.el('ul', 'brief-list');
    items.forEach(function (it) {
      var text = typeof it === 'string' ? it : (it.text || '');
      var why = (typeof it === 'object' && it.basis) ? it.basis : '';
      var li = UI.el('li', cls || null);
      li.appendChild(document.createTextNode(text));
      if (why) {
        var small = UI.el('p', 'help');
        small.style.marginTop = '7px';
        small.textContent = '← ' + why;
        li.appendChild(small);
      }
      ul.appendChild(li);
    });
    s.appendChild(ul);
    parent.appendChild(s);
  }

  /**
   * さりげなくお勧めできるもの。
   * 売上は組数×単価。組数だけ追っても届かない。
   * ただし押し売りにした瞬間に口座が離れるので、理由が書けないものは出さない。
   */
  function renderOffer(parent, b) {
    var items = b.offer || [];
    if (!items.length) return;

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'ご用意できるもの'));
    s.appendChild(UI.el('p', 'help', 'お好みと、これまでのお会計から出しています。無理にお勧めするものではありません。'));

    var ul = UI.el('ul', 'brief-list');
    items.forEach(function (o) {
      var li = UI.el('li', 'offer');
      li.appendChild(UI.el('div', 'seed-q', o.what || ''));
      if (o.how) {
        var h = UI.el('p', 'seed-why');
        h.textContent = '言い方：' + o.how;
        li.appendChild(h);
      }
      if (o.why) {
        var w = UI.el('p', 'help');
        w.style.marginTop = '6px';
        w.textContent = '← ' + o.why;
        li.appendChild(w);
      }
      ul.appendChild(li);
    });
    s.appendChild(ul);
    parent.appendChild(s);
  }

  /**
   * 仕込む質問。
   *
   * 次のご来店をつくれるのは、お会いしている今この時だけ。
   * 今日聞いておかなかったことは、次にご連絡するときの「手ぶら」になって返ってくる。
   * だから質問と一緒に、それが何の口実になるのかを必ず出す。
   */
  function renderSeeds(parent, b) {
    var items = b.seed_questions || [];
    if (!items.length) return;

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '席で伺っておくこと'));
    s.appendChild(UI.el('p', 'help', 'ここで日付を聞けると、次にご連絡する口実になります。'));

    var ul = UI.el('ul', 'brief-list');
    items.forEach(function (q) {
      var li = UI.el('li', 'seed');
      li.appendChild(UI.el('div', 'seed-q', '「' + (q.question || '') + '」'));
      if (q.intent) {
        var p = UI.el('p', 'seed-why');
        p.textContent = '→ ' + q.intent;
        li.appendChild(p);
      }
      if (q.basis) {
        var sm = UI.el('p', 'help');
        sm.style.marginTop = '6px';
        sm.textContent = '← ' + q.basis;
        li.appendChild(sm);
      }
      ul.appendChild(li);
    });
    s.appendChild(ul);
    parent.appendChild(s);
  }

  /** 提案が効いたかを聞く。ここを飛ばすと次回も同じ提案が出る */
  function renderOutcome(parent, b) {
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'この準備はどうでしたか'));

    if (b.outcome && b.outcome.rating) {
      var done = UI.el('p', 'help',
        '「' + ({ 1: '外していた', 2: 'まあまあ', 3: '役に立った' })[b.outcome.rating] + '」と記録しています。');
      s.appendChild(done);
    }

    s.appendChild(UI.segmented(
      [{ value: 3, label: '役に立った' }, { value: 2, label: 'まあまあ' }, { value: 1, label: '外していた' }],
      b.outcome ? b.outcome.rating : null,
      function (v) {
        Store.recordOutcome(b.id, Object.assign({}, b.outcome || {}, { rating: v }));
        UI.toast('次の準備に反映します');
      }
    ));

    var note = UI.el('textarea');
    note.rows = 2;
    note.placeholder = '違っていたところがあれば（次の準備が良くなります）';
    note.value = (b.outcome && b.outcome.note) || '';
    note.style.marginTop = '10px';
    note.addEventListener('change', function () {
      Store.recordOutcome(b.id, Object.assign({}, b.outcome || {}, { note: note.value }));
    });
    s.appendChild(note);

    parent.appendChild(s);
  }

  function init() {
    document.getElementById('brief-back').addEventListener('click', function () { UI.back('home'); });
  }

  return { init: init, generate: generate, show: show };
})();
