# 스페이스쉴드 카탈로그 — 세션 핸드오프

> 갱신: 2026-07-08 (캐시 v118, 커밋 12c9564). 새 세션은 이 문서 먼저 읽고 이어서.
> 속도 원칙: 모든 화면은 `catalog_cache_v1`(localStorage SWR)로 먼저 그리고 네트워크는 백그라운드 갱신 — index(원조)·admin ?edit 즉시폼(v117)·map/pipeline(v118). 새 화면 만들 때도 이 패턴 따를 것.
> 거래/미팅 맥락은 자동메모 `client-meeting-handoff` 참고.

## 한 줄
워치스트랩 셀러 spaceshied 상품 카탈로그 웹앱. 한국어 소통, 상품 618개.
**⚠️ 용도(2026-07-08 확인): 손님용 아님 — 관리자·직원·대표의 내부 확인 도구.** 상품이 너무 많아 "이거 갤럭시 워치8 런칭했나?", "이거 22mm만 했나 20mm도 했나?" 같은 질문에 답하기 위한 것. UX 판단 시 구매 전환이 아니라 **질문 즉답 속도** 기준으로.

## 스택 / 실행 / 배포
- **빌드 없는 정적 웹앱**: `index.html`(카탈로그) + `app.js` + `config.js` + `styles.css`, `admin.html`(관리자). 부가: `map.html`, `pipeline.html`, `verify.html`.
- **실행/검증**: preview 도구 launch.json `catalog`(포트 8123). preview 웹뷰는 백그라운드라 scroll/rAF/IntersectionObserver/lazy-img가 정지됨 — 관련 검증은 수동 호출로.
- **배포**: `git@github.com:demian247/spaceshied-catalog.git` → GitHub Pages(main/root). 라이브 https://demian247.github.io/spaceshied-catalog/
- **작업 규칙**: 변경 → preview 검증 → 선택 커밋(`git add <파일>`) → push (자동, 묻지 않음).
- **캐시버스팅 ⚠️**: CSS/JS 바꾸면 4개 HTML 전부 `?v=` +1:
  `sed -i '' 's/?v=OLD/?v=NEW/g' index.html admin.html pipeline.html map.html` — **현재 v=92**
- Pages 빌드가 가끔 인프라 장애로 errored → `gh api -X POST repos/demian247/spaceshied-catalog/pages/builds`로 재빌드. `.nojekyll` 있음.

## 데이터 (Supabase)
- URL/anon키는 `config.js` SUPABASE. products **618개**. 관리는 admin.html(이메일 로그인)로만.
- **RLS 완비**: 읽기 공개, 쓰기는 authenticated만 (products·categories·column_config·storage `product-images`). `supabase_rls.sql` 참고. anon 쓰기는 400/403 — 나(Claude)는 DB/스토리지 쓰기 불가, **데이터 수정은 SQL을 만들어 사용자에게 실행 요청**하는 패턴.
- **products 주요 컬럼**(전부 사용 중): name, alias(별칭), kind(종류), model(기종), material, size(스트랩 너비), base_size(폼에서 제거됨·값 보존), buckle(고정 타입), connector(호환; 결합형이면 '공용(범용)'), strap_shape(형태=커넥터 타입: 일자형20mm·갤럭시 러그·퀵핏 등), strap_type(**스트랩 구조: 기본형/결합형**), base_family(라인: 베이직/유니크/스페셜), color, color_count, price(공식판매가), launch_year("YYYY-MM" text), status(판매/소싱/단종), image, color_chart(중국차트), color_chart_kr, extra_images(jsonb, 구 aerial_img 흡수), related_ids(jsonb, 비슷한제품 큐레이션), img_sig(text base64, 시각유사도 지문), memo(상세 '비고'로 노출!), store_url, coupang_url, flow_url, source_url, cost_cny, vendor, sort, sampling_date.
- `config.js`: COLUMN_MAP(영→한 헤더), FACETS(필터 정의), VOCAB(표준 어휘집: 기종 46종·재질·체결·너비·구조 등), HIDE_COLUMNS.

## 도메인 어휘 (통일 완료)
- **스트랩 구조**: 기본형(단순출고, 기종 전용) / 결합형(조합출고, 공용+커넥터). 구식 '기종별 일체형/커넥터 연결형'은 표시단에서 자동 매핑.
- **커넥터 타입**(strap_shape): 기본형=자유선택 20종(일자형 12~26mm, 갤럭시 원클릭/러그/울트라 러그, 미밴드 플래그십, 화웨이 이지핏/핏, 갤럭시 핏, XR, 퀵핏 20/22, 가민 전용 22/26, 티렉스 3) / 결합형="너비 to 커넥터" 16조합 → **너비 자동 고정** (admin openForm의 CONN_BASIC/CONN_COMBO).
- **스트랩 너비**(size): 표준 12/14/18/20/22/24/26mm만 필터 인정.
- 필터 = 기종/스트랩 구조/커넥터 타입/스트랩 너비/재질/고정 타입/색상/재고 (FACETS와 폼 어휘 1:1).

## 카탈로그(index) 핵심 구조
- **카드**: 기종 태그(특정=청록 ⌚모델명 / 공용=회색 ↔공용+mm, model 필드 기준) → 제품명 → 스펙 스트립(커넥터|구조|규격 3칸) → 🎨색상수·가격 → 바로가기 바 N/C/F/B(링크 없으면 흐림)+🎨(중국 컬러차트 이미지 클립보드 복사).
- **성능**: 갤러리 60개 청크 점진 렌더(IO+scroll 폴백, 이벤트 위임 — inline stopPropagation 넣으면 위임 죽음 주의), 데이터 3요청 병렬+localStorage SWR 캐시(catalog_cache_v1), 이미지는 `thumbs/` 400px 우선+onerror 원본 폴백(249장 생성 완료, 새 업로드 자동 생성).
- **상세**: 탭(기본정보/컬러옵션/비슷한제품). 이미지 갤러리(대표+중국/한국차트+추가N, 썸네일 클릭 스왑, 클릭=이미지 복사+호버 힌트). 스펙 표: 스트랩 구조/커넥터 타입/스트랩 너비/재질/고정 타입/비고(=memo). 제목 아래 가격+출시년월. 네이버/쿠팡 연한톤 버튼. 관리자 로그인 시 '✏️ 관리자 수정'(admin.html?edit=ID) — isAdminLoggedIn()은 sb-*-auth-token localStorage 파싱.
- **비슷한 제품**: ①큐레이션(related_ids, 관리자만 검색-추가/✕삭제, 카탈로그에서 관리자 토큰으로 직접 PATCH) ②자동 추천 getSimilar — 시각 지문(img_sig 8x8RGB, 최대+14) > 라인+6 > 재질+3 > 체결/규격+2 > 이름토큰(불용어 제외), 점수4 미만 컷, 자기자신 id 기준 배제, 큐레이션 라인조합 학습 가점(lineAffinity).

## 관리자(admin) 핵심 구조
- 상단: 검색(디바운스150ms)/📋표 컬럼/🏷️값 정리/💾백업(zip: products+categories+column_config JSON+CSV)/♻️복원/🔍유사도 분석/＋새 상품/카탈로그/로그아웃.
- 목록: 체크박스 일괄 삭제, thumbs+lazy 이미지, 수정·삭제 후 검색어 유지.
- 폼(섹션형): 이미지(업로드시 900px 리사이즈+400px 썸네일+img_sig 자동) / 기본(상태 pill 판매·소싱·단종, 마스터ID, 바로가기 칩, 제품명, 별칭, 라인, 색상수, 공식판매가, 출시년월 month) / 스펙(종류·기종·재질·고정타입, VOCAB datalist) / 스트랩 구성(①구조→②커넥터타입→③너비 연동) / 판매채널(N·C 링크) / 콘텐츠(Flow) / 소싱(1688·원가CNY·구매처) / 추가 이미지(중국차트·한국차트 1400px, 추가사진 멀티) / 색상 / 메모 / 샘플링날짜·정렬. 바깥클릭/ESC 시 dirty면 confirm. `?edit=ID`로 폼 자동 오픈.

## 진행 중 / 방금 상태
- **유사도 분석 완료·버튼 제거됨**(2026-07-08, v93). 실이미지 상품은 전부 `img_sig` 보유(빈 문자열 image 19개만 미대상). `analyzeSigs`/`sigBtn` 삭제, 폼 자동생성 `imageSig()`는 유지 — 새 업로드는 저장 시 지문 자동 기록.
- 재확인 필요 시: `products?select=id&image=neq.&img_sig=is.null` count가 0이면 완료.

## 다음 후보 (UX 개선안, 사용자에게 제안해 둠 — 미착수)
1. ~~상품 링크 공유~~ **완료(v95)**: openDetail→`#p{id}` push, closeDetail→해시 replaceState 제거, 공유링크 직접진입 시 base 깔고 자동오픈+뒤로가기=닫기. 라우팅 핵심=`routeFromHash()`/`_openId`(app.js). ⚠️ '🔗 링크 복사' 버튼은 사용자 요청으로 제거(주소창 URL로 공유·해시라우팅은 유지) — 다시 넣지 말 것.
2. ~~적용 중 필터 칩~~ **완료(v96)**: `#activeChips`(content 상단), `renderActiveChips()`(updateFilterCount에서 호출), `removeChip()`/`resetAllFilters()`(=`window._resetFilters`, 정렬·뷰는 유지). 칩 대상: 검색/카테고리/상태/즐겨찾기/facet/재고.
3. ~~검색 0건 안내~~ **완료(v96)**: `emptyStateHTML()` — 갤러리(renderGallery 0건 분기) + 표(Tabulator placeholder) 공용, 초기화 버튼은 inline onclick으로 `window._resetFilters` 사용(Tabulator가 문자열 HTML이라 위임 불가).
4. ~~가격 정렬~~ **완료(v96)**: priceAsc/priceDesc 옵션, `priceNum()`/`priceCmp()` — 가격 없는 상품은 양방향 모두 맨 뒤.
5. ~~첫 로딩 스켈레톤~~ **완료(v96)**: `showSkeleton()`이 초기 setStatus 대체(#status에 .skel-grid 8장, 에러 시엔 기존 setStatus 텍스트).
6. **UX 2차 완료(v97)**: ①필터 상태 URL 유지 `#f=q&cat&st&fav&stock&sort&{facet라벨}` — `filtersToHash`/`updateFilterHash`(replaceState, 히스토리 안 쌓음)/`restoreFiltersFromHash`(tableBuilt에서 setFilter 전 복원, 필터된 목록 공유 가능). 상세(#p)와 해시 분담: openDetail 시 #p 우선, closeDetail 시 #f 복원. ②상세 이전/다음 `detailNavList()`(갤러리=galleryRows, 표=getData active) + 탭바 ‹ n/N ›, ←/→ 키, 모바일 스와이프; 넘기기는 replaceState(뒤로가기 오염 방지), navIdx는 참조+__id 대조(Tabulator 사본 대비). ③맨위로 버튼(#btnScrollTop, scrollY>800). ④상세 열면 document.title=상품명. ⑤칩바에 "N개 표시 중". ⚠️ 라이트박스(이미지 확대)는 사용자가 명시적으로 제외함 — 이미지 클릭=복사 유지.
7. **속성값(어휘집) 관리 완료(v103, 9d53df6)**: 관리자 '🧩 속성값' 화면에서 4그룹(기종/구조/커넥터/규격) 드롭다운 선택지를 직접 편집(그룹별 textarea, 한 줄=값, 순서=표시순서). DB `vocab_config`(key text PK, values jsonb) — ⚠️ **`supabase_vocab_config.sql` 1회 실행 필요**(테이블 없으면 저장만 안 되고 앱은 config.js seed로 정상 동작). admin: `vocabCfg`/`loadVocab`(showAdmin에서 loadRows 전 로드)/`vocabOf(key)`(DB우선→VOCAB_DEFAULTS seed). openForm의 CONN_BASIC=vocabOf('커넥터'), SIZES=vocabOf('규격'), 구조 옵션·기종 datalist도 vocabOf. app.js는 `mergeVocab`로 DB어휘집→CONFIG.VOCAB 병합(필터 표준표기 반영, vocab_config fetch는 .catch([]) 무해). 백업에 vocab_config 포함. 결합형 조합(CONN_COMBO)은 편집 대상 아님(코드 유지) — 대표 확정. '갤럭시 날개형' 기추가(cbfa46d).
8. **직원 수기입력 자동화 — 설계만 완료, 보류(2026-07-08)**: 원천 = 구글시트 `1bk81CC5_W3eJxVBF15VZn05Esxy0ghbQ-_N3EkdqhlI` gid=1570135874(공개, CSV export 실시간 읽기 가능; 스크래치패드 `sheet_1570.csv`). 구조 = **제품 81 × 기종 21 등록현황 매트릭스**(전부 22mm; 마이너 기종만 = 보이스캐디·레드미·샤오미·가민·어메이즈핏·타니·낫싱·순토, 갤럭시/애플/화웨이 없음). 셀 상태: 요청=수정전 955 / 완료=수정완료 268 / 미등록=스스 미등록(등록되면 추가) 245 / 진행안함=구기종 233. 직원 작업 = 요청/완료 셀(1,200+)을 카탈로그에 수기 등록(제품명·기종·22mm·재질 타이핑). 제안한 도구 A(시트↔카탈로그 대조 리포트→체크→일괄 SQL, 네이버 리포트 패턴) / B(관리자에 제품×기종 매트릭스, 요청 셀 클릭→등록폼 자동채움). **blocker(사용자 "일단 패스"): 마이너 기종을 ①기종별 개별 상품 vs ②기존 상품 model에 기종 추가 — 이 결정에 따라 SQL/폼 로직이 완전 달라짐.** 방식 정해지면 A부터 바로 구현 가능. 라인 매칭은 시트 제품명↔카탈로그 base_family nk() 정규화(초안 47/81, 개선 여지).
- 기타: '종류(kind)' 필드가 화면 미사용(폼 전용) — 뺄지 사용자 확인.
- 남은 후보(제안됨·미착수): 필터 옵션 개수 표시("실리콘 (204)"), 가격 구간 필터, 최근 본 상품, 모바일 드로어 "결과 N개 보기" 버튼.
- **네이버 리스팅 활용 설계(제안 완료·사용자가 보류함, 2026-07-08)**: 발견=카탈로그 1상품이 네이버 평균 5~18개 기종별 리스팅(기종 prefix "… 호환 …" 패턴, 이름 끝 mm). 내부도구 관점 제안 A~D — A. 상세 "런칭 현황" 표(기종×규격×상태 ✅판매/⏸품절/🚫중지/❌미런칭, VOCAB 대조로 미런칭 명시) B. map.html에 상품×기종 런칭 매트릭스(빈칸=신제품 후보 자동화) C. 카드에 기종 필터 기준 상태 뱃지 + 수기 model↔실런칭 어긋남 검출 D. GitHub Actions cron 동기화(statusType·가격·재고, 키=repo secrets). 데이터 스키마 안: `products.naver_listings` jsonb `[{no,기종,mm,price,status,stock}]`. 난관=기종 표기 정규화(VOCAB 46종 매핑). 추천 순서 A+D→B→C. **재개 시 이 설계 그대로 시작하면 됨.**
- **네이버 커머스 API 대조 리포트 완료(7ac5f8f), 직원 검수 대기** — 키=`.env`(NAVER_CLIENT_ID/SECRET, gitignored), 인증헬퍼=`naver_api.py`(get_token/call, bcrypt 서명). 파이프라인: `naver_sync_analyze.py`(수집 JSON+카탈로그 JSON→대조 데이터) → `naver_sync_report_build.py`(→`naver_sync_report.html`, gitignored). 결과: 네이버 7,162개 중 스트랩 신규후보 115종(변형 1,273), 정보채움 414건(URL확정24/이름높음376/확인필요14 — 확인필요는 기본 해제), 네이버에 없는 카탈로그 79개, 비스트랩 미등록 3,449개(참고 섹션). 리포트에서 체크→'SQL 다운로드'(INSERT+UPDATE)→사용자가 Supabase SQL Editor 실행. 체크상태 localStorage 유지. 이미지는 네이버 URL 직접 사용(thumbUrl이 외부 URL 통과). 재생성: 수집 스크립트는 HANDOFF 참고해 인라인 실행(스크래치패드 naver_products.json/catalog.json).

## 주의/함정 모음
- 검색·필터 값 비교는 normKey(공백무시) — 새 매칭 로직 추가 시 동일 규칙.
- findCol은 정확일치 우선(부분일치 폴백) — "규격"이 "베이스규격"에 안 뺏김.
- memo는 손님 상세에 '비고'로 노출됨(사용자 요청) — 내부용 메모 아님.
- 백업 zip에 원가·구매처 포함 → 공개 저장소 커밋 금지 (HANDOFF/백업 zip은 untracked 유지).
- 이미지 원본은 보존 정책(썸네일 별도 생성). 원본 축소(최적화)는 사용자가 원본 보존 원해 폐기함.
- GitHub CLI 인증 배너는 앱 PR표시용 — 작업 무관, 무시.
