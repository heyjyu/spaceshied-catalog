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
let suggestItems = [];   // 자동완성 후보 [{text, lc, type, key}]
let suggestSel = -1;     // 키보드 선택 인덱스

// 현재 필터 상태
const filterState = { search: "", facets: {}, stock: "", favOnly: false };

const $ = (id) => document.getElementById(id);

// ---- 즐겨찾기 (localStorage) ---------------------------------------
let favs = (() => {
  try { return new Set(JSON.parse(localStorage.getItem("catalog_favs") || "[]")); }
  catch (e) { return new Set(); }
})();
function favKey(r) {
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
  const btn = $("btnFav");
  if (btn) btn.classList.toggle("active", filterState.favOnly);
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
    sel.innerHTML = `<option value="">${esc(f.label)}</option>` +
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
  const hide = new Set(CONFIG.HIDE_COLUMNS || []);
  const colorKey = (facetCols.find((f) => f.derive === "color") || {}).key;
  const sizeKey = (facetCols.find((f) => f.derive === "mm") || {}).key;
  const cols = [];
  // 맨 앞: 즐겨찾기 별 컬럼
  cols.push({
    title: "", field: "_fav", width: 46, hozAlign: "center", headerSort: false,
    resizable: false, cssClass: "col-fav",
    formatter: (cell) => `<span class="fav-star${isFav(cell.getRow().getData()) ? " on" : ""}">★</span>`,
  });
  for (const h of headers) {
    if (hide.has(h)) continue;                    // 내부 컬럼 숨김(원본탭 등)
    const col = { title: h, field: h, resizable: true };
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
  if (filterState.favOnly && !isFav(data)) return false;
  if (filterState.search) {
    const term = filterState.search.toLowerCase();
    if (!Object.values(data).some((v) => String(v).toLowerCase().includes(term)))
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
      <button class="card-fav${isFav(r) ? " on" : ""}" data-i="${i}" aria-label="즐겨찾기">★</button>
      ${img ? `<img class="thumb" src="${esc(img)}" loading="lazy" alt="">`
            : '<div class="thumb"></div>'}
      <div class="body">
        <div class="name">${esc(rowTitle(r))}</div>
        <div class="meta">${esc(sub)}</div>
        <div class="row"><span class="price">${esc(price)}</span>${stockBadge}</div>
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

// ---- 상세 보기 (클릭 시 이미지 + 속성값 + 호환/비슷한 제품) ---------
function openDetail(r) {
  const img = colKeys.image ? r[colKeys.image] : "";
  const link = colKeys.link ? r[colKeys.link] : "";
  // 이미지/링크/상품명은 위에서 따로 표시하므로 속성목록에선 제외 + 내부 컬럼(원본탭) 숨김
  const skip = new Set([colKeys.image, colKeys.name, ...(CONFIG.HIDE_COLUMNS || [])].filter(Boolean));
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

  // ① 호환되는 다른 스트랩(같은 기종/폭) ② 비슷한 디자인(중복 제외)
  const compatible = getCompatible(r);
  const compatSet = new Set(compatible);
  const similar = getSimilar(r, 6, compatSet);
  const reco = [...compatible, ...similar];          // 클릭 매핑용 통합 배열

  const card = (o, ri) => {
    const oi = colKeys.image ? o[colKeys.image] : "";
    const osub = facetCols.slice(0, 2).map((f) => o[f.key]).filter(Boolean).join(" · ");
    return `<div class="sim-card" data-ri="${ri}">
      ${oi ? `<img src="${esc(oi)}" loading="lazy" alt="">` : '<div class="sim-noimg"></div>'}
      <div class="sim-name">${esc(rowTitle(o))}</div>
      <div class="sim-sub">${esc(osub)}</div>
    </div>`;
  };
  const grid = (list, off) => `<div class="similar-grid">${list.map((o, i) => card(o, off + i)).join("")}</div>`;

  const b = compatBasis(r);
  const basis = b.specific ? esc(b.myModel) : (b.mySize || "");
  const compatHtml = compatible.length ? `
    <div class="similar-wrap compat">
      <div class="similar-title">🔗 ${basis ? esc(basis) + "에 " : ""}맞는 다른 스트랩 ${compatible.length}개</div>
      ${grid(compatible, 0)}
    </div>` : "";
  const simHtml = similar.length ? `
    <div class="similar-wrap">
      <div class="similar-title">🔍 비슷한 디자인 ${similar.length}개 — 헷갈리지 않게 비교하세요</div>
      ${grid(similar, compatible.length)}
    </div>` : "";

  $("detail").innerHTML = `
    <div class="detail-head">
      <strong>상품 상세</strong>
      <div class="detail-head-actions">
        <button class="detail-fav${isFav(r) ? " on" : ""}" id="btnDetailFav">★ 즐겨찾기</button>
        <button class="btn ghost" id="btnCloseDetail">✕ 닫기</button>
      </div>
    </div>
    <div class="detail-body">
      ${img ? `<img class="detail-img" src="${esc(img)}" alt="">`
            : '<div class="detail-img placeholder"></div>'}
      <h2 class="detail-title">${esc(rowTitle(r))}</h2>
      <div class="attrs">${rows}</div>
      ${link ? `<a class="store-btn" href="${esc(link)}" target="_blank" rel="noopener">네이버 스토어에서 보기 ↗</a>` : ""}
      ${compatHtml}
      ${simHtml}
    </div>`;
  $("btnCloseDetail").addEventListener("click", closeDetail);
  $("btnDetailFav").addEventListener("click", (e) => {
    e.currentTarget.classList.toggle("on", toggleFav(r));
  });
  // 추천 카드 클릭 → 그 제품 상세로
  $("detail").querySelectorAll(".sim-card").forEach((el) => {
    el.addEventListener("click", () => openDetail(reco[Number(el.dataset.ri)]));
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
  $("btnClear").addEventListener("click", clearFilters);
  $("btnTable").addEventListener("click", () => setView("table"));
  $("btnGallery").addEventListener("click", () => setView("gallery"));

  // 즐겨찾기만 보기 토글
  const favBtn = $("btnFav");
  if (favBtn) favBtn.addEventListener("click", () => {
    filterState.favOnly = !filterState.favOnly;
    updateFavUI();
    applyFilters();
  });

  // 모바일: 필터 패널 접기/펴기
  $("btnFilters").addEventListener("click", () => {
    const open = $("filters").classList.toggle("open");
    $("btnFilters").setAttribute("aria-expanded", open ? "true" : "false");
  });

  // 모바일은 표 뷰가 좁아 첫 컬럼만 보임 → 기본 갤러리
  if (window.matchMedia("(max-width: 640px)").matches) viewMode = "gallery";
  $("btnReload").addEventListener("click", () => {
    if (table) { table.destroy(); table = null; }
    loadData();
  });
  $("overlay").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
