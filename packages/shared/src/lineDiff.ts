// Построчный diff (roadmap-4 п.9): какие строки нового текста добавлены/изменены относительно старого.
// LCS по строкам с ограничением размера — для подсветки правок ассистента в редакторе, не для патчей.

export function changedLines(prev: string, next: string, limit = 4000): number[] {
  const a = prev.split('\n'), b = next.split('\n')
  if (a.length > limit || b.length > limit) return b.map((_, i) => i + 1)
  // LCS DP по строкам (O(n·m) на ≤4000² ячеек — терпимо для файлов проекта Make).
  const n = a.length, m = b.length
  const dp: Uint16Array[] = []
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out: number[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++ }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else { out.push(j + 1); j++ }
  }
  while (j < m) { out.push(j + 1); j++ }
  return out
}
