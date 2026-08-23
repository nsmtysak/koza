/* Kōza v2 — 起動 */
(function () {
  'use strict';

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('Service Worker を登録できませんでした', e);
      });
    });
  }

  function goto(name) {
    if (name === 'lock') { UI.show('lock'); return; }
    if (name === 'home') Home.refresh();
    if (name === 'board') Board.render();
    if (name === 'people') People.renderList();
    if (name === 'gifts') Gifts.render();
    if (name === 'settings') Settings.load();
    UI.show(name);   // 丸ボタンの出し入れは UI.show が持っている
  }

  function init() {
    registerServiceWorker();

    // 期日を過ぎた誘いと予定を片付ける。放っておくと数字が嘘になる
    Store.settleOverdueInvites();
    Store.closeStaleAppointments();

    Record.init();
    Night.init();
    Tidy.init();
    Scan.init();
    People.init();
    Brief.init();
    Board.init();
    Review.init();
    Invite.init();
    Study.init();
    Home.init();
    Settings.init();
    Lock.init();

    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { goto(b.dataset.go); });
    });

    document.getElementById('fab').addEventListener('click', function () { Night.refreshNames(); Night.open(); });

    var cameFromLink = Api.consumeSetupLink();

    // 開く前に暗証番号を挟む。お客様のお名前と連絡先を持っているため
    Lock.gate(function () {
      if (!Store.getProfile().configured) {
        UI.show('setup', { replace: true });
        document.getElementById('fab').hidden = true;
        Settings.initSetup(function () {
          goto('home');
          if (cameFromLink) UI.toast('準備ができました');
        });
      } else {
        goto('home');
        if (cameFromLink) UI.toast('設定を受け取りました');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // 画面遷移でナビの選択状態と一覧の再描画を揃える
  window.Nav = { goto: goto };
})();
