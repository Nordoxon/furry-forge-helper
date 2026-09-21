ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS failure_kind text;

CREATE INDEX IF NOT EXISTS generation_jobs_heartbeat_idx
  ON public.generation_jobs (user_id, status, heartbeat_at);