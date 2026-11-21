// SPDX-License-Identifier: MIT
// Exact identities supplied in ROM-for-HW-mod-39gs.zip. These describe research
// configurations, not original HP40gs/HP50g hardware or stock-model admission.
export const HARDWARE_MOD_ROMS = Object.freeze([
  { preset:'hp39gs-archive-home', model:2, bytes:0x100000, nor:2,
    hash:'1d0f323c289c67ee197e6f7983e771eec1ef70c8a174422fd5257f79fb3b80f3',
    label:'HP39gs archive ROM', firmware:'hp39gs', board:'hp39gs',
    description:'HP39gs ROM from the hardware-modification archive; acquisition and font provenance are not independently verified.' },
  { preset:'hp39gs-font-home', model:2, bytes:0x100000, nor:2,
    hash:'a6abaa2ce5a257886691ca3aac3fb10aa43c5d29fc6bf57121b880906b2b5b1b',
    label:'HP39gs alternate-font ROM', firmware:'hp39gs', board:'hp39gs',
    description:'HP39gs alternate-font ROM from the hardware-modification archive.' },
  { preset:'hp40gs-mod-home', model:3, bytes:0x200000, nor:1,
    hash:'9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311',
    label:'HP39gs → HP40gs · 2 MiB mod', firmware:'hp40gs', board:'hp39gs-modified',
    description:'HP40gs software on an HP39gs donor bootloader with 2 MiB NOR, 256 KiB SRAM and a 64-line LCD; uses the HP40gs memory profile.' },
  { preset:'hp50gm-home', model:7, bytes:0x200000, nor:1,
    hash:'b30a9ffb90996f0291b10a902a72d3a122db9c87fa5a55aa6ffdf07276b82db5',
    label:'HP50gm · 64-line hardware mod', firmware:'hp50gm', board:'hp48gii-compatible-modified',
    description:'Modified HP50g/HP49g+ software with an HP48gII-target bootloader, 2 MiB NOR, replaced 512 KiB SRAM and a 64-line LCD; the optional SD slot starts empty.' },
].map(Object.freeze));

export const hardwareModSetup = preset => HARDWARE_MOD_ROMS.find(rom => rom.preset === preset);
