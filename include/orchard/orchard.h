/* SPDX-License-Identifier: MIT */
#ifndef ORCHARD_H
#define ORCHARD_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct orchard_machine orchard_machine;

typedef enum {
    ORCHARD_OK = 0,
    ORCHARD_BAD_ARGUMENT,
    ORCHARD_BAD_ROM_SIZE,
    ORCHARD_BAD_ROM_FORMAT,
    ORCHARD_NO_ROM,
    ORCHARD_UNSUPPORTED_INSTRUCTION,
    ORCHARD_UNSUPPORTED_CP15,
    ORCHARD_UNIMPLEMENTED_MMIO,
    ORCHARD_UNIMPLEMENTED_FLASH,
    ORCHARD_UNPREDICTABLE,
    ORCHARD_IO_FULL,
    ORCHARD_UNSUPPORTED_ENDIAN,
    ORCHARD_UNSUPPORTED_LCD,
    ORCHARD_BUS_ERROR,
    ORCHARD_UNIMPLEMENTED_RESET
} orchard_status;

typedef struct {
    unsigned id;                 /* Matches hpclang's stable model IDs. */
    const char *slug;
    const char *name;
    const char *family;
    uint32_t flash_bytes;
    uint32_t ram_bytes;
    unsigned lcd_width;
    unsigned lcd_height;
    bool sd_slot;
} orchard_profile;

typedef struct {
    orchard_status status;
    uint32_t pc;
    uint32_t instruction;
    uint32_t address;
    uint32_t detail;
} orchard_stop;

typedef struct {
    uint32_t registers[16];
    uint32_t cpsr;
    uint32_t cp15_control;
    uint32_t fault_status;
    uint32_t fault_address;
    uint64_t instructions;
    uint64_t ticks;              /* Deterministic quanta, NOT ARM clock cycles. */
    uint64_t exceptions;
    bool sleeping;
    bool rom_loaded;
    orchard_stop stop;
} orchard_state;

const orchard_profile *orchard_get_profile(unsigned id);
const char *orchard_status_string(orchard_status status);
/* Arena must be aligned to orchard_machine_alignment(). No core allocator. */
size_t orchard_machine_size(void);
size_t orchard_machine_alignment(void);
orchard_machine *orchard_init(void *arena, size_t bytes, unsigned model_id);
/* Full physical NOR only. Does not patch, pad, synthesize, or replace boot code. */
orchard_status orchard_load_rom(orchard_machine *m, const void *bytes, size_t length);
void orchard_reset(orchard_machine *m);
/* Each call is bounded. A zero budget does nothing. Unsupported devices stop. */
orchard_stop orchard_run(orchard_machine *m, uint32_t tick_budget);
void orchard_get_state(const orchard_machine *m, orchard_state *state);
/* Physical memory debug access; MMIO is deliberately not exposed here. */
orchard_status orchard_read_memory(const orchard_machine *m, uint32_t address,
                                   void *destination, size_t length);
/* Functional UART0 queues; these are not USB or a host-OS virtual device. */
size_t orchard_uart_send(orchard_machine *m, const uint8_t *data, size_t length);
size_t orchard_uart_receive(orchard_machine *m, uint8_t *data, size_t capacity);
/* Raw STN pixels, one intensity byte per pixel. No skin or annunciator overlays. */
orchard_status orchard_framebuffer(const orchard_machine *m, uint8_t *pixels,
                                   size_t capacity);
#ifdef __cplusplus
}
#endif
#endif
