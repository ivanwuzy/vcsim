"use client";

import { useEffect, useRef } from "react";

const colors = ["#e7efff", "#b5c6dc", "#ffffff", "#8599b5", "#3d79ff", "#7cd7ff"];
const duration = 6200;

// The podium's metallic confetti motion, scaled to the lottery stage.
export function LotteryCelebration() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let width = 0, height = 0, frame = 0;
    const resize = () => {
      width = element.clientWidth; height = element.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const particles = Array.from({ length: width < 600 ? 170 : 380 }, (_, i) => {
      const cannon = i % 3 !== 0, side = i % 2 === 0 ? -1 : 1;
      return {
        x: cannon ? (side === -1 ? .025 : .975) : Math.random(),
        y: cannon ? .98 : -.08 - Math.random() * .3,
        vx: cannon ? -side * (.13 + Math.random() * .19) : (Math.random() - .5) * .055,
        vy: cannon ? -.82 - Math.random() * .42 : .12 + Math.random() * .13,
        gravity: cannon ? .42 : .045,
        delay: i < 24 ? 0 : Math.random() * (cannon ? .65 : 1.6),
        size: 4 + Math.random() * 7, phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - .5) * 7, color: colors[i % colors.length], ribbon: i % 4 === 0,
      };
    });
    const start = performance.now();
    const draw = (now: number) => {
      const elapsed = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        const t = elapsed - p.delay;
        if (t < 0) continue;
        const x = (p.x + p.vx * t) * width + Math.sin(t * 3 + p.phase) * 22;
        const y = (p.y + p.vy * t + .5 * p.gravity * t * t) * height;
        if (y > height + 40) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.phase + t * p.spin);
        // Confetti crossing the name windows stays translucent for projection readability.
        const overNames = x > width * .12 && x < width * .86 && y > height * .35 && y < height * .73;
        ctx.globalAlpha = (overNames ? .35 : .9) * Math.min(1, Math.max(0, (duration / 1000 - elapsed) / 1.2));
        ctx.fillStyle = p.color;
        ctx.scale(Math.max(.15, Math.abs(Math.cos(t * 5 + p.phase))), 1);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.ribbon ? p.size * 2.8 : p.size * .65);
        ctx.restore();
      }
      if (now - start < duration) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvas} />;
}
