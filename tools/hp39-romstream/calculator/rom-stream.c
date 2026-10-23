/* SPDX-License-Identifier: MIT
 * HP39gs/39g+ complete physical NOR reader, revision 2.
 * Derived from hpclang e240c58c ROM streamer, Copyright (c) 2026 Max Alex.
 * Orchard changes: framebuffer-safe mappings, visible progress/errors,
 * cancellation and bounded USB waits, asynchronous control endpoint.
 * No flash write, erase or program operation exists in this program.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#define REG32(a) (*(volatile u32 *)(a))

#define FLASH_BASE          0x01100000u
#define FLASH_BYTES         0x00100000u
#define BLOCK_BYTES         0x00004000u

/* One private coarse table; do not use framebuffer words as L1 entries. */
#define USBD_BASE           0x01200000u
#define CLK_BASE            0x01201000u
#define GPIO_BASE           0x01202000u
#define INT_BASE            0x01203000u
#define LCD_BASE            0x01204000u
#define RTC_BASE            0x01205000u
#define STOCK_LCD_BASE      0x07300000u
#define STOCK_GPIO_BASE     0x07a00000u
#define BCDSEC              REG32(RTC_BASE + 0x70)

#define FUNC_ADDR_REG       REG32(USBD_BASE + 0x140)
#define PWR_REG             REG32(USBD_BASE + 0x144)
#define EP_INT_REG          REG32(USBD_BASE + 0x148)
#define USB_INT_REG         REG32(USBD_BASE + 0x158)
#define EP_INT_EN_REG       REG32(USBD_BASE + 0x15c)
#define USB_INT_EN_REG      REG32(USBD_BASE + 0x16c)
#define INDEX_REG           REG32(USBD_BASE + 0x178)
#define MAXP_REG            REG32(USBD_BASE + 0x180)
#define EP0_CSR             REG32(USBD_BASE + 0x184)
#define IN_CSR1_REG         REG32(USBD_BASE + 0x184)
#define IN_CSR2_REG         REG32(USBD_BASE + 0x188)
#define MAXP_REG2           REG32(USBD_BASE + 0x18c)
#define OUT_CSR1_REG        REG32(USBD_BASE + 0x190)
#define OUT_CSR2_REG        REG32(USBD_BASE + 0x194)
#define OUT_FIFO_CNT1_REG   REG32(USBD_BASE + 0x198)
#define OUT_FIFO_CNT2_REG   REG32(USBD_BASE + 0x19c)
#define EP0_FIFO            REG32(USBD_BASE + 0x1c0)
#define EP1_FIFO            REG32(USBD_BASE + 0x1c4)
#define EP2_FIFO            REG32(USBD_BASE + 0x1c8)

#define LOCKTIME            REG32(CLK_BASE + 0x00)
#define MPLLCON             REG32(CLK_BASE + 0x04)
#define UPLLCON             REG32(CLK_BASE + 0x08)
#define CLKCON              REG32(CLK_BASE + 0x0c)
#define CLKSLOW             REG32(CLK_BASE + 0x10)
#define CLKDIVN             REG32(CLK_BASE + 0x14)
#define GPFCON              REG32(GPIO_BASE + 0x50)
#define GPFDAT              REG32(GPIO_BASE + 0x54)
#define MISCCR              REG32(GPIO_BASE + 0x80)
#define EXTINT0             REG32(GPIO_BASE + 0x88)
#define SRCPND              REG32(INT_BASE + 0x00)
#define INTMSK              REG32(INT_BASE + 0x08)
#define INTPND              REG32(INT_BASE + 0x10)
#define LCDCON1             REG32(LCD_BASE + 0x00)

#define EP0_OUT_PKT_RDY             0x01u
#define EP0_IN_PKT_RDY              0x02u
#define EP0_SENT_STALL              0x04u
#define EP0_DATA_END                0x08u
#define EP0_SETUP_END               0x10u
#define EP0_SEND_STALL              0x20u
#define EP0_SERVICED_OUT_PKT_RDY    0x40u
#define EP0_SERVICED_SETUP_END      0x80u
#define EPN_IN_PKT_RDY              0x01u
#define EPN_IN_FIFO_FLUSH           0x08u
#define EPN_IN_CLR_DATA_TOGGLE      0x40u
#define EPN_OUT_PKT_RDY             0x01u
#define EPN_OUT_FIFO_FLUSH          0x10u
#define EPN_OUT_CLR_DATA_TOGGLE     0x80u

#define USB_RESET_BIT       0x04u
#define IRQ_EINT1           (1u << 1)
#define IRQ_USBD            (1u << 25)

#define GET_STATUS          0u
#define CLEAR_FEATURE       1u
#define SET_FEATURE         3u
#define SET_ADDRESS         5u
#define GET_DESCRIPTOR      6u
#define GET_CONFIGURATION   8u
#define SET_CONFIGURATION   9u
#define GET_INTERFACE       10u
#define SET_INTERFACE       11u
#define HID_GET_REPORT      1u
#define HID_SET_REPORT      9u
#define HID_SET_IDLE        10u
#define HID_SET_PROTOCOL    11u

#define VID_HP              0x03f0u
#define PID_HP39            0x0121u
#define PROTO_VERSION       2u
#define READER_REVISION     2u
#define REPORT_BYTES        64u
#define DATA_BYTES          56u
#define FNV_OFFSET          2166136261u
#define FNV_PRIME           16777619u

struct hw_snapshot {
    u32 locktime;
    u32 mpllcon;
    u32 upllcon;
    u32 clkcon;
    u32 clkslow;
    u32 clkdivn;
    u32 misccr;
    u32 intmsk;
    u32 gpfcon;
    u32 extint0;
    u32 lcd[17];
    volatile u8 *screen;
    u8 pixels[1280];
};

extern void hp39_rom_stream_clean(volatile void *, u32);

struct usb_state {
    int configured, started;
    u8 control[64];
    u32 sent, count, zero_packet, pending;
};

struct deadline { u32 seconds, last, spins; };

static u32 rtc_second(void)
{
    u32 b = BCDSEC & 0x7fu;
    return (b >> 4) * 10u + (b & 15u);
}

static void deadline_start(struct deadline *d, u32 seconds)
{
    d->seconds = seconds; d->last = rtc_second(); d->spins = 0xffffffffu;
}

static int deadline_expired(struct deadline *d)
{
    u32 now = rtc_second();
    if(now != d->last) {
        u32 elapsed = now >= d->last ? now - d->last : 60u + now - d->last;
        d->last = now;
        if(elapsed >= d->seconds) return 1;
        d->seconds -= elapsed;
    }
    /* Also terminate if the battery-backed clock is stopped or invalid. */
    return !--d->spins;
}

/* Original, deliberately small 3x5 uppercase glyphs. Each row is three bits. */
static u32 glyph(u8 c)
{
    static const u16 letters[] = {0x2bed,0x6bae,0x3923,0x6b6e,0x79a7,0x79a4,0x396b,0x5bed,0x7497,0x126a,0x5bad,0x4927,0x5fed,0x5ffd,0x2b6a,0x6ba4,0x2b7b,0x6bad,0x388e,0x7492,0x5b6f,0x5b6a,0x5bfd,0x5aad,0x5a92,0x72a7};
    static const u16 numbers[] = {0x7b6f,0x2c97,0x62a7,0x628e,0x5bc9,0x798e,0x39ef,0x7292,0x7bef,0x7bce};
    if(c >= 'A' && c <= 'Z') return letters[c-'A'];
    if(c >= '0' && c <= '9') return numbers[c-'0'];
    if(c == '/') return 0x12a4;
    if(c == '-') return 0x01c0;
    if(c == ':') return 0x0410;
    return 0;
}

static volatile u8 *screen_at(u32 lcd)
{
    /* Stock 39 framebuffer: 160-bit stride, 131 visible columns, 64 rows.
     * Reject an unfamiliar layout instead of corrupting the MMU table/RAM. */
    u32 physical = (REG32(lcd + 0x14) & 0x3fffffffu) << 1;
    u32 stride = REG32(lcd + 0x1c);
    if((((stride >> 11) & 0x7ffu) + (stride & 0x7ffu)) != 10u)
        return (volatile u8 *)0;
    if(physical >= 0x40000200u && physical <= 0x40001000u - 1280u)
        return (volatile u8 *)(0x07f00000u + physical - 0x40000000u);
    if(physical >= 0x08000000u && physical <= 0x08040000u - 1280u)
        return (volatile u8 *)physical;
    return (volatile u8 *)0;
}

static void text(volatile u8 *screen, u32 y, const char *s)
{
    u32 x = 2;
    if(!screen) return;
    while(*s && x + 6u < 131u) {
        u32 bits = glyph((u8)*s++);
        for(u32 row = 0; row < 5; ++row)
            for(u32 col = 0; col < 3; ++col)
                if(bits & (1u << (14u - row * 3u - col)))
                    for(u32 dy = 0; dy < 2; ++dy)
                        for(u32 dx = 0; dx < 2; ++dx) {
                            u32 px = x + col * 2u + dx;
                            screen[(y + row * 2u + dy) * 20u + (px >> 3)] |= (u8)(1u << (px & 7u));
                        }
        x += 8;
    }
}

static void display(volatile u8 *screen, const char *phase, u32 block, u32 pass)
{
    char progress[] = "BLOCK 00/64 P0";
    if(!screen) return;
    if(block>64u) block=64u; /* FINISH wait is still the last completed block. */
    for(u32 i = 0; i < 1280; ++i) screen[i] = 0;
    text(screen, 0, "H39 ROM V2");
    text(screen, 14, phase);
    if(block) {
        u32 tens = 0;
        while(block >= 10u) { block -= 10u; ++tens; }
        progress[6] += (char)tens; progress[7] += (char)block;
        progress[13] += (char)pass;
        text(screen, 29, progress);
    }
    text(screen, 51, "ON CANCEL");
    hp39_rom_stream_clean(screen, 1280);
}

/* Called only for entry rejection, before any temporary mapping exists. */
void hp39_rom_stream_entry_error(u32 code)
{
    volatile u8 *screen = screen_at(STOCK_LCD_BASE);
    display(screen, code == 1u ? "E01 MEMORY" : "E02 MMU BUSY", 0, 0);
    REG32(STOCK_LCD_BASE) |= 1u;
    /* Acknowledge the visible error explicitly, without resetting the machine. */
    while(!(REG32(STOCK_GPIO_BASE + 0x54) & 1u)) { }
    while(REG32(STOCK_GPIO_BASE + 0x54) & 1u) { }
}

static void put16(u8 *p, u16 v)
{
    p[0] = (u8)v;
    p[1] = (u8)(v >> 8);
}

static void put32(u8 *p, u32 v)
{
    p[0] = (u8)v;
    p[1] = (u8)(v >> 8);
    p[2] = (u8)(v >> 16);
    p[3] = (u8)(v >> 24);
}

static u32 get32(const u8 *p)
{
    return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24);
}

static void zero64(u8 *p)
{
    u32 i;
    for(i = 0; i < REPORT_BYTES; ++i)
        p[i] = 0;
}

static int cable_connected(void)
{
    return (GPFDAT & 2u) != 0;
}

static int prepare_cable_detect(void)
{
    /*
     * Match newRPL target_39gs: GPF1/EINT1 with a falling-edge disconnect
     * latch.  The main interrupt controller remains masked while the streamer
     * owns the hardware, so SRCPND is safe to poll directly.
     */
    GPFCON = (GPFCON & ~0x0cu) | 0x08u;
    EXTINT0 = (EXTINT0 & ~0x70u) | 0x20u;
    SRCPND = IRQ_EINT1;
    INTPND = IRQ_EINT1;
    return cable_connected();
}

static int disconnect_seen(void)
{
    return !cable_connected() || (SRCPND & IRQ_EINT1);
}

static void take_snapshot(struct hw_snapshot *s)
{
    u32 i;

    s->locktime = LOCKTIME;
    s->mpllcon = MPLLCON;
    s->upllcon = UPLLCON;
    s->clkcon = CLKCON;
    s->clkslow = CLKSLOW;
    s->clkdivn = CLKDIVN;
    s->misccr = MISCCR;
    s->intmsk = INTMSK;
    s->gpfcon = GPFCON;
    s->extint0 = EXTINT0;
    s->screen = screen_at(LCD_BASE);
    if(s->screen)
        for(i = 0; i < 1280; ++i) s->pixels[i] = s->screen[i];

    /*
     * HPGCC sys_lcdsave() saves LCD registers 0..10 and 19..24.  Preserve
     * the exact same set so the raw PrRUN payload can perform the same restore
     * that a normal HPGCC crt0 program would get.
     */
    for(i = 0; i < 11; ++i)
        s->lcd[i] = REG32(LCD_BASE + i * 4u);
    for(i = 0; i < 6; ++i)
        s->lcd[11 + i] = REG32(LCD_BASE + 0x4cu + i * 4u);

    /* Raw PrRUN has no HPGCC crt0 around us; own the interrupt mask here. */
    INTMSK = 0xffffffffu;
}

static void usb_hwshutdown(void)
{
    /*
     * Follow newRPL usb_shutdown(): quiesce the UDC first, then remove its
     * clocks.  No attempt is made to replay volatile endpoint status bits.
     */
    USB_INT_EN_REG = 0;
    EP_INT_EN_REG = 0;
    USB_INT_REG = 0x07u;
    EP_INT_REG = 0x1fu;
    /* The main interrupt latch survives clearing the peripheral latch.
     * Remove only events generated by our temporary USB ownership. */
    SRCPND = IRQ_USBD;
    INTPND = IRQ_USBD;
    CLKSLOW |= 0x80u;   /* UPLL off */
    CLKCON &= ~0xc0u;   /* USB host + device clocks off */
}

static void restore_platform(const struct hw_snapshot *s)
{
    u32 i;
    u32 lcd0;

    /*
     * Do not leak our disconnect edge into the stock firmware.  Then restore
     * GPIO/pad state that HPGCC crt0 does not know about.
     */
    SRCPND = IRQ_EINT1;
    INTPND = IRQ_EINT1;
    EXTINT0 = s->extint0;
    GPFCON = s->gpfcon;
    MISCCR = s->misccr;

    LCDCON1 &= ~1u;
    /*
     * Exact HPGCC 1.1 sys_clkrestore() ordering.  This is deliberately not a
     * field-by-field reverse of our setup: the historical runtime first puts
     * CLKSLOW in its safe intermediate state, restores clock registers 0..3,
     * then CLKDIVN, then the original CLKSLOW value.
     */
    CLKSLOW &= 0xffffffe0u;
    LOCKTIME = s->locktime;
    MPLLCON = s->mpllcon;
    UPLLCON = s->upllcon;
    CLKCON = s->clkcon;
    CLKDIVN = s->clkdivn;
    CLKSLOW = s->clkslow;

    /*
     * Exact shape of HPGCC 1.1 sys_lcdrestore(): strip live LINECNT/status
     * bits from LCDCON1, restore registers 0..10 and 19..24, then enable LCD.
     */
    lcd0 = s->lcd[0] & 0x0003fffeu;
    REG32(LCD_BASE + 0x00) = lcd0;
    for(i = 1; i < 11; ++i)
        REG32(LCD_BASE + i * 4u) = s->lcd[i];
    for(i = 0; i < 6; ++i)
        REG32(LCD_BASE + 0x4cu + i * 4u) = s->lcd[11 + i];
    REG32(LCD_BASE + 0x00) |= s->lcd[0] & 1u;

    if(s->screen) {
        for(i = 0; i < 1280; ++i) s->screen[i] = s->pixels[i];
        hp39_rom_stream_clean(s->screen, 1280);
    }
    /* Same final boundary as HPGCC sys_intOn(). */
    INTMSK = s->intmsk;
}

static u32 normal_fclk_scaled(void)
{
    /*
     * Return FCLK in units of 1 MHz times the PLL denominator:
     *   numerator = (m + 8) * 12
     *   denominator = (p + 2) * 2^s
     *
     * Keeping numerator/denominator separate avoids pulling __aeabi_uidiv into
     * this freestanding payload.
     */
    u32 pll = MPLLCON;
    u32 m = ((pll >> 12) & 0xffu) + 8u;
    return m * 12u;
}

static u32 normal_fclk_denominator(void)
{
    u32 pll = MPLLCON;
    u32 p = ((pll >> 4) & 0x1fu) + 2u;
    u32 s = pll & 3u;
    return p << s;
}

static int pclk_at_least_20mhz(void)
{
    u32 numerator;
    u32 denominator;
    u32 pclk_div = 1u;

    if(CLKSLOW & 0x30u)
        return 0;

    numerator = normal_fclk_scaled();
    denominator = normal_fclk_denominator();
    if(CLKDIVN & 2u)
        pclk_div <<= 1;
    if(CLKDIVN & 1u)
        pclk_div <<= 1;

    return numerator >= 20u * denominator * pclk_div;
}

static int prepare_usb_clock(void)
{
    u32 numerator;
    u32 denominator;
    u32 divider;

    /*
     * HPGCC39's CRT deliberately enters slow mode before main; its own source
     * notes a typical 3 MHz PCLK there.  The newRPL S3C2410 USB driver requires
     * PCLK > 20 MHz.  Use the same divider thresholds as newRPL cpu_setspeed(),
     * but keep the stock MPLL value rather than programming a new CPU PLL.
     *
     * Keep the LCD controller off while HCLK/PCLK changes.  We restore the
     * exact saved LCDCON1 only after the original clock state is back.
     */
    LCDCON1 &= ~1u;

    numerator = normal_fclk_scaled();
    denominator = normal_fclk_denominator();

    if(numerator <= 24u * denominator)
        divider = 0u;
    else if(numerator <= 48u * denominator)
        divider = 1u;
    else if(numerator <= 75u * denominator)
        divider = 2u;
    else
        divider = 3u;

    CLKDIVN = (CLKDIVN & ~3u) | divider;
    CLKSLOW &= ~0x30u; /* leave slow mode and enable MPLL */

    /*
     * If an unexpected stock MPLL/divider combination still leaves PCLK below
     * 20 MHz, try the least-divided safe setting.  If even FCLK itself is too
     * low, abort and restore instead of attempting USB at an invalid clock.
     */
    if(!pclk_at_least_20mhz()) {
        CLKDIVN &= ~3u;
        if(!pclk_at_least_20mhz())
            return 0;
    }
    /* Retain the stock geometry, retime the panel for the changed HCLK.
     * CLKVAL = ceil(HCLK / 1 MHz), corresponding to the SDK 500 kHz target. */
    denominator *= (CLKDIVN & 2u) ? 2u : 1u;
    u32 clkval = 0;
    while(numerator) { ++clkval; numerator = numerator > denominator ? numerator - denominator : 0; }
    REG32(LCD_BASE + 0x08) = (REG32(LCD_BASE + 0x08) & 0x7ff00u) | 8u;
    REG32(LCD_BASE + 0x0c) &= 0xffffff00u;
    LCDCON1 = (LCDCON1 & 0xffu) | (clkval << 8) | 1u;
    return 1;
}

static void usb_hwsetup(void)
{
    CLKCON &= ~0x40u;   /* USB host off */
    CLKCON |= 0x80u;    /* USB device on */
    UPLLCON = 0x78023u; /* 48 MHz USB PLL, same value as newRPL target_39gs */
    CLKSLOW &= ~0x80u;  /* UPLL on */
    MISCCR &= ~((1u << 13) | (1u << 12) | (1u << 3));

    PWR_REG = 0;
    FUNC_ADDR_REG = 0x80u;

    INDEX_REG = 0;
    MAXP_REG = 1;       /* 8-byte EP0 */
    MAXP_REG2 = 1;
    EP0_CSR = 0xc0u;

    INDEX_REG = 1;
    MAXP_REG = 8;       /* 64-byte EP1 IN */
    MAXP_REG2 = 8;
    IN_CSR1_REG = EPN_IN_FIFO_FLUSH | EPN_IN_CLR_DATA_TOGGLE;
    IN_CSR2_REG = 0x20u;
    OUT_CSR1_REG = EPN_OUT_CLR_DATA_TOGGLE;
    OUT_CSR2_REG = 0;

    INDEX_REG = 2;
    MAXP_REG = 8;       /* 64-byte EP2 OUT */
    MAXP_REG2 = 8;
    IN_CSR1_REG = EPN_IN_FIFO_FLUSH | EPN_IN_CLR_DATA_TOGGLE;
    IN_CSR2_REG = 0;
    OUT_CSR1_REG = EPN_OUT_CLR_DATA_TOGGLE;
    OUT_CSR2_REG = 0;

    USB_INT_EN_REG = 0x07u;
    EP_INT_EN_REG = 0x07u;
    USB_INT_REG = 0x07u;
    EP_INT_REG = 0x1fu;
    INDEX_REG = 0;
}

static u32 make_device_desc(u8 *d)
{
    d[0]=18; d[1]=1; d[2]=0x10; d[3]=0x01;
    d[4]=0; d[5]=0; d[6]=0; d[7]=8;
    put16(d+8, VID_HP); put16(d+10, PID_HP39);
    d[12]=0x02; d[13]=0x01;
    d[14]=1; d[15]=2; d[16]=0; d[17]=1;
    return 18;
}

static u32 make_hid_report_desc(u8 *d)
{
    u32 i=0;
    d[i++]=0x06; d[i++]=0xab; d[i++]=0xff;
    d[i++]=0x0a; d[i++]=0x00; d[i++]=0x02;
    d[i++]=0xa1; d[i++]=0x01;
    d[i++]=0x75; d[i++]=0x08;
    d[i++]=0x15; d[i++]=0x00;
    d[i++]=0x26; d[i++]=0xff; d[i++]=0x00;
    d[i++]=0x95; d[i++]=64;
    d[i++]=0x09; d[i++]=0x01;
    d[i++]=0x81; d[i++]=0x02;
    d[i++]=0x95; d[i++]=64;
    d[i++]=0x09; d[i++]=0x02;
    d[i++]=0x91; d[i++]=0x02;
    d[i++]=0xc0;
    return i;
}

static u32 make_config_desc(u8 *d)
{
    u32 i=0;
    d[i++]=9; d[i++]=2; d[i++]=41; d[i++]=0; d[i++]=1; d[i++]=1; d[i++]=0; d[i++]=0xc0; d[i++]=50;
    d[i++]=9; d[i++]=4; d[i++]=0; d[i++]=0; d[i++]=2; d[i++]=3; d[i++]=0; d[i++]=0; d[i++]=0;
    d[i++]=9; d[i++]=0x21; d[i++]=0x11; d[i++]=0x01; d[i++]=0; d[i++]=1; d[i++]=0x22; d[i++]=28; d[i++]=0;
    d[i++]=7; d[i++]=5; d[i++]=0x81; d[i++]=3; d[i++]=64; d[i++]=0; d[i++]=2;
    d[i++]=7; d[i++]=5; d[i++]=0x02; d[i++]=3; d[i++]=64; d[i++]=0; d[i++]=2;
    return i;
}

static void put_utf16_char(u8 *d, u32 index, u8 ch)
{
    d[2 + 2 * index] = ch;
    d[3 + 2 * index] = 0;
}

static u32 make_string_desc(u8 *d, u32 which)
{
    if(which == 0) {
        d[0]=4; d[1]=3; d[2]=0x09; d[3]=0x04;
        return 4;
    }
    d[1]=3;
    if(which == 1) {
        d[0]=16;
        put_utf16_char(d,0,'h'); put_utf16_char(d,1,'p');
        put_utf16_char(d,2,'c'); put_utf16_char(d,3,'l');
        put_utf16_char(d,4,'a'); put_utf16_char(d,5,'n');
        put_utf16_char(d,6,'g');
        return 16;
    }
    if(which == 2) {
        const char *name = "HP39 ROM Stream V2";
        d[0]=38;
        for(u32 i=0; i<18; ++i) put_utf16_char(d,i,(u8)name[i]);
        return 38;
    }
    return 0;
}

static void ep0_ack(void)
{
    INDEX_REG=0;
    EP0_CSR |= EP0_SERVICED_OUT_PKT_RDY | EP0_DATA_END;
}

static void ep0_stall(void)
{
    INDEX_REG=0;
    EP0_CSR |= EP0_SEND_STALL | EP0_SERVICED_OUT_PKT_RDY;
}

/* Queue control IN data. Never wait here for a host packet: reset, a new
 * SETUP, cable removal and ON cancellation must stay serviceable. */
static void ep0_send(struct usb_state *u, const u8 *data, u32 count, u32 requested)
{
    if(count > requested) count=requested;
    for(u32 i=0; i<count; ++i) u->control[i]=data[i];
    u->count=count; u->sent=0;
    u->zero_packet=(count==0 || (count<requested && (count&7u)==0));
    u->pending=1;
    INDEX_REG=0;
    EP0_CSR |= EP0_SERVICED_OUT_PKT_RDY;
}

static void ep0_transmit(struct usb_state *u)
{
    INDEX_REG=0;
    if(!u->pending || (EP0_CSR & EP0_IN_PKT_RDY)) return;
    u32 n=u->count-u->sent;
    if(n>8) n=8;
    for(u32 i=0; i<n; ++i) EP0_FIFO=u->control[u->sent+i];
    u->sent+=n;
    if(u->sent==u->count && (!u->zero_packet || n==0)) {
        u->pending=0;
        EP0_CSR |= EP0_IN_PKT_RDY | EP0_DATA_END;
    } else EP0_CSR |= EP0_IN_PKT_RDY;
}

static void reset_endpoints(void)
{
    FUNC_ADDR_REG=0x80u;
    INDEX_REG=0; MAXP_REG=1; MAXP_REG2=1; EP0_CSR=0xc0u;
    INDEX_REG=1; MAXP_REG=8; MAXP_REG2=8; IN_CSR1_REG=0x48u; IN_CSR2_REG=0x20u; OUT_CSR1_REG=0x80u; OUT_CSR2_REG=0;
    INDEX_REG=2; MAXP_REG=8; MAXP_REG2=8; IN_CSR1_REG=0x48u; IN_CSR2_REG=0; OUT_CSR1_REG=0x80u; OUT_CSR2_REG=0;
    INDEX_REG=0;
}

static int service_ep0(struct usb_state *u)
{
    u8 b[64];
    u32 reqtype, request, value, index, length, n;
    INDEX_REG=0;
    if(EP0_CSR & EP0_SETUP_END) {
        u->pending=0;
        EP0_CSR |= EP0_SERVICED_SETUP_END;
    }
    if(EP0_CSR & EP0_SENT_STALL)
        EP0_CSR = 0;
    if(!(EP0_CSR & EP0_OUT_PKT_RDY))
        return 0;

    /* A zero-length OUT packet completes a control read; it is not SETUP. */
    n=(OUT_FIFO_CNT1_REG & 0xffu) | ((OUT_FIFO_CNT2_REG & 0xffu)<<8);
    if(n!=8) {
        for(u32 i=0; i<n; ++i) (void)EP0_FIFO;
        EP0_CSR |= EP0_SERVICED_OUT_PKT_RDY;
        return 1;
    }
    u->pending=0;
    reqtype=(u8)EP0_FIFO; request=(u8)EP0_FIFO;
    value=(u8)EP0_FIFO; value|=(u32)(u8)EP0_FIFO<<8;
    index=(u8)EP0_FIFO; index|=(u32)(u8)EP0_FIFO<<8;
    length=(u8)EP0_FIFO; length|=(u32)(u8)EP0_FIFO<<8;

    if((reqtype & 0x60u)==0) {
        if(request==GET_DESCRIPTOR) {
            n=0;
            if(value==0x0100u) n=make_device_desc(b);
            else if(value==0x0200u) n=make_config_desc(b);
            else if(value==0x2200u && index==0) n=make_hid_report_desc(b);
            else if(value==0x2100u && index==0) { make_config_desc(b); for(n=0;n<9;++n) b[n]=b[18+n]; }
            else if((value & 0xff00u)==0x0300u) n=make_string_desc(b,value & 0xffu);
            if(n) { ep0_send(u,b,n,length); return 1; }
            ep0_stall(); return 1;
        }
        if(request==SET_ADDRESS) {
            FUNC_ADDR_REG=(value & 0x7fu) | 0x80u;
            ep0_ack(); return 1;
        }
        if(request==SET_CONFIGURATION) {
            if(value>1) { ep0_stall(); return 1; }
            u->configured = value ? 1 : 0;
            ep0_ack(); return 1;
        }
        if(request==GET_CONFIGURATION) {
            b[0]=(u8)(u->configured ? 1 : 0); ep0_send(u,b,1,length); return 1;
        }
        if(request==GET_STATUS) {
            b[0]=0; b[1]=0; ep0_send(u,b,2,length); return 1;
        }
        if(request==GET_INTERFACE) {
            b[0]=0; ep0_send(u,b,1,length); return 1;
        }
        if(request==SET_INTERFACE || request==CLEAR_FEATURE || request==SET_FEATURE) {
            ep0_ack(); return 1;
        }
        ep0_stall(); return 1;
    }

    if((reqtype & 0x61u)==0x21u && index==0) {
        if(request==HID_SET_IDLE || request==HID_SET_PROTOCOL) {
            ep0_ack(); return 1;
        }
        if(request==HID_GET_REPORT) {
            zero64(b); ep0_send(u,b,64,length); return 1;
        }
        if(request==HID_SET_REPORT) {
            /* Raw HID data uses EP2 OUT.  Do not ACK a control transfer whose
               data stage we are not consuming. */
            ep0_stall(); return 1;
        }
    }
    ep0_stall();
    return 1;
}

static void pump_usb(struct usb_state *u)
{
    u32 interrupts=USB_INT_REG;
    u32 endpoints=EP_INT_REG;
    if(interrupts & USB_RESET_BIT) {
        u->configured=0; u->pending=0;
        reset_endpoints();
        USB_INT_REG=USB_RESET_BIT;
        return;
    }
    if(interrupts & 0x03u) USB_INT_REG=interrupts & 0x03u;
    /* Poll both SETUP and pending IN even when an interrupt edge was cleared. */
    service_ep0(u);
    ep0_transmit(u);
    if(endpoints) EP_INT_REG=endpoints & 0x1fu;
}

/* Negative statuses are stable on-screen/host error codes: disconnect, user
 * cancel, timeout, reset during transfer. */
static int wait_status(struct usb_state *u, struct deadline *d)
{
    if(GPFDAT & 1u) return -2;
    if(disconnect_seen()) return -1;
    if(u->started && !u->configured) return -4;
    if(deadline_expired(d)) return -3;
    return 0;
}

static int recv_report(u8 *b, struct usb_state *u)
{
    struct deadline d;
    deadline_start(&d,120);
    for(;;) {
        pump_usb(u);
        int status=wait_status(u,&d);
        if(status) return status;
        if(!u->configured) continue;
        INDEX_REG=2;
        if(OUT_CSR1_REG & EPN_OUT_PKT_RDY) {
            u32 n=(OUT_FIFO_CNT1_REG & 0xffu) | ((OUT_FIFO_CNT2_REG & 0xffu)<<8);
            for(u32 i=0; i<n; ++i) {
                u8 value=(u8)EP2_FIFO;
                if(i<REPORT_BYTES) b[i]=value;
            }
            OUT_CSR1_REG &= ~EPN_OUT_PKT_RDY;
            INDEX_REG=0;
            if(n!=REPORT_BYTES) return -5;
            return (int)n;
        }
        INDEX_REG=0;
    }
}

static int send_report(const u8 *b, struct usb_state *u)
{
    struct deadline d;
    deadline_start(&d,15);
    for(;;) {
        pump_usb(u);
        int status=wait_status(u,&d);
        if(status) return status;
        if(!u->configured) return -4;
        INDEX_REG=1;
        if(!(IN_CSR1_REG & EPN_IN_PKT_RDY)) break;
        INDEX_REG=0;
    }
    /* Bus reset is asynchronous even with CPU IRQs masked. It also resets
     * MAXP and INDEX: do not finish a 64-byte packet using reset registers.
     * Checking every byte bounds any post-reset write to one FIFO byte. */
    for(u32 i=0; i<REPORT_BYTES; ++i) {
        if(USB_INT_REG & USB_RESET_BIT) { u->configured=0; return -4; }
        EP1_FIFO=b[i];
    }
    if(USB_INT_REG & USB_RESET_BIT) { u->configured=0; return -4; }
    INDEX_REG=1;
    IN_CSR1_REG |= EPN_IN_PKT_RDY;
    INDEX_REG=0;
    return 0;
}

static int command_is(const u8 *b, u8 cmd)
{
    return b[0]==cmd && b[1]==PROTO_VERSION && b[2]=='H' && b[3]=='3' && b[4]=='9';
}

static int wait_command(u8 wanted, u8 *b, struct usb_state *u)
{
    for(;;) {
        int status=recv_report(b,u);
        if(status<0) return status;
        if(command_is(b,'X')) return -2;
        if(command_is(b,wanted)) return 0;
        if(command_is(b,'?')) {
            zero64(b);
            b[0]='I'; b[1]=PROTO_VERSION; b[2]='H'; b[3]='3'; b[4]='9'; b[5]='R'; b[6]='O'; b[7]='M';
            put32(b+8,FLASH_BYTES); put32(b+12,BLOCK_BYTES); put32(b+16,DATA_BYTES);
            put32(b+20,READER_REVISION);
            int status=send_report(b,u);
            if(status<0) return status;
        } else return -5;
    }
}

static int send_block(u32 block, u8 *pkt, struct usb_state *u, u32 *sum_out, u32 *fnv_out)
{
    u32 base=block*BLOCK_BYTES;
    u32 pos=0, seq=0, n, i, sum=0, fnv=FNV_OFFSET;
    volatile const u8 *flash=(volatile const u8 *)(FLASH_BASE+base);
    while(pos<BLOCK_BYTES) {
        n=BLOCK_BYTES-pos; if(n>DATA_BYTES)n=DATA_BYTES;
        zero64(pkt);
        pkt[0]='D'; pkt[1]=(u8)n; put16(pkt+2,(u16)seq); put32(pkt+4,base+pos);
        for(i=0;i<n;++i) {
            u8 v=flash[pos+i];
            pkt[8+i]=v; sum+=v; fnv=(fnv ^ v)*FNV_PRIME;
        }
        int status=send_report(pkt,u);
        if(status<0) return status;
        pos+=n; ++seq;
    }
    *sum_out=sum; *fnv_out=fnv;
    return 0;
}

int hp39_rom_stream_main(void)
{
    struct hw_snapshot saved;
    struct usb_state usb;
    struct deadline deadline;
    u8 pkt[64];
    u32 block=0, pass=0, sum=0, fnv=0, total_sum=0;
    int status=0, usb_owned=0;

    usb.configured=0; usb.started=0; usb.pending=0;
    take_snapshot(&saved);
    display(saved.screen,"STARTING",0,0);
    /* A connected launch is recoverable and explains its required next step. */
    if(prepare_cable_detect()) {
        display(saved.screen,"UNPLUG USB",0,0);
        while(cable_connected()) {
            if(GPFDAT & 1u) { status=-2; goto restore; }
        }
    }
    SRCPND=IRQ_EINT1; INTPND=IRQ_EINT1;
    if(!prepare_usb_clock()) {
        /* The clock check can fail while LCDEN is cleared. Restore its
         * original clock/timing before presenting E07; never hide the error. */
        restore_platform(&saved);
        status=-6; goto stopped;
    }
    usb_hwsetup(); usb_owned=1;
    display(saved.screen,"PLUG USB",0,0);
    while(!cable_connected()) {
        if(GPFDAT & 1u) { status=-2; goto stopped; }
    }
    SRCPND=IRQ_EINT1; INTPND=IRQ_EINT1;
    display(saved.screen,"ENUMERATING",0,0);
    deadline_start(&deadline,120);
    while(!usb.configured) {
        pump_usb(&usb);
        status=wait_status(&usb,&deadline);
        if(status) goto stopped;
    }
    display(saved.screen,"START RECEIVER",0,0);
    status=wait_command('S',pkt,&usb);
    if(status<0) goto stopped;
    usb.started=1;

    for(block=0; block<FLASH_BYTES/BLOCK_BYTES; ++block) {
        pass=0;
retry_block:
        ++pass;
        display(saved.screen,"READING",block+1,pass>9 ? 9 : pass);
        status=send_block(block,pkt,&usb,&sum,&fnv);
        if(status<0) goto stopped;
        zero64(pkt);
        pkt[0]='C'; pkt[1]=PROTO_VERSION; pkt[2]=(u8)block;
        put32(pkt+4,block*BLOCK_BYTES); put32(pkt+8,BLOCK_BYTES);
        put32(pkt+12,sum); put32(pkt+16,fnv);
        status=send_report(pkt,&usb);
        if(status<0) goto stopped;
        for(;;) {
            status=recv_report(pkt,&usb);
            if(status<0) goto stopped;
            if(command_is(pkt,'X')) { status=-2; goto stopped; }
            if(command_is(pkt,'R') && pkt[5]==(u8)block && get32(pkt+8)==block*BLOCK_BYTES)
                goto retry_block;
            if(command_is(pkt,'A') && pkt[5]==(u8)block && get32(pkt+8)==block*BLOCK_BYTES)
                break;
            status=-5; goto stopped;
        }
        total_sum+=sum;
    }
    display(saved.screen,"HOST SAVING",64,2);
    zero64(pkt);
    pkt[0]='E'; pkt[1]=PROTO_VERSION; pkt[2]='H'; pkt[3]='3'; pkt[4]='9'; pkt[5]='R'; pkt[6]='O'; pkt[7]='M';
    put32(pkt+8,FLASH_BYTES); put32(pkt+12,total_sum); put32(pkt+16,0x50415353u);
    status=send_report(pkt,&usb);
    if(status<0) goto stopped;
    status=wait_command('F',pkt,&usb);
    if(status<0) goto stopped;
    display(saved.screen,"SAVED UNPLUG",64,2);
    goto wait_disconnect;

stopped:
    /* A machine-readable error is best effort. Never block teardown on a host
     * which stopped accepting IN packets; the LCD retains the precise code. */
    if(usb_owned && usb.configured && cable_connected() && !(USB_INT_REG & USB_RESET_BIT)) {
        INDEX_REG=1;
        if(!(IN_CSR1_REG & EPN_IN_PKT_RDY)) {
            IN_CSR1_REG=EPN_IN_FIFO_FLUSH;
            zero64(pkt); pkt[0]='!'; pkt[1]=PROTO_VERSION;
            pkt[2]=(u8)(-status); pkt[3]=(u8)(block<64u ? block : 63u); pkt[4]=(u8)pass;
            u32 i;
            for(i=0; i<REPORT_BYTES; ++i) {
                if(USB_INT_REG & USB_RESET_BIT) break;
                EP1_FIFO=pkt[i];
            }
            if(i==REPORT_BYTES && !(USB_INT_REG & USB_RESET_BIT)) {
                INDEX_REG=1;
                IN_CSR1_REG |= EPN_IN_PKT_RDY;
            }
        }
        INDEX_REG=0;
    }
    if(status==-1) display(saved.screen,"E03 CABLE LOST",block+1,pass);
    else if(status==-2) display(saved.screen,"CANCELLED",0,0);
    else if(status==-3) display(saved.screen,"E04 USB TIMEOUT",block+1,pass);
    else if(status==-4) display(saved.screen,"E05 USB RESET",block+1,pass);
    else if(status==-5) display(saved.screen,"E06 PROTOCOL",block+1,pass);
    else display(saved.screen,"E07 USB CLOCK",0,0);
    /* If already unplugged, retain an error until ON acknowledges it. */
    if(!cable_connected() && status!=-2) {
        while(!(GPFDAT & 1u)) { }
    }
wait_disconnect:
    /* Physical removal is the ownership boundary for returning USB to Stock. */
    while(cable_connected()) { }
restore:
    while(GPFDAT & 1u) { }
    if(usb_owned) usb_hwshutdown();
    restore_platform(&saved);
    return status;
}
