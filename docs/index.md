# Orchard development

Orchard targets six HP Apples calculators using an original ARM920T/ARMv4T
interpreter and a progressively implemented S3C2410-class machine. Its goal is
unmodified stock firmware running from a complete physical NOR dump, natively
and in a browser, with useful virtual PC connectivity.

**Current boundary:** two genuine full NORs execute to early hardware stops;
no stock-OS-capable calculator is claimed. [Boot research](development/boot-research.md)
records the exact inputs, progression and remaining blockers. The six model records specify candidate physical
memory/display profiles; they are not a claim of six validated boards.

The [roadmap](development/roadmap.md) owns durable milestones and acceptance
criteria. The [board](development/board.md) owns short-term work. The
[validation record](development/validation.md) distinguishes implementation,
local synthetic evidence, remote CI and real-firmware evidence. A checked box
must not cross those boundaries without a new witness.

Start with [architecture](development/architecture.md), then consult
[models](development/models.md), [ROM inputs](development/roms.md) and
[virtual links](development/virtual-link.md). The
[handoff](development/handoff.md) records what has and has not been published.

New research: [native boot-region inventory](development/native-roms.md) and
[explicit GPIO sensitivity experiments](development/boot-research.md). Original
HP49g+/HP50g boot code now runs separately from the genuine full-dump fixtures;
no additional complete stock OS or full-NOR capture is claimed.

Current peripheral work: [LCD scan/interrupts](development/lcd.md) and
[normal ADC with explicit inputs](development/adc.md). Conditioned full-NOR
runs pass USB initialization but next stop on a zero-fill store into NOR; no stock UI
boot is implied. Strict default checkpoints remain separate.

The original 50g boot-only input now answers six local EP0 control requests.
See [USB](development/usb.md) for guest descriptors, host APIs and the explicit
limits: no Bulk, complete standard-request compatibility or host-OS device.
