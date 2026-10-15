"use client";
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/leaderboard";

export function useLeaderboard(eventId?: string) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>, controller: AbortController;
    setData(null); setError(""); setUpdatedAt(null);
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(eventId ? `/api/admin/leaderboard?event=${encodeURIComponent(eventId)}` : "/api/leaderboard", { cache: "no-store", signal: controller.signal });
        if (eventId && response.status === 401) { if (live) window.location.assign("/admin"); return; }
        const board = await response.json();
        if (!response.ok) throw new Error(board.error || "暂时无法连接榜单");
        if (live) { setData(board); setError(""); setUpdatedAt(new Date()); }
      } catch (e) {
        if (live) setError((e as Error).name === "AbortError" ? "连接超时" : (e as Error).message);
      } finally {
        clearTimeout(timeout);
        if (live) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => { live = false; clearTimeout(timer); controller?.abort(); };
  }, [eventId]);
  return { data, error, updatedAt };
}
