/* Synthesized casino sounds — no audio files, no licences, works offline. */
(function () {
  'use strict';

  var ctx = null;
  var noiseBuf = null;
  var muted = false;

  function ensure() {
    if (muted) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;

    if (!ctx) {
      try {
        ctx = new AC();
      } catch (err) {
        return null;
      }
      var len = Math.floor(ctx.sampleRate * 0.12);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var decay = Math.pow(1 - i / len, 2);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }

    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise(gain, freq, q, dur, when) {
    var c = ensure();
    if (!c) return;
    var t = c.currentTime + (when || 0);

    var src = c.createBufferSource();
    src.buffer = noiseBuf;

    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;

    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  function tone(freq, dur, opts) {
    var c = ensure();
    if (!c) return;
    opts = opts || {};
    var t = c.currentTime + (opts.when || 0);

    var osc = c.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);

    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain || 0.1), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  window.Sfx = {
    init: function () {
      ensure();
    },

    isMuted: function () {
      return muted;
    },

    setMuted: function (value) {
      muted = !!value;
      if (!muted) ensure();
    },

    toggle: function () {
      muted = !muted;
      if (!muted) ensure();
      return muted;
    },

    /* ball crossing a pocket fret; speed 0..1 */
    tick: function (speed) {
      speed = speed == null ? 0.4 : speed;
      noise(0.018 + 0.075 * speed, 1700 + 1100 * speed, 5, 0.032);
    },

    chip: function () {
      noise(0.09, 2200, 3, 0.05);
      tone(330, 0.05, { type: 'triangle', gain: 0.045 });
    },

    land: function () {
      noise(0.11, 1200, 2, 0.1);
      tone(150, 0.14, { type: 'sine', gain: 0.06, to: 80 });
    },

    spin: function () {
      noise(0.045, 650, 1.2, 0.35);
      tone(210, 0.4, { type: 'sawtooth', gain: 0.018, to: 88 });
    },

    win: function () {
      [784, 988, 1319].forEach(function (f, i) {
        tone(f, 0.55, { type: 'sine', gain: 0.09, when: i * 0.09 });
      });
      noise(0.05, 3000, 1, 0.3, 0.02);
    },

    lose: function () {
      tone(180, 0.35, { type: 'sine', gain: 0.05, to: 90 });
    },

    error: function () {
      tone(165, 0.12, { type: 'square', gain: 0.035 });
    }
  };
})();
