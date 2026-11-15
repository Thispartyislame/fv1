# FV-1 Studio

Visual patch editor + emulator + looper + chip programmer for the Spin Semiconductor FV-1 DSP (guitar pedals). Output is one self-contained file, `fv1-studio.html`.

## Layout
- `src/fv1asm.js`   assembler (asfv1-compatible), disassembler, Intel HEX / bank image helpers
- `src/fv1emu.js`   FV-1 emulator (float, runs machine words; used in the AudioWorklet and in Node tests)
- `src/patch.js`    block library (NODE_TYPES), code generator, optimizer, presets, tooltip text
- `src/worklet.js`  AudioWorklet processors (FV-1 + looper)
- `src/app.html`   UI template with markers /*@@EMU@@*/ /*@@WORKLET@@*/ /*@@FV1ASM@@*/ /*@@PATCH@@*/
- `build.js`        inlines everything -> `fv1-studio.html`  (run `node build.js` after every change)
- `fv1-eeprom-programmer.ino`  Arduino sketch for the 24LC32A (serial protocol: '?', 'P', 'R')
- `test/check.js`   pass/fail suite (`npm test`): builds, chip limits, optimizer, disassembler, HEX, emulator, asfv1 cross-check
- `test/ui.js`      Playwright smoke test of the built page (`npm run test:ui`), with a fake serial programmer
- `test/explore/`   older print-only measurement scripts; `test/dump.js`, `cmp.js`, `dis.js`, `opt.js` are manual helpers

## Rules of thumb
- After any change: `node build.js`, then `npm test` (must be 0 failed) and `npm run test:ui`.
- `npm test` cross-checks every generated program word-for-word against the reference assembler when `asfv1` is on PATH
  (`pip install asfv1`); it is skipped otherwise, so install it before touching patch.js or fv1asm.js.
  Hand-written SpinASM-style source (bare `1` / `2` meaning 1.0 / 2.0) needs `asfv1 -s`.
- The optimizer must not change sound (checked by `npm test`). Blocks allocate registers freely; the 32-register limit is
  enforced in `generate()` after sharing.
- `FV1Emu.step()` returns the same array every call; read it before the next step.
- Graphs from files / localStorage go through `FV1PATCH.sanitize()`; keep that when adding load paths.
- Emulator is not bit-exact with silicon. Unverified on hardware: LFO rate-register scaling (rate*/pitch* ctl inputs), ramp-LFO `cho rdal` range (modeled as position/8192: 0..0.5 at amplitude 4096, per the SpinCAD Designer docs), chorus depth (sine swing is modeled as +/- amp/2 samples), Metal Dist voicing (modeled on the described character of a Fromel-modded MT-2, not its circuit).
- Program the EEPROM out of circuit; never while powered in the pedal.

## Ideas not done
Slot-to-slot pot morph (impossible on chip), stereo input handling beyond a channel picker, more blocks (tap tempo, freeze, harmonizer), bit-exact fixed-point emulation.
