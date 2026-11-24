const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVEL_RANK[level] ?? LEVEL_RANK.info;

  const emit = (name, msg, obj) => {
    if (LEVEL_RANK[name] < threshold) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase()} ${msg}`;
    const sink = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    if (obj === undefined) sink(line);
    else sink(line, obj);
  };

  return {
    debug: (msg, obj) => emit('debug', msg, obj),
    info: (msg, obj) => emit('info', msg, obj),
    warn: (msg, obj) => emit('warn', msg, obj),
    error: (msg, obj) => emit('error', msg, obj),
  };
}
