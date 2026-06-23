#!/bin/bash
# 시트에서 최신 데이터 받아 카탈로그 재생성 (한 방)
#   사용: ./build.sh            (기본 시트)
#        ./build.sh <SHEET_ID>  (다른 시트)
set -e
cd "$(dirname "$0")"
echo "▶ 1/2 시트 다운로드…"
python3 fetch.py "$@"
echo "▶ 2/2 카탈로그 변환 + 이미지 추출…"
python3 normalize.py
echo "✅ 완료: catalog.csv / images/ 갱신됨. 웹앱 새로고침하면 반영."
