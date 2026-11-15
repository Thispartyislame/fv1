/* Pass/fail checks for the assembler, emulator and code generator. Run: npm test  (or: node test/check.js)
 * Exits non-zero on any failure. The asfv1 cross-check runs only when `asfv1` is installed (pip install asfv1). */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const A = require('../src/fv1asm.js'), E = require('../src/fv1emu.js'), P = require('../src/patch.js');
const ROOT = path.resolve(__dirname, '..');

let failed = 0, passed = 0;
function check(name, fn) {
  try { const note = fn(); passed++; console.log('ok    ' + name + (note ? '  (' + note + ')' : '')); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').join('\n      ')); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const N = (id, type, p) => ({ id, type, x: 0, y: 0, p: Object.assign(P.defaultParams(type), p || {}) });

function build(graph, opts) {
  const g = P.generate(graph, opts);
  must(!g.errors.length, 'generate: ' + g.errors.join('; '));
  const r = A.assemble(g.asm);
  must(!r.errors.length, 'assemble: line ' + (r.errors[0] || {}).line + ': ' + (r.errors[0] || {}).msg);
  return { g, r };
}
function run(words, n, inFn, pots) {
  const e = new E(32000); e.load(words);
  const L = new Float64Array(n), R = new Float64Array(n);
  pots = pots || [0.5, 0.5, 0.5];
  for (let i = 0; i < n; i++) {
    e.reg[0x10] = pots[0]; e.reg[0x11] = pots[1]; e.reg[0x12] = pots[2];
    const x = inFn(i), o = e.step(x, x); L[i] = o[0]; R[i] = o[1];
  }
  return { L, R };
}
const guitar = (i) => 0.25 * Math.sin(2 * Math.PI * 220 * i / 32000) * (1 + Math.sin(i / 9000)) + 0.02 * Math.sin(i * 1.7);
const rms = (a, s, t) => { let q = 0; for (let i = s; i < t; i++) q += a[i] * a[i]; return Math.sqrt(q / (t - s)); };

// A graph with every block type in awkward configurations (also used for the asfv1 cross-check)
const STRESS = {
  nodes: [N('i', 'input'), N('d', 'drive', { gain: 30, bias: 0.2 }), N('f', 'filter', { mode: 1, order: 1, hz: 300 }), N('c', 'chorus', { fb: 0.5, rate: 3 }), N('l', 'lfo'), N('s', 'smooth'),
    N('m', 'mixer'), N('x', 'xfade'), N('dl', 'delay', { damp: 15000 }), N('g', 'gain', { gain: 0.5 }), N('o', 'output'), N('p', 'pot', { pot: 1 })],
  edges: [{ a: 'i.l', b: 'd.in' }, { a: 'd.out', b: 'f.in' }, { a: 'f.out', b: 'c.in' }, { a: 'c.out', b: 'm.a' }, { a: 'i.r', b: 'm.b' }, { a: 'f.out', b: 'm.c' }, { a: 'm.out', b: 'dl.in' },
    { a: 'p.out', b: 's.in' }, { a: 's.out', b: 'dl.time' }, { a: 'l.out', b: 'f.freq' }, { a: 'dl.out', b: 'x.b' }, { a: 'm.out', b: 'x.a' }, { a: 'l.out', b: 'x.ctl' }, { a: 'x.out', b: 'g.in' },
    { a: 's.out', b: 'g.ctl' }, { a: 'g.out', b: 'o.l' }, { a: 'dl.out', b: 'o.r' }],
};
const single = (type, p, ctl) => {                       // input -> block -> output, optional control source on a port
  const def = P.NODE_TYPES[type], g = { nodes: [N('i', 'input'), N('b', type, p), N('o', 'output')], edges: [] };
  const ain = def.inputs.find((x) => x.kind === 'audio'), aout = def.outputs.find((x) => x.kind === 'audio');
  if (ain) g.edges.push({ a: 'i.l', b: 'b.' + ain.id });
  if (aout) g.edges.push({ a: 'b.' + aout.id, b: 'o.l' });
  else { g.nodes.push(N('v', 'gain')); g.edges.push({ a: 'i.l', b: 'v.in' }, { a: 'b.' + def.outputs[0].id, b: 'v.ctl' }, { a: 'v.out', b: 'o.l' }); }
  if (ctl) { g.nodes.push(N('k', 'pot')); def.inputs.filter((x) => x.kind === 'ctl').forEach((x) => g.edges.push({ a: 'k.out', b: 'b.' + x.id })); }
  return g;
};
const GRAPHS = Object.assign({ 'stress (all basic blocks)': STRESS }, P.PRESETS);
Object.keys(P.NODE_TYPES).filter((t) => t !== 'input' && t !== 'output').forEach((t) => {
  GRAPHS['block ' + t] = single(t); GRAPHS['block ' + t + ' + pots'] = single(t, null, true);
});

check('every preset and block builds, fits the chip and stays finite', () => {
  for (const [name, graph] of Object.entries(GRAPHS)) {
    let b; try { b = build(graph); } catch (e) { throw new Error(name + ': ' + e.message); }
    must(b.r.ninstr <= 128 && b.r.memUsed <= 32768 && b.g.stats.regs <= 32, name + ': over a chip limit');
    must(!b.r.warnings.length, name + ': assembler warning: ' + (b.r.warnings[0] || {}).msg);
    const o = run(b.r.words, 48000, guitar);
    for (let i = 0; i < o.L.length; i++) must(Number.isFinite(o.L[i]) && Number.isFinite(o.R[i]), name + ': non-finite output');
  }
  return Object.keys(GRAPHS).length + ' graphs';
});

check('generated code is deterministic', () => {
  for (const [name, graph] of Object.entries(GRAPHS)) must(P.generate(graph).asm === P.generate(graph).asm, name + ' differs between runs');
});

check('optimizer does not change the sound', () => {
  let saved = 0;
  for (const [name, graph] of Object.entries(GRAPHS)) {
    const a = build(graph, { optimize: true }), b = build(graph, { optimize: false });
    const x = run(a.r.words, 48000, guitar, [0.6, 0.4, 0.7]), y = run(b.r.words, 48000, guitar, [0.6, 0.4, 0.7]);
    let d = 0; for (let i = 0; i < x.L.length; i++) d = Math.max(d, Math.abs(x.L[i] - y.L[i]), Math.abs(x.R[i] - y.R[i]));
    must(d === 0, name + ': max difference ' + d);
    must(a.r.ninstr <= b.r.ninstr, name + ': optimizer made the program longer');
    saved += b.r.ninstr - a.r.ninstr;
  }
  return saved + ' instructions saved in total';
});

check('register limit is applied after sharing', () => {
  const big = { nodes: [N('i', 'input'), N('o', 'output')], edges: [] };
  let prev = 'i.l';
  for (let k = 0; k < 40; k++) { big.nodes.push(N('g' + k, 'gain', { gain: 0.9 })); big.edges.push({ a: prev, b: 'g' + k + '.in' }); prev = 'g' + k + '.out'; }
  big.edges.push({ a: prev, b: 'o.l' });
  const g = P.generate(big);                              // 40 block outputs are level-tapped, so they cannot be shared
  must(g.errors.length === 1 && /needs 40/.test(g.errors[0]), 'expected a clear out-of-registers error, got ' + JSON.stringify(g.errors));
});

check('disassembler round-trips every program', () => {
  const srcs = Object.entries(GRAPHS).map(([k, g]) => [k, P.generate(g).asm]);
  srcs.push(['t1.spn', fs.readFileSync(path.join(__dirname, 't1.spn'), 'utf8')]);
  for (const [name, asm] of srcs) {
    const r = A.assemble(asm), d = A.disassemble(r.words, { header: 'x' }), r2 = A.assemble(d);
    must(!r2.errors.length, name + ': disassembly does not assemble: ' + JSON.stringify(r2.errors[0]));
    for (let i = 0; i < 128; i++) must(r.words[i] === r2.words[i], name + ': word ' + i + ' differs');
  }
  must(A.disassemble(new Uint32Array(128).fill(0x11), { header: 'Hello' }).startsWith('; Hello\n'), 'header option ignored');
  return srcs.length + ' programs';
});

check('Intel HEX and bank image round-trip', () => {
  const progs = Object.values(P.PRESETS).slice(0, 8).map((g) => build(g).r.words);
  const img = A.buildBankImage(progs);
  must(img.length === 4096, 'image size');
  const back = A.parseIntelHex(A.toIntelHex(img));
  must(back.length === 4096 && back.every((b, i) => b === img[i]), 'hex round trip changed bytes');
  const split = A.splitPrograms(back);
  must(split.length === 8 && split.every((w, s) => w.every((x, i) => x === progs[s][i])), 'programs differ after split');
  must(A.splitPrograms(img.slice(0, 700)).length === 2, 'short image handling');
});

check('assembler matches the stored reference binary (t1.spn -> t1.bin)', () => {
  const r = A.assemble(fs.readFileSync(path.join(__dirname, 't1.spn'), 'utf8')), ref = fs.readFileSync(path.join(__dirname, 't1.bin'));
  must(!r.errors.length && ref.length === 512, 'setup');
  for (let i = 0; i < 128; i++) must(ref.readUInt32BE(i * 4) === r.words[i], 'word ' + i + ' differs');
});

check('assembler reports errors instead of emitting bad code', () => {
  const bad = { 'rdax reg99,1.0': /out of range|Undefined/i, 'skp run,nowhere': /Undefined skip target/, 'bogus 1,2': /Unexpected/, 'mem big 40000\nmem more 10': /exhausted|clamped/i };
  for (const [src, re] of Object.entries(bad)) { const r = A.assemble(src); must(r.errors.length + r.warnings.length > 0 && re.test(JSON.stringify(r.errors.concat(r.warnings))), 'no diagnostic for: ' + src); }
  must(A.assemble(new Array(129).fill('clr').join('\n')).errors.length === 1, '129 instructions must be an error');
});

check('noise gate closed level equals the "Closed level" setting', () => {
  for (const floor of [0, 0.1, 0.3]) {
    const b = build(single('gate', { thr: 0.05, floor }));
    const o = run(b.r.words, 64000, (i) => 0.01 * Math.sin(2 * Math.PI * 220 * i / 32000));
    const gain = rms(o.L, 48000, 64000) / (0.01 / Math.SQRT2);
    must(Math.abs(gain - floor) < 0.01, 'floor ' + floor + ' gives gain ' + gain.toFixed(3));
    const open = run(b.r.words, 64000, (i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / 32000));
    must(rms(open.L, 48000, 64000) / (0.4 / Math.SQRT2) > 0.95, 'gate does not open fully at floor ' + floor);
  }
});

check('LFO shapes cover exactly Low..High at the set rate', () => {
  for (const shape of [0, 1, 2, 3, 4]) for (const [low, high] of [[0, 1], [0.2, 0.7]]) {
    const b = build(single('lfo', { shape, rate: 5, low, high }));
    const o = run(b.r.words, 64000, () => 0.5);
    let mn = 9, mx = -9, cross = 0; const mid = (low + high) / 2;
    for (let i = 200; i < 64000; i++) { const y = o.L[i] / 0.5; mn = Math.min(mn, y); mx = Math.max(mx, y); if (o.L[i - 1] / 0.5 < mid && y >= mid) cross++; }
    must(Math.abs(mn - low) < 0.02 && Math.abs(mx - high) < 0.02, 'shape ' + shape + ' range ' + mn.toFixed(3) + '..' + mx.toFixed(3) + ', wanted ' + low + '..' + high);
    must(Math.abs(cross / 2 - 5) <= 0.5, 'shape ' + shape + ' rate ' + cross / 2 + ' Hz, wanted 5');
  }
});

check('emulator: ramp and sine LFO read-back ranges', () => {
  const peak = (src) => { const r = A.assemble(src); must(!r.errors.length, JSON.stringify(r.errors)); const o = run(r.words, 32000, () => 0); let mn = 9, mx = -9; for (const v of o.L) { mn = Math.min(mn, v); mx = Math.max(mx, v); } return [mn, mx]; };
  const amps = { 4096: 0.5, 2048: 0.25, 1024: 0.125, 512: 0.0625 };
  for (const [amp, top] of Object.entries(amps)) {
    const [mn, mx] = peak('skp run,go\nwldr rmp0,2000,' + amp + '\ngo:\ncho rdal,rmp0\nwrax dacl,0');
    must(mn >= 0 && Math.abs(mx - top) < top * 0.02, 'ramp ' + amp + ' reads ' + mn + '..' + mx + ', wanted 0..' + top);
  }
  const [smn, smx] = peak('skp run,go\nwlds sin0,200,16384\ngo:\ncho rdal,sin0\nwrax dacl,0');
  must(Math.abs(smx - 0.5) < 0.01 && Math.abs(smn + 0.5) < 0.01, 'sine at half amplitude reads ' + smn + '..' + smx);
  const [zmn, zmx] = peak('skp run,go\nwlds sin0,200,32767\ngo:\nclr\nwrax sin0_rate,0\ncho rdal,sin0\nwrax dacl,0');
  must(zmx - zmn < 1e-9, 'writing 0 to SIN0_RATE must stop the LFO');
});

check('emulator: delay line timing and saturation', () => {
  const r = A.assemble('mem d 1000\nrdax adcl,1.0\nwra d,0\nrda d#,1.0\nwrax dacl,0\nrdax adcl,1.99\nsof 1.99,0\nwrax dacr,0');
  const o = run(r.words, 3000, (i) => (i === 10 ? 0.5 : 0));
  let at = -1; for (let i = 0; i < 3000; i++) if (Math.abs(o.L[i]) > 0.1) { must(at < 0, 'more than one echo'); at = i; }
  must(at === 1010, 'echo arrived at sample ' + at + ', wanted 1010');
  const s = run(r.words, 100, () => 0.9);
  must(s.R[50] > 0.9999 && s.R[50] < 1, 'accumulator must saturate just below 1.0, got ' + s.R[50]);
});

check('emulator: step() does not allocate per sample and ignores NOP padding', () => {
  const e = new E(32000); e.load(build(P.PRESETS.Echo).r.words);
  must(e.step(0, 0) === e.step(0, 0), 'step() should return the same output array');
  must(e.prog.length < 128, 'trailing NOPs should not be executed');
});

check('sanitize(): presets pass through unchanged, junk is dropped', () => {
  for (const [name, g] of Object.entries(P.PRESETS)) must(JSON.stringify(P.sanitize(g)) === JSON.stringify(g), name + ' was altered');
  const dirty = {
    nodes: [N('a', 'input'), N('a', 'gain'), { id: 'b', type: 'nonsense', x: 1, y: 1, p: {} }, { id: 'c', type: 'delay', p: { time: 99999, fb: 'x' } }, N('o', 'output'), N('o2', 'output'), null, N('x.y', 'gain')],
    edges: [{ a: 'a.l', b: 'c.in' }, { a: 'a.r', b: 'c.in' }, { a: 'c.out', b: 'o.l' }, { a: 'c.nope', b: 'o.r' }, { a: 'zz.out', b: 'o.r' }, { a: 'c.out', b: 'c.in' }, null],
  };
  const s = P.sanitize(dirty);
  must(s.nodes.map((n) => n.id).join() === 'a,c,o', 'kept nodes: ' + s.nodes.map((n) => n.id).join());
  must(s.edges.length === 2, 'kept ' + s.edges.length + ' edges');
  const c = s.nodes[1]; must(c.p.time === 900 && c.p.fb === 0.45 && c.x === 0 && c.y === 0, 'settings not repaired: ' + JSON.stringify(c));
  must(P.sanitize(null).nodes.length === 0 && !P.generate(s).errors.length, 'sanitized graph should generate');
});

check('fv1-studio.html is up to date with src/ (run "node build.js")', () => {
  const out = path.join(ROOT, 'fv1-studio.html'), before = fs.readFileSync(out, 'utf8');
  cp.execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'pipe' });
  const same = fs.readFileSync(out, 'utf8') === before;
  must(same, 'the built file was stale; it has just been rebuilt');
});

check('word-for-word match with the asfv1 reference assembler', () => {
  let has = true; try { cp.execFileSync('asfv1', ['-v'], { stdio: 'pipe' }); } catch (e) { has = false; }
  if (!has) return 'SKIPPED: asfv1 not installed (pip install asfv1)';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv1-')); let n = 0;
  const srcs = Object.entries(GRAPHS).map(([k, g]) => [k, P.generate(g).asm, []]);
  srcs.push(['t1.spn', fs.readFileSync(path.join(__dirname, 't1.spn'), 'utf8'), ['-s']]);   // SpinASM-style source: bare 1 and 2 are reals
  try {
    for (const [name, asm, flags] of srcs) {
      const spn = path.join(tmp, 'p.spn'), bin = path.join(tmp, 'p.bin');
      fs.writeFileSync(spn, asm);
      try { cp.execFileSync('asfv1', ['-q', '-b'].concat(flags, [spn, bin]), { stdio: 'pipe' }); } catch (e) { throw new Error(name + ': asfv1 rejected the code: ' + String(e.stderr || e.message).trim()); }
      const ref = fs.readFileSync(bin), mine = A.assemble(asm).words;
      for (let i = 0; i < 128; i++) must(ref.readUInt32BE(i * 4) === mine[i], name + ': word ' + i + ' asfv1=' + ref.readUInt32BE(i * 4).toString(16) + ' ours=' + mine[i].toString(16));
      n++;
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return n + ' programs identical';
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
