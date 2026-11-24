// Public APIs use rupees; the DB stores integer paisa. Convert only through these helpers.

export function toPaisa(rupees) {
  const n = Number(rupees);
  if (!Number.isFinite(n)) throw new RangeError(`Invalid amount: ${rupees}`);
  // toPrecision(15) strips binary noise so 1.005 * 100 = 100.49999999999999 still rounds to 101 paisa.
  return Math.round(Number((n * 100).toPrecision(15)));
}

export function fromPaisa(paisa) {
  return paisa / 100;
}

// Pakistani digit grouping via Intl 'en-IN': 150000 -> 'Rs 1,50,000'. No trailing '.00'.
export function formatRs(rupees) {
  const n = Number(rupees);
  const body = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(n));
  return n < 0 ? `Rs -${body}` : `Rs ${body}`;
}
