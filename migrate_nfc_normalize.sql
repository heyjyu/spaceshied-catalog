-- 상품 텍스트 NFD(분해형 한글) → NFC(조합형) 정규화
-- 배경: 엑셀/네이버에서 넘어온 이름 25개가 분해형이라 "런 업" 같은 검색·정렬·값정리에서 어긋남.
--       앱 검색은 이미 NFC 비교로 우회했지만, DB 원본도 정리하면 정렬/중복탐지/일괄 값정리가 정확해짐.
-- 환경: Supabase(Postgres 15) → normalize(text, NFC) 기본 제공.
-- 대상: 현재 NFD인 컬럼 = name, base_family (각 25건, 동일한 행 id).
-- 안전성: WHERE로 실제 다른 행만 갱신(이미 NFC면 건드리지 않음). 표시 문자는 동일 — 내부 코드포인트만 통일.
-- Supabase → SQL Editor에 붙여넣고 실행.

-- 실행 전 미리보기(선택): 영향 행 확인
--   select id, name from products where name is not null and name <> normalize(name, NFC);

-- ① 제품명 정규화 (약 25건)
update products
set name = normalize(name, NFC)
where name is not null and name <> normalize(name, NFC);

-- ② 라인(base_family) 정규화 (약 25건)
update products
set base_family = normalize(base_family, NFC)
where base_family is not null and base_family <> normalize(base_family, NFC);

-- (선택) 다른 텍스트 컬럼도 예방적으로 통일하고 싶다면 — 지금은 NFD 없음(no-op).
--   나중에 새 데이터가 분해형으로 들어올 때 대비해 같은 패턴으로 확장 가능:
-- update products set model     = normalize(model, NFC)     where model     is not null and model     <> normalize(model, NFC);
-- update products set material  = normalize(material, NFC)  where material  is not null and material  <> normalize(material, NFC);
-- update products set alias     = normalize(alias, NFC)     where alias     is not null and alias     <> normalize(alias, NFC);
-- update products set memo      = normalize(memo, NFC)      where memo      is not null and memo      <> normalize(memo, NFC);
-- update products set color     = normalize(color, NFC)     where color     is not null and color     <> normalize(color, NFC);
-- update products set buckle    = normalize(buckle, NFC)    where buckle    is not null and buckle    <> normalize(buckle, NFC);
-- update products set kind      = normalize(kind, NFC)      where kind      is not null and kind      <> normalize(kind, NFC);

-- 실행 후 검증: 0이 나와야 정상
--   select count(*) from products where name <> normalize(name, NFC) or base_family <> normalize(base_family, NFC);
