/* SPDX-License-Identifier: MIT */
#ifndef ORCHARD_INTERNAL_H
#define ORCHARD_INTERNAL_H
#include "orchard/orchard.h"

#define O_N UINT32_C(0x80000000)
#define O_Z UINT32_C(0x40000000)
#define O_C UINT32_C(0x20000000)
#define O_V UINT32_C(0x10000000)
#define O_I 0x80u
#define O_F 0x40u
#define O_T 0x20u
#define O_USR 0x10u
#define O_FIQ 0x11u
#define O_IRQ 0x12u
#define O_SVC 0x13u
#define O_ABT 0x17u
#define O_UND 0x1bu
#define O_SYS 0x1fu
#define O_FLASH_MAX 0x200000u
#define O_RAM_MAX 0x80000u
#define O_RAM_BASE 0x08000000u
#define O_RAM_BANK_SIZE 0x08000000u
#define O_BOOT_SRAM_BASE 0x40000000u
#define O_BOOT_SRAM_SIZE 0x1000u
#define O_QUEUE 1024u
#define O_FUNCTIONAL_TIMEBASE_HZ 12000000u

/* Exact-width, unaligned-safe host reads from an already checked byte span.
 * Constant-size memcpy is recognized as a load, without pointer casts/aliasing
 * UB. Byte assembly remains the portable big-endian/reference implementation. */
static inline uint32_t o_read_le(const uint8_t *p, unsigned width) {
#if !defined(ORCHARD_REFERENCE) && defined(__BYTE_ORDER__) && \
    __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__ && (defined(__GNUC__) || defined(__clang__))
    if (width == 4) { uint32_t v; __builtin_memcpy(&v, p, 4); return v; }
    if (width == 2) { uint16_t v; __builtin_memcpy(&v, p, 2); return v; }
    return p[0];
#else
    uint32_t value = 0;
    for (unsigned i = 0; i < width; ++i) value |= (uint32_t)p[i] << (8u * i);
    return value;
#endif
}

typedef struct {
    uint8_t data[O_QUEUE];
    unsigned head, count;
} o_queue;

typedef struct {
    uint32_t r[16], cpsr;
    uint32_t usr[7], fiq[7], bank[4][2], spsr[5];
    uint32_t control, ttb, domain, dfsr, ifsr, far, pid;
    uint32_t next_pc;
    uint64_t instructions, exceptions;
    bool sleeping, data_abort, prefetch_abort;
} o_cpu;

typedef struct {
    uint8_t reg[19];
    uint32_t phase, divider, tick_count;
} o_rtc;

typedef struct {
    uint32_t con, tsc, delay;
    uint32_t remaining;
    uint16_t inputs[8], sample, data;
    uint8_t known;
    bool valid;
} o_adc;

typedef struct {
    uint8_t tx[64], rx[64];
    unsigned tx_count, rx_count, rx_pos;
    uint8_t maxp, in1, in2, out1, out2, tx_toggle, rx_toggle;
    uint8_t dma[6];
} o_usb_ep;
typedef struct {
    o_usb_ep ep[5];
    uint8_t address, active_address, power, index, ep_pending, bus_pending;
    uint8_t ep_enable, bus_enable;
    uint16_t frame, control_length;
    unsigned phase;
    bool connected, control_in;
    uint64_t resets, setups, in_packets, out_packets;
} o_usb;

/* Host optimization state only. Exact input comparison, not a hash or a
 * hardware debounce filter. It must never replace architectural EINT state. */
typedef struct {
    uint32_t key[18];
    uint64_t switches;
    uint32_t direct, known, levels, level_sources;
    bool valid;
} o_eint_cache;

typedef struct {
    uint32_t srcpnd, intmod, intmsk, intpnd, subsrcpnd, intsubmsk, priority;
    uint32_t memc[13], clock[6], gpio[48], lcd[25];
    uint32_t lcd_phase, lcd_line;
    uint64_t lcd_frames;
    o_adc adc;
    o_usb usb;
    uint32_t gpio_input_known[8], gpio_input_levels[8];
    uint32_t gpio_bias_known[8], gpio_bias_levels[8];
    bool lcd_probe68_idle_zero;
    uint64_t lcd_probe68_reads;
    bool keyboard_attached;
    uint64_t keyboard_switches;
    uint32_t keyboard_direct, eint_known, eint_levels;
    o_eint_cache eint_cache;
    uint32_t uart[3][11];
    uint32_t tcfg0, tcfg1, tcon, tcntb[5], tcmpb[4], count[5];
    uint32_t phase[5];
    uint32_t wtcon, wtdat, wtcnt, wtphase;
    o_queue rx, tx;
    o_rtc rtc;
} o_soc;

/* Host memoization, NOT guest TLB state. A hit revalidates both live table
 * words and the full translation context. Offsets survive machine relocation;
 * only side-effect-free, non-aliased physical table storage is admitted. */
typedef struct {
    uint32_t virtual_page, physical_page, control, ttb, domain, access;
    uint32_t first_offset, first_word, second_offset, second_word;
} o_translation;
#define O_TRANSLATIONS 64u

struct orchard_machine {
    const orchard_profile *profile;
    uint32_t quiet_left, deferred_ticks; /* Host-only, flushed at public boundaries. */
    o_translation translations[O_TRANSLATIONS];
    o_cpu cpu;
    o_soc soc;
    uint64_t ticks;
    bool loaded;
    orchard_nor_device nor_device;
    orchard_sram_decode sram_decode;
    uint64_t sram_alias_reads, sram_alias_writes;
    unsigned nor_sequence;
    bool nor_id_mode;
    orchard_stop stop;
    uint8_t flash[O_FLASH_MAX];
    uint8_t ram[O_RAM_MAX];
    uint8_t boot_sram[O_BOOT_SRAM_SIZE];
};

void o_zero(void *p, size_t size);
void o_copy(void *dst, const void *src, size_t size);
void o_stop(orchard_machine *m, orchard_status status, uint32_t address, uint32_t detail);
uint32_t o_ror(uint32_t n, unsigned amount);
void o_cpu_reset(o_cpu *c);
bool o_mode_valid(uint32_t mode);
void o_set_cpsr(o_cpu *c, uint32_t value);
uint32_t *o_spsr(o_cpu *c);
void o_exception(o_cpu *c, unsigned mode, uint32_t vector, uint32_t link);
void o_cpu_step(orchard_machine *m);
/* Full-checkpoint dispatcher retained for test/reference comparison. */
void o_cpu_step_reference(orchard_machine *m);
uint32_t o_getr(const o_cpu *c, unsigned r);
void o_putr(o_cpu *c, unsigned r, uint32_t value);
uint32_t o_get_user(const o_cpu *c, unsigned r);
void o_put_user(o_cpu *c, unsigned r, uint32_t value);
bool o_condition(const o_cpu *c, unsigned condition);
void o_nz(o_cpu *c, uint32_t value);
uint32_t o_add(o_cpu *c, uint32_t a, uint32_t b, unsigned carry, bool flags);
uint32_t o_shift(uint32_t value, unsigned kind, unsigned amount,
                 bool immediate, bool *carry);
void o_thumb(orchard_machine *m, uint16_t op);
bool o_cp15(orchard_machine *m, uint32_t op);

bool o_sram_copy(const orchard_machine *m, uint32_t address, void *destination, size_t length);
bool o_sram_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_sram_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_nor_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_nor_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_phys_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_translate_reference(orchard_machine *m, uint32_t address, bool write, bool fetch,
                           bool user, uint32_t *physical);
bool o_translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                 bool user, uint32_t *physical);
bool o_load(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t *value);
bool o_store(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t value);
void o_fault(o_cpu *c, uint32_t address, unsigned status, unsigned domain, bool fetch);
void o_soc_reset(o_soc *s);
void o_soc_tick(orchard_machine *m);
void o_schedule_plan(orchard_machine *m);
void o_schedule_sync(orchard_machine *m);
orchard_stop o_run_reference(orchard_machine *m, uint32_t budget);
void o_irq_update(o_soc *s);
void o_gpio_reset(o_soc *s);
void o_gpio_sample(const orchard_machine *m, unsigned port, uint32_t *known,
                   uint32_t *levels, uint32_t *conflicts);
void o_eint_tick(orchard_machine *m);
bool o_gpio_register(orchard_machine *m, uint32_t address, uint32_t *value, bool write);
void o_rtc_reset(o_soc *s);
void o_rtc_tick(orchard_machine *m);
void o_rtc_clock(orchard_machine *m);
bool o_rtc_register(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value, bool write);
void o_watchdog_reset(o_soc *s);
void o_watchdog_tick(orchard_machine *m);
bool o_watchdog_register(o_soc *s, uint32_t address, uint32_t *value, bool write);
void o_usb_reset(o_usb *u);
void o_usb_tick(orchard_machine *m);
bool o_usb_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write);
void o_adc_reset(o_adc *a);
void o_adc_tick(orchard_machine *m);
bool o_adc_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write);
void o_lcd_reset(o_soc *s);
void o_lcd_tick(orchard_machine *m);
bool o_lcd_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write);
bool o_lcd_probe68_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_mmio_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_mmio_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_q_push(o_queue *q, uint8_t byte);
bool o_q_pop(o_queue *q, uint8_t *byte);
#endif
