// SPDX-License-Identifier: MIT
// Scan coordinates are hardware facts; provenance: docs/development/web.md.
export const HP39_ROM = '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67';
export const HP49_ROM = '3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab';
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
export function setupHash(preset) {
  return preset === 'hp48-home' ? HP48_ROM : preset === 'hp39-home' ? HP39_ROM : preset === 'hp49-home' ? HP49_ROM : null;
}
export function isPlayable(model, preset) {
  return (model === 4 && preset === 'hp48-home') || (model === 1 && preset === 'hp39-home') || (model === 5 && preset === 'hp49-home');
}
export function keyRows(model) {
  if (model !== 1 && model !== 2 && model !== 3) return KEY_ROWS;
  const labels = new Map([[41,'SYMB'],[46,'PLOT'],[47,'NUM'],[48,'HOME'],[49,'APLET'],[50,'VIEWS'],
    [28,'VARS'],[21,'MATH'],[14,'d/dx'],[7,'X,T,θ'],[0,'DEL'],[29,'SIN'],[22,'COS'],[15,'TAN'],
    [8,'LN'],[1,'LOG'],[30,'x²'],[23,'xʸ'],[16,'('],[9,')'],[57,','],[58,'ALPHA'],[59,'SHIFT'],[13,'(−)']]);
  return KEY_ROWS.map(row => row.map(([label,scan]) => [labels.get(scan) ?? label,scan]));
}
export function applySetup(core, model, preset) {
  if (preset === 'strict') return;
  if (!isPlayable(model, preset)) throw new Error('This HOME research setup does not match the selected model.');
  const operations = preset === 'hp39-home' ? [
    ['keyboard_attach',1], ['nor_select',2], ['gpio_inputs',5,0x8e,0],
    ['adc_input',0,1,1023], ['lcd_probe68',1],
  ] : preset === 'hp49-home' ? [
    ['keyboard_attach',1], ['nor_select',1], ['sram_select',1],
    ['gpio_inputs',3,0xcc7f,0], ['gpio_inputs',4,0xc000,0xc000],
    ['gpio_inputs',5,0x8e,0], ['gpio_inputs',6,1,0],
    ['gpio_bias',6,0xf800,0xf800], ['adc_input',0,1,1023], ['adc_input',7,1,512], ['lcd_probe68',1],
  ] : [
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
    if (!KEYS.has(scan)) throw new Error('Unknown physical key');
    if (this.queue.length + (this.active !== null ? 1 : 0) >= 32) throw new Error('Key queue full; wait for the pending taps.');
    this.queue.push(scan);
  }
  pushMany(scans) {
    if (!Array.isArray(scans) || !scans.length || scans.length > 8 || scans.some(s => !KEYS.has(s))) throw new Error('Invalid key sequence');
    if (this.pending + scans.length > 32) throw new Error('Key queue full; wait for the pending taps.');
    this.queue.push(...scans);
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
