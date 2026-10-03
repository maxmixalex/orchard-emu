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

/* Fixed-size EP0 packet buffers, separate from UART and ROM staging. */
static uint8_t usb_packet[16];
static uint32_t usb_length;
EXPORT("usb_packet") uintptr_t web_usb_packet(void) { return (uintptr_t)usb_packet; }
EXPORT("usb_length") unsigned web_usb_length(void) { return usb_length; }
EXPORT("usb_attach") unsigned web_usb_attach(unsigned attached) {
    return attached > 1 ? ORCHARD_BAD_ARGUMENT : orchard_usb_attach(&machine, attached != 0);
}
EXPORT("usb_bus_reset") unsigned web_usb_bus_reset(unsigned asserted) {
    return asserted > 1 ? ORCHARD_USB_BAD_ARGUMENT : orchard_usb_bus_reset(&machine, asserted != 0);
}
EXPORT("usb_sof") unsigned web_usb_sof(unsigned frame) { return orchard_usb_sof(&machine, frame); }
EXPORT("usb_setup") unsigned web_usb_setup(unsigned address, unsigned length) {
    if (length != 8) return ORCHARD_USB_BAD_ARGUMENT;
    return orchard_usb_setup(&machine, address, usb_packet, length);
}
EXPORT("usb_out") unsigned web_usb_out(unsigned address, unsigned length) {
    if (length > sizeof(usb_packet)) return ORCHARD_USB_BAD_ARGUMENT;
    return orchard_usb_out(&machine, address, usb_packet, length);
}
EXPORT("usb_in") unsigned web_usb_in(unsigned address, unsigned capacity) {
    usb_length = 0;
    if (capacity > sizeof(usb_packet)) return ORCHARD_USB_BAD_ARGUMENT;
    size_t length = 0;
    orchard_usb_result r = orchard_usb_in(&machine, address, usb_packet, capacity, &length);
    usb_length = (uint32_t)length;
    return r;
}
EXPORT("usb_snapshot") uintptr_t web_usb_snapshot(void) {
    static uint32_t words[ORCHARD_USB_SNAPSHOT_WORDS];
    return orchard_usb_snapshot(&machine, words, ORCHARD_USB_SNAPSHOT_WORDS) ? (uintptr_t)words : 0;
}
