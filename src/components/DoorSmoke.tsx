import { useEffect, useRef } from "react";

type Wisp = {
  age: number;
  life: number;
  travel: number;
  spread: number;
  phase: number;
  size: number;
  opacity: number;
};

function createWisp(age = 0): Wisp {
  const life = 13 + Math.random() * 10;
  return {
    age: age * life,
    life,
    travel: 360 + Math.random() * 620,
    spread: 55 + Math.random() * 210,
    phase: Math.random() * Math.PI * 2,
    size: 0.65 + Math.random() * 0.65,
    opacity: 0.13 + Math.random() * 0.12,
  };
}

// Build soft, irregular wisps once; no video, image downloads or per-frame blur.
function createSmokeTexture(): HTMLCanvasElement {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 192;
  const context = texture.getContext("2d");
  if (!context) return texture;

  for (let index = 0; index < 32; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 46;
    const x = 96 + Math.cos(angle) * distance;
    const y = 96 + Math.sin(angle) * distance * 0.65;
    const radius = 18 + Math.random() * 35;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(189, 176, 155, 0.11)");
    gradient.addColorStop(0.45, "rgba(174, 164, 147, 0.065)");
    gradient.addColorStop(1, "rgba(174, 164, 147, 0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return texture;
}

export function DoorSmoke({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const texture = createSmokeTexture();
    let width = 0;
    let height = 0;
    let scale = 1;
    let doorX = 0;
    let doorY = 0;
    let wisps: Wisp[] = [];
    let frame = 0;
    let lastTime = 0;
    let disposed = false;

    function resize() {
      // Match threshold.webp's cover crop and CSS background-position exactly.
      width = document.documentElement.clientWidth;
      height = window.innerHeight;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas!.width = Math.round(width * pixelRatio);
      canvas!.height = Math.round(height * pixelRatio);
      context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      scale = Math.max(width / 1536, height / 1024);
      const positionX = width <= 760 ? 0.88 : 0.75;
      doorX = (width - 1536 * scale) * positionX + 1265 * scale;
      doorY = (height - 1024 * scale) * 0.5 + 700 * scale;
      const count = width <= 760 ? 40 : 64;
      wisps = Array.from({ length: count }, (_, index) =>
        createWisp(index / count),
      );
    }

    function draw(delta: number) {
      context!.clearRect(0, 0, width, height);
      for (let index = 0; index < wisps.length; index += 1) {
        let wisp = wisps[index];
        wisp.age += delta;
        if (wisp.age >= wisp.life) {
          wisp = createWisp();
          wisps[index] = wisp;
        }
        const progress = wisp.age / wisp.life;
        const outward = Math.pow(progress, 0.85);
        const curl = Math.sin(progress * Math.PI * 3 + wisp.phase);
        const x = doorX - wisp.travel * outward * scale;
        const y = doorY + (wisp.spread * outward + curl * 22 * progress) * scale;
        const radius = (38 + 230 * progress) * wisp.size * scale;
        const fadeIn = Math.min(progress / 0.14, 1);
        const fadeOut = Math.pow(1 - progress, 1.25);
        context!.globalAlpha = fadeIn * fadeOut * wisp.opacity;
        context!.save();
        context!.translate(x, y);
        context!.scale(1, 0.48 + Math.sin(wisp.phase) * 0.08);
        context!.rotate(curl * 0.12);
        context!.drawImage(texture, -radius, -radius, radius * 2, radius * 2);
        context!.restore();
      }
      context!.globalAlpha = 1;
    }

    function animate(time: number) {
      if (disposed) return;
      // 30fps cap. Reset the clock on resume, so hidden tabs never fast-forward.
      if (!lastTime) lastTime = time;
      const elapsed = time - lastTime;
      if (elapsed >= 1000 / 30) {
        draw(Math.min(elapsed / 1000, 0.08));
        lastTime = time - (elapsed % (1000 / 30));
      }
      frame = window.requestAnimationFrame(animate);
    }

    function syncMotion() {
      window.cancelAnimationFrame(frame);
      lastTime = 0;
      if (paused || reducedMotion.matches || document.hidden) {
        canvas!.dataset.motion = reducedMotion.matches ? "reduced" : "paused";
        if (paused || reducedMotion.matches) context!.clearRect(0, 0, width, height);
        return;
      }
      canvas!.dataset.motion = "running";
      draw(0);
      frame = window.requestAnimationFrame(animate);
    }

    function handleResize() {
      resize();
      syncMotion();
    }

    resize();
    syncMotion();
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", syncMotion);
    reducedMotion.addEventListener("change", syncMotion);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", syncMotion);
      reducedMotion.removeEventListener("change", syncMotion);
      context.clearRect(0, 0, width, height);
    };
  }, [paused]);

  return <canvas ref={canvasRef} className="door-smoke" aria-hidden="true" />;
}
