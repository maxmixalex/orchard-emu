/* SPDX-License-Identifier: MIT
 * Original switch-network model. Wiring evidence: newRPL target_50g keyboard
 * scan and hpclang's six-model raw GPIO scan; see docs/development/input.md.
 * No ROM variables, key queues or instruction addresses are intercepted.
 */
#include "internal.h"

orchard_status orchard_keyboard_attach(orchard_machine *m, bool attached) {
    if (!m || !m->profile) return ORCHARD_BAD_ARGUMENT;
    m->soc.keyboard_attached = attached;
    m->soc.keyboard_switches = 0;
    m->soc.keyboard_direct = 0;
    m->soc.eint_known = 0;
    return ORCHARD_OK;
}
orchard_status orchard_keyboard_matrix(orchard_machine *m, unsigned column, unsigned row, bool down) {
    if (!m || !m->profile || !m->soc.keyboard_attached || column >= 8 || row >= 7)
        return ORCHARD_BAD_ARGUMENT;
    uint64_t bit = UINT64_C(1) << (column * 7u + row);
    if (down) m->soc.keyboard_switches |= bit;
    else m->soc.keyboard_switches &= ~bit;
    return ORCHARD_OK;
}
orchard_status orchard_keyboard_dedicated(orchard_machine *m, unsigned pin, bool down) {
    if (!m || !m->profile || !m->soc.keyboard_attached ||
        (pin != 0 && pin != 4 && pin != 5 && pin != 6)) return ORCHARD_BAD_ARGUMENT;
    if (down) m->soc.keyboard_direct |= 1u << pin;
    else m->soc.keyboard_direct &= ~(1u << pin);
    return ORCHARD_OK;
}
static unsigned root(unsigned *parents, unsigned pin) {
    while (parents[pin] != pin) pin = parents[pin];
    return pin;
}
/* A known external stimulus applies to input pads, never to output latches.
 * Matrix switches connect pads bidirectionally. Strong drives beat pull-ups;
 * contradictory drives are reported, not arbitrarily resolved low or high.
 * Floating components remain unknown. This includes disconnected columns
 * whose internal pull-up is disabled at reset.
 */
void o_gpio_sample(const orchard_machine *m, unsigned port, uint32_t *known,
                   uint32_t *levels, uint32_t *conflicts) {
    const o_soc *s = &m->soc;
    uint32_t con = s->gpio[port * 4], latch = s->gpio[port * 4 + 1];
    *known = s->gpio_input_known[port];
    *levels = s->gpio_input_levels[port];
    *conflicts = 0;
    /* Samsung S3C2410A chapter 9: GPxUP=0 enables the weak pull-up on
       every port B..H, not only the attached keyboard's matrix port. A
       strong external drive wins; opposed weak biases remain unresolved.
       Keep the matrix's connected-net resolution below authoritative. */
    static const unsigned pins[8] = {0,11,16,16,16,8,16,11};
    uint32_t internal_up = port ? ~s->gpio[port * 4 + 2] & ((1u << pins[port]) - 1u) : 0;
    uint32_t weak_high = internal_up | (s->gpio_bias_known[port] & s->gpio_bias_levels[port]);
    uint32_t weak_low = s->gpio_bias_known[port] & ~s->gpio_bias_levels[port];
    uint32_t weak_only = (weak_high ^ weak_low) & ~*known;
    *known |= weak_only;
    *levels |= weak_high & weak_only;
    if (!s->keyboard_attached) return;
    if (port == ORCHARD_GPIO_F) {
        *conflicts = (s->gpio_input_levels[port] ^ s->keyboard_direct) & s->gpio_input_known[port] & 0x71u;
        *known |= 0x71u;
        *levels = (*levels & ~0x71u) | s->keyboard_direct;
        return;
    }
    if (port != ORCHARD_GPIO_G) return;
    unsigned parents[16], drive[16] = {0};
    for (unsigned pin = 0; pin < 16; ++pin) parents[pin] = pin;
    for (unsigned col = 0; col < 8; ++col)
        for (unsigned row = 0; row < 7; ++row)
            if (s->keyboard_switches & (UINT64_C(1) << (col * 7u + row)))
                parents[root(parents, row + 1)] = root(parents, col + 8);
    for (unsigned pin = 1; pin < 16; ++pin) {
        unsigned direction = (con >> (pin * 2u)) & 3u;
        unsigned *d = &drive[root(parents, pin)];
        if (direction == 1) *d |= latch & (1u << pin) ? 2u : 1u;
        else if (direction == 0 || direction == 2 ||
                 (pin == 5 && direction == 3 && (s->spi[1].control & 8u))) {
            /* GPG5 function 11 is SPI1 MISO, an input in master mode.
               Its real pull-up/external drives still use this net resolver. */
            if (s->gpio_input_known[port] & (1u << pin))
                *d |= s->gpio_input_levels[port] & (1u << pin) ? 2u : 1u;
            if (!(s->gpio[port * 4 + 2] & (1u << pin))) *d |= 4u;
        }
        else *d |= 8u; /* Unmodeled alternate-function drive: net unresolved. */
        if (s->gpio_bias_known[port] & (1u << pin))
            *d |= s->gpio_bias_levels[port] & (1u << pin) ? 4u : 16u;
    }
    for (unsigned pin = 1; pin < 16; ++pin) {
        unsigned d = drive[root(parents, pin)];
        uint32_t bit = 1u << pin;
        *known &= ~bit; *levels &= ~bit;
        if ((d & 3u) == 3u) *conflicts |= bit;
        else if (!(d & 8u) && ((d & 3u) || (d & 20u) == 4u || (d & 20u) == 16u)) {
            *known |= bit;
            if ((d & 2u) || (!(d & 1u) && (d & 4u))) *levels |= bit;
        }
    }
}
/* Unfiltered EINT sampling at virtual-quantum boundaries, not subcycle
 * debounce. Unknown pads never create edges. Enabling/changing pin function
 * starts edge history afresh; level sources remain active until deasserted.
 */
static void eint_pending(o_soc *s) {
    uint32_t pending = s->gpio[0xa8 / 4] & ~s->gpio[0xa4 / 4];
    if (pending & 0xf0u) s->srcpnd |= 1u << 4;
    if (pending & 0xffff00u) s->srcpnd |= 1u << 5;
}
#ifndef ORCHARD_REFERENCE
static bool eint_same(o_soc *s, uint32_t *key) {
    unsigned n = 0;
    for (unsigned p = ORCHARD_GPIO_F; p <= ORCHARD_GPIO_G; ++p) {
        key[n++] = s->gpio[p * 4];
        key[n++] = s->gpio[p * 4 + 1];
        key[n++] = s->gpio[p * 4 + 2];
        key[n++] = s->gpio_input_known[p];
        key[n++] = s->gpio_input_levels[p];
        key[n++] = s->gpio_bias_known[p];
        key[n++] = s->gpio_bias_levels[p];
    }
    for (unsigned i = 0; i < 3; ++i) key[n++] = s->gpio[0x88 / 4 + i];
    key[n++] = s->keyboard_attached;
    const o_eint_cache *c = &s->eint_cache;
    if (!c->valid || c->switches != s->keyboard_switches ||
        c->direct != s->keyboard_direct || c->known != s->eint_known ||
        c->levels != s->eint_levels) return false;
    for (unsigned i = 0; i < n; ++i) if (key[i] != c->key[i]) return false;
    return true;
}
#endif
void o_eint_tick(orchard_machine *m) {
    o_soc *s = &m->soc;
    if (!s->keyboard_attached) { s->eint_cache.valid = false; return; }
#ifndef ORCHARD_REFERENCE
    uint32_t key[18];
    if (eint_same(s, key)) {
        /* Stable level sources reassert every quantum, even after W1C.
           Edge sources do NOT reassert until another actual transition. */
        s->srcpnd |= s->eint_cache.level_sources & 15u;
        s->gpio[0xa8 / 4] |= s->eint_cache.level_sources & ~15u;
        if (s->clock[3]&8u) m->power_wake|=s->eint_cache.level_sources&0xffffu;
        eint_pending(s);
        return;
    }
#endif
    s->eint_cache.valid = false;
    uint32_t known = 0, levels = 0, level_sources = 0;
    for (unsigned p = ORCHARD_GPIO_F; p <= ORCHARD_GPIO_G; ++p) {
        uint32_t k, v, conflicts;
        o_gpio_sample(m, p, &k, &v, &conflicts);
        unsigned count = p == ORCHARD_GPIO_F ? 8 : 16;
        for (unsigned pin = 0; pin < count; ++pin) {
            if (((s->gpio[p * 4] >> (pin * 2u)) & 3u) != 2) continue;
            unsigned line = p == ORCHARD_GPIO_F ? pin : pin + 8;
            uint32_t bit = 1u << line;
            if (conflicts & (1u << pin)) {
                o_stop(m, ORCHARD_GPIO_CONTENTION, 0x56000000u + p * 16u + 4u, conflicts); return;
            }
            if (!(k & (1u << pin))) continue;
            uint32_t control = s->gpio[0x88 / 4 + line / 8];
            unsigned mode = (control >> (line % 8 * 4)) & 7u;
            if (line >= 16 && (control & (8u << (line % 8 * 4)))) {
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, 0x56000090u, control);
                return;
            }
            known |= bit;
            bool high = (v & (1u << pin)) != 0;
            if (high) levels |= bit;
            bool changed = (s->eint_known & bit) && ((s->eint_levels ^ levels) & bit);
            bool triggered = mode == 0 ? !high : mode == 1 ? high :
                changed && (mode >= 6 || (mode >= 4 ? high : !high));
            if (triggered) {
                if ((s->clock[3]&8u) && line<16) m->power_wake|=bit;
                if (mode <= 1) level_sources |= bit;
                if (line < 4) s->srcpnd |= bit;
                else s->gpio[0xa8 / 4] |= bit;
            }
        }
    }
    s->eint_known = known;
    s->eint_levels = levels;
    eint_pending(s);
#ifndef ORCHARD_REFERENCE
    o_eint_cache *c = &s->eint_cache;
    for (unsigned i = 0; i < 18; ++i) c->key[i] = key[i];
    c->switches = s->keyboard_switches; c->direct = s->keyboard_direct;
    c->known = known; c->levels = levels; c->level_sources = level_sources;
    c->valid = true;
#else
    (void)level_sources;
#endif
}
