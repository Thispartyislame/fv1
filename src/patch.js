/* Patch graph -> SpinASM code generator + node/preset definitions. */
(function (root) {
'use strict';
const FS = 32000;
const f6 = (x) => (Math.round(x * 1e6) / 1e6).toFixed(6);
const cc = (x) => f6(Math.max(-2, Math.min(1.99993, x)));        // S1.14 coefficient
const kPole = (hz) => Math.max(0.0001, Math.min(1, 1 - Math.exp(-2 * Math.PI * hz / FS)));
const kfOf = (hz) => Math.max(1, Math.min(511, Math.round(hz * 2 * Math.PI * 131072 / FS)));
const hzOf = (kf) => kf * FS / (2 * Math.PI * 131072);
const MAX_LFO_HZ = hzOf(511);

class Ctx {
  constructor() { this.code = []; this.setupLines = []; this.memLines = []; this.memTop = 0; this.regN = 0; this.lfoUsed = [null, null]; this.rmpUsed = [null, null]; this.labelN = 0; }
  e(s) { this.code.push(s); }
  c(s) { this.code.push('; ' + s); }
  reg() { return 'REG' + (this.regN++); }   // virtual: the 32-register limit is checked in generate(), after sharing
  mem(name, size, align) {
    align = align || 1;
    if (this.memTop % align) {
      const pad = align - (this.memTop % align);
      this.memLines.push(`mem pad${this.memLines.length} ${pad - 1}`);
      this.memTop += pad;
    }
    if (this.memTop + size > 32767) throw new Error('Out of delay memory (' + (this.memTop + size) + ' of 32767 samples needed)');
    const start = this.memTop;
    this.memLines.push(`mem ${name} ${size}`);
    this.memTop += size + 1;
    return { name, start, size };
  }
  lfo(who) {
    const i = this.lfoUsed.indexOf(null);
    if (i < 0) throw new Error('Only 2 sine LFOs exist on the FV-1 (' + who + ' needs a third)');
    this.lfoUsed[i] = who; return i;
  }
  rmp(who) {
    const i = this.rmpUsed.indexOf(null);
    if (i < 0) throw new Error('Only 2 ramp LFOs exist on the FV-1 (' + who + ' needs a third)');
    this.rmpUsed[i] = who; return i;
  }
  setup(s) { this.setupLines.push(s); }
  onePole(inSig, hz, lpName) {            // lp reg holds low-passed signal; ACC cleared
    const lp = lpName || this.reg();
    this.e(`rdax ${inSig},1.0`); this.e(`rdfx ${lp},${f6(kPole(hz))}`); this.e(`wrax ${lp},0`);
    return lp;
  }
}

const P = (id, label, min, max, step, def, extra) => Object.assign({ id, label, min, max, step, def }, extra || {});
const AUD = 'audio', CTL = 'ctl';

const NODE_TYPES = {
  input: {
    title: 'Input', color: '#4aa3ff', unique: true,
    inputs: [], outputs: [{ id: 'l', label: 'L', kind: AUD }, { id: 'r', label: 'R', kind: AUD }], params: [],
    gen: () => ({ l: 'ADCL', r: 'ADCR' }),
  },
  output: {
    title: 'Output', color: '#4aa3ff', unique: true,
    inputs: [{ id: 'l', label: 'L', kind: AUD }, { id: 'r', label: 'R', kind: AUD }], outputs: [],
    params: [P('level', 'Level', 0, 1.99, 0.01, 1)],
    gen: (c, n, ins) => {
      const lv = cc(n.p.level);
      c.c('Output');
      if (ins.l && ins.r) { c.e(`rdax ${ins.l},${lv}`); c.e('wrax DACL,0'); c.e(`rdax ${ins.r},${lv}`); c.e('wrax DACR,0'); }
      else if (ins.l || ins.r) { c.e(`rdax ${ins.l || ins.r},${lv}`); c.e('wrax DACL,1.0'); c.e('wrax DACR,0'); }
      return {};
    },
  },
  pot: {
    title: 'Pot', color: '#ff9f43',
    inputs: [], outputs: [{ id: 'out', label: 'out', kind: CTL }],
    params: [P('pot', 'Pot #', 0, 2, 1, 0, { int: true }), P('curve', 'Taper', 0, 3, 1, 0, { select: ['Linear', 'Log (slow start)', 'Reverse linear', 'Reverse log'] }),
      P('lo', 'Min', 0, 1, 0.01, 0), P('hi', 'Max', 0, 1, 0.01, 1)],
    gen: (c, n) => {
      const pn = 'POT' + Math.round(n.p.pot), cv = Math.round(n.p.curve || 0), lo = n.p.lo === undefined ? 0 : n.p.lo, hi = n.p.hi === undefined ? 1 : n.p.hi;
      if (cv === 0 && lo === 0 && hi === 1) return { out: pn };
      const o = c.reg(); c.c('Pot shaping (' + ['linear', 'log', 'reverse', 'reverse log'][cv] + ', ' + lo + '..' + hi + ')');
      c.e(`rdax ${pn},1.0`);
      if (cv === 1 || cv === 3) c.e(`mulx ${pn}`);
      if (cv >= 2) c.e('sof -1.0,0.999');
      c.e(`sof ${f6(hi - lo)},${f6(Math.min(0.999, lo))}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  gain: {
    title: 'Gain / VCA', color: '#7bd88f',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'ctl', label: 'ctl', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('gain', 'Gain', 0, 1.99, 0.01, 1)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Gain');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      if (ins.ctl) {
        c.e(`rdax ${ins.in},1.0`); c.e(`mulx ${ins.ctl}`);
        if (Math.abs(n.p.gain - 1) > 0.005) c.e(`sof ${cc(n.p.gain)},0`);
        c.e(`wrax ${o},0`);
      } else { c.e(`rdax ${ins.in},${cc(n.p.gain)}`); c.e(`wrax ${o},0`); }
      return { out: o };
    },
  },
  mixer: {
    title: 'Mixer', color: '#7bd88f',
    inputs: [{ id: 'a', label: 'a', kind: AUD }, { id: 'b', label: 'b', kind: AUD }, { id: 'c', label: 'c', kind: AUD }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('ga', 'Level a', 0, 1.99, 0.01, 0.7), P('gb', 'Level b', 0, 1.99, 0.01, 0.7), P('gc', 'Level c', 0, 1.99, 0.01, 0.7)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Mixer');
      let any = false;
      ['a', 'b', 'c'].forEach((k) => { if (ins[k]) { c.e(`rdax ${ins[k]},${cc(n.p['g' + k])}`); any = true; } });
      if (!any) c.e('clr');
      c.e(`wrax ${o},0`); return { out: o };
    },
  },
  xfade: {
    title: 'Dry/Wet', color: '#7bd88f',
    inputs: [{ id: 'a', label: 'dry', kind: AUD }, { id: 'b', label: 'wet', kind: AUD }, { id: 'ctl', label: 'mix', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('mix', 'Mix', 0, 1, 0.01, 0.5)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Dry/Wet crossfade');
      if (ins.ctl) {
        if (ins.a && ins.b) {
          c.e(`rdax ${ins.b},0.5`); c.e(`rdax ${ins.a},-0.5`); c.e(`mulx ${ins.ctl}`); c.e('sof 1.99993,0'); c.e(`rdax ${ins.a},1.0`);
        } else if (ins.b) { c.e(`rdax ${ins.b},1.0`); c.e(`mulx ${ins.ctl}`); }
        else if (ins.a) { c.e(`rdax ${ins.a},1.0`); c.e(`mulx ${ins.ctl}`); c.e('sof -1.0,0'); c.e(`rdax ${ins.a},1.0`); }
        else c.e('clr');
      } else {
        const m = n.p.mix;
        if (ins.a) c.e(`rdax ${ins.a},${cc(1 - m)}`);
        if (ins.b) c.e(`rdax ${ins.b},${cc(m)}`);
        if (!ins.a && !ins.b) c.e('clr');
      }
      c.e(`wrax ${o},0`); return { out: o };
    },
  },
  delay: {
    title: 'Delay', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'time', label: 'time', kind: CTL }, { id: 'fb', label: 'fdbk', kind: CTL }], outputs: [{ id: 'out', label: 'wet', kind: AUD }],
    params: [P('time', 'Time (max) ms', 20, 900, 1, 350, { unit: 'ms' }), P('fb', 'Feedback', 0, 0.98, 0.01, 0.45), P('damp', 'Damping Hz', 500, 15000, 10, 4000, { log: true, unit: 'Hz' })],
    gen: (c, n, ins) => {
      const L = Math.max(64, Math.min(30000, Math.round(n.p.time * 32)));
      const D = c.mem('dly' + n.id, L, ins.time ? 32 : 1);
      const o = c.reg(); const lp = n.p.damp < 14900 ? c.reg() : null;
      c.c('Delay');
      if (ins.time) {
        const minS = 32;
        c.e(`rdax ${ins.time},1.0`); c.e(`sof ${f6((L - minS) / 32768)},${f6((D.start + minS) / 32768)}`);
        c.e('wrax addr_ptr,0'); c.e('rmpa 1.0');
      } else c.e(`rda ${D.name}#,1.0`);
      if (ins.fb) { c.e(`wrax ${o},0`); c.e(`rdax ${o},${cc(n.p.fb)}`); c.e(`mulx ${ins.fb}`); }
      else c.e(`wrax ${o},${cc(n.p.fb)}`);
      if (lp) { c.e(`rdfx ${lp},${f6(kPole(n.p.damp))}`); c.e(`wrax ${lp},1.0`); }
      if (ins.in) c.e(`rdax ${ins.in},1.0`);
      c.e(`wra ${D.name},0`);
      return { out: o };
    },
  },
  reverb: {
    title: 'Reverb', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'l', label: 'wet L', kind: AUD }, { id: 'r', label: 'wet R', kind: AUD }],
    params: [P('time', 'Decay', 0.2, 0.93, 0.01, 0.65), P('damp', 'Damping Hz', 800, 15000, 10, 5000, { log: true, unit: 'Hz' }), P('level', 'Wet level', 0.2, 1.99, 0.01, 1.0)],
    gen: (c, n, ins) => {
      const kr = cc(n.p.time), dk = f6(kPole(n.p.damp));
      const M = (nm, s) => c.mem('rv' + n.id + nm, s).name;
      const a1 = M('a1', 142), a2 = M('a2', 107), a3 = M('a3', 379), a4 = M('a4', 277);
      const pL1 = M('pl1', 672), dL1 = M('dl1', 4453), pL2 = M('pl2', 1800), dL2 = M('dl2', 3720);
      const pR1 = M('pr1', 908), dR1 = M('dr1', 4217), pR2 = M('pr2', 2656), dR2 = M('dr2', 3163);
      const diff = c.reg(), lpL = c.reg(), lpR = c.reg(), oL = c.reg(), oR = c.reg();
      c.c('Reverb (plate-style: 4 input allpasses + 2 cross-fed tanks)');
      if (ins.in) c.e(`rdax ${ins.in},0.5`); else c.e('clr');
      [[a1, 0.75], [a2, 0.75], [a3, 0.625], [a4, 0.625]].forEach(([m, k]) => { c.e(`rda ${m}#,${f6(k)}`); c.e(`wrap ${m},${f6(-k)}`); });
      c.e(`wrax ${diff},0`);
      const tank = (pa1, d1, pa2, d2, otherEnd, lp) => {
        c.e(`rdax ${diff},1.0`); c.e(`rda ${otherEnd}#,${kr}`);
        c.e(`rda ${pa1}#,0.7`); c.e(`wrap ${pa1},-0.7`);
        c.e(`wra ${d1},0`); c.e(`rda ${d1}#,1.0`);
        c.e(`rdfx ${lp},${dk}`); c.e(`wrax ${lp},1.0`);
        c.e(`rda ${pa2}#,0.5`); c.e(`wrap ${pa2},-0.5`);
        c.e(`wra ${d2},0`);
      };
      tank(pL1, dL1, pL2, dL2, dR2, lpL);
      tank(pR1, dR1, pR2, dR2, dL2, lpR);
      const lv = 0.9 * n.p.level;
      const tap = (m, off, k) => c.e(`rda ${m}+${off},${f6(k * lv)}`);
      tap(dL1, 300, 0.7); tap(dL1, 2900, 0.6); tap(dR1, 1800, 0.6); tap(dR2, 1500, -0.5); tap(pL2, 1200, -0.5);
      c.e(`wrax ${oL},0`);
      tap(dR1, 400, 0.7); tap(dR1, 2700, 0.6); tap(dL1, 2200, 0.6); tap(dL2, 1100, -0.5); tap(pR2, 900, -0.5);
      c.e(`wrax ${oR},0`);
      return { l: oL, r: oR };
    },
  },
  chorus: {
    title: 'Chorus / Flanger', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'rate', label: 'rate*', kind: CTL }], outputs: [{ id: 'out', label: 'wet', kind: AUD }],
    params: [P('rate', 'Rate (max) Hz', 0.1, 19, 0.05, 0.8, { unit: 'Hz' }), P('depth', 'Depth ms', 0.1, 8, 0.1, 2.5, { unit: 'ms' }),
      P('center', 'Center ms', 1, 25, 0.1, 8, { unit: 'ms' }), P('fb', 'Feedback', -0.9, 0.9, 0.01, 0)],
    gen: (c, n, ins) => {
      const swing = Math.max(1, Math.round(n.p.depth * 32));
      const amp = Math.min(32000, swing * 2);                    // WLDS amplitude (swing is about +/- amp/2; kept clear even if it were +/- amp)
      const center = Math.max(amp + 2, Math.round(n.p.center * 32));
      const D = c.mem('chr' + n.id, center + amp + 3);
      const l = c.lfo('Chorus'); const o = c.reg();
      c.setup(`wlds sin${l},${kfOf(n.p.rate)},${amp}`);
      c.c('Chorus / Flanger');
      if (ins.rate) { c.e(`rdax ${ins.rate},${cc(Math.min(1.99, n.p.rate / MAX_LFO_HZ))}`); c.e(`wrax sin${l}_rate,0`); }
      if (Math.abs(n.p.fb) > 0.001) c.e(`rdax ${o},${cc(n.p.fb)}`);
      if (ins.in) c.e(`rdax ${ins.in},1.0`);
      c.e(`wra ${D.name},0`);
      c.e(`cho rda,sin${l},sin|reg|compc,${D.name}+${center}`);
      c.e(`cho rda,sin${l},sin,${D.name}+${center + 1}`);
      c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  pitch: {
    title: 'Pitch Shift', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'pitch', label: 'pitch*', kind: CTL }], outputs: [{ id: 'out', label: 'wet', kind: AUD }],
    params: [P('semis', 'Semitones', -12, 12, 1, 12, { unit: 'st' }), P('cents', 'Fine (cents)', -50, 50, 1, 0), P('win', 'Window', 0, 3, 1, 2, { select: ['512 (fast, warbly)', '1024', '2048', '4096 (smooth, laggy)'] })],
    gen: (c, n, ins) => {
      const amp = [512, 1024, 2048, 4096][Math.round(n.p.win)];
      const D = c.mem('pit' + n.id, amp), T = c.mem('ptt' + n.id, 1);
      const u = c.rmp('Pitch Shift'), o = c.reg();
      const kOf = (st) => { const r = Math.pow(2, st / 12); return Math.max(-16384, Math.min(32767, Math.round(16384 * (r - 1)))); };
      const k = kOf(n.p.semis + n.p.cents / 100);
      c.setup(`wldr rmp${u},${k},${amp}`);
      c.c('Pitch shift (two crossfaded read heads on a ramp LFO)');
      if (ins.pitch) {
        const lo = kOf(-Math.abs(n.p.semis)), hi = kOf(Math.abs(n.p.semis));
        c.e(`rdax ${ins.pitch},1.0`); c.e(`sof ${f6((hi - lo) / 32768)},${f6(lo / 32768)}`); c.e(`wrax rmp${u}_rate,0`);
      }
      if (ins.in) c.e(`rdax ${ins.in},1.0`);
      c.e(`wra ${D.name},0`);
      c.e(`cho rda,rmp${u},reg|compc,${D.name}`);
      c.e(`cho rda,rmp${u},0,${D.name}+1`);
      c.e(`wra ${T.name},0`);
      c.e(`cho rda,rmp${u},rptr2|compc,${D.name}`);
      c.e(`cho rda,rmp${u},rptr2,${D.name}+1`);
      c.e(`cho sof,rmp${u},na|compc,0`);
      c.e(`cho rda,rmp${u},na,${T.name}`);
      c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  lfo: {
    title: 'LFO', color: '#ff9f43',
    inputs: [{ id: 'rate', label: 'rate*', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: CTL }],
    params: [P('shape', 'Shape', 0, 4, 1, 0, { select: ['Sine', 'Triangle', 'Square', 'Soft square', 'Saw (ramp)'] }),
      P('rate', 'Rate (max) Hz', 0.1, 19, 0.05, 4, { unit: 'Hz' }), P('low', 'Low', 0, 1, 0.01, 0.0), P('high', 'High', 0, 1, 0.01, 1.0)],
    gen: (c, n, ins) => {
      const shape = Math.round(n.p.shape || 0), o = c.reg();
      const lo = Math.min(n.p.low, n.p.high), hi = Math.max(n.p.low, n.p.high);
      c.c('LFO (' + ['sine', 'triangle', 'square', 'soft square', 'saw'][shape] + ') -> control signal');
      if (shape === 1 || shape === 4) {                          // ramp LFO based
        const u = c.rmp('LFO'), amp = 2048;
        const kOf = (hz) => Math.max(1, Math.min(32767, Math.round(hz * amp * 16384 / FS)));
        c.setup(`wldr rmp${u},${kOf(n.p.rate)},${amp}`);
        if (ins.rate) { c.e(`rdax ${ins.rate},${cc(Math.min(1.99, kOf(n.p.rate) / 32768))}`); c.e(`wrax rmp${u}_rate,0`); }
        c.e(`cho rdal,rmp${u}`);                                  // ramp, 0..amp/8192 = 0..0.25
        if (shape === 1) { c.e('sof 1.99993,-0.25'); c.e('absa'); } // triangle 0..0.25
        let g = 4 * (hi - lo);                                    // bring it up to lo..hi
        while (g > 2.0001) { c.e('sof 1.99993,0'); g /= 1.99993; }
        c.e(`sof ${cc(g)},${f6(Math.min(0.999, lo))}`);
      } else {
        const l = c.lfo('LFO');
        c.setup(`wlds sin${l},${kfOf(n.p.rate)},32767`);
        if (ins.rate) { c.e(`rdax ${ins.rate},${cc(Math.min(1.99, n.p.rate / MAX_LFO_HZ))}`); c.e(`wrax sin${l}_rate,0`); }
        c.e(`cho rdal,sin${l}`);
        if (shape === 2) gainStages(c, 64); else if (shape === 3) gainStages(c, 2.2);
        c.e(`sof ${f6((hi - lo) / 2)},${f6(Math.min(0.999, (hi + lo) / 2))}`);
      }
      c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  filter: {
    title: 'Filter', color: '#ffd166',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'freq', label: 'freq', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('mode', 'Mode', 0, 1, 1, 0, { select: ['Low-pass', 'High-pass'] }), P('order', 'Slope', 0, 1, 1, 0, { select: ['6 dB/oct', '12 dB/oct'] }),
      P('hz', 'Cutoff (max) Hz', 20, 15000, 1, 1500, { log: true, unit: 'Hz' })],
    gen: (c, n, ins) => {
      const hp = Math.round(n.p.mode) === 1, poles = Math.round(n.p.order) === 1 ? 2 : 1;
      c.c('Filter');
      let sig = ins.in;
      if (!sig) { const o = c.reg(); c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      for (let i = 0; i < poles; i++) {
        const lp = c.reg();
        if (ins.freq) {
          c.e(`rdax ${sig},1.0`); c.e(`rdax ${lp},-1.0`); c.e(`mulx ${ins.freq}`); c.e(`sof ${f6(kPole(n.p.hz))},0`); c.e(`rdax ${lp},1.0`); c.e(`wrax ${lp},0`);
        } else c.onePole(sig, n.p.hz, lp);
        if (hp) { const h = c.reg(); c.e(`rdax ${sig},1.0`); c.e(`rdax ${lp},-1.0`); c.e(`wrax ${h},0`); sig = h; } else sig = lp;
      }
      return { out: sig };
    },
  },
  drive: {
    title: 'Overdrive', color: '#ff6b6b',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('gain', 'Drive x', 1, 32, 0.5, 8, { log: true }), P('bias', 'Asymmetry', -0.4, 0.4, 0.01, 0), P('tone', 'Tone Hz', 500, 15000, 10, 3500, { log: true, unit: 'Hz' }), P('level', 'Level', 0, 1.99, 0.01, 0.5)],
    gen: (c, n, ins) => {
      const o = c.reg(), lp = c.reg();
      c.c('Overdrive (hard clip through accumulator saturation)');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      c.e(`rdax ${ins.in},1.0`);
      let rem = Math.max(1, n.p.gain), first = true;
      const bias = Math.max(-0.99, Math.min(0.99, n.p.bias));
      while (rem > 1.9999) { c.e(`sof 1.99993,${first ? f6(bias) : '0'}`); first = false; rem /= 1.99993; }
      if (rem > 1.001 || first) c.e(`sof ${cc(rem)},${first ? f6(bias) : '0'}`);
      c.e(`rdfx ${lp},${f6(kPole(n.p.tone))}`); c.e(`wrax ${lp},0`);
      c.e(`rdax ${lp},${cc(n.p.level)}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  smooth: {
    title: 'Smooth (ctl)', color: '#ff9f43',
    inputs: [{ id: 'in', label: 'in', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: CTL }],
    params: [P('hz', 'Smoothing Hz', 0.2, 30, 0.1, 3, { unit: 'Hz' })],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Control smoothing');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      c.e(`rdax ${ins.in},1.0`); c.e(`rdfx ${o},${f6(kPole(n.p.hz))}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
};


// ---------- shared DSP helpers for the dynamics / filter / distortion blocks ----------
function gainStages(c, g) {                     // multiply ACC by g (>=1) with saturating SOF stages
  let rem = Math.max(1, g);
  while (rem > 1.9999) { c.e('sof 1.99993,0'); rem /= 1.99993; }
  if (rem > 1.001) c.e(`sof ${cc(rem)},0`);
}
function envFollow(c, sig, atkMs, relMs) {      // rectifier + attack/release smoothing; returns env register
  const env = c.reg(), k = ++c.labelN;
  const a = Math.max(1 / 16384, 1 - Math.exp(-1 / (FS * atkMs / 1000))), r = Math.max(1 / 16384, 1 - Math.exp(-1 / (FS * relMs / 1000)));
  c.e(`rdax ${sig},1.0`); c.e('absa'); c.e(`rdax ${env},-1.0`);
  c.e(`skp neg,rel${k}`); c.e(`sof ${f6(a)},0`); c.e(`skp 0,dn${k}`);
  c.e(`rel${k}:`); c.e(`sof ${f6(r)},0`);
  c.e(`dn${k}:`); c.e(`rdax ${env},1.0`); c.e(`wrax ${env},0`);
  return env;
}
function hpf(c, sig, hz) {                      // one-pole high-pass: in - lowpass(in)
  const lp = c.onePole(sig, hz), h = c.reg();
  c.e(`rdax ${sig},1.0`); c.e(`rdax ${lp},-1.0`); c.e(`wrax ${h},0`);
  return h;
}
function svf(c, sig, o) {                       // state-variable filter (Chamberlin). o: {hz, ctl, curve, Q}
  const low = c.reg(), band = c.reg(), high = c.reg();
  const q = Math.min(1.99, 1 / Math.max(0.5, o.Q));
  const fmax = Math.min(1.5, 2 * Math.sin(Math.PI * Math.min(o.hz, 6000) / FS));
  let FR = null;
  if (o.ctl) {
    FR = c.reg();
    const fmin = Math.min(fmax * 0.9, 2 * Math.sin(Math.PI * Math.min(o.minhz || 0, 6000) / FS));
    c.e(`rdax ${o.ctl},1.0`); if (o.curve) c.e(`mulx ${o.ctl}`);
    c.e(`sof ${f6((fmax - fmin) / 2)},${f6(fmin / 2)}`); c.e(`wrax ${FR},0`);
  }
  const mulF = () => { if (FR) { c.e(`mulx ${FR}`); c.e('sof 1.99993,0'); } else c.e(`sof ${f6(fmax)},0`); };
  c.e(`rdax ${sig},1.0`); c.e(`rdax ${low},-1.0`); c.e(`rdax ${band},${cc(-q)}`); c.e(`wrax ${high},1.0`);
  mulF(); c.e(`rdax ${band},1.0`); c.e(`wrax ${band},1.0`);
  mulF(); c.e(`rdax ${low},1.0`); c.e(`wrax ${low},0`);
  return { low, band, high, q };
}

Object.assign(NODE_TYPES, {
  env: {
    title: 'Envelope', color: '#ff9f43',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'out', label: 'level', kind: CTL }],
    params: [P('atk', 'Attack ms', 1, 80, 1, 5, { unit: 'ms' }), P('rel', 'Release ms', 20, 1500, 1, 180, { log: true, unit: 'ms' }), P('gain', 'Gain x', 1, 40, 0.5, 6, { log: true })],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Envelope follower -> control signal');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const env = envFollow(c, ins.in, n.p.atk, n.p.rel);
      c.e(`rdax ${env},1.0`); gainStages(c, n.p.gain); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  gate: {
    title: 'Noise Gate', color: '#7bd88f',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('thr', 'Threshold', 0.002, 0.3, 0.001, 0.008, { log: true }), P('rel', 'Hold/release ms', 10, 800, 1, 120, { log: true, unit: 'ms' }), P('floor', 'Closed level', 0, 0.5, 0.01, 0)],
    gen: (c, n, ins) => {
      const o = c.reg(), gs = c.reg(); c.c('Noise gate');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const env = envFollow(c, ins.in, 1, n.p.rel);
      c.e(`rdax ${env},1.0`); c.e(`sof 1.0,${f6(-Math.min(0.99, n.p.thr))}`);
      gainStages(c, Math.min(64, 1 / (n.p.thr * 0.6)));
      c.e('skp gez,1'); c.e('clr');
      c.e(`rdfx ${gs},${f6(kPole(120))}`);                      // gs = smoothed open/closed state (0..1)
      let mul = gs;
      if (n.p.floor > 0.004) {                                  // closed level: the multiplier is floor..1, kept apart from the filter state
        mul = c.reg(); c.e(`wrax ${gs},1.0`); c.e(`sof ${cc(1 - n.p.floor)},${f6(Math.min(0.999, n.p.floor))}`); c.e(`wrax ${mul},0`);
      } else c.e(`wrax ${gs},0`);
      c.e(`rdax ${ins.in},1.0`); c.e(`mulx ${mul}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  comp: {
    title: 'Compressor', color: '#7bd88f',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('thr', 'Threshold dB', -50, -3, 1, -24, { unit: 'dB' }), P('ratio', 'Ratio', 1.5, 20, 0.5, 4), P('atk', 'Attack ms', 1, 100, 1, 8, { unit: 'ms' }),
      P('rel', 'Release ms', 30, 1500, 1, 250, { log: true, unit: 'ms' }), P('mk', 'Makeup dB', 0, 24, 1, 6, { unit: 'dB' })],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Compressor (envelope -> LOG -> gain computer -> EXP)');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const env = envFollow(c, ins.in, n.p.atk, n.p.rel);
      const Lt = n.p.thr / 20 * Math.log2(10) / 16;               // threshold in the chip's log2/16 domain
      c.e(`rdax ${env},1.0`); c.e('log 1.0,0'); c.e(`sof 1.0,${f6(-Lt)}`);
      c.e('skp gez,1'); c.e('clr');                              // only the part above the threshold
      c.e(`sof ${cc(-(1 - 1 / n.p.ratio))},0`); c.e('exp 1.0,0');
      const G = c.reg(); c.e(`wrax ${G},0`);
      c.e(`rdax ${ins.in},1.0`); c.e(`mulx ${G}`); gainStages(c, Math.pow(10, n.p.mk / 20)); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  svf: {
    title: 'Resonant Filter', color: '#ffd166',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'freq', label: 'freq', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('mode', 'Mode', 0, 3, 1, 1, { select: ['Low-pass', 'Band-pass', 'High-pass', 'Notch'] }), P('hz', 'Freq (max) Hz', 80, 6000, 1, 1800, { log: true, unit: 'Hz' }),
      P('minhz', 'Freq (min) Hz', 20, 2000, 1, 300, { log: true, unit: 'Hz' }), P('q', 'Resonance Q', 0.7, 20, 0.1, 5, { log: true }), P('curve', 'Freq ctl curve', 0, 1, 1, 1, { select: ['Linear', 'Squared (wah-like)'] }),
      P('lvl', 'Output boost x', 1, 8, 0.5, 2.5)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Resonant state-variable filter');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const f = svf(c, ins.in, { hz: n.p.hz, minhz: n.p.minhz === undefined ? 300 : n.p.minhz, ctl: ins.freq, curve: Math.round(n.p.curve), Q: n.p.q });
      const m = Math.round(n.p.mode), lv = n.p.lvl === undefined ? 1 : n.p.lvl;
      if (m === 0) c.e(`rdax ${f.low},1.0`);
      else if (m === 2) c.e(`rdax ${f.high},1.0`);
      else if (m === 1) c.e(`rdax ${f.band},${cc(f.q)}`);
      else { c.e(`rdax ${f.high},1.0`); c.e(`rdax ${f.low},1.0`); }
      gainStages(c, lv); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  phaser: {
    title: 'Phaser', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'rate', label: 'rate*', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('stages', 'Stages', 0, 2, 1, 1, { select: ['2 (mild)', '4 (classic)', '6 (deep)'] }), P('rate', 'Rate (max) Hz', 0.05, 19, 0.05, 0.5, { unit: 'Hz' }),
      P('depth', 'Depth', 0.1, 1, 0.01, 0.8), P('fb', 'Feedback', -0.85, 0.85, 0.01, 0.3), P('mix', 'Mix', 0, 1, 0.01, 0.5)],
    gen: (c, n, ins) => {
      const k = [2, 4, 6][Math.round(n.p.stages)];
      const l = c.lfo('Phaser'), A = c.reg(), o = c.reg();
      const ys = [], xs = [];
      for (let i = 0; i < k; i++) { ys.push(c.reg()); xs.push(c.reg()); }
      c.setup(`wlds sin${l},${kfOf(n.p.rate)},32767`);
      c.c('Phaser (' + k + ' first-order allpass stages)');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const lo = 0.1, hi = 0.1 + 0.85 * n.p.depth;
      if (ins.rate) { c.e(`rdax ${ins.rate},${cc(Math.min(1.99, n.p.rate / MAX_LFO_HZ))}`); c.e(`wrax sin${l}_rate,0`); }
      c.e(`cho rdal,sin${l}`); c.e(`sof ${f6((hi - lo) / 2)},${f6((hi + lo) / 2)}`); c.e(`wrax ${A},0`);
      let sig = ins.in;
      if (Math.abs(n.p.fb) > 0.001) { const s0 = c.reg(); c.e(`rdax ${ins.in},1.0`); c.e(`rdax ${ys[k - 1]},${cc(n.p.fb)}`); c.e(`wrax ${s0},0`); sig = s0; }
      for (let i = 0; i < k; i++) {                     // y = a*(x - y1) + x1
        c.e(`rdax ${sig},1.0`); c.e(`rdax ${ys[i]},-1.0`); c.e(`mulx ${A}`); c.e(`rdax ${xs[i]},1.0`); c.e(`wrax ${ys[i]},0`);
        c.e(`rdax ${sig},1.0`); c.e(`wrax ${xs[i]},0`);
        sig = ys[i];
      }
      c.e(`rdax ${ins.in},${cc(1 - n.p.mix)}`); c.e(`rdax ${ys[k - 1]},${cc(n.p.mix)}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  metal: {
    title: 'Metal Dist (Fromel-style)', color: '#ff6b6b',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'midf', label: 'mid freq', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('trim', 'Input boost x', 1, 8, 0.5, 2), P('dist', 'Distortion x', 2, 80, 0.5, 40, { log: true }), P('tight', 'Tightness Hz', 40, 400, 1, 110, { log: true, unit: 'Hz' }), P('fizz', 'Fizz tame Hz', 2000, 9000, 10, 4200, { log: true, unit: 'Hz' }),
      P('low', 'Low', -1, 1, 0.01, 0.2), P('mid', 'Mid', -1, 1, 0.01, 0.1), P('high', 'High', -1, 1, 0.01, -0.15),
      P('midhz', 'Mid freq (max) Hz', 200, 5000, 1, 900, { log: true, unit: 'Hz' }), P('level', 'Level', 0, 1.99, 0.01, 0.8)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Metal distortion: 4 cascaded soft-clip stages with coupling filters, tame highs, usable 3-band EQ');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const t = c.reg(), y = c.reg();
      const per = Math.min(1.99, Math.max(0.4, Math.pow(n.p.dist, 0.25) / 1.5));
      const stage = () => {                           // gain, then smooth limiter 1.5x - 0.5x^3
        c.e(`sof ${cc(per)},0`); c.e(`wrax ${t},1.0`); c.e(`mulx ${t}`); c.e(`mulx ${t}`); c.e('sof -0.5,0'); c.e(`rdax ${t},1.5`);
      };
      const h1 = hpf(c, ins.in, n.p.tight);
      c.e(`rdax ${h1},1.0`); gainStages(c, n.p.trim === undefined ? 1 : n.p.trim); stage(); stage();
      const s1 = c.reg(); c.e(`wrax ${s1},0`);
      const lp1 = c.onePole(s1, 6500);
      const h2 = hpf(c, lp1, 160);                    // drop the mud between stages (keeps it tight)
      c.e(`rdax ${h2},1.0`); stage(); stage();
      const s3 = c.reg(); c.e(`wrax ${s3},0`);
      const lp2 = c.onePole(s3, n.p.fizz);            // tame the harsh top end
      c.e(`rdax ${lp2},0.5`); c.e(`wrax ${y},0`);
      // 3-band EQ: low shelf, sweepable mid peak, high shelf
      const L = n.p.low, M = n.p.mid, H = n.p.high;
      const lowLP = Math.abs(L) > 0.01 ? c.onePole(y, 130) : null;
      const hiLP = Math.abs(H) > 0.01 ? c.onePole(y, 3200) : null;
      const sv = Math.abs(M) > 0.01 ? svf(c, y, { hz: n.p.midhz, ctl: ins.midf, curve: 0, Q: 1.4 }) : null;
      c.e(`rdax ${y},1.0`);
      if (lowLP) c.e(`rdax ${lowLP},${cc(L)}`);
      if (hiLP) { c.e(`rdax ${y},${cc(H)}`); c.e(`rdax ${hiLP},${cc(-H)}`); }
      if (sv) c.e(`rdax ${sv.band},${cc(M * 1.5 * sv.q)}`);
      c.e(`sof ${cc(n.p.level)},0`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
});

Object.assign(NODE_TYPES, {
  ringmod: {
    title: 'Ring Mod', color: '#c780ff',
    inputs: [{ id: 'in', label: 'in', kind: AUD }, { id: 'freq', label: 'freq', kind: CTL }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('hz', 'Carrier (max) Hz', 20, 4500, 1, 440, { log: true, unit: 'Hz' }), P('mix', 'Mix', 0, 1, 0.01, 0.7)],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Ring modulator (audio-rate quadrature oscillator)');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const X = c.reg(), Y = c.reg();
      const e = Math.min(0.99, 2 * Math.sin(Math.PI * n.p.hz / FS));
      c.setup('sof 0.0,0.45'); c.setup(`wrax ${X},0`);
      if (ins.freq) {
        const E = c.reg();
        c.e(`rdax ${ins.freq},1.0`); c.e(`sof ${f6(e)},0`); c.e(`wrax ${E},0`);
        c.e(`rdax ${Y},1.0`); c.e(`mulx ${E}`); c.e(`rdax ${X},1.0`); c.e(`wrax ${X},0`);
        c.e(`rdax ${X},1.0`); c.e(`mulx ${E}`); c.e('sof -1.0,0'); c.e(`rdax ${Y},1.0`); c.e(`wrax ${Y},0`);
      } else {
        c.e(`rdax ${Y},${f6(e)}`); c.e(`rdax ${X},1.0`); c.e(`wrax ${X},0`);
        c.e(`rdax ${X},${f6(-e)}`); c.e(`rdax ${Y},1.0`); c.e(`wrax ${Y},0`);
      }
      c.e(`rdax ${ins.in},1.0`); c.e(`mulx ${X}`); gainStages(c, 2.2 * 1.0); c.e(`sof ${cc(n.p.mix)},0`);
      c.e(`rdax ${ins.in},${cc(1 - n.p.mix)}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
  crush: {
    title: 'Bit Crusher', color: '#ff6b6b',
    inputs: [{ id: 'in', label: 'in', kind: AUD }], outputs: [{ id: 'out', label: 'out', kind: AUD }],
    params: [P('bits', 'Bits', 2, 12, 1, 5), P('pre', 'Input boost x', 1, 16, 1, 4), P('mix', 'Mix', 0, 1, 0.01, 1), P('tone', 'Smooth Hz', 1000, 15000, 10, 7000, { log: true, unit: 'Hz' })],
    gen: (c, n, ins) => {
      const o = c.reg(); c.c('Bit crusher: boost, truncate to N bits (AND mask), attenuate, smooth');
      if (!ins.in) { c.e('clr'); c.e(`wrax ${o},0`); return { out: o }; }
      const bits = Math.round(n.p.bits), mask = (0xffffff & ~((1 << (24 - bits)) - 1)) >>> 0;
      const pre = Math.round(n.p.pre), t = c.reg();
      c.e(`rdax ${ins.in},1.0`); gainStages(c, pre);
      c.e(`and $${mask.toString(16).padStart(6, '0')}`);
      c.e(`sof ${f6(1 / pre > 0.0001 ? Math.min(1, 1 / pre) : 1)},0`);
      c.e(`wrax ${t},0`);
      const lp = c.onePole(t, n.p.tone);
      c.e(`rdax ${lp},${cc(n.p.mix)}`); c.e(`rdax ${ins.in},${cc(1 - n.p.mix)}`); c.e(`wrax ${o},0`);
      return { out: o };
    },
  },
});

// ---------- human-readable help for tooltips ----------
const DESC = {
  input: 'Audio coming into the pedal (the FV-1 has a stereo ADC; guitar is usually the L channel).',
  output: 'Audio leaving the pedal (stereo DAC). Wire your final signal here. If you only connect L, it is copied to both sides.',
  pot: 'One of the three pedal knobs (POT0, POT1, POT2) as a 0–1 control signal. Drag its output onto any orange "control" input.',
  gain: 'Volume control. With a control signal connected to "ctl" it becomes a VCA (e.g. LFO → tremolo, envelope → auto-swell).',
  mixer: 'Adds up to three audio signals with an individual level for each.',
  xfade: 'Dry/wet blend. Plug the clean signal into "dry", the effect into "wet" and optionally a Pot into "mix".',
  delay: 'Echo with feedback and damping. Output is the wet echoes only; blend with Dry/Wet. A Pot on "time" sweeps the delay time.',
  reverb: 'Stereo plate-style reverb. Outputs are the wet signal only; blend with Dry/Wet.',
  chorus: 'Modulated short delay: chorus, vibrato or flanger depending on settings. Wet only; blend with Dry/Wet.',
  pitch: 'Pitch shifter with two crossfaded read heads. Wet only; blend with Dry/Wet. Short windows are fast but warbly.',
  drive: 'Simple hard-clipping overdrive (gain, clip, tone, level).',
  filter: 'Basic 6 or 12 dB/octave low-pass or high-pass filter.',
  lfo: 'Slow oscillator (sine, triangle, square, soft square or saw) producing a control signal. Use for tremolo, wobble, sweeps.',
  smooth: 'Smooths a control signal (such as a Pot) to avoid zipper noise.',
  env: 'Envelope follower: turns how loud you play into a control signal. Plug into a filter\'s freq for auto-wah, or a Gain "ctl" for swells.',
  gate: 'Noise gate: mutes the signal when it falls below the threshold. Place it early in the chain, before big gain.',
  comp: 'Compressor with threshold, ratio, attack/release and makeup gain. Evens out dynamics and adds sustain.',
  svf: 'Resonant filter (low/band/high-pass/notch). Plug a Pot or Envelope into "freq" for wah / auto-wah.',
  phaser: 'Classic swirling phaser built from allpass stages swept by an LFO.',
  ringmod: 'Ring modulator: multiplies your guitar by an oscillator for metallic, bell-like tones. A Pot on "freq" sweeps the carrier.',
  crush: 'Bit crusher: lo-fi quantization. Fewer bits = grittier. Boost the input so quiet notes still use the steps.',
  metal: 'High-gain distortion inspired by a heavily modded Metal Zone: smooth amp-like clipping, tight low end, tamed fizz, three-band EQ with a sweepable mid.',
};
const GENERIC_PORT = {
  'in:audio': 'AUDIO input (blue). Drop an audio output here: Input L/R, or the output of any effect or Gain/Mixer block.',
  'in:ctl': 'CONTROL input (orange, optional). Drop a control output here: a Pot, LFO, Envelope or Smooth block. When empty, the number on the block is used.',
  'out:audio': 'AUDIO output (blue). Drag from this dot to an input dot on another block (left side). One output can feed several inputs.',
  'out:ctl': 'CONTROL output (orange, 0–1). Drag it to a control input (orange dot), such as a "time", "freq", "mix" or "ctl" input.',
};
const PORT_TIPS = {
  'delay.time': 'Optional. A Pot here sweeps the delay time from about 1 ms up to the "Time (max)" setting.',
  'delay.fb': 'Optional. A control signal here scales the feedback (repeats) up to the "Feedback" setting.',
  'delay.out': 'Echoes only (no dry signal). Send to a Dry/Wet "wet" input or a Mixer.',
  'reverb.l': 'Reverb, left. Send to Output L (or a Dry/Wet "wet").', 'reverb.r': 'Reverb, right. Send to Output R (or a Dry/Wet "wet").',
  'chorus.rate': 'Optional. A Pot here sets LFO speed up to "Rate (max)". (*Rate registers are modeled, not yet bench-verified.)',
  'phaser.rate': 'Optional. A Pot here sets LFO speed up to "Rate (max)".',
  'lfo.rate': 'Optional. A Pot here sets LFO speed up to "Rate (max)".',
  'pitch.pitch': 'Optional. A Pot here sweeps the shift between −N and +N semitones (N = the Semitones setting); not centered on unity.',
  'xfade.a': 'DRY signal (plug the clean signal here).', 'xfade.b': 'WET signal (plug the effect output here).', 'xfade.ctl': 'Optional. A Pot here sets the dry/wet balance (0 = all dry, 1 = all wet).',
  'gain.ctl': 'Optional. A control signal here multiplies the audio (VCA). LFO → tremolo, Envelope → swell.',
  'svf.freq': 'Optional. A Pot (wah pedal) or Envelope (auto-wah) here sweeps the cutoff up to the "Freq (max)" setting.',
  'filter.freq': 'Optional. A Pot here sweeps the cutoff up to the "Cutoff (max)" setting.',
  'ringmod.freq': 'Optional. A Pot or Envelope here sweeps the carrier frequency up to "Carrier (max)".',
  'metal.midf': 'Optional. A Pot here sweeps the mid-EQ centre frequency (like the sweepable mid on a Metal Zone).',
  'env.out': 'Control signal that follows your playing level. Connect to a "freq", "ctl" or "mix" input.',
  'pot.out': 'Pedal knob as a 0–1 control signal. Drag to any orange input.',
  'smooth.in': 'CONTROL input: plug a Pot or other control signal to be smoothed.',
  'input.l': 'Left (guitar) input, audio.', 'input.r': 'Right input, audio.',
  'output.l': 'Left output. Drop your final audio here.', 'output.r': 'Right output. If left empty, L is copied to R.',
};
function portTip(type, dir, port) {
  const def = NODE_TYPES[type], list = dir === 'in' ? def.inputs : def.outputs, pd = list.find((p) => p.id === port);
  const spec = PORT_TIPS[type + '.' + port];
  const g = GENERIC_PORT[dir + ':' + (pd ? pd.kind : 'audio')];
  return (spec ? spec + '\n' : '') + g;
}

function defaultParams(type) {
  const p = {}; NODE_TYPES[type].params.forEach((d) => { p[d.id] = d.def; }); return p;
}

// graph: {nodes:[{id,type,x,y,p}], edges:[{a:'n1.out', b:'n2.in'}]}
// Make a graph from a file / localStorage safe to render and generate: drops unknown blocks and dangling
// cables, fills in settings added since it was saved, and keeps every setting inside its range.
function sanitize(g) {
  const nodes = [], byId = {};
  (g && Array.isArray(g.nodes) ? g.nodes : []).forEach((n) => {
    const def = n && NODE_TYPES[n.type];
    if (!def || typeof n.id !== 'string' || !n.id || n.id.includes('.') || byId[n.id]) return;
    if (def.unique && nodes.some((m) => m.type === n.type)) return;
    const p = defaultParams(n.type);
    def.params.forEach((d) => { const v = n.p && n.p[d.id]; if (typeof v === 'number' && Number.isFinite(v)) p[d.id] = Math.max(d.min, Math.min(d.max, v)); });
    const m = { id: n.id, type: n.type, x: Math.max(0, +n.x || 0), y: Math.max(0, +n.y || 0), p };
    nodes.push(m); byId[m.id] = m;
  });
  const edges = [], fed = {};
  const has = (key, side) => {
    if (typeof key !== 'string') return false;
    const [id, port] = key.split('.'), n = byId[id];
    return !!n && NODE_TYPES[n.type][side].some((x) => x.id === port);
  };
  (g && Array.isArray(g.edges) ? g.edges : []).forEach((e) => {
    if (!e || !has(e.a, 'outputs') || !has(e.b, 'inputs') || fed[e.b] || e.a.split('.')[0] === e.b.split('.')[0]) return;
    fed[e.b] = true; edges.push({ a: e.a, b: e.b });
  });
  return { nodes, edges };
}
// ---------- optimizer: peephole + register sharing ----------
function optimize(code, setup, keep) {
  let lines = code.slice(), removed = 0;
  const isLabelOrComment = (l) => /^\s*;/.test(l) || /:\s*$/.test(l);
  // 1) wrax r,0 ; rdax r,1.0  ->  wrax r,1.0   2) wrax r,0 ; clr  ->  wrax r,0
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], prev = out.length ? out[out.length - 1] : null;
      const mw = prev && /^wrax\s+(\w+)\s*,\s*0(\.0+)?\s*$/i.exec(prev);
      if (mw && !isLabelOrComment(l)) {
        if (/^clr\s*$/i.test(l)) { removed++; continue; }
        const mr = new RegExp('^rdax\\s+' + mw[1] + '\\s*,\\s*1(\\.0+)?\\s*$', 'i').exec(l);
        if (mr) { out[out.length - 1] = 'wrax ' + mw[1] + ',1.0'; removed++; continue; }
      }
      out.push(l);
    }
    lines = out;
  }
  // 2) share temp registers whose live ranges do not overlap
  const rx = /\bREG(\d+)\b/g, first = {}, lastU = {}, firstIsWrite = {};
  lines.forEach((l, i) => {
    if (isLabelOrComment(l)) return;
    const wr = /^\s*(wrax|wrhx|wrlx)\b/i.test(l);
    let m; rx.lastIndex = 0;
    while ((m = rx.exec(l))) { const r = 'REG' + m[1]; if (!(r in first)) { first[r] = i; firstIsWrite[r] = wr; } lastU[r] = i; }
  });
  (setup || []).forEach((l) => { const m = l.match(/\bREG\d+\b/g); if (m) m.forEach((r) => { firstIsWrite[r] = false; }); });
  const temps = Object.keys(first).filter((r) => firstIsWrite[r] && !keep.has(r)).sort((x, y) => first[x] - first[y]);
  const pool = [], map = {}; let saved = 0;
  temps.forEach((r) => {
    const slot = pool.find((q) => q.end < first[r]);
    if (slot) { map[r] = slot.name; slot.end = lastU[r]; saved++; } else pool.push({ name: r, end: lastU[r] });
  });
  if (saved) lines = lines.map((l) => isLabelOrComment(l) ? l : l.replace(/\bREG\d+\b/g, (r) => map[r] || r));
  return { code: lines, removed, saved, map };
}

function generate(graph, opts) {
  opts = opts || {};
  const errors = [];
  const byId = {}; graph.nodes.forEach((n) => { byId[n.id] = n; });
  const outNode = graph.nodes.find((n) => n.type === 'output');
  if (!outNode) return { asm: '', errors: ['Add an Output node.'], stats: {} };
  const incoming = (nid, port) => {
    const e = graph.edges.find((x) => x.b === nid + '.' + port);
    return e ? e.a.split('.') : null;
  };
  const c = new Ctx();
  const done = {}, visiting = {};
  function build(n) {
    if (done[n.id]) return done[n.id];
    if (visiting[n.id]) throw new Error('Feedback loop through "' + NODE_TYPES[n.type].title + '". Use a Delay node feedback instead of a cable loop.');
    visiting[n.id] = true;
    const def = NODE_TYPES[n.type];
    const ins = {};
    def.inputs.forEach((ip) => {
      const src = incoming(n.id, ip.id);
      if (src && byId[src[0]]) { const so = build(byId[src[0]]); ins[ip.id] = so[src[1]] || null; } else ins[ip.id] = null;
    });
    const outs = def.gen(c, n, ins) || {};
    visiting[n.id] = false; done[n.id] = outs; return outs;
  }
  try { build(outNode); } catch (e) { return { asm: '', errors: [e.message], stats: {} }; }
  // level taps: the first register-valued output of each block
  const taps = {}, keep = new Set();
  Object.keys(done).forEach((id) => {
    const o = done[id], k = Object.keys(o).find((x) => /^REG\d+$/.test(o[x]));
    if (k) { taps[id] = o[k]; keep.add(o[k]); }
  });
  let code = c.code, stats = { regs: c.regN, memTop: c.memTop };
  if (opts.optimize !== false) {
    const r = optimize(c.code, c.setupLines, keep);
    code = r.code;
    const used = new Set((code.join('\n').match(/\bREG\d+\b/g) || []));
    stats.regsBefore = c.regN; stats.regs = used.size; stats.saved = r.removed; stats.regsSaved = r.saved;
  }
  // The chip has REG0..REG31. Blocks allocate freely; what counts is what is left after register sharing.
  let setup = c.setupLines;
  const order = [];
  setup.concat(code).forEach((l) => { if (/^\s*;/.test(l)) return; (l.match(/\bREG\d+\b/g) || []).forEach((r) => { if (!order.includes(r)) order.push(r); }); });
  if (order.length > 32) {
    return { asm: '', errors: ['Out of registers: this patch needs ' + order.length + ', the FV-1 has 32.' + (opts.optimize === false ? ' Turn on "Optimize code" to share registers.' : ' Remove a block or two.')], stats: {} };
  }
  stats.regs = order.length;
  if (order.some((r) => +r.slice(3) > 31)) {            // squeeze the survivors into REG0..REG31
    const ren = {}; order.forEach((r, i) => { ren[r] = 'REG' + i; });
    const fix = (l) => (/^\s*;/.test(l) ? l : l.replace(/\bREG\d+\b/g, (r) => ren[r] || r));
    code = code.map(fix); setup = setup.map(fix);
    Object.keys(taps).forEach((id) => { if (ren[taps[id]]) taps[id] = ren[taps[id]]; else delete taps[id]; });
  }
  const hdr = ['; Generated by FV-1 Studio', '; FV-1 @ 32 kHz'];
  let asm = hdr.join('\n') + '\n';
  if (c.memLines.length) asm += '\n' + c.memLines.join('\n') + '\n';
  if (setup.length) asm += '\nskp run,setup_done\n' + setup.join('\n') + '\nsetup_done:\n';
  asm += '\n' + code.join('\n') + '\n';
  // pot usage legend: which blocks each knob feeds
  const legend = [[], [], []];
  graph.nodes.filter((n) => n.type === 'pot').forEach((pn) => {
    graph.edges.filter((e) => e.a.startsWith(pn.id + '.')).forEach((e) => {
      const [tid, tp] = e.b.split('.'), t = byId[tid]; if (!t) return;
      const pd = NODE_TYPES[t.type].inputs.find((x) => x.id === tp);
      legend[Math.round(pn.p.pot)].push(NODE_TYPES[t.type].title + (pd ? ' ' + pd.label.replace('*', '') : ''));
    });
  });
  return { asm, errors, stats, taps, legend };
}

// ---------- presets ----------
const N = (id, type, x, y, p) => ({ id, type, x, y, p: Object.assign(defaultParams(type), p || {}) });
const PRESETS = {
  'Clean (pass-through)': {
    nodes: [N('n1', 'input', 20, 20), N('n2', 'output', 260, 20)],
    edges: [{ a: 'n1.l', b: 'n2.l' }],
  },
  'Echo': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'delay', 230, 10, { time: 600, fb: 0.55, damp: 3500 }), N('n3', 'xfade', 450, 20), N('n4', 'output', 670, 20),
      N('p0', 'pot', 10, 230, { pot: 0 }), N('p1', 'pot', 10, 320, { pot: 1 }), N('p2', 'pot', 450, 230, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'n3.out', b: 'n4.l' },
      { a: 'p0.out', b: 'n2.time' }, { a: 'p1.out', b: 'n2.fb' }, { a: 'p2.out', b: 'n3.ctl' }],
  },
  'Plate Reverb': {
    nodes: [N('n1', 'input', 10, 100), N('n2', 'reverb', 230, 10), N('n3', 'xfade', 450, 10, { mix: 0.35 }), N('n4', 'xfade', 450, 230, { mix: 0.35 }), N('n5', 'output', 670, 100),
      N('p2', 'pot', 230, 330, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n1.l', b: 'n4.a' }, { a: 'n2.l', b: 'n3.b' }, { a: 'n2.r', b: 'n4.b' },
      { a: 'n3.out', b: 'n5.l' }, { a: 'n4.out', b: 'n5.r' }, { a: 'p2.out', b: 'n3.ctl' }, { a: 'p2.out', b: 'n4.ctl' }],
  },
  'Chorus': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'chorus', 230, 10, { rate: 0.8, depth: 2.5, center: 8 }), N('n3', 'xfade', 450, 20, { mix: 0.5 }), N('n4', 'output', 670, 20),
      N('p0', 'pot', 10, 230, { pot: 0 }), N('p2', 'pot', 450, 230, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'n3.out', b: 'n4.l' }, { a: 'p0.out', b: 'n2.rate' }, { a: 'p2.out', b: 'n3.ctl' }],
  },
  'Octave Up': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'pitch', 230, 10, { semis: 12, win: 2 }), N('n3', 'xfade', 450, 20, { mix: 0.5 }), N('n4', 'output', 670, 20), N('p2', 'pot', 450, 230, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'n3.out', b: 'n4.l' }, { a: 'p2.out', b: 'n3.ctl' }],
  },
  'Whammy (POT0 = pitch)': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'pitch', 230, 10, { semis: 12, win: 1 }), N('n3', 'xfade', 450, 20, { mix: 1 }), N('n4', 'output', 670, 20), N('p0', 'pot', 10, 230, { pot: 0 }), N('p2', 'pot', 450, 230, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'n3.out', b: 'n4.l' }, { a: 'p0.out', b: 'n2.pitch' }, { a: 'p2.out', b: 'n3.ctl' }],
  },
  'Auto-Wah': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'env', 10, 150, { atk: 5, rel: 200, gain: 10 }), N('n3', 'svf', 230, 10, { mode: 1, hz: 2200, minhz: 250, q: 6, curve: 0 }), N('n4', 'xfade', 450, 20, { mix: 0.9 }), N('n5', 'output', 670, 20),
      N('p2', 'pot', 450, 230, { pot: 2 })],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.in' }, { a: 'n2.out', b: 'n3.freq' }, { a: 'n1.l', b: 'n4.a' }, { a: 'n3.out', b: 'n4.b' }, { a: 'n4.out', b: 'n5.l' }, { a: 'p2.out', b: 'n4.ctl' }],
  },
  'Wah (POT0 = pedal)': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'svf', 230, 10, { mode: 1, hz: 2400, minhz: 350, q: 5, curve: 1 }), N('p0', 'pot', 10, 180, { pot: 0 }), N('n3', 'output', 470, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'p0.out', b: 'n2.freq' }, { a: 'n2.out', b: 'n3.l' }],
  },
  'Phaser': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'phaser', 230, 10, { rate: 0.4 }), N('p0', 'pot', 10, 180, { pot: 0 }), N('n3', 'output', 470, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'p0.out', b: 'n2.rate' }, { a: 'n2.out', b: 'n3.l' }],
  },
  'Compressor + Gate': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'gate', 230, 10, { thr: 0.01 }), N('n3', 'comp', 450, 10), N('n4', 'gain', 670, 20, { gain: 1.99 }), N('p0', 'pot', 670, 180, { pot: 0 }), N('n5', 'output', 890, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n2.out', b: 'n3.in' }, { a: 'n3.out', b: 'n4.in' }, { a: 'p0.out', b: 'n4.ctl' }, { a: 'n4.out', b: 'n5.l' }],
  },
  'Metal (Fromel-style)': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'gate', 230, 10, { thr: 0.006 }), N('n3', 'metal', 450, 10), N('n4', 'gain', 670, 20, { gain: 1.99 }), N('p0', 'pot', 670, 180, { pot: 0 }), N('p1', 'pot', 450, 370, { pot: 1 }), N('n5', 'output', 890, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n2.out', b: 'n3.in' }, { a: 'n3.out', b: 'n4.in' }, { a: 'p0.out', b: 'n4.ctl' }, { a: 'p1.out', b: 'n3.midf' }, { a: 'n4.out', b: 'n5.l' }],
  },
  'Ring Mod (POT0 = freq)': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'ringmod', 230, 10, { hz: 1200, mix: 1 }), N('p0', 'pot', 10, 180, { pot: 0, curve: 1 }), N('n3', 'xfade', 450, 20, { mix: 0.7 }), N('p2', 'pot', 450, 230, { pot: 2 }), N('n4', 'output', 670, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'p0.out', b: 'n2.freq' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'p2.out', b: 'n3.ctl' }, { a: 'n3.out', b: 'n4.l' }],
  },
  'Lo-Fi Crusher': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'crush', 230, 10, { bits: 5, pre: 4, tone: 5000, mix: 1 }), N('n3', 'xfade', 450, 20, { mix: 1 }), N('p2', 'pot', 450, 230, { pot: 2 }), N('n4', 'output', 670, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.a' }, { a: 'n2.out', b: 'n3.b' }, { a: 'p2.out', b: 'n3.ctl' }, { a: 'n3.out', b: 'n4.l' }],
  },
  'Square Tremolo': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'lfo', 10, 150, { shape: 3, rate: 6, low: 0.1, high: 1 }), N('p0', 'pot', 230, 330, { pot: 0 }), N('n3', 'gain', 230, 20), N('n4', 'output', 450, 20)],
    edges: [{ a: 'n1.l', b: 'n3.in' }, { a: 'p0.out', b: 'n2.rate' }, { a: 'n2.out', b: 'n3.ctl' }, { a: 'n3.out', b: 'n4.l' }],
  },
  'Tremolo': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'lfo', 10, 150, { rate: 5, low: 0.1, high: 1 }), N('p0', 'pot', 230, 330, { pot: 0 }), N('n3', 'gain', 230, 20), N('n4', 'output', 450, 20)],
    edges: [{ a: 'n1.l', b: 'n3.in' }, { a: 'p0.out', b: 'n2.rate' }, { a: 'n2.out', b: 'n3.ctl' }, { a: 'n3.out', b: 'n4.l' }],
  },
  'Overdrive': {
    nodes: [N('n1', 'input', 10, 20), N('n2', 'drive', 230, 10, { gain: 10, level: 0.45, tone: 3000 }), N('n3', 'filter', 450, 20, { hz: 7000 }), N('p1', 'pot', 450, 230, { pot: 1 }), N('n4', 'output', 670, 20)],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n2.out', b: 'n3.in' }, { a: 'n3.out', b: 'n4.l' }, { a: 'p1.out', b: 'n3.freq' }],
  },
};

const api = { NODE_TYPES, PRESETS, generate, sanitize, defaultParams, FS, MAX_LFO_HZ, DESC, portTip };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.FV1PATCH = api;
})(typeof self !== 'undefined' ? self : this);
