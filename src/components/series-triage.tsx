import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSwipe } from "@/hooks/use-swipe";
import {
  chooseVariant,
  fetchItems,
  fetchSeriesList,
  fetchVariants,
  signed,
  updateItem,
} from "@/lib/series";

/** Отбор в режиме «Отдельные эксклюзивы»: свайп вправо — этот вариант лучший, влево — мимо. */
export function SeriesTriage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["series"], queryFn: fetchSeriesList, refetchInterval: 15000 });
  const series = (list.data ?? []).find((s) => s.status === "running") ?? list.data?.[0] ?? null;
  const items = useQuery({
    queryKey: ["series-items", series?.id],
    queryFn: () => fetchItems(series!.id),
    enabled: Boolean(series),
    refetchInterval: 8000,
  });
  const variants = useQuery({
    queryKey: ["series-variants", series?.id],
    queryFn: () => fetchVariants(series!.id),
    enabled: Boolean(series),
    refetchInterval: 8000,
  });
  const [viewId, setViewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // первый персонаж, которому ещё не выбран вариант и у которого есть кадры
  const item = useMemo(
    () =>
      (items.data ?? []).find(
        (i) =>
          ["waiting", "generating", "choosing"].includes(i.status) &&
          !i.selected_image_id &&
          (variants.data ?? []).some((v) => v.series_item_id === i.id),
      ) ?? null,
    [items.data, variants.data],
  );
  const mine = (variants.data ?? []).filter((v) => v.series_item_id === item?.id);
  const pending = mine.filter((v) => v.status === "new");
  const current = pending.find((v) => v.id === viewId) ?? pending[0] ?? null;

  const ready = (items.data ?? []).filter((i) => i.selected_image_id).length;
  const total = items.data?.length ?? 0;

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["series-items"] });
    void qc.invalidateQueries({ queryKey: ["series-variants"] });
  }

  async function pick() {
    if (!current || !item || !series || busy) return;
    setBusy(true);
    try {
      await chooseVariant(item, series, current.id);
      toast.success(`${item.name}: вариант выбран`);
      setViewId(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!current || busy) return;
    setBusy(true);
    try {
      await supabase
        .from("images")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), decision_source: "human" })
        .eq("id", current.id);
      setViewId(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function more() {
    if (!item) return;
    await updateItem(item.id, { requested_variants: item.requested_variants + 3, status: "waiting" });
    toast.success("Заказано ещё 3 варианта");
    refresh();
  }

  const swipe = useSwipe(() => void skip(), () => void pick());

  if (list.isLoading || items.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!series) {
    return (
      <Empty text="Серий пока нет.">
        <Button asChild size="sm"><Link to="/series">Создать серию</Link></Button>
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="truncate font-medium">{series.title || series.scene_name || "Серия"}</span>
          <span className="text-muted-foreground">выбрано {ready}/{total}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
        </div>
      </div>

      {!item ? (
        <Empty text={ready === total && total > 0 ? "Все персонажи серии выбраны." : "Ждём новые варианты с ПК…"}>
          <Button asChild size="sm" variant="outline"><Link to="/series">Открыть серию</Link></Button>
        </Empty>
      ) : (
        <>
          <p className="mb-2 text-sm">
            <span className="font-semibold">{item.name}</span>{" "}
            <span className="text-muted-foreground">
              · вариант {current ? mine.indexOf(current) + 1 : "—"} из {mine.length} · осталось {pending.length}
            </span>
          </p>

          {current ? (
            <div {...swipe.handlers} style={swipe.style} className="touch-pan-y select-none">
              <VariantImage path={current.preview_path} />
            </div>
          ) : (
            <Empty text="Все варианты отклонены.">
              <Button size="sm" onClick={() => void more()}>
                <RefreshCw className="mr-1 h-4 w-4" /> Ещё 3 варианта
              </Button>
            </Empty>
          )}

          {pending.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {pending.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setViewId(v.id)}
                  className={`h-16 w-14 shrink-0 overflow-hidden rounded-md border-2 ${v.id === current?.id ? "border-primary" : "border-transparent"}`}
                >
                  <VariantImage path={v.preview_path} thumb />
                </button>
              ))}
            </div>
          )}

          {current && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button size="lg" variant="outline" className="h-16 text-base" disabled={busy} onClick={() => void skip()}>
                  <X className="mr-2 h-5 w-5" /> Мимо
                </Button>
                <Button size="lg" className="h-16 text-base" disabled={busy} onClick={() => void pick()}>
                  <Check className="mr-2 h-5 w-5" /> Лучший
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Свайп ← мимо · → лучший</span>
                <button className="underline" onClick={() => void more()}>ещё 3 варианта</button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function VariantImage({ path, thumb }: { path: string | null; thumb?: boolean }) {
  const { data: url } = useQuery({ queryKey: ["signed", path], queryFn: () => signed(path), staleTime: 30 * 60 * 1000 });
  if (thumb) return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null;
  return (
    <div className="grid min-h-64 place-items-center overflow-hidden rounded-2xl border border-border/60 bg-card">
      {url ? (
        <img src={url} alt="Вариант" draggable={false} className="max-h-[65vh] w-full object-contain" />
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
