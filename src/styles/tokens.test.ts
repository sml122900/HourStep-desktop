/**
 * 디자인 시스템 규칙을 **자동으로** 지킨다.
 *
 * D2.5 에서 색을 CSS 변수로 옮겨 놓고도 창별 CSS 에 하드코딩 값이 계속 새로 생겼다.
 * 사람이 리뷰로 잡는 규칙은 결국 샌다 — 그래서 잔존 여부를 테스트로 못 박는다.
 * (stylelint 를 새로 들이지 않는 이유: 규칙 네 개 때문에 의존성·설정 파일이 늘어난다.)
 *
 * 규격과 예외는 docs/design-system.md.
 */

import { describe, expect, it } from 'vitest'

/**
 * `src/**` 의 모든 CSS 를 문자열로 읽는다. `node:fs` 대신 Vite 의 glob 을 쓰는 이유 —
 * `@types/node` 를 새로 들이지 않으려는 것도 있고, **새 CSS 파일이 자동으로 검사 대상에
 * 들어와야** 하기 때문이다. 파일을 하나씩 import 하면 새로 만든 창은 조용히 빠진다.
 */
const RAW = import.meta.glob('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** glob 키는 이 파일 기준 상대경로다 (`./base.css`, `../windows/main/main.css`) */
const nameOf = (path: string) => path.replace(/^\.{1,2}\//, '')

/** 토큰을 **정의**하는 파일. 여기만 색 리터럴을 쓸 수 있다 */
const TOKENS = 'tokens.css'

/** 주석 안의 예시·설명은 규칙 대상이 아니다 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const tokensCss = Object.entries(RAW).find(([p]) => nameOf(p) === TOKENS)?.[1] as string

/** 토큰을 **참조**하기만 해야 하는 CSS 전부 */
const CONSUMERS = Object.entries(RAW)
  .map(([path, css]) => ({ name: nameOf(path), css: strip(css) }))
  .filter((f) => f.name !== TOKENS)
  .sort((a, b) => a.name.localeCompare(b.name))

describe('tokens.css', () => {
  it('라이트/다크 두 벌을 다 정의한다', () => {
    expect(tokensCss).toBeTypeOf('string')
    expect(tokensCss).toContain(":root[data-theme='dark']")
    expect(tokensCss).toContain(":root[data-theme='light']")
  })

  it('두 테마가 같은 토큰 집합을 갖는다', () => {
    // 한쪽에만 있는 토큰은 그 테마에서 조용히 다른 테마 값을 물려받는다 — 반드시 잡아야 한다
    const split = tokensCss.indexOf(":root[data-theme='light']")
    const names = (block: string) =>
      new Set([...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))

    const dark = tokensCss.slice(0, split)
    const light = tokensCss.slice(split)
    const darkNames = names(dark.slice(0, dark.indexOf('color-scheme: dark')))
    const lightNames = names(light.slice(0, light.indexOf('color-scheme: light')))

    expect([...darkNames].filter((n) => !lightNames.has(n))).toEqual([])
    expect([...lightNames].filter((n) => !darkNames.has(n))).toEqual([])
  })

  it('검사 대상 CSS 를 실제로 다 찾았고, 내용이 비어 있지 않다', () => {
    // 빈 문자열은 아래 규칙을 전부 **조용히 통과**시킨다. 실제로 그렇게 샌 적이 있다 —
    // vitest 의 `css: false`(기본값)가 CSS 를 빈 모듈로 갈아치웠다 (vite.config.ts 참고).
    for (const f of [...CONSUMERS, { name: TOKENS, css: tokensCss }]) {
      expect(f.css.length, `${f.name} 가 비었다`).toBeGreaterThan(200)
    }

    // 경로가 어긋나 0건을 검사하고 통과하는 사고를 막는다
    expect(CONSUMERS.map((f) => f.name)).toEqual([
      'base.css',
      'components.css',
      'windows/main/main.css',
      'windows/overlay/overlay.css',
      'windows/settings/settings.css',
    ])
  })
})

describe('토큰 밖 하드코딩', () => {
  it.each(CONSUMERS)('$name 에 색 리터럴이 없다', ({ css }) => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(css.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([])
  })

  it.each(CONSUMERS)('$name 의 여백이 전부 --sp-* 에서 온다', ({ css }) => {
    const offenders: string[] = []

    // 선언의 시작은 파일 처음 / `{` / `;` 뒤 — 한 줄에 여러 선언을 몰아 써도 걸린다
    for (const [, prop, value] of css.matchAll(
      /(?:^|[;{])\s*(padding|margin|gap|row-gap|column-gap)(?:-top|-right|-bottom|-left)?\s*:\s*([^;{}]+)/g
    )) {
      // var(--sp-2) / calc(var(--icon-size) + var(--sp-3)) 는 토큰을 지운 뒤 길이가 남지 않는다
      const literal = value.replace(/var\(--[a-z0-9-]+\)/g, '')
      if (/\d\s*(?:px|r?em)/.test(literal)) offenders.push(`${prop}: ${value.trim()}`)
    }

    expect(offenders).toEqual([])
  })

  it('오버레이 창은 그림자를 쓰지 않는다', () => {
    // 창이 카드 실크기라 바깥으로 번지는 그림자는 잘린다 (docs/decisions/0005)
    const overlay = CONSUMERS.find((f) => f.name === 'windows/overlay/overlay.css')
    expect(overlay?.css).not.toMatch(/--shadow-/)
  })
})
