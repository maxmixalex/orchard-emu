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
#define O_QUEUE 1024u

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
    uint32_t srcpnd, intmod, intmsk, intpnd, subsrcpnd, intsubmsk;
    uint32_t memc[13], clock[6], gpio[48], lcd[8];
    uint32_t uart[3][11];
    uint32_t tcfg0, tcfg1, tcon, tcntb[5], tcmpb[4], count[5];
    uint32_t phase[5];
    uint32_t wtcon, wtdat, wtcnt, wtphase;
    o_queue rx, tx;
} o_soc;

struct orchard_machine {
    const orchard_profile *profile;
    o_cpu cpu;
    o_soc soc;
    uint64_t ticks;
    bool loaded;
    orchard_stop stop;
    uint8_t flash[O_FLASH_MAX];
    uint8_t ram[O_RAM_MAX];
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

bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_phys_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                 bool user, uint32_t *physical);
bool o_load(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t *value);
bool o_store(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t value);
void o_fault(o_cpu *c, uint32_t address, unsigned status, unsigned domain, bool fetch);
void o_soc_reset(o_soc *s);
void o_soc_tick(orchard_machine *m);
void o_irq_update(o_soc *s);
void o_watchdog_reset(o_soc *s);
void o_watchdog_tick(orchard_machine *m);
bool o_watchdog_register(o_soc *s, uint32_t address, uint32_t *value, bool write);
bool o_mmio_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value);
bool o_mmio_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value);
bool o_q_push(o_queue *q, uint8_t byte);
bool o_q_pop(o_queue *q, uint8_t *byte);
#endif
