CREATE TABLE public.gen_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gen_styles TO authenticated;
GRANT ALL ON public.gen_styles TO service_role;

ALTER TABLE public.gen_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own gen styles" ON public.gen_styles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);