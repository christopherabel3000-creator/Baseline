(function () {
  'use strict';
  var B = window.Baseline, Net = window.BaselineNet;
  var SAVE_KEY = 'baseline-save-v2';
  var ONLINE_KEY = 'baseline-online-v1';
  var $ = function (id) { return document.getElementById(id); };

  // game: { m, mode: cpu|pass|online, hide, humans, seen, holder, online: { code, me, ver, unwatch } }
  var game = null;
  var step = null;
  var lobbyUnwatch = null;

  // ---------- match state to and from plain data ----------
  function dump(m) {
    var data = {};
    Object.keys(m).forEach(function (k) { if (k !== 'rng') data[k] = m[k]; });
    return JSON.stringify(data);
  }
  function load(json) {
    var m = Object.create(B.Match.prototype);
    Object.assign(m, typeof json === 'string' ? JSON.parse(json) : json);
    m.rng = Math.random;
    return m;
  }
  function freshMatch(cfg, names) {
    var c = Object.assign({}, cfg, { names: names, firstServer: Math.random() < 0.5 ? 0 : 1 });
    var m = new B.Match(c);
    m.log.unshift(names[c.firstServer] + ' wins the toss and will serve.');
    return m;
  }

  // ---------- setup ----------
  function modeValue() { return document.querySelector('input[name=mode]:checked').value; }
  function syncSetup() {
    var mode = modeValue();
    $('name2Wrap').hidden = mode !== 'pass';
    $('hideWrap').hidden = mode !== 'pass';
    $('diffWrap').hidden = mode !== 'cpu';
    $('codeWrap').hidden = mode !== 'join';
    $('matchWrap').hidden = mode === 'join';
    $('startBtn').textContent = mode === 'host' ? 'Create room' : mode === 'join' ? 'Join match' : 'Start match';
    $('setupMsg').textContent = '';
  }
  document.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', syncSetup); });

  function readCfg() {
    return { length: $('length').value, surface: $('surface').value, difficulty: $('difficulty').value };
  }

  $('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var mode = modeValue();
    var n1 = $('name1').value.trim() || 'Player 1';
    if (mode === 'host') return hostRoom(n1);
    if (mode === 'join') return joinRoom(n1);
    var n2 = mode === 'cpu' ? 'Computer' : ($('name2').value.trim() || 'Player 2');
    if (n1 === n2) n2 += ' 2';
    startLocal(freshMatch(readCfg(), [n1, n2]), mode, mode === 'pass' && $('hide').checked);
  });

  function setupMsg(t) { $('setupMsg').textContent = t; }

  function startLocal(m, mode, hide) {
    game = { m: m, mode: mode, hide: hide, humans: [true, mode === 'pass'], seen: [0, 0], holder: null };
    loop();
  }

  // ---------- local save and resume ----------
  function save() {
    if (!game || game.mode === 'online') return;
    try {
      if (game.m.over) { localStorage.removeItem(SAVE_KEY); return; }
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        m: dump(game.m), mode: game.mode, hide: game.hide, humans: game.humans, seen: game.seen
      }));
    } catch (e) { /* storage unavailable */ }
  }
  function loadJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function forget(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function remember(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  $('resume').addEventListener('click', function () {
    var s = loadJSON(SAVE_KEY);
    if (!s) return;
    game = { m: load(s.m), mode: s.mode, hide: s.hide, humans: s.humans, seen: s.seen, holder: null };
    loop();
  });
  $('rejoin').addEventListener('click', function () {
    var s = loadJSON(ONLINE_KEY);
    if (s) watchOnline(s.code, s.me, s.seen || 0);
  });

  // ---------- online ----------
  function netReady() {
    if (Net && Net.available()) return true;
    setupMsg('Online play could not connect. Check your internet connection and try again.');
    return false;
  }

  function spell(code) { return code.split('').join(' '); }

  function hostRoom(name) {
    if (!netReady()) return;
    var cfg = readCfg();
    var tries = 0;
    (function attempt() {
      var code = Net.newCode();
      Net.create(code, cfg, name).then(function (ok) {
        if (!ok) { if (++tries < 5) return attempt(); setupMsg('Could not create a room. Try again.'); return; }
        remember(ONLINE_KEY, { code: code, me: 0, seen: 0 });
        $('lobbyText').textContent = 'Room code: ' + spell(code);
        show('lobby');
        $('lobbyText').focus();
        lobbyUnwatch = Net.watch(code, function (room) {
          if (room && room.state) {
            stopLobby();
            watchOnline(code, 0, 0);
          }
        });
      }).catch(function () { setupMsg('Could not reach the server. Try again.'); });
    })();
  }
  function stopLobby() { if (lobbyUnwatch) { lobbyUnwatch(); lobbyUnwatch = null; } }
  $('lobbyCancel').addEventListener('click', function () { stopLobby(); forget(ONLINE_KEY); showSetup(); });

  function joinRoom(name) {
    if (!netReady()) return;
    var code = $('code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { setupMsg('Room codes are 5 letters and numbers.'); $('code').focus(); return; }
    setupMsg('Joining…');
    var un = Net.watch(code, function () { /* keeps the room loaded while joining */ });
    Net.join(code, name, function (room) {
      var names = [room.names[0], name === room.names[0] ? name + ' 2' : name];
      return dump(freshMatch(room.cfg, names));
    }).then(function (r) {
      un();
      if (!r.committed) {
        setupMsg(r.value ? 'That room already has two players.' : 'No room with that code. Check the code and try again.');
        return;
      }
      remember(ONLINE_KEY, { code: code, me: 1, seen: 0 });
      watchOnline(code, 1, 0);
    }).catch(function () { un(); setupMsg('Could not reach the server. Try again.'); });
  }

  function watchOnline(code, me, seen) {
    if (game && game.online && game.online.unwatch) game.online.unwatch();
    var g = { m: null, mode: 'online', hide: true, humans: [me === 0, me === 1], seen: [seen, seen], holder: me,
      online: { code: code, me: me, ver: -1, unwatch: null } };
    game = g;
    g.online.unwatch = Net.watch(code, function (room) {
      if (game !== g) return;
      if (!room || !room.state) { if (room === null) { forget(ONLINE_KEY); showSetup('That match is no longer available.'); } return; }
      if (room.ver === g.online.ver) return;
      var prevLen = g.m ? g.m.log.length : -1;
      g.online.ver = room.ver;
      g.m = load(room.state);
      if (g.m.log.length < prevLen || g.seen[me] > g.m.log.length) g.seen = [0, 0]; // rematch started
      loop();
    });
  }

  function commitOnline() {
    var g = game, o = g.online;
    var state = dump(g.m);
    showWaiting(true);
    Net.commit(o.code, o.ver, state).then(function (ok) {
      if (!ok) { $('waiting').textContent = 'That move did not go through. The match has changed, reloading.'; }
    }).catch(function () {
      $('waiting').textContent = 'Connection problem. Your move was not sent. Reopen the match from the start screen.';
    });
  }

  // ---------- screens ----------
  function show(id) {
    ['setup', 'lobby', 'pass', 'play'].forEach(function (s) { $(s).hidden = s !== id; });
  }

  function showSetup(msg) {
    if (game && game.online && game.online.unwatch) game.online.unwatch();
    game = null;
    waitingShown = false;
    var s = loadJSON(SAVE_KEY);
    $('resume').hidden = !s;
    if (s) {
      var n = JSON.parse(s.m).names;
      $('resume').textContent = 'Resume match: ' + n[0] + ' against ' + n[1];
    }
    var o = loadJSON(ONLINE_KEY);
    $('rejoin').hidden = !o;
    if (o) $('rejoin').textContent = 'Rejoin online match, room ' + spell(o.code);
    syncSetup();
    if (msg) setupMsg(msg);
    show('setup');
    document.querySelector('#setup h1').focus();
  }
  document.querySelector('#setup h1').setAttribute('tabindex', '-1');

  function loop() {
    var m = game.m;
    if (game.mode !== 'online') {
      while (!m.over && !game.humans[m.pending.player]) m.aiAct();
      save();
    }
    if (m.over) { showEnd(); return; }
    var p = m.pending.player;
    if (game.mode === 'online') {
      if (p === game.online.me) showDecision(p); else showWaiting(false);
      return;
    }
    if (game.mode === 'pass' && game.hide && game.holder !== p) showPass(p);
    else showDecision(p);
  }

  function showPass(p) {
    var n = game.m.names[p];
    $('passText').textContent = 'Pass to ' + n + '.';
    $('passReady').textContent = n + ' is ready';
    $('passReady').onclick = function () { game.holder = p; showDecision(p); };
    show('pass');
    $('passText').focus();
  }

  function takeFeed(p) {
    var m = game.m, from;
    if (game.hide) { from = game.seen[p]; game.seen[p] = m.log.length; }
    else { from = Math.min(game.seen[0], game.seen[1]); game.seen = [m.log.length, m.log.length]; }
    if (game.mode === 'online') {
      var o = loadJSON(ONLINE_KEY);
      if (o && o.code === game.online.code) { o.seen = game.seen[p]; remember(ONLINE_KEY, o); }
    }
    return m.log.slice(from);
  }

  function renderFeed(lines, append) {
    var f = $('feed');
    if (!append) f.innerHTML = '';
    lines.forEach(function (t) {
      var el = document.createElement('p');
      el.textContent = t;
      if (/^(Point|Game|Break|Set|Double|Game, set)/.test(t)) el.className = 'point';
      f.appendChild(el);
    });
  }

  function playChrome(choosing) {
    $('choices').hidden = !choosing;
    $('waiting').hidden = choosing;
    $('endButtons').hidden = true;
    $('quit').hidden = false;
    resetQuit();
    show('play');
  }

  function showDecision(p) {
    game.holder = p;
    waitingShown = false;
    var lines = takeFeed(p);
    $('feed').removeAttribute('aria-live');
    renderFeed(lines);
    step = { type: game.m.pending.type, player: p, i: 0, pick: {} };
    playChrome(true);
    renderStep();
    if (lines.length) $('feed').focus(); else $('prompt').focus();
  }

  // online: the other player is choosing
  var waitingShown = false;
  function showWaiting(justActed) {
    var m = game.m, me = game.online.me, other = m.names[1 - me];
    var wasWaiting = waitingShown;
    var lines = takeFeed(me);
    if (wasWaiting) {
      $('feed').setAttribute('aria-live', 'polite');
      renderFeed(lines, true);
    } else {
      $('feed').removeAttribute('aria-live');
      renderFeed(lines);
    }
    $('situation').textContent = '';
    $('waiting').textContent = 'Waiting for ' + other + '.';
    $('score').textContent = m.fullScore();
    playChrome(false);
    waitingShown = true;
    if (!wasWaiting) {
      if (lines.length && !justActed) $('feed').focus();
      else { $('waiting').setAttribute('tabindex', '-1'); $('waiting').focus(); }
    }
  }

  function who(p) { return game.mode === 'pass' ? game.m.names[p] + ', ' : ''; }

  function renderStep() {
    var m = game.m, p = step.player, opts = [], prompt = '', sit = '';
    if (step.type === 'read') {
      sit = m.serveSituation(p);
      if (step.i === 0) {
        prompt = who(p) + 'read the serve';
        opts = B.LOCS.map(function (l) { return [l, B.LOC_LABELS[l]]; });
      } else {
        prompt = 'Return position';
        opts = B.STANCES.map(function (s) { return [s, B.STANCE_LABELS[s]]; });
      }
    } else if (step.type === 'serve') {
      sit = m.serveSituation(p);
      if (step.i === 0) {
        prompt = who(p) + 'serve type';
        opts = B.SERVE_TYPES.map(function (t) { return [t, B.SERVE_LABELS[t]]; });
      } else if (step.i === 1) {
        prompt = 'Aim';
        opts = B.LOCS.map(function (l) { return [l, B.LOC_LABELS[l]]; });
      } else {
        prompt = 'After the serve';
        opts = m.followOptions().map(function (f) { return [f, B.FOLLOW_LABELS[f]]; });
      }
    } else {
      sit = m.situation(p);
      if (step.i === 0) {
        prompt = who(p) + 'your shot';
        opts = m.shotOptions(p).map(function (k) { return [k, m.shotLabel(p, k)]; });
      } else {
        prompt = 'Then';
        opts = m.coverOptions(p, step.pick.shot).map(function (c) { return [c, m.coverLabel(p, step.pick.shot, c)]; });
      }
    }
    $('situation').textContent = sit;
    $('prompt').textContent = prompt.charAt(0).toUpperCase() + prompt.slice(1);
    $('score').textContent = m.fullScore();
    var box = $('buttons');
    box.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o[1];
      b.addEventListener('click', function () { choose(o[0]); });
      box.appendChild(b);
    });
    if (step.i > 0) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'back';
      back.textContent = 'Back';
      back.addEventListener('click', function () { step.i--; renderStep(); $('prompt').focus(); });
      box.appendChild(back);
    }
  }

  function acted() {
    if (game.mode === 'online') commitOnline(); else loop();
  }

  function choose(v) {
    var m = game.m;
    if (step.type === 'read') {
      if (step.i === 0) step.pick.loc = v;
      else { m.doRead(step.pick.loc, v); return acted(); }
    } else if (step.type === 'serve') {
      if (step.i === 0) step.pick.type = v;
      else if (step.i === 1) step.pick.loc = v;
      else { m.doServe(step.pick.type, step.pick.loc, v); return acted(); }
    } else {
      if (step.i === 0) step.pick.shot = v;
      else { m.doShot(step.pick.shot, v); return acted(); }
    }
    step.i++;
    renderStep();
    $('prompt').focus();
  }

  function showEnd() {
    var m = game.m;
    if (game.mode !== 'online') forget(SAVE_KEY);
    var from = game.mode === 'online' ? Math.min(game.seen[game.online.me], m.log.length - 2) : Math.min(game.seen[0], game.seen[1]);
    from = Math.max(0, from);
    var lines = m.log.slice(from);
    game.seen = [m.log.length, m.log.length];
    $('feed').removeAttribute('aria-live');
    renderFeed(lines);
    var st = m.stats, n = m.names;
    $('situation').textContent = [0, 1].map(function (p) {
      return n[p] + ': ' + st[p].points + ' points won, ' + st[p].aces + ' aces, ' + st[p].doubles +
        ' double faults, ' + st[p].winners + ' winners, ' + st[p].errors + ' errors.';
    }).join(' ');
    $('choices').hidden = true;
    $('waiting').hidden = true;
    $('endButtons').hidden = false;
    $('quit').hidden = true;
    $('score').textContent = '';
    show('play');
    waitingShown = false;
    $('feed').focus();
  }

  $('again').addEventListener('click', function () {
    var m = game.m;
    if (game.mode === 'online') {
      game.m = freshMatch(m.cfg, m.names);
      game.seen = [0, 0];
      waitingShown = false;
      commitOnline();
      return;
    }
    startLocal(freshMatch(m.cfg, m.names), game.mode, game.hide);
  });
  $('newSetup').addEventListener('click', function () {
    if (game && game.mode === 'online') forget(ONLINE_KEY);
    showSetup();
  });

  var quitArmed = false;
  function resetQuit() {
    quitArmed = false;
    $('quit').textContent = 'Leave match';
  }
  $('quit').addEventListener('click', function () {
    if (!quitArmed) {
      quitArmed = true;
      $('quit').textContent = game && game.mode === 'online'
        ? 'Tap again to leave. You can rejoin from the start screen.'
        : 'Tap again to leave. Your match is saved.';
      return;
    }
    showSetup();
  });

  showSetup();
})();
