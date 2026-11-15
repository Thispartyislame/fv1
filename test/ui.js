/* Browser smoke test of the built fv1-studio.html, opened from file:// like a user would.
 * Run: npm run test:ui   (needs the `playwright` package and a Chromium it can launch).
 * The Arduino programmer is replaced by an in-page fake that speaks the same serial protocol. */
const path = require('path');
const { chromium } = require('playwright');
const A = require('../src/fv1asm.js'), P = require('../src/patch.js');
const PAGE = 'file://' + path.resolve(__dirname, '..', 'fv1-studio.html');

let failed = 0;
const ok = (cond, name, detail) => { if (cond) console.log('ok    ' + name); else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')); } };

function fakeProgrammer() {                               // runs in the page before the app's own scripts
  const eeprom = new Uint8Array(4096).fill(0xff); let ctl, pending = [];
  const reply = (bytes) => ctl.enqueue(Uint8Array.from(bytes));
  const pump = () => {
    for (;;) {
      const c = pending[0];
      if (c === undefined) return;
      if (c === 63) { pending.shift(); reply([...'FV1PROG1Y'].map((ch) => ch.charCodeAt(0))); }
      else if (c === 80) { if (pending.length < 19) return; const a = (pending[1] << 8) | pending[2]; eeprom.set(pending.slice(3, 19), a); pending = pending.slice(19); reply([75]); }
      else if (c === 82) { if (pending.length < 4) return; const a = (pending[1] << 8) | pending[2], n = pending[3]; pending = pending.slice(4); reply([...eeprom.slice(a, a + n), 75]); }
      else pending.shift();
    }
  };
  const port = {
    open: async () => {}, close: async () => {},
    readable: new ReadableStream({ start(c) { ctl = c; } }),
    writable: new WritableStream({ write(chunk) { pending.push(...chunk); pump(); } }),
  };
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port }, configurable: true });
  window.__eeprom = eeprom;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['microphone'] });
  await ctx.addInitScript(fakeProgrammer);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const text = (sel) => page.textContent(sel);
  const nodes = () => page.$$eval('.node', (n) => n.length);

  await page.goto(PAGE); await page.waitForTimeout(300);
  ok(await nodes() > 0 && +(await text('#sI')) > 0 && !(await text('#errs')), 'page loads with a working default patch');

  let bad = [];
  for (const name of Object.keys(P.PRESETS)) {
    await page.selectOption('#preset', name); await page.waitForTimeout(120);
    const n = +(await text('#sI')), cables = await page.$$eval('#cables path:not(.hit)', (p) => p.length);
    const overlaps = await page.$$eval('.node', (els) => { const b = els.map((e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]); let k = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i][0] < b[j][0] + b[j][2] && b[j][0] < b[i][0] + b[i][2] && b[i][1] < b[j][1] + b[j][3] && b[j][1] < b[i][1] + b[i][3]) k++; return k; });
    if ((await text('#errs')) || n < 1 || n > 128 || cables !== P.PRESETS[name].edges.length || overlaps) bad.push(name);
  }
  ok(!bad.length, 'every preset loads, draws its cables without overlapping blocks, and assembles', bad.join(', '));

  await page.selectOption('#preset', 'Echo'); await page.waitForTimeout(120);
  await page.evaluate(() => Promise.all([window.__fv1.startAudio(), window.__fv1.startAudio()]));
  await page.click('#btnDemo'); await page.waitForTimeout(1200);
  const mOut = await page.$eval('#mOut', (e) => parseFloat(e.style.width) || 0);
  ok((await text('#btnPower')) === 'Audio running' && /playing/.test(await text('#loopState')) && mOut > 5, 'audio starts and the demo riff reaches the output meter', 'meter ' + mOut + '%, ' + (await text('#statMsg')));
  const lvl = await page.$$eval('.node .lvl i', (els) => els.filter((e) => parseFloat(e.style.width) > 0).length);
  ok(lvl > 0, 'per-block level meters move');

  await page.click('#btnMic'); await page.waitForTimeout(700);
  ok((await text('#btnMic')) === 'Turn off' && /ch · in1/.test(await text('#inStat')), 'live input turns on', await text('#statMsg'));
  await page.click('#btnMic');

  const n0 = await nodes();
  await page.click('#palette button[data-type="drive"]'); await page.waitForTimeout(600);
  const n1 = await nodes(); await page.click('#btnUndo2'); await page.waitForTimeout(150);
  const n2 = await nodes(); await page.click('#btnRedo2'); await page.waitForTimeout(150);
  ok(n1 === n0 + 1 && n2 === n0 && (await nodes()) === n1, 'add block, undo, redo', [n0, n1, n2].join(' '));
  await page.click('#btnUndo2'); await page.waitForTimeout(150);

  await page.click('#btnHand'); await page.fill('#code', 'rdax adcl,0.5\nwrax dacl,0\nbogus'); await page.waitForTimeout(150);
  const e1 = await text('#errs');
  await page.fill('#code', 'rdax adcl,0.5\nwrax dacl,0'); await page.waitForTimeout(150);
  ok(/line 3/.test(e1) && !(await text('#errs')) && (await text('#sI')) === '2', 'hand-edited code: errors are reported with a line number, good code assembles', e1);
  await page.click('#btnHand'); await page.waitForTimeout(150);

  await page.click('.tabs button[data-tab="chip"]');
  await page.click('#slots .slot:nth-child(1) .acts button'); await page.waitForTimeout(150);
  ok(/^1 of 8 slots used/.test(await text('#bankInfo')), 'store the patch in slot 1', await text('#bankInfo'));

  await page.click('#btnSerial');
  await page.waitForFunction(() => !document.querySelector('#btnWrite').disabled, null, { timeout: 8000 }).catch(() => {});
  const enabled = await page.$$eval('#btnWrite,#btnVerify,#btnRead,#btnReadBank', (b) => b.map((x) => !x.disabled));
  ok(enabled.every(Boolean), 'programmer connects and all four chip buttons are enabled', enabled.join(' ') + '\n      ' + (await text('#log')));
  await page.click('#btnWrite');
  await page.waitForFunction(() => /Chip matches|FAILED|Error/.test(document.querySelector('#log').textContent), null, { timeout: 20000 }).catch(() => {});
  const want = Array.from(A.buildBankImage([A.assemble(P.generate(P.PRESETS.Echo).asm).words]));
  const got = await page.evaluate(() => Array.from(window.__eeprom));
  ok(/Chip matches the bank image/.test(await text('#log')) && got.length === 4096 && got.every((b, i) => b === want[i]), 'write bank: the chip holds exactly the bank image', (await text('#log')).slice(-200));
  await page.click('#btnReadBank');
  await page.waitForFunction(() => /Imported 1 program/.test(document.querySelector('#statMsg').textContent), null, { timeout: 20000 }).catch(() => {});
  ok(/Imported 1 program/.test(await text('#statMsg')) && /^; Imported from the chip, program 1/.test(await page.inputValue('#code')), 'read chip → bank imports the program as code', await text('#statMsg'));
  const reasm = await page.evaluate(() => Array.from(window.__fv1.last.r.words));
  ok(reasm.every((w, i) => w === A.assemble(P.generate(P.PRESETS.Echo).asm).words[i]), 'imported code assembles to the same machine words');

  await page.reload(); await page.waitForTimeout(300);
  ok(/^1 of 8 slots used/.test(await text('#bankInfo')) && (await text('#btnHand')) === 'Back to graph', 'bank and hand-edit state survive a reload');
  await page.click('#btnHand');

  const junk = { graph: { nodes: [{ id: 'n1', type: 'input', x: 10, y: 10, p: {} }, { id: 'n2', type: 'from-the-future', x: 200, y: 10, p: {} }, { id: 'n3', type: 'delay', x: 200, y: 200, p: { time: 1e9 } }, { id: 'n4', type: 'output', x: 500, y: 10, p: {} }],
    edges: [{ a: 'n1.l', b: 'n2.in' }, { a: 'n1.l', b: 'n3.in' }, { a: 'n3.out', b: 'n4.l' }, { a: 'n2.out', b: 'n4.r' }] } };
  await page.setInputFiles('#filePatch', { name: 'odd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(junk)) });
  await page.waitForTimeout(300);
  ok((await nodes()) === 3 && !(await text('#errs')) && +(await text('#sI')) > 3, 'a patch file with unknown blocks and bad values still opens', (await text('#errs')) + ' nodes ' + (await nodes()));

  ok(!problems.length, 'no page errors or console errors', problems.join('\n      '));
  await browser.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall UI checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
