/// <reference types="node" />
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSnow, stepSnow } from './snow.ts'

const gravity = { x: 0, y: -1, z: 0 }

test('snow stays inside the globe, gets stirred up and settles again', () => {
  const count = 500
  const radius = 0.96
  const groundY = -0.5
  const dt = 1 / 60
  const snow = createSnow(count, radius, groundY)
  const still = { x: 0, y: 0, z: 0 }

  for (let i = 0; i < 120; i++) stepSnow(snow, dt, { x: Math.sin(i * 0.5) * 60, y: 0, z: 0 }, gravity)
  assert.ok(snow.turbulence > 0.5, `turbulence after shaking: ${snow.turbulence}`)

  for (let i = 0; i < 60 * 90; i++) stepSnow(snow, dt, still, gravity)

  for (let j = 0; j < count * 3; j += 3) {
    const [x, y, z] = snow.pos.subarray(j, j + 3)
    assert.ok(Math.hypot(x, y, z) <= radius + 1e-4, 'flake outside the globe')
    assert.ok(y >= groundY - 1e-4, 'flake below the ground')
  }
  const resting = snow.resting.reduce((sum, value) => sum + value, 0)
  assert.ok(resting > count * 0.95, `only ${resting}/${count} flakes at rest`)
})

function medianNearestDistance(pos: Float32Array) {
  const distances: number[] = []
  for (let i = 0; i < pos.length; i += 3) {
    let nearest = Infinity
    for (let k = 0; k < pos.length; k += 3) {
      if (k !== i)
        nearest = Math.min(nearest, Math.hypot(pos[i] - pos[k], pos[i + 1] - pos[k + 1], pos[i + 2] - pos[k + 2]))
    }
    distances.push(nearest)
  }
  return distances.sort((a, b) => a - b)[distances.length >> 1]
}

test('flakes do not clump when shaken hard', () => {
  const random = Math.random
  let seed = 12345
  Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  try {
    const dt = 1 / 60
    const snow = createSnow(400, 0.96, -0.5)
    const before = medianNearestDistance(snow.pos)

    // Same spring as in main.ts; the target jumps between ±0.8 every 0.15 s for 3 s.
    let x = 0
    let v = 0
    for (let frame = 0; frame < 60 * 5; frame++) {
      const target = frame < 180 ? (Math.floor((frame * dt) / 0.15) % 2 ? 0.8 : -0.8) : 0
      const a = 120 * (target - x) - 7 * v
      v += a * dt
      x += v * dt
      stepSnow(snow, dt, { x: a, y: 0, z: 0 }, gravity)
    }

    const ratio = medianNearestDistance(snow.pos) / before
    assert.ok(ratio > 0.5, `median nearest-neighbour distance shrank to ${ratio.toFixed(3)} of its start value`)
  } finally {
    Math.random = random
  }
})
