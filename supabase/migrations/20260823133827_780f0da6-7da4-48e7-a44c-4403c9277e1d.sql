ALTER TABLE public.publish_templates
  ALTER COLUMN exclusive_price TYPE numeric(10,2) USING exclusive_price::numeric,
  ALTER COLUMN exclusive_price SET DEFAULT 0;