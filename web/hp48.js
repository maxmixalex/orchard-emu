// SPDX-License-Identifier: MIT
// Scan coordinates are hardware facts; provenance: docs/development/web.md.
export const HP48_ROM = '4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937';
export const KEY_ROWS = [
  [['F1',35],['F2',36],['F3',37],['F4',38],['F5',39],['F6',40]],
  [['APPS',41],['MODE',46],['TOOL',47],['↑',42],['←',43],['→',45]],
  [['VAR',48],['STO',49],['NXT',50],['HIST',28],['EVAL',21],['↓',44]],
  [["'",14],['SYMB',7],['yˣ',29],['√',22],['SIN',15],['COS',8],['TAN',1]],
  [['EEX',30],['±',23],['X',16],['1/x',9],['⌫',0]],
  [['ALPHA',57],['7',24],['8',17],['9',10],['÷',2]],
  [['L SHIFT',58],['4',25],['5',18],['6',11],['×',3]],
  [['R SHIFT',59],['1',26],['2',19],['3',12],['−',4]],
  [['ON',56],['0',27],['.',20],['SPACE',13],['+',5]],
  [['ENTER',6]],
];
export const KEYS = new Map(KEY_ROWS.flat().map(([label, scan]) => [scan, label]));
const shortcuts = new Map([
  ...KEY_ROWS.flat().filter(([label]) => /^\d$/.test(label)).map(([label, scan]) => [label, scan]),
  ['.',20],['+',5],['-',4],['*',3],['/',2],['Enter',6],['Backspace',0],['Escape',56],
  ['ArrowUp',42],['ArrowLeft',43],['ArrowDown',44],['ArrowRight',45],
  ...Array.from({length:6},(_,i)=>[`F${i+1}`,35+i]),
]);
export function shortcut(key) { return shortcuts.get(key); }
export function applySetup(core, model, preset) {
  if (preset === 'strict') return;
  if (preset !== 'hp48-home' || model !== 4) throw new Error('The HOME research setup is only defined for HP48gII.');
  const operations = [
    ['keyboard_attach',1], ['nor_select',1], ['sram_select',1],
    ['gpio_inputs',3,0xcc7f,0], ['gpio_inputs',5,0x8e,0], ['gpio_inputs',6,1,0],
    ['gpio_bias',6,0xf800,0xf800], ['adc_input',0,1,1023], ['adc_input',7,1,512], ['lcd_probe68',1],
  ];
  for (const [name,...args] of operations) if (core[name](...args)) throw new Error(`Cannot apply ${name}`);
}
// Tap semantics deliberately use virtual time, not how fast the browser click fires.
// Queueing is bounded. Pause/reset/visibility loss cancels pending and held keys.
export class TapQueue {
  constructor(change, hold = 2000000, gap = 2000000) {
    this.change = change; this.hold = hold; this.gap = gap; this.queue = []; this.active = null; this.readyAt = 0;
  }
  push(scan) {
    if (!KEYS.has(scan)) throw new Error('Unknown HP48 key');
    if (this.queue.length + (this.active !== null ? 1 : 0) >= 32) throw new Error('Key queue full; wait for the pending taps.');
    this.queue.push(scan);
  }
  update(tick) {
    if (this.active !== null && tick >= this.releaseAt) {
      this.change(this.active, false, tick); this.active = null; this.readyAt = tick + this.gap;
    }
    if (this.active === null && this.queue.length && tick >= this.readyAt) {
      this.active = this.queue.shift(); this.change(this.active, true, tick); this.releaseAt = tick + this.hold;
    }
  }
  boundary(tick) {
    if (this.active !== null) return this.releaseAt;
    return this.queue.length ? Math.max(tick, this.readyAt) : Infinity;
  }
  clear(tick) {
    this.queue.length = 0;
    if (this.active !== null) this.change(this.active, false, tick);
    this.active = null; this.readyAt = tick;
  }
  get pending() { return this.queue.length + (this.active !== null ? 1 : 0); }
}
