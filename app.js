// ===================================================================
//  워치 스트랩 카탈로그 — 메인 로직
//  구글시트(또는 sample-data.csv) → 검색/필터/정렬 + 클릭하면 상세(이미지+속성)
// ===================================================================

let table = null;        // Tabulator 인스턴스
let allRows = [];        // 원본 데이터
let _openId = null;      // 현재 열린 상세의 상품 id(#p{id} 해시 라우팅용, 없으면 null)
let headersAll = [];     // 전체 헤더 순서
let colKeys = {};        // 특수 컬럼 키 {image, link, price, stock, name}
let facetCols = [];      // [{label, key}] 자동감지된 필터 컬럼
let viewMode = "gallery";  // "table" | "gallery" — 갤러리 기본
let suggestItems = [];   // 자동완성 후보 [{text, lc, type, key}]
let suggestSel = -1;     // 키보드 선택 인덱스
let categoryCfg = {};    // 사이드바 카테고리 설정(Supabase categories): {key:{label,sort,visible}}
let columnCfg = {};      // 표 컬럼 설정(Supabase column_config): {헤더:{label,sort,visible}}

// 현재 필터 상태
const filterState = { search: "", facets: {}, stock: "", favOnly: false, category: "", lifecycle: "", sort: "" };

// 상품 상태 3종: 판매 → 소싱 → 단종. (기존 진행/기획/샘플/일부 데이터도 자동 매핑)
const STATUS_DEF = {
  active:   { label: "판매", cls: "st-active" },
  sampling: { label: "소싱", cls: "st-sampling" },
  discont:  { label: "단종", cls: "st-discont" },
};
const STATUS_ORDER = ["active", "sampling", "discont"];
function statusKey(r) {
  const s = String(r["상태"] || "").trim();
  if (/단종|disc/i.test(s)) return "discont";
  if (/소싱|샘플|기획|계획|sourc|sampl|plan/i.test(s)) return "sampling";
  return "active"; // 판매/진행/출시/일부/빈값
}

const $ = (id) => document.getElementById(id);

// ---- 즐겨찾기 (localStorage) ---------------------------------------
let favs = (() => {
  try {
    let s = new Set(JSON.parse(localStorage.getItem("catalog_favs") || "[]"));
    // 즐겨찾기 키를 고유 id 기반("id:N")으로 전환. Supabase면 옛 'name||model' 키
    // (이름·기종 같은 다른 제품이 같이 찜되던 버그)를 1회 정리.
    if (CONFIG.SUPABASE && CONFIG.SUPABASE.URL) s = new Set([...s].filter((k) => k.startsWith("id:")));
    return s;
  } catch (e) { return new Set(); }
})();
// 고유 식별: DB id(__id) 우선. 없으면(CSV/DEMO) 제품명+기종 폴백.
function favKey(r) {
  if (r.__id != null) return "id:" + r.__id;
  const m = facetCols[0] ? (r[facetCols[0].key] || "") : "";
  return (rowTitle(r) || "") + "||" + m;
}
function isFav(r) { return favs.has(favKey(r)); }
function saveFavs() {
  try { localStorage.setItem("catalog_favs", JSON.stringify([...favs])); } catch (e) {}
}
function toggleFav(r) {
  const k = favKey(r);
  if (favs.has(k)) favs.delete(k); else favs.add(k);
  saveFavs();
  updateFavUI();
  if (filterState.favOnly) applyFilters();
  return favs.has(k);
}
function updateFavUI() {
  const c = $("favCount"); if (c) c.textContent = favs.size;
  // 통계 옆 '★ 즐겨찾기 N' 버튼: 카운트+활성 상태 실시간 갱신(카드 별 눌러도 즉시 반영)
  const sf = $("statFav");
  if (sf) {
    const n = sf.querySelector(".sf-n"); if (n) n.textContent = favs.size;
    sf.classList.toggle("active", filterState.favOnly);
  }
  ["btnFav", "btnFavTop"].forEach((id) => {
    const btn = $(id); if (btn) btn.classList.toggle("active", filterState.favOnly);
  });
}

// ---- 유틸 -----------------------------------------------------------
function findCol(headers, hints) {
  const lc = headers.map((h) => String(h).toLowerCase());
  // 1차: 정확히 같은 헤더 우선 ("규격" 힌트가 "베이스규격"에 가로채이지 않게)
  for (const hint of hints) {
    const i = lc.indexOf(hint.toLowerCase());
    if (i >= 0) return headers[i];
  }
  // 2차: 부분 일치
  for (const hint of hints) {
    const i = lc.findIndex((h) => h.includes(hint.toLowerCase()));
    if (i >= 0) return headers[i];
  }
  return null;
}

// 출시년월 표시: "2024-05"/"2024.05"/"202405" → "2024. 05", "2024" → "2024"
function formatYM(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})\D*(\d{1,2})?/);
  if (!m) return s;
  return m[2] ? `${m[1]}. ${m[2].padStart(2, "0")}` : m[1];
}

// 호환(커넥터) 표시 라벨: 공용/범용 = "커넥터 연결형", 기종 전용 = "기종별 일체형" (상세 단일값용)
function connectorLabel(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return /공용|공통|범용|universal/i.test(s) ? "커넥터 연결형" : "기종별 일체형";
}
// 필터·표용: '공용(범용)'만 '커넥터 연결형'으로, 나머지 기종명은 그대로 유지(옵션 구분 보존)
function connUniversalLabel(v) {
  const s = String(v ?? "").trim();
  return /공용|공통|범용|universal/i.test(s) ? "커넥터 연결형" : s;
}

// 간단 토스트
function showToast(msg) {
  let t = document.getElementById("__toast");
  if (!t) { t = document.createElement("div"); t.id = "__toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

// 이미지를 클립보드에 복사(붙여넣기 가능). jpg 등은 PNG로 변환(클립보드는 주로 image/png만 허용).
async function copyImageToClipboard(url) {
  const toPng = async () => {
    const resp = await fetch(url, { mode: "cors" });
    const blob = await resp.blob();
    if (blob.type === "image/png") return blob;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    return await new Promise((res) => c.toBlob(res, "image/png"));
  };
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error("no clipboard");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": toPng() })]);
    showToast("이미지 복사됨 — 붙여넣기(⌘/Ctrl+V) 하세요");
  } catch (e) {
    try { await navigator.clipboard.writeText(url); showToast("이미지 주소 복사됨 (이 브라우저는 이미지 직접 복사 미지원)"); }
    catch (_) { showToast("복사 실패: " + (e.message || e)); }
  }
}

// 관리자 로그인 여부: Supabase 세션 토큰(localStorage)이 있고 만료 전이면 true
function isAdminLoggedIn() {
  try {
    const s = CONFIG.SUPABASE || {};
    const ref = (s.URL || "").match(/https?:\/\/([^.]+)\./);
    if (!ref) return false;
    const raw = localStorage.getItem(`sb-${ref[1]}-auth-token`);
    if (!raw) return false;
    const t = JSON.parse(raw);
    const exp = t && (t.expires_at || (t.currentSession && t.currentSession.expires_at));
    return !exp || exp * 1000 > Date.now();
  } catch (e) { return false; }
}

// 카드용 썸네일 URL: Supabase 이미지는 thumbs/ 경로의 축소본을 우선 사용(원본 보존, 카드만 가볍게).
// 썸네일이 아직 없으면 onerror 폴백으로 원본을 로드하므로 깨지지 않음.
function thumbUrl(u) {
  const marker = "/storage/v1/object/public/product-images/";
  const s = String(u || "");
  if (!s.includes(marker) || s.includes(marker + "thumbs/")) return s;
  return s.replace(marker, marker + "thumbs/");
}

function won(v) {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  if (!isFinite(n) || String(v).trim() === "") return v ?? "";
  return n.toLocaleString("ko-KR") + "원";
}

function stockClass(v) {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  if (!isFinite(n)) return null;
  if (n <= 0) return "out";
  if (n <= 20) return "low";
  return "ok";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 한 셀에 값이 여러 개(쉼표/줄바꿈)면 쪼갬. "(및 추가 색상)" 같은 괄호 메모 제거.
// 쉼표(,)·한글쉼표(、)·줄바꿈으로만 분리. "/"는 규격(42/44/45mm)에 쓰이므로 분리 안 함.
function splitVals(v) {
  return String(v ?? "")
    .replace(/\(.*?\)/g, "")
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- facet 값 파생 (derive) ----------------------------------------
// 사이즈: 셀/제품명에서 폭(NNmm)만 추출. 스트랩 호환의 핵심.
function firstMm(s) {
  const m = String(s ?? "").match(/(\d{2})\s*mm/);
  return m ? m[1] + "mm" : "";
}
// 색상: 복합 색상명을 표준 색 버킷으로 (config COLOR_BUCKETS). 복합값은 여러 색 반환.
function colorBuckets(s) {
  const dict = CONFIG.COLOR_BUCKETS || [];
  const found = [];
  for (const tok of String(s ?? "").split(/[,、\n\s/&+]+/)) {
    if (!tok) continue;
    for (const [canon, kws] of dict) {
      if (kws.some((k) => tok.includes(k)) && !found.includes(canon)) found.push(canon);
    }
  }
  return found;
}
// facet 한 행의 필터값 목록. derive 없으면 원본을 쪼갬. exclude 값은 제거.
const STRAP_WIDTHS = ["12mm", "14mm", "18mm", "20mm", "22mm", "24mm", "26mm"];   // 표준 스트랩 너비
function facetValues(row, f) {
  let vals;
  if (f.derive === "mm") {
    // 규격 필드 우선, 없으면 제품명에서 추출 — 표준 너비(12~26mm)만 인정(47mm 등 워치 크기 잡음 배제)
    const own = firstMm(row[f.key]);
    const fromTitle = firstMm(rowTitle(row));
    const v = STRAP_WIDTHS.includes(own) ? own : (STRAP_WIDTHS.includes(fromTitle) ? fromTitle : "");
    vals = v ? [v] : [];
  } else if (f.derive === "structure") {
    // 스트랩 구조: 기본형/결합형으로 정규화 (구식 '커넥터 연결형'/'기종별 일체형'·빈값은 커넥터 공용여부로)
    const v = String(row[f.key] || "").trim();
    if (/결합|연결/.test(v)) vals = ["결합형"];
    else if (/기본|일체/.test(v)) vals = ["기본형"];
    else vals = [/공용|공통|범용/.test(String(row["호환"] || "")) || !String(row["호환"] || "").trim() ? "결합형" : "기본형"];
  } else if (f.derive === "color") {
    const b = colorBuckets(row[f.key]);
    vals = b.length ? b : colorBuckets(rowTitle(row));
  } else {
    vals = splitVals(row[f.key]);
  }
  if (f.exclude && f.exclude.length) vals = vals.filter((v) => !f.exclude.includes(v));
  return vals;
}
// 색상 표시 순서(드롭다운 정렬용)
function colorOrder(v) {
  const d = CONFIG.COLOR_BUCKETS || [];
  const i = d.findIndex(([c]) => c === v);
  return i < 0 ? 999 : i;
}
// 색상 옵션 갯수: "색상수" 입력값 우선, 없으면 색상 목록 개수로 추정
function colorCountOf(r) {
  const explicit = parseInt(String(r["색상수"] || "").replace(/[^0-9]/g, ""), 10);
  if (explicit > 0) return explicit;
  const f = facetCols.find((x) => x.derive === "color");
  return f ? splitVals(r[f.key]).length : 0;
}

// ---- 데이터 로딩 ----------------------------------------------------
function sheetUrl() {
  if (!CONFIG.SHEET_ID || CONFIG.SHEET_ID === "DEMO") return "sample-data.csv";
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv`;
  if (CONFIG.SHEET_GID) return `${base}&gid=${encodeURIComponent(CONFIG.SHEET_GID)}`;
  return `${base}&sheet=${encodeURIComponent(CONFIG.SHEET_NAME || "")}`;
}

// 헤더·행을 받아 화면 구성 (CSV/시트/Supabase 공통 진입점)
function ingest(headers, rows) {
  rows = rows.filter((r) => Object.keys(r).some((k) => k !== "__id" && String(r[k]).trim() !== ""));
  if (!rows.length) {
    setStatus("데이터가 비어 있습니다. 연결 설정/내용을 확인하세요.", true);
    return;
  }
  headersAll = headers;
  detectColumns(headersAll, rows);
  // 사진 있는 상품을 앞으로 (사진 없는 구형 상품이 위를 다 차지해 '사진 없음'처럼 보이는 것 방지).
  // 같은 그룹 안에서는 기존 정렬 순서 유지(안정 정렬).
  if (colKeys.image) {
    rows = rows.map((r, i) => [r, i]).sort((a, b) => {
      const ai = String(a[0][colKeys.image] || "").trim() ? 0 : 1;
      const bi = String(b[0][colKeys.image] || "").trim() ? 0 : 1;
      return ai - bi || a[1] - b[1];
    }).map((x) => x[0]);
  }
  allRows = rows;
  buildView(rows);
}

function supabaseEnabled() {
  const s = CONFIG.SUPABASE;
  return !!(s && s.URL && s.ANON_KEY);
}

function loadData() {
  showSkeleton();
  if (supabaseEnabled()) return loadFromSupabase();
  const url = sheetUrl();
  // header:false 로 받아서 HEADER_ROW(제목 줄 건너뛰기)를 우리가 직접 처리
  Papa.parse(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), {
    download: true,
    header: false,
    skipEmptyLines: true,
    complete: (res) => {
      const grid = res.data || [];
      const hr = Math.max(1, CONFIG.HEADER_ROW || 1) - 1;
      if (grid.length <= hr) {
        setStatus("데이터가 비어 있습니다. 시트 내용/HEADER_ROW/공유설정을 확인하세요.", true);
        return;
      }
      // 헤더 만들기 (빈 헤더는 컬럼N 으로 이름 붙임)
      const headers = grid[hr].map((h, i) => (String(h).trim() || `컬럼${i + 1}`));
      const rows = grid.slice(hr + 1).map((arr) => {
        const o = {};
        headers.forEach((h, i) => (o[h] = arr[i] != null ? String(arr[i]) : ""));
        return o;
      });
      ingest(headers, rows);
    },
    error: (err) => {
      setStatus("불러오기 실패: " + err.message +
        "\n구글시트 공유설정(링크가 있는 모든 사용자=뷰어)을 확인하세요.", true);
    },
  });
}

// Supabase REST 에서 상품을 읽어 카탈로그 표시 (영문 컬럼 → 한글 헤더 매핑)
//  속도: ① categories/column_config/products 3개를 병렬 요청(순차 대비 ~2배)
//        ② 지난 방문 데이터(localStorage)를 먼저 그려 즉시 표시 → 최신 도착하면 바뀐 경우만 조용히 교체
//        (수정 반영: 최신 fetch가 항상 돌므로 저장 직후 값이 1초 내 반영. 관리자 저장 신호 시엔 softRefresh 즉시)
const CATALOG_CACHE_KEY = "catalog_cache_v1";
// DB 레코드 → 화면 행. __* 키는 헤더 밖(표·검색 비노출), 상세에서만 사용.
function rowFromRec(rec, map) {
  const o = {};
  for (const [col, head] of Object.entries(map)) o[head] = rec[col] != null ? String(rec[col]) : "";
  if (rec.id != null) o.__id = String(rec.id);                                    // 즐겨찾기 고유키
  if (rec.color_chart != null) o.__colorChart = String(rec.color_chart);          // 중국 컬러차트
  if (rec.color_chart_kr != null) o.__colorChartKr = String(rec.color_chart_kr);  // 한국 컬러차트
  if (rec.aerial_img != null) o.__aerial = String(rec.aerial_img);                // (구) 항공뷰 — 추가 사진으로 흡수됨
  if (Array.isArray(rec.extra_images)) o.__extra = rec.extra_images.map(String);  // 추가 사진 여러 장
  if (Array.isArray(rec.related_ids)) o.__related = rec.related_ids.map(String);  // 직접 추가한 비슷한 제품 id들
  if (rec.img_sig) {                                                              // 이미지 색상 지문(8x8 RGB, base64)
    try { const b = atob(String(rec.img_sig)); const a = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); o.__sig = a; } catch (e) {}
  }
  return o;
}

// 관리자 액세스 토큰(admin.html 로그인 세션 재사용) — 카탈로그에서 큐레이션 저장용
function adminToken() {
  try {
    const ref = ((CONFIG.SUPABASE || {}).URL || "").match(/https?:\/\/([^.]+)\./);
    if (!ref) return null;
    const t = JSON.parse(localStorage.getItem(`sb-${ref[1]}-auth-token`) || "null");
    const at = t && (t.access_token || (t.currentSession && t.currentSession.access_token));
    const exp = t && (t.expires_at || (t.currentSession && t.currentSession.expires_at));
    return at && (!exp || exp * 1000 > Date.now()) ? at : null;
  } catch (e) { return null; }
}
// 비슷한 제품 직접 추가 목록(related_ids) 저장
async function saveRelated(r, ids) {
  const s = CONFIG.SUPABASE;
  const tok = adminToken();
  if (!tok) throw new Error("관리자 로그인이 필요합니다");
  const resp = await fetch(`${s.URL}/rest/v1/${s.TABLE || "products"}?id=eq.${encodeURIComponent(r.__id)}`, {
    method: "PATCH",
    headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ related_ids: ids.map(Number) }),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  r.__related = ids.map(String);
}
// 관리자 어휘집(vocab_config) → CONFIG.VOCAB 병합. 필터 표준표기(vocabCanon)가 편집값을 따르게.
function mergeVocab(vocab) {
  if (!Array.isArray(vocab) || !vocab.length) return;
  const KMAP = { "기종": ["기종"], "구조": ["스트랩 구조", "스트랩구조"], "커넥터": ["커넥터 타입"], "규격": ["스트랩 너비"] };
  CONFIG.VOCAB = CONFIG.VOCAB || {};
  vocab.forEach((r) => {
    const vals = Array.isArray(r.values) ? r.values.filter(Boolean) : [];
    if (!vals.length) return;
    (KMAP[r.key] || [r.key]).forEach((vk) => { CONFIG.VOCAB[vk] = vals; });
  });
}
function applySupabaseData(cats, cols, prods, vocab) {
  mergeVocab(vocab);
  categoryCfg = {};
  (cats || []).forEach((c) => { categoryCfg[c.key] = { label: c.label || "", sort: c.sort, visible: c.visible !== false }; });
  columnCfg = {};
  (cols || []).forEach((c) => { columnCfg[c.key] = { label: c.label || "", sort: c.sort, visible: c.visible !== false }; });
  const map = CONFIG.SUPABASE.COLUMN_MAP || {};   // {영문컬럼: 한글헤더}
  const headers = Object.values(map);              // 표시 순서 = 매핑 순서
  ingest(headers, (prods || []).map((rec) => rowFromRec(rec, map)));
}
function loadFromSupabase() {
  const s = CONFIG.SUPABASE;
  const H = { headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${s.ANON_KEY}` } };
  const order = s.ORDER ? `&order=${encodeURIComponent(s.ORDER)}` : "";
  // ① 캐시 먼저 그리기 (재방문 시 체감 0초)
  let cachedRaw = null;
  try { cachedRaw = localStorage.getItem(CATALOG_CACHE_KEY); } catch (e) {}
  if (cachedRaw) {
    try { const c = JSON.parse(cachedRaw); applySupabaseData(c.cats, c.cols, c.prods, c.vocab); }
    catch (e) { cachedRaw = null; }
  }
  // ② 병렬 fetch → 캐시와 다르면 조용히 교체 + 캐시 저장 (vocab_config는 없어도 무시)
  const j = (u) => fetch(u, H).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))));
  Promise.all([
    j(`${s.URL}/rest/v1/categories?select=key,label,sort,visible`).catch(() => []),
    j(`${s.URL}/rest/v1/column_config?select=key,label,sort,visible`).catch(() => []),
    j(`${s.URL}/rest/v1/${s.TABLE || "products"}?select=*${order}`),
    j(`${s.URL}/rest/v1/vocab_config?select=key,values`).catch(() => []),
  ])
    .then(([cats, cols, prods, vocab]) => {
      const fresh = JSON.stringify({ cats, cols, prods, vocab });
      try { localStorage.setItem(CATALOG_CACHE_KEY, fresh); } catch (e) {}
      if (!cachedRaw || fresh !== cachedRaw) applySupabaseData(cats, cols, prods, vocab);
    })
    .catch((err) => {
      if (!cachedRaw) setStatus("Supabase 불러오기 실패: " + err.message +
        "\nconfig.js 의 SUPABASE.URL/ANON_KEY/TABLE 과 RLS(공개 읽기) 설정을 확인하세요.", true);
    });
}

// 자동 갱신: 데이터만 다시 받아 표를 in-place 교체(필터·정렬·스크롤 유지). 조용히 실패.
function softRefresh() {
  if (!supabaseEnabled() || !table) return;
  const s = CONFIG.SUPABASE;
  const map = s.COLUMN_MAP || {};
  const order = s.ORDER ? `&order=${encodeURIComponent(s.ORDER)}` : "";
  fetch(`${s.URL}/rest/v1/${s.TABLE || "products"}?select=*${order}`, {
    headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${s.ANON_KEY}` },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((data) => {
      let rows = (data || []).map((rec) => rowFromRec(rec, map))
        .filter((r) => Object.keys(r).some((k) => k[0] !== "_" && String(r[k]).trim() !== ""));
      if (colKeys.image) {
        rows = rows.map((r, i) => [r, i]).sort((a, b) => {
          const ai = String(a[0][colKeys.image] || "").trim() ? 0 : 1;
          const bi = String(b[0][colKeys.image] || "").trim() ? 0 : 1;
          return ai - bi || a[1] - b[1];
        }).map((x) => x[0]);
      }
      allRows = rows;
      table.replaceData(sortedRows(rows, filterState.sort)).then(() => {
        renderStats(); updateFilterCount(); renderCatNav();
        if (viewMode === "gallery") setView("gallery");
      });
    })
    .catch(() => {}); // 자동 갱신이라 실패해도 사용자 방해하지 않음
}

// 검색/필터 0건 안내 (갤러리 + 표 placeholder 공용). onclick 전역은 위임 밖 컨텍스트(Tabulator) 때문.
function emptyStateHTML() {
  return `<div class="empty-state">
    <div class="es-icon" aria-hidden="true">🔍</div>
    <div class="es-title">조건에 맞는 상품이 없습니다</div>
    <div class="es-sub">검색어를 바꾸거나 필터를 풀어보세요.</div>
    <button class="es-reset" onclick="window._resetFilters&&window._resetFilters()">검색·필터 초기화</button>
  </div>`;
}

// 첫 로딩 스켈레톤: 데이터 도착 전 빈 화면 대신 카드 자리 미리 표시
function showSkeleton() {
  const el = $("status");
  el.className = "";
  el.classList.remove("hidden");
  el.innerHTML = `<div class="skel-grid" aria-label="불러오는 중">` +
    Array.from({ length: 8 }, () =>
      `<div class="skel-card"><div class="skel-img"></div><div class="skel-line w60"></div><div class="skel-line"></div><div class="skel-line w40"></div></div>`
    ).join("") + `</div>`;
  $("table").classList.add("hidden");
  $("gallery").classList.add("hidden");
}

function setStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.classList.remove("hidden");
  $("table").classList.add("hidden");
  $("gallery").classList.add("hidden");
}

// ---- 컬럼/필터 자동감지 --------------------------------------------
function detectColumns(headers, rows) {
  colKeys = {};
  // 쿠팡*·플로우링크·구매링크는 전용 처리(버튼/바로가기) → 일반 link 자동감지에서 제외.
  //  ('플로우링크'가 link 힌트 '링크'를 가로채 네이버 버튼이 Flow로 잘못 연결되던 것 방지)
  const detectHeaders = headers.filter((h) => !/^쿠팡/.test(h) && h !== "플로우링크" && h !== "구매링크");
  for (const [type, hints] of Object.entries(CONFIG.COLUMN_HINTS)) {
    const c = findCol(detectHeaders, hints);
    if (c) colKeys[type] = c;
  }
  // 필터(facet) 드롭다운 컬럼
  facetCols = [];
  filterState.facets = {};
  for (const f of CONFIG.FACETS || []) {
    const c = findCol(headers, f.hints);
    if (c && !facetCols.some((x) => x.key === c)) {
      facetCols.push({ label: f.label, vocab: f.vocab || f.label, key: c, derive: f.derive || null, exclude: f.exclude || null });
      filterState.facets[c] = "";
    }
  }
  buildFacetDropdowns(rows);
  buildSuggestIndex(rows);
}

// ---- 검색 자동완성 인덱스 ------------------------------------------
// 상품명 + 모든 facet 값(기종/규격/색상 등)을 후보로. 빈도순 정렬.
function buildSuggestIndex(rows) {
  const map = new Map(); // 키: type|text → {text,type,key,count}
  const add = (text, type, key) => {
    text = String(text || "").trim();
    if (text.length < 1) return;
    const id = type + "|" + text.toLowerCase();
    const cur = map.get(id);
    if (cur) cur.count++;
    else map.set(id, { text, lc: searchNorm(text), lcNS: searchNorm(text).replace(/\s+/g, ""), type, key, count: 1 });
  };
  for (const r of rows) {
    if (colKeys.name) add(rowTitle(r), "상품", null);
    for (const f of facetCols) facetValues(r, f).forEach((v) => add(v, f.label, f.key));
  }
  // 속성값을 상품명보다 먼저(짧고 필터로 바로 연결), 그다음 빈도순
  suggestItems = [...map.values()].sort((a, b) => {
    const an = a.type === "상품", bn = b.type === "상품";
    if (an !== bn) return an ? 1 : -1;
    return b.count - a.count;
  });
}

// 공백·대소문자 무시 정규화 키 (띄어쓰기 다른 같은 값 병합용): "갤럭시 워치8" == "갤럭시 워치 8"
function normKey(s) { return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, "").toLowerCase(); }
// 검색 비교용 정규화: 분해형(NFD) 한글→조합형(NFC)로 통일 + 소문자. (엑셀/네이버 유래 데이터가 NFD라 검색 안 되던 문제)
function searchNorm(s) { return String(s == null ? "" : s).normalize("NFC").toLowerCase(); }
// facet 라벨 → {정규화키: 표준표기} (VOCAB 기준값 우선 표시)
function vocabCanon(label) {
  const list = (CONFIG.VOCAB && CONFIG.VOCAB[label]) || [];
  const m = {};
  list.forEach((v) => { m[normKey(v)] = v; });
  return m;
}

function buildFacetDropdowns(rows) {
  const wrap = $("filters");
  // 기존 facet select 제거 (stockFilter / btnClear 는 유지)
  wrap.querySelectorAll("select.facet-select").forEach((e) => e.remove());
  const stockSel = $("stockFilter");
  for (const f of facetCols) {
    const sel = document.createElement("select");
    sel.className = "filter facet-select";
    sel.dataset.key = f.key;
    // 한 셀에 여러 값이면 쪼개서 각각을 옵션으로 (derive 적용).
    // 공백 차이로 갈라진 값은 하나로 병합(VOCAB 표준표기 우선).
    const canon = vocabCanon(f.vocab || f.label);
    const groups = new Map();  // 정규화키 → 표시값
    rows.forEach((r) => facetValues(r, f).forEach((v) => {
      const k = normKey(v);
      if (!groups.has(k)) groups.set(k, canon[k] || v);
    }));
    let vals = [...groups.values()];
    if (f.derive === "mm") vals.sort((a, b) => parseInt(a) - parseInt(b));
    else if (f.derive === "color") vals.sort((a, b) => colorOrder(a) - colorOrder(b));
    else vals.sort((a, b) => a.localeCompare(b, "ko"));
    const optLabel = (f.label === "호환" || f.label === "기종") ? connUniversalLabel : ((x) => x);
    sel.innerHTML = `<option value="">${esc(f.label)}</option>` +
      vals.map((v) => `<option value="${esc(v)}">${esc(optLabel(v))}</option>`).join("");
    sel.addEventListener("change", (e) => {
      filterState.facets[f.key] = e.target.value;
      applyFilters();
    });
    wrap.insertBefore(sel, stockSel);
  }
}

// ---- Tabulator 컬럼 구성 -------------------------------------------
function buildColumns(headers) {
  const hide = new Set(CONFIG.HIDE_COLUMNS || []);
  const colorKey = (facetCols.find((f) => f.derive === "color") || {}).key;
  const sizeKey = (facetCols.find((f) => f.derive === "mm") || {}).key;
  const connKey = "호환";   // 표 컬럼 포맷용 (facet 구성과 무관하게 고정)
  const modelKey2 = (facetCols.find((f) => f.label === "기종") || {}).key;
  const hasCfg = columnCfg && Object.keys(columnCfg).length > 0;
  // 필수 컬럼(항상 노출): 제품명·사진·규격 ("규격"은 COLUMN_MAP.size 헤더, sizeKey는 '베이스규격'을 잡을 수 있어 직접 지정)
  const sizeHeader = ((CONFIG.SUPABASE && CONFIG.SUPABASE.COLUMN_MAP) || {}).size || "규격";
  const must = new Set([colKeys.name, colKeys.image, sizeHeader].filter(Boolean));
  // 표시 순서/노출: column_config 가 있으면 그 설정 우선, 없으면 기존(매핑 순서 + HIDE_COLUMNS)
  let ordered;
  if (hasCfg) {
    ordered = headers
      .filter((h) => { if (must.has(h)) return true; const c = columnCfg[h]; return c ? c.visible !== false : !hide.has(h); })
      .sort((a, b) => {
        const sa = columnCfg[a] ? (columnCfg[a].sort ?? 9999) : 9999;
        const sb = columnCfg[b] ? (columnCfg[b].sort ?? 9999) : 9999;
        return sa - sb || headers.indexOf(a) - headers.indexOf(b);
      });
  } else {
    // 디폴트 순서: 사진 → 제품명 → 나머지(매핑 순서)
    const vis = headers.filter((h) => !hide.has(h));
    const front = [colKeys.image, colKeys.name].filter(Boolean);
    ordered = [...front, ...vis.filter((h) => !front.includes(h))];
  }
  const cols = [];
  // 맨 앞: 즐겨찾기 별 컬럼
  cols.push({
    title: "", field: "_fav", width: 46, hozAlign: "center", headerSort: false,
    resizable: false, cssClass: "col-fav",
    formatter: (cell) => `<span class="fav-star${isFav(cell.getRow().getData()) ? " on" : ""}">★</span>`,
  });
  for (const h of ordered) {
    const lbl = (columnCfg[h] && columnCfg[h].label) ? columnCfg[h].label : h;
    const col = { title: lbl, field: h, resizable: true };
    if (h === colKeys.image) {
      col.width = 70; col.headerSort = false; col.title = "사진";
      col.formatter = (cell) => {
        const v = cell.getValue();
        return v ? `<img class="cell-thumb" src="${esc(v)}" loading="lazy" alt="">`
                 : `<span class="cell-noimg">—</span>`;
      };
    } else if (h === colorKey) {
      // 색상: 표준색 스와치 동그라미
      col.formatter = (cell) => {
        const cs = facetValues(cell.getRow().getData(), facetCols.find((f) => f.key === colorKey));
        if (!cs.length) return `<span class="cell-noimg">—</span>`;
        const hex = CONFIG.COLOR_HEX || {};
        return `<span class="swatches">` + cs.slice(0, 6).map((c) =>
          `<span class="swatch" style="background:${hex[c] || "#ccc"}" title="${esc(c)}"></span>`).join("") +
          (cs.length > 6 ? `<span class="swatch-more">+${cs.length - 6}</span>` : "") + `</span>`;
      };
    } else if (h === sizeKey) {
      col.formatter = (cell) => {
        const v = firstMm(cell.getValue()) || firstMm(rowTitle(cell.getRow().getData()));
        return v ? `<span class="size-badge">${esc(v)}</span>` : `<span class="cell-noimg">—</span>`;
      };
    } else if (h === colKeys.link) {
      col.formatter = (cell) => {
        const v = cell.getValue();
        return v ? `<a class="cell-link" href="${esc(v)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">열기 ↗</a>` : "";
      };
    } else if (h === connKey || h === modelKey2) {
      col.formatter = (cell) => esc(connUniversalLabel(cell.getValue()));
    } else if (h === "원가(CNY)") {
      col.hozAlign = "right"; col.sorter = "number";
      col.formatter = (cell) => { const val = cell.getValue(); return val !== "" && val != null ? `¥${esc(String(val))}` : "-"; };
    } else if (h === "출시년월") {
      col.formatter = (cell) => esc(formatYM(cell.getValue()));
    } else if (h === colKeys.price) {
      col.hozAlign = "right"; col.sorter = "number";
      col.formatter = (cell) => won(cell.getValue());
    } else if (h === colKeys.stock) {
      col.hozAlign = "right"; col.sorter = "number";
      col.formatter = (cell) => {
        const v = cell.getValue(); const cls = stockClass(v);
        if (cls === "out") return `<span class="badge out">품절</span>`;
        if (cls === "low") return `<span class="badge low">${esc(v)}</span>`;
        return `<span class="badge ok">${esc(v)}</span>`;
      };
    }
    cols.push(col);
  }
  return cols;
}

// ---- 메인 뷰 빌드 ---------------------------------------------------
function buildView(rows) {
  $("status").classList.add("hidden");
  $("table").classList.remove("hidden");

  table = new Tabulator("#table", {
    data: rows,
    columns: buildColumns(headersAll),
    layout: "fitDataStretch",
    pagination: true,
    paginationSize: CONFIG.PAGE_SIZE,
    paginationSizeSelector: [25, 50, 100, 200],
    movableColumns: true,
    placeholder: emptyStateHTML(),
    rowFormatter: (row) => {   // 리스트 뷰: 단종 제품 전체 흐릿 처리
      row.getElement().classList.toggle("row-discont", statusKey(row.getData()) === "discont");
    },
  });

  table.on("tableBuilt", () => {
    const restored = restoreFiltersFromHash(); // 공유 링크/새로고침의 #f=… 를 setFilter 전에 복원
    table.setFilter(matchRow);
    renderStats();
    updateFilterCount();
    updateFavUI();
    renderCatNav();
    setView(viewMode); // 모바일 기본 갤러리 등 현재 뷰모드 반영
    if (restored && filterState.sort) applySort(); // 복원된 정렬 반영(데이터 교체)
    routeFromHash();   // 공유 링크(#p{id})로 들어왔으면 데이터 준비된 지금 상세 열기
  });
  table.on("rowClick", (e, row) => {
    const star = e.target.closest(".fav-star");
    if (star) { toggleFav(row.getData()); star.classList.toggle("on", isFav(row.getData())); return; }
    openDetail(row.getData());
  });
}

// ---- 필터 ----------------------------------------------------------
function matchRow(data) {
  if (filterState.category && productGroup(data) !== filterState.category) return false;
  if (filterState.lifecycle && statusKey(data) !== filterState.lifecycle) return false;
  if (filterState.favOnly && !isFav(data)) return false;
  if (filterState.search) {
    // NFC 정규화(엑셀/네이버 유래 분해형 한글 "런 업" 검색 실패 방지) + 공백단위 토큰 AND 매칭.
    // 내부 키(__id, Tabulator _fav 등)는 검색 대상에서 제외.
    const hay = Object.entries(data)
      .filter(([k]) => k[0] !== "_")
      .map(([, v]) => searchNorm(v)).join(" ");
    const hayNS = hay.replace(/\s+/g, "");   // 공백 무시 매칭용 ("런업"으로 "런 업" 검색)
    const tokens = searchNorm(filterState.search).split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => hay.includes(t) || hayNS.includes(t.replace(/\s+/g, "")))) return false;
  }
  for (const f of facetCols) {
    const val = filterState.facets[f.key];
    if (val && !facetValues(data, f).some((v) => normKey(v) === normKey(val))) return false;
  }
  if (filterState.stock && colKeys.stock) {
    if (stockClass(data[colKeys.stock]) !== filterState.stock) return false;
  }
  return true;
}

function applyFilters() {
  if (!table) return;
  table.refreshFilter();
  renderStats();
  updateFilterCount();
  if (viewMode === "gallery") renderGallery();
  updateFilterHash();
}

// ---- 정렬 ----------------------------------------------------------
// 사이즈 정렬용: 첫 mm 숫자(없으면 맨 뒤로). 색상수/상태는 기존 헬퍼 재사용.
function mmNum(r) {
  const sf = facetCols.find((f) => f.derive === "mm");
  const v = sf ? (firstMm(r[sf.key]) || firstMm(rowTitle(r))) : firstMm(rowTitle(r));
  const n = parseInt(v, 10);
  return isFinite(n) ? n : 9999;
}
// 가격 정렬용: 숫자 가격(없으면 null → 오름/내림 모두 맨 뒤로).
function priceNum(r) {
  const raw = colKeys.price ? String(r[colKeys.price] ?? "").trim() : "";
  if (raw === "") return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return isFinite(n) ? n : null;
}
// 가격 없는 상품은 방향과 무관하게 맨 뒤 (품절/미정 상품이 맨 위 차지 방지)
function priceCmp(a, b, dir) {
  const x = priceNum(a), y = priceNum(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return (x - y) * dir;
}
// allRows 를 정렬한 새 배열. key="" 면 기본 순서(사진 있는 순, allRows 그대로).
function sortedRows(rows, key) {
  const arr = rows.slice();
  const cmp = {
    name:   (a, b) => String(rowTitle(a)).localeCompare(String(rowTitle(b)), "ko"),
    priceAsc:  (a, b) => priceCmp(a, b, 1),
    priceDesc: (a, b) => priceCmp(a, b, -1),
    size:   (a, b) => mmNum(a) - mmNum(b),
    colors: (a, b) => colorCountOf(b) - colorCountOf(a),
    status: (a, b) => STATUS_ORDER.indexOf(statusKey(a)) - STATUS_ORDER.indexOf(statusKey(b)),
  }[key];
  if (!cmp) return arr;                       // 기본: 원본(사진 있는 순) 유지
  // 안정 정렬(동점이면 원래 순서 유지)
  return arr.map((r, i) => [r, i]).sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map((p) => p[0]);
}
function applySort() {
  if (!table) return;
  table.replaceData(sortedRows(allRows, filterState.sort)).then(() => {
    renderStats();
    if (viewMode === "gallery") renderGallery();
    updateFilterHash();
  });
}

// 활성 필터 개수(facet+재고) → 모바일 "필터" 버튼 배지
function activeFilterCount() {
  let n = 0;
  for (const v of Object.values(filterState.facets)) if (v) n++;
  if (filterState.stock) n++;
  return n;
}
function updateFilterCount() {
  renderActiveChips();
  const n = activeFilterCount();
  const badge = $("filterCount");
  const btn = $("btnFilters");
  if (!badge || !btn) return;
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
  btn.classList.toggle("active", n > 0);
}

// ---- 적용 중 필터 칩 (본문 상단, 개별 ✕ 해제) -----------------------
const STOCK_LABEL = { out: "품절", low: "재고부족", ok: "정상" };
function chipItems() {
  const items = [];
  if (filterState.search) items.push({ t: "search", label: `검색 “${filterState.search}”` });
  if (filterState.category) items.push({ t: "category", label: catMeta(filterState.category).label });
  if (filterState.lifecycle && STATUS_DEF[filterState.lifecycle])
    items.push({ t: "lifecycle", label: STATUS_DEF[filterState.lifecycle].label });
  if (filterState.favOnly) items.push({ t: "fav", label: "★ 즐겨찾기만" });
  for (const f of facetCols) {
    const v = filterState.facets[f.key];
    if (!v) continue;
    const disp = (f.label === "호환" || f.label === "기종") ? connUniversalLabel(v) : v;
    items.push({ t: "facet", key: f.key, label: `${f.label}: ${disp}` });
  }
  if (filterState.stock) items.push({ t: "stock", label: `재고: ${STOCK_LABEL[filterState.stock] || filterState.stock}` });
  return items;
}
function renderActiveChips() {
  const bar = $("activeChips");
  if (!bar) return;
  const items = chipItems();
  bar.classList.toggle("hidden", items.length === 0);
  if (!items.length) { bar.innerHTML = ""; return; }
  // 결과 개수 — 모바일에선 사이드바 통계가 안 보여서 여기서 알려줌
  const n = table ? table.getData("active").length : null;
  bar.innerHTML = (n != null ? `<span class="achip-count">${n.toLocaleString("ko-KR")}개 표시 중</span>` : "") + items.map((c) =>
    `<span class="achip"><span class="achip-l">${esc(c.label)}</span>
      <button class="achip-x" data-t="${c.t}" data-key="${esc(c.key || "")}" aria-label="${esc(c.label)} 해제">✕</button></span>`
  ).join("") + (items.length >= 2 ? `<button class="achip-clear" id="achipClear">전체 해제</button>` : "");
}
function removeChip(t, key) {
  if (t === "search") { filterState.search = ""; $("search").value = ""; }
  else if (t === "category") { filterState.category = ""; renderCatNav(); }
  else if (t === "lifecycle") filterState.lifecycle = "";
  else if (t === "fav") { filterState.favOnly = false; updateFavUI(); }
  else if (t === "stock") { filterState.stock = ""; $("stockFilter").value = ""; }
  else if (t === "facet") {
    filterState.facets[key] = "";
    document.querySelectorAll("select.facet-select").forEach((s) => { if (s.dataset.key === key) s.value = ""; });
  }
  applyFilters();
}
// 필터에 걸리는 모든 조건 해제 (정렬·뷰모드는 유지 — goHome과 다름)
function resetAllFilters() {
  filterState.search = "";
  filterState.stock = "";
  filterState.category = "";
  filterState.lifecycle = "";
  filterState.favOnly = false;
  for (const k of Object.keys(filterState.facets)) filterState.facets[k] = "";
  $("search").value = "";
  $("stockFilter").value = "";
  document.querySelectorAll("select.facet-select").forEach((s) => (s.value = ""));
  updateFavUI();
  renderCatNav();
  applyFilters();
}
window._resetFilters = resetAllFilters; // Tabulator placeholder(문자열 HTML)의 onclick에서 사용

// ---- 필터 상태 ↔ URL 해시 (#f=…) ------------------------------------
// 새로고침해도 필터 유지 + "필터된 목록" 자체를 링크로 공유 가능.
// 상세(#p{id})와 해시를 나눠 쓴다: 상세가 열리면 #p가 우선, 닫히면 #f 복원.
function filtersToHash() {
  const p = new URLSearchParams();
  if (filterState.search) p.set("q", filterState.search);
  if (filterState.category) p.set("cat", filterState.category);
  if (filterState.lifecycle) p.set("st", filterState.lifecycle);
  if (filterState.favOnly) p.set("fav", "1");
  if (filterState.stock) p.set("stock", filterState.stock);
  if (filterState.sort) p.set("sort", filterState.sort);
  for (const f of facetCols) {
    const v = filterState.facets[f.key];
    if (v) p.set(f.label, v);   // 키는 facet 라벨(기종/재질…) — 사람이 읽어도 뜻이 보임
  }
  const s = p.toString();
  return s ? "#f=" + s : "";
}
// 히스토리 항목을 쌓지 않고(replaceState) 현재 주소만 갱신 — 뒤로가기가 필터 단계를 되감지 않게
function updateFilterHash() {
  if (_openId != null || /^#p/.test(location.hash)) return;  // 상세 해시가 점유 중
  const want = filtersToHash();
  if ((location.hash || "") === want) return;
  history.replaceState(null, "", location.pathname + location.search + want);
}
// 진입/새로고침 시 #f=… 를 filterState + UI(입력창·셀렉트)에 복원. 복원했으면 true.
function restoreFiltersFromHash() {
  const m = (location.hash || "").match(/^#f=(.+)$/);
  if (!m) return false;
  let p;
  try { p = new URLSearchParams(m[1]); } catch (e) { return false; }
  filterState.search = p.get("q") || "";
  filterState.category = p.get("cat") || "";
  filterState.lifecycle = p.get("st") || "";
  filterState.favOnly = p.get("fav") === "1";
  filterState.stock = p.get("stock") || "";
  filterState.sort = p.get("sort") || "";
  for (const f of facetCols) filterState.facets[f.key] = p.get(f.label) || "";
  $("search").value = filterState.search;
  $("stockFilter").value = filterState.stock;
  const ss = $("sortSelect"); if (ss) ss.value = filterState.sort;
  document.querySelectorAll("select.facet-select").forEach((s) => { s.value = filterState.facets[s.dataset.key] || ""; });
  return true;
}

function clearFilters() {
  filterState.search = "";
  filterState.stock = "";
  for (const k of Object.keys(filterState.facets)) filterState.facets[k] = "";
  $("search").value = "";
  $("stockFilter").value = "";
  document.querySelectorAll("select.facet-select").forEach((s) => (s.value = ""));
  applyFilters();
}

// 제목 클릭 = 홈: 모든 필터/검색/카테고리/정렬/즐겨찾기 초기화 + 맨 위로 (새로고침 없이)
function goHome() {
  filterState.search = "";
  filterState.stock = "";
  filterState.category = "";
  filterState.lifecycle = "";
  filterState.sort = "";
  filterState.favOnly = false;
  for (const k of Object.keys(filterState.facets)) filterState.facets[k] = "";
  $("search").value = "";
  $("stockFilter").value = "";
  const ss = $("sortSelect"); if (ss) ss.value = "";
  document.querySelectorAll("select.facet-select").forEach((s) => (s.value = ""));
  closeDetail();
  closeSidebar();
  updateFavUI();
  updateFilterCount();
  renderCatNav();
  applySort();   // 기본 정렬로 복원 + 필터 재적용 + 통계·갤러리 갱신
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- 통계 ----------------------------------------------------------
function renderStats() {
  const active = table ? table.getData("active") : allRows;
  const ko = (n) => n.toLocaleString("ko-KR");
  const counts = {};
  for (const r of allRows) { const k = statusKey(r); counts[k] = (counts[k] || 0) + 1; }
  const filtering = active.length !== allRows.length;

  const cards = [];
  if (filtering) cards.push({ label: "표시 중", value: ko(active.length), vcls: "brand" });
  cards.push({ label: "전체", value: ko(allRows.length), life: "" });
  for (const k of STATUS_ORDER) {
    if (counts[k]) cards.push({ label: STATUS_DEF[k].label, value: ko(counts[k]), life: k, vcls: STATUS_DEF[k].cls });
  }

  $("stats").innerHTML = cards.map((c) => {
    const click = c.life !== undefined;
    const on = click && filterState.lifecycle === c.life;
    return `<div class="stat-card${click ? " clickable" : ""}${on ? " active" : ""}"${click ? ` data-life="${esc(c.life)}"` : ""}>` +
      `<div class="label">${c.label}</div><div class="value ${c.vcls || ""}">${c.value}</div></div>`;
  }).join("") +
    // 통계 오른쪽: 즐겨찾기만 보기 토글 (데스크톱; 모바일은 토바 ★)
    `<button class="stat-fav${filterState.favOnly ? " active" : ""}" id="statFav" title="즐겨찾기만 보기">
       <span class="sf-star">★</span><span class="sf-txt">즐겨찾기</span><span class="sf-n">${favs.size}</span>
     </button>`;

  $("stats").querySelectorAll(".stat-card.clickable").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.dataset.life;
      filterState.lifecycle = v;          // 전체="" / 진행 / 단종
      applyFilters();
    });
  });
  const sf = $("statFav");
  if (sf) sf.addEventListener("click", () => {
    filterState.favOnly = !filterState.favOnly;
    updateFavUI();
    applyFilters();
  });
}

// ---- 제품 카테고리 (스트랩 / 케이스 / 액세서리) --------------------
//  "케이스는 케이스끼리, 스트랩은 스트랩끼리" — 사이드바에서 종류별로 본다.
function materialKey() {
  const f = facetCols.find((x) => x.label === "재질");
  return f ? f.key : null;
}
function productCategory(r) {
  const name = rowTitle(r);
  const mk = materialKey();
  const mat = mk ? String(r[mk] || "") : "";
  if (/케이스|범퍼|액정|글라스|보호\s?필름|필름/.test(name) || ["강화유리", "사생활 강화유리"].includes(mat)) return "케이스";
  if (/충전|케이블|어댑터|거치|클리너|공구|USB/i.test(name)) return "액세서리";
  return "스트랩";
}
// 사이드바 카테고리 그룹: 공용은 "Nmm 일반형", 그 외는 기종 값.
function productGroup(r) {
  // 미밴드10 SET 은 미밴드와 별도 카테고리 (사이드바 레퍼런스 기준)
  if (/미밴드10\s*SET/i.test(String(r["기종"] || ""))) return "미밴드10 SET";
  // 호환(커넥터) 기준 그룹. 공용은 베이스규격(20/22mm)으로 쪼갬.
  const conn = String(r["호환"] || "").trim();
  if (conn) {
    if (/공용|공통|범용/.test(conn)) {
      const bs = firstMm(String(r["베이스규격"] || "")) || firstMm(String(r["규격"] || "")) || firstMm(rowTitle(r));
      return bs ? `${bs} 일반형` : "공용";
    }
    return conn;
  }
  // 호환 필드 없으면(CSV/DEMO) 기종 기준 폴백
  const modelKey = facetCols[0] && facetCols[0].key;
  const model = modelKey ? String(r[modelKey] || "").trim() : "";
  if (!model || /공용|공통|범용/.test(model)) {
    const sf = facetCols.find((f) => f.derive === "mm");
    const mm = sf ? (firstMm(r[sf.key]) || firstMm(rowTitle(r))) : "";
    return mm ? `${mm} 일반형` : (model || "기타");
  }
  return model;
}
// 카테고리 표시정보: DB categories 우선, 없으면 config, 그것도 없으면 그룹값/개수순
function catMeta(g) {
  const c = categoryCfg[g];
  if (c) return { label: c.label || g, sort: (c.sort != null ? c.sort : null), visible: c.visible !== false };
  const order = CONFIG.CATEGORY_ORDER || [];
  const labels = CONFIG.CATEGORY_LABELS || {};
  const i = order.indexOf(g);
  return { label: labels[g] || g, sort: i === -1 ? null : i, visible: true };
}
function renderCatNav() {
  const nav = $("catNav");
  if (!nav) return;
  const counts = {};
  for (const r of allRows) { const g = productGroup(r); counts[g] = (counts[g] || 0) + 1; }
  const order = CONFIG.CATEGORY_ORDER || [];
  let groups;
  if (CONFIG.CATEGORY_STRICT && order.length) {
    // config 지정 카테고리 + admin이 추가한 DB 전용 카테고리(categoryCfg). 노출된 것만.
    // 순서: 저장된 DB sort 우선, 없으면 config 순서. → admin 추가/순서/노출이 반영됨.
    const cfgIdx = (g) => { const i = order.indexOf(g); return i < 0 ? 9999 : i; };
    groups = [...new Set([...order, ...Object.keys(categoryCfg)])]
      // 손님 뷰에선 0개 카테고리 숨김(클릭해도 빈 결과 → 데모에서 고장처럼 보임).
      // 상품이 들어오면 자동 재등장. placeholder 자리잡기 의도는 admin 관리화면에서 유지.
      .filter((g) => catMeta(g).visible && (counts[g] || 0) > 0)
      .sort((a, b) => {
        const sa = catMeta(a).sort, sb = catMeta(b).sort;
        const va = (sa != null) ? sa : cfgIdx(a);
        const vb = (sb != null) ? sb : cfgIdx(b);
        return va - vb || cfgIdx(a) - cfgIdx(b);
      });
  } else {
    // DB categories(admin 관리) > config CATEGORY_ORDER/LABELS > 개수 많은 순
    groups = Object.keys(counts)
      .filter((g) => catMeta(g).visible)
      .sort((a, b) => {
        const sa = catMeta(a).sort, sb = catMeta(b).sort;
        if (sa != null || sb != null) { if (sa == null) return 1; if (sb == null) return -1; return sa - sb; }
        return counts[b] - counts[a] || a.localeCompare(b, "ko");
      });
  }
  const items = [["", "전체 카테고리", allRows.length]].concat(groups.map((g) => [g, catMeta(g).label, counts[g] || 0]));
  nav.innerHTML = items.map(([val, label, n]) => {
    const on = (filterState.category || "") === val;
    return `<button class="cat-item${on ? " active" : ""}" data-cat="${esc(val)}">
      <span class="lbl">${esc(label)}</span><span class="cnt">${n.toLocaleString("ko-KR")}</span>
    </button>`;
  }).join("");
  nav.querySelectorAll(".cat-item").forEach((el) => {
    el.addEventListener("click", () => {
      filterState.category = el.dataset.cat;
      filterState.favOnly = false;   // 카테고리로 둘러보기 = 즐겨찾기 모드 해제
      updateFavUI();
      nav.querySelectorAll(".cat-item").forEach((x) => x.classList.toggle("active", x === el));
      applyFilters();
      closeSidebar();
    });
  });
}

// 사이드바 드로어(모바일)
function toggleSidebar() {
  const open = $("sidebar").classList.toggle("open");
  $("sidebarBackdrop").classList.toggle("open", open);
  const b = $("btnFilters"); if (b) b.setAttribute("aria-expanded", open ? "true" : "false");
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarBackdrop").classList.remove("open");
  const b = $("btnFilters"); if (b) b.setAttribute("aria-expanded", "false");
}

// ---- 갤러리 뷰 ------------------------------------------------------
function rowTitle(r) {
  return colKeys.name ? r[colKeys.name] : (r[headersAll[0]] || "");
}

function renderGallery() {
  const rows = table ? table.getData("active") : allRows;
  const g = $("gallery");
  // ▼ 점진 렌더: 상품이 많아도(600+) 첫 화면은 60개만 그리고, 스크롤하면 이어서 그림.
  //   (전체를 한 번에 DOM으로 만들면 검색/필터마다 수백 ms 걸려 느려짐)
  galleryRows = rows;
  galleryPos = 0;
  bindGalleryEvents(g);
  // 0건: 백지 대신 안내 + 초기화 버튼 (고장으로 오해 방지)
  if (!rows.length) {
    if (galleryIO) galleryIO.disconnect();
    g.innerHTML = emptyStateHTML();
    return;
  }
  g.innerHTML = `<div id="gallerySentinel" class="gallery-sentinel" aria-hidden="true"></div>`;
  appendGalleryChunk();
  setupGalleryObserver();
}

const GALLERY_CHUNK = 60;
let galleryRows = [];
let galleryPos = 0;
let galleryIO = null;

function cardHTML(r, i) {
  const sizeFacet = facetCols.find((f) => f.derive === "mm");
  const img = colKeys.image ? r[colKeys.image] : "";
  const mf = facetCols.find((f) => f.label === "기종") || facetCols[0];
  const model = mf ? String(r[mf.key] || "").trim() : "";
  const size = firstMm(r["규격"]) || firstMm(r["베이스규격"]) || (sizeFacet && firstMm(r[sizeFacet.key])) || firstMm(rowTitle(r)) || "";
  const cc = colorCountOf(r);
  const price = colKeys.price ? String(r[colKeys.price] || "").trim() : "";
  // 호환(커넥터) 기준: 공용/범용 = 결합형, 그 외 = 기종 전용 (필드 직접 참조 — facet 구성과 무관)
  const connVal = String(r["호환"] || "").trim();
  const universal = !connVal || /공용|공통|범용/.test(connVal);
  // ③ 기종 태그: 기종(model) 값 기준. 특정 기종=청록(⌚ 모델명), 공용/빈값=회색(↔ 공용 mm)
  const modelUniversal = !model || /공용|공통|범용/.test(model);
  const devTag = modelUniversal
    ? `<span class="ctag t-common">↔ 공용${size ? ` ${esc(size)}` : ""}</span>`
    : `<span class="ctag t-device">⌚ ${esc(model)}</span>`;
  // ⑤ 스펙 스트립: 커넥터(형태) / 구조(스트랩형태: 결합형·기본형) / 규격
  const stField = String(r["스트랩형태"] || "").trim();
  const isConn = stField ? /결합|연결/.test(stField) : universal;
  const shapeVal = String(r["형태"] || "").trim();           // 일반형/날개형
  const connName = shapeVal
    || (/러그/.test(connVal) ? "러그형" : /날개/.test(connVal) ? "날개형" : /원클릭/.test(connVal) ? "원클릭" : /원터치/.test(connVal) ? "원터치" : (universal ? "일반형" : "-"));
  const structName = isConn ? "결합형" : "기본형";
  const specStrip = `<div class="spec-strip">
      <div class="ss-cell ss-struct"><div class="ss-l">구조</div><div class="ss-v">${esc(structName)}</div></div>
      <div class="ss-cell ss-conn"><div class="ss-l">커넥터</div><div class="ss-v">${esc(connName)}</div></div>
      <div class="ss-cell ss-size"><div class="ss-l">규격</div><div class="ss-v">${esc(size || "-")}</div></div>
    </div>`;
  // ⑥ 바로가기: N 네이버 / C 쿠팡 / F 플로우 / B 1688
  const naver = String(r["네이버스토어"] || "").trim();
  const coupang = String(r["쿠팡링크"] || "").trim();
  const flow = String(r["플로우링크"] || "").trim();
  const src = String(r["구매링크"] || "").trim();
  const qb = (cls, ch, url) => `<a class="qb ${cls}${url ? "" : " off"}" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'} onclick="event.stopPropagation()">${ch}</a>`;
  return `<div class="card" data-i="${i}">
    <button class="card-fav${isFav(r) ? " on" : ""}" data-i="${i}" aria-label="즐겨찾기">${isFav(r) ? "★" : "☆"}</button>
    ${img ? `<img class="thumb" src="${esc(thumbUrl(img))}" data-full="${esc(img)}" onerror="this.onerror=null;this.src=this.dataset.full" loading="lazy" alt="">`
          : '<div class="thumb"></div>'}
    <div class="body">
      <div class="card-chips">${devTag}</div>
      <div class="name">${esc(rowTitle(r))}</div>
      ${specStrip}
      <div class="card-foot">
        ${cc ? `<span class="cc-badge">🎨 ${cc}</span>` : ""}
        ${price ? `<span class="card-price">${esc(won(price))}</span>` : ""}
      </div>
      <div class="qbar">
        ${qb("qn", "N", naver)}${qb("qc", "C", coupang)}${qb("qf", "F", flow)}${qb("qb2", "B", src)}
        <button class="qb qpal" data-i="${i}" title="중국 컬러차트 복사">🎨</button>
      </div>
    </div>
  </div>`;
}

function appendGalleryChunk() {
  const s = $("gallerySentinel");
  if (!s) return;
  const end = Math.min(galleryPos + GALLERY_CHUNK, galleryRows.length);
  if (galleryPos < end) {
    let html = "";
    for (let i = galleryPos; i < end; i++) html += cardHTML(galleryRows[i], i);
    s.insertAdjacentHTML("beforebegin", html);
    galleryPos = end;
  }
  s.style.display = galleryPos >= galleryRows.length ? "none" : "";
}

function setupGalleryObserver() {
  if (galleryIO) galleryIO.disconnect();
  const s = $("gallerySentinel");
  if (!s) return;
  if ("IntersectionObserver" in window) {
    galleryIO = new IntersectionObserver((es) => {
      es.forEach((en) => { if (en.isIntersecting) galleryLoadMore(); });
    }, { rootMargin: "1200px" });   // 바닥 오기 한참 전에 미리 그려서 끊김 없음
    galleryIO.observe(s);
  }
  // 폴백: IO가 안 도는 브라우저/웹뷰용 스크롤 감지 (1회만 등록)
  if (!window._gScrollBound) {
    window._gScrollBound = true;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; galleryLoadMore(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }
  galleryLoadMore();   // 첫 화면이 큰 모니터면 즉시 이어 그림
}
// sentinel이 화면 근처(1200px 이내)면 필요한 만큼 청크 추가
function galleryLoadMore() {
  const s = $("gallerySentinel");
  if (!s || viewMode !== "gallery") return;
  let guard = 0;
  while (galleryPos < galleryRows.length && guard++ < 20) {
    const rect = s.getBoundingClientRect();
    if (rect.top > innerHeight + 1200) break;
    appendGalleryChunk();
  }
}

// 갤러리 클릭 이벤트: 컨테이너에 1번만 위임(카드 수백 개에 리스너 안 붙임)
function bindGalleryEvents(g) {
  if (g._bound) return;
  g._bound = true;
  g.addEventListener("click", (e) => {
    const fav = e.target.closest(".card-fav");
    if (fav) {
      e.stopPropagation();
      const r = galleryRows[Number(fav.dataset.i)];
      const on = toggleFav(r);
      fav.classList.toggle("on", on);
      fav.textContent = on ? "★" : "☆";
      return;
    }
    const pal = e.target.closest(".qpal");
    if (pal) {
      e.stopPropagation();
      showColorPopup(galleryRows[Number(pal.dataset.i)], pal);   // 팔레트 → 컬러 팝업 "뿅"
      return;
    }
    if (e.target.closest(".qb")) return;   // 외부 링크는 기본 동작
    const card = e.target.closest(".card");
    if (card) openDetail(galleryRows[Number(card.dataset.i)]);
  });
}

// ---- 컬러 팝업 (카드 🎨 클릭 → 색상 스와치+컬러차트 "뿅") ----------
let _colorPop = null;
function closeColorPopup() {
  if (!_colorPop) return;
  _colorPop.remove(); _colorPop = null;
  document.removeEventListener("mousedown", _colorPopOutside, true);
  document.removeEventListener("keydown", _colorPopEsc, true);
  window.removeEventListener("scroll", closeColorPopup, true);
}
function _colorPopOutside(e) { if (_colorPop && !_colorPop.contains(e.target) && !e.target.closest(".qpal")) closeColorPopup(); }
function _colorPopEsc(e) { if (e.key === "Escape") closeColorPopup(); }
function showColorPopup(r, anchor) {
  closeColorPopup();
  const cc = colorCountOf(r);
  const colorFacet = facetCols.find((f) => f.derive === "color");
  const colorRaw = colorFacet ? String(r[colorFacet.key] || "").trim() : "";
  const buckets = colorBuckets(colorRaw);
  const hex = CONFIG.COLOR_HEX || {};
  const chart = String(r.__colorChart || "").trim();
  if (!buckets.length && !colorRaw && !chart) { showToast("등록된 컬러차트/색상이 없습니다"); return; }
  const pop = document.createElement("div");
  pop.className = "color-pop";
  pop.innerHTML =
    `<div class="cp-head">🎨 ${cc ? `색상 ${cc}종` : "색상"}</div>` +
    (buckets.length ? `<div class="cp-sw">${buckets.map((c) =>
      `<span class="cp-chip"><span class="cp-dot" style="background:${hex[c] || "#ccc"}"></span>${esc(c)}</span>`).join("")}</div>` : "") +
    (colorRaw && !buckets.length ? `<div class="cp-list">${esc(colorRaw)}</div>` : "") +
    (chart ? `<img class="cp-chart" src="${esc(chart)}" alt="컬러차트" title="클릭하면 이미지 복사">
              <button class="cp-copy">📋 차트 이미지 복사 (발주용)</button>` : "");
  document.body.appendChild(pop);
  // 앵커(팔레트 버튼) 위에 띄우되, 위 공간 없으면 아래로. 화면 밖으로 안 나가게 보정.
  const b = anchor.getBoundingClientRect();
  const M = 8, pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.max(M, Math.min(b.left + b.width / 2 - pw / 2, window.innerWidth - pw - M));
  let top = b.top - ph - 10, below = false;
  if (top < M) { top = b.bottom + 10; below = true; }                 // 위 공간 없으면 아래로
  top = Math.max(M, Math.min(top, window.innerHeight - ph - M));       // 뷰포트 안으로 클램프(넘침 방지)
  pop.style.left = left + "px"; pop.style.top = top + "px";
  pop.style.transformOrigin = below ? "top center" : "bottom center";
  void pop.offsetHeight;              // 강제 리플로우 → 초기(opacity0·scale) 확정 후 전이 재생(rAF 없이도 "뿅")
  pop.classList.add("show");
  const img = pop.querySelector(".cp-chart");
  if (img) img.addEventListener("click", () => copyImageToClipboard(chart));
  const cp = pop.querySelector(".cp-copy");
  if (cp) cp.addEventListener("click", () => copyImageToClipboard(chart));
  _colorPop = pop;
  setTimeout(() => {
    document.addEventListener("mousedown", _colorPopOutside, true);
    document.addEventListener("keydown", _colorPopEsc, true);
    window.addEventListener("scroll", closeColorPopup, true);
  }, 0);
}

function setView(mode) {
  viewMode = mode;
  $("btnTable").classList.toggle("active", mode === "table");
  $("btnGallery").classList.toggle("active", mode === "gallery");
  $("table").classList.toggle("hidden", mode !== "table");
  $("gallery").classList.toggle("hidden", mode !== "gallery");
  if (mode === "gallery") renderGallery();
}

// ---- 검색 자동완성 드롭다운 ----------------------------------------
function ensureSuggestBox() {
  let box = $("suggestBox");
  if (box) return box;
  box = document.createElement("div");
  box.id = "suggestBox";
  box.className = "suggest hidden";
  box.setAttribute("role", "listbox");
  const wrap = document.querySelector(".search-wrap");
  if (wrap) wrap.appendChild(box);
  return box;
}

function highlight(text, term) {
  text = String(text).normalize("NFC");
  const i = searchNorm(text).indexOf(searchNorm(term));
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + term.length)) +
    "</mark>" + esc(text.slice(i + term.length));
}

function renderSuggestions(term) {
  const box = ensureSuggestBox();
  term = String(term || "").trim();
  if (term.length < 1) return hideSuggest();
  const lc = searchNorm(term);
  const lcNS = lc.replace(/\s+/g, "");
  const matches = suggestItems
    .filter((s) => s.lc.includes(lc) || (s.lcNS || "").includes(lcNS))
    .sort((a, b) => {
      // 앞에서 일치(startsWith)를 우선
      const as = a.lc.startsWith(lc) ? 0 : 1;
      const bs = b.lc.startsWith(lc) ? 0 : 1;
      if (as !== bs) return as - bs;
      const an = a.type === "상품", bn = b.type === "상품";
      if (an !== bn) return an ? 1 : -1;
      return b.count - a.count;
    })
    .slice(0, 8);
  if (!matches.length) return hideSuggest();
  suggestSel = -1;
  box.innerHTML = matches.map((s, i) => {
    const tag = s.type === "상품" ? "" : `<span class="sg-tag">${esc(s.type)}</span>`;
    const cnt = `<span class="sg-cnt">${s.count}</span>`;
    return `<div class="sg-item" role="option" data-i="${i}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span class="sg-text">${highlight(s.text, term)}</span>${tag}${cnt}
    </div>`;
  }).join("");
  box._matches = matches;
  box.querySelectorAll(".sg-item").forEach((el) => {
    el.addEventListener("mousedown", (e) => { // mousedown: blur보다 먼저 실행
      e.preventDefault();
      chooseSuggest(matches[Number(el.dataset.i)]);
    });
  });
  box.classList.remove("hidden");
}

function hideSuggest() {
  const box = $("suggestBox");
  if (box) box.classList.add("hidden");
  suggestSel = -1;
}

// 후보 선택 → 상품명은 검색어로, 속성값은 해당 facet 필터로 적용
function chooseSuggest(item) {
  if (!item) return;
  if (item.key) {
    // 속성값: facet 드롭다운 설정 + 검색어 비움
    filterState.facets[item.key] = item.text;
    const sel = document.querySelector(`select.facet-select[data-key="${cssEsc(item.key)}"]`);
    if (sel) sel.value = item.text;
    filterState.search = "";
    $("search").value = "";
  } else {
    // 상품명: 검색어로
    filterState.search = item.text;
    $("search").value = item.text;
  }
  hideSuggest();
  applyFilters();
}

function cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
}

function moveSuggest(delta) {
  const box = $("suggestBox");
  if (!box || box.classList.contains("hidden")) return false;
  const items = box.querySelectorAll(".sg-item");
  if (!items.length) return false;
  suggestSel = (suggestSel + delta + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle("active", i === suggestSel));
  return true;
}

// ---- 비슷한 제품 찾기 (비주얼 비교용) ------------------------------
// 어디에나 붙는 범용 단어는 유사도 판단에서 제외 (이것 때문에 '안 비슷한' 결과가 섞였음)
const SIM_STOPWORDS = new Set(["스트랩", "밴드", "호환", "워치", "시계줄", "손목", "용"]);
function nameTokens(s) {
  return new Set(String(s || "").split(/\s+/).filter((t) => t.length > 1 && !SIM_STOPWORDS.has(t)));
}
// 큐레이션 학습: 직접 추가된 쌍들의 라인(베이스그룹) 조합을 집계 →
// "이 라인을 보던 사람에게 저 라인을 붙여줬다"는 이력이 있으면 같은 라인 조합에 가점
let _lineAff = null, _lineAffN = -1;
function lineAffinity() {
  if (_lineAff && _lineAffN === allRows.length) return _lineAff;
  const byId = {};
  allRows.forEach((x) => { if (x.__id) byId[x.__id] = x; });
  const m = {};
  allRows.forEach((a) => {
    (a.__related || []).forEach((id) => {
      const b = byId[id]; if (!b) return;
      const ka = String(a["베이스그룹"] || "").trim(), kb = String(b["베이스그룹"] || "").trim();
      if (!ka || !kb || ka === kb) return;
      m[ka + "→" + kb] = (m[ka + "→" + kb] || 0) + 1;
      m[kb + "→" + ka] = (m[kb + "→" + ka] || 0) + 1;
    });
  });
  _lineAff = m; _lineAffN = allRows.length;
  return m;
}
function getSimilar(r, limit = 8, exclude = null) {
  const aff = lineAffinity();
  const myLine = String(r["베이스그룹"] || "").trim();
  const myMat = String(r["재질"] || "").trim();
  const myBuckle = String(r["체결"] || "").trim();
  const myShape = String(r["형태"] || "").trim();
  const mySize = firstMm(r["규격"]) || firstMm(r["베이스규격"]) || "";
  const baseTokens = nameTokens(rowTitle(r));
  // 자기 자신·제외 목록은 id 기준으로 배제 (데이터 갱신 뒤 객체가 바뀌어도 자신이 안 뜨게)
  const exIds = new Set([r.__id]);
  if (exclude) exclude.forEach((x) => { if (x && x.__id) exIds.add(x.__id); });
  const scored = [];
  for (const o of allRows) {
    if (o === r) continue;
    if (o.__id && exIds.has(o.__id)) continue;
    if (exclude && exclude.has(o)) continue;
    let s = 0;
    // 시각적 유사도(이미지 색상 지문): 색·패턴이 가까울수록 최대 +14 — 사진이 닮은 게 최우선
    if (r.__sig && o.__sig && o.__sig.length === r.__sig.length) {
      let diff = 0;
      for (let i = 0; i < r.__sig.length; i++) diff += Math.abs(r.__sig[i] - o.__sig[i]);
      const d = diff / r.__sig.length;              // 평균 색 차이 (0~255)
      if (d < 70) s += Math.round((1 - d / 70) * 14);
    }
    const oLine = String(o["베이스그룹"] || "").trim();
    if (myLine && oLine === myLine) s += 6;                       // 같은 라인(베이스 디자인)
    else if (myLine && oLine && aff[myLine + "→" + oLine]) s += Math.min(4, 1 + aff[myLine + "→" + oLine]);  // 큐레이션 학습 가점
    if (myMat && String(o["재질"] || "").trim() === myMat) s += 3;   // 재질(비주얼 결)
    if (myBuckle && String(o["체결"] || "").trim() === myBuckle) s += 2;
    if (myShape && String(o["형태"] || "").trim() === myShape) s += 1;
    const oSize = firstMm(o["규격"]) || firstMm(o["베이스규격"]) || "";
    if (mySize && oSize === mySize) s += 2;
    // 제품명 단어 겹침 (범용 단어 제외)
    const ot = nameTokens(rowTitle(o));
    let overlap = 0;
    baseTokens.forEach((t) => { if (ot.has(t)) overlap++; });
    s += overlap * 2;
    if (s >= 4) scored.push([s, o]);   // 낮은 점수(우연 일치)는 잘라 '안 비슷한' 결과 배제
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

// ---- 호환되는 다른 스트랩 (같은 기종 또는 같은 폭mm) ----------------
// 스트랩은 폭(20/22mm 등)·기종이 호환의 핵심. "내 시계에 맞는 다른 스트랩"을 제안.
function compatBasis(r) {
  const sizeFacet = facetCols.find((f) => f.derive === "mm");
  const modelKey = facetCols[0] && facetCols[0].key; // 첫 facet = 기종
  const myModel = modelKey ? String(r[modelKey] || "").trim() : "";
  const specific = myModel && !/공용|공통|범용|universal/i.test(myModel);
  const mySize = sizeFacet ? (firstMm(r[sizeFacet.key]) || firstMm(rowTitle(r))) : "";
  return { sizeFacet, modelKey, myModel, specific, mySize };
}
function getCompatible(r, limit = 6) {
  const { sizeFacet, modelKey, myModel, specific, mySize } = compatBasis(r);
  if (!specific && !mySize) return [];
  const baseTokens = nameTokens(rowTitle(r));
  const scored = [];
  for (const o of allRows) {
    if (o === r) continue;
    let s = 0;
    if (specific && modelKey && String(o[modelKey] || "").trim() === myModel) s += 2;
    if (mySize) {
      const os = sizeFacet ? (firstMm(o[sizeFacet.key]) || firstMm(rowTitle(o))) : "";
      if (os && os === mySize) s += 2;
    }
    if (s <= 0) continue;
    let overlap = 0; const ot = nameTokens(rowTitle(o));
    baseTokens.forEach((t) => { if (ot.has(t)) overlap++; });
    scored.push([s * 10 + overlap, o]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

// ---- 상세 보기 (탭형: 기본정보 / 컬러옵션 / 비슷한) -----------------
// 이전/다음 탐색용: 지금 화면에 보이는 순서(필터+정렬 반영) 그대로
function detailNavList() {
  if (viewMode === "gallery" && galleryRows.length) return galleryRows;
  return table ? table.getData("active") : allRows;
}
let _detailNav = false;   // ←/→ 탐색 중이면 해시를 replaceState로 (히스토리에 상품마다 안 쌓이게)

function openDetail(r, activeTab) {
  const img = colKeys.image ? r[colKeys.image] : "";
  const link = colKeys.link ? r[colKeys.link] : "";
  const coupangUrl = String(r["쿠팡링크"] || "").trim();
  const coupangStock = String(r["쿠팡재고"] || "").trim();
  const coupangSynced = String(r["쿠팡기준일"] || "").trim();
  const mf = facetCols.find((f) => f.label === "기종") || facetCols[0];
  const tf = facetCols.find((f) => f.label === "재질");
  const model = mf ? String(r[mf.key] || "").trim() : "";
  const material = tf ? String(r[tf.key] || "").trim() : "";
  const sf = facetCols.find((f) => f.derive === "mm");
  const size = sf ? (firstMm(r[sf.key]) || firstMm(rowTitle(r))) : "";
  const st = STATUS_DEF[statusKey(r)];
  const colorFacet = facetCols.find((f) => f.derive === "color");

  // ① 기본정보 스펙 표 (카드 스펙 스트립과 동일 어휘)
  const connVal = String(r["호환"] || "").trim();
  const universal = !connVal || /공용|공통|범용/.test(connVal);
  const stField = String(r["스트랩형태"] || "").trim();
  const isConn = stField ? /결합|연결/.test(stField) : universal;
  const shapeVal = String(r["형태"] || "").trim();
  const connName = shapeVal
    || (/러그/.test(connVal) ? "러그형" : /날개/.test(connVal) ? "날개형" : /원클릭/.test(connVal) ? "원클릭" : /원터치/.test(connVal) ? "원터치" : (universal ? "일반형" : "-"));
  const memoVal = String(r["메모"] || "").trim();
  const specRows = [
    ["구조", isConn ? "결합형" : "기본형"],
    ["커넥터", connName],
    ["규격", size || "-"],
    ["재질", material || "-"],
    ["고정 타입", String(r["체결"] || "").trim() || "-"],
  ];
  if (memoVal) specRows.push(["비고", memoVal]);
  const attrs = specRows.map(([k, v]) =>
    `<div class="attr"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");

  // ② 컬러 옵션
  const colorRaw = colorFacet ? String(r[colorFacet.key] || "").trim() : "";
  const buckets = colorBuckets(colorRaw);
  const hex = CONFIG.COLOR_HEX || {};
  const cc = colorCountOf(r);
  const swHtml = buckets.length ? `<div class="dc-swatches">${buckets.map((c) =>
    `<span class="dc-sw"><span class="swatch" style="background:${hex[c] || "#ccc"}"></span>${esc(c)}</span>`).join("")}</div>` : "";
  const chart = String(r.__colorChart || "").trim();
  const chartHtml = chart ? `<img class="color-chart" src="${esc(chart)}" alt="컬러 차트" loading="lazy">` : "";
  const colorPane = (chart || colorRaw || cc)
    ? `${chartHtml}${cc ? `<div class="detail-cc">🎨 색상 ${cc}종</div>` : ""}${swHtml}${colorRaw ? `<div class="dc-list">${esc(colorRaw)}</div>` : ""}`
    : `<div class="dpane-empty">등록된 색상 정보가 없습니다.</div>`;

  // ③ 비슷한 제품: 직접 추가(큐레이션) 우선 + 자동 추천
  const byId = {};
  allRows.forEach((x) => { if (x.__id) byId[x.__id] = x; });
  const curated = (r.__related || []).map((id) => byId[id]).filter(Boolean);
  const similar = getSimilar(r, 8, new Set([r, ...curated]));
  const reco = [...curated, ...similar];
  const adminMode = isAdminLoggedIn() && r.__id;
  const card = (o, ri, removable) => {
    const oi = colKeys.image ? o[colKeys.image] : "";
    const osub = facetCols.slice(0, 2).map((f) => o[f.key]).filter(Boolean).join(" · ");
    return `<div class="sim-card" data-ri="${ri}">
      ${removable ? `<button class="sim-del" data-id="${esc(o.__id)}" title="직접 추가 목록에서 빼기">✕</button>` : ""}
      ${oi ? `<img src="${esc(thumbUrl(oi))}" data-full="${esc(oi)}" onerror="this.onerror=null;this.src=this.dataset.full" loading="lazy" alt="">` : '<div class="sim-noimg"></div>'}
      <div class="sim-name">${esc(rowTitle(o))}</div><div class="sim-sub">${esc(osub)}</div></div>`;
  };
  const addHtml = adminMode
    ? `<div class="sim-add"><input id="simAddInput" placeholder="🔎 상품명 검색해서 직접 추가…" autocomplete="off"><div id="simAddResults" class="sim-add-results"></div></div>`
    : "";
  const curatedHtml = curated.length
    ? `<div class="similar-title">📌 직접 추가한 제품 ${curated.length}개</div><div class="similar-grid">${curated.map((o, i) => card(o, i, adminMode)).join("")}</div>`
    : "";
  const autoHtml = similar.length
    ? `<div class="similar-title">🔍 비슷한 디자인 ${similar.length}개</div><div class="similar-grid">${similar.map((o, i) => card(o, curated.length + i, false)).join("")}</div>`
    : (curated.length ? "" : `<div class="dpane-empty">비슷한 제품이 없습니다.</div>`);
  const simPane = addHtml + curatedHtml + autoHtml;

  const chips = [
    `<span class="dchip ${st.cls}">${st.label}</span>`,
    model ? `<span class="dchip">${esc(connUniversalLabel(model))}</span>` : "",
    size ? `<span class="dchip">${esc(size)}</span>` : "",
  ].filter(Boolean).join("");

  // 이전/다음 탐색 (현재 필터·정렬 순서 기준). Tabulator getData가 사본을 줄 수 있어 id로도 대조.
  const navList = detailNavList();
  let navIdx = navList.indexOf(r);
  if (navIdx < 0 && r.__id != null) navIdx = navList.findIndex((x) => x.__id != null && String(x.__id) === String(r.__id));
  const navHtml = (navIdx >= 0 && navList.length > 1) ? `
      <div class="detail-nav">
        <button class="dnav" id="btnDetailPrev" ${navIdx > 0 ? "" : "disabled"} aria-label="이전 상품">‹</button>
        <span class="dnav-pos">${navIdx + 1} / ${navList.length}</span>
        <button class="dnav" id="btnDetailNext" ${navIdx < navList.length - 1 ? "" : "disabled"} aria-label="다음 상품">›</button>
      </div>` : "";

  $("detail").innerHTML = `
    <div class="detail-tabbar">
      <div class="detail-tabs">
        <button class="dtab active" data-tab="info">기본 정보</button>
        <button class="dtab" data-tab="color">컬러 옵션</button>
        <button class="dtab" data-tab="similar">비슷한 제품</button>
      </div>${navHtml}
      <button class="dtab-close" id="btnCloseDetail" aria-label="닫기">✕</button>
    </div>
    <div class="detail-main">
      <div class="detail-imgcol">
        ${(() => {
          // 이미지 갤러리: 대표 + 중국/한국 컬러차트 + 추가 사진들 (있는 것만 썸네일로)
          const extras = Array.isArray(r.__extra) ? r.__extra.filter(Boolean) : [];
          const aerial = String(r.__aerial || "").trim();   // 구 항공뷰: 추가 사진에 아직 없으면 함께 표시
          const gal = [
            ["대표", img],
            ["중국 컬러차트", String(r.__colorChart || "").trim()],
            ["한국 컬러차트", String(r.__colorChartKr || "").trim()],
            ...(aerial && !extras.includes(aerial) ? [["추가", aerial]] : []),
            ...extras.map((u, i) => [`추가 ${i + 1}`, u]),
          ].filter(([, u]) => u);
          if (!gal.length) return '<div class="detail-img placeholder"></div>';
          const main = gal[0][1];
          const thumbs = gal.length > 1 ? `<div class="detail-thumbs">${gal.map(([label, u], i) =>
            `<img class="dthumb${i === 0 ? " on" : ""}" src="${esc(u)}" data-src="${esc(u)}" title="${esc(label)}" alt="${esc(label)}" loading="lazy">`).join("")}</div>` : "";
          return `<div class="detail-imgwrap" title="클릭하면 이미지 복사">
            <img class="detail-img" id="detailMainImg" src="${esc(main)}" alt="">
            <div class="detail-copyhint"><span>📋 클릭하면 이미지 복사</span></div>
          </div>${thumbs}`;
        })()}
        <button class="detail-fav2${isFav(r) ? " on" : ""}" id="btnDetailFav">★ 즐겨찾기</button>
        ${isAdminLoggedIn() && r.__id ? `<a class="detail-edit-btn" href="admin.html?edit=${encodeURIComponent(r.__id)}">✏️ 관리자 수정</a>` : ""}
      </div>
      <div class="detail-infocol">
        ${material ? `<div class="detail-eyebrow">${esc(material)}</div>` : ""}
        <h2 class="detail-title">${esc(rowTitle(r))}</h2>
        ${(() => {
          const yr = formatYM(r["출시년월"]);
          const pr = colKeys.price ? String(r[colKeys.price] || "").trim() : "";
          if (!yr && !pr) return "";
          return `<div class="detail-headline">
            ${pr ? `<span class="detail-price">${esc(won(pr))}</span>` : ""}
            ${yr ? `<span class="detail-year">${esc(yr)}</span>` : ""}
          </div>`;
        })()}
        <div class="detail-chips">${chips}</div>
        <div class="dpane" data-pane="info"><div class="attrs">${attrs}</div>
          ${coupangUrl && coupangStock !== "" ? `<div class="attr"><div class="k">쿠팡 재고</div><div class="v">${esc(coupangStock)}개${coupangSynced ? ` <span style="color:var(--muted);font-size:12px">(${esc(coupangSynced)} 기준)</span>` : ""}</div></div>` : ""}
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${link ? `<a class="store-btn naver" href="${esc(link)}" target="_blank" rel="noopener">네이버 스토어에서 보기 <span class="sb-arrow">↗</span></a>` : ""}
            ${coupangUrl ? `<a class="store-btn coupang" href="${esc(coupangUrl)}" target="_blank" rel="noopener">쿠팡에서 보기 <span class="sb-arrow">↗</span></a>` : ""}
          </div></div>
        <div class="dpane hidden" data-pane="color">${colorPane}</div>
        <div class="dpane hidden" data-pane="similar">${simPane}</div>
      </div>
    </div>`;

  const detail = $("detail");
  detail.querySelectorAll(".dtab").forEach((t) => {
    t.addEventListener("click", () => {
      detail.querySelectorAll(".dtab").forEach((x) => x.classList.toggle("active", x === t));
      detail.querySelectorAll(".dpane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== t.dataset.tab));
      const col = detail.querySelector(".detail-infocol"); if (col) col.scrollTop = 0;
    });
  });
  const dimg = detail.querySelector(".detail-imgwrap");
  const mainImg = detail.querySelector("#detailMainImg");
  if (dimg && mainImg) dimg.addEventListener("click", () => copyImageToClipboard(mainImg.src));
  // 썸네일 클릭 → 큰 이미지 교체
  detail.querySelectorAll(".dthumb").forEach((t) => t.addEventListener("click", () => {
    if (mainImg) mainImg.src = t.dataset.src;
    detail.querySelectorAll(".dthumb").forEach((x) => x.classList.toggle("on", x === t));
  }));
  $("btnCloseDetail").addEventListener("click", closeDetail);
  $("btnDetailFav").addEventListener("click", (e) => e.currentTarget.classList.toggle("on", toggleFav(r)));
  detail.querySelectorAll(".sim-card").forEach((el) => el.addEventListener("click", () => openDetail(reco[Number(el.dataset.ri)])));
  // 직접 추가(큐레이션) — 검색해서 추가
  const addInput = detail.querySelector("#simAddInput");
  if (addInput) {
    const results = detail.querySelector("#simAddResults");
    addInput.addEventListener("input", () => {
      const q = normKey(addInput.value);
      results.innerHTML = "";
      if (q.length < 2) return;
      const cur = new Set([String(r.__id), ...(r.__related || [])]);
      const hits = allRows.filter((o) => o.__id && !cur.has(o.__id) && normKey(rowTitle(o)).includes(q)).slice(0, 6);
      results.innerHTML = hits.length ? hits.map((o) => {
        const oi = colKeys.image ? o[colKeys.image] : "";
        return `<div class="sim-add-item" data-id="${esc(o.__id)}">${oi ? `<img src="${esc(oi)}" alt="">` : '<span class="sim-noimg-s"></span>'}<span>${esc(rowTitle(o))}</span><b>＋</b></div>`;
      }).join("") : `<div class="sim-add-empty">검색 결과 없음</div>`;
      results.querySelectorAll(".sim-add-item").forEach((el) => el.addEventListener("click", async () => {
        try {
          await saveRelated(r, [...(r.__related || []), el.dataset.id]);
          _lineAff = null;   // 큐레이션 학습 캐시 갱신
          showToast("직접 추가됨");
          openDetail(r, "similar");
        } catch (e) { showToast("저장 실패: " + e.message); }
      }));
    });
  }
  // 직접 추가 목록에서 빼기
  detail.querySelectorAll(".sim-del").forEach((el) => el.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await saveRelated(r, (r.__related || []).filter((id) => id !== el.dataset.id));
      _lineAff = null;
      openDetail(r, "similar");
    } catch (e2) { showToast("저장 실패: " + e2.message); }
  }));
  // 재오픈 시 탭 복원 (추가/삭제 후 비슷한 제품 탭 유지)
  if (activeTab) {
    const tb = detail.querySelector(`.dtab[data-tab="${activeTab}"]`);
    if (tb) tb.click();
  }
  // 이전/다음 버튼 + 스크롤 맨 위로
  const navTo = (i) => {
    const nr = navList[i];
    if (!nr) return;
    _detailNav = true;
    try { openDetail(nr); } finally { _detailNav = false; }
    detail.scrollTop = 0;
  };
  const pv = detail.querySelector("#btnDetailPrev");
  const nx = detail.querySelector("#btnDetailNext");
  if (pv) pv.addEventListener("click", () => navTo(navIdx - 1));
  if (nx) nx.addEventListener("click", () => navTo(navIdx + 1));

  detail.classList.remove("hidden");
  $("overlay").classList.remove("hidden");
  document.title = `${rowTitle(r)} — ${CONFIG.TITLE || "상품 카탈로그"}`;

  // 주소에 #p{id} 반영 → 링크 공유 + 뒤로가기로 상세 닫기. (id 없는 CSV/데모 행은 생략)
  _openId = r.__id != null ? String(r.__id) : null;
  if (_openId != null) {
    const want = "#p" + encodeURIComponent(_openId);
    if (location.hash !== want) {
      // ←/→ 넘기기는 항목 교체(replaceState) — 안 그러면 뒤로가기가 본 상품을 전부 되감음
      if (_detailNav && /^#p/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + want);
      else location.hash = want;   // 히스토리 항목 추가 → 뒤로가기=닫기
    }
  }
}

function closeDetail() {
  $("detail").classList.add("hidden");
  $("overlay").classList.add("hidden");
  _openId = null;
  document.title = CONFIG.TITLE || "상품 카탈로그";
  // 상세용 해시(#p…)만 제거(히스토리 항목 추가 없이). 필터 해시(#f…)는 되살림.
  if (/^#p/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + filtersToHash());
}

// 현재 주소 해시(#p{id})에 맞춰 상세를 열거나 닫는다. 뒤로/앞으로·공유링크 진입·최초 로드에 사용.
function productById(id) { id = String(id); return allRows.find((r) => r.__id != null && String(r.__id) === id); }
function routeFromHash() {
  const m = (location.hash || "").match(/^#p(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (id === _openId) return;              // 이미 그 상품이 열려 있음(우리가 방금 바꾼 해시) → 무시
    const r = productById(id);
    if (r) openDetail(r);                    // 데이터에 있으면 열기(없으면 아직 로드 전 → 렌더 후 재호출됨)
  } else if (_openId != null) {
    closeDetail();                           // 해시가 비면(뒤로가기 등) 상세 닫기
  }
}

// ---- 이벤트 바인딩 --------------------------------------------------
function init() {
  $("title").textContent = CONFIG.TITLE || "상품 카탈로그";
  document.title = CONFIG.TITLE || "상품 카탈로그";
  // 제목 클릭 → 홈(필터 초기화 + 맨 위로)
  const titleEl = $("title");
  if (titleEl) {
    titleEl.addEventListener("click", goHome);
    titleEl.setAttribute("role", "button");
    titleEl.setAttribute("tabindex", "0");
    titleEl.setAttribute("title", "홈으로 (필터 초기화)");
    titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); } });
  }

  let t;
  const searchEl = $("search");
  // 검색 버튼: 즉시 검색 실행
  const btnSearch = $("btnSearch");
  if (btnSearch) btnSearch.addEventListener("click", () => {
    clearTimeout(t);
    hideSuggest();
    filterState.search = searchEl.value.trim();
    applyFilters();
  });
  searchEl.addEventListener("input", (e) => {
    renderSuggestions(e.target.value);          // 자동완성은 즉시
    clearTimeout(t);
    t = setTimeout(() => { filterState.search = e.target.value.trim(); applyFilters(); }, 150);
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { if (moveSuggest(1)) e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (moveSuggest(-1)) e.preventDefault(); }
    else if (e.key === "Enter") {
      const box = $("suggestBox");
      if (box && !box.classList.contains("hidden") && suggestSel >= 0 && box._matches) {
        e.preventDefault(); chooseSuggest(box._matches[suggestSel]);
      } else { hideSuggest(); }
    } else if (e.key === "Escape") { hideSuggest(); }
  });
  searchEl.addEventListener("focus", (e) => { if (e.target.value.trim()) renderSuggestions(e.target.value); });
  searchEl.addEventListener("blur", () => setTimeout(hideSuggest, 120));
  $("stockFilter").addEventListener("change", (e) => {
    filterState.stock = e.target.value; applyFilters();
  });
  const sortSel = $("sortSelect");
  if (sortSel) sortSel.addEventListener("change", (e) => {
    filterState.sort = e.target.value; applySort();
  });
  $("btnClear").addEventListener("click", clearFilters);
  $("btnTable").addEventListener("click", () => setView("table"));
  $("btnGallery").addEventListener("click", () => setView("gallery"));

  // 즐겨찾기만 보기 토글 (사이드바 + 모바일 토바 버튼 둘 다)
  const toggleFavOnly = () => {
    filterState.favOnly = !filterState.favOnly;
    updateFavUI();
    applyFilters();
    closeSidebar();
  };
  ["btnFav", "btnFavTop"].forEach((id) => {
    const b = $(id); if (b) b.addEventListener("click", toggleFavOnly);
  });

  // 모바일: 사이드바(카테고리+필터) 드로어 열기/닫기
  $("btnFilters").addEventListener("click", toggleSidebar);
  $("sidebarBackdrop").addEventListener("click", closeSidebar);

  // 활성 필터 칩: ✕ 개별 해제 / 전체 해제 (위임 — 칩은 매번 다시 그려짐)
  const chipsBar = $("activeChips");
  if (chipsBar) chipsBar.addEventListener("click", (e) => {
    const x = e.target.closest(".achip-x");
    if (x) { removeChip(x.dataset.t, x.dataset.key); return; }
    if (e.target.closest("#achipClear")) resetAllFilters();
  });

  // 모바일은 표 뷰가 좁아 첫 컬럼만 보임 → 기본 갤러리
  if (window.matchMedia("(max-width: 640px)").matches) viewMode = "gallery";
  // 다크/라이트 테마 토글
  const themeIcon = () => { const b = $("btnTheme"); if (b) b.textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"; };
  themeIcon();
  if ($("btnTheme")) $("btnTheme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    themeIcon();
  });
  // 사이드바 토글 (데스크톱) — 헤더 버튼 + 사이드바 탭 둘 다
  const sidebarWrap = $("sidebarWrap");
  const collapseSidebar = () => {
    const collapsed = sidebarWrap.classList.toggle("collapsed");
    try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch(e) {}
  };
  if (sidebarWrap) {
    if (localStorage.getItem("sidebarCollapsed") === "1") sidebarWrap.classList.add("collapsed");
    const sidebarToggleBtn = $("btnSidebarToggle");
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener("click", collapseSidebar);
    const collapseTab = $("sidebarCollapseTab");
    if (collapseTab) collapseTab.addEventListener("click", collapseSidebar);
  }

  $("overlay").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDetail(); return; }
    // 상세 열려 있으면 ←/→ 로 이전/다음 상품 (입력 중일 땐 제외)
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !$("detail").classList.contains("hidden")) {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const b = $(e.key === "ArrowLeft" ? "btnDetailPrev" : "btnDetailNext");
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });
  // 모바일: 상세에서 좌우 스와이프 = 이전/다음 상품
  {
    const detEl = $("detail");
    let tx = 0, ty = 0;
    detEl.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    detEl.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) {
        const b = $(dx < 0 ? "btnDetailNext" : "btnDetailPrev");
        if (b && !b.disabled) b.click();
      }
    }, { passive: true });
  }
  // 맨 위로 버튼 (긴 목록 스크롤 복귀)
  const stBtn = $("btnScrollTop");
  if (stBtn) {
    stBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    window.addEventListener("scroll", () => stBtn.classList.toggle("hidden", window.scrollY < 800), { passive: true });
  }

  // 상세 링크 공유(#p{id}) 라우팅.
  // 공유 링크로 바로 진입한 경우, base 진입점을 히스토리에 깔아 뒤로가기=상세 닫기(사이트 이탈 아님)로 만든다.
  if (/^#p/.test(location.hash)) {
    const h = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    history.pushState(null, "", h);
  }
  window.addEventListener("hashchange", routeFromHash);   // 뒤로/앞으로·해시 변경 반영

  // ---- 자동 갱신 (관리자 저장/복귀 시 카탈로그 최신화) ----
  let lastRefresh = 0;
  const autoRefresh = () => {
    const now = Date.now();
    if (now - lastRefresh < 1500) return; // 과도한 연속 갱신 방지
    lastRefresh = now;
    softRefresh();
  };
  // ① 다른 탭(관리자)에서 저장하면 localStorage 신호 → 즉시 갱신
  window.addEventListener("storage", (e) => { if (e.key === "catalog_dirty") autoRefresh(); });
  // ② 카탈로그 탭으로 돌아오면 갱신
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoRefresh(); });
  window.addEventListener("focus", autoRefresh);

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
