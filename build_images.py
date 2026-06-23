#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xlsx_x/ (압축 푼 시트) 의 삽입 이미지를 (탭, 행, 열) 로 매핑.
build_image_map() -> { 탭원본이름: { (row,col): media절대경로 } }
탭 원본이름은 workbook.xml 의 시트명(이모지 제거 전 원형) 기준.
"""
import os, re, glob
import xml.etree.ElementTree as ET

X = "xlsx_x"
NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}

def rels(path):
    """rels 파일 → {Id: Target}"""
    d = {}
    if not os.path.exists(path):
        return d
    for rel in ET.parse(path).getroot():
        d[rel.get("Id")] = rel.get("Target")
    return d

def sheet_files():
    """workbook 순서대로 [(시트명, worksheets/sheetN.xml 경로)]"""
    wb = ET.parse(f"{X}/xl/workbook.xml").getroot()
    rmap = rels(f"{X}/xl/_rels/workbook.xml.rels")
    out = []
    for sh in wb.find("main:sheets", NS):
        name = sh.get("name")
        rid = sh.get(f"{{{NS['r']}}}id")
        target = rmap.get(rid, "")
        out.append((name, os.path.normpath(f"{X}/xl/{target}")))
    return out

def drawing_for_sheet(sheet_path):
    r = rels(os.path.join(os.path.dirname(sheet_path), "_rels", os.path.basename(sheet_path) + ".rels"))
    for tid, tgt in r.items():
        if "drawings/drawing" in tgt:
            return os.path.normpath(os.path.join(os.path.dirname(sheet_path), tgt))
    return None

def parse_drawing(draw_path):
    """drawing → [(row, col, media절대경로)]"""
    if not draw_path or not os.path.exists(draw_path):
        return []
    r = rels(os.path.join(os.path.dirname(draw_path), "_rels", os.path.basename(draw_path) + ".rels"))
    root = ET.parse(draw_path).getroot()
    out = []
    for anc in root:  # oneCellAnchor / twoCellAnchor
        frm = anc.find("xdr:from", NS)
        if frm is None:
            continue
        col = int(frm.find("xdr:col", NS).text)
        row = int(frm.find("xdr:row", NS).text)
        blip = anc.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
        if blip is None:
            continue
        embed = blip.get(f"{{{NS['r']}}}embed")
        media = r.get(embed)
        if not media:
            continue
        mpath = os.path.normpath(os.path.join(os.path.dirname(draw_path), media))
        out.append((row, col, mpath))
    return out

def build_image_map():
    m = {}
    for name, sheet_path in sheet_files():
        draw = drawing_for_sheet(sheet_path)
        anchors = parse_drawing(draw)
        if anchors:
            m[name] = {(row, col): mp for (row, col, mp) in anchors}
    return m

def build_ordered():
    """워크북(=raw 파일) 순서대로 [ {(row,col): media}, ... ]. 앵커 없으면 빈 dict."""
    out = []
    for name, sheet_path in sheet_files():
        anchors = parse_drawing(drawing_for_sheet(sheet_path))
        out.append({(row, col): mp for (row, col, mp) in anchors})
    return out

if __name__ == "__main__":
    m = build_image_map()
    print("탭별 이미지 수:")
    for name, d in m.items():
        print(f"  {len(d):3}  {name}")
    # 화웨이 탭 검증: 행/열 분포
    for key in m:
        if "화웨이" in key:
            print(f"\n[검증] {key} 앵커(행,열) 샘플:")
            for (row, col), mp in sorted(m[key].items())[:8]:
                print(f"   row={row} col={col}  {os.path.basename(mp)} ({os.path.getsize(mp)}B)")
