import * as THREE from 'three'

export const GLOBE_RADIUS = 1 // build the Blender scenes at the same scale

const toProfile = (points: number[][]) => points.map(([r, y]) => new THREE.Vector2(r, y))

// Tiled data texture supplies roughness and microscopic relief
function createPorcelainTexture() {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const grain = ((Math.imul(i + 1, 1664525) ^ Math.imul(i + 17, 1013904223)) >>> 16) & 255
    data.set([grain, 185 + Math.round(grain * 0.18), 0, 255], i * 4)
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 3)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

// Glass, pedestal and brass trim. The pedestal colour is set per world
export function createGlobe() {
  const group = new THREE.Group()

  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 64, 32),
    new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.012, ior: 1.45, thickness: 0.06 }),
  )

  // The rounded profile gives the porcelain edge a highlight without another material
  const porcelain = createPorcelainTexture()
  const pedestalMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.38,
    metalness: 0,
    roughnessMap: porcelain,
    bumpMap: porcelain,
    bumpScale: 0.0007,
  })
  const pedestalProfile = toProfile([
    [0, -1.02],
    [0.83, -1.02],
    [0.89, -0.99],
    [0.9, -0.95],
    [0.9, -0.76],
    [0.87, -0.71],
    [0.79, -0.69],
    [0, -0.69],
  ])
  const pedestal = new THREE.Mesh(new THREE.LatheGeometry(pedestalProfile, 96), pedestalMaterial)

  const trimProfile = toProfile([
    [0.901, -0.009],
    [0.904, -0.007],
    [0.906, -0.004],
    [0.906, 0.004],
    [0.904, 0.007],
    [0.901, 0.009],
  ])
  const trim = new THREE.Mesh(
    new THREE.LatheGeometry(trimProfile, 96),
    new THREE.MeshStandardMaterial({ color: 0xd5c4ad, metalness: 0.8, roughness: 0.24 }),
  )
  trim.position.y = -0.94

  group.add(glass, pedestal, trim)
  return { group, glass, pedestalMaterial, grabbable: [glass, pedestal] }
}

// Soft contact shadow, independent of the baked miniature lighting
export function createContactShadow() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(72, 55, 93, 0.28)')
  gradient.addColorStop(0.45, 'rgba(72, 55, 93, 0.13)')
  gradient.addColorStop(1, 'rgba(72, 55, 93, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -1.03
  return shadow
}
