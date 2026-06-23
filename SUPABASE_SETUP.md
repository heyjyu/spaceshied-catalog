# Supabase 연결 — 웹사이트로만 상품 관리하기

구글시트 없이 **웹 관리자 페이지(admin.html)에서 추가·수정·삭제**를 하고,
그 결과가 카탈로그에 **즉시** 반영되게 만드는 설정입니다. 한 번만 하면 끝.

> anon key 는 공개돼도 안전합니다. 읽기는 누구나, **쓰기는 로그인한 사람만**(RLS)으로 막혀 있습니다.

---

## 1. Supabase 프로젝트 만들기 (5분)
1. https://supabase.com → **Start your project** → GitHub/이메일로 가입(무료).
2. **New project** → 이름/비밀번호 입력 → 지역은 **Northeast Asia (Seoul)** 권장 → 생성(1~2분).

## 2. 표(table) 만들기
1. 좌측 **SQL Editor** → **New query**.
2. 이 폴더의 **`supabase_schema.sql`** 내용을 통째로 붙여넣고 **RUN**.
   → `products` 표 + 보안규칙(RLS) + 이미지 버킷이 한 번에 생성됩니다.

## 3. 기존 상품 481개 가져오기 (import)
1. 좌측 **Table Editor** → `products` 표 선택.
2. 우측 **Insert ▸ Import data from CSV** → 이 폴더의 **`supabase_import.csv`** 업로드.
3. 컬럼이 자동 매칭됩니다(name/model/material/size/buckle/color/image/store_url/sort) → **Import**.
   - 이미지는 기존 GitHub Pages 주소로 들어가 바로 보입니다.

## 4. 키 2개 복사해서 붙여넣기
1. 좌측 **Settings ▸ API**.
2. **Project URL** 과 **anon public** key 를 복사.
3. `config.js` 의 `SUPABASE` 에 붙여넣기:
   ```js
   SUPABASE: {
     URL: "https://xxxx.supabase.co",   // Project URL
     ANON_KEY: "eyJhbGci...",            // anon public
     TABLE: "products",
     ...
   },
   ```
4. 저장 → `git add -A && git commit && git push` → 사이트가 이제 **Supabase 에서** 상품을 읽습니다.
   (URL/KEY 가 비어 있으면 예전처럼 CSV 로 동작 — 안전)

## 5. 관리자 로그인 계정 만들기
1. 좌측 **Authentication ▸ Users ▸ Add user** → 이메일/비밀번호 입력(본인 것).
2. 끝. 이제 사이트의 **관리자(admin.html)** 에서 그 이메일로 로그인하면
   상품을 **추가/수정/삭제**할 수 있고, **사진 업로드**도 됩니다.

---

## 사용 흐름 (이후)
- 신상 등록·수정·삭제 → 사이트 우측 상단 **관리자** 버튼(admin.html) → 로그인 → 작업.
- 변경은 **새로고침하면 바로** 카탈로그에 반영(빌드/푸시 불필요).
- 구글시트·`build.sh`·`fetch.py`·`normalize.py` 는 더 이상 필요 없습니다(보관만).

## 자주 묻는 것
- **anon key 가 코드에 노출돼도 되나요?** 네. 설계상 공개용이고, 쓰기는 로그인(JWT)만 허용됩니다.
- **사진은 어디에?** Supabase Storage `product-images` 버킷(공개). 관리자에서 업로드하면 URL 자동 입력.
- **다른 셀러에 재판매?** 그 셀러용 Supabase 프로젝트를 새로 만들고 1~5단계만 반복 → `config.js` 키만 교체.
