import { ArrowUpRight } from "lucide-react";
export function Brand({ small = false, href = "/" }: { small?: boolean; href?: string }) {
  return <a href={href} className={`brand ${small ? "brand-small" : ""}`} aria-label="A Night · 具身VC投资模拟器首页"><span className="brand-mark"><ArrowUpRight size={22} strokeWidth={2.5} /></span><span>A Night<small>智元创投 A 计划 · PLAYGROUND</small></span></a>;
}
