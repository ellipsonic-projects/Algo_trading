let slAudio: HTMLAudioElement | null = null
let globalPrimed = false

export function getSlAudioSrc(): string {
  return '/assets/music/fah.mp3'
}

function ensureAudio(): HTMLAudioElement {
  if (slAudio) return slAudio
  slAudio = new Audio(getSlAudioSrc())
  slAudio.preload = 'auto'
  return slAudio
}

export function primeSlAudio(): void {
  const audio = ensureAudio()

  const prevMuted = audio.muted
  const prevVolume = audio.volume

  audio.muted = true
  audio.volume = 0

  const p = audio.play()
  if (p && typeof (p as Promise<void>).then === 'function') {
    ;(p as Promise<void>)
      .then(() => {
        audio.pause()
        audio.currentTime = 0
      })
      .catch(() => {})
      .finally(() => {
        audio.muted = prevMuted
        audio.volume = prevVolume
      })
  } else {
    audio.muted = prevMuted
    audio.volume = prevVolume
  }
}

// Prime on first user interaction to satisfy autoplay policy
if (typeof window !== 'undefined' && !globalPrimed) {
  const once = () => {
    primeSlAudio()
    globalPrimed = true
  }
  document.addEventListener('pointerdown', once, { once: true, capture: true })
  document.addEventListener('keydown', once, { once: true, capture: true })
}

export function playSlAudio(): void {
  const audio = ensureAudio()
  audio.currentTime = 0
  audio.volume = 1
  audio.muted = false
  audio.load()
  const p = audio.play()
  if (p && typeof (p as Promise<void>).catch === 'function') {
    ;(p as Promise<void>).catch((err) => {
      console.warn('[SL AUDIO] Playback failed:', err)
    })
  }
}

export function isStopLossExitReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  const normalized = reason.trim().toUpperCase()
  return normalized === 'SL' || normalized === 'STOP_LOSS' || normalized === 'STOPLOSS'
}
