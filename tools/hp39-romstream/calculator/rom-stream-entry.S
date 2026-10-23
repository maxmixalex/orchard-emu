/* SPDX-License-Identifier: MIT
 * Derived from hpclang's ROM streamer and ARMToolbox supervisor helpers.
 * Copyright (c) 2026 Max Alex and Orchard contributors.
 *
 * The stock HP39 framebuffer overlaps high L1 words. Never borrow 0xa0..0xa4:
 * they are pixels, not free page-table storage. Only the low 0x11/0x12 slots
 * are borrowed, with all peripheral pages in our private 1 KiB coarse table.
 */
.syntax unified
.arm
.equ L1_BASE,        0x07f00000
.equ L1_FLASH,       0x07f00044
.equ L1_IO,          0x07f00048
.equ SWI_VECTOR,     0x08000008
.equ POOL_BYTES,     12288

.section .text.rom_stream_entry,"ax",%progbits
.global hp39_rom_stream
.type hp39_rom_stream,%function
hp39_rom_stream:
    stmfd   sp!, {r0-r12, lr}
    mov     r9, sp
    ldr     r10, [r1, #0x914]  /* raw PrRUN allocation bytes */
    ldr     r11, [r1, #0x920]  /* raw PrRUN allocation ARM address */
    cmp     r10, #POOL_BYTES
    blo     .Lbad_pool
    ldr     r2, =0x08000000
    cmp     r11, r2
    blo     .Lbad_pool
    adds    r12, r11, #POOL_BYTES
    bcs     .Lbad_pool
    ldr     r3, =0x08040000
    cmp     r12, r3
    bhi     .Lbad_pool
    /* A physical table pointer is valid only in an identity-mapped section. */
    ldr     r3, =L1_BASE
    ldr     r2, [r3, #0x200]
    and     r3, r2, #3
    cmp     r3, #2
    bne     .Lbad_pool
    mov     r2, r2, lsr #20
    cmp     r2, #0x80
    bne     .Lbad_pool
    bic     sp, r12, #7

    bl      .Lirq_save_disable
    mov     r8, r0
    /* Round up within the allocated pool: 1024-byte L2, then C stack space. */
    add     r6, r11, #1024
    sub     r6, r6, #1
    mov     r6, r6, lsr #10
    mov     r6, r6, lsl #10
    mov     r0, r6
    mov     r1, #1024
    mov     r2, #0
.Lzero_l2:
    str     r2, [r0], #4
    subs    r1, r1, #4
    bne     .Lzero_l2
    ldr     r0, =0x52000ff2
    str     r0, [r6, #0]
    ldr     r0, =0x4c000ff2
    str     r0, [r6, #4]
    ldr     r0, =0x56000ff2
    str     r0, [r6, #8]
    ldr     r0, =0x4a000ff2
    str     r0, [r6, #12]
    ldr     r0, =0x4d000ff2
    str     r0, [r6, #16]
    ldr     r0, =0x57000ff2
    str     r0, [r6, #20]

    ldr     r4, =L1_FLASH
    ldr     r5, =L1_IO
    ldr     r0, [r4]
    ldr     r1, [r5]
    orrs    r0, r0, r1
    bne     .Lbusy_slots
    ldr     r0, =0x00000c12
    str     r0, [r4]
    orr     r0, r6, #0x11
    str     r0, [r5]
    bl      .Lpublish_maps

    bl      hp39_rom_stream_main

    mov     r0, #0
    str     r0, [r4]
    str     r0, [r5]
    bl      .Lpublish_maps
.Lrestore_irq:
    mov     r0, r8
    bl      .Lirq_restore
    mov     sp, r9
    ldmfd   sp!, {r0-r12, pc}

.Lbusy_slots:
    mov     r0, #2
    bl      hp39_rom_stream_entry_error
    b       .Lrestore_irq
.Lbad_pool:
    /* This small leaf display path needs no private C stack or new mappings. */
    mov     r0, #1
    bl      hp39_rom_stream_entry_error
    mov     sp, r9
    ldmfd   sp!, {r0-r12, pc}
.size hp39_rom_stream, .-hp39_rom_stream

.type .Lirq_save_disable,%function
.Lirq_save_disable:
    stmfd   sp!, {r1-r5, lr}
    ldr     r2, =SWI_VECTOR
    adr     r3, .Ldisable_supervisor
    swp     r4, r3, [r2]
    swi     0
    ldmfd   sp!, {r1-r5, pc}
.Ldisable_supervisor:
    str     r4, [r2]
    mrs     r0, spsr
    orr     r1, r0, #0xc0
    msr     spsr_c, r1
    movs    pc, lr

.type .Lirq_restore,%function
.Lirq_restore:
    stmfd   sp!, {r1-r5, lr}
    ldr     r2, =SWI_VECTOR
    adr     r3, .Lrestore_supervisor
    swp     r4, r3, [r2]
    swi     0
    ldmfd   sp!, {r1-r5, pc}
.Lrestore_supervisor:
    str     r4, [r2]
    msr     spsr_cxsf, r0
    movs    pc, lr

.type .Lpublish_maps,%function
.Lpublish_maps:
    stmfd   sp!, {r0-r4, lr}
    ldr     r2, =SWI_VECTOR
    adr     r3, .Lmap_supervisor
    swp     r4, r3, [r2]
    swi     0
    ldmfd   sp!, {r0-r4, pc}
.Lmap_supervisor:
    str     r4, [r2]
    stmfd   sp!, {r0-r2, lr}
    mov     r0, r6
    add     r1, r6, #1024
.Lclean_l2:
    mcr     p15, 0, r0, c7, c10, 1
    add     r0, r0, #32
    cmp     r0, r1
    blo     .Lclean_l2
    ldr     r0, =L1_FLASH
    bic     r0, r0, #31
    mcr     p15, 0, r0, c7, c10, 1
    mov     r0, #0
    mcr     p15, 0, r0, c7, c10, 4
    mcr     p15, 0, r0, c8, c7, 0
    nop
    nop
    ldmfd   sp!, {r0-r2, lr}
    movs    pc, lr

/* Display writes live in the original uncached SRAM mapping. No cache flush
 * is needed there; this explicit helper is used for a RAM framebuffer too. */
.global hp39_rom_stream_clean
.type hp39_rom_stream_clean,%function
hp39_rom_stream_clean:
    stmfd   sp!, {r0-r4, lr}
    add     r1, r0, r1
    bic     r0, r0, #31
    ldr     r2, =SWI_VECTOR
    adr     r3, .Lclean_supervisor
    swp     r4, r3, [r2]
    swi     0
    ldmfd   sp!, {r0-r4, pc}
.Lclean_supervisor:
    str     r4, [r2]
    stmfd   sp!, {r0, lr}
.Lclean_screen:
    cmp     r0, r1
    bhs     .Lclean_done
    mcr     p15, 0, r0, c7, c10, 1
    add     r0, r0, #32
    b       .Lclean_screen
.Lclean_done:
    mov     r0, #0
    mcr     p15, 0, r0, c7, c10, 4
    ldmfd   sp!, {r0, lr}
    movs    pc, lr
