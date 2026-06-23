#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스페이스쉴드 통합시트 → 깨끗한 '카탈로그' CSV 변환기.
- raw/*.csv (gviz 각 탭) 를 키워드매칭으로 매핑
- 재질/규격 값 정규화(표준화)
- 체결 형태: 체결방식 컬럼 없으면 제품명에서 추출
- 기종: 탭 이름에서
- 이미지: xlsx에서 추출한 삽입이미지를 (탭,행) 매칭 → sips 리사이즈 → images/
출력: catalog.csv (+ sample-data.csv 복사)
"""
import csv, glob, json, os, re, subprocess
import build_images

RAW = "raw"
IMG_OUT = "images"
os.makedirs(IMG_OUT, exist_ok=True)

# 상품 리스트가 아닌/구조상 자동변환 불가한 탭만 제외
#  - 커넥터: 스트랩 아님(부속)   - 샤인SET: 제품명 없이 구성품/별칭 구조
#  - 레드미: 다른 시트로 리다이렉트(상품 없음)
#  - 가민 D2.3: 제품이 '열(column)'로 들어간 전치형  - 가민전용: 미사용 탭
SKIP_TABS = {
    "🔗 커넥터 리스트", "🌌 갤럭시_샤인 SET", "🌌 갤럭시8 러그형_샤인 SET",
    "🟠레드미 워치 5 / 4 ,미밴드 9 8 프로",
    "미사용🔴가민 전용 (퀵핏/퀵릴리즈 가민 메인형)",
    "💪 가민 D2.3 바넷봉 호환 스트랩",
}

def clean(s):
    return re.sub(r"\s+", " ", str(s or "").replace("\x08", "")).strip()

def clean_model(name):
    n = re.sub(r"[^\w가-힣A-Za-z0-9 ~/]+", " ", name)
    n = n.replace("*", " ").replace("~", " ").replace("_", " ")
    return re.sub(r"\s+", " ", n).strip()

# ---- 재질 정규화 ----------------------------------------------------
MAT_RULES = [
    (["티타늄"], "티타늄"),
    (["하이브리드"], "하이브리드"),
    (["레더", "가죽", "포우", "비건", "코도반", "사피아노"], "가죽"),
    (["나일론"], "나일론"),
    (["패브릭"], "패브릭"),
    (["tpu", "젤리"], "TPU"),
    (["pc", "크리스탈", "아크릴", "polycarbonate"], "PC"),
    (["비즈"], "비즈"),
    (["스테인", "스틸"], "스틸"),
    (["실리콘"], "실리콘"),
    (["마그네틱", "마그넷"], "실리콘"),
    (["메탈"], "메탈"),
]
def norm_material(s):
    s = clean(s)
    if not s:
        return ""
    if s == "시":
        return "실리콘"
    low = s.lower()
    for kws, canon in MAT_RULES:
        if any(k in low for k in kws):
            return canon
    return s  # 못 맞추면 원본 유지

# ---- 규격 정규화 ----------------------------------------------------
def norm_spec(raw, tab_mm):
    if tab_mm:          # 일반형 NNmm 탭은 무조건 탭 규격
        return tab_mm
    s = clean(raw)
    return s

# ---- 체결 형태 추출 -------------------------------------------------
BUCKLE_RULES = [
    ("디버클", "디버클(마그네틱)"),
    ("마그넷", "마그네틱"), ("마그네틱", "마그네틱"),
    ("밸크로", "벨크로"), ("벨크로", "벨크로"),
    ("클래식버클", "클래식버클"), ("클래식 버클", "클래식버클"),
    ("접이식", "접이식버클"),
    ("핀버클", "핀버클"),
    ("퀵핏", "퀵핏"), ("퀵릴리즈", "퀵릴리즈"),
    ("나토", "나토"), ("스틸링", "나토"),
    ("원클릭", "원클릭"),
    ("솔로루프", "일체형"), ("솔로 루프", "일체형"), ("일체형", "일체형"),
    ("브레이드", "브레이드"),
    ("스포츠루프", "스포츠루프"), ("스포츠 루프", "스포츠루프"), ("루프", "루프"),
    ("버튼", "버튼"),
    ("버클", "버클"),
]
def extract_buckle(name):
    for kw, val in BUCKLE_RULES:
        if kw in name:
            return val
    return ""
def norm_buckle(cell, name):
    c = clean(cell)
    if c:
        # 셀 값도 표기 통일
        return extract_buckle(c) or c
    return extract_buckle(name)

# ---- 컬럼 찾기 -----------------------------------------------------
def find_col(cols, *keys, exclude=()):
    for i, c in enumerate(cols):
        cc = clean(c)
        if any(e in cc for e in exclude):
            continue
        if any(k in cc for k in keys):
            return i
    return -1

def find_header_row(rows):
    for i, r in enumerate(rows[:8]):
        if any(("제품명" in clean(c)) or ("상품명" in clean(c)) for c in r):
            return i
    return -1

# ---- 이미지 리사이즈 -----------------------------------------------
def resize_image(src, dst, px=360):
    if os.path.exists(dst):
        return True
    r = subprocess.run(
        ["sips", "-s", "format", "jpeg", "-Z", str(px), src, "--out", dst],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0 and os.path.exists(dst)

# ---- 탭 파싱 -------------------------------------------------------
def parse_tab(path, model_name, idx, anchors):
    rows = list(csv.reader(open(path, encoding="utf-8")))
    h = find_header_row(rows)
    if h < 0:
        return [], "헤더(제품명) 못 찾음"
    cols = [clean(c) for c in rows[h]]
    ci_name = find_col(cols, "제품명", "상품명")
    ci_mat  = find_col(cols, "재질", "소재")
    ci_col  = find_col(cols, "컬러", "색상")
    ci_buk  = find_col(cols, "체결")
    ci_img  = find_col(cols, "이미지", "사진")
    ci_spec = find_col(cols, "규격")
    if ci_spec < 0:
        ci_spec = find_col(cols, "사이즈", exclude=("옵션",))
    if ci_spec < 0:
        ci_spec = find_col(cols, "형태")
    # 신규입력 탭용 추가 속성 (기존 탭엔 보통 없음 → 빈값)
    ci_sample  = find_col(cols, "샘플링", "샘플 날짜", "샘플날짜")
    ci_creator = find_col(cols, "제작자", "컨텐츠 제작자", "담당자")
    ci_coupang = find_col(cols, "쿠팡 등록", "쿠팡등록")
    ci_naver   = find_col(cols, "네이버 등록", "네이버등록")
    ci_imgurl  = find_col(cols, "이미지url", "이미지 url", "사진url")

    mm = re.search(r"(\d+)\s*mm", model_name)
    tab_mm = (mm.group(1) + "mm") if (mm and "일반형" in model_name) else ""
    model = "공용" if "일반형" in model_name else clean_model(model_name)

    # 행 -> media (이미지열 우선)
    row_media = {}
    for (rr, cc), mp in anchors.items():
        if rr in row_media:
            if cc == ci_img:        # 이미지열 정확매칭 우선
                row_media[rr] = mp
        else:
            row_media[rr] = mp

    out = []
    for j, r in enumerate(rows[h+1:]):
        abs_row = h + 1 + j
        def g(i): return clean(r[i]) if 0 <= i < len(r) else ""
        name = re.split(r"[⬇️⬆️➡️↔️→▼▲]", g(ci_name))[0].strip()
        name = re.sub(r"\s*\(단종.*?\)", "", name).strip()
        if not name or "세부스펙" in name or len(name) < 2:
            continue
        if name in ("제품명", "샘플", "총 SKU"):
            continue
        # 이미지: ①시트 삽입이미지(xlsx) 우선 ②없으면 이미지URL 칸
        img_path = ""
        mp = row_media.get(abs_row)
        if mp and os.path.exists(mp):
            dst = f"{IMG_OUT}/{idx:02d}_{abs_row}.jpg"
            if resize_image(mp, dst):
                img_path = dst
        if not img_path and ci_imgurl >= 0:
            u = g(ci_imgurl)
            if u.startswith("http"):
                img_path = u
        out.append({
            "제품명": name,
            "기종": model,
            "재질": norm_material(g(ci_mat)),
            "스트랩 규격": norm_spec(g(ci_spec), tab_mm),
            "체결 형태": norm_buckle(g(ci_buk), name),
            "색상": g(ci_col),
            "샘플링날짜": g(ci_sample),
            "컨텐츠제작자": g(ci_creator),
            "쿠팡등록": g(ci_coupang),
            "네이버등록": g(ci_naver),
            "이미지": img_path,
            "원본탭": clean_model(model_name),
        })
    return out, f"{len(out)}개 (이미지 {sum(1 for x in out if x['이미지'])})"

def main():
    tabs = json.load(open("tabs.json", encoding="utf-8"))  # [[gid,name],...] 순서=워크북순서
    img_maps = build_images.build_ordered()                # 순서 동일
    files = sorted(glob.glob(f"{RAW}/*.csv"))

    all_rows, report = [], []
    for path in files:
        idx = int(os.path.basename(path).split("_")[0])
        name = tabs[idx][1]
        if name in SKIP_TABS:
            report.append((name, "건너뜀(SET/커넥터/깨진탭 → 수동)"))
            continue
        anchors = img_maps[idx] if idx < len(img_maps) else {}
        rows, msg = parse_tab(path, name, idx, anchors)
        all_rows.extend(rows)
        report.append((name, msg))

    base = ["제품명", "기종", "재질", "스트랩 규격", "체결 형태", "색상"]
    # 값이 하나라도 있으면 포함 (신규입력 탭에서 채워지면 자동 노출)
    optional = ["샘플링날짜", "컨텐츠제작자", "쿠팡등록", "네이버등록"]
    fields = base + [c for c in optional if any(r.get(c, "").strip() for r in all_rows)]
    fields += ["이미지", "원본탭"]
    with open("catalog.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_rows)
    # 데모용으로도 복사
    import shutil
    shutil.copy("catalog.csv", "sample-data.csv")

    print("=== 탭별 결과 ===")
    for n, m in report:
        print(f"  {m:>26}  {n}")
    n = len(all_rows)
    print(f"\n총 {n}개 제품 → catalog.csv (+ sample-data.csv)")
    for k in ["재질", "스트랩 규격", "체결 형태", "색상", "이미지"]:
        filled = sum(1 for r in all_rows if r[k].strip())
        print(f"  {k:8} 채움 {filled:3}/{n} ({100*filled//n}%)")
    from collections import Counter
    print("재질 종류:", dict(Counter(r["재질"] for r in all_rows if r["재질"]).most_common()))

if __name__ == "__main__":
    main()
