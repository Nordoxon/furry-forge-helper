import { useRef, useState } from "react";

/** Свайп влево/вправо по карточке. Возвращает обработчики и смещение для анимации. */
export function useSwipe(onLeft: () => void, onRight: () => void, threshold = 90) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  return {
    dx,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!start.current) return;
        const t = e.touches[0];
        const x = t.clientX - start.current.x;
        const y = t.clientY - start.current.y;
        if (Math.abs(x) > Math.abs(y)) setDx(x);
      },
      onTouchEnd: () => {
        const x = dx;
        start.current = null;
        setDx(0);
        if (x > threshold) onRight();
        else if (x < -threshold) onLeft();
      },
    },
    style: {
      transform: dx ? `translateX(${dx}px) rotate(${dx / 30}deg)` : undefined,
      transition: dx ? "none" : "transform 0.2s",
    } as React.CSSProperties,
  };
}
