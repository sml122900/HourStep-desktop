# 고쳐 놓은 버그가 다시 보고됐다 — 코드가 아니라 설치본이 두 Phase 뒤처져 있었다

- 날짜: 2026-08-09 (Phase D2.8 후속)
- 환경: Windows 11, 도그푸딩 기기(개발 PC = 사용 PC)

## 문제 상황

사용자가 상세한 버그 리포트를 냈다.

> 설정 창 「세션 미시작 알림」의 분 입력칸에서 값이 `3`일 때 백스페이스를 누르면
> 빈칸이 되지 않고 `30`으로 되돌아간다. 계속 눌러도 지워지지 않는다.
> 같은 창의 「휴식 루틴」 간격칸은 정상 — 빈칸이 된다.
>
> 원인: 이 칸만 생 `<input>` + onChange 에서 clamp 즉시 호출.
> **D2.8 에서 clamp 함수는 통일했지만 컴포넌트 교체는 안 됐다.**

증상 설명이 구체적이고, 원인 추정도 그럴듯했다. 실제로 D2.8 에서 `clampIdleReminderMinutes()`
를 새로 만든 건 맞다. **그대로 믿고 고치러 갔으면 멀쩡한 코드를 "고쳤을" 것이다.**

## 시도한 것들

**① 고치기 전에 현재 코드부터 열었다.** 그 칸은 이미 `NumberField` 였다.

```tsx
<NumberField
  value={settings?.idleReminderMinutes ?? DEFAULT_SETTINGS.idleReminderMinutes}
  clamp={clampIdleReminderMinutes}
  onCommit={(minutes) => settings && void persist({ ...settings, idleReminderMinutes: minutes })}
/>
```

여기서 멈추고 "이미 고쳐졌습니다"라고 답할 수도 있었지만, **보고된 증상이 진짜라면**
다른 경로가 있다는 뜻이다. 근거를 더 모았다.

**② 언제 바뀌었는지 커밋으로 확정.**

```
$ git log -S 'clamp={clampIdleReminderMinutes}' -- src/windows/settings/SettingsWindow.tsx
2eb8576 feat(D2.8): 디자인 토큰 + 공통 컴포넌트 — 네 화면 정렬
```

clamp 함수와 컴포넌트 교체가 **같은 커밋**이었다. 보고서의 "clamp만 통일하고 컴포넌트는
안 바꿨다"는 한 커밋 차이로 어긋난 추정이었다.

**③ 그럼 사용자가 본 화면은 무엇인가 — 설치본을 의심했다.**

```
$ git show ee9e102:src/windows/settings/SettingsWindow.tsx   # 0.2.1 = D2.6 빌드
<input type="number"
  value={settings?.idleReminderMinutes ?? 30}
  onChange={(e) => settings && void persist({ ...settings, idleReminderMinutes: Number(e.target.value) })}
/>
```

**정확히 보고된 코드 그대로다.** 그리고 그 빌드에서도 「휴식 루틴」 간격칸은 이미
`NumberInput`(D2.6 후속)이었다 — 보고서의 "간격칸은 정상"까지 일치한다.

```powershell
(Get-Item "$env:LOCALAPPDATA\HourStep\hourstep-desktop.exe").VersionInfo.FileVersion
# 0.2.1
```

## 원인

**코드는 맞았고 설치본이 두 Phase 뒤처져 있었다.** 개발 PC 가 곧 사용 PC 라
"저장소 = 내가 쓰는 앱"이라고 착각하기 쉽지만, 그 둘은 `pnpm tauri build` + 설치를
거쳐야 같아진다. 마지막 설치가 D2.6 시점이었다.

## 최종 해결법

1. **코드는 손대지 않았다.** 이미 맞았다
2. 0.3.0 으로 빌드해 설치 → 증상 소멸
3. 다만 **진짜 남아 있던 결함은 따로 있었다** — 「빈칸·범위 밖은 위로 올리지 않는다」는
   규칙이 컴포넌트 안에만 있어서 **테스트가 닿지 않았다.** 그래서 같은 버그가 두 번 났다.
   `liveNumber()` 순수 함수로 빼고 회귀 테스트를 붙였다 (`docs/decisions/0011`)

즉 보고자의 **증상은 사실, 원인 추정은 빗나감, 그러나 지적한 방향은 옳았다** —
"D2.8 에서 뭔가 반쯤 하고 넘어갔다"는 감각이 맞았고, 그 반쯤이 코드가 아니라 검증이었다.

## 재발 방지

- **버그 리포트를 받으면 코드를 고치기 전에 "지금 코드가 그런가"부터 본다.**
  그럴듯한 원인 추정이 붙어 있을수록 더 그렇다
- **버전을 먼저 대조한다.** 설치본 버전 / 저장소 HEAD / 마지막 빌드 시각 세 개면
  이 종류는 30초에 갈린다
- STATUS.md 최상단에 **설치본 버전과 그게 어느 Phase 빌드인지**를 적어 둔다.
  이번에 그 줄이 있었고("설치본이 아직 0.2.1(D2.6 빌드)이다"), 그게 단서였다
- Phase 를 마치면 설치까지 하거나, **안 했다는 사실을 STATUS 에 남긴다**

## 이력서 소재 한 줄

> 상세한 원인 분석이 붙은 버그 리포트를 받고, 코드를 고치기 전에 커밋 이력과 설치 바이너리
> 버전을 대조해 **증상은 실재하나 원인은 버전 스큐**임을 규명 — 멀쩡한 코드를 수정하는 대신
> 재발을 부른 진짜 결함(테스트가 닿지 않는 UI 규칙)을 찾아 순수 함수로 분리하고 회귀 테스트를 추가.

## 관련

- `docs/decisions/0011-ui-rules-as-pure-functions.md` — 규칙을 테스트가 닿는 곳으로
- `docs/troubleshooting/dev-and-installed-share-db.md` — dev 와 설치본이 같은 DB 를 쓴다
- `docs/daily/2026-08-09-d2.8-followup.md`
