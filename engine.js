// Baseline tennis engine. Pure game logic, no page code.
// Court lanes are always from the player's own view: fh = forehand side, mid, bh = backhand side.
// Both players are right-handed.
(function (root) {
  'use strict';

  var LANE_I = { fh: 0, mid: 1, bh: 2 };
  var LANES = ['fh', 'mid', 'bh'];

  // dir: cross / line / mid. g: attacking power. deep: chance it lands deep.
  var SHOTS = {
    cross:      { e: 0.05, g: 1, dir: 'cross', deep: 0.70, topspin: true },
    line:       { e: 0.10, g: 2, dir: 'line',  deep: 0.60, aggr: true },
    middle:     { e: 0.03, g: 0, dir: 'mid',   deep: 0.85, safe: true },
    slice:      { e: 0.05, g: 0, dir: 'cross', deep: 0.60, spin: 'low', safe: true },
    angle:      { e: 0.14, g: 2, dir: 'cross', deep: 0,    aggr: true, wide: true, topspin: true },
    drop:       { e: 0.15, special: 'drop', aggr: true },
    lob:        { e: 0.06, special: 'lob', safe: true },
    approach:   { e: 0.10, g: 2, dir: 'line',  deep: 0.60, aggr: true, toNet: true },
    io:         { e: 0.08, g: 1, dir: 'cross', deep: 0.70, aggr: true, runAround: true, topspin: true },
    ii:         { e: 0.14, g: 2, dir: 'line',  deep: 0.60, aggr: true, runAround: true },
    vcross:     { e: 0.06, g: 2, dir: 'cross', deep: 0.50, net: true, spin: 'low' },
    vline:      { e: 0.10, g: 3, dir: 'line',  deep: 0.50, net: true, aggr: true, spin: 'low' },
    dropvolley: { e: 0.12, special: 'drop', net: true, aggr: true },
    smash:      { e: 0.08, g: 4, dir: 'line',  deep: 0.80, net: true }
  };
  var FH_BONUS = { cross: 1, line: 1, angle: 1, approach: 1, io: 1, ii: 1 };

  var COVER_LABELS = {
    base: { fh: 'Cover your forehand side', mid: 'Recover to the middle', bh: 'Cover your backhand side', short: 'Read the drop' },
    net: { fh: 'Cover your forehand side', mid: 'Cover the middle', bh: 'Cover your backhand side', deep: 'Read the lob' }
  };
  var FOLLOW_LABELS = {
    fh: 'Stay back, cover forehand side', mid: 'Stay back in the middle',
    bh: 'Stay back, cover backhand side', sv: 'Serve and volley'
  };
  var LOCS = ['wide', 'body', 't'];
  var LOC_LABELS = { wide: 'Wide', body: 'Body', t: 'Down the T' };
  var LOC_WORDS = { wide: 'out wide', body: 'into the body', t: 'down the T' };
  var STANCES = ['in', 'normal', 'back'];
  var STANCE_LABELS = { in: 'Step in and attack', normal: 'Normal position', back: 'Stand back' };
  var STANCE_WORDS = { in: 'standing in close', normal: 'at normal depth', back: 'standing well back' };
  var SERVE_TYPES = ['flat', 'slice', 'kick'];
  var SERVE_LABELS = { flat: 'Flat, big but risky', slice: 'Slice, curves away', kick: 'Kick, safe and high' };
  var SURFACE_UP = { hard: 0.5, grass: 0.6, clay: 0.4 };
  var RALLY_WIN = { hard: 0.35, grass: 0.45, clay: 0.22 };
  var ACE_CHANCE = { hard: 0.4, grass: 0.6, clay: 0.25 };
  var POINT_WORDS = ['0', '15', '30', '40'];

  function Match(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng || Math.random;
    this.names = cfg.names;
    this.setsToWin = { tiebreak: 1, one: 1, three: 2, five: 3 }[cfg.length];
    this.sets = [];
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
    this.tend = [newTend(), newTend()];
    if (this.tiebreak) this.tbFirst = this.server;
    this.startPoint();
  }

  function newStats() { return { aces: 0, doubles: 0, winners: 0, errors: 0, points: 0 }; }
  function newTend() {
    return {
      target: { fh: 1, mid: 1, bh: 1, short: 0.5, deep: 0.5 },
      dir: { base: { cross: 2, line: 1, mid: 1, drop: 0.3, lob: 0.3 }, net: { cross: 2, line: 1, mid: 1, drop: 0.3, lob: 0.6 } },
      cover: { fh: 1, mid: 1, bh: 1, short: 0.5, deep: 0.5 },
      serve: { deuce: { wide: 1, body: 1, t: 1 }, ad: { wide: 1, body: 1, t: 1 } }
    };
  }
  function newPlayer() {
    return { pos: 'base', lane: 'mid', d: 0, sitter: 0, boost: 0, jam: false, limited: false, inc: null };
  }
  function dist(a, b) { return Math.abs(LANE_I[a] - LANE_I[b]); }
  function wingOf(lane) { return lane === 'bh' ? 'bh' : 'fh'; }
  function wingWord(w) { return w === 'bh' ? 'backhand' : 'forehand'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var P = Match.prototype;

  P.other = function (p) { return 1 - p; };
  P.r = function () { return this.rng(); };
  P.up = function () { return this.r() < SURFACE_UP[this.cfg.surface] ? 1 : 0; };
  P.say = function (text) { this.log.push(text); };

  P.side = function () {
    return (this.points[0] + this.points[1]) % 2 === 0 ? 'deuce' : 'ad';
  };

  P.startPoint = function () {
    this.pl = [newPlayer(), newPlayer()];
    this.cover = [null, null];
    this.serveNum = 1;
    this.read = null;
    this.stance = 'normal';
    this.rally = 0;
    this.pending = { type: 'read', player: this.other(this.server) };
  };

  P.fatigue = function (p) { return (100 - this.stamina[p]) * 0.0015; };
  P.drain = function (p, aggr, scramble) {
    var c = 0.12 + (aggr ? 0.15 : 0) + (scramble ? 0.15 : 0);
    this.stamina[p] = Math.max(0, this.stamina[p] - c);
  };

  // ---------- serve ----------
  P.doRead = function (loc, stance) {
    if (this.pending.type !== 'read') throw new Error('not reading');
    this.read = loc;
    this.stance = stance || 'normal';
    this.pending = { type: 'serve', player: this.server };
  };

  P.serveFault = function (type) {
    var base = type === 'flat' ? (this.serveNum === 1 ? 0.36 : 0.40) : type === 'slice' ? 0.16 : 0.08;
    return base + this.fatigue(this.server);
  };

  P.serveLane = function (loc) {
    var deuce = this.side() === 'deuce';
    if (loc === 'body') return 'mid';
    if (loc === 'wide') return deuce ? 'fh' : 'bh';
    return deuce ? 'bh' : 'fh';
  };

  P.doServe = function (type, loc, follow) {
    if (this.pending.type !== 'serve') throw new Error('not serving');
    var s = this.server, o = this.other(s), n = this.names, side = this.side();
    this.tend[s].serve[side][loc]++;
    this.drain(s, type === 'flat', false);
    var which = this.serveNum === 1 ? 'first' : 'second';
    if (this.r() < this.serveFault(type)) {
      if (this.serveNum === 1) {
        this.say(n[s] + "'s " + (type === 'flat' ? 'big ' : '') + 'first serve ' + (this.r() < 0.5 ? 'clips the net' : 'is long') + '. Fault.');
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
    var lane = this.serveLane(loc);
    var right = this.read === loc;
    var wide = type === 'slice' && loc === 'wide' && side === 'deuce';
    var g = type === 'flat' ? 3 : 1;
    if (wide) g += 1;
    var A = g + this.up() - (right ? 3 : 0) + (this.stance === 'in' ? 1 : this.stance === 'back' ? -1 : 0);
    if (loc === 'body') A = Math.min(A, 3);

    var verb = type === 'flat' ? 'fires a flat ' : type === 'slice' ? 'slices a ' : 'kicks a ';
    var text = n[s] + ' ' + verb + which + ' serve ' + LOC_WORDS[loc];
    if (wide) text += ', pulling ' + n[o] + ' off the court';
    else if (type === 'kick' && lane === 'bh') text += ', jumping up high to the backhand';
    text += '. ';

    var winner = A >= 5 || (A === 4 && this.r() < ACE_CHANCE[this.cfg.surface]);
    if (winner) {
      this.stats[s].aces++;
      text += right ? 'Unreturnable! ' + n[o] + ' read it but could not handle it.'
        : 'Ace! ' + n[o] + ' was leaning ' + LOC_WORDS[this.read] + '.';
      this.say(text);
      this.pointTo(s);
      return;
    }
    var d = A >= 3 ? 2 : A === 2 ? 1 : 0;
    var ret = this.pl[o];
    ret.d = d;
    ret.lane = lane;
    ret.jam = loc === 'body' && !right;
    ret.limited = wide || d === 2;
    ret.sitter = right && type !== 'flat' ? 1 : 0;
    ret.boost = this.stance === 'in' ? 1 : this.stance === 'back' ? -1 : 0;
    ret.inc = { lane: lane, depth: 'deep', spin: type === 'kick' ? 'heavy' : type === 'slice' ? 'low' : 'flat' };
    if (right) text += n[o] + ' read it' + (ret.sitter ? ' and can attack the return.' : '.');
    else text += n[o] + ' was leaning ' + LOC_WORDS[this.read] + (d === 2 ? ' and is stretched.' : d === 1 ? ' and has to reach.' : ' but gets there.');
    if (ret.jam) text += ' Jammed.';
    this.say(text);

    var sv = this.pl[s];
    sv.lane = 'mid';
    if (follow === 'sv') { sv.pos = 'net'; this.cover[s] = 'mid'; this.tend[s].cover.mid++; this.log[this.log.length - 1] += ' ' + n[s] + ' follows it in.'; }
    else this.cover[s] = follow;
    this.rally = 1;
    this.pending = { type: 'shot', player: o };
  };

  // ---------- rally ----------
  P.targetOf = function (lane, dir) {
    if (dir === 'mid') return 'mid';
    if (dir === 'cross') return lane === 'fh' ? 'fh' : 'bh';
    return lane === 'fh' ? 'bh' : 'fh';
  };

  P.wingFor = function (p, key) {
    var h = this.pl[p];
    if (SHOTS[key].runAround) return 'fh';
    return wingOf(h.inc ? h.inc.lane : h.lane);
  };

  P.shotError = function (p, key) {
    var h = this.pl[p], sh = SHOTS[key], inc = h.inc || {}, wing = this.wingFor(p, key);
    var e = sh.e + (sh.aggr ? [0, 0.06, 0.15][h.d] : [0, 0.03, 0.07][h.d]) + this.fatigue(p);
    if (h.jam) e += 0.05;
    if (h.sitter) e -= 0.03;
    if (!sh.net && inc.depth === 'deep' && sh.aggr) e += 0.03;
    if (!sh.net && inc.spin === 'low' && (sh.aggr || sh.topspin) && key !== 'approach') e += 0.04;
    if (inc.spin === 'heavy' && wing === 'bh' && key !== 'slice' && !sh.net) e += 0.04;
    if (sh.special === 'drop' && inc.depth === 'deep' && !sh.net) e += 0.05;
    if (sh.net && inc.spin === 'low') e += 0.04;
    return Math.max(0.01, e);
  };

  P.shotPower = function (p, key) {
    var h = this.pl[p], r = this.pl[this.other(p)], sh = SHOTS[key], inc = h.inc || {}, wing = this.wingFor(p, key);
    var g = sh.g + h.sitter + h.boost - (h.d >= 2 ? 1 : 0);
    if (wing === 'fh' && FH_BONUS[key]) g += 1;
    if (!sh.net && inc.depth === 'deep' && sh.aggr) g -= 1;
    if (!sh.net && inc.spin === 'low' && (sh.aggr || sh.topspin) && key !== 'approach') g -= 1;
    if (inc.spin === 'heavy' && wing === 'bh' && key !== 'slice' && !sh.net) g -= 1;
    if (sh.net && inc.spin === 'low' && key !== 'smash') g -= 1;
    if (h.pos === 'base' && r.pos === 'net') g += 1;
    if (h.pos === 'net' && r.pos === 'net') g -= 1;
    if (sh.wide) g += 1;
    return g;
  };

  P.landing = function (R, target, depth, wide) {
    var who = this.names[R] + "'s ";
    if (wide) return 'short and wide to ' + who + wingWord(wingOf(target)) + ', pulling them off the court';
    var where = target === 'mid' ? 'down the middle' : 'to ' + who + wingWord(target);
    return (depth === 'deep' ? 'deep ' : depth === 'short' ? 'short ' : '') + where;
  };

  P.verb = function (p, key, wing) {
    var w = wingWord(wing), h = this.pl[p];
    switch (key) {
      case 'cross': return h.lane === 'mid' ? 'hits a ' + w : (wing === 'fh' ? 'rips a forehand crosscourt' : 'drives a backhand crosscourt');
      case 'line': return h.lane === 'mid' ? 'hits a ' + w : 'goes down the line with the ' + w;
      case 'middle': return 'plays a safe ' + w;
      case 'slice': return wing === 'bh' ? 'slices a low backhand crosscourt' : 'throws out a defensive forehand slice';
      case 'angle': return 'carves a short-angle ' + w + ' crosscourt';
      case 'drop': return 'feathers a ' + w + ' drop shot';
      case 'lob': return 'throws up a ' + w + ' lob';
      case 'approach': return this.rally === 1
        ? 'chips the return' + (wing === 'bh' ? ' with a backhand slice' : '') + ' and charges the net'
        : 'approaches down the line with ' + (wing === 'bh' ? 'a backhand slice' : 'the forehand') + ' and comes in';
      case 'io': return 'runs around the backhand and cracks an inside-out forehand';
      case 'ii': return 'runs around the backhand and goes inside-in with the forehand';
      case 'vcross': return 'punches a ' + w + ' volley crosscourt';
      case 'vline': return 'punches a ' + w + ' volley down the line';
      case 'dropvolley': return 'softens a drop volley';
      case 'smash': return 'smashes an overhead';
    }
    return 'hits';
  };

  P.doShot = function (key, cover) {
    if (this.pending.type !== 'shot') throw new Error('not hitting');
    var H = this.pending.player, R = this.other(H), n = this.names;
    var h = this.pl[H], r = this.pl[R], sh = SHOTS[key];
    if (this.shotOptions(H).indexOf(key) < 0) throw new Error('shot not allowed: ' + key);
    var wing = this.wingFor(H, key);
    var fromLane = sh.runAround ? 'bh' : (h.inc ? h.inc.lane : h.lane);
    h.lane = fromLane;
    this.drain(H, sh.aggr, h.d === 2);
    this.rally++;
    var verb = this.verb(H, key, wing);

    if (this.r() < this.shotError(H, key)) {
      var miss = sh.special === 'drop' ? 'it finds the net' : sh.special === 'lob' ? "it's long"
        : ["it finds the net", "it's wide", "it's long"][Math.floor(this.r() * (sh.net ? 2 : 3))];
      this.stats[H].errors++;
      this.say(n[H] + ' ' + verb + ', but ' + miss + '.');
      this.pointTo(R);
      return;
    }

    var rc = this.cover[R];
    var rLimitedBefore = r.limited;
    var A, sitter = 0, target, depth, spin, wide = false, text = n[H] + ' ' + verb, outcome = '';

    if (sh.special === 'drop') {
      target = this.targetOf(fromLane, 'cross');
      depth = 'short'; spin = 'low';
      text += '.';
      if (r.pos === 'net') { A = -1; sitter = 1; outcome = 'It sits up for ' + n[R] + ' at the net.'; }
      else if (rc === 'short') { A = 0; sitter = 1; r.pos = 'net'; outcome = n[R] + ' read the drop and is in early.'; }
      else { A = 2 + this.up() + this.up(); r.pos = 'net'; }
    } else if (sh.special === 'lob') {
      target = 'bh'; depth = 'deep'; spin = 'heavy';
      text += '.';
      if (r.pos === 'net') {
        if (rc === 'deep') { A = -1; sitter = 2; outcome = n[R] + ' read the lob and has an overhead.'; }
        else { A = 2 + this.up() + (h.d === 0 ? 1 : 0); r.pos = 'base'; r.limited = true; }
      } else { A = 0; outcome = 'Deep and high, the rally resets.'; }
    } else {
      target = this.targetOf(fromLane, sh.dir);
      wide = !!sh.wide;
      var deepP = sh.deep * (h.d === 2 ? 0.6 : 1) + (h.sitter ? 0.1 : 0);
      var shortP = (sh.aggr ? 0.10 : 0.06) + (h.d === 2 ? 0.15 : h.d === 1 ? 0.05 : 0);
      var roll = this.r();
      depth = wide ? 'short' : roll < deepP ? 'deep' : roll > 1 - shortP ? 'short' : 'mid';
      spin = sh.spin || (key === 'approach' && wing === 'bh' ? 'low' : sh.topspin && wing === 'fh' ? 'heavy' : 'flat');
      var stand = rc === 'short' || rc === 'deep' ? 'mid' : (rc || 'mid');
      var dd = dist(stand, target);
      var place = dd === 0 ? -3 : dd === 1 ? 0 : 2;
      if (rc === 'short' || rc === 'deep') place += 1;
      A = this.shotPower(H, key) + this.up() + place;
      if (dd === 0 && rc !== 'short' && rc !== 'deep') sitter = 1;
      var land = this.landing(R, target, depth, wide);
      text += (/^(deep|short)/.test(land) ? ', ' : ' ') + land + '.';
    }

    if (sh.toNet) { h.pos = 'net'; h.lane = 'mid'; }
    var hitterLimited = !sh.toNet && h.pos === 'base' && (h.d === 2 || h.limited || !!sh.runAround);
    h.sitter = 0; h.boost = 0; h.jam = false; h.d = 0; h.inc = null;
    h.limited = hitterLimited;
    if (target !== 'mid' || sh.special) this.tend[H].target[sh.special === 'drop' ? 'short' : sh.special === 'lob' ? 'deep' : target]++;
    else this.tend[H].target.mid++;
    if (rc) this.tend[R].cover[rc]++;
    this.tend[H].dir[r.pos === 'net' && sh.special !== 'drop' ? 'net' : (r.pos === 'net' ? 'net' : 'base')][sh.special || sh.dir]++;

    var winner = A >= 5 || (A === 4 && this.r() < RALLY_WIN[this.cfg.surface]);
    if (winner) {
      this.stats[H].winners++;
      if (sh.special === 'drop') outcome = 'Winner! ' + n[R] + ' could not get there.';
      else if (sh.special === 'lob') outcome = 'Winner over ' + n[R] + "'s head.";
      else if (key === 'smash') outcome = 'Put away.';
      else if (rLimitedBefore && rc && dist(rc === 'short' || rc === 'deep' ? 'mid' : rc, target) === 2) outcome = 'Winner into the open court!';
      else if (rc && rc !== 'mid' && rc !== 'short' && rc !== 'deep' && dist(rc, target) === 2) outcome = 'Winner! ' + n[R] + ' was covering the other side.';
      else if (rc && dist(rc === 'short' || rc === 'deep' ? 'mid' : rc, target) === 0) outcome = 'Winner! ' + n[R] + ' read it but could not handle the pace.';
      else outcome = 'Winner! ' + n[R] + ' could not reach it.';
      this.say(text + ' ' + outcome);
      this.pointTo(H);
      return;
    }

    var d = A >= 3 ? 2 : A === 2 ? 1 : 0;
    if (depth === 'short' && d < 2 && !sitter) sitter = 1;
    r.d = d; r.sitter = sitter; r.boost = 0; r.jam = false;
    r.inc = { lane: target, depth: depth, spin: spin };
    r.lane = target;
    r.limited = r.pos === 'base' && (d === 2 || wide);
    if (!outcome) {
      if (sitter === 1 && depth === 'short' && rc !== 'short') outcome = 'It sits up short for ' + n[R] + '.';
      else if (sitter === 1) outcome = n[R] + ' read it.';
      else if (sh.special === 'drop') outcome = n[R] + ' sprints in' + (d === 2 ? ' and just gets a racket on it.' : '.');
      else if (sh.special === 'lob') outcome = n[R] + ' has to chase it back' + (d === 2 ? ' and is in trouble.' : '.');
      else outcome = n[R] + (d === 2 ? ' is stretched.' : d === 1 ? ' has to move.' : ' gets there comfortably.');
    }
    this.say(text + ' ' + outcome);
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
  P.shotOptions = function (p) {
    var h = this.pl[p];
    if (h.pos === 'net') return h.sitter === 2 ? ['smash', 'vcross', 'vline', 'dropvolley'] : ['vcross', 'vline', 'dropvolley'];
    var inc = h.inc || { lane: h.lane, depth: 'deep', spin: 'flat' }, list = ['cross', 'line'];
    if (inc.lane === 'bh' && h.d === 0 && inc.spin !== 'low') list.push('io', 'ii');
    list.push('middle');
    if (wingOf(inc.lane) === 'bh' || h.d === 2) list.push('slice');
    if (h.d < 2) list.push('angle', 'drop', 'approach');
    list.push('lob');
    return list;
  };

  P.shotLabel = function (p, key) {
    var h = this.pl[p], lane = h.inc ? h.inc.lane : h.lane, w = cap(wingWord(wingOf(lane)));
    switch (key) {
      case 'cross': return lane === 'mid' ? 'Forehand to their backhand' : w + ' crosscourt';
      case 'line': return lane === 'mid' ? 'Forehand to their forehand' : w + ' down the line';
      case 'middle': return 'Deep down the middle';
      case 'slice': return wingOf(lane) === 'bh' ? 'Backhand slice crosscourt' : 'Defensive forehand slice';
      case 'angle': return 'Short angle crosscourt';
      case 'drop': return 'Drop shot';
      case 'lob': return 'Lob';
      case 'approach': return this.rally === 1 ? 'Chip and charge the net' : 'Approach down the line and come in';
      case 'io': return 'Run around: inside-out forehand';
      case 'ii': return 'Run around: inside-in forehand';
      case 'vcross': return 'Volley crosscourt';
      case 'vline': return 'Volley down the line';
      case 'dropvolley': return 'Drop volley';
      case 'smash': return 'Overhead smash';
    }
    return key;
  };

  P.coverOptions = function (p, key) {
    var h = this.pl[p], sh = SHOTS[key];
    var pos = sh.toNet ? 'net' : h.pos;
    if (pos === 'net') return ['fh', 'mid', 'bh', 'deep'];
    var from = sh.runAround ? 'bh' : (h.inc ? h.inc.lane : h.lane);
    var limited = h.d === 2 || h.limited || !!sh.runAround;
    if (!limited) return ['fh', 'mid', 'bh', 'short'];
    return LANES.filter(function (l) { return dist(l, from) <= 1; });
  };
  P.coverLabel = function (p, key, c) {
    var pos = SHOTS[key].toNet ? 'net' : this.pl[p].pos;
    return COVER_LABELS[pos][c];
  };
  P.followOptions = function () { return ['fh', 'mid', 'bh', 'sv']; };

  P.serveSituation = function (p) {
    var n = this.names, which = this.serveNum === 1 ? 'first serve' : 'second serve';
    var court = cap(this.side()) + ' court, ' + which + '.';
    if (p === this.server) return court + ' ' + n[this.other(p)] + ' is ' + STANCE_WORDS[this.stance] + '.';
    return n[this.server] + ' serving. ' + court;
  };

  P.situation = function (p) {
    var me = this.pl[p], o = this.other(p), opp = this.pl[o], n = this.names, parts = [];
    var inc = me.inc;
    if (me.sitter === 2) parts.push('A short lob, set up for an overhead.');
    else if (inc) {
      var where = inc.lane === 'mid' ? 'at your body' : 'to your ' + wingWord(inc.lane);
      var spin = inc.spin === 'heavy' ? ', heavy topspin' : inc.spin === 'low' ? ', low slice' : '';
      parts.push(cap((inc.depth === 'deep' ? 'deep ' : inc.depth === 'short' ? 'short ' : '') + 'ball ' + where + spin + '.'));
    }
    if (me.pos === 'net' && me.sitter !== 2) parts.push('You are at the net.');
    if (me.sitter === 1) parts.push('You can attack it.');
    else if (me.d === 2) parts.push('You are stretched.');
    else if (me.d === 1) parts.push('You are on the move.');
    if (me.jam) parts.push('Jammed.');
    if (opp.pos === 'net') parts.push(n[o] + ' is at the net.');
    else if (opp.limited) parts.push(n[o] + ' is pulled to their ' + wingWord(wingOf(opp.lane)) + ' side.');
    else parts.push(n[o] + ' is on the baseline.');
    return parts.join(' ');
  };

  // ---------- computer player ----------
  function pick(rng, weights) {
    var keys = Object.keys(weights), total = 0, i;
    for (i = 0; i < keys.length; i++) total += weights[keys[i]];
    var x = rng() * total;
    for (i = 0; i < keys.length; i++) { x -= weights[keys[i]]; if (x <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  var SMART = { easy: 0, normal: 0.35, hard: 0.7 };
  var PLACE = [-3, 0, 2];
  function V(A) { return A >= 5 ? 1 : A === 4 ? 0.65 : A === 3 ? 0.35 : A === 2 ? 0.15 : A === 1 ? 0 : -0.25; }

  // p covers after sending the ball to the opponent's lane L; opts are p's cover options
  P.aiCover = function (p, opts, L, pPos) {
    var self = this, o = this.other(p);
    if (this.r() >= SMART[this.cfg.difficulty]) {
      var w0 = {};
      opts.forEach(function (c) { w0[c] = c === 'mid' ? 2 : c === 'short' || c === 'deep' ? 0.4 : 1; });
      return pick(this.r.bind(this), w0);
    }
    var t = this.tend[o].dir[pPos === 'net' ? 'net' : 'base'];
    var tot = t.cross + t.line + t.mid + t.drop + t.lob;
    var best = null, bestE = Infinity;
    opts.forEach(function (c) {
      var E = 0;
      ['cross', 'line', 'mid'].forEach(function (dir) {
        var tg = self.targetOf(L, dir), stand = LANE_I[c] !== undefined ? c : 'mid';
        E += (t[dir] / tot) * (PLACE[dist(stand, tg)] + (LANE_I[c] === undefined ? 1 : 0));
      });
      E += (t.drop / tot) * (pPos === 'net' ? -1 : c === 'short' ? -2 : 3);
      E += (t.lob / tot) * (pPos === 'net' ? (c === 'deep' ? -3 : 3) : 0);
      E += self.r() * 0.6;
      if (E < bestE) { bestE = E; best = c; }
    });
    return best;
  };

  P.aiShotValue = function (p, key) {
    var o = this.other(p), me = this.pl[p], opp = this.pl[o], sh = SHOTS[key], self = this;
    var err = this.shotError(p, key), cv = this.tend[o].cover;
    var opts = opp.pos === 'net' ? ['fh', 'mid', 'bh', 'deep'] : opp.limited
      ? LANES.filter(function (l) { return dist(l, opp.lane) <= 1; }) : ['fh', 'mid', 'bh', 'short'];
    var tot = 0; opts.forEach(function (c) { tot += cv[c]; });
    var up = SURFACE_UP[this.cfg.surface], val = 0;
    if (sh.special === 'drop') {
      var pr = opts.indexOf('short') >= 0 ? cv.short / tot : 0;
      val = opp.pos === 'net' ? -0.5 : pr * -0.3 + (1 - pr) * (0.25 * V(2) + 0.5 * V(3) + 0.25 * V(4));
    } else if (sh.special === 'lob') {
      var pl = opts.indexOf('deep') >= 0 ? cv.deep / tot : 0;
      val = opp.pos === 'net' ? pl * -0.8 + (1 - pl) * ((1 - up) * V(2 + (me.d === 0 ? 1 : 0)) + up * V(3 + (me.d === 0 ? 1 : 0))) : 0.02;
    } else {
      var from = sh.runAround ? 'bh' : (me.inc ? me.inc.lane : me.lane);
      var tg = this.targetOf(from, sh.dir), g = this.shotPower(p, key);
      opts.forEach(function (c) {
        var stand = LANE_I[c] !== undefined ? c : 'mid';
        var A = g + PLACE[dist(stand, tg)] + (LANE_I[c] === undefined ? 1 : 0);
        val += (cv[c] / tot) * ((1 - up) * V(A) + up * V(A + 1));
      });
      if (sh.runAround || (sh.aggr && me.pos === 'base' && !sh.toNet)) val -= 0.05;
    }
    return (1 - err) * val - err;
  };

  P.aiAct = function () {
    var pd = this.pending, p = pd.player, rng = this.r.bind(this), self = this;
    var smart = SMART[this.cfg.difficulty];
    if (pd.type === 'read') {
      var ts = this.tend[this.other(p)].serve[this.side()];
      var loc = this.r() < smart ? pick(rng, { wide: ts.wide * ts.wide, body: ts.body * ts.body, t: ts.t * ts.t }) : LOCS[Math.floor(this.r() * 3)];
      var st = this.serveNum === 2 ? pick(rng, { in: 5, normal: 4, back: 1 }) : pick(rng, { in: 1, normal: 6, back: 3 });
      this.doRead(loc, st);
      return;
    }
    if (pd.type === 'serve') {
      var type = this.serveNum === 1 ? pick(rng, { flat: 55, slice: 25, kick: 20 }) : pick(rng, { kick: 70, slice: 25, flat: 5 });
      var lw = { wide: 4, body: 2, t: 4 };
      if (type === 'slice' && this.side() === 'deuce') lw.wide += 4;
      if (type === 'kick' && this.side() === 'ad') lw.wide += 3;
      var sl = pick(rng, lw);
      var follow = this.serveNum === 1 && this.r() < 0.08 ? 'sv' : this.aiCover(p, ['fh', 'mid', 'bh'], this.serveLane(sl), 'base');
      this.doServe(type, sl, follow);
      return;
    }
    var me = this.pl[p], opp = this.pl[this.other(p)], w = {}, opts = this.shotOptions(p), key;
    if (this.r() < smart) {
      var best = -Infinity;
      opts.forEach(function (k) {
        var v = self.aiShotValue(p, k) + self.r() * 0.12;
        if (v > best) { best = v; key = k; }
      });
    } else {
      var base;
      if (me.pos === 'net') base = { smash: 20, vcross: 3, vline: 3, dropvolley: opp.pos === 'base' ? 2 : 0.5 };
      else if (opp.pos === 'net') base = { cross: 3, line: 3, lob: 3, slice: 1.5, middle: 0.5, io: 1, ii: 1 };
      else if (me.sitter) base = { line: 3, io: 3, ii: 2, approach: 3, angle: 2, drop: 2, cross: 2, middle: 0.5 };
      else if (me.d === 2) base = { cross: 4, middle: 3, slice: 4, lob: 3, line: 0.7 };
      else base = { cross: 5, line: 2.5, io: 2, ii: 0.8, middle: 2, slice: 1.5, angle: 1, drop: 0.8, approach: 1, lob: 0.4 };
      opts.forEach(function (k) { if (base[k]) w[k] = base[k]; });
      if (!Object.keys(w).length) opts.forEach(function (k) { w[k] = 1; });
      key = pick(rng, w);
    }
    var sh = SHOTS[key];
    var L = sh.special === 'drop' || sh.special === 'lob' ? opp.lane : this.targetOf(sh.runAround ? 'bh' : (me.inc ? me.inc.lane : me.lane), sh.dir);
    var pos = sh.toNet ? 'net' : me.pos;
    this.doShot(key, this.aiCover(p, this.coverOptions(p, key), L, pos));
  };

  var api = {
    Match: Match, SHOTS: SHOTS, LOCS: LOCS, LOC_LABELS: LOC_LABELS,
    STANCES: STANCES, STANCE_LABELS: STANCE_LABELS, SERVE_TYPES: SERVE_TYPES, SERVE_LABELS: SERVE_LABELS,
    FOLLOW_LABELS: FOLLOW_LABELS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Baseline = api;
})(this);
