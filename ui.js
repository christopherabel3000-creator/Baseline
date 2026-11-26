(function () {
  'use strict';
  var B = window.Baseline;
  var SAVE_KEY = 'baseline-save-v2';
  var $ = function (id) { return document.getElementById(id); };

  var game = null;   // { m, mode, hide, humans, seen, holder }
  var step = null;   // current human decision in progress

  // ---------- setup ----------
  function syncSetup() {
    var pass = document.querySelector('input[name=mode]:checked').value === 'pass';
    $('name2Wrap').hidden = !pass;
    $('hideWrap').hidden = !pass;
    $('diffWrap').hidden = pass;
  }
  document.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', syncSetup); });

  $('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var mode = document.querySelector('input[name=mode]:checked').value;
    var n1 = $('name1').value.trim() || 'Player 1';
    var n2 = mode === 'cpu' ? 'Computer' : ($('name2').value.trim() || 'Player 2');
    if (n1 === n2) n2 += ' 2';
    newMatch({
      names: [n1, n2],
      length: $('length').value,
      surface: $('surface').value,
      difficulty: $('difficulty').value
    }, mode, mode === 'pass' && $('hide').checked);
  });

  function newMatch(cfg, mode, hide) {
    cfg = Object.assign({}, cfg, { firstServer: Math.random() < 0.5 ? 0 : 1 });
    var m = new B.Match(cfg);
    m.log.unshift(cfg.names[cfg.firstServer] + ' wins the toss and will serve.');
    game = { m: m, mode: mode, hide: hide, humans: [true, mode === 'pass'], seen: [0, 0], holder: null };
    loop();
  }

  // ---------- save and resume ----------
  function save() {
    try {
      if (!game || game.m.over) { localStorage.removeItem(SAVE_KEY); return; }
      var data = {}, m = game.m;
      Object.keys(m).forEach(function (k) { if (k !== 'rng') data[k] = m[k]; });
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        m: data, mode: game.mode, hide: game.hide, humans: game.humans, seen: game.seen
      }));
    } catch (e) { /* storage unavailable */ }
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

  $('resume').addEventListener('click', function () {
    var s = loadSaved();
    if (!s) return;
    var m = Object.create(B.Match.prototype);
    Object.assign(m, s.m);
    m.rng = Math.random;
    game = { m: m, mode: s.mode, hide: s.hide, humans: s.humans, seen: s.seen, holder: null };
    loop();
  });

  // ---------- screens ----------
  function show(id) {
    ['setup', 'pass', 'play'].forEach(function (s) { $(s).hidden = s !== id; });
  }

  function showSetup() {
    game = null;
    var s = loadSaved();
    $('resume').hidden = !s;
    if (s) {
      var n = s.m.names;
      $('resume').textContent = 'Resume match: ' + n[0] + ' against ' + n[1];
    }
    syncSetup();
    show('setup');
    document.querySelector('#setup h1').focus();
  }
  document.querySelector('#setup h1').setAttribute('tabindex', '-1');

  function loop() {
    var m = game.m;
    while (!m.over && !game.humans[m.pending.player]) m.aiAct();
    save();
    if (m.over) { showEnd(); return; }
    var p = m.pending.player;
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
    if (game.mode === 'pass' && game.hide) { from = game.seen[p]; game.seen[p] = m.log.length; }
    else { from = Math.min(game.seen[0], game.seen[1]); game.seen = [m.log.length, m.log.length]; }
    return m.log.slice(from);
  }

  function renderFeed(lines) {
    var f = $('feed');
    f.innerHTML = '';
    lines.forEach(function (t) {
      var el = document.createElement('p');
      el.textContent = t;
      if (/^(Point|Game|Break|Set|Double|Game, set)/.test(t)) el.className = 'point';
      f.appendChild(el);
    });
  }

  function showDecision(p) {
    game.holder = p;
    var lines = takeFeed(p);
    renderFeed(lines);
    step = { type: game.m.pending.type, player: p, i: 0, pick: {} };
    $('choices').hidden = false;
    $('endButtons').hidden = true;
    $('quit').hidden = false;
    resetQuit();
    show('play');
    renderStep();
    if (lines.length) $('feed').focus(); else $('prompt').focus();
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

  function choose(v) {
    var m = game.m;
    if (step.type === 'read') {
      if (step.i === 0) step.pick.loc = v;
      else { m.doRead(step.pick.loc, v); return loop(); }
    } else if (step.type === 'serve') {
      if (step.i === 0) step.pick.type = v;
      else if (step.i === 1) step.pick.loc = v;
      else { m.doServe(step.pick.type, step.pick.loc, v); return loop(); }
    } else {
      if (step.i === 0) step.pick.shot = v;
      else { m.doShot(step.pick.shot, v); return loop(); }
    }
    step.i++;
    renderStep();
    $('prompt').focus();
  }

  function showEnd() {
    var m = game.m;
    clearSave();
    var lines = m.log.slice(Math.min(game.seen[0], game.seen[1]));
    game.seen = [m.log.length, m.log.length];
    renderFeed(lines);
    var st = m.stats, n = m.names;
    $('situation').textContent = [0, 1].map(function (p) {
      return n[p] + ': ' + st[p].points + ' points won, ' + st[p].aces + ' aces, ' + st[p].doubles +
        ' double faults, ' + st[p].winners + ' winners, ' + st[p].errors + ' errors.';
    }).join(' ');
    $('choices').hidden = true;
    $('endButtons').hidden = false;
    $('quit').hidden = true;
    $('score').textContent = '';
    show('play');
    $('feed').focus();
  }

  $('again').addEventListener('click', function () { newMatch(game.m.cfg, game.mode, game.hide); });
  $('newSetup').addEventListener('click', showSetup);

  var quitArmed = false;
  function resetQuit() { quitArmed = false; $('quit').textContent = 'Leave match'; }
  $('quit').addEventListener('click', function () {
    if (!quitArmed) { quitArmed = true; $('quit').textContent = 'Tap again to leave. Your match is saved.'; return; }
    showSetup();
  });

  showSetup();
})();
