/* Kōza v2 — 覚えておくこと（分野の手引き）
 *
 * **会話は、聞くだけでは相手の記憶に残らない。**
 *
 *   「へぇー、そうなんですね」しか返せない相手に、人は二度目を話さない。
 *   深く伺うには、こちらがある程度知っている必要がある。
 *   知らない人間には、そもそも踏み込んだ問いが作れないからである。
 *
 * だからこの画面が出すのは、**本人が読んで覚えるもの**。
 * お客様に向けた言葉でも、その方についての推測でもない。
 *
 * ここだけは、お客様の記録をAIに送らない。送るのは分野の名前だけ。
 * 記録を使うのは「どの分野を先に勉強するか」を決めるところだけである。
 *   - 出力は一般知識なので、**その方について作り話をする余地が構造的に無い**
 *   - お客様に届く文でもないので、内側のものが漏れる経路も無い
 *
 * そして**知ったかぶりを勧めない。**
 * 効くのは知識をひけらかすことではなく、深いところを尋ねられること。
 * お客様に教える立場に回った瞬間、その方がここへ来る理由が消える。
 */
var Study = (function () {
  'use strict';

  var current = null;   // いま開いている分野名。null なら一覧

  function open(topic) {
    current = topic || null;
    document.getElementById('study-title').textContent =
      current ? current + 'のこと' : '覚えておくこと';
    UI.show('study');
    render();
  }

  function render() {
    var body = UI.clear(document.getElementById('study-body'));
    if (current) drawOne(body, current);
    else drawList(body);
  }

  /* ---------- 一覧 ----------
   * 50人ぶんの趣味を全部さらうことはできない。だから順番をつける。
   * 近くお会いする方の分野が先、次に人数の多い分野。 */
  function drawList(body) {
    var topics = Store.studyTopics();

    body.appendChild(UI.el('p', 'lede-sm',
      'お客様の趣味やご関心から並べています。' +
      '知っていれば、その場で一歩踏み込んで伺えます。'));

    if (!topics.length) {
      body.appendChild(UI.el('p', 'empty',
        'まだご趣味の記録がありません。お客様のプロフィールに入れると、ここに並びます。'));
      return;
    }

    var wrap = UI.el('div', 'cards');
    topics.forEach(function (t) {
      var card = UI.el('button', 'card');
      card.type = 'button';

      var top = UI.el('div', 'card-top');
      top.appendChild(UI.el('div', 'card-name', t.topic));
      // 「近く会う」だけだと、ほとんどの分野に付いて印にならない。数で出す
      if (t.soon) top.appendChild(UI.chip('近く' + t.soon + '名', 'gold'));
      if (t.study) top.appendChild(UI.chip('用意済み'));
      card.appendChild(top);

      var names = t.people.slice(0, 4).map(function (c) { return c.display_name; }).join('、');
      card.appendChild(UI.el('p', 'card-body',
        t.people.length + '名　' + names + (t.people.length > 4 ? ' ほか' : '')));

      card.addEventListener('click', function () { open(t.topic); });
      wrap.appendChild(card);
    });
    body.appendChild(wrap);
  }

  /* ---------- 1つの分野 ---------- */
  function drawOne(body, topic) {
    var back = UI.el('button', 'ghost small', '← ほかの分野');
    back.type = 'button';
    back.addEventListener('click', function () { open(null); });
    body.appendChild(back);

    var people = Store.activeCustomers().filter(function (c) {
      return (c.interests || []).indexOf(topic) >= 0;
    });
    if (people.length) {
      body.appendChild(UI.el('p', 'help',
        'この分野に関心のある方：' + people.map(function (c) { return c.display_name; }).join('、')));
    }

    var s = Store.getStudy(topic);
    if (!s) {
      if (!Api.isConfigured()) {
        body.appendChild(UI.el('p', 'empty', 'AIの接続を入れると、ここに手引きを用意できます。'));
        return;
      }
      body.appendChild(UI.el('p', 'help',
        'この分野について、席で使えるところだけをまとめます。'));
      var b = UI.el('button', 'primary full', '手引きを用意する');
      b.type = 'button';
      b.addEventListener('click', function () { generate(topic); });
      body.appendChild(b);
      return;
    }

    body.appendChild(UI.aiNote('content'));

    /* いちばん大事なものを先に出す。
     * 用語から並べると、読み終わる前に画面を閉じられる。 */
    sec(body, '一歩踏み込んで伺う', s.questions, function (q) {
      var li = UI.el('li');
      li.appendChild(UI.el('div', 'seed-q', q.ask || ''));
      if (q.why) {
        var w = UI.el('p', 'seed-why');
        w.textContent = q.why;
        li.appendChild(w);
      }
      return li;
    }, '「お好きなんですか」で終わらせないための問いです。答えから次が続きます。');

    sec(body, 'いま何が起きているか', s.now, function (n) {
      var li = UI.el('li');
      li.appendChild(UI.el('div', null, n.text || ''));
      if (n.asof) {
        var a = UI.el('p', 'seed-why');
        a.textContent = n.asof;
        li.appendChild(a);
      }
      return li;
    }, 'AIが覚えている範囲です。日が経っていることがあるので、確かめてからお使いください。');

    sec(body, 'これだけは押さえる', s.basics, function (t) {
      var li = UI.el('li');
      li.appendChild(UI.el('div', 'seed-q', t.term || ''));
      var m = UI.el('p', 'seed-why');
      m.textContent = t.meaning || '';
      li.appendChild(m);
      return li;
    }, '知らないと話が止まるものだけです。');

    if ((s.pitfalls || []).length) {
      var pf = UI.el('div', 'banner-warn');
      pf.appendChild(UI.el('h3', null, '間違えると恥をかくこと'));
      s.pitfalls.forEach(function (p) {
        pf.appendChild(UI.el('p', null, p.dont + ' ── ' + p.why));
      });
      body.appendChild(pf);
    }

    if (s.deeper) {
      var d = UI.el('div', 'brief-sec');
      d.appendChild(UI.el('h3', null, 'もっと知りたくなったら'));
      d.appendChild(UI.el('p', 'card-body whole', s.deeper));
      body.appendChild(d);
    }

    /* 知ったかぶりをさせない。ここを外すと、この機能は毒になる */
    body.appendChild(UI.el('p', 'help',
      'お客様に教える側に回らないでください。' +
      '知っているのは、深いところを伺うためです。' +
      'ご存じない話は、そのまま伺うほうが喜ばれます。'));

    var acts = UI.el('div', 'card-acts');
    var again = UI.el('button', 'ghost small', '作り直す');
    again.type = 'button';
    again.addEventListener('click', function () {
      if (!UI.confirmAsk(topic + 'の手引きを作り直します。よろしいですか。')) return;
      generate(topic);
    });
    acts.appendChild(again);

    var del = UI.el('button', 'ghost small', '消す');
    del.type = 'button';
    del.addEventListener('click', function () {
      if (!UI.confirmAsk(topic + 'の手引きを消します。よろしいですか。')) return;
      Store.removeStudy(topic);
      render();
    });
    acts.appendChild(del);
    body.appendChild(acts);

    if (s.created_at) {
      body.appendChild(UI.el('p', 'help', UI.shortDate(s.created_at.slice(0, 10)) + 'に用意したものです。'));
    }
  }

  function sec(body, title, items, make, note) {
    if (!(items || []).length) return;
    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, title));
    if (note) s.appendChild(UI.el('p', 'help', note));
    var ul = UI.el('ul', 'brief-list');
    items.forEach(function (it) { ul.appendChild(make(it)); });
    s.appendChild(ul);
    body.appendChild(s);
  }

  function generate(topic) {
    /* 記録から拾える具体を渡す。どこを厚く書くかの手がかりにするだけで、
     * 出力にそのまま出させない（プロンプト側でも禁じている）。 */
    var known = [];
    Store.activeCustomers().forEach(function (c) {
      if ((c.interests || []).indexOf(topic) < 0) return;
      Store.visitsOf(c.id).slice(0, 3).forEach(function (v) {
        var t = (v.topic_detail || '');
        if (t && t.indexOf(topic) >= 0 && known.length < 8) known.push(t.slice(0, 120));
      });
    });

    UI.busy(true, topic + 'のことを調べています…', {
      estimate: Store.estimateMs('study', 20000),
      steps: ['いま何が起きているかを見ています…', '伺える問いを考えています…']
    });
    Api.study(topic, known)
      .then(function (d) {
        UI.busy(false);
        Store.saveStudy(topic, d);
        render();
      })
      .catch(function (e) {
        UI.busy(false);
        UI.toast(e.message, true);
      });
  }

  function init() {
    document.getElementById('study-back').addEventListener('click', function () {
      if (current) { open(null); return; }
      UI.back('people');
    });
  }

  return { init: init, open: open };
})();
