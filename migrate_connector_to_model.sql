-- 호환 기종(connector) → 기종(model) 통합, 중복 컬럼 정리
-- 대표 요청(2026-07-08): 스펙 '기종'과 스트랩구성 '호환 기종'이 중복 → 기종으로 합치고 호환 기종은 비움
-- 사전 확인: strap_type(스트랩 구조)은 전 행 채워져 있어 구조 판정이 connector에 의존하지 않음 → 안전
-- Supabase SQL Editor에 붙여넣고 순서대로 실행.

-- 실행 전 미리보기: 영향 행 확인 (선택)
--   select id, name, model, connector, strap_type from products
--   where connector is not null and connector !~ '공용|공통|범용' order by id;

-- ① model이 비어 있고 connector에만 기종이 있는 행 → model로 이관 (약 1건: #811)
update products
set model = connector
where coalesce(trim(model), '') = ''
  and connector is not null
  and connector !~ '공용|공통|범용';

-- ② 기종 전용(기본형) 행의 중복 connector 비우기 (약 353건). '공용(범용)'(결합형)은 그대로 둠.
update products
set connector = null
where connector is not null
  and connector !~ '공용|공통|범용';

-- 실행 후 검증: 남은 connector 값은 공용(범용)뿐이어야 함
--   select connector, count(*) from products group by connector order by count(*) desc;
