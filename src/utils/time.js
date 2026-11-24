// Dates are local 'YYYY-MM-DD' strings in the business timezone. created_at values are UTC ISO strings.

export function todayLocal(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Pure UTC date arithmetic, so DST and host timezone never matter.
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

// period: today | yesterday | week (Mon..today) | month (1st..today)
export function periodRange(period, timezone, now = new Date()) {
  const today = todayLocal(timezone, now);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      const [y, m, d] = today.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      const sinceMonday = (dow + 6) % 7;
      return { from: addDays(today, -sinceMonday), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      throw new RangeError(`Unknown period: ${period}`);
  }
}

export function nowIso(now = new Date()) {
  return now.toISOString();
}
