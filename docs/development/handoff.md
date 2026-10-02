# Continuation handoff

## Repository

Work is in private `zyf722/orchard-emu`, branch `main`, with
[issue #1](https://github.com/zyf722/orchard-emu/issues/1) as the live board.
The first source import is `2840885f1c5bd649fe002a4a24c6abd638c96cde`, parented
to the existing MIT initialization commit `f7246e5`. Keep this ancestry; do
not recreate the repository, duplicate the board or force-push.

The 2026-10-02 continuation adds the maintained regression corpus, CPU edge
fixes and functional watchdog. See [validation](validation.md) for commands,
results and limitations. Tests are repository development inputs, not runtime
or distribution content. Generated fixtures, reports and firmware are excluded
from the production web and native install targets.

The build workflow runs on `main` pushes and manual dispatch, on `home-docker`.
It validates native Release, sanitizer, WASM and documentation builds, then
uploads web/site artifacts. Read the actual run before claiming success.
No Pages publication or visibility change is configured.

## Preferred first stock fixture

The existing hpclang file is
`tests/e2e/fixtures/hp39gplus/flash.bin.xz`. This is the hardware-acquired
HP39g+ D1.55 full NOR, not a new dumper task.

| Identity | Value |
| --- | --- |
| Raw size | 1,048,576 bytes |
| Raw SHA-256 | `95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67` |
| Compressed size | 462,392 bytes |
| Compressed LFS SHA-256 | `814cda6572b78fb20ec6b40bbb48cda44def717887113f569cb2e1885487ece8` |

The connected repository read supplies the LFS pointer, not its binary.
Local HTTPS retrieval failed with DNS errors. The existing hpclang Runtime
artifact `hp39-stock-runtime-e2e` from run `36369507309` was downloaded and
inspected: it contains payload/log/frame evidence but no full NOR. That
artifact does not resolve fixture availability and has not been imported.

After obtaining the existing binary, verify the compressed and raw hashes,
keep the original bytes unchanged, and run a bounded trace from reset. Record
the first unsupported PC/instruction/address and resolve it against a primary
manual plus a minimized local regression. Do not start speculative per-model
ROM patching, replace the bootloader or infer stock support from the synthetic
tests. No firmware, signed URLs or credentials belong in Orchard source.
