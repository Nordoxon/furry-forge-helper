CREATE TABLE public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  character_id uuid REFERENCES public.characters(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'sfw',
  prompt text NOT NULL DEFAULT '',
  negative_prompt text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'QUEUED',
  worker text,
  error text,
  image_id uuid,
  seed bigint,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_jobs TO authenticated;
GRANT ALL ON public.generation_jobs TO service_role;

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own generation jobs" ON public.generation_jobs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX generation_jobs_user_status_idx ON public.generation_jobs (user_id, status, created_at);

CREATE TRIGGER touch_generation_jobs
  BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.images ADD COLUMN generation_job_id uuid;

CREATE UNIQUE INDEX images_generation_job_id_key
  ON public.images (generation_job_id)
  WHERE generation_job_id IS NOT NULL;