ALTER TABLE public.publish_templates
  ADD COLUMN IF NOT EXISTS is_exclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusive_price integer NOT NULL DEFAULT 0;