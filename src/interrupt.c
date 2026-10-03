/* SPDX-License-Identifier: MIT
 * S3C2410A manual (2004), 14-3 through 14-5 and 14-12: two-level IRQ
 * arbitration. REQ0/5 stay fixed; only REQ1..4 rotate. FIQ bypasses it.
 */
#include "internal.h"

static unsigned choose(unsigned requests, unsigned selector) {
    if (requests & 1u) return 0;
    for (unsigned n = 0; n < 4; ++n) {
        unsigned request = 1u + ((selector + n) & 3u);
        if (requests & (1u << request)) return request;
    }
    return requests & 32u ? 5 : 6;
}
static void rotate(o_soc *s, unsigned arbiter, unsigned request) {
    if (!(s->priority & (1u << arbiter)) || request == 0 || request >= 5) return;
    unsigned shift = 7u + 2u * arbiter;
    s->priority = (s->priority & ~(3u << shift)) | ((request & 3u) << shift);
}
void o_irq_update(o_soc *s) {
    uint32_t sub = s->subsrcpnd & ~s->intsubmsk;
    if (sub & 7u) s->srcpnd |= 1u << 28;
    if (sub & (7u << 3)) s->srcpnd |= 1u << 23;
    if (sub & (7u << 6)) s->srcpnd |= 1u << 15;
    if (sub & (3u << 9)) s->srcpnd |= 1u << 31;
    if (s->intpnd) return; /* Preserve the awarded IRQ until W1C. */
    uint32_t requests = s->srcpnd & ~s->intmsk & ~s->intmod;
    requests &= ~((1u << 6) | (1u << 24)); /* Reserved interrupt sources. */
    if (!requests) return; /* No arbitration or priority rotation without a request. */
    unsigned group_requests[6] = {
        (requests & 15u) << 1, (requests >> 4) & 63u,
        (requests >> 10) & 63u, (requests >> 16) & 63u,
        (requests >> 22) & 63u, ((requests >> 28) & 15u) << 1
    };
    unsigned winners[6], groups = 0;
    for (unsigned group = 0; group < 6; ++group) {
        winners[group] = choose(group_requests[group], (s->priority >> (7u + 2u * group)) & 3u);
        if (winners[group] < 6) groups |= 1u << group;
    }
    unsigned group = choose(groups, (s->priority >> 19) & 3u);
    if (group == 6) return;
    unsigned request = winners[group];
    unsigned irq = group == 0 ? request - 1u : group == 5 ? request + 27u
        : (group * 6u - 2u) + request;
    s->intpnd = 1u << irq;
    rotate(s, group, request);
    rotate(s, 6, group);
}
