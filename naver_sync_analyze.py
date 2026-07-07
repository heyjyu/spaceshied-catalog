"""네이버 스토어 ↔ 카탈로그 대조 분석 → naver_sync_report.html 생성용 데이터.

사용: python3 naver_sync_analyze.py <naver_products.json> <catalog.json> <out_data.json>
- 신규 등록 후보: 웨어러블 카테고리 중 카탈로그 미매칭 → '호환' 뒤 코어이름으로 그룹핑
- 정보 채움 후보: 카탈로그의 빈 store_url/image/price 에 네이버 값 제안(신뢰도 표기)
"""
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher

WEARABLE = "웨어러블 디바이스 액세서리"


def norm(s):
    return re.sub(r"[\s\-‐–—/·..,()\[\]+&*]", "", str(s or "").lower())


def tokens(s):
    s = re.sub(r"\([^)]*\)", " ", str(s or ""))
    return [t for t in re.split(r"[\s/·,+&\-]+", s.lower()) if len(t) >= 2]


def core_name(name):
    """'기종들 호환 제품명 규격' → 제품명 규격 (그룹 키). 호환 없으면 원문."""
    parts = name.split(" 호환 ")
    core = parts[-1].strip() if len(parts) > 1 else name.strip()
    return re.sub(r"\s+", " ", core)


def model_prefix(name):
    parts = name.split(" 호환 ")
    return parts[0].strip() if len(parts) > 1 else ""


def main(nv_path, cat_path, out_path):
    nv = json.load(open(nv_path))
    cat = json.load(open(cat_path))

    # ---- 매칭 (store_url 번호 → 이름 부분포함 → 토큰 전체포함) ----
    by_no = {x["no"]: x for x in nv}
    nv_norm = [(norm(x["name"]), set(tokens(x["name"])), x) for x in nv]

    url_match = {}      # cat id → naver product (확정)
    for r in cat:
        m = re.search(r"products/(\d+)", r.get("store_url") or "")
        if m and int(m.group(1)) in by_no:
            url_match[r["id"]] = by_no[int(m.group(1))]

    def name_candidates(r):
        cn = norm(re.sub(r"\([^)]*\)", "", r["name"]))
        ctoks = tokens(r["name"])
        subs, toks_hit = [], []
        for nn, ntoks, x in nv_norm:
            if len(cn) >= 4 and cn in nn:
                subs.append(x)
            elif len(ctoks) >= 2 and all(any(t in n2 or n2 in t for n2 in ntoks) for t in ctoks):
                toks_hit.append(x)
        return subs, toks_hit

    matched_nv_nos = set()
    fills = []
    bad_rows = []
    cat_only = []

    for r in cat:
        name = str(r.get("name") or "").strip()
        if len(norm(name)) < 3:
            bad_rows.append({"id": r["id"], "name": name})
            continue
        missing = []
        if not (r.get("store_url") or "").strip():
            missing.append("store_url")
        if not (r.get("image") or "").strip():
            missing.append("image")
        if not str(r.get("price") or "").strip():
            missing.append("price")

        exact = url_match.get(r["id"])
        subs, toks_hit = name_candidates(r)
        for x in subs + toks_hit:
            matched_nv_nos.add(x["no"])
        if exact:
            matched_nv_nos.add(exact["no"])

        cands = subs or toks_hit
        if not exact and not cands:
            cat_only.append({"id": r["id"], "name": name, "status": r.get("status") or ""})
            continue
        if not missing:
            continue

        # 대표 후보: URL 확정 > 기종(model) 일치 가점 > 유사도
        if exact:
            best, conf = exact, "URL확정"
        else:
            mtoks = tokens(r.get("model") or "")
            def score(x):
                bonus = sum(1 for t in mtoks if t in x["name"].lower()) * 0.15
                return SequenceMatcher(None, norm(name), norm(x["name"])).ratio() + bonus
            best = max(cands, key=score)
            conf = "이름높음" if (len(cands) == 1 or subs) else "확인필요"

        proposal = {}
        if "store_url" in missing:
            proposal["store_url"] = f"https://smartstore.naver.com/spaceshied/products/{best['no']}"
        if "image" in missing and best.get("img"):
            proposal["image"] = best["img"]
        if "price" in missing and best.get("salePrice"):
            proposal["price"] = str(best["salePrice"])
        if not proposal:
            continue
        fills.append({
            "id": r["id"], "name": name, "model": r.get("model") or "",
            "curImage": (r.get("image") or "").strip(),
            "missing": missing, "proposal": proposal,
            "matchName": best["name"], "matchNo": best["no"],
            "matchImg": best.get("img", ""), "conf": conf,
            "altCount": max(0, len(cands) - 1),
        })

    # ---- 신규 등록 후보: 웨어러블 & 미매칭 → 코어이름 그룹 ----
    un_wear = [x for x in nv if x["no"] not in matched_nv_nos and WEARABLE in x["cat"]]
    groups = {}
    for x in un_wear:
        key = norm(core_name(x["name"]))
        g = groups.setdefault(key, {"core": core_name(x["name"]), "variants": [], "models": set()})
        g["variants"].append(x)
        mp = model_prefix(x["name"])
        if mp:
            g["models"].add(mp)

    new_groups = []
    for g in groups.values():
        vs = g["variants"]
        prices = [v["salePrice"] for v in vs if v.get("salePrice")]
        rep = max(vs, key=lambda v: (v["status"] == "SALE", bool(v.get("img"))))
        new_groups.append({
            "core": g["core"],
            "count": len(vs),
            "models": sorted(g["models"]),
            "img": rep.get("img", ""),
            "repNo": rep["no"],
            "price": Counter(prices).most_common(1)[0][0] if prices else None,
            "priceMin": min(prices) if prices else None,
            "priceMax": max(prices) if prices else None,
            "statuses": dict(Counter(v["status"] for v in vs)),
            "variants": [{"no": v["no"], "name": v["name"], "price": v.get("salePrice"),
                          "status": v["status"], "img": v.get("img", "")} for v in vs],
        })
    new_groups.sort(key=lambda g: -g["count"])

    # ---- 비-스트랩 카테고리 요약 (참고) ----
    un_other = [x for x in nv if x["no"] not in matched_nv_nos and WEARABLE not in x["cat"]]
    other_summary = [{"cat": c, "count": n} for c, n in
                     Counter(x["cat"] for x in un_other).most_common()]

    data = {
        "counts": {
            "naverTotal": len(nv), "catalogTotal": len(cat),
            "urlMatched": len(url_match), "newGroups": len(new_groups),
            "newVariants": len(un_wear), "fills": len(fills),
            "catalogOnly": len(cat_only), "otherProducts": len(un_other),
        },
        "newGroups": new_groups,
        "fills": sorted(fills, key=lambda f: ({"URL확정": 0, "이름높음": 1, "확인필요": 2}[f["conf"]], f["name"])),
        "catalogOnly": cat_only,
        "badRows": bad_rows,
        "otherSummary": other_summary,
    }
    json.dump(data, open(out_path, "w"), ensure_ascii=False)
    print("newGroups:", len(new_groups), "(variants:", len(un_wear), ")")
    print("fills:", len(fills), dict(Counter(f["conf"] for f in fills)))
    print("catalogOnly:", len(cat_only), "/ badRows:", len(bad_rows), "/ other:", len(un_other))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
