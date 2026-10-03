# Research references

Consulted for the 2026-10-02 baseline. These references describe sources, not
redistributed dependencies. Repository status and release versions can change;
implementation evidence should pin a commit or document revision.

## Primary technical specifications

1. [ARM920T Technical Reference Manual, ARM DDI 0151C](https://documentation-service.arm.com/static/5e8e2a5b88295d1e18d381bb).
   CP15 control/reset state, MMU, domain/AP/S/R permissions, exception behavior
   and cache/TLB interface. Current cache behavior is deliberately only a
   coherent functional approximation, not a cache model.
2. [Samsung S3C2410A User's Manual, 2004](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf).
   Vendor manual mirrored by Arm/Keil. ARM/Thumb instruction formats in
   chapters 3–4; memory controller, clock, interrupt, GPIO, PWM, UART, LCD,
   USB and other peripheral chapters. Only a subset is currently implemented.
3. [WebUSB specification](https://wicg.github.io/webusb/).
   Browser access to USB devices; not host-OS virtual-device creation.

The manual instruction-format diagrams, MMU permission table and CP15 reset
values were inspected directly. No manual PDF is bundled.

## Existing projects

- [webemu48, web-port](https://github.com/zyf722/webemu48/tree/web-port),
  inspected tree `4223aee5a965cd5c861c601e0f36e9be4922ceb4`.
  Native/browser separation and project experience; inherited GPL core is not
  Orchard source. README blob `a5e5fdb428df13a007c5b1cb1a355acc20f1ae16`.
- [hpclang roadmap](https://github.com/zyf722/hpclang/blob/main/docs/development/roadmap.md),
  inspected blob `c937fb84b33d5dc5a27b0b8a8b69e7a5941ba4c4`.
  Durable milestone/gate style, separate functional and visible-UI evidence.
- [hpclang development board](https://github.com/zyf722/hpclang/issues/1).
  Live concise Now/Next/Recently-closed tracking; not a substitute for design docs.
- [hpclang fixture provenance](https://github.com/zyf722/hpclang/blob/main/docs/development/fixtures.md),
  inspected blob `265e169c2f47345d22f70044d676fe8c5acf4765`.
  Complete NOR versus updater, HP39g+ dump identity, HP48gII USB revision and
  distinct HP49g+/50g bootloaders.
- [hpclang platform records](https://github.com/zyf722/hpclang/blob/main/docs/development/platforms.md),
  inspected blob `c263a6a6d87039df9e2d2ff7e1b7de1f6805ff81`.
- [hpclang stock USB research](https://github.com/zyf722/hpclang/blob/main/docs/development/stock-usb-transport.md).
  Relevant next-reading and behavioral comparison target; no implementation
  was transplanted. The live board supplied the initial transport scope.
- [x50ng archived GitHub repository](https://github.com/gwenhael-le-moine/x50ng)
  and [current Codeberg project](https://codeberg.org/gwh/x50ng).
  Machine-level ARM comparison target. The GitHub listing points to Codeberg;
  the latter was not retrievable during this session. No x50ng implementation
  is included or claimed to have been fully audited here.

## Documentation tools

- [Zensical setup](https://zensical.org/docs/setup/basics/): TOML `[project]`
  configuration and navigation.
- [Zensical build](https://zensical.org/docs/usage/build/): `build --strict`.
- [Zensical package](https://pypi.org/project/zensical/0.0.67/): version 0.0.67,
  released 2026-09-30; pinned for the initial documentation environment.

Pinning the direct documentation dependency is not a lockfile for every
transitive Python package. A complete reproducible docs environment is part
of M0 follow-up. Configuration/link checks are not a successful site render.

## Native NOR bring-up references

- Samsung manual chapters 6, 9, 14, 15 and 17: internal 4 KiB SRAM, GPIO/reset
  registers, two-level IRQ arbitration, STN word/byte order and RTC. The RTC
  control table (page 17-5) was also inspected as a rendered page.
- [HP 40gs Specification Sheet](https://www.manualslib.com/manual/704129/Hp-Hp-40gs.html?page=2),
  HP 4AA1-0863ENUC, June 2007: 2 MiB flash and 256 KiB RAM.
- [lyc8503's hardware modification write-up](https://blog.lyc8503.net/post/hp39gs-modify/),
  2021: original source of the separately acquired HP48gII full-NOR mirror.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages):
  site-only upload and OIDC deployment.

The undocumented HP39g+ LCD offset `0x68` remains a research question. The
reviewed manual does not establish its semantics; no emulator's convenient
readback has been promoted to hardware truth. Kernel register headers surfaced
in searches supplied only corroborating register facts, not implementation.

## Native-region and GPIO follow-up (2026-10-02)

- [HP49g+/HP50g original ARM boot-region archive](https://www.hpcalc.org/details/9335),
  acquired and hash-verified; [Emu48+ 2.15 image](https://www.hpcalc.org/details/6744),
  acquired and format-inspected. These bytes are research inputs, not vendored code.
- [Bernd Grubert's HP39gs boot-region contribution](https://www.hpmuseum.org/forum/post-117443.html),
  2019-06-07. Indexed provenance found; attachment retrieval failed with HTTP 403.
- [HP39GS-Explorer ROM directory](https://github.com/Yanye0xFF/HP39GS-Explorer/tree/master/rom).
  Git blob identity independently establishes that its `raw` file is the official updater.
- [newRPL target_50g LCD hardware access](https://github.com/c3d/db48x-from-newrpl/blob/063bd8e1ee9b641701a11488cd2a02dd540d87cf/firmware/sys/target_50g/lcd.c),
  blob `429bf955d6775ea4b4d54fed3702fa5595230739`. Pin-use descriptions identify
  GPD7 as LCD power and GPD9/12/13 as contrast-control signals. No implementation
  was imported; these descriptions do not independently establish every HP48gII pin.

Full identities, rejected candidates and limitations are in [native ROM research](native-roms.md).
The original vendor manual remains the source for GPIO input/output semantics.

## LCD and weak-bias follow-up

- Samsung 2004 manual pages 15-9 through 15-14 and 15-31 through 15-38:
  STN pixel groups, LCDCON5 BSWP/HWSWP, BLUELUT and documented LCD interrupt
  register addresses. Rendered diagrams/tables were inspected locally because
  the web PDF screenshot service failed. The manual still does not name `+0x68`.
- [x49gp LCD source](https://github.com/claudiobsd/x49gp/blob/master/s3c2410_lcd.c),
  inspected blob `3c7745863fabb8da5cfac974daae92ea76a50967`: unnamed `+0x68`
  storage with reset zero, read-driven scan approximation and fixed-width
  packed-memory rendering. Comparative evidence only, not imported code or
  a hardware specification. It motivates an explicit experiment, not a default.
- [MAME S3C24xx LCD DMA source](https://github.com/mamedev/mame/blob/0c77e0bc49ff302e248dbe9be4659448f07705d9/src/devices/machine/s3c24xx.hxx),
  inspected blob `f6ef1925eb25522650827fd0bf4f7f63bf6941e0`, selected lines
  230–440: a comparison of word-relative DMA lanes and palette interpretation.
  No implementation was copied or translated into Orchard.

The new guarded read, bias resolver, decoder corrections and tests are original
Orchard code. See [LCD evidence](lcd.md) and [licensing](licensing.md) for the
separation between specifications, firmware observations and emulator choices.

## LCD interrupts and normal ADC

- Samsung S3C2410A manual, sections 15-4, 15-26..15-38, 16-4..16-11 and
  14-17. The timing formula and WDLY/WLH tables disagree for some settings;
  the functional model follows the explicit tables and records the discrepancy.
- [Linux s3c2410fb hardware driver, pinned revision](https://code.googlesource.com/linux/torvalds/linux/+/91f28da8c9a054286d6917ce191349455c479478/drivers/video/fbdev/s3c2410fb.c).
  Its frame-IRQ acknowledgment writes the frame bit to LCDINTPND then
  LCDSRCPND. Only this hardware-use sequence was consulted; no driver
  implementation was copied or translated into Orchard. The resulting
  original latches are tested with both acknowledgment orders.

The ADC accepts ideal digital sample codes, not captured voltages. Functional
HCLK/PCLK quanta, initial scan phase, inactive ADC status lanes and standby
phase retention are modeling conventions, not new physical measurements.

## USB continuation

Samsung S3C2410A chapter 13 supplies register widths/reset bits, indexed CSRs,
FIFO ownership and EP0 SETUP_END/DATA_END semantics (13-12/13-13). The same
vendor PDF was rendered locally for register-table inspection. USB-IF's
[USB 2.0 specification library](https://www.usb.org/document-library/usb-20-specification)
provides generic control-stage/address context, not evidence that Orchard
implements high-speed USB or complete conformance. No reference emulator USB
implementation was imported for this slice. Actual descriptor values derive
from hash-pinned guest execution, not a host-side table.
