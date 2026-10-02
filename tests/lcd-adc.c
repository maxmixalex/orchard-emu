/* SPDX-License-Identifier: MIT
 * Directed, ROM-free register/timing tests. No HP firmware or external core.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif
static orchard_machine m;
static unsigned checks, failures, first_failure;
static void check(bool ok, unsigned line) {
    ++checks;
    if (!ok) {
        if (!failures) first_failure = line;
        ++failures;
#ifndef __wasm__
        if (failures < 20) fprintf(stderr, "lcd-adc.c:%u failed\n", line);
#endif
    }
}
#define CHECK(x) check((x), __LINE__)
static void write_reg(uint32_t address, uint32_t value) { CHECK(o_phys_write(&m, address, 4, value)); }
static uint32_t read_reg(uint32_t address) {
    uint32_t value = 0xdeadbeef;
    CHECK(o_phys_read(&m, address, 4, &value));
    return value;
}
static void lcd_ticks(unsigned n) { for (unsigned i = 0; i < n; ++i) o_lcd_tick(&m); }
static void adc_ticks(unsigned n) { for (unsigned i = 0; i < n; ++i) o_adc_tick(&m); }
static void adc(void) {
    orchard_reset(&m);
    CHECK(read_reg(0x58000000) == 0x3fc4);
    CHECK(read_reg(0x58000004) == 0x58);
    CHECK(read_reg(0x58000008) == 0xff);
    CHECK(orchard_adc_input(NULL, 0, true, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_adc_input(&m, 8, true, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_adc_input(&m, 0, true, 1024) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_adc_input(&m, 0, false, 1) == ORCHARD_BAD_ARGUMENT);
    for (unsigned channel = 0; channel < 8; ++channel) {
        for (unsigned divisor = 1; divisor <= 256; divisor *= 2) {
            orchard_reset(&m);
            unsigned code = channel * 127u + divisor % 127u;
            CHECK(orchard_adc_input(&m, channel, true, code) == ORCHARD_OK);
            uint32_t control = channel * 8u | (divisor > 1 ? 0x4000u | ((divisor - 1u) << 6) : 0);
            write_reg(0x58000000, control | 1u | 0x80000000u); /* High reserved bits ignored. */
            CHECK(read_reg(0x58000000) == control); /* ENABLE_START self clears. */
            CHECK(m.soc.adc.remaining == 5u * divisor && !m.soc.adc.valid);
            CHECK(orchard_adc_input(&m, channel, true, 1023) == ORCHARD_OK);
            adc_ticks(5u * divisor - 1u);
            CHECK(!(read_reg(0x58000000) & 0x8000u));
            CHECK(!m.soc.adc.valid && m.soc.subsrcpnd == 0);
            adc_ticks(1);
            CHECK(read_reg(0x58000000) == (control | 0x8000u));
            CHECK(read_reg(0x5800000c) == code); /* Original held sample, not later stimulus. */
            CHECK(m.soc.adc.valid && m.soc.adc.remaining == 0);
            CHECK(m.soc.subsrcpnd == (1u << 10));
            o_irq_update(&m.soc); CHECK(!(m.soc.srcpnd & O_N)); /* Subsource masked. */
            write_reg(0x4a00001c, 0x3ff); o_irq_update(&m.soc);
            CHECK(m.soc.srcpnd & O_N);
            write_reg(0x4a000008, ~O_N); o_irq_update(&m.soc);
            CHECK(m.soc.intpnd == O_N);
            write_reg(0x4a000000, O_N); write_reg(0x4a000010, O_N); o_irq_update(&m.soc);
            CHECK(m.soc.intpnd == O_N); /* Must clear subsource as well. */
            write_reg(0x4a000018, 1u << 10); write_reg(0x4a000000, O_N);
            write_reg(0x4a000010, O_N); o_irq_update(&m.soc);
            CHECK(m.soc.intpnd == 0);
            write_reg(0x58000000, control); CHECK(read_reg(0x58000000) & 0x8000u); /* RO flag. */
            write_reg(0x58000000, control | 1u);
            CHECK(read_reg(0x5800000c) == code); /* Previous conversion retained while busy. */
            adc_ticks(5u * divisor);
            CHECK(read_reg(0x5800000c) == 1023);
        }
    }
    orchard_reset(&m);
    write_reg(0x58000000, 0x42f8); /* Actual first HP48gII write: configuration only. */
    CHECK(read_reg(0x58000000) == 0x42f8 && !m.soc.adc.remaining);
    CHECK(!o_phys_write(&m, 0x58000000, 4, 0x42f9));
    CHECK(m.stop.status == ORCHARD_UNRESOLVED_ANALOG && m.stop.detail == 7);
    CHECK(m.soc.adc.con == 0x42f8 && !m.soc.adc.valid && !m.soc.adc.remaining);
    orchard_reset(&m); CHECK(orchard_adc_input(&m, 7, true, 0) == ORCHARD_OK);
    write_reg(0x58000000, 0x42f9); adc_ticks(10);
    CHECK(m.soc.adc.remaining == 50);
    write_reg(0x58000000, 0x42fc); adc_ticks(100);
    CHECK(m.soc.adc.remaining == 50 && !(m.soc.adc.con & 0x8000u));
    write_reg(0x58000000, 0x42f8); adc_ticks(50);
    CHECK(read_reg(0x5800000c) == 0 && m.soc.adc.valid); /* Zero is a valid sample. */
    CHECK(orchard_adc_input(&m, 7, true, 512) == ORCHARD_OK);
    write_reg(0x58000000, 0x42fa); /* READ_START mode. */
    orchard_peripheral_state before, after;
    orchard_get_peripheral_state(&m, &before); orchard_get_peripheral_state(&m, &after);
    CHECK(before.adc_remaining == 0 && after.adc_remaining == 0); /* Diagnostic getter pure. */
    CHECK(read_reg(0x5800000c) == 0 && m.soc.adc.remaining == 60);
    adc_ticks(60);
    write_reg(0x58000000, 0x42fe); /* Standby with READ_START does not sample. */
    CHECK(read_reg(0x5800000c) == 512 && !m.soc.adc.remaining);
    CHECK(orchard_adc_input(&m, 7, false, 0) == ORCHARD_OK);
    write_reg(0x58000000, 0x42fa);
    uint32_t value = 0xabcdef;
    CHECK(!o_phys_read(&m, 0x5800000c, 4, &value));
    CHECK(m.stop.status == ORCHARD_UNRESOLVED_ANALOG && value == 0xabcdef);
    CHECK(m.soc.adc.valid && m.soc.adc.data == 512 && !m.soc.adc.remaining);

    for (unsigned width = 1; width <= 2; ++width) {
        orchard_reset(&m); CHECK(!o_phys_read(&m, 0x58000000, width, &value));
        CHECK(m.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
        orchard_reset(&m); CHECK(!o_phys_write(&m, 0x58000000, width, 1));
        CHECK(m.soc.adc.con == 0x3fc4);
    }
    const uint32_t absent[] = {0x58000001, 0x58000010, 0x58000014, 0x5800000c};
    for (unsigned i = 0; i < 4; ++i) {
        orchard_reset(&m); CHECK(!o_phys_read(&m, absent[i], 4, &value));
        CHECK(!m.soc.adc.valid);
    }
    orchard_reset(&m); CHECK(!o_phys_write(&m, 0x5800000c, 4, 42));
    CHECK(!m.soc.adc.valid);
    for (unsigned mode = 1; mode < 8; ++mode) {
        orchard_reset(&m); CHECK(!o_phys_write(&m, 0x58000004, 4, 0x58u | mode));
        CHECK(m.soc.adc.tsc == 0x58 && m.stop.status == ORCHARD_UNIMPLEMENTED_MMIO);
    }
    orchard_reset(&m); write_reg(0x58000008, 0x12345678);
    CHECK(read_reg(0x58000008) == 0x5678);
    CHECK(!o_phys_write(&m, 0x58000008, 4, 0)); CHECK(m.soc.adc.delay == 0x5678);
    orchard_reset(&m); CHECK(orchard_adc_input(&m, 0, true, 1) == ORCHARD_OK);
    write_reg(0x58000000, 1);
    CHECK(!o_phys_write(&m, 0x58000000, 4, 9)); /* Busy mux/retrigger rejected atomically. */
    CHECK(m.soc.adc.con == 0 && m.soc.adc.remaining == 5);
    orchard_reset(&m); CHECK(m.soc.adc.known == 0 && !m.soc.adc.valid);
}
static void lcd(void) {
    orchard_reset(&m);
    CHECK(read_reg(0x4d00005c) == 3 && read_reg(0x4d000060) == 4);
    CHECK(read_reg(0x4d000054) == 0 && read_reg(0x4d000058) == 0);
    write_reg(0x4d000000, 0xfffc0000u); CHECK(read_reg(0x4d000000) == 0); /* RO LINECNT. */
    for (unsigned mode = 1; mode <= 2; ++mode) {
        for (unsigned wlh = 0; wlh < 4; ++wlh) for (unsigned wdly = 0; wdly < 4; ++wdly) {
            orchard_reset(&m);
            write_reg(0x4d000004, 2u << 14); /* Three scan lines. */
            write_reg(0x4d000008, 7u << 8 | wdly << 19 | 3u);
            write_reg(0x4d00000c, wlh);
            write_reg(0x4d000000, 3u << 8 | mode << 5 | 1u);
            const unsigned table[] = {16,32,48,64};
            unsigned period = 6u * 8u + table[wlh] + table[wdly] + 24u;
            for (unsigned line = 2; line <= 2; --line) {
                for (unsigned repeat = 0; repeat < 3; ++repeat)
                    CHECK((read_reg(0x4d000000) >> 18) == line);
                lcd_ticks(period - 1); CHECK((read_reg(0x4d000000) >> 18) == line);
                lcd_ticks(1);
            }
            CHECK(m.soc.lcd_frames == 1 && m.soc.lcd_line == 2);
            CHECK(read_reg(0x4d000058) == 2 && read_reg(0x4d000054) == 0);
            CHECK(!(m.soc.srcpnd & (1u << 16)));
            write_reg(0x4d00005c, 1); /* Existing source becomes pending when unmasked. */
            CHECK(read_reg(0x4d000054) == 2 && (m.soc.srcpnd & (1u << 16)));
            write_reg(0x4d00005c, 3); /* Does not erase a pending interrupt. */
            CHECK(read_reg(0x4d000054) == 2);
            write_reg(0x4d000058, 0); CHECK(read_reg(0x4d000058) == 2);
            write_reg(0x4d000058, 1); CHECK(read_reg(0x4d000058) == 2);
            write_reg(0x4d000058, 2); CHECK(read_reg(0x4d000058) == 0);
            CHECK(read_reg(0x4d000054) == 2);
            write_reg(0x4d000054, 2); CHECK(read_reg(0x4d000054) == 0);
            write_reg(0x4a000000, 1u << 16); write_reg(0x4a000010, 1u << 16);
            lcd_ticks(1); CHECK(!(m.soc.srcpnd & (1u << 16)));
            write_reg(0x4d000000, 3u << 8 | mode << 5); /* Disable freezes count. */
            unsigned line = m.soc.lcd_line; lcd_ticks(4 * period);
            CHECK(m.soc.lcd_frames == 1 && m.soc.lcd_line == line);
            write_reg(0x4d000000, 3u << 8 | mode << 5 | 1u);
            CHECK(m.soc.lcd_line == 2 && !m.soc.lcd_phase);
        }
    }
    orchard_reset(&m);
    write_reg(0x4d000004, 1u << 14); write_reg(0x4d00005c, 1);
    write_reg(0x4d000000, 0x221); lcd_ticks(72);
    CHECK(read_reg(0x4d000054) == 2 && read_reg(0x4d000058) == 2);
    write_reg(0x4d000054, 2); lcd_ticks(1); /* Driver order: PND then SRC. */
    CHECK(read_reg(0x4d000054) == 0 && read_reg(0x4d000058) == 2);
    write_reg(0x4d000058, 2); write_reg(0x4a000000, 1u << 16);
    lcd_ticks(1); CHECK(!(m.soc.srcpnd & (1u << 16)));
    lcd_ticks(70); CHECK(read_reg(0x4d000054) == 2); /* A new frame can retrigger. */
    write_reg(0x4d000058, 2); lcd_ticks(1); /* Opposite acknowledgment order. */
    CHECK(read_reg(0x4d000054) == 2 && read_reg(0x4d000058) == 0);
    write_reg(0x4d000054, 2); write_reg(0x4a000000, 1u << 16);
    lcd_ticks(1); CHECK(!(m.soc.srcpnd & (1u << 16)));
    orchard_reset(&m);
    CHECK(!o_phys_write(&m, 0x4d00005c, 4, 0)); CHECK(m.soc.lcd[23] == 3); /* FIFO not implemented. */
    orchard_reset(&m); CHECK(!o_phys_write(&m, 0x4d000060, 4, 5)); CHECK(m.soc.lcd[24] == 4);
    orchard_reset(&m); CHECK(!o_phys_write(&m, 0x4d000050, 4, 0x1000000));
    for (unsigned width = 1; width <= 2; ++width) {
        uint32_t value = 9;
        orchard_reset(&m); CHECK(!o_phys_read(&m, 0x4d000058, width, &value));
        CHECK(m.stop.status == ORCHARD_UNIMPLEMENTED_MMIO && value == 9);
    }
    const uint32_t invalid[] = {0x21, 0x201, 0x261, 0x227};
    for (unsigned i = 0; i < 4; ++i) {
        orchard_reset(&m); write_reg(0x4d000000, invalid[i]); lcd_ticks(1);
        CHECK(m.stop.status == ORCHARD_UNSUPPORTED_LCD && !m.soc.lcd_frames);
    }
    orchard_reset(&m); write_reg(0x4d000000, 0x221);
    CHECK(!o_phys_write(&m, 0x4d000008, 4, 0x100)); CHECK(m.soc.lcd[2] == 0);
    orchard_reset(&m); CHECK(m.soc.lcd_line == 0 && m.soc.lcd_frames == 0);
}
EXPORT("regression") unsigned run(void) {
    checks = failures = first_failure = 0;
    if (!orchard_init(&m, sizeof(m), 6)) return 1;
    adc(); lcd();
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
