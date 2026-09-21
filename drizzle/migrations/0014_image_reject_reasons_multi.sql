ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS reject_reasons text[],
  ADD COLUMN IF NOT EXISTS reject_note text;