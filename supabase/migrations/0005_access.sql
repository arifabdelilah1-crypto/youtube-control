-- Lets the dashboard tell an allow-listed account from a stranger right after sign-in.
create or replace function public.am_i_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_app_user(); $$;

revoke all on function public.am_i_allowed() from public, anon;
grant execute on function public.am_i_allowed() to authenticated;
