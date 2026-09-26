/* CloudHub POS — checkout tax math (mirrors posNormalizeLine server-side).
   Exclusive (default): tax is added on top. Inclusive: the rate already
   contains tax, so the tax portion is extracted and the total is unchanged.
   Keep these formulas byte-identical to functions/pos_backend/index.js. */

export type TaxMode = 'exclusive' | 'inclusive';

export interface TaxOpts {
  mode: TaxMode;
  round: boolean;
}

export const DEFAULT_TAX_OPTS: TaxOpts = { mode: 'exclusive', round: true };

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function clampPct(n: number): number {
  const v = Number(n) || 0;
  return Math.min(100, Math.max(0, v));
}

export interface TaxLineInput {
  qty: number;
  rate: number;
  taxPct: number;
  discVal?: number;
  discType?: 'percent' | 'flat';
}

export interface TaxLineResult {
  gross: number;
  disc: number;
  net: number;
  tax: number;
}

export function calcLine(input: TaxLineInput, opts: TaxOpts = DEFAULT_TAX_OPTS): TaxLineResult {
  const r2 = opts.round === false ? (n: number): number => Number(n) || 0 : round2;
  const qty = Math.max(0, Number(input.qty) || 0);
  const rate = Math.max(0, Number(input.rate) || 0);
  const taxPct = clampPct(input.taxPct);
  const discType = input.discType === 'flat' ? 'flat' : 'percent';
  const discVal = Math.max(0, Number(input.discVal) || 0);
  const gross = r2(qty * rate);
  const disc = discType === 'flat' ? Math.min(discVal, gross) : r2((gross * Math.min(discVal, 100)) / 100);
  const inclusiveNet = r2(gross - disc);
  if (opts.mode === 'inclusive') {
    const tax = r2(inclusiveNet - inclusiveNet / (1 + taxPct / 100));
    return { gross, disc, net: r2(inclusiveNet - tax), tax };
  }
  return { gross, disc, net: inclusiveNet, tax: r2((inclusiveNet * taxPct) / 100) };
}

export interface TaxTotals {
  sub: number;
  tax: number;
  orderDisc: number;
  total: number;
}

export function calcTotals(
  lines: Array<TaxLineInput>,
  orderPct: number,
  opts: TaxOpts = DEFAULT_TAX_OPTS,
): TaxTotals {
  const calc = lines.map((l) => calcLine(l, opts));
  const r2 = opts.round === false ? (n: number): number => Number(n) || 0 : round2;
  const sub = r2(calc.reduce((s, l) => s + l.net, 0));
  const tax = r2(calc.reduce((s, l) => s + l.tax, 0));
  const orderDisc = r2(((sub + tax) * clampPct(orderPct)) / 100);
  const total = opts.round === false ? sub + tax - orderDisc : r2(sub + tax - orderDisc);
  return { sub, tax, orderDisc, total };
}
