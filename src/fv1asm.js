/* FV-1 assembler (SpinASM-compatible subset) -> 32-bit machine words, Intel HEX.
 * Encoding tables follow the FV-1 datasheet instruction formats and were
 * cross-checked word-for-word against the open-source asfv1 assembler. */
(function (root) {
'use strict';

const PROGLEN = 128, DELAYSIZE = 32767;

const M = { 1:1, 2:3, 5:0x1f, 6:0x3f, 9:0x1ff, 11:0x7ff, 15:0x7fff, 16:0xffff, 24:0xffffff, 32:0xffffffff };
// mnemonic: [opcode, [mask, shift], ...]
const OPS = {
  RDA:[0, [M[15],5],[M[11],21]], RMPA:[1,[M[11],21]],
  WRA:[2,[M[15],5],[M[11],21]],  WRAP:[3,[M[15],5],[M[11],21]],
  RDAX:[4,[M[6],5],[M[16],16]],  RDFX:[5,[M[6],5],[M[16],16]],
  WRAX:[6,[M[6],5],[M[16],16]],  WRHX:[7,[M[6],5],[M[16],16]],
  WRLX:[8,[M[6],5],[M[16],16]],  MAXX:[9,[M[6],5],[M[16],16]],
  MULX:[10,[M[6],5]],
  LOG:[11,[M[16],16],[M[11],5]], EXP:[12,[M[16],16],[M[11],5]], SOF:[13,[M[16],16],[M[11],5]],
  AND:[14,[M[24],8]], OR:[15,[M[24],8]], XOR:[16,[M[24],8]],
  SKP:[17,[M[5],27],[M[6],21]],
  WLDS:[18,[M[1],29],[M[9],20],[M[15],5]],
  WLDR:[18,[M[2],29],[M[16],13],[M[2],5]],
  JAM:[19,[M[2],6]],
  CHO:[20,[M[2],30],[M[2],21],[M[6],24],[M[16],5]],
  // pseudo ops
  RAW:[0,[M[32],0]],
  LDAX:[5,[M[6],5]], ABSA:[9], CLR:[14], NOT:[16,[M[24],8]], NOP:[17], JMP:[17,[M[5],27],[M[6],21]],
};

const SYMS = {
  SIN0_RATE:0x00, SIN0_RANGE:0x01, SIN1_RATE:0x02, SIN1_RANGE:0x03,
  RMP0_RATE:0x04, RMP0_RANGE:0x05, RMP1_RATE:0x06, RMP1_RANGE:0x07,
  POT0:0x10, POT1:0x11, POT2:0x12, ADCL:0x14, ADCR:0x15, DACL:0x16, DACR:0x17, ADDR_PTR:0x18,
  SIN0:0, SIN1:1, RMP0:2, RMP1:3, RDA:0, SOF:2, RDAL:3,
  SIN:0, COS:1, REG:2, COMPC:4, COMPA:8, RPTR2:0x10, NA:0x20,
  RUN:0x10, ZRC:0x08, ZRO:0x04, GEZ:0x02, NEG:0x01,
};
for (let i = 0; i < 32; i++) SYMS['REG' + i] = 0x20 + i;

const MIN_S1_14 = -2, MAX_S1_14 = (32768 - 1) / 16384;
const MIN_S1_9 = -2, MAX_S1_9 = (1024 - 1) / 512;
const MIN_S_10 = -1, MAX_S_10 = (1024 - 1) / 1024;
const MIN_S_15 = -1, MAX_S_15 = (32768 - 1) / 32768;
const MIN_S_23 = -1, MAX_S_23 = (8388608 - 1) / 8388608;

function roundHalfEven(x) {            // matches Python's round()
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;
}

const TOKRE = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(0[xX][0-9a-fA-F_]+|0[bB][01_]+)|(\$[0-9a-fA-F_]+)|(%[01_]+)|((?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)|(<<|>>|\/\/|\*\*|[-+*\/|&^~(),:]))/y;

function assemble(src, opts) {
  opts = opts || {};
  const errors = [], warnings = [];
  const sym = Object.assign({}, SYMS);
  const labels = {};              // skip targets
  const pl = [];                  // parsed instructions {cmd:[...], target, line}
  let delaymem = 0;
  const memLayout = [];
  let line = 0;

  const err = (m, ln) => errors.push({ line: ln || line, msg: m });
  const warn = (m, ln) => warnings.push({ line: ln || line, msg: m });

  function tokenize(text) {
    const toks = [];
    TOKRE.lastIndex = 0;
    let pos = 0;
    const s = text;
    while (pos < s.length) {
      if (/^\s*$/.test(s.slice(pos))) break;
      TOKRE.lastIndex = pos;
      const m = TOKRE.exec(s);
      if (!m) { err('Unrecognised input "' + s.slice(pos).trim().slice(0, 12) + '"'); return toks; }
      pos = TOKRE.lastIndex;
      if (m[1] !== undefined) {
        let id = m[1].toUpperCase();
        // name# / name^ memory modifiers (only if defined)
        const nx = s[pos];
        if ((nx === '#' || nx === '^') && (id + nx) in sym) { id += nx; pos++; }
        toks.push({ t: 'id', v: id, raw: m[1] });
      } else if (m[2] !== undefined) {
        const x = m[2].toLowerCase().replace(/_/g, '');
        toks.push({ t: 'num', v: x.startsWith('0x') ? parseInt(x.slice(2), 16) : parseInt(x.slice(2), 2), real: false });
      } else if (m[3] !== undefined) {
        toks.push({ t: 'num', v: parseInt(m[3].slice(1).replace(/_/g, ''), 16), real: false });
      } else if (m[4] !== undefined) {
        toks.push({ t: 'num', v: parseInt(m[4].slice(1).replace(/_/g, ''), 2), real: false });
      } else if (m[5] !== undefined) {
        const txt = m[5];
        const real = /[.eE]/.test(txt) || txt === '1' || txt === '2';   // "spinreals": bare 1 and 2 are reals
        toks.push({ t: 'num', v: parseFloat(txt), real, bare: !/[.eE]/.test(txt) });
      } else if (m[6] !== undefined) {
        toks.push({ t: 'op', v: m[6] });
      }
    }
    return toks;
  }

  // ---------- expression evaluator over token slice ----------
  function evalExpr(toks) {
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v) => i < toks.length && toks[i].t === 'op' && toks[i].v === v;
    function primary() {
      const t = toks[i];
      if (!t) throw new Error('Missing operand');
      if (t.t === 'num') { i++; return { v: t.v, r: t.real }; }
      if (t.t === 'id') {
        i++;
        if (!(t.v in sym)) throw new Error('Undefined symbol ' + t.raw);
        const v = sym[t.v];
        return { v, r: !Number.isInteger(v) };
      }
      if (t.t === 'op' && t.v === '(') {
        i++; const r = bor();
        if (!isOp(')')) throw new Error('Missing )');
        i++; return r;
      }
      throw new Error('Unexpected "' + (t.v) + '"');
    }
    function unary() {
      if (isOp('-')) { i++; const a = unary(); return { v: -a.v, r: a.r }; }
      if (isOp('+')) { i++; return unary(); }
      if (isOp('~')) { i++; const a = unary(); return { v: ~Math.trunc(a.v), r: false }; }
      return primary();
    }
    function mul() {
      let a = unary();
      while (isOp('*') || isOp('/') || isOp('//')) {
        const op = toks[i++].v; const b = unary();
        if (op === '*') a = { v: a.v * b.v, r: a.r || b.r };
        else if (op === '/') a = { v: a.v / b.v, r: true };
        else a = { v: Math.floor(a.v / b.v), r: false };
      }
      return a;
    }
    function add() {
      let a = mul();
      while (isOp('+') || isOp('-')) {
        const op = toks[i++].v; const b = mul();
        a = op === '+' ? { v: a.v + b.v, r: a.r || b.r } : { v: a.v - b.v, r: a.r || b.r };
      }
      return a;
    }
    function shift() {
      let a = add();
      while (isOp('<<') || isOp('>>')) {
        const op = toks[i++].v; const b = add();
        a = { v: op === '<<' ? Math.trunc(a.v) * Math.pow(2, b.v) : Math.floor(a.v / Math.pow(2, b.v)), r: false };
      }
      return a;
    }
    function band() { let a = shift(); while (isOp('&')) { i++; const b = shift(); a = { v: (Math.trunc(a.v) & Math.trunc(b.v)) >>> 0, r: false }; } return a; }
    function bxor() { let a = band(); while (isOp('^')) { i++; const b = band(); a = { v: (Math.trunc(a.v) ^ Math.trunc(b.v)) >>> 0, r: false }; } return a; }
    function bor() { let a = bxor(); while (isOp('|')) { i++; const b = bxor(); a = { v: (Math.trunc(a.v) | Math.trunc(b.v)) >>> 0, r: false }; } return a; }
    const res = bor();
    if (i < toks.length) throw new Error('Unexpected "' + toks[i].v + '"');
    return res;
  }

  // ---------- argument converters (mirror asfv1) ----------
  function clampInt(v, lo, hi, what) {
    if (v < lo) { warn(what + ' clamped to ' + lo); return lo; }
    if (v > hi) { warn(what + ' clamped to ' + hi); return hi; }
    return v;
  }
  function fixed(e, minv, maxv, ref, rawMax, what) {
    if (!e.r) return clampInt(Math.trunc(e.v), 0, rawMax, what);
    let v = e.v;
    if (v < minv) { warn(what + ' clamped to ' + minv); v = minv; }
    if (v > maxv) { warn(what + ' clamped to ' + maxv); v = maxv; }
    return roundHalfEven(v * ref);
  }
  const s1_14 = (e) => fixed(e, MIN_S1_14, MAX_S1_14, 16384, 0xffff, 'S1.14 value');
  const s1_9  = (e) => fixed(e, MIN_S1_9, MAX_S1_9, 512, 0x7ff, 'S1.9 value');
  const s_10  = (e) => fixed(e, MIN_S_10, MAX_S_10, 1024, 0x7ff, 'S.10 value');
  const s_23  = (e) => fixed(e, MIN_S_23, MAX_S_23, 8388608, 0xffffff, 'S.23 value');
  function intArg(e, lo, hi, what) {
    if (!Number.isInteger(e.v)) throw new Error('Invalid ' + what + ' ' + e.v);
    if (e.v < lo || e.v > hi) throw new Error(what + ' ' + e.v + ' out of range');
    return e.v;
  }
  function d15(e) {   // delay address
    let v = e.v;
    if (v < MIN_S_15 || v > MAX_S_15) {
      v = roundHalfEven(v);
      if (v < -0x8000 || v > 0x7fff) { warn('Address clamped'); v = Math.max(-0x8000, Math.min(0x7fff, v)); }
      return v;
    }
    return roundHalfEven(v * 32768);
  }
  function s15a(e) {  // CHO address
    if (e.r && Number.isInteger(e.v)) e = { v: e.v, r: false };
    if (!e.r) return clampInt(Math.trunc(e.v), 0, 0xffff, 'Address');
    let v = Math.max(MIN_S_15, Math.min(MAX_S_15, e.v));
    return roundHalfEven(v * 32768);
  }

  // proper shifted-OR without int32 overflow
  function opGen2(cmd) {
    const gen = OPS[cmd[0]];
    let w = gen[0] >>> 0;
    for (let i = 1; i < gen.length; i++) {
      if (i < cmd.length) {
        const field = (cmd[i] & gen[i][0]) >>> 0;
        w = (w | ((field << gen[i][1]) >>> 0)) >>> 0;
      }
    }
    return w >>> 0;
  }

  // ---------- statement parsing ----------
  const lines = String(src).split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    line = ln + 1;
    const text = lines[ln].split(';')[0];
    if (/^\s*$/.test(text)) continue;
    let toks = tokenize(text);
    try {
      // labels:  name:
      while (toks.length >= 2 && toks[0].t === 'id' && toks[1].t === 'op' && toks[1].v === ':') {
        labels[toks[0].v] = pl.length;
        toks = toks.slice(2);
      }
      if (!toks.length) continue;
      const first = toks[0];
      if (first.t !== 'id') throw new Error('Unexpected "' + first.v + '"');

      // directives
      let dir = null, name = null, rest = null;
      if (first.v === 'EQU' || first.v === 'MEM') { dir = first.v; name = toks[1] && toks[1].v; rest = toks.slice(2); }
      else if (toks[1] && toks[1].t === 'id' && (toks[1].v === 'EQU' || toks[1].v === 'MEM')) { dir = toks[1].v; name = first.v; rest = toks.slice(2); }
      if (dir) {
        if (!name) throw new Error('Missing name');
        name = name.replace(/[#^]$/, '');
        if (['RDAL', 'SOF', 'RDA'].includes(name)) throw new Error('Reserved name ' + name);
        const e = evalExpr(rest);
        if (dir === 'EQU') { sym[name] = e.v; }
        else {
          if (!Number.isInteger(e.v)) throw new Error('Memory ' + name + ' length not an integer');
          let size = e.v;
          if (size < 0 || size > DELAYSIZE) { warn('Memory size clamped'); size = Math.max(0, Math.min(DELAYSIZE, size)); }
          const top = delaymem + size;
          if (delaymem > DELAYSIZE || top > DELAYSIZE) throw new Error('Delay memory exhausted (' + name + ')');
          sym[name] = delaymem; sym[name + '#'] = top; sym[name + '^'] = delaymem + Math.floor(size / 2);
          memLayout.push(name + ':' + delaymem + '+' + size);
          delaymem = top + 1;
        }
        continue;
      }

      // instruction
      const mn = first.v;
      if (!(mn in OPS)) throw new Error('Unexpected "' + first.raw + '"');
      if (pl.length >= PROGLEN) throw new Error('Program exceeds ' + PROGLEN + ' instructions');
      // split operands on commas
      const args = []; let cur = [];
      for (const t of toks.slice(1)) {
        if (t.t === 'op' && t.v === ',') { args.push(cur); cur = []; } else cur.push(t);
      }
      if (cur.length || args.length) args.push(cur);
      const need = (n) => { if (args.length < n) throw new Error('Missing operand for ' + mn); if (args.length > n) warn('Excess operands for ' + mn); };
      const E = (k) => evalExpr(args[k]);

      switch (mn) {
        case 'AND': case 'OR': case 'XOR': need(1); pl.push({ cmd: [mn, s_23(E(0))], line }); break;
        case 'SOF': case 'EXP': case 'LOG': need(2); pl.push({ cmd: [mn, s1_14(E(0)), s_10(E(1))], line }); break;
        case 'RDAX': case 'WRAX': case 'MAXX': case 'RDFX': case 'WRLX': case 'WRHX':
          need(2); pl.push({ cmd: [mn, intArg(E(0), 0, 63, 'Register'), s1_14(E(1))], line }); break;
        case 'MULX': need(1); pl.push({ cmd: [mn, intArg(E(0), 0, 63, 'Register')], line }); break;
        case 'SKP': case 'JMP': {
          let cond = 0, a = args;
          if (mn === 'SKP') { need(2); cond = intArg(E(0), 0, 31, 'Condition'); a = [args[1]]; } else need(1);
          let target = null, off = 0;
          if (a[0].length === 1 && a[0][0].t === 'id' && !(a[0][0].v in sym)) target = a[0][0].v;
          else off = intArg(evalExpr(a[0]), 0, 63, 'Offset');
          pl.push({ cmd: ['SKP', cond, off], target, line }); break;
        }
        case 'RDA': case 'WRA': case 'WRAP': need(2); pl.push({ cmd: [mn, d15(E(0)), s1_9(E(1))], line }); break;
        case 'RMPA': need(1); pl.push({ cmd: [mn, s1_9(E(0))], line }); break;
        case 'WLDS': need(3); {
          const lfo = intArg(E(0), 0, 3, 'LFO') & 1;
          pl.push({ cmd: [mn, lfo, intArg(E(1), 0, 511, 'Frequency'), d15(E(2))], line });
        } break;
        case 'WLDR': need(3); {
          const lfo = intArg(E(0), 0, 3, 'LFO') | 2;
          let f = E(1).v;
          if (f < -0.5 || f > MAX_S_15) { f = Math.max(-0x8000, Math.min(0x7fff, roundHalfEven(f))); } else f = roundHalfEven(f * 32768);
          const amps = { 4096: 0, 2048: 1, 1024: 2, 512: 3, 0: 0, 1: 1, 2: 2, 3: 3 };
          const av = E(2).v; if (!(av in amps)) throw new Error('Invalid ramp amplitude ' + av);
          pl.push({ cmd: [mn, lfo, f, amps[av]], line });
        } break;
        case 'JAM': need(1); pl.push({ cmd: [mn, intArg(E(0), 0, 3, 'LFO') | 2], line }); break;
        case 'CHO': {
          if (args.length < 2) throw new Error('Missing operand for CHO');
          const ty = evalExpr(args[0]).v;
          if (![0, 2, 3].includes(ty)) throw new Error('Invalid CHO type');
          const lfo = intArg(E(1), 0, 3, 'LFO');
          let flags = 2, arg = 0;
          const fl = (x) => {
            let f = intArg(x, 0, 63, 'Flags');
            const keep = (lfo & 2) ? (f & 0x3e) : (f & 0x0f);
            if (keep !== f) warn('CHO flags adjusted to 0x' + keep.toString(16));
            return keep;
          };
          if (ty === 0 || ty === 2) { need(4); flags = fl(E(2)); arg = s15a(E(3)); }
          else if (args.length >= 3) flags = fl(E(2));
          pl.push({ cmd: ['CHO', ty, lfo, flags, arg], line });
        } break;
        case 'RAW': need(1); pl.push({ cmd: ['RAW', Math.max(0, Math.min(0xffffffff, Math.trunc(E(0).v)))], line }); break;
        case 'CLR': pl.push({ cmd: ['AND', 0], line }); break;
        case 'NOT': pl.push({ cmd: ['XOR', 0xffffff], line }); break;
        case 'NOP': pl.push({ cmd: ['SKP', 0, 0], line }); break;
        case 'ABSA': pl.push({ cmd: ['MAXX', 0, 0], line }); break;
        case 'LDAX': need(1); pl.push({ cmd: ['RDFX', intArg(E(0), 0, 63, 'Register'), 0], line }); break;
        default: throw new Error('Unexpected "' + first.raw + '"');
      }
    } catch (e) { err(e.message); }
  }

  // resolve skip targets
  pl.forEach((p, idx) => {
    if (p.cmd[0] === 'SKP' && p.target) {
      if (!(p.target in labels)) { err('Undefined skip target ' + p.target, p.line); return; }
      const dest = labels[p.target];
      if (dest <= idx) { err('Target ' + p.target + ' does not follow SKP', p.line); return; }
      const off = dest - idx - 1;
      if (off > 63) { err('Skip to ' + p.target + ' too far (' + off + ')', p.line); return; }
      p.cmd[2] = off;
    }
  });

  const words = new Uint32Array(PROGLEN);
  const ninstr = pl.length;
  for (let i = 0; i < PROGLEN; i++) words[i] = i < ninstr ? opGen2(pl[i].cmd) : 0x11; // pad with SKP 0,0 (NOP)
  return { words, ninstr, errors, warnings, memUsed: delaymem, memLayout, symbols: sym };
}

function wordsToBytes(words) {
  const b = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    b[4 * i] = (words[i] >>> 24) & 255; b[4 * i + 1] = (words[i] >>> 16) & 255;
    b[4 * i + 2] = (words[i] >>> 8) & 255; b[4 * i + 3] = words[i] & 255;
  }
  return b;
}

// 8 programs x 512 bytes = 4096 byte image for a 24LC32A
function buildBankImage(programWordsArr) {
  const img = new Uint8Array(4096);
  for (let s = 0; s < 8; s++) {
    const w = programWordsArr[s] || new Uint32Array(PROGLEN).fill(0x11);
    img.set(wordsToBytes(w), s * 512);
  }
  return img;
}

function toIntelHex(bytes, width) {
  width = width || 16;
  let out = '';
  for (let a = 0; a < bytes.length; a += width) {
    const n = Math.min(width, bytes.length - a);
    let sum = n + ((a >> 8) & 255) + (a & 255);
    let l = ':' + hex(n, 2) + hex(a, 4) + '00';
    for (let j = 0; j < n; j++) { l += hex(bytes[a + j], 2); sum += bytes[a + j]; }
    l += hex((-sum) & 255, 2);
    out += l + '\n';
  }
  return out + ':00000001FF\n';
}
function hex(v, n) { return (v >>> 0).toString(16).toUpperCase().padStart(n, '0'); }


// ---------- disassembler: machine words -> SpinASM text that re-assembles to the same words ----------
const REGNAME = {};
Object.keys(SYMS).forEach((k) => { if (/^(SIN[01]_|RMP[01]_|POT|ADC|DAC|ADDR_PTR|REG\d)/.test(k) && !(SYMS[k] in REGNAME)) REGNAME[SYMS[k]] = k.toLowerCase(); });
function disassemble(words, opts) {
  opts = opts || {};
  const sg = (v, b) => ((v & (1 << (b - 1))) ? v - (1 << b) : v);
  const rn = (r) => REGNAME[r] || ('$' + r.toString(16));
  const f = (x, n) => { let t = x.toFixed(n || 9); if (t.indexOf('.') < 0) t += '.0'; return t; };
  const NOP = 0x11;
  let last = -1;
  for (let i = 0; i < words.length; i++) if ((words[i] >>> 0) !== NOP) last = i;
  const out = [];
  if (!opts.noHeader) out.push('; Disassembled by FV-1 Studio', '; Delay addresses are plain numbers (no MEM names).');
  const hex6 = (v) => '$' + (v >>> 0).toString(16).padStart(6, '0');
  for (let i = 0; i <= last; i++) {
    const w = words[i] >>> 0, op = w & 31;
    let t;
    switch (op) {
      case 0: case 2: case 3: t = ['rda', 'rmpa', 'wra', 'wrap'][op] + ' ' + ((w >>> 5) & 0x7fff) + ',' + f(sg((w >>> 21) & 0x7ff, 11) / 512); break;
      case 1: t = 'rmpa ' + f(sg((w >>> 21) & 0x7ff, 11) / 512); break;
      case 4: case 5: case 6: case 7: case 8: case 9: {
        const nm = ['rdax', 'rdfx', 'wrax', 'wrhx', 'wrlx', 'maxx'][op - 4], reg = (w >>> 5) & 63, c = sg((w >>> 16) & 0xffff, 16) / 16384;
        if (op === 5 && c === 0) t = 'ldax ' + rn(reg);
        else if (op === 9 && c === 0 && reg === 0) t = 'absa';
        else t = nm + ' ' + rn(reg) + ',' + f(c);
        break;
      }
      case 10: t = 'mulx ' + rn((w >>> 5) & 63); break;
      case 11: case 12: case 13: t = ['log', 'exp', 'sof'][op - 11] + ' ' + f(sg((w >>> 16) & 0xffff, 16) / 16384) + ',' + f(sg((w >>> 5) & 0x7ff, 11) / 1024); break;
      case 14: case 15: case 16: {
        const m = (w >>> 8) & 0xffffff;
        if (op === 14 && m === 0) t = 'clr';
        else if (op === 16 && m === 0xffffff) t = 'not';
        else t = ['and', 'or', 'xor'][op - 14] + ' ' + hex6(m);
        break;
      }
      case 17: {
        const cond = (w >>> 27) & 31, n = (w >>> 21) & 63;
        if (cond === 0 && n === 0 && (w >>> 0) === NOP) { t = 'nop'; break; }
        const names = [[0x10, 'run'], [8, 'zrc'], [4, 'zro'], [2, 'gez'], [1, 'neg']].filter((x) => cond & x[0]).map((x) => x[1]);
        t = 'skp ' + (names.length ? names.join('|') : '0') + ',' + n;
        break;
      }
      case 18:
        if ((w >>> 30) & 1) t = 'wldr rmp' + ((w >>> 29) & 1) + ',' + sg((w >>> 13) & 0xffff, 16) + ',' + [4096, 2048, 1024, 512][(w >>> 5) & 3];
        else t = 'wlds sin' + ((w >>> 29) & 1) + ',' + ((w >>> 20) & 0x1ff) + ',' + ((w >>> 5) & 0x7fff);
        break;
      case 19: t = 'jam rmp' + ((w >>> 6) & 1); break;
      case 20: {
        const ty = (w >>> 30) & 3, lfo = (w >>> 21) & 3, fl = (w >>> 24) & 63, ad = (w >>> 5) & 0xffff;
        if (ty === 1) { t = 'raw $' + w.toString(16).padStart(8, '0'); break; }
        const fn = [];
        if (lfo < 2) fn.push((fl & 1) ? 'cos' : 'sin');
        [[2, 'reg'], [4, 'compc'], [8, 'compa'], [0x10, 'rptr2'], [0x20, 'na']].forEach((x) => { if (fl & x[0]) fn.push(x[1]); });
        const fs = fn.length ? fn.join('|') : '0', ln = ['sin0', 'sin1', 'rmp0', 'rmp1'][lfo];
        if (ty === 3) t = 'cho rdal,' + ln + (fl ? ',' + fs : '');
        else t = 'cho ' + (ty === 0 ? 'rda' : 'sof') + ',' + ln + ',' + fs + ',' + ad;
        break;
      }
      default: t = 'raw $' + w.toString(16).padStart(8, '0');
    }
    out.push(t);
  }
  return out.join('\n') + '\n';
}

function parseIntelHex(text) {
  const bytes = []; let base = 0, maxA = 0;
  const lines = String(text).split(/\r?\n/);
  for (const ln of lines) {
    const l = ln.trim(); if (!l) continue;
    if (l[0] !== ':') throw new Error('Not an Intel HEX file (line starts with "' + l[0] + '")');
    const n = parseInt(l.substr(1, 2), 16), a = parseInt(l.substr(3, 4), 16), t = parseInt(l.substr(7, 2), 16);
    let sum = 0; for (let i = 1; i + 1 < l.length; i += 2) sum += parseInt(l.substr(i, 2), 16);
    if (sum & 255) throw new Error('Bad checksum in HEX file');
    if (t === 0) for (let j = 0; j < n; j++) { const addr = base + a + j; bytes[addr] = parseInt(l.substr(9 + 2 * j, 2), 16); if (addr > maxA) maxA = addr; }
    else if (t === 4) base = parseInt(l.substr(9, 4), 16) << 16;
    else if (t === 2) base = parseInt(l.substr(9, 4), 16) << 4;
    else if (t === 1) break;
  }
  const out = new Uint8Array(maxA + 1).fill(0);
  bytes.forEach((v, i) => { if (v !== undefined) out[i] = v; });
  return out;
}
// bytes -> array of Uint32Array(128) programs (up to 8). Short files are padded with NOPs.
function splitPrograms(bytes) {
  const nprog = Math.min(8, Math.max(1, Math.ceil(bytes.length / 512)));
  const progs = [];
  for (let p = 0; p < nprog; p++) {
    const w = new Uint32Array(128).fill(0x11);
    for (let i = 0; i < 128; i++) {
      const o = p * 512 + i * 4; if (o + 3 >= bytes.length + 3 && o >= bytes.length) break;
      w[i] = (((bytes[o] || 0) << 24) | ((bytes[o + 1] || 0) << 16) | ((bytes[o + 2] || 0) << 8) | (bytes[o + 3] || 0)) >>> 0;
    }
    progs.push(w);
  }
  return progs;
}

const api = { assemble, disassemble, parseIntelHex, splitPrograms, wordsToBytes, buildBankImage, toIntelHex, PROGLEN, DELAYSIZE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.FV1ASM = api;
})(typeof self !== 'undefined' ? self : this);
