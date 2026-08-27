/* Kōza v2 — 今夜の分
 *
 * 深夜1時のタクシーの中、5分。ここが通らなければ、このアプリは全部飾りになる。
 *
 * 守ること。
 *   - 1画面で終わる。卓を移るたびに画面を往復させない
 *   - 1卓は1行。名前・金額・一言。それ以上は畳んでおく
 *   - AIを待たせない。整理は翌日に回す
 *   - 途中で閉じても消えない
 *
 * 声については、**強いるのでも禁じるのでもなく、選べるようにする。**
 * 以前は「声に出させない」を原則にしていた。タクシーの中では、
 * お客様のお名前と金額を音読できないからである。それは今も正しい。
 * ただし帰宅後の自室、控室、化粧を落としながら——声が出せる場所はある。
 * 打つ手間で続かなくなるくらいなら、話していただいたほうがよい。
 *
 * 話す場合はキーボードのマイクを使う。iPhone本体の機能なので、
 * ホーム画面から開いていても動く（アプリ自前の音声認識はここでは動かない）。
 * iOS16以降は端末の中だけで文字にするので、話した中身は外に出ない。
 */
var Night = (function () {
  'use strict';

  var DRAFT_KEY = 'koza2.night';
  var state = null;

  /** 深夜は前日の営業分として扱う（4時までは「ゆうべ」） */
  function businessDate() {
    var d = new Date();
    if (d.getHours() < 4) d.setDate(d.getDate() - 1);
    return Store.toISO(d);
  }

  function blankRow() {
    return { name: '', customer_id: null, spend: '', douhan: false, memo: '', help: false,
             others: '', sets: '', bottle: '', place: '', place_by: '',
             kirikaeshi: false, nominaoshi: false, open: false };
  }

  /** 入力中の下書き。日をまたいでも捨てない */
  function draft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }

  function pendingDraft() {
    var raw = draft();
    if (!raw) return null;
    var n = (raw.rows || []).filter(isFilled).length;
    return n ? { date: raw.date, count: n } : null;
  }

  function load() {
    var raw = draft();
    /* 日が変わっていても捨てない。
     * 「残す」を押し忘れた3卓が黙って消えるのが、いちばん腹の立つ壊れ方。 */
    if (raw && (raw.rows || []).length) return raw;
    return { date: businessDate(), rows: [blankRow()] };
  }

  function save() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* 容量なら諦める */ }
  }

  function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

  /* ---------- 画面 ---------- */

  function open(opts) {
    state = load();
    // 前の晩の下書きが残っていて、今夜の分を入れたいときは日を切り替える
    if (opts && opts.fresh && state.date !== businessDate()) {
      state = { date: businessDate(), rows: [blankRow()] };
    }
    UI.show('night');
    render();
  }

  function render() {
    var dateEl = document.getElementById('night-date');
    dateEl.textContent = UI.longDate(state.date);

    renderVoiceNote();

    var old = document.getElementById('night-old');
    if (state.date !== businessDate()) {
      UI.clear(old);
      old.appendChild(UI.el('p', null,
        UI.longDate(state.date) + 'の入力が残っています。先にこちらを残してください。'));
      var nb = UI.el('button', 'ghost small', '今夜の分を新しく始める');
      nb.type = 'button';
      nb.addEventListener('click', function () {
        if (!UI.confirmAsk(UI.longDate(state.date) + 'の入力を捨てて、今夜の分を始めます。よろしいですか。')) return;
        clearDraft();
        state = { date: businessDate(), rows: [blankRow()] };
        save(); render();
      });
      old.appendChild(nb);
      old.hidden = false;
    } else {
      old.hidden = true;
    }

    var wrap = UI.clear(document.getElementById('night-rows'));
    state.rows.forEach(function (r, i) { wrap.appendChild(rowEl(r, i)); });

    countUp();
  }

  function isFilled(r) {
    return !!((r.name || '').trim() || (r.memo || '').trim() || String(r.spend || '').trim());
  }

  /**
   * 打たれたお名前を、どなたに結び付けるか。
   *
   * **この仕事でいちばん重い事故が、ここで起きる。**
   * 田中様が二人いる店で、黙って先頭の方に付けてしまうと、
   * 乙社の田中様が話されたご息女のことが、甲社の田中様の宿題として残る。
   * そのまま次のお声がけの起点になれば、身に覚えのない話を振ることになり、
   * 本人には気づく手がかりが一つもない。
   *
   * だから順番はこうする。
   *   1. すでに本人が選んでおられるなら、**その方を動かさない**
   *   2. 同じ苗字が複数いるなら、**名前が完全に一致していても訊く**
   *   3. 一人しかいないときだけ、黙って結び付ける
   *
   * 以前は 1 と 2 が無く、選んだ2人目が再描画のたびに1人目へ化けていた。
   */
  function applyHint(r, hint) {
    UI.clear(hint);
    hint.className = 'nrow-hint';
    var nm = (r.name || '').trim();
    if (!nm) return;

    /* 1. 本人が選ばれた方は、照合し直さない。
     *    ここで matchCustomer を通すと、選択が毎回上書きされる。 */
    if (r.customer_id) {
      var chosen = Store.getCustomer(r.customer_id);
      if (chosen) {
        hint.className = 'nrow-hint ok';
        hint.textContent = '既存の ' + chosen.display_name + (chosen.company ? '（' + chosen.company + '）' : '');
        return;
      }
      r.customer_id = null;   // 消された方。選び直していただく
    }

    /* 2. 同じ苗字が複数。**完全に一致していても訊く。**
     *    「大森様」が二人いる店で、名前が合っているからと先頭に付けてはいけない。 */
    var cands = Store.candidates(nm.replace(/(様|さん)$/, ''));
    if (cands.length > 1) {
      hint.className = 'nrow-hint pick';
      hint.appendChild(UI.el('span', null, '同じ苗字の方が' + cands.length + '名います。どちらですか'));
      var row = UI.el('div', 'nrow-pick');
      cands.slice(0, 4).forEach(function (c) {
        /* 会社が同じだと「田中様／大阪商事」が二つ並んで見分けがつかない。
         * 前回いつお越しになったかを添えると、その晩の記憶で選べる。 */
        var last = Store.visitsOf(c.id)[0];
        var mark = c.display_name + (c.company ? '／' + c.company : '');
        if (last) mark += '／前回 ' + UI.shortDate(last.date);
        else mark += '／未来店';

        var b = UI.el('button', 'chip gold', mark);
        b.type = 'button';
        b.addEventListener('click', function () {
          r.customer_id = c.id;
          r.name = c.display_name;
          save(); render();
        });
        row.appendChild(b);
      });
      var nw = UI.el('button', 'chip', '新しい方');
      nw.type = 'button';
      nw.addEventListener('click', function () {
        r.customer_id = null;
        hint.className = 'nrow-hint';
        hint.textContent = '新しくお客様として登録します';
      });
      row.appendChild(nw);
      hint.appendChild(row);
      return;
    }

    // 3. お一人しかいない。ここで初めて黙って結び付けてよい
    var m = Store.matchCustomer({ display_name: nm, name: nm });
    if (m) {
      r.customer_id = m.id;
      hint.className = 'nrow-hint ok';
      hint.textContent = '既存の ' + m.display_name + (m.company ? '（' + m.company + '）' : '');
      return;
    }

    r.customer_id = null;
    hint.textContent = '新しくお客様として登録します';
  }

  /* ---------- 話して入れられる、というご案内 ----------
   *
   * 打つ手間で続かなくなるのが、このアプリのいちばんの死に方である。
   * ところがキーボードのマイクは、あることを知らなければ使われない。
   * だから一度だけお伝えして、閉じられたら二度と出さない。
   *
   * ここで案内するのは**iPhone本体のマイク**であって、
   * アプリ自前の音声認識ではない。後者はホーム画面から開くと動かない。
   */
  var VOICE_SEEN = 'koza2.night_voice_seen';

  function renderVoiceNote() {
    var host = document.getElementById('night-voice');
    if (!host) return;
    if (localStorage.getItem(VOICE_SEEN)) { host.hidden = true; return; }

    UI.clear(host);
    host.appendChild(UI.el('h3', null, '話して入れられます'));
    host.appendChild(UI.el('p', null,
      '下の欄を開くと、キーボードにマイクのボタンが出ます。' +
      'そのまま話していただければ、文字になります。' +
      'お名前も金額も、話の中に入っていれば翌日AIが拾います。'));
    host.appendChild(UI.el('p', null,
      '話した中身はiPhoneの中だけで文字になります。どこにも送られません。' +
      'ただし声は出ますので、車の中など、人のいる場所ではお気をつけください。'));

    var ok = UI.el('button', 'ghost small', 'もう出さない');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      try { localStorage.setItem(VOICE_SEEN, '1'); } catch (e) { /* 容量なら諦める */ }
      host.hidden = true;
    });
    host.appendChild(ok);
    host.hidden = false;
  }

  function rowEl(r, i) {
    var box = UI.el('div', 'nrow' + (r.open ? ' is-open' : ''));

    /* 1行目：番号・お名前・金額 */
    var head = UI.el('div', 'nrow-head');
    head.appendChild(UI.el('span', 'nrow-no', String(i + 1)));

    var name = UI.el('input');
    name.type = 'text';
    name.className = 'nrow-name';
    name.placeholder = 'お名前';
    name.value = r.name;
    name.setAttribute('list', 'night-names');
    name.addEventListener('input', function () {
      r.name = name.value;
      r.customer_id = null;
      applyHint(r, hint);
      save();
      countUp();
    });
    head.appendChild(name);

    var spend = UI.el('input');
    spend.type = 'text';
    spend.inputMode = 'numeric';
    spend.className = 'nrow-spend';
    spend.placeholder = '金額';
    spend.value = r.spend ? UI.commas(r.spend) : '';
    UI.moneyInput(spend);
    spend.addEventListener('input', function () { r.spend = spend.value; save(); countUp(); });
    // 「8万」は欄を離れたときに 80,000 になる。そこも拾わないと下書きに 8 が残る
    spend.addEventListener('blur', function () { r.spend = spend.value; save(); countUp(); });
    head.appendChild(spend);

    var x = UI.el('button', 'nrow-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'この卓を消す');
    x.addEventListener('click', function () {
      // 揺れる車内で親指が滑る。入っている卓は確認してから消す
      if (isFilled(r) && !UI.confirmAsk((r.name || (i + 1) + '卓目') + 'の入力を消します。よろしいですか。')) return;
      state.rows.splice(i, 1);
      if (!state.rows.length) state.rows.push(blankRow());
      save(); render();
    });
    head.appendChild(x);
    box.appendChild(head);

    var hint = UI.el('div', 'nrow-hint');
    applyHint(r, hint);
    box.appendChild(hint);

    /* 2行目：一言。ここがいちばん大事なので広く取る。
     * 枠を固定すると、3行目から下が箱の縁で切れて読めなくなる。
     * 深夜に打った本人が、打った端から見えなくなるのがいちばん困る。
     *
     * ここは話し言葉のまま入れてよい欄である。
     * キーボードのマイクを押せば、そのまま声で入る（iPhoneの機能なので、
     * ホーム画面から開いていても動く）。翌日、AIが卓ごとに組み直す。
     * **お名前も金額も、話の中に入っていれば拾われる。**
     * だから打つのは、この欄ひとつでも足りる。 */
    var memo = UI.el('textarea');
    memo.rows = 2;
    memo.className = 'nrow-memo';
    memo.placeholder = 'そのままの言葉で。「田中様と佐藤様。福岡の担当が代わったって話。8万くらい」';
    memo.value = r.memo;
    memo.style.overflow = 'hidden';
    memo.addEventListener('input', function () {
      r.memo = memo.value; save(); countUp(); grow(memo);
    });
    box.appendChild(memo);
    // 描かれてからでないと高さが取れない
    setTimeout(function () { grow(memo); }, 0);

    /* 3行目：同伴だけは一等地に。ほかは畳む */
    var tog = UI.el('div', 'nrow-toggles');

    /* 何も押さないときが何になるのか、どこにも出ていなかった。
     * いちばん多い形なのでボタンが無く、それゆえ画面から消えていた。
     * 文で説明するより、その行に結果を出すほうが早い。 */
    var state = UI.el('span', 'nrow-state', '係のお客様');
    function syncState() { state.hidden = !!(r.douhan || r.help); }

    tog.appendChild(toggle('同伴', r.douhan, function (v) { r.douhan = v; syncState(); save(); }));
    /* ヘルプの席は自分の売上ではない。
     * ここを分けないと、1晩の半分を占めるヘルプの卓が全部実績に乗って帯が嘘をつく。 */
    tog.appendChild(toggle('ヘルプ', r.help, function (v) { r.help = v; syncState(); save(); }));

    syncState();
    tog.appendChild(state);

    var more = UI.el('button', 'nrow-more', r.open ? '閉じる' : 'そのほか');
    more.type = 'button';
    more.addEventListener('click', function () { r.open = !r.open; save(); render(); });
    tog.appendChild(more);
    box.appendChild(tog);

    if (r.open) box.appendChild(detailEl(r));
    return box;
  }

  /** 打った字数ぶんだけ伸ばす。切って隠さない */
  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(64, ta.scrollHeight) + 'px';
  }

  function toggle(label, on, onChange) {
    var b = UI.el('button', 'ntog' + (on ? ' is-on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', function () {
      on = !on;
      b.classList.toggle('is-on', on);
      onChange(on);
    });
    return b;
  }

  function detailEl(r) {
    var d = UI.el('div', 'nrow-detail');

    function field(label, key, ph, numeric) {
      var f = UI.el('label', 'f');
      f.appendChild(UI.el('span', null, label));
      var i = UI.el('input');
      i.type = 'text';
      if (numeric) i.inputMode = 'numeric';
      i.placeholder = ph || '';
      i.value = r[key] || '';
      i.addEventListener('input', function () { r[key] = i.value; save(); });
      f.appendChild(i);
      return f;
    }

    d.appendChild(field('ご一緒された方', 'others', '佐藤部長、田中様 など'));
    var g = UI.el('div', 'grid2');
    g.appendChild(field('セット数', 'sets', '2', true));
    g.appendChild(field('ボトル', 'bottle', '響17年'));
    d.appendChild(g);

    /* お食事のお店。**同伴のときだけ出す。**
     *
     * ここが空のままだと、その方のお好みが永久に読めない。
     * 予定に入れていれば「残す」で引き継ぐので、たいていは触らなくてよい。
     * 触るのは、予定と違うお店になったときだけ。 */
    if (r.douhan) {
      d.appendChild(field('お食事のお店', 'place', '天喜、かねさか など'));
      var pb = UI.el('div', 'f');
      pb.appendChild(UI.el('span', null, 'どちらが決めたお店ですか'));
      pb.appendChild(UI.segmented(
        [{ value: '', label: '—' },
         { value: 'guest', label: 'お客様が' },
         { value: 'self', label: 'こちらで' }],
        r.place_by || '',
        function (v) { r.place_by = v; save(); }));
      pb.appendChild(UI.el('span', 'help',
        'お客様が選ばれたお店は、その方のお好みそのものです。'));
      d.appendChild(pb);
    }

    var t = UI.el('div', 'nrow-toggles');
    t.appendChild(toggle('切り返し', r.kirikaeshi, function (v) { r.kirikaeshi = v; save(); }));
    t.appendChild(toggle('飲み直し', r.nominaoshi, function (v) { r.nominaoshi = v; save(); }));
    d.appendChild(t);
    return d;
  }

  /* 「残す」は上と下の2箇所にある。どちらも同じ顔をしていないと、
   * 押した側が効かなかったのかと思わせる。必ず揃えて書き換える。 */
  function countUp() {
    var filled = state.rows.filter(isFilled).length;

    var btm = document.getElementById('night-save');
    btm.textContent = filled ? '残す（' + filled + '卓）' : '残す';
    btm.disabled = !filled;

    var top = document.getElementById('night-save-top');
    top.textContent = filled ? '残す（' + filled + '卓）' : '残す';
    top.disabled = !filled;

    document.getElementById('night-count').textContent = filled ? filled + '卓ぶん入っています' : '';
  }

  function addRow() {
    state.rows.push(blankRow());
    save(); render();
    var inputs = document.querySelectorAll('#night-rows .nrow-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  /* ---------- 残す ----------
   * AIは呼ばない。待たせない。整理は翌日。
   */

  function commit() {
    var rows = state.rows.filter(isFilled);
    if (!rows.length) return;

    var made = 0, failed = 0;
    rows.forEach(function (r) {
      var attendees = [];
      var nm = r.name.trim();

      if (nm) {
        var id = r.customer_id;
        if (!id) {
          var m = Store.matchCustomer({ display_name: nm, name: nm });
          id = m ? m.id : Store.createCustomer({
            name: nm,
            display_name: /(様|さん)$/.test(nm) ? nm.replace(/さん$/, '様') : nm + '様',
            first_met: state.date
          }).id;
        }
        attendees.push({ customer_id: id, role: 'shukyaku' });
      }

      // ご一緒された方は、名前をそのまま残しておいて整理のときに拾う
      var others = (r.others || '').split(/[、,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      others.forEach(function (o) {
        var m = Store.matchCustomer({ display_name: o, name: o });
        if (m) attendees.push({ customer_id: m.id, role: 'doukousha' });
      });

      var raw = [nm ? nm + 'と。' : '', r.memo,
        others.length ? '（ご一緒：' + others.join('、') + '）' : ''].filter(Boolean).join(' ');

      /* お食事のお店を、予定から引き継ぐ。
       *
       * ここが無いと、予定にいくら店名を入れても来歴に残らず、
       * その方のお好みが永久に読めないままになる（実際そうなっていた）。
       * 深夜に手で入れ直させるのは酷なので、予定にあるものを黙って持ってくる。
       * 手で入れてあれば、そちらを優先する。 */
      var place = (r.place || '').trim();
      var placeBy = r.place_by || '';
      if (!place && r.douhan) {
        var main = attendees[0];
        if (main) {
          Store.appointmentsOn(state.date).forEach(function (a) {
            if (place || a.customer_id !== main.customer_id) return;
            if (!(a.place || '').trim()) return;
            place = a.place.trim();
            placeBy = a.place_by || '';
          });
        }
      }

      var v = Store.addVisit({
        date: state.date,
        attendees: attendees,
        my_role: r.help ? 'help' : (Store.getProfile().my_role === 'help' ? 'help' : 'kakari'),
        douhan: !!r.douhan,
        douhan_place: place,
        place_by: placeBy,
        kirikaeshi: !!r.kirikaeshi,
        nominaoshi: !!r.nominaoshi,
        set_count: parseInt(r.sets, 10) || 0,
        spend: UI.parseMoney(r.spend) || null,
        bottle: (r.bottle || '').trim(),
        topic_detail: r.memo.trim(),
        raw_memo: raw,
        hooks: [],
        ai_structured: false        // 整理は翌日。ここが未整理の目印
      });
      if (v) made += 1; else failed += 1;
    });

    /* 一卓でも保存できなかったら、**下書きを消さない。**
     * 消してしまえば、その晩の入力は取り戻せない。
     * 「残しました」と出して何も残っていないのが、いちばん困る壊れ方である。 */
    if (failed) {
      UI.toast(failed + '卓ぶんが保存できませんでした。入力はそのまま残してあります', true);
      return;
    }

    clearDraft();
    state = null;
    UI.show('home', { replace: true });
    Home.refresh();
    UI.toast(made + '卓ぶん残しました。整理は明日で構いません');
  }

  function init() {
    document.getElementById('night-back').addEventListener('click', function () {
      save();
      UI.back('home');
      Home.refresh();
    });
    document.getElementById('night-add').addEventListener('click', addRow);
    document.getElementById('night-add-top').addEventListener('click', addRow);
    document.getElementById('night-save').addEventListener('click', commit);
    document.getElementById('night-save-top').addEventListener('click', commit);
    document.getElementById('night-clear').addEventListener('click', function () {
      if (!UI.confirmAsk('入力中の内容を捨てます。よろしいですか。')) return;
      clearDraft();
      state = load();
      render();
    });
  }

  /** お名前の候補。打ち間違いを減らす */
  function refreshNames() {
    var dl = UI.clear(document.getElementById('night-names'));
    Store.activeCustomers().forEach(function (c) {
      var o = UI.el('option');
      o.value = c.display_name;
      dl.appendChild(o);
    });
  }

  return { init: init, open: open, refreshNames: refreshNames,
           businessDate: businessDate, pendingDraft: pendingDraft };
})();
