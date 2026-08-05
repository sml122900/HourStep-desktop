/**
 * UI 문구 상수 (한국어).
 * CLAUDE.md 규칙 8: 사용자가 직접 쓴 카피는 임의 수정 금지.
 */

export const APP_NAME = 'HourStep'

export const TRAY = {
  START_SESSION: '▶ 작업 시작',
  TEST_NOTIFICATION: '테스트 알림',
  SETTINGS: '설정',
  QUIT: '종료',
  TOOLTIP: 'HourStep — 작업 중 휴식 리마인더',
} as const

export const OVERLAY = {
  /** D0 스파이크용 고정 문구. D1에서 Behavior 모델로 대체된다. */
  SPIKE_ICON: '🧘',
  SPIKE_MESSAGE: '일어나서 1분 스트레칭할 시간이에요',
  ACTION_DONE: '✅ 완료',
  ACTION_SNOOZE: '⏰ 3분 뒤',
  ACTION_SKIP: '건너뛰기',
} as const

export const SETTINGS = {
  TITLE: '설정',
  AUTOSTART_LABEL: '컴퓨터 켤 때 자동으로 시작',
  AUTOSTART_HINT: '자동 실행 시 창을 띄우지 않고 트레이에만 조용히 상주합니다.',
  AUTOSTART_ERROR: '자동 실행 설정을 변경하지 못했습니다.',
} as const

export const MAIN = {
  TITLE: 'HourStep Desktop',
  PHASE_BADGE: 'Phase D0 — 상주 + 오버레이 기술 검증',
  DESCRIPTION:
    '이 창을 닫아도 앱은 종료되지 않고 트레이에 남습니다. 종료는 트레이 메뉴에서만 가능합니다.',
  TEST_OVERLAY_BUTTON: '테스트 알림 띄우기',
  OPEN_SETTINGS_BUTTON: '설정 열기',
  HIDE_BUTTON: '트레이로 숨기기',
} as const
