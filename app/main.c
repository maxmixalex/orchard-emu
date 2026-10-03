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
          "              [--keyboard apples] [--nor-device sst39vf1601|sst39vf800a]\n"
          "              [--sram-decode bank1-mirror] (explicit wiring hypothesis)\n"
          "              [--gpio-bias PORT:MASK_HEX:LEVELS_HEX] ...\n"
          "              [--key-at TICK:COLUMN:ROW:0_OR_1] ...\n"
          "              [--lcd-probe68 idle-zero] [--frame-view packed-lsb]\n"
          "              [--adc-input CHANNEL:CODE] ... (decimal 0..7:0..1023)\n"
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
static bool parse_adc(const char *text, unsigned *channel, unsigned *code) {
    if (text[0] < '0' || text[0] > '7' || text[1] != ':') return false;
    const char *p = text + 2;
    if (!*p) return false;
    unsigned value = 0, digits = 0;
    for (; *p; ++p) {
        if (*p < '0' || *p > '9' || ++digits > 4) return false;
        value = 10u * value + (unsigned)(*p - '0');
    }
    if (value > 1023) return false;
    *channel = (unsigned)(text[0] - '0'); *code = value;
    return true;
}
typedef struct { uint64_t tick; unsigned col, row, down; } key_event;
static bool parse_key(const char *text, key_event *event) {
    uint64_t fields[4] = {0};
    for (unsigned i = 0; i < 4; ++i) {
        if (*text < '0' || *text > '9') return false;
        while (*text >= '0' && *text <= '9') {
            unsigned digit = (unsigned)(*text++ - '0');
            if (fields[i] > (UINT64_MAX - digit) / 10u) return false;
            fields[i] = fields[i] * 10u + digit;
        }
        if (i < 3) { if (*text++ != ':') return false; }
        else if (*text) return false;
    }
    if (fields[1] >= 8 || fields[2] >= 7 || fields[3] > 1) return false;
    *event = (key_event){fields[0], (unsigned)fields[1], (unsigned)fields[2], (unsigned)fields[3]};
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
    bool keyboard = false, lcd_idle_zero = false;
    orchard_frame_view frame_view = ORCHARD_FRAME_CONTROLLER;
    key_event events[64]; unsigned event_count = 0, next_event = 0;
    uint32_t bias_known[8] = {0}, bias_levels[8] = {0};
    bool bias_set[8] = {false};
    orchard_nor_device nor = ORCHARD_NOR_UNSPECIFIED;
    orchard_sram_decode sram = ORCHARD_SRAM_EXACT;
    bool sram_set = false;
    uint32_t gpio_known[8] = {0}, gpio_levels[8] = {0};
    bool gpio_set[8] = {false};
    bool adc_set[8] = {false};
    unsigned adc_codes[8] = {0};
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
        } else if (strcmp(key, "--gpio-bias") == 0) {
            unsigned port; uint32_t known, levels;
            if (!parse_gpio(value, &port, &known, &levels) || bias_set[port]) {
                fputs("Use --gpio-bias PORT:MASK_HEX:LEVELS_HEX once per port B..H\n", stderr); return 64;
            }
            bias_set[port] = true; bias_known[port] = known; bias_levels[port] = levels;
        } else if (strcmp(key, "--adc-input") == 0) {
            unsigned channel, code;
            if (!parse_adc(value, &channel, &code) || adc_set[channel]) {
                fputs("Use --adc-input CHANNEL:CODE once per channel (decimal 0..7:0..1023)\n", stderr);
                return 64;
            }
            adc_set[channel] = true; adc_codes[channel] = code;
        } else if (strcmp(key, "--lcd-probe68") == 0) {
            if (strcmp(value, "idle-zero") != 0) { fputs("Expected --lcd-probe68 idle-zero\n", stderr); return 64; }
            lcd_idle_zero = true;
        } else if (strcmp(key, "--frame-view") == 0) {
            if (strcmp(value, "packed-lsb") != 0) { fputs("Expected --frame-view packed-lsb\n", stderr); return 64; }
            frame_view = ORCHARD_FRAME_PACKED_LSB;
        } else if (strcmp(key, "--key-at") == 0) {
            key_event event;
            if (event_count == 64 || !parse_key(value, &event) ||
                (event_count && event.tick < events[event_count - 1].tick)) {
                fputs("Expected up to 64 chronological --key-at TICK:COL:ROW:0_OR_1 events\n", stderr); return 64;
            }
            events[event_count++] = event;
        } else if (strcmp(key, "--keyboard") == 0) {
            if (strcmp(value, "apples") != 0) { fputs("Expected --keyboard apples\n", stderr); return 64; }
            keyboard = true;
        } else if (strcmp(key, "--nor-device") == 0) {
            if (strcmp(value, "sst39vf1601") != 0 && strcmp(value, "sst39vf800a") != 0) { fputs("Unknown NOR device\n", stderr); return 64; }
            nor = strcmp(value, "sst39vf800a") == 0 ? ORCHARD_NOR_SST39VF800A : ORCHARD_NOR_SST39VF1601;
        } else if (strcmp(key, "--sram-decode") == 0) {
            if (sram_set || strcmp(value, "bank1-mirror") != 0) {
                fputs("Expected one --sram-decode bank1-mirror\n", stderr); return 64;
            }
            sram_set = true; sram = ORCHARD_SRAM_BANK1_MIRROR;
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
    if (event_count && (!keyboard || events[event_count - 1].tick >= budget)) {
        fputs("Key events require --keyboard apples and a tick below the run budget\n", stderr); return 64;
    }
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
    for (unsigned port = 1; port <= 7; ++port) if (bias_set[port])
        if (orchard_gpio_bias(m, (orchard_gpio_port)port, bias_known[port], bias_levels[port]) != ORCHARD_OK) {
            fputs("Invalid GPIO bias mask/levels\n", stderr); result = 64; goto cleanup;
        }
    if (orchard_sram_select(m, sram) != ORCHARD_OK) { result = 64; goto cleanup; }
    if (orchard_lcd_probe68(m, lcd_idle_zero) != ORCHARD_OK) { result = 64; goto cleanup; }
    for (unsigned channel = 0; channel < 8; ++channel) if (adc_set[channel]) {
        if (orchard_adc_input(m, channel, true, adc_codes[channel]) != ORCHARD_OK) {
            fputs("Invalid ADC stimulus\n", stderr); result = 64; goto cleanup;
        }
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
        while (next_event < event_count && events[next_event].tick == state.ticks) {
            const key_event *e = &events[next_event++];
            if (orchard_keyboard_matrix(m, e->col, e->row, e->down != 0) != ORCHARD_OK) {
                fputs("Key event rejected\n", stderr); result = 64; goto cleanup;
            }
        }
        if (input) {
            if (position == available && !feof(input)) {
                available = fread(incoming, 1, sizeof(incoming), input); position = 0;
                if (ferror(input)) { fputs("UART input read failed\n", stderr); goto cleanup; }
            }
            position += orchard_uart_send(m, incoming + position, available - position);
        }
        uint32_t slice = trace ? 1u : 256u;
        if (budget - state.ticks < slice) slice = (uint32_t)(budget - state.ticks);
        if (next_event < event_count && events[next_event].tick - state.ticks < slice)
            slice = (uint32_t)(events[next_event].tick - state.ticks);
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
        frame_status = orchard_framebuffer_view(m, frame_view, pixels, sizeof(pixels));
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
    fputs("],\"gpio_bias\":[", stdout);
    bool first_bias = true;
    for (unsigned port = 1; port <= 7; ++port) if (bias_set[port]) {
        printf("%s{\"port\":\"%c\",\"known_mask\":\"%08" PRIx32 "\",\"levels\":\"%08" PRIx32 "\"}",
               first_bias ? "" : ",", 'A' + (int)port, bias_known[port], bias_levels[port]);
        first_bias = false;
    }
    printf("],\"keyboard\":\"%s\",\"nor_device\":\"%s\",\"lcd_probe68\":\"%s\","
           "\"lcd_unverified_reads\":\"%" PRIu64 "\",\"frame_view\":\"%s\",\"key_events_applied\":%u,\"key_events\":[",
           keyboard ? "apples" : "detached", nor == ORCHARD_NOR_SST39VF800A ? "sst39vf800a" : nor ? "sst39vf1601" : "unspecified",
           lcd_idle_zero ? "idle-zero" : "strict", orchard_lcd_probe68_reads(m),
           frame_view == ORCHARD_FRAME_PACKED_LSB ? "packed-lsb" : "controller", next_event);
    for (unsigned i = 0; i < event_count; ++i)
        printf("%s{\"tick\":\"%" PRIu64 "\",\"column\":%u,\"row\":%u,\"down\":%u}",
               i ? "," : "", events[i].tick, events[i].col, events[i].row, events[i].down);
    fputs("],\"adc_inputs\":[", stdout);
    bool first_adc = true;
    for (unsigned channel = 0; channel < 8; ++channel) if (adc_set[channel]) {
        printf("%s{\"channel\":%u,\"code\":%u}", first_adc ? "" : ",", channel, adc_codes[channel]);
        first_adc = false;
    }
    orchard_peripheral_state peripheral;
    orchard_get_peripheral_state(m, &peripheral);
    printf("],\"peripherals\":{\"lcd_control\":%" PRIu32 ",\"lcd_source_pending\":%" PRIu32
           ",\"lcd_interrupt_pending\":%" PRIu32 ",\"lcd_interrupt_mask\":%" PRIu32
           ",\"lcd_frames\":\"%" PRIu64 "\",\"adc_control\":%" PRIu32 ",\"adc_data\":%" PRIu32
           ",\"adc_remaining\":%" PRIu32 ",\"adc_valid\":%s}",
           peripheral.lcd_control, peripheral.lcd_source_pending, peripheral.lcd_interrupt_pending,
           peripheral.lcd_interrupt_mask, peripheral.lcd_frames, peripheral.adc_control,
           peripheral.adc_data, peripheral.adc_remaining, peripheral.adc_valid ? "true" : "false");
    printf(",\"sram_decode\":\"%s\",\"sram_alias_reads\":\"%" PRIu64
           "\",\"sram_alias_writes\":\"%" PRIu64 "\"",
           sram == ORCHARD_SRAM_BANK1_MIRROR ? "bank1-mirror" : "exact",
           orchard_sram_alias_reads(m), orchard_sram_alias_writes(m));
    uint8_t segment_levels[6];
    orchard_status segment_status = orchard_annunciators(m, segment_levels);
    printf(",\"annunciators\":{\"status\":%u,\"levels\":[", (unsigned)segment_status);
    for (unsigned i = 0; i < 6; ++i) printf("%s%u", i ? "," : "", (unsigned)segment_levels[i]);
    printf("]}");
    orchard_usb_state usb;
    orchard_get_usb_state(m, &usb);
    printf(",\"usb\":{\"address\":%" PRIu32 ",\"active_address\":%" PRIu32
           ",\"power\":%" PRIu32 ",\"index\":%" PRIu32
           ",\"ep_pending\":%" PRIu32 ",\"bus_pending\":%" PRIu32
           ",\"ep_enable\":%" PRIu32 ",\"bus_enable\":%" PRIu32
           ",\"frame\":%" PRIu32 ",\"phase\":%" PRIu32 ",\"connected\":%s,\"endpoints\":[",
           usb.address, usb.active_address, usb.power, usb.index, usb.ep_pending,
           usb.bus_pending, usb.ep_enable, usb.bus_enable, usb.frame, usb.phase,
           usb.connected ? "true" : "false");
    for (unsigned ep = 0; ep < 5; ++ep)
        printf("%s{\"max_packet\":%" PRIu32 ",\"in_csr\":%" PRIu32
               ",\"out_csr\":%" PRIu32 ",\"tx_bytes\":%" PRIu32 ",\"rx_bytes\":%" PRIu32 "}",
               ep ? "," : "", usb.max_packet[ep], usb.in_csr[ep], usb.out_csr[ep],
               usb.tx_bytes[ep], usb.rx_bytes[ep]);
    printf("],\"resets\":\"%" PRIu64 "\",\"setups\":\"%" PRIu64
           "\",\"in_packets\":\"%" PRIu64 "\",\"out_packets\":\"%" PRIu64 "\"}}\n",
           usb.resets, usb.setups, usb.in_packets, usb.out_packets);
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
