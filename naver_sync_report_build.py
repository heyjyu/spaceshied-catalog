"""대조 데이터(report_data.json) → 직원 검수용 naver_sync_report.html 생성.

사용: python3 naver_sync_report_build.py <report_data.json> <out.html>
검수 흐름: 체크 확인 → 하단 'SQL 다운로드' → Supabase SQL Editor에서 실행.
체크 상태는 localStorage에 자동 저장(새로고침해도 유지).
"""
import json
import sys

TEMPLATE = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>네이버 스토어 ↔ 카탈로그 대조 리포트</title>
<style>
:root { --bg:#f5f5f7; --panel:#fff; --border:#e7e7ec; --text:#1d1d1f; --muted:#86868b;
  --brand:#3182f6; --brand-soft:#e8f3ff; --ok:#1a9c4e; --warn:#bf6a02; --danger:#e0352b; }
* { box-sizing:border-box; }
body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",sans-serif;
  background:var(--bg); color:var(--text); font-size:14px; line-height:1.5; padding-bottom:88px; }
header { background:#fff; border-bottom:1px solid var(--border); padding:18px 24px; position:sticky; top:0; z-index:10; }
h1 { font-size:19px; margin:0 0 4px; } .sub { color:var(--muted); font-size:13px; }
.stats { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
.stat { background:var(--bg); border-radius:10px; padding:8px 14px; font-size:13px; }
.stat b { font-size:16px; margin-right:4px; }
main { max-width:1200px; margin:0 auto; padding:20px; }
section { background:var(--panel); border:1px solid var(--border); border-radius:14px; margin-bottom:20px; overflow:hidden; }
.sec-head { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.sec-head h2 { font-size:16px; margin:0; } .sec-head .n { color:var(--brand); }
.sec-head .desc { color:var(--muted); font-size:12.5px; width:100%; }
.selbtns { margin-left:auto; display:flex; gap:6px; }
.selbtns button { border:1px solid var(--border); background:#fff; border-radius:8px; padding:4px 10px; font-size:12px; cursor:pointer; }
.selbtns button:hover { background:var(--bg); }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; padding:8px 10px; background:#fafafc; border-bottom:1px solid var(--border); font-size:12px; color:var(--muted); white-space:nowrap; }
td { padding:8px 10px; border-bottom:1px solid #f0f0f3; vertical-align:middle; }
tr:hover td { background:#fafcff; }
tr.unchecked td { opacity:.45; }
img.pimg { width:52px; height:52px; object-fit:cover; border-radius:8px; background:#eee; display:block; }
.core { font-weight:600; } .meta { color:var(--muted); font-size:12px; }
.badge { display:inline-block; border-radius:999px; padding:2px 9px; font-size:11.5px; font-weight:700; }
.b-url { background:#e6f6ec; color:var(--ok); } .b-name { background:var(--brand-soft); color:var(--brand); }
.b-check { background:#fdf1e2; color:var(--warn); }
.b-sale { background:#e6f6ec; color:var(--ok); } .b-stop { background:#fdecea; color:var(--danger); }
.fill-field { font-size:12.5px; margin:1px 0; }
.fill-field b { color:var(--brand); }
a { color:var(--brand); text-decoration:none; } a:hover { text-decoration:underline; }
details.vars { margin-top:4px; } details.vars summary { cursor:pointer; color:var(--brand); font-size:12px; }
details.vars li { font-size:12px; color:var(--muted); margin:2px 0; }
input[type=checkbox] { width:17px; height:17px; accent-color:var(--brand); cursor:pointer; }
.footer-bar { position:fixed; left:0; right:0; bottom:0; background:rgba(255,255,255,.92);
  backdrop-filter:blur(12px); border-top:1px solid var(--border); padding:14px 24px;
  display:flex; align-items:center; gap:14px; z-index:20; }
.footer-bar .cnt { font-weight:700; }
.dl { border:0; background:var(--brand); color:#fff; border-radius:999px; padding:11px 24px;
  font-size:14px; font-weight:700; cursor:pointer; }
.dl:hover { background:#2272eb; } .dl.ghost { background:#fff; color:var(--brand); border:1px solid var(--brand); }
.note { background:#fffbe8; border:1px solid #f0e0a0; border-radius:10px; padding:10px 14px; font-size:12.5px; margin-bottom:16px; color:#6b5a12; }
.collapsible > .sec-head { cursor:pointer; }
.collapsible.closed > *:not(.sec-head) { display:none; }
.tag { background:var(--bg); border-radius:6px; padding:1px 7px; font-size:11px; color:var(--muted); margin-right:4px; display:inline-block; margin-top:2px; }
</style>
</head>
<body>
<header>
  <h1>네이버 스토어 ↔ 카탈로그 대조 리포트</h1>
  <div class="sub">생성 __DATE__ · 검수 후 하단에서 SQL 다운로드 → Supabase SQL Editor 실행 · 체크 상태는 이 브라우저에 자동 저장됩니다</div>
  <div class="stats" id="stats"></div>
</header>
<main>
  <div class="note">💡 <b>이미지 제안</b>은 네이버 대표이미지 URL을 그대로 카탈로그에 넣습니다(카탈로그가 외부 URL도 표시 가능). 추후 자체 스토리지로 옮기려면 관리자 수정에서 재업로드하면 됩니다.<br>
  ⚠️ <b>신규 등록</b>은 이름·가격·링크·이미지·상태(판매)만 채워 넣습니다 — 기종·재질 등 세부 스펙은 등록 후 관리자 화면에서 채워주세요.</div>

  <section id="secNew">
    <div class="sec-head"><input type="checkbox" id="allNew" checked><h2>① 신규 등록 후보 — 스트랩 <span class="n" id="nNew"></span></h2>
      <div class="selbtns"><button data-sec="new" data-on="1">전체 선택</button><button data-sec="new" data-on="0">전체 해제</button></div>
      <div class="desc">네이버에서 판매 중이지만 카탈로그에 없는 스트랩. 같은 제품의 기종별 등록을 한 줄(코어 제품명)로 묶었습니다. 체크된 것이 카탈로그에 새 상품으로 들어갑니다.</div></div>
    <table><thead><tr><th></th><th>사진</th><th>제품명 (코어)</th><th>기종 등록 수</th><th>가격</th><th>상태</th><th>링크</th></tr></thead><tbody id="tbNew"></tbody></table>
  </section>

  <section id="secFill">
    <div class="sec-head"><h2>② 기존 상품 정보 채움 <span class="n" id="nFill"></span></h2>
      <div class="selbtns"><button data-sec="fill" data-on="1">전체 선택</button><button data-sec="fill" data-on="0">전체 해제</button></div>
      <div class="desc">카탈로그에 있으나 <b>스토어 링크 / 이미지 / 가격</b>이 빈 상품. 네이버에서 찾은 값을 제안합니다. <span class="badge b-url">URL확정</span>=이미 연결된 링크로 확인(정확), <span class="badge b-name">이름높음</span>=이름 일치(신뢰 높음), <span class="badge b-check">확인필요</span>=이름 유사(직접 확인!) — 확인필요는 기본 해제되어 있습니다.</div></div>
    <table><thead><tr><th></th><th>신뢰도</th><th>카탈로그 상품</th><th>채울 값 (제안)</th><th>매칭된 네이버 상품</th></tr></thead><tbody id="tbFill"></tbody></table>
  </section>

  <section id="secOther" class="collapsible closed">
    <div class="sec-head"><h2>③ 기타 웨어러블 신규 후보 (케이스·필름·충전 등) <span class="n" id="nOther"></span> <span class="meta">— 클릭해서 펼치기</span></h2>
      <div class="selbtns"><button data-sec="other" data-on="1">전체 선택</button><button data-sec="other" data-on="0">전체 해제</button></div>
      <div class="desc">스트랩이 아닌 웨어러블 액세서리. 이 카탈로그는 스트랩 중심이므로 기본 해제 상태입니다. 넣을 것만 체크하세요.</div></div>
    <table><thead><tr><th></th><th>사진</th><th>제품명 (코어)</th><th>기종 등록 수</th><th>가격</th><th>상태</th><th>링크</th></tr></thead><tbody id="tbOther"></tbody></table>
  </section>

  <section id="secRef" class="collapsible closed">
    <div class="sec-head"><h2>④ 참고 (적용 대상 아님) <span class="meta">— 클릭해서 펼치기</span></h2></div>
    <div style="padding:16px 18px" id="refBody"></div>
  </section>
</main>

<div class="footer-bar">
  <span class="cnt" id="pickCnt"></span>
  <span class="meta" id="pickDetail"></span>
  <span style="margin-left:auto"></span>
  <button class="dl ghost" id="btnJson">선택 JSON 다운로드</button>
  <button class="dl" id="btnSql">✔ 선택 항목 SQL 다운로드</button>
</div>

<script>
const DATA = __DATA__;
const LS_KEY = "naver_sync_checks_v1";
const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const won = (n) => n == null ? "-" : Number(n).toLocaleString("ko-KR") + "원";
const url = (no) => `https://smartstore.naver.com/spaceshied/products/${no}`;

// 스트랩/기타 분리
const isStrap = (g) => /스트랩|루프|밴드|버클/.test(g.core);
const strapGroups = DATA.newGroups.filter(isStrap);
const otherGroups = DATA.newGroups.filter(g => !isStrap(g));

function statusBadge(st) {
  const sale = st.SALE || 0, other = Object.entries(st).filter(([k]) => k !== "SALE");
  let h = `<span class="badge b-sale">판매 ${sale}</span>`;
  if (other.length) h += ` <span class="badge b-stop">${other.map(([k,v])=>k+" "+v).join(", ")}</span>`;
  return h;
}
function groupRow(g, sec, i, defOn) {
  const id = `${sec}:${g.repNo}`;
  const on = saved[id] !== undefined ? saved[id] : defOn;
  const pr = (g.priceMin !== g.priceMax && g.priceMin != null) ? `${won(g.priceMin)}~${won(g.priceMax)}` : won(g.price);
  return `<tr class="${on?"":"unchecked"}" data-id="${id}">
    <td><input type="checkbox" data-id="${id}" ${on?"checked":""}></td>
    <td>${g.img ? `<img class="pimg" loading="lazy" src="${esc(g.img)}">` : ""}</td>
    <td><div class="core">${esc(g.core)}</div>
      <div>${g.models.slice(0,4).map(m=>`<span class="tag">${esc(m)}</span>`).join("")}${g.models.length>4?`<span class="tag">+${g.models.length-4}</span>`:""}</div>
      ${g.count>1?`<details class="vars"><summary>기종별 등록 ${g.count}개 보기</summary><ul>${g.variants.map(v=>`<li><a href="${url(v.no)}" target="_blank">${esc(v.name)}</a> · ${won(v.price)} · ${v.status}</li>`).join("")}</ul></details>`:""}</td>
    <td style="text-align:center">${g.count}</td>
    <td>${pr}</td>
    <td>${statusBadge(g.statuses)}</td>
    <td><a href="${url(g.repNo)}" target="_blank">보기 ↗</a></td>
  </tr>`;
}
function fillRow(f) {
  const id = `fill:${f.id}`;
  const defOn = f.conf !== "확인필요";
  const on = saved[id] !== undefined ? saved[id] : defOn;
  const bcls = {"URL확정":"b-url","이름높음":"b-name","확인필요":"b-check"}[f.conf];
  const fields = Object.entries(f.proposal).map(([k,v]) => {
    const label = {store_url:"스토어 링크", image:"이미지", price:"가격"}[k];
    const val = k === "price" ? won(v) : (k === "image" ? "네이버 대표이미지" : "네이버 상품 링크");
    return `<div class="fill-field"><b>${label}</b> ← ${esc(val)}</div>`;
  }).join("");
  return `<tr class="${on?"":"unchecked"}" data-id="${id}">
    <td><input type="checkbox" data-id="${id}" ${on?"checked":""}></td>
    <td><span class="badge ${bcls}">${f.conf}</span>${f.altCount?`<div class="meta">후보 +${f.altCount}</div>`:""}</td>
    <td><div class="core">${esc(f.name)}</div><div class="meta">id ${f.id}${f.model?` · ${esc(f.model)}`:""}</div></td>
    <td>${fields}</td>
    <td>${f.matchImg?`<img class="pimg" loading="lazy" src="${esc(f.matchImg)}" style="float:left;margin-right:8px">`:""}
      <a href="${url(f.matchNo)}" target="_blank">${esc(f.matchName)}</a></td>
  </tr>`;
}

document.getElementById("tbNew").innerHTML = strapGroups.map((g,i)=>groupRow(g,"new",i,true)).join("");
document.getElementById("tbOther").innerHTML = otherGroups.map((g,i)=>groupRow(g,"other",i,false)).join("");
document.getElementById("tbFill").innerHTML = DATA.fills.map(fillRow).join("");
document.getElementById("nNew").textContent = `${strapGroups.length}종`;
document.getElementById("nOther").textContent = `${otherGroups.length}종`;
document.getElementById("nFill").textContent = `${DATA.fills.length}건`;

// 통계
const C = DATA.counts;
document.getElementById("stats").innerHTML = [
  ["네이버 스토어 상품", C.naverTotal], ["카탈로그 상품", C.catalogTotal],
  ["신규 스트랩 후보", strapGroups.length + "종"], ["정보 채움 후보", C.fills + "건"],
  ["네이버에 없는 카탈로그 상품", C.catalogOnly],
].map(([l,v])=>`<div class="stat"><b>${v}</b>${l}</div>`).join("");

// 참고 섹션
document.getElementById("refBody").innerHTML = `
  <p><b>카탈로그에는 있으나 네이버에서 못 찾은 상품 ${DATA.catalogOnly.length}개</b> (단종·미출시이거나 이름이 많이 다른 경우):</p>
  <ul>${DATA.catalogOnly.map(r=>`<li>${esc(r.name)} <span class="meta">(id ${r.id}${r.status?" · "+esc(r.status):""})</span></li>`).join("")}</ul>
  ${DATA.badRows.length?`<p><b>⚠️ 데이터 오류 행</b>: ${DATA.badRows.map(r=>`id ${r.id} (이름: "${esc(r.name)}")`).join(", ")} — 관리자에서 확인/삭제 필요</p>`:""}
  <p><b>워치 액세서리 외 미등록 네이버 상품 ${C.otherProducts.toLocaleString()}개</b> (이 카탈로그 범위 밖 — 케이스·필름·삼각대 등):</p>
  <ul>${DATA.otherSummary.slice(0,12).map(o=>`<li>${esc(o.cat.split(">").pop())} <b>${o.count}</b></li>`).join("")}</ul>`;

// 체크 상호작용
document.body.addEventListener("change", (e) => {
  const cb = e.target.closest("input[type=checkbox][data-id]");
  if (!cb) return;
  saved[cb.dataset.id] = cb.checked;
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
  cb.closest("tr").classList.toggle("unchecked", !cb.checked);
  updateCount();
});
document.querySelectorAll(".selbtns button").forEach(b => b.addEventListener("click", (e) => {
  e.stopPropagation();
  const sec = b.dataset.sec, on = b.dataset.on === "1";
  document.querySelectorAll(`input[data-id^="${sec}:"], input[data-id^="${sec === "fill" ? "fill" : sec}:"]`).forEach(cb => {
    cb.checked = on; saved[cb.dataset.id] = on;
    cb.closest("tr").classList.toggle("unchecked", !on);
  });
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
  updateCount();
}));
document.querySelectorAll(".collapsible > .sec-head").forEach(h => h.addEventListener("click", (e) => {
  if (e.target.closest("button,input,a")) return;
  h.parentElement.classList.toggle("closed");
}));

function picked() {
  const ids = [...document.querySelectorAll("input[data-id]:checked")].map(c => c.dataset.id);
  const newG = [], fills = [];
  for (const id of ids) {
    const [sec, no] = id.split(":");
    if (sec === "fill") { const f = DATA.fills.find(x => String(x.id) === no); if (f) fills.push(f); }
    else { const pool = sec === "new" ? strapGroups : otherGroups;
      const g = pool.find(x => String(x.repNo) === no); if (g) newG.push(g); }
  }
  return { newG, fills };
}
function updateCount() {
  const { newG, fills } = picked();
  document.getElementById("pickCnt").textContent = `선택: 신규 ${newG.length}종 · 채움 ${fills.length}건`;
  document.getElementById("pickDetail").textContent = "";
}
updateCount();

// SQL 생성
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function buildSQL() {
  const { newG, fills } = picked();
  const L = ["-- 네이버 스토어 대조 리포트에서 생성 (" + new Date().toLocaleDateString("sv-SE") + ")",
             "-- Supabase SQL Editor에 붙여넣고 실행하세요.", ""];
  if (newG.length) {
    L.push("-- ① 신규 등록 " + newG.length + "종");
    L.push("insert into products (name, price, store_url, image, status) values");
    L.push(newG.map(g => `  (${q(g.core)}, ${g.price != null ? q(String(g.price)) : "''"}, ${q(url(g.repNo))}, ${q(g.img || "")}, '판매')`).join(",\n") + ";");
    L.push("");
  }
  if (fills.length) {
    L.push("-- ② 정보 채움 " + fills.length + "건 (빈 필드만 갱신)");
    for (const f of fills) {
      const sets = Object.entries(f.proposal).map(([k,v]) => `${k} = ${q(v)}`).join(", ");
      L.push(`update products set ${sets} where id = ${Number(f.id)}; -- ${f.name.replace(/--/g,"-")}`);
    }
  }
  if (!newG.length && !fills.length) L.push("-- 선택된 항목이 없습니다.");
  return L.join("\n");
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
document.getElementById("btnSql").addEventListener("click", () =>
  download("naver_sync_approved.sql", buildSQL(), "text/plain"));
document.getElementById("btnJson").addEventListener("click", () =>
  download("naver_sync_approved.json", JSON.stringify(picked(), null, 1), "application/json"));
</script>
</body>
</html>
"""


def main(data_path, out_path):
    data = open(data_path, encoding="utf-8").read()
    import datetime
    html = TEMPLATE.replace("__DATA__", data).replace("__DATE__", datetime.date.today().isoformat())
    open(out_path, "w", encoding="utf-8").write(html)
    print("written:", out_path, f"({len(html)//1024}KB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
