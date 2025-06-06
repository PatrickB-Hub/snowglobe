import './styles.scss'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { createSnow, stepSnow, params } from './snow'
import { GLOBE_RADIUS, createGlobe, createContactShadow } from './globe'

const FLAKE_COUNT = matchMedia('(pointer: coarse)').matches ? 1500 : 3000
const SNOW_RADIUS = GLOBE_RADIUS * 0.96 // keeps flakes just inside the glass
const GROUND_Y = -0.5
const CANVAS_BLEED = 0.35 // extra canvas height above and below scene, relative to its height
const BACKGROUND = 0xeeedf3
const BAKED_BRIGHTNESS = 1.25 // a third of a stop lifts the baked interiors
const SHAKE_DURATION = 1.1 // in seconds
const MAX_TILT = 0.4 // in rad
const READOUT_INTERVAL = 150 // in ms
const DEFAULT_SINK_SPEED = params.sinkSpeed

const WORLDS = {
  hochzeit: {
    pedestalColor: 0xc9c1d5,
    flakeGeometry: () => new THREE.CircleGeometry(1, 5), // rose petals
    palette: [0xffffff, 0xfff1e4, 0xf7d0c8, 0xeeb0aa],
    note: 'A gentle nudge is all it takes. See where the currents go.',
  },
  festival: {
    pedestalColor: 0xd8cdbd,
    flakeGeometry: () => new THREE.PlaneGeometry(1.8, 1), // confetti
    palette: [0xff3d8b, 0xffb000, 0x22d3c5, 0x8b5cf6, 0xff6a2a, 0xfff06b, 0x3b82f6],
    note: 'A pocket-sized celebration. Give the confetti a little lift.',
  },
}
type World = keyof typeof WORLDS
const isWorld = (value: string | null | undefined): value is World => !!value && Object.hasOwn(WORLDS, value)

const requestedWorld = new URLSearchParams(location.search).get('world')
const initialWorld: World = isWorld(requestedWorld) ? requestedWorld : 'hochzeit'

// DOM

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const host = $('#scene')
const loadingStatus = $('#loading')
const experimentNote = $('#experiment-note')
const shakeButton = $<HTMLButtonElement>('#shake')
const pauseButton = $('#pause')
const settlingInput = $<HTMLInputElement>('#settling')
const settlingLabel = $('#settling-label')
const movingCount = $('#moving-count')
const motionState = $('#motion-state')
const energyBar = $('#energy')
const worldButtons = document.querySelectorAll<HTMLElement>('[data-world]')

// Renderer, camera and lighting

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
// The miniatures already contain baked, display-ready lighting. Neutral keeps
// their midtones and the pale backdrop bright when viewed through transmission.
renderer.toneMapping = THREE.NeutralToneMapping
renderer.setClearColor(BACKGROUND, 0)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(BACKGROUND)
scene.add(new THREE.HemisphereLight(0xf4f1ff, 0xaba1bc, 2))

scene.environmentIntensity = 0.65
scene.environmentRotation.y = Math.PI * 0.35
new RGBELoader().load(
  `${import.meta.env.BASE_URL}overcast_soil_puresky_1k.hdr`,
  (hdri) => {
    hdri.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromEquirectangular(hdri).texture
    pmrem.dispose()
    hdri.dispose()
  },
  undefined,
  (error) => {
    // Direct lighting keeps the miniature usable if the environment cannot load.
    console.warn('The sky reflection could not be loaded.', error)
  },
)

const sun = new THREE.DirectionalLight(0xffffff, 1.5)
sun.position.set(3, 5, 2)
const rim = new THREE.DirectionalLight(0xd6c8ff, 2)
rim.position.set(-3, 2, -2)
scene.add(sun, rim)

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
camera.position.set(0, 0.35, 4.9)
camera.zoom = 1.21 // how large the globe appears

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, -0.08, 0)
controls.update()
controls.saveState()
controls.enableZoom = false
controls.enablePan = false
controls.enableDamping = true
controls.minDistance = 3.5
controls.maxDistance = 8
controls.minPolarAngle = Math.PI * 0.3
controls.maxPolarAngle = Math.PI * 0.55

function resize() {
  const { width, height } = host.getBoundingClientRect()
  const aspect = width / height
  camera.aspect = aspect
  camera.fov = aspect < 1 ? Math.min(65, 35 / aspect) : 35
  const bleed = Math.round(height * CANVAS_BLEED)
  camera.setViewOffset(width, height, 0, -bleed, width, height + 2 * bleed)
  renderer.setSize(width, height + 2 * bleed)
  renderer.domElement.style.marginTop = `${-bleed}px`
}
resize()
new ResizeObserver(resize).observe(host)

// Globe

// Everything in this group moves when the globe is shaken.
const { group: globe, glass, pedestalMaterial, grabbable } = createGlobe()
scene.add(globe)
const shadow = createContactShadow()
scene.add(shadow)

// Flakes

// Opaque instances, so the glass's transmission pass renders them too
const flakes = new THREE.InstancedMesh(
  new THREE.BufferGeometry(),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide }),
  FLAKE_COUNT,
)
flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
flakes.frustumCulled = false
globe.add(flakes)

const flakeSpinAxis = Array.from({ length: FLAKE_COUNT }, () => new THREE.Vector3().randomDirection())
const flakeSpin = Float32Array.from({ length: FLAKE_COUNT }, () => Math.random() * Math.PI * 2)
const flakeSize = Float32Array.from({ length: FLAKE_COUNT }, () => 0.004 + Math.random() * 0.005)
const lyingFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
const flakeColor = new THREE.Color()
let snow = createSnow(FLAKE_COUNT, SNOW_RADIUS, GROUND_Y)

function applyWorldLook(world: World) {
  const { pedestalColor, flakeGeometry, palette, note } = WORLDS[world]
  pedestalMaterial.color.set(pedestalColor)
  flakes.geometry.dispose()
  flakes.geometry = flakeGeometry()
  for (let i = 0; i < FLAKE_COUNT; i++) flakes.setColorAt(i, flakeColor.set(palette[i % palette.length]))
  flakes.instanceColor!.needsUpdate = true
  experimentNote.textContent = note
}
applyWorldLook(initialWorld)

// Loading worlds

const ktx2Loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer)
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder)
const worldModels = new Map<World, THREE.Group>()
let currentModel: THREE.Group | undefined
let latestLoad = 0

async function loadWorldModel(world: World) {
  const gltf = await gltfLoader.loadAsync(`${import.meta.env.BASE_URL}${world}.glb`)
  const bakedMaterials = new Set<THREE.MeshBasicMaterial>()
  gltf.scene.traverse((object) => {
    if (/Sockel|Gravur/.test(object.name)) object.visible = false
    const { material } = object as THREE.Mesh
    if (material instanceof THREE.MeshBasicMaterial) bakedMaterials.add(material)
  })
  for (const material of bakedMaterials) material.color.multiplyScalar(BAKED_BRIGHTNESS)
  return gltf.scene
}

async function loadWorld(world: World) {
  const load = ++latestLoad
  loadingStatus.hidden = false
  loadingStatus.textContent = 'A little world is taking shape…'
  shakeButton.disabled = true
  try {
    if (!worldModels.has(world)) worldModels.set(world, await loadWorldModel(world))
    if (load !== latestLoad) return

    if (currentModel) globe.remove(currentModel)
    currentModel = worldModels.get(world)!
    globe.add(currentModel)
    applyWorldLook(world)
    worldButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.world === world)))
    const url = new URL(location.href)
    url.searchParams.set('world', world)
    history.replaceState(null, '', url)
    reset()
    loadingStatus.hidden = true
  } catch (error) {
    if (load !== latestLoad) return
    loadingStatus.textContent = 'This little world could not load. Select a world below to try again.'
    console.error(error)
  } finally {
    if (load === latestLoad) shakeButton.disabled = !currentModel
  }
}

// Interaction: the globe hangs on a spring that pulls towards the pointer (or back to rest)

const spring = { stiffness: 120, damping: 7, tilt: 0.12, maxOffset: 0.8 }
const target = new THREE.Vector3()
const velocity = new THREE.Vector3()
const accel = new THREE.Vector3()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const dragPlane = new THREE.Plane()
const grabOffset = new THREE.Vector3()
const hit = new THREE.Vector3()
let dragging = false
let paused = false
let shakeTimeLeft = 0

function aimRay(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
}

function grab(event: PointerEvent) {
  if (paused || !currentModel || event.button !== 0) return
  aimRay(event)
  const [first] = raycaster.intersectObjects(grabbable, false)
  if (!first) return
  dragging = true
  shakeTimeLeft = 0
  renderer.domElement.classList.add('dragging')
  renderer.domElement.setPointerCapture(event.pointerId)
  controls.enabled = false
  dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(hit), first.point)
  grabOffset.subVectors(first.point, globe.position)
}

function drag(event: PointerEvent) {
  if (!dragging) return
  aimRay(event)
  if (raycaster.ray.intersectPlane(dragPlane, hit)) {
    target.subVectors(hit, grabOffset).clampLength(0, spring.maxOffset)
  }
}

function release() {
  dragging = false
  renderer.domElement.classList.remove('dragging')
  controls.enabled = true
  target.set(0, 0, 0)
}

host.addEventListener('pointerdown', grab, { capture: true })
addEventListener('pointermove', drag)
addEventListener('pointerup', release)
addEventListener('pointercancel', release)
addEventListener('blur', release)
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') release()
})

// Animation loop

const inverseRotation = new THREE.Quaternion()
const localGravity = new THREE.Vector3()
const localAccel = new THREE.Vector3()
const flakeTransform = new THREE.Object3D()
let lastFrameTime = 0
let lastReadoutTime = 0

renderer.setAnimationLoop((time) => {
  const dt = paused ? 0 : Math.min((time - lastFrameTime) / 1000, 1 / 30)
  lastFrameTime = time

  if (shakeTimeLeft > 0 && !paused) {
    shakeTimeLeft = Math.max(0, shakeTimeLeft - dt)
    target.set(Math.sin(shakeTimeLeft * 24) * 0.5, Math.sin(shakeTimeLeft * 17) * 0.16, 0)
    if (!shakeTimeLeft) target.set(0, 0, 0)
  }

  accel.subVectors(target, globe.position).multiplyScalar(spring.stiffness).addScaledVector(velocity, -spring.damping)
  velocity.addScaledVector(accel, dt)
  globe.position.addScaledVector(velocity, dt)
  globe.rotation.set(
    THREE.MathUtils.clamp(velocity.z * spring.tilt, -MAX_TILT, MAX_TILT),
    0,
    THREE.MathUtils.clamp(-velocity.x * spring.tilt, -MAX_TILT, MAX_TILT),
  )

  const lift = Math.max(0, globe.position.y)
  shadow.position.x = globe.position.x
  shadow.position.z = globe.position.z
  shadow.scale.setScalar(1 + lift * 0.45)
  shadow.material.opacity = 1 / (1 + lift * 1.8)

  inverseRotation.copy(globe.quaternion).invert()
  localGravity.set(0, -1, 0).applyQuaternion(inverseRotation)
  localAccel.copy(accel).applyQuaternion(inverseRotation)
  stepSnow(snow, dt, localAccel, localGravity)
  updateFlakes(dt)

  if (time - lastReadoutTime > READOUT_INTERVAL) {
    lastReadoutTime = time
    updateReadout()
  }
  controls.update()
  renderer.render(scene, camera)
})

function updateFlakes(dt: number) {
  for (let i = 0; i < FLAKE_COUNT; i++) {
    flakeTransform.position.fromArray(snow.pos, i * 3)
    if (snow.resting[i]) {
      flakeTransform.quaternion.copy(lyingFlat)
      flakeTransform.position.y += 0.003 // avoid z-fighting with the ground
    } else {
      flakeTransform.quaternion.setFromAxisAngle(flakeSpinAxis[i], (flakeSpin[i] += dt * 2))
    }
    flakeTransform.scale.setScalar(flakeSize[i])
    flakeTransform.updateMatrix()
    flakes.setMatrixAt(i, flakeTransform.matrix)
  }
  flakes.instanceMatrix.needsUpdate = true
}

function updateReadout() {
  const moving = FLAKE_COUNT - snow.resting.reduce((sum, value) => sum + value, 0)
  movingCount.textContent = `${Math.round((moving / FLAKE_COUNT) * 100)}%`
  motionState.textContent = paused ? 'PAUSED' : snow.turbulence > 0.3 ? 'SWIRLING' : moving > 0 ? 'SETTLING' : 'AT REST'
  energyBar.style.transform = `scaleX(${snow.turbulence})`
}

// Controls

function setPaused(value: boolean) {
  paused = value
  pauseButton.setAttribute('aria-pressed', String(paused))
  pauseButton.textContent = paused ? '▷ Resume' : 'Ⅱ Pause'
  release()
}

function setSinkSpeed(speed: number) {
  params.sinkSpeed = speed
  settlingInput.value = String(speed)
  settlingLabel.textContent = speed < 0.06 ? 'FLOATY' : speed < 0.13 ? 'DREAMY' : 'GROUNDED'
}

function reset() {
  release()
  shakeTimeLeft = 0
  globe.position.set(0, 0, 0)
  globe.rotation.set(0, 0, 0)
  velocity.set(0, 0, 0)
  snow = createSnow(FLAKE_COUNT, SNOW_RADIUS, GROUND_Y)
  setSinkSpeed(DEFAULT_SINK_SPEED)
  setPaused(false)
}

$('#particle-count').textContent = FLAKE_COUNT.toLocaleString('en-US')
shakeButton.addEventListener('click', () => {
  setPaused(false)
  shakeTimeLeft = SHAKE_DURATION
  experimentNote.textContent = 'A little impulse, a thousand tiny journeys. Watch them settle.'
})
pauseButton.addEventListener('click', () => setPaused(!paused))
$('#reset').addEventListener('click', reset)
$('#camera-reset').addEventListener('click', () => controls.reset())
settlingInput.addEventListener('input', () => setSinkSpeed(Number(settlingInput.value)))
worldButtons.forEach((button) =>
  button.addEventListener('click', () => {
    if (isWorld(button.dataset.world)) loadWorld(button.dataset.world)
  }),
)
loadWorld(initialWorld)

// Debug panel (dev only, ?debug)

if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
  import('lil-gui').then(({ default: GUI }) => {
    const gui = new GUI({ title: 'Tuning' })
    if (innerWidth < 700) gui.close()
    const snowFolder = gui.addFolder('Snow')
    for (const key of Object.keys(params) as (keyof typeof params)[]) snowFolder.add(params, key, 0, params[key] * 4)
    const springFolder = gui.addFolder('Globe')
    for (const key of Object.keys(spring) as (keyof typeof spring)[]) springFolder.add(spring, key, 0, spring[key] * 4)
    const glassFolder = gui.addFolder('Glass')
    glassFolder.add(glass.material, 'thickness', 0, 3)
    glassFolder.add(glass.material, 'ior', 1, 2.3)
    glassFolder.add(glass.material, 'roughness', 0, 1)
    glassFolder.add(scene, 'environmentIntensity', 0, 3).name('Environment light')
  })
}
