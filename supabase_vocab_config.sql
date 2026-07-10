-- 속성값(어휘집) 관리 테이블 — 관리자 '🏷️ 속성값' 화면에서 편집
-- 4개 그룹: 기종 / 구조 / 커넥터 / 규격. 폼 드롭다운 + 카탈로그 필터 표준값에 반영.
-- 없어도 앱은 config.js 기본값으로 동작(seed). 이 테이블이 있으면 웹에서 편집·즉시 반영.
-- Supabase → SQL Editor에서 1회 실행.

create table if not exists public.vocab_config (
  key text primary key,          -- '기종' | '구조' | '커넥터' | '규격'
  values jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.vocab_config enable row level security;

-- 읽기: 공개(카탈로그·폼). 쓰기: 로그인(authenticated)만.
drop policy if exists vocab_read  on public.vocab_config;
drop policy if exists vocab_write on public.vocab_config;
create policy vocab_read  on public.vocab_config for select using (true);
create policy vocab_write on public.vocab_config for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- (선택) seed 없이도 첫 저장 때 기록됨. 미리 채우고 싶으면 관리자 화면에서 한 번 '저장'하면 현재 기본값이 그대로 들어갑니다.
