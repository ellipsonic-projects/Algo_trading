import { describe, expect, it, vi, beforeEach } from 'vitest'

import { getSlAudioSrc, isStopLossExitReason, playSlAudio, primeSlAudio } from './slAudio'

// Mock HTMLAudioElement
const mockPlay = vi.fn()
const mockPause = vi.fn()
const mockLoad = vi.fn()
vi.stubGlobal('Audio', vi.fn().mockImplementation(() => ({
  play: mockPlay,
  pause: mockPause,
  load: mockLoad,
  currentTime: 0,
  volume: 1,
  muted: false,
  preload: 'auto',
})))

describe('slAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct audio src path', () => {
    expect(getSlAudioSrc()).toBe('/assets/music/fah.mp3')
  })

  it('detects SL exit reasons correctly', () => {
    expect(isStopLossExitReason('SL')).toBe(true)
    expect(isStopLossExitReason('sl')).toBe(true)
    expect(isStopLossExitReason(' STOP_LOSS ')).toBe(true)
    expect(isStopLossExitReason('stoploss')).toBe(true)
    expect(isStopLossExitReason('Target')).toBe(false)
    expect(isStopLossExitReason('')).toBe(false)
    expect(isStopLossExitReason(null)).toBe(false)
    expect(isStopLossExitReason(undefined)).toBe(false)
  })

  it('primes audio silently', async () => {
    primeSlAudio()
    expect(global.Audio).toHaveBeenCalledWith('/assets/music/fah.mp3')
    expect(mockPlay).toHaveBeenCalled()
    expect(mockPause).toHaveBeenCalled()
  })

  it('plays SL audio', () => {
    playSlAudio()
    expect(global.Audio).toHaveBeenCalledWith('/assets/music/fah.mp3')
    expect(mockPlay).toHaveBeenCalled()
  })
})
