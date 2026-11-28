// Fixed QR version 5-L, byte mode, mask 0. Kept local so the hall PIN never reaches a QR service.
const SIZE = 37, DATA_WORDS = 108, ECC_WORDS = 26, MAX_BYTES = 106
function multiply(a: number, b: number): number {
  let result = 0
  for (let i = 7; i >= 0; i--) { result = (result << 1) ^ ((result >>> 7) * 0x11d); result ^= ((b >>> i) & 1) * a }
  return result
}
/** Encode a short HTTPS/local quiz URL into a scanner-readable SVG path, including a four-module quiet zone. */
export function quizQrPath(value: string): string | null {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > MAX_BYTES) return null
  const bits: number[] = []
  const append = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  append(4,4); append(bytes.length,8); for (const byte of bytes) append(byte,8)
  append(0,Math.min(4,DATA_WORDS * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i,i + 8).reduce((a,b) => a * 2 + b,0))
  for (let pad = 0; data.length < DATA_WORDS; pad++) data.push(pad % 2 ? 0x11 : 0xec)
  const divisor = Array<number>(ECC_WORDS).fill(0), remainder = Array<number>(ECC_WORDS).fill(0)
  divisor[ECC_WORDS - 1] = 1
  let root = 1
  for (let i = 0; i < ECC_WORDS; i++) {
    for (let j = 0; j < ECC_WORDS; j++) divisor[j] = multiply(divisor[j],root) ^ (j + 1 < ECC_WORDS ? divisor[j + 1] : 0)
    root = multiply(root,2)
  }
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!; remainder.push(0)
    for (let i = 0; i < ECC_WORDS; i++) remainder[i] ^= multiply(divisor[i],factor)
  }
  const words = [...data,...remainder]
  const cells = Array.from({ length: SIZE },() => Array<boolean>(SIZE).fill(false))
  const fixed = Array.from({ length: SIZE },() => Array<boolean>(SIZE).fill(false))
  const set = (x: number,y: number,dark: boolean) => { if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) { cells[y][x] = dark; fixed[y][x] = true } }
  for (let i = 0; i < SIZE; i++) { set(6,i,i % 2 === 0); set(i,6,i % 2 === 0) }
  for (const [cx,cy] of [[3,3],[SIZE - 4,3],[3,SIZE - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.max(Math.abs(dx),Math.abs(dy)); set(cx + dx,cy + dy,d !== 2 && d !== 4)
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(30 + dx,30 + dy,Math.max(Math.abs(dx),Math.abs(dy)) !== 1)
  const formatData = 8 // L error correction, mask 0.
  let rem = formatData
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const format = ((formatData << 10) | rem) ^ 0x5412
  const bit = (i: number) => Boolean((format >>> i) & 1)
  for (let i = 0; i <= 5; i++) set(8,i,bit(i))
  set(8,7,bit(6)); set(8,8,bit(7)); set(7,8,bit(8))
  for (let i = 9; i < 15; i++) set(14 - i,8,bit(i))
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i,8,bit(i))
  for (let i = 8; i < 15; i++) set(8,SIZE - 15 + i,bit(i))
  set(8,SIZE - 8,true)
  let index = 0
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = ((right + 1) & 2) === 0 ? SIZE - 1 - vertical : vertical
      for (let j = 0; j < 2; j++) {
        const x = right - j
        if (fixed[y][x]) continue
        const dark = index < words.length * 8 && Boolean((words[index >>> 3] >>> (7 - (index & 7))) & 1)
        cells[y][x] = dark !== ((x + y) % 2 === 0); index++
      }
    }
  }
  return cells.flatMap((row,y) => row.flatMap((dark,x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join('')
}
