/* SPDX-License-Identifier: MIT */
#include "orchard/orchard.h"
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void usage(FILE *out) {
    fputs("Orchard 0.1.0 -- ARM hardware bring-up, stock boot NOT verified\n\n"
          "  orchard models\n"
          "  orchard run --model SLUG --rom FULL-NOR.bin [--ticks N]\n"
          "              [--trace FILE.jsonl] [--frame FILE.pgm]\n"
          "              [--keyboard apples] [--nor-device sst39vf1601]\n"
          "              [--uart-in FILE] [--uart-out FILE]\n"
          "              [--gpio-input PORT:KNOWN_HEX:LEVELS_HEX] ...\n\n"
          "GPIO input stimuli are explicit research conditions, not board wiring.\n"
          "Full physical NOR images only. No firmware or bootloader is bundled.\n"
          "Default budget: 100000 ticks; ticks are not hardware clock cycles.\n"
          "Exit 0 = budget completed, 2 = emulator stopped, 64 = input error,\n"
          "74 = host I/O error. None of these is a stock-OS boot certificate.\n", out);
}
static const orchard_profile *find_model(const char *slug) {
    for (unsigned id = 1; id <= 6; ++id) {
        const orchard_profile *p = orchard_get_profile(id);
        if (strcmp(p->slug, slug) == 0) return p;
    }
    return NULL;
}
static void models(void) {
    for (unsigned id = 1; id <= 6; ++id) {
        const orchard_profile *p = orchard_get_profile(id);
        printf("%-12s  %-23s  NOR=%u KiB RAM=%u KiB LCD=%ux%u  boot=unverified\n",
               p->slug, p->name, p->flash_bytes / 1024u, p->ram_bytes / 1024u,
               p->lcd_width, p->lcd_height);
    }
}
/* Exclusive creation also rejects symlink/hardlink aliases of input files. */
static FILE *open_output(const char *name) {
    if (!name) return NULL;
    FILE *f = fopen(name, "wbx");
    if (!f) fprintf(stderr, "%s: %s\n", name, strerror(errno));
    return f;
}
static bool parse_gpio(const char *text, unsigned *port, uint32_t *known, uint32_t *levels) {
    if (text[0] < 'B' || text[0] > 'H' || text[1] != ':') return false;
    const char *p = text + 2;
    uint32_t fields[2];
    for (unsigned field = 0; field < 2; ++field) {
        const char *first = p;
        while (isxdigit((unsigned char)*p)) ++p;
        if (p == first || p - first > 8 || (field == 0 ? *p != ':' : *p != '\0')) return false;
        char *end;
        errno = 0;
        unsigned long value = strtoul(first, &end, 16);
        if (errno || end != p || value > UINT32_MAX) return false;
        fields[field] = (uint32_t)value;
        if (field == 0) ++p;
    }
    *port = (unsigned)(text[0] - 'A'); *known = fields[0]; *levels = fields[1];
    return true;
}
int main(int argc, char **argv) {
    if (argc == 1 || (argc == 2 && (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0))) {
        usage(stdout); return 0;
    }
    if (argc == 2 && strcmp(argv[1], "models") == 0) { models(); return 0; }
    if (strcmp(argv[1], "run") != 0) { usage(stderr); return 64; }
    const char *slug = NULL, *rompath = NULL, *tracepath = NULL, *framepath = NULL;
    const char *inpath = NULL, *outpath = NULL;
    uint64_t budget = 100000;
    bool keyboard = false;
    orchard_nor_device nor = ORCHARD_NOR_UNSPECIFIED;
    uint32_t gpio_known[8] = {0}, gpio_levels[8] = {0};
    bool gpio_set[8] = {false};
    for (int i = 2; i < argc; i += 2) {
        if (i + 1 == argc) { fprintf(stderr, "Missing value for %s\n", argv[i]); return 64; }
        const char *key = argv[i], *value = argv[i + 1];
        if (strcmp(key, "--model") == 0) slug = value;
        else if (strcmp(key, "--rom") == 0) rompath = value;
        else if (strcmp(key, "--trace") == 0) tracepath = value;
        else if (strcmp(key, "--frame") == 0) framepath = value;
        else if (strcmp(key, "--uart-in") == 0) inpath = value;
        else if (strcmp(key, "--uart-out") == 0) outpath = value;
        else if (strcmp(key, "--gpio-input") == 0) {
            unsigned port;
            uint32_t known, levels;
            if (!parse_gpio(value, &port, &known, &levels) || gpio_set[port]) {
                fputs("Use --gpio-input PORT:KNOWN_HEX:LEVELS_HEX once per port B..H\n", stderr);
                return 64;
            }
            gpio_set[port] = true; gpio_known[port] = known; gpio_levels[port] = levels;
        } else if (strcmp(key, "--keyboard") == 0) {
            if (strcmp(value, "apples") != 0) { fputs("Expected --keyboard apples\n", stderr); return 64; }
            keyboard = true;
        } else if (strcmp(key, "--nor-device") == 0) {
            if (strcmp(value, "sst39vf1601") != 0) { fputs("Unknown NOR device\n", stderr); return 64; }
            nor = ORCHARD_NOR_SST39VF1601;
        } else if (strcmp(key, "--ticks") == 0) {
            char *end;
            for (const char *digit = value; *digit; ++digit) {
                if (*digit < '0' || *digit > '9') {
                    fputs("Invalid tick budget\n", stderr); return 64;
                }
            }
            errno = 0;
            budget = strtoull(value, &end, 10);
            if (errno || !*value || *end || value[0] == '-') {
                fputs("Invalid tick budget\n", stderr); return 64;
            }
        } else { fprintf(stderr, "Unknown option: %s\n", key); return 64; }
    }
    const orchard_profile *p = slug ? find_model(slug) : NULL;
    if (!p || !rompath) { usage(stderr); return 64; }
    /* Refuse obvious destructive path collisions, even before opening outputs. */
    const char *outputs[] = {tracepath, framepath, outpath};
    for (unsigned i = 0; i < 3; ++i) if (outputs[i]) {
        if (strcmp(outputs[i], rompath) == 0 || (inpath && strcmp(outputs[i], inpath) == 0)) {
            fputs("Output path must differ from input path\n", stderr); return 64;
        }
        for (unsigned j = 0; j < i; ++j) if (outputs[j] && strcmp(outputs[i], outputs[j]) == 0) {
            fputs("Output paths must be distinct\n", stderr); return 64;
        }
    }
    int result = 74;
    FILE *rom = fopen(rompath, "rb"), *trace = NULL, *input = NULL, *output = NULL;
    void *arena = malloc(orchard_machine_size());
    uint8_t *bytes = malloc((size_t)p->flash_bytes + 1u);
    if (!rom || !arena || !bytes) {
        fprintf(stderr, "Cannot open ROM or allocate machine: %s\n", strerror(errno));
        goto cleanup;
    }
    size_t size = fread(bytes, 1, (size_t)p->flash_bytes + 1u, rom);
    if (ferror(rom)) { fputs("Failed to read ROM\n", stderr); goto cleanup; }
    orchard_machine *m = orchard_init(arena, orchard_machine_size(), p->id);
    if (!m) { fputs("Cannot initialize machine\n", stderr); goto cleanup; }
    orchard_status status = orchard_load_rom(m, bytes, size);
    if (status != ORCHARD_OK) {
        fprintf(stderr, "ROM rejected: %s (expected %u bytes, read %zu)\n",
                orchard_status_string(status), p->flash_bytes, size);
        result = 64; goto cleanup;
    }
    for (unsigned port = 1; port <= 7; ++port) if (gpio_set[port]) {
        if (orchard_gpio_inputs(m, (orchard_gpio_port)port, gpio_known[port], gpio_levels[port]) != ORCHARD_OK) {
            fputs("GPIO mask exceeds port width or levels exceed the known mask\n", stderr);
            result = 64; goto cleanup;
        }
    }
    if (orchard_nor_select(m, nor) != ORCHARD_OK || orchard_keyboard_attach(m, keyboard) != ORCHARD_OK) {
        fputs("Hardware configuration incompatible with model\n", stderr); result = 64; goto cleanup;
    }
    trace = open_output(tracepath);
    output = open_output(outpath);
    if ((tracepath && !trace) || (outpath && !output)) goto cleanup;
    if (inpath) {
        input = fopen(inpath, "rb");
        if (!input) { fprintf(stderr, "%s: %s\n", inpath, strerror(errno)); goto cleanup; }
    }
    uint8_t incoming[512], outgoing[1024];
    size_t available = 0, position = 0;
    orchard_state state;
    orchard_get_state(m, &state);
    while (state.ticks < budget && state.stop.status == ORCHARD_OK) {
        if (input) {
            if (position == available && !feof(input)) {
                available = fread(incoming, 1, sizeof(incoming), input); position = 0;
                if (ferror(input)) { fputs("UART input read failed\n", stderr); goto cleanup; }
            }
            position += orchard_uart_send(m, incoming + position, available - position);
        }
        uint32_t slice = trace ? 1u : 256u;
        if (budget - state.ticks < slice) slice = (uint32_t)(budget - state.ticks);
        (void)orchard_run(m, slice);
        orchard_get_state(m, &state);
        if (trace && fprintf(trace,
            "{\"tick\":\"%" PRIu64 "\",\"pc\":\"%08" PRIx32 "\",\"cpsr\":\"%08" PRIx32
            "\",\"instructions\":\"%" PRIu64 "\",\"exceptions\":\"%" PRIu64 "\",\"stop\":%u}\n",
            state.ticks, state.registers[15], state.cpsr, state.instructions, state.exceptions,
            (unsigned)state.stop.status) < 0) goto cleanup;
        size_t n = orchard_uart_receive(m, outgoing, sizeof(outgoing));
        if (output && n && fwrite(outgoing, 1, n, output) != n) goto cleanup;
    }
    orchard_status frame_status = ORCHARD_OK;
    if (framepath) {
        uint8_t pixels[131 * 80];
        frame_status = orchard_framebuffer(m, pixels, sizeof(pixels));
        if (frame_status == ORCHARD_OK) {
            FILE *frame = open_output(framepath);
            if (!frame) goto cleanup;
            bool ok = fprintf(frame, "P5\n%u %u\n255\n", p->lcd_width, p->lcd_height) > 0;
            size_t count = (size_t)p->lcd_width * p->lcd_height;
            for (size_t i = 0; i < count; ++i) pixels[i] = (uint8_t)(255u - pixels[i]);
            if (fwrite(pixels, 1, count, frame) != count) ok = false;
            if (fclose(frame) != 0) ok = false;
            if (!ok) goto cleanup;
        }
    }
    printf("{\"model\":\"%s\",\"status\":\"%s\",\"boot_verified\":false,"
           "\"ticks\":\"%" PRIu64 "\",\"instructions\":\"%" PRIu64 "\","
           "\"exceptions\":\"%" PRIu64 "\",\"pc\":\"%08" PRIx32 "\","
           "\"cpsr\":\"%08" PRIx32 "\",\"sleeping\":%s,\"stop\":{\"code\":%u,"
           "\"reason\":\"%s\",\"pc\":\"%08" PRIx32 "\",\"instruction\":\"%08" PRIx32 "\","
           "\"address\":\"%08" PRIx32 "\",\"detail\":\"%08" PRIx32 "\"},\"frame_status\":%u,"
           "\"cp15_control\":\"%08" PRIx32 "\",\"fault_status\":\"%08" PRIx32 "\","
           "\"fault_address\":\"%08" PRIx32 "\",\"registers\":[",
           p->slug, state.stop.status == ORCHARD_OK ? "budget-exhausted" : "stopped",
           state.ticks, state.instructions, state.exceptions, state.registers[15], state.cpsr,
           state.sleeping ? "true" : "false", (unsigned)state.stop.status,
           orchard_status_string(state.stop.status), state.stop.pc, state.stop.instruction,
           state.stop.address, state.stop.detail, (unsigned)frame_status,
           state.cp15_control, state.fault_status, state.fault_address);
    for (unsigned r = 0; r < 16; ++r)
        printf("%s\"%08" PRIx32 "\"", r ? "," : "", state.registers[r]);
    fputs("],\"gpio_inputs\":[", stdout);
    bool first_input = true;
    for (unsigned port = 1; port <= 7; ++port) if (gpio_set[port]) {
        printf("%s{\"port\":\"%c\",\"known_mask\":\"%08" PRIx32 "\",\"levels\":\"%08" PRIx32 "\"}",
               first_input ? "" : ",", 'A' + (int)port, gpio_known[port], gpio_levels[port]);
        first_input = false;
    }
    printf("],\"keyboard\":\"%s\",\"nor_device\":\"%s\"}\n",
           keyboard ? "apples" : "detached", nor ? "sst39vf1601" : "unspecified");
    result = state.stop.status == ORCHARD_OK && frame_status == ORCHARD_OK ? 0 : 2;
cleanup:
    if (rom && fclose(rom) != 0) result = 74;
    if (trace && fclose(trace) != 0) result = 74;
    if (input && fclose(input) != 0) result = 74;
    if (output && fclose(output) != 0) result = 74;
    if (ferror(stdout) || fflush(stdout) != 0) result = 74;
    free(bytes);
    free(arena);
    return result;
}
