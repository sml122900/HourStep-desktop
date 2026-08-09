import type { ReactNode } from 'react'

/**
 * 보여줄 게 없을 때 자리를 비워 두지 않고 왜 비었는지 한 줄로 말한다
 * (세션 없음 / 통계 0건 / 파싱 실패). 문구는 `src/constants/strings.ts` 에서 온다.
 */
export default function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
