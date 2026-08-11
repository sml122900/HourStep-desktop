/**
 * 물 참고 기준 + 간격 제안 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * 원천: `docs/content/hourstep-evidence-archive.md` §2 (KDRIs 2020 수분 충분섭취량).
 * 「체중×30mL」같은 공식은 쓰지 않는다 — 공식 가이드라인에 없는 임상 관습이라 아카이브가
 * 명시적으로 금지한다. 여기서는 **목표가 아니라 참고 기준**이라는 표기 규칙을 지킨다
 * (§2-2: "표기: '목표'가 아니라 '참고 기준'").
 */

import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from './behaviors'

export type Sex = 'male' | 'female'
export type AgeGroup = '19-29' | '30-49' | '50-64' | '65+'

export const SEXES: readonly Sex[] = ['male', 'female']
export const AGE_GROUPS: readonly AgeGroup[] = ['19-29', '30-49', '50-64', '65+']

/** 신체정보 — 선택 입력. 체중 등 다른 항목은 수집하지 않는다 (CLAUDE.md 규칙) */
export interface Profile {
  sex: Sex | null
  ageGroup: AgeGroup | null
}

export const EMPTY_PROFILE: Profile = { sex: null, ageGroup: null }

/** 저장된 값을 신뢰 가능한 형태로 정규화한다 (DB 가 손상됐거나 구버전일 수 있다) */
export function normalizeProfile(raw: Partial<Profile> | null | undefined): Profile {
  if (!raw) return EMPTY_PROFILE
  return {
    sex: raw.sex === 'male' || raw.sex === 'female' ? raw.sex : null,
    ageGroup: AGE_GROUPS.includes(raw.ageGroup as AgeGroup) ? (raw.ageGroup as AgeGroup) : null,
  }
}

/**
 * KDRIs 2020 액체수분 충분섭취량 중 **확정치가 있는 조합만**. 나머지(30-49/50-64 남,
 * 19-29/30-49 여, 65+ 전체)는 원문 표 확인이 더 필요하다고 아카이브가 명시한다 —
 * 지어내지 않고 일반값 문구로 대체한다.
 */
const CONFIRMED_LIQUID_ML: Partial<Record<Sex, Partial<Record<AgeGroup, number>>>> = {
  male: { '19-29': 1200 },
  female: { '50-64': 1000 },
}

/** 미입력(성별·연령대 둘 중 하나라도 null)일 때의 일반값 문구 */
const GENERAL_LABEL = '성인 기준 하루 5~6잔'

/** 입력은 있으나 확정 mL 이 없는 조합의 문구 — 아카이브가 정한 단순화 표기 그대로 */
const UNCONFIRMED_LABEL = '하루 5~6잔(200mL 기준)'

export interface WaterReference {
  /** 화면에 그대로 쓰는 참고 기준 문구. "목표" 라는 단어를 쓰지 않는다 */
  label: string
  /** 확정치가 있을 때만 채워진다 (간격 제안 계산에 쓴다). 없으면 null */
  liquidMl: number | null
}

/** 성별·연령대 → 참고 기준. 하나라도 없으면(선택 입력을 건너뛰면) 일반값 경로다. */
export function waterReference(sex: Sex | null, ageGroup: AgeGroup | null): WaterReference {
  if (!sex || !ageGroup) return { label: GENERAL_LABEL, liquidMl: null }

  const liquidMl = CONFIRMED_LIQUID_ML[sex]?.[ageGroup]
  if (liquidMl == null) return { label: UNCONFIRMED_LABEL, liquidMl: null }

  return { label: `${UNCONFIRMED_LABEL} · 약 ${liquidMl.toLocaleString('ko-KR')}mL`, liquidMl }
}

const CUP_ML = 200

/** 세션 길이를 모를 때 간격 제안의 기준으로 삼는 근무시간. 아카이브 §2-2 예시와 같다 */
export const DEFAULT_SESSION_HOURS = 8

/**
 * 확정치가 없을 때 간격 **계산에만** 쓰는 값 — "하루 5~6잔"의 중간값이다.
 * 화면에는 절대 mL 로 노출하지 않는다(미확정 구간을 확정치처럼 보이게 하면 안 된다,
 * `waterReference` 의 `UNCONFIRMED_LABEL`/`GENERAL_LABEL` 이 그 선을 지킨다).
 */
const GENERAL_LIQUID_ML_FOR_CALC = 5.5 * CUP_ML

/**
 * 액체 참고 기준 ÷ 세션 시간 ÷ 1잔(200mL) 으로 알림 간격을 **제안만** 한다
 * (아카이브 §2-2). 자동으로 설정을 바꾸지 않는다 — 호출부가 [제안 적용]을 눌러야 반영된다.
 *
 * `liquidMl` 이 확정치가 아니면(0 이하·NaN) 일반값으로 계산한다. 결과는 행동 간격의
 * 허용 범위(`MIN_INTERVAL_MINUTES`~`MAX_INTERVAL_MINUTES`) 안으로 접는다 — 극단적인
 * 입력(세션 1분, 목표 1mL 등)이 스케줄러가 거부할 값을 만들지 않게.
 */
export function suggestWaterInterval(liquidMl: number, sessionHours: number): number {
  const ml = Number.isFinite(liquidMl) && liquidMl > 0 ? liquidMl : GENERAL_LIQUID_ML_FOR_CALC
  const hours =
    Number.isFinite(sessionHours) && sessionHours > 0 ? sessionHours : DEFAULT_SESSION_HOURS
  const cups = ml / CUP_ML
  const minutes = Math.round((hours * 60) / cups)

  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, minutes))
}
