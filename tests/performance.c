/* SPDX-License-Identifier: MIT
 * Exact-state differential for host-only EINT memoization. The reference
 * below retains the pre-optimization tick algorithm, not an assumed result. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif
static orchard_machine fast, reference;
static unsigned checks, failures, first_failure;
static void check(bool value, unsigned line) {
    ++checks;
    if (!value) { if (!failures) first_failure = line; ++failures; }
}
#define CHECK(x) check((x), __LINE__)
static void reference_tick(orchard_machine *m) {
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
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, 0x56000090u, control); return;
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
    s->eint_known = known; s->eint_levels = levels;
    uint32_t pending = s->gpio[0xa8 / 4] & ~s->gpio[0xa4 / 4];
    if (pending & 0xf0u) s->srcpnd |= 1u << 4;
    if (pending & 0xffff00u) s->srcpnd |= 1u << 5;
}
static bool equal(const void *a, const void *b, size_t length) {
    const uint8_t *x = a, *y = b;
    for (size_t i=0;i<length;++i) if(x[i]!=y[i]) return false;
    return true;
}
static void compare(void) {
    o_eint_tick(&fast); reference_tick(&reference);
    CHECK(equal(&fast.stop,&reference.stop,sizeof(fast.stop)));
    o_soc a=fast.soc, b=reference.soc;
    o_zero(&a.eint_cache,sizeof(a.eint_cache));o_zero(&b.eint_cache,sizeof(b.eint_cache));
    CHECK(equal(&a,&b,sizeof(a)));
}
static uint32_t random_word(uint32_t *seed) {
    uint32_t x=*seed;x^=x<<13;x^=x>>17;x^=x<<5;return *seed=x;
}
static void setup(void) {
    CHECK(orchard_init(&fast,sizeof fast,4)!=NULL);
    CHECK(orchard_keyboard_attach(&fast,true)==ORCHARD_OK);
    fast.soc.gpio[0x50/4]=0xaaaau;
    fast.soc.gpio[0x60/4]=0xaaaa5554u;
    fast.soc.gpio_bias_known[6]=0xff00;
    fast.soc.gpio_bias_levels[6]=0xff00;
    fast.soc.gpio_input_known[5]=0x8e;
    reference.soc=fast.soc;reference.cpu=fast.cpu;reference.stop=fast.stop;reference.profile=fast.profile;
}
EXPORT("regression") unsigned run(void) {
    checks=failures=first_failure=0;setup();
    /* Level interrupts reassert after W1C even when every electrical input
       remains unchanged. All trigger modes, direct and matrix lines. */
    for(unsigned mode=0;mode<8;++mode) {
        uint32_t control=mode*0x11111111u;
        fast.soc.gpio[0x88/4]=fast.soc.gpio[0x8c/4]=fast.soc.gpio[0x90/4]=control;
        reference.soc=fast.soc;
        for(unsigned j=0;j<20;++j) {
            fast.soc.keyboard_direct=reference.soc.keyboard_direct=(j/4)%2?0x71:0;
            fast.soc.srcpnd=reference.soc.srcpnd=0;
            fast.soc.gpio[0xa8/4]=reference.soc.gpio[0xa8/4]=0;
            compare();
        }
    }
    uint32_t seed=0x9202410;
    for(unsigned n=0;n<12000;++n) {
        if(n%32==0)setup();
        /* Warm the fast path, clear pending independently, then mutate one
           dependency, including direct writes used by core regression tools. */
        o_zero(&fast.stop,sizeof fast.stop);o_zero(&reference.stop,sizeof reference.stop);
        for(unsigned i=0;i<3;++i)compare();
        uint32_t value=random_word(&seed), bit=1u<<(value&15u);
        unsigned port=5+(value>>4&1u);
        switch(n%16) {
        case 0:fast.soc.gpio[port*4]^=3u<<((value&15u)*2u);break;
        case 1:fast.soc.gpio[port*4+1]^=bit;break;
        case 2:fast.soc.gpio[port*4+2]^=bit;break;
        case 3:fast.soc.gpio_input_known[port]^=bit;break;
        case 4:fast.soc.gpio_input_levels[port]^=bit;break;
        case 5:fast.soc.gpio_bias_known[port]^=bit;break;
        case 6:fast.soc.gpio_bias_levels[port]^=bit;break;
        case 7:fast.soc.keyboard_switches^=UINT64_C(1)<<(value%56);break;
        case 8:fast.soc.keyboard_direct^=1u<<((unsigned[]){0,4,5,6})[value&3u];break;
        case 9:fast.soc.gpio[0x88/4+value%3]^=value;break;
        case 10:fast.soc.eint_known=0;break;
        case 11:fast.soc.eint_levels^=value&0xffffffu;break;
        case 12:fast.soc.gpio[0xa8/4]=0;fast.soc.srcpnd=0;break;
        case 13:fast.soc.gpio[0xa4/4]^=value&0xfffff0u;break;
        case 14:fast.soc.keyboard_attached=!fast.soc.keyboard_attached;break;
        case 15:fast.soc.gpio[0x90/4]^=0x80000000u;break;
        }
        o_eint_cache old=reference.soc.eint_cache;
        reference.soc=fast.soc;reference.soc.eint_cache=old;
        compare();compare();
    }
    setup();compare();orchard_reset(&fast);orchard_reset(&reference);compare();
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first_failure;}
#ifndef __wasm__
int main(void){unsigned result=run();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,result,first_failure);return result?1:0;}
#endif
