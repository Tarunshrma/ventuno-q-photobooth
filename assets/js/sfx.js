/**
 * Sound effects synthesized in the browser with Web Audio (no sound files).
 * They play on the screen showing the booth page (HDMI monitor, Bluetooth, laptop).
 */
const Sfx = (() => {
  let ctx = null;
  let enabled = () => true; // set by the app (follows "play the voice on this screen")
  let noiseBuffer = null;

  function audio() {
    if (!enabled()) return null;
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  function noise(c, start, duration, { type = 'lowpass', freq = 1000, q = 0.7, gain = 0.5, attack = 0.005, endFreq } = {}) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, start);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(g).connect(c.destination);
    src.start(start, Math.random());
    src.stop(start + duration + 0.05);
  }

  function tone(c, start, duration, { from, to, type = 'sine', gain = 0.15 }) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  // ---------- Ambient soundscape (very quiet, per theme) ----------

  let ambient = null; // { name, master, stops: [], timers: [] }
  const AMBIENT_LEVEL = 1; // the layers below are already very soft
  const DUCKED_LEVEL = 0.35; // while the booth speaks

  function every(minS, maxS, fn) {
    const timers = [];
    const next = () => {
      timers[0] = setTimeout(() => {
        if (ambient) fn();
        next();
      }, (minS + Math.random() * (maxS - minS)) * 1000);
    };
    next();
    return () => clearTimeout(timers[0]);
  }

  const AMBIENTS = {
    /** Diwali: a warm tanpura-like drone, a gentle temple bell now and then, rare distant firecrackers. */
    diwali(c, master, stops) {
      for (const [freq, gain] of [[130.81, 0.012], [196.0, 0.009], [261.63, 0.006]]) {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = c.createGain();
        g.gain.value = gain;
        const lfo = c.createOscillator(); // slow shimmer
        lfo.frequency.value = 0.15 + Math.random() * 0.1;
        const depth = c.createGain();
        depth.gain.value = gain * 0.4;
        lfo.connect(depth).connect(g.gain);
        osc.connect(g).connect(master);
        osc.start();
        lfo.start();
        stops.push(() => (osc.stop(), lfo.stop()));
      }
      stops.push(
        every(7, 14, () => {
          const t = c.currentTime;
          for (const f of [880, 1318.5]) {
            const o = c.createOscillator();
            o.frequency.value = f;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.012, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
            o.connect(g).connect(master);
            o.start(t);
            o.stop(t + 2.7);
          }
        })
      );
      stops.push(every(12, 24, () => noise(c, c.currentTime, 0.6, { type: 'lowpass', freq: 500, endFreq: 100, gain: 0.03 })));
    },

    /** Halloween: a soft breeze rising and falling, and a faraway owl now and then. */
    halloween(c, master, stops) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.8;
      const g = c.createGain();
      g.gain.value = 0.03;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoDepth = c.createGain();
      lfoDepth.gain.value = 180;
      lfo.connect(lfoDepth).connect(filter.frequency);
      const swell = c.createOscillator();
      swell.frequency.value = 0.05;
      const swellDepth = c.createGain();
      swellDepth.gain.value = 0.015;
      swell.connect(swellDepth).connect(g.gain);
      src.connect(filter).connect(g).connect(master);
      src.start();
      lfo.start();
      swell.start();
      stops.push(() => (src.stop(), lfo.stop(), swell.stop()));
      stops.push(
        every(10, 20, () => {
          const t = c.currentTime;
          for (const [start, len] of [[0, 0.35], [0.55, 0.6]]) {
            const o = c.createOscillator();
            o.frequency.setValueAtTime(430, t + start);
            o.frequency.exponentialRampToValueAtTime(390, t + start + len);
            const og = c.createGain();
            og.gain.setValueAtTime(0.0001, t + start);
            og.gain.exponentialRampToValueAtTime(0.014, t + start + 0.08);
            og.gain.exponentialRampToValueAtTime(0.0001, t + start + len);
            o.connect(og).connect(master);
            o.start(t + start);
            o.stop(t + start + len + 0.05);
          }
        })
      );
    },
  };

  return {
    setEnabled(fn) {
      enabled = fn;
    },

    /** Start the ambient soundscape for a theme (null to stop). Fades in and out gently. */
    ambient(name) {
      if (ambient && ambient.name === name) return;
      if (ambient) {
        const old = ambient;
        ambient = null;
        old.master.gain.setTargetAtTime(0, old.master.context.currentTime, 0.5);
        setTimeout(() => old.stops.forEach((stop) => stop()), 2500);
      }
      const c = name && AMBIENTS[name] ? audio() : null;
      if (!c) return;
      const master = c.createGain();
      master.gain.value = 0;
      master.connect(c.destination);
      master.gain.setTargetAtTime(AMBIENT_LEVEL, c.currentTime, 1.5);
      const stops = [];
      AMBIENTS[name](c, master, stops);
      ambient = { name, master, stops };
    },

    /** Lower the ambience while the booth is speaking. */
    duck(on) {
      if (!ambient || ambient.ducked === on) return;
      ambient.ducked = on;
      ambient.master.gain.setTargetAtTime(on ? DUCKED_LEVEL : AMBIENT_LEVEL, ambient.master.context.currentTime, 0.3);
    },

    /** Rocket whistle going up (Diwali firecracker launch). */
    launch(delay = 0) {
      const c = audio();
      if (!c) return;
      const t = c.currentTime + delay;
      tone(c, t, 0.75, { from: 700, to: 2300, type: 'triangle', gain: 0.07 });
      noise(c, t, 0.7, { type: 'bandpass', freq: 1500, endFreq: 4000, q: 2, gain: 0.08 });
    },

    /** Firework burst: a deep boom followed by crackles. */
    bang(delay = 0, size = 1) {
      const c = audio();
      if (!c) return;
      const t = c.currentTime + delay;
      noise(c, t, 1.1 * size, { type: 'lowpass', freq: 900, endFreq: 120, gain: 0.55 * size, attack: 0.004 });
      tone(c, t, 0.5, { from: 120, to: 45, type: 'sine', gain: 0.35 * size });
      for (let i = 0; i < 14 * size; i++) {
        noise(c, t + 0.25 + Math.random() * 1.1, 0.04, { type: 'highpass', freq: 3000 + Math.random() * 3000, gain: 0.05 + Math.random() * 0.06 });
      }
    },

    /** Friendly bats: soft wing flutter plus a few cute chirps (not scary). */
    bats(delay = 0) {
      const c = audio();
      if (!c) return;
      const t = c.currentTime + delay;
      for (let i = 0; i < 9; i++) {
        noise(c, t + i * 0.07, 0.06, { type: 'bandpass', freq: 600 + Math.random() * 300, q: 1.2, gain: 0.12 });
      }
      for (let i = 0; i < 3; i++) {
        const s = t + 0.15 + i * 0.18 + Math.random() * 0.05;
        const f = 1800 + Math.random() * 600;
        tone(c, s, 0.09, { from: f, to: f * 1.4, gain: 0.05 });
      }
    },

    /** Gentle thunder roll (Halloween finale), soft rather than scary. */
    thunder(delay = 0) {
      const c = audio();
      if (!c) return;
      const t = c.currentTime + delay;
      noise(c, t, 2.2, { type: 'lowpass', freq: 400, endFreq: 60, gain: 0.35, attack: 0.08 });
    },

    /** Short sparkle chime (props on, photo taken). */
    chime(delay = 0) {
      const c = audio();
      if (!c) return;
      const t = c.currentTime + delay;
      [1320, 1760, 2640].forEach((f, i) => tone(c, t + i * 0.07, 0.35, { from: f, to: f, gain: 0.05 }));
    },

    /** Camera shutter click. */
    shutter() {
      const c = audio();
      if (!c) return;
      const t = c.currentTime;
      noise(c, t, 0.05, { type: 'highpass', freq: 2000, gain: 0.25 });
      noise(c, t + 0.08, 0.06, { type: 'bandpass', freq: 1200, gain: 0.18 });
    },
  };
})();
