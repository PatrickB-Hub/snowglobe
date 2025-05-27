// Snow physics in the globe's local frame
// Not a fluid solver: the water is a damped slosh plus chaotic eddies whose
// energy (turbulence) rises while shaking and then decays exponentially

export const params = {
  sinkSpeed: 0.08, // sinking speed in calm water (radii/s)
  drag: 30, // how quickly flakes follow the current (1/s)
  inertia: 0.05, // flake/water density difference
  slosh: 0.04, // how far the water lags behind while shaking
  sloshStiffness: 6,
  sloshDamping: 1.5,
  turbulenceGain: 0.04, // turbulence per unit of acceleration
  turbulenceDecay: 2.5, // turbulence decay time (s)
  swirl: 0.6, // speed at full turbulence
  wakeThreshold: 0.15, // turbulence above which resting snow is stirred up again
}

export type Vec3 = { x: number; y: number; z: number }
export type Snow = ReturnType<typeof createSnow>

export function createSnow(count: number, radius: number, groundY: number, turbulence = 0.4) {
  const pos = new Float32Array(count * 3)
  for (let j = 0; j < pos.length; j += 3) {
    let x: number, y: number, z: number
    do {
      x = Math.random() * 2 - 1
      y = Math.random() * 2 - 1
      z = Math.random() * 2 - 1
    } while (x * x + y * y + z * z > 1 || y * radius < groundY)
    pos[j] = x * radius
    pos[j + 1] = y * radius
    pos[j + 2] = z * radius
  }
  return {
    pos,
    vel: new Float32Array(count * 3),
    resting: new Uint8Array(count),
    sink: Float32Array.from({ length: count }, () => 0.6 + Math.random() * 0.8),
    wake: Float32Array.from({ length: count }, () => 0.3 + Math.random()),
    radius,
    groundY,
    turbulence,
    time: 0,
    slosh: { x: 0, y: 0, z: 0 },
    sloshVelocity: { x: 0, y: 0, z: 0 },
  }
}

// accel: the globe's acceleration, gravity: direction of gravity
export function stepSnow(snow: Snow, dt: number, accel: Vec3, gravity: Vec3) {
  const { slosh, sloshVelocity } = snow
  for (const k of ['x', 'y', 'z'] as const) {
    // The water lags behind the globe's acceleration, then sloshes back
    sloshVelocity[k] +=
      (-accel[k] * params.slosh - params.sloshStiffness * slosh[k] - params.sloshDamping * sloshVelocity[k]) * dt
    slosh[k] += sloshVelocity[k] * dt
  }
  const accelMagnitude = Math.hypot(accel.x, accel.y, accel.z)
  snow.turbulence = Math.min(
    1,
    snow.turbulence * Math.exp(-dt / params.turbulenceDecay) + accelMagnitude * params.turbulenceGain * dt,
  )
  snow.time += dt

  const { pos, vel, resting, sink, wake, radius, groundY } = snow
  const follow = 1 - Math.exp(-params.drag * dt)
  const swirl = params.swirl * snow.turbulence * 0.5
  const phase = snow.time * 0.5
  const invR2 = 1 / (radius * radius)

  for (let i = 0, j = 0; i < resting.length; i++, j += 3) {
    const calm = snow.turbulence < wake[i] * params.wakeThreshold
    if (resting[i]) {
      if (calm) continue
      resting[i] = 0
    }
    let x = pos[j]
    let y = pos[j + 1]
    let z = pos[j + 2]
    const sinkSpeed = sink[i] * params.sinkSpeed

    // Eddies = curl(χ·ψ) with χ = 1 − r²/R²: divergence-free and tangential at the glass
    // A field that points through the wall piles flakes up there, and they stay a clump forever.
    const sx = Math.sin(2.1 * y + phase) + Math.cos(1.7 * z - phase)
    const sy = Math.sin(1.9 * z + phase * 1.3) + Math.cos(2.3 * x + phase)
    const sz = Math.sin(2.2 * x - phase) + Math.cos(1.8 * y + phase * 0.7)
    const cx = -1.8 * Math.sin(1.8 * y + phase * 0.7) - 1.9 * Math.cos(1.9 * z + phase * 1.3)
    const cy = -1.7 * Math.sin(1.7 * z - phase) - 2.2 * Math.cos(2.2 * x - phase)
    const cz = -2.3 * Math.sin(2.3 * x + phase) - 2.1 * Math.cos(2.1 * y + phase)
    const chi = 1 - (x * x + y * y + z * z) * invR2
    const fx = sloshVelocity.x + swirl * (chi * cx - 2 * invR2 * (y * sz - z * sy)) + gravity.x * sinkSpeed
    const fy = sloshVelocity.y + swirl * (chi * cy - 2 * invR2 * (z * sx - x * sz)) + gravity.y * sinkSpeed
    const fz = sloshVelocity.z + swirl * (chi * cz - 2 * invR2 * (x * sy - y * sx)) + gravity.z * sinkSpeed

    vel[j] += (fx - vel[j]) * follow - accel.x * params.inertia * dt
    vel[j + 1] += (fy - vel[j + 1]) * follow - accel.y * params.inertia * dt
    vel[j + 2] += (fz - vel[j + 2]) * follow - accel.z * params.inertia * dt
    x += vel[j] * dt
    y += vel[j + 1] * dt
    z += vel[j + 2] * dt

    const r = Math.hypot(x, y, z)
    if (r > radius) {
      const nx = x / r
      const ny = y / r
      const nz = z / r
      x = nx * radius
      y = ny * radius
      z = nz * radius
      const vn = vel[j] * nx + vel[j + 1] * ny + vel[j + 2] * nz
      if (vn > 0) {
        // slide along the glass
        vel[j] -= vn * nx
        vel[j + 1] -= vn * ny
        vel[j + 2] -= vn * nz
      }
    }

    if (y < groundY) {
      y = groundY
      if (vel[j + 1] < 0) vel[j + 1] = 0
      if (calm) {
        resting[i] = 1
        vel[j] = vel[j + 1] = vel[j + 2] = 0
      }
    }

    pos[j] = x
    pos[j + 1] = y
    pos[j + 2] = z
  }
}
