/* Kōza v2 — 画面遷移と共通部品 */
var UI = (function () {
  'use strict';

  var VIEWS = ['lock', 'setup', 'home', 'board', 'day', 'appt', 'invite', 'people', 'person', 'night', 'tidy',
    'record', 'confirm', 'scan', 'gifts', 'settings', 'brief'];
  var current = 'home';
  var stack = [];
  var toastTimer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function show(name, opts) {
    opts = opts || {};
    if (!opts.replace && current !== name) stack.push(current);

    VIEWS.forEach(function (v) {
      var n = document.getElementById('v-' + v);
      if (n) n.hidden = v !== name;
    });
    current = name;

    var nav = document.getElementById('nav');
    nav.hidden = ['lock', 'setup', 'record', 'confirm', 'scan', 'brief', 'person', 'night', 'tidy',
      'day', 'appt', 'invite'].indexOf(name) >= 0;

    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.go === name);
    });

    window.scrollTo(0, 0);
  }

  function back(fallback) {
    var prev = stack.pop();
    show(prev || fallback || 'home', { replace: true });
  }

  /* ---------- 待たせるときの見せ方 ----------
   *
   * AIの返事は途中経過が取れない。だからこの％は実測にもとづく目安で、
   * 「どこまで進んだか」ではなく「あとどれくらいか」を出している。
   * それでも、いつ終わるか分からないクルクルよりはるかにましだと判断した。
   *
   * 決め打ちの秒数は使わない。使うたびに実測を残して、次からその中央値を目安にする。
   * 端末も回線も人によって違うので、本人の実測のほうが当たる。
   */

  var busyTimer = null, busyStart = 0, busyEst = 0, busySteps = null, busyPct = 0;

  function busy(on, msg, opts) {
    var b = document.getElementById('busy');
    var gauge = document.getElementById('busy-gauge');
    var spin = document.getElementById('busy-spin');

    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }

    if (!on) {
      // 終わったことは見せる。一瞬でも満ちてから消えるほうが、終わった感じがする
      if (busyEst) {
        paint(1, '');
        setTimeout(function () { b.hidden = true; gauge.hidden = true; spin.hidden = false; }, 220);
      } else {
        b.hidden = true; gauge.hidden = true; spin.hidden = false;
      }
      busyEst = 0; busySteps = null; busyPct = 0;
      return;
    }

    if (msg) document.getElementById('busy-msg').textContent = msg;
    b.hidden = false;

    var est = opts && opts.estimate;
    if (!est) { gauge.hidden = true; spin.hidden = false; busyEst = 0; return; }

    busyStart = Date.now();
    busyEst = est;
    busySteps = (opts.steps && opts.steps.length) ? opts.steps : null;
    busyPct = 0;
    spin.hidden = true;      // バーが出るならクルクルは要らない
    gauge.hidden = false;
    paint(0, '');
    tick();
    busyTimer = setInterval(tick, 400);
  }

  function tick() {
    var el = (Date.now() - busyStart) / busyEst;
    var pct;
    if (el < 1) {
      pct = el * 0.9;                       // 見込みの範囲は素直に進める
    } else {
      pct = 0.9 + 0.08 * (1 - Math.exp(-(el - 1) * 1.2));  // 越えたら詰めながら粘る
    }
    if (pct < busyPct) pct = busyPct;       // 後ろには戻さない
    busyPct = pct;

    var leftMs = busyEst - (Date.now() - busyStart);
    var left = leftMs > 1500 ? 'あと約' + Math.ceil(leftMs / 1000) + '秒'
      : (leftMs > -8000 ? 'まもなくです' : 'もう少しかかっています');

    if (busySteps) {
      var i = Math.min(busySteps.length - 1, Math.floor(pct / (0.9 / busySteps.length)));
      document.getElementById('busy-msg').textContent = busySteps[i];
    }
    paint(pct, left);
  }

  function paint(pct, left) {
    document.getElementById('busy-fill').style.width = Math.round(pct * 100) + '%';
    document.getElementById('busy-pct').textContent = Math.round(pct * 100) + '%';
    document.getElementById('busy-left').textContent = left || '';
  }

  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.toggle('ng', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 4500 : 2400);
  }

  /* ---------- 表示のための小道具 ---------- */

  function yen(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 10000) {
      var man = n / 10000;
      return (man >= 10 ? Math.round(man) : Math.round(man * 10) / 10) + '万円';
    }
    return n.toLocaleString('ja-JP') + '円';
  }

  function shortDate(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '';
    return parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
  }

  function longDate(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '';
    var d = new Date(iso + 'T00:00:00');
    var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日（' + wd + '）';
  }

  function sinceLabel(days) {
    if (days === null || days === undefined) return '';
    if (days === 0) return '今日';
    if (days === 1) return '昨日';
    if (days < 31) return days + '日前';
    if (days < 365) return Math.round(days / 30) + 'か月前';
    return Math.round(days / 365 * 10) / 10 + '年前';
  }

  /* ---------- 金額の欄 ----------
   * 4000000 と並んだ数字は読み違える。桁区切りを入れる。
   * type="number" ではカンマを入れられないので text＋数字キーボードにする。
   */

  function parseMoney(v) {
    var n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) ? n : 0;
  }

  function commas(n) {
    if (n === '' || n === null || n === undefined) return '';
    var v = parseMoney(n);
    return v ? v.toLocaleString('ja-JP') : (String(n).replace(/[^\d]/g, '') ? '0' : '');
  }

  /** 入力中も打ち終わりも桁区切りを保つ */
  function moneyInput(el) {
    if (!el || el.dataset.money) return el;
    el.dataset.money = '1';
    el.type = 'text';
    el.inputMode = 'numeric';
    el.autocomplete = 'off';

    function format() {
      var caretFromEnd = el.value.length - (el.selectionStart || el.value.length);
      var raw = el.value.replace(/[^\d]/g, '');
      el.value = raw ? parseInt(raw, 10).toLocaleString('ja-JP') : '';
      var pos = Math.max(0, el.value.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 数字キーボードでは効かないことがある */ }
    }
    el.addEventListener('input', format);
    el.addEventListener('blur', format);
    return el;
  }

  function setMoney(id, n) {
    var el = document.getElementById(id);
    if (!el) return;
    moneyInput(el);
    el.value = (typeof n === 'number' && n > 0) ? n.toLocaleString('ja-JP') : '';
  }

  function getMoney(id) {
    var el = document.getElementById(id);
    return el ? parseMoney(el.value) : 0;
  }

  function chip(text, kind) {
    var s = el('span', 'chip' + (kind ? ' ' + kind : ''), text);
    return s;
  }

  /** 顔写真の代わりに頭文字を出す */
  /**
   * 顔写真があればそれを、無ければ頭文字を出す。
   * 写真は端末の中（IndexedDB）にしか無いので、読み込みは非同期。
   * 先に頭文字を描いてから差し替える（一覧がガタつかないように）。
   */
  function avatar(customer, size) {
    var a = el('span', 'avatar' + (size ? ' ' + size : ''));
    var base = customer.display_name || customer.name || '？';
    a.textContent = base.replace(/(様|さん)$/, '').slice(0, 1);

    if (customer.photo_id && window.Blobs) {
      Blobs.get(customer.photo_id).then(function (src) {
        if (!src) return;
        a.textContent = '';
        a.classList.add('has-photo');
        a.style.backgroundImage = 'url(' + src + ')';
      }).catch(function () { /* 無ければ頭文字のまま */ });
    }
    return a;
  }

  function confirmAsk(message) {
    return window.confirm(message);
  }

  /** 「はい/いいえ」の小さな選択列 */
  function segmented(options, value, onChange) {
    var wrap = el('div', 'seg');
    options.forEach(function (o) {
      var b = el('button', 'seg-btn' + (o.value === value ? ' is-on' : ''), o.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        wrap.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        onChange(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /** 文字列の配列を編集する欄（趣味・NG話題など） */
  function tagEditor(values, placeholder, onChange) {
    var wrap = el('div', 'tag-editor');
    var list = el('div', 'tag-list');
    var vals = (values || []).slice();

    function render() {
      clear(list);
      vals.forEach(function (v, i) {
        var t = el('span', 'chip removable', v);
        var x = el('button', 'chip-x', '×');
        x.type = 'button';
        x.addEventListener('click', function () {
          vals.splice(i, 1); render(); onChange(vals);
        });
        t.appendChild(x);
        list.appendChild(t);
      });
    }

    var row = el('div', 'tag-input');
    var input = el('input');
    input.type = 'text';
    input.placeholder = placeholder || '入力して追加';
    var add = el('button', 'ghost small', '追加');
    add.type = 'button';

    function commit() {
      var v = input.value.trim();
      if (!v) return;
      if (vals.indexOf(v) === -1) vals.push(v);
      input.value = '';
      render(); onChange(vals);
    }
    add.addEventListener('click', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });

    row.appendChild(input); row.appendChild(add);
    wrap.appendChild(list); wrap.appendChild(row);
    render();
    return wrap;
  }

  return {
    el: el, clear: clear,
    show: show, back: back, busy: busy, toast: toast,
    yen: yen, shortDate: shortDate, longDate: longDate, sinceLabel: sinceLabel,
    parseMoney: parseMoney, commas: commas, moneyInput: moneyInput,
    setMoney: setMoney, getMoney: getMoney,
    chip: chip, avatar: avatar, confirmAsk: confirmAsk,
    segmented: segmented, tagEditor: tagEditor,
    get current() { return current; }
  };
})();
