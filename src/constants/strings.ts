/**
 * UI 문구 상수 (한국어).
 * CLAUDE.md 규칙 8: 사용자가 직접 쓴 카피는 임의 수정 금지.
 */

export const APP_NAME = 'HourStep'

/** 실제 트레이 메뉴는 src-tauri/src/tray.rs 가 만든다. 여기는 대조용 사본이다. */
export const TRAY = {
  START_SESSION: '▶ 작업 시작',
  END_SESSION: '■ 작업 종료',
  TEST_NOTIFICATION: '테스트 알림',
  SETTINGS: '설정',
  QUIT: '종료',
  TOOLTIP: 'HourStep — 작업 중 휴식 리마인더',
} as const

/**
 * 행동별 카드 문구. key 는 src/core/presets.ts 의 Behavior.id.
 *
 * CLAUDE.md 규칙 6: 건강 효용 문구는 연구 인용형("~라는 연구가 있어요")만 쓸 수 있고
 * 치료·개선 단정은 금지다. 지금은 **효용 주장을 아예 넣지 않았다** — 실제 출처 없이
 * "~라는 연구가 있어요" 를 지어내는 건 규칙을 지키는 게 아니라 어기는 것이기 때문.
 * 인용할 연구가 정해지면 아래 문구에 한 문장씩 덧붙이면 된다.
 */
export const BEHAVIOR_MESSAGE: Record<string, string> = {
  // 사용자가 D0에서 직접 쓴 카피 — 그대로 유지 (CLAUDE.md 규칙 8)
  stretch: '일어나서 1분 스트레칭할 시간이에요',
  water: '물 한 잔 마실 시간이에요',
  eyes: '눈 감고 1분, 눈을 쉬게 해줄 시간이에요',
}

export const OVERLAY = {
  ACTION_DONE: '✅ 완료',
  ACTION_SNOOZE: '⏰ 3분 뒤',
  ACTION_SKIP: '건너뛰기',
  /** 완료 후 카운트다운 제안 (선택형) */
  COUNTDOWN_OFFER: '1분만 같이 세어볼까요?',
  COUNTDOWN_ACCEPT: '⏱ 좋아요',
  COUNTDOWN_DECLINE: '괜찮아요',
  COUNTDOWN_STOP: '그만하기',
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
