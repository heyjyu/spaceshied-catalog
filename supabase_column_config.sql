-- ===================================================================
--  카탈로그 표(리스트) 보기 컬럼 순서/이름/노출 관리 테이블
--  Supabase SQL Editor 에 붙여넣고 RUN. (admin "표 컬럼"에서 편집)
-- ===================================================================
create table if not exists public.column_config (
  key        text primary key,       -- 컬럼(헤더) 이름: 예) "기종", "재질", "판매가"
  label      text default '',         -- 표 헤더 표시 이름(비우면 key 그대로)
  sort       int  default 0,          -- 표시 순서(작을수록 왼쪽)
  visible    boolean default true,    -- 표에 노출 여부
  updated_at timestamptz default now()
);

alter table public.column_config enable row level security;
drop policy if exists "col public read" on public.column_config;
drop policy if exists "col auth write"  on public.column_config;
create policy "col public read" on public.column_config for select using (true);
create policy "col auth write"  on public.column_config for all to authenticated using (true) with check (true);

-- 끝. 이제 admin 우측 상단 "📋 표 컬럼"에서 드래그로 순서·이름·노출 편집 → 저장.
