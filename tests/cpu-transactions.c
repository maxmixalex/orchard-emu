/* SPDX-License-Identifier: MIT
 * Transactional CPU rollback versus the retained full-checkpoint dispatcher.
 * Exhaustive Thumb decode, all halfword addressing flags, and directed partial
 * multiple transfers/MMIO descriptor failures. No firmware is required.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#include <string.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif

static orchard_machine fast, reference;
static unsigned checks, failures, first_failure;

static void check(bool value, unsigned line) {
    ++checks;
    if (!value) { if (!failures) first_failure = line; ++failures; }
}
#define CHECK(value) check((value), __LINE__)

static bool equal(const void *a, const void *b, size_t size) {
#ifndef __wasm__
    return memcmp(a, b, size) == 0;
#else
    const uint8_t *x = a, *y = b;
    for (size_t i = 0; i < size; ++i) if (x[i] != y[i]) return false;
    return true;
#endif
}
static uint32_t random_word(uint32_t *seed) {
    *seed ^= *seed << 13; *seed ^= *seed >> 17; *seed ^= *seed << 5;
    return *seed;
}
static void initialize(void) {
    CHECK(orchard_init(&fast, sizeof fast, 1) != NULL);
    CHECK(orchard_init(&reference, sizeof reference, 1) != NULL);
}
static o_cpu cpu_state(bool thumb, uint32_t *seed) {
    static const unsigned modes[] = {O_USR, O_SYS, O_FIQ, O_IRQ, O_SVC, O_ABT, O_UND};
    o_cpu c;
    o_cpu_reset(&c);
    uint32_t bits = random_word(seed);
    c.cpsr = (bits & 0xf00000c0u) | modes[bits % 7] | (thumb ? O_T : 0);
    for (unsigned i = 0; i < 15; ++i) c.r[i] = random_word(seed);
    for (unsigned i = 0; i < 7; ++i) {
        c.usr[i] = random_word(seed); c.fiq[i] = random_word(seed);
    }
    for (unsigned i = 0; i < 4; ++i)
        for (unsigned j = 0; j < 2; ++j) c.bank[i][j] = random_word(seed);
    for (unsigned i = 0; i < 5; ++i) {
        bits = random_word(seed);
        c.spsr[i] = (bits & 0xf00000e0u) | modes[bits % 7];
    }
    c.next_pc = random_word(seed);
    c.far = random_word(seed); c.dfsr = random_word(seed); c.ifsr = random_word(seed);
    uint32_t high = random_word(seed), low = random_word(seed);
    c.instructions = (uint64_t)high << 32 | low;
    c.exceptions = random_word(seed);
    c.r[15] = 0x100 + (thumb ? random_word(seed) & 2u : 0);
    return c;
}
static void compare_memory(void) {
    CHECK(equal(fast.ram, reference.ram, sizeof fast.ram));
    CHECK(equal(fast.boot_sram, reference.boot_sram, sizeof fast.boot_sram));
}
static void execute(uint32_t op, o_cpu c, bool memory) {
    fast.cpu = reference.cpu = c;
    o_zero(&fast.stop, sizeof fast.stop); o_zero(&reference.stop, sizeof reference.stop);
    unsigned width = c.cpsr & O_T ? 2u : 4u;
    for (unsigned b = 0; b < width; ++b)
        fast.flash[c.r[15] + b] = reference.flash[c.r[15] + b] = (uint8_t)(op >> (b * 8u));
    o_cpu_step(&fast); o_cpu_step_reference(&reference);
    CHECK(equal(&fast.cpu, &reference.cpu, sizeof fast.cpu));
    CHECK(equal(&fast.stop, &reference.stop, sizeof fast.stop));
    CHECK(equal(&fast.soc, &reference.soc, sizeof fast.soc));
    CHECK(fast.nor_sequence == reference.nor_sequence && fast.nor_id_mode == reference.nor_id_mode);
    CHECK(fast.sram_alias_reads == reference.sram_alias_reads && fast.sram_alias_writes == reference.sram_alias_writes);
    CHECK(fast.quiet_left == reference.quiet_left && fast.deferred_ticks == reference.deferred_ticks);
    if (memory) compare_memory();
}

static void exhaustive_thumb(void) {
    initialize();
    uint32_t seed = 0x7468756du;
    for (unsigned op = 0; op <= 0xffffu; ++op) {
        o_cpu c = cpu_state(true, &seed);
        /* Exhaust decode without 65,536 full-arena copies: all register/SP
         * data addresses (and sums of two registers) are unmapped. The full
         * RAM comparison after the corpus confirms no store reached SRAM.
         * Successful memory and partial effects are exercised separately. */
        for (unsigned r = 0; r < 15; ++r) c.r[r] = 0x60010000u | (c.r[r] & 0xfff8u);
        execute(op, c, false);
    }
    compare_memory();
    for (unsigned i = 0; i < 2048; ++i) {
        o_cpu c = cpu_state(true, &seed);
        for (unsigned r = 0; r < 8; ++r)
            c.r[r] = r & 1u ? O_RAM_BASE + 0x400 + (c.r[r] & 0xfcu) : c.r[r] & 0x3cu;
        c.r[13] = O_RAM_BASE + 0x1000;
        execute(random_word(&seed) & 0xffffu, c, true);
    }
}

static void halfwords(void) {
    static const uint32_t addresses[] = {O_RAM_BASE + 0x300, O_RAM_BASE + 0x301,
        O_RAM_BASE + 0x302, O_RAM_BASE + 0x3fffe, 0x60000000u,
        0x50000020u, 0x50000024u, 0x4d000068u};
    initialize();
    uint32_t seed = 0x68616c66u;
    for (unsigned flags = 0; flags < 32; ++flags)
    for (unsigned kind = 1; kind < 4; ++kind)
    for (unsigned destination = 0; destination < 3; ++destination)
    for (unsigned address = 0; address < 8; ++address)
    for (unsigned alignment = 0; alignment < 2; ++alignment) {
        unsigned rd = destination == 0 ? 0u : destination == 1 ? 3u : 15u;
        uint32_t op = 0xe0000092u | (flags << 20) | (3u << 16) | (rd << 12) | (kind << 5);
        o_cpu c = cpu_state(false, &seed);
        c.r[2] = 2; c.r[3] = addresses[address];
        c.control |= alignment << 1;
        execute(op, c, true);
    }
}

static void multiple_stores(void) {
    static const uint32_t addresses[] = {O_RAM_BASE + 0x300, O_RAM_BASE + 0x301,
        O_RAM_BASE + 0x3fff8, O_RAM_BASE + 0x40000, 0x60000000u,
        0x50000020u, 0x4d000068u, O_BOOT_SRAM_BASE + O_BOOT_SRAM_SIZE - 8};
    static const unsigned lists[] = {0, 1, 8, 9, 16, 0x7fff, 0x8000, 0xffff};
    initialize();
    uint32_t seed = 0x73746f72u;
    for (unsigned flags = 0; flags < 16; ++flags)
    for (unsigned list = 0; list < 8; ++list)
    for (unsigned address = 0; address < 8; ++address) {
        uint32_t op = 0xe8000000u | (flags << 21) | (3u << 16) | lists[list];
        o_cpu c = cpu_state(false, &seed);
        c.r[3] = addresses[address];
        c.control |= (flags & 1u) << 1;
        execute(op, c, true);
    }
}

static void block_register_lists(void) {
    static const struct { uint32_t flags; unsigned first, adjusted; } modes[] = {
        {0x00800000u, 0x400, 0x40c}, /* IA */
        {0x01800000u, 0x404, 0x40c}, /* IB */
        {0x00000000u, 0x3f8, 0x3f4}, /* DA */
        {0x01000000u, 0x3f4, 0x3f4}, /* DB */
    };
    uint32_t seed = 0x6c697374u;
    /* Independent addresses and word values also check the shared decoder. */
    for (unsigned mode = 0; mode < 4; ++mode) {
        initialize();
        o_cpu c = cpu_state(false, &seed);
        c.r[3] = O_RAM_BASE + 0x400;
        c.r[0] = 0x01020304u; c.r[7] = 0x708090a0u; c.r[14] = 0xdeadbeefu;
        uint32_t op = 0xe8234081u | modes[mode].flags; /* STM r3!, {r0,r7,r14} */
        execute(op, c, true);
        CHECK(fast.stop.status == ORCHARD_OK);
        CHECK(o_read_le(fast.ram + modes[mode].first, 4) == 0x01020304u);
        CHECK(o_read_le(fast.ram + modes[mode].first + 4, 4) == 0x708090a0u);
        CHECK(o_read_le(fast.ram + modes[mode].first + 8, 4) == 0xdeadbeefu);
        CHECK(fast.ram[modes[mode].first - 1] == 0 && fast.ram[modes[mode].first + 12] == 0);
        CHECK(fast.cpu.r[3] == O_RAM_BASE + modes[mode].adjusted);
        c.r[0] = c.r[7] = c.r[14] = 0;
        execute(op | (1u << 20), c, true); /* LDM r3!, {r0,r7,r14} */
        CHECK(fast.stop.status == ORCHARD_OK);
        CHECK(fast.cpu.r[0] == 0x01020304u && fast.cpu.r[7] == 0x708090a0u);
        CHECK(fast.cpu.r[14] == 0xdeadbeefu && fast.cpu.r[1] == c.r[1]);
        CHECK(fast.cpu.r[3] == O_RAM_BASE + modes[mode].adjusted);
        CHECK(fast.cpu.r[15] == 0x104 && fast.cpu.cpsr == c.cpsr);
    }
    /* A high-bit-only list must still commit PC and, for LDM^, restore SPSR. */
    for (unsigned special = 0; special < 2; ++special) {
        initialize();
        o_cpu c = cpu_state(false, &seed);
        c.cpsr = O_SVC | O_I | O_F; c.spsr[2] = O_SVC | O_T | O_N;
        c.r[3] = O_RAM_BASE + 0x600;
        fast.ram[0x600] = reference.ram[0x600] = 0x37;
        fast.ram[0x601] = reference.ram[0x601] = 0x12;
        execute(0xe8b38000u | (special << 22), c, true);
        CHECK(fast.stop.status == ORCHARD_OK && fast.cpu.r[3] == O_RAM_BASE + 0x604);
        CHECK(fast.cpu.r[15] == (special ? 0x1236u : 0x1234u));
        CHECK(fast.cpu.cpsr == (special ? c.spsr[2] : c.cpsr));
    }
    initialize();
    o_cpu c = cpu_state(false, &seed);
    c.r[3] = O_RAM_BASE + 0x700; c.r[14] = 0x12345678u;
    execute(0xe8a3c008u, c, true); /* Base is first: STMIA r3!, {r3,r14,pc}. */
    CHECK(fast.stop.status == ORCHARD_OK && fast.cpu.r[3] == O_RAM_BASE + 0x70c);
    CHECK(o_read_le(fast.ram + 0x700, 4) == O_RAM_BASE + 0x700);
    CHECK(o_read_le(fast.ram + 0x704, 4) == 0x12345678u);
    CHECK(o_read_le(fast.ram + 0x708, 4) == 0x10cu);
    /* Empty lists and a non-first writeback base stop before any bus access. */
    const uint32_t invalid[] = {0xe8a30000u, 0xe8a30009u};
    for (unsigned i = 0; i < 2; ++i) {
        initialize();
        execute(invalid[i], c, true);
        CHECK(fast.stop.status == ORCHARD_UNPREDICTABLE && equal(&fast.cpu, &c, sizeof c));
        CHECK(o_read_le(fast.ram + 0x700, 4) == 0 && o_read_le(fast.ram + 0x704, 4) == 0);
    }
}

static void thumb_memory(void) {
    static const uint32_t addresses[] = {O_RAM_BASE + 0x300, O_RAM_BASE + 0x301,
        O_RAM_BASE + 0x302, O_RAM_BASE + 0x3fffc, 0x60000000u,
        0x50000020u, 0x50000024u, 0x4d000068u};
    static const unsigned ops[] = {0x5088u, 0x5288u, 0x5488u, 0x5688u,
        0x5888u, 0x5a88u, 0x5c88u, 0x5e88u, 0x6008u, 0x6808u,
        0x7008u, 0x7808u, 0x8008u, 0x8808u, 0x9000u, 0x9800u};
    initialize();
    uint32_t seed = 0x6d656d31u;
    for (unsigned op = 0; op < sizeof ops / sizeof *ops; ++op)
    for (unsigned address = 0; address < 8; ++address)
    for (unsigned alignment = 0; alignment < 2; ++alignment) {
        o_cpu c = cpu_state(true, &seed);
        c.r[1] = c.r[13] = addresses[address]; c.r[2] = 0;
        c.control |= alignment << 1;
        execute(ops[op], c, true);
    }
}

static void partial_effects(void) {
    uint32_t seed = 0x70617274u;
    const uint32_t ops[] = {0xe8a1000du, 0xc10du, 0xb40du,
                            0xe8b1000du, 0xc90du, 0xbc0du};
    for (unsigned instruction = 0; instruction < 6; ++instruction) {
        initialize();
        bool thumb = instruction != 0 && instruction != 3;
        o_cpu c = cpu_state(thumb, &seed);
        uint32_t end = O_RAM_BASE + fast.profile->ram_bytes;
        c.r[1] = end - 8;
        c.r[13] = instruction == 2 ? end + 4 : end - 8;
        c.r[0] = 0x01020304; c.r[2] = 0x50607080; c.r[3] = 0x90123456;
        execute(ops[instruction], c, true);
        CHECK(fast.stop.status == ORCHARD_OK);
        CHECK((fast.cpu.cpsr & 31u) == O_ABT && fast.cpu.instructions == c.instructions + 1u);
        CHECK(fast.cpu.far == end && !fast.cpu.data_abort);
        if (instruction < 3) {
            CHECK(o_read_le(fast.ram + fast.profile->ram_bytes - 8, 4) == c.r[0]);
            CHECK(o_read_le(fast.ram + fast.profile->ram_bytes - 4, 4) == c.r[2]);
        } else CHECK(fast.cpu.r[0] == c.r[0] && fast.cpu.r[2] == c.r[2]);
    }
    /* An earlier UART write/read remains externally visible when a later
     * transfer diagnoses an unsupported register. CPU writeback is restored. */
    const uint32_t mmio_ops[] = {0xe8a10005u, 0xc105u, 0xb405u, 0xbc07u};
    for (unsigned instruction = 0; instruction < 4; ++instruction) {
        initialize();
        o_cpu c = cpu_state(instruction != 0, &seed);
        c.r[1] = 0x50000020u;
        c.r[13] = instruction == 2 ? 0x50000028u : 0x50000024u;
        c.r[0] = 0x42;
        fast.soc.uart[0][0]=reference.soc.uart[0][0]=3;
        fast.soc.uart[0][1]=reference.soc.uart[0][1]=5;
        CHECK(o_q_push(&fast.soc.rx, 0x55)); CHECK(o_q_push(&reference.soc.rx, 0x55));
        execute(mmio_ops[instruction], c, true);
        CHECK(fast.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
        CHECK(equal(&fast.cpu, &c, sizeof c));
        if (instruction < 3) CHECK(fast.soc.tx.count == 1 && fast.soc.tx.data[0] == 0x42);
        else CHECK(fast.soc.rx.count == 0);
    }
}

static void descriptor_diagnostics(void) {
    uint32_t seed = 0x6661756cu;
    const uint32_t ops[] = {0xe5910000u, 0xe1d100b0u, 0x6808u,
                            0xe8810001u, 0xc101u, 0xb401u};
    for (unsigned instruction = 0; instruction < 6; ++instruction) {
        initialize();
        bool thumb = instruction == 2 || instruction >= 4;
        o_cpu c = cpu_state(thumb, &seed);
        c.control |= 1u; c.ttb = 0x50000000u; c.domain = UINT32_MAX;
        c.r[1] = 0x00b00000u; c.r[13] = 0x00b00004u;
        /* Fetch's first descriptor is a valid UART register; the data walk
         * reaches unsupported UART offset 0x2c, setting a diagnostic AND DFSR. */
        fast.soc.uart[0][0] = reference.soc.uart[0][0] = 2;
        fast.quiet_left = reference.quiet_left = 16;
        fast.deferred_ticks = reference.deferred_ticks = 3;
        execute(ops[instruction], c, true);
        CHECK(fast.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
        CHECK(fast.stop.address == 0x5000002cu && fast.stop.instruction == ops[instruction]);
        CHECK(equal(&fast.cpu, &c, sizeof c));
        CHECK(fast.soc.rtc.phase == 3u * 32768u);
    }
}

EXPORT("regression") unsigned run(void) {
    checks = failures = first_failure = 0;
    exhaustive_thumb(); halfwords(); multiple_stores(); block_register_lists(); thumb_memory();
    partial_effects(); descriptor_diagnostics();
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
