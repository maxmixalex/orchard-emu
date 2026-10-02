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
    ORCHARD_UNIMPLEMENTED_RESET,
    ORCHARD_GPIO_CONTENTION
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
/* External GPIO stimuli, not model wiring or a high-level keyboard interface.
 * Port numbers match B=1 through H=7; port A has no input mode.
 * Replace the known input mask/levels of one port. Unspecified input pins
 * remain unresolved; output-mode pins read their guest-controlled latch.
 * Levels must be a subset of known_mask. Zero mask releases the whole port.
 * Cold reset/loading a ROM clears stimuli. EINT sampling is opt-in through
 * keyboard attachment; this call does not clear an existing diagnostic stop.
 * Call only from the machine's owner.
 */
typedef enum {
    ORCHARD_GPIO_B = 1, ORCHARD_GPIO_C, ORCHARD_GPIO_D, ORCHARD_GPIO_E,
    ORCHARD_GPIO_F, ORCHARD_GPIO_G, ORCHARD_GPIO_H
} orchard_gpio_port;
orchard_status orchard_gpio_inputs(orchard_machine *m, orchard_gpio_port port,
                                   uint32_t known_mask, uint32_t levels);
/* Explicit weak external bias. Same mask/level convention as gpio_inputs:
 * mask=1,level=1 adds a pull-up; mask=1,level=0 adds a pull-down.
 * Strong drives dominate. Opposing weak biases without a strong drive leave
 * a net unresolved, not shorted. This is digital resolution, not resistance
 * or analog timing. Cold reset releases bias. No board default is inferred.
 */
orchard_status orchard_gpio_bias(orchard_machine *m, orchard_gpio_port port,
                                 uint32_t known_mask, uint32_t levels);
/* Opt-in Apples electrical keyboard: columns GPG8..15, rows GPG1..7,
 * dedicated active-high inputs GPF0/4/5/6. Matrix indices are raw switch
 * positions, not 56 physical keys or a model-specific printed-key map.
 * Attach releases keys; cold reset detaches it. Unrelated/floating GPIO pads
 * still need explicit inputs. EINT0..23 is sampled without digital filters
 * while attached. Key events must be delivered by the machine owner between
 * bounded run calls. A switch change never clears a diagnostic stop.
 */
orchard_status orchard_keyboard_attach(orchard_machine *m, bool attached);
orchard_status orchard_keyboard_matrix(orchard_machine *m, unsigned column, unsigned row, bool down);
orchard_status orchard_keyboard_dedicated(orchard_machine *m, unsigned gpf_pin, bool down);
/* Optional physical NOR part: array reads / software ID only for now.
 * A selected part survives cold reset, while command/ID state is reset.
 * Selection does not modify the supplied NOR bytes and is not inferred from
 * the calculator model or file contents. Program/erase remain unsupported.
 */
typedef enum { ORCHARD_NOR_UNSPECIFIED = 0, ORCHARD_NOR_SST39VF1601 } orchard_nor_device;
orchard_status orchard_nor_select(orchard_machine *m, orchard_nor_device device);
/* Opt-in, unverified LCD +0x68 hypothesis. When enabled, aligned word reads
 * return zero ONLY while ENVID is clear. Other widths, active-display reads,
 * writes and neighboring unknown addresses still stop. No FIFO is implied.
 * Count every such read; disabling the option does not erase that evidence.
 * Cold reset disables the hypothesis and clears its count. */
orchard_status orchard_lcd_probe68(orchard_machine *m, bool idle_zero);
uint64_t orchard_lcd_probe68_reads(const orchard_machine *m);
/* CONTROLLER is the documented raw STN stream. PACKED_LSB is an alternative
 * memory-inspection view, NOT a verified physical panel mapping. Selecting a
 * view never changes the CPU, LCD registers, or probe68 policy/counter. */
typedef enum { ORCHARD_FRAME_CONTROLLER = 0, ORCHARD_FRAME_PACKED_LSB } orchard_frame_view;
orchard_status orchard_framebuffer_view(const orchard_machine *m, orchard_frame_view view,
                                        uint8_t *pixels, size_t capacity);
/* Raw STN pixels, one intensity byte per pixel. No skin or annunciator overlays. */
orchard_status orchard_framebuffer(const orchard_machine *m, uint8_t *pixels,
                                   size_t capacity);
#ifdef __cplusplus
}
#endif
#endif
