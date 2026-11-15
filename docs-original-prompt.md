# Prompt: build "FV-1 Studio"

I'm a guitar-pedal builder. I want you to build **FV-1 Studio**: a single-file, offline web app for designing sounds for the Spin Semiconductor **FV-1** DSP chip by wiring blocks together visually, hearing the result live, and then putting the program on a chip for a real pedal. Build the whole thing, test it properly, and hand me something I can use without a second round of fixes. Take as long as you need; I'd rather have it right than fast.

## How I will use it
- Open `fv1-studio.html` in Chrome or Edge on a laptop (about 1366×768), including straight from `file://`, with no server and no internet after load.
- Plug my guitar in through a USB audio interface (often a 2-channel one with the guitar on input 1 *or* input 2) or load a recording, loop it, and tweak patches while it plays.
- Save patches into the 8 program slots a pedal's EEPROM holds, then program a 24LC32A with an Arduino from the browser, or export `.hex` / `.bin` for a standalone programmer.

## Deliverables
1. `fv1-studio.html`: one self-contained file (inline JS and CSS, no CDN, no build step needed to run it). Keep the source in modules plus a small `build.js` that inlines them.
2. `fv1-eeprom-programmer.ino`: an Arduino sketch (Uno/Nano) that writes and reads the EEPROM over serial (protocol below).
3. A `test/` folder with the automated tests described under "Verification".
4. A short README: wiring, workflow, known limits.

## Core features (all required)
**Visual patch editor.** Node-and-cable canvas, with SVG cables drawn between audio and control ports. Palette of blocks, drag to place, drag from an output dot to an input dot to connect, click a cable to delete it. Blocks have parameter sliders and selects. The editor generates FV-1 assembly (SpinASM) live as the graph changes, shown in a Code tab with a stats footer: instructions used out of 128, delay RAM used out of 32768 samples, and registers used out of 32.

**Blocks.**
- Signal: Input L/R, Output L/R.
- Controls: Pot (POT0–2, with taper and min/max), LFO (sine, triangle, square, soft square, saw; rate-controllable), Smooth.
- Time/pitch effects: Delay (feedback, damping, time control), Reverb (stereo, plate-style), Chorus/flanger/vibrato, Pitch shifter (two crossfaded ramp-LFO read heads, semitones and cents, window size, optional pot sweep), Phaser (2/4/6 stages), Ring modulator (audio-rate oscillator, optional freq control), Bit crusher (AND-mask quantiser).
- Dynamics and filters: Envelope follower, Noise gate, Compressor (LOG/EXP gain computer), Resonant state-variable filter (LP/BP/HP/notch, min and max frequency, wah-style squared control curve), simple 1/2-pole filter.
- Gain: Gain/VCA with a control input, Mixer, Dry/Wet crossfade.
- Distortion: Overdrive, and a **Metal Zone-style high-gain block voiced like a Fromel Electronics modded MT-2**: more gain, smooth amp-like clipping, tight low end, tamed fizzy highs and harsh mids, usable 3-band EQ with a sweepable mid (pot-controllable), input boost, level.
- Presets for everything: clean, echo, plate reverb, chorus, octave up, whammy (POT0 = pitch), auto-wah, wah (POT0 = pedal), phaser, compressor + gate, metal, ring mod, lo-fi crusher, tremolo, square tremolo, overdrive. **Every preset must be fully wired with no stray nodes, and must expose useful pots wherever a control input exists. Presets must be laid out so every block is visible without scrolling.**

**Audio engine.**
- An FV-1 emulator running in an AudioWorklet at **32 kHz** (`new AudioContext({sampleRate: 32000})`), executing the *assembled machine words*, not a separate model of the graph. That way what I hear is what the chip will run.
- Live input through `getUserMedia` with echoCancellation, noiseSuppression and autoGainControl all **off**. Request up to 2 channels and provide a channel selector (Auto / Input 1 / Input 2 / Both). Auto picks the louder channel. Provide a trim control in dB and an input meter. Show a status line with channel count and per-channel level, and warn clearly if the signal is very quiet or absent. Guitar signals through interfaces are often −30 dBFS, so **every level-dependent block (gate, compressor, envelope, metal) must work well with low-level input**. Test at peaks of 0.02, 0.08 and 0.3.
- Built-in looper (up to 60 s): record, play, overdub, undo, clear, load an audio file (decode and resample), input/loop monitoring toggles. The looper feeds the FV-1 emulator, so loops are heard through the patch.
- Three pot sliders feeding POT0–2 with smoothing, bypass, output volume, and input/output peak meters with a clip indicator.
- AudioWorklet loading must work from `file://`: try a Blob URL and fall back to a `data:` URL.
- Offline "Render WAV" of the current loop through the current patch (plus a 3 s tail).
- Short-crossfade "Audition" of any bank slot, like flipping the pedal's program switch.

**Chip workflow.**
- Bank of 8 slots (stored in localStorage): store, load, rename, clear, audition.
- Export `.hex` (Intel HEX) and `.bin` (4096 bytes = 8×512 B), and per-slot `.spn`.
- Web Serial writer, verifier and reader for the Arduino sketch. Protocol at 115200 8N1: `'?'` returns `"FV1PROG1"` plus `'Y'`/`'N'` (chip present); `'P' addrHi addrLo` plus 16 bytes returns `'K'`/`'E'` (16-byte page writes, ACK-polled); `'R' addrHi addrLo n` returns n bytes plus `'K'`/`'E'`. EEPROM is a 24LC32A at I²C 0x50, with programs selected by S0–S2 on the pedal. Warn me not to program the chip while it is powered in the pedal.
- **Import**: SpinASM (`.spn`/`.asm`/`.txt`), Intel HEX or raw `.bin` chip images, and "read chip into bank". For binary input, write a disassembler that produces SpinASM that reassembles to identical words (round-trip tested).

**Editing quality.**
- Hand-edit mode (edit the generated code directly with live assembly errors), patch save/open as JSON, undo/redo (Ctrl+Z / Ctrl+Y), A/B compare of two patch versions, "Fit view" plus automatic fit on load and Ctrl+wheel zoom.
- A code optimizer (peephole plus register sharing) that must not change the sound.
- Per-block output level bars that turn red at the chip's limit.
- Hover tooltips on every port, parameter and block explaining what it does and, for ports, **exactly what should be dropped there**. While dragging a cable, highlight valid drop targets (green for matching audio/control type, amber for mismatch) and show a hint such as "Drop on an INPUT dot (left side of a block)".
- Help tab, a knob-legend export (which pot does what in each slot), and clear error messages (for example for a cable loop or running out of instructions, RAM or registers).

## Technical facts you must get right (I already hit these)
- FV-1: 128 instructions per sample at 32 kHz, 32 registers (REG0–31), 32768 words of delay RAM, 24-bit saturating accumulator, 3 pots, 2 sine LFOs, 2 ramp LFOs, ADCL/ADCR in, DACL/DACR out.
- Fixed-point formats: coefficients S1.14 (RDAX, WRAX, MULX-style multipliers, SOF multiplier), S1.9 for RDA/WRA/RMPA multipliers, S.10 for SOF/LOG/EXP offsets, S.15 for addresses. Follow the **asfv1** conventions (the standard open-source assembler): integers mean raw bits and real numbers are scaled.
- `mem name size`: allocate delay RAM in order; `name#` is the end and `name^` the midpoint. Delay memory is circular with a decrementing write pointer.
- Sine LFO: `Kf = f·2π·2¹⁷ / fs`, max 511 (about 19.9 Hz). Verify the swing convention (±amp/2 samples against SpinCAD's simulator) and note any residual uncertainty. Ramp LFOs (`WLDR`, `CHO RDA` with `RPTR2`, `NA`, `COMPC`) are used for pitch shifting. The crossfade between the two heads must be done with the `NA` window.
- Allpass idiom `rda ap#,k` then `wrap ap,-k`; one-pole low-pass `rdax in,1` / `rdfx lp,f` / `wrax lp,0`. Using `wrax r,0` leaves ACC zeroed after each node. Saturation of ACC at ±1 gives hard clipping, so build soft clippers deliberately.
- Cables must not form feedback loops (use delay feedback instead). The code generator should detect this and say so.

## Verification (do not skip; this is how I'll judge the result)
1. **Assembler correctness:** `pip install asfv1`. For every preset plus a stress patch that exercises every block, generate SpinASM, assemble it with both your assembler and `asfv1`, and require **128/128 identical machine words**. Do the same for a broad instruction test file covering every opcode, flag, condition and pseudo-op.
2. **Disassembler:** round-trip every generated program and a full 8-slot HEX image (bytes in, asm out, bytes identical).
3. **Optimizer:** emulator output with and without optimization must be identical on every preset.
4. **Audio behavior** (headless emulator tests): spectral checks for pitch shift (peaks at the expected ratios), ring mod (sum and difference tones), chorus delay modulation depth, gate closing, compressor ratio, filter response, and level sweeps (0.02 / 0.08 / 0.3 peak) showing no preset collapses or blows up at realistic guitar levels.
5. **UI tests with Playwright** (Chromium or Chrome is installed): every preset loads with zero errors, all cables drawn, no node off-screen at 1366×768, drag-to-connect works at zoom, tooltips show, undo/redo, A/B, import/export, a mock serial EEPROM exercising write, verify and read, fake-microphone input (`--use-fake-device-for-media-stream`), Render WAV, and no page errors on `file://`.
6. Look at screenshots of the finished UI yourself and fix anything cramped, overlapping or ugly.

## Design and UX
Make it look like professional audio gear software: dark theme, clear colour-coding (audio blue, control orange), readable type, cables that are easy to follow. Nothing should require a mouse-hover to discover its existence. The three most important things (input meter and channel status, looper transport, and the Chip/bank tab) must be obvious within five seconds of opening.

## Honesty
The emulator is floating-point and not bit-exact with the silicon. Say so in the Help tab and README. Mark any behavior you could not verify against hardware or a reference (for example LFO rate-register scaling) in the code comments and README, and tell me at the end exactly which parts are verified and which are modeled. Don't claim anything works that you haven't run.

## How to work
Plan first. Then build in stages: assembler and emulator and tests, then the block library, then the audio engine, then the UI, then the chip workflow, then polish. Run the verification at each stage rather than at the end. When done, give me a concise summary of what's in the box and what to check on the bench before I trust a chip in a pedal.
