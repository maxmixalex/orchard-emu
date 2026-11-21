/* SPDX-License-Identifier: MIT
 * Fixed ARMv4T undefined-instruction cases and executable exception handlers.
 * Expectations: ARM920T DDI 0151C 2.2.2/2.3.2 and ARM DDI 0100I
 * A2.6.3/A3.16. Decode values are fixed independently of the core classifier.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif

static orchard_machine machine;
static unsigned checks, failures, first_failure;
static void check(bool value, unsigned line) {
    ++checks;
    if (!value) { if (!failures) first_failure = line; ++failures; }
}
#define CHECK(value) check((value), __LINE__)
static void put(uint8_t *bytes, uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) bytes[i] = (uint8_t)(value >> (i * 8));
}
static void (*step)(orchard_machine *);

static void prepare(uint32_t op, bool thumb, bool high, uint32_t status) {
    CHECK(orchard_init(&machine, sizeof machine, 1) != NULL);
    o_cpu *c = &machine.cpu;
    o_set_cpsr(c, status | (thumb ? O_T : 0));
    c->r[15] = O_RAM_BASE + 0x100 + (thumb ? 2u : 0);
    for (unsigned i = 0; i < 15; ++i) c->r[i] = 0x12340000u + i;
    c->r[4] = O_RAM_BASE + 0x300;
    c->bank[3][0] = O_RAM_BASE + 0x1000; /* UND stack. */
    c->far = 0x11223344; c->dfsr = 5; c->ifsr = 7;
    put(machine.ram + (c->r[15] - O_RAM_BASE), op);
    if (thumb) {
        machine.ram[0x104] = 1; machine.ram[0x105] = 0x33; /* ADDS r3,#1 */
    } else put(machine.ram + 0x104, 0xe2833001); /* ADD r3,r3,#1 */
    uint8_t *vector = machine.flash + 4;
    if (high) {
        c->control |= 0x2001; c->ttb = O_RAM_BASE + 0x4000; c->domain = 3;
        /* Identity-map guest SRAM; map high-vector page to SRAM + 0x1000. */
        put(machine.ram + 0x4000 + 0x80 * 4, O_RAM_BASE | 0xc02);
        put(machine.ram + 0x4000 + 0xfff * 4, (O_RAM_BASE + 0x8000) | 1);
        put(machine.ram + 0x8000 + 0xf0 * 4, (O_RAM_BASE + 0x1000) | 0xff2);
        vector = machine.ram + 0x1004;
    }
    static const uint32_t handler[] = {
        0xe584e000, /* STR lr,[r4] */
        0xe14f1000, /* MRS r1,SPSR */
        0xe5841004, /* STR r1,[r4,#4] */
        0xe10f2000, /* MRS r2,CPSR */
        0xe5842008, /* STR r2,[r4,#8] */
        0xe3a0306d, /* MOV r3,#109: emulate an instruction result. */
        0xe1b0f00e, /* MOVS pc,lr: return to the original ARM/Thumb program. */
    };
    for (unsigned i = 0; i < sizeof handler / sizeof *handler; ++i)
        put(vector + i * 4, handler[i]);
}

static void entry_return(uint32_t op, bool thumb, bool high, uint32_t status) {
    prepare(op, thumb, high, status);
    o_cpu before = machine.cpu, *c = &machine.cpu;
    uint32_t link = before.r[15] + (thumb ? 2u : 4u);
    uint32_t expected = (before.cpsr & ~(31u | O_T)) | O_UND | O_I;
    step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(c->r[15] == (high ? 0xffff0004u : 4u));
    CHECK(c->r[14] == link && c->r[13] == O_RAM_BASE + 0x1000);
    CHECK(c->cpsr == expected);
    CHECK(o_spsr(c) && *o_spsr(c) == before.cpsr);
    CHECK(c->instructions == 1 && c->exceptions == 1 && !c->sleeping);
    CHECK(c->r[0] == before.r[0] && c->r[4] == before.r[4]);
    CHECK(c->far == before.far && c->dfsr == before.dfsr && c->ifsr == before.ifsr);
    CHECK(c->control == before.control && c->ttb == before.ttb && c->domain == before.domain);
    if (machine.stop.status != ORCHARD_OK || c->r[15] != (high ? 0xffff0004u : 4u)) return;
    for (unsigned i = 0; i < 7; ++i) step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(c->r[15] == link && c->cpsr == before.cpsr);
    CHECK(c->r[13] == before.r[13] && c->r[14] == before.r[14]);
    for (unsigned r = 8; r < 13; ++r) CHECK(c->r[r] == before.r[r]);
    CHECK(o_read_le(machine.ram + 0x300, 4) == link);
    CHECK(o_read_le(machine.ram + 0x304, 4) == before.cpsr);
    CHECK(o_read_le(machine.ram + 0x308, 4) == expected);
    CHECK(c->instructions == 8 && c->exceptions == 1 && c->r[3] == 109);
    step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK && c->r[3] == 110);
    CHECK(c->r[15] == link + (thumb ? 2u : 4u));
    CHECK(c->instructions == 9 && c->exceptions == 1);
}

static void defined_traps(void) {
    static const uint32_t arm_words[] = {
        0xe6000010, /* Original permanently undefined load/store space. */
        0xe7f0def0, /* Software UDF encoding. */
        0xe16f0f10, /* CLZ: ARMv5, control extension. */
        0xe12fff30, /* BLX r0: ARMv5, control extension. */
        0xe1200070, /* BKPT: ARMv5, control extension. */
        0xe1000050, /* QADD: ARMv5E, arithmetic extension. */
        0xe0400090, /* Unallocated ARMv4 multiply decode. */
        0xe1c000d0, /* LDRD: ARMv5E load/store extension. */
        0xec400000, /* Coprocessor double-register extension. */
        0xee100010, /* MRC p0: no coprocessor attached. */
        0xee000000, /* CDP p0: no coprocessor attached. */
        0xed900000, /* LDC p0: no coprocessor attached. */
        0xee000f00, /* CDP p15 is undefined on ARM920T. */
        0xed900f00, /* LDC p15 is undefined on ARM920T. */
        0xed800f00, /* STC p15 is undefined on ARM920T. */
    };
    static const uint16_t thumb_words[] = {0xde00, 0xdeff, 0xb100, 0xbe00, 0xe800, 0x4780};
    static const uint32_t modes[] = {O_USR, O_SYS, O_SVC, O_FIQ};
    for (unsigned high = 0; high < 2; ++high)
    for (unsigned masked = 0; masked < 2; ++masked)
    for (unsigned mode = 0; mode < sizeof modes / sizeof *modes; ++mode) {
        uint32_t status = modes[mode] | O_N | O_C | (masked ? O_F : 0);
        for (unsigned i = 0; i < sizeof arm_words / sizeof *arm_words; ++i)
            entry_return(arm_words[i], false, high != 0, status);
        for (unsigned i = 0; i < sizeof thumb_words / sizeof *thumb_words; ++i)
            entry_return(thumb_words[i], true, high != 0, status);
        if (modes[mode] == O_USR) {
            entry_return(0xee100f10, false, high != 0, status); /* MRC ID */
            entry_return(0xee010f10, false, high != 0, status); /* MCR control */
            entry_return(0xee070f90, false, high != 0, status); /* MCR WFI */
        }
    }
}

static void boundaries(void) {
    static const struct {uint32_t op; bool thumb; orchard_status result;} cases[] = {
        {0xe10f0100, false, ORCHARD_UNPREDICTABLE}, /* Malformed MRS: same decode. */
        {0xe1200010, false, ORCHARD_UNPREDICTABLE}, /* Malformed BX: same decode. */
        {0xe0000190, false, ORCHARD_UNPREDICTABLE}, /* MUL Rm/destination overlap. */
        {0xe1d0f0b0, false, ORCHARD_UNPREDICTABLE}, /* LDRH PC. */
        {0xee140f10, false, ORCHARD_UNSUPPORTED_CP15}, /* Reserved CP15 register. */
        {0xee100e10, false, ORCHARD_UNSUPPORTED_CP15}, /* Unmodeled on-chip CP14. */
        {0x4701, true, ORCHARD_UNPREDICTABLE}, /* BX reserved low bits. */
        {0xb400, true, ORCHARD_UNPREDICTABLE}, /* PUSH empty list. */
        {0xc000, true, ORCHARD_UNPREDICTABLE}, /* STM empty list. */
    };
    for (unsigned i = 0; i < sizeof cases / sizeof *cases; ++i) {
        prepare(cases[i].op, cases[i].thumb, false, O_SVC);
        o_cpu before = machine.cpu;
        step(&machine);
        CHECK(machine.stop.status == cases[i].result);
        CHECK(machine.cpu.r[15] == before.r[15] && machine.cpu.cpsr == before.cpsr);
        CHECK(machine.cpu.instructions == 0 && machine.cpu.exceptions == 0);
    }
    static const uint32_t skipped[] = {0x06000010, 0x016f0f10, 0x0e100f10, 0xf6000010};
    for (unsigned i = 0; i < sizeof skipped / sizeof *skipped; ++i) {
        prepare(skipped[i], false, false, O_USR); /* EQ with Z=0, and ARMv4T NV. */
        step(&machine);
        CHECK(machine.stop.status == ORCHARD_OK);
        CHECK(machine.cpu.cpsr == O_USR && machine.cpu.r[15] == O_RAM_BASE + 0x104);
        CHECK(machine.cpu.instructions == 1 && machine.cpu.exceptions == 0);
    }
}

EXPORT("regression") unsigned run(void) {
    checks = failures = first_failure = 0;
    for (unsigned reference = 0; reference < 2; ++reference) {
        step = reference ? o_cpu_step_reference : o_cpu_step;
        defined_traps(); boundaries();
    }
    return failures;
}
EXPORT("checks") unsigned get_checks(void) { return checks; }
EXPORT("first_failure") unsigned get_first(void) { return first_failure; }
#ifndef __wasm__
int main(void) {
    unsigned result = run();
    printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n", checks, result, first_failure);
    return result ? 1 : 0;
}
#endif
