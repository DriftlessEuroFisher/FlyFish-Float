-- News, blog posts and announcements: the /news pages (worker/index.js),
-- the homepage's "News & updates" cards and pinned banner (js/home-news.js),
-- and the Posts editor on admin.html (js/admin.js).
-- Paste into Supabase: SQL Editor -> New query -> Run, AFTER auth.sql (it
-- uses public.is_admin()). Safe to run again: every statement replaces or
-- skips what an earlier run made.
--
-- Read supabase/README.md ("Step: news and blog") for the why.
--
-- Three kinds of post, one table:
--  * announcement: the owner's short notice. Pinned, it is the homepage
--    banner until show_until.
--  * blog: the owner's own article, with a page at /news/<slug>.
--  * news: a link to someone else's article with a one-line summary. With no
--    body it has no page of its own (no slug): the list links straight out.
--    With a body (the owner's notes on it) it gets a page like a blog post.
--
-- Who sees what: anyone, signed in or not, reads published posts whose
-- publish date has come. Admins read and write everything, drafts included.
-- Both rules are RLS below; the grants say which operations and columns
-- each role may attempt at all.


-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  kind         text not null constraint posts_kind_check
                 check (kind in ('announcement', 'blog', 'news')),
  -- The page's address, /news/<slug>: lowercase words joined by single
  -- hyphens. The Worker checks a requested slug against this same pattern
  -- before it asks the database anything.
  slug         text unique constraint posts_slug_check check (slug is null or (
                 slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80)),
  -- Stored trimmed, no control characters (a newline in a title would break
  -- the page head and the RSS feed). The editor trims; this makes sure.
  title        text not null constraint posts_title_check check (
                 char_length(title) between 1 and 140 and title = btrim(title)
                 and title !~ '[[:cntrl:]]'),
  -- One or two sentences: the card text, the meta description and the link
  -- preview's description. Null = none (the page falls back to the body's
  -- first words).
  summary      text constraint posts_summary_check check (summary is null or (
                 char_length(summary) between 1 and 300 and summary !~ '[[:cntrl:]]')),
  -- Markdown, the small subset js/postmd.js renders. Raw HTML in it is shown
  -- as text, never as markup. Null = no body.
  body         text constraint posts_body_check check (body is null or
                 char_length(body) between 1 and 50000),
  -- The outside article, https only. "Read the original at <source>".
  link_url     text constraint posts_link_url_check check (link_url is null or (
                 char_length(link_url) <= 2000 and link_url ~ '^https://[^[:space:]<>"]+$')),
  link_source  text constraint posts_link_source_check check (link_source is null or (
                 char_length(link_source) between 1 and 80 and link_source !~ '[[:cntrl:]]')),
  -- An object path in the post-images bucket ("2026/<uuid>.jpg"), not a URL:
  -- the pages build the public URL from the project they are configured for.
  cover_path   text constraint posts_cover_path_check check (cover_path is null or (
                 char_length(cover_path) <= 200 and cover_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
                 and cover_path !~ '\.\.')),
  cover_alt    text constraint posts_cover_alt_check check (cover_alt is null or (
                 char_length(cover_alt) between 1 and 300 and cover_alt !~ '[[:cntrl:]]')),
  status       text not null default 'draft' constraint posts_status_check
                 check (status in ('draft', 'published')),
  -- An announcement shown as the homepage banner, until show_until (null =
  -- until unpinned). Once show_until passes it is still listed on /news,
  -- just no longer a banner.
  pinned       boolean not null default false,
  show_until   timestamptz,
  -- When it goes public. A date in the future is a scheduled post: RLS keeps
  -- it hidden until then, with nothing to run at that time.
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),   -- set by the trigger below
  -- Who wrote it. Never shown publicly (no select grant on this column).
  -- `set null`: every table that references auth.users must say what happens
  -- on delete, or delete_my_account() fails. Deleting the account keeps the
  -- post and drops the author.
  author_id    uuid default auth.uid() references auth.users (id) on delete set null,

  -- Every post has a page, except a news link with no body of its own.
  constraint posts_page_check check (
    slug is not null or (kind = 'news' and link_url is not null and body is null)),
  -- News is a link to someone else's article.
  constraint posts_news_link_check check (kind <> 'news' or link_url is not null),
  -- Only announcements are banners.
  constraint posts_pinned_check check (not pinned or kind = 'announcement'),
  -- A published post has a date (the trigger fills it in if the editor didn't).
  constraint posts_published_check check (status = 'draft' or published_at is not null)
);

-- The public list and feed: published posts, newest first.
create index if not exists posts_published_idx
  on public.posts (published_at desc, id desc) where status = 'published';


-- ---------------------------------------------------------------------------
-- updated_at on every change, and a publish date when publishing without one.
-- Not security definer: it only touches the row being written. Trigger
-- functions are never callable as /rest/v1/rpc, but execute is revoked like
-- every other function here.
-- ---------------------------------------------------------------------------
create or replace function public.posts_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.posts_before_write() from public, anon, authenticated;

drop trigger if exists posts_before_write on public.posts;
create trigger posts_before_write
  before insert or update on public.posts
  for each row execute function public.posts_before_write();


-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;

-- Anyone: published posts whose date has come. This is the Worker's and the
-- homepage's only way in; they use the publishable key and no user token.
drop policy if exists "anyone reads published posts" on public.posts;
create policy "anyone reads published posts" on public.posts
  for select to anon, authenticated
  using (status = 'published' and published_at <= now());

-- Admins: everything, drafts and scheduled posts included. Policies for one
-- operation are OR'd, so an admin sees both sets.
drop policy if exists "admins read all posts" on public.posts;
create policy "admins read all posts" on public.posts
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins write posts" on public.posts;
create policy "admins write posts" on public.posts
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "admins edit posts" on public.posts;
create policy "admins edit posts" on public.posts
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "admins delete posts" on public.posts;
create policy "admins delete posts" on public.posts
  for delete to authenticated
  using ((select public.is_admin()));


-- ---------------------------------------------------------------------------
-- Grants. Revoke first: a column grant only restricts while there is no
-- table-wide grant, and a project whose defaults do grant would otherwise
-- keep select on author_id.
--  * select: every column but author_id, for anon and authenticated. RLS
--    decides which rows. Because one column is withheld, a request must name
--    its columns (?select=id,title,...): `select=*` is refused, and so is an
--    insert or update with return=representation that doesn't name them.
--  * insert, update: the editable columns only, so nobody can set id,
--    created_at, updated_at or author_id through the API. Granted to
--    authenticated; RLS lets only admins' rows through.
--  * delete: authenticated, admins only by RLS.
-- The identity column needs no sequence grant: an identity's sequence is
-- used on the table's behalf (reports and events insert the same way).
-- ---------------------------------------------------------------------------
revoke all on public.posts from anon, authenticated;
grant select (id, kind, slug, title, summary, body, link_url, link_source, cover_path, cover_alt,
              status, pinned, show_until, published_at, created_at, updated_at)
  on public.posts to anon, authenticated;
grant insert (kind, slug, title, summary, body, link_url, link_source, cover_path, cover_alt,
              status, pinned, show_until, published_at)
  on public.posts to authenticated;
grant update (kind, slug, title, summary, body, link_url, link_source, cover_path, cover_alt,
              status, pinned, show_until, published_at)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;


-- ---------------------------------------------------------------------------
-- Photos: the post-images Storage bucket.
-- Public: anyone can fetch a file by its public URL
-- (<project>/storage/v1/object/public/post-images/<path>), which is what lets
-- Google and link previews show a cover. That URL skips RLS entirely, so the
-- policies below govern uploading, replacing, deleting and listing only.
-- Draft photos are fetchable too if someone has the address; the editor
-- names every file with a random UUID, so an address can't be guessed.
-- 2 MB a file (the editor resizes to 1600 px JPEG, typically 200-600 KB) and
-- three image types. Re-running this file puts these settings back.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Admins only, and only in this bucket. Storage checks select as well as the
-- operation itself for deletes and replacements, hence a select policy (it
-- also lets an admin list the bucket; nobody else can).
drop policy if exists "post-images: admins read" on storage.objects;
create policy "post-images: admins read" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()));

drop policy if exists "post-images: admins upload" on storage.objects;
create policy "post-images: admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and (select public.is_admin()));

drop policy if exists "post-images: admins replace" on storage.objects;
create policy "post-images: admins replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()))
  with check (bucket_id = 'post-images' and (select public.is_admin()));

drop policy if exists "post-images: admins delete" on storage.objects;
create policy "post-images: admins delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()));

-- Checks, once it has run:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'post-images';
--   select policyname, cmd from pg_policies where tablename in ('posts', 'objects') order by 1;
