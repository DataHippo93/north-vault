create extension if not exists pgcrypto;

alter table if exists northvault.assets
  add column if not exists face_group text,
  add column if not exists face_label text,
  add column if not exists face_confidence numeric,
  add column if not exists people_indexed_at timestamptz;

create table if not exists northvault.face_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text,
  centroid jsonb not null default '[]'::jsonb,
  representative_asset_id uuid references northvault.assets(id) on delete set null,
  representative_face_index integer,
  representative_face_confidence numeric,
  face_count integer not null default 0,
  image_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists northvault.asset_faces (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references northvault.assets(id) on delete cascade,
  face_group_id uuid not null references northvault.face_groups(id) on delete cascade,
  face_index integer not null,
  bounding_box jsonb not null,
  embedding jsonb not null,
  confidence numeric not null,
  created_at timestamptz not null default now(),
  unique (asset_id, face_index)
);

create index if not exists face_groups_image_count_idx on northvault.face_groups (image_count desc, face_count desc);
create index if not exists face_groups_slug_idx on northvault.face_groups (slug);
create index if not exists asset_faces_asset_id_idx on northvault.asset_faces (asset_id);
create index if not exists asset_faces_group_id_idx on northvault.asset_faces (face_group_id);
create index if not exists assets_people_indexed_at_idx on northvault.assets (people_indexed_at);

alter table northvault.face_groups enable row level security;
alter table northvault.asset_faces enable row level security;

drop policy if exists "Authenticated users can read face groups" on northvault.face_groups;
drop policy if exists "Authenticated users can manage face groups" on northvault.face_groups;
drop policy if exists "Authenticated users can read face records" on northvault.asset_faces;
drop policy if exists "Authenticated users can manage face records" on northvault.asset_faces;

create policy "Authenticated users can read face groups" on northvault.face_groups
  for select
  to authenticated
  using (true);

create policy "Authenticated users can manage face groups" on northvault.face_groups
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can read face records" on northvault.asset_faces
  for select
  to authenticated
  using (true);

create policy "Authenticated users can manage face records" on northvault.asset_faces
  for all
  to authenticated
  using (true)
  with check (true);
