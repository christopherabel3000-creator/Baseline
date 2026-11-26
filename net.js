// Online rooms for Baseline. Uses Firebase Realtime Database.
// Each room: { cfg, names: [host, guest], state: "<match json>", ver }
(function () {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyA5WgyvGLY3EMUjecqLXfVdT7_Wo66K4M8',
    authDomain: 'baseline-de10c.firebaseapp.com',
    databaseURL: 'https://baseline-de10c-default-rtdb.firebaseio.com',
    projectId: 'baseline-de10c',
    storageBucket: 'baseline-de10c.firebasestorage.app',
    messagingSenderId: '220291518507',
    appId: '1:220291518507:web:98c16f4cbaefc79da05a6e'
  };

  // ----- Firebase backend -----
  function firebaseBackend() {
    if (!window.firebase || !firebase.database) return null;
    if (!firebase.apps.length) firebase.initializeApp(CONFIG);
    var db = firebase.database();
    return {
      transact: function (code, fn) {
        var ref = db.ref('rooms/' + code);
        // read first so the transaction starts from the real room, not an empty cache
        return ref.once('value').then(function () {
          return ref.transaction(function (cur) { return fn(cur); }, null, false);
        }).then(function (res) { return { committed: res.committed, value: res.snapshot.val() }; });
      },
      watch: function (code, cb) {
        var ref = db.ref('rooms/' + code);
        var h = ref.on('value', function (s) { cb(s.val()); });
        return function () { ref.off('value', h); };
      }
    };
  }

  // ----- Local test backend: shares rooms between tabs of one browser -----
  function fakeBackend() {
    var chan = new BroadcastChannel('baseline-fake');
    var subs = {};
    function read(code) { var r = localStorage.getItem('fake-room-' + code); return r ? JSON.parse(r) : null; }
    chan.onmessage = function (e) { (subs[e.data.code] || []).forEach(function (cb) { cb(e.data.room); }); };
    return {
      transact: function (code, fn) {
        var next = fn(read(code));
        if (next === undefined) return Promise.resolve({ committed: false, value: read(code) });
        localStorage.setItem('fake-room-' + code, JSON.stringify(next));
        chan.postMessage({ code: code, room: next });
        (subs[code] || []).forEach(function (cb) { setTimeout(function () { cb(read(code)); }, 0); });
        return Promise.resolve({ committed: true, value: next });
      },
      watch: function (code, cb) {
        (subs[code] = subs[code] || []).push(cb);
        setTimeout(function () { cb(read(code)); }, 0);
        return function () { subs[code] = subs[code].filter(function (f) { return f !== cb; }); };
      }
    };
  }

  var backend = null;
  function get() {
    if (!backend) backend = window.BASELINE_FAKE_NET ? fakeBackend() : firebaseBackend();
    return backend;
  }

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newCode() {
    var s = '';
    for (var i = 0; i < 5; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  }

  window.BaselineNet = {
    available: function () { return !!get(); },
    newCode: newCode,
    // create an empty room; resolves false if the code is taken
    create: function (code, cfg, hostName) {
      return get().transact(code, function (cur) {
        if (cur) return undefined;
        return { cfg: cfg, names: [hostName, ''], state: '', ver: 0, created: Date.now() };
      }).then(function (r) { return r.committed; });
    },
    // join as guest; makeState(room) builds the first match state
    join: function (code, guestName, makeState) {
      return get().transact(code, function (cur) {
        if (!cur || cur.names[1]) return undefined;
        cur.names[1] = guestName;
        cur.state = makeState(cur);
        cur.ver = 1;
        return cur;
      }).then(function (r) { return r; });
    },
    // write a new state only if nobody else wrote since expectedVer
    commit: function (code, expectedVer, state) {
      return get().transact(code, function (cur) {
        if (!cur || cur.ver !== expectedVer) return undefined;
        cur.state = state;
        cur.ver = expectedVer + 1;
        return cur;
      }).then(function (r) { return r.committed; });
    },
    watch: function (code, cb) { return get().watch(code, cb); }
  };
})();
