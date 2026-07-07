-- ============================================================
--  운영 관리(ops.html)용 컬럼 추가 — Supabase SQL Editor 에서 1회 실행
--  실행 전엔 ops.html 작업 지정이 브라우저(localStorage)에만 저장되고,
--  실행 후엔 DB(products)에 저장되어 팀이 함께 봅니다.
--  (RLS 는 기존 products 정책 그대로 적용 — 로그인만 쓰기 가능)
-- ============================================================

alter table public.products
  add column if not exists barcode      text,              -- 바코드
  add column if not exists supply_price integer,           -- 공급가(원). 여백률 = (판매가-공급가)/판매가
  add column if not exists ops_flags    text default '',   -- 작업 필요: 수정,보강,리뉴얼,결합,분리,가격변경,신고 (쉼표 구분)
  add column if not exists ops_note     text;              -- 운영 메모

-- 확인:
-- select id, name, barcode, supply_price, ops_flags, ops_note from public.products limit 5;
