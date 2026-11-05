-- Long to Shorts, narrator help.
-- clip_sources.memory: what the long video is about and what each reviewed scene shows, written once by the clipper
-- function (DeepSeek reads the transcript and looks at the scene frames), then used to write narrator lines:
--   {summary, people: [..], made_at, scenes: {"<thumb path>": {start, end, sees, says}}}
-- clips.voice_state: the narrator voice-over being prepared by the "Narrator voice" GitHub job (working | ready | failed).
-- Each narrator scene then carries voice_path (object in the 'renders' bucket, clipvoice/...), voice_text, voice_name,
-- voice_duration and voice_words; the final render reuses that file when the text and voice haven't changed.
alter table public.clip_sources add column if not exists memory jsonb;
alter table public.clips
  add column if not exists voice_state text check (voice_state in ('working', 'ready', 'failed')),
  add column if not exists voice_error text;
