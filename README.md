# 스페이스쉴드 워치 스트랩 카탈로그

기존 운영 구글시트(기종별 통합 List)를 읽어, 워치 스트랩을 **검색·필터**하고
**클릭하면 큰 이미지 + 속성값**을 보여주는 내부 관리용 웹앱.

- 검색: 재질·제품명·스트랩 규격·체결 형태·색상·기종 전체검색 + 드롭다운 필터
- 상세: 표/카드 클릭 → 큰 이미지 + 모든 속성
- 데이터: 시트에서 자동 추출 (이미지 포함) → 정적 파일로 서빙 (백엔드 0)

## 동작 방식 (중요)

운영 시트가 **기종별 23개 탭 + 제목줄/병합셀/운영컬럼**이 섞인 형태라
앱이 시트를 직접 실시간으로 읽지 않고, **변환 파이프라인**으로 깨끗하게 뽑아 씁니다:

```
구글시트 ──fetch.py──> raw/*.csv (탭별) + sheet.xlsx(삽입이미지)
          ──normalize.py──> catalog.csv  +  images/*.jpg
                                    └─> 웹앱(index.html)이 표시
```

- `fetch.py` : 23개 탭 CSV + 시트 전체 xlsx(삽입 이미지 포함) 다운로드
- `normalize.py` : 탭마다 다른 컬럼을 키워드 매핑 → 통일,
  재질/규격 정규화, 체결 형태는 제품명에서 추출, 기종은 탭 이름에서,
  xlsx 삽입 이미지를 (탭·행) 매칭해 `images/`에 리사이즈 저장

### 데이터 갱신 (한 방)

시트를 수정한 뒤 최신 반영:
```bash
./build.sh                 # = fetch.py + normalize.py
# 웹앱 새로고침하면 끝
```

## 지금 바로 보기

```bash
python3 -m http.server 8000
# http://localhost:8000
```
`config.js`의 `SHEET_ID="DEMO"` → 변환된 `sample-data.csv`(= 최신 catalog.csv) 표시.

## 현재 데이터 채움률 (원본 시트 기준)

| 속성 | 채움률 | 비고 |
|---|---|---|
| 제품명 / 기종 | 100% | |
| 재질 | 84% | 35종→실리콘/패브릭/메탈/가죽/스틸 등으로 정규화 |
| 스트랩 규격 | 63% | 일반형 탭은 탭명(20/22mm)으로 보정 |
| 체결 형태 | 47% | 체결방식 컬럼 없으면 제품명에서 추출 |
| 이미지 | 52% | 시트에 삽입된 사진 자동 추출(나머지는 시트에 없음) |
| **색상** | **18%** | ⚠️ 원본 마스터시트에 거의 미입력 — 보강 필요 |

### 남은 일
- **색상**: 시트에 거의 없음. (a) 셀러가 `컬러옵션명` 칸을 채우거나 (b) 스마트스토어 옵션에서 가져와야 함
- **수동 처리 탭**: SET·커넥터·날개형·원클릭·가민 D2.3 등은 구조가 달라 자동변환 제외(`normalize.py`의 `SKIP_TABS`)
- 재질 희귀값(강화유리/PMMA/우레탄 등) 일부는 그대로 둠

## GitHub Pages 배포

```bash
git init && git add . && git commit -m "스페이스쉴드 카탈로그"
git remote add origin https://github.com/<아이디>/spaceshied-catalog.git
git push -u origin main
```
Settings → Pages → main / root. `images/`(약 6MB)도 함께 커밋됩니다.

## 파일 구조
```
fetch.py        시트 다운로드 (CSV + xlsx)
normalize.py    변환 + 이미지 추출/리사이즈 → catalog.csv, images/
build_images.py xlsx 삽입이미지 위치(행/열) 파서
build.sh        fetch + normalize 한 번에
config.js       앱 설정 (제목/필터/컬럼 매핑)
index.html, app.js, styles.css   웹앱
catalog.csv     변환 결과 (= sample-data.csv)
images/         추출된 상품 이미지(리사이즈)
```
