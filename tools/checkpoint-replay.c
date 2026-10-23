/* SPDX-License-Identifier: MIT
 * Local-only cross-host checkpoint witness. This tool never fetches firmware.
 * Usage: MODEL ROM CHECKPOINT DELTA-TICKS NEW-CHECKPOINT
 */
#include "orchard/orchard.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
static int read_exact(const char *path, void *data, size_t n) {
    FILE *f=fopen(path,"rb");if(!f)return 0;
    int ok=fread(data,1,n,f)==n && fgetc(f)==EOF && !ferror(f);
    if(fclose(f))ok=0;
    return ok;
}
static int read_checkpoint(const char *path, void *data, size_t capacity, size_t *length) {
    FILE *f=fopen(path,"rb");if(!f)return 0;
    *length=fread(data,1,capacity,f);
    int ok=*length>=32 && fgetc(f)==EOF && !ferror(f);
    if(fclose(f))ok=0;
    return ok;
}
int main(int argc,char **argv){
    if(argc!=6)return 64;
    char *end;unsigned long model=strtoul(argv[1],&end,10);if(!*argv[1]||*end||model>6)return 64;
    const orchard_profile *p=orchard_get_profile((unsigned)model);if(!p)return 64;
    for(const char *s=argv[4];*s;s++)if(*s<'0'||*s>'9')return 64;
    errno=0;unsigned long budget=strtoul(argv[4],&end,10);if(errno||!*argv[4]||*end||budget>500000000)return 64;
    void *arena=malloc(orchard_machine_size());uint8_t *rom=malloc(p->flash_bytes),*data=NULL,*card=NULL;
    int result=74;orchard_machine *m=orchard_init(arena,orchard_machine_size(),(unsigned)model);
    if(!m||!rom||!read_exact(argv[2],rom,p->flash_bytes)||orchard_load_rom(m,rom,p->flash_bytes))goto done;
    size_t capacity=orchard_checkpoint_size(m)+(p->sd_slot?ORCHARD_SD_MAX_BYTES:0u),input_length=0,card_bytes=0;
    data=malloc(capacity);
    if(!data||!read_checkpoint(argv[3],data,capacity,&input_length))goto done;
    if(orchard_checkpoint_sd_size(m,data,input_length,&card_bytes)){result=64;goto done;}
    if(card_bytes) {
        card=malloc(card_bytes);
        if(!card||orchard_sd_bind(m,card,card_bytes))goto done;
    }
    if(orchard_checkpoint_load(m,data,input_length)){result=64;goto done;}
    size_t n=orchard_checkpoint_size(m);
    if(orchard_run(m,(uint32_t)budget).status||orchard_checkpoint_save(m,data,n)){result=2;goto done;}
    FILE *out=fopen(argv[5],"wbx");if(!out)goto done;
    int ok=fwrite(data,1,n,out)==n;if(fclose(out))ok=0;if(ok)result=0;
 done:free(card);free(data);free(rom);free(arena);return result;
}
