/* Kōza v2 — 休みの判定
 *
 * 高級クラブは法人のお客様が中心で、企業が休む日はお客様も来ない。
 * 日曜・祝日・年末年始・お盆が空き枠として盤面に出ると、
 * 「埋められるはずの日」を数え間違える。逆算がそのまま狂う。
 *
 * 祝日は外部に問い合わせず、この中で計算する。
 * 圏外でも盤面が出る必要があるし、そのために通信するほどのものでもない。
 * 春分・秋分の近似式は1980〜2099年で実際の官報と一致する。
 */
var Holiday = (function () {
  'use strict';

  function ymd(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** その月の第n月曜日 */
  function nthMonday(y, m, n) {
    var first = new Date(y, m - 1, 1).getDay();          // 0=日
    var offset = (8 - first) % 7;                        // 最初の月曜までの日数
    return 1 + offset + (n - 1) * 7;
  }

  function shunbun(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  function shubun(y) {
    return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  var cache = {};

  /** その年の祝日 { 'YYYY-MM-DD': '名前' } */
  function ofYear(y) {
    if (cache[y]) return cache[y];
    var h = {};

    h[ymd(y, 1, 1)] = '元日';
    h[ymd(y, 1, nthMonday(y, 1, 2))] = '成人の日';
    h[ymd(y, 2, 11)] = '建国記念の日';
    h[ymd(y, 2, 23)] = '天皇誕生日';
    h[ymd(y, 3, shunbun(y))] = '春分の日';
    h[ymd(y, 4, 29)] = '昭和の日';
    h[ymd(y, 5, 3)] = '憲法記念日';
    h[ymd(y, 5, 4)] = 'みどりの日';
    h[ymd(y, 5, 5)] = 'こどもの日';
    h[ymd(y, 7, nthMonday(y, 7, 3))] = '海の日';
    h[ymd(y, 8, 11)] = '山の日';
    h[ymd(y, 9, nthMonday(y, 9, 3))] = '敬老の日';
    h[ymd(y, 9, shubun(y))] = '秋分の日';
    h[ymd(y, 10, nthMonday(y, 10, 2))] = 'スポーツの日';
    h[ymd(y, 11, 3)] = '文化の日';
    h[ymd(y, 11, 23)] = '勤労感謝の日';

    // 国民の休日：祝日に挟まれた平日（9月の敬老の日と秋分の日の間に起きる）
    Object.keys(h).slice().forEach(function (k) {
      var d = new Date(k + 'T00:00:00');
      var next = new Date(d); next.setDate(d.getDate() + 2);
      var mid = new Date(d); mid.setDate(d.getDate() + 1);
      var nk = ymd(next.getFullYear(), next.getMonth() + 1, next.getDate());
      var mk = ymd(mid.getFullYear(), mid.getMonth() + 1, mid.getDate());
      if (h[nk] && !h[mk] && mid.getDay() !== 0) h[mk] = '国民の休日';
    });

    // 振替休日：日曜と重なったら、次の平日まで送る
    Object.keys(h).slice().forEach(function (k) {
      var d = new Date(k + 'T00:00:00');
      if (d.getDay() !== 0) return;
      var n = new Date(d);
      do { n.setDate(n.getDate() + 1); }
      while (h[ymd(n.getFullYear(), n.getMonth() + 1, n.getDate())]);
      h[ymd(n.getFullYear(), n.getMonth() + 1, n.getDate())] = '振替休日';
    });

    cache[y] = h;
    return h;
  }

  /** 祝日名。祝日でなければ空文字 */
  function nameOf(iso) {
    if (!iso) return '';
    return ofYear(parseInt(iso.slice(0, 4), 10))[iso] || '';
  }

  function inRange(iso, fromMD, toMD) {
    var md = iso.slice(5);
    // 年をまたぐ範囲（12-29〜01-03）に対応する
    if (fromMD <= toMD) return md >= fromMD && md <= toMD;
    return md >= fromMD || md <= toMD;
  }

  /**
   * その日が休みなら理由を返す。営業日なら空文字。
   * 判定の順番は、店に近いものから。
   */
  function closedReason(iso, override) {
    // override を渡すと、まだ保存していない設定でも数えられる。
    // 設定画面で曜日を選んだその場で日数を出すために要る
    var p = override || Store.getProfile();

    // 本人が出ない日が先。店が開いていても、本人が出なければ枠にならない
    if ((p.off_days || []).indexOf(iso) >= 0) return 'お休み';
    if ((p.closed_dates || []).indexOf(iso) >= 0) return '店休';

    var wd = new Date(iso + 'T00:00:00').getDay();
    var open = p.open_days || [1, 2, 3, 4, 5];
    if (open.indexOf(wd) < 0) return '定休';

    if (p.closed_on_holidays) {
      var n = nameOf(iso);
      if (n) return n;
    }
    if (p.closed_newyear && inRange(iso, p.newyear_from || '12-29', p.newyear_to || '01-03')) {
      return '年末年始';
    }
    if (p.closed_obon && inRange(iso, p.obon_from || '08-13', p.obon_to || '08-16')) {
      return 'お盆';
    }
    return '';
  }

  return { nameOf: nameOf, closedReason: closedReason, ofYear: ofYear };
})();
