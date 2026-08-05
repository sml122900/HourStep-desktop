# 2026-08-05 (2차 세션) — D0 검증 자동화 + 검증 정책 수립

> 1차 세션(D0 구현)은 `2026-08-05-phase-d0.md` 참고.
> 이 세션은 "만든 걸 어떻게 믿을 것인가"에 대한 작업이다.

## 오늘 한 것

D0 수동 검증 절차 A~F를 사람 손 없이 얼마나 닫을 수 있는지 밀어붙였고,
그 과정에서 **사고를 하나 냈고**, 그 사고가 검증 정책과 `--debug-cmd` 훅으로 이어졌다.

## 1. "네가 검증 못해?" — 자동 검증 1차

수동 검증 문서를 사용자에게 넘겼더니 나온 질문. 과소평가하고 있었다.
실제로 가능한 것이 꽤 많았다.

| 수단 | 검증한 것 |
| --- | --- |
| `EnumWindows` + `GetWindowLongW(GWL_EXSTYLE)` | 오버레이 확장 스타일, 좌표, 표시 여부 |
| `GetForegroundWindow` | 카드 표시 전후 포커스 불변 |
| `Graphics.CopyFromScreen` | 카드가 실제로 그려지는지 (눈으로 확인) |
| `WindowFromPoint` + `GetAncestor(GA_ROOT)` | 어느 창이 클릭을 먹는지 |
| `PostMessage(WM_CLOSE)` | 창 닫기 → 트레이 생존 |

성과:
- **B-1** 캡처로 카드 렌더링 확인 (Chrome/YouTube 위)
- **B-3** `WS_EX_TOOLWINDOW` 설정 + `WS_EX_APPWINDOW` 해제 → Alt+Tab 후보 판정 False
  (같은 판정기로 메모장은 True → 로직 자체가 맞다는 걸 같이 보임)
- **B-5** 숨긴 뒤 같은 좌표 히트테스트가 실제 Chrome 반환 (유령 사각형 회귀)
- **C-2** F11 borderless 전체화면 위에 카드가 그려짐 (캡처)
- **D** `Screen.AllScreens` = 1개 → 해당 없음 확정

### 히트테스트 오독

`WindowFromPoint` 가 `Chrome_RenderWidgetHostHWND` / `Chrome Legacy Window` 를 반환해서
"카드 위인데 브라우저가 잡힌다"고 30분쯤 헤맸다.
**WebView2 가 Chromium 기반이라 자식 창 클래스명이 그런 것**이고, 브라우저 Chrome 이 아니다.
`GetAncestor(h, GA_ROOT)` 로 올라가면 `HourStep Overlay` 가 나온다.

덕분에 "투명 영역도 클릭을 가로챈다"는 알려진 한계가 **추정에서 실측으로** 승격됐다.
카드 위·카드 배경·투명 영역 6개 지점 전부 root 가 오버레이였다.

## 2. 사고 — 합성 입력이 사용자 세션을 침범

`SendInput` 으로 실제 마우스 클릭과 키 입력을 넣어 B-2/B-4를 검증했다. 통과는 했지만:

- 메모장을 새로 띄운 줄 알았는데 `FindByTitleContains("메모장")` 이
  **이미 최소화돼 있던 사용자의 메모장**을 잡았다. 좌표가 `(-32000, -32000)` 이라
  클릭이 화면 `(0,0)` 으로 갔고, 타이핑(`BEFORE-`, `AFTER`)이 **사용자의 Chrome** 으로 들어갔다
- C-1 마지막 단계에서 테스트 창이 포그라운드를 잃어, 화면 중앙 클릭과 `Esc` 가
  **사용자의 Claude 앱** 으로 들어갔다

자동화가 자기 창만 건드린다는 보장이 없다는 걸 몸으로 배웠다.
포그라운드는 언제든 바뀌고, 창 검색은 남의 창을 잡을 수 있다.

## 3. 검증 정책 수립

사용자가 정책을 확정했고 CLAUDE.md 「검증 정책」에 원문 그대로 넣었다.

- 자동 검증 우선순위: ① 프로그램적 상태 검사 ② 앱 디버그 훅(`--debug-cmd`) — **없으면 만든다**
- **사용자 데스크톱 세션에 합성 입력 주입 금지.** 클릭 E2E 는 Windows Sandbox/VM 에서만
- 재부팅·지각 판단만 사용자 수동 확인

여기에 운영 세부를 덧붙였다:
- 화면 캡처는 읽기 전용이라 허용하되 **증거이지 최종 판정이 아니다**
  (DWM 합성·하드웨어 오버레이 때문에 캡처와 실화면이 다를 수 있음)
- `PostMessage(WM_CLOSE)` 같은 창 메시지는 합성 입력이 아니므로 허용
- 자동 검증 결과에는 **획득 방법을 함께 기록** — 나중에 방법이 금지되면
  어떤 근거가 무효인지 가려낼 수 있어야 한다

마지막 항목을 바로 적용해서 결과표에 `방법` 열을 만들고,
`SendInput` 으로 얻은 B-2'(클릭 시 포커스)와 B-4b(실제 클릭 전달)를 격리환경 재검증 대상으로 내렸다.

## 4. `--debug-cmd` 훅

### 내가 틀렸던 전제

처음엔 "상주 앱이라 이미 떠 있는 인스턴스에 명령을 보내야 한다"고 보고
설계 갈림길을 3개(single-instance 플러그인 / named pipe / 환경변수)로 정리해 사용자에게 물었다.
**전제가 틀렸다.** 검증은 내가 프로세스를 띄우는 쪽이므로
**한 프로세스 수명 안에서 명령 시퀀스를 실행**하면 충분하다.
D3 범위인 single-instance 플러그인을 당겨올 이유가 없었다.

자세한 결정 기록은 `docs/decisions/0002-debug-cmd-hook.md`.

### 사용법

`--` 를 **세 번** 써야 앱까지 전달된다 (pnpm 이 하나, tauri 가 하나 먹는다).
두 번으로 시작했다가 `--debug-cmd` 가 cargo 인자로 넘어가서 알았다.

```powershell
pnpm tauri dev -- -- -- --debug-cmd "wait:4000,dump,start-session,wait:1500,dump,quit"
```

### 검증 결과

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| **F-1** 작업 시작 placeholder | ✅ | `start-session` 전후 `dump` 가 **완전히 동일** — 로그 한 줄 외 창 상태 변화 없음 |
| **E-4** 트레이 종료 | ✅ | `quit` 후 `Get-Process` 결과 없음 |
| **B-4a** 액션 체인 | ✅ | `done`/`snoozed`/`skipped` 각각 로그 + `overlay.visible` true→false |

**정직하게 못 닫은 것**: 훅은 핸들러를 직접 부르는 것이라
"실제 마우스 클릭이 `WS_EX_NOACTIVATE` 창에 닿는가"(B-4b)와
"클릭해도 포커스가 안 넘어가는가"(B-2')는 증명할 수 없다. 격리환경 E2E 몫이다.

### 릴리스 오염 확인

`#[cfg(debug_assertions)]` 게이트가 실제로 먹는지 바이너리를 바이트 스캔했다.

```
--debug-cmd        릴리스 바이너리에 존재: False
start-session      릴리스 바이너리에 존재: False
overlay-action     릴리스 바이너리에 존재: False
```

릴리스 빌드에서 `overlay::is_visible` 이 dead_code 경고를 냈는데,
이게 곧 "debug_cmd 모듈이 컴파일되지 않았다"는 증거이기도 했다.
`#[cfg_attr(not(debug_assertions), allow(dead_code))]` 로 정리.

## 오늘 밟은 함정들

| 함정 | 증상 | 원인 / 해결 |
| --- | --- | --- |
| `Add-Type` 한글 주석 | C# 컴파일 에러 폭발 | 임시 `.cs` 인코딩 문제. **C# 소스는 ASCII 만** |
| `.ps1` 한글 깨짐 | 파서 에러 (`Missing ')'`) | PS 5.1 은 BOM 없는 UTF-8 을 cp949 로 읽는다. **UTF-8 BOM 으로 저장** |
| `pnpm tauri dev -- --` | `--debug-cmd` 가 cargo 로 감 | pnpm 과 tauri 가 `--` 를 하나씩 먹는다. **세 번** |
| `is_visible()` | 오버레이가 항상 숨김으로 나옴 | tao 의 `WindowFlags::VISIBLE` 캐시. **Win32 `IsWindowVisible` 직접 호출** |

마지막 것은 1차 세션의 `hide()` no-op 버그와 **완전히 같은 뿌리**다.
`docs/troubleshooting/tao-visible-cache.md` 로 따로 정리했다.

## 남은 것 (전부 사용자 몫)

정책상 자동화할 수 없는 것만 남았다.

- **C-1** 유튜브 플레이어 전체화면 / **C-3~C-5** 플레이어·게임 (특히 배타적 전체화면)
- **E-4'** 트레이 아이콘이 눈에서 사라지는가 — 지각 판단
- **A** 재부팅 자동 상주

C 항목용 반복 모드:

```powershell
pnpm tauri dev -- -- -- --debug-cmd "wait:8000,overlay-show,wait:8000,overlay-hide,wait:12000,loop"
```

## 다음 (D1)

- `WorkSession` / `Behavior` / `Occurrence` / `CompletionLog` 도메인
- `computeNextOccurrences(session, behaviors, now, horizon)` 순수 함수 + vitest
- 오버레이 카드에 실제 Behavior 주입 (지금은 `SPIKE_PAYLOAD` 고정)
- 투명 영역 클릭 차단 수정 여부 결정 (D1 or D3)
