ALTER TABLE public.publish_templates
  ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_downloadable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS download_price integer NOT NULL DEFAULT 0;