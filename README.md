# HourStep Desktop

트레이 상주 웰니스 브레이크 앱 (Windows). "작업 시작"을 누르면 루틴대로 화면 중앙 상단에
오버레이 카드를 띄워 스트레칭·물마시기·눈휴식을 실천시킨다.

현재 **Phase D2.8** 완료 (세션·스케줄러·통계·설정·행동 CRUD·테마·AI 루틴 브리지·행위 시간·
알림음·발화 큐·디자인 시스템). 진행 상황은 `STATUS.md`.

## 설치 (쓰기만 할 때 — 개발 도구 불필요)

`pnpm tauri build` 로 만들어진 **`HourStep_<버전>_x64-setup.exe`** 하나만 옮겨 실행하면 된다.

- **사용자 단위 설치**라 관리자 권한이 필요 없다 → `%LOCALAPPDATA%\HourStep`
- 코드 서명이 없어 SmartScreen 파란 창이 뜬다 → `추가 정보` → `실행`
- 같은 폴더의 `.msi` 는 전체 사용자 설치라 관리자 권한이 필요하다. 배포 정책상 필요할 때만 쓴다
- Windows 10 에서는 설치 중 WebView2 런타임을 내려받으므로 인터넷이 필요하다 (Windows 11 은 기본 포함)
- x64 전용. 제거는 `%LOCALAPPDATA%\HourStep\uninstall.exe` 또는 설정 > 앱

데이터(작업 기록·행동·설정)는 `%APPDATA%\com.hourstep.desktop\hourstep.db` 에 있다.
**PC 를 옮겨도 따라가지 않는다** — 옮기려면 양쪽 앱을 완전히 종료한 뒤 그 폴더를
`-wal`/`-shm` 파일까지 통째로 복사한다. 계정 동기화는 MVP 범위 밖이다
(`docs/decisions/0003-settings-storage-sqlite.md`).

부팅 시 자동 실행은 **기본 꺼짐**이다. 설정 창에서 켠다.

## 요구 사항 (개발·빌드할 때)

- Node 22+ / pnpm 11+
- Rust stable (`x86_64-pc-windows-msvc`)
- **Visual Studio C++ 빌드 도구 + Windows SDK** — SDK가 없으면 `link.exe not found` 로 빌드 실패
- WebView2 런타임 (Windows 11 기본 포함)

## 명령

```bash
pnpm install
pnpm tauri dev      # 개발 실행
pnpm tauri build    # NSIS(.exe) + MSI 설치본 생성
pnpm test           # vitest (src/core 순수 모듈)
pnpm lint
pnpm format
```

설치본은 `src-tauri/target/release/bundle/` 아래 `nsis/`(.exe)와 `msi/` 에 나온다.
버전을 올릴 때는 **세 곳을 같이** 고친다 — `package.json` / `src-tauri/tauri.conf.json` /
`src-tauri/Cargo.toml`.

클릭 없이 앱을 몰아 세우는 자동 검증 훅(`--debug-cmd`)은 CLAUDE.md 「개발 메모」에 있다.
**dev 와 설치본은 프로세스 이름도 DB 도 같다** — dev 가 떠 있으면 설치본이 조용히 안 뜨고,
dev 검증이 실제 사용자 데이터를 바꾼다 (`docs/troubleshooting/dev-and-installed-share-db.md`).

## 문서

- `STATUS.md` — **현재 상태의 단일 출처**. 진행 상황·남은 확인 항목
- `CLAUDE.md` — 제품 정의, 핵심 결정, 코딩 규칙, 검증 정책
- `docs/design-system.md` — 디자인 토큰·컴포넌트 규격
- `docs/daily/` — 작업 일지
- `docs/decisions/` — 기술 결정 기록
- `docs/troubleshooting/` — 해결한 문제 기록
- `docs/par-materials.md` — 이력서용 PAR 소재
