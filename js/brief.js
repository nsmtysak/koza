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
    UI.busy(true, purpose === 'contact' ? '連絡の言葉を考えています…' : '前回までを読み返しています…', {
      estimate: Store.estimateMs('brief', 16000),
      steps: [
        'これまでの来歴を読み返しています…',
        'お好みと、お会計の運びを見ています…',
        '席で伺っておくことを考えています…',
        'まとめています…'
      ]
    });

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
        meal: d.meal || null,
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

    body.appendChild(UI.aiNote('content'));

    if (b.summary) {
      body.appendChild(UI.el('div', 'brief-summary', b.summary));
    }

    // 今日その席でする手当て。次があるかは、ここで決まる
    section(body, '今日して差し上げること', b.hospitality, 'hosp');
    renderOffer(body, b);
    renderMeal(body, b);
    section(body, '話せること', b.talk_points);
    section(body, '確かめたいこと', b.confirm_points);
    renderSeeds(body, b);
    section(body, '信を落としかねないこと', b.trust_risks, 'caution');
    renderCautions(body, b);

    if (b.timing) {
      var t = UI.el('div', 'brief-sec');
      t.appendChild(UI.el('h3', null, 'お声がけの頃合い'));
      var ul = UI.el('ul', 'brief-list');
      ul.appendChild(UI.el('li', null, b.timing));
      t.appendChild(ul);
      body.appendChild(t);
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
   * 気をつけること。
   *
   * 「健康の数値には触れない」「お会計のことは口にしない」——
   * こういう当たり前が上に並ぶと、その方だけの大事な一つが読み飛ばされる。
   *   「これを読んで気づく人は現場にいないほうがいい」（8年目の評価より）
   * だから、この方だからのものだけを開いて、基本は畳んでおく。
   * 畳むのであって、消すのではない。1年目には教科書として値打ちがある。
   */
  function renderCautions(parent, b) {
    var all = b.cautions || [];
    if (!all.length) return;

    var personal = all.filter(function (x) { return (x && x.scope) !== 'basic'; });
    var basic = all.filter(function (x) { return (x && x.scope) === 'basic'; });

    section(parent, '気をつけること', personal, 'caution');

    if (!basic.length) return;
    var det = UI.el('details', 'raw');
    det.appendChild(UI.el('summary', null, 'どなたにも当てはまる基本（' + basic.length + '件）'));
    var ul = UI.el('ul', 'brief-list');
    ul.style.marginTop = '12px';
    basic.forEach(function (x) {
      ul.appendChild(UI.el('li', 'caution', typeof x === 'string' ? x : (x.text || '')));
    });
    det.appendChild(ul);
    parent.appendChild(det);
  }

  /**
   * お食事にお誘いするなら、どういうお店か。
   *
   * **ジャンルの多数決を出さない。**「鮨が3回だから次も鮨」は、
   * 記録を見ているのではなく数えているだけで、その方に飽きられる。
   * 出すのは**共通している軸**（カウンター、静か、ご主人と話せる）。
   * 軸が読めれば、毎回違うお店をお出ししても外れない。
   *
   * そして**お店の名前はここで出さない。** 店は入れ替わる。
   * 実際に探すのは、ウェブで調べる別の仕事にしてある。
   */
  function renderMeal(parent, b) {
    var m = b.meal;
    if (!m || (!m.axis && !m.next && !m.ask)) return;

    var c = Store.getCustomer(b.customer_id);
    var p = c ? Store.placesOf(c.id) : null;

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'お食事にお誘いするなら'));

    if (m.axis) {
      var ax = UI.el('p', 'card-body whole');
      ax.textContent = m.axis;
      s.appendChild(ax);
      if (m.basis) s.appendChild(UI.el('p', 'help', m.basis));
    }

    var ul = UI.el('ul', 'brief-list');
    if (m.next) {
      var li = UI.el('li');
      li.appendChild(UI.el('div', 'seed-q', '次にお誘いするなら'));
      li.appendChild(UI.el('p', 'seed-why', m.next));
      ul.appendChild(li);
    }
    if (m.avoid) {
      var la = UI.el('li');
      la.appendChild(UI.el('div', 'seed-q', '避けること'));
      la.appendChild(UI.el('p', 'seed-why', m.avoid));
      ul.appendChild(la);
    }
    if (m.ask) {
      var lq = UI.el('li');
      lq.appendChild(UI.el('div', 'seed-q', 'まだ読み切れないこと'));
      lq.appendChild(UI.el('p', 'seed-why', m.ask));
      ul.appendChild(lq);
    }
    if (ul.children.length) s.appendChild(ul);

    /* 記録そのもの。AIの読みが外れていないか、本人が確かめられるように */
    if (p && (p.by_guest.length || p.recent.length)) {
      var det = UI.el('details', 'raw');
      det.appendChild(UI.el('summary', null, 'これまでのお店'));
      if (p.by_guest.length) {
        det.appendChild(UI.el('p', 'help', 'お客様が選ばれたお店：' +
          p.by_guest.map(function (x) { return x.place + (x.times > 1 ? '（' + x.times + '回）' : ''); }).join('、')));
      }
      if (p.by_self.length) {
        det.appendChild(UI.el('p', 'help', 'こちらでお選びしたお店：' +
          p.by_self.map(function (x) { return x.place; }).join('、')));
      }
      if (p.recent.length) {
        det.appendChild(UI.el('p', 'help', '直近：' +
          p.recent.map(function (x) { return x.place; }).join('、')));
      }
      s.appendChild(det);
    }

    /* ここから先は、実際にウェブで探す。記憶で店名を出すと閉店した店を案内してしまう */
    if (c && Api.isConfigured()) {
      var find = UI.el('button', 'ghost small', 'この筋でお店を探す');
      find.type = 'button';
      find.addEventListener('click', function () { findPlaces(c.id, m.axis || ''); });
      s.appendChild(find);
      s.appendChild(UI.el('p', 'help',
        'お食事のあとご一緒にお店へ向かえる範囲で、いま開いているお店を実際に調べます。'));
    }

    parent.appendChild(s);
  }

  /** 探した結果は、その場に出す。保存はしない（お店は入れ替わるため） */
  function findPlaces(customerId, axis) {
    UI.busy(true, 'お店を調べています…', {
      estimate: Store.estimateMs('places', 40000),
      steps: ['この筋のお店を探しています…', 'いま開いているか確かめています…']
    });
    Api.places(customerId, axis)
      .then(function (d) {
        UI.busy(false);
        showPlaces(d);
      })
      .catch(function (e) {
        UI.busy(false);
        UI.toast(e.message, true);
      });
  }

  function showPlaces(d) {
    var host = document.getElementById('brief-body');
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '調べたお店'));

    var list = d.places || [];
    if (!list.length) {
      s.appendChild(UI.el('p', 'empty', d.note || '確かめられるお店が見つかりませんでした。'));
      host.appendChild(s);
      return;
    }

    list.forEach(function (x) {
      var card = UI.el('div', 'card');
      var top = UI.el('div', 'card-top');
      top.appendChild(UI.el('div', 'card-name', x.name || ''));
      if (x.kind) top.appendChild(UI.chip(x.kind));
      card.appendChild(top);
      if (x.where) card.appendChild(UI.el('p', 'card-body', x.where));
      if (x.why) card.appendChild(UI.el('p', 'card-body whole', x.why));
      if (x.note) card.appendChild(UI.el('p', 'help', x.note));
      // 調べたものは古いことがある。予約の前に必ず確かめていただく
      if (x.check) card.appendChild(UI.el('p', 'help', '確かめること：' + x.check));
      s.appendChild(card);
    });

    if (d.note) s.appendChild(UI.el('p', 'help', d.note));
    s.appendChild(UI.el('p', 'help',
      'ウェブで調べたものです。**閉まっていることもあります。**お約束の前に必ずお確かめください。'.replace(/\*\*/g, '')));
    host.appendChild(s);
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    s.appendChild(UI.el('p', 'help',
      'ここで日付を聞けると、次にご連絡する口実になります。' +
      '全部は使いません。流れに乗ったものを一つだけ。'));

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
