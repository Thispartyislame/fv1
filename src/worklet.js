/* AudioWorklet processors. FV1Emu is prepended to this source at runtime. */
class FV1Proc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.emu = new FV1Emu(sampleRate);
    this.emu.onwarn = (m) => this.port.postMessage({ type: 'warn', msg: m });
    this.potT = [0.5, 0.5, 0.5]; this.pot = [0.5, 0.5, 0.5];
    this.bypass = false;
    this.taps = []; this.tapPk = []; this.old = null; this.xfN = 0; this.xfT = 0;
    this.pkIn = 0; this.pkOut = 0; this.clipped = false; this.count = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'program') {
        if (m.xfade) { this.old = this.emu; this.emu = new FV1Emu(sampleRate); this.emu.onwarn = this.old.onwarn; this.emu.load(m.words); this.xfN = this.xfT = Math.round(sampleRate * 0.05); }
        else { if (m.reset) this.emu.mem.fill(0); this.emu.resetState(false); this.emu.load(m.words); }
      }
      else if (m.type === 'taps') { this.taps = m.regs; this.tapPk = m.regs.map(() => 0); }
      else if (m.type === 'pots') this.potT = m.pots;
      else if (m.type === 'bypass') this.bypass = !!m.on;
      else if (m.type === 'reset') this.emu.resetState(true);
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const iL = inp && inp[0], iR = inp && (inp[1] || inp[0]);
    const emu = this.emu, reg = emu.reg;
    for (let i = 0; i < oL.length; i++) {
      const x = iL ? iL[i] : 0, y = iR ? iR[i] : x;
      for (let k = 0; k < 3; k++) { this.pot[k] += (this.potT[k] - this.pot[k]) * 0.002; reg[0x10 + k] = this.pot[k]; }
      let l, r;
      if (this.bypass) { l = x; r = y; }
      else {
        const xi = x < -1 ? -1 : (x > 1 ? 1 : x), yi = y < -1 ? -1 : (y > 1 ? 1 : y);
        const o = emu.step(xi, yi); l = o[0]; r = o[1];
        if (this.old) {
          const po = this.old; for (let k = 0; k < 3; k++) po.reg[0x10 + k] = this.pot[k];
          const q = po.step(xi, yi), g = this.xfN / this.xfT;
          l = l * (1 - g) + q[0] * g; r = r * (1 - g) + q[1] * g;
          if (--this.xfN <= 0) this.old = null;
        }
        for (let k = 0; k < this.taps.length; k++) { const v = Math.abs(reg[this.taps[k]]); if (v > this.tapPk[k]) this.tapPk[k] = v; }
      }
      oL[i] = l; if (oR !== oL) oR[i] = r;
      const ax = Math.abs(x), ao = Math.max(Math.abs(l), Math.abs(r));
      if (ax > this.pkIn) this.pkIn = ax;
      if (ao > this.pkOut) this.pkOut = ao;
      if (ao >= 0.9999 || ax >= 0.9999) this.clipped = true;
    }
    this.count += oL.length;
    if (this.count >= 2048) {
      this.port.postMessage({ type: 'meter', pkIn: this.pkIn, pkOut: this.pkOut, clip: this.clipped, taps: this.tapPk.slice() });
      this.tapPk.fill(0);
      this.pkIn = this.pkOut = 0; this.clipped = false; this.count = 0;
    }
    return true;
  }
}
registerProcessor('fv1', FV1Proc);

class LooperProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.max = Math.floor(sampleRate * 60);
    this.buf = new Float32Array(this.max);
    this.len = 0; this.pos = 0; this.recPos = 0;
    this.state = 'idle'; this.backup = null;
    this.live = true; this.liveGain = 1; this.loopGain = 1; this.count = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'rec': this.buf.fill(0); this.len = 0; this.recPos = 0; this.backup = null; this.state = 'rec'; break;
        case 'endrec': if (this.state === 'rec') this.finishRec(); break;
        case 'play': if (this.state === 'rec') this.finishRec(); else if (this.len > 0) { this.pos = 0; this.state = 'play'; } break;
        case 'overdub': if (this.len > 0) { this.backup = this.buf.slice(0, this.len); this.state = 'overdub'; } break;
        case 'stop': if (this.state === 'rec') this.finishRec(); this.state = this.len > 0 ? 'stopped' : 'idle'; break;
        case 'dump': this.port.postMessage({ type: 'dump', data: this.buf.slice(0, this.len), sr: sampleRate }); return;
        case 'clear': this.len = 0; this.pos = 0; this.state = 'idle'; this.backup = null; this.buf.fill(0); break;
        case 'undo': if (this.backup) { this.buf.set(this.backup); this.backup = null; if (this.state === 'overdub') this.state = 'play'; } break;
        case 'load': {
          const d = m.data; const n = Math.min(d.length, this.max);
          this.buf.fill(0); this.buf.set(d.subarray(0, n)); this.len = n; this.pos = 0; this.backup = null; this.state = 'play'; break;
        }
        case 'set': if ('live' in m) this.live = m.live; if ('liveGain' in m) this.liveGain = m.liveGain; if ('loopGain' in m) this.loopGain = m.loopGain; break;
      }
      this.report();
    };
  }
  finishRec() {
    this.len = this.recPos;
    if (this.len < 64) { this.len = 0; this.state = 'idle'; return; }
    const f = Math.min(256, this.len >> 2);
    for (let i = 0; i < f; i++) { const g = i / f; this.buf[i] *= g; this.buf[this.len - 1 - i] *= g; }
    this.pos = 0; this.state = 'play';
  }
  report() { this.port.postMessage({ type: 'looper', state: this.state, pos: this.state === 'rec' ? this.recPos : this.pos, len: this.state === 'rec' ? this.max : this.len, sr: sampleRate }); }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0][0];
    const iL = inp && inp[0];
    let s = this.state;
    for (let i = 0; i < out.length; i++) {
      const x = iL ? iL[i] : 0;
      let y = this.live ? x * this.liveGain : 0;
      if (s === 'rec') {
        this.buf[this.recPos++] = x;
        if (this.recPos >= this.max) { this.finishRec(); s = this.state; this.report(); }   // 60 s limit: start looping
      } else if ((s === 'play' || s === 'overdub') && this.len > 0) {
        const p = this.pos;
        y += this.buf[p] * this.loopGain;
        if (s === 'overdub') { let v = this.buf[p] + x; this.buf[p] = v > 1 ? 1 : (v < -1 ? -1 : v); }
        this.pos = p + 1 >= this.len ? 0 : p + 1;
      }
      out[i] = y;
    }
    this.count += out.length;
    if (this.count >= 4096) { this.count = 0; this.report(); }
    return true;
  }
}
registerProcessor('looper', LooperProc);
