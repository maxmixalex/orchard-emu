/* SPDX-License-Identifier: MIT
 * Test-only one-instruction runner. Binary, little-endian fixed records:
 * input: opcode, CPSR, r0..r15, 256 bytes at 0x08002000;
 * output: stop status, CPSR, r0..r15, the same 256-byte memory window.
 * Code runs at 0x08000000 or Thumb halfword 0x08000002. No peripheral tick,
 * host file access, firmware, or external emulator library is involved.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif

#define RECORD_SIZE (18u * 4u + 256u)
static orchard_machine machine;
static uint32_t word(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24;
}
static void put(uint8_t *p, uint32_t v) {
    for (unsigned i=0; i<4; ++i) p[i]=(uint8_t)(v>>(8u*i));
}
static uint8_t input[RECORD_SIZE], output[RECORD_SIZE];
EXPORT("oracle_init") unsigned initialize(void) {
    return orchard_init(&machine, sizeof(machine), 6) ? 0u : 1u;
}
EXPORT("oracle_input") uintptr_t input_buffer(void) { return (uintptr_t)input; }
EXPORT("oracle_output") uintptr_t output_buffer(void) { return (uintptr_t)output; }
EXPORT("oracle_step") unsigned step(void) {
    uint32_t cpsr=word(input+4), pc=word(input+17*4);
    if (!machine.profile || (cpsr & ~0xf00000ffu) ||
        ((cpsr & 31u)!=O_SYS && (cpsr & 31u)!=O_USR) ||
        (pc!=O_RAM_BASE && !(pc==O_RAM_BASE+2 && (cpsr&O_T)))) return 64;
    o_cpu_reset(&machine.cpu);
    o_zero(&machine.stop,sizeof(machine.stop));
    o_zero(machine.ram,0x2100);
    machine.cpu.cpsr=cpsr;
    for(unsigned i=0;i<16;++i) machine.cpu.r[i]=word(input+8+4*i);
    o_copy(machine.ram+0x2000,input+72,256);
    o_copy(machine.ram+(pc-O_RAM_BASE),input,4);
    o_cpu_step(&machine);
    put(output,(uint32_t)machine.stop.status);
    put(output+4,machine.cpu.cpsr);
    for(unsigned i=0;i<16;++i) put(output+8+4*i,machine.cpu.r[i]);
    o_copy(output+72,machine.ram+0x2000,256);
    return 0;
}
#ifndef __wasm__
int main(void) {
#ifdef _WIN32
    if (_setmode(_fileno(stdin), _O_BINARY)==-1 ||
        _setmode(_fileno(stdout), _O_BINARY)==-1) return 74;
#endif
    if (initialize()) return 74;
    unsigned cases=0;
    for (;;) {
        size_t n=fread(input,1,sizeof(input),stdin);
        if (!n && feof(stdin)) break;
        if (n!=sizeof(input) || ++cases>100000) return ferror(stdin)?74:64;
        if (step()) return 64;
        if (fwrite(output,1,sizeof(output),stdout)!=sizeof(output)) return 74;
    }
    return ferror(stdin)||ferror(stdout)||fflush(stdout)?74:0;
}
#endif
