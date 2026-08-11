import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { type ActionPref, canDisable } from '../../core/actionRotation'
import {
  MAX_BEHAVIORS,
  MAX_DURATION_SEC,
  MAX_EMOJI_CODEPOINTS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_DURATION_SEC,
  MIN_INTERVAL_MINUTES,
  clampDurationSeconds,
  clampIntervalMinutes,
  intervalMinutes,
  moveBehavior,
  newBehavior,
  restoreBuiltins,
} from '../../core/behaviors'
import {
  DEFAULT_SETTINGS,
  MAX_IDLE_REMINDER_MINUTES,
  MAX_SOUND_VOLUME,
  MIN_IDLE_REMINDER_MINUTES,
  MIN_SOUND_VOLUME,
  clampIdleReminderMinutes,
  type AppSettings,
} from '../../core/settings'
import { routineItemsToBehaviors, type RoutineItem } from '../../core/routineParse'
import { THEME_PREFERENCES, type ThemePreference } from '../../core/theme'
import type { Behavior } from '../../core/types'
import {
  AGE_GROUPS,
  DEFAULT_SESSION_HOURS,
  SEXES,
  type AgeGroup,
  type Profile,
  type Sex,
  suggestWaterInterval,
  waterReference,
} from '../../core/waterGoal'
import * as db from '../../data/db'
import { ACTION_CARDS, ACTION_CARDS_DISCLAIMER, AI, SETTINGS } from '../../constants/strings'
import Button from '../../components/Button'
import Card from '../../components/Card'
import Checkbox from '../../components/Checkbox'
import EmptyState from '../../components/EmptyState'
import NumberField from '../../components/NumberField'
import Section from '../../components/Section'
import { playCue } from '../sound'
import RoutineFinder from './RoutineFinder'

const MIN = 60_000

const THEME_LABEL: Record<ThemePreference, string> = {
  system: SETTINGS.THEME_SYSTEM,
  light: SETTINGS.THEME_LIGHT,
  dark: SETTINGS.THEME_DARK,
}

const SEX_LABEL: Record<Sex, string> = {
  male: SETTINGS.PROFILE_SEX_MALE,
  female: SETTINGS.PROFILE_SEX_FEMALE,
}

const AGE_GROUP_LABEL: Record<AgeGroup, string> = {
  '19-29': SETTINGS.PROFILE_AGE_19_29,
  '30-49': SETTINGS.PROFILE_AGE_30_49,
  '50-64': SETTINGS.PROFILE_AGE_50_64,
  '65+': SETTINGS.PROFILE_AGE_65_PLUS,
}

/** 이모지 입력 상한. maxLength 는 UTF-16 단위라 코드포인트의 2배로 잡는다 */
const EMOJI_MAXLENGTH = MAX_EMOJI_CODEPOINTS * 2

export default function SettingsWindow() {
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [behaviors, setBehaviors] = useState<Behavior[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [actionPrefs, setActionPrefs] = useState<ActionPref[] | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 글자 입력은 매 타이핑마다 저장하지 않는다 (DB 쓰기 + 방송 + 정규화가 커서를 튕긴다).
   * 화면 상태를 먼저 바꾸고 포커스가 빠질 때 저장한다. 그래서 "아직 저장 안 된 화면 값"이
   * 존재하고, 커밋할 때 그 최신값을 읽어야 하므로 ref 로 따로 들고 있는다.
   */
  const draftRef = useRef<Behavior[] | null>(null)
  draftRef.current = behaviors

  const reload = useCallback(() => {
    db.loadSettings()
      .then(setSettings)
      .catch((e) => {
        console.error('[settings] 설정 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })

    db.loadBehaviors()
      .then(setBehaviors)
      .catch((e) => {
        console.error('[settings] 행동 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })

    db.loadProfile()
      .then(setProfile)
      .catch((e) => {
        console.error('[settings] 신체정보 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })

    db.loadActionPrefs()
      .then(setActionPrefs)
      .catch((e) => {
        console.error('[settings] 동작 선택 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })
  }, [])

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch(() => setError(SETTINGS.AUTOSTART_ERROR))
    reload()
  }, [reload])

  async function toggleAutostart(next: boolean) {
    setError(null)
    try {
      if (next) await enable()
      else await disable()
      setAutostart(await isEnabled())
    } catch {
      setError(SETTINGS.AUTOSTART_ERROR)
      setAutostart(await isEnabled().catch(() => null))
    }
  }

  /**
   * 저장 즉시 다른 창에 알린다. 오버레이가 이걸 받아 실행 중인 세션의 스케줄을 다시 계산한다.
   * 저장에 실패하면 방송하지 않는다 — 화면과 DB 가 갈라지면 안 된다.
   */
  const persist = useCallback(async (draft: AppSettings) => {
    setError(null)
    try {
      setSettings(await db.saveSettingsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setSettings(await db.loadSettings().catch(() => null))
    }
  }, [])

  /**
   * 신체정보 저장 (D2.9). 선택 입력이라 즉시 저장 — 글자 입력이 아니라 버튼 선택이라
   * 커밋 시점을 따로 둘 이유가 없다. 다른 창의 스케줄에 영향이 없어 방송하지 않는다.
   */
  const persistProfile = useCallback(async (draft: Profile) => {
    setError(null)
    try {
      setProfile(await db.saveProfile(draft))
    } catch (e) {
      console.error('[settings] 신체정보 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setProfile(await db.loadProfile().catch(() => null))
    }
  }, [])

  /**
   * 동작 선택 저장(D2.10). 체크박스 클릭은 신체정보와 같은 성격 — 글자 입력이 아니라
   * 즉시 확정되는 선택이라 커밋 시점을 따로 둘 이유가 없다.
   */
  const persistActionPrefs = useCallback(async (draft: ActionPref[]) => {
    setError(null)
    try {
      setActionPrefs(await db.saveActionPrefsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 동작 선택 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setActionPrefs(await db.loadActionPrefs().catch(() => null))
    }
  }, [])

  /** 행동 목록 저장. 정규화된 결과로 화면을 되돌려 놓아 DB 와 눈에 보이는 값이 같아진다. */
  const persistBehaviors = useCallback(async (draft: Behavior[]) => {
    setError(null)
    setBehaviors(draft) // 정규화 왕복을 기다리는 동안에도 화면은 즉시 반응해야 한다
    try {
      setBehaviors(await db.saveBehaviorsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 행동 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setBehaviors(await db.loadBehaviors().catch(() => null))
    }
  }, [])

  /** 아직 저장되지 않은 화면 값을 확정한다 (입력 포커스가 빠질 때 / 창이 숨을 때) */
  const commit = useCallback(() => {
    if (draftRef.current) void persistBehaviors(draftRef.current)
  }, [persistBehaviors])

  /**
   * 숫자칸(간격·행위 시간)을 확정한다. 그냥 `commit` 을 쓰면 안 되는 이유 — 이 칸들은
   * blur 에서 값을 **복구**하는데(빈칸 → 1분, 500 → 480분), 그 복구값이 화면 상태에
   * 반영되기 전에 커밋이 돌아 옛 값이 저장된다. 복구된 숫자를 직접 받아서 덮어쓴다.
   * 나머지 칸의 미저장 편집은 `draftRef` 에 들어 있으므로 함께 저장된다.
   */
  const commitField = useCallback(
    (behaviorId: string, patch: Partial<Behavior>) => {
      const current = draftRef.current
      if (!current) return
      void persistBehaviors(current.map((b) => (b.id === behaviorId ? { ...b, ...patch } : b)))
    },
    [persistBehaviors]
  )

  /**
   * 「AI로 루틴 찾기」에서 확인한 항목을 실제 행동으로 넣는다. 직삽입 경로가 아니다 —
   * 사용자가 미리보기에서 확인을 눌러야 여기까지 온다. 저장은 손으로 추가할 때와 **같은 함수**를
   * 타므로 실행 중 세션에도 즉시 반영된다 (D2.5 CRUD 경로 그대로).
   */
  const insertRoutine = useCallback(
    (items: RoutineItem[]) => {
      const current = draftRef.current
      if (!current) return
      // Date.now() 는 UI 계층에서만 — 코어는 now 를 인자로 받는다 (CLAUDE.md 규칙 4)
      void persistBehaviors(routineItemsToBehaviors(current, items, Date.now()))
    },
    [persistBehaviors]
  )

  /**
   * 이 창은 만들어질 때(앱 기동 시) 한 번 읽고 숨어 있다가 나중에 보인다. 그 사이 값이
   * 바뀌었을 수 있으므로 — 다른 창의 「기본값 복원」, `--debug-cmd`, 앱 최초 시드 —
   * **다시 보일 때** 읽어온다.
   *
   * 보이는 동안 오는 방송은 무시한다. 이 창이 유일한 편집자라 그 방송은 대부분 자기가
   * 낸 것이고, 그때 다시 읽으면 타이핑 중인 값을 덮어써 버린다.
   *
   * 반대로 창을 X 로 닫으면(=트레이로 숨김) 입력에 blur 가 안 올 수 있다.
   * 숨는 순간에 한 번 확정해서 편집 중이던 값을 잃지 않게 한다.
   */
  useEffect(() => {
    const onVisibility = () => (document.hidden ? commit() : reload())
    document.addEventListener('visibilitychange', onVisibility)

    const unlisteners = [
      listen(db.SETTINGS_CHANGED, () => document.hidden && reload()),
      listen(db.BEHAVIORS_CHANGED, () => document.hidden && reload()),
      listen(db.ACTION_PREFS_CHANGED, () => document.hidden && reload()),
    ]

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [commit, reload])

  /** 화면만 바꾼다. 저장은 commit() 이 한다. */
  function editLocal(behaviorId: string, patch: Partial<Behavior>) {
    setBehaviors((prev) =>
      prev ? prev.map((b) => (b.id === behaviorId ? { ...b, ...patch } : b)) : prev
    )
  }

  const atLimit = (behaviors?.length ?? 0) >= MAX_BEHAVIORS

  return (
    <main className="settings">
      <h1>{SETTINGS.TITLE}</h1>

      <Section title={SETTINGS.BEHAVIORS_TITLE}>
        {behaviors === null ? (
          <EmptyState>…</EmptyState>
        ) : behaviors.length === 0 ? (
          <EmptyState>{SETTINGS.BEHAVIOR_EMPTY}</EmptyState>
        ) : (
          <ul className="behaviors">
            {behaviors.map((behavior, index) => (
              <Card key={behavior.id} as="li" variant="row" className="behavior">
                <div className="behavior__row">
                  <Checkbox
                    checked={behavior.enabled}
                    ariaLabel={behavior.label}
                    onChange={(checked) =>
                      void persistBehaviors(
                        behaviors.map((b) =>
                          b.id === behavior.id ? { ...b, enabled: checked } : b
                        )
                      )
                    }
                  />

                  <input
                    className="field behavior__emoji"
                    value={behavior.emoji}
                    maxLength={EMOJI_MAXLENGTH}
                    aria-label="이모지"
                    onChange={(e) => editLocal(behavior.id, { emoji: e.target.value })}
                    onBlur={commit}
                  />

                  <input
                    className="field behavior__label"
                    value={behavior.label}
                    maxLength={MAX_LABEL_LENGTH}
                    placeholder={SETTINGS.BEHAVIOR_NAME_PLACEHOLDER}
                    onChange={(e) => editLocal(behavior.id, { label: e.target.value })}
                    onBlur={commit}
                  />

                  {behavior.isBuiltin && (
                    <span className="tag">{SETTINGS.BEHAVIOR_BUILTIN_TAG}</span>
                  )}
                  {/* 우리가 지어낸 문구가 아니라 사용자가 AI 답변에서 가져온 것이라는 표시 */}
                  {behavior.source === 'ai' && <span className="tag tag--ai">{AI.SOURCE_TAG}</span>}

                  <span className="behavior__interval">
                    <NumberField
                      value={intervalMinutes(behavior)}
                      min={MIN_INTERVAL_MINUTES}
                      max={MAX_INTERVAL_MINUTES}
                      clamp={clampIntervalMinutes}
                      disabled={!behavior.enabled}
                      ariaLabel={`${behavior.label} 간격(분)`}
                      onChange={(minutes) =>
                        editLocal(behavior.id, {
                          rule: { kind: 'interval', everyMs: minutes * MIN },
                        })
                      }
                      onCommit={(minutes) =>
                        commitField(behavior.id, {
                          rule: { kind: 'interval', everyMs: minutes * MIN },
                        })
                      }
                    />
                    {SETTINGS.INTERVAL_SUFFIX}
                  </span>

                  <span className="behavior__order">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon
                      title={SETTINGS.BEHAVIOR_UP}
                      disabled={index === 0}
                      onClick={() =>
                        void persistBehaviors(moveBehavior(behaviors, behavior.id, -1))
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon
                      title={SETTINGS.BEHAVIOR_DOWN}
                      disabled={index === behaviors.length - 1}
                      onClick={() => void persistBehaviors(moveBehavior(behaviors, behavior.id, 1))}
                    >
                      ↓
                    </Button>
                  </span>

                  <Button
                    size="sm"
                    variant="danger"
                    icon
                    title={SETTINGS.BEHAVIOR_DELETE}
                    onClick={() =>
                      void persistBehaviors(behaviors.filter((b) => b.id !== behavior.id))
                    }
                  >
                    ✕
                  </Button>
                </div>

                <input
                  className="field behavior__message"
                  value={behavior.message}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder={SETTINGS.BEHAVIOR_MESSAGE_PLACEHOLDER}
                  disabled={!behavior.enabled}
                  onChange={(e) => editLocal(behavior.id, { message: e.target.value })}
                  onBlur={commit}
                />

                {/* 행위 시간. 0 이면 [완료] 즉시 끝, 0 보다 크면 카드가 그만큼 같이 세어준다 */}
                <span className="behavior__duration">
                  <label>
                    {SETTINGS.DURATION_LABEL}
                    <NumberField
                      value={behavior.durationSec}
                      min={MIN_DURATION_SEC}
                      max={MAX_DURATION_SEC}
                      clamp={clampDurationSeconds}
                      disabled={!behavior.enabled}
                      ariaLabel={`${behavior.label} ${SETTINGS.DURATION_LABEL}(${SETTINGS.DURATION_SUFFIX})`}
                      onChange={(seconds) => editLocal(behavior.id, { durationSec: seconds })}
                      onCommit={(seconds) => commitField(behavior.id, { durationSec: seconds })}
                    />
                    {SETTINGS.DURATION_SUFFIX}
                  </label>
                  <em>
                    {behavior.durationSec === 0
                      ? SETTINGS.DURATION_ZERO_HINT
                      : SETTINGS.DURATION_HINT.replace('{n}', String(behavior.durationSec))}
                  </em>
                </span>
              </Card>
            ))}
          </ul>
        )}

        <div className="row">
          <Button
            size="sm"
            disabled={behaviors === null || atLimit}
            onClick={() =>
              behaviors &&
              // Date.now() 는 UI 계층에서만 — 코어의 newBehavior 는 now 를 인자로 받는다
              void persistBehaviors([...behaviors, newBehavior(behaviors, Date.now())])
            }
          >
            {SETTINGS.BEHAVIOR_ADD}
          </Button>
          <Button
            size="sm"
            disabled={behaviors === null}
            onClick={() => behaviors && void persistBehaviors(restoreBuiltins(behaviors))}
          >
            {SETTINGS.BEHAVIOR_RESTORE}
          </Button>
        </div>

        <p className="hint">
          {atLimit
            ? SETTINGS.BEHAVIOR_LIMIT.replace('{n}', String(MAX_BEHAVIORS))
            : SETTINGS.BEHAVIORS_HINT}
        </p>
        <p className="hint">{SETTINGS.BEHAVIOR_RESTORE_HINT}</p>

        {/* 근거 보기 (D2.9) — 간격이 왜 지금 값인지, 아카이브 카피 예시를 그대로 보여준다 */}
        <Button size="sm" variant="ghost" onClick={() => setEvidenceOpen((v) => !v)}>
          {SETTINGS.EVIDENCE_ENTRY}
        </Button>
        {evidenceOpen && (
          <div className="evidence">
            <p>{SETTINGS.EVIDENCE_STRETCH}</p>
            <p>{SETTINGS.EVIDENCE_EYES}</p>
            <p className="hint">{ACTION_CARDS_DISCLAIMER}</p>
          </div>
        )}

        {/* 동작 목록 (D2.10) — 스트레칭 카드가 로테이션으로 보여줄 8종 중 뭘 켤지 고른다 */}
        <Button size="sm" variant="ghost" onClick={() => setActionsOpen((v) => !v)}>
          {SETTINGS.ACTIONS_ENTRY}
        </Button>
        {actionsOpen && (
          <div className="action-prefs">
            <p className="hint">{ACTION_CARDS_DISCLAIMER}</p>
            <ul className="action-prefs__list">
              {Object.entries(ACTION_CARDS).map(([id, action]) => {
                const checked = actionPrefs?.find((p) => p.id === id)?.enabled ?? true
                const blocked = checked && actionPrefs !== null && !canDisable(actionPrefs, id)
                return (
                  <Card key={id} as="li" variant="row" className="action-pref">
                    <div className="action-card__head">
                      <Checkbox
                        checked={checked}
                        disabled={actionPrefs === null || blocked}
                        ariaLabel={action.name}
                        onChange={(next) =>
                          actionPrefs &&
                          void persistActionPrefs(
                            actionPrefs.map((p) => (p.id === id ? { ...p, enabled: next } : p))
                          )
                        }
                      />
                      <strong>{action.name}</strong>
                      {blocked && (
                        <span className="tag" title={SETTINGS.ACTIONS_MIN_ONE_HINT}>
                          {SETTINGS.ACTIONS_MIN_ONE_HINT}
                        </span>
                      )}
                    </div>
                    <ul className="action-card__method">
                      {action.method.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    <p className="action-card__row">
                      <span>{SETTINGS.ACTIONS_DURATION_LABEL}</span>
                      <strong>{action.duration}</strong>
                    </p>
                    <p className="action-card__source">
                      {SETTINGS.ACTIONS_SOURCE_LABEL}: {action.source}
                    </p>
                  </Card>
                )
              })}
            </ul>
          </div>
        )}
      </Section>

      <RoutineFinder
        remaining={Math.max(0, MAX_BEHAVIORS - (behaviors?.length ?? MAX_BEHAVIORS))}
        onInsert={insertRoutine}
      />

      <Section title={SETTINGS.PROFILE_TITLE}>
        <p className="hint">{SETTINGS.PROFILE_WHY}</p>

        <div className="row row--split">
          <span className="field-label">{SETTINGS.PROFILE_SEX_LABEL}</span>
          <div className="segmented">
            {SEXES.map((sex) => (
              <Button
                key={sex}
                size="sm"
                variant={profile?.sex === sex ? 'primary' : 'ghost'}
                disabled={profile === null}
                onClick={() =>
                  profile &&
                  void persistProfile({
                    ...profile,
                    sex: profile.sex === sex ? null : sex,
                  })
                }
              >
                {SEX_LABEL[sex]}
              </Button>
            ))}
            {profile?.sex === null && <span className="tag">{SETTINGS.PROFILE_UNSET}</span>}
          </div>
        </div>

        <div className="row row--split">
          <span className="field-label">{SETTINGS.PROFILE_AGE_LABEL}</span>
          <div className="segmented">
            {AGE_GROUPS.map((age) => (
              <Button
                key={age}
                size="sm"
                variant={profile?.ageGroup === age ? 'primary' : 'ghost'}
                disabled={profile === null}
                onClick={() =>
                  profile &&
                  void persistProfile({
                    ...profile,
                    ageGroup: profile.ageGroup === age ? null : age,
                  })
                }
              >
                {AGE_GROUP_LABEL[age]}
              </Button>
            ))}
            {profile?.ageGroup === null && <span className="tag">{SETTINGS.PROFILE_UNSET}</span>}
          </div>
        </div>

        <p className="hint">{SETTINGS.PROFILE_SKIP_HINT}</p>
      </Section>

      <WaterSection profile={profile} behaviors={behaviors} onApply={persistBehaviors} />

      <Section title={SETTINGS.THEME_TITLE}>
        <div className="segmented">
          {THEME_PREFERENCES.map((pref) => (
            <Button
              key={pref}
              size="sm"
              variant={settings?.theme === pref ? 'primary' : 'ghost'}
              disabled={settings === null}
              onClick={() => settings && void persist({ ...settings, theme: pref })}
            >
              {THEME_LABEL[pref]}
            </Button>
          ))}
        </div>
      </Section>

      <Section title={SETTINGS.SOUND_TITLE}>
        <Checkbox
          checked={settings?.soundEnabled ?? false}
          disabled={settings === null}
          label={SETTINGS.SOUND_LABEL}
          onChange={(checked) => settings && void persist({ ...settings, soundEnabled: checked })}
        />

        <div className="row">
          <span className="sound__label">{SETTINGS.SOUND_VOLUME}</span>
          {/*
            드래그하는 내내 저장하면 DB 쓰기와 방송이 수십 번 나간다. 화면만 먼저 움직이고
            손을 뗄 때(또는 키보드 조작이 끝날 때) 한 번 저장한다.
          */}
          <input
            type="range"
            className="sound__range"
            min={MIN_SOUND_VOLUME}
            max={MAX_SOUND_VOLUME}
            step={5}
            value={settings?.soundVolume ?? 0}
            disabled={settings === null || !settings.soundEnabled}
            aria-label={SETTINGS.SOUND_VOLUME}
            onChange={(e) =>
              settings && setSettings({ ...settings, soundVolume: Number(e.target.value) })
            }
            onPointerUp={() => settings && void persist(settings)}
            onKeyUp={() => settings && void persist(settings)}
            onBlur={() => settings && void persist(settings)}
          />
          <span className="sound__value">{settings?.soundVolume ?? 0}</span>

          {/* 소리는 눌러보기 전엔 알 수 없다. 볼륨을 맞추려면 들어봐야 한다 */}
          <Button
            size="sm"
            disabled={settings === null || !settings.soundEnabled}
            onClick={() => settings && playCue('start', settings)}
          >
            {SETTINGS.SOUND_PREVIEW}
          </Button>
        </div>

        <p className="hint">{SETTINGS.SOUND_HINT}</p>
      </Section>

      <Section title={SETTINGS.IDLE_TITLE}>
        <div className="row row--split">
          <Checkbox
            checked={settings?.idleReminderEnabled ?? false}
            disabled={settings === null}
            label={SETTINGS.IDLE_LABEL}
            onChange={(checked) =>
              settings && void persist({ ...settings, idleReminderEnabled: checked })
            }
          />

          {/*
            행동의 간격칸과 **같은 컴포넌트**를 쓴다. D2.8 이전에는 여기만 생 input 이라
            마지막 글자를 지우는 순간 `Number('')=0` 이 저장되고 정규화가 기본값(30분)으로
            되돌려 버렸다 — 간격칸에서 이미 고친 버그가 여기 남아 있었다.
          */}
          <span className="behavior__interval">
            <NumberField
              value={settings?.idleReminderMinutes ?? DEFAULT_SETTINGS.idleReminderMinutes}
              min={MIN_IDLE_REMINDER_MINUTES}
              max={MAX_IDLE_REMINDER_MINUTES}
              clamp={clampIdleReminderMinutes}
              disabled={settings === null || !settings.idleReminderEnabled}
              ariaLabel={`${SETTINGS.IDLE_LABEL} (${SETTINGS.IDLE_SUFFIX})`}
              onChange={(minutes) =>
                settings && setSettings({ ...settings, idleReminderMinutes: minutes })
              }
              onCommit={(minutes) =>
                settings && void persist({ ...settings, idleReminderMinutes: minutes })
              }
            />
            {SETTINGS.IDLE_SUFFIX}
          </span>
        </div>
      </Section>

      <section className="section">
        <Checkbox
          checked={autostart === true}
          disabled={autostart === null}
          label={SETTINGS.AUTOSTART_LABEL}
          onChange={(checked) => void toggleAutostart(checked)}
        />
        <p className="hint">{SETTINGS.AUTOSTART_HINT}</p>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  )
}

/**
 * 물 참고 기준 (D2.9, 아카이브 §2). 신체정보가 없으면 일반값 경로로 자연스럽게 빠진다
 * (`waterReference` 가 null 을 받아도 문구를 낸다). 간격은 **제안만** — [제안 적용]을
 * 눌러야 실제 '물마시기' 행동의 간격이 바뀐다 (자동 변경 금지).
 */
function WaterSection({
  profile,
  behaviors,
  onApply,
}: {
  profile: Profile | null
  behaviors: Behavior[] | null
  onApply: (draft: Behavior[]) => Promise<void>
}) {
  const reference = waterReference(profile?.sex ?? null, profile?.ageGroup ?? null)
  const water = behaviors?.find((b) => b.id === 'water')
  const suggested = suggestWaterInterval(reference.liquidMl ?? 0, DEFAULT_SESSION_HOURS)
  const currentInterval = water ? intervalMinutes(water) : null

  return (
    <Section title={SETTINGS.WATER_TITLE}>
      <p>{reference.label}</p>
      <p className="hint">{SETTINGS.WATER_ACTIVITY_HINT}</p>

      {water && (
        <div className="row row--split">
          <p className="hint">
            {SETTINGS.WATER_SUGGESTION_HINT.replace('{n}', String(suggested)).replace(
              '{hours}',
              String(DEFAULT_SESSION_HOURS)
            )}
          </p>
          <Button
            size="sm"
            disabled={currentInterval === suggested}
            onClick={() =>
              behaviors &&
              void onApply(
                behaviors.map((b) =>
                  b.id === 'water'
                    ? { ...b, rule: { kind: 'interval' as const, everyMs: suggested * MIN } }
                    : b
                )
              )
            }
          >
            {SETTINGS.WATER_APPLY_SUGGESTION}
          </Button>
        </div>
      )}

      <p className="hint">⚠ {SETTINGS.WATER_DISCLAIMER}</p>
    </Section>
  )
}
