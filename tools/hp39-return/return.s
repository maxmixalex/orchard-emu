* SPDX-License-Identifier: MIT
* Orchard HP39 ARM-return probe; no Flash or MMIO accesses in the ARM payload.
TITLE Orchard ARM Return Probe
INCLUDE =Entry39.h
INCLUDE =Common.h
ASSEMBLE
=~xPrRUN EQU #113
	Dir_Head 11,ORCHARD RET,113
RPL
EXTERNAL xPrRUN
StndtType
INCLUDE =Sharedvar.h
ASSEMBLE
	Vfield L34,IntTable
	CON(5) =DOHSTR
	REL(5) endLink
	Link _Main
	Link _Entry
	Link _Exit
	Link _Display
endLink
RPL
DEFINE Entry INT_01
DEFINE Exit INT_02
DEFINE Display INT_03
ASSEMBLE
	Vfield IntTable,DirVar
	CON(5) =DOHSTR
	REL(5) endCode
RPL
NAMELESS _Main
::
  StndCheck
  FALSE TopicVar1!
  ' Entry
  ' Exit
  ' Display
  ' ::
    { { kcOn :: TurnOff TakeOver Entry ; } NULL{} NULL{} NULL{} NULL{} NULL{} }
    ONE KeyFace
  ;
  TRUE
  { NullMenuKey NullMenuKey NullMenuKey NullMenuKey NullMenuKey NullMenuKey }
  ONE
  ' :: TURNMENUON RECLAIMDISP ERRJMP ;
;
NAMELESS _Entry
::
  FALSE TopicVar1!
  LastBut3 CARCOMP
  xPrRUN
  TRUE TopicVar1!
  Display
;
NAMELESS _Display
::
  TopicVar1@ NOT case NOP
  EnsureMenuOff
  HARDBUFF ZEROZERO BINT_131d SIXTYFOUR GROB!ZERODRP
  $ "ARM RETURN OK" NINE TWENTYFOUR Put5x7
;
NAMELESS _Exit
:: LeaveGraphView ;
ASSEMBLE
endCode
	Vfield DirVar,DirCode
RPL
{
ASSEMBLE
	CON(5) =DOCSTR
	CON(5) 27
	NIBHEX C43B08
	NIBASC \A>CP\
	NIBHEX E1FFF21E
RPL
}
ASSEMBLE
	Vfield DirCode,DirAlt
RPL
{ }
ASSEMBLE
	Vfield DirAlt,DirNot
RPL
$ ""
ASSEMBLE
	Vfield DirNot,DirEnd
RPL
{ }
