// ===================================================================
//  워치 스트랩 카탈로그 — 메인 로직
//  구글시트(또는 sample-data.csv) → 검색/필터/정렬 + 클릭하면 상세(이미지+속성)
// ===================================================================

let table = null;        // Tabulator 인스턴스
let allRows = [];        // 원본 데이터
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

// 상품 상태 5종 (런칭 매트릭스와 동일 정의/색). active=진행/출시
const STATUS_DEF = {
  active:   { label: "출시", cls: "st-active" },
  planned:  { label: "기획", cls: "st-planned" },
  partial:  { label: "일부", cls: "st-partial" },
  sampling: { label: "샘플", cls: "st-sampling" },
  discont:  { label: "단종", cls: "st-discont" },
};
const STATUS_ORDER = ["active", "planned", "partial", "sampling", "discont"];
function statusKey(r) {
  const s = String(r["상태"] || "").trim();
  if (/단종|disc/i.test(s)) return "discont";
  if (/기획|계획|plan/i.test(s)) return "planned";
  if (/샘플|sampl/i.test(s)) return "sampling";
  if (/일부|부분|partial/i.test(s)) return "partial";
  return "active"; // 진행/출시/빈값
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
function facetValues(row, f) {
  let vals;
  if (f.derive === "mm") {
    const v = firstMm(row[f.key]) || firstMm(rowTitle(row));
    vals = v ? [v] : [];
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
  setStatus("데이터를 불러오는 중…");
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
//  먼저 categories(사이드바 순서/이름/노출) 로드 → 그다음 상품
function loadFromSupabase() {
  const s = CONFIG.SUPABASE;
  fetch(`${s.URL}/rest/v1/categories?select=key,label,sort,visible`, {
    headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${s.ANON_KEY}` },
  })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((cats) => {
      categoryCfg = {};
      (cats || []).forEach((c) => { categoryCfg[c.key] = { label: c.label || "", sort: c.sort, visible: c.visible !== false }; });
      // 표 컬럼 설정(순서/이름/노출) 로드 → 그다음 상품
      return fetch(`${s.URL}/rest/v1/column_config?select=key,label,sort,visible`, {
        headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${s.ANON_KEY}` },
      }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    })
    .then((cols) => {
      columnCfg = {};
      (cols || []).forEach((c) => { columnCfg[c.key] = { label: c.label || "", sort: c.sort, visible: c.visible !== false }; });
      loadProductsFromSupabase();
    });
}
function loadProductsFromSupabase() {
  const s = CONFIG.SUPABASE;
  const map = s.COLUMN_MAP || {};            // {영문컬럼: 한글헤더}
  const headers = Object.values(map);        // 표시 순서 = 매핑 순서
  const order = s.ORDER ? `&order=${encodeURIComponent(s.ORDER)}` : "";
  fetch(`${s.URL}/rest/v1/${s.TABLE || "products"}?select=*${order}`, {
    headers: { apikey: s.ANON_KEY, Authorization: `Bearer ${s.ANON_KEY}` },
  })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((data) => {
      const rows = (data || []).map((rec) => {
        const o = {};
        for (const [col, head] of Object.entries(map)) o[head] = rec[col] != null ? String(rec[col]) : "";
        if (rec.id != null) o.__id = String(rec.id);  // 즐겨찾기 고유키용(헤더 목록 밖이라 컬럼·검색엔 노출 안 됨)
        if (rec.color_chart != null) o.__colorChart = String(rec.color_chart);  // 컬러차트 이미지(헤더 밖 → 표/검색 비노출, 상세 컬러옵션 탭에서만 사용)
        return o;
      });
      ingest(headers, rows);
    })
    .catch((err) => {
      setStatus("Supabase 불러오기 실패: " + err.message +
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
      let rows = (data || []).map((rec) => {
        const o = {};
        for (const [col, head] of Object.entries(map)) o[head] = rec[col] != null ? String(rec[col]) : "";
        if (rec.id != null) o.__id = String(rec.id);  // 즐겨찾기 고유키용
        return o;
      }).filter((r) => Object.keys(r).some((k) => k !== "__id" && String(r[k]).trim() !== ""));
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
  // 쿠팡* 컬럼은 상세 드로어에서 전용 처리(버튼/재고) → 일반 특수컬럼(link/stock 등) 자동감지에서 제외.
  //  ("쿠팡링크"가 link 힌트 '링크'를, "쿠팡재고"가 stock 힌트 '재고'를 가로채는 것 방지)
  const detectHeaders = headers.filter((h) => !/^쿠팡/.test(h));
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
      facetCols.push({ label: f.label, key: c, derive: f.derive || null, exclude: f.exclude || null });
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
    else map.set(id, { text, lc: text.toLowerCase(), type, key, count: 1 });
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

function buildFacetDropdowns(rows) {
  const wrap = $("filters");
  // 기존 facet select 제거 (stockFilter / btnClear 는 유지)
  wrap.querySelectorAll("select.facet-select").forEach((e) => e.remove());
  const stockSel = $("stockFilter");
  for (const f of facetCols) {
    const sel = document.createElement("select");
    sel.className = "filter facet-select";
    sel.dataset.key = f.key;
    // 한 셀에 여러 값이면 쪼개서 각각을 옵션으로 (derive 적용)
    const set = new Set();
    rows.forEach((r) => facetValues(r, f).forEach((v) => set.add(v)));
    let vals = [...set];
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
  const connKey = (facetCols.find((f) => f.label === "호환") || {}).key;
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
    placeholder: "조건에 맞는 상품이 없습니다.",
  });

  table.on("tableBuilt", () => {
    table.setFilter(matchRow);
    renderStats();
    updateFilterCount();
    updateFavUI();
    renderCatNav();
    setView(viewMode); // 모바일 기본 갤러리 등 현재 뷰모드 반영
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
    const term = filterState.search.toLowerCase();
    // 내부 키(__id, Tabulator _fav 등)는 검색 대상에서 제외
    if (!Object.entries(data).some(([k, v]) => k[0] !== "_" && String(v).toLowerCase().includes(term)))
      return false;
  }
  for (const f of facetCols) {
    const val = filterState.facets[f.key];
    if (val && !facetValues(data, f).includes(val)) return false;
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
}

// ---- 정렬 ----------------------------------------------------------
// 사이즈 정렬용: 첫 mm 숫자(없으면 맨 뒤로). 색상수/상태는 기존 헬퍼 재사용.
function mmNum(r) {
  const sf = facetCols.find((f) => f.derive === "mm");
  const v = sf ? (firstMm(r[sf.key]) || firstMm(rowTitle(r))) : firstMm(rowTitle(r));
  const n = parseInt(v, 10);
  return isFinite(n) ? n : 9999;
}
// allRows 를 정렬한 새 배열. key="" 면 기본 순서(사진 있는 순, allRows 그대로).
function sortedRows(rows, key) {
  const arr = rows.slice();
  const cmp = {
    name:   (a, b) => String(rowTitle(a)).localeCompare(String(rowTitle(b)), "ko"),
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
  const n = activeFilterCount();
  const badge = $("filterCount");
  const btn = $("btnFilters");
  if (!badge || !btn) return;
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
  btn.classList.toggle("active", n > 0);
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
  const sizeFacet = facetCols.find((f) => f.derive === "mm");
  g.innerHTML = rows.map((r, i) => {
    const img = colKeys.image ? r[colKeys.image] : "";
    const mf = facetCols.find((f) => f.label === "기종") || facetCols[0];
    const tf = facetCols.find((f) => f.label === "재질");
    const model = mf ? String(r[mf.key] || "").trim() : "";
    const material = tf ? String(r[tf.key] || "").trim() : "";
    const size = sizeFacet ? (firstMm(r[sizeFacet.key]) || firstMm(rowTitle(r))) : "";
    const cc = colorCountOf(r);
    const price = colKeys.price ? String(r[colKeys.price] || "").trim() : "";
    const st = STATUS_DEF[statusKey(r)];
    return `<div class="card" data-i="${i}">
      ${st.cls !== "st-active" ? `<span class="card-status ${st.cls}">${st.label}</span>` : ""}
      <button class="card-fav${isFav(r) ? " on" : ""}" data-i="${i}" aria-label="즐겨찾기">★</button>
      ${img ? `<img class="thumb" src="${esc(img)}" loading="lazy" alt="">`
            : '<div class="thumb"></div>'}
      <div class="body">
        <div class="name">${esc(rowTitle(r))}</div>
        ${r["출시년월"] ? `<div class="card-year">${esc(formatYM(r["출시년월"]))}</div>` : ""}
        <div class="card-chips">
          ${model ? `<span class="cchip primary">${esc(connUniversalLabel(model))}</span>` : ""}
        </div>
        <div class="card-foot">
          ${size ? `<span class="size-badge">${esc(size)}</span>` : ""}
          ${cc ? `<span class="cc-badge">${cc}색상</span>` : ""}
          ${price ? `<span class="card-price">${esc(won(price))}</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");
  // 즐겨찾기 별 클릭 (상세 안 열리게 먼저 처리)
  g.querySelectorAll(".card-fav").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rows[Number(el.dataset.i)];
      el.classList.toggle("on", toggleFav(r));
    });
  });
  // 카드 클릭 → 상세
  g.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", () => openDetail(rows[Number(el.dataset.i)]));
  });
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
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + term.length)) +
    "</mark>" + esc(text.slice(i + term.length));
}

function renderSuggestions(term) {
  const box = ensureSuggestBox();
  term = String(term || "").trim();
  if (term.length < 1) return hideSuggest();
  const lc = term.toLowerCase();
  const matches = suggestItems
    .filter((s) => s.lc.includes(lc))
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
function nameTokens(s) {
  return new Set(String(s || "").split(/\s+/).filter((t) => t.length > 1));
}
function getSimilar(r, limit = 8, exclude = null) {
  const facetKeys = facetCols.map((f) => f.key);
  const baseTokens = nameTokens(rowTitle(r));
  const scored = [];
  for (const o of allRows) {
    if (o === r) continue;
    if (exclude && exclude.has(o)) continue;
    let s = 0;
    // 같은 기종/재질/규격 등 facet 일치 가중
    for (const k of facetKeys) {
      if (r[k] && o[k] && String(r[k]) === String(o[k])) {
        s += (k === (facetCols[0] && facetCols[0].key)) ? 3 : 2;
      }
    }
    // 제품명 단어 겹침
    const ot = nameTokens(rowTitle(o));
    let overlap = 0;
    baseTokens.forEach((t) => { if (ot.has(t)) overlap++; });
    s += overlap * 2;
    if (s > 0) scored.push([s, o]);
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

// ---- 상세 보기 (탭형: 기본정보 / 컬러옵션 / 호환 / 비슷한) -----------
function openDetail(r) {
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

  // ① 기본정보 속성 (이미지/이름/링크/색상/숨김 컬럼 제외 — 색상은 별도 탭)
  const connFacet = facetCols.find((f) => f.label === "호환");
  const skip = new Set([colKeys.image, colKeys.name, colKeys.link, colKeys.price, "출시년월",
    (colorFacet && colorFacet.key), ...(CONFIG.HIDE_COLUMNS || [])].filter(Boolean));
  const attrs = headersAll.filter((h) => !skip.has(h)).map((h) => {
    let val = r[h];
    if (h === colKeys.price) val = won(val);
    else if (h === colKeys.stock) { const c = stockClass(val); val = c === "out" ? "품절 (0)" : (val ? `${val}개` : "-"); }
    else if (connFacet && h === connFacet.key) val = esc(connectorLabel(val));  // 공용(범용)→커넥터 연결형, 전용→기종별 일체형
    else if (mf && h === mf.key) val = esc(connUniversalLabel(val));  // 기종 '공용'→커넥터 연결형
    else val = esc(val);
    return `<div class="attr"><div class="k">${esc(h)}</div><div class="v">${val || "-"}</div></div>`;
  }).join("");

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

  // ③ 호환 / ④ 비슷한
  const compatible = getCompatible(r);
  const similar = getSimilar(r, 8, new Set(compatible));
  const reco = [...compatible, ...similar];
  const card = (o, ri) => {
    const oi = colKeys.image ? o[colKeys.image] : "";
    const osub = facetCols.slice(0, 2).map((f) => o[f.key]).filter(Boolean).join(" · ");
    return `<div class="sim-card" data-ri="${ri}">
      ${oi ? `<img src="${esc(oi)}" loading="lazy" alt="">` : '<div class="sim-noimg"></div>'}
      <div class="sim-name">${esc(rowTitle(o))}</div><div class="sim-sub">${esc(osub)}</div></div>`;
  };
  const grid = (list, off) => `<div class="similar-grid">${list.map((o, i) => card(o, off + i)).join("")}</div>`;
  const b = compatBasis(r);
  const basis = b.specific ? esc(b.myModel) : (b.mySize || "");
  const compatPane = compatible.length
    ? `<div class="similar-title">🔗 ${basis ? esc(basis) + "에 " : ""}맞는 다른 스트랩 ${compatible.length}개</div>${grid(compatible, 0)}`
    : `<div class="dpane-empty">호환 정보를 찾지 못했습니다.</div>`;
  const simPane = similar.length
    ? `<div class="similar-title">🔍 비슷한 디자인 ${similar.length}개</div>${grid(similar, compatible.length)}`
    : `<div class="dpane-empty">비슷한 제품이 없습니다.</div>`;

  const chips = [
    `<span class="dchip ${st.cls}">${st.label}</span>`,
    model ? `<span class="dchip">${esc(connUniversalLabel(model))}</span>` : "",
    size ? `<span class="dchip">${esc(size)}</span>` : "",
  ].filter(Boolean).join("");

  $("detail").innerHTML = `
    <div class="detail-tabbar">
      <div class="detail-tabs">
        <button class="dtab active" data-tab="info">기본 정보</button>
        <button class="dtab" data-tab="color">컬러 옵션</button>
        <button class="dtab" data-tab="compat">호환 스트랩</button>
        <button class="dtab" data-tab="similar">비슷한 제품</button>
      </div>
      <button class="dtab-close" id="btnCloseDetail" aria-label="닫기">✕</button>
    </div>
    <div class="detail-main">
      <div class="detail-imgcol">
        ${img ? `<img class="detail-img" src="${esc(img)}" alt="" title="클릭하면 이미지 복사" style="cursor:copy">` : '<div class="detail-img placeholder"></div>'}
        <button class="detail-fav2${isFav(r) ? " on" : ""}" id="btnDetailFav">★ 즐겨찾기</button>
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
            ${link ? `<a class="store-btn" href="${esc(link)}" target="_blank" rel="noopener">네이버 스토어에서 보기 ↗</a>` : ""}
            ${coupangUrl ? `<a class="store-btn" style="background:#ee2b2b" href="${esc(coupangUrl)}" target="_blank" rel="noopener">쿠팡에서 보기 ↗</a>` : ""}
          </div></div>
        <div class="dpane hidden" data-pane="color">${colorPane}</div>
        <div class="dpane hidden" data-pane="compat">${compatPane}</div>
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
  const dimg = detail.querySelector(".detail-img");
  if (dimg && img) dimg.addEventListener("click", () => copyImageToClipboard(img));
  $("btnCloseDetail").addEventListener("click", closeDetail);
  $("btnDetailFav").addEventListener("click", (e) => e.currentTarget.classList.toggle("on", toggleFav(r)));
  detail.querySelectorAll(".sim-card").forEach((el) => el.addEventListener("click", () => openDetail(reco[Number(el.dataset.ri)])));
  detail.classList.remove("hidden");
  $("overlay").classList.remove("hidden");
}

function closeDetail() {
  $("detail").classList.add("hidden");
  $("overlay").classList.add("hidden");
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

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
