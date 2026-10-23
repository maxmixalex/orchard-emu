/* SPDX-License-Identifier: MIT
 * Original functional S3C2410A USB device model. Samsung manual (2004),
 * chapter 13: byte/word registers, indexed CSRs, FIFO and interrupt semantics.
 * Packet boundary API assumes a valid USB packet (no wire/CRC/DMA model).
 */
#include "internal.h"

#define U_BASE 0x52000000u
#define U_IRQ (1u << 25)
#define E0_OUT 1u
#define E0_IN 2u
#define E0_SENT 4u
#define E0_END 8u
#define E0_SETUP_END 16u
#define E0_STALL 32u
/* Control stage numbers are exposed only as diagnostic state, not host actions. */
enum { U_IDLE, U_SETUP, U_DATA_IN, U_DATA_OUT, U_STATUS_IN, U_STATUS_OUT };

void o_usb_reset(o_usb *u) {
    o_zero(u, sizeof(*u));
    /* Reserved bits read zero even though the register table says 0xff. */
    u->ep_enable = 0x1f;
    u->bus_enable = 4;
    for (unsigned n = 0; n < 5; ++n) {
        u->ep[n].maxp = 1;
        u->ep[n].in2 = 0x20;
    }
}
void o_usb_tick(orchard_machine *m) {
    o_usb *u = &m->soc.usb;
    /* Pending USB events are latched until their own W1C, independently of
       main SRCPND/INTPND. Resume has no separate enable bit (13-9). */
    if ((u->ep_pending & u->ep_enable) ||
        (u->bus_pending & (u->bus_enable | 2u))) m->soc.srcpnd |= U_IRQ;
}
orchard_status orchard_usb_connect(orchard_machine *m, bool connected) {
    if (!m || !m->profile) return ORCHARD_BAD_ARGUMENT;
    m->soc.usb.connected = connected;
    return ORCHARD_OK;
}
orchard_status orchard_usb_reset_signal(orchard_machine *m, bool asserted) {
    if (!m || !m->profile || !m->soc.usb.connected) return ORCHARD_BAD_ARGUMENT;
    o_usb *u = &m->soc.usb;
    if (asserted && !(u->power & 8u)) {
        uint64_t resets = u->resets, setups = u->setups;
        uint64_t in = u->in_packets, out = u->out_packets;
        o_usb_reset(u);
        u->connected = true;
        u->resets = resets + 1; u->setups = setups;
        u->in_packets = in; u->out_packets = out;
        u->power = 8;
        u->bus_pending = 4;
    } else if (!asserted) u->power &= (uint8_t)~8u;
    return ORCHARD_OK;
}
orchard_status orchard_usb_sof(orchard_machine *m, unsigned frame) {
    if (!m || !m->profile || frame > 2047 || !m->soc.usb.connected ||
        (m->soc.usb.power & 8u)) return ORCHARD_BAD_ARGUMENT;
    m->soc.usb.frame = (uint16_t)frame;
    return ORCHARD_OK;
}
void orchard_get_usb_state(const orchard_machine *m, orchard_usb_state *state) {
    if (!m || !state) return;
    const o_usb *u = &m->soc.usb;
    o_zero(state, sizeof(*state));
    state->address = u->address; state->active_address = u->active_address;
    state->power = u->power; state->index = u->index;
    state->ep_pending = u->ep_pending; state->bus_pending = u->bus_pending;
    state->ep_enable = u->ep_enable; state->bus_enable = u->bus_enable;
    state->frame = u->frame; state->phase = u->phase;
    state->connected = u->connected; state->resets = u->resets;
    state->setups = u->setups; state->in_packets = u->in_packets;
    state->out_packets = u->out_packets;
    for (unsigned n = 0; n < 5; ++n) {
        const o_usb_ep *e = &u->ep[n];
        state->max_packet[n] = e->maxp * 8u;
        state->in_csr[n] = e->in1 | (uint32_t)e->in2 << 8;
        state->out_csr[n] = e->out1 | (uint32_t)e->out2 << 8;
        state->tx_bytes[n] = e->tx_count;
        state->rx_bytes[n] = e->rx_count - e->rx_pos;
    }
}
static bool unsupported(orchard_machine *m, uint32_t address, uint32_t detail) {
    o_stop(m, ORCHARD_UNSUPPORTED_USB, address, detail);
    return false;
}
static unsigned maxp(const o_usb_ep *e) { return e->maxp * 8u; }
static bool mode_supported(const o_usb_ep *e, unsigned ep) {
    return ep ? e->maxp == 8 && !(e->dma[0] & 7u) &&
                !(e->in2 & 0x40u) && !(e->out2 & 0x40u)
              : e->maxp == 1 || e->maxp == 2;
}
static bool available(const o_usb *u, unsigned address) {
    return u->connected && !(u->power & 10u) && u->active_address == address;
}
static void control_done(o_usb *u) {
    o_usb_ep *e = &u->ep[0];
    u->phase = U_IDLE;
    e->in1 &= (uint8_t)~(E0_END | E0_IN | E0_OUT);
    e->tx_count = e->rx_count = e->rx_pos = 0;
    if (u->address & 128u) {
        u->active_address = u->address & 127u;
        u->address &= 127u;
    }
    u->ep_pending |= 1;
}
static orchard_usb_result stall(o_usb *u, unsigned ep, bool in) {
    o_usb_ep *e = &u->ep[ep];
    if (!ep) { e->in1 |= E0_SENT; e->in1 &= (uint8_t)~E0_STALL; }
    else if (in) { e->in1 |= 0x20; e->in1 &= (uint8_t)~1u; }
    else e->out1 |= 0x40;
    u->ep_pending |= (uint8_t)(1u << ep);
    return ORCHARD_USB_STALL;
}
orchard_usb_result orchard_usb_out(orchard_machine *m, unsigned address,
                                  unsigned ep, bool setup, unsigned data1,
                                  const uint8_t *bytes, size_t length) {
    if (!m || !m->profile || address > 127 || ep >= 5 || data1 > 1 ||
        length > 64 || (!bytes && length) || (setup && (ep || data1 || length != 8)))
        return ORCHARD_USB_BAD_ARGUMENT;
    o_usb *u = &m->soc.usb;
    o_usb_ep *e = &u->ep[ep];
    if (!available(u, address)) return ORCHARD_USB_NO_RESPONSE;
    if (!mode_supported(e, ep)) return ORCHARD_USB_UNSUPPORTED;
    if (setup) {
        bool interrupted = u->phase != U_IDLE && !(e->in1 & E0_END);
        e->tx_count = e->rx_count = e->rx_pos = 0;
        e->in1 = E0_OUT | (interrupted ? E0_SETUP_END : 0);
        e->tx_toggle = e->rx_toggle = 1;
        u->address = u->active_address; /* Abandon uncommitted SET_ADDRESS. */
        o_copy(e->rx, bytes, length); e->rx_count = (unsigned)length;
        u->control_length = (uint16_t)((unsigned)bytes[6] | (unsigned)bytes[7] << 8);
        u->control_in = (bytes[0] & 0x80u) != 0;
        u->phase = U_SETUP;
        u->ep_pending |= 1; ++u->setups;
        return ORCHARD_USB_ACK;
    }
    if ((!ep && (e->in1 & (E0_STALL | E0_SENT))) || (ep && (e->out1 & 0x20u)))
        return stall(u, ep, false);
    if (!ep && (u->phase == U_STATUS_OUT || u->phase == U_DATA_IN)) {
        if (length || data1 != 1) return stall(u, ep, false);
        /* A host can end a control read at wLength before firmware sets
           DATA_END (e.g. an exact multiple of MAXP). Report SETUP_END and
           discard any speculative next packet, rather than NAKing status. */
        bool early = !(e->in1 & E0_END);
        control_done(u);
        if (early) e->in1 |= E0_SETUP_END;
        ++u->out_packets;
        return ORCHARD_USB_ACK;
    }
    if ((!ep && u->phase != U_DATA_OUT) || (ep && (e->in2 & 0x20u)))
        return ORCHARD_USB_NAK;
    if (length > maxp(e)) return stall(u, ep, false);
    /* A retry of the last ACKed OUT must not enqueue data or interrupt again. */
    if (data1 != e->rx_toggle) return ORCHARD_USB_ACK;
    if (ep ? (e->out1 & 1u) != 0 : (e->in1 & E0_OUT) != 0) return ORCHARD_USB_NAK;
    o_copy(e->rx, bytes, length); e->rx_count = (unsigned)length; e->rx_pos = 0;
    if (ep) e->out1 |= 1; else e->in1 |= E0_OUT;
    e->rx_toggle ^= 1;
    u->ep_pending |= (uint8_t)(1u << ep); ++u->out_packets;
    return ORCHARD_USB_ACK;
}
orchard_usb_result orchard_usb_in(orchard_machine *m, unsigned address,
                                 unsigned ep, bool ack, uint8_t *bytes,
                                 size_t capacity, size_t *length, unsigned *data1) {
    if (!m || !m->profile || address > 127 || ep >= 5 || !length || !data1 ||
        (!bytes && capacity)) return ORCHARD_USB_BAD_ARGUMENT;
    *length = 0; *data1 = 0;
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[ep];
    if (!available(u, address)) return ORCHARD_USB_NO_RESPONSE;
    if (!mode_supported(e, ep)) return ORCHARD_USB_UNSUPPORTED;
    if ((!ep && (e->in1 & (E0_STALL | E0_SENT))) || (ep && (e->in1 & 0x10u)))
        return stall(u, ep, true);
    bool status = !ep && u->phase == U_STATUS_IN && (e->in1 & E0_END);
    if (!status && ((!ep && (u->phase != U_DATA_IN || !(e->in1 & E0_IN))) ||
        (ep && (!(e->in2 & 0x20u) || !(e->in1 & 1u))))) return ORCHARD_USB_NAK;
    *length = status ? 0 : e->tx_count;
    *data1 = status ? 1 : e->tx_toggle;
    if (capacity < *length) return ORCHARD_USB_BUFFER_SMALL;
    o_copy(bytes, e->tx, *length);
    if (ack) {
        ++u->in_packets;
        if (status) control_done(u);
        else {
            e->in1 &= (uint8_t)~(ep ? 1u : E0_IN);
            e->tx_count = 0; e->tx_toggle ^= 1;
            u->ep_pending |= (uint8_t)(1u << ep);
            if (!ep && (e->in1 & E0_END)) u->phase = U_STATUS_OUT;
        }
    }
    return ORCHARD_USB_ACK;
}
static bool fifo(orchard_machine *m, unsigned ep, uint32_t address, uint32_t *v, bool write) {
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[ep];
    unsigned limit = ep ? 64u : 16u;
    if (!mode_supported(e, ep) || (!ep && (e->in1 & E0_SETUP_END)))
        return unsupported(m, address, write ? *v : 0);
    if (write) {
        if ((e->in1 & (ep ? 1u : E0_IN)) || e->tx_count >= maxp(e) || e->tx_count >= limit)
            return unsupported(m, address, write ? *v : 0);
        e->tx[e->tx_count++] = (uint8_t)*v;
        if (ep && (e->in2 & 0x80u) && e->tx_count == maxp(e)) e->in1 |= 1;
    } else {
        if (e->rx_pos >= e->rx_count) return unsupported(m, address, 0);
        *v = e->rx[e->rx_pos++];
        if (ep && (e->out2 & 0x80u) && e->rx_pos == e->rx_count) {
            e->out1 &= (uint8_t)~1u; e->rx_count = e->rx_pos = 0;
        }
    }
    return true;
}
static bool ep0_csr(orchard_machine *m, uint32_t value) {
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[0];
    uint8_t v = (uint8_t)value;
    e->in1 = (uint8_t)((e->in1 & ~(E0_SENT | E0_STALL)) |
                      (e->in1 & v & E0_SENT) | (v & E0_STALL));
    if (v & 128u) e->in1 &= (uint8_t)~E0_SETUP_END;
    if (v & 64u) {
        e->in1 &= (uint8_t)~E0_OUT; e->rx_count = e->rx_pos = 0;
        if (u->phase == U_SETUP)
            u->phase = !u->control_length ? U_STATUS_IN : u->control_in ? U_DATA_IN : U_DATA_OUT;
    }
    if (v & E0_IN) e->in1 |= E0_IN;
    if (v & E0_END) {
        e->in1 |= E0_END;
        if (u->phase == U_DATA_OUT) u->phase = U_STATUS_IN;
    }
    return true;
}
bool o_usb_register(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value, bool write) {
    if (address < U_BASE || address >= U_BASE + 0x10000u) return false;
    if ((width != 1 && width != 4) || (address & 3u))
        return unsupported(m, address, width);
    o_usb *u = &m->soc.usb;
    uint32_t off = address - U_BASE;
    uint8_t v = write ? (uint8_t)*value : 0;
    if (off >= 0x1c0 && off <= 0x1d0) return fifo(m, (off - 0x1c0) / 4, address, value, write);
    if (off >= 0x180 && off <= 0x19c) {
        if (u->index >= 5) return unsupported(m, address, u->index);
        o_usb_ep *e = &u->ep[u->index];
        switch (off) {
        /* Samsung's S3C2410X revision table (2003-04-28, 13-19) places
           MAXP at +18c; the S3C2410A 2004 manual places it at +180.
           Accept both documented layouts as one indexed functional register.
           This is address-layout compatibility, not a claim that a particular
           physical silicon revision decodes both addresses simultaneously. */
        case 0x180: case 0x18c:
            if (write) e->maxp = v & 15u; else *value = e->maxp;
            return true;
        case 0x184:
            if (!write) { *value = e->in1; return true; }
            if (!u->index) return ep0_csr(m, v);
            e->in1 = (uint8_t)((e->in1 & 1u) | (e->in1 & v & 0x20u) | (v & 0x10u));
            if ((v & 1u) && !(v & 0x10u)) e->in1 |= 1u;
            if (v & 0x40u) e->tx_toggle = 0;
            if (v & 8u) {
                e->in1 &= (uint8_t)~1u; e->tx_count = 0;
                u->ep_pending |= (uint8_t)(1u << u->index);
            }
            return true;
        case 0x188:
            if (write) {
                if (v & 0x40u) return unsupported(m, address, v);
                e->in2 = v & 0xb0u;
            } else *value = e->in2;
            return true;
        case 0x190:
            if (!write) { *value = e->out1; return true; }
            if (!u->index) return unsupported(m, address, v);
            e->out1 = (uint8_t)((e->out1 & v & 0x41u) | (v & 0x20u));
            if (v & 128u) e->rx_toggle = 0;
            if (!(e->out1 & 1u) || (v & 16u)) {
                e->out1 &= (uint8_t)~1u; e->rx_count = e->rx_pos = 0;
            }
            return true;
        case 0x194:
            if (write) {
                if (v & 0x40u) return unsupported(m, address, v);
                e->out2 = v & 0xa0u;
            } else *value = e->out2;
            return true;
        case 0x198: case 0x19c:
            if (write) return unsupported(m, address, v);
            *value = off == 0x198 ? e->rx_count - e->rx_pos : 0;
            return true;
        default: return false;
        }
    }
    static const uint16_t dma_base[4] = {0x200, 0x218, 0x240, 0x258};
    for (unsigned n = 0; n < 4; ++n) {
        if (off < dma_base[n] || off > dma_base[n] + 20u) continue;
        unsigned slot = (off - dma_base[n]) / 4;
        o_usb_ep *e = &u->ep[n + 1];
        if (write) {
            if (!slot && (v & 7u)) return unsupported(m, address, v);
            e->dma[slot] = slot == 5 ? v & 15u : slot ? v : v & 0x88u;
        } else *value = e->dma[slot];
        return true;
    }
    switch (off) {
    case 0x140:
        if (write) u->address = v | 128u; else *value = u->address;
        return true;
    case 0x144:
        if (write) {
            if (v & 4u) return unsupported(m, address, v); /* Remote resume timing. */
            u->power = (uint8_t)((u->power & 10u) | (v & 1u));
        } else *value = u->power;
        return true;
    case 0x148:
        if (write) u->ep_pending &= (uint8_t)~v; else *value = u->ep_pending;
        return true;
    case 0x158:
        if (write) u->bus_pending &= (uint8_t)~v; else *value = u->bus_pending;
        return true;
    case 0x15c:
        if (write) u->ep_enable = v & 0x1fu; else *value = u->ep_enable;
        return true;
    case 0x16c:
        if (write) u->bus_enable = v & 5u; else *value = u->bus_enable;
        return true;
    case 0x170: case 0x174:
        if (write) return unsupported(m, address, v);
        *value = off == 0x170 ? u->frame & 255u : u->frame >> 8;
        return true;
    case 0x178:
        if (write) u->index = v; else *value = u->index;
        return true;
    default: return false;
    }
}
