/* Kōza v2 — 今夜の分
 *
 * 深夜1時のタクシーの中、5分。ここが通らなければ、このアプリは全部飾りになる。
 *
 * 守ること。
 *   - 1画面で終わる。卓を移るたびに画面を往復させない
 *   - 1卓は1行。名前・金額・一言。それ以上は畳んでおく
 *   - AIを待たせない。整理は翌日に回す
 *   - 声に出させない。タクシーの中でお客様の名前と金額は音読できない
 *   - 途中で閉じても消えない
 */
var Night = (function () {
  'use strict';

  var DRAFT_KEY = 'koza2.night';
  var state = null;

  /** 深夜は前日の営業分として扱う（4時までは「ゆうべ」） */
  function businessDate() {
    var d = new Date();
    if (d.getHours() < 4) d.setDate(d.getDate() - 1);
    return Store.toISO(d);
  }

  function blankRow() {
    return { name: '', customer_id: null, spend: '', douhan: false, memo: '',
             others: '', sets: '', bottle: '', kirikaeshi: false, nominaoshi: false, open: false };
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { raw = null; }
    if (raw && raw.date === businessDate() && (raw.rows || []).length) return raw;
    return { date: businessDate(), rows: [blankRow()] };
  }

  function save() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* 容量なら諦める */ }
  }

  function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

  /* ---------- 画面 ---------- */

  function open() {
    state = load();
    UI.show('night');
    render();
  }

  function render() {
    document.getElementById('night-date').textContent = UI.longDate(state.date);
    var wrap = UI.clear(document.getElementById('night-rows'));
    state.rows.forEach(function (r, i) { wrap.appendChild(rowEl(r, i)); });

    var filled = state.rows.filter(isFilled).length;
    var btn = document.getElementById('night-save');
    btn.textContent = filled ? '残す（' + filled + '卓）' : '残す';
    btn.disabled = !filled;
    document.getElementById('night-count').textContent =
      filled ? filled + '卓ぶん入っています' : '';
  }

  function isFilled(r) {
    return !!(r.name.trim() || r.memo.trim() || String(r.spend).trim());
  }

  function rowEl(r, i) {
    var box = UI.el('div', 'nrow' + (r.open ? ' is-open' : ''));

    /* 1行目：番号・お名前・金額 */
    var head = UI.el('div', 'nrow-head');
    head.appendChild(UI.el('span', 'nrow-no', String(i + 1)));

    var name = UI.el('input');
    name.type = 'text';
    name.className = 'nrow-name';
    name.placeholder = 'お名前';
    name.value = r.name;
    name.setAttribute('list', 'night-names');
    name.addEventListener('input', function () {
      r.name = name.value;
      r.customer_id = null;
      var m = Store.matchCustomer({ display_name: r.name, name: r.name });
      if (m) r.customer_id = m.id;
      hint.textContent = r.name.trim()
        ? (m ? '既存の ' + m.display_name : '新しくお客様として登録します')
        : '';
      hint.className = 'nrow-hint' + (m ? ' ok' : '');
      save();
      countUp();
    });
    head.appendChild(name);

    var spend = UI.el('input');
    spend.type = 'text';
    spend.inputMode = 'numeric';
    spend.className = 'nrow-spend';
    spend.placeholder = '金額';
    spend.value = r.spend ? UI.commas(r.spend) : '';
    UI.moneyInput(spend);
    spend.addEventListener('input', function () { r.spend = spend.value; save(); countUp(); });
    head.appendChild(spend);

    var x = UI.el('button', 'nrow-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'この卓を消す');
    x.addEventListener('click', function () {
      state.rows.splice(i, 1);
      if (!state.rows.length) state.rows.push(blankRow());
      save(); render();
    });
    head.appendChild(x);
    box.appendChild(head);

    var hint = UI.el('div', 'nrow-hint');
    if (r.name.trim()) {
      var m0 = Store.matchCustomer({ display_name: r.name, name: r.name });
      hint.textContent = m0 ? '既存の ' + m0.display_name : '新しくお客様として登録します';
      if (m0) hint.className = 'nrow-hint ok';
    }
    box.appendChild(hint);

    /* 2行目：一言。ここがいちばん大事なので広く取る */
    var memo = UI.el('textarea');
    memo.rows = 2;
    memo.className = 'nrow-memo';
    memo.placeholder = '話したこと、覚えておきたいこと（そのままの言葉で）';
    memo.value = r.memo;
    memo.addEventListener('input', function () { r.memo = memo.value; save(); countUp(); });
    box.appendChild(memo);

    /* 3行目：同伴だけは一等地に。ほかは畳む */
    var tog = UI.el('div', 'nrow-toggles');
    tog.appendChild(toggle('同伴', r.douhan, function (v) { r.douhan = v; save(); }));

    var more = UI.el('button', 'nrow-more', r.open ? '閉じる' : 'そのほか');
    more.type = 'button';
    more.addEventListener('click', function () { r.open = !r.open; save(); render(); });
    tog.appendChild(more);
    box.appendChild(tog);

    if (r.open) box.appendChild(detailEl(r));
    return box;
  }

  function toggle(label, on, onChange) {
    var b = UI.el('button', 'ntog' + (on ? ' is-on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', function () {
      on = !on;
      b.classList.toggle('is-on', on);
      onChange(on);
    });
    return b;
  }

  function detailEl(r) {
    var d = UI.el('div', 'nrow-detail');

    function field(label, key, ph, numeric) {
      var f = UI.el('label', 'f');
      f.appendChild(UI.el('span', null, label));
      var i = UI.el('input');
      i.type = 'text';
      if (numeric) i.inputMode = 'numeric';
      i.placeholder = ph || '';
      i.value = r[key] || '';
      i.addEventListener('input', function () { r[key] = i.value; save(); });
      f.appendChild(i);
      return f;
    }

    d.appendChild(field('ご一緒された方', 'others', '佐藤部長、田中様 など'));
    var g = UI.el('div', 'grid2');
    g.appendChild(field('セット数', 'sets', '2', true));
    g.appendChild(field('ボトル', 'bottle', '響17年'));
    d.appendChild(g);

    var t = UI.el('div', 'nrow-toggles');
    t.appendChild(toggle('切り返し', r.kirikaeshi, function (v) { r.kirikaeshi = v; save(); }));
    t.appendChild(toggle('飲み直し', r.nominaoshi, function (v) { r.nominaoshi = v; save(); }));
    d.appendChild(t);
    return d;
  }

  function countUp() {
    var filled = state.rows.filter(isFilled).length;
    var btn = document.getElementById('night-save');
    btn.textContent = filled ? '残す（' + filled + '卓）' : '残す';
    btn.disabled = !filled;
    document.getElementById('night-count').textContent = filled ? filled + '卓ぶん入っています' : '';
  }

  function addRow() {
    state.rows.push(blankRow());
    save(); render();
    var inputs = document.querySelectorAll('#night-rows .nrow-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  /* ---------- 残す ----------
   * AIは呼ばない。待たせない。整理は翌日。
   */

  function commit() {
    var rows = state.rows.filter(isFilled);
    if (!rows.length) return;

    var made = 0;
    rows.forEach(function (r) {
      var attendees = [];
      var nm = r.name.trim();

      if (nm) {
        var id = r.customer_id;
        if (!id) {
          var m = Store.matchCustomer({ display_name: nm, name: nm });
          id = m ? m.id : Store.createCustomer({
            name: nm,
            display_name: /(様|さん)$/.test(nm) ? nm.replace(/さん$/, '様') : nm + '様',
            first_met: state.date
          }).id;
        }
        attendees.push({ customer_id: id, role: 'shukyaku' });
      }

      // ご一緒された方は、名前をそのまま残しておいて整理のときに拾う
      var others = (r.others || '').split(/[、,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      others.forEach(function (o) {
        var m = Store.matchCustomer({ display_name: o, name: o });
        if (m) attendees.push({ customer_id: m.id, role: 'doukousha' });
      });

      var raw = [nm ? nm + 'と。' : '', r.memo,
        others.length ? '（ご一緒：' + others.join('、') + '）' : ''].filter(Boolean).join(' ');

      Store.addVisit({
        date: state.date,
        attendees: attendees,
        my_role: Store.getProfile().my_role === 'help' ? 'help' : 'kakari',
        douhan: !!r.douhan,
        kirikaeshi: !!r.kirikaeshi,
        nominaoshi: !!r.nominaoshi,
        set_count: parseInt(r.sets, 10) || 0,
        spend: UI.parseMoney(r.spend) || null,
        bottle: (r.bottle || '').trim(),
        topic_detail: r.memo.trim(),
        raw_memo: raw,
        hooks: [],
        ai_structured: false        // 整理は翌日。ここが未整理の目印
      });
      made += 1;
    });

    clearDraft();
    state = null;
    UI.show('home', { replace: true });
    Home.refresh();
    UI.toast(made + '卓ぶん残しました。整理は明日で構いません');
  }

  function init() {
    document.getElementById('night-back').addEventListener('click', function () {
      save();
      UI.back('home');
      Home.refresh();
    });
    document.getElementById('night-add').addEventListener('click', addRow);
    document.getElementById('night-save').addEventListener('click', commit);
    document.getElementById('night-clear').addEventListener('click', function () {
      if (!UI.confirmAsk('入力中の内容を捨てます。よろしいですか。')) return;
      clearDraft();
      state = load();
      render();
    });
  }

  /** お名前の候補。打ち間違いを減らす */
  function refreshNames() {
    var dl = UI.clear(document.getElementById('night-names'));
    Store.activeCustomers().forEach(function (c) {
      var o = UI.el('option');
      o.value = c.display_name;
      dl.appendChild(o);
    });
  }

  return { init: init, open: open, refreshNames: refreshNames, businessDate: businessDate };
})();
