/* SPDX-License-Identifier: MIT
 * Local, bounded USB transaction driver using only Orchard's public API.
 * Reads one model-correct image, commands on stdin, and JSON lines on stdout.
 * No firmware is embedded and no image/memory writes are exposed to the host.
 */
#include "orchard/orchard.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool number(const char *text, uint32_t *out, unsigned base) {
    if (!text || !*text || *text == '-' || *text == '+') return false;
    uint64_t v = 0;
    for (const char *p = text; *p; ++p) {
        unsigned n = *p >= '0' && *p <= '9' ? (unsigned)(*p - '0') :
                     *p >= 'a' && *p <= 'f' ? (unsigned)(*p - 'a' + 10) :
                     *p >= 'A' && *p <= 'F' ? (unsigned)(*p - 'A' + 10) : 99u;
        if (n >= base || v > (UINT32_MAX - n) / base) return false;
        v = v * base + n;
    }
    *out = (uint32_t)v;
    return true;
}
static void snapshot(orchard_machine *m, unsigned result, const uint8_t *data, size_t length, unsigned pid) {
    orchard_state s; orchard_usb_state u;
    orchard_get_state(m, &s); orchard_get_usb_state(m, &u);
    printf("{\"result\":%u,\"length\":%zu,\"pid\":%u,\"data\":\"", result, length, pid);
    for (size_t i = 0; i < length; ++i) printf("%02x", data[i]);
    printf("\",\"cpu\":[");
    uint32_t words[33];
    for (unsigned i = 0; i < 16; ++i) words[i] = s.registers[i];
    words[16]=s.cpsr; words[17]=s.cp15_control; words[18]=s.fault_status; words[19]=s.fault_address;
    words[20]=(uint32_t)s.instructions; words[21]=(uint32_t)(s.instructions>>32);
    words[22]=(uint32_t)s.ticks; words[23]=(uint32_t)(s.ticks>>32);
    words[24]=(uint32_t)s.exceptions; words[25]=(uint32_t)(s.exceptions>>32);
    words[26]=s.sleeping; words[27]=s.rom_loaded; words[28]=(uint32_t)s.stop.status;
    words[29]=s.stop.pc; words[30]=s.stop.instruction; words[31]=s.stop.address; words[32]=s.stop.detail;
    for (unsigned i=0;i<33;++i) printf("%s%" PRIu32, i ? "," : "",words[i]);
    printf("],\"usb\":[%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u",
           u.address,u.active_address,u.power,u.index,u.ep_pending,u.bus_pending,
           u.ep_enable,u.bus_enable,u.frame,u.phase,(unsigned)u.connected);
    for(unsigned i=0;i<5;++i) printf(",%u,%u,%u,%u,%u",u.max_packet[i],u.in_csr[i],u.out_csr[i],u.tx_bytes[i],u.rx_bytes[i]);
    const uint64_t counts[]={u.resets,u.setups,u.in_packets,u.out_packets};
    for(unsigned i=0;i<4;++i) printf(",%" PRIu32 ",%" PRIu32,(uint32_t)counts[i],(uint32_t)(counts[i]>>32));
    puts("]}");
}
int main(int argc, char **argv) {
    uint32_t model;
    if (argc != 3 || !number(argv[1], &model, 10) || !orchard_get_profile(model)) {
        fputs("Usage: orchard-usb-session MODEL_ID FULL-NOR.bin < commands.txt\n",stderr); return 64;
    }
    const orchard_profile *p=orchard_get_profile(model);
    uint8_t *rom=malloc((size_t)p->flash_bytes+1);
    void *arena=malloc(orchard_machine_size()); FILE *f=fopen(argv[2],"rb");
    if (!rom || !arena || !f) { free(rom);free(arena);if(f)fclose(f);return 74; }
    size_t n=fread(rom,1,(size_t)p->flash_bytes+1,f);
    bool read_error=ferror(f)!=0; if(fclose(f)!=0)read_error=true;
    orchard_machine *m=orchard_init(arena,orchard_machine_size(),model);
    if(read_error || !m || orchard_load_rom(m,rom,n)!=ORCHARD_OK) {free(rom);free(arena);return 64;}
    free(rom);
    char line[512]; unsigned commands=0;uint64_t ticks=0;int exit_code=0;
    while(fgets(line,sizeof(line),stdin)) {
        if(++commands>4096 || (!strchr(line,'\n') && !feof(stdin))) {exit_code=64;break;}
        char *args[8]; unsigned count=0;
        for(char*t=strtok(line," \t\r\n");t;t=strtok(NULL," \t\r\n")) {
            if(count==8){count=9;break;}args[count++]=t;
        }
        if(!count)continue;
        if(count>7){exit_code=64;break;}
        uint32_t v[5]={0}; uint8_t data[64];size_t length=0;unsigned pid=0,result=0;
        const char *op=args[0]; bool valid=true;
        unsigned numeric=count-1;
        if(strcmp(op,"out")==0){if(count!=6){exit_code=64;break;}numeric=4;}
        for(unsigned i=0;i<numeric;++i) {
            unsigned base=(!strcmp(op,"pad")||!strcmp(op,"bias")) && i>0 ? 16:10;
            if(i>=5 || !number(args[i+1],&v[i],base)){valid=false;break;}
        }
        if(!valid){exit_code=64;break;}
        if(!strcmp(op,"run")&&count==2 && v[0]<=10000000u && ticks+v[0]<=100000000u) {
            ticks+=v[0];result=(unsigned)orchard_run(m,v[0]).status;
        } else if(!strcmp(op,"connect")&&count==2&&v[0]<=1) result=(unsigned)orchard_usb_connect(m,v[0]!=0);
        else if(!strcmp(op,"reset")&&count==2&&v[0]<=1) result=(unsigned)orchard_usb_reset_signal(m,v[0]!=0);
        else if(!strcmp(op,"sof")&&count==2) result=(unsigned)orchard_usb_sof(m,v[0]);
        else if(!strcmp(op,"keyboard")&&count==2&&v[0]<=1)result=(unsigned)orchard_keyboard_attach(m,v[0]!=0);
        else if(!strcmp(op,"key")&&count==4&&v[2]<=1)result=(unsigned)orchard_keyboard_matrix(m,v[0],v[1],v[2]!=0);
        else if(!strcmp(op,"pad")&&count==4)result=(unsigned)orchard_gpio_inputs(m,(orchard_gpio_port)v[0],v[1],v[2]);
        else if(!strcmp(op,"bias")&&count==4)result=(unsigned)orchard_gpio_bias(m,(orchard_gpio_port)v[0],v[1],v[2]);
        else if(!strcmp(op,"cold")&&count==1)orchard_reset(m);
        else if(!strcmp(op,"in")&&count==4&&v[2]<=1)result=(unsigned)orchard_usb_in(m,v[0],v[1],v[2]!=0,data,sizeof(data),&length,&pid);
        else if(!strcmp(op,"out")&&count==6&&v[2]<=1) {
            const char *hex=args[5];size_t size=!strcmp(hex,"-")?0:strlen(hex);
            if(size>128 || (size&1)){exit_code=64;break;}
            for(size_t i=0;i<size;i+=2){char b[3]={hex[i],hex[i+1],0};uint32_t x;if(!number(b,&x,16)){valid=false;break;}data[i/2]=(uint8_t)x;}
            if(!valid){exit_code=64;break;}
            result=(unsigned)orchard_usb_out(m,v[0],v[1],v[2]!=0,v[3],data,size/2);
        } else {exit_code=64;break;}
        snapshot(m,result,data,length,pid);
        orchard_state state;orchard_get_state(m,&state);
        if(state.stop.status!=ORCHARD_OK){exit_code=2;break;}
    }
    if(ferror(stdin)||ferror(stdout)||fflush(stdout)!=0)exit_code=74;
    if(exit_code==64)fprintf(stderr,"Invalid command at line %u\n",commands);
    free(arena);return exit_code;
}
