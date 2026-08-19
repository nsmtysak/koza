/* Kōza v2 — 名刺の登録
 * 撮る → AIが読む → 直す → 登録
 * 画像は端末の中（IndexedDB）にだけ残す。
 */
var Scan = (function () {
  'use strict';

  var imageData = null;   // 縮小済み dataURL
  var fields = null;
  var editingCustomerId = null;

  var FORM = [
    ['name', 'お名前', 'text'],
    ['kana', 'よみ', 'text'],
    ['company', '会社', 'text'],
    ['department', '部署', 'text'],
    ['title', '役職', 'text'],
    ['mobile', '携帯', 'tel'],
    ['phone', '電話', 'tel'],
    ['email', 'メール', 'email'],
    ['address', '住所', 'text']
  ];

  function open(customerId) {
    editingCustomerId = customerId || null;
    imageData = null;
    fields = null;
    stage('capture');
    UI.show('scan');
  }

  function stage(which) {
    document.getElementById('scan-stage').hidden = which !== 'capture';
    document.getElementById('scan-preview').hidden = which !== 'preview';
    document.getElementById('scan-form').hidden = which !== 'form';
    document.getElementById('scan-actions').hidden = which !== 'form';
  }

  function onFile(file) {
    if (!file) return;
    UI.busy(true, '画像を整えています…');
    Blobs.shrink(file, 1400, 0.82).then(function (r) {
      UI.busy(false);
      imageData = r.dataUrl;
      document.getElementById('scan-img').src = imageData;
      stage('preview');
    }).catch(function (e) {
      UI.busy(false);
      UI.toast(e.message || '画像を扱えませんでした', true);
    });
  }

  function read() {
    if (!imageData) return;
    if (!Api.isConfigured()) {
      fields = blank();
      renderForm('AIの接続がまだなので、手で入れてください。');
      stage('form');
      return;
    }

    UI.busy(true, '名刺を読んでいます…');
    Api.readCard(imageData).then(function (d) {
      UI.busy(false);
      fields = Object.assign(blank(), d || {});
      renderForm('');
      stage('form');
    }).catch(function (err) {
      UI.busy(false);
      fields = blank();
      renderForm('読み取れませんでした（' + err.message + '）。手で入れてください。');
      stage('form');
    });
  }

  function blank() {
    var o = {};
    FORM.forEach(function (f) { o[f[0]] = ''; });
    o.display_name = '';
    return o;
  }

  function renderForm(note) {
    var wrap = UI.clear(document.getElementById('scan-form'));

    if (note) {
      wrap.appendChild(UI.el('p', 'confirm-note', note));
      wrap.appendChild(UI.aiNote('read'));
    }

    // 呼び方は毎回使うので一番上に置く
    var dn = fields.display_name ||
      ((fields.name || '').split(/[\s　]+/)[0] ? (fields.name || '').split(/[\s　]+/)[0] + '様' : '');
    wrap.appendChild(field('display_name', 'お呼びする名前', 'text', dn,
      'アプリの中ではこの名前で表示されます'));

    FORM.forEach(function (f) {
      wrap.appendChild(field(f[0], f[1], f[2], fields[f[0]] || ''));
    });

    // 同姓の既存客がいれば教える
    var hit = Store.matchCustomer({ name: fields.name, company: fields.company });
    if (hit) {
      var warn = UI.el('p', 'help');
      warn.innerHTML = '';
      warn.appendChild(document.createTextNode('※ 既に「' + hit.display_name + '」が登録されています。同じ方なら、いったんやめて既存の方を開いてください。'));
      wrap.appendChild(warn);
    }

    var imgWrap = UI.el('div', 'f');
    imgWrap.appendChild(UI.el('span', null, '名刺の画像'));
    var img = UI.el('img', 'card-img');
    img.src = imageData;
    img.alt = '名刺';
    imgWrap.appendChild(img);
    wrap.appendChild(imgWrap);
  }

  function field(key, label, type, value, help) {
    var f = UI.el('label', 'f');
    f.appendChild(UI.el('span', null, label));
    var i = UI.el('input');
    i.type = type; i.value = value || ''; i.dataset.key = key;
    f.appendChild(i);
    if (help) f.appendChild(UI.el('p', 'help', help));
    return f;
  }

  function collect() {
    var out = {};
    document.querySelectorAll('#scan-form input').forEach(function (i) {
      out[i.dataset.key] = i.value.trim();
    });
    return out;
  }

  function save() {
    var v = collect();
    if (!v.name && !v.display_name) { UI.toast('お名前を入れてください', true); return; }
    if (!v.display_name) {
      var base = v.name.split(/[\s　]+/)[0];
      v.display_name = base + '様';
    }

    var imageId = Store.uid('img');
    UI.busy(true, '登録しています…');

    Blobs.put(imageId, imageData).catch(function () { return null; }).then(function () {
      if (editingCustomerId) {
        Store.updateCustomer(editingCustomerId, Object.assign({}, v, { card_image_id: imageId }));
        UI.busy(false);
        UI.toast('名刺を登録しました');
        People.openPerson(editingCustomerId);
      } else {
        var c = Store.createCustomer(Object.assign({}, v, { card_image_id: imageId }));
        UI.busy(false);
        UI.toast('登録しました');
        People.openPerson(c.id);
      }
      imageData = null; fields = null; editingCustomerId = null;
    });
  }

  function init() {
    document.getElementById('scan-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('scan-read').addEventListener('click', read);
    document.getElementById('scan-retake').addEventListener('click', function () { stage('capture'); });
    document.getElementById('scan-save').addEventListener('click', save);
    document.getElementById('scan-cancel').addEventListener('click', function () { UI.back('people'); });
    document.getElementById('scan-back').addEventListener('click', function () { UI.back('people'); });
  }

  return { init: init, open: open };
})();
