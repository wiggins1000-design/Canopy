let _flush = null

export function registerFlush(fn) { _flush = fn }
export function unregisterFlush() { _flush = null }
export async function callFlush() { if (_flush) await _flush() }
