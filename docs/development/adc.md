# Normal ADC conversion

`src/adc.c` implements an original functional normal-mode S3C2410A ADC.
The source is the Samsung manual, chapter 16 (especially 16-4 through 16-11)
and interrupt-controller section 14-17. It is not a battery-voltage simulator
or a touch-panel implementation.

## Registers and conversion

ADCCON, ADCTSC and ADCDLY reset to `3fc4`, `58` and `ff`. Normal-mode
ADCCON writes select AIN0..7, the prescaler, standby and start/read-start.
ENABLE_START self-clears; ECFLG is read-only and becomes set only after a
conversion finishes. The normal conversion takes five ADC clocks, each
consuming either one provisional PCLK quantum or `PRSCVL+1` quanta when the
prescaler is enabled. This is functional scheduling, not a measured PLL,
clock-gating or analog settling model.

The selected explicit sample is held at start. Later changes to an input do
not change that in-flight conversion. Completion updates the 10-bit DAT0
value and pends SUBSRCPND bit 10; existing sub/main interrupt masks and
arbitration determine whether the CPU receives interrupt 31. Reading data
does not acknowledge that interrupt.

Standby pauses a held conversion and retains the previous result. READ_START
returns the previous completed sample and starts a new conversion. Conversion
data before the first completed sample is unresolved, not silently zero. Thus
this implementation does not support a cold READ_START-only bootstrap without
a preceding valid result. DAT1/touch status, touchscreen modes, overlapping
starts, live mux/clock changes during conversion, and undocumented accesses
remain explicit stops. ADCDLY is stored and checked nonzero but is not added
to normal-ADC conversion time: it controls touch-position sequencing.

The inactive upper DAT0 flags are represented as zero in normal mode; their
electrical values outside the documented normal-result bits have not been
measured. Byte/halfword MMIO and data-register writes are unsupported. Invalid
or missing-input starts do not partially replace the current configuration.
The divider's startup phase is a deterministic convention, not a timing claim.

## Inputs are explicit conditions

```sh
./build/orchard run --model hp48gii --rom /private/48gii.bin \
  --ticks 10000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0 --gpio-input G:1:0 --gpio-bias G:f800:f800 \
  --lcd-probe68 idle-zero --adc-input 7:512
```

The CLI accepts decimal `CHANNEL:CODE`, once per channel, where channel is
0..7 and code is 0..1023. This is an ideal quantized sample, **not volts**.
No channel is connected automatically. Sampling an unspecified channel stops
with `ORCHARD_UNRESOLVED_ANALOG`, including the channel number. The native
API is `orchard_adc_input(machine, channel, known, code)`; the WASM export is
`adc_input(channel, known, code)`. Releasing an input uses `known=false, code=0`.
Cold reset releases every ADC input and invalidates previous conversion data.

Probe v6 (extending v5 with USB diagnostics) accepts comma-separated `--adc-input 0:0,7:512`, records every input,
reapplies it on cold replay and compares the native-reported conditions with
the request. `orchard_get_peripheral_state()` and WASM `peripheral_snapshot()`
inspect ADC/LCD state without reading side-effecting MMIO. A diagnostic data
word is meaningful only when `adc_valid=true`.

## Real-firmware observation

The unmodified HP48gII NOR first writes ADCCON `42f8`, then `42f9`, requesting
AIN7 with a divide-by-12 clock. With no input, it stops at this actual start
instruction, not at the earlier configuration write. Explicit AIN7 codes
0, 512 and 1023 each let it finish conversion and reach USB initialization.
The low-code path executes six fewer instructions than the other two; the
read therefore affects guest control flow. Neither these three codes nor the
next USB stop establishes the real board's voltage-divider/battery mapping.
Each conditioned run still records one unverified LCD `+0x68` read.

See [boot research](boot-research.md) for exact checkpoints and
[validation](validation.md) for directed and production-host evidence.
