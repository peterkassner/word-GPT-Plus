export function createUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const buffer = new Uint8Array(16)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buffer)
  } else {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.floor(Math.random() * 256)
    }
  }

  buffer[6] = (buffer[6] & 0x0f) | 0x40
  buffer[8] = (buffer[8] & 0x3f) | 0x80

  const bytesToHex = (index: number) => buffer[index].toString(16).padStart(2, '0')

  return `${bytesToHex(0)}${bytesToHex(1)}${bytesToHex(2)}${bytesToHex(3)}-${bytesToHex(4)}${bytesToHex(
    5,
  )}-${bytesToHex(6)}${bytesToHex(7)}-${bytesToHex(8)}${bytesToHex(9)}-${bytesToHex(10)}${bytesToHex(
    11,
  )}${bytesToHex(12)}${bytesToHex(13)}${bytesToHex(14)}${bytesToHex(15)}`
}
