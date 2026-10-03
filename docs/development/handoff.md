# Continuation handoff

The reconciled USB continuation is parented on remote `80a1466`; it also
incorporates the independently preserved `orchard-usb-a9e03bd.patch`. No
force-push or repository visibility change is authorized or needed.
Current accepted revision, CI and Pages status belong in issue #1.

The newer packet API supersedes the provisional EP0-only helper/API. Its
original assembly control guest remains active alongside the new bulk guest.
Re-run all maintained native/WASM suites before further changes.

The user will later provide HP39gs/HP49g+ full NORs; do not request them now.
Available full dumps remain HP39g+ and HP48gII. The HP50g experiment uses only
its unchanged native 16 KiB bootloader and erased OS backing. No firmware is
committed or published.

Next concrete issues: the original HP50g GET_CONFIGURATION reply remains NAK,
and conditioned HP39g+/HP48gII full-NOR startup attempts a zero-fill at physical
NOR base. Preserve strict LCD defaults and the counted idle-zero hypothesis.
Neither issue can be hidden by invented packet readiness or writable ROM.

See [USB](usb.md), [boot research](boot-research.md) and
[validation](validation.md) for command/input/evidence details.
