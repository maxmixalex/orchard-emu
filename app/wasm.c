/* SPDX-License-Identifier: MIT */
#include "internal.h"

#define EXPORT(name) __attribute__((export_name(name)))
static orchard_machine machine;
static uint8_t rom_input[O_FLASH_MAX];
static uint8_t pixels[131 * 80];
static uint8_t uart_input[O_QUEUE], uart_output[O_QUEUE];
static uint32_t snapshot[33];

EXPORT("create") unsigned web_create(unsigned model) {
    return orchard_init(&machine, sizeof(machine), model) ? ORCHARD_OK : ORCHARD_BAD_ARGUMENT;
}
EXPORT("profile") uint32_t web_profile(unsigned id, unsigned field) {
    const orchard_profile *p = orchard_get_profile(id);
    if (!p) return 0;
    switch (field) {
    case 0: return p->flash_bytes;
    case 1: return p->ram_bytes;
    case 2: return p->lcd_width;
    case 3: return p->lcd_height;
    case 4: return p->sd_slot;
    default: return 0;
    }
}
EXPORT("rom_buffer") uintptr_t web_rom_buffer(void) { return (uintptr_t)rom_input; }
EXPORT("load") unsigned web_load(unsigned length) {
    if (!machine.profile || length > sizeof(rom_input)) return ORCHARD_BAD_ARGUMENT;
    return orchard_load_rom(&machine, rom_input, length);
}
EXPORT("run") unsigned web_run(unsigned budget) {
    return orchard_run(&machine, budget).status;
}
EXPORT("reset") void web_reset(void) { if (machine.profile) orchard_reset(&machine); }
EXPORT("snapshot") uintptr_t web_snapshot(void) {
    if (!machine.profile) return 0;
    orchard_state s;
    orchard_get_state(&machine, &s);
    for (unsigned i = 0; i < 16; ++i) snapshot[i] = s.registers[i];
    snapshot[16] = s.cpsr; snapshot[17] = s.cp15_control;
    snapshot[18] = s.fault_status; snapshot[19] = s.fault_address;
    snapshot[20] = (uint32_t)s.instructions; snapshot[21] = (uint32_t)(s.instructions >> 32);
    snapshot[22] = (uint32_t)s.ticks; snapshot[23] = (uint32_t)(s.ticks >> 32);
    snapshot[24] = (uint32_t)s.exceptions; snapshot[25] = (uint32_t)(s.exceptions >> 32);
    snapshot[26] = s.sleeping; snapshot[27] = s.rom_loaded;
    snapshot[28] = s.stop.status; snapshot[29] = s.stop.pc;
    snapshot[30] = s.stop.instruction; snapshot[31] = s.stop.address; snapshot[32] = s.stop.detail;
    return (uintptr_t)snapshot;
}
EXPORT("frame") unsigned web_frame(void) {
    return machine.profile ? orchard_framebuffer(&machine, pixels, sizeof(pixels)) : ORCHARD_BAD_ARGUMENT;
}
EXPORT("frame_buffer") uintptr_t web_frame_buffer(void) { return (uintptr_t)pixels; }
EXPORT("uart_input") uintptr_t web_uart_input(void) { return (uintptr_t)uart_input; }
EXPORT("uart_send") unsigned web_uart_send(unsigned length) {
    if (length > sizeof(uart_input)) return 0;
    return (unsigned)orchard_uart_send(&machine, uart_input, length);
}
EXPORT("uart_output") uintptr_t web_uart_output(void) { return (uintptr_t)uart_output; }
EXPORT("uart_receive") unsigned web_uart_receive(void) {
    return (unsigned)orchard_uart_receive(&machine, uart_output, sizeof(uart_output));
}

EXPORT("gpio_inputs") unsigned web_gpio_inputs(unsigned port, uint32_t known_mask, uint32_t levels) {
    return orchard_gpio_inputs(&machine, (orchard_gpio_port)port, known_mask, levels);
}

EXPORT("keyboard_attach") unsigned web_keyboard_attach(unsigned attached) {
    if (attached > 1) return ORCHARD_BAD_ARGUMENT;
    return orchard_keyboard_attach(&machine, attached != 0);
}
EXPORT("keyboard_matrix") unsigned web_keyboard_matrix(unsigned col, unsigned row, unsigned down) {
    if (down > 1) return ORCHARD_BAD_ARGUMENT;
    return orchard_keyboard_matrix(&machine, col, row, down != 0);
}
EXPORT("keyboard_dedicated") unsigned web_keyboard_dedicated(unsigned pin, unsigned down) {
    if (down > 1) return ORCHARD_BAD_ARGUMENT;
    return orchard_keyboard_dedicated(&machine, pin, down != 0);
}
EXPORT("sram_select") unsigned web_sram_select(unsigned decode) {
    return orchard_sram_select(&machine, (orchard_sram_decode)decode);
}
EXPORT("sram_alias_reads") uint64_t web_sram_alias_reads(void) {
    return orchard_sram_alias_reads(&machine);
}
EXPORT("sram_alias_writes") uint64_t web_sram_alias_writes(void) {
    return orchard_sram_alias_writes(&machine);
}
EXPORT("nor_select") unsigned web_nor_select(unsigned device) {
    return orchard_nor_select(&machine, (orchard_nor_device)device);
}

EXPORT("gpio_bias") unsigned web_gpio_bias(unsigned port, uint32_t mask, uint32_t levels) {
    return orchard_gpio_bias(&machine, (orchard_gpio_port)port, mask, levels);
}
EXPORT("lcd_probe68") unsigned web_lcd_probe68(unsigned enabled) {
    if (enabled > 1) return ORCHARD_BAD_ARGUMENT;
    return orchard_lcd_probe68(&machine, enabled != 0);
}
EXPORT("lcd_probe68_reads") uint64_t web_lcd_probe68_reads(void) {
    return orchard_lcd_probe68_reads(&machine);
}
EXPORT("frame_view") unsigned web_frame_view(unsigned view) {
    return orchard_framebuffer_view(&machine, (orchard_frame_view)view, pixels, sizeof(pixels));
}

EXPORT("adc_input") unsigned web_adc_input(unsigned channel, unsigned known, unsigned code) {
    if (known > 1) return ORCHARD_BAD_ARGUMENT;
    return orchard_adc_input(&machine, channel, known != 0, code);
}

EXPORT("peripheral_snapshot") uintptr_t web_peripheral_snapshot(void) {
    static uint32_t words[10];
    if (!machine.profile) return 0;
    orchard_peripheral_state s;
    orchard_get_peripheral_state(&machine, &s);
    words[0] = s.lcd_control; words[1] = s.lcd_source_pending;
    words[2] = s.lcd_interrupt_pending; words[3] = s.lcd_interrupt_mask;
    words[4] = (uint32_t)s.lcd_frames; words[5] = (uint32_t)(s.lcd_frames >> 32);
    words[6] = s.adc_control; words[7] = s.adc_data;
    words[8] = s.adc_remaining; words[9] = s.adc_valid;
    return (uintptr_t)words;
}

static uint8_t usb_bytes[64];
static size_t usb_length;
static unsigned usb_data1;
EXPORT("usb_buffer") uintptr_t web_usb_buffer(void) { return (uintptr_t)usb_bytes; }
EXPORT("usb_connect") unsigned web_usb_connect(unsigned connected) {
    return connected > 1 ? ORCHARD_BAD_ARGUMENT : orchard_usb_connect(&machine, connected != 0);
}
EXPORT("usb_reset_signal") unsigned web_usb_reset_signal(unsigned asserted) {
    return asserted > 1 ? ORCHARD_BAD_ARGUMENT : orchard_usb_reset_signal(&machine, asserted != 0);
}
EXPORT("usb_sof") unsigned web_usb_sof(unsigned frame) { return orchard_usb_sof(&machine, frame); }
EXPORT("usb_out") unsigned web_usb_out(unsigned address, unsigned ep, unsigned setup,
                                        unsigned data1, unsigned length) {
    if (length > sizeof(usb_bytes) || setup > 1) return ORCHARD_USB_BAD_ARGUMENT;
    return orchard_usb_out(&machine, address, ep, setup != 0, data1, usb_bytes, length);
}
EXPORT("usb_in") unsigned web_usb_in(unsigned address, unsigned ep, unsigned ack) {
    usb_length = 0; usb_data1 = 0;
    if (ack > 1) return ORCHARD_USB_BAD_ARGUMENT;
    return orchard_usb_in(&machine, address, ep, ack != 0, usb_bytes, sizeof(usb_bytes), &usb_length, &usb_data1);
}
EXPORT("usb_length") unsigned web_usb_length(void) { return (unsigned)usb_length; }
EXPORT("usb_data1") unsigned web_usb_data1(void) { return usb_data1; }
EXPORT("usb_snapshot") uintptr_t web_usb_snapshot(void) {
    static uint32_t words[44];
    if (!machine.profile) return 0;
    orchard_usb_state u; orchard_get_usb_state(&machine, &u);
    words[0] = u.address; words[1] = u.active_address; words[2] = u.power;
    words[3] = u.index; words[4] = u.ep_pending; words[5] = u.bus_pending;
    words[6] = u.ep_enable; words[7] = u.bus_enable; words[8] = u.frame;
    words[9] = u.phase; words[10] = u.connected;
    for (unsigned e = 0; e < 5; ++e) {
        words[11 + 5*e] = u.max_packet[e]; words[12 + 5*e] = u.in_csr[e];
        words[13 + 5*e] = u.out_csr[e]; words[14 + 5*e] = u.tx_bytes[e];
        words[15 + 5*e] = u.rx_bytes[e];
    }
    words[36] = (uint32_t)u.resets; words[37] = (uint32_t)(u.resets >> 32);
    words[38] = (uint32_t)u.setups; words[39] = (uint32_t)(u.setups >> 32);
    words[40] = (uint32_t)u.in_packets; words[41] = (uint32_t)(u.in_packets >> 32);
    words[42] = (uint32_t)u.out_packets; words[43] = (uint32_t)(u.out_packets >> 32);
    return (uintptr_t)words;
}

static uint8_t annunciator_levels[6];
EXPORT("annunciators") unsigned web_annunciators(void) {
    return orchard_annunciators(&machine, annunciator_levels);
}
EXPORT("annunciator_buffer") uintptr_t web_annunciator_buffer(void) {
    return (uintptr_t)annunciator_levels;
}

/* Bounded interchange buffer, distinct from ROM and emulated machine storage. */
static uint8_t checkpoint_bytes[600000];
EXPORT("checkpoint_buffer") uintptr_t web_checkpoint_buffer(void) { return (uintptr_t)checkpoint_bytes; }
EXPORT("checkpoint_size") unsigned web_checkpoint_size(void) {
    return (unsigned)orchard_checkpoint_size(&machine);
}
EXPORT("checkpoint_save") unsigned web_checkpoint_save(void) {
    size_t n=orchard_checkpoint_size(&machine);
    if(!n||n>sizeof(checkpoint_bytes))return ORCHARD_BAD_ARGUMENT;
    return orchard_checkpoint_save(&machine,checkpoint_bytes,n);
}
EXPORT("checkpoint_load") unsigned web_checkpoint_load(unsigned length) {
    if(length>sizeof(checkpoint_bytes))return ORCHARD_BAD_ARGUMENT;
    return orchard_checkpoint_load(&machine,checkpoint_bytes,length);
}
