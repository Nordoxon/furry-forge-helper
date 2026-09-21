CREATE TABLE public.poses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  prompt text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.poses TO authenticated;
GRANT ALL ON public.poses TO service_role;
ALTER TABLE public.poses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own poses" ON public.poses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.backgrounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  prompt text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backgrounds TO authenticated;
GRANT ALL ON public.backgrounds TO service_role;
ALTER TABLE public.backgrounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own backgrounds" ON public.backgrounds FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS pose_id text,
  ADD COLUMN IF NOT EXISTS pose_text text,
  ADD COLUMN IF NOT EXISTS background_id text,
  ADD COLUMN IF NOT EXISTS background_text text;

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS pose_text text,
  ADD COLUMN IF NOT EXISTS background_text text;
