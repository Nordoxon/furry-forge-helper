CREATE TABLE public.prompt_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  sfw_prompt text NOT NULL DEFAULT '',
  nsfw_prompt text NOT NULL DEFAULT '',
  negative_prompt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_defaults TO authenticated;
GRANT ALL ON public.prompt_defaults TO service_role;

ALTER TABLE public.prompt_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prompt defaults" ON public.prompt_defaults
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER prompt_defaults_touch BEFORE UPDATE ON public.prompt_defaults
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.species_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  species text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, species)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.species_tags TO authenticated;
GRANT ALL ON public.species_tags TO service_role;

ALTER TABLE public.species_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own species tags" ON public.species_tags
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER species_tags_touch BEFORE UPDATE ON public.species_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();