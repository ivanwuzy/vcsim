import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pollVisible } from "../lib/poll";
let page: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers(); page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("pauses hidden pages, refreshes on return and stops on unmount", async () => {
  const task = vi.fn(async () => {}), stop = pollVisible(task, 5000);
  await vi.advanceTimersByTimeAsync(0); expect(task).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000); expect(task).toHaveBeenCalledTimes(1);
  page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0); expect(task).toHaveBeenCalledTimes(2);
  stop(); await vi.advanceTimersByTimeAsync(60000); expect(task).toHaveBeenCalledTimes(2);
});
it("avoids overlapping requests and backs off after errors", async () => {
  const task = vi.fn().mockRejectedValue(new Error("quota exceeded")), stop = pollVisible(task, 5000);
  await vi.advanceTimersByTimeAsync(0); expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9999); expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledTimes(2);
  task.mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(20000); expect(task).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(5000); expect(task).toHaveBeenCalledTimes(4);
  stop();
  let resolve!: () => void;
  const slow = vi.fn(() => new Promise<void>(done => { resolve = done; })), end = pollVisible(slow, 5000);
  await vi.advanceTimersByTimeAsync(60000); expect(slow).toHaveBeenCalledTimes(1);
  resolve(); await vi.advanceTimersByTimeAsync(5000); expect(slow).toHaveBeenCalledTimes(2); end();
});
