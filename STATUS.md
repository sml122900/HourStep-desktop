# STATUS — HourStep Desktop 진행 상황

> 이 파일이 **현재 상태의 단일 출처(single source of truth)** 다.
> 작업을 이어갈 때 가장 먼저 읽고, 작업이 끝나면 여기부터 갱신한다.
> 배경·규칙은 `CLAUDE.md`, 상세 기록은 `docs/daily/`·`docs/decisions/`.

**마지막 갱신: 2026-08-07** · **현재 Phase: D0 완료 → D1 착수**

---

## 완료

- **D0 구현 완료 (2026-08-05)** — 스캐폴딩 / 트레이 상주 / 부팅 자동실행 / 오버레이 스파이크 / NSIS·MSI 빌드 확인.
  실측: 오버레이가 주 모니터 중앙 상단(640,0)에 TOPMOST+TOOLWINDOW+NOACTIVATE로 뜨고 포커스를 뺏지 않음. 메모리 약 32MB.
  일지 `docs/daily/2026-08-05-phase-d0.md`
- **D0 검증 자동화 완료 (2026-08-05)** — 검증 정책 수립 + `--debug-cmd` 훅 구축.
  자동으로 닫은 항목: B-1/B-3/B-5(상태 검사·캡처·히트테스트), B-4a/E-4/F-1(훅), C-2, D(모니터 1대라 해당 없음), E-1~E-3.
  일지 `docs/daily/2026-08-05-d0-verification.md` / 결정 `docs/decisions/0002-debug-cmd-hook.md`

- **D0 수동 검증 완료 (2026-08-07)** — 남아 있던 4건 전부 통과, **실패 항목 없음**.
  - **B-2' / B-4b** — 실제 마우스 클릭이 `WS_EX_NOACTIVATE` 오버레이에 닿고, 클릭 후에도 포커스가 뒤 창에 유지됨.
    3버튼(`done`/`snoozed`/`skipped`) 전부 정상. **Sandbox/VM E2E 불필요해짐**
  - **C-1/C-3/C-4/C-5** — 유튜브 Fullscreen API·팟플레이어·게임 borderless·**게임 exclusive 전부 표시됨**.
    실패 목록 비어 있음 (예상 밖 — 「알려진 한계 2」가 이 환경에선 해당 없음)
  - **E-4'** — 트레이 `종료` 시 아이콘 즉시 소멸, 유령 아이콘 없음
  - **A** — NSIS 설치본에서 Run 키 `HourStep.exe --autostart` 확인, 재부팅 후 창 깜빡임 없이 트레이만 상주, 설치본 카드도 정상

## 진행 중

D0 검증 종료. **다음 작업은 D1.**

### 남은 자투리 (D1을 막지는 않음)

- **C-4/C-5 게임명이 기록되지 않았고, C-5가 실제 배타적 전체화면이었는지 미확증.**
  옵션에 `전체화면` 이라 써 있어도 DXGI flip model 이면 실제로는 borderless — 그러면 C-5는 C-4의 재측정이다.
  D3 「전체화면 감지」 착수 전에 게임 2~3종으로 보강할 것

## 미결 결정

없음.

## 다음 (D1)

- `WorkSession` / `Behavior` / `Occurrence` / `CompletionLog` 도메인 타입
- `computeNextOccurrences(session, behaviors, now, horizon)` 순수 함수 + vitest
- 오버레이 카드에 실제 Behavior 주입 (지금은 `SPIKE_PAYLOAD` 고정)
- 프리셋 루틴 3종(스트레칭 50분 / 물마시기 30분 / 눈휴식 60분) 내장
- **오버레이 투명 영역 클릭 차단 해소** (「알려진 한계 1」) — 2026-08-07 D1 편입 확정.
  커서 위치를 추적해 `setIgnoreCursorEvents` 를 토글한다.
  근거: C 검증에서 카드가 게임·영상 전체화면 위에도 뜨는 것이 확인돼, 표시되는 동안
  화면 상단 중앙 640×240 이 그 앱의 클릭을 막는 것이 실질적 방해가 된다.
  D1부터 실제 루틴이 돌면 하루 수십 번 뜨므로 체감이 바로 온다
