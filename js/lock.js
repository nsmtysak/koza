/* Kōza v2 — 暗証番号
 *
 * このアプリはお客様の実名・携帯番号・ご家族のことを持っている。
 * 落とす、置き忘れる、店で誰かが手に取る。どれも起こりうる。
 * だから開く前に一枚挟む。
 *
 * ただし、これは覗き見を止めるためのもの。
 * 端末そのものを解析されれば記録は読めてしまう。
 * 端末のロックと併せて使っていただく前提で、そこは正直に書いてある。
 */
var Lock = (function () {
  'use strict';

  var MAX_TRIES = 5;
  var PENALTY_MS = 30000;

  var input = '';
  var tries = 0;
  var lockedUntil = 0;
  var onPass = null;
  var mode = 'enter';      // enter（開く）/ set（決める）/ confirm（確かめ）/ off（外す）
  var firstEntry = '';
  var hiddenAt = 0;

  /* ---------- 暗証番号の保管 ---------- */

  function randomSalt() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function hash(pin, salt) {
    var text = salt + ':' + pin + ':koza';
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        .then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
        })
        .then(function (h) { return { hash: h, algo: 'sha256' }; })
        .catch(function () { return { hash: weak(text), algo: 'weak' }; });
    }
    return Promise.resolve({ hash: weak(text), algo: 'weak' });
  }

  /** SHA-256 が使えない環境のための最低限。無いよりまし、という位置づけ */
  function weak(s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      h1 = ((h1 ^ s.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + s.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  }

  function isSet() {
    var l = Store.getProfile().lock;
    return !!(l && l.hash && l.salt);
  }

  function verify(pin) {
    var l = Store.getProfile().lock;
    if (!l) return Promise.resolve(false);
    return hash(pin, l.salt).then(function (r) { return r.hash === l.hash; });
  }

  function save(pin) {
    var salt = randomSalt();
    return hash(pin, salt).then(function (r) {
      Store.saveProfile({ lock: { salt: salt, hash: r.hash, algo: r.algo } });
      return true;
    });
  }

  function clear() { Store.saveProfile({ lock: null }); }

  /* ---------- 画面 ---------- */

  function label() {
    if (mode === 'set') return '新しい暗証番号（4桁）';
    if (mode === 'confirm') return 'もう一度、同じ番号を';
    if (mode === 'off') return '今の暗証番号を入れてください';
    return '暗証番号を入れてください';
  }

  function render(message, isError) {
    document.getElementById('lock-label').textContent = label();
    var msg = document.getElementById('lock-msg');
    msg.textContent = message || '';
    msg.className = 'lock-msg' + (isError ? ' ng' : '');

    var dots = UI.clear(document.getElementById('lock-dots'));
    for (var i = 0; i < 4; i++) {
      dots.appendChild(UI.el('span', 'lock-dot' + (i < input.length ? ' on' : '')));
    }
    document.getElementById('lock-cancel').hidden = mode === 'enter';
  }

  function press(n) {
    if (Date.now() < lockedUntil) return;
    if (input.length >= 4) return;
    input += String(n);
    render();
    if (input.length === 4) setTimeout(submit, 120);
  }

  function back() {
    input = input.slice(0, -1);
    render();
  }

  function submit() {
    var pin = input;
    input = '';

    if (mode === 'set') {
      firstEntry = pin;
      mode = 'confirm';
      render();
      return;
    }

    if (mode === 'confirm') {
      if (pin !== firstEntry) {
        mode = 'set'; firstEntry = '';
        render('番号が違いました。もう一度決めてください。', true);
        return;
      }
      save(pin).then(function () {
        UI.toast('暗証番号を決めました');
        finish();
      });
      return;
    }

    if (mode === 'off') {
      verify(pin).then(function (ok) {
        if (!ok) { render('番号が違います', true); return; }
        clear();
        UI.toast('暗証番号を外しました');
        finish();
      });
      return;
    }

    verify(pin).then(function (ok) {
      if (ok) { tries = 0; finish(); return; }
      tries += 1;
      if (tries >= MAX_TRIES) {
        lockedUntil = Date.now() + PENALTY_MS;
        tries = 0;
        render('しばらく入れられません（30秒）', true);
        setTimeout(function () { render('もう一度どうぞ'); }, PENALTY_MS);
        return;
      }
      render('番号が違います（あと' + (MAX_TRIES - tries) + '回）', true);
    });
  }

  function finish() {
    var cb = onPass;
    onPass = null;
    mode = 'enter';
    firstEntry = '';
    input = '';
    if (cb) cb();
  }

  /* ---------- 外から呼ぶ ---------- */

  /** 起動時・復帰時に閉じる */
  function gate(done) {
    if (!isSet()) { done(); return; }
    onPass = done;
    mode = 'enter';
    input = '';
    UI.show('lock', { replace: true });
    document.getElementById('nav').hidden = true;
    document.getElementById('fab').hidden = true;
    render();
  }

  function startSetting() {
    onPass = function () { Settings.load(); UI.show('settings', { replace: true }); };
    mode = isSet() ? 'off' : 'set';
    input = '';
    UI.show('lock');
    document.getElementById('nav').hidden = true;
    document.getElementById('fab').hidden = true;
    render(mode === 'off' ? '外すには、今の番号が要ります' : '');
  }

  /** 画面を離れて時間が経ったら閉じ直す。店に置いたままにされることがある */
  function watchAway() {
    document.addEventListener('visibilitychange', function () {
      if (!isSet()) return;
      if (document.hidden) { hiddenAt = Date.now(); return; }
      var min = parseInt(Store.getProfile().lock_after_min, 10);
      if (!isFinite(min) || min < 0) min = 3;
      if (hiddenAt && Date.now() - hiddenAt > min * 60000 && UI.current !== 'lock') {
        gate(function () { Nav.goto('home'); });
      }
    });
  }

  function init() {
    document.querySelectorAll('#lock-pad .lock-key').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.k;
        if (v === 'back') back();
        else press(v);
      });
    });
    document.getElementById('lock-cancel').addEventListener('click', function () {
      input = ''; mode = 'enter';
      var cb = onPass; onPass = null;
      if (cb) cb(); else Nav.goto('settings');
    });
    watchAway();
  }

  return { init: init, gate: gate, isSet: isSet, startSetting: startSetting };
})();
