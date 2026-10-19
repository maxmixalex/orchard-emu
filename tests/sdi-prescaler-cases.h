/* SPDX-License-Identifier: MIT */
static uint32_t state_crc(const uint8_t *p,size_t n) {
    uint32_t value=UINT32_MAX;
    for(size_t i=0;i<n;++i){value^=p[i];for(unsigned j=0;j<8;++j)value=(value>>1)^((0u-(value&1u))&0xedb88320u);}
    return ~value;
}
static void sdi_cases(void) {
    for(unsigned model=1;model<=6;++model){
        init(model,0);uint32_t value=99;
        if(model<5){CHECK(!o_mmio_read(&a,0x5a000004u,4,&value));CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);continue;}
        CHECK(o_mmio_read(&a,0x5a000004u,4,&value));CHECK(value==0);
        CHECK(o_mmio_write(&a,0x5a000004u,4,0xabcdef73u));
        CHECK(o_mmio_read(&a,0x5a000004u,4,&value));CHECK(value==0x73);
        size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof saved);
        CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
        CHECK(o_read_le(saved+8,4)==2u);CHECK(o_read_le(saved+n-4,4)==0x73);
        a.soc.sdi_prescaler=42;
        CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);CHECK(a.soc.sdi_prescaler==0x73);
        /* A valid checksum must not let an out-of-range latch mutate state. */
        word(saved+n-4,256);word(saved+28,state_crc(saved+32,n-32));duplicate();
        CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_BAD_ARGUMENT);same_state();
        /* Genuine v1 layout excludes only the appended word. Its header and
           independent bitwise CRC are rebuilt without touching the payload. */
        word(saved+8,1);word(saved+12,(uint32_t)n-4);word(saved+28,state_crc(saved+32,n-36));
        CHECK(orchard_checkpoint_load(&a,saved,n-4)==ORCHARD_OK);CHECK(a.soc.sdi_prescaler==0);
        CHECK(orchard_checkpoint_load(&a,saved,n-5)==ORCHARD_BAD_ARGUMENT);
        init(model,0);CHECK(!o_mmio_read(&a,0x5a000008u,4,&value));CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        init(model,0);CHECK(!o_mmio_write(&a,0x5a000004u,1,1));CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
    }
}
