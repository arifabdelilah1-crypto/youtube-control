-- Six frames of a drawn film (Story, Explainer, Mix) on one picture, made by render/autovideo.mjs after the final checks.
-- The path is in the private 'renders' bucket (contact/<run>.jpg); the Animation page shows it with a signed link.
alter table public.video_runs add column if not exists contact_sheet text;
