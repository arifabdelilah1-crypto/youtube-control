-- Free exploration: a hidden "Global" scope that isn't tied to any channel or niche.
-- Manual lookups land here when no channel is selected; scheduled jobs skip it.
alter table public.niches add column if not exists is_explore boolean not null default false;

insert into public.niches (name, slug, languages, markets, is_explore, daily_unit_budget)
values ('Global', 'explore', '{en,fr,de,es,ar,it,pt,nl}',
        '{GLOBAL,US,GB,CA,AU,IN,FR,BE,CH,DE,AT,ES,IT,NL,PT,BR,MX,MA,DZ,TN,EG,SA,AE}', true, 0)
on conflict (slug) do update set is_explore = true;
