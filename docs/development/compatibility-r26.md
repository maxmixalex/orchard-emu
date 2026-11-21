# r26 model, core and application continuation

This continuation implements guest undefined-instruction exceptions, PCLK UART
FIFO receive timeout, version-8 continuation state, an overlapping-key queue
fix, and two explicitly identified hardware-mod firmware configurations. It
extends the [r25 record](compatibility-r25.md); it does not replace its retained
counterexamples or turn a test count into a percentage of all calculator
features. The [sanitized acceptance record](evidence/compatibility-r26.json)
identifies each build and bounded result.

## Implemented behavior

| Change | Result | Boundary retained |
| --- | --- | --- |
| ARM/Thumb undefined encodings | The guest enters UND, with the correct banked link/SPSR, vector selection and return behavior; absent external coprocessors also trap | Condition-failed instructions stay inactive; malformed allocated instructions and unimplemented privileged operations retain explicit diagnostics |
| UART FIFO receive timeout | Three idle serial-frame times derived from the programmed PCLK divisor and line format can raise the receive interrupt below the FIFO trigger | Clock gates retain remaining time; no external-clock rate, optical waveform, DMA or break signal is invented |
| Checkpoint v8 | Three remaining timeout values and latches are serialized after the existing architectural state | v1–v7 retain explicit import/migration; a v8 session is not promised to open in an older emulator |
| Mixed held and macro input | A queued character macro no longer prevents a second physical contact while another contact remains held | Macro order, bounds, minimum dwell, release gap and ownership remain unchanged |
| HP40gs automatic USB receive | The two observed USB-selected RECEIVE dialogs have their own exact recognition and direct Enter transition | Original 39-series navigation remains unchanged; unknown or altered screens and cancellation retain bounded fallback |
| Untitled Wire libraries | Reverse multipart transfer accepts the valid zero-title library form, in which the library ID follows without a repeated name length | Nonempty names still require the matching repeated length; truncated or unrequested IDs remain rejected |
| Hardware-mod ROMs | Exact complete-image identities admit the supplied 40gs and 50gm to the normal calculator, with visible provenance and independent persistence | Original HP50g remains separate; no updater-only or arbitrary same-size image is admitted |
| Reproducible browser matrix | One command runs real HTTP/Worker/file/session/storage/self-test workflows against a frozen asset directory | The runner checks ROM and build immutability; a report is not itself proof of every guest operation |

The [core record](core-r26.md), [UART model](uart-irda.md),
[input continuation](input-r26.md), [session format](sessions.md) and
[hardware-mod audit](hardware-mod-roms.md) explain the implementation and
independent expectations. The code changes are not ROM patches, host-side
Saturn replacements or substitutions for guest diagnostic results.

## Firmware and model identities

| Normal calculator entry | Core model | Firmware identity and scope |
| --- | ---: | --- |
| HP39g+ | 1 | Original D1.55 full 1 MiB NOR, SHA-256 `95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67` |
| HP39gs | 2 | User's original full 1 MiB capture, SHA-256 `a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff` |
| HP48gII | 4 | Original USB-revision full 2 MiB image, SHA-256 `4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937` |
| HP49g+ | 5 | User's original full 2 MiB capture, SHA-256 `3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab` |
| HP40gs hardware mod | 3 | Supplied complete image with an HP39gs donor boot region, SHA-256 `9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311` |
| HP50gm hardware mod | 7 | Supplied 64-row modification with an HP48gII-target boot region, SHA-256 `b30a9ffb90996f0291b10a902a72d3a122db9c87fa5a55aa6ffdf07276b82db5` |

Model 7 has 2 MiB NOR, 512 KiB SRAM and a 131×64 LCD. It is distinct from
model 4's 256 KiB capacity and model 6's original-HP50g target. Existing numeric
model identities remain unchanged. The archive also includes alternative
39gs images and KINPO update containers; these are inventoried separately and
are not counted as additional independently accepted models.

`tools/install-firmware-update.mjs` verifies a recognized update header,
declared native length, additive checksum, target compatibility and a matching
complete base image. It writes a new file while preserving the base boot
region and untouched tail, including payload beyond the declared native ARM
length. It does not manufacture an original capture. Reconstructing the
supplied 40gs full image from its matching base/update reproduces its complete
SHA-256; that identity check is separate from executing the resulting image.

## Program-driven coverage

The program records distinguish guest ARM/Thumb applications, Saturn programs
and RPL/user-language programs. They include actual installation or separately
identified installed-state continuation, interaction, return, a known
arithmetic result and, where applicable, reverse transfer of exact bytes.

| Machine/configuration | Application evidence in this continuation |
| --- | --- |
| Original HP39g+ | Unchanged native Tetris+; unchanged Arkalite and Hanoi; game input/animation, return, arithmetic and exact warm continuation |
| Original HP39gs | Unchanged Arkalite and Hanoi; existing native ROMstream/ALIGN4 return remains independently recorded; actual browser contacts and DEL exit |
| Original HP48gII | Correct original ARMToolbox library and unchanged SDK ARM example installed over stock USB; native return, RPN arithmetic, exact library GET and FINISH |
| Original HP49g+ | SDK ARM example, native Thumb 2048, Saturn BabalPlus and RPL conversion programs; USB install, interaction, return and arithmetic; SD FILES write/export/fresh-boot recall |
| HP40gs hardware mod | Native/WASM HOME and CAS, including `1/3+1/6=1/2`; unchanged Arkalite cold Wire install, exact Disk export, input/return/arithmetic and warm replay; native ROMstream USB entry and return |
| HP50gm hardware mod | Correct LIB275 ARMToolbox library and SDK ARM example; exact 4,474-byte library USB GET, native return and arithmetic; VERSION, FACTOR, APPS, MODE and graphing; guest SD write/export and fresh-boot recall of `42` |

Arkalite's six additional real-browser short-DEL trials cover both original
39-series images and three input phases. They all return to the exact
`1+1=2` frame, without changing key dwell. The original failure has not been
explained. The independently reproduced overlapping-key/macro defect is fixed;
it is not asserted to be the cause of those historical Arkalite failures.

HP40gs has no infrared item in the supplied firmware's RECEIVE menu. Before
USB connection, its first entry is HP39/40 USB, followed by serial and the two
Disk drive entries. After USB connection, the observed dialog can contain only
the USB and serial choices; USB remains first in both renderings. A
39gs menu schedule would select the wrong transport. The model-specific
verifier follows the observed menu; it does not modify firmware to produce a
desired result. The experimental models' unverified infrared UI remains gated.

## Build and browser evidence

Four principal acceptance builds are listed here and remain distinct:

| Stage | WASM SHA-256 | Use |
| --- | --- | --- |
| UND implementation | `13bc6cb48b0877eadcdd3d6a904a219a0deef58957c0fa981708783ec3317143` | Early original-program and native-return regressions |
| UND plus model 7 | `8149548168ca58d3060cdf4a470f65cc3c3f05816add3b30173fc2bbc6631a80` | Four original production-browser workflows, six short-DEL trials, serial self-tests, original 39gs/49g+ full FLASH tests and initial hardware-mod programs |
| UART/v8 integrated | `209bce3c0cc3b7940d921aed8730dfb096ed7cb5600714e0eacc62ae3621239f` | Six-configuration production-browser matrix, original serial self-tests, exact v7 migration and hardware-mod ARM/CAS/SD/application gates |
| UART pulse edge and final integration | `bb53704a128319df23a0340da4bf7e8767d1a98ae8337a3b4d8572750d4ec7a3` | Idle FIFO threshold-crossing fix, final native/oracle/migration/recovery gates, actual HP40gs auto-RECV browser flow and HP39gs serial reverse-library correction |

Earlier records are not relabelled as later-binary cold installs. The integrated
browser runner hashes all 51 distribution files before and after execution and
can test an externally downloaded distribution using `--dist`. Each child
uses the ordinary file input and production Worker, exercises arithmetic while
the connection sidebar is open, saves/restores a complete session, reopens a
remembered ROM, enters/exits factory tests and verifies storage disable,
reenable and Forget behavior. The supplied ROM bytes are checked unchanged.

```sh
python tools/verify-browser-matrix.py \
  --dist /path/to/frozen-distribution \
  --rom /private/original-39gplus.bin \
  --rom /private/original-39gs.bin \
  --rom /private/original-48gii.bin \
  --rom /private/original-49gplus.bin \
  --rom /private/supplied-40gs-mod.bin \
  --rom /private/supplied-50gm.raw \
  --output /private/new-evidence-directory
```

Actual browser tests use official Chromium headless shell 150.0.7871.181 in
this execution environment. They do not establish Firefox, WebKit, physical
mobile input or unlimited-duration reliability. A missing local desktop
process-singleton capability was an initial launcher failure, not a calculator
execution result. The final deployment has its own build identity and must be
observed separately from the local Clang build.

The preceding documentation-only main Build failed at the real directory-file
input test with Playwright 1.57.0 and the runner's rolling Chromium 157.0.8103.78.
That timeout was not reproduced locally with Chromium 150 or the driver's
matching Chromium 143.0.7499.4; both completed the unchanged eight-case directory
workflow. CI now installs the browser paired with the pinned Playwright release,
uses its explicit executable and preserves the version record. This improves
reproducibility without changing the directory test, its ten-second limit or
application behavior. [CI evidence](evidence/browser-ci-r26.json) retains the
failure and the limit on causal attribution.

## Remaining work and next acceptance gates

| Area | Concrete next work | Required evidence |
| --- | --- | --- |
| Original-device coverage | Obtain complete original HP40gs and HP50g NORs when available | Their own boot/OS identity, cold workflows, native return and per-model limits; hardware-mod results remain useful separately |
| Core | Continue precise abort/writeback, decode restrictions and privileged/MMU cases beyond the implemented UND subset | Independently specified fixed instructions, reduced failing state, reference/optimized agreement and sanitizer/oracle checks |
| UART/board | Supply an independently justified UEXTCLK rate if that mode is needed; calibrate physical clock/pad/LCD assumptions | Measured or primary-source-supported inputs; no arbitrary frequency fallback |
| Infrared | Explain the retained malformed Y3 retry and expand interruption/cancel/re-pair cases | A reduced original-peer trace and exact bidirectional object comparison, including final acknowledgments |
| Input | Reproduce the historical Arkalite short-click failure or identify its cause | Original UI sequence and scheduling context; successful samples alone do not close it |
| New firmware applications | Broaden 40gs/50gm transfer, native return, SD and capacity/recovery workflows | Actual unchanged programs and exact file/frame/state checks for each supported operation |
| Browser stability | Extend the current Chromium coverage to other engines and sustained sessions; classify the retained HP48 Unlimited stop | Recorded engine/build/input identities and a reproducible witness for failures |
| Remaining peripherals | Implement only needed SD DMA/SDHC/NOR modes with their own behavioral contract | Guest-visible operations and independent expected behavior, not just new registers or probes |

No global “99% implemented” value is assigned: there is no agreed exhaustive
feature denominator or measured failure-rate population. A completed local
case, an unavailable original capture, a missing physical measurement and a
browser-only limitation are different statuses. Only the user can decide
which otherwise feasible features have no implementation value.

Firmware, application binaries, full checkpoints, guest pixels and private
traces remain outside public source, Pages and releases. Public evidence
contains identities, commands, bounded outcomes and hashes.
