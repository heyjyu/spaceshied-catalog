-- ============================================================
--  RLS: 비로그인(anon) 쓰기 전면 차단 / 로그인(authenticated)만 쓰기
--  읽기(SELECT)는 공개 유지 — 카탈로그가 publishable(anon) 키로 조회하기 때문.
--  Supabase → SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- ---------- products (상품) ----------
alter table public.products enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='products' loop
    execute format('drop policy %I on public.products', p.policyname);
  end loop; end $$;
create policy products_read  on public.products for select using (true);
create policy products_write on public.products for all to authenticated
  using (true) with check (true);

-- ---------- categories (사이드바 카테고리) ----------
alter table public.categories enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='categories' loop
    execute format('drop policy %I on public.categories', p.policyname);
  end loop; end $$;
create policy categories_read  on public.categories for select using (true);
create policy categories_write on public.categories for all to authenticated
  using (true) with check (true);

-- ---------- column_config (표 컬럼 설정) ----------
alter table public.column_config enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='column_config' loop
    execute format('drop policy %I on public.column_config', p.policyname);
  end loop; end $$;
create policy column_config_read  on public.column_config for select using (true);
create policy column_config_write on public.column_config for all to authenticated
  using (true) with check (true);

-- ---------- storage: product-images 버킷 ----------
--  읽기 공개(이미지 표시), 업로드·수정·삭제는 로그인만.
--  (이 버킷용 정책만 지웠다 다시 만들어 다른 버킷 정책은 건드리지 않음)
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname like 'productimg_%' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop; end $$;
create policy productimg_read  on storage.objects for select
  using (bucket_id = 'product-images');
create policy productimg_write on storage.objects for all to authenticated
  using (bucket_id = 'product-images') with check (bucket_id = 'product-images');

-- 확인용: 정책 목록
-- select schemaname, tablename, policyname, roles, cmd from pg_policies
--   where tablename in ('products','categories','column_config','objects') order by tablename, cmd;
