# HourStep Desktop

트레이 상주 웰니스 브레이크 앱 (Windows). "작업 시작"을 누르면 루틴대로 화면 중앙 상단에
오버레이 카드를 띄워 스트레칭·물마시기·눈휴식을 실천시킨다.

현재 **Phase D0** (스캐폴딩 + 상주/오버레이 기술 검증) 완료. 제품 기능은 D1부터.

## 요구 사항

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

개발 빌드 스모크 (사람 클릭 없이 오버레이 표시/숨김 자동 실행):

```powershell
$env:HOURSTEP_SPIKE_AUTO_OVERLAY = "1"; pnpm tauri dev
```

## 문서

- `CLAUDE.md` — 제품 정의, 핵심 결정, 코딩 규칙
- `docs/phase-d0-verification.md` — D0 수동 검증 절차 (A~F)
- `docs/daily/` — 작업 일지
- `docs/decisions/` — 기술 결정 기록
