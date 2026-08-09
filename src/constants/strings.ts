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
 * 내장 행동 3종의 **초기** 카드 문구. key 는 src/core/presets.ts 의 Behavior.id.
 *
 * D2.5 부터 문구는 사용자가 고칠 수 있는 데이터이고 DB(behaviors.message)가 런타임 소스다.
 * 여기 값은 최초 시드와 「기본값 복원」이 되돌릴 기준값이다.
 *
 * CLAUDE.md 규칙 6: 건강 효용 문구는 연구 인용형("~라는 연구가 있어요")만 쓸 수 있고
 * 치료·개선 단정은 금지다. 지금은 **효용 주장을 아예 넣지 않았다** — 실제 출처 없이
 * "~라는 연구가 있어요" 를 지어내는 건 규칙을 지키는 게 아니라 어기는 것이기 때문.
 * 인용할 연구가 정해지면 아래 문구에 한 문장씩 덧붙이면 된다 (is_builtin 플래그가 그 자리다).
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
  /**
   * 행위 시간이 있는 행동은 [완료]가 곧바로 카운트다운을 시작한다 (D2.7).
   * D2 의 「1분만 같이 세어볼까요?」 제안 단계는 없앴다 — 셀지 말지는 설정에서 정한다.
   */
  COUNTDOWN_STOP: '그만하기',

  /** 세션 미시작 리마인더 — 세션당 한 번만 뜬다 */
  IDLE_ICON: '👋',
  IDLE_MESSAGE: '작업 중이신가요? 세션을 시작하면 휴식을 챙겨드릴게요',
  IDLE_START: '▶ 작업 시작',
  IDLE_LATER: '나중에',

  /** 세션 종료 요약 */
  SUMMARY_ICON: '📊',
  SUMMARY_TITLE: '수고하셨어요',
  SUMMARY_WORKED: '작업시간',
  SUMMARY_RATE: '실천율',
  SUMMARY_NO_RECORD: '이번 세션에는 기록된 휴식이 없어요',
  SUMMARY_CLOSE: '닫기',
} as const

export const SETTINGS = {
  TITLE: '설정',
  AUTOSTART_LABEL: '컴퓨터 켤 때 자동으로 시작',
  AUTOSTART_HINT: '자동 실행 시 창을 띄우지 않고 트레이에만 조용히 상주합니다.',
  AUTOSTART_ERROR: '자동 실행 설정을 변경하지 못했습니다.',

  BEHAVIORS_TITLE: '휴식 루틴',
  BEHAVIORS_HINT: '변경하면 진행 중인 세션에도 바로 반영됩니다.',
  INTERVAL_SUFFIX: '분마다',

  /** 행위 시간 — [완료]를 누른 뒤 카드가 함께 세어줄 시간 */
  DURATION_LABEL: '행위 시간',
  DURATION_SUFFIX: '초',
  DURATION_ZERO_HINT: '완료를 누르면 바로 끝나요',
  DURATION_HINT: '완료를 누르면 {n}초를 같이 세어드려요',

  /** 행동 CRUD */
  BEHAVIOR_ADD: '＋ 행동 추가',
  BEHAVIOR_DELETE: '삭제',
  BEHAVIOR_UP: '위로',
  BEHAVIOR_DOWN: '아래로',
  BEHAVIOR_RESTORE: '기본값 복원',
  BEHAVIOR_RESTORE_HINT: '기본 3종을 처음 값으로 되돌립니다. 직접 만든 행동은 그대로 둡니다.',
  BEHAVIOR_BUILTIN_TAG: '기본',
  BEHAVIOR_NAME_PLACEHOLDER: '이름',
  BEHAVIOR_MESSAGE_PLACEHOLDER: '알림 문구 (비우면 이름으로 표시돼요)',
  BEHAVIOR_LIMIT: '행동은 최대 {n}개까지 만들 수 있어요.',
  BEHAVIOR_EMPTY: '행동이 하나도 없어요. 추가하거나 기본값을 복원해 주세요.',

  THEME_TITLE: '테마',
  THEME_SYSTEM: '시스템',
  THEME_LIGHT: '라이트',
  THEME_DARK: '다크',

  SOUND_TITLE: '알림음',
  SOUND_LABEL: '카드가 뜰 때와 카운트다운이 끝날 때 소리로 알리기',
  SOUND_VOLUME: '볼륨',
  SOUND_PREVIEW: '🔊 미리듣기',
  SOUND_HINT: '소리는 알림 카드가 냅니다. 창을 닫아 트레이에 있어도 들려요.',

  IDLE_TITLE: '세션 미시작 알림',
  IDLE_LABEL: '작업 시작을 잊었을 때 한 번 알려주기',
  IDLE_SUFFIX: '분 후',

  SAVE_ERROR: '설정을 저장하지 못했습니다.',
} as const

/**
 * D2.6 「AI로 루틴 찾기」.
 *
 * 앱은 구글 결과를 직접 읽지 않는다 — 브라우저를 열어주고, 사용자가 복사해 온 텍스트만 받는다
 * (docs/decisions/0008). 그래서 문구가 단계를 설명하는 형태다.
 *
 * CLAUDE.md 규칙 6: 여기 어떤 문구도 건강 효용을 단정하지 않는다. `DISCLAIMER` 는 미리보기에
 * 항상 고정으로 뜬다 — 우리가 지어낸 문구가 아니라 AI 가 준 문구라는 사실을 화면에 남긴다.
 */
export const AI = {
  TITLE: 'AI로 루틴 찾기',
  OPEN: '🔍 시작하기',
  CLOSE: '닫기',
  INTRO: '내 상황을 적으면 프롬프트를 만들어 드려요. AI에 붙여넣고, 답을 복사해 아래에 넣으세요.',

  JOB_LABEL: '직군·자세',
  JOB_PLACEHOLDER: '예: 사무직, 하루 종일 앉아서 코딩',
  SYMPTOM_LABEL: '증상·고민',
  SYMPTOM_PLACEHOLDER: '예: 어깨가 뻐근하고 눈이 침침해요',

  /** ① 프롬프트 — 숨기지 않는다. 무엇을 보내는지 보고 보내야 한다 */
  PROMPT_LABEL: '이 프롬프트가 만들어졌어요',
  PROMPT_COPY: '📋 복사',

  /** ② AI 열기 — 어디로 가든 상관없다. 구글만 프롬프트가 URL 에 실린다 */
  TARGETS_LABEL: 'AI 열기',
  TARGET_OPEN: '{name} 열기',
  TARGET_OPEN_PASTE: '{name} 열기 (붙여넣기 필요)',
  TARGETS_HINT: '어느 AI를 써도 괜찮아요. 열면 프롬프트가 자동으로 복사됩니다.',
  OPEN_ERROR: '브라우저를 열지 못했습니다.',

  COPIED: '프롬프트 복사됨',
  COPY_ERROR: '복사하지 못했습니다. 프롬프트를 직접 선택해 복사해 주세요.',

  PASTE_LABEL: '붙여넣기',
  PASTE_PLACEHOLDER: 'AI 답변을 통째로 붙여넣으세요. [HOURSTEP] 블록만 읽습니다.',
  ANALYZE: '분석하기',
  MANUAL: '직접 입력',

  /** 파싱 결과 안내 — routineParse.ts 의 reason 코드에 대응한다 */
  RESULT_OK: '{n}개를 찾았어요. 확인하고 추가하세요.',
  RESULT_PARTIAL: '{n}개를 찾았어요. 형식이 맞지 않는 {skipped}줄은 건너뛰었어요.',
  RESULT_NO_BLOCK: '[HOURSTEP] 블록을 찾지 못했어요. 형식이 안 맞으면 아래에 직접 입력하세요.',
  RESULT_EMPTY_BLOCK: '블록은 찾았지만 읽을 수 있는 줄이 없었어요. 아래에 직접 입력하세요.',

  PREVIEW_TITLE: '추가할 행동',
  DISCLAIMER: '참고용이며 전문의 상담을 대체하지 않습니다.',
  INSERT: '선택한 {n}개 추가',
  INSERT_NONE: '추가할 항목을 선택하세요',
  CANCEL: '취소',
  ROW_ADD: '＋ 줄 추가',
  LIMIT: '{n}개까지만 더 추가할 수 있어요. 선택을 줄이거나 기존 행동을 지워주세요.',
  SOURCE_TAG: 'AI',
} as const

export const MAIN = {
  TITLE: 'HourStep Desktop',
  PHASE_BADGE: 'Phase D2.8 — 디자인 시스템',
  DESCRIPTION:
    '이 창을 닫아도 앱은 종료되지 않고 트레이에 남습니다. 종료는 트레이 메뉴에서만 가능합니다.',
  TEST_OVERLAY_BUTTON: '테스트 알림 띄우기',
  OPEN_SETTINGS_BUTTON: '⚙️ 설정',
  HIDE_BUTTON: '트레이로 숨기기',

  /** 세션 제어 + 타이머 */
  SESSION_START: '▶ 작업 시작',
  SESSION_END: '■ 작업 종료',
  SESSION_ELAPSED: '작업 중',
  SESSION_IDLE_TITLE: '쉬는 중',
  SESSION_IDLE_HINT: '작업 시작하면 알림이 시작돼요',
  NEXT_TITLE: '다음 알림',
  NEXT_NONE: '켜진 행동이 없어요. 설정에서 하나 이상 켜주세요.',
  UPCOMING_TITLE: '예정',

  STATS_TODAY: '오늘',
  STATS_WEEK: '최근 7일',
  STATS_WORKED: '작업시간',
  STATS_SESSIONS: '세션',
  STATS_RATE: '실천율',
  STATS_EMPTY: '아직 기록이 없어요. [▶ 작업 시작]을 눌러보세요.',
  STATS_SESSION_UNIT: '회',
  STATS_ACTIVE: '세션 진행 중',
} as const
