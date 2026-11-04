-- The team's own list of music: tracks kept for a mood, and tracks that must never be used again.
create table if not exists public.music_library (
  track_id text primary key,
  status text not null check (status in ('saved', 'banned')),
  mood text,
  title text not null,
  author text,
  url text,
  duration integer,
  license text,
  license_url text,
  page text,
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.music_library enable row level security;
drop policy if exists app_users_all on public.music_library;
create policy app_users_all on public.music_library for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
