# ARM920T translation state

The core models separate 64-entry data and instruction TLBs. A successful page
translation is retained until replacement, matching CP15 maintenance or a CPU
reset. Changing a page-table word does not silently change a loaded translation.
This fixes the HP39g+ native-return failure described below without changing
firmware, application bytes, physical RAM size or exception handling.

The primary reference is the [ARM920T Technical Reference Manual, ARM DDI
0151C](https://documentation-service.arm.com/static/5e8e2a5b88295d1e18d381bb):

| Area | Reference | Implemented behavior |
| --- | --- | --- |
| Capacity and replacement | §3.1, §2.3.14 | 64 entries in each bank; cyclic victim selection |
| TLB operations | §2.3.12, Table 2-17 | Both-bank/all, I/all, D/all, I/MVA, D/MVA |
| Lockdown | §2.3.14, Figure 2-8 | Independent c10 Base, Victim and P; replacement wraps from 63 to Base |
| Preserved entries | §2.3.12–14 | All-entry invalidation retains P-marked entries; single-MVA invalidation removes a matching preserved entry too |
| Subpages | §3.3.12 | Equal APs load a whole 4 KiB/64 KiB page; unequal APs load only the selected 1 KiB/16 KiB quarter |
| Protection | §3.1.2, §3.6–7 | Cached AP/domain, current DACR, S/R, user/privileged mode and access direction |
| Fault priority | Figure 3-14, Table 3-9 | Invalid page descriptors precede domain rejection; failed walks do not create a translation |
| FCSE | §2.3.16 | Low virtual addresses are tagged with their modified virtual address; an invalidation operand is already an MVA |
| MMU disable/re-enable | §3.9.2 | Bypasses translation while disabled, retaining the TLB contents for re-enable |

TTBR, DACR and FCSE writes do not implicitly invalidate either bank. A new
TTBR supplies subsequent misses. DACR changes affect protection on the next
access, including a hit. The replacement counter advances only when a complete
translation is inserted; invalidation does not reset it or change c10.

A valid descriptor is cached before access protection is checked. Consequently,
a domain or permission fault can leave a valid TLB entry. Invalid L1/L2 entries,
failed physical table reads and an alignment fault do not create an entry. The
page walk still obtains and validates L2 before reporting a domain fault,
following the ordering in Figure 3-14 and Table 3-9. This distinguishes an actual
failed walk from a valid translation whose current access is forbidden.

`src/mmu.c` keeps a small host hint array for each bank. A hint is only a candidate
entry number with an exact 1 KiB MVA tag; every use verifies the architectural
entry's valid bit and range and repeats current protection checks. A fill,
replacement or invalidation clears the affected bank's hints. Even overlapping
guest entries therefore retain the reference scan's deterministic first-match
priority across hints, host relocation and checkpoint restoration. Hints do not
change architectural replacement or invalidation. The reference path scans the same architectural entries
without hints. Neither path re-reads a descriptor on a TLB hit.

This is a functional TLB model. It does not implement I/D cache contents,
writeback, bus-cycle latency, instruction prefetch pipelines or CP15 debug/test
access to TLB RAM. Cache maintenance remains the existing coherent-memory
model. This work does not establish complete ARM920T timing or full MMU/cache
conformance.

## HP39g+ native return

The original GBP39 Player 0.3 package still has the independently diagnosed
unaligned BSS-clear address. That is a program/linker issue, documented in
[r23 native program results](hp39-programs-r23.md). It is not relaxed by this
change. The separately named **GBP39 ALIGN4** diagnostic rebuild is used to
reach the later return failure; its `main.c` is unchanged.

On the unchanged HP39g+ D1.55 ROM, ordinary stock Wire installation and physical
START/F6/ON input produced this chain on the r23 core:

1. The native user stack at `0x0902decc` maps through the L1 word at physical
   `0x40000240`, initially `0x0800c011`, and a small-page descriptor mapping it
   to SRAM near `0x08039ecc`.
2. The native application restores the stock interrupt mask. The ROM keyboard
   handler at `0x0000e7c4` performs its normal byte store to `0x07f00243`.
   That queue address aliases the internal SRAM containing the L1 word; the
   descriptor becomes `0x0000c011`.
3. The old core's live-descriptor memo immediately walks that modified L1 word.
   At `0x00022a04`, the ROM IRQ handler's `stmdb sp!, {lr}` faults with DFSR 7
   and FAR `0x0902dec8`. The preceding switch to the user stack is intentional
   ROM code, not evidence of a banked-register defect.
4. The complete trace from ON to the first fault has 2,494 scheduler steps and
   no CP15 instruction. The descriptor changes at step 2,193, so no TLB
   invalidation occurs between the queue store and the fault.

The new DTLB retains the previously loaded stack translation across that store.
The same installed program now returns normally, restores the stock IRQ stack,
and calculates HOME `1+1=2`. HP39gs remains a passing control. Saving the game
with warm TLBs, restoring, and repeating the same ON sequence yields identical
complete checkpoints. These are original-ROM emulator witnesses, not physical
hardware measurements. Public evidence contains hashes and diagnostic facts;
ROMs, full traces, LCD images and checkpoints stay in private outputs.

## Checkpoints and regression coverage

Checkpoint version 7 appends both banks, entry coverage/protection/valid/P
state, and c10 replacement/lockdown registers. Version 1–6 imports explicitly
start with empty TLBs and reset c10 registers, matching the absence of this
state in those formats. See [sessions](sessions.md) for the exact wire layout.
A new snapshot must retain stale-but-valid translations: reconstructing entries
from current page tables would change execution after restore.

`tests/mmu-tlb.c` uses generated page tables to test stale L1/L2 mappings,
separate I/D maintenance, real entry capacity and replacement, whole/subpage
coverage, preservation and lockdown, FCSE, TTBR and MMU toggles, protection/fault
ordering, warm-state save/restore, legacy migration and atomic malformed-state
rejection. The scheduler regression also executes a guest STR followed by
actual c8 maintenance to distinguish stale and invalidated instruction mappings.

With privately supplied ROMs and an installed ALIGN4 aplet selected in APLET,
the maintained return witness is:

```sh
node tools/verify-hp39-native-return.mjs /private/full-nor.bin \
  /private/wire-install/installed.checkpoint /private/new-return-result
```

Generate that installed state through `tools/verify-hp39-wire-batch.mjs`; the
return tool does not install objects or inject memory. It records the input
checkpoint identity, program selection frame, physical switches, normal return,
restored continuation and arithmetic frame. The expected arithmetic hash is the
already visually checked ALIGN4 result from the r23 HP39gs witness.

## r24 validation record

The [public evidence](evidence/arm920t-tlb-r24.json) pins the final production
WASM to `74a8c4f299b522aa134b25072493db2bd5cd29a436281b8275f74c8608d8197a`.
All return runs below use that binary; their installation checkpoints retain
separate provenance. HP39g+ was installed from a cold boot on the preceding
TLB candidate (`121cd17f…`), before the host-hint determinism correction;
HP39gs uses the independently reproduced cold-boot r23 Wire installation
(`4bd0b8bb…`). Neither is described as a final-candidate cold-install witness.

| Verification | Result and scope |
| --- | --- |
| Generated core regressions | 1,182,695 assertions on each of native and WASM, including 812 explicit TLB assertions |
| Independent ARM instruction witness | The integration run of `tests/tlb-wasm.mjs` passes 25 checks using generated ARM MCR/MRC and memory-access instructions, including checkpoint restore and the overlapping-entry hint case |
| Native suite | All 24 CTest suites pass |
| Reference interpreter | All 24 suites pass; one local binary's missing executable permission was corrected before its targeted rerun |
| Address/undefined sanitizers | MMU, checkpoint, execution and scheduler suites pass; leak detection is disabled because the environment uses ptrace |
| HP39g+ and HP39gs ALIGN4 | START, F6 game, ON return, identical return after warm checkpoint restore, HOME `1+1=2` |
| HP49g+ original ROM | Cold boot, VERSION, FACTOR, APPS/MODE, plotting and return; exact native/WASM and reset/restore checkpoint continuation |
| HP49g+ and HP48gII USB | Cold boot, stock Kermit SERVER, generated integer `42` upload and GET, FINISH and physical recall; object bodies match exactly |
| HP49g+ SD | Cold boot, normal FILES operations, write `42`, inspect exported FAT16 bytes, restore a partially written sector across native/WASM, reimport and recall on a fresh boot |
| HP48gII original ROM | Cold boot, FILES navigation, return and `1+1`; the model continues to reject an SD card because it has no SD slot |

The USB witness uses the production FileTransfer/VirtualUSB modules and normal
physical keys. The stock firmware rewrites the `HPHP49-X` transfer header to
`HPHP49-C` on 49g+ and `HPHP49-B` on 48gII. The seven-byte object body is
unchanged and both machines display `42` after ordinary recall; full file-wrapper
equality is not claimed.

The HP49 plotting tool carried a fixed frame hash from r17. Its final HOME sample
now produces a different hash on both frozen r23 and the new TLB candidate;
all stage images and the final CPU snapshot match between those two runs. The
normal command-history image was visually inspected before updating that stale
assertion. The historical r17 evidence is unchanged, and the baseline control
is recorded in the r24 evidence rather than being hidden as a candidate pass.

Unicorn was not rerun as part of this focused change. These results do not cover
physical ARM920T cache timing, every third-party program, or browser interaction;
those remain separate validation scopes.
