-- ===================================================================
--  마이그레이션: "베이스 + 커넥터" 구조를 DB에 녹이기
--  Supabase 대시보드 ▸ SQL Editor 에 통째로 붙여넣고 RUN (한 번만, 재실행해도 안전)
--
--  [왜?] 대표님 설명대로 우리 스트랩은
--    "규격(20·22mm)으로 만든 베이스 스트랩 1종" + "머리쪽 러그 커넥터"
--    → 갤럭시 워치/울트라/샤오미/보이스캐디 … 여러 워치 제품으로 확장된다.
--  그런데 지금 데이터는 평평해서 "같은 스트랩이 어디로 확장됐는지 / 어디가 비었는지"가
--  안 보인다. 아래 4개 컬럼이 그 관계를 DB에 기록한다.
--
--  ※ 기존 컬럼(name/model/size…)은 그대로 둔다. 새 컬럼만 추가/채움 → 되돌리기 쉬움.
-- ===================================================================

-- 0) 새 컬럼 4개 추가 (이미 있으면 건너뜀) ----------------------------
alter table public.products
  add column if not exists base_size   text default '',   -- 베이스 규격: 20mm/22mm (커넥터 떼면 남는 표준 폭)
  add column if not exists strap_shape text default '',   -- 형태: 날개형(아치) / 일반형(일자). 자동은 '날개형'만, 나머지는 수기
  add column if not exists connector   text default '',   -- 머리쪽 커넥터 = 호환 대상(공용/갤럭시 워치/울트라/샤오미/보이스캐디 …)
  add column if not exists base_family text default '';    -- 같은 베이스 스트랩끼리 묶는 그룹키(=제품명에서 괄호·mm 뺀 디자인명)

-- 1) base_family = 디자인명 정규화 (괄호·"NNmm"·중복공백 제거) ---------
--    같은 base_family 끼리 = "같은 스트랩, 커넥터만 다른" 형제들.
update public.products set base_family =
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(name,''), '\(.*?\)', '', 'g'),  -- (괄호 내용) 제거
      '\d+\s*mm', '', 'g'),                                      -- 20mm/22mm 등 제거
    '\s+', ' ', 'g')                                             -- 공백 정리
  );

-- 2) base_size = size/이름/기종에서 표준 스트랩 폭만 추출 (47mm 같은 케이스 치수는 제외) --
update public.products
  set base_size = (regexp_match(concat_ws(' ', size, name, model), '(14|18|20|22|24)\s*mm'))[1] || 'mm'
  where concat_ws(' ', size, name, model) ~ '(14|18|20|22|24)\s*mm';

-- 3) connector = 기종(model)을 호환 커넥터 이름으로 정규화 ---------------
update public.products set connector = case
  when model like '공용%'         then '공용(범용)'
  when model like '갤럭시 워치8%'  then '갤럭시 워치(러그)'
  when model like '갤럭시 울트라%' then '갤럭시 워치 울트라'
  when model like '갤럭시 날개형%' then '갤럭시 워치(날개)'
  when model like '갤럭시 원클릭%' then '갤럭시 워치(원클릭)'
  when model like '갤럭시 핏3%'    then '갤럭시 핏3'
  when model like '미밴드%'        then '샤오미 미밴드'
  when model like '애플%'          then '애플워치'
  when model like '화웨이%'        then '화웨이 워치핏'
  when model like '보이스캐디%'    then '보이스캐디'
  when model like '티렉스%'        then '아미즈핏 티렉스'
  when model like '프레스티지%'    then '프레스티지(프리미엄)'
  else model
end;

-- 4) strap_shape = 자동은 '날개형'만 (제품명/기종에 '날개') ---------------
--    일반형(일자) 등 나머지는 비워둔다 → 관리자에서 수기로 채워 큐레이션.
update public.products set strap_shape = '날개형'
  where name like '%날개%' or model like '%날개%';

-- 5) 보이스캐디 보정 (대표님 메모): 최근 4~5년 보이스캐디는 22mm 호환 → 22mm 일반형 계열 --
--    별도 기종으로 두되, 베이스는 22mm 로 명시. (전부 size=22mm 라 위 2)에서 이미 채워짐 — 안전망)
update public.products set base_size = '22mm'
  where model like '보이스캐디%' and (base_size is null or base_size = '');

-- ===================================================================
--  확인용 쿼리 (RUN 후 따로 돌려보면 좋음):
--
--  -- 같은 베이스가 여러 커넥터로 확장된 "형제" 보기 + 확장 개수
--  select base_family,
--         count(distinct connector) as 호환수,
--         string_agg(distinct connector, ' / ' order by connector) as 호환목록
--  from public.products
--  where base_family <> ''
--  group by base_family
--  having count(distinct connector) >= 2
--  order by 호환수 desc;
--
--  -- (이후) 어떤 베이스가 특정 커넥터로 "아직 확장 안 됐는지"(=공백) 찾는 쿼리도 가능
-- ===================================================================
