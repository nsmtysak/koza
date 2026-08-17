/* Kōza v2 — 枠（盤面と逆算）
 *
 * 「今日誰に声をかけるか」の前に、「どの日が空いているか」を見せる。
 * 空いている日が見えないと、先に手を打つ理由が生まれない。
 */
var Board = (function () {
  'use strict';

  var editing = null;      // 編集中の予定
  var draft = null;        // 入力途中の値

  /* ---------- 進捗 ---------- */

  function renderProgress(node) {
    var p = Plan.progress();
    var wrap = UI.clear(node || document.getElementById('board-progress'));

    if (!p.goal.sales) {
      var note = UI.el('div', 'goalbar empty-goal');
      note.appendChild(UI.el('p', null, '月の目標を入れると、締め日から逆算して動けます。'));
      var b = UI.el('button', 'ghost small', '目標を決める');
      b.type = 'button';
      b.addEventListener('click', function () { Nav.goto('settings'); });
      note.appendChild(b);
      wrap.appendChild(note);
      return p;
    }

    var box = UI.el('div', 'goalbar');

    var head = UI.el('div', 'goal-head');
    head.appendChild(UI.el('span', 'goal-period', p.period.label));
    head.appendChild(UI.el('span', 'goal-left', 'あと' + p.days_left + '日'));
    box.appendChild(head);

    // 実績 → 見込み → 目標。3色で「どこまで来ているか」を1本で見せる
    var bar = UI.el('div', 'bar');
    var a = UI.el('span', 'bar-actual');
    var b2 = UI.el('span', 'bar-booked');
    a.style.width = Math.min(100, p.actual / p.goal.sales * 100) + '%';
    b2.style.width = Math.min(100 - Math.min(100, p.actual / p.goal.sales * 100),
      p.booked / p.goal.sales * 100) + '%';
    bar.appendChild(a); bar.appendChild(b2);
    box.appendChild(bar);

    var nums = UI.el('div', 'goal-nums');
    [['実績', p.actual], ['予定の見込み', p.booked], ['このままの着地', p.forecast], ['目標', p.goal.sales]]
      .forEach(function (pair) {
        var c = UI.el('div', 'goal-num');
        c.appendChild(UI.el('span', 'k', pair[0]));
        c.appendChild(UI.el('span', 'v', UI.yen(pair[1])));
        nums.appendChild(c);
      });
    box.appendChild(nums);

    if (p.gap > 0) {
      var g = UI.el('p', 'goal-gap');
      g.textContent = '不足 ' + UI.yen(p.gap) +
        (p.need_visits ? '　あと' + p.need_visits + '組ほど' : '');
      box.appendChild(g);
    } else {
      box.appendChild(UI.el('p', 'goal-ok', '今の予定のままで目標に届く見込みです'));
    }

    if (p.douhan.target) {
      box.appendChild(UI.el('p', 'help',
        '同伴 ' + p.douhan.done + ' / ' + p.douhan.target + ' 回' +
        (p.douhan.booked ? '（予定 ' + p.douhan.booked + '回）' : '')));
    }

    wrap.appendChild(box);
    return p;
  }

  /* ---------- 14日の盤面 ---------- */

  function renderDays() {
    var wrap = UI.clear(document.getElementById('board-days'));
    var days = Plan.board(Plan.HORIZON);
    var period = Store.periodOf(Store.today());
    var shownClose = false;

    days.forEach(function (d) {
      // 締め日をまたぐところに線を入れる。ここから先は今月に効かない
      if (!shownClose && !d.in_period) {
        shownClose = true;
        var sep = UI.el('div', 'board-sep', period.label + 'の締め　ここから先は来月分');
        wrap.appendChild(sep);
      }

      var row = UI.el('button', 'board-row' + (d.empty ? ' is-empty' : '') + (d.offset === 0 ? ' is-today' : ''));
      row.type = 'button';

      var dl = UI.el('div', 'bd-date');
      dl.appendChild(UI.el('span', 'bd-d', String(parseInt(d.date.slice(8), 10))));
      dl.appendChild(UI.el('span', 'bd-w' + (d.weekday === '日' ? ' sun' : d.weekday === '土' ? ' sat' : ''), d.weekday));
      row.appendChild(dl);

      var mid = UI.el('div', 'bd-mid');
      // 休みの日でも、入っている予定は必ず出す。消すと取りこぼす
      if (!d.open) mid.appendChild(UI.el('span', 'bd-off', d.closed_reason || '休み'));
      if (d.items.length) {
        d.items.forEach(function (x) {
          var t = UI.el('span', 'bd-item ' + x.appointment.confidence);
          t.textContent = (x.customer ? x.customer.display_name : '（未定）') +
            (x.appointment.kind === 'douhan' ? '・同伴' : '');
          mid.appendChild(t);
        });
      } else if (d.open) {
        mid.appendChild(UI.el('span', 'bd-empty', '空き'));
      }
      row.appendChild(mid);

      var right = UI.el('div', 'bd-right');
      if (d.expected) right.appendChild(UI.el('span', 'bd-yen', UI.yen(d.expected)));
      row.appendChild(right);

      // 日をタップしたら、その日に何があるかを見せる。いきなり入力画面にしない
      row.addEventListener('click', function () { openDay(d.date); });
      wrap.appendChild(row);
    });
  }

  /* ---------- 埋める候補 ---------- */

  var URGENCY = {
    late:  { label: '締切を過ぎています', cls: 'warn' },
    today: { label: '今日が締切', cls: 'gold' },
    soon:  { label: '', cls: '' }
  };

  function renderCandidates() {
    var wrap = UI.clear(document.getElementById('board-candidates'));
    var list = Plan.candidates(12);

    if (!list.length) {
      wrap.appendChild(UI.el('p', 'empty',
        Store.activeCustomers().length
          ? 'いま声をかける先がありません。予定が入っている方は候補から外れます。'
          : 'お客様を登録すると、ここに候補が出ます。'));
      return;
    }

    list.forEach(function (x) { wrap.appendChild(candidateCard(x)); });

    // 「なぜこの方が出ていないのか」が分からないと、勝手に別で連絡してしまう
    var held = Plan.heldBack();
    if (held.length) {
      var det = UI.el('details', 'raw');
      det.appendChild(UI.el('summary', null, '今は間を置く方（' + held.length + '名）'));
      var box = UI.el('div', 'cards');
      box.style.marginTop = '12px';
      held.forEach(function (h) {
        var row = UI.el('div', 'gift-row');
        var t = UI.el('span', 'gname', h.customer.display_name + '　' + h.reason);
        t.style.whiteSpace = 'normal';
        t.style.fontSize = '.92rem';
        t.style.color = 'var(--text-dim)';
        row.appendChild(t);
        box.appendChild(row);
      });
      det.appendChild(box);
      wrap.appendChild(det);
    }
  }

  function candidateCard(x) {
    var card = UI.el('div', 'card cand');

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.avatar(x.customer));
    top.appendChild(UI.el('div', 'card-name', x.customer.display_name));
    var u = URGENCY[x.urgency];
    if (u.label) top.appendChild(UI.chip(u.label, u.cls));
    card.appendChild(top);

    // ここが逆算の中身。1行で言い切る
    var line = UI.el('p', 'card-reason');
    line.textContent = UI.longDate(x.target_date) + 'に来ていただくなら、' +
      (x.urgency === 'today' ? '今日' :
        x.urgency === 'late' ? '本来は' + UI.shortDate(x.contact_by) + 'が締切。今日動くしかありません' :
          UI.shortDate(x.contact_by) + 'まで') +
      (x.urgency === 'late' ? '' : 'にお声がけ');
    card.appendChild(line);

    var meta = [];
    meta.push('お声がけから平均' + x.lead.days + '日' +
      (x.lead.samples < 2 ? '（記録が少ないため目安）' : ''));
    if (x.come_rate.samples >= 2) meta.push('お越しになる割合 ' + Math.round(x.come_rate.rate * 100) + '%');
    if (x.expected_spend) meta.push('見込み ' + UI.yen(x.expected_spend));
    card.appendChild(UI.el('p', 'card-body', meta.join('　/　')));

    if (x.reason) {
      var r = UI.el('p', 'card-body');
      r.style.color = 'var(--gold)';
      r.textContent = x.reason.text;
      card.appendChild(r);
    }

    if (x.hooks.length) {
      var h = UI.el('p', 'card-body');
      h.style.color = 'var(--text-dim)';
      h.textContent = '口実：' + x.hooks.slice(0, 2).join('／');
      card.appendChild(h);
    }

    var acts = UI.el('div', 'card-acts');

    var inv = UI.el('button', 'primary small', 'お誘いの文を作る');
    inv.type = 'button';
    inv.addEventListener('click', function () {
      Invite.open(x.customer.id, { target_date: x.target_date, kind: 'visit' });
    });
    acts.appendChild(inv);

    var dou = UI.el('button', 'ghost small', '同伴で誘う');
    dou.type = 'button';
    dou.addEventListener('click', function () {
      Invite.open(x.customer.id, { target_date: x.target_date, kind: 'douhan' });
    });
    acts.appendChild(dou);

    var per = UI.el('button', 'ghost small', 'この方を見る');
    per.type = 'button';
    per.addEventListener('click', function () { People.openPerson(x.customer.id, 'brief'); });
    acts.appendChild(per);

    card.appendChild(acts);
    return card;
  }

  function render() {
    Store.closeStaleAppointments();
    Store.settleOverdueInvites();
    renderProgress();
    renderDays();
    renderCandidates();
  }

  /* ---------- その日 ----------
   * 盤面の日をタップしたときに開く。
   * 「その日に誰がお見えになるか」を見るのが主で、予定を足すのは従。
   * 臨時の休みもここで決める（設定画面に置くと、盤面を見ながら決められない）。
   */

  var dayDate = null;

  function openDay(date) {
    dayDate = date;
    document.getElementById('day-title').textContent = UI.longDate(date);
    UI.show('day');
    renderDay();
  }

  function renderDay() {
    var body = UI.clear(document.getElementById('day-body'));
    var date = dayDate;
    var closed = Holiday.closedReason(date);
    var apts = Store.appointmentsOn(date);
    var isTemp = (Store.getProfile().closed_dates || []).indexOf(date) >= 0;

    if (closed) {
      var b = UI.el('div', 'banner-warn');
      b.appendChild(UI.el('h3', null, closed === '休み' ? '臨時の休みにしています' : closed));
      b.appendChild(UI.el('p', null, closed === '休み'
        ? 'この日は枠として数えていません。'
        : 'この日は枠として数えていません。設定の「お店の休み」で変えられます。'));
      body.appendChild(b);
    }

    /* お見えになる方。複数でも全部並べる */
    var sec = UI.el('div', 'brief-sec');
    sec.appendChild(UI.el('h3', null, apts.length
      ? 'この日にお見えになる方（' + apts.length + '組）'
      : 'この日の予定'));

    if (!apts.length) {
      sec.appendChild(UI.el('p', 'empty', 'まだ予定がありません。'));
    } else {
      var list = UI.el('div', 'cards');
      apts.forEach(function (a) {
        list.appendChild(dayCard(a));
      });
      sec.appendChild(list);
    }
    body.appendChild(sec);

    /* この日の見込み */
    if (apts.length) {
      var day = Plan.board(Plan.HORIZON).filter(function (d) { return d.date === date; })[0];
      if (day && day.expected) {
        body.appendChild(UI.el('p', 'help', 'この日の見込み ' + UI.yen(day.expected) + '（確からしさで割り引いた額）'));
      }
    }

    var act = UI.el('div', 'actions col');

    var add = UI.el('button', 'primary', 'この日に予定を入れる');
    add.type = 'button';
    add.addEventListener('click', function () { openAppt({ date: date }); });
    act.appendChild(add);

    // 臨時の休み。盤面を見ながら決められるように、ここに置いてある
    var toggle = UI.el('button', 'ghost', isTemp ? '営業日に戻す' : 'この日を臨時の休みにする');
    toggle.type = 'button';
    toggle.addEventListener('click', function () {
      var cur = (Store.getProfile().closed_dates || []).slice();
      if (isTemp) {
        cur = cur.filter(function (v) { return v !== date; });
      } else {
        if (apts.length && !UI.confirmAsk(
          'この日には' + apts.length + '組の予定が入っています。\n休みにしても予定は消えませんが、枠としては数えなくなります。\n\nよろしいですか。')) return;
        cur.push(date);
      }
      Store.saveProfile({ closed_dates: cur });
      Store.clearDailyPlan();
      UI.toast(isTemp ? '営業日に戻しました' : '臨時の休みにしました');
      renderDay();
    });
    act.appendChild(toggle);

    body.appendChild(act);
  }

  function dayCard(a) {
    var c = a.customer_id ? Store.getCustomer(a.customer_id) : null;
    var card = UI.el('div', 'card');

    var top = UI.el('div', 'card-top');
    if (c) top.appendChild(UI.avatar(c));
    top.appendChild(UI.el('div', 'card-name', c ? c.display_name : '（お名前未定）'));
    top.appendChild(UI.chip(Store.CONFIDENCE[a.confidence] || '',
      a.confidence === 'confirmed' ? 'gold' : ''));
    if (a.kind === 'douhan') top.appendChild(UI.chip('同伴', 'gold'));
    card.appendChild(top);

    if (c) {
      var sub = [];
      if (c.company) sub.push(c.company + (c.title ? ' ' + c.title : ''));
      var m = Store.moneyOf(c.id);
      if (m.average) sub.push('平均 ' + UI.yen(m.average));
      var vs = Store.visitsOf(c.id);
      if (vs.length) sub.push(vs.length + '回目');
      if (sub.length) card.appendChild(UI.el('p', 'card-body', sub.join('　/　')));

      if (!Store.isMyAccount(c)) {
        var w = UI.el('p', 'card-body warn-text');
        w.textContent = Store.accountLabel(c) + '。係の方を立てて、店内でのお相手に徹します。';
        card.appendChild(w);
      }

      var last = vs[0];
      if (last && last.topic_detail) {
        card.appendChild(UI.el('p', 'talk', '前回：' + last.topic_detail));
      }

      var hooks = Insight.digest(c.id).open_hooks;
      if (hooks.length) {
        var hb = UI.el('div', 'hook-box');
        hb.appendChild(UI.el('div', 'hook-h', '触れられること'));
        hooks.slice(0, 3).forEach(function (h) {
          hb.appendChild(UI.el('div', 'hook-i', '・' + h.text));
        });
        card.appendChild(hb);
      }
    }

    if (a.note) card.appendChild(UI.el('p', 'card-body', a.note));

    var acts = UI.el('div', 'card-acts');
    if (c) {
      var prep = UI.el('button', 'primary small', '会う前の準備');
      prep.type = 'button';
      prep.addEventListener('click', function () { People.openPerson(c.id, 'brief'); });
      acts.appendChild(prep);

      var hist = UI.el('button', 'ghost small', 'これまでの流れ');
      hist.type = 'button';
      hist.addEventListener('click', function () { People.openPerson(c.id, 'history'); });
      acts.appendChild(hist);
    }
    var ed = UI.el('button', 'ghost small', '予定を直す');
    ed.type = 'button';
    ed.addEventListener('click', function () { openAppt({ id: a.id }); });
    acts.appendChild(ed);
    card.appendChild(acts);

    return card;
  }

  /* ---------- 予定の追加・編集 ---------- */

  function openAppt(opts) {
    opts = opts || {};
    editing = opts.id ? (Store.listAppointments().filter(function (a) { return a.id === opts.id; })[0] || null) : null;

    draft = {
      date: editing ? editing.date : (opts.date || Store.today()),
      customer_id: editing ? editing.customer_id : (opts.customer_id || null),
      kind: editing ? editing.kind : (opts.kind || 'visit'),
      confidence: editing ? editing.confidence : (opts.confidence || 'verbal'),
      expected_spend: editing ? editing.expected_spend : null,
      note: editing ? editing.note : ''
    };

    document.getElementById('appt-title').textContent = editing ? '予定を直す' : '予定を入れる';
    document.getElementById('appt-date').value = draft.date;
    UI.setMoney('appt-spend', draft.expected_spend);
    document.getElementById('appt-note').value = draft.note || '';
    document.getElementById('appt-delete').hidden = !editing;

    var sel = UI.clear(document.getElementById('appt-customer'));
    var none = UI.el('option', null, '（お客様を選ぶ）');
    none.value = '';
    sel.appendChild(none);
    Store.activeCustomers().slice().sort(function (a, b) {
      return (a.kana || a.display_name).localeCompare(b.kana || b.display_name, 'ja');
    }).forEach(function (c) {
      var o = UI.el('option', null, c.display_name + (c.company ? '（' + c.company + '）' : ''));
      o.value = c.id;
      if (c.id === draft.customer_id) o.selected = true;
      sel.appendChild(o);
    });

    var kind = UI.clear(document.getElementById('appt-kind'));
    kind.appendChild(UI.segmented(
      [{ value: 'visit', label: 'ご来店' }, { value: 'douhan', label: '同伴' }],
      draft.kind, function (v) { draft.kind = v; }));

    var conf = UI.clear(document.getElementById('appt-confidence'));
    conf.appendChild(UI.segmented(
      [{ value: 'confirmed', label: '確定' }, { value: 'verbal', label: 'お約束' }, { value: 'aiming', label: '狙う' }],
      draft.confidence, function (v) { draft.confidence = v; }));

    UI.show('appt');
  }

  function saveAppt() {
    var date = document.getElementById('appt-date').value;
    var cid = document.getElementById('appt-customer').value;
    if (!date) { UI.toast('日にちを入れてください', true); return; }
    if (!cid) { UI.toast('どなたか選んでください', true); return; }

    var spend = UI.getMoney('appt-spend');
    var fields = {
      date: date,
      customer_id: cid,
      kind: draft.kind,
      confidence: draft.confidence,
      expected_spend: spend > 0 ? spend : null,
      note: document.getElementById('appt-note').value.trim()
    };

    // 鉢合わせは、起きてからでは取り返せない
    var clash = Plan.clashOn(date, cid);
    if (clash) {
      var msg = clash.map(function (x) {
        return '・' + x.customer.display_name + '（' + x.why + '）';
      }).join('\n');
      if (!UI.confirmAsk('この日には、すでに次の方の予定が入っています。\n\n' + msg +
        '\n\nこのまま入れてよろしいですか。')) return;
    }

    if (editing) {
      Store.updateAppointment(editing.id, fields);
      UI.toast('直しました');
    } else {
      Store.addAppointment(fields);
      UI.toast('予定に入れました');
    }
    Store.clearDailyPlan();   // 盤面が変われば段取りも変わる
    editing = null;
    UI.back('board');
    if (UI.current === 'day') renderDay(); else render();
  }

  function init() {
    document.getElementById('board-add').addEventListener('click', function () { openAppt({}); });
    document.getElementById('day-back').addEventListener('click', function () {
      UI.back('board'); Board.render();
    });
    document.getElementById('appt-back').addEventListener('click', function () { UI.back('board'); });
    document.getElementById('appt-cancel').addEventListener('click', function () { UI.back('board'); });
    document.getElementById('appt-save').addEventListener('click', saveAppt);
    document.getElementById('appt-delete').addEventListener('click', function () {
      if (!editing) return;
      if (!UI.confirmAsk('この予定を消します。よろしいですか。')) return;
      Store.deleteAppointment(editing.id);
      Store.clearDailyPlan();
      editing = null;
      UI.toast('消しました');
      UI.back('board');
      if (UI.current === 'day') renderDay(); else render();
    });
  }

  return { init: init, render: render, renderProgress: renderProgress,
           openAppt: openAppt, openDay: openDay };
})();
