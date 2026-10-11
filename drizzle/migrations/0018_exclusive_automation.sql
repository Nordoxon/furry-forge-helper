ALTER TABLE public.user_settings
 ADD COLUMN IF NOT EXISTS exclusive_price numeric NOT NULL DEFAULT 15,
 ADD COLUMN IF NOT EXISTS exclusive_sale_type text NOT NULL DEFAULT 'fixed',
 ADD COLUMN IF NOT EXISTS exclusive_topic text NOT NULL DEFAULT 'Adoptable',
 ADD COLUMN IF NOT EXISTS gallery_folder text NOT NULL DEFAULT 'Exclusives',
 ADD COLUMN IF NOT EXISTS auto_publish_exclusive boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS listing_confirm boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS auto_censor boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS censor_preset jsonb,
 ADD COLUMN IF NOT EXISTS censor_style text NOT NULL DEFAULT 'pixel',
 ADD COLUMN IF NOT EXISTS mature_level text NOT NULL DEFAULT 'moderate',
 ADD COLUMN IF NOT EXISTS mature_classification text[] NOT NULL DEFAULT '{nudity,sexual}',
 ADD COLUMN IF NOT EXISTS allow_resales boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS early_access boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS description_template text NOT NULL DEFAULT '';
ALTER TABLE public.series_items
 ADD COLUMN IF NOT EXISTS preview_stash_item_id bigint,
 ADD COLUMN IF NOT EXISTS source_stash_item_id bigint,
 ADD COLUMN IF NOT EXISTS source_stash_url text,
 ADD COLUMN IF NOT EXISTS listing_status text NOT NULL DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS listing_error text,
 ADD COLUMN IF NOT EXISTS listing_started_at timestamptz;