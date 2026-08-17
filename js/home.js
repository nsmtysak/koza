/* Kōza v2 — 今日
 *
 * 開いて最初に見えるのは「今日誰に何をするか」。記録一覧ではない。
 * そしてその「今日」は、今日の売上のためではなく、3日後・5日後の席のためにある。
 */
var Home = (function () {
  'use strict';

  var showAll = false;
  var TOP = 5;

  function refresh() {
    var d = new Date();
    var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    document.getElementById('home-today').textContent =
      (d.getMonth() + 1) + '月' + d.getDate() + '日（' + wd + '）';

    Store.closeStaleAppointments();
    Store.settleOverdueInvites();

    Board.renderProgress(document.getElementById('home-goal'));
    renderAccountTodo();
    renderAskingInvites();
    renderGiftBanner();
    renderGuests();
    renderPlan();
    renderCallList();
    renderRecent();
    renderNag();
  }

  /* ---------- 口座が決まっていない方 ----------
   * 音声・名刺・同席者から自動で作られた方は、口座が分かっていない。
   * 分かるまでは、声かけにも段取りにも一切出さない。
   * ただし黙って隠すと存在ごと忘れられるので、ここで催促する。
   */
  function renderAccountTodo() {
    var host = document.getElementById('home-account');
    var list = Store.unknownAccountCustomers();
    if (!list.length) { host.hidden = true; return; }

    UI.clear(host);
    host.appendChild(UI.el('h3', null, '口座を決めてください（' + list.length + '名）'));
    host.appendChild(UI.el('p', null,
      'どなたの口座か分かるまで、この方々はお声がけの候補に出しません。' +
      'ほかの方のお客様にこちらからご連絡してしまう事故を防ぐためです。'));

    var row = UI.el('div', 'card-tags');
    list.slice(0, 8).forEach(function (c) {
      var b = UI.el('button', 'chip warn', c.display_name);
      b.type = 'button';
      b.addEventListener('click', function () { People.openPerson(c.id, 'profile'); });
      row.appendChild(b);
    });
    if (list.length > 8) row.appendChild(UI.el('span', 'chip', 'ほか' + (list.length - 8) + '名'));
    host.appendChild(row);
    host.hidden = false;
  }

  /* ---------- お返事の確認 ----------
   * 期日が過ぎたお誘いを、勝手に「来なかった」にはしない。
   * 記録が遅れているだけかもしれない。本人に聞いてから数える。
   */
  function renderAskingInvites() {
    var host = document.getElementById('home-asking');
    var list = Store.invitesAwaitingAnswer();
    if (!list.length) { host.hidden = true; return; }

    UI.clear(host);
    host.appendChild(UI.el('h3', null, 'お越しになりましたか（' + list.length + '件）'));
    host.appendChild(UI.el('p', null, 'ここが埋まると、お声がけの効き方が分かるようになります。'));

    var wrap = UI.el('div', 'cards');
    wrap.style.marginTop = '12px';
    list.slice(0, 5).forEach(function (t) {
      var c = Store.getCustomer(t.customer_id);
      if (!c) return;
      var row = UI.el('div', 'gift-row');
      row.appendChild(UI.el('span', 'gname',
        c.display_name + '　' + UI.shortDate(t.date) + 'のお誘い'));
      var yes = UI.el('button', 'ghost small', 'お越しになった');
      yes.type = 'button';
      yes.addEventListener('click', function () { Store.answerInvite(t.id, true); refresh(); });
      var no = UI.el('button', 'ghost small', 'いいえ');
      no.type = 'button';
      no.addEventListener('click', function () { Store.answerInvite(t.id, false); refresh(); });
      row.appendChild(yes); row.appendChild(no);
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
    host.hidden = false;
  }

  /* ---------- 今日お会いする方 ---------- */

  function renderGuests() {
    var block = document.getElementById('home-guests-block');
    var wrap = UI.clear(document.getElementById('home-guests'));
    var guests = Plan.todaysGuests();

    if (!guests.length) { block.hidden = true; return; }
    block.hidden = false;

    guests.forEach(function (g) {
      var c = g.customer;
      var card = UI.el('button', 'card');
      card.type = 'button';

      var top = UI.el('div', 'card-top');
      top.appendChild(UI.avatar(c));
      top.appendChild(UI.el('div', 'card-name', c.display_name));
      top.appendChild(UI.chip(Store.CONFIDENCE[g.appointment.confidence] || '',
        g.appointment.confidence === 'confirmed' ? 'gold' : ''));
      if (g.appointment.kind === 'douhan') top.appendChild(UI.chip('同伴', 'gold'));
      card.appendChild(top);

      // 口座が違う方は、こちらから前に出ない。ここを間違えると信を失う
      if (!Store.isMyAccount(c)) {
        var a = UI.el('p', 'card-body warn-text');
        a.textContent = Store.accountLabel(c) + 'です。係の方を立てて、店内でのお相手に徹します。';
        card.appendChild(a);
      }

      var last = Store.visitsOf(c.id)[0];
      if (last && last.topic_detail) {
        card.appendChild(UI.el('p', 'card-body', '前回：' + last.topic_detail));
      }
      card.appendChild(UI.el('p', 'card-reason', 'お会いする前に、準備を見ておく'));

      card.addEventListener('click', function () { People.openPerson(c.id, 'brief'); });
      wrap.appendChild(card);
    });
  }

  /* ---------- 今日の段取り（AI） ---------- */

  var ACTION = {
    thanks: { label: 'お礼を伝える', cls: 'gold' },
    line:   { label: '連絡する',     cls: 'gold' },
    douhan: { label: '同伴に誘う',   cls: 'gold' },
    store:  { label: '店で話す',     cls: '' },
    gift:   { label: 'ご挨拶を出す', cls: '' }
  };

  function renderPlan() {
    var body = UI.clear(document.getElementById('plan-body'));
    var cached = Store.getDailyPlan();

    if (cached && cached.data) { drawPlan(body, cached.data); return; }

    if (!Api.isConfigured()) {
      body.appendChild(UI.el('p', 'empty', 'AIの接続を入れると、今日どなたに何をするかをここに出します。'));
      return;
    }

    var f = Plan.fillPlan();
    if (!f.chosen.length && !Plan.todaysGuests().length && !Plan.aftercare().length) {
      body.appendChild(UI.el('p', 'empty', '今日は動く先がありません。'));
      return;
    }

    var b = UI.el('button', 'primary full', '今日の段取りを組む');
    b.type = 'button';
    b.addEventListener('click', function () { fetchPlan(); });
    body.appendChild(b);
  }

  function fetchPlan() {
    UI.busy(true, '締め日から逆算しています…');
    Api.weekPlan().then(function (d) {
      UI.busy(false);
      Store.saveDailyPlan(d);
      renderPlan();
    }).catch(function (e) {
      UI.busy(false);
      UI.toast(e.message, true);
    });
  }

  function drawPlan(body, plan) {
    // 深夜・早朝に送らせない。ご家庭のある方には特に響く
    var timeWarn = Plan.sendTimeWarning();
    if (timeWarn && (plan.today || []).some(function (it) { return it.draft; })) {
      var tw = UI.el('div', 'banner-warn');
      tw.appendChild(UI.el('h3', null, 'お送りする時間にご注意ください'));
      tw.appendChild(UI.el('p', null, timeWarn));
      body.appendChild(tw);
    }

    if (plan.headline) {
      var head = UI.el('div', 'brief-summary');
      head.appendChild(UI.el('div', null, plan.headline));
      if (plan.gap_comment) head.appendChild(UI.el('p', 'help', plan.gap_comment));
      if (plan.effort) head.appendChild(UI.el('p', 'help', 'かかる時間の目安：' + plan.effort));
      body.appendChild(head);
    }

    var today = (plan.today || []).filter(function (it) { return Store.getCustomer(it.id); });
    if (today.length) {
      body.appendChild(UI.el('p', 'plan-step', '今日やること'));
      var list = UI.el('div', 'cards');
      today.forEach(function (it, i) { list.appendChild(planCard(it, i + 1)); });
      body.appendChild(list);
    }

    // ここが「今日という日を迎えるための仕事」。日付で書かせている
    var soon = (plan.soon || []).filter(function (it) { return Store.getCustomer(it.id); });
    if (soon.length) {
      body.appendChild(UI.el('p', 'plan-step', 'この先、動く日'));
      var sl = UI.el('div', 'cards');
      soon.forEach(function (it) { sl.appendChild(soonRow(it)); });
      body.appendChild(sl);
    }

    if (!today.length && !soon.length) {
      body.appendChild(UI.el('p', 'empty', '今日は急いで動く必要のある方はいないとのことです。'));
    }

    // 今日はやらない、も出す。判断を省けるのが値打ち
    var skip = (plan.skip || []).filter(function (s) { return Store.getCustomer(s.id); });
    if (skip.length) {
      var det = UI.el('details', 'raw');
      det.appendChild(UI.el('summary', null, '今日は動かなくてよい方（' + skip.length + '名）'));
      var ul = UI.el('div', 'cards');
      ul.style.marginTop = '12px';
      skip.forEach(function (s) {
        var c = Store.getCustomer(s.id);
        var row = UI.el('div', 'gift-row');
        var t = UI.el('span', 'gname', c.display_name + '　' + s.reason);
        t.style.whiteSpace = 'normal';
        t.style.fontSize = '.92rem';
        t.style.color = 'var(--text-dim)';
        row.appendChild(t);
        ul.appendChild(row);
      });
      det.appendChild(ul);
      body.appendChild(det);
    }

    if (plan.note) body.appendChild(UI.el('p', 'help', plan.note));
  }

  function planCard(it, rank) {
    var c = Store.getCustomer(it.id);
    var card = UI.el('div', 'card' + (rank === 1 ? ' focus' : ''));

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.el('span', 'rank', String(rank)));
    top.appendChild(UI.el('div', 'card-name', c.display_name));
    var a = ACTION[it.action] || ACTION.store;
    top.appendChild(UI.chip(a.label, a.cls));
    card.appendChild(top);

    var meta = UI.el('div', 'card-tags');
    if (it.when) meta.appendChild(UI.chip(it.when));
    // これが逆算の見えるところ。何のために今日動くのか
    if (it.target_date) meta.appendChild(UI.chip(UI.shortDate(it.target_date) + 'に来ていただくため', 'gold'));
    if (meta.children.length) card.appendChild(meta);

    card.appendChild(UI.el('p', 'card-reason', it.reason || ''));

    if (it.why_now) {
      var w = UI.el('p', 'card-body');
      w.style.color = 'var(--text-dim)';
      w.textContent = it.why_now;
      card.appendChild(w);
    }

    /* 文を写すことと、送ったことにすることは別。
     * 押した瞬間に「送った」ことにすると、LINEに貼る前に気が変わっても
     * 記録は「送った」まま残り、その方は10日間候補から外れる。
     * 送っていない人が、送ったことにされて放置される。 */
    if (it.draft) {
      var d = UI.el('div', 'draft');
      d.appendChild(UI.el('div', 'txt', it.draft));

      var row = UI.el('div', 'card-acts');
      var copy = UI.el('button', 'ghost small copy', '文を写す');
      copy.type = 'button';
      copy.addEventListener('click', function (ev) {
        ev.stopPropagation();
        copyText(it.draft);
      });
      row.appendChild(copy);

      var sent = UI.el('button', 'primary small', '送りました');
      sent.type = 'button';
      sent.addEventListener('click', function (ev) {
        ev.stopPropagation();
        recordSent(c, it);
      });
      row.appendChild(sent);
      d.appendChild(row);
      card.appendChild(d);
    }

    var acts = UI.el('div', 'card-acts');
    if (it.action === 'line' || it.action === 'douhan') {
      var alt = UI.el('button', 'ghost small', '別の言い方を出す');
      alt.type = 'button';
      alt.addEventListener('click', function () {
        Invite.open(c.id, { target_date: it.target_date, kind: it.action === 'douhan' ? 'douhan' : 'visit' });
      });
      acts.appendChild(alt);
    }
    var open = UI.el('button', 'ghost small', 'この方を見る');
    open.type = 'button';
    open.addEventListener('click', function () { People.openPerson(c.id, 'brief'); });
    acts.appendChild(open);
    card.appendChild(acts);

    return card;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { UI.toast('写しました。LINEに貼ってお送りください'); })
        .catch(function () { UI.toast('長押しでコピーしてください', true); });
    } else {
      UI.toast('長押しでコピーしてください', true);
    }
  }

  /** 実際に送ってから押していただく。ここが埋まらないと次の逆算ができない */
  function recordSent(c, it) {
    var isInvite = it.action === 'line' || it.action === 'douhan';
    Store.addTouch({
      customer_id: c.id,
      kind: 'line',
      direction: 'sent',
      intent: isInvite ? 'invite' : null,
      style: it.style || '',
      target_date: isInvite ? (it.target_date || null) : null,
      title: it.action === 'thanks' ? 'お礼' : (it.action === 'douhan' ? '同伴のお誘い' : 'お誘い'),
      note: it.draft
    });

    if (isInvite && it.target_date &&
        !Store.appointmentsOn(it.target_date).some(function (a) { return a.customer_id === c.id; })) {
      Store.addAppointment({
        date: it.target_date, customer_id: c.id,
        kind: it.action === 'douhan' ? 'douhan' : 'visit',
        confidence: 'aiming', source: 'ai', note: 'お誘いを差し上げた'
      });
    }

    UI.toast('記録しました');
    refresh();
  }

  function soonRow(it) {
    var c = Store.getCustomer(it.id);
    var row = UI.el('div', 'card soon');

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.el('span', 'soon-when', UI.shortDate(it.do_on)));
    top.appendChild(UI.el('div', 'card-name', c.display_name));
    var a = ACTION[it.action] || ACTION.line;
    top.appendChild(UI.chip(a.label));
    row.appendChild(top);

    var line = UI.el('p', 'card-body');
    line.textContent = (it.target_date ? UI.longDate(it.target_date) + 'に来ていただくため　' : '') + (it.reason || '');
    row.appendChild(line);

    return row;
  }

  function renderGiftBanner() {
    var el = document.getElementById('home-gift');
    var tasks = Insight.giftTasks();
    if (!tasks || !tasks.pending.length) { el.hidden = true; return; }

    UI.clear(el);
    el.appendChild(UI.el('h3', null, tasks.season.label + 'の時期です'));
    el.appendChild(UI.el('p', null, 'あと' + tasks.pending.length + '名、まだお出しになっていません'));
    el.hidden = false;
    el.onclick = function () { UI.show('gifts'); Gifts.render(); };
  }

  function renderCallList() {
    var wrap = UI.clear(document.getElementById('call-list'));
    var all = Insight.callList();
    var more = document.getElementById('call-more');

    if (!all.length) {
      wrap.appendChild(UI.el('p', 'empty',
        Store.activeCustomers().length
          ? '今日は急いで声をかける方はいません。'
          : 'お客様を登録すると、ここに声をかける方が出ます。'));
      more.hidden = true;
      return;
    }

    var shown = showAll ? all : all.slice(0, TOP);
    shown.forEach(function (item) { wrap.appendChild(callCard(item)); });

    if (all.length > TOP) {
      more.hidden = false;
      more.textContent = showAll ? '上位だけ表示する' : 'ほかの' + (all.length - TOP) + '名も見る';
    } else {
      more.hidden = true;
    }
  }

  function callCard(item) {
    var card = UI.el('button', 'card');
    card.type = 'button';

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.avatar(item.customer));
    top.appendChild(UI.el('div', 'card-name', item.customer.display_name));
    top.appendChild(UI.chip(item.reason.tag, 'gold'));
    card.appendChild(top);

    // 「なぜ今この人なのか」を必ず1行で
    card.appendChild(UI.el('p', 'card-reason', item.reason.text));

    var meta = [];
    if (item.last_visit) meta.push('前回 ' + UI.shortDate(item.last_visit));
    var money = Store.moneyOf(item.customer.id);
    if (money.total) meta.push('累計 ' + UI.yen(money.total));
    if (item.other_count) meta.push('ほか' + item.other_count + '件');
    if (meta.length) card.appendChild(UI.el('p', 'card-body', meta.join('　/　')));

    card.addEventListener('click', function () { People.openPerson(item.customer.id, 'brief'); });
    return card;
  }

  function renderRecent() {
    var wrap = UI.clear(document.getElementById('recent-list'));
    var visits = Store.listVisits().slice(0, 3);

    if (!visits.length) {
      wrap.appendChild(UI.el('p', 'empty', 'まだ来歴がありません。右下のボタンから残せます。'));
      return;
    }

    visits.forEach(function (v) {
      var card = UI.el('button', 'card');
      card.type = 'button';

      var names = (v.attendees || []).map(function (a) {
        var c = Store.getCustomer(a.customer_id);
        return c ? c.display_name : null;
      }).filter(Boolean);

      var top = UI.el('div', 'card-top');
      top.appendChild(UI.el('div', 'card-name', names.join('・') || '（お名前なし）'));
      top.appendChild(UI.el('span', 'card-meta', UI.shortDate(v.date)));
      card.appendChild(top);

      if (v.topic_detail || v.observation) {
        card.appendChild(UI.el('p', 'card-body', v.topic_detail || v.observation));
      }

      var tags = UI.el('div', 'card-tags');
      if (v.douhan) tags.appendChild(UI.chip('同伴', 'gold'));
      if (v.kirikaeshi) tags.appendChild(UI.chip('切り返し', 'warn'));
      if (typeof v.spend === 'number' && v.spend > 0) tags.appendChild(UI.chip(UI.yen(v.spend)));
      if (!v.ai_structured) tags.appendChild(UI.chip('未整理'));
      if (tags.children.length) card.appendChild(tags);

      card.addEventListener('click', function () { Record.openEdit(v.id); });
      wrap.appendChild(card);
    });
  }

  function renderNag() {
    var nag = document.getElementById('export-nag');
    if (Store.exportOverdue()) {
      nag.hidden = false;
      nag.textContent = '書き出しから1週間以上経っています。設定から書き出しておくと、機種変更でも記録が残ります。';
    } else {
      nag.hidden = true;
    }
  }

  function init() {
    document.getElementById('call-more').addEventListener('click', function () {
      showAll = !showAll;
      renderCallList();
    });
    document.getElementById('plan-refresh').addEventListener('click', function () {
      if (!Api.isConfigured()) { UI.toast('AIの接続が必要です', true); return; }
      Store.clearDailyPlan();
      fetchPlan();
    });
  }

  return { init: init, refresh: refresh };
})();
