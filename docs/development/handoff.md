# Repository handoff

## Repository and publication

The private repository is `zyf722/orchard-emu`, on `main`. The existing MIT
LICENSE initialization commit is `f7246e5cc166c6cfa8e773990f9762ca336ad07a`.
The baseline source import preserves that commit as its parent and retains
[issue #1](https://github.com/zyf722/orchard-emu/issues/1) as the live board.
Do not initialize a replacement history, force-push, or create a duplicate board.

The initial downloadable handoff contained stale statements that the repository
was empty and no board existed. A connected read on 2026-10-02 found the LICENSE
commit and existing issue. The current GitHub connection exposes write actions;
publication uses Git trees, a parented commit and a non-forced branch update.
The reference webemu48 and hpclang repositories are read-only research inputs
for this work and have not been modified.

Source and static distributions exclude firmware, bootloaders, generated
screenshots, local exploratory harnesses and reports. Public deployment is not
a side effect of committing to this private repository.

## Local verification during import

The CMake release build, native profile listing, JavaScript syntax checks and
freestanding WASM build were rerun successfully. Historical assertion counts
from the original handoff are retained as historical experiments in
[validation](validation.md), not presented as rerun tests. Establishing a
maintained corpus remains an explicit task.

Zensical installation failed because the local package network could not be
resolved; a strict site render is not accepted on that basis. The manual Build
workflow targets `home-docker`, builds native/WASM and checks documentation,
then uploads web/site artifacts. Runner access and a successful remote run
must be observed separately. No Pages deployment is configured.

## Existing ROM fixture

The preferred first boot fixture already exists in hpclang:
`tests/e2e/fixtures/hp39gplus/flash.bin.xz`.

| Identity | Value |
| --- | --- |
| Native firmware | HP39g+ D1.55, `Version HP39-D1.55,*0` |
| Raw size | 1,048,576 bytes |
| Raw SHA-256 | `95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67` |
| Compressed size | 462,392 bytes |
| Compressed LFS SHA-256 | `814cda6572b78fb20ec6b40bbb48cda44def717887113f569cb2e1885487ece8` |

The connected read returned the 131-byte LFS pointer. Local HTTPS binary
retrieval failed; no stock-ROM instruction trace has therefore been produced.
The missing local bytes are not a missing hardware dump. Do not restart the
retired dumper or its calculator-side automatic-return investigation.
Do not commit signed download URLs, credentials or firmware bytes to Orchard.

## Continuation

After obtaining the exact fixture locally, verify both compressed and raw
identities, keep the original bytes unmodified, and record the first stop PC,
instruction and MMIO/NOR address. Resolve that dependency against the relevant
primary manual and a minimized local regression. Advance to one interactive
stock cold boot before expanding skins or claiming six-model compatibility.
