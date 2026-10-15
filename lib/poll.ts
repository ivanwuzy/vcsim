// One request at a time, pause hidden tabs, and slow down after outages.
export function pollVisible(task: () => Promise<void>, intervalMs: number, immediate = true) {
  let stopped = false, running = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => document.visibilityState === "hidden";
  async function tick() {
    if (stopped || running || hidden()) return;
    running = true;
    try { await task(); failures = 0; }
    catch { failures = Math.min(failures + 1, 5); }
    finally {
      running = false;
      if (!stopped && !hidden()) {
        timer = setTimeout(tick, Math.min(intervalMs * 2 ** failures, 60000));
      }
    }
  }
  function visibility() {
    clearTimeout(timer);
    if (!hidden()) void tick();
  }
  document.addEventListener("visibilitychange", visibility);
  if (immediate) void tick(); else timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
}
