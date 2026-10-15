import { afterEach, expect, it, vi } from "vitest";
import { createReadCache } from "../lib/read-cache";

afterEach(() => vi.useRealTimers());
it("coalesces concurrent readers, expires after completion and bounds memory", async () => {
  vi.useFakeTimers();
  const cache = createReadCache<number>(2000, 2), read = vi.fn(async () => 1);
  expect(await Promise.all(Array.from({ length: 100 }, () => cache.get("a", read)))).toEqual(Array(100).fill(1));
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2001); await cache.get("a", read);
  expect(read).toHaveBeenCalledTimes(2);
  await cache.get("b", read); await cache.get("c", read); await cache.get("a", read);
  expect(read).toHaveBeenCalledTimes(5);
});
it("does not retain database errors or repopulate entries invalidated during a write", async () => {
  const cache = createReadCache<number>(2000, 2);
  await expect(cache.get("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  expect(await cache.get("a", async () => 2)).toBe(2);
  cache.clear();
  let resolve!: (value: number) => void;
  const pending = cache.get("a", () => new Promise<number>(done => { resolve = done; }));
  await Promise.resolve(); cache.clear(); resolve(3); await pending;
  expect(await cache.get("a", async () => 4)).toBe(4);
});
