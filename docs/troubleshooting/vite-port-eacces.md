# `pnpm tauri dev` 가 `listen EACCES ::1:1420` 으로 죽는다 — 포트는 비어 있는데

- 날짜: 2026-08-07 (Phase D1)
- 환경: Windows 11, Vite 7, Tauri 2

## 문제 상황

어제까지 잘 되던 `pnpm tauri dev` 가 갑자기 죽었다. 그 사이에 한 일은 **재부팅뿐**이다
(D0 A 항목 "재부팅 후 자동 상주" 검증).

```
     Running BeforeDevCommand (`pnpm dev`)
$ vite
error when starting dev server:
Error: listen EACCES: permission denied ::1:1420
    at Server.setupListenHandle [as _listen2] (node:net:1919:21)
       Error The "beforeDevCommand" terminated with a non-zero status code.
```

## 헷갈린 지점

에러가 `EADDRINUSE`(이미 사용 중)가 아니라 **`EACCES`(권한 없음)** 다.
그래서 처음엔 다른 인스턴스가 물고 있나 싶어 확인했지만 비어 있었다.

```powershell
netstat -ano | Select-String 1420    # 결과 없음
```

관리자 권한으로 실행해도 같다. 1420 은 특권 포트(<1024)도 아니다.

## 원인

**Windows 가 그 포트를 예약해버렸다.** Hyper-V / WinNAT / Docker / WSL 같은 기능이 켜져 있으면
Windows 는 **부팅할 때마다 임의의 TCP 구간을 동적으로 예약**한다. 예약된 구간의 포트는
아무도 안 쓰고 있어도 일반 프로세스가 바인딩할 수 없고, 그때 나오는 게 `EACCES` 다.

확인:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

이 PC 에서는 **1336–1435** 가 잡혀 있었고, Tauri 기본 dev 포트 1420 이 정확히 그 안이었다.
재부팅 전에는 다른 구간이 잡혀 있어서 멀쩡했던 것이다.

```powershell
# 특정 포트가 예약 구간에 걸리는지 한 줄로 확인
$ranges = netsh interface ipv4 show excludedportrange protocol=tcp |
  Select-String -Pattern "^\s*\d+" |
  ForEach-Object { $p = ($_.Line.Trim() -split '\s+'); [pscustomobject]@{ s=[int]$p[0]; e=[int]$p[1] } }
$ranges | Where-Object { 1420 -ge $_.s -and 1420 -le $_.e }
```

## 해결

**예약 구간 밖의 포트로 옮겼다.** 1420/1421 → **5183/5184**.

고쳐야 할 곳이 **두 군데**다. 하나만 고치면 Vite 는 뜨는데 Tauri 가 빈 화면을 띄운다.

```ts
// vite.config.ts
server: {
  port: 5183,
  strictPort: true,
  hmr: host ? { protocol: 'ws', host, port: 5184 } : undefined,
}
```

```json
// src-tauri/tauri.conf.json
"build": { "devUrl": "http://localhost:5183" }
```

## 다시 걸리면

5183 도 언젠가 예약 구간에 들어갈 수 있다. **재부팅 후 갑자기 dev 가 안 뜨면 이 문서를 의심할 것.**
위 `netsh` 명령으로 빈 번호를 찾아 두 파일을 같이 고치면 된다.

## 왜 예약을 풀지 않았나

`netsh int ipv4 add excludedportrange ... store=persistent` 로 특정 포트를 미리 확보하는 방법도
있지만, 관리자 권한이 필요하고 OS 의 동적 할당과 싸우는 쪽이다.
**포트 하나 옮기는 게 두 줄이고 부작용이 없다.** 개발 환경 설정을 OS 설정보다 먼저 바꾼다.

## 관련

- CLAUDE.md 「개발 메모」에 포트 번호와 이 절차를 요약해뒀다
- 이 문제는 코드와 무관하다. D1 작업 중에 터졌지만 원인은 전날 재부팅이었다
