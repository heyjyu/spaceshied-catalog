/**
 * 스페이스쉴드 카탈로그 — 신규 스트랩 등록 받기 (Google Apps Script Web App)
 *
 * [설치] (한 번만, 5분)
 *  1) 등록할 구글시트 열기 → 확장프로그램 → Apps Script
 *  2) 이 코드 전체를 붙여넣기, 아래 SHEET_ID 가 그 시트 ID인지 확인
 *  3) 우측 상단 "배포 → 새 배포 → 유형: 웹 앱"
 *     - 실행 계정: 나
 *     - 액세스 권한: "모든 사용자"
 *  4) 생성된 "웹 앱 URL" 복사 → add.html 의 GAS_URL 에 붙여넣기
 *
 * 신규 등록은 시트의 "신규입력" 탭에 한 줄씩 쌓이고,
 * 이미지는 Drive 의 "카탈로그_이미지" 폴더에 저장됩니다.
 * 사이트 반영은 ./build.sh 실행 후.
 */

var SHEET_ID = "1zM4NUC31V81b3l26DyR6Lnw3fwJBzD5uzlcaWHVVATo";
var TAB = "신규입력";
var IMG_FOLDER = "카탈로그_이미지";
var HEADERS = ["제품명","기종","재질","스트랩 규격","체결 형태","색상",
               "샘플링날짜","컨텐츠제작자","쿠팡등록","네이버등록","이미지URL","등록시각"];

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);

    var imgUrl = "";
    if (d.imageBase64) {
      imgUrl = saveImage_(d.imageBase64, d.imageName || "strap.jpg", d.제품명);
    }
    sh.appendRow([
      d.제품명 || "", d.기종 || "", d.재질 || "", d["스트랩 규격"] || "",
      d["체결 형태"] || "", d.색상 || "", d.샘플링날짜 || "", d.컨텐츠제작자 || "",
      d.쿠팡등록 ? "O" : "", d.네이버등록 ? "O" : "", imgUrl, new Date()
    ]);
    return json_({ ok: true, imageUrl: imgUrl });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function saveImage_(b64, name, prod) {
  var folders = DriveApp.getFoldersByName(IMG_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IMG_FOLDER);
  var m = b64.match(/^data:(.*?);base64,(.*)$/);
  var type = m ? m[1] : "image/jpeg";
  var data = m ? m[2] : b64;
  var blob = Utilities.newBlob(Utilities.base64Decode(data), type,
              (prod ? prod.substring(0, 20) + "_" : "") + name);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // 이미지 임베드용 thumbnail URL (리사이즈됨)
  return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w600";
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, msg: "스페이스쉴드 카탈로그 등록 엔드포인트 작동중" });
}
