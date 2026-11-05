-- Long to Shorts, narrator mode: a brief turns a picked Short into a mix of narrator lines (voice-over) and original clips.
-- Each scene in clips.scenes: {kind: original|narrator, start, end, crop, thumb, text?, under?, footage?}
--   original: the long video's own sound from start to end
--   narrator: `text` spoken by the voice; the picture starts at `start` and lasts as long as the voice; `under` = original sound under it (0-0.3)
--   footage:  null = the long video itself, else a stock clip or photo {type, url, preview, thumb, source, id, duration, author, license, page}
alter table public.clips
  add column if not exists brief text,
  add column if not exists voice text,
  add column if not exists voice_rate numeric not null default 1.0,
  add column if not exists narrator_lang text;
