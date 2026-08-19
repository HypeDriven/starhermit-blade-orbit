/**
 * Blade Orbit — audio module.
 * Fully procedural WebAudio: original short transients tied to logical events,
 * layered material impacts, quiet ambience, adaptive music stems.
 * Buses: master → music / effects / ambience / voice. Captions emitted as text cues.
 */

import { makeRng } from './rules.js';

export class AudioEngine {
  constructor(settings, onCaption = () => {}) {
    this.settings = settings;
    this.onCaption = onCaption;
    this.ctx = null;
    this.buses = {};
    this.ambienceNodes = null;
    this.musicTimer = null;
    this.musicSeed = makeRng('music:blade-orbit');
    this.enabled = true;
    this.started = false;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
    } catch { this.enabled = false; return; }
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.buses = { master };
    for (const name of ['music', 'effects', 'ambience', 'voice']) {
      const g = ctx.createGain();
      g.connect(master);
      this.buses[name] = g;
    }
    this.applyVolumes();
    this.started = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  applyVolumes() {
    if (!this.started) return;
    const s = this.settings;
    this.buses.music.gain.value = s.music;
    this.buses.effects.gain.value = s.effects;
    this.buses.ambience.gain.value = s.ambience;
    this.buses.voice.gain.value = s.voice;
  }

  caption(text) {
    if (this.settings.captions) this.onCaption(text);
  }

  // --- synth helpers -------------------------------------------------------

  env(gainNode, t0, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + 0.008);
    g.exponentialRampToValueAtTime(0.0001, t0 + decay);
  }

  noiseBuffer(seconds = 0.3) {
    const ctx = this.ctx;
    if (!this._noise) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const rng = makeRng('audio-noise');
      for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
      this._noise = buf;
    }
    void seconds;
    return this._noise;
  }

  playNoise({ bus = 'effects', t0, dur = 0.2, peak = 0.4, filterFreq = 2000, q = 1, type = 'bandpass' }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = filterFreq; filt.Q.value = q;
    const g = ctx.createGain();
    src.connect(filt); filt.connect(g); g.connect(this.buses[bus]);
    this.env(g, t0, peak, dur);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  playTone({ bus = 'effects', t0, freq = 440, freqEnd = null, dur = 0.15, peak = 0.3, type = 'sine' }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    osc.connect(g); g.connect(this.buses[bus]);
    this.env(g, t0, peak, dur);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /** Seeded pitch variant so replays sound consistent. */
  variant(base, seedTag) {
    const r = makeRng(`av:${seedTag}:${this._avCounter = (this._avCounter || 0) + 1}`);
    return base * (0.94 + r.next() * 0.12);
  }

  // --- logical events → sounds + captions -----------------------------------

  event(type, detail = {}) {
    if (!this.started || !this.enabled) { this.captionFor(type); return; }
    this.resume();
    const t0 = this.ctx.currentTime + 0.001;
    switch (type) {
      case 'throw': {
        const f = this.variant(900, 'throw');
        this.playNoise({ t0, dur: 0.14, peak: 0.25, filterFreq: f, q: 2 });
        this.playTone({ t0, freq: 300, freqEnd: 700, dur: 0.1, peak: 0.06, type: 'triangle' });
        break;
      }
      case 'embed': {
        // layered wood impact: low thunk + knock + crunch noise
        this.playTone({ t0, freq: this.variant(110, 'embed'), freqEnd: 55, dur: 0.16, peak: 0.55, type: 'sine' });
        this.playTone({ t0, freq: 320, freqEnd: 180, dur: 0.06, peak: 0.2, type: 'square' });
        this.playNoise({ t0, dur: 0.09, peak: 0.3, filterFreq: 1400, q: 0.8 });
        if ((detail.combo || 1) >= 3) {
          this.playTone({ t0: t0 + 0.05, freq: 520 + detail.combo * 60, dur: 0.12, peak: 0.15, type: 'triangle' });
        }
        break;
      }
      case 'miss-blade': {
        this.playTone({ t0, freq: this.variant(2200, 'clang'), freqEnd: 1400, dur: 0.28, peak: 0.22, type: 'square' });
        this.playTone({ t0, freq: 3130, dur: 0.2, peak: 0.08, type: 'sine' });
        this.playNoise({ t0, dur: 0.12, peak: 0.2, filterFreq: 4000, q: 3 });
        break;
      }
      case 'miss-marker': {
        this.playTone({ t0, freq: 660, freqEnd: 330, dur: 0.3, peak: 0.3, type: 'sawtooth' });
        this.playTone({ t0: t0 + 0.04, freq: 495, freqEnd: 247, dur: 0.3, peak: 0.2, type: 'sawtooth' });
        break;
      }
      case 'win': {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => this.playTone({ t0: t0 + i * 0.11, freq: f, dur: 0.25, peak: 0.22, type: 'triangle' }));
        break;
      }
      case 'lose': {
        [392, 330, 262].forEach((f, i) => this.playTone({ t0: t0 + i * 0.16, freq: f, dur: 0.3, peak: 0.2, type: 'triangle' }));
        break;
      }
      case 'click':
        this.playTone({ t0, freq: 800, dur: 0.05, peak: 0.12, type: 'triangle' });
        break;
      case 'undo':
        this.playTone({ t0, freq: 500, freqEnd: 750, dur: 0.09, peak: 0.12, type: 'sine' });
        break;
      case 'pause':
        this.playTone({ t0, freq: 400, dur: 0.08, peak: 0.1, type: 'sine' });
        break;
      case 'hint':
        this.playTone({ t0, freq: 980, dur: 0.1, peak: 0.1, type: 'sine' });
        this.playTone({ t0: t0 + 0.08, freq: 1240, dur: 0.12, peak: 0.1, type: 'sine' });
        break;
      case 'tick': // countdown
        this.playTone({ t0, freq: 880, dur: 0.06, peak: 0.14, type: 'sine' });
        break;
      case 'go':
        this.playTone({ t0, freq: 1320, dur: 0.18, peak: 0.2, type: 'sine' });
        break;
      default:
        break;
    }
    this.captionFor(type, detail);
  }

  captionFor(type, detail = {}) {
    const captions = {
      throw: 'Blade thrown',
      embed: detail.combo >= 3 ? `Blade embedded — combo x${detail.combo}` : 'Blade embedded',
      'miss-blade': 'Clang — blade struck steel',
      'miss-marker': 'Warded sigil struck',
      win: 'Stage cleared fanfare',
      lose: 'Stage failed tone',
      tick: 'Countdown tick',
      go: 'Go signal',
    };
    if (captions[type]) this.caption(captions[type]);
  }

  // --- ambience & adaptive music -------------------------------------------

  startAmbience(kind = 'hearth') {
    if (!this.started || this.ambienceNodes) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = kind === 'wind' ? 500 : kind === 'chimes' ? 900 : 240;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(filt); filt.connect(g); g.connect(this.buses.ambience);
    src.start();
    // slow LFO on the filter for a breathing room tone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === 'wind' ? 260 : 60;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
    lfo.start();
    this.ambienceNodes = { src, lfo, g };
  }

  stopAmbience() {
    if (!this.ambienceNodes) return;
    try { this.ambienceNodes.src.stop(); this.ambienceNodes.lfo.stop(); } catch { /* already stopped */ }
    this.ambienceNodes = null;
  }

  /** Quiet generative music stem: slow seeded pentatonic arpeggio. */
  startMusic(intensity = 0) {
    if (!this.started || this.musicTimer) return;
    const scale = [220, 262, 294, 330, 392, 440];
    const step = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const r = this.musicSeed;
      const t0 = this.ctx.currentTime + 0.02;
      const notes = 1 + (r.next() < 0.3 + intensity * 0.4 ? 1 : 0);
      for (let i = 0; i < notes; i++) {
        const f = scale[r.int(scale.length)] * (r.next() < 0.2 ? 2 : 1);
        this.playTone({ bus: 'music', t0: t0 + i * 0.22, freq: f, dur: 0.9, peak: 0.05 + intensity * 0.03, type: 'sine' });
      }
      this.musicTimer = setTimeout(step, 900 + r.next() * 900);
    };
    step();
  }

  stopMusic() {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
}
