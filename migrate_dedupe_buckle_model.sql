-- 고정타입(buckle)·기종(model) 중복 용어 통합 (대표 요청 2026-07-08)
-- 원칙: "~형"과 짧은 용어가 겹치던 것을 더 간단한 용어로 통합. VOCAB(config.js)도 동일하게 정리됨.
-- Supabase → SQL Editor에서 실행.

-- 미리보기(선택): 영향 건수
--   select buckle, count(*) from products where buckle in ('버클형','버튼형','벨크로형','마그네틱형') group by buckle;
--   select model,  count(*) from products where model  in ('갤럭시 울트라','갤럭시 울트라 47mm') group by model;

-- ① 고정타입: ~형 → 간단 용어 통합
update products set buckle = '버클'     where buckle = '버클형';      -- 236건 → 버클(62)과 합쳐짐
update products set buckle = '버튼'     where buckle = '버튼형';      -- 21건 → 버튼(16)
update products set buckle = '밸크로'   where buckle = '벨크로형';    -- 2건 → 밸크로(46)
update products set buckle = '마그네틱' where buckle = '마그네틱형';  -- 19건 → 마그네틱(145)

-- ② 기종: '워치' 누락 표기 → 표준(갤럭시 워치 울트라)
update products set model = '갤럭시 워치 울트라' where model in ('갤럭시 울트라', '갤럭시 울트라 47mm');  -- 12건

-- ③ 고정타입 나머지 '~형' 제거 (대표 요청 2026-07-08). ①②를 이미 실행했어도 재실행 무해(no-op).
update products set buckle = '일체'       where buckle = '일체형';        -- 12건
update products set buckle = '버터플라이' where buckle = '버터플라이형';  -- 5건
update products set buckle = '디버클'     where buckle = '디버클형';      -- 2건
update products set buckle = '후크'       where buckle = '후크형';        -- 3건 (일관성)

-- 검증: 아래가 모두 0이어야 정상
--   select count(*) from products where buckle in ('버클형','버튼형','벨크로형','마그네틱형','일체형','버터플라이형','디버클형','후크형')
--     or model in ('갤럭시 울트라','갤럭시 울트라 47mm');
