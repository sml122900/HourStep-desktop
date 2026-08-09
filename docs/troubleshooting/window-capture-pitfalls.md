# 창 캡처 자동화가 세 번 조용히 빗나갔다 — 창을 못 찾고, 엉뚱한 창을 찾고, 엉뚱한 순간을 찍었다

- 날짜: 2026-08-09 (Phase D2.8)
- 환경: Windows 11, Windows PowerShell 5.1, Tauri 2 (WebView2)

## 문제 상황

D2.8 시각 확인을 위해 **4화면 × 라이트·다크 = 8장**을 자동으로 캡처해야 했다.
방식은 기존과 같다 — 대상 창을 일시 `HWND_TOPMOST` 로 올리고 그 사각형만
`Graphics.CopyFromScreen` 으로 읽는다 (합성 입력 금지, CLAUDE.md 「검증 정책」).

세 번 연속으로 결과가 틀렸는데, **세 번 다 조용히 틀렸다.** 스크립트는 정상 종료하고
파일도 생겼다. 캡처 결과를 눈으로 보고 나서야 잘못됐음을 알았다.

## 시도한 것들 / 증상별 원인

### ① 창을 아예 못 찾는다 — `FindWindow` 가 계속 0

```
waiting for the main window...
TIMEOUT: main window never appeared     ← 창은 화면에 멀쩡히 떠 있는데
```

같은 코드를 도구가 여는 PowerShell 세션에 **직접** 붙여 넣으면 잘 찾는다.
차이는 실행 방식뿐이었다.

```powershell
& powershell -NoProfile -File .\capture.ps1   # ✗ FindWindow / EnumWindows → 0
& .\capture.ps1                               # ✓ 같은 코드가 잘 찾는다
```

**원인: 자식 `powershell -File` 프로세스는 이 환경에서 사용자 데스크톱의 창을 보지 못한다.**
(윈도 스테이션/데스크톱이 갈린다.) 창 열거 API 가 예외 없이 **빈 결과**를 주므로
"아직 안 떴나 보다" 로 오해하기 딱 좋다.

**해결: 캡처 스크립트는 도구 세션 안에서 실행한다.** `&` 로 `.ps1` 을 호출하면
새 프로세스가 아니라 현재 프로세스의 자식 스코프에서 돈다.

> 곁가지: 처음엔 파싱 에러부터 났다. PowerShell 5.1 은 BOM 없는 UTF-8 `.ps1` 을
> 시스템 ANSI 코드페이지로 읽어 한글 주석이 깨지면서 스크립트가 죽는다.
> **BOM 을 붙이거나 스크립트를 ASCII 로 쓰고 한글은 인자로 넘긴다.**

### ② 엉뚱한 창을 찾는다 — 160×28 짜리 유령

```
OK settings-dark 160x28     ← 설정 창은 576x759 다
```

**원인: WebView2 가 앱 창과 똑같은 제목을 가진 보조 창을 하나 더 띄운다.**
제목만으로 찾으면 그쪽이 걸린다.

**해결: 같은 제목 중 가장 큰 창을 고른다.** 면적 하한도 뒀다 —
가장 작은 실제 창인 오버레이 카드가 540×132(≈70,000)이고 유령이 160×28(=4,480)이라
20,000 으로 넉넉히 갈린다.

```csharp
// 같은 제목이 여러 개다. 면적이 가장 큰 것이 진짜 앱 창
if (a > best) { best = a; found = h; }
return best >= 20000 ? found : IntPtr.Zero;
```

### ③ 엉뚱한 순간을 찍는다 — 앵커가 부팅 창에 걸렸다

`--debug-cmd` 시퀀스(`main-show → settings-open → …`)는 자기 시간표대로 흐르고,
캡처 스크립트는 "메인 창이 보이면 그때부터 8초 간격" 으로 따라가게 짰다. 결과가
`MISS, MISS, OK, OK, MISS, OK, MISS, OK` 처럼 반쯤 맞았다.

**원인: 메인 창은 앱이 부팅될 때 이미 보인다.** `main-show` 를 기다린 줄 알았는데
부팅 시점의 창을 잡고 있었고, 그 뒤 전부 시간표가 밀렸다.

**해결 1 (앵커):** 시퀀스를 `main-hide` 로 시작하고, **보임 → 숨김 → 보임** 세 전이를
모두 통과해야 앵커로 인정한다. 부팅 창으로는 이 조건을 만족할 수 없다.

**해결 2 (더 중요):** 벽시계 시간표를 **버렸다**. 창이 뜨는 것을 보고 찍는다.

```powershell
Wait-Vis $SettingsTitle $true "settings window ($theme)"
Start-Sleep -Milliseconds 900      # 렌더 안정화
Snap $SettingsTitle "settings-$theme"
```

앱의 대기 시간이 바뀌어도, 빌드가 느려도 어긋나지 않는다.
같은 창을 두 번 찍어야 하는 구간(설정 목록 → AI 패널)만 상대 대기로 남겼다.

## 최종 결과

```
anchor: main-show at 17:16:54
OK main-dark 796x819      OK settings-dark 576x759
OK ai-dark 576x759        OK overlay-dark 540x132
OK main-light 796x819     OK settings-light 576x759
OK ai-light 576x759       OK overlay-light 540x132
done
```

그리고 이 캡처가 실제로 **회귀 하나를 잡았다** — 설정 창 가로 스크롤바
(`docs/troubleshooting/grid-auto-track-max-content-overflow.md`).

## 재발 방지

- **캡처 결과의 크기를 항상 같이 출력한다.** `OK settings-dark 160x28` 한 줄이
  ②를 알려줬다. "저장했다" 만 찍으면 파일을 열어 보기 전까지 모른다
- 창을 기다릴 때는 **존재**가 아니라 **상태 전이**를 기다린다. 부팅 때 이미 있는 창이 있다
- 자동 검증이 "조용히 통과" 할 수 있는 자리를 의심한다. 이번 Phase 에서만
  같은 종류를 두 번 밟았다 — 여기와, CSS 를 빈 문자열로 읽고 통과하던 lint 테스트
  (`docs/decisions/0010`)
- 요약은 CLAUDE.md 「검증 정책 · 운영 세부」에 세 줄로 넣어 뒀다

## 이력서 소재 한 줄

> GUI 앱 스크린샷 회귀 검증을 자동화하며 "조용히 잘못된 결과를 내는" 실패 세 가지
> (프로세스 격리로 인한 창 열거 실패 / 프레임워크 보조 창 오인 / 시간 기반 동기화 어긋남)를
> 진단하고, 벽시계 스케줄을 창 상태 대기로 바꿔 결정론적으로 재설계 — 이 캡처가 실제 UI 회귀를 검출.

## 관련

- `docs/decisions/0002-debug-cmd-hook.md` — 합성 입력 대신 `--debug-cmd` 로 검증하는 근거
- `docs/troubleshooting/synthetic-input-leak.md` — 합성 입력이 사용자 환경을 침범한 사고
- `docs/daily/2026-08-09-phase-d2.8.md`
