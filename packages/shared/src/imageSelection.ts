export interface DetectedImageObject { x: number; y: number; width: number; height: number; pixels: number }

function pixelDistance(data: Uint8ClampedArray, at: number, color: readonly number[]): number {
  const alpha = Math.abs(data[at + 3]! - color[3]!)
  const red = data[at]! - color[0]!
  const green = data[at + 1]! - color[1]!
  const blue = data[at + 2]! - color[2]!
  return Math.sqrt(red * red + green * green + blue * blue + alpha * alpha)
}

/** Selects a connected region whose pixels are close to the seed color. */
export function magicWandMask(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, tolerance: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height)
  if (width <= 0 || height <= 0) return output
  const seedX = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const seedY = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const seedAt = (seedY * width + seedX) * 4
  const seed = [data[seedAt]!, data[seedAt + 1]!, data[seedAt + 2]!, data[seedAt + 3]!] as const
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  queue[tail++] = seedY * width + seedX
  output[seedY * width + seedX] = 255
  while (head < tail) {
    const index = queue[head++]!
    const px = index % width
    const py = Math.floor(index / width)
    const neighbours = [px > 0 ? index - 1 : -1, px + 1 < width ? index + 1 : -1, py > 0 ? index - width : -1, py + 1 < height ? index + width : -1]
    for (const next of neighbours) {
      if (next < 0 || output[next]) continue
      if (pixelDistance(data, next * 4, seed) > tolerance) continue
      output[next] = 255
      queue[tail++] = next
    }
  }
  return output
}

/**
 * Finds foreground islands against the average corner color. This works well
 * for portraits and product shots with a stable background. Complex scenes
 * can still use the magic wand or an explicit lasso.
 */
export function detectImageObjects(data: Uint8ClampedArray, width: number, height: number, tolerance: number): DetectedImageObject[] {
  if (width <= 0 || height <= 0) return []
  const corners = [0, width - 1, (height - 1) * width, height * width - 1]
  const background = [0, 0, 0, 0]
  for (const index of corners) for (let channel = 0; channel < 4; channel += 1) background[channel] += data[index * 4 + channel]!
  for (let channel = 0; channel < 4; channel += 1) background[channel] /= corners.length
  const foreground = new Uint8Array(width * height)
  for (let index = 0; index < foreground.length; index += 1) {
    if (pixelDistance(data, index * 4, background) > tolerance) foreground[index] = 1
  }
  const seen = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  const minimum = Math.max(9, Math.round(width * height * 0.002))
  const found: DetectedImageObject[] = []
  for (let start = 0; start < foreground.length; start += 1) {
    if (!foreground[start] || seen[start]) continue
    let head = 0
    let tail = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    seen[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]!
      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      const neighbours = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]
      for (const next of neighbours) if (next >= 0 && foreground[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next }
    }
    if (tail >= minimum) found.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels: tail })
  }
  return found.sort((a, b) => b.pixels - a.pixels).slice(0, 8)
}

export function selectionBounds(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } | null {
  if (!points.length) return null
  const x = Math.min(...points.map((point) => point.x))
  const y = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x, y, width: right - x, height: bottom - y }
}
