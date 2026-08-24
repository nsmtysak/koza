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
    // ご無沙汰な順で上に来る方なので、印が無いと理由が分からなくなる
    if (r.c.standing) tags.appendChild(UI.chip(Store.STANDING[r.c.standing] || '', 'warn'));
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
    renderContactRow(c);
  }

  /**
   * 連絡の導線。
   *
   * **LINEと電話のボタンは外した。**（施主の指示・2026-08-23）
   *
   * LINEには、相手を指定して開く方法が公開されていない。
   * ボタンが開けるのは**最後に見ていたトーク**であって、この方ではない。
   * 別の方の画面が開いたことに気づかず打ち込めば、
   * ここまでの記録が無駄になるどころか、店ごと信を失う。
   *   「間違った客の話を別の客に送りかねない」（現場の評価より）
   *
   * 電話も、画面から一続きで発信まで行ってしまう。
   * こちらの都合で鳴らす道具を、押しやすいところに置いておく理由がない。
   *
   * 相手を探す手間は本人に戻るが、**そのほうが安い。**
   * 番号もLINEの表示名も、プロフィールの欄にそのまま残してある。
   */
  function renderContactRow(c) {
    var host = UI.clear(document.getElementById('person-contact'));
    var any = false;

    function link(label, href, note) {
      var a = UI.el('a', 'contact-btn', label);
      a.href = href;
      if (note) a.title = note;
      host.appendChild(a);
      any = true;
    }

    if (c.email) link('メール', 'mailto:' + c.email);

    host.hidden = !any;
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

  /* ---------- いまの間柄 ----------
   *
   * こちらの努力ではどうにもならない事情で、お越しになれなくなることがある。
   * ご転勤、ご退職、お立場の変化、接待の枠そのものが無くなること。
   * 記憶を尽くしても戻らないものは戻らない。
   *
   * それでも候補に並び続けると、来られない方が「ご無沙汰な順」の上に居座って、
   * 動くべき方が埋もれる。そして声をかけていない負い目だけが残る。
   *
   * **だから、間隔が空いたら尋ねる。決めるのは本人。**
   * 機械が「この方はもう来ない」と判定してはいけない。
   */
  function renderStanding(body, c, d) {
    // すでに決めておられる方。いつでも戻せるようにしておく
    if (c.standing) {
      var box = UI.el('div', 'banner-warn');
      box.appendChild(UI.el('h3', null, Store.STANDING[c.standing] || ''));
      var bits = [];
      if (c.standing_reason) bits.push(c.standing_reason);
      if (c.standing_at) bits.push(UI.shortDate(c.standing_at) + 'にそう記録しています');
      if (bits.length) box.appendChild(UI.el('p', null, bits.join('　/　')));
      box.appendChild(UI.el('p', null, c.standing === 'closed'
        ? 'お声がけの候補からも、記念日からも外れています。'
        : 'お声がけの候補から外れています。記念日とご挨拶は続きます。'));

      var back = UI.el('button', 'ghost small', 'お付き合いが続いている、に戻す');
      back.type = 'button';
      back.addEventListener('click', function () {
        Store.setStanding(c.id, null, '');
        openPerson(c.id, 'brief');
        UI.toast('戻しました');
      });
      box.appendChild(back);
      body.appendChild(box);
      return;
    }

    /* まだ決めておられない方。間隔が平均の2倍を超えたら、一度だけ尋ねる。
     * 記録が少ない方に尋ねると、ただの早合点になる */
    var avg = d ? d.average_interval : 0;
    var since = d ? d.days_since : null;
    if (!avg || since === null || d.visit_count < 3 || since < avg * 2) return;

    var ask = UI.el('div', 'block');
    ask.appendChild(UI.el('h3', 'sect', 'この方は、いかがでしょうか'));
    ask.appendChild(UI.el('p', 'help',
      'いつもは' + avg + '日ほどの間隔が、今日で' + since + '日です。' +
      'ご事情でお越しになれないのであれば、ここで外しておけます。' +
      'そのほうが、動ける方に手が回ります。'));

    var row = UI.el('div', 'card-acts');

    var pause = UI.el('button', 'ghost small', 'ご事情があって、いまは難しい');
    pause.type = 'button';
    pause.addEventListener('click', function () { askReason(c, 'paused'); });
    row.appendChild(pause);

    var close = UI.el('button', 'ghost small', '区切りがついた');
    close.type = 'button';
    close.addEventListener('click', function () { askReason(c, 'closed'); });
    row.appendChild(close);

    ask.appendChild(row);
    ask.appendChild(UI.el('p', 'help',
      'まだ分からなければ、何も押さずにそのままで構いません。'));
    body.appendChild(ask);
  }

  /** なぜそうなったかを残す。残さないと、半年後にただの放置と見分けがつかない */
  function askReason(c, standing) {
    var body = UI.clear(document.getElementById('person-body'));
    var box = UI.el('div', 'block');
    box.appendChild(UI.el('h3', 'sect',
      standing === 'closed' ? '区切りがついた、として記録します' : 'いまは難しい、として記録します'));
    box.appendChild(UI.el('p', 'help', '差し支えなければ、事情を残しておいてください。'));

    var chosen = '';
    var wrap = UI.el('div', 'card-tags');
    Store.STANDING_REASONS.forEach(function (label) {
      var b = UI.el('button', 'ghost small', label);
      b.type = 'button';
      b.addEventListener('click', function () {
        chosen = label;
        // .ghost には .is-on のスタイルが無い。並べ替えの見出しと同じやり方で色を付ける
        wrap.querySelectorAll('button').forEach(function (x) {
          x.style.borderColor = '';
          x.style.color = '';
        });
        b.style.borderColor = 'var(--accent-deep)';
        b.style.color = 'var(--accent)';
      });
      wrap.appendChild(b);
    });
    box.appendChild(wrap);

    var note = UI.el('textarea');
    note.rows = 2;
    note.placeholder = '補足があれば（任意）';
    box.appendChild(note);

    var acts = UI.el('div', 'card-acts');
    var ok = UI.el('button', 'primary small', 'これで残す');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      var reason = [chosen, note.value.trim()].filter(String).join('　');
      Store.setStanding(c.id, standing, reason);
      openPerson(c.id, 'brief');
      UI.toast('記録しました');
    });
    acts.appendChild(ok);

    var cancel = UI.el('button', 'ghost small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { openPerson(c.id, 'brief'); });
    acts.appendChild(cancel);

    box.appendChild(acts);
    body.appendChild(box);
  }

  /* ---------- 準備タブ ---------- */

  function renderBriefTab(body, c) {
    var d = Insight.digest(c.id);

    renderStanding(body, c, d);

    if (!Store.isMyAccount(c)) {
      var w = UI.el('div', 'banner-warn');
      w.appendChild(UI.el('h3', null, Store.accountLabel(c)));
      w.appendChild(UI.el('p', null, c.account_owner === 'free'
        ? 'フリーのお客様です。ご連絡は差し上げられます。店内でのお相手から場内でのご指名につなげます。'
        : 'こちらからのご連絡・お誘いはしません。係の方を立てて、店内でのお相手に徹します。'));
      body.appendChild(w);
    }

    /* 日待ちのお話。日が無いので盤面には出ないが、
     * ここに出さないと「行くよ」と仰せられたことごと見失う */
    var sched = Store.schedulingOf(c.id);
    if (sched) {
      var sb2 = UI.el('div', 'brief-sec');
      sb2.appendChild(UI.el('h3', null, '日程調整'));
      sb2.appendChild(UI.el('p', 'card-reason',
        'お越しになるお話をいただいています' +
        (sched.kind === 'douhan' ? '（同伴）' : '') +
        (sched.note ? '　「' + sched.note + '」' : '') + '。日を決めていただければ、枠に入ります。'));
      var ed2 = UI.el('button', 'ghost small', '日を入れる');
      ed2.type = 'button';
      ed2.addEventListener('click', function () { Board.openAppt({ id: sched.id }); });
      sb2.appendChild(ed2);
      body.appendChild(sb2);
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
    if (lead.samples || rate.samples) {
      var lb = UI.el('p', 'help');
      var bits = ['お声がけから平均' + lead.days + '日でお越しになります'];
      if (rate.samples >= 2) bits.push('お誘いへのお応えは ' + rate.came + '／' + rate.samples);
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

    /* ご趣味から、その分野の手引きへ。
     *
     * 「ゴルフがお好き」と知っているだけでは、席で「へぇー」しか返せない。
     * 深く伺うには、こちらが少し知っている必要がある。
     * ここは**その方についての話ではなく、分野の話**へ渡す入口である。 */
    var ints = (c.interests || []).filter(Boolean);
    if (ints.length) {
      var sb = UI.el('div', 'brief-sec');
      sb.appendChild(UI.el('h3', null, '席で伺うために、覚えておくこと'));
      sb.appendChild(UI.el('p', 'help',
        '下の分野を押すと、席で使えるところだけをまとめます。'));
      var row = UI.el('div', 'card-tags');
      ints.slice(0, 6).forEach(function (t) {
        /* 分野名だけだと、ほかの画面の趣味タグと見分けがつかず、押すものだと分からない。
         * 動詞まで書くと、はじめて押せるものに見える */
        var b = UI.el('button', 'ghost small study-go',
          t + (Store.getStudy(t) ? 'を読む' : 'を覚える'));
        b.type = 'button';
        b.addEventListener('click', function () { Study.open(t); });
        row.appendChild(b);
      });
      sb.appendChild(row);
      body.appendChild(sb);
    }

    var act = UI.el('div', 'actions col');

    var mk = UI.el('button', 'primary', last ? '最新の内容で準備し直す' : '会う前の準備をする');
    mk.type = 'button';
    mk.addEventListener('click', function () { Brief.generate(c.id, 'visit'); });
    act.appendChild(mk);

    // ほかの方の口座には、お誘いの導線そのものを出さない
    if (Store.canContactDirectly(c)) {
      var inv = UI.el('button', 'ghost', '話のきっかけを見る');
      inv.type = 'button';
      inv.addEventListener('click', function () {
        var cand = Plan.candidates().filter(function (x) { return x.customer.id === c.id; })[0];
        Invite.open(c.id, { target_date: cand ? cand.target_date : '', kind: 'visit' });
      });
      act.appendChild(inv);

      var call = UI.el('button', 'ghost', 'ご連絡の前に下調べをする');
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

    form.appendChild(text('line', 'LINEの表示名', 'text', '相手を探すときの手がかり'));
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
      c.account_owner,
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

    /* お預かりしているボトル。
     * 「そろそろ空きます」は、いちばん自然にお声がけできる理由。
     * ここが埋まって初めて、AIは期限のあるお誘いを書ける。 */
    var bt = UI.el('div', 'f');
    bt.appendChild(UI.el('span', null, 'お預かりしているボトル'));
    var blist = UI.el('div', 'cards');
    (c.bottles || []).forEach(function (b) {
      var row = UI.el('div', 'gift-row');
      row.appendChild(UI.el('span', 'gname',
        b.name + '　' + UI.shortDate(b.opened_at) + '〜'));
      var sel = UI.el('select');
      sel.style.width = 'auto';
      sel.style.minHeight = '40px';
      Object.keys(Store.REMAIN).forEach(function (k) {
        var o = UI.el('option', null, Store.REMAIN[k]);
        o.value = k;
        if (b.remain === k) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        Store.updateBottle(c.id, b.id, { remain: sel.value });
        Store.clearDailyPlan();
        renderBody();
      });
      row.appendChild(sel);
      var del = UI.el('button', 'chip-x', '×');
      del.type = 'button';
      del.addEventListener('click', function () {
        Store.removeBottle(c.id, b.id);
        renderBody();
      });
      row.appendChild(del);
      blist.appendChild(row);
    });
    if (!(c.bottles || []).length) blist.appendChild(UI.el('p', 'help', 'ありません'));
    bt.appendChild(blist);

    var badd = UI.el('div', 'tag-input');
    var bi = UI.el('input');
    bi.type = 'text';
    bi.placeholder = '銘柄（響17年 など）';
    var bb = UI.el('button', 'ghost small', '入れていただいた');
    bb.type = 'button';
    bb.addEventListener('click', function () {
      var v = bi.value.trim();
      if (!v) return;
      Store.addBottle(c.id, { name: v });
      bi.value = '';
      renderBody();
    });
    badd.appendChild(bi); badd.appendChild(bb);
    bt.appendChild(badd);
    bt.appendChild(UI.el('p', 'help',
      '「そろそろ空きます」にすると、お声がけの候補に出ます。話のきっかけにもなります。'));
    form.appendChild(bt);

    /* ご紹介くださった方。
     * これまで判定するコードだけがあって、入れる場所が無かった。
     * 紹介者へのお礼は、ご本人へのお礼より先に出す筋のもの。 */
    var intro = UI.el('div', 'f');
    intro.appendChild(UI.el('span', null, 'ご紹介くださった方'));
    var isel = UI.el('select');
    var none = UI.el('option', null, '（なし）');
    none.value = '';
    isel.appendChild(none);
    Store.activeCustomers().forEach(function (o) {
      if (o.id === c.id) return;
      var op = UI.el('option', null, o.display_name + (o.company ? '（' + o.company + '）' : ''));
      op.value = o.id;
      if (c.intro_by === o.id) op.selected = true;
      isel.appendChild(op);
    });
    isel.addEventListener('change', function () {
      Store.updateCustomer(c.id, { intro_by: isel.value || null });
      UI.toast('保存しました');
    });
    intro.appendChild(isel);
    form.appendChild(intro);

    /* 顔を合わせない方が良い相手。判定はあったが入れる場所が無かった */
    var avoid = UI.el('div', 'f');
    avoid.appendChild(UI.el('span', null, '顔を合わせない方が良い相手'));
    var alist = UI.el('div', 'tag-list');
    (c.avoid_pair || []).forEach(function (id) {
      var o = Store.getCustomer(id);
      if (!o) return;
      var t = UI.el('span', 'chip removable warn', o.display_name);
      var x = UI.el('button', 'chip-x', '×');
      x.type = 'button';
      x.addEventListener('click', function () {
        Store.updateCustomer(c.id, {
          avoid_pair: (c.avoid_pair || []).filter(function (v) { return v !== id; })
        });
        renderBody();
      });
      t.appendChild(x);
      alist.appendChild(t);
    });
    if (!(c.avoid_pair || []).length) alist.appendChild(UI.el('span', 'help', 'ありません'));
    avoid.appendChild(alist);

    var asel = UI.el('select');
    var an = UI.el('option', null, '（選ぶと足します）');
    an.value = '';
    asel.appendChild(an);
    Store.activeCustomers().forEach(function (o) {
      if (o.id === c.id || (c.avoid_pair || []).indexOf(o.id) >= 0) return;
      var op = UI.el('option', null, o.display_name + (o.company ? '（' + o.company + '）' : ''));
      op.value = o.id;
      asel.appendChild(op);
    });
    asel.addEventListener('change', function () {
      if (!asel.value) return;
      Store.updateCustomer(c.id, { avoid_pair: (c.avoid_pair || []).concat([asel.value]) });
      renderBody();
    });
    avoid.appendChild(asel);
    avoid.appendChild(UI.el('p', 'help', '同じ日に予定を入れようとすると、確認が出ます。'));
    form.appendChild(avoid);

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

    /* ご在宅になりやすい曜日。
     * 深夜を避けるだけでは足りない。ご在宅の日に届けば、ご家族の目に触れる。 */
    var qd = UI.el('div', 'f');
    qd.appendChild(UI.el('span', null, 'ご連絡を控える曜日'));
    var qdRow = UI.el('div', 'daypick');
    ['日', '月', '火', '水', '木', '金', '土'].forEach(function (label, i) {
      var cur = Store.getCustomer(c.id).quiet_days || [];
      var b = UI.el('button', 'daybtn' + (cur.indexOf(i) >= 0 ? ' is-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', function () {
        var days = (Store.getCustomer(c.id).quiet_days || []).slice();
        var at = days.indexOf(i);
        if (at >= 0) days.splice(at, 1); else days.push(i);
        Store.updateCustomer(c.id, { quiet_days: days.sort() });
        b.classList.toggle('is-on', days.indexOf(i) >= 0);
      });
      qdRow.appendChild(b);
    });
    qd.appendChild(qdRow);
    qd.appendChild(UI.el('span', 'help',
      'ご在宅になりやすい曜日です。その日にお送りすると、ご家族の目に触れることがあります。'));
    form.appendChild(qd);

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
    if (t.intent === 'invite') top.appendChild(UI.chip(t.title || 'お誘い', 'gold'));
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
    var st = document.getElementById('btn-study');
    if (st) st.addEventListener('click', function () { Study.open(null); });
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
