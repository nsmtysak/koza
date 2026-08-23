/* Kōza — Service Worker
 * 設計書 §8.3
 *
 * 方針は2つだけ。
 *   1. アプリの見た目と動きは端末に持たせる（圏外・地下でも開ける）
 *   2. 顧客データは一切キャッシュしない。localStorage にしかない
 *
 * GASへの通信（POST）は素通しする。キャッシュすると古い返事を返しかねない。
 */

var VERSION = 'koza2-v59';

// index.html が読み込むURL（?v= 付き）と揃える。
// ここがずれると、圏外での初回起動でCSSやJSだけ取れないことがある。
var SHELL = [
  './',
  './index.html',
  './about.html?v=59',
  './css/app.css?v=59',
  './js/db.js?v=59',
  './js/store.js?v=59',
  './js/holiday.js?v=59',
  './js/insight.js?v=59',
  './js/plan.js?v=59',
  './js/api.js?v=59',
  './js/ui.js?v=59',
  './js/lock.js?v=59',
  './js/night.js?v=59',
  './js/record.js?v=59',
  './js/tidy.js?v=59',
  './js/scan.js?v=59',
  './js/people.js?v=59',
  './js/brief.js?v=59',
  './js/gifts.js?v=59',
  './js/board.js?v=59',
  './js/review.js?v=59',
  './js/invite.js?v=59',
  './js/study.js?v=59',
  './js/home.js?v=59',
  './js/seed.js?v=59',
  './js/install.js?v=59',
  './js/settings.js?v=59',
  './js/app.js?v=59',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // 1つ落ちても全体を失敗させない（アイコン欠けでインストール不能にしない）
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // GETだけ扱う。GASへのPOSTには触らない
  if (req.method !== 'GET') return;

  // 別オリジン（GAS等）はキャッシュしない
  if (new URL(req.url).origin !== self.location.origin) return;

  // ネットワーク優先。取れたら差し替え、駄目ならキャッシュを返す。
  // こうしておくと、更新版を配ったときに次回起動で反映される。
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // ページ遷移の要求なら、とにかくアプリを開く
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
