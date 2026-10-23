/* SPDX-License-Identifier: MIT
 * GPB2 wiring: HP GCC SDK sys_playTone; GPB2/TOUT2 and PWM output rules:
 * Samsung S3C2410A user manual, chapters 9 and 10. Independently implemented.
 * See docs/development/buzzer.md for functional-clock and restore boundaries.
 */
#include "internal.h"

static bool level(const orchard_machine *m) {
    unsigned mode = (m->soc.gpio[4] >> 4) & 3u;
    if (mode == 1) return (m->soc.gpio[5] & 4u) != 0;
    if (mode == 2) return (m->soc.count[2] <= m->soc.active_compare[2]) != ((m->soc.tcon & 0x4000u) != 0);
    return false; /* Input/reserved functions do not drive the speaker. */
}
static void edge(orchard_machine *m, bool value) {
    o_buzzer *b = &m->buzzer;
    if (b->count == ORCHARD_BUZZER_CAPACITY) {
        /* Never stall a guest waiting for a host audio consumer. A new epoch
         * tells that consumer to discard the incomplete old waveform. */
        b->head = b->count = 0;
        ++b->epoch; ++b->overflows;
    }
    unsigned tail = (b->head + b->count) % ORCHARD_BUZZER_CAPACITY;
    b->edges[tail] = (orchard_buzzer_edge){m->ticks, value ? 1u : 0u};
    ++b->count; b->level = value;
}
void o_buzzer_reset(orchard_machine *m) {
    o_buzzer *b = &m->buzzer;
    bool enabled = b->enabled;
    uint32_t epoch = b->epoch + 1u;
    o_zero(b, sizeof(*b));
    b->enabled = enabled; b->epoch = epoch;
    b->level = level(m);
    if (enabled) edge(m, b->level);
}
void o_buzzer_observe(orchard_machine *m) {
    if (m->buzzer.enabled) {
        bool next = level(m);
        if (next != m->buzzer.level) edge(m, next);
    }
}
orchard_status orchard_buzzer_enable(orchard_machine *m, bool enabled) {
    if (!m || !m->profile) return ORCHARD_BAD_ARGUMENT;
    if (m->buzzer.enabled != enabled) {
        m->buzzer.enabled = enabled;
        o_buzzer_reset(m);
    }
    return ORCHARD_OK;
}
void orchard_buzzer_clear(orchard_machine *m) {
    if (m && m->profile) o_buzzer_reset(m);
}
void orchard_get_buzzer_state(const orchard_machine *m, orchard_buzzer_state *state) {
    if (!state) return;
    *state = (orchard_buzzer_state){0};
    if (!m || !m->profile) return;
    const o_buzzer *b = &m->buzzer;
    *state = (orchard_buzzer_state){m->ticks, b->epoch, b->overflows, b->count,
                                  O_FUNCTIONAL_TIMEBASE_HZ, b->enabled, b->level};
}
size_t orchard_buzzer_read(orchard_machine *m, orchard_buzzer_edge *edges, size_t capacity) {
    if (!m || !m->profile || !edges) return 0;
    o_buzzer *b = &m->buzzer;
    size_t n = b->count < capacity ? b->count : capacity;
    for (size_t i = 0; i < n; ++i) {
        edges[i] = b->edges[b->head];
        b->head = (b->head + 1u) % ORCHARD_BUZZER_CAPACITY;
    }
    b->count -= (uint32_t)n;
    return n;
}
