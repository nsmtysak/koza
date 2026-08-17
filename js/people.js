/* Kōza v2 — お客様の一覧と顧客カード */
var People = (function () {
  'use strict';

  var sortMode = 'recent';
  var query = '';
  var currentId = null;
  var currentTab = 'brief';

  var SORTS = [
    { key: 'recent', label: '最近お会いした順' },
    { key: 'stale',  label: 'ご無沙汰な順' },
    { key: 'money',  label: '売上の多い順' },
    { key: 'name',   label: 'お名前順' }
  ];

  /* ================= 一覧 ================= */

  function renderSorts() {
    var wrap = UI.clear(document.getElementById('people-sort'));
    SORTS.forEach(function (s) {
      var b = UI.el('button', 'ghost small' + (s.key === sortMode ? ' is-on' : ''), s.label);
      b.type = 'button';
      if (s.key === sortMode) b.style.borderColor = 'var(--accent-deep)', b.style.color = 'var(--accent)';
      b.addEventListener('click', function () { sortMode = s.key; renderList(); });
      wrap.appendChild(b);
    });
  }

  function renderList() {
    renderSorts();
    var list = UI.clear(document.getElementById('people-list'));
    var q = query.trim().toLowerCase();

    var rows = Store.activeCustomers().map(function (c) {
      var visits = Store.visitsOf(c.id);
      return {
        c: c,
        last: visits[0] ? visits[0].date : null,
        count: visits.length,
        money: Store.moneyOf(c.id)
      };
    });

    if (q) {
      rows = rows.filter(function (r) {
        var hay = [r.c.display_name, r.c.name, r.c.kana, r.c.company, r.c.department, r.c.title,
          (r.c.interests || []).join(' '), (r.c.tags || []).join(' '), r.c.memo].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }

    rows.sort(function (a, b) {
      if (sortMode === 'name') return (a.c.kana || a.c.display_name).localeCompare(b.c.kana || b.c.display_name, 'ja');
      if (sortMode === 'money') return b.money.total - a.money.total;
      if (sortMode === 'stale') {
        if (!a.last) return -1;
        if (!b.last) return 1;
        return a.last.localeCompare(b.last);
      }
      if (!a.last) return 1;
      if (!b.last) return -1;
      return b.last.localeCompare(a.last);
    });

    if (!rows.length) {
      list.appendChild(UI.el('p', 'empty',
        q ? '見つかりませんでした。' : 'まだお客様がいません。名刺を撮って登録するか、記録から自動で増えていきます。'));
      return;
    }

    rows.forEach(function (r) {
      list.appendChild(personCard(r));
    });
  }

  function personCard(r) {
    var card = UI.el('button', 'card');
    card.type = 'button';
    var top = UI.el('div', 'card-top');
    top.appendChild(UI.avatar(r.c));

    var name = UI.el('div', 'card-name', r.c.display_name);
    top.appendChild(name);

    var meta = UI.el('span', 'card-meta',
      r.last ? UI.sinceLabel(Store.daysBetween(r.last, Store.today())) : '未来店');
    top.appendChild(meta);
    card.appendChild(top);

    var sub = [];
    if (r.c.company) sub.push(r.c.company + (r.c.title ? ' ' + r.c.title : ''));
    if (r.count) sub.push(r.count + '回');
    if (r.money.total) sub.push(UI.yen(r.money.total));
    if (sub.length) card.appendChild(UI.el('p', 'card-body', sub.join('　/　')));

    var tags = UI.el('div', 'card-tags');
    (r.c.interests || []).slice(0, 3).forEach(function (i) { tags.appendChild(UI.chip(i)); });
    if (r.c.relation_type === 'help') tags.appendChild(UI.chip('ヘルプ'));
    if (tags.children.length) card.appendChild(tags);

    card.addEventListener('click', function () { openPerson(r.c.id); });
    return card;
  }

  /* ================= 顧客カード ================= */

  function openPerson(id, tab) {
    currentId = id;
    currentTab = tab || 'brief';
    var c = Store.getCustomer(id);
    if (!c) { UI.toast('お客様が見つかりません', true); return; }

    document.getElementById('person-title').textContent = c.display_name;
    renderHead(c);
    renderTabs();
    renderBody();
    UI.show('person');
  }

  function renderHead(c) {
    var head = UI.clear(document.getElementById('person-head'));

    /* 写真。頭文字より顔のほうが早く見つかる。
     * 画像は端末の中だけに置く（名刺と同じ扱い）。 */
    var av = UI.avatar(c, 'lg');
    av.classList.add('tappable');
    var file = UI.el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.addEventListener('change', function () {
      if (!file.files || !file.files[0]) return;
      UI.busy(true, '写真を取り込んでいます…');
      Blobs.square(file.files[0], 320).then(function (dataUrl) {
        var id = c.photo_id || Store.uid('ph');
        return Blobs.put(id, dataUrl).then(function () {
          Store.updateCustomer(c.id, { photo_id: id });
          UI.busy(false);
          renderHead(Store.getCustomer(c.id));
          UI.toast('写真を登録しました');
        });
      }).catch(function (e) {
        UI.busy(false);
        UI.toast(e.message || '取り込めませんでした', true);
      });
      file.value = '';
    });
    av.addEventListener('click', function () {
      if (!c.photo_id) { file.click(); return; }
      if (UI.confirmAsk('写真を差し替えますか。\n\n「キャンセル」を押すと、写真を外します。')) file.click();
      else {
        Blobs.remove(c.photo_id);
        Store.updateCustomer(c.id, { photo_id: null });
        renderHead(Store.getCustomer(c.id));
        UI.toast('写真を外しました');
      }
    });
    head.appendChild(av);
    head.appendChild(file);
    var pi = UI.el('div', 'pi');
    pi.appendChild(UI.el('h2', null, c.display_name));
    var line = [c.company, c.department, c.title].filter(Boolean).join(' ');
    pi.appendChild(UI.el('p', null, line || (c.name || '')));
    if (!c.photo_id) pi.appendChild(UI.el('p', 'help', '丸をタップすると写真を入れられます'));
    // 誰の口座かは、開いてすぐ分かるところに出す。ここを見落とすと事故になる
    var acc = Store.accountLabel(c);
    if (acc) {
      var chip = UI.el('span', 'chip' + (Store.isMyAccount(c) ? ' gold' : ' warn'), acc);
      var row = UI.el('div', 'card-tags');
      row.appendChild(chip);
      pi.appendChild(row);
    }
    head.appendChild(pi);
  }

  function renderTabs() {
    document.querySelectorAll('#person-tabs .tab').forEach(function (t) {
      t.classList.toggle('is-on', t.dataset.tab === currentTab);
    });
  }

  function renderBody() {
    var body = UI.clear(document.getElementById('person-body'));
    var c = Store.getCustomer(currentId);
    if (!c) return;

    if (currentTab === 'brief') renderBriefTab(body, c);
    else if (currentTab === 'profile') renderProfileTab(body, c);
    else if (currentTab === 'history') renderHistoryTab(body, c);
    else renderTouchTab(body, c);
  }

  /* ---------- 準備タブ ---------- */

  function renderBriefTab(body, c) {
    var d = Insight.digest(c.id);

    if (!Store.isMyAccount(c)) {
      var w = UI.el('div', 'banner-warn');
      w.appendChild(UI.el('h3', null, Store.accountLabel(c)));
      w.appendChild(UI.el('p', null, c.account_owner === 'free'
        ? 'フリーのお客様です。ご連絡は差し上げられます。店内でのお相手から場内でのご指名につなげます。'
        : 'こちらからのご連絡・お誘いはしません。係の方を立てて、店内でのお相手に徹します。'));
      body.appendChild(w);
    }

    // 次の予定。入っていれば、誘う相手ではなく迎える相手
    var appt = Store.nextAppointmentOf(c.id);
    if (appt) {
      var ab = UI.el('div', 'brief-sec');
      ab.appendChild(UI.el('h3', null, '次のご予定'));
      var line = UI.el('p', 'card-reason',
        UI.longDate(appt.date) + '　' + (Store.CONFIDENCE[appt.confidence] || '') +
        (appt.kind === 'douhan' ? '・同伴' : ''));
      ab.appendChild(line);
      var ed = UI.el('button', 'ghost small', 'この予定を直す');
      ed.type = 'button';
      ed.addEventListener('click', function () { Board.openAppt({ id: appt.id }); });
      ab.appendChild(ed);
      body.appendChild(ab);
    }

    // 誘ってからお越しになるまでの日数。逆算の根拠を本人にも見せる
    var lead = Plan.leadTime(c.id, 'visit');
    var rate = Plan.comeRate(c.id);
    var st = Plan.bestStyle(c.id);
    if (lead.samples || rate.samples) {
      var lb = UI.el('p', 'help');
      var bits = ['お声がけから平均' + lead.days + '日でお越しになります'];
      if (rate.samples >= 2) bits.push('お誘いへのお応えは ' + rate.came + '／' + rate.samples);
      if (st) bits.push('効いた型は「' + (Store.INVITE_STYLES[st.style] || st.style) + '」');
      lb.textContent = bits.join('　/　');
      body.appendChild(lb);
    }

    var stats = UI.el('div', 'stats');
    function stat(label, value) {
      var w = UI.el('div');
      w.appendChild(UI.el('dt', null, label));
      w.appendChild(UI.el('dd', null, value));
      stats.appendChild(w);
    }
    stat('ご来店', d.visit_count + '回');
    stat('前回', d.days_since === null ? '—' : UI.sinceLabel(d.days_since));
    stat('平均間隔', d.average_interval ? d.average_interval + '日' : '—');
    stat('累計', UI.yen(d.money.total || 0));
    stat('平均単価', d.money.average ? UI.yen(d.money.average) : '—');
    stat('同伴', String(d.visits.filter(function (v) { return v.douhan; }).length) + '回');
    body.appendChild(stats);

    /* 未回収の口実。
     * 中身は来歴から毎回組み直している。記録を直せばここも変わる。
     * 使い終わったものは「済み」にして、次から出ないようにする。 */
    if (d.open_hooks.length) {
      var s = UI.el('div', 'brief-sec');
      s.appendChild(UI.el('h3', null, '声をかけるきっかけ'));
      s.appendChild(UI.el('p', 'help', '来歴から組み直しています。使い終わったものは「済み」にすると、次から出ません。'));
      var ul = UI.el('ul', 'brief-list');
      d.open_hooks.slice(0, 8).forEach(function (h) {
        var li = UI.el('li', 'hookrow');
        li.appendChild(UI.el('span', 'hooktext', h.text));
        var sub = UI.el('p', 'help');
        sub.textContent = UI.shortDate(
          (Store.getVisit(h.visit_id) || {}).date || '') + 'の記録から';
        li.appendChild(sub);

        var done = UI.el('button', 'ghost small', '済み');
        done.type = 'button';
        done.addEventListener('click', function () {
          Store.setHookStatus(h.visit_id, h.index, 'closed');
          Store.clearDailyPlan();
          UI.toast('済みにしました');
          renderBody();
        });
        li.appendChild(done);
        ul.appendChild(li);
      });
      s.appendChild(ul);
      body.appendChild(s);
    }

    var last = Store.latestBrief(c.id);
    if (last) {
      var prev = UI.el('div', 'brief-sec');
      prev.appendChild(UI.el('h3', null, '前回の準備（' + UI.shortDate(last.created_at.slice(0, 10)) + '）'));
      var p = UI.el('div', 'brief-summary', last.summary || '');
      prev.appendChild(p);
      var open = UI.el('button', 'ghost full', 'この準備をもう一度見る');
      open.type = 'button';
      open.addEventListener('click', function () { Brief.show(last.id); });
      prev.appendChild(open);
      body.appendChild(prev);
    }

    var act = UI.el('div', 'actions col');

    var mk = UI.el('button', 'primary', last ? '最新の内容で準備し直す' : '会う前の準備をする');
    mk.type = 'button';
    mk.addEventListener('click', function () { Brief.generate(c.id, 'visit'); });
    act.appendChild(mk);

    // ほかの方の口座には、お誘いの導線そのものを出さない
    if (Store.canContactDirectly(c)) {
      var inv = UI.el('button', 'ghost', 'お誘いの文をつくる');
      inv.type = 'button';
      inv.addEventListener('click', function () {
        var cand = Plan.candidates().filter(function (x) { return x.customer.id === c.id; })[0];
        Invite.open(c.id, { target_date: cand ? cand.target_date : '', kind: 'visit' });
      });
      act.appendChild(inv);

      var call = UI.el('button', 'ghost', '連絡する言葉を用意する');
      call.type = 'button';
      call.addEventListener('click', function () { Brief.generate(c.id, 'contact'); });
      act.appendChild(call);
    }

    var ap = UI.el('button', 'ghost', 'ご来店の予定を入れる');
    ap.type = 'button';
    ap.addEventListener('click', function () { Board.openAppt({ customer_id: c.id }); });
    act.appendChild(ap);

    var rec = UI.el('button', 'ghost', 'この方の来歴を記録する');
    rec.type = 'button';
    rec.addEventListener('click', function () {
      Record.open({ prefill: c.display_name + 'が', brief_id: last ? last.id : null });
    });
    act.appendChild(rec);

    body.appendChild(act);
  }

  /* ---------- プロフィールタブ ---------- */

  function renderProfileTab(body, c) {
    if (c.card_image_id) {
      var img = UI.el('img', 'card-img');
      img.alt = '名刺';
      Blobs.get(c.card_image_id).then(function (d) { if (d) img.src = d; });
      body.appendChild(img);
    }

    var form = UI.el('div', 'form');

    function text(key, label, type, ph) {
      var f = UI.el('label', 'f');
      f.appendChild(UI.el('span', null, label));
      var i = UI.el('input');
      i.type = type || 'text';
      i.value = c[key] || '';
      if (ph) i.placeholder = ph;
      i.addEventListener('change', function () {
        var patch = {}; patch[key] = i.value.trim();
        Store.updateCustomer(c.id, patch);
        if (key === 'display_name') { renderHead(Store.getCustomer(c.id)); document.getElementById('person-title').textContent = i.value; }
        UI.toast('保存しました');
      });
      f.appendChild(i);
      return f;
    }

    form.appendChild(text('display_name', 'お呼びする名前'));
    form.appendChild(text('name', 'お名前（本名）'));
    form.appendChild(text('kana', 'よみ'));
    form.appendChild(text('company', '会社'));

    var g1 = UI.el('div', 'grid2');
    g1.appendChild(text('department', '部署'));
    g1.appendChild(text('title', '役職'));
    form.appendChild(g1);

    var g2 = UI.el('div', 'grid2');
    g2.appendChild(text('mobile', '携帯', 'tel'));
    g2.appendChild(text('phone', '電話', 'tel'));
    form.appendChild(g2);

    form.appendChild(text('email', 'メール', 'email'));
    form.appendChild(text('address', 'ご住所'));
    form.appendChild(text('birthday', 'お誕生日', 'text', '例）08-16 もしくは 1972-08-16'));

    /* 口座。
     * ここが正しくないと、ほかの方のお客様に誘いをかけてしまう。
     * 永久指名制の店では、それは取り返しがつかない。だから上のほうに置く。 */
    var acc = UI.el('div', 'f');
    acc.appendChild(UI.el('span', null, 'どなたの口座ですか'));
    acc.appendChild(UI.segmented(
      [{ value: 'self', label: '自分' }, { value: 'mama', label: 'ママ' },
       { value: 'other', label: 'ほかの方' }, { value: 'free', label: 'フリー' }],
      c.account_owner || 'self',
      function (v) {
        Store.updateCustomer(c.id, { account_owner: v });
        Store.clearDailyPlan();
        ownerName.hidden = v !== 'other';
        renderHead(Store.getCustomer(c.id));
      }
    ));
    acc.appendChild(UI.el('p', 'help',
      'ほかの方・ママの口座にした方には、こちらからのお誘いを出しません。店内でのお相手だけになります。'));
    form.appendChild(acc);

    var ownerName = UI.el('label', 'f');
    ownerName.appendChild(UI.el('span', null, 'どなたの口座か（お名前）'));
    var oi = UI.el('input');
    oi.type = 'text';
    oi.value = c.account_owner_name || '';
    oi.placeholder = '係の方の源氏名';
    oi.addEventListener('change', function () {
      Store.updateCustomer(c.id, { account_owner_name: oi.value.trim() });
      renderHead(Store.getCustomer(c.id));
      UI.toast('保存しました');
    });
    ownerName.appendChild(oi);
    ownerName.hidden = (c.account_owner || 'self') !== 'other';
    form.appendChild(ownerName);

    // 立場
    var rel = UI.el('div', 'f');
    rel.appendChild(UI.el('span', null, 'この方との関係'));
    rel.appendChild(UI.segmented(
      [{ value: 'kakari', label: '自分の係' }, { value: 'help', label: 'ヘルプで' }, { value: 'other', label: 'その他' }],
      c.relation_type,
      function (v) { Store.updateCustomer(c.id, { relation_type: v }); }
    ));
    form.appendChild(rel);

    // ご家族
    var fam = UI.el('div', 'f');
    fam.appendChild(UI.el('span', null, 'ご家族'));
    var famList = UI.el('div', 'cards');
    function renderFamily() {
      UI.clear(famList);
      (Store.getCustomer(c.id).family || []).forEach(function (f, i) {
        var row = UI.el('div', 'gift-row');
        var t = UI.el('span', 'gname',
          f.relation + (f.name ? '・' + f.name : '') + (f.note ? '（' + f.note + '）' : '') +
          (f.birthday ? ' ' + f.birthday : ''));
        row.appendChild(t);
        var del = UI.el('button', null, '外す');
        del.type = 'button';
        del.style.background = 'transparent';
        del.style.borderColor = 'var(--ink-3)';
        del.style.color = 'var(--text-faint)';
        del.addEventListener('click', function () {
          var cur = Store.getCustomer(c.id).family.slice();
          cur.splice(i, 1);
          Store.updateCustomer(c.id, { family: cur });
          renderFamily();
        });
        row.appendChild(del);
        famList.appendChild(row);
      });
    }
    renderFamily();
    fam.appendChild(famList);

    var famAdd = UI.el('div', 'tag-input');
    var fRel = UI.el('input'); fRel.type = 'text'; fRel.placeholder = '続柄（ご長女など）';
    var fName = UI.el('input'); fName.type = 'text'; fName.placeholder = 'お名前・ひとこと';
    var fAdd = UI.el('button', 'ghost small', '追加'); fAdd.type = 'button';
    fAdd.addEventListener('click', function () {
      if (!fRel.value.trim()) return;
      var cur = (Store.getCustomer(c.id).family || []).slice();
      cur.push({ relation: fRel.value.trim(), name: fName.value.trim(), note: '', birthday: '' });
      Store.updateCustomer(c.id, { family: cur });
      fRel.value = ''; fName.value = '';
      renderFamily();
    });
    famAdd.appendChild(fRel); famAdd.appendChild(fName); famAdd.appendChild(fAdd);
    fam.appendChild(famAdd);
    form.appendChild(fam);

    // 趣味・好み
    function listField(label, getter, setter, ph) {
      var f = UI.el('div', 'f');
      f.appendChild(UI.el('span', null, label));
      f.appendChild(UI.tagEditor(getter(), ph, setter));
      return f;
    }

    form.appendChild(listField('趣味・興味',
      function () { return Store.getCustomer(c.id).interests; },
      function (v) { Store.updateCustomer(c.id, { interests: v }); }, 'ゴルフ、釣り…'));

    form.appendChild(listField('お好みのお酒',
      function () { return Store.getCustomer(c.id).prefs.drinks; },
      function (v) { var p = Object.assign({}, Store.getCustomer(c.id).prefs, { drinks: v });
        Store.updateCustomer(c.id, { prefs: p }); }, '芋の水割り…'));

    form.appendChild(listField('お好みの食べ物',
      function () { return Store.getCustomer(c.id).prefs.food; },
      function (v) { var p = Object.assign({}, Store.getCustomer(c.id).prefs, { food: v });
        Store.updateCustomer(c.id, { prefs: p }); }, '鮨、蕎麦…'));

    form.appendChild(listField('苦手なもの',
      function () { return Store.getCustomer(c.id).prefs.dislikes; },
      function (v) { var p = Object.assign({}, Store.getCustomer(c.id).prefs, { dislikes: v });
        Store.updateCustomer(c.id, { prefs: p }); }, ''));

    form.appendChild(listField('触れない話題',
      function () { return Store.getCustomer(c.id).ng_topics; },
      function (v) { Store.updateCustomer(c.id, { ng_topics: v }); }, '例）前の会社のこと'));

    // 贈答の方針
    var gp = UI.el('div', 'f');
    gp.appendChild(UI.el('span', null, 'ご挨拶を出す'));
    var gpRow = UI.el('div', 'f inline');
    [['nenga', '年賀状'], ['ochugen', 'お中元'], ['oseibo', 'お歳暮']].forEach(function (k) {
      var lab = UI.el('label', 'chk');
      var cb = UI.el('input'); cb.type = 'checkbox';
      cb.checked = !!(Store.getCustomer(c.id).gift_policy || {})[k[0]];
      cb.addEventListener('change', function () {
        var pol = Object.assign({}, Store.getCustomer(c.id).gift_policy);
        pol[k[0]] = cb.checked;
        Store.updateCustomer(c.id, { gift_policy: pol });
      });
      lab.appendChild(cb); lab.appendChild(UI.el('span', null, k[1]));
      gpRow.appendChild(lab);
    });
    gp.appendChild(gpRow);
    form.appendChild(gp);

    // 覚え書き
    var memo = UI.el('label', 'f');
    memo.appendChild(UI.el('span', null, '覚え書き'));
    var ta = UI.el('textarea'); ta.rows = 4; ta.value = c.memo || '';
    ta.addEventListener('change', function () {
      Store.updateCustomer(c.id, { memo: ta.value });
      UI.toast('保存しました');
    });
    memo.appendChild(ta);
    form.appendChild(memo);

    body.appendChild(form);

    var act = UI.el('div', 'actions col');
    var cardBtn = UI.el('button', 'ghost', c.card_image_id ? '名刺を撮り直す' : '名刺を撮る');
    cardBtn.type = 'button';
    cardBtn.addEventListener('click', function () { Scan.open(c.id); });
    act.appendChild(cardBtn);
    body.appendChild(act);

    var danger = UI.el('div', 'actions');
    var del = UI.el('button', 'danger', 'このお客様を削除する');
    del.type = 'button';
    del.addEventListener('click', function () {
      if (!UI.confirmAsk(c.display_name + ' と、その来歴・接点をすべて削除します。元に戻せません。')) return;
      Store.deleteCustomer(c.id);
      UI.toast('削除しました');
      UI.show('people', { replace: true });
      renderList();
    });
    danger.appendChild(del);
    body.appendChild(danger);
  }

  /* ---------- 来歴タブ ---------- */

  function renderHistoryTab(body, c) {
    var visits = Store.visitsOf(c.id);

    var comp = Store.companionsOf(c.id);
    if (comp.length) {
      var s = UI.el('div', 'brief-sec');
      s.appendChild(UI.el('h3', null, 'よくご一緒される方'));
      var wrap = UI.el('div', 'cards');
      comp.slice(0, 5).forEach(function (x) {
        var b = UI.el('button', 'card');
        b.type = 'button';
        var top = UI.el('div', 'card-top');
        top.appendChild(UI.avatar(x.customer));
        top.appendChild(UI.el('div', 'card-name', x.customer.display_name));
        top.appendChild(UI.el('span', 'card-meta', x.times + '回'));
        b.appendChild(top);
        b.addEventListener('click', function () { openPerson(x.customer.id); });
        wrap.appendChild(b);
      });
      s.appendChild(wrap);
      body.appendChild(s);
    }

    /* これまでの流れ。
     * ご来店とご連絡を一本の時系列にする。
     * 「前に何を話したか」は、来店だけ・連絡だけを見ても思い出せない。 */
    var sec = UI.el('div', 'brief-sec');
    sec.appendChild(UI.el('h3', null, 'これまでの流れ'));
    sec.appendChild(UI.el('p', 'help', 'ご来店とご連絡を、新しい順に並べています。ご来店をタップすると直せます。'));

    var items = [];
    visits.forEach(function (v) { items.push({ date: v.date, kind: 'visit', v: v }); });
    Store.touchesOf(c.id).forEach(function (t) { items.push({ date: t.date, kind: 'touch', t: t }); });
    items.sort(function (a, b) {
      if (a.date === b.date) return a.kind === 'visit' ? -1 : 1;
      return b.date.localeCompare(a.date);
    });

    var list = UI.el('div', 'cards');

    if (!items.length) {
      list.appendChild(UI.el('p', 'empty', 'まだ記録がありません。'));
    } else {
      items.forEach(function (it) {
        list.appendChild(it.kind === 'visit' ? visitCard(it.v, c) : touchCard(it.t));
      });
    }
    sec.appendChild(list);
    body.appendChild(sec);
  }

  /** ご来店1回分。会話の中身をここで全部読めるようにする */
  function visitCard(v, c) {
    var card = UI.el('button', 'card');
    card.type = 'button';

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.el('div', 'card-name', UI.longDate(v.date)));
    if (typeof v.spend === 'number' && v.spend > 0) {
      top.appendChild(UI.el('span', 'card-meta', UI.yen(v.spend)));
    }
    card.appendChild(top);

    var tags = UI.el('div', 'card-tags');
    (v.attendees || []).forEach(function (a) {
      if (a.customer_id === c.id) {
        if (a.role === 'shukyaku') tags.appendChild(UI.chip('主客', 'gold'));
        return;
      }
      var o = Store.getCustomer(a.customer_id);
      if (o) tags.appendChild(UI.chip('ご一緒：' + o.display_name));
    });
    if (v.douhan) tags.appendChild(UI.chip('同伴', 'gold'));
    if (v.kirikaeshi) tags.appendChild(UI.chip('切り返し', 'warn'));
    if (v.nominaoshi) tags.appendChild(UI.chip('飲み直し'));
    if (v.set_count) tags.appendChild(UI.chip(v.set_count + 'セット'));
    if (v.bottle) tags.appendChild(UI.chip('ボトル：' + v.bottle, 'gold'));
    if (tags.children.length) card.appendChild(tags);

    if (v.topic_detail) {
      var t = UI.el('p', 'talk');
      t.textContent = v.topic_detail;
      card.appendChild(t);
    }
    if (v.observation) {
      var o = UI.el('p', 'card-body');
      o.style.color = 'var(--text-dim)';
      o.textContent = 'ご様子：' + v.observation;
      card.appendChild(o);
    }
    if ((v.drinks || []).length) {
      card.appendChild(UI.el('p', 'card-body', '召し上がったもの：' +
        v.drinks.map(function (d) { return d.count > 1 ? d.item + ' ×' + d.count : d.item; }).join('、')));
    }

    // その回に拾った口実。次の連絡の材料はここにある
    var hooks = Insight.hooksFor ? Insight.hooksFor(v, c.id) : (v.hooks || []);
    if (hooks.length) {
      var hb = UI.el('div', 'hook-box');
      hb.appendChild(UI.el('div', 'hook-h', '声をかけるきっかけ'));
      hooks.forEach(function (h) {
        var li = UI.el('div', 'hook-i' + (h.status === 'closed' ? ' done' : ''), '・' + h.text);
        hb.appendChild(li);
      });
      card.appendChild(hb);
    }

    if (v.raw_memo) {
      var det = UI.el('details', 'raw');
      det.appendChild(UI.el('summary', null, '話した言葉のまま'));
      det.appendChild(UI.el('p', null, v.raw_memo));
      // details の開閉でカードのタップが走らないようにする
      det.addEventListener('click', function (ev) { ev.stopPropagation(); });
      card.appendChild(det);
    }

    card.addEventListener('click', function () { Record.openEdit(v.id); });
    return card;
  }

  /** ご連絡・贈答1件分 */
  function touchCard(t) {
    var row = UI.el('div', 'card touch-row');

    var top = UI.el('div', 'card-top');
    top.appendChild(UI.el('span', 'soon-when', UI.shortDate(t.date)));
    top.appendChild(UI.el('div', 'card-name', Store.TOUCH_KINDS[t.kind] || t.kind));
    if (t.intent === 'invite') {
      top.appendChild(UI.chip(t.title || 'お誘い', 'gold'));
      if (t.style) top.appendChild(UI.chip(Store.INVITE_STYLES[t.style] || t.style));
    }
    row.appendChild(top);

    if (t.note) {
      var n = UI.el('p', 'talk');
      n.textContent = t.note;
      row.appendChild(n);
    }

    // 誘いがどうなったか。ここが次の逆算の材料になる
    if (t.intent === 'invite') {
      var bits = [];
      if (t.target_date) bits.push(UI.shortDate(t.target_date) + 'を狙って');
      if (t.result === 'came') bits.push('お越しいただけました' + (t.came_date ? '（' + UI.shortDate(t.came_date) + '）' : ''));
      else if (t.result === 'missed') bits.push('このお誘いではお越しになりませんでした');
      else if (t.result === 'superseded') bits.push('あとのお誘いに引き継ぎ');
      else bits.push('お返事待ち');
      var r = UI.el('p', 'card-body');
      r.style.color = t.result === 'came' ? 'var(--accent)' : 'var(--text-faint)';
      r.textContent = bits.join('　/　');
      row.appendChild(r);
    }

    return row;
  }

  /* ---------- 接点タブ ---------- */

  function renderTouchTab(body, c) {
    var add = UI.el('div', 'brief-sec');
    add.appendChild(UI.el('h3', null, '接点を足す'));

    var kinds = UI.el('div', 'filter-row');
    Object.keys(Store.TOUCH_KINDS).forEach(function (k) {
      var b = UI.el('button', 'ghost small', Store.TOUCH_KINDS[k]);
      b.type = 'button';
      b.addEventListener('click', function () {
        Store.addTouch({ customer_id: c.id, kind: k, direction: 'sent', date: Store.today() });
        UI.toast(Store.TOUCH_KINDS[k] + 'を記録しました');
        renderBody();
      });
      kinds.appendChild(b);
    });
    add.appendChild(kinds);
    body.appendChild(add);

    var sec = UI.el('div', 'brief-sec');
    sec.appendChild(UI.el('h3', null, 'これまでの接点'));
    var list = UI.el('div', 'cards');
    var touches = Store.touchesOf(c.id);

    if (!touches.length) {
      list.appendChild(UI.el('p', 'empty', 'まだ記録がありません。'));
    } else {
      touches.forEach(function (t) {
        var row = UI.el('div', 'gift-row');
        var name = UI.el('span', 'gname',
          UI.shortDate(t.date) + '　' + (Store.TOUCH_KINDS[t.kind] || t.kind) +
          (t.note ? '　' + t.note : ''));
        row.appendChild(name);
        var del = UI.el('button', null, '外す');
        del.type = 'button';
        del.style.background = 'transparent';
        del.style.borderColor = 'var(--ink-3)';
        del.style.color = 'var(--text-faint)';
        del.addEventListener('click', function () {
          Store.deleteTouch(t.id);
          renderBody();
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }
    sec.appendChild(list);
    body.appendChild(sec);
  }

  /* ---------- 手で登録 ---------- */

  function createBlank() {
    var name = window.prompt('お呼びする名前を入れてください（例：田中様）');
    if (!name) return;
    var c = Store.createCustomer({ display_name: name.trim(), name: name.trim().replace(/(様|さん)$/, '') });
    openPerson(c.id, 'profile');
  }

  function init() {
    document.getElementById('people-search').addEventListener('input', function (e) {
      query = e.target.value; renderList();
    });
    document.getElementById('btn-scan-card').addEventListener('click', function () { Scan.open(); });
    document.getElementById('btn-new-person').addEventListener('click', createBlank);
    document.getElementById('person-back').addEventListener('click', function () { UI.back('people'); });
    document.querySelectorAll('#person-tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        currentTab = t.dataset.tab;
        renderTabs(); renderBody();
      });
    });
  }

  return {
    init: init, renderList: renderList, openPerson: openPerson,
    refresh: function () { if (currentId) renderBody(); }
  };
})();
