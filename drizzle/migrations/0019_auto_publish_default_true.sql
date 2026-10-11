ALTER TABLE public.user_settings ALTER COLUMN auto_publish_exclusive SET DEFAULT true;
UPDATE public.user_settings SET auto_publish_exclusive = true WHERE auto_publish_exclusive = false;