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
static void uart_tx_level(void) {
    const uint32_t tx = 2u, uart = 1u << 28;
    uint32_t value;
    uint8_t output[3];
    orchard_reset(&machine);
    machine.soc.wtcon = 0;
    CHECK(read_reg(0x50000010, &value) && value == 6u);
    ticks(1); CHECK(machine.soc.subsrcpnd == 0);
    CHECK(write_reg(0x50000004, 0x204)); /* TX polling/IRQ, level, non-FIFO. */
    ticks(1); o_irq_update(&machine.soc);
    CHECK(machine.soc.subsrcpnd == tx); /* Child latches under both masks. */
    CHECK(machine.soc.srcpnd == 0 && machine.soc.intpnd == 0);
    CHECK(write_reg(0x4a00001c, 0x7fdu));
    ticks(1); o_irq_update(&machine.soc);
    CHECK(machine.soc.srcpnd == uart && machine.soc.intpnd == 0);
    CHECK(write_reg(0x4a000008, ~uart));
    ticks(1); o_irq_update(&machine.soc);
    CHECK(machine.soc.intpnd == uart);
    /* Acknowledge every latch, with the empty level still asserted. */
    CHECK(write_reg(0x4a000018, tx));
    CHECK(write_reg(0x4a000000, uart));
    CHECK(write_reg(0x4a000010, uart));
    CHECK(machine.soc.subsrcpnd == 0 && machine.soc.srcpnd == 0 && machine.soc.intpnd == 0);
    ticks(1); o_irq_update(&machine.soc);
    CHECK(machine.soc.subsrcpnd == tx && machine.soc.srcpnd == uart && machine.soc.intpnd == uart);
    /* The host capture queue contains bytes that already left UTXH0. A host
       that has not drained them cannot make the hardware holding register full. */
    CHECK(o_phys_write(&machine, 0x50000020, 1, 0x00));
    CHECK(o_phys_write(&machine, 0x50000020, 1, 0xff));
    CHECK(o_phys_write(&machine, 0x50000020, 1, 0x41));
    CHECK(machine.soc.tx.count == 3);
    CHECK(read_reg(0x50000010, &value) && value == 6u);
    CHECK(write_reg(0x4a000018, tx));
    ticks(1); CHECK(machine.soc.subsrcpnd == tx && machine.soc.tx.count == 3);
    CHECK(orchard_uart_receive(&machine, output, sizeof output) == 3);
    CHECK(output[0] == 0 && output[1] == 0xff && output[2] == 0x41);
    CHECK(machine.soc.tx.count == 0 && machine.soc.subsrcpnd == tx);
    /* Disabling the source does not erase an interrupt that was latched. */
    CHECK(write_reg(0x50000004, 0));
    ticks(1); CHECK(machine.soc.subsrcpnd == tx);
    CHECK(write_reg(0x4a000018, tx));
    ticks(1); CHECK(machine.soc.subsrcpnd == 0);
    /* Disabled / RX-only / DMA / pulse modes do not synthesize an empty level;
       FIFO and other UART channels are outside this UART0 non-FIFO subset. */
    const uint32_t modes[] = {0, 1, 0x200, 0x201, 0x208, 0x20c, 4, 5};
    for (unsigned i = 0; i < sizeof modes / sizeof modes[0]; ++i) {
        CHECK(write_reg(0x50000004, modes[i]));
        CHECK(write_reg(0x4a000018, tx));
        ticks(3); CHECK(machine.soc.subsrcpnd == 0);
    }
    CHECK(write_reg(0x50000004, 0x705));
    CHECK(write_reg(0x50000008, 1));
    ticks(1); CHECK(machine.soc.subsrcpnd == 0);
    CHECK(write_reg(0x50000008, 0));
    ticks(1); CHECK(machine.soc.subsrcpnd == tx);
    CHECK(write_reg(0x50000004, 0));
    CHECK(write_reg(0x50004004, 0x204));
    CHECK(write_reg(0x50008004, 0x204));
    CHECK(write_reg(0x4a000018, 0x7ff));
    ticks(1); CHECK(machine.soc.subsrcpnd == 0);
    orchard_reset(&machine);
}
static void boot_sram_and_lcd(void) {
    orchard_reset(&machine);
    uint32_t value;
    uint8_t byte = 99, pixels[131 * 80];
    CHECK(o_phys_write(&machine, O_BOOT_SRAM_BASE, 4, 0x80402010));
    CHECK(o_phys_read(&machine, O_BOOT_SRAM_BASE + 3, 1, &value) && value == 0x80);
    CHECK(o_phys_write(&machine, O_BOOT_SRAM_BASE + O_BOOT_SRAM_SIZE - 2, 2, 0x1234));
    CHECK(!o_phys_write(&machine, O_BOOT_SRAM_BASE + O_BOOT_SRAM_SIZE - 1, 2, 0));
    CHECK(!o_phys_read(&machine, O_BOOT_SRAM_BASE - 1, 1, &value));
    CHECK(!o_phys_read(&machine, O_BOOT_SRAM_BASE + O_BOOT_SRAM_SIZE, 1, &value));
    CHECK(orchard_read_memory(&machine, O_BOOT_SRAM_BASE + 2, &byte, 1) == ORCHARD_OK && byte == 0x40);
    CHECK(orchard_read_memory(&machine, O_BOOT_SRAM_BASE + O_BOOT_SRAM_SIZE - 1, &byte, 2) == ORCHARD_BUS_ERROR);
    CHECK(write_reg(0x4d000004, 0)); /* One scan line, other output rows remain blank. */
    CHECK(write_reg(0x4d000014, O_BOOT_SRAM_BASE >> 1));
    CHECK(write_reg(0x4d000018, 10));
    CHECK(write_reg(0x4d00001c, 10));
    CHECK(write_reg(0x4d000000, 0x21));
    /* Independent lane order for BSWP/HWSWP combinations; first word only. */
    const unsigned offsets[4][4] = {{3,2,1,0}, {1,0,3,2}, {0,1,2,3}, {2,3,0,1}};
    for (unsigned swap = 0; swap < 4; ++swap) {
        CHECK(write_reg(0x4d000010, swap));
        CHECK(orchard_framebuffer(&machine, pixels, sizeof(pixels)) == ORCHARD_OK);
        for (unsigned x = 0; x < 32; ++x) {
            unsigned source_byte = offsets[swap][x / 8u];
            unsigned source_bit = 7u - x % 8u;
            CHECK(pixels[x] == (((0x80402010u >> (source_byte * 8u + source_bit)) & 1u) ? 255 : 0));
        }
        CHECK(pixels[131] == 0);
    }
    CHECK(write_reg(0x4d000000, 0x20)); /* Disable before changing scan mode. */
    CHECK(write_reg(0x4d000000, 1)); /* Dual scan is not single scan. */
    CHECK(orchard_framebuffer(&machine, pixels, sizeof(pixels)) == ORCHARD_UNSUPPORTED_LCD);
    orchard_reset(&machine);
    CHECK(o_phys_read(&machine, O_BOOT_SRAM_BASE, 4, &value) && value == 0);
    CHECK(write_reg(0x4d00004c, 0));
    CHECK(read_reg(0x4d00004c, &value) && value == 0);
    CHECK(!o_phys_read(&machine, 0x4d000068, 4, &value));
    CHECK(machine.stop.address == 0x4d000068 && machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    CHECK(orchard_get_profile(3)->flash_bytes == 0x200000u);
}
static void gpio_and_reset(void) {
    orchard_reset(&machine);
    uint32_t value;
    CHECK(read_reg(0x560000b4, &value) && value == 1);
    CHECK(write_reg(0x560000b4, 6));
    CHECK(read_reg(0x560000b4, &value) && value == 1);
    CHECK(write_reg(0x560000b4, 1));
    CHECK(read_reg(0x560000b4, &value) && value == 0);
    CHECK(write_reg(0x560000b4, 1));
    CHECK(read_reg(0x560000b4, &value) && value == 0);
    for (unsigned off = 0xb8; off <= 0xbc; off += 4) {
        CHECK(write_reg(0x56000000u + off, 0x12345678));
        CHECK(read_reg(0x56000000u + off, &value) && value == 0x12345678);
    }
    CHECK(read_reg(0x56000000, &value) && value == 0x7fffff);
    CHECK(read_reg(0x56000038, &value) && value == 0xf000);
    CHECK(read_reg(0x56000068, &value) && value == 0xf800);
    CHECK(read_reg(0x56000080, &value) && value == 0x10330);
    CHECK(write_reg(0x56000004, UINT32_MAX));
    CHECK(read_reg(0x56000004, &value) && value == 0x7fffff);
    CHECK(write_reg(0x56000030, 0x55555555)); /* Every GPD pin is an output. */
    CHECK(write_reg(0x56000034, 0x1234ffff));
    CHECK(read_reg(0x56000034, &value) && value == 0xffff);
    CHECK(write_reg(0x56000030, 0x55555554)); /* GPD0 now externally driven. */
    CHECK(!o_phys_read(&machine, 0x56000034, 4, &value));
    CHECK(machine.stop.address == 0x56000034 && machine.stop.detail == 1);
    orchard_reset(&machine);
    CHECK(read_reg(0x560000b4, &value) && value == 1);
    CHECK(read_reg(0x560000b8, &value) && value == 0);
    CHECK(write_reg(0x56000010, UINT32_MAX));
    CHECK(read_reg(0x56000010, &value) && value == 0x3fffff);
    CHECK(!o_phys_write(&machine, 0x560000bc, 2, 9));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    orchard_reset(&machine);
    CHECK(!o_phys_read(&machine, 0x56000094, 4, &value)); /* Reserved, not EINTFLT0. */
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
}
static unsigned interrupt_number(unsigned group, unsigned request) {
    static const int bases[6] = {-1,4,10,16,22,27};
    return (unsigned)(bases[group] + (int)request);
}
static void gpio_stimuli(void) {
    orchard_reset(&machine);
    const unsigned widths[8] = {0, 11, 16, 16, 16, 8, 16, 11};
    uint32_t value = 0;
    CHECK(orchard_gpio_inputs(NULL, ORCHARD_GPIO_D, 0, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)0, 0, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)8, 0, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)-1, 0, 0) == ORCHARD_BAD_ARGUMENT);
    for (unsigned port = 1; port <= 7; ++port) {
        uint32_t mask = (1u << widths[port]) - 1u, addr = 0x56000000u + port * 16u;
        uint32_t outputs = 0;
        for (unsigned bit = 0; bit < widths[port]; ++bit) outputs |= 1u << (bit * 2u);
        CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)port, mask, mask & 0x5555u) == ORCHARD_OK);
        CHECK(o_phys_read(&machine, addr + 4u, 4, &value) && value == (mask & 0x5555u));
        CHECK(o_phys_write(&machine, addr + 4u, 4, mask & 0xaaaau));
        CHECK(o_phys_read(&machine, addr + 4u, 4, &value) && value == (mask & 0x5555u));
        CHECK(o_phys_write(&machine, addr, 4, outputs));
        CHECK(o_phys_read(&machine, addr + 4u, 4, &value) && value == (mask & 0xaaaau));
        CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)port, mask + 1u, 0) == ORCHARD_BAD_ARGUMENT);
        CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)port, mask, mask + 1u) == ORCHARD_BAD_ARGUMENT);
        CHECK(machine.soc.gpio_input_levels[port] == (mask & 0x5555u));
        CHECK(o_phys_write(&machine, addr, 4, 0));
        CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)port, mask & ~1u, 0) == ORCHARD_OK);
        CHECK(!o_phys_read(&machine, addr + 4u, 4, &value));
        CHECK(machine.stop.detail == 1 && machine.stop.address == addr + 4u);
        o_zero(&machine.stop, sizeof(machine.stop));
        CHECK(orchard_gpio_inputs(&machine, (orchard_gpio_port)port, 0, 0) == ORCHARD_OK);
        CHECK(!o_phys_read(&machine, addr + 4u, 4, &value) && machine.stop.detail == mask);
        o_zero(&machine.stop, sizeof(machine.stop));
    }
    /* Independently generated ARM RMW sequence: all 2048 external combinations
       leave the actual output pins unchanged. This is a bounded property,
       not proof of a board's idle levels or arbitrary future execution. */
    const uint32_t input_mask = 0xcc7f, output_mask = 0x3380;
    for (unsigned variant = 0; variant < 2048; ++variant) {
        uint32_t levels = 0;
        unsigned index = 0;
        for (unsigned pin = 0; pin < 16; ++pin) if (input_mask & (1u << pin))
            levels |= ((variant >> index++) & 1u) << pin;
        o_gpio_reset(&machine.soc);
        CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_D, input_mask, levels) == ORCHARD_OK);
        CHECK(o_phys_write(&machine, 0x56000030, 4, 0x05054000));
        instruction(0xe5941034u, false, 0x100); /* LDR r1,[r4,#0x34] */
        put_word(machine.ram + 0x104, 0xe0010000u); /* AND r0,r1,r0 */
        put_word(machine.ram + 0x108, 0xe3800c03u); /* ORR r0,r0,#0x300 */
        put_word(machine.ram + 0x10c, 0xe5860000u); /* STR r0,[r6] */
        machine.cpu.r[0] = input_mask; machine.cpu.r[4] = 0x56000000; machine.cpu.r[6] = 0x56000034;
        for (unsigned i = 0; i < 4; ++i) o_cpu_step(&machine);
        CHECK(machine.stop.status == ORCHARD_OK && machine.cpu.r[15] == O_RAM_BASE + 0x110);
        CHECK((machine.soc.gpio[0x34 / 4] & output_mask) == 0x300);
        CHECK(o_phys_read(&machine, 0x56000034, 4, &value) && value == (levels | 0x300));
        CHECK(machine.soc.srcpnd == 0); /* Read-level stimuli do not implement EINT. */
    }
    orchard_reset(&machine);
    CHECK(machine.soc.gpio_input_known[3] == 0 && machine.soc.gpio_input_levels[3] == 0);
    CHECK(!o_phys_read(&machine, 0x56000034, 4, &value));
    CHECK(machine.stop.detail == 0xffff);
}
static void interrupt_arbitration(void) {
    uint32_t value;
    orchard_reset(&machine);
    CHECK(read_reg(0x4a00000c, &value) && value == 0x7f);
    for (unsigned group = 0; group < 6; ++group) {
        for (unsigned selector = 0; selector < 4; ++selector) {
            for (unsigned mask = 1; mask < 64; ++mask) {
                unsigned present = mask;
                if (group == 0 || group == 5) present &= 30u;
                if (group == 1 || group == 4) present &= ~4u;
                if (!present) continue;
                orchard_reset(&machine);
                machine.soc.intmsk = 0;
                machine.soc.priority = selector << (7u + 2u * group); /* Fixed mode. */
                for (unsigned r = 0; r < 6; ++r) if (present & (1u << r))
                    machine.soc.srcpnd |= 1u << interrupt_number(group, r);
                const unsigned orders[4][6] = {{0,1,2,3,4,5},{0,2,3,4,1,5},{0,3,4,1,2,5},{0,4,1,2,3,5}};
                unsigned rank = 0;
                while (!(present & (1u << orders[selector][rank]))) ++rank;
                unsigned want = interrupt_number(group, orders[selector][rank]);
                o_irq_update(&machine.soc);
                CHECK(machine.soc.intpnd == (1u << want));
                CHECK(read_reg(0x4a000014, &value) && value == want);
            }
        }
    }
    for (unsigned sel = 0; sel < 4; ++sel) {
        orchard_reset(&machine);
        machine.soc.intmsk = 0;
        machine.soc.srcpnd = (1u<<4)|(1u<<10)|(1u<<16)|(1u<<22);
        machine.soc.priority = (sel << 19) | (1u << 6);
        o_irq_update(&machine.soc);
        CHECK(machine.soc.intpnd == (1u << (4u + 6u * sel)));
        uint32_t awarded = machine.soc.intpnd, priority = machine.soc.priority;
        o_irq_update(&machine.soc);
        CHECK(machine.soc.intpnd == awarded && machine.soc.priority == priority);
        CHECK(((priority >> 19) & 3u) == ((sel + 1u) & 3u));
    }
    orchard_reset(&machine);
    machine.soc.intmsk = 0;
    machine.soc.srcpnd = (1u << 6) | (1u << 24) | (1u << 9);
    machine.soc.intmod = 1u << 9;
    o_irq_update(&machine.soc);
    CHECK(machine.soc.intpnd == 0); /* Reserved sources and FIQ not awarded. */
    machine.soc.intmod = 0;
    o_irq_update(&machine.soc);
    CHECK(machine.soc.intpnd == (1u << 9));
}
static void rtc_edge(void) {
    machine.soc.rtc.divider = 32767;
    o_rtc_clock(&machine);
}
static void rtc_calendar(void) {
    orchard_reset(&machine);
    uint32_t value;
    CHECK(o_phys_read(&machine, 0x57000088, 4, &value) && value == 0);
    CHECK(o_phys_read(&machine, 0x5700007c, 1, &value) && value == 1);
    CHECK(o_phys_write(&machine, 0x57000070, 1, 0x12));
    CHECK(o_phys_read(&machine, 0x57000070, 1, &value) && value == 0); /* RTCEN=0. */
    CHECK(o_phys_write(&machine, 0x57000040, 1, 1));
    CHECK(o_phys_write(&machine, 0x57000070, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000074, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000078, 1, 0x23));
    CHECK(o_phys_write(&machine, 0x5700007c, 1, 0x28));
    CHECK(o_phys_write(&machine, 0x57000084, 1, 2));
    rtc_edge(); /* Leap year 2000, not 1900. */
    CHECK(machine.stop.status == ORCHARD_OK);
    CHECK(machine.soc.rtc.reg[15] == 0x29 && machine.soc.rtc.reg[12] == 0);
    CHECK(machine.soc.rtc.reg[14] == 0 && machine.soc.rtc.reg[16] == 1);
    CHECK(o_phys_write(&machine, 0x57000088, 1, 1));
    CHECK(o_phys_write(&machine, 0x5700007c, 1, 0x28));
    CHECK(o_phys_write(&machine, 0x57000070, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000074, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000078, 1, 0x23));
    rtc_edge();
    CHECK(machine.soc.rtc.reg[15] == 1 && machine.soc.rtc.reg[17] == 3);
    CHECK(o_phys_write(&machine, 0x57000088, 1, 0x99));
    CHECK(o_phys_write(&machine, 0x57000084, 1, 0x12));
    CHECK(o_phys_write(&machine, 0x5700007c, 1, 0x31));
    CHECK(o_phys_write(&machine, 0x57000070, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000074, 1, 0x59));
    CHECK(o_phys_write(&machine, 0x57000078, 1, 0x23));
    rtc_edge();
    CHECK(machine.soc.rtc.reg[18] == 0 && machine.soc.rtc.reg[17] == 1 && machine.soc.rtc.reg[15] == 1);
    CHECK(o_phys_write(&machine, 0x57000054, 1, 1));
    CHECK(o_phys_write(&machine, 0x57000050, 1, 0x41));
    rtc_edge();
    CHECK(machine.soc.srcpnd & (1u << 30));
    machine.soc.srcpnd = 0;
    CHECK(o_phys_write(&machine, 0x57000044, 1, 0x81)); /* 2 / 128 second. */
    machine.soc.rtc.divider = 0;
    for (unsigned i = 0; i < 511; ++i) o_rtc_clock(&machine);
    CHECK(!(machine.soc.srcpnd & (1u << 8)));
    o_rtc_clock(&machine);
    CHECK(machine.soc.srcpnd & (1u << 8));
    orchard_reset(&machine);
    for (unsigned i = 0; i < O_FUNCTIONAL_TIMEBASE_HZ; ++i) o_rtc_tick(&machine);
    CHECK(machine.soc.rtc.reg[12] == 1 && machine.soc.rtc.phase == 0 && machine.soc.rtc.divider == 0);
    CHECK(o_phys_write(&machine, 0x57000040, 1, 9));
    rtc_edge();
    CHECK(machine.soc.rtc.reg[12] == 1);
    CHECK(!o_phys_write(&machine, 0x57000040, 1, 7));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO && machine.soc.rtc.reg[0] == 9);
    orchard_reset(&machine);
    CHECK(!o_phys_read(&machine, 0x57000071, 1, &value));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    orchard_reset(&machine);
    CHECK(!o_phys_read(&machine, 0x57000070, 2, &value));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
}

static void keyboard_and_eint(void) {
    orchard_reset(&machine);
    CHECK(orchard_keyboard_matrix(&machine, 0, 0, true) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_keyboard_attach(NULL, true) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(orchard_keyboard_matrix(&machine, 8, 0, true) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_keyboard_matrix(&machine, 0, 7, true) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_keyboard_dedicated(&machine, 7, true) == ORCHARD_BAD_ARGUMENT);
    uint32_t value;
    /* Initial floating GPG11..15 and unrelated GPG0 are not guessed. */
    CHECK(!o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK(machine.stop.detail == 0xf801);
    orchard_reset(&machine);
    CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_G, 1, 0) == ORCHARD_OK);
    CHECK(o_phys_write(&machine, 0x56000068, 4, 1));
    /* Every raw matrix switch: selected column pulls exactly one row low.
       Other seven columns remain high-impedance inputs with weak pull-ups. */
    for (unsigned col = 0; col < 8; ++col) for (unsigned row = 0; row < 7; ++row) {
        CHECK(orchard_keyboard_matrix(&machine, col, row, true) == ORCHARD_OK);
        for (unsigned selected = 0; selected < 8; ++selected) {
            CHECK(o_phys_write(&machine, 0x56000060, 4, 1u | (1u << (16u + selected * 2u))));
            CHECK(o_phys_write(&machine, 0x56000064, 4, 0));
            CHECK(o_phys_read(&machine, 0x56000064, 4, &value));
            CHECK((value & 0xfeu) == (selected == col ? 0xfeu ^ (1u << (row + 1)) : 0xfeu));
        }
        CHECK(orchard_keyboard_matrix(&machine, col, row, false) == ORCHARD_OK);
    }
    /* A three-switch rectangle propagates through a floating column (ghost).
       This is a passive switch topology test, not a six-board diode survey. */
    CHECK(o_phys_write(&machine, 0x56000060, 4, 0x10001));
    CHECK(orchard_keyboard_matrix(&machine, 0, 0, true) == ORCHARD_OK);
    CHECK(orchard_keyboard_matrix(&machine, 1, 0, true) == ORCHARD_OK);
    CHECK(orchard_keyboard_matrix(&machine, 1, 1, true) == ORCHARD_OK);
    CHECK(o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK((value & 6u) == 0);
    CHECK(orchard_keyboard_matrix(&machine, 1, 0, false) == ORCHARD_OK);
    CHECK(o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK((value & 6u) == 4);
    /* Conflicting external drive must not be hidden by the keyboard model. */
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_G, 3, 2) == ORCHARD_OK);
    CHECK(!o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK(machine.stop.status == ORCHARD_GPIO_CONTENTION);
    orchard_reset(&machine);
    CHECK(!machine.soc.keyboard_attached && !machine.soc.keyboard_switches);
    CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_F, 0x8e, 0) == ORCHARD_OK);
    /* GPF direct keys are active high, with a known released baseline. */
    const unsigned pins[] = {0, 4, 5, 6};
    for (unsigned i = 0; i < 4; ++i) {
        CHECK(orchard_keyboard_dedicated(&machine, pins[i], true) == ORCHARD_OK);
        CHECK(o_phys_read(&machine, 0x56000054, 4, &value));
        CHECK(value == (1u << pins[i]));
        CHECK(orchard_keyboard_dedicated(&machine, pins[i], false) == ORCHARD_OK);
    }
    /* Test every EXTINT trigger encoding via GPF4, grouped IRQ4. */
    for (unsigned mode = 0; mode < 8; ++mode) {
        orchard_reset(&machine);
        CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
        CHECK(o_phys_write(&machine, 0x56000050, 4, 2u << 8));
        CHECK(o_phys_write(&machine, 0x56000088, 4, mode << 16));
        CHECK(o_phys_write(&machine, 0x560000a4, 4, 0));
        o_eint_tick(&machine);
        CHECK(((machine.soc.gpio[0xa8 / 4] & 16u) != 0) == (mode == 0));
        machine.soc.gpio[0xa8 / 4] = machine.soc.srcpnd = 0;
        CHECK(orchard_keyboard_dedicated(&machine, 4, true) == ORCHARD_OK);
        o_eint_tick(&machine);
        bool rising = mode == 1 || mode >= 4;
        CHECK(((machine.soc.gpio[0xa8 / 4] & 16u) != 0) == rising);
        CHECK(((machine.soc.srcpnd & 16u) != 0) == rising);
        machine.soc.gpio[0xa8 / 4] = machine.soc.srcpnd = 0;
        o_eint_tick(&machine);
        CHECK(((machine.soc.gpio[0xa8 / 4] & 16u) != 0) == (mode == 1));
        machine.soc.gpio[0xa8 / 4] = machine.soc.srcpnd = 0;
        CHECK(orchard_keyboard_dedicated(&machine, 4, false) == ORCHARD_OK);
        o_eint_tick(&machine);
        CHECK(((machine.soc.gpio[0xa8 / 4] & 16u) != 0) == (mode == 0 || mode == 2 || mode == 3 || mode >= 6));
    }
    /* Matrix rows remain readable as EINT inputs. IRQ5 pend survives masking. */
    orchard_reset(&machine); CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(o_phys_write(&machine, 0x56000068, 4, 1));
    CHECK(o_phys_write(&machine, 0x56000060, 4, 0x5555aaa9));
    CHECK(o_phys_write(&machine, 0x5600008c, 4, 0x22222222));
    o_eint_tick(&machine);
    CHECK(orchard_keyboard_matrix(&machine, 0, 0, true) == ORCHARD_OK);
    CHECK(o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK(!(value & 2));
    o_eint_tick(&machine);
    CHECK(machine.soc.gpio[0xa8 / 4] & (1u << 9)); CHECK(!(machine.soc.srcpnd & 32));
    CHECK(o_phys_write(&machine, 0x560000a4, 4, 0)); o_eint_tick(&machine);
    CHECK(machine.soc.srcpnd & 32);
    CHECK(o_phys_write(&machine, 0x560000a8, 4, 1u << 9));
    CHECK(o_phys_write(&machine, 0x4a000000, 4, 32)); o_eint_tick(&machine);
    CHECK(!(machine.soc.srcpnd & 32));
    /* Pin reconfiguration does not invent an edge or reset another port's history. */
    CHECK(o_phys_write(&machine, 0x56000050, 4, 2));
    CHECK(o_phys_write(&machine, 0x56000088, 4, 4)); o_eint_tick(&machine);
    CHECK(o_phys_write(&machine, 0x56000060, 4, 0x10001));
    CHECK(orchard_keyboard_dedicated(&machine, 0, true) == ORCHARD_OK); o_eint_tick(&machine);
    CHECK(machine.soc.srcpnd & 1);
    CHECK(o_phys_write(&machine, 0x56000060, 4, 2u << 16));
    CHECK(o_phys_write(&machine, 0x56000090, 4, 8)); o_eint_tick(&machine);
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    orchard_reset(&machine);
    CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_G, 1, 0) == ORCHARD_OK);
    CHECK(o_phys_write(&machine, 0x56000068, 4, 1));
    CHECK(o_phys_write(&machine, 0x56000060, 4, 3u << 16));
    CHECK(orchard_keyboard_matrix(&machine, 0, 0, true) == ORCHARD_OK);
    CHECK(!o_phys_read(&machine, 0x56000064, 4, &value));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO && machine.stop.detail == 2);
    orchard_reset(&machine);
}
static void nor_identification(void) {
    orchard_reset(&machine);
    CHECK(orchard_nor_select(NULL, ORCHARD_NOR_SST39VF1601) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_nor_select(&machine, (orchard_nor_device)99) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_nor_select(&machine, ORCHARD_NOR_SST39VF1601) == ORCHARD_OK);
    put_word(machine.flash, 0xea000006);
    uint32_t value;
    CHECK(o_phys_write(&machine, 0x1aaaa, 2, 0xffaa)); /* Higher address/data lines ignored. */
    CHECK(o_phys_write(&machine, 0x25554, 2, 0xee55));
    CHECK(o_phys_write(&machine, 0x3aaaa, 2, 0xab90));
    CHECK(o_phys_read(&machine, 0, 2, &value) && value == 0xbf);
    CHECK(o_phys_read(&machine, 2, 2, &value) && value == 0x234b);
    CHECK(o_phys_read(&machine, 0, 4, &value) && value == 0x234b00bf);
    CHECK(o_phys_read(&machine, 3, 1, &value) && value == 0x23);
    uint8_t original[4];
    CHECK(orchard_read_memory(&machine, 0, original, 4) == ORCHARD_OK &&
          original[0] == 6 && original[1] == 0 && original[2] == 0 && original[3] == 0xea);
    CHECK(o_phys_write(&machine, 0x1fe, 2, 0xf0));
    CHECK(o_phys_read(&machine, 0, 4, &value) && value == 0xea000006);
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0xaa));
    CHECK(o_phys_write(&machine, 0x5554, 2, 0x55));
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0x90));
    orchard_reset(&machine);
    CHECK(machine.nor_device == ORCHARD_NOR_SST39VF1601 && !machine.nor_id_mode && machine.nor_sequence == 0);
    CHECK(o_phys_read(&machine, 0, 4, &value) && value == 0xea000006);
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0xaa));
    CHECK(o_phys_write(&machine, 0x5555, 2, 0x55) == false); /* Physical API does not round odd writes. */
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_FLASH);
    orchard_reset(&machine);
    CHECK(o_phys_write(&machine, 0x5554, 2, 0x55)); /* Wrong order aborts SDP to read mode. */
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0x90));
    CHECK(!machine.nor_id_mode);
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0xaa));
    CHECK(o_phys_write(&machine, 0x5554, 2, 0x55));
    CHECK(!o_phys_write(&machine, 0xaaaa, 2, 0xa0));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_FLASH && machine.nor_sequence == 2);
    orchard_reset(&machine); CHECK(orchard_nor_select(&machine, ORCHARD_NOR_UNSPECIFIED) == ORCHARD_OK);
    CHECK(orchard_init(&machine, sizeof(machine), 1) != NULL);
    CHECK(orchard_nor_select(&machine, ORCHARD_NOR_SST39VF1601) == ORCHARD_BAD_ARGUMENT);
    CHECK(machine.nor_device == ORCHARD_NOR_UNSPECIFIED);
    CHECK(orchard_init(&machine, sizeof(machine), 6) != NULL);
    CHECK(orchard_nor_select(&machine, ORCHARD_NOR_SST39VF1601) == ORCHARD_OK);
    CHECK(!o_phys_write(&machine, 0xaaaa, 1, 0xaa));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_FLASH && machine.nor_sequence == 0);
    orchard_reset(&machine);
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0xaa));
    CHECK(o_phys_write(&machine, 0x5554, 2, 0x55));
    CHECK(o_phys_write(&machine, 0xaaaa, 2, 0x90));
    CHECK(!o_phys_read(&machine, 4, 2, &value));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_FLASH);
    orchard_reset(&machine);
    CHECK(orchard_nor_select(&machine, ORCHARD_NOR_UNSPECIFIED) == ORCHARD_OK);

}

EXPORT("regression") unsigned orchard_regression(void) {
    checks = failures = first_failure = 0; seed = 0x09202410;
    if (!orchard_init(&machine, sizeof(machine), 6)) return 1;
    arithmetic(); shifter(); conditions(); decoded_arithmetic(); instruction_edges();
    banking_and_exception(); mmu_and_bus(); watchdog(); queues_and_profiles(); uart_tx_level();
    boot_sram_and_lcd(); gpio_and_reset(); gpio_stimuli(); interrupt_arbitration(); rtc_calendar(); keyboard_and_eint(); nor_identification();
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
