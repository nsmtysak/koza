/* Kōza v2 — 来歴の記録
 * 話す → AIが整理 → 確認 → 残す
 * 同時に、話から分かったプロフィールの追記候補を出す（データベースが育つ）
 */
var Record = (function () {
  'use strict';

  var draft = null;
  var rawMemo = '';
  var editingId = null;
  var enrichChoices = [];     // [{customerKey, kind, label, value, checked}]
  var apptChoices = [];       // 話に出た次のご来店
  var recognition = null;
  var listening = false;
  var briefIdForVisit = null; // 準備画面から来た場合、その提案と結び付ける

  /* ---------- 入力 ---------- */

  function open(opts) {
    opts = opts || {};
    editingId = null;
    briefIdForVisit = opts.brief_id || null;
    document.getElementById('memo').value = opts.prefill || '';
    UI.show('record');
    setupMic();
    setTimeout(function () { document.getElementById('memo').focus(); }, 150);
  }

  /* ---------- マイク ----------
   * 使えない事情がいくつもある。黙って何も起きないのがいちばん困るので、
   * 「なぜ使えないか」と「代わりにどうするか」を必ず出す。
   *
   *   - https でないと動かない（音声認識は保護された接続を要求する）
   *   - iPhone の Safari には音声認識そのものが無い
   *   - マイクの許可を断ったあとは、ブラウザの設定からしか戻せない
   * どの場合も、キーボードのマイクからは入れられる。そこへ誘導する。
   */

  var micReady = false;

  function micNote() {
    var el = document.querySelector('.mic-note');
    if (!el) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.isSecureContext) {
      el.textContent = 'この接続（http）では音声にできません。公開後に使えます。今はキーボードのマイクからどうぞ';
    } else if (!SR) {
      el.textContent = 'この端末では音声にできません。キーボードのマイクからお願いします';
    } else {
      el.textContent = 'キーボードのマイクからでも入れられます';
    }
  }

  function setupMic() {
    var btn = document.getElementById('btn-mic');
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    btn.hidden = false;
    micNote();

    if (micReady) return;
    micReady = true;

    btn.addEventListener('click', function () {
      if (!window.isSecureContext) {
        UI.toast('この接続では音声が使えません。キーボードのマイクからお願いします', true);
        return;
      }
      if (!SR) {
        UI.toast('この端末は音声に対応していません。キーボードのマイクからお願いします', true);
        return;
      }
      if (listening && recognition) { recognition.stop(); return; }
      start(SR);
    });
  }

  function start(SR) {
    if (!recognition) {
      recognition = new SR();
      recognition.lang = 'ja-JP';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = function (ev) {
        var memo = document.getElementById('memo');
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) memo.value += ev.results[i][0].transcript;
        }
      };
      recognition.onend = function () { setListening(false); };
      recognition.onerror = function (ev) {
        setListening(false);
        UI.toast(errorText(ev && ev.error), true);
      };
    }

    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      setListening(false);
      UI.toast('マイクを始められませんでした。キーボードのマイクからお願いします', true);
    }
  }

  function errorText(code) {
    switch (code) {
      case 'not-allowed':
        return 'マイクの使用が許可されていません。ブラウザの設定で許可してください';
      case 'service-not-allowed':
        return 'この接続では音声が使えません。キーボードのマイクからお願いします';
      case 'audio-capture':
        return 'マイクが見つかりませんでした';
      case 'network':
        return '音声の変換に繋がりませんでした。電波の良いところでもう一度';
      case 'no-speech':
        return '声を拾えませんでした。もう一度どうぞ';
      case 'aborted':
        return '';
      default:
        return 'うまく聞き取れませんでした。文字で入れてください';
    }
  }

  function setListening(on) {
    listening = on;
    var b = document.getElementById('btn-mic');
    b.classList.toggle('is-rec', on);
    b.textContent = on ? '聞いています（押すと止まる）' : 'マイクで話す';
  }

  /* ---------- 整理する ---------- */

  function submit() {
    if (listening && recognition) recognition.stop();
    rawMemo = document.getElementById('memo').value.trim();
    if (!rawMemo) { UI.toast('一言だけでも入れてください', true); return; }

    if (!Api.isConfigured()) {
      draft = normalize(Api.offlineStructure());
      renderConfirm('AIの接続がまだなので、言葉はそのまま残します。下の欄に手で入れてください。');
      UI.show('confirm');
      return;
    }

    UI.busy(true, '整理しています…');
    Api.structure(rawMemo).then(function (data) {
      UI.busy(false);
      draft = normalize(data);
      renderConfirm('');
      UI.show('confirm');
    }).catch(function (err) {
      UI.busy(false);
      draft = normalize(Api.offlineStructure());
      renderConfirm('整理できませんでした（' + err.message + '）。言葉はそのまま残ります。');
      UI.show('confirm');
    });
  }

  function normalize(d) {
    d = d || {};
    var cs = Array.isArray(d.customers) ? d.customers : [];
    // ひとりだけなら主客で確定してよい
    if (cs.length === 1 && cs[0].role !== 'shukyaku') cs[0].role = 'shukyaku';

    var p = Store.getProfile();
    var myRole = (d.my_role === 'kakari' || d.my_role === 'help') ? d.my_role
      : ((p.my_role === 'kakari' || p.my_role === 'help') ? p.my_role : null);

    return {
      visit_date: d.visit_date || Store.today(),
      customers: cs,
      my_role: myRole,
      douhan: !!d.douhan,
      kirikaeshi: !!d.kirikaeshi,
      nominaoshi: !!d.nominaoshi,
      set_count: typeof d.set_count === 'number' ? d.set_count : 0,
      spend: typeof d.spend === 'number' ? d.spend : null,
      bottle: d.bottle || '',
      topics: Array.isArray(d.topics) ? d.topics : [],
      topic_detail: d.topic_detail || '',
      drinks: Array.isArray(d.drinks) ? d.drinks : [],
      observation: d.observation || '',
      hooks: Array.isArray(d.hooks) ? d.hooks : [],
      next_visit_hint: d.next_visit_hint || { timing: '', confidence: 'none' },
      appointments: Array.isArray(d.appointments) ? d.appointments : [],
      profile_updates: Array.isArray(d.profile_updates) ? d.profile_updates : [],
      _offline: !!d._offline
    };
  }

  /* ---------- 既存の来歴を直す ---------- */

  function openEdit(visitId) {
    var v = Store.getVisit(visitId);
    if (!v) { UI.toast('その来歴が見つかりません', true); return; }

    editingId = visitId;
    briefIdForVisit = v.brief_id || null;
    rawMemo = v.raw_memo || '';

    draft = {
      visit_date: v.date,
      customers: (v.attendees || []).map(function (a) {
        var c = Store.getCustomer(a.customer_id);
        return { name: c ? c.display_name : '', role: a.role || 'shukyaku', customer_id: a.customer_id };
      }),
      my_role: v.my_role,
      douhan: v.douhan, kirikaeshi: v.kirikaeshi, nominaoshi: v.nominaoshi,
      set_count: v.set_count || 0, spend: v.spend, bottle: v.bottle || '',
      topics: v.topics || [], topic_detail: v.topic_detail || '',
      drinks: v.drinks || [], observation: v.observation || '',
      hooks: v.hooks || [], next_visit_hint: v.next_visit_hint || {},
      appointments: [], profile_updates: [],
      _offline: !v.ai_structured
    };

    renderConfirm('この来歴を直します。');
    UI.show('confirm');
  }

  /* ---------- 確認画面 ---------- */

  function renderConfirm(note) {
    document.getElementById('confirm-title').textContent = editingId ? '来歴を直す' : 'この内容で残します';
    document.getElementById('confirm-note').textContent =
      note || '違うところだけ直してください。そのままでも残せます。';
    document.getElementById('btn-delete-visit').hidden = !editingId;
    document.getElementById('btn-discard').textContent = editingId ? '直すのをやめる' : 'やめる';

    document.getElementById('f-date').value = draft.visit_date;
    document.getElementById('f-douhan').checked = draft.douhan;
    document.getElementById('f-kirikaeshi').checked = draft.kirikaeshi;
    document.getElementById('f-nominaoshi').checked = draft.nominaoshi;
    document.getElementById('f-sets').value = draft.set_count || '';
    UI.setMoney('f-spend', draft.spend);
    document.getElementById('f-bottle').value = draft.bottle || '';
    document.getElementById('f-topicdetail').value = draft.topic_detail;
    document.getElementById('f-drinks').value = (draft.drinks || []).map(function (d) {
      return d.count > 1 ? d.item + ' ×' + d.count : d.item;
    }).join('、');
    document.getElementById('f-observation').value = draft.observation;
    document.getElementById('f-next').value = (draft.next_visit_hint && draft.next_visit_hint.timing) || '';
    document.getElementById('f-raw').textContent = rawMemo || '（音声・文章の記録はありません）';

    renderMyRole();
    renderAttendees();
    renderHooks();
    renderAppointments();
    renderEnrich();
    window.scrollTo(0, 0);
  }

  function renderMyRole() {
    var wrap = UI.clear(document.getElementById('f-myrole'));
    wrap.appendChild(UI.segmented(
      [{ value: 'kakari', label: '係' }, { value: 'help', label: 'ヘルプ' }, { value: null, label: '未設定' }],
      draft.my_role,
      function (v) { draft.my_role = v; }
    ));
  }

  function renderAttendees() {
    var wrap = UI.clear(document.getElementById('f-attendees'));
    if (!draft.customers.length) {
      addAttendeeRow({ name: '', role: 'shukyaku' });
    } else {
      draft.customers.forEach(addAttendeeRow);
    }
  }

  function addAttendeeRow(c) {
    var wrap = document.getElementById('f-attendees');
    var row = UI.el('div', 'att');
    var top = UI.el('div', 'att-row');

    var input = UI.el('input');
    input.type = 'text';
    input.value = c.name || c.name_key || '';
    input.placeholder = 'お名前';

    var sel = UI.el('select');
    [['shukyaku', '主客'], ['doukousha', '同行'], ['unknown', '不明']].forEach(function (o) {
      var op = UI.el('option', null, o[1]); op.value = o[0]; sel.appendChild(op);
    });
    sel.value = c.role || 'shukyaku';

    var del = UI.el('button', 'del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', 'この方を外す');
    del.addEventListener('click', function () { row.remove(); });

    top.appendChild(input); top.appendChild(sel); top.appendChild(del);

    var hint = UI.el('p', 'att-hint');
    row.dataset.customerId = c.customer_id || '';
    row.dataset.company = c.company || '';

    function updateHint() {
      var name = input.value.trim();
      hint.innerHTML = '';
      if (!name) { hint.textContent = ''; return; }

      var fixed = row.dataset.customerId ? Store.getCustomer(row.dataset.customerId) : null;
      var hit = fixed || Store.matchCustomer({ display_name: name, name: name, company: row.dataset.company });

      if (hit) {
        hint.appendChild(document.createTextNode('既存の '));
        var b = UI.el('b', null, hit.display_name);
        hint.appendChild(b);
        hint.appendChild(document.createTextNode(' に紐づきます'));
        row.dataset.customerId = hit.id;
      } else {
        var cands = Store.candidates(name.replace(/(様|さん)$/, ''));
        if (cands.length > 1) {
          hint.textContent = '同じ苗字の方が' + cands.length + '名います。フルネームか会社名を足すと確実です';
        } else {
          hint.textContent = '新しくお客様として登録します';
        }
        row.dataset.customerId = '';
      }
    }
    input.addEventListener('input', function () { row.dataset.customerId = ''; updateHint(); });

    row.appendChild(top);
    row.appendChild(hint);
    wrap.appendChild(row);
    updateHint();
  }

  function renderHooks() {
    var ul = UI.clear(document.getElementById('f-hooks'));
    if (!draft.hooks.length) {
      var li = UI.el('li', null, '（今回は見つかりませんでした）');
      li.style.color = 'var(--text-faint)';
      ul.appendChild(li);
      return;
    }
    draft.hooks.forEach(function (h) {
      var li = UI.el('li');
      li.appendChild(UI.chip(hookLabel(h.type), 'gold'));
      li.appendChild(UI.el('span', null, h.text));
      ul.appendChild(li);
    });
  }

  function hookLabel(t) {
    return ({ family: '家族', work: '仕事', health: '体調', hobby: '趣味',
      commitment: '約束', event: '予定', other: 'その他' })[t] || 'その他';
  }

  /** AIが拾ったプロフィール追記の候補。既に持っている情報は出さない */
  function renderEnrich() {
    var wrap = document.getElementById('f-enrich-wrap');
    var box = UI.clear(document.getElementById('f-enrich'));
    enrichChoices = [];

    (draft.profile_updates || []).forEach(function (u) {
      var target = (u.customer || '').trim();
      if (!target) return;
      var items = [];
      function push(kind, label, value) {
        if (!value) return;
        items.push({ kind: kind, label: label, value: value });
      }
      (u.interests || []).forEach(function (v) { push('interests', '趣味・興味', v); });
      (u.ng_topics || []).forEach(function (v) { push('ng_topics', '触れない話題', v); });
      ((u.prefs && u.prefs.drinks) || []).forEach(function (v) { push('prefs.drinks', 'お好みのお酒', v); });
      ((u.prefs && u.prefs.food) || []).forEach(function (v) { push('prefs.food', 'お好みの食べ物', v); });
      ((u.prefs && u.prefs.likes) || []).forEach(function (v) { push('prefs.likes', 'お好み', v); });
      ((u.prefs && u.prefs.dislikes) || []).forEach(function (v) { push('prefs.dislikes', '苦手なもの', v); });
      (u.family || []).forEach(function (f) {
        push('family', 'ご家族', (f.relation || '') + (f.name ? '・' + f.name : '') + (f.note ? '（' + f.note + '）' : ''));
      });
      if (u.company) push('company', '会社', u.company);
      if (u.title) push('title', '役職', u.title);
      if (u.birthday) push('birthday', 'お誕生日', u.birthday);

      items.forEach(function (it) {
        var idx = enrichChoices.length;
        var choice = { target: target, kind: it.kind, label: it.label, value: it.value,
                       raw: u, checked: true };
        enrichChoices.push(choice);

        var label = UI.el('label');
        var cb = UI.el('input'); cb.type = 'checkbox'; cb.checked = true;
        cb.addEventListener('change', function () { enrichChoices[idx].checked = cb.checked; });

        var t = UI.el('span');
        t.appendChild(UI.el('span', 'e-kind', target + ' / ' + it.label));
        t.appendChild(UI.el('span', 'e-text', it.value));

        label.appendChild(cb); label.appendChild(t);
        box.appendChild(label);
      });
    });

    wrap.hidden = enrichChoices.length === 0;
  }

  /**
   * 話に出た次のご来店。
   * 「来週の金曜に寄る」と言われた事実は、口実ではなく枠。
   * ここを取り逃すと、その日を埋める仕事が消えてしまう。
   */
  function renderAppointments() {
    var wrap = document.getElementById('f-appt-wrap');
    var box = UI.clear(document.getElementById('f-appt'));
    apptChoices = [];

    (draft.appointments || []).forEach(function (a) {
      if (!a || !a.date) return;
      var idx = apptChoices.length;
      apptChoices.push({ raw: a, checked: true });

      var label = UI.el('label');
      var cb = UI.el('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.addEventListener('change', function () { apptChoices[idx].checked = cb.checked; });

      var t = UI.el('span');
      t.appendChild(UI.el('span', 'e-kind', (a.customer || '') + ' / ' +
        (a.kind === 'douhan' ? '同伴' : 'ご来店') +
        '（' + (a.confidence === 'confirmed' ? '確定' : 'お約束') + '）'));
      t.appendChild(UI.el('span', 'e-text', UI.longDate(a.date) + (a.note ? '　「' + a.note + '」' : '')));

      label.appendChild(cb); label.appendChild(t);
      box.appendChild(label);
    });

    wrap.hidden = apptChoices.length === 0;
  }

  /* ---------- 残す ---------- */

  function commit() {
    var attendees = [];
    var byName = {};
    var rows = document.querySelectorAll('#f-attendees .att');

    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].querySelector('input').value.trim();
      if (!name) continue;
      var role = rows[i].querySelector('select').value;
      var cid = rows[i].dataset.customerId;

      if (!cid) {
        var created = Store.createCustomer({
          display_name: /(様|さん)$/.test(name) ? name.replace(/さん$/, '様') : name + '様',
          name: name,
          company: rows[i].dataset.company || '',
          relation_type: document.getElementById('f-myrole') ? draft.my_role : null,
          first_met: document.getElementById('f-date').value || Store.today()
        });
        cid = created.id;
      }
      attendees.push({ customer_id: cid, role: role });
      byName[name] = cid;
      byName[name.replace(/(様|さん)$/, '')] = cid;
    }

    var drinksText = document.getElementById('f-drinks').value.trim();
    var drinks = drinksText ? drinksText.split(/[、,]/).map(function (s) {
      var t = s.trim();
      var m = t.match(/^(.*?)\s*[×xX]\s*(\d+)$/);
      return m ? { item: m[1].trim(), count: parseInt(m[2], 10) } : { item: t, count: 1 };
    }).filter(function (d) { return d.item; }) : [];

    var timing = document.getElementById('f-next').value.trim();
    var spendRaw = document.getElementById('f-spend').value.replace(/[^\d]/g, '');

    var fields = {
      date: document.getElementById('f-date').value || Store.today(),
      attendees: attendees,
      my_role: draft.my_role,
      douhan: document.getElementById('f-douhan').checked,
      kirikaeshi: document.getElementById('f-kirikaeshi').checked,
      nominaoshi: document.getElementById('f-nominaoshi').checked,
      set_count: parseInt(document.getElementById('f-sets').value, 10) || 0,
      spend: spendRaw === '' ? null : (parseInt(spendRaw, 10) || 0),
      bottle: document.getElementById('f-bottle').value.trim(),
      topics: draft.topics,
      topic_detail: document.getElementById('f-topicdetail').value.trim(),
      drinks: drinks,
      observation: document.getElementById('f-observation').value.trim(),
      raw_memo: rawMemo,
      hooks: (draft.hooks || []).map(function (h) {
        return { text: h.text, type: h.type, status: h.status || 'open' };
      }),
      next_visit_hint: timing ? {
        timing: timing,
        confidence: (draft.next_visit_hint && draft.next_visit_hint.timing === timing &&
          draft.next_visit_hint.confidence !== 'none') ? draft.next_visit_hint.confidence : 'implied'
      } : {},
      brief_id: briefIdForVisit,
      ai_structured: !draft._offline
    };

    if (editingId) Store.updateVisit(editingId, fields);
    else Store.addVisit(fields);

    applyEnrich(byName, attendees);
    applyAppointments(byName, attendees);

    // 準備を出していた相手なら、その提案が効いたかを記録する
    if (briefIdForVisit && !editingId) {
      Store.recordOutcome(briefIdForVisit, { visited: true, note: fields.topic_detail });
    }

    var was = !!editingId;
    reset();
    UI.show('home', { replace: true });
    Home.refresh();
    UI.toast(was ? '直しました' : '残しました');
  }

  /** 話に出た次のご来店を、枠に立てる */
  function applyAppointments(byName, attendees) {
    var fallbackId = (attendees[0] || {}).customer_id;

    apptChoices.filter(function (a) { return a.checked; }).forEach(function (a) {
      var raw = a.raw;
      var key = (raw.customer || '').trim();
      var id = byName[key] || byName[key.replace(/(様|さん)$/, '')] || fallbackId;
      if (!id || !raw.date) return;

      // 同じ日に同じ方の予定が既にあれば重ねない
      var dup = Store.appointmentsOn(raw.date).some(function (x) { return x.customer_id === id; });
      if (dup) return;

      Store.addAppointment({
        date: raw.date,
        customer_id: id,
        kind: raw.kind === 'douhan' ? 'douhan' : 'visit',
        confidence: raw.confidence === 'confirmed' ? 'confirmed' : 'verbal',
        source: 'voice',
        note: raw.note || ''
      });
    });

    Store.clearDailyPlan();
  }

  /** プロフィールへの書き足しを反映する */
  function applyEnrich(byName, attendees) {
    var fallbackId = (attendees[0] || {}).customer_id;

    enrichChoices.filter(function (c) { return c.checked; }).forEach(function (c) {
      var id = byName[c.target] || byName[c.target.replace(/(様|さん)$/, '')] ||
        (Store.matchCustomer({ display_name: c.target, name: c.target }) || {}).id || fallbackId;
      if (!id) return;

      var add = {};
      if (c.kind === 'interests') add.interests = [c.value];
      else if (c.kind === 'ng_topics') add.ng_topics = [c.value];
      else if (c.kind.indexOf('prefs.') === 0) {
        add.prefs = {}; add.prefs[c.kind.slice(6)] = [c.value];
      } else if (c.kind === 'family') {
        var m = c.value.match(/^([^・（]+)(?:・([^（]+))?(?:（(.+)）)?$/);
        add.family = [{ relation: m ? m[1] : c.value, name: m && m[2] ? m[2] : '', note: m && m[3] ? m[3] : '' }];
      } else {
        add[c.kind] = c.value;
      }
      Store.enrichCustomer(id, add);
    });
  }

  function removeVisit() {
    if (!editingId) return;
    if (!UI.confirmAsk('この来歴を削除します。元に戻せません。よろしいですか。')) return;
    Store.deleteVisit(editingId);
    reset();
    UI.show('home', { replace: true });
    Home.refresh();
    UI.toast('削除しました');
  }

  function reset() {
    draft = null; rawMemo = ''; editingId = null;
    enrichChoices = []; apptChoices = []; briefIdForVisit = null;
  }

  function discard() {
    reset();
    UI.back('home');
    Home.refresh();
  }

  function init() {
    document.getElementById('btn-structure').addEventListener('click', submit);
    document.getElementById('record-back').addEventListener('click', function () { UI.back('home'); });
    document.getElementById('btn-commit').addEventListener('click', commit);
    document.getElementById('btn-discard').addEventListener('click', discard);
    document.getElementById('btn-delete-visit').addEventListener('click', removeVisit);
    document.getElementById('confirm-back').addEventListener('click', function () {
      if (editingId) { discard(); return; }
      UI.show('record', { replace: true });
    });
    document.getElementById('f-add-attendee').addEventListener('click', function () {
      addAttendeeRow({ name: '', role: 'doukousha' });
    });
  }

  return { init: init, open: open, openEdit: openEdit };
})();
