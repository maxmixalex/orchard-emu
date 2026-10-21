// SPDX-License-Identifier: MIT
// Samsung S3C2410A User Manual, revision 1.0, sections 7-4, 7-8, 7-11 and 7-22.
// This is a conditional register decoder, not a clock or PLL state machine.
export const CLOCK_RATIO_SCOPE = 'Conditional ratios to the main input frequency Fin after source/divider settling. MPLL ratios additionally require that software has configured MPLL and that it has locked; register snapshots establish neither condition. No Fin value, reset/lock history, clock gating, CPU instruction rate or elapsed time is inferred.';

function fraction(numerator, denominator) {
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

// Callers must establish the returned conditional_on prerequisites before
// treating these ratios as active clocks. Diagnostic snapshots may report the
// conditional result but must not claim that PLL lock was observed.
export function decodeClockRatiosIfSettled({ mpllcon, clkslow, clkdivn }) {
  for (const [name, value] of Object.entries({ mpllcon, clkslow, clkdivn }))
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new TypeError(`${name} must be an unsigned 32-bit register value`);

  const slow = Boolean(clkslow & 0x10), div = clkdivn & 7;
  const source = slow ? 'slow-input' : 'mpll';
  const conditional_on = ['source-and-dividers-settled'];
  if (!slow) conditional_on.push('mpll-configured-and-locked');
  const unavailable = reason => ({ status: 'unavailable', source,
    conditional_on, reason, ratios_to_fin: null });
  if (div > 4) return unavailable('reserved-clkdivn');
  if (!slow && (clkslow & 0x20)) return unavailable('mpll-off-outside-slow');

  const numerator = slow ? 1 : ((mpllcon >>> 12) & 255) + 8;
  const slowValue = clkslow & 7;
  const denominator = slow ? (slowValue ? 2 * slowValue : 1) :
    (((mpllcon >>> 4) & 63) + 2) * (2 ** (mpllcon & 3));
  const hdiv = div === 4 ? 4 : (div & 2 ? 2 : 1);
  const pdiv = div === 4 ? 4 : hdiv * (div & 1 ? 2 : 1);
  return { status: 'conditional', source, conditional_on, ratios_to_fin: {
    fclk: fraction(numerator, denominator),
    hclk: fraction(numerator, denominator * hdiv),
    pclk: fraction(numerator, denominator * pdiv),
  } };
}
