"use client";
import { useEffect, useRef } from "react";
import { Crown, Medal, Trophy } from "lucide-react";
import { fundReturn, type PodiumRecord } from "../lib/leaderboard";

export type Celebration = PodiumRecord & { id: number; initial: number; preview?: boolean };
const palettes = [
  ["#ffdd74", "#ffefaf", "#d9a53c", "#fff7d5", "#b98222"],
  ["#e7efff", "#b5c6dc", "#ffffff", "#8599b5", "#cbd5e5"],
  ["#e6a575", "#ffd2af", "#b76b3d", "#f1be98", "#a85b32"],
];

export function MedalCelebration({ celebration, onComplete }: { celebration: Celebration; onComplete: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const duration = celebration.record ? 7200 : 5200;
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(onComplete, reducedMotion ? 3000 : duration);
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx || reducedMotion) return () => clearTimeout(timer);
    const colors = palettes[Math.min(2, celebration.player.rank - 1)];
    let width = innerWidth, height = innerHeight, frame = 0;
    function resize() {
      width = innerWidth; height = innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      element!.width = width * ratio; element!.height = height * ratio;
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    resize(); window.addEventListener("resize", resize);
    const count = celebration.record ? 540 : celebration.player.rank === 1 ? 360 : 260;
    const particles = Array.from({ length: count }, (_, i) => {
      const cannon = celebration.record && i % 3 === 0;
      const side = i % 2 === 0 ? -1 : 1;
      return {
        x: cannon ? (side === -1 ? .04 : .96) : Math.random(),
        y: cannon ? 1.05 : -.1 - Math.random() * .5,
        vx: cannon ? -side * (.1 + Math.random() * .17) : (Math.random() - .5) * .08,
        vy: cannon ? -.8 - Math.random() * .4 : .1 + Math.random() * .15,
        gravity: cannon ? .42 : .035,
        delay: Math.random() * (cannon ? 1.8 : 2.2),
        size: 4 + Math.random() * 8, phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - .5) * 7, color: colors[i % colors.length], ribbon: i % 4 === 0,
      };
    });
    const start = performance.now();
    function draw(now: number) {
      const elapsed = (now - start) / 1000;
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        const t = elapsed - p.delay;
        if (t < 0) continue;
        const x = (p.x + p.vx * t) * width + Math.sin(t * 3 + p.phase) * 25;
        const y = (p.y + p.vy * t + .5 * p.gravity * t * t) * height;
        if (y > height + 40) continue;
        ctx!.save(); ctx!.translate(x, y); ctx!.rotate(p.phase + t * p.spin);
        ctx!.globalAlpha = Math.min(1, Math.max(0, (duration / 1000 - elapsed) / .8));
        ctx!.fillStyle = p.color;
        ctx!.scale(Math.max(.15, Math.abs(Math.cos(t * 5 + p.phase))), 1);
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.ribbon ? p.size * 2.6 : p.size * .65);
        ctx!.restore();
      }
      if (now - start < duration) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, [celebration, duration, onComplete]);
  const score = fundReturn(celebration.player.profit, celebration.initial);
  const Icon = celebration.record ? Crown : celebration.player.rank === 1 ? Trophy : Medal;
  return <div className={`medal-celebration medal-${celebration.player.rank} ${celebration.record ? "record-celebration" : ""}`} style={{ animationDuration: `${duration}ms` }} role="status" data-testid="medal-celebration" data-rank={celebration.player.rank} data-record={celebration.record}>
    <div className="celebration-rays" aria-hidden="true" />
    <div className="celebration-message">
      <span className="celebration-kicker">{celebration.preview ? "动效预览 · 不计入榜单" : "A NIGHT · THE PARTNERS BOARD"}</span>
      <div className="celebration-emblem"><Icon size={82} strokeWidth={1.2} /></div>
      <h2>{celebration.record ? "新纪录诞生" : `新晋榜单第${celebration.player.rank}名`}</h2>
      <p className="celebration-name">{celebration.player.name}</p>
      <p className="celebration-institution">{celebration.player.institution}</p>
      <strong className="celebration-score">{score.amount}</strong>
      <span className="celebration-amount">MOIC {score.multiple}</span>
      <span className="celebration-caption">{celebration.record ? "此刻，全场见证你的眼光。" : "每一份远见，都值得掌声。"}</span>
    </div>
    <canvas ref={canvas} aria-hidden="true" />
  </div>;
}
