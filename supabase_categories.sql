-- ===================================================================
--  사이드바 카테고리 순서/이름/노출 관리 테이블
--  Supabase SQL Editor 에 붙여넣고 RUN. (admin "카테고리 관리"에서 편집)
-- ===================================================================
create table if not exists public.categories (
  id        bigint generated always as identity primary key,
  key       text unique not null,   -- 제품 그룹 값(매칭 키): 예) "갤럭시 워치(러그)", "20mm 일반형"
  label     text default '',        -- 사이드바 표시 이름: 예) "갤럭시 워치 8"
  sort      int  default 0,         -- 표시 순서(작을수록 위)
  visible   boolean default true,   -- 사이드바 노출 여부
  updated_at timestamptz default now()
);

alter table public.categories enable row level security;
drop policy if exists "cat public read" on public.categories;
drop policy if exists "cat auth write"  on public.categories;
create policy "cat public read" on public.categories for select using (true);
create policy "cat auth write"  on public.categories for all to authenticated using (true) with check (true);

-- 끝. 이제 admin 우측 상단 "카테고리 관리"에서 드래그로 순서 바꾸고 이름/노출 편집 → 저장.
