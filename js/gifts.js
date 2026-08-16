/* Kōza v2 — 贈答とご挨拶
 * 年賀状・お中元・お歳暮を「出した／まだ」で潰していく。
 * 時期でないときは、直近の接点を振り返る場所として使う。
 */
var Gifts = (function () {
  'use strict';

  function render() {
    var body = UI.clear(document.getElementById('gift-body'));
    var tasks = Insight.giftTasks();

    if (tasks) {
      var head = UI.el('div', 'gift-head');
      head.appendChild(UI.el('h2', null, tasks.season.label + 'の時期です'));
      head.appendChild(UI.el('p', null,
        '出す予定の方 ' + (tasks.pending.length + tasks.done.length) + '名のうち、' +
        tasks.done.length + '名にお出し済みです。'));
      body.appendChild(head);

      if (tasks.pending.length) {
        var s = UI.el('div', 'brief-sec');
        s.appendChild(UI.el('h3', null, 'まだの方'));
        var list = UI.el('div', 'cards');
        tasks.pending.forEach(function (c) {
          list.appendChild(giftRow(c, tasks.season, false));
        });
        s.appendChild(list);
        body.appendChild(s);
      }

      if (tasks.done.length) {
        var d = UI.el('div', 'brief-sec');
        d.appendChild(UI.el('h3', null, 'お出し済み'));
        var dl = UI.el('div', 'cards');
        tasks.done.forEach(function (c) {
          dl.appendChild(giftRow(c, tasks.season, true));
        });
        d.appendChild(dl);
        body.appendChild(d);
      }
    } else {
      var none = UI.el('div', 'gift-head');
      none.appendChild(UI.el('h2', null, '今は贈答の時期ではありません'));
      none.appendChild(UI.el('p', null,
        '年賀状は12月から、お中元は6月半ばから、お歳暮は11月からここに出ます。'));
      body.appendChild(none);
    }

    renderYearGrid(body);
    renderRecent(body);
  }

  function giftRow(c, season, done) {
    var row = UI.el('div', 'gift-row' + (done ? ' done' : ''));

    var name = UI.el('span', 'gname', c.display_name + (c.company ? '（' + c.company + '）' : ''));
    name.style.cursor = 'pointer';
    name.addEventListener('click', function () { People.openPerson(c.id); });
    row.appendChild(name);

    var btn = UI.el('button', null, done ? '取り消す' : '出した');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (done) {
        var t = Store.touchesOf(c.id).filter(function (x) {
          return x.kind === season.kind && x.date.slice(0, 4) === String(season.year);
        })[0];
        if (t) Store.deleteTouch(t.id);
      } else {
        Store.addTouch({ customer_id: c.id, kind: season.kind, direction: 'sent',
          date: Store.today(), title: season.label });
      }
      render();
    });
    row.appendChild(btn);
    return row;
  }

  /** 年ごとの実施状況。誰に何年出したかが一目で分かる */
  function renderYearGrid(body) {
    var years = {};
    Store.listTouches().forEach(function (t) {
      if (['nenga', 'ochugen', 'oseibo'].indexOf(t.kind) < 0) return;
      var y = t.date.slice(0, 4);
      years[y] = years[y] || { nenga: 0, ochugen: 0, oseibo: 0 };
      years[y][t.kind] += 1;
    });
    var keys = Object.keys(years).sort().reverse();
    if (!keys.length) return;

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, 'これまでの実績'));
    var kv = UI.el('div', 'kv');
    keys.forEach(function (y) {
      var row = UI.el('div', 'kv-row');
      row.appendChild(UI.el('span', 'kv-k', y + '年'));
      var parts = [];
      if (years[y].nenga) parts.push('年賀状 ' + years[y].nenga + '名');
      if (years[y].ochugen) parts.push('お中元 ' + years[y].ochugen + '名');
      if (years[y].oseibo) parts.push('お歳暮 ' + years[y].oseibo + '名');
      row.appendChild(UI.el('span', 'kv-v', parts.join('　/　')));
      kv.appendChild(row);
    });
    s.appendChild(kv);
    body.appendChild(s);
  }

  function renderRecent(body) {
    var touches = Store.listTouches().slice(0, 12);
    if (!touches.length) return;

    var s = UI.el('div', 'brief-sec');
    s.appendChild(UI.el('h3', null, '最近の接点'));
    var list = UI.el('div', 'cards');
    touches.forEach(function (t) {
      var c = Store.getCustomer(t.customer_id);
      if (!c) return;
      var row = UI.el('div', 'gift-row');
      row.appendChild(UI.el('span', 'gname',
        UI.shortDate(t.date) + '　' + c.display_name + '　' + (Store.TOUCH_KINDS[t.kind] || t.kind)));
      var open = UI.el('button', null, '開く');
      open.type = 'button';
      open.style.background = 'transparent';
      open.style.borderColor = 'var(--ink-3)';
      open.style.color = 'var(--text-faint)';
      open.addEventListener('click', function () { People.openPerson(c.id, 'touch'); });
      row.appendChild(open);
      list.appendChild(row);
    });
    s.appendChild(list);
    body.appendChild(s);
  }

  return { render: render };
})();
