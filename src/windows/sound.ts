/**
 * 알림음 — WebAudio 합성. 음원 파일을 번들하지 않는다 (수백 KB 를 더 들고 다닐 이유가 없고,
 * 두 종류의 짧은 신호음은 코드 스무 줄로 만들어진다).
 *
 * **재생 주체는 오버레이 창**이다. 메인 창은 트레이로 숨어 있을 수 있어서 소리를 맡길 수 없다.
 * 설정 창은 볼륨을 맞출 때 [미리듣기]에만 이 모듈을 쓴다.
 *
 * 세 지점에서 울린다:
 *   ① `start` — 카드가 뜰 때. 행동 종류와 무관하게 무조건
 *   ② `end`   — 카운트다운이 끝날 때. 행위 시간이 있는 행동만
 *   ③ `step`  — 카운트다운 중 동작 단계가 자동 전환될 때(D2.11). **새 소리를 만들지 않고**
 *      `end` 와 같은 짧은 고음을 그대로 재사용한다 — cue 키만 나눠서 stdout 로그(`sound step …`)
 *      에서 "완전히 끝났다"와 "다음 단계로 넘어갔다"를 구분할 수 있게 했다.
 * 스누즈·건너뛰기·큐 대기는 무음이다 — 사용자가 이미 카드를 보고 있는 상황이라
 * 소리는 정보가 아니라 방해가 된다.
 */

import { MAX_SOUND_VOLUME, MIN_SOUND_VOLUME } from '../core/settings'

export type SoundCue = 'start' | 'end' | 'step'

interface Note {
  freq: number
  /** 큐 시작 기준 시작 시각(초) */
  at: number
  /** 길이(초) */
  length: number
}

/**
 * ①과 ②는 **귀로 구분돼야 한다** — 하나는 "시작해라", 다른 하나는 "끝났다"는 뜻이다.
 * 시작은 올라가는 두 음으로 길게, 끝은 한 음으로 짧고 높게.
 */
const CUES: Record<SoundCue, Note[]> = {
  start: [
    { freq: 587.33, at: 0, length: 0.17 }, // D5
    { freq: 880.0, at: 0.13, length: 0.24 }, // A5
  ],
  end: [{ freq: 1174.66, at: 0, length: 0.1 }], // D6
  // end 와 완전히 같은 정의 — 재사용이지 새 소리가 아니다
  step: [{ freq: 1174.66, at: 0, length: 0.1 }], // D6
}

/** 볼륨 100% 일 때의 진폭. 사인파는 0.25 만 돼도 충분히 들린다 — 놀라게 하려는 게 아니다 */
const PEAK_GAIN = 0.25

let ctx: AudioContext | null = null

/**
 * AudioContext 는 창당 하나만 만들어 재사용한다. 카드가 뜰 때마다 새로 만들면
 * 하드웨어 오디오 스트림이 그만큼 열린다.
 */
function audioContext(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  try {
    ctx = new window.AudioContext()
  } catch {
    return null
  }
  return ctx
}

/**
 * 큐를 한 번 재생한다. **예외를 던지지 않는다** — 소리가 안 나는 건 알림이 안 뜨는 것보다
 * 훨씬 가벼운 실패이고, 여기서 던지면 카드 표시 경로가 통째로 멈춘다.
 *
 * @returns 검증용 한 줄. 자동 검증이 stdout 에서 이 문자열을 찾는다.
 */
export function playCue(
  cue: SoundCue,
  settings: { soundEnabled: boolean; soundVolume: number }
): string {
  if (!settings.soundEnabled) return `sound ${cue} skipped=off`

  const volume = Math.min(MAX_SOUND_VOLUME, Math.max(MIN_SOUND_VOLUME, settings.soundVolume))
  if (volume <= 0) return `sound ${cue} skipped=zero-volume`

  const audio = audioContext()
  if (!audio) return `sound ${cue} skipped=no-audio-context`

  // 웹뷰가 사용자 조작 전에는 오디오를 재워 둘 수 있다. 오버레이 창은 포커스를 받지 않으므로
  // (WS_EX_NOACTIVATE) 조작이 영영 안 올 수도 있어서 tauri.conf.json 에 자동재생 인자를 줬고,
  // 그래도 잠겨 있으면 여기서 깨운다. 실패해도 조용히 지나간다.
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined)

  try {
    const gain = (volume / MAX_SOUND_VOLUME) * PEAK_GAIN
    const start = audio.currentTime + 0.01

    for (const note of CUES[cue]) {
      const osc = audio.createOscillator()
      const env = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = note.freq

      const from = start + note.at
      const to = from + note.length
      // 시작·끝을 각지게 자르면 '틱' 하는 클릭 노이즈가 난다. 8ms 로 올리고 지수로 내린다
      env.gain.setValueAtTime(0.0001, from)
      env.gain.exponentialRampToValueAtTime(gain, from + 0.008)
      env.gain.exponentialRampToValueAtTime(0.0001, to)

      osc.connect(env).connect(audio.destination)
      osc.start(from)
      osc.stop(to + 0.02)
    }
  } catch (e) {
    return `sound ${cue} failed=${e}`
  }

  return `sound ${cue} volume=${volume} state=${audio.state}`
}
