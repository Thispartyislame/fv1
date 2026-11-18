# FV-1 Studio

A single-file, offline web app for designing sounds for the Spin Semiconductor **FV-1** DSP chip (guitar pedals).
Wire blocks together, hear the result live through an emulator that runs the real machine code, then put up to
8 programs on a 24LC32A EEPROM.

## Use it

Open `fv1-studio.html` in Chrome or Edge (works straight from `file://`, no server, no internet).

The full [user guide](docs/user-guide.md) covers every block, the looper, the chip bank and the programmer.

1. **Start audio**, then turn on the live input, press **Demo riff**, load a recording, or record a loop.
2. Drag blocks from the left, wire outputs (right dots) to inputs (left dots). Blue = audio, orange = control.
3. On the **Chip** tab, **Store** the patch in one of the 8 slots.
4. **Download .hex / .bin** for a standalone programmer, or write the chip directly with the Arduino programmer.

### Arduino programmer wiring (24LC32A, chip out of the pedal)

| EEPROM pin | Connect to |
|---|---|
| 1, 2, 3 (A0–A2), 4 (VSS), 7 (WP) | GND |
| 5 (SDA) | A4, with a 4.7 k pull-up to VCC |
| 6 (SCL) | A5, with a 4.7 k pull-up to VCC |
| 8 (VCC) | 3.3 V or 5 V (the Arduino's logic level) |

Flash `fv1-eeprom-programmer.ino` to an Uno/Nano, then **Connect programmer** on the Chip tab.
Never program the EEPROM while it sits in a powered pedal: the FV-1 is also an I2C master.

## Known limits

- The emulator is floating point, not bit-exact with the silicon. Assemble the `.spn` in Spin's own SpinASM at
  least once and test the first chip on the bench.
- Not verified on hardware: pot-controlled LFO rate / pitch (`rate*`, `pitch*` inputs), chorus depth scaling,
  ramp-LFO read-back range (modeled as 0–0.5 at amplitude 4096, as documented for SpinCAD Designer).
- Chip limits: 128 instructions, 32 registers, 32768 samples of delay RAM, 3 pots, 2 sine + 2 ramp LFOs.
- The looper is for auditioning only; it is not part of the chip program.

## Develop

Source lives in `src/`; `node build.js` inlines it into `fv1-studio.html` (commit both).

```bash
npm test
```

```bash
npm run test:ui
```

`npm test` needs only Node. It also compares every generated program word-for-word with the reference assembler
when `asfv1` is installed (`pip install asfv1`). `npm run test:ui` needs the `playwright` package; it drives the
built page in Chromium, including a simulated programmer. `test/explore/` holds older measurement scripts that
print numbers rather than pass or fail.
