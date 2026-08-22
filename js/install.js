/* Kōza v2 — ホーム画面に置いて使っていただくための案内
 *
 * ブラウザのタブで開いているあいだ、iPhone は画面の下にアドレス欄と道具箱を出す。
 * これが上下で伸び縮みするので、
 *   - 使える面積が狭い
 *   - 下の「今日／枠／お客様…」が、本文と一緒に持ち上がったように見える
 * この2つが起きる。**ページ側からは、あの帯を縮められない。**
 *
 * ホーム画面に追加してそこから起動すると、あの帯ごと消えて全画面になる。
 * 必要な仕込み（manifest・apple-mobile-web-app-capable）は入れてあるので、
 * あとは一度そうしていただくだけ。だから、その一度を案内する。
 */
var Install = (function () {
  'use strict';

  var KEY = 'koza2.installHint';

  /** ホーム画面から起動しているか */
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /** iPhone の Safari かどうか。Chrome や Firefox は手順が違う */
  function isIOSSafari() {
    return isIOS() && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  }

  function dismissed() {
    try { return localStorage.getItem(KEY) === 'off'; } catch (e) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(KEY, 'off'); } catch (e) { /* 容量なら諦める */ }
  }

  /** 端末に合わせた手順。分からない端末には、当たり障りのない言い方で出す */
  function steps() {
    if (isIOSSafari()) {
      return ['画面の下にある□に↑のついたボタンを押す',
              'メニューを下に送って「ホーム画面に追加」を押す',
              '右上の「追加」を押す',
              'ホーム画面にできた Kōza のアイコンから開く'];
    }
    if (isIOS()) {
      return ['このページを Safari で開き直す',
              '下の共有ボタンから「ホーム画面に追加」を押す',
              'ホーム画面にできた Kōza のアイコンから開く'];
    }
    return ['ブラウザの右上（または右下）のメニューを開く',
            '「アプリをインストール」または「ホーム画面に追加」を押す',
            'ホーム画面にできた Kōza のアイコンから開く'];
  }

  function stepList() {
    var ol = UI.el('ol', 'howto');
    steps().forEach(function (t) { ol.appendChild(UI.el('li', null, t)); });
    return ol;
  }

  /* ---------- ホームに出す一度きりの案内 ---------- */

  function renderHomeBanner() {
    var el = document.getElementById('home-install');
    if (!el) return;
    UI.clear(el);

    if (isStandalone() || dismissed()) { el.hidden = true; return; }

    el.appendChild(UI.el('h3', null, 'ホーム画面に置くと、全画面になります'));
    el.appendChild(UI.el('p', null,
      'いまはブラウザで開いています。下のアドレス欄のぶん、画面が狭くなっています。' +
      'ホーム画面のアイコンから開くと、その帯ごと無くなります。'));

    var det = UI.el('details', 'raw');
    det.style.marginTop = '10px';
    det.appendChild(UI.el('summary', null, 'やり方を見る'));
    det.appendChild(stepList());
    el.appendChild(det);

    var row = UI.el('div', 'actions');
    row.style.marginTop = '12px';
    var no = UI.el('button', 'ghost small', 'もう出さない');
    no.type = 'button';
    no.addEventListener('click', function () {
      dismiss();
      renderHomeBanner();
      UI.toast('設定の「全画面で使う」からいつでも見られます');
    });
    row.appendChild(no);
    el.appendChild(row);

    el.hidden = false;
  }

  /* ---------- 設定に置く、いつでも読める案内 ---------- */

  function renderSettings() {
    var el = document.getElementById('s-install');
    if (!el) return;
    UI.clear(el);

    if (isStandalone()) {
      el.appendChild(UI.el('p', 'help',
        'ホーム画面から開いています。この状態がいちばん広く使えます。'));
      return;
    }

    el.appendChild(UI.el('p', 'help',
      'いまはブラウザで開いています。画面の下にアドレス欄が出るぶん、狭くなっています。' +
      'ホーム画面に追加して、そこから開いてください。アドレス欄ごと無くなります。'));
    el.appendChild(stepList());
    el.appendChild(UI.el('p', 'help',
      '記録は移りません。同じものがそのまま開きます。'));
  }

  function init() {
    renderHomeBanner();
  }

  return { init: init, renderSettings: renderSettings,
           renderHomeBanner: renderHomeBanner, isStandalone: isStandalone };
})();
