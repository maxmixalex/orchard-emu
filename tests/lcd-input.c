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
static void gpio_bias_and_lcd_probe(void) {
    orchard_reset(&machine);
    uint32_t k, v, conflicts;
    CHECK(orchard_gpio_bias(NULL, ORCHARD_GPIO_G, 1, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, (orchard_gpio_port)0, 1, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_F, 0x100, 0) == ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_gpio_bias(&machine, ORCHARD_GPIO_G, 1, 2) == ORCHARD_BAD_ARGUMENT);
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
    CHECK(k == 0 && v == 0);

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
    uint8_t raw[131 * 80 + 1], packed[131 * 80 + 1];
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
                raw[131 * 80] = packed[131 * 80] = 0xa5;
                CHECK(orchard_framebuffer(&machine, raw, sizeof(raw) - 1) == ORCHARD_OK);
                CHECK(orchard_framebuffer_view(&machine, ORCHARD_FRAME_PACKED_LSB, packed, sizeof(packed) - 1) == ORCHARD_OK);
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
                CHECK(raw[131 * 80] == 0xa5 && packed[131 * 80] == 0xa5);
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

static bool bytes_equal(const void *left,const void *right,size_t n) {
    const uint8_t *a=left,*b=right;
    for(size_t i=0;i<n;i++) if(a[i]!=b[i]) return false;
    return true;
}
static void frame_registers(unsigned mode,unsigned swap,uint32_t start,uint32_t end) {
    machine.soc.lcd[0]=0x21u|(mode<<1);machine.soc.lcd[1]=1u<<14;
    machine.soc.lcd[4]=swap;machine.soc.lcd[5]=start>>1;
    machine.soc.lcd[6]=(end>>1)&0x1fffffu;
    machine.soc.lcd[7]=(1u<<11)|((131u*(1u<<mode)+15u)/16u);
    machine.soc.lcd[10]=0x2e71;
}
static void lcd_group_boundaries(void) {
    uint8_t actual[131*80+2],expected[131*80+2];
    orchard_reset(&machine);
    for(unsigned i=0;i<512;i++) {
        machine.flash[i]=machine.flash[machine.profile->flash_bytes-512u+i]=i&1u?0x1b:0xe4;
        machine.ram[i]=machine.ram[machine.profile->ram_bytes-512u+i]=i&1u?0x1b:0xe4;
    }
    machine.boot_sram[O_BOOT_SRAM_SIZE-2]=0xe4;machine.boot_sram[O_BOOT_SRAM_SIZE-1]=0x1b;
    CHECK(o_q_push(&machine.soc.rx,0xa5));
    const uint32_t starts[]={2,O_RAM_BASE+2,O_RAM_BASE+machine.profile->ram_bytes-2,
        machine.profile->flash_bytes-2,
        O_BOOT_SRAM_BASE+O_BOOT_SRAM_SIZE-2,O_RAM_BASE+machine.profile->ram_bytes-2,
        O_RAM_BASE+2,0x50000024u};
    /* 0xe4,0x1b with BLUELUT=0x2e71, independently expanded in both orders. */
    const uint8_t levels[2][8]={{34,238,119,17,17,119,238,34},{17,119,238,34,34,238,119,17}};
    for(unsigned region=0;region<sizeof(starts)/sizeof(starts[0]);region++) {
        CHECK(orchard_sram_select(&machine,region==5?ORCHARD_SRAM_BANK1_MIRROR:ORCHARD_SRAM_EXACT)==ORCHARD_OK);
        machine.nor_id_mode=region==0; /* Debug reads still inspect the NOR array. */
        bool valid=region<2 || region==5;
        unsigned prefix=valid?262u:region==7?0u:8u;
        for(unsigned view=0;view<2;view++) {
            frame_registers(1,2,starts[region],starts[region]+(region==6?2u:512u));
            for(unsigned i=0;i<sizeof actual;i++) {actual[i]=0xa5;expected[i]=0;}
            expected[0]=expected[sizeof expected-1]=0xa5;
            for(unsigned i=0;i<prefix;i++) expected[i+1]=levels[view][(i%131u)%8u];
            o_soc before=machine.soc;o_cpu cpu=machine.cpu;
            CHECK(orchard_framebuffer_view(&machine,(orchard_frame_view)view,actual+1,sizeof actual-2)==
                  (valid?ORCHARD_OK:ORCHARD_BUS_ERROR));
            CHECK(bytes_equal(actual,expected,sizeof actual)); /* Prefix, zero remainder, both canaries. */
            CHECK(bytes_equal(&before,&machine.soc,sizeof before) && bytes_equal(&cpu,&machine.cpu,sizeof cpu));
            CHECK(!machine.sram_alias_reads && !machine.sram_alias_writes && machine.stop.status==ORCHARD_OK);
        }
    }
    /* Self-aliasing RAM follows a per-pixel recurrence: byte x/4 is itself
       an earlier output pixel. Reusing the initial byte breaks this case. */
    const uint8_t shades[4]={17,119,238,34};
    for(unsigned view=0;view<2;view++) {
        orchard_reset(&machine);
        frame_registers(1,2,O_RAM_BASE,O_RAM_BASE+512);machine.soc.lcd[1]=0;
        o_zero(expected,131u*80u);
        for(unsigned x=0;x<131;x++) {
            unsigned shift=view?2u*(x%4u):6u-2u*(x%4u);
            expected[x]=shades[(expected[x/4u]>>shift)&3u];
        }
        CHECK(orchard_framebuffer_view(&machine,(orchard_frame_view)view,machine.ram,131u*80u)==ORCHARD_OK);
        CHECK(bytes_equal(machine.ram,expected,131u*80u));
    }
    /* Tiny valid output spans can alias a live register without zeroing its
       neighbours. Each first pixel changes how the second is decoded. */
    const orchard_profile *profile=machine.profile;
    orchard_profile narrow=*profile;narrow.lcd_width=2;narrow.lcd_height=1;
    machine.profile=&narrow;
    frame_registers(0,0,O_RAM_BASE,O_RAM_BASE+512);
    machine.ram[2]=0;machine.ram[3]=0xc0;
    CHECK(orchard_framebuffer(&machine,(uint8_t *)&machine.soc.lcd[4],2)==ORCHARD_OK);
    CHECK(machine.soc.lcd[4]==0xffu); /* First pixel changes lane 3 to lane 2. */
    frame_registers(1,2,O_RAM_BASE,O_RAM_BASE+512);machine.ram[0]=0x20;
    CHECK(orchard_framebuffer(&machine,(uint8_t *)&machine.soc.lcd[10]+1,2)==ORCHARD_OK);
    CHECK(machine.soc.lcd[10]==0x00111171u); /* New BLUELUT[2] is used by pixel 1. */
    machine.profile=profile;
    orchard_reset(&machine);
}

EXPORT("regression") unsigned orchard_lcd_input_regression(void) {
    checks = failures = first_failure = 0;
    if (!orchard_init(&machine, sizeof(machine), 6)) return 1;
    gpio_bias_and_lcd_probe(); lcd_views_and_absolute_lanes(); lcd_group_boundaries();
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
