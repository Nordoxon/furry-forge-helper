import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Undo2 } from "lucide-react";
import { rectsToPreset, type CensorRect } from "@/lib/series-description";

type Tool = "blur" | "pixel" | "black";
type Rect = { x: number; y: number; w: number; h: number; tool: Tool };

/** Редактор цензуры превью: тянем пальцем прямоугольники размытия/пикселизации/заливки. */
export function CensorEditor({
  src,
  open,
  onOpenChange,
  watermark,
  onSave,
  onSaveTemplate,
}: {
  src: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  watermark: string;
  onSave: (blob: Blob) => Promise<void>;
  onSaveTemplate?: (preset: CensorRect[], style: "pixel" | "blur") => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLCanvasElement | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [tool, setTool] = useState<Tool>("blur");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [small, setSmall] = useState(false);

  useEffect(() => {
    if (!open || !src) return;
    setReady(false);
    setRects([]);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const k = 1; // без растягивания — берём кадр как есть
      const up = document.createElement("canvas");
      up.width = Math.round(img.naturalWidth * k);
      up.height = Math.round(img.naturalHeight * k);
      const uctx = up.getContext("2d")!;
      uctx.imageSmoothingQuality = "high";
      uctx.drawImage(img, 0, 0, up.width, up.height);
      imgRef.current = up;
      setSmall(Math.max(img.naturalWidth, img.naturalHeight) < 1216);
      setReady(true);
    };
    img.src = src;
  }, [open, src]);

  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !ready) return;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.filter = "none";
    ctx.drawImage(img, 0, 0);
    for (const r of [...rects, ...(draft ? [draft] : [])]) apply(ctx, img, r);
    if (watermark) {
      const size = Math.round(c.width / 22);
      ctx.font = `600 ${size}px sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = Math.max(2, size / 10);
      ctx.strokeText(watermark, c.width - size / 2, c.height - size / 2);
      ctx.fillText(watermark, c.width - size / 2, c.height - size / 2);
    }
  }, [rects, draft, ready, watermark]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height };
  };
  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Цензура превью</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {(["blur", "pixel", "black"] as Tool[]).map((t) => (
            <Button key={t} size="sm" variant={tool === t ? "default" : "outline"} onClick={() => setTool(t)}>
              {t === "blur" ? "Размытие" : t === "pixel" ? "Пиксели" : "Заливка"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setRects((r) => r.slice(0, -1))} disabled={!rects.length}>
            <Undo2 className="h-4 w-4" />
          </Button>
        </div>
        {!ready ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full touch-none rounded-md border border-border"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              start.current = pos(e);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = pos(e);
              setDraft(norm(start.current, p, tool));
            }}
            onPointerUp={(e) => {
              if (!start.current) return;
              const r = norm(start.current, pos(e), tool);
              start.current = null;
              setDraft(null);
              if (r.w > 4 && r.h > 4) setRects((x) => [...x, r]);
            }}
          />
        )}
        {small && (
          <p className="rounded-md border border-destructive p-2 text-xs text-destructive">
            Этот кадр пришёл с ПК уменьшенным. Значит, на ПК работает старый скрипт: скачайте его заново с сайта и перезапустите.
          </p>
        )}
        <p className="text-xs text-muted-foreground">Проведите пальцем, чтобы закрыть область.</p>
        {onSaveTemplate && (
          <div className="space-y-1">
            <Button
              variant="outline"
              className="w-full"
              disabled={!ready || !rects.length}
              onClick={() => {
                const c = canvasRef.current!;
                const style = rects.some((r) => r.tool === "blur") ? "blur" : "pixel";
                void onSaveTemplate(rectsToPreset(rects, c.width, c.height), style);
              }}
            >
              Сохранить как шаблон
            </Button>
            <p className="text-xs text-muted-foreground">Шаблон нужен для автоматической цензуры.</p>
          </div>
        )}
        <Button
          disabled={!ready || saving}
          onClick={() => {
            setSaving(true);
            canvasRef.current!.toBlob(
              async (b) => {
                try {
                  if (b) await onSave(b);
                  onOpenChange(false);
                } finally {
                  setSaving(false);
                }
              },
              "image/jpeg",
              0.9,
            );
          }}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить превью для DeviantArt
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function norm(a: { x: number; y: number }, b: { x: number; y: number }, tool: Tool): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), tool };
}

function apply(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, r: Rect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (r.tool === "black") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else if (r.tool === "blur") {
    ctx.filter = `blur(${Math.max(8, img.width / 40)}px)`;
    ctx.drawImage(img, 0, 0);
  } else {
    const s = Math.max(24, Math.round(img.width / 14));
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.ceil(r.w / s));
    tmp.height = Math.max(1, Math.ceil(r.h / s));
    tmp.getContext("2d")!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}
