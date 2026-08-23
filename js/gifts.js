/* Kōza v2 — 記念日
 *
 * 前は「贈答」だけの画面だった。年賀状・お中元・お歳暮は年に3回。
 * 年3回の仕事のために、毎日見るタブを1つ取られていた。
 *
 * この仕事でいちばん売れる日はお客様のお誕生日で、しかも**1か月前から仕込む**。
 * 花もケーキも席の組み方も、10日前では間に合わない。
 * だからここは「今月と来月の記念日」を先に出し、贈答はその下に置く。
 */
var Gifts = (function () {
  'use strict';

  /** MM-DD を取り出す。YYYY-MM-DD でも MM-DD でも受ける */
  function md(v) {
    var m = String(v || '').match(/(\d{1,2})-(\d{1,2})$/);
    return m ? { m: parseInt(m[1], 10), d: parseInt(m[2], 10) } : null;
  }

  /**
   * ご家族の呼び方。
   * 続柄はもともと「奥様」「お母様」のように様が付いている。
   * そこへ機械的に様を足すと「奥様様」になる。贈答の宛名に出る名前なので、ここは崩せない。
   */
  function familyLabel(c, f) {
    var nm = (f.name || '').trim();
    if (!nm) return c.display_name + 'の' + f.relation;
    if (!/(様|さん)$/.test(nm)) nm += '様';
    return nm + '（' + c.display_name + 'の' + f.relation + '）';
  }

  /** その月の記念日を集める。お誕生日・ご家族・初めてお越しいただいた日 */
  function anniversariesIn(month) {
    var out = [];
    /* ご事情でお越しになれない方も、記念日とご挨拶は続ける。
     * 来られないことと、関係が切れたことは別である。
     * 区切りがついた方だけ、ここから外れる。 */
    Store.activeCustomers().filter(Store.keepsGreeting).forEach(function (c) {
      var b = md(c.birthday);
      if (b && b.m === month) {
        out.push({ customer: c, day: b.d, kind: 'お誕生日', who: c.display_name });
      }
      (c.family || []).forEach(function (f) {
        var fb = md(f.birthday);
        if (fb && fb.m === month) {
          out.push({ customer: c, day: fb.d, kind: 'お誕生日', who: familyLabel(c, f) });
        }
      });
      var fm = md(c.first_met);
      if (fm && fm.m === month && c.first_met && c.first_met.length === 10) {
        var years = new Date().getFullYear() - parseInt(c.first_met.slice(0, 4), 10);
        if (years >= 1) {
          out.push({ customer: c, day: fm.d, kind: years + '周年', who: c.display_name });
        }
      }
    });
    return out.sort(function (a, b) { return a.day - b.day; });
  }

  function renderAnniversaries(body) {
    var now = new Date();
    var thisM = now.getMonth() + 1;
    var nextM = thisM === 12 ? 1 : thisM + 1;

    [[thisM, '今月'], [nextM, '来月']].forEach(function (pair) {
      var list = anniversariesIn(pair[0]);
      var sec = UI.el('div', 'brief-sec');
      sec.appendChild(UI.el('h3', null, pair[1] + '（' + pair[0] + '月）の記念日　' + list.length + '件'));

      if (!list.length) {
        sec.appendChild(UI.el('p', 'empty', 'ありません。'));
        body.appendChild(sec);
        return;
      }

      var wrap = UI.el('div', 'cards');
      list.forEach(function (x) {
        var card = UI.el('button', 'card');
        card.type = 'button';
        var top = UI.el('div', 'card-top');
        top.appendChild(UI.el('span', 'soon-when', pair[0] + '/' + x.day));
        top.appendChild(UI.el('div', 'card-name', x.who));
        top.appendChild(UI.chip(x.kind, x.kind === 'お誕生日' ? 'gold' : ''));
        card.appendChild(top);
        if (x.customer.company) card.appendChild(UI.el('p', 'card-body', x.customer.company));
        card.addEventListener('click', function () { People.openPerson(x.customer.id, 'brief'); });
        wrap.appendChild(card);
      });
      sec.appendChild(wrap);
      if (pair[1] === '来月') {
        sec.appendChild(UI.el('p', 'help',
          'お花もケーキも席の組み方も、1か月前から仕込みます。ここで先に見ておいてください。'));
      }
      body.appendChild(sec);
    });
  }

  function render() {
    var body = UI.clear(document.getElementById('gift-body'));

    // 記念日が先。贈答は年3回なので下に置く
    renderAnniversaries(body);

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
      none.appendChild(UI.el('h2', null, '贈答（今は時期ではありません）'));
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
