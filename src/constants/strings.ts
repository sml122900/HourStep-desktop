/**
 * UI 문구 상수 (한국어).
 * CLAUDE.md 규칙 8: 사용자가 직접 쓴 카피는 임의 수정 금지.
 */

export const APP_NAME = 'HourStep'

/**
 * 실제 트레이 메뉴는 src-tauri/src/tray.rs 가 만든다. 여기는 대조용 사본이다.
 * "트레이"는 내부(코드·문서) 용어로만 남긴다 — 사용자 노출 문구에는 쓰지 않는다.
 */
export const TRAY = {
  START_SESSION: '▶ 작업 시작',
  END_SESSION: '■ 작업 종료',
  TEST_NOTIFICATION: '테스트 알림',
  SETTINGS: '설정',
  /** 창 숨김(=백그라운드 실행)과 구분하기 위한 문구 */
  QUIT: '완전히 종료',
  TOOLTIP: 'HourStep — 작업 중 휴식 리마인더',
} as const

/**
 * 내장 행동 3종의 **초기** 카드 문구. key 는 src/core/presets.ts 의 Behavior.id.
 *
 * D2.5 부터 문구는 사용자가 고칠 수 있는 데이터이고 DB(behaviors.message)가 런타임 소스다.
 * 여기 값은 최초 시드와 「기본값 복원」이 되돌릴 기준값이다.
 *
 * D2.9 부터 `water`/`eyes` 는 `docs/content/hourstep-action-cards.md` 원고(E1/D1)의
 * 첫 줄을 그대로 가져온다 — 카드가 한 줄만 보여줄 수 있어서 나머지 줄(출처 포함)은 신지
 * 않았다. `stretch` 는 카드 문구를 쓰지 않는다 — D2.9 부터 오버레이가 이 값 대신
 * `src/core/actionRotation.ts` 의 오늘의 동작을 보여준다(`docs/decisions/0012`).
 * 이 값은 폴백·목록 표시용으로만 남는다.
 *
 * CLAUDE.md 규칙 6: 건강 효용 문구는 연구 인용형("~라는 연구가 있어요")만 쓸 수 있고
 * 치료·개선 단정은 금지다. 원고 문구는 임의로 고치지 않는다(같은 규칙 8) — 오탈자 등은
 * 발견 시 보고만 한다.
 */
export const BEHAVIOR_MESSAGE: Record<string, string> = {
  // 사용자가 D0에서 직접 쓴 카피 — 그대로 유지. 오버레이는 D2.9 부터 이 값을 쓰지 않는다.
  stretch: '일어나서 1분 스트레칭할 시간이에요',
  // E1 원고 첫 줄 (docs/content/hourstep-action-cards.md)
  water: '한 번에 몰아 마시기보다 나눠서 자주',
  // D1 원고 첫 줄
  eyes: '창밖이나 방에서 가장 먼 곳을 바라봐요 (6m 이상이면 좋아요)',
}

/**
 * 동작 카드 원고 (`docs/content/hourstep-action-cards.md`) — 스트레칭 로테이션(D2.9)이 쓴다.
 * 사용자가 직접 쓴 원고 취급: 임의 수정 금지, 우려가 있으면 지적만 한다(CLAUDE.md 규칙 8).
 * `**볼드**` 마크다운만 벗겨냈다 — 카드가 마크다운을 렌더링하지 않는다. 문장은 그대로다.
 *
 * B2·B3·B4 는 2026-08-11 수정본에서 B1 과 같은 출처 문장(Clin Rehabil, 2016)으로 통일됐다 —
 * "동일"이라는 축약 표현이 로테이션 순서상 맥락을 잃는 문제(B4 는 B1 바로 뒤가 아니다)를
 * 없앴다. C2 도 같은 수정본에서 "OSHA" → "미국 산업안전보건청(OSHA)"로 풀어 썼다(C1 과 통일).
 */
/**
 * 카운트다운 자동 전환용 단계(D2.11, 2026-08-14 결정). `durationSec` 합은 v4 기본값(60초)과
 * 일치한다(`actionRotation.test.ts` 가 검증). `minDurationSec` 은 원문에 시간이 **명시된**
 * 단계에만 둔다 — 스트레칭 유지 시간은 근거의 일부라 사용자가 행위 시간을 짧게 설정해도
 * 그 아래로는 줄지 않는다(`scaleSteps`, `src/core/actionSteps.ts`). 회수만 적힌
 * 동작(B2·B3·C2)과 범위가 이미 어긋나 있는 A2(CLAUDE.md 승인 — 그대로 둠)에는 두지 않는다.
 */
export interface ActionStepContent {
  readonly label: string
  readonly durationSec: number
  readonly minDurationSec?: number
}

export const ACTION_CARDS: Record<
  string,
  {
    name: string
    method: readonly string[]
    duration: string
    source: string
    steps: readonly ActionStepContent[]
    /** C1(손목) 전용 — 15초마다 전환음이 4번 울리면 과하다는 도그푸딩 피드백으로 생략 */
    muteStepChime?: boolean
  }
> = {
  A1: {
    name: '앉았다 일어나기 (의자 스쿼트)',
    method: ['의자에서 완전히 일어섰다가 다시 앉기를 반복해요', '손은 사용하지 않고 다리 힘으로, 천천히'],
    duration: '1분간 반복 (본인 속도로)',
    source: '30분마다 1분 반복 기립이 2분 걷기만큼 식후 인슐린을 낮췄다는 연구가 있어요 (J Appl Physiol, 2021)',
    steps: [
      {
        label: '의자에서 완전히 일어섰다가 다시 앉기를 반복해요 · 손은 사용하지 않고 다리 힘으로, 천천히',
        durationSec: 60,
        minDurationSec: 60, // 연구가 측정한 프로토콜 자체가 "1분"
      },
    ],
  },
  A2: {
    name: '가볍게 걷기',
    method: ['자리에서 일어나 복도나 방 안을 천천히 걸어요', '물 뜨러 가기, 창밖 보러 가기도 좋아요'],
    duration: '2~5분',
    source: '좌식을 짧은 걷기로 중단하면 식후 혈당 반응이 낮아졌다는 연구가 있어요 (Diabetes Care, 2012)',
    // "2~5분"과 실제 카운트다운(60초)의 불일치는 이 기능 이전부터 있던 것 — 손대지 않는다
    steps: [
      { label: '자리에서 일어나 복도나 방 안을 천천히 걸어요 · 물 뜨러 가기, 창밖 보러 가기도 좋아요', durationSec: 60 },
    ],
  },
  B1: {
    name: '목 옆으로 기울이기',
    method: [
      '한 손을 머리에 얹고 귀가 어깨에 닿는 방향으로 천천히 기울여요',
      '반대쪽 목 옆이 당기는 느낌에서 멈추고 유지',
    ],
    duration: '15~30초 × 좌우 각 1회',
    source: '규칙적인 목·어깨 스트레칭 4주로 사무직의 목 통증과 기능이 개선됐다는 연구가 있어요 (Clin Rehabil, 2016)',
    steps: [
      {
        label: '왼쪽 · 한 손을 머리에 얹고 귀가 어깨에 닿는 방향으로 천천히 기울여요 · 반대쪽 목 옆이 당기는 느낌에서 멈추고 유지',
        durationSec: 30,
        minDurationSec: 15, // 원문 범위(15~30초)의 하한
      },
      {
        label: '오른쪽 · 한 손을 머리에 얹고 귀가 어깨에 닿는 방향으로 천천히 기울여요 · 반대쪽 목 옆이 당기는 느낌에서 멈추고 유지',
        durationSec: 30,
        minDurationSec: 15,
      },
    ],
  },
  B2: {
    name: '어깨 으쓱하고 내리기',
    method: ['숨 들이쉬며 어깨를 귀 쪽으로 최대한 올려요', '3초 멈춘 뒤 숨 내쉬며 툭 떨어뜨려요'],
    duration: '10회 반복',
    source: '규칙적인 목·어깨 스트레칭 4주로 사무직의 목 통증과 기능이 개선됐다는 연구가 있어요 (Clin Rehabil, 2016)',
    steps: [
      {
        label: '숨 들이쉬며 어깨를 귀 쪽으로 최대한 올려요 · 3초 멈춘 뒤 숨 내쉬며 툭 떨어뜨려요 (10회 반복)',
        durationSec: 60,
      },
    ],
  },
  B3: {
    name: '턱 당기기',
    method: ['시선은 정면, 턱을 뒤로 밀어 이중턱을 만들어요', '뒷목이 길어지는 느낌으로 5초 유지'],
    duration: '10회 반복',
    source: '규칙적인 목·어깨 스트레칭 4주로 사무직의 목 통증과 기능이 개선됐다는 연구가 있어요 (Clin Rehabil, 2016)',
    steps: [
      {
        label: '시선은 정면, 턱을 뒤로 밀어 이중턱을 만들어요 · 뒷목이 길어지는 느낌으로 5초 유지 (10회 반복)',
        durationSec: 60,
      },
    ],
  },
  B4: {
    name: '가슴 펴기',
    method: [
      '등 뒤에서 깍지 끼고 팔을 아래로 뻗으며 가슴을 열어요',
      '어깨가 뒤로 모이는 느낌에서 유지 (문틀 잡고 해도 좋아요)',
    ],
    duration: '15~30초 × 2회',
    source: '규칙적인 목·어깨 스트레칭 4주로 사무직의 목 통증과 기능이 개선됐다는 연구가 있어요 (Clin Rehabil, 2016)',
    steps: [
      {
        label: '등 뒤에서 깍지 끼고 팔을 아래로 뻗으며 가슴을 열어요 · 어깨가 뒤로 모이는 느낌에서 유지 (문틀 잡고 해도 좋아요)',
        durationSec: 60,
        minDurationSec: 30, // 원문 범위 하한(15초) × 2회
      },
    ],
  },
  C1: {
    name: '손목 젖히기 스트레칭',
    method: [
      '팔을 앞으로 뻗고 손바닥이 정면을 보게 손끝을 위로',
      '반대 손으로 손가락을 몸 쪽으로 지그시 당겨요. 손끝 아래로도 반복',
    ],
    duration: '각 15초 × 좌우',
    source: '미국 산업안전보건청(OSHA)은 반복적인 컴퓨터 작업 중 짧은 휴식과 스트레칭을 권고해요',
    muteStepChime: true,
    steps: [
      {
        label: '위로 · 왼쪽 — 팔을 앞으로 뻗고 손바닥이 정면을 보게 손끝을 위로, 반대 손으로 손가락을 몸 쪽으로 지그시 당겨요',
        durationSec: 15,
        minDurationSec: 15, // 원문 고정값("각 15초")
      },
      {
        label: '위로 · 오른쪽 — 팔을 앞으로 뻗고 손바닥이 정면을 보게 손끝을 위로, 반대 손으로 손가락을 몸 쪽으로 지그시 당겨요',
        durationSec: 15,
        minDurationSec: 15,
      },
      {
        // 원문("손끝 아래로도 반복")에 방향별 동작 지시가 없다 — 위 단계의 "당겨요" 문구를
        // 지어내 붙이지 않고, 라벨을 최소화해 원고 톤 그대로 둔다 (2026-08-14 수정)
        label: '손끝 아래로 — 왼쪽',
        durationSec: 15,
        minDurationSec: 15,
      },
      {
        label: '손끝 아래로 — 오른쪽',
        durationSec: 15,
        minDurationSec: 15,
      },
    ],
  },
  C2: {
    name: '선 채 허리 젖히기',
    method: ['일어서서 양손을 허리에 대요', '시선은 위로, 허리를 천천히 뒤로 젖혔다 돌아와요'],
    duration: '5회 반복',
    source: '미국 산업안전보건청(OSHA)은 장시간 정적 자세 작업 시 자세를 바꾸고 몸을 펴는 휴식을 권고해요',
    steps: [
      {
        label: '양손을 허리에 대고 시선은 위로, 허리를 천천히 뒤로 젖혔다 돌아와요 (5회 반복)',
        durationSec: 60,
      },
    ],
  },
}

/** 동작 목록 화면 하단 고정 고지 (동작 카드 원고 상단 고지문 그대로) */
export const ACTION_CARDS_DISCLAIMER =
  '참고용 정보이며 전문의 상담을 대체하지 않아요. 통증이 있다면 무리하지 말고 의료진과 상의하세요.'

/**
 * D1(눈) 원고 — 스트레칭(ACTION_CARDS)과 달리 로테이션이 없는 단일 동작이라 별도로 둔다.
 * `BEHAVIOR_MESSAGE.eyes` 는 이 method 의 첫 줄과 같다(카드는 한 줄만 보여준다).
 * 카운트다운 중 안내(D2.10)가 전체를 보여준다. 원고 임의 수정 금지(CLAUDE.md 규칙 8).
 */
export const EYE_REST_METHOD: readonly string[] = [
  '창밖이나 방에서 가장 먼 곳을 바라봐요 (6m 이상이면 좋아요)',
  '그동안 눈을 천천히 여러 번 깜빡여요 — 화면을 볼 땐 깜빡임이 줄어들어요',
]
export const EYE_REST_DURATION = '20초 이상, 여유 있으면 1분'

export const OVERLAY = {
  ACTION_DONE: '✅ 완료',
  ACTION_SNOOZE: '⏰ 3분 뒤',
  ACTION_SKIP: '건너뛰기',
  /**
   * 행위 시간이 있는 행동은 [완료]가 곧바로 카운트다운을 시작한다 (D2.7).
   * D2 의 「1분만 같이 세어볼까요?」 제안 단계는 없앴다 — 셀지 말지는 설정에서 정한다.
   */
  COUNTDOWN_STOP: '그만하기',

  /** 스트레칭 로테이션(D2.9) — 방법 전체·출처는 카드에 안 들어간다(540×139). 메인 창 상세로 */
  ACTION_DETAIL: '자세히',

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
  AUTOSTART_HINT: '자동 실행 시 창을 띄우지 않고 백그라운드에서 조용히 실행됩니다.',
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
  SOUND_HINT: '소리는 알림 카드가 냅니다. 창을 닫아 백그라운드에 있어도 들려요.',

  IDLE_TITLE: '세션 미시작 알림',
  IDLE_LABEL: '작업 시작을 잊었을 때 한 번 알려주기',
  IDLE_SUFFIX: '분 후',

  /**
   * 신체정보 (D2.9). 체중 등은 수집하지 않는다 — 성별·연령대만, 그마저도 선택 입력이다
   * (CLAUDE.md 규칙: 다른 신체정보 수집 금지). 로컬 저장만, 서버로 나가지 않는다.
   */
  PROFILE_TITLE: '신체정보',
  PROFILE_WHY: '왜 필요한가요? 수분 참고 기준이 성별·연령별이라서예요.',
  PROFILE_SKIP_HINT: '선택 입력이에요. 입력하지 않아도 일반 기준으로 안내해요.',
  PROFILE_SEX_LABEL: '성별',
  PROFILE_SEX_MALE: '남성',
  PROFILE_SEX_FEMALE: '여성',
  PROFILE_AGE_LABEL: '연령대',
  PROFILE_AGE_19_29: '19~29세',
  PROFILE_AGE_30_49: '30~49세',
  PROFILE_AGE_50_64: '50~64세',
  PROFILE_AGE_65_PLUS: '65세 이상',
  PROFILE_UNSET: '입력 안 함',

  /**
   * 물 참고 기준 (D2.9, 아카이브 §2). "목표" 라는 단어를 쓰지 않는다 — 개인차가 크다는
   * 아카이브의 결론을 문구에도 반영한 것 (§2-2 표기 규칙).
   */
  WATER_TITLE: '물 참고 기준',
  WATER_ACTIVITY_HINT: '활동이 많거나 더운 날에는 더 필요할 수 있어요.',
  WATER_DISCLAIMER: '콩팥·심장 질환 등으로 수분 조절이 필요하다면 의료진과 상의하세요.',
  WATER_SUGGESTION_HINT: '지금 참고 기준으로는 {n}분마다가 어때요? (하루 {hours}시간 근무 기준)',
  WATER_APPLY_SUGGESTION: '제안 적용',
  WATER_APPLIED: '적용했어요',

  /** 근거 보기 (D2.9) — 간격이 왜 지금 값인지, 아카이브 §1·§3 의 카피 예시를 그대로 보여준다 */
  EVIDENCE_ENTRY: '왜 이 주기인가요?',
  EVIDENCE_TITLE: '왜 이 주기인가요?',
  EVIDENCE_STRETCH: '스트레칭: 연구는 20~30분대 집중',
  EVIDENCE_EYES: '눈휴식: 원칙은 20분마다',
  EVIDENCE_CLOSE: '닫기',

  /**
   * 동작 목록 화면 (D2.10) — 스트레칭 로테이션 8종 중 어떤 걸 오늘의 동작으로 쓸지 고른다.
   * 최소 1개는 항상 켜져 있어야 한다 — 다 끄면 스트레칭 카드가 보여줄 동작이 없어진다.
   */
  ACTIONS_ENTRY: '동작 목록 보기',
  ACTIONS_DURATION_LABEL: '시간',
  ACTIONS_SOURCE_LABEL: '출처',
  ACTIONS_MIN_ONE_HINT: '최소 1개는 켜져 있어야 해요',

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
  /** 채팅형 AI 드롭다운. 화면에는 서비스 이름만 보이므로 라벨은 스크린리더용이다 */
  CHAT_PICK_LABEL: '채팅형 AI 고르기',
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
  PHASE_BADGE: 'Phase D2.10 — 동작 목록·선택 + 카운트다운 안내',
  DESCRIPTION:
    '이 창을 닫아도 앱은 종료되지 않고 백그라운드에서 계속 실행됩니다. ' +
    '완전히 종료하려면 화면 오른쪽 아래 아이콘에서 [완전히 종료]를 눌러주세요.',
  TEST_OVERLAY_BUTTON: '테스트 알림 띄우기',
  OPEN_SETTINGS_BUTTON: '⚙️ 설정',
  BACKGROUND_BUTTON: '백그라운드에서 실행',

  /**
   * 처음으로 창을 숨길 때 한 번만 뜨는 시스템 토스트 안내 (사용자가 직접 쓴 카피, CLAUDE.md 규칙 8 —
   * 임의 수정 금지). `backgroundNoticeShown` 플래그로 세션이 아니라 설치 전체에서 한 번만 띄운다.
   */
  BACKGROUND_NOTICE_TITLE: 'HourStep은 백그라운드에서 계속 실행돼요',
  BACKGROUND_NOTICE_BODY: '화면 오른쪽 아래 ^ 를 누르면 다시 열 수 있어요',

  /** 창 우측 하단 완전 종료 버튼. TRAY.QUIT 와 같은 문구 — 트레이 메뉴와 같은 종료 경로다 */
  QUIT_BUTTON: '완전히 종료',

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

  /** 스트레칭 로테이션 상세 (D2.9) — 오버레이 [자세히] 가 여기로 보낸다 */
  ACTION_DETAIL_DURATION_LABEL: '시간',
  ACTION_DETAIL_SOURCE_LABEL: '출처',
  ACTION_DETAIL_CLOSE: '닫기',
} as const
