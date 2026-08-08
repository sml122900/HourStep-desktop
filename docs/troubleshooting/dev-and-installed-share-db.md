# dev 로 검증하면 설치본의 사용자 데이터가 바뀐다 — 실제로 설정을 날렸다

- 날짜: 2026-08-09 (Phase D2.6 후속)
- 환경: Windows 11, 설치본 `%LOCALAPPDATA%\HourStep` (NSIS per-user) + `pnpm tauri dev`
- 관련: `CLAUDE.md` 「저장소」·「개발 메모」, `docs/decisions/0002-debug-cmd-hook.md`

## 무슨 일이 있었나

D2.6 을 설치본(0.2.0)으로 갱신한 뒤, 사용자가 그 앱을 쓰면서 설정 창에서
**간격을 직접 바꾸고 순서도 옮겼다**(스트레칭 50→30, 눈휴식 60→30, 물마시기를 맨 뒤로).

그 뒤 다른 작업을 검증하려고 `--debug-cmd` 로 dev 를 돌렸는데 `behaviors-dump` 에
낯선 값이 찍혔다.

```
[debug] behaviors n=3 0:stretch(스트레칭,30m,on,builtin) 1:eyes(눈휴식,30m,on,builtin) 2:water(물마시기,45m,on,builtin)
```

**시드는 50/30/60 이고 순서도 stretch·water·eyes 다.** 방금 만진 코드(간격 입력칸)가
값을 망가뜨렸다고 판단했고, 원인을 좁히려고 `behavior-restore` 를 돌렸다.
그 순간 **사용자가 직접 편집한 값이 시드값으로 덮여 사라졌다.**

## 원인

두 가지가 겹쳤다.

### 1. dev 와 설치본은 같은 DB 를 쓴다

`identifier` 가 같으므로 저장소 경로도 같다.

```
%APPDATA%\com.hourstep.desktop\hourstep.db
```

dev 빌드든 설치본이든 이 파일 하나를 본다. 즉 **`--debug-cmd` 로 하는 모든 검증은
사용자의 실제 데이터에 대고 하는 것**이다. D0~D2.5 동안은 개발 PC = 도그푸딩 기기이면서도
설치본을 상시 쓰지 않아 문제가 드러나지 않았다.

### 2. 낯선 값 = 버그라고 단정했다

덤프에 찍힌 값이 시드와 다르면 코드가 의심스럽다 — 이 추론이 틀렸다.
**사용자가 바꿨을 수 있다.** 실제로 판별할 근거가 로그에 있었다.

- 손상됐다고 본 값은 그 실행이 **시작될 때 이미 DB 에 있었다**
  (`set-interval` 직후의 첫 덤프에 그대로 찍혔다 = 그 실행 중에 생긴 게 아니다)
- **순서가 바뀌어 있었다.** 순서는 설정 창의 ↑/↓(`moveBehavior`)로만 바뀐다.
  스케줄러도 파서도 순서를 건드리지 않는다 → 사람 손이 닿았다는 뜻이다

## 지금 하는 것

### 검증 전에 현재 값을 먼저 남긴다

`--debug-cmd` 스크립트의 **맨 앞에** 덤프를 넣는다. 그러면 "원래 이랬는지 내가 바꿨는지"를
나중에 판별할 수 있다.

```powershell
pnpm tauri dev -- -- -- --debug-cmd "wait:6000,behaviors-dump,db-dump,<검증 단계>,behaviors-dump,quit"
```

DB 를 읽기만 할 거면 앱을 띄우지 않고 사본을 떠서 본다 (실행 중인 앱을 방해하지 않는다).

```powershell
$db = "$env:APPDATA\com.hourstep.desktop\hourstep.db"; $tmp = "C:\Users\Public\hs-check.db"
Copy-Item $db $tmp -Force
foreach ($e in '-wal','-shm') { if (Test-Path "$db$e") { Copy-Item "$db$e" "$tmp$e" -Force } }
sqlite3 -line $tmp "SELECT id, every_ms/60000 AS minutes, sort_order, enabled, source FROM behaviors ORDER BY sort_order"
Remove-Item "$tmp*" -Force
```

WAL 이라 `-wal` 파일을 같이 복사해야 최신 쓰기가 보인다. 경로에 한글이 있으면
`sqlite3.exe` 가 열지 못하므로 **ASCII 경로**(`C:\Users\Public\…`)로 복사한다.

### 파괴적인 디버그 명령을 구분한다

읽기(`dump` / `db-dump` / `behaviors-dump` / `main-dump`)는 언제 써도 된다.
아래는 **사용자 데이터를 덮어쓴다.** 검증 시나리오에 넣기 전에 현재 값을 먼저 남긴다.

| 명령 | 무엇을 덮어쓰나 |
| --- | --- |
| `behavior-restore` | 내장 3종의 간격·문구·이모지·순서를 **시드값으로** (사용자 편집 소실) |
| `set-interval` / `behavior-add` / `behavior-delete` / `behavior-move` | 해당 행동 |
| `ai-import` | 행동 추가 |
| `set-theme` | 테마 설정 |
| `start-session` / `end-session` / `done` 등 | 세션·기록 (통계에 반영된다) |

### 되돌릴 때는 로그를 근거로

이번엔 덤프에 남은 마지막 상태(30/30 + 순서)로 되돌릴 수 있었지만,
**물마시기 간격 하나는 복구하지 못했다** — 조사 중 `set-interval:water=45` 를 먼저
실행해버려서 원래 값이 어느 로그에도 남지 않았다. 순서 복구 경로가 없어서
`behavior-move` 를 이때 추가했다.

## 더 나은 방법 (하지 않은 것)

dev 빌드가 **다른 identifier**를 쓰게 하면 저장소가 갈라져 이 문제 자체가 사라진다.
하지 않은 이유:

- 마이그레이션·시드·`closeDanglingSessions` 처럼 **실제 데이터 위에서만 드러나는 것**을
  검증하는 게 `--debug-cmd` 의 목적이다. 빈 DB 를 대상으로 하면 v1→v2→v3 왕복 검증이
  의미를 잃는다 (실제로 v2→v3 는 사용자 DB 위에서 확인했다)
- 도그푸딩 기기 = 개발 PC 라는 전제가 이 프로젝트의 검증 정책 자체다

대신 **읽기 우선 + 덤프 먼저**라는 절차로 막는다. 정말 위험한 시나리오를 돌려야 하면
그때는 DB 를 백업하고 시작한다.

```powershell
Copy-Item "$env:APPDATA\com.hourstep.desktop\hourstep.db" "$env:TEMP\hourstep.db.bak" -Force
```

## 관련

- `CLAUDE.md` 「개발 메모」의 single-instance 항목에 요약해뒀다 —
  **설치본도 같은 프로세스 이름이라** dev 를 띄우면 조용히 죽는다는 함정도 같이 있다
- 이번 조사에서 dev 인스턴스가 두 번 조용히 죽었다. `--debug-cmd` 출력이 비어 있으면
  거의 항상 설치본이 떠 있는 것이다
