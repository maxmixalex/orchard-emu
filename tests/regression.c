/* SPDX-License-Identifier: MIT
 * Original, ROM-free checks. Reference: Samsung S3C2410A manual (2004),
 * chapters 2-4 and 18. Counts are assertions, not CPU conformance coverage.
 * The same source executes natively and in a test-only WASM module.
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
static uint32_t seed;
static void check(bool ok, unsigned line) {
    ++checks;
    if (!ok) {
        if (!failures) first_failure = line;
        ++failures;
#ifndef __wasm__
        if (failures <= 16) fprintf(stderr, "regression.c:%u failed\n", line);
#endif
    }
}
#define CHECK(condition) check((condition), __LINE__)
static uint32_t random_word(void) {
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
    return seed;
}
static void put_word(uint8_t *p, uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (8u * i));
}
static void instruction(uint32_t op, bool thumb, unsigned offset) {
    o_cpu_reset(&machine.cpu);
    o_zero(&machine.stop, sizeof(machine.stop));
    machine.cpu.cpsr |= thumb ? O_T : 0;
    machine.cpu.r[15] = O_RAM_BASE + offset;
    put_word(machine.ram + offset, op);
}
static int64_t signed_word(uint32_t word) {
    return (word & O_N) ? (int64_t)word - INT64_C(4294967296) : (int64_t)word;
}
static void arithmetic(void) {
    o_cpu c;
    o_cpu_reset(&c);
    for (unsigned i = 0; i < 10000; ++i) {
        uint32_t a = random_word(), b = random_word();
        unsigned cin = random_word() & 1u;
        uint64_t sum = (uint64_t)a + b + cin;
        int64_t signed_sum = signed_word(a) + signed_word(b) + cin;
        uint32_t value = (uint32_t)sum;
        c.cpsr = O_SVC | O_I | O_F | O_V;
        CHECK(o_add(&c, a, b, cin, true) == value);
        CHECK(((c.cpsr & O_C) != 0) == (sum > UINT32_MAX));
        CHECK(((c.cpsr & O_V) != 0) ==
              (signed_sum < INT64_C(-2147483648) || signed_sum > INT64_C(2147483647)));
        CHECK(((c.cpsr & O_N) != 0) == (value >= UINT32_C(0x80000000)));
        CHECK(((c.cpsr & O_Z) != 0) == (value == 0));
        CHECK((c.cpsr & 255u) == (O_SVC | O_I | O_F));
        uint32_t saved = c.cpsr;
        CHECK(o_add(&c, a, b, cin, false) == value && c.cpsr == saved);
    }
}
/* Deliberately iterative, independent of the core's closed-form barrel shifter. */
static uint32_t reference_shift(uint32_t value, unsigned kind, unsigned n,
                                bool immediate, bool *carry) {
    if (!n) {
        if (!immediate || kind == 0) return value;
        if (kind == 3) {
            uint32_t high = *carry ? O_N : 0;
            *carry = (value & 1u) != 0;
            return high | (value >> 1);
        }
        n = 32;
    }
    for (unsigned i = 0; i < n; ++i) {
        bool low = (value & 1u) != 0, high = (value & O_N) != 0;
        if (kind == 0) { *carry = high; value <<= 1; }
        else {
            *carry = low;
            value >>= 1;
            if ((kind == 2 && high) || (kind == 3 && low)) value |= O_N;
        }
    }
    return value;
}
static void shifter(void) {
    const unsigned amounts[] = {0, 1, 2, 15, 31, 32, 33, 63, 64, 255};
    for (unsigned i = 0; i < 40; ++i) {
        uint32_t value = i == 0 ? 0 : i == 1 ? UINT32_MAX : random_word();
        for (unsigned kind = 0; kind < 4; ++kind) {
            for (unsigned a = 0; a < sizeof(amounts) / sizeof(amounts[0]); ++a) {
                for (unsigned immediate = 0; immediate < 2; ++immediate) {
                    if (immediate && amounts[a] > 31) continue;
                    for (unsigned carry = 0; carry < 2; ++carry) {
                        bool actual = carry != 0, expected = actual;
                        uint32_t want = reference_shift(value, kind, amounts[a], immediate != 0, &expected);
                        CHECK(o_shift(value, kind, amounts[a], immediate != 0, &actual) == want);
                        CHECK(actual == expected);
                    }
                }
            }
        }
    }
}
static void conditions(void) {
    o_cpu c;
    o_cpu_reset(&c);
    for (unsigned flags = 0; flags < 16; ++flags) {
        bool n = (flags & 8u) != 0, z = (flags & 4u) != 0;
        bool carry = (flags & 2u) != 0, v = (flags & 1u) != 0;
        bool expected[] = {z, !z, carry, !carry, n, !n, v, !v, carry && !z,
            !carry || z, n == v, n != v, !z && n == v, z || n != v, true, false};
        c.cpsr = flags << 28;
        for (unsigned cond = 0; cond < 16; ++cond) CHECK(o_condition(&c, cond) == expected[cond]);
    }
}
static void decoded_arithmetic(void) {
    for (unsigned i = 0; i < 500; ++i) {
        uint32_t a = random_word(), b = random_word();
        instruction(0xe0902001u, false, 0x100); /* ADDS r2,r0,r1 */
        machine.cpu.r[0] = a; machine.cpu.r[1] = b;
        o_cpu_step(&machine);
        CHECK(machine.stop.status == ORCHARD_OK);
        CHECK(machine.cpu.r[2] == a + b);
        CHECK(machine.cpu.r[15] == O_RAM_BASE + 0x104);
        instruction(0x1842u, true, 0x100); /* ADDS r2,r0,r1 */
        machine.cpu.r[0] = a; machine.cpu.r[1] = b;
        o_cpu_step(&machine);
        CHECK(machine.stop.status == ORCHARD_OK);
        CHECK(machine.cpu.r[2] == a + b);
        CHECK(machine.cpu.r[15] == O_RAM_BASE + 0x102);
    }
}
static void instruction_edges(void) {
    instruction(0x4778u, true, 0x100); /* BX PC: legal at word alignment. */
    put_word(machine.ram + 0x104, 0xe3a0002au); /* MOV r0,#42 */
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(!(machine.cpu.cpsr & O_T) && machine.cpu.r[15] == O_RAM_BASE + 0x104);
    o_cpu_step(&machine);
    CHECK(machine.cpu.r[0] == 42 && machine.cpu.r[15] == O_RAM_BASE + 0x108);
    instruction(0x4778u, true, 0x102);
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_UNPREDICTABLE);
    CHECK(machine.cpu.r[15] == O_RAM_BASE + 0x102 && (machine.cpu.cpsr & O_T));
    instruction(0xe0000190u, false, 0x100); /* MUL r0,r0,r1: forbidden v4 overlap. */
    machine.cpu.r[0] = 3; machine.cpu.r[1] = 7;
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_UNPREDICTABLE && machine.cpu.r[0] == 3);
    instruction(0xe0020190u, false, 0x100); /* MUL r2,r0,r1 */
    machine.cpu.r[0] = 3; machine.cpu.r[1] = 7;
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK && machine.cpu.r[2] == 21);
    instruction(0xe0830190u, false, 0x100); /* UMULL r0,r3,r0,r1: bad RdLo/Rm. */
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_UNPREDICTABLE);
    instruction(0xe0823192u, false, 0x100); /* UMULL r3,r2,r2,r1: bad RdHi/Rm. */
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_UNPREDICTABLE);
    instruction(0xe0c32190u, false, 0x100); /* SMULL r2,r3,r0,r1 */
    machine.cpu.r[0] = UINT32_MAX; machine.cpu.r[1] = 2;
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(machine.cpu.r[2] == 0xfffffffeu && machine.cpu.r[3] == UINT32_MAX);
    instruction(0xe128f00fu, false, 0x100); /* MSR CPSR_f,PC: invalid operand. */
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_UNPREDICTABLE);
    instruction(0xe128f000u, false, 0x100);
    machine.cpu.r[0] = O_N | O_C;
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(machine.cpu.cpsr == (O_N | O_C | O_SVC | O_I | O_F));
}
static void banking_and_exception(void) {
    o_cpu *c = &machine.cpu;
    o_cpu_reset(c);
    for (unsigned r = 8; r < 15; ++r) c->r[r] = r + 100;
    o_set_cpsr(c, O_FIQ | O_I | O_F);
    for (unsigned r = 8; r < 15; ++r) {
        CHECK(c->r[r] == 0);
        c->r[r] = r + 200;
    }
    o_set_cpsr(c, O_SVC | O_I | O_F);
    for (unsigned r = 8; r < 15; ++r) CHECK(c->r[r] == r + 100);
    o_set_cpsr(c, O_FIQ | O_I | O_F);
    for (unsigned r = 8; r < 15; ++r) CHECK(c->r[r] == r + 200);
    instruction(0xdf00u, true, 0x100);
    o_set_cpsr(c, O_SYS | O_T | O_C);
    o_cpu_step(&machine);
    CHECK(c->r[15] == 8 && c->r[14] == O_RAM_BASE + 0x102);
    CHECK(c->cpsr == (O_SVC | O_I | O_C));
    CHECK(o_spsr(c) && *o_spsr(c) == (O_SYS | O_T | O_C));
    put_word(machine.flash + 8, 0xe1b0f00eu); /* MOVS PC,LR */
    o_cpu_step(&machine);
    CHECK(c->r[15] == O_RAM_BASE + 0x102 && c->cpsr == (O_SYS | O_T | O_C));
}
static void mmu_and_bus(void) {
    orchard_reset(&machine);
    uint32_t value, physical;
    CHECK(o_phys_write(&machine, O_RAM_BASE, 4, 0x12345678));
    CHECK(o_phys_read(&machine, O_RAM_BASE + 1, 1, &value) && value == 0x56);
    CHECK(!o_phys_read(&machine, O_RAM_BASE + machine.profile->ram_bytes, 4, &value));
    CHECK(o_load(&machine, O_RAM_BASE + 1, 4, false, &value) && value == 0x78123456);
    machine.cpu.control |= 2u;
    CHECK(!o_load(&machine, O_RAM_BASE + 1, 4, false, &value));
    CHECK(machine.cpu.data_abort && (machine.cpu.dfsr & 15u) == 1);
    orchard_reset(&machine);
    machine.cpu.ttb = O_RAM_BASE + 0x4000;
    machine.cpu.domain = 1; /* Domain 0 client. */
    machine.cpu.control |= 1;
    /* VA 0x10000000 -> SRAM; AP=1, privileged read/write only. */
    CHECK(o_phys_write(&machine, machine.cpu.ttb + 0x400, 4, O_RAM_BASE | 0x402));
    CHECK(o_translate(&machine, 0x10000010, false, false, false, &physical));
    CHECK(physical == O_RAM_BASE + 0x10);
    CHECK(!o_translate(&machine, 0x10000010, false, false, true, &physical));
    CHECK((machine.cpu.dfsr & 15u) == 13 && machine.cpu.far == 0x10000010);
    machine.cpu.domain = 0;
    CHECK(!o_translate(&machine, 0x10000010, true, false, false, &physical));
    CHECK((machine.cpu.dfsr & 15u) == 9);
    machine.cpu.domain = 3;
    CHECK(o_translate(&machine, 0x10000010, true, false, true, &physical));
    CHECK(!o_translate(&machine, 0x20000000, false, true, false, &physical));
    CHECK(machine.cpu.prefetch_abort && (machine.cpu.ifsr & 15u) == 5);
}
static bool write_reg(uint32_t address, uint32_t value) {
    bool ok = o_phys_write(&machine, address, 4, value);
    CHECK(ok);
    return ok;
}
static bool read_reg(uint32_t address, uint32_t *value) {
    bool ok = o_phys_read(&machine, address, 4, value);
    CHECK(ok);
    return ok;
}
static void ticks(unsigned n) { for (unsigned i = 0; i < n; ++i) o_soc_tick(&machine); }
static void watchdog(void) {
    uint32_t value;
    orchard_reset(&machine);
    if (!read_reg(0x53000000, &value)) return;
    CHECK(value == 0x8021);
    CHECK(read_reg(0x53000004, &value) && value == 0x8000);
    CHECK(read_reg(0x53000008, &value) && value == 0x8000);
    const unsigned prescalers[] = {0, 1, 255};
    for (unsigned mux = 0; mux < 4; ++mux) {
        for (unsigned i = 0; i < 3; ++i) {
            orchard_reset(&machine);
            unsigned divisor = (prescalers[i] + 1u) * (16u << mux);
            CHECK(write_reg(0x53000000, 0));
            CHECK(write_reg(0x53000004, 7)); /* Does not initialize WTCNT. */
            CHECK(read_reg(0x53000008, &value) && value == 0x8000);
            CHECK(write_reg(0x53000008, 2));
            CHECK(write_reg(0x53000000, (prescalers[i] << 8) | (mux << 3) | 0x24));
            ticks(divisor - 1);
            CHECK(read_reg(0x53000008, &value) && value == 2);
            ticks(1);
            CHECK(read_reg(0x53000008, &value) && value == 1);
            ticks(divisor);
            CHECK(read_reg(0x53000008, &value) && value == 7);
            CHECK((machine.soc.srcpnd & (1u << 9)) && machine.stop.status == ORCHARD_OK);
            CHECK(write_reg(0x4a000008, ~(1u << 9)));
            o_irq_update(&machine.soc);
            CHECK(machine.soc.intpnd == (1u << 9));
            CHECK(write_reg(0x53000000, 0));
            ticks(divisor * 2);
            CHECK(read_reg(0x53000008, &value) && value == 7);
        }
    }
    orchard_reset(&machine);
    CHECK(write_reg(0x53000004, UINT32_MAX));
    CHECK(read_reg(0x53000004, &value) && value == 0xffff);
    CHECK(write_reg(0x53000008, 1));
    CHECK(write_reg(0x53000000, 0x21)); /* Reset output is not implemented yet. */
    ticks(16);
    CHECK(machine.stop.status == (orchard_status)14);
    CHECK(machine.stop.address == 0x53000000);
    orchard_reset(&machine);
    CHECK(!o_phys_write(&machine, 0x53000000, 1, 0));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    orchard_reset(&machine);
    CHECK(!o_phys_read(&machine, 0x5300000c, 4, &value));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
}
static void queues_and_profiles(void) {
    uint8_t output[8];
    for (unsigned id = 1; id <= 6; ++id) {
        CHECK(orchard_init(&machine, sizeof(machine), id) == &machine);
        CHECK(orchard_run(&machine, 1).status == ORCHARD_NO_ROM);
        CHECK(orchard_load_rom(&machine, machine.flash, 1) == ORCHARD_BAD_ROM_SIZE);
        put_word(machine.flash, 0xeafffffeu); /* Synthetic reset vector loops. */
        CHECK(orchard_load_rom(&machine, machine.flash, machine.profile->flash_bytes) == ORCHARD_OK);
        CHECK(orchard_run(&machine, 32).status == ORCHARD_OK);
        CHECK(machine.cpu.r[15] == 0 && machine.cpu.instructions == 32 && machine.ticks == 32);
        CHECK(orchard_run(&machine, 0).status == ORCHARD_OK && machine.ticks == 32);
        CHECK(orchard_uart_send(&machine, (const uint8_t *)"abc", 3) == 3);
        uint32_t value;
        CHECK(o_phys_read(&machine, 0x50000024, 1, &value) && value == 'a');
        CHECK(o_phys_write(&machine, 0x50000020, 1, 'z'));
        CHECK(orchard_uart_receive(&machine, output, sizeof(output)) == 1 && output[0] == 'z');
        CHECK(!o_phys_read(&machine, O_RAM_BASE + machine.profile->ram_bytes, 1, &value));
        orchard_reset(&machine);
        CHECK(machine.ticks == 0 && machine.loaded && machine.soc.rx.count == 0);
    }
}
EXPORT("regression") unsigned orchard_regression(void) {
    checks = failures = first_failure = 0; seed = 0x09202410;
    if (!orchard_init(&machine, sizeof(machine), 6)) return 1;
    arithmetic(); shifter(); conditions(); decoded_arithmetic(); instruction_edges();
    banking_and_exception(); mmu_and_bus(); watchdog(); queues_and_profiles();
    return failures;
}
EXPORT("checks") unsigned orchard_regression_checks(void) { return checks; }
EXPORT("first_failure") unsigned orchard_regression_first_failure(void) { return first_failure; }
#ifndef __wasm__
int main(void) {
    unsigned failed = orchard_regression();
    printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u,\"seed\":153101328}\n",
           checks, failed, first_failure);
    return failed ? 1 : 0;
}
#endif
