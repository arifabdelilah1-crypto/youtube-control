-- Pinterest refuses some sites' links ("This site doesn't allow you to save Pins"): their pins go up with no link and no URL in the text.
alter table public.sites add column if not exists pin_no_link boolean not null default false;
update public.sites set pin_no_link = true where base_url = 'https://rezeptflow.blog';
