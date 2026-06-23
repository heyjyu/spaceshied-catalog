#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
구글시트에서 원본 데이터 일괄 다운로드.
1) htmlview → 탭 목록(gid+이름) 추출 → tabs.json
2) 각 탭 gviz CSV → raw/
3) 시트 전체 xlsx → sheet.xlsx → 압축해제 xlsx_x/ (삽입 이미지 포함)

사용: python3 fetch.py  (SHEET_ID 는 아래 상수 또는 인자)
"""
import json, os, re, subprocess, sys

SHEET_ID = sys.argv[1] if len(sys.argv) > 1 else "1zM4NUC31V81b3l26DyR6Lnw3fwJBzD5uzlcaWHVVATo"
BASE = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"

def curl(url, out):
    subprocess.run(["curl", "-sL", url, "-o", out], check=True)

def get_tabs():
    curl(f"{BASE}/htmlview", "sheet.html")
    s = open("sheet.html", encoding="utf-8").read()
    pairs = re.findall(r'items\.push\(\{name: "([^"]*)",[^}]*?gid: "(\d+)"', s)
    out, seen = [], set()
    for name, gid in pairs:
        if gid not in seen:
            seen.add(gid)
            # htmlview JS 문자열은 "/" 를 "\/" 로 이스케이프함 (한글/이모지는 그대로)
            out.append([gid, name.replace("\\/", "/")])
    json.dump(out, open("tabs.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"탭 {len(out)}개 → tabs.json")
    return out

def get_raw(tabs):
    os.makedirs("raw", exist_ok=True)
    for i, (gid, name) in enumerate(tabs):
        curl(f"{BASE}/gviz/tq?tqx=out:csv&gid={gid}", f"raw/{i:02d}_{gid}.csv")
    print(f"raw CSV {len(tabs)}개 → raw/")

def get_xlsx():
    curl(f"{BASE}/export?format=xlsx", "sheet.xlsx")
    os.makedirs("xlsx_x", exist_ok=True)
    subprocess.run(["unzip", "-o", "-q", "sheet.xlsx", "-d", "xlsx_x"], check=True)
    n = len(os.listdir("xlsx_x/xl/media")) if os.path.isdir("xlsx_x/xl/media") else 0
    print(f"xlsx 해제 → xlsx_x/ (삽입이미지 {n}개)")

if __name__ == "__main__":
    tabs = get_tabs()
    get_raw(tabs)
    get_xlsx()
    print("완료. 이제 python3 normalize.py 실행.")
