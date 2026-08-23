CREATE TYPE public.image_status AS ENUM ('new','approved','rejected','upscaling','uploading','published','error');

CREATE TABLE public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  species text NOT NULL DEFAULT '',
  base_tags text[] NOT NULL DEFAULT '{}',
  title_template text NOT NULL DEFAULT '{character} #{n}',
  description_template text NOT NULL DEFAULT '',
  gallery_folder text NOT NULL DEFAULT '',
  is_mature boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.characters TO authenticated;
GRANT ALL ON public.characters TO service_role;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own characters" ON public.characters FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  filename text NOT NULL,
  local_path text NOT NULL,
  status public.image_status NOT NULL DEFAULT 'new',
  preview_path text,
  width int,
  height int,
  character_id uuid REFERENCES public.characters ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  deviation_url text,
  error text,
  seq int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, local_path)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.images TO authenticated;
GRANT ALL ON public.images TO service_role;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own images" ON public.images FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX images_user_status_idx ON public.images (user_id, status, created_at DESC);

CREATE TABLE public.agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Мой компьютер',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tokens TO authenticated;
GRANT ALL ON public.agent_tokens TO service_role;
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tokens" ON public.agent_tokens FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER images_touch BEFORE UPDATE ON public.images FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "previews read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'previews' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "previews write own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'previews' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "previews delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'previews' AND (storage.foldername(name))[1] = auth.uid()::text);