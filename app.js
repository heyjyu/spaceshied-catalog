// ===================================================================
//  워치 스트랩 카탈로그 — 메인 로직
//  구글시트(또는 sample-data.csv) → 검색/필터/정렬 + 클릭하면 상세(이미지+속성)
// ===================================================================

let table = null;        // Tabulator 인스턴스
let allRows = [];        // 원본 데이터
let headersAll = [];     // 전체 헤더 순서
let colKeys = {};        // 특수 컬럼 키 {image, link, price, stock, name}
let facetCols = [];      // [{label, key}] 자동감지된 필터 컬럼
let viewMode = "table";  // "table" | "gallery"

// 현재 필터 상태
const filterState = { search: "", facets: {}, stock: "" };

const $ = (id) => document.getElementById(id);

// ---- 유틸 -----------------------------------------------------------
function findCol(headers, hints) {
  const lc = headers.map((h) => String(h).toLowerCase());
  for (const hint of hints) {
    const i = lc.findIndex((h) => h.includes(hint.toLowerCase()));
    if (i >= 0) return headers[i];
  }
  return null;
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

// ---- 데이터 로딩 ----------------------------------------------------
function sheetUrl() {
  if (!CONFIG.SHEET_ID || CONFIG.SHEET_ID === "DEMO") return "sample-data.csv";
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv`;
  if (CONFIG.SHEET_GID) return `${base}&gid=${encodeURIComponent(CONFIG.SHEET_GID)}`;
  return `${base}&sheet=${encodeURIComponent(CONFIG.SHEET_NAME || "")}`;
}

function loadData() {
  setStatus("데이터를 불러오는 중…");
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
      headersAll = grid[hr].map((h, i) => (String(h).trim() || `컬럼${i + 1}`));
      const rows = grid.slice(hr + 1)
        .map((arr) => {
          const o = {};
          headersAll.forEach((h, i) => (o[h] = arr[i] != null ? String(arr[i]) : ""));
          return o;
        })
        .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!rows.length) {
        setStatus("데이터가 비어 있습니다. 시트 내용/공유설정을 확인하세요.", true);
        return;
      }
      allRows = rows;
      detectColumns(headersAll, rows);
      buildView(rows);
    },
    error: (err) => {
      setStatus("불러오기 실패: " + err.message +
        "\n구글시트 공유설정(링크가 있는 모든 사용자=뷰어)을 확인하세요.", true);
    },
  });
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
  for (const [type, hints] of Object.entries(CONFIG.COLUMN_HINTS)) {
    const c = findCol(headers, hints);
    if (c) colKeys[type] = c;
  }
  // 필터(facet) 드롭다운 컬럼
  facetCols = [];
  filterState.facets = {};
  for (const f of CONFIG.FACETS || []) {
    const c = findCol(headers, f.hints);
    if (c && !facetCols.some((x) => x.key === c)) {
      facetCols.push({ label: f.label, key: c });
      filterState.facets[c] = "";
    }
  }
  buildFacetDropdowns(rows);
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
    // 한 셀에 여러 값이면 쪼개서 각각을 옵션으로
    const set = new Set();
    rows.forEach((r) => splitVals(r[f.key]).forEach((v) => set.add(v)));
    const vals = [...set].sort((a, b) => a.localeCompare(b, "ko"));
    sel.innerHTML = `<option value="">${esc(f.label)} 전체</option>` +
      vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.addEventListener("change", (e) => {
      filterState.facets[f.key] = e.target.value;
      applyFilters();
    });
    wrap.insertBefore(sel, stockSel);
  }
}

// ---- Tabulator 컬럼 구성 -------------------------------------------
function buildColumns(headers) {
  const cols = [];
  for (const h of headers) {
    const col = { title: h, field: h, resizable: true };
    if (h === colKeys.image) {
      col.width = 64; col.headerSort = false;
      col.formatter = (cell) => {
        const v = cell.getValue();
        return v ? `<img class="cell-thumb" src="${esc(v)}" loading="lazy" alt="">` : "";
      };
    } else if (h === colKeys.link) {
      col.formatter = (cell) => {
        const v = cell.getValue();
        return v ? `<a class="cell-link" href="${esc(v)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">열기 ↗</a>` : "";
      };
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
  });
  table.on("rowClick", (e, row) => openDetail(row.getData()));
}

// ---- 필터 ----------------------------------------------------------
function matchRow(data) {
  if (filterState.search) {
    const term = filterState.search.toLowerCase();
    if (!Object.values(data).some((v) => String(v).toLowerCase().includes(term)))
      return false;
  }
  for (const [key, val] of Object.entries(filterState.facets)) {
    if (val && !splitVals(data[key]).includes(val)) return false;
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
  if (viewMode === "gallery") renderGallery();
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

// ---- 통계 ----------------------------------------------------------
function renderStats() {
  const active = table ? table.getData("active") : allRows;
  let out = 0, low = 0;
  if (colKeys.stock) {
    for (const r of active) {
      const c = stockClass(r[colKeys.stock]);
      if (c === "out") out++; else if (c === "low") low++;
    }
  }
  const cards = [
    { label: "표시 중", value: active.length.toLocaleString("ko-KR") },
    { label: "전체 상품", value: allRows.length.toLocaleString("ko-KR") },
  ];
  if (colKeys.stock) {
    cards.push({ label: "품절", value: out, cls: out ? "danger" : "" });
    cards.push({ label: "재고부족", value: low, cls: low ? "warn" : "" });
  }
  $("stats").innerHTML = cards.map((c) =>
    `<div class="stat-card"><div class="label">${c.label}</div>` +
    `<div class="value ${c.cls || ""}">${c.value}</div></div>`).join("");
}

// ---- 갤러리 뷰 ------------------------------------------------------
function rowTitle(r) {
  return colKeys.name ? r[colKeys.name] : (r[headersAll[0]] || "");
}

function renderGallery() {
  const rows = table ? table.getData("active") : allRows;
  const g = $("gallery");
  g.innerHTML = rows.map((r, i) => {
    const img = colKeys.image ? r[colKeys.image] : "";
    const price = colKeys.price ? won(r[colKeys.price]) : "";
    // 카드 부제: facet 값 2개 정도 (예: 애플워치 · 가죽)
    const sub = facetCols.slice(0, 2).map((f) => r[f.key]).filter(Boolean).join(" · ");
    const cls = colKeys.stock ? stockClass(r[colKeys.stock]) : null;
    const stockBadge = cls === "out" ? '<span class="badge out">품절</span>'
      : cls === "low" ? `<span class="badge low">재고 ${esc(r[colKeys.stock])}</span>` : "";
    return `<div class="card" data-i="${i}">
      ${img ? `<img class="thumb" src="${esc(img)}" loading="lazy" alt="">`
            : '<div class="thumb"></div>'}
      <div class="body">
        <div class="name">${esc(rowTitle(r))}</div>
        <div class="meta">${esc(sub)}</div>
        <div class="row"><span class="price">${esc(price)}</span>${stockBadge}</div>
      </div>
    </div>`;
  }).join("");
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

// ---- 비슷한 제품 찾기 (비주얼 비교용) ------------------------------
function nameTokens(s) {
  return new Set(String(s || "").split(/\s+/).filter((t) => t.length > 1));
}
function getSimilar(r, limit = 8) {
  const facetKeys = facetCols.map((f) => f.key);
  const baseTokens = nameTokens(rowTitle(r));
  const scored = [];
  for (const o of allRows) {
    if (o === r) continue;
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

// ---- 상세 보기 (클릭 시 이미지 + 속성값 + 비슷한 제품) --------------
function openDetail(r) {
  const img = colKeys.image ? r[colKeys.image] : "";
  const link = colKeys.link ? r[colKeys.link] : "";
  // 이미지/링크/상품명은 위에서 따로 표시하므로 속성목록에선 제외
  const skip = new Set([colKeys.image, colKeys.name].filter(Boolean));
  const rows = headersAll.filter((h) => !skip.has(h)).map((h) => {
    let val = r[h];
    if (h === colKeys.price) val = won(val);
    else if (h === colKeys.stock) {
      const cls = stockClass(val);
      val = cls === "out" ? "품절 (0)" : `${val}개`;
    } else if (h === colKeys.link) {
      val = val ? `<a href="${esc(val)}" target="_blank" rel="noopener">${esc(val)}</a>` : "";
    } else {
      val = esc(val);
    }
    return `<div class="attr"><div class="k">${esc(h)}</div><div class="v">${val || "-"}</div></div>`;
  }).join("");

  // 비슷한 제품 (헷갈리는 비슷한 디자인 비주얼 비교)
  const similar = getSimilar(r);
  const simHtml = similar.length ? `
    <div class="similar-wrap">
      <div class="similar-title">🔍 비슷한 제품 ${similar.length}개 — 헷갈리지 않게 비교하세요</div>
      <div class="similar-grid">
        ${similar.map((o) => {
          const oi = colKeys.image ? o[colKeys.image] : "";
          const osub = facetCols.slice(0, 2).map((f) => o[f.key]).filter(Boolean).join(" · ");
          return `<div class="sim-card" data-key="${esc(rowTitle(o))}|${esc(o[colKeys.image] || "")}">
            ${oi ? `<img src="${esc(oi)}" loading="lazy" alt="">` : '<div class="sim-noimg"></div>'}
            <div class="sim-name">${esc(rowTitle(o))}</div>
            <div class="sim-sub">${esc(osub)}</div>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  $("detail").innerHTML = `
    <div class="detail-head">
      <strong>상품 상세</strong>
      <button class="btn ghost" id="btnCloseDetail">✕ 닫기</button>
    </div>
    <div class="detail-body">
      ${img ? `<img class="detail-img" src="${esc(img)}" alt="">`
            : '<div class="detail-img placeholder"></div>'}
      <h2 class="detail-title">${esc(rowTitle(r))}</h2>
      <div class="attrs">${rows}</div>
      ${link ? `<a class="store-btn" href="${esc(link)}" target="_blank" rel="noopener">네이버 스토어에서 보기 ↗</a>` : ""}
      ${simHtml}
    </div>`;
  $("btnCloseDetail").addEventListener("click", closeDetail);
  // 비슷한 제품 클릭 → 그 제품 상세로
  $("detail").querySelectorAll(".sim-card").forEach((el, i) => {
    el.addEventListener("click", () => openDetail(similar[i]));
  });
  $("detail").querySelector(".detail-body").scrollTop = 0;
  $("detail").classList.remove("hidden");
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

  let t;
  $("search").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { filterState.search = e.target.value.trim(); applyFilters(); }, 150);
  });
  $("stockFilter").addEventListener("change", (e) => {
    filterState.stock = e.target.value; applyFilters();
  });
  $("btnClear").addEventListener("click", clearFilters);
  $("btnTable").addEventListener("click", () => setView("table"));
  $("btnGallery").addEventListener("click", () => setView("gallery"));
  $("btnReload").addEventListener("click", () => {
    if (table) { table.destroy(); table = null; }
    loadData();
  });
  $("overlay").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
