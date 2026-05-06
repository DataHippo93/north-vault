-- Add is_active column to profiles for deactivation support
alter table northvault.profiles
  add column if not exists is_active boolean not null default true;

-- Create is_admin() function with SECURITY DEFINER to avoid RLS recursion
create or replace function northvault.is_admin()
returns boolean
language sql
stable
security definer
set search_path = northvault
as $$
  select exists (
    select 1 from northvault.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  )
$$;

-- Add faces_scanned column to assets if not already present
alter table northvault.assets
  add column if not exists faces_scanned boolean default false;

-- Index for efficient face scanning queries
create index if not exists assets_faces_scanned_idx
  on northvault.assets (faces_scanned)
  where faces_scanned is not true;
