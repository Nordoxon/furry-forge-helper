import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход — Furry Content Manager" },
      {
        name: "description",
        content: "Войдите, чтобы отбирать сгенерированные изображения с телефона и отправлять их на публикацию.",
      },
      { property: "og:title", content: "Вход — Furry Content Manager" },
      {
        property: "og:description",
        content: "Личный кабинет удалённого отбора изображений и автопубликации на DeviantArt.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fn =
      mode === "in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) navigate({ to: "/" });
    else setMsg("Проверьте почту и подтвердите адрес, затем войдите.");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <h1 className="font-display text-3xl font-semibold">Furry Content Manager</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Отбирайте изображения с телефона — компьютер сам апскейлит и выкладывает их.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Почта</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "in" ? "Войти" : "Создать аккаунт"}
        </Button>
      </form>

      <button
        onClick={() => setMode(mode === "in" ? "up" : "in")}
        className="mt-5 text-sm text-muted-foreground underline underline-offset-4"
      >
        {mode === "in" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
      </button>
    </div>
  );
}
