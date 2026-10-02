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
    uint32_t weak_only = s->gpio_bias_known[port] & ~*known;
    *known |= weak_only;
    *levels |= s->gpio_bias_levels[port] & weak_only;
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
        else if (direction == 0 || direction == 2) {
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
void o_eint_tick(orchard_machine *m) {
    o_soc *s = &m->soc;
    if (!s->keyboard_attached) return;
    uint32_t known = 0, levels = 0;
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
                if (line < 4) s->srcpnd |= bit;
                else s->gpio[0xa8 / 4] |= bit;
            }
        }
    }
    s->eint_known = known;
    s->eint_levels = levels;
    uint32_t pending = s->gpio[0xa8 / 4] & ~s->gpio[0xa4 / 4];
    if (pending & 0xf0u) s->srcpnd |= 1u << 4;
    if (pending & 0xffff00u) s->srcpnd |= 1u << 5;
}
