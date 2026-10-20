/* SPDX-License-Identifier: MIT
 * ROM-free CPU-only microbenchmarks. No peripheral scheduling or hardware
 * timing is represented here; use tools/benchmark.mjs for complete ROM replay.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif

static orchard_machine machine;

EXPORT("prepare") unsigned prepare(unsigned workload) {
    static const uint32_t arm_alu[] = {
        0xe2800001u, 0xe0222200u, 0xe1a03262u, 0xe0944003u,
        0xe0a55000u, 0xe1866022u, 0xe3570040u, 0xeafffff7u
    };
    static const uint32_t arm_word[] = {
        0xe5810000u, 0xe5912000u, 0xe2800001u, 0xe5c10004u,
        0xe5d13004u, 0xe0222003u, 0xeafffff8u
    };
    static const uint32_t arm_half[] = {
        0xe1c100b0u, 0xe1d120b0u, 0xe1d130d0u, 0xe1d140f0u,
        0xe2800001u, 0xeafffff9u
    };
    static const uint32_t arm_multiple[] = {
        0xe88100fcu, 0xe89100fcu, 0xe2822001u, 0xeafffffbu
    };
    static const uint16_t thumb_alu[] = {
        0x3001u, 0x0042u, 0x4042u, 0x4153u, 0x2840u, 0xe7f9u
    };
    static const uint16_t thumb_single[] = {
        0x6008u, 0x680au, 0x8008u, 0x880bu, 0x7008u, 0x780cu,
        0x3001u, 0xe7f7u
    };
    static const uint16_t thumb_stack[] = {
        0xb4fcu, 0xbcfcu, 0x3201u, 0xe7fbu
    };
    if (workload > 6 || !orchard_init(&machine, sizeof machine, 1)) return 1;
    const uint32_t *arm_code = NULL;
    const uint16_t *thumb_code = NULL;
    size_t size;
    switch (workload) {
    case 0: arm_code = arm_alu; size = sizeof arm_alu; break;
    case 1: arm_code = arm_word; size = sizeof arm_word; break;
    case 2: arm_code = arm_half; size = sizeof arm_half; break;
    case 3: arm_code = arm_multiple; size = sizeof arm_multiple; break;
    case 4: thumb_code = thumb_alu; size = sizeof thumb_alu; break;
    case 5: thumb_code = thumb_single; size = sizeof thumb_single; break;
    default: thumb_code = thumb_stack; size = sizeof thumb_stack; break;
    }
    unsigned width = thumb_code ? 2u : 4u;
    for (size_t i = 0; i < size / width; ++i) {
        uint32_t op = thumb_code ? thumb_code[i] : arm_code[i];
        for (unsigned b = 0; b < width; ++b)
            machine.flash[0x100 + i * width + b] = (uint8_t)(op >> (b * 8u));
    }
    machine.cpu.cpsr = O_SYS | (thumb_code ? O_T : 0);
    machine.cpu.r[0] = 0x13579bdfu;
    machine.cpu.r[1] = O_RAM_BASE + 0x1000;
    machine.cpu.r[13] = O_RAM_BASE + 0x2000;
    machine.cpu.r[15] = 0x100;
    return 0;
}

EXPORT("execute") unsigned execute(unsigned instructions) {
    for (unsigned i = 0; i < instructions && machine.stop.status == ORCHARD_OK; ++i)
        o_cpu_step(&machine);
    return machine.stop.status;
}

static uint32_t hash_bytes(uint32_t hash, const void *data, size_t size) {
    const uint8_t *bytes = data;
    for (size_t i = 0; i < size; ++i) hash = (hash ^ bytes[i]) * 16777619u;
    return hash;
}
EXPORT("digest") uint32_t digest(void) {
    uint32_t hash = hash_bytes(2166136261u, &machine.cpu, sizeof machine.cpu);
    hash = hash_bytes(hash, &machine.stop, sizeof machine.stop);
    hash = hash_bytes(hash, &machine.soc, sizeof machine.soc);
    hash = hash_bytes(hash, machine.ram, sizeof machine.ram);
    return hash;
}

#ifndef __wasm__
int main(int argc, char **argv) {
    if (argc != 3) {
        fputs("Usage: cpu-throughput WORKLOAD(0..6) INSTRUCTIONS\n", stderr);
        return 1;
    }
    unsigned workload = (unsigned)strtoul(argv[1], NULL, 0);
    unsigned instructions = (unsigned)strtoul(argv[2], NULL, 0);
    if (prepare(workload)) return 1;
    struct timespec begin, end;
    if (timespec_get(&begin, TIME_UTC) != TIME_UTC) return 1;
    unsigned status = execute(instructions);
    if (timespec_get(&end, TIME_UTC) != TIME_UTC) return 1;
    double seconds = (double)(end.tv_sec - begin.tv_sec) +
                     (double)(end.tv_nsec - begin.tv_nsec) / 1e9;
    printf("{\"workload\":%u,\"instructions\":%u,\"seconds\":%.9f,"
           "\"status\":%u,\"digest\":%u}\n", workload, instructions,
           seconds, status, digest());
    return status ? 1 : 0;
}
#endif
