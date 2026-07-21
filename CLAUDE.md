# CLAUDE.md — spaceshied-catalog

㈜쵸미앤세븐 SPACE SHIELD **상품 카탈로그**(워치 스트랩 ~800개). **손님용 아님** — 관리자·직원·대표가
"이거 런칭했나? 22mm만 했나?"에 즉답하는 내부 확인 도구. UX 기준 = 구매전환 아니라 질문 즉답 속도.
정적 웹앱(`index.html`+`app.js`+`config.js`+`styles.css`, 관리자 `admin.html`), 바닐라 JS, 빌드 없음.
`main` push → GitHub Pages 자동 배포. 백엔드 = Supabase(`tnuzqrqxptxrfozzjjek`), 테이블 `products`·`categories`·`column_config`·`vocab_config`, Storage `product-images`.

## ⚠️ 먼저 알 것
- **정본은 Supabase.** repo의 `README.md`가 설명하는 "구글시트→build.sh→CSV" 파이프라인은 **폐기(레거시)**. `SUPABASE_SETUP.md`가 맞음. `build.sh`/`fetch.py`/`normalize.py`/`add.html` 은 안 씀.
- **repo SQL로는 DB를 완전 재현 못 함** — 대시보드로 손 추가한 컬럼 존재. 스키마는 앞으로 반드시 SQL로만 바꾸고 커밋.

## 이 repo 규칙 (어기면 인수인계가 깨짐)
- **DB 변경은 대시보드 클릭 말고 SQL 파일로** 만들고 커밋. (컬럼을 대시보드로 추가해온 게 이 앱의 최대 부채)
- **이미지는 Supabase Storage(`product-images`)로만.** GitHub Pages 경로(`heyjyu.github.io/...`)를 DB에 넣지 말 것 — 계정 이전 시 깨짐. 신규 업로드는 admin이 이미 Storage 사용 + `thumbs/` 썸네일 생성(그 방식 유지).
- **캐시버스팅 수동:** JS/CSS 고치면 `?v=118` 을 **4개 HTML(index/admin/map/pipeline) 전부** +1. 하나라도 빠뜨리면 버전 섞임.
- **CDN 고정 유지:** `@supabase/supabase-js@2.110.5`. `@2`로 되돌리지 말 것.
- **한글 NFC/NFD:** 엑셀·네이버발 한글은 NFD(자모분리)로 들어와 검색에 안 걸림. 비교·검색 로직엔 항상 `.normalize("NFC")`. 쓰는 쪽 정규화는 아직 미완이라 언제든 재발.
- **화면에 뿌리는 DB 텍스트는 escape**(현재 `innerHTML` 직접 사용, 읽기 공개 → 저장형 XSS 위험).
- 죽은 파일: `add.html`(미배포). `store/d2/m2/m.html`은 삭제됨. 네이버 대조 파이프라인은 인수인계 범위 아님.

## 검증
`file://` 금지(CORS). `python3 -m http.server 8000`. 로컬도 운영 DB에 붙음 — admin 로그인 후 저장하면 운영 데이터 바뀜, 주의.

## 상세·전체 맥락
private repo `heyjyu/spaceshied-handoff` → `apps/catalog.md`(가장 상세), `README.md`, `DEV_IN_CLAUDE.md`. 접근은 오너에게 요청.
