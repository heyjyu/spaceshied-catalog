-- ===================================================================
--  마이그레이션: 누락 컬럼 2개 추가 (color_count / sampling_date)
--  Supabase 대시보드 ▸ SQL Editor 에 붙여넣고 RUN (재실행 안전)
--
--  [왜?] 실제 products 테이블에 이 두 컬럼이 없어서(설정·스키마엔 있는데),
--    관리자(admin.html)에서 상품을 저장하면 "column does not exist" 로 실패한다.
--    추가하면: ① 관리자 저장 정상화 ② "🎨 색상 N종" 배지 ③ 샘플링 월별 검색 동작.
-- ===================================================================
alter table public.products
  add column if not exists color_count   int,    -- 색상 옵션 갯수 (예: 12)
  add column if not exists sampling_date date;    -- 샘플링 날짜 (월별 검색용)
