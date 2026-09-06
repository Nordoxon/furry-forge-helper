ALTER TABLE public.packs ADD COLUMN IF NOT EXISTS character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL;
ALTER TABLE public.packs ADD COLUMN IF NOT EXISTS pack_number integer;
CREATE INDEX IF NOT EXISTS packs_character_id_idx ON public.packs(character_id);