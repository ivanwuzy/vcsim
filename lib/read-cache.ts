// Bounded process-local cache. A cold/serverless instance still reads Postgres.
export function createReadCache<T>(ttlMs: number, maxEntries: number) {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();
  return {
    get(key: string, read: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached && cached.expires > Date.now()) return cached.value;
      const entry = { expires: Infinity, value: Promise.resolve().then(read) };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      entry.value.then(() => { entry.expires = Date.now() + ttlMs; }, () => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return entry.value;
    },
    clear() { entries.clear(); },
  };
}
