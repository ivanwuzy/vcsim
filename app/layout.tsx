import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "A Night 2nd · 具身VC投资模拟器", description: "2026智元创新日 · 智元创投A计划，10月28日上海。为A Night打造的趣味投资小游戏：25次选择，最多投20家，凭直觉重仓未来，登榜赢取奖励。", icons: { icon: "/icon.svg" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, viewportFit: "cover", themeColor: "#f4f5f7" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
