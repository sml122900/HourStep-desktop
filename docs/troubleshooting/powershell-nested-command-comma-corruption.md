# 중첩 `powershell.exe -Command` 로 `--debug-cmd` 를 백그라운드로 띄웠더니 콤마가 전부 공백이 됐다

- 날짜: 2026-08-14 (Phase D2.11)
- 환경: Windows 11, Windows PowerShell 5.1, `pnpm tauri dev -- -- -- --debug-cmd "<콤마로 구분된 스크립트>"`
- 관련: `docs/troubleshooting/debug-cmd-async-command-ordering.md`,
  `docs/troubleshooting/window-capture-pitfalls.md`(같은 세션 안에서 실행해야
  하는 다른 이유), `docs/decisions/0002-debug-cmd-hook.md`

## 문제 상황

화면 캡처와 `pnpm tauri dev`(포그라운드로 블로킹) 를 **동시에** 돌려야 해서,
dev 프로세스를 백그라운드로 띄우고 그동안 캡처 루프를 도구 세션에서 직접
실행하려 했다. `Start-Process` 로 새 `powershell.exe` 를 하나 더 띄우고
그 안에서 `pnpm tauri dev` 를 실행하는 방식을 썼다.

```powershell
$inner = "Set-Location -LiteralPath '$proj'; pnpm tauri dev -- -- -- --debug-cmd `"$debugScript`" *> '$log'"
Start-Process -FilePath "powershell.exe" -ArgumentList @('-NoProfile','-Command', $inner) -WindowStyle Hidden
```

로그를 열어 보니 Rust 가 받은 인자가 이렇게 찍혀 있었다.

```
Running `target\debug\hourstep-desktop.exe --debug-cmd "wait:3000 action-toggle:A1=off wait:300 ...`
```

**콤마가 전부 공백으로 바뀌어 있었다.** `--debug-cmd` 스크립트 파서
(`src-tauri/src/debug_cmd.rs`)는 `script.split(',')` 로 단계를 나누는데, 콤마가
없으니 전체를 한 덩어리로 보고 `wait:3000 action-toggle:...` 를 하나의
`wait:` 인자로 파싱하려다 실패 → 기본값(`60_000ms`)으로 그냥 60초 잠들고
스크립트가 끝나 버렸다. `action-toggle`/`start-session`/`done` 등은 단 하나도
실행되지 않았다.

## 원인

`$debugScript` 자체는 처음부터 끝까지 정상이었다(콤마를 유지한 하나의 문자열).
문제는 그 문자열이 거치는 **경로**다.

1. 내 PowerShell 세션에서 `$inner` (콤마 포함 문자열)를 만든다 — 정상
2. `Start-Process -ArgumentList @('-Command', $inner)` 로 **새 프로세스**를
   띄운다 — PowerShell 이 배열을 Win32 `CreateProcess` 커맨드라인 문자열
   하나로 다시 조립해야 한다
3. 새로 뜬 `powershell.exe` 가 그 커맨드라인 문자열을 **자기 자신의 토크나이저로
   다시 파싱**한다 — `$inner` 안에 이미 들어 있던 이스케이프된 큰따옴표
   (`` `"$debugScript`" ``)가 이 재파싱 단계에서 예상대로 살아남지 못했고,
   그 여파로 pnpm.ps1 → node → cargo run 까지 이어지는 각 단계가 인자를
   다시 토크나이즈하면서 콤마 언저리의 문자가 뭉개졌다

핵심은 **문자열이 "새 프로세스의 커맨드라인"으로 변환되는 지점이 최소
두 번**(내 세션 → `Start-Process` 재조립 → 새 `powershell.exe` 재파싱)
있었고, 각 단계는 서로 다른 토크나이저(PowerShell 문자열 리터럴 규칙 vs
Win32 `CommandLineToArgvW`)를 쓴다는 것이다. 콤마 자체는 어느 단계에서도
특수문자가 아니라서 "왜 콤마가?"로 접근하면 답이 안 나오고, "중첩 인용부호가
재파싱을 몇 번 거치는가"로 봐야 원인이 보인다.

## 최종 해결법

`Start-Job` 으로 바꿨다 — 스크립트블록과 인자를 **직렬화된 값**으로 넘기지
커맨드라인 문자열로 넘기지 않는다. 문자열이 어떤 토크나이저도 다시 거치지
않는다.

```powershell
$job = Start-Job -ScriptBlock {
    param($proj, $debugScript, $log)
    Set-Location -LiteralPath $proj
    & pnpm tauri dev -- -- -- --debug-cmd $debugScript *> $log
} -ArgumentList $proj, $debugScript, $log
```

`$debugScript` 를 `-ArgumentList` 로 넘기면 `param()` 이 그 값을 **문자열
객체 그대로** 받는다 — 어디에서도 "커맨드라인으로 합쳤다가 다시 쪼개는" 단계가
없다. 로그를 다시 보니 콤마가 전부 살아 있었다(`wait:3000,action-toggle:A1=off,...`).

`Start-Job` 이 만드는 백그라운드 프로세스도 같은 인터랙티브 세션에서 뜨므로,
그 안에서 실행되는 GUI 앱(cargo run 이 최종적으로 띄우는 `hourstep-desktop.exe`)
은 정상적으로 데스크톱에 창을 만든다 — `window-capture-pitfalls.md` 가 경고하는
"자식 프로세스에서는 창이 안 보인다"는 함정은 **창을 enumerate 하는 코드**가
중첩 자식에서 돌 때만 해당하고, **띄우는 쪽**이 중첩이어도 무방하다. 실제로
캡처 루프(`EnumWindows`)는 도구 세션에서 직접 돌렸고 문제없이 창을 찾았다.

## 재발 방지

- 문자열을 담아 **다른 프로세스를 띄워야** 하는데 그 문자열에 콤마·따옴표·
  공백이 섞여 있으면, `Start-Process -ArgumentList`(커맨드라인 재조립)보다
  `Start-Job -ArgumentList`(타입 있는 파라미터 전달)를 먼저 고려한다
- 이상 증상이 "특정 구분자만 사라진다"처럼 보이면 그 구분자 자체를 의심하기
  전에 **문자열이 프로세스 경계를 몇 번 넘는지**부터 센다 — 경계 하나당
  재파싱이 하나씩 끼어 있다
- 자동 검증 스크립트에서 백그라운드 실행이 필요할 때마다 이 함정을 다시 밟을
  수 있으니, `--debug-cmd` 관련 자동화는 `Start-Job` 패턴을 기본으로 삼는다

## 관련

- `docs/troubleshooting/debug-cmd-async-command-ordering.md` — 같은 세션에서
  겪은, 콤마 파싱 자체는 정상인데 **명령 도착 순서**가 어긋난 별개의 함정
  (원인이 다르니 헷갈리지 말 것 — 이건 텍스트가 깨지는 문제, 그건 이벤트
  도착 타이밍 문제)
- `docs/troubleshooting/window-capture-pitfalls.md` — "자식 프로세스에서
  창이 안 보인다"는 이 문서와 얼핏 비슷해 보이지만, 그건 **enumerate 하는
  쪽**이 중첩일 때 이야기고 이 문서는 **띄우는 쪽**이 중첩일 때 이야기다
