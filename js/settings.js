/* Kōza v2 — 設定と、初回のセットアップ */
var Settings = (function () {
  'use strict';

  /* ---------- 初回セットアップ ---------- */

  var answers = {}, step = 0, steps = null, onDone = null;

  function initSetup(done) {
    onDone = done;
    steps = Array.prototype.slice.call(document.querySelectorAll('#v-setup .q'));
    answers = {}; step = 0;

    steps.forEach(function (q) {
      q.querySelectorAll('.opt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          answers[q.querySelector('.opts').dataset.field] = btn.dataset.value;
          next();
        });
      });
    });

    /* 目標は選ばせない。店も本人も、数字は人それぞれ枠に入らない。
     * 万で受けるのは、月の目標を円で打つ人がいないため。 */
    var man = document.getElementById('setup-target-man');
    document.getElementById('setup-target-ok').addEventListener('click', function () {
      var v = parseInt(man.value, 10);
      answers.target_sales = (v > 0 ? v * 10000 : 0);
      next();
    });
    document.getElementById('setup-target-later').addEventListener('click', function () {
      answers.target_sales = 0;
      next();
    });
    man.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('setup-target-ok').click();
    });

    document.getElementById('setup-skip').addEventListener('click', finishSetup);
    showStep(0);
  }

  function showStep(i) {
    steps.forEach(function (q, n) { q.hidden = n !== i; });
    window.scrollTo(0, 0);
  }

  function next() {
    step += 1;
    if (step >= steps.length) return finishSetup();
    showStep(step);
  }

  function finishSetup() {
    var patch = { configured: true };
    if (answers.my_role) patch.my_role = answers.my_role;
    if (answers.shimei_system) patch.shimei_system = answers.shimei_system;
    if (answers.douhan_reward_type) {
      patch.douhan_reward_type = answers.douhan_reward_type;
      if (answers.douhan_reward_type === 'fixed') patch.douhan_reward_value = 3000;
    }
    var wd = parseInt(answers.workdays, 10) || 0;
    if (wd) patch.workdays_per_month = wd;
    var goalNow = parseInt(answers.target_sales, 10) || 0;
    if (goalNow) patch.target_sales = goalNow;
    Store.saveProfile(patch);
    if (goalNow) Store.saveGoal(Store.periodOf(Store.today()).key, { sales: goalNow });
    if (onDone) onDone();
  }

  /**
   * AIの接続。
   *
   * つながったあとも合言葉を出しっぱなしにしていると、
   * 端末を開ける人が読んで、そのまま別の端末に入れられる。
   * こちらの費用で、こちらの知らない誰かが使うことになる。
   * だから、いちど入れたら伏せる。つなぎ直すときだけ開く。
   */
  var apiEditing = false;

  function maskToken(t) {
    t = String(t || '');
    if (!t) return '（未設定）';
    if (t.length <= 4) return '●'.repeat(t.length);
    return t.slice(0, 2) + '●'.repeat(Math.max(4, t.length - 4)) + t.slice(-2);
  }

  function shortUrl(u) {
    u = String(u || '');
    if (!u) return '（未設定）';
    var m = u.match(/\/macros\/s\/([^\/]+)/);
    if (!m) return u.length > 44 ? u.slice(0, 26) + '…' + u.slice(-8) : u;
    var id = m[1];
    return 'script.google.com/…/' + id.slice(0, 4) + '…' + id.slice(-4) + '/exec';
  }

  /** 伏せているときは入力欄に何も入っていない。そのまま保存すると接続が消える */
  function saveApiFromForm() {
    if (document.getElementById('api-open').hidden) return;
    var url = str('s-gas-url'), token = str('s-gas-token');
    if (!url && !token) return;      // 空のまま保存しない
    Store.saveApiConfig({ gas_url: url, token: token });
    apiEditing = false;
    renderApi(Store.getApiConfig());
  }

  function renderApi(a) {
    var configured = !!(a.gas_url && a.token);
    var locked = document.getElementById('api-locked');
    var open = document.getElementById('api-open');

    if (configured && !apiEditing) {
      var m = UI.clear(document.getElementById('api-masked'));
      m.appendChild(UI.el('span', 'masked-line', shortUrl(a.gas_url)));
      m.appendChild(UI.el('span', 'masked-line', '合言葉　' + maskToken(a.token)));
      locked.hidden = false;
      open.hidden = true;
    } else {
      locked.hidden = true;
      open.hidden = false;
      val('s-gas-url', a.gas_url);
      // つなぎ直すときは空から。前の合言葉を読ませない
      val('s-gas-token', apiEditing ? '' : a.token);
    }
  }

  /* ---------- 設定画面 ---------- */

  function load() {
    // 画面を開き直したら、また伏せる。開けっ放しにしない
    apiEditing = false;
    Install.renderSettings();
    var p = Store.getProfile();
    var a = Store.getApiConfig();

    var period = Store.periodOf(Store.today());
    var goal = Store.getGoal(period.key);
    UI.setMoney('s-target-sales', goal.sales);
    val('s-closing-day', p.closing_day || 0);
    val('s-target-douhan', goal.douhan || 0);
    renderOpenDays(p.open_days || [1, 2, 3, 4, 5]);

    chk('s-closed-holidays', p.closed_on_holidays);
    chk('s-closed-newyear', p.closed_newyear);
    chk('s-closed-obon', p.closed_obon);
    val('s-newyear-from', p.newyear_from || '12-29');
    val('s-newyear-to', p.newyear_to || '01-03');
    val('s-obon-from', p.obon_from || '08-13');
    val('s-obon-to', p.obon_to || '08-16');

    val('s-cooldown-contact', typeof p.cooldown_contact === 'number' ? p.cooldown_contact : 3);
    val('s-cooldown-invite', typeof p.cooldown_invite === 'number' ? p.cooldown_invite : 10);
    val('s-quiet-from', typeof p.quiet_from === 'number' ? p.quiet_from : 23);
    val('s-quiet-to', typeof p.quiet_to === 'number' ? p.quiet_to : 9);
    val('s-lead-visit', typeof p.lead_default_visit === 'number' ? p.lead_default_visit : 4);
    val('s-lead-douhan', typeof p.lead_default_douhan === 'number' ? p.lead_default_douhan : 5);
    val('s-max-contacts', typeof p.max_contacts_month === 'number' ? p.max_contacts_month : 3);

    val('s-area', p.area || '');
    val('s-meal-area', p.meal_area || '');
    val('s-myrole', p.my_role || 'both');
    val('s-shimei', p.shimei_system || 'eikyu');
    val('s-douhan-quota', p.douhan_quota_monthly || 0);
    renderApi(a);
    val('s-lock-after', typeof p.lock_after_min === 'number' ? p.lock_after_min : 3);
    document.getElementById('btn-lock-set').textContent =
      Lock.isSet() ? '暗証番号を外す' : '暗証番号を決める';

    var m = Store.getMeta();
    document.getElementById('last-export').textContent = m.last_export_at
      ? '最後に書き出したのは ' + new Date(m.last_export_at).toLocaleDateString('ja-JP') + ' です。'
      : 'まだ一度も書き出していません。';

    renderUsage();
  }

  function val(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = (v === null || v === undefined) ? '' : v;
  }

  /* 画面から欄を減らしたとき、ここの読み取りを消し忘れると保存が丸ごと落ちる。
   * 一度それで「設定を保存」が効かない状態を作ったので、欠けても止まらないようにする。 */
  function num(id) {
    var el = document.getElementById(id);
    return el ? (parseInt(el.value, 10) || 0) : 0;
  }
  function str(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function sel(id, fallback) {
    var el = document.getElementById(id);
    return el ? el.value : fallback;
  }
  function chk(id, v) { var el = document.getElementById(id); if (el) el.checked = !!v; }
  function on(id) { var el = document.getElementById(id); return !!(el && el.checked); }

  var openDays = [0, 1, 2, 3, 4, 5, 6];

  function renderOpenDays(cur) {
    openDays = (cur || []).slice();
    var wrap = UI.clear(document.getElementById('s-open-days'));
    if (!wrap) return;
    ['日', '月', '火', '水', '木', '金', '土'].forEach(function (label, i) {
      var b = UI.el('button', 'daybtn' + (openDays.indexOf(i) >= 0 ? ' is-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', function () {
        var at = openDays.indexOf(i);
        if (at >= 0) openDays.splice(at, 1); else openDays.push(i);
        b.classList.toggle('is-on', openDays.indexOf(i) >= 0);
      });
      wrap.appendChild(b);
    });
  }

  function save() {
    var closing = Math.max(0, Math.min(28, num('s-closing-day')));
    Store.saveProfile({
      closing_day: closing,
      target_sales: UI.getMoney('s-target-sales'),
      target_douhan: num('s-target-douhan'),
      open_days: openDays.length ? openDays.slice().sort() : [1, 2, 3, 4, 5],
      closed_on_holidays: on('s-closed-holidays'),
      closed_newyear: on('s-closed-newyear'),
      closed_obon: on('s-closed-obon'),
      newyear_from: str('s-newyear-from') || '12-29',
      newyear_to: str('s-newyear-to') || '01-03',
      obon_from: str('s-obon-from') || '08-13',
      obon_to: str('s-obon-to') || '08-16'
    });
    // 締め日を変えると期間が変わるので、保存し直したあとの期間に紐づける
    var period = Store.periodOf(Store.today());
    Store.saveGoal(period.key, { sales: UI.getMoney('s-target-sales'), douhan: num('s-target-douhan') });

    Store.saveProfile({
      area: str('s-area'),
      meal_area: str('s-meal-area'),
      my_role: sel('s-myrole', 'kakari'),
      shimei_system: sel('s-shimei', 'eikyu'),
      douhan_quota_monthly: num('s-douhan-quota'),
      lock_after_min: Math.max(0, Math.min(120, num('s-lock-after'))),

      cooldown_contact: Math.max(0, Math.min(30, num('s-cooldown-contact'))),
      cooldown_invite: Math.max(0, Math.min(60, num('s-cooldown-invite'))),
      quiet_from: Math.max(0, Math.min(23, num('s-quiet-from'))),
      quiet_to: Math.max(0, Math.min(23, num('s-quiet-to'))),
      lead_default_visit: Math.max(1, Math.min(30, num('s-lead-visit') || 4)),
      lead_default_douhan: Math.max(1, Math.min(30, num('s-lead-douhan') || 5)),
      max_contacts_month: Math.max(0, Math.min(20, num('s-max-contacts'))),

      configured: true
    });
    saveApiFromForm();
    Store.clearDailyPlan();   // 目標が変われば段取りも変わる
    UI.toast('設定を保存しました');
  }

  function renderUsage() {
    var s = Store.usageStats();
    var wrap = UI.clear(document.getElementById('usage'));

    function cell(label, value, sub, wide) {
      var d = UI.el('div', wide ? 'wide' : null);
      d.appendChild(UI.el('dt', null, label));
      var dd = UI.el('dd', null, String(value));
      if (sub) {
        var sm = UI.el('small', null, ' ' + sub);
        dd.appendChild(sm);
      }
      d.appendChild(dd);
      wrap.appendChild(d);
    }

    cell('残した来歴', s.visit_count, '件');
    cell('記録した日数', s.recorded_days, '日');
    cell('この7日間', s.recent_7days, '件');
    cell('お客様', s.customer_count, '名');
    cell('贈答・連絡', s.touch_count, '件');
    cell('会う前の準備', s.brief_count, '回');
    if (s.brief_count) cell('うち結果を記録', s.brief_used, '回');
    cell('お誘い', s.invite_count, '件');
    if (s.invite_settled) cell('うちお越しになった', s.invite_came, '件');
    cell('先の予定', s.appointment_count, '件');
    if (s.first_date) {
      cell('記録している期間', UI.shortDate(s.first_date) + ' 〜 ' + UI.shortDate(s.last_date), '', true);
    }
  }

  /* 今月のAI利用は、本人の画面には出さない。
   * 費用はこちらの持ち分であって、使う人が気にすると手が止まる。
   * 数えること自体は Store.recordUsage が続けているので、必要なら
   * 書き出したデータから見られる。請求はAnthropicの管理画面が正。 */

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }

  function testApi(outId) {
    var out = document.getElementById(outId || 'api-test-result');
    out.className = 'test-result';
    out.textContent = '確認中…';
    // 伏せているときは、しまってあるものでそのまま試す
    if (!document.getElementById('api-open').hidden) {
      Store.saveApiConfig({ gas_url: str('s-gas-url'), token: str('s-gas-token') });
    }

    Api.ping().then(function (d) {
      out.className = 'test-result ok';
      out.textContent = 'つながりました（' + (d.model || 'AI') + '）';
    }).catch(function (e) {
      out.className = 'test-result ng';
      out.textContent = e.message;
    });
  }

  function makeSetupLink() {
    var out = document.getElementById('setup-link');
    try {
      saveApiFromForm();
      var link = Api.buildSetupLink();
      out.value = link;
      out.hidden = false;
      out.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link)
          .then(function () { UI.toast('リンクをコピーしました'); })
          .catch(function () { UI.toast('下の欄からコピーしてください'); });
      } else {
        UI.toast('下の欄からコピーしてください');
      }
    } catch (e) {
      out.hidden = true;
      UI.toast(e.message, true);
    }
  }

  function doImport(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var added = Store.importAll(JSON.parse(reader.result));
        load();
        Home.refresh();
        People.renderList();
        UI.toast('お客様' + added.customers + '名 / 来歴' + added.visits + '件 を取り込みました');
      } catch (e) {
        UI.toast(e.message || '読み込めませんでした', true);
      }
    };
    reader.onerror = function () { UI.toast('ファイルを読めませんでした', true); };
    reader.readAsText(file);
  }

  function init() {
    // 休みの条件を変えたら、出られる日数もその場で数え直す
    ['s-closed-holidays', 's-closed-newyear', 's-closed-obon',
      's-newyear-from', 's-newyear-to', 's-obon-from', 's-obon-to'].forEach(function (id) {
      var el = document.getElementById(id);
    });

    document.getElementById('btn-save-settings').addEventListener('click', save);
    document.getElementById('btn-test-api').addEventListener('click', function () { testApi('api-test-result'); });
    document.getElementById('btn-test-api-2').addEventListener('click', function () { testApi('api-test-result-2'); });
    document.getElementById('btn-api-edit').addEventListener('click', function () {
      if (!UI.confirmAsk('つなぎ直します。\n\n合言葉をもう一度入れていただく必要があります。\nよろしいですか。')) return;
      apiEditing = true;
      renderApi(Store.getApiConfig());
      document.getElementById('s-gas-token').focus();
    });
    document.getElementById('btn-setup-link').addEventListener('click', makeSetupLink);
    document.getElementById('btn-lock-set').addEventListener('click', function () {
      Lock.startSetting();
    });

    document.getElementById('btn-export').addEventListener('click', function () {
      Store.exportToFile(false).then(function () { load(); UI.toast('書き出しました'); });
    });
    document.getElementById('btn-export-img').addEventListener('click', function () {
      UI.busy(true, '名刺の画像をまとめています…');
      Store.exportToFile(true).then(function () {
        UI.busy(false); load(); UI.toast('書き出しました');
      }).catch(function () { UI.busy(false); UI.toast('書き出せませんでした', true); });
    });
    /* お試しのデータ。お渡しする前に消す前提のもの（DEPLOY.md 8節） */
    var seedBtn = document.getElementById('btn-seed');
    if (seedBtn) {
      seedBtn.addEventListener('click', function () {
        var n = Store.activeCustomers().length;
        if (n > 0 && !UI.confirmAsk(
          'すでに' + n + '名のお客様が登録されています。\n\n' +
          'お試しのデータを足すと、どれが本物か分からなくなります。\n本当に入れますか。')) return;

        UI.busy(true, 'お試しのデータを作っています…');
        setTimeout(function () {
          try {
            var r = Seed.install();
            UI.busy(false);
            document.getElementById('seed-result').textContent =
              'お客様' + r.customers + '名／来歴' + r.visits + '件／接点' + r.touches +
              '件／予定' + r.appointments + '件を入れました。';
            load();
            UI.toast('お試しのデータを入れました');
          } catch (err) {
            UI.busy(false);
            UI.toast('作れませんでした：' + err.message, true);
          }
        }, 30);
      });
    }

    var wipeBtn = document.getElementById('btn-wipe');
    if (wipeBtn) {
      wipeBtn.addEventListener('click', function () {
        if (!UI.confirmAsk('記録を全部消します。お客様も来歴も接点も予定も、すべてです。\n\nよろしいですか。')) return;
        if (!UI.confirmAsk('元に戻せません。本当に消しますか。')) return;
        Seed.wipe();
        location.reload();
      });
    }

    document.getElementById('file-import').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = '';
    });
  }

  return { init: init, initSetup: initSetup, load: load };
})();
