ALTER TABLE public.series_items ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.packs ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';