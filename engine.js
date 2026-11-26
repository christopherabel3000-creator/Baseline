// Baseline tennis engine. Pure game logic, no page code.
(function (root) {
  'use strict';

  var SHOTS = {
    cross:      { name: 'crosscourt',            cat: 'cross', e: 0.05, g: 1, aggr: false, at: 'base' },
    line:       { name: 'down the line',         cat: 'line',  e: 0.10, g: 2, aggr: true,  at: 'base' },
    drop:       { name: 'a drop shot',           cat: 'short', e: 0.15, g: 0, aggr: true,  at: 'base' },
    lob:        { name: 'a lob',                 cat: 'deep',  e: 0.06, g: 0, aggr: false, at: 'base' },
    approach:   { name: 'an approach down the line', cat: 'line', e: 0.10, g: 2, aggr: true, at: 'base', toNet: true },
    vcross:     { name: 'a crosscourt volley',   cat: 'cross', e: 0.06, g: 2, aggr: false, at: 'net' },
    vline:      { name: 'a volley down the line', cat: 'line', e: 0.10, g: 3, aggr: true,  at: 'net' },
    dropvolley: { name: 'a drop volley',         cat: 'short', e: 0.12, g: 0, aggr: true,  at: 'net' }
  };
  var SHOT_ORDER = {
    base: ['cross', 'line', 'drop', 'lob', 'approach'],
    net: ['vcross', 'vline', 'dropvolley']
  };
  var SHOT_LABELS = {
    cross: 'Crosscourt', line: 'Down the line', drop: 'Drop shot', lob: 'Lob',
    approach: 'Approach and come in', vcross: 'Volley crosscourt',
    vline: 'Volley down the line', dropvolley: 'Drop volley'
  };
  var COVERS = {
    base: ['cross', 'line', 'short'],
    net: ['cross', 'line', 'deep']
  };
  var COVER_LABELS = { cross: 'Crosscourt', line: 'Down the line', short: 'Read the drop', deep: 'Read the lob' };
  var COVER_WORDS = { cross: 'crosscourt', line: 'down the line', short: 'for the drop', deep: 'for the lob' };
  var LOCS = ['wide', 'body', 't'];
  var LOC_LABELS = { wide: 'Wide', body: 'Body', t: 'Down the T' };
  var LOC_WORDS = { wide: 'out wide', body: 'into the body', t: 'down the T' };
  var SURFACE_UP = { hard: 0.5, grass: 0.6, clay: 0.4 };
  var ACE_CHANCE = { hard: 0.4, grass: 0.6, clay: 0.25 };
  var POINT_WORDS = ['0', '15', '30', '40'];

  function Match(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng || Math.random;
    this.names = cfg.names;
    this.setsToWin = { tiebreak: 1, one: 1, three: 2, five: 3 }[cfg.length];
    this.sets = [];               // finished sets: [a, b, tiebreakLoser points or null]
    this.setWins = [0, 0];
    this.games = [0, 0];
    this.points = [0, 0];
    this.tiebreak = cfg.length === 'tiebreak';
    this.tbTarget = 7;
    this.tbFirst = null;
    this.server = cfg.firstServer;
    this.stamina = [100, 100];
    this.log = [];
    this.over = false;
    this.winner = null;
    this.stats = [newStats(), newStats()];
    // tendencies, for the computer: what each player does
    this.tend = [newTend(), newTend()];
    if (this.tiebreak) this.tbFirst = this.server;
    this.startPoint();
  }

  function newStats() { return { aces: 0, doubles: 0, winners: 0, errors: 0, points: 0 }; }
  function newTend() {
    return {
      shot: { base: { cross: 1, line: 1, short: 1, deep: 1 }, net: { cross: 1, line: 1, short: 1, deep: 1 } },
      serve: { wide: 1, body: 1, t: 1 },
      cover: { cross: 1, line: 1, short: 1, deep: 1 }
    };
  }

  var P = Match.prototype;

  P.other = function (p) { return 1 - p; };
  P.r = function () { return this.rng(); };
  P.up = function () { return this.r() < SURFACE_UP[this.cfg.surface] ? 1 : 0; };
  P.say = function (text) { this.log.push(text); };

  P.startPoint = function () {
    this.pl = [
      { pos: 'base', d: 0, sitter: 0, jam: false },
      { pos: 'base', d: 0, sitter: 0, jam: false }
    ];
    this.cover = [null, null];
    this.serveNum = 1;
    this.read = null;
    this.rally = 0;
    this.pending = { type: 'read', player: this.other(this.server) };
  };

  P.fatigue = function (p) { return (100 - this.stamina[p]) * 0.0015; };
  P.drain = function (p, aggr, scramble) {
    var c = 0.12 + (aggr ? 0.15 : 0) + (scramble ? 0.15 : 0);
    this.stamina[p] = Math.max(0, this.stamina[p] - c);
  };

  // returner guesses the serve location
  P.doRead = function (loc) {
    if (this.pending.type !== 'read') throw new Error('not reading');
    this.read = loc;
    this.pending = { type: 'serve', player: this.server };
  };

  P.serveFault = function (type) {
    var base = type === 'flat' ? (this.serveNum === 1 ? 0.36 : 0.40) : 0.10;
    return base + this.fatigue(this.server);
  };

  P.doServe = function (type, loc, cover) {
    if (this.pending.type !== 'serve') throw new Error('not serving');
    var s = this.server, o = this.other(s), n = this.names;
    this.tend[s].serve[loc]++;
    this.drain(s, type === 'flat', false);
    var label = (this.serveNum === 1 ? 'first' : 'second') + ' serve';
    if (this.r() < this.serveFault(type)) {
      if (this.serveNum === 1) {
        this.say(n[s] + "'s " + (type === 'flat' ? 'flat ' : '') + 'first serve is a fault.');
        this.serveNum = 2;
        this.read = null;
        this.pending = { type: 'read', player: o };
        return;
      }
      this.stats[s].doubles++;
      this.say('Double fault from ' + n[s] + '.');
      this.pointTo(o);
      return;
    }
    var right = this.read === loc;
    var A = (type === 'flat' ? 3 : 1) + this.up() - (right ? 3 : 0);
    if (loc === 'body') A = Math.min(A, 3);
    var text = n[s] + ' hits a ' + (type === 'flat' ? 'flat ' : 'spin ') + label + ' ' + LOC_WORDS[loc] + '. ';
    var winner = A >= 5 || (A === 4 && this.r() < ACE_CHANCE[this.cfg.surface]);
    if (winner) {
      this.stats[s].aces++;
      text += (!right ? 'Ace! ' : 'Unreturnable! ') + n[o] + (right ? ' read it but could not handle it.' : ' had read ' + LOC_WORDS[this.read] + '.');
      this.say(text);
      this.pointTo(s);
      return;
    }
    var d = A >= 3 ? 2 : A === 2 ? 1 : 0;
    var ret = this.pl[o];
    ret.d = d;
    ret.jam = loc === 'body' && !right;
    ret.sitter = right && type === 'spin' ? 1 : 0;
    if (right) text += n[o] + ' read it' + (ret.sitter ? ' and can attack the return.' : '.');
    else text += n[o] + ' guessed ' + LOC_WORDS[this.read] + (d === 2 ? ' and is stretched.' : d === 1 ? ' and has to reach.' : ' but gets there.');
    if (ret.jam) text += ' Jammed.';
    this.say(text);
    this.cover[s] = cover;
    this.rally = 1;
    this.pending = { type: 'shot', player: o };
  };

  P.shotError = function (p, key) {
    var h = this.pl[p], sh = SHOTS[key];
    var add = sh.aggr ? [0, 0.06, 0.15][h.d] : [0, 0.03, 0.07][h.d];
    return Math.max(0.01, sh.e + add + this.fatigue(p) + (h.jam ? 0.05 : 0) - (h.sitter ? 0.03 : 0));
  };

  P.doShot = function (key, cover) {
    if (this.pending.type !== 'shot') throw new Error('not hitting');
    var H = this.pending.player, R = this.other(H), n = this.names;
    var h = this.pl[H], r = this.pl[R], sh = SHOTS[key];
    if (sh.at !== h.pos) throw new Error('shot not allowed from ' + h.pos);
    this.tend[H].shot[r.pos][sh.cat]++;
    this.drain(H, sh.aggr, h.d === 2);
    this.rally++;

    if (this.r() < this.shotError(H, key)) {
      var miss = sh.cat === 'short' ? 'into the net' : (this.r() < 0.5 ? 'wide' : sh.cat === 'deep' ? 'long' : 'into the net');
      this.stats[H].errors++;
      this.say(n[H] + ' tries ' + sh.name + ', but it goes ' + miss + '.');
      this.pointTo(R);
      return;
    }

    var rc = this.cover[R];
    if (rc) this.tend[R].cover[rc]++;
    var right = rc === sh.cat;
    var A, sitter = 0, text = n[H] + ' hits ' + sh.name + '. ';
    var rFrom = r.pos;

    if (sh.cat === 'short') {
      if (r.pos === 'net') { A = -1; sitter = 1; text += 'It sits up for ' + n[R] + ' at the net. '; }
      else if (right) { A = 0; sitter = 1; r.pos = 'net'; text += n[R] + ' read it and is in early. '; }
      else { A = 2 + this.up() + this.up(); r.pos = 'net'; }
    } else if (sh.cat === 'deep') {
      if (r.pos === 'net') {
        if (right) { A = -1; sitter = 2; text += n[R] + ' read the lob and has an overhead. '; }
        else { A = 2 + this.up() + (h.d === 0 ? 1 : 0); r.pos = 'base'; }
      } else { A = 0; text += 'The rally resets. '; }
    } else {
      var g = sh.g;
      if (h.pos === 'base' && r.pos === 'net') g += 1;
      if (h.pos === 'net' && r.pos === 'net') g -= 1;
      A = g + this.up() + h.sitter - (h.d >= 2 ? 1 : 0) - (right ? 3 : 0);
      if (right) { sitter = 1; text += n[R] + ' read it. '; }
    }

    if (sh.toNet) h.pos = 'net';
    h.sitter = 0; h.jam = false; h.d = 0;

    var winner = A >= 4 || (A === 3 && this.r() < 0.4);
    if (winner) {
      this.stats[H].winners++;
      if (sh.cat === 'short') text += 'Winner! ' + n[R] + ' could not get there.';
      else if (sh.cat === 'deep') text += 'Winner over ' + n[R] + "'s head.";
      else text += 'Winner! ' + n[R] + (rc ? ' was covering ' + COVER_WORDS[rc] + '.' : ' could not reach it.');
      this.say(text);
      this.pointTo(H);
      return;
    }
    var d = A >= 2 ? 2 : A === 1 ? 1 : 0;
    r.d = d; r.sitter = sitter; r.jam = false;
    if (!right && sh.cat !== 'deep' && !(sh.cat === 'short' && rFrom === 'net')) {
      if (sh.cat === 'short') text += n[R] + ' sprints in' + (d === 2 ? ' and just gets it back.' : '.');
      else text += n[R] + (rc ? ' was covering ' + COVER_WORDS[rc] : '') + (d === 2 ? ', stretched.' : d === 1 ? ', has to move.' : ', gets there.');
    } else if (sh.cat === 'deep' && rFrom === 'net' && !right) {
      text += n[R] + ' has to chase it back' + (d === 2 ? ' and is in trouble.' : '.');
    }
    if (h.pos === 'net' && sh.toNet) text += ' ' + n[H] + ' comes in.';
    this.say(text.trim());
    this.cover[H] = cover;
    this.pending = { type: 'shot', player: R };
  };

  // ---------- scoring ----------
  P.pointTo = function (w) {
    var l = this.other(w), n = this.names;
    this.stats[w].points++;
    if (this.tiebreak) {
      this.points[w]++;
      var total = this.points[0] + this.points[1];
      var t = this.points;
      if (t[w] >= this.tbTarget && t[w] - t[l] >= 2) {
        this.games[w]++;
        this.finishSet(w, Math.min(t[0], t[1]));
        return;
      }
      if (total % 2 === 1) this.server = this.other(this.server);
      this.say('Point ' + n[w] + '. ' + this.scoreText());
      this.startPoint();
      return;
    }
    this.points[w]++;
    var p = this.points;
    if (p[w] >= 4 && p[w] - p[l] >= 2) {
      this.games[w]++;
      var held = w === this.server;
      this.points = [0, 0];
      this.stamina[0] = Math.min(100, this.stamina[0] + 1);
      this.stamina[1] = Math.min(100, this.stamina[1] + 1);
      var g = this.games;
      if ((g[w] >= 6 && g[w] - g[l] >= 2) || g[w] === 7) {
        this.finishSet(w, null, held);
        return;
      }
      this.server = this.other(this.server);
      if (g[0] === 6 && g[1] === 6) {
        this.tiebreak = true;
        this.tbFirst = this.server;
        var finalSet = this.setWins[0] === this.setsToWin - 1 && this.setWins[1] === this.setsToWin - 1;
        this.tbTarget = finalSet && this.cfg.length === 'five' ? 10 : 7;
        this.say((held ? 'Game ' : 'Break of serve! Game ') + n[w] + '. 6 all, tiebreak' + (this.tbTarget === 10 ? ' to 10.' : '.'));
      } else {
        this.say((held ? 'Game ' : 'Break of serve! Game ') + n[w] + '. ' + this.gamesText() + ' ' + n[this.server] + ' to serve.');
      }
      this.startPoint();
      return;
    }
    this.say('Point ' + n[w] + '. ' + this.scoreText());
    this.startPoint();
  };

  P.finishSet = function (w, tbLow, held) {
    var n = this.names;
    this.sets.push([this.games[0], this.games[1], tbLow]);
    this.setWins[w]++;
    var setLine = this.games[w] + '–' + this.games[this.other(w)];
    if (this.setWins[w] >= this.setsToWin) {
      this.over = true;
      this.winner = w;
      this.pending = null;
      var detail = this.cfg.length === 'tiebreak'
        ? this.points[w] + '–' + this.points[this.other(w)]
        : this.setsLine(w);
      this.say('Game, set and match, ' + n[w] + ', ' + detail + '.');
      return;
    }
    var wasTb = this.tiebreak;
    if (wasTb) this.server = this.other(this.tbFirst);
    else this.server = this.other(this.server);
    this.games = [0, 0];
    this.points = [0, 0];
    this.tiebreak = false;
    this.stamina[0] = Math.min(100, this.stamina[0] + 8);
    this.stamina[1] = Math.min(100, this.stamina[1] + 8);
    this.say('Set ' + n[w] + ', ' + setLine + '. ' + this.setsLeader() + ' ' + n[this.server] + ' serves to start the next set.');
    this.startPoint();
  };

  P.setsLine = function (w) {
    var l = this.other(w);
    return this.sets.map(function (s) {
      var t = s[w] + '–' + s[l];
      if (s[2] !== null && s[2] !== undefined && s[w] === 7 && s[l] === 6) t += ' (' + s[2] + ')';
      return t;
    }).join(', ');
  };

  P.setsLeader = function () {
    var s = this.setWins, n = this.names;
    if (s[0] === s[1]) return 'Sets level at ' + s[0] + ' all.';
    var lead = s[0] > s[1] ? 0 : 1;
    return n[lead] + ' leads ' + s[lead] + ' sets to ' + s[1 - lead] + '.';
  };

  P.gamesText = function () {
    var g = this.games, n = this.names;
    if (g[0] === g[1]) return g[0] + ' all in games.';
    var lead = g[0] > g[1] ? 0 : 1;
    return n[lead] + ' leads ' + g[lead] + '–' + g[1 - lead] + '.';
  };

  // point score, from the server's side
  P.scoreText = function () {
    var p = this.points, s = this.server, o = this.other(s), n = this.names;
    if (this.tiebreak) {
      if (p[0] === p[1]) return p[0] + ' all in the tiebreak.';
      var lead = p[0] > p[1] ? 0 : 1;
      return n[lead] + ' leads the tiebreak ' + p[lead] + '–' + p[1 - lead] + '.';
    }
    if (p[0] >= 3 && p[1] >= 3) {
      if (p[0] === p[1]) return 'Deuce.';
      return 'Advantage ' + n[p[0] > p[1] ? 0 : 1] + '.';
    }
    if (p[s] === p[o]) return (p[s] === 0 ? 'Love' : POINT_WORDS[p[s]]) + ' all.';
    var a = p[s] === 0 ? 'Love' : POINT_WORDS[p[s]];
    var b = p[o] === 0 ? 'love' : POINT_WORDS[p[o]];
    return a + '–' + b + '.';
  };

  P.fullScore = function () {
    var n = this.names, parts = [];
    if (this.cfg.length !== 'tiebreak' && this.cfg.length !== 'one') {
      parts.push('Sets ' + this.setWins[0] + '–' + this.setWins[1] + '.');
    }
    if (this.cfg.length !== 'tiebreak') parts.push('Games ' + this.games[0] + '–' + this.games[1] + '.');
    if (this.tiebreak) parts.push('Tiebreak ' + this.points[0] + '–' + this.points[1] + '.');
    else parts.push(this.scoreText());
    parts.push(n[this.server] + ' serving.');
    return parts.join(' ') + ' (Scores listed ' + n[0] + ' first.)';
  };

  // ---------- options for the current decision ----------
  P.shotOptions = function (p) { return SHOT_ORDER[this.pl[p].pos].slice(); };
  P.coverOptions = function (posAfter) { return COVERS[posAfter].slice(); };
  P.posAfter = function (p, key) { return SHOTS[key].toNet ? 'net' : this.pl[p].pos; };

  P.situation = function (p) {
    var me = this.pl[p], opp = this.pl[this.other(p)], n = this.names;
    var where = me.pos === 'net' ? 'at the net' : 'on the baseline';
    var state = me.sitter === 2 ? ', with an overhead' : me.sitter ? ', with a ball to attack' :
      me.d === 2 ? ', stretched' : me.d === 1 ? ', on the move' : ', balanced';
    if (me.jam) state += ', jammed';
    return 'You are ' + where + state + '. ' + n[this.other(p)] + ' is ' + (opp.pos === 'net' ? 'at the net.' : 'on the baseline.');
  };

  // ---------- computer player ----------
  function pick(rng, weights) {
    var keys = Object.keys(weights), total = 0, i;
    for (i = 0; i < keys.length; i++) total += weights[keys[i]];
    var x = rng() * total;
    for (i = 0; i < keys.length; i++) { x -= weights[keys[i]]; if (x <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function bestOf(obj, keys) {
    var best = keys[0];
    keys.forEach(function (k) { if (obj[k] > obj[best]) best = k; });
    return best;
  }
  var SMART = { easy: 0, normal: 0.45, hard: 0.75 };

  // guess where the opponent will hit, from their habits
  P.aiCover = function (p, posAfter) {
    var opts = COVERS[posAfter], o = this.other(p);
    var smart = SMART[this.cfg.difficulty];
    if (this.r() >= smart) return opts[Math.floor(this.r() * opts.length)];
    var t = this.tend[o].shot[posAfter], w = {};
    opts.forEach(function (c) { w[c] = t[c] * t[c]; });
    return pick(this.r.bind(this), w);
  };

  P.aiAct = function () {
    var pd = this.pending, p = pd.player, rng = this.r.bind(this);
    var smart = SMART[this.cfg.difficulty];
    if (pd.type === 'read') {
      var ts = this.tend[this.other(p)].serve;
      var loc = this.r() < smart ? pick(rng, { wide: ts.wide * ts.wide, body: ts.body * ts.body, t: ts.t * ts.t }) : LOCS[Math.floor(this.r() * 3)];
      this.doRead(loc);
      return;
    }
    if (pd.type === 'serve') {
      var type = this.serveNum === 1 ? (this.r() < 0.7 ? 'flat' : 'spin') : (this.r() < 0.08 ? 'flat' : 'spin');
      var sl = pick(rng, { wide: 4, body: 2, t: 4 });
      this.doServe(type, sl, this.aiCover(p, 'base'));
      return;
    }
    var me = this.pl[p], opp = this.pl[this.other(p)], w;
    if (me.pos === 'net') {
      w = { vcross: 3, vline: 3, dropvolley: opp.pos === 'base' ? 2 : 0.5 };
      if (me.sitter) { w.vline += 2; }
    } else if (opp.pos === 'net') {
      w = { cross: 3, line: 3, lob: 3, drop: 0.3, approach: 0.3 };
    } else if (me.sitter) {
      w = { cross: 2, line: 4, approach: 3, drop: 2, lob: 0.3 };
    } else if (me.d === 2) {
      w = { cross: 5, lob: 4, line: 1, drop: 0.5, approach: 0.2 };
    } else {
      w = { cross: 5, line: 3, approach: 1.5, drop: 1, lob: 1 };
    }
    // a smarter computer steers away from what you usually cover
    if (this.r() < smart) {
      var cv = this.tend[this.other(p)].cover, self = this;
      Object.keys(w).forEach(function (k) {
        var c = SHOTS[k].cat, tot = cv.cross + cv.line + cv.short + cv.deep;
        w[k] *= 1.4 - (cv[c] / tot);
      });
    }
    var key = pick(rng, w);
    this.doShot(key, this.aiCover(p, this.posAfter(p, key)));
  };

  var api = {
    Match: Match, SHOTS: SHOTS, SHOT_LABELS: SHOT_LABELS, COVER_LABELS: COVER_LABELS,
    LOCS: LOCS, LOC_LABELS: LOC_LABELS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Baseline = api;
})(this);
