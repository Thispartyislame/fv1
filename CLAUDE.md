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
- `test/`           node tests; `pw*.js` are Playwright UI tests

## Rules of thumb
- After any change to patch.js or fv1asm.js, cross-check generated code against the reference assembler:
  `pip install asfv1`, `cd test && node dump.js` (writes gen/*.spn), assemble each with asfv1 and run `node cmp.js file.spn file.bin` (expect "ALL 128 WORDS IDENTICAL").
- `node test/opt.js` must show zero diff (optimizer must not change sound). `node test/dis.js` for disassembler round trip.
- Playwright tests hard-code `/opt/npm-tools/node_modules/playwright`, `/usr/bin/google-chrome` and `/home/claude/fv1` paths: edit these for your machine.
- Emulator is not bit-exact with silicon. Unverified on hardware: LFO rate-register scaling (rate*/pitch* ctl inputs), chorus depth (sine swing is modeled as +/- amp/2 samples), Metal Dist voicing (modeled on the described character of a Fromel-modded MT-2, not its circuit).
- Program the EEPROM out of circuit; never while powered in the pedal.

## Ideas not done
Slot-to-slot pot morph (impossible on chip), stereo input handling beyond a channel picker, more blocks (tap tempo, freeze, harmonizer), bit-exact fixed-point emulation.
