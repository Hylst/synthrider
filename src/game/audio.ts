// Moteur audio synthwave — tout est synthétisé en temps réel (Web Audio API).
// Créateur : Hylst — Geoff, avec l'aide d'une IA

function midiToFreq(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Progression d'accords (4 mesures) : Am - F - C - G
const PROG = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [60, 64, 67], // C
  [55, 59, 62], // G
];
const BASS_ROOTS = [45, 41, 48, 43]; // A2 F2 C3 G2
const LEAD_NOTES = [69, 72, 76, 74]; // A4 C5 E5 D5

export class SynthEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private delayIn: GainNode | null = null;
  muted = false;
  started = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();

    // Compresseur final pour éviter l'écrêtage et « coller » le mix
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 24;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.42;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);

    // Bus de delay (écho) pour l'atmosphère
    this.delayIn = this.ctx.createGain();
    this.delayIn.gain.value = 1;
    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = 0.38; // dotted-ish eighth
    const fb = this.ctx.createGain();
    fb.gain.value = 0.36;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.32;
    const dfilt = this.ctx.createBiquadFilter();
    dfilt.type = "lowpass";
    dfilt.frequency.value = 2600;
    this.delayIn.connect(delay);
    delay.connect(dfilt);
    dfilt.connect(fb);
    fb.connect(delay);
    dfilt.connect(wet);
    wet.connect(this.master);
    this.started = true;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // Oscillateur avec enveloppe ADSR, peut router vers plusieurs bus + delay.
  private voice(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    dests: AudioNode[],
    opts?: { attack?: number; glideTo?: number; detune?: number },
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (opts?.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glideTo), start + dur);
    }
    if (opts?.detune) osc.detune.value = opts.detune;
    const atk = opts?.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    for (const d of dests) g.connect(d);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  // Burst de bruit filtré.
  private noise(
    start: number,
    dur: number,
    peak: number,
    dests: AudioNode[],
    filter: "lowpass" | "highpass" | "bandpass",
    freq: number,
    q = 1,
  ) {
    if (!this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    for (const d of dests) g.connect(d);
    src.start(start);
    src.stop(start + dur);
  }

  // ====== Batterie ======
  private kick(t: number, accent: boolean) {
    if (!this.musicGain) return;
    this.voice(accent ? 140 : 120, t, 0.2, "sine", accent ? 0.95 : 0.6, [this.musicGain], {
      glideTo: 45,
    });
    this.noise(t, 0.03, 0.2, [this.musicGain], "highpass", 2200, 1);
  }

  private hat(t: number, open = false) {
    if (!this.musicGain) return;
    this.noise(t, open ? 0.12 : 0.04, open ? 0.07 : 0.05, [this.musicGain], "highpass", 8000, 0.7);
  }

  private snare(t: number) {
    if (!this.musicGain) return;
    this.noise(t, 0.18, 0.22, [this.musicGain], "bandpass", 1800, 0.6);
    this.noise(t, 0.1, 0.18, [this.musicGain], "highpass", 5000, 0.7);
    this.voice(180, t, 0.12, "triangle", 0.14, [this.musicGain], { glideTo: 120 });
  }

  // ====== Basse (sawtooth filtré avec enveloppe de filtre) ======
  private bassNote(freq: number, t: number, peak = 1) {
    if (!this.ctx || !this.musicGain) return;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 7;
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    filt.connect(g);
    g.connect(this.musicGain);
    const make = (type: OscillatorType, detune: number) => {
      const o = this.ctx!.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(filt);
      o.start(t);
      o.stop(t + 0.26);
    };
    make("sawtooth", 0);
    make("sawtooth", 8);
  }

  // Nappe d'accords (pad) avec ouvert/fermeture de filtre.
  private pad(freqs: number[], t: number, dur: number, peak: number) {
    if (!this.ctx || !this.musicGain) return;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 5;
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.linearRampToValueAtTime(1600, t + dur * 0.45);
    filt.frequency.linearRampToValueAtTime(600, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.5);
    g.gain.setValueAtTime(peak, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filt.connect(g);
    g.connect(this.musicGain);
    for (const f of freqs) {
      for (const d of [-8, 0, 8]) {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = d;
        o.connect(filt);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  // Note d'arpège (plucked) envoyée aussi au delay.
  private pluck(freq: number, t: number, dur: number, peak: number) {
    if (!this.musicGain || !this.delayIn) return;
    this.voice(freq, t, dur, "square", peak, [this.musicGain, this.delayIn], { attack: 0.004 });
    this.voice(freq * 2, t, dur * 0.6, "sine", peak * 0.4, [this.musicGain, this.delayIn], {
      attack: 0.004,
    });
  }

  // Mélodie lead.
  private leadNote(freq: number, t: number, dur: number, peak: number) {
    if (!this.musicGain || !this.delayIn) return;
    this.voice(freq, t, dur, "sawtooth", peak, [this.musicGain, this.delayIn], {
      attack: 0.04,
      glideTo: freq * 0.992,
    });
  }

  // ====== Compositeur : appelé à chaque beat ======
  step(beatIndex: number, intensity = 1) {
    if (!this.ctx) return;
    const bar = Math.floor(beatIndex / 4);
    const b = beatIndex % 4;
    const t = this.now() + 0.004;
    const beat = 0.5; // 120 BPM

    this.kick(t, b === 0); // four-on-the-floor
    this.hat(t + beat * 0.5); // contretemps

    if (b === 1 || b === 3) this.snare(t);
    else this.hat(t, b === 2);

    const root = midiToFreq(BASS_ROOTS[bar % 4]);
    this.bassNote(root, t, 1);
    this.bassNote(root, t + beat * 0.5, 0.6); // rebond en double-croche

    if (b === 0) {
      const chord = PROG[bar % 4].map(midiToFreq);
      this.pad(chord, t, beat * 4, 0.1 * intensity);
      this.leadNote(midiToFreq(LEAD_NOTES[bar % 4]), t, beat * 3.6, 0.07 * intensity);
      const arp = [
        chord[0], chord[1], chord[2], chord[1],
        chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[0] * 2,
      ];
      for (let i = 0; i < 8; i++) {
        this.pluck(arp[i], t + i * beat * 0.5, 0.22, 0.085 * intensity);
      }
    }
  }

  // ====== Effets (SFX) ======
  private sfx() {
    return this.sfxGain ? [this.sfxGain] : [];
  }

  pickup(combo: number) {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    const base = 660;
    const steps = Math.min(combo, 12);
    const f = base * Math.pow(2, steps / 12);
    this.voice(f, t, 0.16, "triangle", 0.4, this.sfx());
    this.voice(f * 2, t, 0.12, "sine", 0.18, this.sfx());
    this.voice(f * 3, t, 0.08, "sine", 0.08, this.sfx());
  }

  dodge() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    this.voice(900, t, 0.12, "square", 0.16, this.sfx(), { glideTo: 1500 });
    this.noise(t, 0.14, 0.06, this.sfx(), "bandpass", 1600, 0.8);
  }

  powerup() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) =>
      this.voice(f, t + i * 0.07, 0.18, "triangle", 0.32, this.sfx()),
    );
    this.noise(t, 0.4, 0.05, this.sfx(), "highpass", 6000, 0.5);
  }

  surge() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    // whoosh montant
    this.noise(t, 0.5, 0.22, this.sfx(), "bandpass", 1200, 1.5);
    const g = this.ctx.createGain();
    const filt = this.ctx!.createBiquadFilter();
    filt.type = "bandpass";
    filt.Q.value = 6;
    filt.frequency.setValueAtTime(300, t);
    filt.frequency.exponentialRampToValueAtTime(4000, t + 0.45);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    filt.connect(g);
    if (this.sfxGain) g.connect(this.sfxGain);
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.45);
    o.connect(filt);
    o.start(t);
    o.stop(t + 0.55);
    // accord de victoire court
    [440, 554, 659].forEach((f) => this.voice(f, t + 0.4, 0.3, "triangle", 0.16, this.sfx()));
  }

  shieldHit() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    this.voice(1320, t, 0.2, "sine", 0.3, this.sfx(), { glideTo: 1760 });
    this.voice(1980, t, 0.12, "triangle", 0.12, this.sfx());
    this.noise(t, 0.1, 0.12, this.sfx(), "bandpass", 2400, 2);
  }

  crash() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    this.noise(t, 0.6, 0.8, this.sfx(), "lowpass", 1800, 0.7);
    this.noise(t, 0.3, 0.5, this.sfx(), "highpass", 3000, 0.6);
    this.voice(220, t, 0.7, "sawtooth", 0.5, this.sfx(), { glideTo: 50 });
    this.voice(110, t, 0.8, "square", 0.4, this.sfx(), { glideTo: 40 });
  }

  milestone() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) =>
      this.voice(f, t + i * 0.06, 0.9, "triangle", 0.28, this.sfx()),
    );
    this.noise(t, 0.5, 0.08, this.sfx(), "highpass", 6000, 0.5);
  }

  blip() {
    if (!this.ctx) return;
    const t = this.now() + 0.001;
    this.voice(740, t, 0.05, "square", 0.1, this.sfx());
    this.voice(1100, t + 0.01, 0.04, "square", 0.05, this.sfx());
  }
}

export const synth = new SynthEngine();
