ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS decision_source text,
  ADD COLUMN IF NOT EXISTS generation_seed bigint,
  ADD COLUMN IF NOT EXISTS generation_prompt text,
  ADD COLUMN IF NOT EXISTS generation_negative_prompt text,
  ADD COLUMN IF NOT EXISTS pose_id text,
  ADD COLUMN IF NOT EXISTS background_id text,
  ADD COLUMN IF NOT EXISTS ai_decision text,
  ADD COLUMN IF NOT EXISTS ai_score real,
  ADD COLUMN IF NOT EXISTS ai_details jsonb;