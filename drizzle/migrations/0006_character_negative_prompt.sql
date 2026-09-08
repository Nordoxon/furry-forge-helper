ALTER TABLE public.characters ADD COLUMN negative_prompt text NOT NULL DEFAULT '';
GRANT SELECT, INSERT, UPDATE ON public.characters TO authenticated;
GRANT ALL ON public.characters TO service_role;