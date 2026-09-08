ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS sfw_prompt text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nsfw_prompt text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prompt_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS generation_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS is_cover boolean NOT NULL DEFAULT false;

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS zip_url text;

DROP POLICY IF EXISTS "own pack files select" ON storage.objects;
CREATE POLICY "own pack files select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'packs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "own pack files insert" ON storage.objects;
CREATE POLICY "own pack files insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'packs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "own pack files update" ON storage.objects;
CREATE POLICY "own pack files update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'packs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'packs' AND (storage.foldername(name))[1] = auth.uid()::text);