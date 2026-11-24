// Fixed clock for deterministic tests. Default instant in the spec is 2026-11-24T05:00:00Z (10:00 PKT).
export function fixedClock(iso = '2026-11-24T05:00:00Z') {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set(value) {
      current = new Date(value);
    },
  };
}
