-- Per-scene visuals: on-screen title, which footage to search for, and an animated name/stat card.
-- Photo credits (Wikimedia author + licence) live inside project_scenes.clip, no column needed.

alter table public.project_scenes
  add column if not exists title text,                     -- big on-screen text for this scene (optional)
  add column if not exists footage text not null default 'video'
    check (footage in ('video', 'image', 'both')),         -- what "Find clips" searches for
  add column if not exists card jsonb;                     -- {name, stat, colors: ["#RRGGBB", "#RRGGBB"]}
