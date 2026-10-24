# Program-driven compatibility continuation

This iteration continues PR #38 with real downloaded applications, production
browser interaction and specific fixes exposed by those workloads. The initial
program-acceptance core is SHA-256
`57d5d586bbf4e22e8e733130630c961df73ba0df57f1bcf683fc53bb327b8547`.
The subsequent [ARM920T roadmap review](core-next-r25.md) implements a further
CP15 ID-read correction and the UART keeps not-yet-arrived host input separate
from its resettable receive FIFO. The combined production core is SHA-256
`36e2a4811a793413ca5ec49436e047b3f47a518112810f2c1835030322fa8569`.
The initial matrix, [CP15-only follow-up](evidence/cp15-followup-r25.json) and
[combined production verification](evidence/production-continuation-r25.json)
retain distinct binary identities; results are not reassigned to later builds.
It uses the same original HP39g+, HP39gs, HP48gII USB-revision and HP49g+
full-NOR identities already admitted in [ROM provenance](native-roms.md).
No ROM, bootloader, guest memory or application object is patched by the host.

The [sanitized acceptance record](evidence/compatibility-r25.json) retains
input/build hashes, tool identities, completed outcomes and test boundaries.
Original programs, ROMs, screenshots, card images and checkpoints remain
private caller-owned inputs or outputs. A successful installation, moving
screen, protocol packet or test driver without an observed result is not a
compatibility pass.

## Implemented changes

| Area | Failure observed | Implemented behavior |
| --- | --- | --- |
| Multiple loads | ARM LDM and Thumb LDM/POP reused ordinary LDR rotation for unaligned addresses with alignment checking disabled | Whole-word multiple-load ordering, preserving ordinary LDR rotation and enabled alignment faults |
| Native context save | Original Tetris+ stopped at its full-register STM; an initial updated-base interpretation then corrupted the saved SP on return | Ordinary ARM/Thumb STM stores the original base value before writeback; the architecture's UNPREDICTABLE field and conflicting Samsung description remain explicit |
| Live LCD clock | Tetris+ writes CLKVAL with the LCD enabled | Supported STN divider changes preserve the current line/phase and take effect through the existing functional scan clock; live format changes still stop |
| PWM observation | HP-GCC reads TCNTO0 with LDRH | Lane-correct byte/halfword reads expose the existing read-only counter values; control and buffer registers do not gain guessed narrow writes |
| CP15 identification follow-up | Six documented ID-read encodings stopped as unsupported | All seven ID-read aliases retain the existing processor ID; the separate cache-type encoding and rejection boundaries remain covered independently |
| Physical input | DOM key presses and pointer clicks became fixed pulses even when held | Independent down/up contacts, overlapping keys and touches, minimum brief-click dwell, finite character macros, and lifecycle cancellation |
| Background pointer capture | With background execution enabled, releasing only Worker contacts left DOM capture attached to an old key | The same lifecycle reset clears keyboard owners, both keypads' pointer owners/capture and Worker contacts; a new click reaches its actual key |
| Settings and layout | Settings actions fell below short viewports; menu keys leaked into the guest; fitting the whole calculator made landscape keys too small | Bounded modal scrolling, native Mantine input ownership, compact short-window actions, usable scrolling keys and conditional sticky LCD |
| Serial Wire | HP39gs rejected a library's first 1 KiB block; continuous receive was USB-only | Serial uses accepted 128-byte blocks, with continuous bounded Note/aplet/library reception and completed-file retention after Stop |
| Directory synchronization | Matching changes on both sides could be reported as conflicts; directory-to-file replacement retained obsolete descendants | Identical changes converge, obsolete child baselines are removed and the next persisted synchronization remains clean |
| Infrared reconnection | An old asynchronous partial receive could outlive its peer link; tiny queued chunks required repeated browser acknowledgments | Receive continuations retain their exact link identity; subsequent timing and original-firmware acceptance are recorded below |

[ARM memory behavior](arm-memory.md) records independent source-derived cases,
the original native program's exact failing instructions and the evidence
limits. In particular, the STM choice is a global deterministic compatibility
policy within an architecturally unpredictable case; it is not an assertion
that the physical ARM920T has been measured. The PWM lane behavior is supported
by original HP-GCC source/use, while the vendor table recommends word accesses.
Neither change recognizes an application, ROM hash or special PC in the CPU.

## Original downloaded programs

| Program and primary download | Guest execution | Admitted machines exercised | Completion criterion |
| --- | --- | --- | --- |
| [Tetris+ 1.1](https://www.hpcalc.org/hp39/games/tetris39gpls.zip) | Native HP-GCC ARM | HP39g+ only, as declared by its author | Cold Wire install, title/start, actual left/right movement, ON exit, HOME `1+1=2`, exact full-checkpoint continuation after warm restore |
| [Arkalite](https://www.hpcalc.org/hp39/games/arkalite40.zip) | Guest Saturn program and dependency library | HP39g+, HP39gs | Cold two-object Wire install and exact reverse export, game input, held DEL exit, HOME arithmetic, exact warm continuation; browser keyboard/touch movement and separately retained short-DEL failures |
| [Hanoi](https://www.hpcalc.org/hp39/games/hanoi39.zip) | Guest SysRPL aplet | HP39g+, HP39gs | Cold install, five-disk animation, return, HOME arithmetic and exact warm continuation |
| [2048](https://www.hpcalc.org/hp49/games/board/2048.zip) | Native Thumb executable | HP49g+ | Stock USB install, native execution, changed board after directions, ON exit and correct subsequent arithmetic |
| [BabalPlus](https://www.hpcalc.org/hp49/games/arcade/babal49plus.zip) | Guest Saturn library | HP49g+ | Stock installation/attachment, game interaction, return and correct subsequent arithmetic |
| [BaseConvert / ListConvert](https://www.hpcalc.org/hp49/math/misc/baseconvert.zip) | Guest RPL | HP49g+ | Convert 42 to binary and back, then subsequent arithmetic; exact independently reviewed result frames |
| [Pinned HP-GCC SDK example](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2) | Native ARM through ARMToolbox | HP49g+ | Cold stock USB installation, actual greeting, ON return, RPN arithmetic and exact 4,474-byte library GET after reconnect |
| Same unchanged SDK example with its original `L275_48.LIB` | Native ARM through the 48gII ARMToolbox library | HP48gII USB revision | Cold USB install, PrRUN greeting, ON return, RPN arithmetic, 2,404-byte library GET and FINISH; all object payload bytes match, with the original OS's C-to-B transport-header revision change explicitly checked |

The 2048 readme declares 49g+/50g; it is not treated as a 48gII application.
Downloading Life without completing its library invocation is not counted.
Previous 48gII positive/negative-base RPL results remain separately recorded
in [the earlier application evidence](apps-r23.md). The new
[48gII native-return workflow](hp48-native.md) uses that model's original
library, rather than silently substituting the 49g+ ARMToolbox object.

`tools/verify-hp39-programs.mjs` recognizes exact original program hashes.
Its arithmetic assertion compares the reviewed HOME calculation area, allowing
each aplet's own title. This catches a stale title or exception-handler loop
even when the core reports no diagnostic stop. `tools/verify-hp49-apps.mjs`
asserts all eleven reviewed result-frame hashes; merely different frames are
insufficient. Both check that their original input files and WASM did not
change during the run.

### Original GBP 0.3 remains distinct

The original package clears BSS at an unaligned address with CP15 alignment
checking enabled. On both original 39-series systems the first fault is
PC `0x0803ca04`, DFSR `1`, FAR `0x090007f2`; the ELF's aligned BSS is
`0x090007f4`. The diagnostic ALIGN4 package is separately named and hashed.
It runs and returns on both machines, but that result is never relabelled as
success of the unchanged original package. The emulator does not disable
alignment faults or rewrite the loader. See [the native prerequisite record](hp39-native-prerequisites.md)
and [retained translation evidence](arm920t-tlb.md).

## Browser input and presentation

The production Chromium witness loads the original ROM and a session produced
by stock installation through the actual file inputs. Keyboard/pointer events
then travel through the normal React/controller, Worker and core paths. The
observer records messages and pixels without replacing them. The initial
57d5 browser results and combined 36e2 results retain their own served-asset
hashes in the two acceptance records. The combined-core browser games reuse
earlier stock-installed checkpoints; fresh combined-core cold installations
are verified separately in the native-program record.

- Both Arkalite machines move the paddle from center 65.5 to 5.5 for a keyboard
  left hold and to 124.5 for a touch right hold. Each hold lasts at least twelve
  million functional ticks and contains exactly one down/up pair. On the
  combined production core, an explicitly held DEL (about 2.15–2.18 million
  observed ticks) exits on both machines and the complete HOME `1+1=2` image
  matches. Ordinary short DEL also has retained failures: a valid down/up
  pair can leave Arkalite running. Passing held-DEL runs do not replace those
  failed short-click results. Twenty-eight paired fixed-input comparisons
  between the initial and combined cores reach identical full checkpoints;
  that bounded diagnostic did not reproduce the browser failure and does not
  establish its cause or frequency.
- Tetris+ moves its initial piece from center 23.5 to 7.5 or 43.5 under left
  and right holds. Shift and Alpha also retain/release contacts while the
  program keeps running. The initial piece is square, so those two contacts
  are not advertised as visible rotation tests. ON return and the complete
  `1+1=2` LCD match the native witness.
- Separate DOM tests cover simultaneous keys, independent touch contacts,
  pointer capture loss, cancellation, pause, blur, modal entry, view changes
  and teardown. Auxiliary keyboard/screen-reader clicks remain finite taps.
  Eight additional cases cross both keypad implementations, blur/hidden, and
  disabled pause/paired infrared policies. They release the pointer in another
  tab and verify that the next click reaches the right key instead of the old
  captured left key. Pointer events/capture are real Chromium behavior;
  lifecycle events and Worker snapshots are explicit component fixtures.
- At 844×390, traditional landscape retains a 704-pixel calculator with main
  key bounds of at least 24×24 CSS pixels; the earlier height fit reduced it
  to approximately 324 pixels. The compact header/toolbar occupies 92 pixels.
  The lower rows scroll, and the LCD stays visible only when enough room
  remains to operate the keyboard. Narrow Connections layouts also verify
  actual lower-row hit targets.
- Settings Apply/Cancel stay inside the viewport across four settings tabs
  and four viewports. Storage explanations are shorter, and the save interval is
  disabled while automatic saving is off. Menu Arrow/Escape keys do not reach
  the guest. The workbench status vectors now match the user calculator.

These are actual Chromium keyboard and emulated-touch events, not a claim of
physical iOS/Android or all-engine acceptance. LCD nearest/bilinear/bicubic/
Lanczos scaling and optional 35 ms response remain presentation policies;
raw captures, recordings and guest state remain independent. The original
firmware's OFF-text-at-enable sequence is retained rather than hidden.

The initial 57d5 core also measures a four-second GBP39 ALIGN4 workload on each
39-series system, with 241 output samples per variant. Mean adjacent-frame
pixel changes are 1.587/1.625/1.241 on 39g+ and 1.503/1.537/1.182 on 39gs for
after-slice, completed-scan and completed-scan plus 35 ms response respectively.
Every variant reaches the same complete guest checkpoint. Completed-scan
publication prevents inconsistent within-scan images, but this workload does
not show a lower transition metric from that policy alone. The optional
response reduces the sampled transitions; it is neither an optical flicker
measurement nor proof that all genuine guest redraw intermediates disappear.
These Node publication measurements exclude Worker messaging, Canvas and the
browser compositor.

## Connectivity and storage

Original HP39gs serial Wire cold-installs two Notes and the diagnostic
library/aplet package. One listening session accepts the two Notes; another
accepts two successive multipart library/aplet groups. Six exported files
total 30,016 bytes. Note/aplet files are identical; the library's body is
identical while its original OS may rename the transport header. The real
browser receives both Notes, observes the actual Stop acknowledgement,
downloads both exact files and returns to arithmetic.

Directory convergence is implemented in the production comparison/apply
paths. Its maintained tests include real OPFS directory handles and IndexedDB
reloads, matching deletions, directory-to-file replacement and descendant
baseline cleanup. These browser component cases remain distinct from the
original HP49g+ FILES/media workflow. Explicit synchronization pauses and
ejects a mounted image before modifications, then reinstates it under the
existing lifecycle policy. It does not mutate a mounted filesystem behind
the guest cache or create an operating-system virtual disk.

An initial 57d5-core browser run, before the later DOM-capture and timed-relay
changes, uses original 49g+/48gII production tabs to interrupt a stock infrared
transfer, end both peer links on Pause, resume with a new pairing code and
cancel the firmware's old command through ON. The next forward object recalls
`ORCHARD = 12345`; the reverse object recalls `RETURN = 54321`. Each is exactly
26 bytes with valid Kermit completion and final acknowledgment, followed by
Disconnect on both tabs. [The maintained workflow](infrared.md#browser-interruption-and-recovery)
records the prepared cold-boot sessions, physical inputs and all served assets.
A subsequent strict run on the final pre-timing frontend completed the forward
object but timed out during reverse discovery; that failed report is retained
separately, so the earlier positive run is not final timed-relay acceptance.
The separate controlled stale-link and partial-acceptance regressions establish
the two relay fixes. A successful browser exchange does not establish that
they explain every earlier malformed ACK or firmware discovery timeout.

## Fixed-workload performance comparison

The r24 core and combined 36e2 r25 core execute six fixed private checkpoints with the
same ordinary inputs: 39g+ `1+1`, `7*8`, APLET and Function, and 48gII `1+1`
and `7*8`. All six final complete checkpoints match between builds, in both
Node and the real Chromium Worker. Five alternating Node samples and four
browser samples per case separate these measurements from the concurrent
application acceptance runs.

| Workload | Node baseline/candidate median time | Chromium Worker baseline/candidate median time |
| --- | --- | --- |
| 39g+ `1+1` | 0.989 | 1.000 |
| 39g+ `7*8` | 1.011 | 0.992 |
| 39g+ APLET | 1.007 | 1.023 |
| 39g+ Function | 0.934 | 1.020 |
| 48gII `1+1` | 1.006 | 1.014 |
| 48gII `7*8` | 1.068 | 1.055 |

A ratio above one means the candidate took less host time in that sample.
The small, mixed differences do not support an overall optimization claim.
This measures core work on the current host, not end-to-end input latency,
physical calculator speed or a survey of user devices. The exact identities,
sample times and state comparisons are in the combined production record.
The earlier 57d5 measurements remain in the initial record; they are not
substituted for these final-core samples.

## Remaining roadmap work

| Roadmap area | Present boundary | Next concrete acceptance requirement |
| --- | --- | --- |
| Six-model admission, M4 | No complete original HP40gs or HP50g NOR is available | Obtain each complete original image with provenance, then independently cold boot, calculate, transfer, save/restore and run/return from an applicable native program |
| ARM920T semantics, M1 | Bounded independent instruction/MMU tests; undefined instructions still stop at the host boundary | Implement defined ARMv4T Undefined exception delivery with independently specified vector/LR/SPSR and ARM/Thumb return cases; preserve explicit UNPREDICTABLE cases and verify abort base/FAR/DFSR obligations before assuming partial destination updates |
| Board timing and LCD, M2 | Functional 12 MHz reference, declared SRAM/GPIO/LCD conditions | Physical clock/reset/pad/panel measurements; retain exact original-ROM counterexamples instead of interpreting visual smoothness as hardware accuracy |
| SD and peripherals, M2/M6 | SDSC PIO/FAT16 and bounded UART/SPI/NOR modes | Add a source-derived PCLK UART receive-timeout subset and checkpoint state; first establish any external UEXTCLK frequency used by stock IrDA. DMA/larger media require separate transaction evidence and exact continuation |
| Browser stability, M5/M7 | Maintained Chromium desktop/narrow/touch fixtures and real original programs; Arkalite short DEL is not consistently accepted | Retain exact input/virtual-time histories for the Arkalite failure; add other engines, real phones and long-session/storage-pressure cases, including the historical rare HP48 Unlimited post-result failure |
| Infrared, M6 | Decoded-byte same-origin pairing, original object transfer | Wider cancellation/retry/re-pair cases with valid end acknowledgements, exact recalled objects and retained malformed/retransmitted-packet evidence; physical optical timing remains separate |
| Performance | Exact-workload state comparison and host measurements | Measure candidate/reference execution and browser input latency separately, at fixed inputs, without inferring physical calculator speed or a speedup from passing functionality |
| Release, M0/M7 | Source review, local gates, hosted Build and Pages are distinct | Observe successful hosted checks and the exact live asset/revision manifest for every accepted release |

Native operating-system device simulation, driver binding and Conn3x remain
retired at the user's request. Missing original images, physical measurements
and browser capabilities are not silently assigned a nominal one-percent
exception. This record reports completed flows and specific remaining gates;
there is no defensible denominator for a blanket 99-percent compatibility claim.
