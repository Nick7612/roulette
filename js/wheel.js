/* European wheel: canvas rendering + ball flight. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30,
               8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
               28, 12, 35, 3, 26];
  var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  var STEP = TAU / ORDER.length;
  var POCKET_FRAC = 0.775;

  var pocketIndex = {};
  ORDER.forEach(function (n, i) { pocketIndex[n] = i; });
  var redSet = {};
  RED.forEach(function (n) { redSet[n] = true; });

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) { /* ignore */ }

  var canvas = null;
  var ctx = null;
  var size = 0;
  var wheelAngle = 0;
  var ballAngle = 0;
  var ballR = POCKET_FRAC;
  var restSlip = 0;
  var highlight = -1;
  var flight = null;
  var idle = true;
  var lastFrame = 0;

  /* ---------- drawing ---------- */

  function draw(now) {
    if (!ctx || !size) return;
    var cx = size / 2;
    var cy = size / 2;
    var R = size / 2 - 1;

    ctx.clearRect(0, 0, size, size);

    var bowl = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
    bowl.addColorStop(0, '#7d5a33');
    bowl.addColorStop(0.55, '#3e2714');
    bowl.addColorStop(1, '#150c05');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = bowl;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.995, 0, TAU);
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wheelAngle);
    drawPockets(R);
    drawCone(R);
    drawHighlight(R, now);
    ctx.restore();

    drawDiamonds(cx, cy, R);
    drawBall(cx, cy, R);
  }

  function drawPockets(R) {
    var out = R * 0.905;
    var inn = R * 0.695;
    var i, n, mid, a0, a1;

    for (i = 0; i < ORDER.length; i++) {
      n = ORDER[i];
      mid = i * STEP;
      a0 = mid - STEP / 2;
      a1 = mid + STEP / 2;

      ctx.beginPath();
      ctx.arc(0, 0, out, a0, a1);
      ctx.arc(0, 0, inn, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = n === 0 ? '#0d7a45' : redSet[n] ? '#a5121f' : '#121317';
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.0045);
      ctx.strokeStyle = 'rgba(216,178,92,0.5)';
      ctx.stroke();
    }

    var nr = R * 0.862;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (R * 0.052).toFixed(1) + 'px "Trebuchet MS", system-ui, sans-serif';

    for (i = 0; i < ORDER.length; i++) {
      n = ORDER[i];
      ctx.save();
      ctx.rotate(i * STEP);
      ctx.translate(nr, 0);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#f7eeda';
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
  }

  function drawCone(R) {
    var inn = R * 0.695;

    var g = ctx.createRadialGradient(0, 0, inn * 0.1, 0, 0, inn);
    g.addColorStop(0, '#241508');
    g.addColorStop(0.55, '#150c05');
    g.addColorStop(1, '#0a0503');
    ctx.beginPath();
    ctx.arc(0, 0, inn, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    for (var i = 0; i < 8; i++) {
      var a = i * TAU / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inn * 0.22, Math.sin(a) * inn * 0.22);
      ctx.lineTo(Math.cos(a) * inn * 0.97, Math.sin(a) * inn * 0.97);
      ctx.strokeStyle = 'rgba(216,178,92,0.16)';
      ctx.lineWidth = Math.max(1, R * 0.006);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 0, inn, 0, TAU);
    ctx.strokeStyle = '#b08a3c';
    ctx.lineWidth = Math.max(1.5, R * 0.012);
    ctx.stroke();

    var hubR = R * 0.155;
    var hg = ctx.createRadialGradient(-hubR * 0.3, -hubR * 0.35, hubR * 0.1, 0, 0, hubR);
    hg.addColorStop(0, '#f2e3b8');
    hg.addColorStop(0.5, '#c19a46');
    hg.addColorStop(1, '#5d4318');
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, TAU);
    ctx.fillStyle = hg;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.55, 0, TAU);
    ctx.fillStyle = '#3a2810';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.3, 0, TAU);
    ctx.fillStyle = '#e8cf8d';
    ctx.fill();
  }

  function drawHighlight(R, now) {
    if (highlight < 0) return;
    var mid = highlight * STEP;
    var out = R * 0.905;
    var inn = R * 0.695;
    var pulse = 0.6 + 0.4 * Math.sin(now / 200);
    var inset = 0.012;

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, out - 1, mid - STEP / 2 + inset, mid + STEP / 2 - inset);
    ctx.arc(0, 0, inn + 1, mid + STEP / 2 - inset, mid - STEP / 2 + inset, true);
    ctx.closePath();
    ctx.shadowColor = 'rgba(255,214,120,0.95)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(255,230,160,' + (0.45 + 0.55 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, R * 0.014);
    ctx.stroke();
    ctx.restore();
  }

  function drawDiamonds(cx, cy, R) {
    var rr = R * 0.958;
    ctx.save();
    ctx.translate(cx, cy);
    for (var i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate(i * TAU / 8 + TAU / 16);
      ctx.translate(rr, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(242,222,172,0.9)';
      ctx.fillRect(-R * 0.008, -R * 0.008, R * 0.016, R * 0.016);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBall(cx, cy, R) {
    var r = ballR * R;
    var x = cx + Math.cos(ballAngle) * r;
    var y = cy + Math.sin(ballAngle) * r;
    var br = R * 0.032;

    ctx.beginPath();
    ctx.ellipse(x + br * 0.4, y + br * 0.55, br * 0.95, br * 0.78, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    var g = ctx.createRadialGradient(x - br * 0.35, y - br * 0.4, br * 0.08, x, y, br);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#efe9dc');
    g.addColorStop(1, '#9d9587');
    ctx.beginPath();
    ctx.arc(x, y, br, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ---------- animation ---------- */

  function radiusFor(p) {
    var dropStart = 0.58;
    var track = 0.952;
    if (p < dropStart) {
      return track + Math.sin(p * 60) * 0.0035;
    }
    var q = (p - dropStart) / (1 - dropStart);
    var ease = q * q * (3 - 2 * q);
    var r = track + (POCKET_FRAC - track) * ease;
    var hop = Math.sin(q * Math.PI * 4) * Math.pow(1 - q, 2) * 0.05;
    return r + Math.abs(hop);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;

    if (flight) {
      var p = Math.min(1, (now - flight.t0) / flight.dur);
      var eW = 1 - Math.pow(1 - p, 2.1);
      var eS = 1 - Math.pow(1 - p, 3.1);

      wheelAngle = flight.w0 + flight.wRot * eW;
      var slip = flight.s0 + (flight.sEnd - flight.s0) * eS;
      ballAngle = wheelAngle + slip;
      ballR = radiusFor(p);

      var idx = Math.floor(slip / STEP);
      if (idx !== flight.lastIdx) {
        flight.lastIdx = idx;
        if (now / 1000 - flight.lastTickAt > 0.03) {
          flight.lastTickAt = now / 1000;
          var pps = Math.abs(slip - flight.lastSlip) / Math.max(dt, 0.001) / STEP;
          if (window.Sfx) window.Sfx.tick(Math.min(1, pps / 26));
        }
      }
      flight.lastSlip = slip;

      if (p >= 1) {
        wheelAngle = flight.w0 + flight.wRot;
        ballAngle = wheelAngle + flight.target;
        restSlip = flight.target;
        ballR = POCKET_FRAC;
        highlight = flight.win;
        idle = true;
        if (window.Sfx) window.Sfx.land();
        var done = flight.resolve;
        flight = null;
        if (done) done();
      }
    } else if (idle) {
      wheelAngle += (reduceMotion ? 0 : 0.035) * dt;
      ballAngle = wheelAngle + restSlip;
      ballR = POCKET_FRAC;
    }

    draw(now);
  }

  /* ---------- public ---------- */

  function resize() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var px = Math.round(rect.width);
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var target = Math.round(px * dpr);
    if (px === size && canvas.width === target) return;
    size = px;
    canvas.width = target;
    canvas.height = target;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function park(number) {
    var i = pocketIndex[number];
    if (i == null) return;
    restSlip = i * STEP;
    ballAngle = wheelAngle + restSlip;
    ballR = POCKET_FRAC;
    highlight = i;
    draw(performance.now());
  }

  function spin(winNumber) {
    var targetIndex = pocketIndex[winNumber];
    if (targetIndex == null) return Promise.resolve();
    if (flight) return Promise.resolve();

    var target = targetIndex * STEP;
    var s0 = restSlip;
    var w0 = wheelAngle;
    var wRot = TAU * (reduceMotion ? 0.25 : 1.4 + Math.random() * 0.9);
    var turns = reduceMotion ? 2 : 8 + Math.floor(Math.random() * 3);
    var k = Math.ceil((target - s0) / TAU) + turns;
    var sEnd = target - k * TAU;
    var dur = reduceMotion ? 1000 : 4600 + Math.random() * 700;

    highlight = -1;
    idle = false;

    return new Promise(function (resolve) {
      flight = {
        t0: performance.now(),
        dur: dur,
        w0: w0,
        wRot: wRot,
        s0: s0,
        sEnd: sEnd,
        target: target,
        win: targetIndex,
        lastIdx: Math.floor(s0 / STEP),
        lastSlip: s0,
        lastTickAt: 0,
        resolve: resolve
      };
    });
  }

  window.Wheel = {
    init: function () {
      canvas = document.getElementById('wheel');
      if (!canvas) return;
      ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;
      resize();
      if ('ResizeObserver' in window) {
        new ResizeObserver(function () { resize(); }).observe(canvas.parentElement || canvas);
      } else {
        window.addEventListener('resize', resize);
      }
      lastFrame = 0;
      requestAnimationFrame(frame);
    },
    spin: spin,
    park: park,
    clear: function () {
      highlight = -1;
      draw(performance.now());
    }
  };
})();
