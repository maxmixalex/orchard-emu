/* SPDX-License-Identifier: MIT
 * Original ROM-free control-endpoint guest. Responses are ordinary guest data.
 * A small IRQ handler streams descriptors and commits address/configuration.
 */
.syntax unified
.cpu arm920t
.arm
.section .text
.global _start
_start:
 b start
 b .
 b .
 b .
 b .
 b .
 b irq
 b .
.org 0x100
start:
 msr cpsr_c,#0xd2
 ldr sp,=0x08001000
 msr cpsr_c,#0xd3
 ldr sp,=0x08002000
 ldr r0,=0x53000000
 mov r1,#0
 str r1,[r0]
 ldr r0,=0x5200015c
 mov r1,#1
 str r1,[r0]
 ldr r0,=0x4a000000
 ldr r1,=0xfdffffff
 str r1,[r0,#8]
 mvn r1,#0
 str r1,[r0]
 str r1,[r0,#16]
 mov r6,#0
 mov r7,#0
 mov r10,#0
 msr cpsr_c,#0x53
wait:
 mcr p15,0,r0,c7,c0,4
 b wait
irq:
 stmdb sp!,{r0-r5,lr}
 ldr r0,=0x52000140
 ldr r1,[r0,#0x18]
 tst r1,#4
 beq endpoint
 mov r1,#4
 str r1,[r0,#0x18]
 mov r1,#0
 str r1,[r0,#0x38]
 mov r1,#1
 str r1,[r0,#0x40]
 str r1,[r0,#0x1c]
 mov r6,#0
 mov r7,#0
 mov r10,#0
 b ack
endpoint:
#ifdef ORCHARD_BRIDGE_TEST
 ldr r1,[r0,#8]
 tst r1,#1
 beq bulk_echo
#endif
 mov r1,#0
 str r1,[r0,#0x38]
 ldr r4,[r0,#0x44]
 tst r4,#16
 movne r1,#128
 strne r1,[r0,#0x44]
 tst r4,#1
 beq next_packet
 /* Drain eight SETUP bytes, one byte per MMIO word read. */
 ldr r1,[r0,#0x80]
 ldr r3,[r0,#0x80]
 ldr r5,[r0,#0x80]
 ldr r2,[r0,#0x80]
 ldr r1,[r0,#0x80]
 ldr r1,[r0,#0x80]
 ldr r7,[r0,#0x80]
 ldr r1,[r0,#0x80]
 orr r7,r7,r1,lsl #8
 cmp r3,#5
 beq address
 cmp r3,#9
 beq configure
 cmp r3,#8
 beq get_configuration
#ifdef ORCHARD_BRIDGE_TEST
 cmp r3,#0x5a
 beq watchdog_test_reset
#endif
 cmp r3,#6
 bne stall
 cmp r2,#1
 ldreq r6,=device_descriptor
 moveq r2,#18
 beq response
 cmp r2,#2
 bne stall
 ldr r6,=configuration_descriptor
 mov r2,#32
 b response
get_configuration:
 ldr r6,=0x08003000
 strb r10,[r6]
 mov r2,#1
response:
 cmp r7,r2
 movhi r7,r2
 mov r1,#64
 str r1,[r0,#0x44]
 b send
address:
 orr r5,r5,#128
 str r5,[r0]
 b no_data
configure:
 mov r10,r5
#ifdef ORCHARD_BRIDGE_TEST
 /* This test-only build configures real bulk FIFOs and interrupts. */
 mov r1,#1
 str r1,[r0,#0x38]
 mov r1,#8
 str r1,[r0,#0x40]
 mov r1,#32
 str r1,[r0,#0x48]
 mov r1,#64
 str r1,[r0,#0x44]
 mov r1,#3
 str r1,[r0,#0x38]
 mov r1,#8
 str r1,[r0,#0x40]
 mov r1,#0
 str r1,[r0,#0x48]
 mov r1,#128
 str r1,[r0,#0x50]
 mov r1,#11
 str r1,[r0,#0x1c]
 mov r1,#0
 str r1,[r0,#0x38]
#endif
no_data:
 mov r7,#0
 mov r6,#0
 mov r1,#0x48
 str r1,[r0,#0x44]
 b ack
stall:
 mov r7,#0
 mov r1,#0x60
 str r1,[r0,#0x44]
 b ack
next_packet:
 cmp r7,#0
 beq ack
 tst r4,#2
 bne ack
send:
 mov r2,#0
bytes:
 cmp r7,#0
 beq arm_packet
 ldrb r1,[r6],#1
 str r1,[r0,#0x80]
 sub r7,r7,#1
 add r2,r2,#1
 cmp r2,#8
 blo bytes
arm_packet:
 mov r1,#2
 cmp r7,#0
 orreq r1,r1,#8
 str r1,[r0,#0x44]
ack:
 mov r1,#1
 str r1,[r0,#8]
ack_irq:
 ldr r0,=0x4a000000
 mov r1,#0x02000000
 str r1,[r0]
 str r1,[r0,#16]
 ldmia sp!,{r0-r5,lr}
 subs pc,lr,#4
#ifdef ORCHARD_BRIDGE_TEST
/* EP3 OUT -> EP1 IN, preserving binary data and zero-length packets. */
bulk_echo:
 mov r1,#1
 str r1,[r0,#0x38]
 ldr r1,[r0,#0x44]
 tst r1,#1
 bne bulk_ack
 mov r1,#3
 str r1,[r0,#0x38]
 ldr r1,[r0,#0x50]
 tst r1,#1
 beq bulk_ack
 ldr r2,[r0,#0x58]
bulk_copy:
 cmp r2,#0
 beq bulk_ready
 ldr r1,[r0,#0x8c]
 str r1,[r0,#0x84]
 subs r2,r2,#1
 bne bulk_copy
bulk_ready:
 mov r1,#0
 str r1,[r0,#0x50]
 mov r1,#1
 str r1,[r0,#0x38]
 str r1,[r0,#0x44]
bulk_ack:
 mov r1,#10
 str r1,[r0,#8]
 b ack_irq
/* A vendor request makes the guest itself trigger the real WDT reset. */
watchdog_test_reset:
 ldr r0,=0x53000000
 mov r1,#1
 str r1,[r0,#4]
 str r1,[r0,#8]
 mov r1,#0x21
 str r1,[r0]
 b .
#endif
.ltorg
.balign 4
device_descriptor:
.byte 18,1,16,1,255,0,0,8,0x34,0x12,0x78,0x56,0,1,0,0,0,1
configuration_descriptor:
.byte 9,2,32,0,1,1,0,128,25,9,4,0,0,2,255,0,0,0,7,5,129,2,64,0,0,7,5,3,2,64,0,0
