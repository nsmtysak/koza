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

  /* ---------- 設定画面 ---------- */

  function load() {
    var p = Store.getProfile();
    var a = Store.getApiConfig();

    var period = Store.periodOf(Store.today());
    var goal = Store.getGoal(period.key);
    UI.setMoney('s-target-sales', goal.sales);
    val('s-closing-day', p.closing_day || 0);
    val('s-target-douhan', goal.douhan || 0);
    renderOpenDays(p.open_days || [1, 2, 3, 4, 5, 6]);

    chk('s-closed-holidays', p.closed_on_holidays);
    chk('s-closed-newyear', p.closed_newyear);
    chk('s-closed-obon', p.closed_obon);
    val('s-newyear-from', p.newyear_from || '12-29');
    val('s-newyear-to', p.newyear_to || '01-03');
    val('s-obon-from', p.obon_from || '08-13');
    val('s-obon-to', p.obon_to || '08-16');

    val('s-douhan-deadline', p.douhan_deadline || '');
    val('s-open-time', p.open_time || '');

    val('s-cooldown-contact', typeof p.cooldown_contact === 'number' ? p.cooldown_contact : 3);
    val('s-cooldown-invite', typeof p.cooldown_invite === 'number' ? p.cooldown_invite : 10);
    val('s-quiet-from', typeof p.quiet_from === 'number' ? p.quiet_from : 23);
    val('s-quiet-to', typeof p.quiet_to === 'number' ? p.quiet_to : 9);
    val('s-lead-visit', typeof p.lead_default_visit === 'number' ? p.lead_default_visit : 4);
    val('s-lead-douhan', typeof p.lead_default_douhan === 'number' ? p.lead_default_douhan : 5);
    val('s-max-contacts', typeof p.max_contacts_month === 'number' ? p.max_contacts_month : 3);

    val('s-myrole', p.my_role || 'both');
    val('s-shimei', p.shimei_system || 'eikyu');
    val('s-douhan-type', p.douhan_reward_type || 'none');
    val('s-douhan-value', p.douhan_reward_value || 0);
    val('s-douhan-timeout', p.douhan_timeout_min || 0);
    val('s-douhan-quota', p.douhan_quota_monthly || 0);
    val('s-gas-url', a.gas_url);
    val('s-gas-token', a.token);
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

  function num(id) { return parseInt(document.getElementById(id).value, 10) || 0; }
  function str(id) { return document.getElementById(id).value.trim(); }
  function chk(id, v) { var el = document.getElementById(id); if (el) el.checked = !!v; }
  function on(id) { var el = document.getElementById(id); return !!(el && el.checked); }

  var openDays = [0, 1, 2, 3, 4, 5, 6];

  function renderOpenDays(cur) {
    openDays = (cur || []).slice();
    var wrap = UI.clear(document.getElementById('s-open-days'));
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
      open_days: openDays.length ? openDays.slice().sort() : [1, 2, 3, 4, 5, 6],
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
      my_role: document.getElementById('s-myrole').value,
      shimei_system: document.getElementById('s-shimei').value,
      douhan_reward_type: document.getElementById('s-douhan-type').value,
      douhan_reward_value: num('s-douhan-value'),
      douhan_timeout_min: num('s-douhan-timeout'),
      douhan_quota_monthly: num('s-douhan-quota'),
      lock_after_min: Math.max(0, Math.min(120, num('s-lock-after'))),

      douhan_deadline: str('s-douhan-deadline'),
      open_time: str('s-open-time'),

      cooldown_contact: Math.max(0, Math.min(30, num('s-cooldown-contact'))),
      cooldown_invite: Math.max(0, Math.min(60, num('s-cooldown-invite'))),
      quiet_from: Math.max(0, Math.min(23, num('s-quiet-from'))),
      quiet_to: Math.max(0, Math.min(23, num('s-quiet-to'))),
      lead_default_visit: Math.max(1, Math.min(30, num('s-lead-visit') || 4)),
      lead_default_douhan: Math.max(1, Math.min(30, num('s-lead-douhan') || 5)),
      max_contacts_month: Math.max(0, Math.min(20, num('s-max-contacts'))),

      configured: true
    });
    Store.saveApiConfig({ gas_url: str('s-gas-url'), token: str('s-gas-token') });
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
    renderAiUsage();
  }

  /** AIをどれだけ使ったか。クレジットの減りは推測ではなく実測で見せる */
  var AI_LABEL = {
    structure: '整理', card: '名刺', brief: '会う前の準備',
    plan: '今日の段取り', drafts: '送る文', invite: 'お誘いの文', ping: '接続の確認'
  };

  function renderAiUsage() {
    var wrap = document.getElementById('ai-usage');
    if (!wrap) return;
    UI.clear(wrap);

    var u = Store.usageThisMonth();
    if (!u) {
      wrap.appendChild(UI.el('p', 'help', '今月はまだAIを使っていません。'));
      return;
    }

    var head = UI.el('p', null,
      u.calls + '回　' + fmt(u.in + u.out) + 'トークン　およそ' + u.yen.toLocaleString('ja-JP') + '円');
    head.style.fontSize = '1.02rem';
    wrap.appendChild(head);

    var rows = Object.keys(u.by).sort(function (a, b) { return u.by[b].calls - u.by[a].calls; });
    var ul = UI.el('div', 'cards');
    rows.forEach(function (k) {
      var b = u.by[k];
      var row = UI.el('div', 'gift-row');
      var t = UI.el('span', 'gname',
        (AI_LABEL[k] || k) + '　' + b.calls + '回　' + fmt(b.in) + '→' + fmt(b.out));
      t.style.fontSize = '.9rem';
      t.style.color = 'var(--text-dim)';
      row.appendChild(t);
      ul.appendChild(row);
    });
    wrap.appendChild(ul);

    wrap.appendChild(UI.el('p', 'help',
      '「送った量→返ってきた量」です。費用は1ドル155円で見た概算で、実際の請求はAnthropicの管理画面が正です。'));
  }

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }

  function testApi() {
    var out = document.getElementById('api-test-result');
    out.className = 'test-result';
    out.textContent = '確認中…';
    Store.saveApiConfig({ gas_url: str('s-gas-url'), token: str('s-gas-token') });

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
      Store.saveApiConfig({ gas_url: str('s-gas-url'), token: str('s-gas-token') });
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
    document.getElementById('btn-save-settings').addEventListener('click', save);
    document.getElementById('btn-test-api').addEventListener('click', testApi);
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
