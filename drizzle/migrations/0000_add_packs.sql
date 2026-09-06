CREATE TABLE public.packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  sfw_count int NOT NULL DEFAULT 0,
  nsfw_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'building',
  zip_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packs TO authenticated;
GRANT ALL ON public.packs TO service_role;

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own packs select" ON public.packs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own packs insert" ON public.packs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own packs update" ON public.packs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own packs delete" ON public.packs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER packs_touch BEFORE UPDATE ON public.packs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS content_kind text NOT NULL DEFAULT 'nsfw',
  ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pack_id uuid REFERENCES public.packs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS images_pack_idx ON public.images (pack_id);