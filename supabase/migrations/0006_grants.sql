-- is_app_user() is used inside RLS policies, so signed-in users need it; anonymous visitors don't.
revoke all on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated;
