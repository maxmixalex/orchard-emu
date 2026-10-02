/* SPDX-License-Identifier: MIT
 * Native research helper for one bounded HP48gII GPDDAT read-modify-write
 * window. Use probe-gpio-window.mjs: it validates the exact original NOR hash.
 * This deliberately uses an internal checkpoint, not a public resume/ROM patch.
 */
#include "internal.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WINDOW_TICKS 8192u
#define VARIANTS 2048u

int main(int argc, char **argv) {
    if (argc != 2) { fputs("Use the hash-validating probe-gpio-window.mjs wrapper\n", stderr); return 64; }
    int result = 1;
    orchard_machine *m = malloc(sizeof(*m)), *checkpoint = malloc(sizeof(*m));
    uint8_t *rom = malloc(0x200001), *reference_ram = malloc(0x40000);
    uint32_t *trace = malloc(WINDOW_TICKS * sizeof(*trace));
    FILE *file = fopen(argv[1], "rb");
    if (!m || !checkpoint || !rom || !reference_ram || !trace || !file) goto cleanup;
    size_t length = fread(rom, 1, 0x200001, file);
    if (ferror(file) || length != 0x200000) goto cleanup;
    if (!orchard_init(m, sizeof(*m), 4) || orchard_load_rom(m, rom, length) != ORCHARD_OK) goto cleanup;
    orchard_stop stop = orchard_run(m, 1000000);
    if (stop.status != ORCHARD_UNIMPLEMENTED_MMIO || stop.pc != 0x08001820 ||
        stop.instruction != 0xe5941034 || stop.address != 0x56000034 || stop.detail != 0xcc7f ||
        m->soc.gpio[0x30 / 4] != 0x05054000 || m->cpu.exceptions) {
        fputs("Expected GPDDAT checkpoint not reached; refusing a different probe\n", stderr);
        goto cleanup;
    }
    memcpy(checkpoint, m, sizeof(*m));
    orchard_state reference_state;
    uint32_t reference_lcd[20], reference_output = 0;
    unsigned ram_different = 0;
    for (unsigned variant = 0; variant < VARIANTS; ++variant) {
        memcpy(m, checkpoint, sizeof(*m));
        uint32_t levels = 0;
        unsigned bit = 0;
        for (unsigned pin = 0; pin < 16; ++pin)
            if (0xcc7fu & (1u << pin)) levels |= ((variant >> bit++) & 1u) << pin;
        if (orchard_gpio_inputs(m, ORCHARD_GPIO_D, 0xcc7f, levels) != ORCHARD_OK) goto cleanup;
        /* Reexecute the stopped read from the checked checkpoint. No firmware,
           CPU register, instruction or memory content is changed. All variants
           inherit the same already-consumed diagnostic tick. */
        o_zero(&m->stop, sizeof(m->stop));
        for (unsigned tick = 0; tick < WINDOW_TICKS; ++tick) {
            if (variant == 0) trace[tick] = m->cpu.r[15];
            else if (trace[tick] != m->cpu.r[15]) {
                fprintf(stderr, "PC trace differs: variant=%u tick=%u\n", variant, tick); goto cleanup;
            }
            if (orchard_run(m, 1).status != ORCHARD_OK) goto cleanup;
        }
        orchard_state state;
        orchard_get_state(m, &state);
        uint32_t outputs = 0;
        for (unsigned pin = 0; pin < 16; ++pin)
            if (((m->soc.gpio[0x30 / 4] >> (2u * pin)) & 3u) == 1) outputs |= 1u << pin;
        uint32_t driven = m->soc.gpio[0x34 / 4] & outputs;
        if (variant == 0) {
            reference_state = state; reference_output = driven;
            memcpy(reference_lcd, m->soc.lcd, sizeof(reference_lcd));
            memcpy(reference_ram, m->ram, 0x40000);
        } else {
            if (memcmp(&reference_state, &state, sizeof(state)) || driven != reference_output ||
                memcmp(reference_lcd, m->soc.lcd, sizeof(reference_lcd))) {
                fprintf(stderr, "Architectural/LCD/output state differs: variant=%u\n", variant); goto cleanup;
            }
            if (memcmp(reference_ram, m->ram, 0x40000)) ++ram_different;
        }
        if (memcmp(rom, m->flash, length)) goto cleanup;
    }
    printf("{\"variants\":%u,\"window_ticks\":%u,\"checkpoint_pc\":\"08001820\","
           "\"input_mask\":\"0000cc7f\",\"end_pc\":\"%08x\",\"pc_trace_equal\":true,"
           "\"architectural_state_equal\":true,\"gpio_outputs_equal\":true,\"lcd_registers_equal\":true,"
           "\"nor_unchanged\":true,\"ram_differing_variants\":%u,\"boot_verified\":false,"
           "\"unbounded_equivalence_proven\":false}\n", VARIANTS, WINDOW_TICKS,
           reference_state.registers[15], ram_different);
    result = ferror(stdout) || fflush(stdout) != 0 ? 1 : 0;
cleanup:
    if (file && fclose(file) != 0) result = 1;
    free(trace); free(reference_ram); free(rom); free(checkpoint); free(m);
    return result;
}
