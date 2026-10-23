OUTPUT_FORMAT("elf32-littlearm")
OUTPUT_ARCH(arm)
ENTRY(hp39_rom_stream)

PHDRS
{
    image PT_LOAD FLAGS(5);
}

SECTIONS
{
    . = 0;
    .image :
    {
        KEEP(*(.text.rom_stream_entry))
        *(.text .text.*)
        *(.rodata .rodata.*)
        . = ALIGN(4);
    } :image

    /DISCARD/ :
    {
        *(.ARM.exidx*)
        *(.ARM.extab*)
        *(.eh_frame*)
        *(.note .note.*)
        *(.note.GNU-stack)
        *(.comment)
        *(.data .data.*)
        *(.bss .bss.*)
        *(.got .got.*)
    }
}
