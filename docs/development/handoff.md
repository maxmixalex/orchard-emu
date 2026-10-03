# Continuation handoff

Private `zyf722/orchard-emu`; preserve main ancestry and existing issue #1.
Base for this slice: `a9e03bd`. The live issue owns current accepted commit,
Build and Pages results. Do not force-push or change repository visibility.

## Input plan

The user will later provide original **HP39gs and HP49g+ full NOR dumps** from
their machines. Do not request those now or restart the retired dumper. This
is deferred input work, not a development blocker. Available full dumps remain
HP39g+ D1.55 and HP48gII USB revision. The two original 16 KiB 49g+/50g boot
regions remain separately classified with erased OS backing. No new firmware
was acquired. See [native inventory](native-roms.md).

## Current dependency

USB register initialization now proceeds on both original full NORs. With
prior explicit conditions and one counted LCD idle-zero read, HP39g+ stops at
`00022440` and HP48gII at `00027380`, both attempting a zero-fill store to
physical NOR address zero. Do not discard the store or make NOR writable;
trace memory conventions/cache/MMU/NOR behavior independently. Strict default
LCD/GPIO stops remain unchanged, and no stock UI is booted.

Original HP50g boot-only recovery now completes six local EP0 control requests
on native and WASM, including guest device/configuration descriptors, delayed
address activation and SET_CONFIGURATION status. GET_CONFIGURATION remains a
counterexample; Bulk and host-OS enumeration are not implemented. Source and
erased backing remain separately identified. See [USB evidence](usb.md).

## Validation / publication

Four CTest suites, 145,021 assertions per native/test-WASM host, six existing
integrations and an original USB IRQ guest pass. Five ordinary firmware probes
and one six-request USB session agree across hosts/cold replays. Two progressed
full NORs and that control session also pass optimized sanitizers. See
[validation](validation.md) for exact current versus historical scope.

Run locally before pushing. Tests belong in the source repository but not
production packages. Firmware/manuals/private traces never enter Git or Pages.
Zensical deployment publishes docs only and verifies live content/revision.
M0 stays closed; no current conditioned run closes M3 or independent CPU gates.
