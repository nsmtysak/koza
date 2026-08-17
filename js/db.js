/* Kōza v2 — 画像専用ストア（IndexedDB）
 *
 * 名刺やお客様に関する画像は localStorage には入らない（容量が足りない）。
 * 構造化データは localStorage、画像だけここ、と分ける。
 * 分けておくと書き出しも軽く済む（画像は任意で同梱）。
 */
var Blobs = (function () {
  'use strict';

  var DB_NAME = 'koza-blobs';
  var STORE = 'images';
  var VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('この端末では画像を保存できません')); return; }
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('画像の保管庫を開けませんでした')); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /** dataURL を保存して id を返す */
  function put(id, dataUrl) {
    return tx('readwrite').then(function (store) {
      return wrap(store.put(dataUrl, id));
    }).then(function () { return id; });
  }

  function get(id) {
    if (!id) return Promise.resolve(null);
    return tx('readonly').then(function (store) {
      return wrap(store.get(id));
    }).catch(function () { return null; });
  }

  function remove(id) {
    if (!id) return Promise.resolve();
    return tx('readwrite').then(function (store) {
      return wrap(store.delete(id));
    }).catch(function () { return null; });
  }

  function keys() {
    return tx('readonly').then(function (store) {
      return wrap(store.getAllKeys());
    }).catch(function () { return []; });
  }

  /** 書き出し用に全画像を取り出す */
  function exportAll() {
    return keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return get(k).then(function (v) { return { id: k, data: v }; });
      }));
    });
  }

  function importAll(list) {
    return Promise.all((list || []).map(function (item) {
      if (!item || !item.id || !item.data) return null;
      return put(item.id, item.data);
    }));
  }

  /**
   * 画像を縮小する。名刺は横1400pxあれば文字が読める。
   * そのまま送るとAPIの費用が跳ねるので、必ず通す。
   */
  /** 顔写真は正方形に切って小さくする。一覧に何十枚も並ぶため */
  function square(file, size) {
    size = size || 320;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        var cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読めませんでした')); };
      img.src = url;
    });
  }

  function shrink(file, maxEdge, quality) {
    maxEdge = maxEdge || 1400;
    quality = quality || 0.82;

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('画像を読めませんでした')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('画像を開けませんでした')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);

          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, cw, ch);

          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            width: cw,
            height: ch
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return {
    put: put, get: get, remove: remove, keys: keys,
    exportAll: exportAll, importAll: importAll,
    shrink: shrink, square: square
  };
})();
