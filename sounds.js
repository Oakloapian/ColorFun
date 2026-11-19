/* Finish-the-picture sounds, synthesized with WebAudio (no audio files needed).
   window.playFinish(categoryName) picks a sound that matches the category. */
(function () {
  let ac;
  const ctx = () => ac || (ac = new (window.AudioContext || window.webkitAudioContext)());
  window.unlockAudio = () => { try { const c = ctx(); if (c.state === 'suspended') c.resume(); } catch (e) {} };

  const env = (g, t, attack, dur, peak) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  };
  function noise(c, dur) {
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b; return s;
  }
  function tone(type, f0, f1, t, dur, vol) {
    const c = ctx(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.02, dur, vol); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.1);
  }
  function chime(notes, step, type, vol) {
    const c = ctx(), t = c.currentTime;
    notes.forEach((f, i) => tone(type || 'triangle', f, f, t + i * step, 0.35, vol || 0.25));
  }

  /* Dinosaur roar. p = 0..1 grows the roar (small, quiet, high -> big, loud, low); crazy = the grand finale T-Rex. */
  function roar(p, crazy) {
    const c = ctx(), t = c.currentTime;
    const dur = crazy ? 3.0 : 0.35 + p * 0.85;
    const base = crazy ? 90 : 190 - p * 80;
    const vol = crazy ? 0.9 : 0.1 + p * 0.4;
    const out = c.createDynamicsCompressor(); out.connect(c.destination);
    const sh = c.createWaveShaper(), k = crazy ? 160 : 4 + p * 70, curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    sh.curve = curve;
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(900 + p * 1500, t); f.frequency.exponentialRampToValueAtTime(crazy ? 260 : 350, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    if (crazy) { g.gain.setValueAtTime(vol, t + 1.0); g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 1.35); g.gain.exponentialRampToValueAtTime(vol, t + 1.55); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sh.connect(f); f.connect(g); g.connect(out);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = crazy ? 38 : 20 + p * 18; lg.gain.value = base * (crazy ? 0.3 : 0.12); lfo.connect(lg);
    [['sawtooth', 1], ['square', 1.01]].forEach(([type, m]) => {
      const o = c.createOscillator(); o.type = type; const fr = o.frequency;
      fr.setValueAtTime(base * 0.8 * m, t);
      fr.linearRampToValueAtTime(base * 1.9 * m, t + dur * 0.2);
      if (crazy) { fr.linearRampToValueAtTime(base * 0.9 * m, t + 1.2); fr.linearRampToValueAtTime(base * 2.4 * m, t + 1.6); }
      fr.exponentialRampToValueAtTime(base * 0.5 * m, t + dur);
      lg.connect(fr); o.connect(sh); o.start(t); o.stop(t + dur + 0.1);
    });
    lfo.start(t); lfo.stop(t + dur + 0.1);
    const n = noise(c, dur), nf = c.createBiquadFilter(), ng = c.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 500 + p * 700; nf.Q.value = 0.8;
    env(ng, t, 0.05, dur - 0.05, vol * (crazy ? 0.7 : 0.4));
    n.connect(nf); nf.connect(ng); ng.connect(out); n.start(t);
  }

  const SOUNDS = {
    dinosaurs() { roar(1, true); },                 // grand finale T-Rex
    aliens() {                          // wobbly UFO warble
      const c = ctx(), t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.9);
      lfo.frequency.value = 14; lg.gain.value = 260; lfo.connect(lg); lg.connect(o.frequency);
      env(g, t, 0.05, 1.0, 0.35); o.connect(g); g.connect(c.destination);
      o.start(t); lfo.start(t); o.stop(t + 1.2); lfo.stop(t + 1.2);
    },
    space() {                           // whoosh + sparkles
      const c = ctx(), t = c.currentTime;
      const n = noise(c, 1.4), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3500, t + 1.2);
      env(g, t, 0.3, 1.0, 0.5); n.connect(f); f.connect(g); g.connect(c.destination); n.start(t);
      [1200, 1600, 2000, 2600].forEach((fr, i) => tone('sine', fr, fr, t + 0.9 + i * 0.1, 0.3, 0.15));
    },
    robots() {                          // beep boop
      const c = ctx(), t = c.currentTime;
      [440, 660, 550, 880, 660].forEach((f, i) => tone('square', f, f, t + i * 0.14, 0.1, 0.12));
    },
    cars() {                            // engine rev + horn
      const c = ctx(), t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.7); o.frequency.exponentialRampToValueAtTime(90, t + 1.1);
      f.type = 'lowpass'; f.frequency.value = 600; env(g, t, 0.05, 1.1, 0.5);
      o.connect(f); f.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 1.3);
      tone('square', 392, 392, t + 1.0, 0.3, 0.1); tone('square', 494, 494, t + 1.0, 0.3, 0.1);
    },
    animals() { chime([523, 659, 784, 1047, 784, 1047], 0.12, 'sine', 0.3); },
    default() { chime([523, 659, 784, 1047], 0.13); }
  };

  window.playProgress = (name, stage) => {      // stage 1..4 while coloring: roars grow toward the finale
    try { ctx(); if (String(name).toLowerCase() === "dinosaurs") roar((stage - 1) / 3); } catch (e) {}
  };
  window.playFinish = name => {
    try { ctx(); (SOUNDS[{ vehicles: 'cars' }[String(name).toLowerCase()] || String(name).toLowerCase()] || SOUNDS.default)(); } catch (e) {}
  };
})();
