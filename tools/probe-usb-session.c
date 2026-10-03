/* SPDX-License-Identifier: MIT
 * Opt-in, local packet replay against a caller-supplied 2 MiB backing image.
 * No firmware, downloads, sockets, physical USB or guest memory patching.
 * Use probe-usb.mjs to authenticate the original boot-region input.
 */
#include "orchard/orchard.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
static orchard_machine *machine;
static int failed;
static void run(unsigned ticks) {
    while (ticks && !failed) {
        unsigned n = ticks < 256 ? ticks : 256;
        orchard_stop stop = orchard_run(machine,n);
        if (stop.status) {
            fprintf(stderr,"Guest stopped: code=%u pc=%08"PRIx32" address=%08"PRIx32"\n",
                    (unsigned)stop.status,stop.pc,stop.address);failed=1;return;
        }
        ticks-=n;
    }
}
static bool request(unsigned address, const uint8_t setup[8], uint8_t *reply, size_t *length) {
    *length=0;
    if(orchard_usb_setup(machine,address,setup,8)!=ORCHARD_USB_ACK) return false;
    size_t expected=(size_t)setup[6] | (size_t)setup[7]<<8;
    bool read=(setup[0]&128u)!=0;
    if(expected>256 || (!read && expected)) return false;
    bool data_done=!expected;
    for(unsigned tries=0;!data_done && tries<100 && !failed;++tries) {
        uint8_t packet[16];size_t n=0;run(1000);
        orchard_usb_result r=orchard_usb_in(machine,address,packet,sizeof(packet),&n);
        if(r==ORCHARD_USB_NAK)continue;
        if(r!=ORCHARD_USB_ACK || *length+n>expected) return false;
        memcpy(reply+*length,packet,n);*length+=n;
        /* The replay uses the default-control pipe's discovered 8-byte MPS.
           The synthetic and admitted original boot region both report eight. */
        data_done=(*length==expected || n<8);
    }
    if(!data_done || failed)return false;
    for(unsigned tries=0;tries<100 && !failed;++tries) {
        run(1000);size_t n=0;
        orchard_usb_result r=read && expected ? orchard_usb_out(machine,address,NULL,0)
            : orchard_usb_in(machine,address,NULL,0,&n);
        if(r==ORCHARD_USB_NAK)continue;
        if(r!=ORCHARD_USB_ACK || n)return false;
        run(1000);return !failed;
    }
    return false;
}
static void hex(const uint8_t *b,size_t n) {for(size_t i=0;i<n;++i)printf("%02x",b[i]);}
int main(int argc,char **argv) {
    if(argc!=3 || (strcmp(argv[2],"recovery") && strcmp(argv[2],"synthetic"))) return 64;
    uint8_t *rom=malloc(0x200001);void *arena=malloc(orchard_machine_size());
    FILE *f=fopen(argv[1],"rb");
    if(!rom || !arena || !f){if(f)fclose(f);free(rom);free(arena);return 74;}
    size_t n=fread(rom,1,0x200001,f);bool bad=ferror(f)!=0;fclose(f);
    machine=orchard_init(arena,orchard_machine_size(),6);
    if(bad || !machine || orchard_load_rom(machine,rom,n)!=ORCHARD_OK){free(rom);free(arena);return 64;}
    orchard_usb_attach(machine,true);orchard_keyboard_attach(machine,true);
    orchard_gpio_inputs(machine,ORCHARD_GPIO_D,0xcc7f,0);
    orchard_gpio_inputs(machine,ORCHARD_GPIO_G,1,0);
    orchard_gpio_bias(machine,ORCHARD_GPIO_G,0xf800,0xf800);
    run(2000000);orchard_keyboard_matrix(machine,3,5,true);run(400000);
    orchard_keyboard_matrix(machine,3,5,false);run(600000);
    orchard_usb_bus_reset(machine,true);run(500);orchard_usb_bus_reset(machine,false);run(20000);
    const uint8_t queries[7][8]={
        {128,6,0,1,0,0,8,0}, {128,6,0,1,0,0,18,0}, {0,5,7,0,0,0,0,0},
        {128,6,0,2,0,0,9,0}, {128,6,0,2,0,0,32,0}, {0,9,1,0,0,0,0,0},
        {128,8,0,0,0,0,1,0}
    };
    uint8_t replies[7][256];size_t sizes[7]={0};
    unsigned count=!strcmp(argv[2],"synthetic")?7:6;
    for(unsigned i=0;i<count && !failed;++i) {
        if(!request(i<3?0:7,queries[i],replies[i],&sizes[i])){
            fprintf(stderr,"Control request %u failed\n",i);failed=1;
        } else if(i==0 && (sizes[i]!=8 || replies[i][7]!=8)) {
            fputs("Unsupported EP0 packet size\n",stderr);failed=1;
        }
    }
    if(!failed){
        orchard_state s;orchard_get_state(machine,&s);uint32_t usb[48];orchard_usb_snapshot(machine,usb,48);
        printf("{\"replies\":[");for(unsigned i=0;i<count;++i){printf("%s\"",i?",":"");hex(replies[i],sizes[i]);printf("\"");}
        printf("],\"registers\":[");for(unsigned i=0;i<16;++i)printf("%s%"PRIu32,i?",":"",s.registers[i]);
        printf("],\"cpsr\":%"PRIu32",\"cp15_control\":%"PRIu32",\"fault_status\":%"PRIu32",\"fault_address\":%"PRIu32
               ",\"ticks\":\"%"PRIu64"\",\"instructions\":\"%"PRIu64"\",\"exceptions\":\"%"PRIu64
               "\",\"sleeping\":%s,\"stop_code\":%u,\"usb\":[",s.cpsr,s.cp15_control,s.fault_status,s.fault_address,
               s.ticks,s.instructions,s.exceptions,s.sleeping?"true":"false",(unsigned)s.stop.status);
        for(unsigned i=0;i<48;++i)printf("%s%"PRIu32,i?",":"",usb[i]);
        puts("]}");
    }
    free(rom);free(arena);return failed?2:0;
}
