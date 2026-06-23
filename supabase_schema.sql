-- ===================================================================
--  스페이스쉴드 카탈로그 — Supabase 스키마
--  Supabase 대시보드 ▸ SQL Editor 에 통째로 붙여넣고 RUN
-- ===================================================================

-- 1) 상품 테이블 -----------------------------------------------------
create table if not exists public.products (
  id         bigint generated always as identity primary key,
  name       text not null,          -- 제품명
  model      text default '',        -- 기종(호환)
  material   text default '',        -- 재질
  size       text default '',        -- 스트랩 규격
  buckle     text default '',        -- 체결 형태
  color      text default '',        -- 색상(옵션 나열 가능)
  image      text default '',        -- 대표 이미지 URL
  store_url  text default '',        -- 네이버스토어 등 상품 링크
  sampling_date date,                -- 샘플링 날짜(월별 검색용)
  status     text default '진행',     -- 진행 / 단종
  sort       int  default 0,         -- 정렬 순서
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 수정 시 updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- 2) RLS: 누구나 읽기, 로그인한 사람만 추가/수정/삭제 ----------------
alter table public.products enable row level security;

drop policy if exists "public read"  on public.products;
drop policy if exists "auth write"   on public.products;

create policy "public read" on public.products
  for select using (true);

create policy "auth write" on public.products
  for all to authenticated
  using (true) with check (true);

-- 3) 이미지 저장용 Storage 버킷 (공개 읽기) --------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "img public read"  on storage.objects;
drop policy if exists "img auth write"   on storage.objects;

create policy "img public read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "img auth write" on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

-- 끝. 이제 SUPABASE_SETUP.md 의 3단계(데이터 import)로.
