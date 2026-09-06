ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS sfw_target integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS nsfw_target integer NOT NULL DEFAULT 23,
  ADD COLUMN IF NOT EXISTS preview_target integer NOT NULL DEFAULT 4;