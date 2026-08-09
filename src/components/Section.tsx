import type { ReactNode, Ref } from 'react'

/** 제목 한 줄 + 본문. 설정 창의 묶음이 전부 이 모양이다. */
export default function Section({
  title,
  children,
  ref,
}: {
  title: string
  children: ReactNode
  ref?: Ref<HTMLElement>
}) {
  return (
    <section className="section" ref={ref}>
      <h2 className="section__title">{title}</h2>
      {children}
    </section>
  )
}
