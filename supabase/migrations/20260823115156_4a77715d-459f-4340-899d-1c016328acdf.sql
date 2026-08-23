CREATE TABLE IF NOT EXISTS public.publish_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tags text[] not null default '{}',
  description_template text not null default '',
  gallery_folder text not null default '',
  is_mature boolean not null default false,
  mature_level text not null default 'moderate',
  mature_classification text[] not null default '{}',
  is_ai_generated boolean not null default true,
  noai boolean not null default false,
  allow_comments boolean not null default true,
  allow_free_download boolean not null default false,
  add_watermark boolean not null default false,
  display_resolution integer not null default 0,
  license_cc boolean not null default false,
  license_commercial boolean not null default false,
  license_modify text not null default 'no',
  category_path text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_templates TO authenticated;
GRANT ALL ON public.publish_templates TO service_role;
ALTER TABLE public.publish_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own templates" ON public.publish_templates;
CREATE POLICY "own templates" ON public.publish_templates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_publish_templates()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_publish_templates ON public.publish_templates;
CREATE TRIGGER trg_touch_publish_templates BEFORE UPDATE ON public.publish_templates FOR EACH ROW EXECUTE FUNCTION public.touch_publish_templates();

ALTER TABLE public.images ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.publish_templates(id) ON DELETE SET NULL;