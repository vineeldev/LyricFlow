-- Lyric Capital Group — Firm Priorities dashboard
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

-- ============ tables ============
create table if not exists public.tasks (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.meta (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  person text
);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
drop trigger if exists meta_touch on public.meta;
create trigger meta_touch before update on public.meta for each row execute function public.touch_updated_at();

-- ============ row-level security ============
-- Only signed-in users can read or write anything. Sign-ups are created by
-- you in the Supabase console, so "authenticated" = your approved people.
alter table public.tasks enable row level security;
alter table public.meta enable row level security;
alter table public.profiles enable row level security;

drop policy if exists tasks_rw on public.tasks;
create policy tasks_rw on public.tasks for all to authenticated using (true) with check (true);
drop policy if exists meta_rw on public.meta;
create policy meta_rw on public.meta for all to authenticated using (true) with check (true);
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ live sync ============
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.meta;

-- ============ seed: your current board (exported 2026-09-23) ============
insert into public.tasks (id, data) values ('m3', $json${"dueDate":null,"followUp":[],"gid":"m3","group":"Deals","horizon":"nextweek","lead":"Vinny","name":"Imagine Dragons","order":3,"subtasks":[{"assignee":"Vinny","done":false,"dueDate":"2026-09-29","gid":"s7","horizon":"nextweek","name":"Intro call with manager"},{"assignee":"Vinny","done":false,"dueDate":"2026-10-02","gid":"s8","horizon":"nextweek","name":"Sketch catalog perimeter"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.tasks (id, data) values ('m4', $json${"dueDate":"2026-09-30","followUp":["Vinny"],"gid":"m4","group":"Operations","horizon":"week","lead":"Paul","name":"Q3 quarterly close","order":4,"subtasks":[{"assignee":"Paul","done":false,"dueDate":"2026-09-21","gid":"s9","horizon":"today","name":"Collect fund expense accruals"},{"assignee":"Paul","done":true,"dueDate":"2026-09-24","gid":"s10","horizon":"week","name":"Reconcile Ramp transactions"},{"assignee":"Ross","done":false,"dueDate":"2026-09-28","gid":"s11","horizon":"week","name":"Partner review of close package"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.tasks (id, data) values ('m5', $json${"dueDate":"2027-01-15","followUp":[],"gid":"m5","group":"Operations","horizon":"long","lead":"Ross","name":"Annual LP meeting prep","order":5,"subtasks":[{"assignee":"Tatiana","done":false,"dueDate":"2026-10-15","gid":"s12","horizon":"month","name":"Hold date with venue"},{"assignee":"Ross","done":false,"dueDate":"2026-11-20","gid":"s13","horizon":"long","name":"Outline portfolio review deck"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.tasks (id, data) values ('tmud319uf4jeql', $json${"dueDate":"2026-10-22","followUp":[],"gid":"tmud319uf4jeql","group":"Deals","horizon":"month","lead":"Thomas","name":"Martin Garrix","order":6,"subtasks":[{"assignee":"Thomas","done":false,"dueDate":"2026-09-25","gid":"tmud31wnvw4kr3","horizon":"week","name":"Follow up with Martin's dad on outstanding statements"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.tasks (id, data) values ('tmud339pp0ract', $json${"dueDate":"2026-12-20","followUp":[],"gid":"tmud339pp0ract","group":"Deals","horizon":"nextmonth","lead":"Abe","name":"LMN","order":7,"subtasks":[{"assignee":"Vinny","done":false,"dueDate":"2026-09-22","gid":"tmud33sqpmeswe","horizon":"week","name":"Follow up with Alan on EY Diligence list"},{"assignee":"Abe","done":false,"dueDate":"2026-09-25","gid":"tmud34g0e4s5kx","horizon":"week","name":"Send Vic model and slides to kick off debt workstream"},{"assignee":"Ross","done":false,"dueDate":"2026-09-22","gid":"tmud6u67ryjgdq","horizon":"today","name":"Review sals responses to model questions list"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.tasks (id, data) values ('tmud7mtuivuu6b', $json${"dueDate":"2026-09-30","followUp":[],"gid":"tmud7mtuivuu6b","group":"Deals","horizon":"month","lead":"Rich","name":"Dominance MMA","order":8,"subtasks":[{"assignee":"Ross","done":false,"dueDate":"2026-09-25","gid":"tmud7nchq5cg6o","horizon":"week","name":"Ross to follow up with Menacham on firm who can do the work"}]}$json$::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.meta (key, data) values ('team', $json${"people":["Abe","Paul","Rich","Ross","Tatiana","Vinny"],"emails":{"Rich":"rgarzia@lyriccapitalgroup.com","Ross":"rcameron@lyriccapitalgroup.com","Vinny":"vdevalapalli@lyriccapitalgroup.com"}}$json$::jsonb) on conflict (key) do update set data = excluded.data;
insert into public.meta (key, data) values ('ooo', $json${"entries":[{"from":"2026-09-21","note":"LA Trip","person":"Abe","to":"2026-09-22"},{"from":"2026-09-21","note":"Fishing Trip","person":"Thomas","to":"2026-09-22"},{"from":"2026-09-24","note":"Wedding","person":"Vinny","to":"2026-09-25"},{"from":"2026-09-25","note":"Wedding","person":"Thomas","to":"2026-09-25"}]}$json$::jsonb) on conflict (key) do update set data = excluded.data;
insert into public.meta (key, data) values ('review', $json${"overrides":{}}$json$::jsonb) on conflict (key) do update set data = excluded.data;
insert into public.meta (key, data) values ('labels', $json${"labels":{"col_assigned":"Task Assignee","col_main":"Project","col_mainlead":"Main Project Lead","col_mainpriority":"Project Timeline","col_priority":"Task Timeline","mcol_due":"Project Due Date","mcol_lead":"Project Lead","mcol_name":"Project","mcol_priority":"Timeline","tab_summary":"Chief View"}}$json$::jsonb) on conflict (key) do update set data = excluded.data;
