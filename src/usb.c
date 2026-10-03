/* SPDX-License-Identifier: MIT
 * Original functional S3C2410A USB-device model. Samsung manual ch.13.
 * Packet-level EP0 host adapter; no wire timing, DMA or bulk host yet.
 */
#include "internal.h"

#define BASE 0x52000000u
#define U_OUT 1u
#define U_IN 2u
#define U_STALL 4u
#define U_END 8u
#define U_SETUP_END 16u
#define U_SEND_STALL 32u

enum { IDLE, SETUP, DATA_IN, DATA_OUT, STATUS_IN, STATUS_OUT };

void o_usb_reset(o_usb *u) {
    o_zero(u, sizeof(*u));
    u->ep_enable = 0x1f; /* Defined bits: manual's 0xff reset includes reserved bits. */
    u->usb_enable = 4;
    for (unsigned i = 0; i < 5; ++i) {
        u->ep[i].maxp = 1;
        u->ep[i].in2 = 0x20;
    }
}
void o_usb_tick(orchard_machine *m) {
    const o_usb *u = &m->soc.usb;
    if ((u->ep_pending & u->ep_enable) ||
        (u->usb_pending & (u->usb_enable | 2u)))
        m->soc.srcpnd |= 1u << 25;
}
static bool stop(orchard_machine *m, uint32_t address, uint32_t detail) {
    o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, detail);
    return false;
}
static void clear_rx(o_usb_ep *e) { e->rx_size = e->rx_pos = 0; }
static void clear_tx(o_usb_ep *e) { e->tx_size = 0; }
static void control_clear(o_usb *u) {
    clear_rx(&u->ep[0]); clear_tx(&u->ep[0]);
    u->ep[0].in1 = 0;
    u->stage = IDLE; u->remaining = 0; u->stalled = false;
}
static void control_complete(o_usb *u) {
    if (u->function_address & 0x80u) {
        u->active_address = u->function_address & 127u;
        u->function_address &= 127u;
    }
    control_clear(u);
    u->ep_pending |= 1u;
}
orchard_status orchard_usb_attach(orchard_machine *m, bool attached) {
    if (!m || !m->profile) return ORCHARD_BAD_ARGUMENT;
    /* An adapter lifecycle boundary, not a physical cable/pull-up simulation.
       A changed attachment resets only the USB block, never CPU/RAM/NOR. */
    if (m->soc.usb.attached != attached) {
        o_usb_reset(&m->soc.usb);
        m->soc.usb.attached = attached;
    }
    return ORCHARD_OK;
}
orchard_usb_result orchard_usb_bus_reset(orchard_machine *m, bool asserted) {
    if (!m || !m->profile) return ORCHARD_USB_BAD_ARGUMENT;
    o_usb *u = &m->soc.usb;
    if (!u->attached) return ORCHARD_USB_NO_DEVICE;
    if (asserted && !u->reset_asserted) {
        o_usb_reset(u); u->attached = true;
        u->reset_asserted = true; u->power = 8; u->usb_pending = 4;
    } else if (!asserted) {
        u->reset_asserted = false; u->power &= ~8u;
    }
    o_usb_tick(m);
    return ORCHARD_USB_ACK;
}
orchard_usb_result orchard_usb_sof(orchard_machine *m, unsigned frame) {
    if (!m || !m->profile || frame > 0x7ffu) return ORCHARD_USB_BAD_ARGUMENT;
    o_usb *u = &m->soc.usb;
    if (!u->attached || u->reset_asserted) return ORCHARD_USB_NO_DEVICE;
    u->frame = (uint16_t)frame;
    return ORCHARD_USB_ACK;
}
static orchard_usb_result address_check(const orchard_machine *m, unsigned address) {
    if (!m || !m->profile || address > 127) return ORCHARD_USB_BAD_ARGUMENT;
    const o_usb *u = &m->soc.usb;
    return !u->attached || u->reset_asserted || u->active_address != address
        ? ORCHARD_USB_NO_DEVICE : ORCHARD_USB_ACK;
}
static orchard_usb_result stall_packet(orchard_machine *m) {
    o_usb *u = &m->soc.usb;
    if (u->stalled || (u->ep[0].in1 & U_SEND_STALL)) {
        u->stalled = true;
        u->ep[0].in1 = (u->ep[0].in1 & ~(U_SEND_STALL | U_IN)) | U_STALL;
        clear_tx(&u->ep[0]);
        u->ep_pending |= 1u;
        o_usb_tick(m);
        return ORCHARD_USB_STALL;
    }
    return ORCHARD_USB_ACK;
}
orchard_usb_result orchard_usb_setup(orchard_machine *m, unsigned address,
                                     const uint8_t *packet, size_t length) {
    if (!packet || length != 8) return ORCHARD_USB_BAD_ARGUMENT;
    orchard_usb_result r = address_check(m, address);
    if (r != ORCHARD_USB_ACK) return r;
    o_usb *u = &m->soc.usb;
    bool interrupted = u->stage != IDLE && !u->stalled;
    control_clear(u);
    /* A superseding SETUP cancels a pending address update as well. */
    u->function_address = u->active_address;
    o_copy(u->ep[0].rx, packet, 8); u->ep[0].rx_size = 8;
    u->remaining = (uint16_t)((unsigned)packet[6] | (unsigned)packet[7] << 8);
    u->direction_in = (packet[0] & 128u) != 0;
    u->stage = SETUP;
    u->ep[0].in1 = U_OUT | (interrupted ? U_SETUP_END : 0);
    u->ep_pending |= 1u;
    o_usb_tick(m);
    return ORCHARD_USB_ACK;
}
orchard_usb_result orchard_usb_out(orchard_machine *m, unsigned address,
                                   const uint8_t *packet, size_t length) {
    if ((!packet && length) || length > 16) return ORCHARD_USB_BAD_ARGUMENT;
    orchard_usb_result r = address_check(m, address);
    if (r != ORCHARD_USB_ACK) return r;
    r = stall_packet(m); if (r != ORCHARD_USB_ACK) return r;
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[0];
    if (u->stage == STATUS_OUT) {
        if (length) return ORCHARD_USB_BAD_ARGUMENT;
        bool early = !(e->in1 & U_END);
        control_complete(u);
        if (early) u->ep[0].in1 |= U_SETUP_END;
        o_usb_tick(m); return ORCHARD_USB_ACK;
    }
    if (u->stage != DATA_OUT || (e->in1 & (U_OUT | U_SETUP_END))) return ORCHARD_USB_NAK;
    if (length > e->maxp * 8u || length > u->remaining) return ORCHARD_USB_BAD_ARGUMENT;
    o_copy(e->rx, packet, length); e->rx_size = (uint8_t)length; e->rx_pos = 0;
    u->remaining -= (uint16_t)length;
    e->in1 |= U_OUT; u->ep_pending |= 1u;
    o_usb_tick(m);
    return ORCHARD_USB_ACK;
}
orchard_usb_result orchard_usb_in(orchard_machine *m, unsigned address,
                                  uint8_t *packet, size_t capacity, size_t *length) {
    if (!length || (!packet && capacity)) return ORCHARD_USB_BAD_ARGUMENT;
    *length = 0;
    orchard_usb_result r = address_check(m, address);
    if (r != ORCHARD_USB_ACK) return r;
    r = stall_packet(m); if (r != ORCHARD_USB_ACK) return r;
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[0];
    if (u->stage == STATUS_IN && (e->in1 & U_END)) {
        control_complete(u); o_usb_tick(m); return ORCHARD_USB_ACK;
    }
    if (u->stage != DATA_IN || !(e->in1 & U_IN) || (e->in1 & U_SETUP_END)) return ORCHARD_USB_NAK;
    if (capacity < e->tx_size || e->tx_size > u->remaining) return ORCHARD_USB_BAD_ARGUMENT;
    *length = e->tx_size; o_copy(packet, e->tx, *length);
    u->remaining -= e->tx_size;
    if (e->tx_size < e->maxp * 8u || !u->remaining || (e->in1 & U_END)) u->stage = STATUS_OUT;
    clear_tx(e); e->in1 &= ~U_IN;
    u->ep_pending |= 1u; o_usb_tick(m);
    return ORCHARD_USB_ACK;
}
size_t orchard_usb_snapshot(const orchard_machine *m, uint32_t *words, size_t capacity) {
    if (!m || !m->profile || !words || capacity < ORCHARD_USB_SNAPSHOT_WORDS) return 0;
    const o_usb *u = &m->soc.usb;
    words[0] = u->function_address; words[1] = u->power;
    words[2] = u->ep_pending; words[3] = u->usb_pending;
    words[4] = u->ep_enable; words[5] = u->usb_enable;
    words[6] = u->index; words[7] = u->frame;
    words[8] = u->active_address; words[9] = u->stage;
    words[10] = u->remaining; words[11] = u->attached; words[12] = u->reset_asserted;
    for (unsigned i = 0; i < 5; ++i) {
        const o_usb_ep *e = &u->ep[i]; unsigned j = 13 + i * 7;
        words[j] = e->maxp * 8u; words[j+1] = e->in1; words[j+2] = e->in2;
        words[j+3] = e->out1; words[j+4] = e->out2;
        words[j+5] = e->rx_size - e->rx_pos; words[j+6] = e->tx_size;
    }
    return ORCHARD_USB_SNAPSHOT_WORDS;
}
static bool fifo(orchard_machine *m, unsigned ep, uint32_t *value, bool write) {
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[ep];
    uint32_t addr = BASE + 0x1c0u + ep * 4u;
    if (ep == 0 && (e->in1 & U_SETUP_END)) return stop(m, addr, write ? *value : 0);
    if (write) {
        unsigned limit = ep ? 64u : 16u;
        unsigned ready = ep ? 1u : U_IN;
        if ((e->in1 & ready) || e->tx_size >= limit || e->tx_size >= e->maxp * 8u)
            return stop(m, addr, *value);
        /* Small replies may be staged after SETUP is drained, before the
           combined SERVICED_OUT/IN_PKT_RDY write advances the phase. */
        bool drained_setup = u->stage == SETUP && u->direction_in &&
                             e->rx_pos == e->rx_size;
        if (ep == 0 && u->stage != DATA_IN && u->stage != STATUS_IN &&
            u->stage != STATUS_OUT && !drained_setup)
            return stop(m, addr, *value);
        e->tx[e->tx_size++] = (uint8_t)*value;
        if (ep && (e->in2 & 128u) && e->tx_size == e->maxp * 8u) e->in1 |= 1u;
    } else {
        unsigned ready = ep ? e->out1 & 1u : e->in1 & U_OUT;
        if (!ready || e->rx_pos >= e->rx_size) return stop(m, addr, 0);
        *value = e->rx[e->rx_pos++];
        if (ep && (e->out2 & 128u) && e->rx_pos == e->rx_size) {
            e->out1 &= ~1u; clear_rx(e);
        }
    }
    return true;
}
static bool csr0(orchard_machine *m, uint8_t v) {
    o_usb *u = &m->soc.usb; o_usb_ep *e = &u->ep[0];
    if (v & 128u) e->in1 &= ~U_SETUP_END;
    if (v & 64u) {
        clear_rx(e); e->in1 &= ~U_OUT;
        if (u->stage == SETUP) u->stage = !u->remaining ? STATUS_IN : u->direction_in ? DATA_IN : DATA_OUT;
    }
    e->in1 = (e->in1 & ~U_SEND_STALL) | (v & U_SEND_STALL);
    if (!(v & U_STALL)) e->in1 &= ~U_STALL;
    if (v & U_END) {
        e->in1 |= U_END;
        if (u->stage == DATA_OUT && !(e->in1 & U_OUT)) u->stage = STATUS_IN;
    }
    if (v & U_IN) e->in1 |= U_IN;
    return true;
}
bool o_usb_register(orchard_machine *m, uint32_t address, unsigned width,
                     uint32_t *value, bool write) {
    if (address < BASE || address >= BASE + 0x10000u) return false;
    if ((width != 1 && width != 4) || (address & 3u)) return stop(m, address, write ? *value : width);
    o_usb *u = &m->soc.usb;
    uint32_t off = address - BASE;
    uint8_t v = write ? (uint8_t)*value : 0;
    if (off >= 0x1c0 && off <= 0x1d0) return fifo(m, (off - 0x1c0) / 4u, value, write);
    /* DMA configuration may be prepared, but enabling/running it is explicit. */
    const unsigned dma_base[4] = {0x200, 0x218, 0x240, 0x258};
    for (unsigned i = 0; i < 4; ++i) if (off >= dma_base[i] && off <= dma_base[i] + 20) {
        unsigned slot = (off - dma_base[i]) / 4;
        if (write) {
            if (!slot && (v & 7u)) return stop(m, address, v);
            u->dma[i][slot] = slot ? v : v & 0x88u;
        } else *value = slot ? u->dma[i][slot] : u->dma[i][slot] & 8u;
        return true;
    }
    if (off == 0x180 || off == 0x184 || off == 0x188 || off == 0x190 || off == 0x194 || off == 0x198 || off == 0x19c) {
        if (u->index >= 5) return stop(m, address, u->index);
        o_usb_ep *e = &u->ep[u->index];
        if (!write) {
            switch (off) {
            case 0x180: *value = e->maxp; break;
            case 0x184: *value = e->in1; break;
            case 0x188: *value = e->in2; break;
            case 0x190: *value = e->out1; break;
            case 0x194: *value = e->out2; break;
            case 0x198: *value = e->rx_size - e->rx_pos; break;
            default: *value = 0; break;
            }
            return true;
        }
        switch (off) {
        case 0x180:
            v &= 15u;
            if ((v != 1 && v != 2 && v != 4 && v != 8) || (!u->index && v > 2) || e->rx_size || e->tx_size)
                return stop(m, address, v);
            e->maxp = v; return true;
        case 0x184:
            if (!u->index) return csr0(m, v);
            if (v & 8u) { clear_tx(e); e->in1 &= ~1u; u->ep_pending |= 1u << u->index; }
            e->in1 = (e->in1 & 1u) | (v & 0x10u) | (e->in1 & v & 0x20u);
            if ((v & 1u) && !(v & (8u | 16u))) e->in1 |= 1u;
            return true;
        case 0x188:
            if (v & 64u) return stop(m, address, v);
            e->in2 = v & 0xb0u; return true;
        case 0x190:
            if (!u->index && v) return stop(m, address, v);
            if ((v & 16u) || !(v & 1u)) { clear_rx(e); e->out1 &= ~1u; }
            e->out1 = (e->out1 & v & 0x41u) | (v & 0x20u); return true;
        case 0x194:
            if (v & 64u) return stop(m, address, v);
            e->out2 = v & 0xa0u; return true;
        default: return stop(m, address, v); /* Read-only count. */
        }
    }
    switch (off) {
    case 0x140:
        if (write) u->function_address = v; else *value = u->function_address;
        break;
    case 0x144:
        if (write) {
            if (v & 4u) return stop(m, address, v); /* No remote-resume timing yet. */
            u->power = (u->power & 10u) | (v & 1u);
        } else *value = u->power;
        break;
    case 0x148: if (write) u->ep_pending &= ~v; else *value = u->ep_pending; break;
    case 0x158: if (write) u->usb_pending &= ~v; else *value = u->usb_pending; break;
    case 0x15c: if (write) u->ep_enable = v & 31u; else *value = u->ep_enable; break;
    case 0x16c: if (write) u->usb_enable = v & 5u; else *value = u->usb_enable; break;
    case 0x178: if (write) u->index = v; else *value = u->index; break;
    case 0x170: case 0x174:
        if (write) return stop(m, address, v);
        *value = off == 0x170 ? u->frame & 255u : u->frame >> 8; break;
    default: return stop(m, address, write ? *value : width);
    }
    return true;
}
