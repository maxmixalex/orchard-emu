/* SPDX-License-Identifier: MIT
 * ROM-free LCD and electrical-bias regression. Test-only host/WASM executable.
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
static void check(bool ok, unsigned line) {
    ++checks;
    if (!ok) {
        if (!failures) first_failure = line;
        ++failures;
#ifndef __wasm__
        if (failures <= 16) fprintf(stderr, "lcd-input.c:%u failed\n", line);
#endif
    }
}
#define CHECK(condition) check((condition), __LINE__)
static void put_word(uint8_t *p, uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (8u * i));
}
static void gpio_internal_pullups(void) {
    const unsigned widths[8] = {0,11,16,16,16,8,16,11};
    for (unsigned port = 1; port <= 7; ++port) {
        orchard_reset(&machine);
        uint32_t mask=(1u<<widths[port])-1u, addr=0x56000000u+16u*port;
        uint32_t value, known, levels, conflicts;
        CHECK(o_phys_write(&machine,addr,4,0));
        CHECK(o_phys_write(&machine,addr+8u,4,0));
        CHECK(o_phys_read(&machine,addr+4u,4,&value) && value==mask);
        CHECK(orchard_gpio_inputs(&machine,(orchard_gpio_port)port,1,0)==ORCHARD_OK);
        CHECK(o_phys_read(&machine,addr+4u,4,&value) && value==(mask&~1u));
        CHECK(orchard_gpio_inputs(&machine,(orchard_gpio_port)port,0,0)==ORCHARD_OK);
        CHECK(orchard_gpio_bias(&machine,(orchard_gpio_port)port,1,0)==ORCHARD_OK);
        o_gpio_sample(&machine,port,&known,&levels,&conflicts);
        CHECK(known==(mask&~1u) && levels==(mask&~1u) && !conflicts);
        CHECK(o_phys_write(&machine,addr+8u,4,1));
        CHECK(o_phys_read(&machine,addr+4u,4,&value) && value==(mask&~1u));
        CHECK(orchard_gpio_bias(&machine,(orchard_gpio_port)port,0,0)==ORCHARD_OK);
        CHECK(!o_phys_read(&machine,addr+4u,4,&value));
        CHECK(machine.stop.status==ORCHARD_UNIMPLEMENTED_MMIO && machine.stop.detail==1);
    }
    /* Reduced original-OS suspend witness: E14/E15 input, pulls enabled,
       all other E pins outputs. Execute the actual LDR access, not a host
       substitution for its value. No external preset supplies these pins. */
    orchard_reset(&machine);
    CHECK(o_phys_write(&machine,0x56000040,4,0x05555555));
    CHECK(o_phys_write(&machine,0x56000048,4,0x3fff));
    machine.cpu.r[4]=0x56000000;
    put_word(machine.flash,0xe5940044);
    o_cpu_step(&machine);
    CHECK(machine.stop.status==ORCHARD_OK && machine.cpu.r[0]==0xc000 && machine.cpu.r[15]==4);
    orchard_reset(&machine);
}
static void gpio_bias_and_lcd_probe(void) {
    orchard_reset(&machine);
    uint32_t k, v, conflicts;
    CHECK(orchard_gpio_bias(NULL, ORCHARD_GPIO_G, 1, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, (orchard_gpio_port)0, 1, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_F, 0x100, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_G, 1, 2) == ORCHARD_BAD_ARGUMENT);
    CHECK(o_phys_write(&machine, 0x56000038, 4, 0xffff)); /* Isolate external bias. */
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_D, 3, 1) == ORCHARD_OK);
    o_gpio_sample(&machine, ORCHARD_GPIO_D, &k, &v, &conflicts);
    CHECK(k == 3 && v == 1 && conflicts == 0);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_D, 3, 2) == ORCHARD_OK);
    o_gpio_sample(&machine, ORCHARD_GPIO_D, &k, &v, &conflicts);
    CHECK(k == 3 && v == 2 && conflicts == 0); /* Both strong polarities beat opposing bias. */
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_D, 0, 0) == ORCHARD_OK);
    o_gpio_sample(&machine, ORCHARD_GPIO_D, &k, &v, &conflicts);
    CHECK(k == 3 && v == 2);
    orchard_reset(&machine);
    o_gpio_sample(&machine, ORCHARD_GPIO_D, &k, &v, &conflicts);
    CHECK(k == 0x0fff && v == 0x0fff); /* GP D12..15 reset with pull-ups disabled. */

    CHECK(orchard_keyboard_attach(&machine, true) == ORCHARD_OK);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_G, 1, 0) == ORCHARD_OK);
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_G, 0xf800, 0xf800) == ORCHARD_OK);
    CHECK(o_phys_write(&machine, 0x56000068, 4, 1)); /* Internal row/column pulls. */
    for (unsigned col = 0; col < 8; ++col) {
        CHECK(o_phys_write(&machine, 0x56000060, 4, 1u | (1u << (2u * (col + 8u)))));
        CHECK(o_phys_write(&machine, 0x56000064, 4, 0));
        for (unsigned row = 0; row < 7; ++row) {
            CHECK(orchard_keyboard_matrix(&machine, col, row, true) == ORCHARD_OK);
            o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
            CHECK((k & 0xfffe) == 0xfffe && conflicts == 0);
            CHECK((v & 0xfeu) == (0xfeu & ~(1u << (row + 1u))));
            CHECK(orchard_keyboard_matrix(&machine, col, row, false) == ORCHARD_OK);
            o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
            CHECK((v & 0xfeu) == 0xfeu && conflicts == 0);
        }
    }
    /* Opposing passive biases are unresolved, not a strong-drive short. */
    CHECK(o_phys_write(&machine, 0x56000060, 4, 0));
    CHECK(o_phys_write(&machine, 0x56000068, 4, 0xffff));
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_G, 0x802, 0x800) == ORCHARD_OK);
    CHECK(orchard_keyboard_matrix(&machine, 3, 0, true) == ORCHARD_OK);
    o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
    CHECK(!(k & 0x802) && conflicts == 0);
    CHECK(o_phys_write(&machine, 0x56000060, 4, 1u << 22));
    CHECK(o_phys_write(&machine, 0x56000064, 4, 0));
    o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
    CHECK((k & 0x802) == 0x802 && !(v & 0x802) && !conflicts);
    CHECK(o_phys_write(&machine, 0x56000064, 4, 0x800));
    o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
    CHECK((v & 0x802) == 0x802 && !conflicts);
    CHECK(orchard_gpio_inputs(&machine, ORCHARD_GPIO_G, 3, 0) == ORCHARD_OK);
    o_gpio_sample(&machine, ORCHARD_GPIO_G, &k, &v, &conflicts);
    CHECK((conflicts & 0x802) == 0x802); /* Strong low on row fights column high. */
    orchard_reset(&machine);
    CHECK(machine.soc.gpio_bias_known[6] == 0 && !machine.soc.keyboard_attached);

    CHECK(orchard_lcd_probe68(NULL, true) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_lcd_probe68_reads(NULL) == 0);
    CHECK(!o_phys_read(&machine, 0x4d000068, 4, &v));
    CHECK(machine.stop.status == ORCHARD_UNIMPLEMENTED_MMIO && orchard_lcd_probe68_reads(&machine) == 0);
    orchard_reset(&machine);
    CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
    CHECK(o_phys_read(&machine, 0x4d000068, 4, &v) && v == 0);
    CHECK(orchard_lcd_probe68_reads(&machine) == 1);
    CHECK(orchard_lcd_probe68(&machine, false) == ORCHARD_OK);
    CHECK(!o_phys_read(&machine, 0x4d000068, 4, &v));
    CHECK(orchard_lcd_probe68_reads(&machine) == 1); /* Disabling cannot erase evidence. */
    orchard_reset(&machine);
    CHECK(orchard_lcd_probe68_reads(&machine) == 0 && !machine.soc.lcd_probe68_idle_zero);
    for (unsigned width = 1; width <= 2; ++width) {
        orchard_reset(&machine); CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
        CHECK(!o_phys_read(&machine, 0x4d000068, width, &v));
        CHECK(!orchard_lcd_probe68_reads(&machine));
    }
    orchard_reset(&machine); CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
    CHECK(o_phys_write(&machine, 0x4d000000, 4, 0x21));
    CHECK(!o_phys_read(&machine, 0x4d000068, 4, &v));
    CHECK(!orchard_lcd_probe68_reads(&machine)); /* Even the option rejects enabled video. */
    for (unsigned off = 0x64; off <= 0x6c; off += 4) {
        orchard_reset(&machine); CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
        CHECK(!o_phys_write(&machine, 0x4d000000 + off, 4, 0));
        CHECK(!orchard_lcd_probe68_reads(&machine));
        if (off == 0x68) continue;
        orchard_reset(&machine); CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
        CHECK(!o_phys_read(&machine, 0x4d000000 + off, 4, &v));
    }
    /* Decode an actual LDR; no debugger PC skip or ROM patch is involved. */
    orchard_reset(&machine); CHECK(orchard_lcd_probe68(&machine, true) == ORCHARD_OK);
    machine.cpu.r[5] = 0x4d000000;
    put_word(machine.flash, 0xe5950068);
    o_cpu_step(&machine);
    CHECK(machine.stop.status == ORCHARD_OK && machine.cpu.r[0] == 0 && machine.cpu.r[15] == 4);
    CHECK(machine.cpu.instructions == 1 && orchard_lcd_probe68_reads(&machine) == 1);
    orchard_reset(&machine);
}

static void lcd_views_and_absolute_lanes(void) {
    orchard_reset(&machine);
    uint8_t raw[131 * 80], packed[131 * 80];
    const unsigned lanes[4][4] = {{3,2,1,0}, {1,0,3,2}, {0,1,2,3}, {2,3,0,1}};
    CHECK(orchard_framebuffer_view(NULL, ORCHARD_FRAME_CONTROLLER, raw, sizeof(raw)) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_framebuffer_view(&machine, (orchard_frame_view)2, raw, sizeof(raw)) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_CONTROLLER, raw, 1) == ORCHARD_BAD_ARGUMENT);
    for (unsigned i = 0; i < 512; ++i) machine.boot_sram[i] = (uint8_t)(i * 73u + 19u);
    for (unsigned mode = 0; mode < 3; ++mode) {
        unsigned bpp = 1u << mode, page = (131u * bpp + 15u) / 16u;
        /* An odd halfword offset also changes the next line's word alignment. */
        unsigned stride = (page + 1u) * 2u;
        for (unsigned start = 0; start <= 2; start += 2) {
            machine.soc.lcd[0] = 0x21 | (mode << 1);
            machine.soc.lcd[1] = 1u << 14;
            machine.soc.lcd[5] = (O_BOOT_SRAM_BASE + start) >> 1;
            machine.soc.lcd[6] = (start + 2u * stride) / 2u;
            machine.soc.lcd[7] = (1u << 11) | page;
            machine.soc.lcd[10] = 0x2e71; /* Deliberately nonlinear palette. */
            for (unsigned swap = 0; swap < 4; ++swap) {
                machine.soc.lcd[4] = swap;
                CHECK(orchard_framebuffer(&machine, raw, sizeof(raw)) == ORCHARD_OK);
                CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_PACKED_LSB, packed, sizeof(packed)) == ORCHARD_OK);
                for (unsigned y = 0; y < 2; ++y) for (unsigned x = 0; x < 131; ++x) {
                    unsigned logical = start + y * stride + x * bpp / 8u;
                    unsigned source = (logical / 4u) * 4u + lanes[swap][logical % 4u];
                    unsigned rv = (machine.boot_sram[source] >> (8u - bpp - (x * bpp % 8u))) & ((1u << bpp) - 1u);
                    unsigned pv = (machine.boot_sram[logical] >> (x * bpp % 8u)) & ((1u << bpp) - 1u);
                    unsigned expected_raw = mode == 1 ? ((0x2e71u >> (rv * 4u)) & 15u) * 17u : rv * 255u / ((1u << bpp) - 1u);
                    unsigned expected_packed = mode == 1 ? ((0x2e71u >> (pv * 4u)) & 15u) * 17u : pv * 255u / ((1u << bpp) - 1u);
                    CHECK(raw[y * 131u + x] == expected_raw);
                    CHECK(packed[y * 131u + x] == expected_packed);
                }
                CHECK(raw[262] == 0 && packed[262] == 0);
            }
        }
    }
    CHECK(orchard_lcd_probe68_reads(&machine) == 0); /* Capturing is side-effect-free. */
    machine.soc.lcd[6] = 1; /* End below start. */
    CHECK(orchard_framebuffer(&machine, raw, sizeof(raw)) == ORCHARD_UNSUPPORTED_LCD);
    machine.soc.lcd[6] = 10; /* End partway through requested line. */
    CHECK(orchard_framebuffer(&machine, raw, sizeof(raw)) == ORCHARD_BUS_ERROR);
    machine.soc.lcd[0] = 0;
    CHECK(orchard_framebuffer(&machine, raw, sizeof(raw)) == ORCHARD_OK);
    CHECK(raw[0] == 0 && raw[10479] == 0);
    orchard_reset(&machine);
}

static void documented_dither_patterns(void) {
    orchard_reset(&machine);
    uint32_t value;
    CHECK(o_phys_read(&machine, 0x4d00004c, 4, &value) && value == 0);
    CHECK(o_phys_write(&machine, 0x4d00004c, 4, 0x12210));
    CHECK(o_phys_read(&machine, 0x4d00004c, 4, &value) && value == 0x12210);
    CHECK(o_phys_write(&machine, 0x4d00004c, 4, 0xfff92210));
    CHECK(o_phys_read(&machine, 0x4d00004c, 4, &value) && value == 0x12210);
    uint8_t before[131 * 80], after[131 * 80];
    machine.soc.lcd[0] = 0x223; machine.soc.lcd[1] = 79u << 14;
    machine.soc.lcd[5] = O_BOOT_SRAM_BASE >> 1;
    machine.soc.lcd[6] = 80u * 40u / 2u; machine.soc.lcd[7] = 20;
    machine.soc.lcd[10] = 0xf840;
    for (unsigned i = 0; i < 3200; ++i) machine.boot_sram[i] = 0xe4;
    CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_PACKED_LSB, before, sizeof(before)) == ORCHARD_OK);
    CHECK(before[0] == 0 && before[1] == 68 && before[2] == 136 && before[3] == 255);
    CHECK(o_phys_write(&machine, 0x4d00004c, 4, 0));
    CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_PACKED_LSB, after, sizeof(after)) == ORCHARD_OK);
    bool same = true;
    for (unsigned i = 0; i < sizeof(before); ++i) if (before[i] != after[i]) same = false;
    CHECK(same); /* Both valid patterns preserve pre-dither inspection levels. */
    CHECK(o_phys_write(&machine, 0x4d00004c, 4, 0x12210)); /* Live STN write. */
    CHECK(machine.stop.status == ORCHARD_OK && !machine.soc.lcd_frames);
    const uint32_t invalid[] = {1, 0x12211, 0x7ffff};
    for (unsigned i = 0; i < 3; ++i) {
        orchard_reset(&machine);
        CHECK(!o_phys_write(&machine, 0x4d00004c, 4, invalid[i]));
        CHECK(machine.stop.status == ORCHARD_UNSUPPORTED_LCD && machine.soc.lcd[19] == 0);
    }
    orchard_reset(&machine);
    CHECK(o_phys_read(&machine, 0x4d00004c, 4, &value) && value == 0);
}

static void completed_scan_observer(void) {
    orchard_reset(&machine);
    uint8_t frame[131 * 80], raw[131 * 80], segments[6];
    CHECK(orchard_lcd_observe(NULL, true, ORCHARD_FRAME_PACKED_LSB) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_lcd_observe(&machine, true, (orchard_frame_view)2) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_lcd_published_frame(&machine, frame, 1) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_lcd_published_annunciators(NULL, segments) == ORCHARD_BAD_ARGUMENT);
    machine.soc.lcd[0] = 0x221;
    machine.soc.lcd[1] = 79u << 14;
    machine.soc.lcd[5] = O_BOOT_SRAM_BASE >> 1;
    machine.soc.lcd[6] = 80u * 20u / 2u;
    machine.soc.lcd[7] = 10;
    for (unsigned i = 0; i < 1600; ++i) machine.boot_sram[i] = 255;
    CHECK(orchard_lcd_observe(&machine, true, ORCHARD_FRAME_PACKED_LSB) == ORCHARD_OK);
    CHECK(!machine.lcd_output.valid);
    /* Complete one line-zero event, then let the guest clear its live buffer
       before the later browser request. The published frame stays intact. */
    machine.soc.lcd_line = 0; machine.soc.lcd_phase = 35;
    o_lcd_tick(&machine);
    CHECK(machine.soc.lcd_frames == 1 && machine.lcd_output.valid);
    for (unsigned i = 0; i < 1600; ++i) machine.boot_sram[i] = 0;
    CHECK(orchard_lcd_published_frame(&machine, frame, sizeof(frame)) == ORCHARD_OK);
    CHECK(orchard_lcd_published_annunciators(&machine, segments) == ORCHARD_OK);
    CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_PACKED_LSB, raw, sizeof(raw)) == ORCHARD_OK);
    CHECK(frame[0] == 255 && frame[10479] == 255 && raw[0] == 0 && raw[10479] == 0);
    CHECK(segments[0] == 255 && segments[5] == 255);
    CHECK(machine.stop.status == ORCHARD_OK);
    machine.soc.lcd_line = 0; machine.soc.lcd_phase = 35;
    o_lcd_tick(&machine);
    CHECK(orchard_lcd_published_frame(&machine, frame, sizeof(frame)) == ORCHARD_OK);
    CHECK(frame[0] == 0 && frame[10479] == 0); /* Genuine blank is published. */
    for (unsigned i = 0; i < 1600; ++i) machine.boot_sram[i] = 255;
    machine.soc.lcd_line = 0; machine.soc.lcd_phase = 35; o_lcd_tick(&machine);
    uint32_t disabled = 0x220;
    CHECK(o_lcd_register(&machine, 0x4d000000u, 4, &disabled, true));
    CHECK(!machine.lcd_output.valid);
    CHECK(orchard_lcd_published_frame(&machine, frame, sizeof(frame)) == ORCHARD_OK && frame[0] == 0);
    uint32_t enabled = 0x221;
    CHECK(o_lcd_register(&machine, 0x4d000000u, 4, &enabled, true));
    CHECK(!machine.lcd_output.valid);
    CHECK(orchard_lcd_published_frame(&machine, frame, sizeof(frame)) == ORCHARD_OK && frame[0] == 255);
    machine.soc.lcd_line = 0; machine.soc.lcd_phase = 35; o_lcd_tick(&machine);
    orchard_lcd_observer_reset(&machine);
    CHECK(!machine.lcd_output.valid && machine.lcd_output.enabled);
    CHECK(orchard_lcd_observe(&machine, false, ORCHARD_FRAME_PACKED_LSB) == ORCHARD_OK);
    CHECK(!machine.lcd_output.enabled);
    orchard_reset(&machine);
}


EXPORT("regression") unsigned orchard_lcd_input_regression(void) {
    checks = failures = first_failure = 0;
    if (!orchard_init(&machine, sizeof(machine), 6)) return 1;
    gpio_internal_pullups(); gpio_bias_and_lcd_probe(); lcd_views_and_absolute_lanes(); documented_dither_patterns(); completed_scan_observer();
    return failures;
}
EXPORT("checks") unsigned orchard_lcd_input_checks(void) { return checks; }
EXPORT("first_failure") unsigned orchard_lcd_input_first_failure(void) { return first_failure; }
#ifndef __wasm__
int main(void) {
    unsigned failed = orchard_lcd_input_regression();
    printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n", checks, failed, first_failure);
    return failed ? 1 : 0;
}
#endif
