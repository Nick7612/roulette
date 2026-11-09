/* Game: bets, payouts, bankroll, persistence. */
(function () {
  'use strict';

  var START_CASH = 1000;
  var STORAGE_KEY = 'roulette.v1';
  var CHIPS = [1, 5, 25, 100, 500];
  var RED = {
    1: 1, 3: 1, 5: 1, 7: 1, 9: 1, 12: 1, 14: 1, 16: 1, 18: 1,
    19: 1, 21: 1, 23: 1, 25: 1, 27: 1, 30: 1, 32: 1, 34: 1, 36: 1
  };
  var PAYOUT = { straight: 35, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen: 2, column: 2 };
  var NAMES = { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1 to 18', high: '19 to 36' };
  var DEFAULT_HINT = 'Pick a chip, then click the felt. Shift-click or right-click to take chips back.';

  var state = {
    cash: START_CASH,
    bets: {},
    lastBets: null,
    history: [],
    spins: 0,
    wagered: 0,
    best: 0,
    muted: false
  };

  var undoStack = [];
  var selectedChip = 25;
  var spinning = false;
  var cellMap = {};
  var previewed = [];
  var el = {};

  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  function shortMoney(n) {
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
    return String(n);
  }

  function colorName(n) { return n === 0 ? 'green' : RED[n] ? 'red' : 'black'; }

  function chipClass(n) {
    if (n >= 500) return 'c500';
    if (n >= 100) return 'c100';
    if (n >= 25) return 'c25';
    if (n >= 5) return 'c5';
    return 'c1';
  }

  /* ---------- bet maths ---------- */

  function betDef(id) {
    var parts = String(id).split(':');
    var kind = parts[0];
    var raw = parts[1];

    if (kind === 'straight') {
      var n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n <= 36 ? { kind: kind, value: n } : null;
    }
    if (!Object.prototype.hasOwnProperty.call(PAYOUT, kind)) return null;
    if (kind === 'dozen' || kind === 'column') {
      var v = Number(raw);
      return v >= 1 && v <= 3 && v % 1 === 0 ? { kind: kind, value: v } : null;
    }
    return raw === undefined ? { kind: kind, value: null } : null;
  }

  function wins(def, n) {
    if (def.kind === 'straight') return def.value === n;
    if (n === 0) return false;
    switch (def.kind) {
      case 'red': return !!RED[n];
      case 'black': return !RED[n];
      case 'odd': return n % 2 === 1;
      case 'even': return n % 2 === 0;
      case 'low': return n <= 18;
      case 'high': return n >= 19;
      case 'dozen': return Math.ceil(n / 12) === def.value;
      case 'column': return ((n - 1) % 3) + 1 === def.value;
      default: return false;
    }
  }

  function covered(def) {
    var out = [];
    var n;
    if (def.kind === 'straight') return [def.value];
    if (def.kind === 'red' || def.kind === 'black') {
      for (n = 1; n <= 36; n++) if ((def.kind === 'red') === !!RED[n]) out.push(n);
    } else if (def.kind === 'odd' || def.kind === 'even') {
      for (n = 1; n <= 36; n++) if ((n % 2 === 1) === (def.kind === 'odd')) out.push(n);
    } else if (def.kind === 'low') {
      for (n = 1; n <= 18; n++) out.push(n);
    } else if (def.kind === 'high') {
      for (n = 19; n <= 36; n++) out.push(n);
    } else if (def.kind === 'dozen') {
      for (n = (def.value - 1) * 12 + 1; n <= def.value * 12; n++) out.push(n);
    } else if (def.kind === 'column') {
      for (n = def.value; n <= 36; n += 3) out.push(n);
    }
    return out;
  }

  /* ---------- storage ---------- */

  function sanitizeBets(input) {
    var out = {};
    if (!input || typeof input !== 'object') return out;
    Object.keys(input).forEach(function (id) {
      var amt = input[id];
      if (betDef(id) && typeof amt === 'number' && isFinite(amt) && amt > 0) {
        out[id] = Math.round(amt);
      }
    });
    return out;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (typeof d.cash === 'number' && isFinite(d.cash)) state.cash = Math.max(0, Math.round(d.cash));
      state.bets = sanitizeBets(d.bets);
      state.lastBets = d.lastBets ? sanitizeBets(d.lastBets) : null;
      if (Array.isArray(d.history)) {
        state.history = d.history
          .filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 36; })
          .slice(0, 16);
      }
      if (typeof d.spins === 'number') state.spins = Math.max(0, d.spins | 0);
      if (typeof d.wagered === 'number') state.wagered = Math.max(0, Math.round(d.wagered));
      if (typeof d.best === 'number') state.best = Math.round(d.best);
      state.muted = !!d.muted;
    } catch (err) {
      /* corrupted storage — start fresh */
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cash: state.cash,
        bets: state.bets,
        lastBets: state.lastBets,
        history: state.history,
        spins: state.spins,
        wagered: state.wagered,
        best: state.best,
        muted: state.muted
      }));
    } catch (err) {
      /* private mode / quota — play on without saving */
    }
  }

  /* ---------- table markup ---------- */

  function numberCell(n, row, col) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell num ' + (n === 0 ? 'green' : RED[n] ? 'red' : 'black');
    b.dataset.bet = 'straight:' + n;
    b.style.gridRow = row;
    b.style.gridColumn = col;
    b.textContent = String(n);
    b.setAttribute('aria-label', 'Bet on ' + n + ', ' + colorName(n) + ', pays 35 to 1');
    return b;
  }

  function outsideCell(id, label, row, col, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell outside' + (cls ? ' ' + cls : '');
    b.dataset.bet = id;
    b.style.gridRow = row;
    b.style.gridColumn = col;
    b.textContent = label;
    var def = betDef(id);
    var pays = def ? PAYOUT[def.kind] : 1;
    var spoken = label.replace(/[–—]/g, ' to ');
    b.setAttribute('aria-label', 'Bet on ' + spoken + ', pays ' + pays + ' to 1');
    return b;
  }

  function buildBoard() {
    var frag = document.createDocumentFragment();
    var n;
    var i;

    frag.appendChild(numberCell(0, '1 / 4', '1'));

    for (n = 1; n <= 36; n++) {
      var col = Math.floor((n - 1) / 3) + 2;
      var row = 3 - ((n - 1) % 3);
      frag.appendChild(numberCell(n, String(row), String(col)));
    }

    for (i = 1; i <= 3; i++) {
      frag.appendChild(outsideCell('column:' + i, '2:1', String(4 - i), '14', 'col-bet'));
    }

    ['1st 12', '2nd 12', '3rd 12'].forEach(function (label, idx) {
      frag.appendChild(outsideCell('dozen:' + (idx + 1), label, '4', (2 + idx * 4) + ' / span 4', 'dozen'));
    });

    [
      ['low', '1 – 18'],
      ['even', 'EVEN'],
      ['red', 'RED'],
      ['black', 'BLACK'],
      ['odd', 'ODD'],
      ['high', '19 – 36']
    ].forEach(function (item, idx) {
      var cls = 'even' + (item[0] === 'red' ? ' red-cell' : item[0] === 'black' ? ' black-cell' : '');
      frag.appendChild(outsideCell(item[0], item[1], '5', (2 + idx * 2) + ' / span 2', cls));
    });

    el.board.appendChild(frag);

    cellMap = {};
    Array.prototype.forEach.call(el.board.querySelectorAll('[data-bet]'), function (cell) {
      cellMap[cell.dataset.bet] = cell;
    });
  }

  function buildChips() {
    CHIPS.forEach(function (value) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn ' + chipClass(value);
      b.dataset.value = String(value);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === selectedChip));
      b.setAttribute('aria-label', value + ' dollar chip');
      b.textContent = String(value);
      el.chips.appendChild(b);
    });
  }

  /* ---------- rendering ---------- */

  function totalStaked() {
    var total = 0;
    Object.keys(state.bets).forEach(function (id) { total += state.bets[id]; });
    return total;
  }

  function renderStacks() {
    Object.keys(cellMap).forEach(function (id) {
      var cell = cellMap[id];
      var amount = state.bets[id] || 0;
      var chip = cell.querySelector('.chip-mini');

      if (!amount) {
        if (chip) chip.remove();
        return;
      }
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'chip-mini';
        cell.appendChild(chip);
      }
      chip.className = 'chip-mini ' + chipClass(amount);
      chip.textContent = shortMoney(amount);
    });
  }

  function renderHistory() {
    el.history.textContent = '';
    if (!state.history.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '—';
      el.history.appendChild(empty);
      return;
    }
    state.history.slice(0, 12).forEach(function (n) {
      var li = document.createElement('li');
      li.className = colorName(n);
      li.textContent = String(n);
      el.history.appendChild(li);
    });
  }

  function render() {
    var onTable = totalStaked();
    el.cash.textContent = money(state.cash);
    el.staked.textContent = money(onTable);

    var net = state.cash + onTable - START_CASH;
    el.net.textContent = (net > 0 ? '+' : net < 0 ? '−' : '') + money(Math.abs(net));
    el.net.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';

    renderStacks();
    renderHistory();

    el.undo.disabled = spinning || undoStack.length === 0;
    el.clear.disabled = spinning || onTable === 0;
    el.rebet.disabled = spinning || onTable > 0 || !state.lastBets;
    el.spin.disabled = spinning || onTable === 0;

    el.stats.textContent = state.spins
      ? 'Spins ' + state.spins + ' · Wagered ' + money(state.wagered) +
        ' · Best win ' + (state.best > 0 ? '+' + money(state.best) : money(0))
      : 'No spins yet.';
  }

  function setStatus(text, tone) {
    el.status.textContent = text;
    if (tone) el.status.dataset.tone = tone;
    else delete el.status.dataset.tone;
  }

  function warn(message) {
    if (!message) return;
    setStatus(message, 'warn');
    if (window.Sfx) window.Sfx.error();
  }

  function showResult(n, returned, profit) {
    var cls = colorName(n);
    var detail = n + ' ' + cls;
    if (returned > 0) detail += ' · returned ' + money(returned);

    el.result.className = 'result show ' + cls + (profit > 0 ? ' win' : ' lose');
    el.result.textContent = '';

    var num = document.createElement('span');
    num.className = 'result-num ' + cls;
    num.textContent = String(n);

    var text = document.createElement('span');
    text.className = 'result-text';

    var strong = document.createElement('strong');
    strong.textContent = profit > 0 ? '+' + money(profit) : '−' + money(-profit);

    var small = document.createElement('small');
    small.textContent = detail;

    text.appendChild(strong);
    text.appendChild(small);
    el.result.appendChild(num);
    el.result.appendChild(text);
  }

  function setBusy(busy) {
    el.board.classList.toggle('locked', busy);
    el.spin.textContent = busy ? 'Spinning…' : 'Spin';
  }

  /* ---------- chip placement ---------- */

  function placeBet(id, amount) {
    if (spinning) return;
    var def = betDef(id);
    if (!def) return;
    if (amount > state.cash) {
      warn('Not enough cash for that chip');
      return;
    }
    state.cash -= amount;
    state.bets[id] = (state.bets[id] || 0) + amount;
    undoStack.push({ id: id, amount: amount });
    if (window.Sfx) window.Sfx.chip();
    render();
    save();
  }

  function removeBet(id) {
    if (spinning) return;
    var amount = state.bets[id];
    if (!amount) return;
    state.cash += amount;
    delete state.bets[id];
    undoStack = undoStack.filter(function (entry) { return entry.id !== id; });
    if (window.Sfx) window.Sfx.chip();
    render();
    save();
  }

  function undo() {
    if (spinning) return;
    var last = undoStack.pop();
    if (!last) return;
    var have = state.bets[last.id] || 0;
    var take = Math.min(last.amount, have);
    if (take <= 0) { render(); return; }

    var left = have - take;
    if (left > 0) state.bets[last.id] = left;
    else delete state.bets[last.id];
    state.cash += take;
    if (window.Sfx) window.Sfx.chip();
    render();
    save();
  }

  function clearAll() {
    if (spinning) return;
    var total = totalStaked();
    if (!total) return;
    state.cash += total;
    state.bets = {};
    undoStack = [];
    if (window.Sfx) window.Sfx.chip();
    setStatus('Bets cleared');
    render();
    save();
  }

  function rebet() {
    if (spinning || !state.lastBets) return;
    if (totalStaked() > 0) {
      warn('Clear the table first');
      return;
    }
    var ids = Object.keys(state.lastBets);
    var total = 0;
    ids.forEach(function (id) { total += state.lastBets[id]; });
    if (total > state.cash) {
      warn('Not enough cash to repeat that bet');
      return;
    }

    state.bets = {};
    undoStack = [];
    ids.forEach(function (id) {
      var amount = state.lastBets[id];
      state.cash -= amount;
      state.bets[id] = amount;
      undoStack.push({ id: id, amount: amount });
    });
    if (window.Sfx) window.Sfx.chip();
    setStatus('Last bet repeated');
    render();
    save();
  }

  /* ---------- spin ---------- */

  function randomInt(max) {
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
      var buf = new Uint32Array(1);
      var limit = Math.floor(4294967296 / max) * max;
      for (var i = 0; i < 64; i++) {
        c.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % max;
      }
    }
    return Math.floor(Math.random() * max);
  }

  function wheelSpin(n) {
    if (window.Wheel) return window.Wheel.spin(n);
    return new Promise(function (resolve) { setTimeout(resolve, 1400); });
  }

  function spin() {
    if (spinning) return;
    var staked = totalStaked();
    if (!staked) {
      warn('Place a bet first');
      return;
    }

    spinning = true;
    setBusy(true);
    el.result.className = 'result';

    state.lastBets = {};
    Object.keys(state.bets).forEach(function (id) { state.lastBets[id] = state.bets[id]; });

    setStatus('No more bets');
    if (window.Sfx) window.Sfx.spin();
    render();

    var n = randomInt(37);
    wheelSpin(n).then(function () { settle(n, staked); });
  }

  function settle(n, staked) {
    var returned = 0;
    Object.keys(state.bets).forEach(function (id) {
      var def = betDef(id);
      if (def && wins(def, n)) returned += state.bets[id] * (PAYOUT[def.kind] + 1);
    });
    var profit = returned - staked;

    state.cash += returned;
    state.spins += 1;
    state.wagered += staked;
    if (profit > state.best) state.best = profit;
    state.history.unshift(n);
    state.history = state.history.slice(0, 16);
    state.bets = {};
    undoStack = [];

    spinning = false;
    setBusy(false);

    if (window.Sfx) window.Sfx[profit > 0 ? 'win' : 'lose']();
    showResult(n, returned, profit);
    setStatus(profit > 0 ? 'Winner' : 'Place your bets', profit > 0 ? 'win' : '');
    if (state.cash === 0) warn('Out of chips — reset the bankroll to buy in again');
    render();
    save();
  }

  /* ---------- hover hints ---------- */

  function clearPreview() {
    previewed.forEach(function (cell) { cell.classList.remove('preview'); });
    previewed = [];
  }

  function previewBet(id) {
    clearPreview();
    var def = betDef(id);
    if (!def) return;
    covered(def).forEach(function (n) {
      var cell = cellMap['straight:' + n];
      if (cell) {
        cell.classList.add('preview');
        previewed.push(cell);
      }
    });
  }

  function describe(id) {
    var def = betDef(id);
    if (!def) return DEFAULT_HINT;

    var label;
    if (def.kind === 'straight') label = 'Number ' + def.value + ' · ' + colorName(def.value);
    else if (def.kind === 'dozen') label = ['1st', '2nd', '3rd'][def.value - 1] + ' dozen';
    else if (def.kind === 'column') label = 'Column ' + def.value;
    else label = NAMES[def.kind];

    var pays = PAYOUT[def.kind];
    return label + ' · pays ' + pays + ' to 1 · ' + money(selectedChip) +
      ' returns ' + money(selectedChip * (pays + 1));
  }

  function updateHint(id) {
    el.hint.textContent = id ? describe(id) : DEFAULT_HINT;
  }

  function selectChip(value) {
    selectedChip = value;
    Array.prototype.forEach.call(el.chips.children, function (b) {
      b.setAttribute('aria-checked', String(Number(b.dataset.value) === value));
    });
    if (window.Sfx) window.Sfx.chip();
  }

  /* ---------- sound + reset ---------- */

  function updateSoundBtn() {
    var muted = window.Sfx ? window.Sfx.isMuted() : false;
    el.sound.setAttribute('aria-pressed', String(!muted));
    el.sound.title = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
  }

  function toggleSound() {
    if (!window.Sfx) return;
    state.muted = window.Sfx.toggle();
    updateSoundBtn();
    save();
  }

  function resetBankroll() {
    if (spinning) return;
    if (!window.confirm('Reset your bankroll to ' + money(START_CASH) + ' and clear the table?')) return;

    state.cash = START_CASH;
    state.bets = {};
    state.lastBets = null;
    state.history = [];
    state.spins = 0;
    state.wagered = 0;
    state.best = 0;
    undoStack = [];

    el.result.className = 'result';
    if (window.Wheel && window.Wheel.clear) window.Wheel.clear();
    setStatus('Place your bets');
    render();
    save();
  }

  /* ---------- events ---------- */

  function cellFrom(target) {
    return target && target.closest ? target.closest('[data-bet]') : null;
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var key = e.key.toLowerCase();
    if (key === 'm') { e.preventDefault(); toggleSound(); return; }
    if (key === 'r') { e.preventDefault(); rebet(); return; }
    if (key === 'c') { e.preventDefault(); clearAll(); return; }
    if (key === 'u') { e.preventDefault(); undo(); return; }

    if (e.code === 'Space') {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      spin();
    }
  }

  function bind() {
    el.board.addEventListener('click', function (e) {
      var cell = cellFrom(e.target);
      if (!cell) return;
      if (e.shiftKey) removeBet(cell.dataset.bet);
      else placeBet(cell.dataset.bet, selectedChip);
    });

    el.board.addEventListener('contextmenu', function (e) {
      var cell = cellFrom(e.target);
      if (!cell) return;
      e.preventDefault();
      removeBet(cell.dataset.bet);
    });

    el.board.addEventListener('pointerover', function (e) {
      var cell = cellFrom(e.target);
      if (!cell) return;
      previewBet(cell.dataset.bet);
      updateHint(cell.dataset.bet);
    });

    el.board.addEventListener('pointerleave', function () {
      clearPreview();
      updateHint(null);
    });

    el.board.addEventListener('focusin', function (e) {
      var cell = cellFrom(e.target);
      if (!cell) return;
      previewBet(cell.dataset.bet);
      updateHint(cell.dataset.bet);
    });

    el.board.addEventListener('focusout', function () {
      clearPreview();
      updateHint(null);
    });

    el.board.addEventListener('keydown', function (e) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      var cell = cellFrom(e.target);
      if (!cell) return;
      e.preventDefault();
      removeBet(cell.dataset.bet);
    });

    el.chips.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip-btn');
      if (!btn) return;
      selectChip(Number(btn.dataset.value));
    });

    el.spin.addEventListener('click', spin);
    el.undo.addEventListener('click', undo);
    el.clear.addEventListener('click', clearAll);
    el.rebet.addEventListener('click', rebet);
    el.sound.addEventListener('click', toggleSound);
    el.reset.addEventListener('click', resetBankroll);

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', function () {
      if (window.Sfx) window.Sfx.init();
    }, { once: true });
  }

  /* ---------- boot ---------- */

  function init() {
    ['cash', 'staked', 'net', 'board', 'chips', 'status', 'result', 'history',
      'hint', 'stats'].forEach(function (id) { el[id] = $(id); });

    el.spin = $('spinBtn');
    el.undo = $('undoBtn');
    el.clear = $('clearBtn');
    el.rebet = $('rebetBtn');
    el.sound = $('soundBtn');
    el.reset = $('resetBtn');

    load();
    if (window.Sfx) window.Sfx.setMuted(state.muted);
    updateSoundBtn();

    buildBoard();
    buildChips();
    bind();

    if (window.Wheel) {
      window.Wheel.init();
      if (state.history.length) window.Wheel.park(state.history[0]);
    }

    setStatus(totalStaked() > 0 ? 'Bets on the table' : 'Place your bets');
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
