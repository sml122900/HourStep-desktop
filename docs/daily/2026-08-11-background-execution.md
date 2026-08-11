# 2026-08-11 — "트레이" 대신 "백그라운드 실행" + 최초 1회 안내 토스트

중장년 사용자(1번 타겟은 개발자 본인이지만, 부모님 PC 에도 설치하는 게 목표) 는
"트레이"가 뭔지 모른다. 동작은 그대로 두고 언어만 사용자가 이해할 수 있는 말로
바꿔 달라는 요청으로 시작했다. 진행하다 보니 실제 버그 하나(WebView2 의
`visibilitychange` 미신뢰, `docs/troubleshooting/webview2-visibilitychange-unreliable.md`)
를 만나 설계가 한 번 뒤집혔다.

## 1. 문구 전수 교체

`grep 트레이` 기준으로 사용자 노출 문구에서 전부 "백그라운드"로 바꿨다. 코드·문서
내부 용어(주석, 파일명 등)는 규칙대로 남겼다.

- `TRAY.QUIT` / `tray.rs` 의 메뉴 라벨: "종료" → **"완전히 종료"** (숨김과 구분하기 위해)
- `AUTOSTART_HINT`/`SOUND_HINT`/`MAIN.DESCRIPTION`: "트레이에 상주" → "백그라운드에서 실행"
- `MAIN.HIDE_BUTTON` → `MAIN.BACKGROUND_BUTTON`("백그라운드에서 실행")로 개명

## 2. 버튼 재배치

사용자가 위치·크기 둘 다 가독성을 올려 달라고 했다. 옵션 세 개(헤더/세션 카드 옆/
헤더-세션 사이 전용 줄)를 미리보기로 제시했고, **헤더, 설정 버튼 왼쪽**을 골랐다.
`Button` 컴포넌트의 기본 크기(md, 34px)를 그대로 써서 옆의 설정 버튼(sm, 28px)보다
커 보이게 했다 — 새 크기 토큰을 만들지 않고 기존 두 단만으로 해결했다.

## 3. 최초 1회 안내 — 설계가 한 번 뒤집힌 지점

처음엔 표준적인 방법대로 짰다: `document.hidden`/`visibilitychange` 로 "창이 막 숨겨졌다"를
감지하고, 그때 `backgroundNoticeShown` 플래그를 보고 Windows 시스템 토스트
(`@tauri-apps/plugin-notification`, 이번에 새로 추가)를 한 번만 띄운다.

`--debug-cmd main-hide` 로 자동 검증했는데 **로그가 5초를 기다려도 한 줄도 안 찍혔다.**
디버깅 과정은 `docs/troubleshooting/webview2-visibilitychange-unreliable.md` 에 남겼다 —
결론만 적으면: Tauri 의 공식 `window.hide()`(`ShowWindow(SW_HIDE)`) 로 숨겨도 WebView2 는
`visibilitychange` 를 신뢰성 있게 주지 않는다. 오버레이가 raw Win32 로 숨어서
`WebviewWindow::is_visible()` 이 어긋나는 것(`docs/decisions/0001`)과 같은 결의 문제였다.

**고친 방향**: Page Visibility 를 믿는 대신, Rust 가 창을 숨길 때 명시적으로
`main://hidden` 이벤트를 쏘게 했다(`windows::hide_main()`). X 닫기(`CloseRequested`)와
[백그라운드에서 실행] 버튼 둘 다 이 함수 하나로 모은다 — 판단(토스트를 띄울지)은
여전히 TS 가 하고, "숨었다는 사실"만 Rust 가 보증한다. 근거는 `docs/decisions/0013`.

## 4. 검증

실 도그푸딩 DB 대상, `--debug-cmd`:

```
main-hide → wait:3000 → main-show → wait:1000 → main-hide → wait:3000 → db-dump
```

- 첫 `main-hide` 뒤 `[debug] background-notice granted=true` 1회만 찍힘
- 같은 프로세스 안 두 번째 `main-hide` → 로그 없음 (플래그가 이미 true)
- 프로세스를 완전히 새로 띄운 뒤 `main-hide` → 로그 없음 (재부팅을 넘어 지속됨을 확인)
- `db-dump` 전후 `sessions=11 logs=54` 동일 — 세션·기록은 만들지 않았다

## 남은 것 (눈으로)

- 실제 Windows 토스트가 화면에 보였는지, 위치·문구가 자연스러운지 (기존 알림음처럼
  자동 검증은 "시도했다"까지만 확인하고 지각 판단은 사용자 몫)
- 헤더에 옮긴 [백그라운드에서 실행] 버튼의 배치가 실제로 편한지
