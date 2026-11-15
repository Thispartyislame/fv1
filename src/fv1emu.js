/* FV-1 emulator core. Executes assembled 32-bit machine words, one program pass per sample.
 * Floating point (not bit-exact): ACC/registers saturate at about +/-1 like the real chip.
 * Runs inside an AudioWorklet and in Node for tests.
 * step() returns the same 2-element array every call (no per-sample garbage): read it before the next step(). */
const S16 = (v) => ((v & 0x8000) ? v - 0x10000 : v);
const MAXV = 1 - 1 / 8388608, TWO_PI = 6.283185307179586;
const clamp = (x) => (x > MAXV ? MAXV : (x < -1 ? -1 : x));
class FV1Emu {
  constructor(fs) {
    this.fs = fs || 32000;
    this.N = 32768;
    this.mem = new Float32Array(this.N);
    this.reg = new Float64Array(64);
    this.wp = 0;
    this.prog = [];
    this.run = false;
    this.sinPhase = [0, 0];   // rate and amplitude live in the SINn_RATE / SINn_RANGE registers
    this.rampPos = [0, 0];    // ramp LFO positions, units of 1/16384 sample
    this.out = [0, 0];
    this.warned = {};
    this.onwarn = null;
    this.acc = 0; this.pacc = 0; this.lr = 0;
    this.load(new Uint32Array(128).fill(0x11));
  }
  static s(v, bits) { return (v & (1 << (bits - 1))) ? v - (1 << bits) : v; }
  load(words) {
    const S = FV1Emu.s, prog = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i] >>> 0, op = w & 31;
      // every decoded instruction has the same shape so the interpreter loop stays monomorphic (fast)
      const o = { op, addr: 0, c: 0, d: 0, r: 0, m: 0, cond: 0, n: 0, ramp: false, lfo: 0, K: 0, sel: 0, freq: 0, amp: 0, type: 0, flags: 0 };
      switch (op) {
        case 0: case 2: case 3: o.addr = (w >>> 5) & 0x7fff; o.c = S((w >>> 21) & 0x7ff, 11) / 512; break;
        case 1: o.c = S((w >>> 21) & 0x7ff, 11) / 512; break;
        case 4: case 5: case 6: case 7: case 8: case 9:
          o.r = (w >>> 5) & 63; o.c = S((w >>> 16) & 0xffff, 16) / 16384; break;
        case 10: o.r = (w >>> 5) & 63; break;
        case 11: case 12: case 13: o.c = S((w >>> 16) & 0xffff, 16) / 16384; o.d = S((w >>> 5) & 0x7ff, 11) / 1024; break;
        case 14: case 15: case 16: o.m = (w >>> 8) & 0xffffff; break;
        case 17: o.cond = (w >>> 27) & 31; o.n = (w >>> 21) & 63; break;
        case 18:
          if ((w >>> 30) & 1) { o.ramp = true; o.lfo = (w >>> 29) & 1; o.K = S((w >>> 13) & 0xffff, 16); o.sel = (w >>> 5) & 3; }
          else { o.lfo = (w >>> 29) & 1; o.freq = (w >>> 20) & 0x1ff; o.amp = (w >>> 5) & 0x7fff; }
          break;
        case 19: o.lfo = (w >>> 6) & 1; break;
        case 20: o.type = (w >>> 30) & 3; o.flags = (w >>> 24) & 63; o.lfo = (w >>> 21) & 3; o.addr = (w >>> 5) & 0xffff; break;
        default: o.op = 99;
      }
      prog.push(o);
    }
    // Trailing NOPs (SKP 0,0 padding) do nothing except leave PACC equal to ACC, so they are not executed.
    let n = prog.length;
    while (n > 0 && (words[n - 1] >>> 0) === 0x11) n--;
    this.padded = n < prog.length;
    this.prog = prog.slice(0, n);
    this.run = false;
  }
  resetState(clearMem) {
    this.reg.fill(0); this.acc = this.pacc = this.lr = 0; this.run = false;
    this.sinPhase = [0, 0]; this.rampPos = [0, 0];
    if (clearMem) this.mem.fill(0);
  }
  _w(msg) { if (!this.warned[msg]) { this.warned[msg] = 1; if (this.onwarn) this.onwarn(msg); } }
  // one sample. returns [dacL, dacR]
  step(adcL, adcR) {
    const reg = this.reg, mem = this.mem, MASK = this.N - 1, prog = this.prog, sinPhase = this.sinPhase;
    reg[0x14] = adcL; reg[0x15] = adcR;
    const wp = this.wp;
    let acc = this.acc, pacc = this.pacc, lr = this.lr;
    const runFlag = this.run;
    const n = prog.length;
    for (let pc = 0; pc < n; pc++) {
      const o = prog[pc];
      const before = acc;
      switch (o.op) {
        case 0: { lr = mem[(wp + o.addr) & MASK]; acc = clamp(acc + lr * o.c); break; }
        case 1: { const a = Math.max(0, Math.floor(reg[0x18] * 32768)) & MASK; lr = mem[(wp + a) & MASK]; acc = clamp(acc + lr * o.c); break; }
        case 2: { mem[(wp + o.addr) & MASK] = acc; acc = clamp(acc * o.c); break; }
        case 3: { mem[(wp + o.addr) & MASK] = acc; acc = clamp(acc * o.c + lr); break; }
        case 4: acc = clamp(acc + reg[o.r] * o.c); break;
        case 5: acc = clamp((acc - reg[o.r]) * o.c + reg[o.r]); break;
        case 6: reg[o.r] = acc; acc = clamp(acc * o.c); break;
        case 7: reg[o.r] = acc; acc = clamp(acc * o.c + pacc); break;
        case 8: reg[o.r] = acc; acc = clamp((pacc - acc) * o.c + pacc); break;
        case 9: acc = Math.max(Math.abs(acc), Math.abs(reg[o.r] * o.c)); acc = clamp(acc); break;
        case 10: acc = clamp(acc * reg[o.r]); break;
        case 11: { const a = Math.abs(acc); const l = a > 0 ? Math.log2(a) : -16; acc = clamp(o.c * l / 16 + o.d); break; }
        case 12: acc = clamp(o.c * Math.pow(2, acc * 16) + o.d); break;
        case 13: acc = clamp(acc * o.c + o.d); break;
        case 14: acc = FV1Emu.fromInt(FV1Emu.toInt(acc) & o.m); break;
        case 15: acc = FV1Emu.fromInt(FV1Emu.toInt(acc) | o.m); break;
        case 16: acc = FV1Emu.fromInt(FV1Emu.toInt(acc) ^ o.m); break;
        case 17: {
          let ok = true; const c = o.cond;
          if (c & 0x10) ok = ok && runFlag;
          if (c & 0x08) ok = ok && ((acc >= 0) !== (pacc >= 0));
          if (c & 0x04) ok = ok && acc === 0;
          if (c & 0x02) ok = ok && acc >= 0;
          if (c & 0x01) ok = ok && acc < 0;
          if (ok) pc += o.n;
          break;
        }
        case 18:
          if (o.ramp) { reg[4 + 2 * o.lfo] = o.K / 32768; reg[5 + 2 * o.lfo] = o.sel; this.rampPos[o.lfo] = 0; }
          else { reg[2 * o.lfo] = o.freq / 512; reg[1 + 2 * o.lfo] = o.amp / 32768; }   // SINn_RATE, SINn_RANGE
          break;
        case 19: this.rampPos[o.lfo] = 0; break;
        case 20: {
          const l = o.lfo, flags = o.flags;
          if (l >= 2) {                                                     // ramp LFO (pitch shifting)
            const u = l - 2, units = FV1Emu.RAMPAMP[(reg[5 + 2 * u] | 0) & 3] * 16384, pos0 = this.rampPos[u];
            if (flags & 0x20) {                                             // NA: crossfade window value
              let x = Math.max(0, Math.min(1, (0.375 - Math.abs(pos0 / units - 0.5)) * 4));
              if (flags & 4) x = 1 - x;
              if (o.type === 0) { lr = mem[(wp + o.addr) & MASK]; acc = clamp(acc + lr * x); }
              else if (o.type === 2) acc = clamp(acc * x + S16(o.addr) / 32768);
              else acc = clamp(x);
              break;
            }
            const p = (flags & 0x10) ? (pos0 + units / 2) % units : pos0;   // RPTR2: second read pointer, half a cycle away
            if (o.type === 3) { acc = clamp(p / 134217728); break; }      // CHO RDAL: position in samples / 8192 (0..0.5 at amplitude 4096)
            const off = (flags & 8) ? units - p : p;
            const ii = Math.floor(off / 16384), fr = (off % 16384) / 16384;
            const coef = (flags & 4) ? 1 - fr : fr;
            if (o.type === 0) { lr = mem[(wp + o.addr + ii) & MASK]; acc = clamp(acc + lr * coef); }
            else acc = clamp(acc * coef + S16(o.addr) / 32768);
            break;
          }
          const amp = reg[1 + 2 * l] * 32768;                              // SINn_RANGE
          const val = (flags & 1) ? Math.cos(sinPhase[l]) : Math.sin(sinPhase[l]);
          if (o.type === 3) { acc = clamp(val * amp / 32767); break; }     // CHO RDAL: sine scaled by its amplitude
          let pos = val * amp / 2;                                         // swing is +/- amp/2 samples
          if (flags & 8) pos = -pos;                                       // COMPA
          const i = Math.floor(pos), fr = pos - i;
          const coef = (flags & 4) ? (1 - fr) : fr;                        // COMPC
          if (o.type === 0) { lr = mem[(wp + o.addr + i) & MASK]; acc = clamp(acc + lr * coef); }
          else acc = clamp(acc * coef + S16(o.addr) / 32768);
          break;
        }
        default: break;
      }
      pacc = before;
    }
    this.acc = acc; this.pacc = this.padded ? acc : pacc; this.lr = lr;
    this.run = true;
    this.wp = (wp - 1) & MASK;
    // advance LFO phase: omega = Kf / 2^17 rad/sample, Kf = SINn_RATE * 512 (0..511)
    for (let l = 0; l < 2; l++) {
      const rv = reg[2 * l], kf = rv <= 0 ? 0 : (rv >= 0.998046875 ? 511 : Math.floor(rv * 512));
      if (kf) { sinPhase[l] += kf / 131072; if (sinPhase[l] > TWO_PI) sinPhase[l] -= TWO_PI; }
    }
    for (let u = 0; u < 2; u++) {                       // ramp LFOs: position moves by -K per sample
      const units = FV1Emu.RAMPAMP[(reg[5 + 2 * u] | 0) & 3] * 16384;
      const K = Math.round(reg[4 + 2 * u] * 32768);
      this.rampPos[u] = (((this.rampPos[u] - K) % units) + units) % units;
    }
    const out = this.out; out[0] = reg[0x16]; out[1] = reg[0x17];
    return out;
  }
  static toInt(a) { return Math.round(a * 8388608) & 0xffffff; }
  static fromInt(i) { i &= 0xffffff; if (i & 0x800000) i -= 0x1000000; return i / 8388608; }
}
FV1Emu.RAMPAMP = [4096, 2048, 1024, 512];
if (typeof module !== 'undefined' && module.exports) module.exports = FV1Emu;
