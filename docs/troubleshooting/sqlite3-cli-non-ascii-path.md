# `sqlite3.exe` 가 한글이 든 사용자 경로를 못 연다 — ASCII 경로로 복사해서 우회

- 날짜: 2026-08-12 (Phase D2.10)
- 환경: Windows 11, 사용자 프로필 경로에 한글(`C:\Users\이성민\...`),
  `C:\Android\Sdk\platform-tools\sqlite3.exe` (PowerShell / Git Bash 양쪽에서 재현)
- 관련: `docs/troubleshooting/debug-cmd-async-command-ordering.md`,
  `docs/troubleshooting/dev-and-installed-share-db.md`

## 문제 상황

`--debug-cmd` 검증 중 실 데이터에 남은 테스트 세션·기록을 지우려고, 실행 중인
HourStep 프로세스를 전부 끈 뒤 `hourstep.db` 를 직접 조회하려 했다.

```powershell
$db = Join-Path $env:APPDATA "com.hourstep.desktop\hourstep.db"
& "C:\Android\Sdk\platform-tools\sqlite3.exe" $db "SELECT COUNT(*) FROM work_sessions;"
```

```
Error: unable to open database "C:\Users\�̼���\AppData\Roaming\com.hourstep.desktop\hourstep.db":
unable to open database file
```

경로 문자열의 사용자명(`이성민`)이 깨져서(`�̼���`) 출력된다 — **`sqlite3.exe` 가
받은 인자 자체가 이미 손상돼 있다**는 뜻이다. `Test-Path $db` 는 `True` 를 반환해서
파일은 분명히 그 자리에 있는데도 열지 못했다.

## 시도한 것들

**① Git Bash 에서 재시도.** `$APPDATA` 를 그대로 넘겼는데 같은 증상(같은 깨진 문자열).
셸을 바꿔도 안 되는 걸 보고 "셸의 인코딩 설정" 이 아니라 **`sqlite3.exe` 자체의 인자
처리** 를 의심했다.

**② 8.3 short path(`GetShortPathName` 상당)로 우회 시도.**

```powershell
$fso = New-Object -ComObject Scripting.FileSystemObject
$short = $fso.GetFile($db).ShortPath
# C:\Users\이성민\AppData\Roaming\COMHOU~1.DES\hourstep.db
```

폴더 이름(`com.hourstep.desktop` → `COMHOU~1.DES`)은 짧아졌지만 **상위 경로의
`이성민` 은 그대로 남았다** — Windows 가 사용자 폴더 자체에는 8.3 별칭을 안 만든
경우였다(시스템 설정에 따라 다르다). 여전히 실패.

**③ 파일을 통째로 ASCII 전용 경로로 복사.** 원인을 셸이나 경로 별칭으로 못 없애면,
**비ASCII 문자가 아예 없는 경로**에서 작업하면 된다.

```powershell
$work = "C:\Users\Public\hourstep-cleanup\hourstep.db"
New-Item -ItemType Directory -Force -Path (Split-Path $work) | Out-Null
Copy-Item $db $work -Force
& $sqlite $work "SELECT COUNT(*) FROM work_sessions;"   # 13  ← 성공
```

바로 열렸다.

## 원인

`C:\Android\Sdk\platform-tools\sqlite3.exe` (Android SDK 에 딸려 오는 빌드)는
명령줄 인자를 유니코드(와이드 문자)로 안전하게 받지 못하는 것으로 보인다 — 콘솔
코드페이지 기준으로 인자를 해석하다 비-ASCII 문자를 깨뜨리고, 그 결과로 만들어진
경로 문자열이 실제 파일과 일치하지 않아 "파일을 열 수 없다"는 에러로 이어진다.
PowerShell 이든 Git Bash 든 **셸이 넘겨주는 문자열은 정상**이었다(`Write-Output`
으로 확인하면 `이성민` 이 정상 출력된다) — 문제는 그 다음, 프로세스 인자를 받는
`sqlite3.exe` 내부였다.

## 최종 해결법

1. **DB 파일을 비ASCII 문자가 없는 임시 경로로 복사**해서 그 사본에서만
   `sqlite3.exe` 를 쓴다 (`C:\Users\Public\...` 처럼 시스템 공용 경로가 무난하다)
2. 조회·수정이 끝나면 원본 위치에 **다시 덮어쓴다** — 이때 반드시 앱이 완전히
   종료된 상태인지 먼저 확인한다(`Get-Process hourstep-desktop`), 그렇지 않으면
   앱이 들고 있는 파일 핸들과 충돌하거나 WAL 파일이 갈릴 수 있다
3. **raw sqlite 조회를 최종 근거로 쓰지 않는다.** 사본을 원본에 덮어쓴 뒤
   앱 자체의 `--debug-cmd db-dump` (정규화 읽기 경로) 로 다시 한번 확인해,
   "내가 sqlite 로 본 값"과 "앱이 실제로 읽는 값"이 같은지 대조했다
4. 작업이 끝나면 임시 사본은 지운다(`Remove-Item -Recurse -Force`) — 민감한
   실사용 DB 사본을 로컬에 남겨두지 않는다

## 추가 발견 (2026-08-14, Phase D2.11) — 더 가벼운 우회: 폴더로 `cd` 하고 상대 경로만 넘긴다

같은 문제를 D2.11 검증에서 또 만났다. 이번엔 파일을 복사하지 않고, DB 가 있는
**폴더로 먼저 이동한 뒤 파일명만 상대 경로로** 넘겼더니 바로 열렸다.

```bash
cd "/c/Users/이성민/AppData/Roaming/com.hourstep.desktop" && \
  sqlite3 hourstep.db "SELECT COUNT(*) FROM work_sessions;"   # 성공
```

이 방식이 통하는 이유는 원인 분석과 일치한다 — 깨지는 건 **인자 문자열에 담긴
비ASCII 문자**이지 작업 디렉터리가 아니다. `cd` 는 셸 내부 상태 변경이라
`sqlite3.exe` 의 인자로 전혀 전달되지 않고, 파일명(`hourstep.db`)은 ASCII 라
인자 손상이 애초에 일어날 자리가 없다. 매번 복사본을 만들고 정리하는 절차
(①~④) 보다 가벼워서, **읽기 전용 조회**에는 이 방법을 우선 쓴다 — 다만
원본을 직접 열고 쓰는 것이므로, "본문 최종 해결법"의 ②(앱이 완전히 종료된
상태인지 먼저 확인)와 ③(raw 조회를 최종 근거로 쓰지 않고 앱 자신의 읽기
경로로 재검증)은 그대로 지킨다.

## 이력서 소재 한 줄

> 한글 사용자명 경로에서 서드파티 `sqlite3.exe` 가 인자를 손상시키는 문제를
> 8.3 별칭 우회 실패 후 원인을 도구 자체로 좁혀, ASCII 임시 경로로 파일을
> 복사해 작업한 뒤 원본에 안전하게 되돌리는 절차로 우회 — 최종 검증은 raw
> SQL 이 아니라 애플리케이션 자체의 정규화 읽기 경로로 재확인해 신뢰성을 높임.

## 관련

- `docs/troubleshooting/debug-cmd-async-command-ordering.md` — 같은 정리
  작업에서 함께 발견한 첫 번째 함정
- `docs/troubleshooting/dev-and-installed-share-db.md` — 「경로에 한글이 있으면
  `sqlite3.exe` 가 열지 못하므로 ASCII 경로로 복사한다」는 짧은 메모가 이미 있었다.
  이번에 실제로 그 상황을 겪고 8.3 별칭이 항상 통하지는 않는다는 것까지 확인해 보강함
