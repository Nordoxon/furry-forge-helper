CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  mode text NOT NULL DEFAULT 'pack',
  next_exclusive_number integer NOT NULL DEFAULT 1,
  title_template text NOT NULL DEFAULT 'EXCLUSIVE ADOPT #{number} — {character}',
  default_tags text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.user_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  scene_name text NOT NULL DEFAULT '',
  scene_background text NOT NULL DEFAULT '',
  scene_composition text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  negative_prompt text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  variants integer NOT NULL DEFAULT 3,
  auto_upscale boolean NOT NULL DEFAULT true,
  upscale_factor integer NOT NULL DEFAULT 4,
  watermark boolean NOT NULL DEFAULT true,
  shrink_preview boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.series TO authenticated;
GRANT ALL ON public.series TO service_role;
ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own series" ON public.series FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER series_touch BEFORE UPDATE ON public.series FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.series_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  name text NOT NULL,
  character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting',
  requested_variants integer NOT NULL DEFAULT 0,
  selected_image_id uuid,
  exclusive_number integer,
  title text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  original_local_path text,
  censored_preview_path text,
  deviation_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.series_items TO authenticated;
GRANT ALL ON public.series_items TO service_role;
ALTER TABLE public.series_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own series items" ON public.series_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER series_items_touch BEFORE UPDATE ON public.series_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.images ADD COLUMN series_item_id uuid;
ALTER TABLE public.generation_jobs ADD COLUMN series_item_id uuid;
CREATE INDEX images_series_item_idx ON public.images(series_item_id);