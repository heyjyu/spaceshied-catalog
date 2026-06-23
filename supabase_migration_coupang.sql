-- ===================================================================
--  마이그레이션: 쿠팡 연동 컬럼 추가 (재실행 안전)
--  Supabase ▸ SQL Editor 에 붙여넣고 RUN → 그다음 supabase_enrich_coupang.sql
-- ===================================================================
alter table public.products
  add column if not exists coupang_url    text default '',  -- 쿠팡 상품 페이지 링크
  add column if not exists coupang_id     text default '',  -- 쿠팡 상품ID
  add column if not exists coupang_stock  int,              -- 쿠팡 재고 합(옵션 전체) — 스냅샷
  add column if not exists coupang_opts   int,              -- 쿠팡 옵션(SKU) 수
  add column if not exists coupang_synced date;             -- 재고 스냅샷 기준일
