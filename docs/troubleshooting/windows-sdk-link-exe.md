# Rust MSVC 빌드가 `link.exe not found` 로 전부 실패 — VS 는 깔려 있는데

- 날짜: 2026-08-05 (Phase D0)
- 환경: Windows 11, Visual Studio Community 2026 (18.8.2), rustc 1.97.1 stable-msvc

## 문제 상황

`cargo check` 를 돌리자 의존성 빌드 스크립트가 줄줄이 실패했다.

```
error: linker `link.exe` not found
  = note: program not found
note: the msvc targets depend on the msvc linker but `link.exe` was not found
note: please ensure that Visual Studio 2017 or later, or Build Tools for Visual Studio
      were installed with the Visual C++ option

error: could not compile `proc-macro2` (build script)
error: could not compile `serde_core` (build script)
... (8개 크레이트)
```

혼란스러웠던 점: **Visual Studio 는 이미 설치돼 있었다.**
`vswhere` 로 확인하면 `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` 가
명시적으로 선택된 상태였고, `link.exe` 파일도 디스크에 실존했다.

```
C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.51.36231\bin\Hostx64\x64\link.exe
```

## 시도한 것들

| 시도 | 결과 |
| --- | --- |
| `vswhere` 로 VS 설치 확인 | VS Community 2026 + VC.Tools.x86.x64 존재 → 여기서 오판했다 |
| `link.exe` 파일 검색 | 4개 경로에 실존 → "PATH 문제인가?" 로 잘못 좁힘 |
| `state.json` 에서 설치 컴포넌트 목록 확인 | **`Windows11SDK` / `Windows10SDK` 계열이 하나도 없음** ← 원인 |
| `Windows Kits` 디렉터리 확인 | `NETFXSDK` 만 있고 `Windows Kits\10\Lib` 자체가 없음 |
| `kernel32.lib` 검색 | 0건 |
| winget 으로 SDK 설치 | 저장소에 **구버전만**(10.0.17134, 10.0.18362) 있어 부적합 |

## 최종 해결법

**원인**: VC++ 컴파일러 툴셋과 **Windows SDK 는 별개 컴포넌트**다.
툴셋만 있으면 `link.exe` 는 존재하지만, 링크에 필요한
`kernel32.lib` 등 SDK 라이브러리와 SDK 쪽 링커 지원이 없다.
rustc 의 MSVC 링커 탐지는 SDK 가 없으면 아예 실패로 처리하고
`link.exe not found` 라는 (다소 오해를 부르는) 메시지를 낸다.

**해결**: VS Installer 로 기존 설치에 Windows 11 SDK 컴포넌트를 추가한다.

```powershell
Start-Process "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" `
  -ArgumentList 'modify',
                '--installPath','"C:\Program Files\Microsoft Visual Studio\18\Community"',
                '--add','Microsoft.VisualStudio.Component.Windows11SDK.26100',
                '--quiet','--norestart' `
  -Verb RunAs -Wait
```

### 두 번째 함정 — exit code 5007

권한 없이 실행하면 **조용히 실패**하면서 종료 코드 5007 만 남긴다.
설치 로그(`%TEMP%\dd_installer_*.log`)를 봐야 이유가 나온다.

```
Commands with --quiet or --passive should be run elevated from the beginning.
Exit Code: 5007
```

→ `-Verb RunAs` 로 **처음부터 관리자 권한**으로 띄워야 한다.
`--quiet` 는 UAC 승격을 스스로 하지 않는다.

설치 후 확인:

```powershell
Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Lib" -Directory
# 10.0.26100.0
```

## 재발 방지

- README 요구사항에 "**Visual Studio C++ 빌드 도구 + Windows SDK**" 를 함께 명시
  (C++ 툴셋만으로는 부족하다는 걸 문장에 박아둠)
- CLAUDE.md 개발 메모: "빌드 전제: Rust(stable-msvc) + **Windows SDK 컴포넌트**.
  SDK 없으면 `link.exe not found`"

## 이력서 소재 한 줄

> `link.exe not found` 라는 오해를 부르는 링커 오류를, 파일 실존 확인에서 멈추지 않고
> VS 설치 상태(state.json)와 SDK 라이브러리 존재 여부까지 역추적해
> "VC++ 툴셋과 Windows SDK 는 별개 컴포넌트"라는 실제 원인을 특정하고 무인 설치로 해결
