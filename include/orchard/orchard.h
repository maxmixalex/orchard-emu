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
    ORCHARD_GPIO_CONTENTION,
    ORCHARD_UNRESOLVED_ANALOG,
    ORCHARD_UNSUPPORTED_USB
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

/* Read-only diagnostic state; adc_data is meaningful only when adc_valid.
   This getter never acknowledges an IRQ or starts a conversion. */
typedef struct {
    uint32_t lcd_control, lcd_source_pending, lcd_interrupt_pending, lcd_interrupt_mask;
    uint64_t lcd_frames;
    uint32_t adc_control, adc_data, adc_remaining;
    bool adc_valid;
} orchard_peripheral_state;
void orchard_get_peripheral_state(const orchard_machine *m, orchard_peripheral_state *state);

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
/* Read-only GPB2 speaker observation (GPIO or Timer2/TOUT2). Edges carry the
 * functional tick, not a measured ARM cycle. The bounded host queue never
 * changes guest execution and is excluded from checkpoints. Overflow starts a
 * new epoch; hosts must discard their old audio. Reset and successful restore
 * also start a new epoch while preserving the enabled policy. */
#define ORCHARD_BUZZER_CAPACITY 4096u
typedef struct { uint64_t tick; uint32_t level; } orchard_buzzer_edge;
typedef struct {
    uint64_t tick;
    uint32_t epoch, overflows, queued, timebase_hz;
    bool enabled, level;
} orchard_buzzer_state;
orchard_status orchard_buzzer_enable(orchard_machine *m, bool enabled);
void orchard_buzzer_clear(orchard_machine *m);
void orchard_get_buzzer_state(const orchard_machine *m, orchard_buzzer_state *state);
size_t orchard_buzzer_read(orchard_machine *m, orchard_buzzer_edge *edges, size_t capacity);
/* Portable versioned state, excluding immutable NOR. Load the matching ROM first.
 * Save uses a non-overlapping buffer of exactly checkpoint_size bytes. Load
 * also accepts the bounded v1/v2 wire formats; export emits v3, including an
 * inserted SD card's complete image and its in-flight controller state.
 * Invalid data/ROM/version is rejected without changing the current machine.
 * CRC is corruption detection, not authentication; hosts should bind SHA-256. */
size_t orchard_checkpoint_size(const orchard_machine *m);
orchard_status orchard_checkpoint_save(const orchard_machine *m, void *buffer, size_t length);
orchard_status orchard_checkpoint_load(orchard_machine *m, const void *buffer, size_t length);
/* Validate a checkpoint without mutation and report its embedded SD image size.
 * This does not require SD storage to be bound yet. The matching ROM is required. */
orchard_status orchard_checkpoint_sd_size(const orchard_machine *m, const void *buffer,
                                          size_t length, size_t *required);

/* Functional SDSC memory card, 1/2/4/8/16/32 MiB, 512-byte sectors. The caller
 * owns the writable backing buffer and must keep it alive and unmodified while
 * inserted. Bind storage while ejected; insert consumes its existing bytes
 * without formatting. Only profiles with a physical SD slot accept media.
 * Eject preserves bytes and aborts card transfers with hardware timeout status.
 * Cold reset preserves insertion/image/write protection, resets card protocol.
 * Checkpoint v3 includes the image; load requires sufficient bound storage and
 * restores bytes and protocol atomically after validation. No core allocator. */
#define ORCHARD_SD_MAX_BYTES (32u * 1024u * 1024u)
typedef struct {
    uint32_t bytes, card_state, last_command;
    uint64_t commands, read_blocks, written_blocks;
    bool present, write_protected, dirty;
} orchard_sd_state;
orchard_status orchard_sd_bind(orchard_machine *m, void *storage, size_t capacity);
orchard_status orchard_sd_insert(orchard_machine *m, size_t length, bool write_protected);
orchard_status orchard_sd_eject(orchard_machine *m);
void orchard_get_sd_state(const orchard_machine *m, orchard_sd_state *state);

/* Physical memory debug access; MMIO is deliberately not exposed here. */
orchard_status orchard_read_memory(const orchard_machine *m, uint32_t address,
                                   void *destination, size_t length);
/* Functional UART0 queues; these are not USB or a host-OS virtual device. */
size_t orchard_uart_send(orchard_machine *m, const uint8_t *data, size_t length);
size_t orchard_uart_receive(orchard_machine *m, uint8_t *data, size_t capacity);
/* Functional, acknowledged USB transactions, NOT a host-OS virtual device.
 * Call only between run() slices on the machine owner. No descriptor contents
 * are synthesized. The caller explicitly supplies bus presence/reset/SOF.
 * Cold reset detaches the host. Disconnect does not reset guest registers.
 * Reset signaling resets the USB block only; guest CPU/SRAM remain unchanged.
 * PIO EP0 (8/16-byte packets) and single-packet bulk EP1..4 (64-byte MAXP).
 * CRC/bit timing, DMA, ISO, dual-packet bulk and automatic suspend are absent.
 */
typedef enum {
    ORCHARD_USB_ACK = 0, ORCHARD_USB_NAK, ORCHARD_USB_STALL,
    ORCHARD_USB_NO_RESPONSE, ORCHARD_USB_BAD_ARGUMENT,
    ORCHARD_USB_UNSUPPORTED, ORCHARD_USB_BUFFER_SMALL
} orchard_usb_result;
typedef struct {
    uint32_t address, active_address, power, index, ep_pending, bus_pending;
    uint32_t ep_enable, bus_enable, frame, phase;
    uint32_t max_packet[5], in_csr[5], out_csr[5], tx_bytes[5], rx_bytes[5];
    uint64_t resets, setups, in_packets, out_packets;
    bool connected;
} orchard_usb_state;
void orchard_get_usb_state(const orchard_machine *m, orchard_usb_state *state);
orchard_status orchard_usb_connect(orchard_machine *m, bool connected);
orchard_status orchard_usb_reset_signal(orchard_machine *m, bool asserted);
orchard_status orchard_usb_sof(orchard_machine *m, unsigned frame);
/* setup must be DATA0, endpoint 0, exactly 8 bytes. OUT uses explicit DATA0/1;
 * duplicate DATA packets are ACKed without re-enqueueing. One call represents
 * a complete valid packet; it does not write guest RAM or advance guest time. */
orchard_usb_result orchard_usb_out(orchard_machine *m, unsigned address,
                                  unsigned endpoint, bool setup, unsigned data1,
                                  const uint8_t *bytes, size_t length);
/* On ACK result, length/data1 describe one packet. ack=false previews/retries
 * without consuming it; ack=true includes host ACK, advancing FIFO/toggle.
 * BUFFER_SMALL reports required length with no transaction side effects.
 * No IN data means NAK, never an invented zero-length successful packet. */
orchard_usb_result orchard_usb_in(orchard_machine *m, unsigned address,
                                 unsigned endpoint, bool ack, uint8_t *bytes,
                                 size_t capacity, size_t *length, unsigned *data1);
/* Explicit ideal ADC sample code, NOT a battery voltage/model default.
   Channels 0..7 and codes 0..1023. Cold reset releases all inputs.
   Unknown channels stop when sampled. A started conversion holds its sample. */
orchard_status orchard_adc_input(orchard_machine *m, unsigned channel,
                                  bool known, unsigned code);
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
typedef enum { ORCHARD_NOR_UNSPECIFIED = 0, ORCHARD_NOR_SST39VF1601, ORCHARD_NOR_SST39VF800A } orchard_nor_device;
orchard_status orchard_nor_select(orchard_machine *m, orchard_nor_device device);
/* Explicit external SRAM address-decode hypothesis. EXACT is the default.
 * BANK1_MIRROR connects only the installed SRAM's address bits throughout
 * nGCS1 (0x08000000..0x0fffffff); it does not allocate additional RAM.
 * No board is automatically assigned this unmeasured wiring. Configuration
 * persists across cold reset like a physical component; access counters reset.
 * Pure debug/framebuffer reads do not increment bus-transaction counters.
 */
typedef enum { ORCHARD_SRAM_EXACT = 0, ORCHARD_SRAM_BANK1_MIRROR } orchard_sram_decode;
orchard_status orchard_sram_select(orchard_machine *m, orchard_sram_decode decode);
uint64_t orchard_sram_alias_reads(const orchard_machine *m);
uint64_t orchard_sram_alias_writes(const orchard_machine *m);
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
/* Read-only packed display inspection: indices are I/O, left shift, right
 * shift, alpha, battery, busy. These are six segment samples beyond the
 * 131-column matrix, not extra visible columns. Physical routing unverified.
 * Returns unsupported for a stream without a 160-pixel row / six lines. */
orchard_status orchard_annunciators(const orchard_machine *m, uint8_t levels[6]);
orchard_status orchard_framebuffer(const orchard_machine *m, uint8_t *pixels,
                                   size_t capacity);
#ifdef __cplusplus
}
#endif
#endif
