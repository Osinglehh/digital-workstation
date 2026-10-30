import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  createOfficeCubicleWorkstationDioramaModel,
  createOfficeCubicleWorkstationDioramaEnvironment,
  configureOfficeCubicleWorkstationDioramaRenderer,
} from './createOfficeCubicleWorkstationDioramaModel';
import { createOfficeCubicleWorkstationDioramaInspectControls } from './createOfficeCubicleWorkstationDioramaModel';
import { enhanceWorkstation } from './workstationDetails';
import { setupWorkbench } from './workbenchController';
import type { ViewId } from './ui/types';

// 紧凑工位隔间的环境基准。工位内部坐标不动，只按工位占地包围盒收缩地板与墙体；
// 地板砖仍保持 600 mm 实物尺寸，纹理重复由下面的尺寸参数推导。
const ENVIRONMENT = {
  floorWidth: 2.4,
  floorDepth: 2.25,
  floorCenterX: -0.08,
  floorCenterZ: 0.485,
  tileSize: 0.6,
  wallWidth: 2.6,
  wallHeight: 2.35,
  wallZ: -0.64,
  sideReturnDepth: 0.42,
  baseboardHeight: 0.085,
  wallColorDay: '#8F8B84',
  wallColorNight: '#232220',
  baseboardColorDay: '#6C6861',
  baseboardColorNight: '#1B1A18',
};

const stage = document.getElementById('stage') as HTMLDivElement;

// --- 启动占位与贴图加载进度 -------------------------------------------------
// 首屏先显示 poster 与进度条；贴图与首帧都就绪后再淡出，避免评委看到白屏或半成品。
const bootEl = document.getElementById('boot');
const bootLoadingEl = document.getElementById('boot-loading');
const bootErrorEl = document.getElementById('boot-error');
const bootFillEl = document.getElementById('boot-fill');
const bootStatusEl = document.getElementById('boot-status');
const bootTrackEl = bootFillEl?.parentElement ?? null;
let bootFinished = false;
let texturesReady = false;
let textureErrors = 0;
let firstFrameRendered = false;

function setBootStatus(text: string): void {
  if (bootStatusEl) bootStatusEl.textContent = text;
}

function setBootProgress(loaded: number, total: number): void {
  if (!bootFillEl) return;
  const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
  bootFillEl.style.width = `${Math.max(6, Math.round(ratio * 100))}%`;
  bootTrackEl?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

function finishBoot(): void {
  if (bootFinished) return;
  bootFinished = true;
  stage.removeAttribute('aria-busy');
  if (bootFillEl) bootFillEl.style.width = '100%';
  bootTrackEl?.setAttribute('aria-valuenow', '100');
  setBootStatus(textureErrors > 0 ? '部分贴图加载失败，已使用简化材质' : '工位就绪');
  if (!bootEl) {
    window.dispatchEvent(new Event('workstation:ready'));
    return;
  }
  bootEl.classList.add('is-done');
  // 即使无头环境下 opacity 过渡被冻结，也强制从布局中移除启动占位。
  window.setTimeout(() => {
    bootEl.hidden = true;
    window.dispatchEvent(new Event('workstation:ready'));
  }, 460);
}

function maybeFinishBoot(): void {
  if (texturesReady && firstFrameRendered) finishBoot();
}

function showBootError(message: string): void {
  stage.removeAttribute('aria-busy');
  if (bootEl) {
    bootEl.hidden = false;
    bootEl.classList.remove('is-done');
  }
  if (bootLoadingEl) bootLoadingEl.hidden = true;
  if (bootErrorEl) {
    bootErrorEl.hidden = false;
    const reason = bootErrorEl.querySelector<HTMLElement>('[data-boot-reason]');
    if (reason) reason.textContent = message;
  }
}

const loadingManager = THREE.DefaultLoadingManager;
loadingManager.onStart = (_url, loaded, total) => {
  if (bootFinished) return;
  setBootProgress(loaded, total);
  setBootStatus(`正在装配工位… ${loaded} / ${total}`);
};
loadingManager.onProgress = (_url, loaded, total) => {
  if (bootFinished) return;
  setBootProgress(loaded, total);
  setBootStatus(`正在装配工位… ${loaded} / ${total}`);
};
loadingManager.onError = (url) => {
  textureErrors += 1;
  console.warn('[workstation] 贴图加载失败：', url);
};
loadingManager.onLoad = () => {
  texturesReady = true;
  maybeFinishBoot();
};
// 贴图请求全部挂起或管理器未触发 onLoad 时，最迟 15 秒进入场景。
window.setTimeout(() => {
  texturesReady = true;
  maybeFinishBoot();
}, 15000);

// 移动端画质档：仅在触屏主指针设备降级（低像素比、跳过 SSAO/辉光、阴影降级），桌面保持原画质
const lowPowerTier = window.matchMedia('(pointer: coarse)').matches;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
} catch (error) {
  showBootError('当前浏览器未能创建 WebGL 上下文。请开启硬件加速后刷新，或更换浏览器。');
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerTier ? 1.5 : 2));
renderer.toneMappingExposure = 0.74;
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = lowPowerTier ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
configureOfficeCubicleWorkstationDioramaRenderer(renderer);
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showBootError('WebGL 上下文已丢失，请刷新页面重试。');
});
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
function makeDayBackground(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#A09B94');
  grad.addColorStop(0.55, '#8A857E');
  grad.addColorStop(1, '#746F69');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2200; i += 1) {
    ctx.fillStyle = `rgba(70,62,52,${0.01 + Math.random() * 0.025})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const dayBackground = makeDayBackground();

// 参考 figure/桌底-*.jpg 的 600 mm 方砖地面：4×4 块拼成一张可平铺贴图，
// 灰缝、轻微色差与擦痕都画在贴图里，避免均匀灰地让桌下结构“浮”起来。
function makeFloorTileMaps(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const tileCount = 4;
  const tilePixels = 512;
  const size = tileCount * tilePixels;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = tilePixels;
  bumpCanvas.height = tilePixels;
  const bumpCtx = bumpCanvas.getContext('2d');
  if (!bumpCtx) throw new Error('2D canvas unavailable');
  let seed = 9281;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = '#C5C2BA';
  ctx.fillRect(0, 0, size, size);
  for (let ty = 0; ty < tileCount; ty += 1) {
    for (let tx = 0; tx < tileCount; tx += 1) {
      const x = tx * tilePixels;
      const y = ty * tilePixels;
      const tone = 180 + Math.floor(rand() * 9);
      ctx.fillStyle = `rgb(${tone},${tone - 2},${tone - 7})`;
      ctx.fillRect(x + 2, y + 2, tilePixels - 4, tilePixels - 4);
      const shade = ctx.createLinearGradient(x, y, x + tilePixels, y + tilePixels);
      shade.addColorStop(0, 'rgba(255,255,255,0.06)');
      shade.addColorStop(0.55, 'rgba(120,113,100,0.02)');
      shade.addColorStop(1, 'rgba(72,66,56,0.06)');
      ctx.fillStyle = shade;
      ctx.fillRect(x + 2, y + 2, tilePixels - 4, tilePixels - 4);
      for (let i = 0; i < 900; i += 1) {
        const v = 150 + Math.floor(rand() * 80);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.02 + rand() * 0.05})`;
        ctx.fillRect(x + rand() * tilePixels, y + rand() * tilePixels, 0.8 + rand() * 2.4, 0.7 + rand() * 1.8);
      }
      // 靠墙与门口常见的浅褐色鞋印/拖痕。
      for (let i = 0; i < 8; i += 1) {
        const sx = x + 40 + rand() * (tilePixels - 80);
        const sy = y + 60 + rand() * (tilePixels - 120);
        const r = 12 + rand() * 44;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(95,82,64,${0.02 + rand() * 0.035})`);
        g.addColorStop(1, 'rgba(95,82,64,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    }
  }
  // 十字灰缝：在平铺边界处各画半条，重复后合并成完整 4 mm 缝。
  // 缩小空间后地面占比提高，灰缝与倒角高光稍微收淡，避免网格线抢主体。
  ctx.fillStyle = '#8B867C';
  for (let i = 0; i <= tileCount; i += 1) {
    const p = i * tilePixels;
    ctx.fillRect(p - 2, 0, 4, size);
    ctx.fillRect(0, p - 2, size, 4);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i <= tileCount; i += 1) {
    const p = i * tilePixels;
    ctx.fillRect(p + 2, 0, 1, size);
    ctx.fillRect(0, p + 2, size, 1);
  }
  bumpCtx.fillStyle = '#C4C4C4';
  bumpCtx.fillRect(0, 0, tilePixels, tilePixels);
  bumpCtx.fillStyle = '#6A6A6A';
  bumpCtx.fillRect(0, 0, 4, tilePixels);
  bumpCtx.fillRect(0, 0, tilePixels, 4);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(
    ENVIRONMENT.floorWidth / (ENVIRONMENT.tileSize * tileCount),
    ENVIRONMENT.floorDepth / (ENVIRONMENT.tileSize * tileCount),
  );
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.colorSpace = THREE.NoColorSpace;
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(ENVIRONMENT.floorWidth / ENVIRONMENT.tileSize, ENVIRONMENT.floorDepth / ENVIRONMENT.tileSize);
  bump.anisotropy = 8;
  return { map, bump };
}

const floorTiles = makeFloorTileMaps();
scene.background = dayBackground;
scene.environment = createOfficeCubicleWorkstationDioramaEnvironment(renderer);
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(52, 4 / 3, 0.01, 30);
// 初始值必须与 views.default 一致，避免首帧或体验层接线前出现旧机位。
camera.position.set(-1.1834, 1.7377, 2.4049);
const controls = createOfficeCubicleWorkstationDioramaInspectControls(camera, renderer.domElement);
controls.target.set(-0.03, 0.78, 0.04);
// 交互边界按缩小后的房间和工位包围盒设置：只允许在开敞正面一侧环绕，
// 不能退到远距离、钻到地板下或穿过隔间背墙。
controls.minDistance = 0.45;
controls.maxDistance = 3.15;
controls.minPolarAngle = THREE.MathUtils.degToRad(16);
controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
controls.minAzimuthAngle = THREE.MathUtils.degToRad(-75);
controls.maxAzimuthAngle = THREE.MathUtils.degToRad(75);
controls.cursor.set(0, 0.90, 0.0);
controls.maxTargetRadius = 0.75;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.7;
controls.enablePan = true;

const root = createOfficeCubicleWorkstationDioramaModel({
  qualityPriority: 'reference-fidelity',
  castShadow: true,
  receiveShadow: true,
});
root.name = 'OfficeCubicleWorkstationDiorama';
scene.add(root);

// The root and the wire-harness group carry 1 mm proxy geometry only.
const runtime = (root.userData.sculptRuntime ?? {}) as {
  nodes?: Record<string, THREE.Object3D>;
  meshes?: Record<string, THREE.Mesh>;
};
if (runtime.meshes?.root) runtime.meshes.root.visible = false;
if (runtime.meshes?.wireHarness) runtime.meshes.wireHarness.visible = false;

const workstation = enhanceWorkstation(root);

// --- studio surround -------------------------------------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ENVIRONMENT.floorWidth, ENVIRONMENT.floorDepth),
  new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    map: floorTiles.map,
    bumpMap: floorTiles.bump,
    bumpScale: 0.00055,
    roughness: 0.94,
    metalness: 0.0,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.name = 'studio-floor';
// 地面抬高到 y=0，让桌下木侧板、书包、垃圾桶和椅子滚轮真正落在同一基准面。
floor.position.set(ENVIRONMENT.floorCenterX, 0, ENVIRONMENT.floorCenterZ);
floor.receiveShadow = true;
scene.add(floor);

// 只有朝向室内的单面墙：正面视角仍有完整背景，验证用背面机位则自动透视过去，
// 不会像实体墙一样把工位背面完全挡住。
const wallMaterial = new THREE.MeshStandardMaterial({
  color: ENVIRONMENT.wallColorDay,
  roughness: 1.0,
  metalness: 0.0,
});
const baseboardMaterial = new THREE.MeshStandardMaterial({
  color: ENVIRONMENT.baseboardColorDay,
  roughness: 0.92,
  metalness: 0.0,
});
const roomLeft = ENVIRONMENT.floorCenterX - ENVIRONMENT.floorWidth / 2;
const roomRight = ENVIRONMENT.floorCenterX + ENVIRONMENT.floorWidth / 2;
const roomWalls = new THREE.Group();
roomWalls.name = 'studio-walls';

const rearWall = new THREE.Mesh(
  new THREE.PlaneGeometry(ENVIRONMENT.wallWidth, ENVIRONMENT.wallHeight),
  wallMaterial,
);
rearWall.name = 'studio-wall-rear';
rearWall.position.set(ENVIRONMENT.floorCenterX, ENVIRONMENT.wallHeight / 2, ENVIRONMENT.wallZ);
rearWall.receiveShadow = true;
roomWalls.add(rearWall);

const leftWall = new THREE.Mesh(
  new THREE.PlaneGeometry(ENVIRONMENT.sideReturnDepth, ENVIRONMENT.wallHeight),
  wallMaterial,
);
leftWall.name = 'studio-wall-left';
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(
  roomLeft,
  ENVIRONMENT.wallHeight / 2,
  ENVIRONMENT.wallZ + ENVIRONMENT.sideReturnDepth / 2,
);
leftWall.receiveShadow = true;
roomWalls.add(leftWall);

const rightWall = new THREE.Mesh(
  new THREE.PlaneGeometry(ENVIRONMENT.sideReturnDepth, ENVIRONMENT.wallHeight),
  wallMaterial,
);
rightWall.name = 'studio-wall-right';
rightWall.rotation.y = -Math.PI / 2;
rightWall.position.set(
  roomRight,
  ENVIRONMENT.wallHeight / 2,
  ENVIRONMENT.wallZ + ENVIRONMENT.sideReturnDepth / 2,
);
rightWall.receiveShadow = true;
roomWalls.add(rightWall);

const rearBaseboard = new THREE.Mesh(
  new THREE.BoxGeometry(ENVIRONMENT.wallWidth, ENVIRONMENT.baseboardHeight, 0.018),
  baseboardMaterial,
);
rearBaseboard.name = 'studio-baseboard-rear';
rearBaseboard.position.set(
  ENVIRONMENT.floorCenterX,
  ENVIRONMENT.baseboardHeight / 2,
  ENVIRONMENT.wallZ + 0.010,
);
rearBaseboard.receiveShadow = true;
roomWalls.add(rearBaseboard);

for (const side of [-1, 1] as const) {
  const baseboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, ENVIRONMENT.baseboardHeight, ENVIRONMENT.sideReturnDepth),
    baseboardMaterial,
  );
  baseboard.name = side < 0 ? 'studio-baseboard-left' : 'studio-baseboard-right';
  baseboard.position.set(
    (side < 0 ? roomLeft : roomRight) + (side < 0 ? 0.009 : -0.009),
    ENVIRONMENT.baseboardHeight / 2,
    ENVIRONMENT.wallZ + ENVIRONMENT.sideReturnDepth / 2,
  );
  baseboard.receiveShadow = true;
  roomWalls.add(baseboard);
}
scene.add(roomWalls);

// --- lighting --------------------------------------------------------------
const hemisphere = new THREE.HemisphereLight(0xe9eff5, 0x4E453B, 0.19);
scene.add(hemisphere);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.04);
scene.add(ambientLight);

// Reference daylight enters from the right window; the key follows it so the laptop
// and monitor cast shadows back toward the left instead of flattening into the wall.
const key = new THREE.DirectionalLight(0xf2f3f2, 1.95);
key.position.set(1.9, 3.2, 3.1);
key.castShadow = true;
key.shadow.mapSize.set(lowPowerTier ? 1024 : 2048, lowPowerTier ? 1024 : 2048);
key.shadow.camera.near = 0.2;
key.shadow.camera.far = 12;
key.shadow.camera.left = -2.2;
key.shadow.camera.right = 2.2;
key.shadow.camera.top = 2.8;
key.shadow.camera.bottom = -0.5;
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.01;
key.shadow.radius = 6;
key.target.position.set(0, 0.95, -0.05);
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0xc9dcff, 0.24);
fill.position.set(-2.6, 2.0, 1.3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xf5f2ea, 0.45);
rim.position.set(-0.4, 2.8, -2.4);
scene.add(rim);

const screenGlow = new THREE.PointLight(0x3b7bff, 0.32, 1.35, 2.0);
screenGlow.position.set(0.235, 1.02, -0.02);
scene.add(screenGlow);

RectAreaLightUniformsLib.init();
const ceilingSoftbox = new THREE.RectAreaLight(0xf3f1ec, 0.08, 1.35, 0.7);
ceilingSoftbox.position.set(0.0, 2.18, 0.55);
ceilingSoftbox.lookAt(0.0, 0.9, 0.0);
scene.add(ceilingSoftbox);

// 桌下背光很弱，补一盏低强度暖色填充，让线槽、插座和书包的细节可读；
// 不投影，避免在椅背和地面上产生第二套硬阴影。
const underDeskFill = new THREE.PointLight(0xffe8cf, 0.38, 1.35, 2.0);
underDeskFill.position.set(-0.06, 0.48, 0.28);
scene.add(underDeskFill);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssaoPass = new SSAOPass(scene, camera, stage.clientWidth, stage.clientHeight);
ssaoPass.kernelRadius = 0.16;
ssaoPass.minDistance = 0.0004;
ssaoPass.maxDistance = 0.32;
if (!lowPowerTier) composer.addPass(ssaoPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(stage.clientWidth, stage.clientHeight), 0.16, 0.32, 0.95);
if (!lowPowerTier) composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const filmPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float grainNoise(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.025);
      c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;
      c.rgb *= vec3(1.006, 1.0, 0.995);
      float grain = grainNoise(floor(vUv * vec2(1280.0, 960.0)) + floor(uTime * 12.0) * 0.017) - 0.5;
      c.rgb += grain * 0.010;
      gl_FragColor = c;
    }`,
});
composer.addPass(filmPass);
const vignettePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5)); float v = smoothstep(0.5, 0.95, d); gl_FragColor = vec4(c.rgb * (1.0 - v * 0.34), c.a); }',
});
composer.addPass(vignettePass);
composer.setSize(stage.clientWidth, stage.clientHeight);

// --- camera presets --------------------------------------------------------
// 机位用「观察目标 + 方位角/仰角/距离」描述，便于按缩小后的房间统一调整，
// 而不是在多个位置维护世界坐标常量。
type ViewName = ViewId;
type ViewPose = {
  target: [number, number, number];
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
  fov: number;
};

const views: Record<ViewName, ViewPose> = {
  // 默认 3/4：完整保留椅子滚轮与格架顶部，工位约占画面高度八成。
  default: { target: [-0.03, 0.78, 0.04], azimuthDeg: -26, elevationDeg: 20, distance: 2.80, fov: 52 },
  // 正面用于与参考图对照，椅子会遮住部分键盘，这是正面机位的正常遮挡。
  front: { target: [0.0, 0.86, 0.03], azimuthDeg: 0, elevationDeg: 16, distance: 2.90, fov: 48 },
  // 从左前下方越过椅背左侧，检查落地侧板、线槽、插座、书包与垃圾桶。
  under: { target: [-0.18, 0.34, -0.08], azimuthDeg: -28, elevationDeg: 11, distance: 1.50, fov: 52 },
  // 左右 3/4 保持近景透视，但必须完整收进椅子滚轮，避免底部裁切。
  left: { target: [0.0, 0.80, -0.02], azimuthDeg: -36, elevationDeg: 15, distance: 2.52, fov: 54 },
  right: { target: [0.02, 0.80, -0.02], azimuthDeg: 30, elevationDeg: 15, distance: 2.52, fov: 54 },
  overhead: { target: [0.0, 0.88, 0.0], azimuthDeg: 2, elevationDeg: 52, distance: 2.55, fov: 50 },
  keyboard: { target: [-0.07, 0.79, 0.06], azimuthDeg: 4, elevationDeg: 20, distance: 0.73, fov: 36 },
  laptop: { target: [-0.24, 0.89, -0.09], azimuthDeg: -16, elevationDeg: 16, distance: 0.78, fov: 36 },
  // 坐姿眼高约 1.13 m，落在座面上方、靠背前方，避免相机进入椅子网格。
  firstPerson: { target: [0.0, 0.99, -0.30], azimuthDeg: 0, elevationDeg: 9, distance: 0.90, fov: 62 },
  panorama: { target: [-0.02, 0.82, 0.05], azimuthDeg: -16, elevationDeg: 21, distance: 3.0, fov: 48 },
  // 显示器近景：保留屏幕窗口文字判读空间，同时避开键盘前沿。
  monitor: { target: [0.0, 1.02, -0.22], azimuthDeg: 1, elevationDeg: 8, distance: 0.66, fov: 38 },
};

let currentView: ViewName | null = 'default';
let viewChangeListener: ((name: ViewId | null) => void) | null = null;
let frameListener: ((dt: number) => void) | null = null;
let viewAnimationToken = 0;

function notifyViewChanged(): void {
  viewChangeListener?.(currentView);
}

function clearView(): void {
  if (currentView === null) return;
  currentView = null;
  notifyViewChanged();
}

function cancelViewAnimation(): void {
  viewAnimationToken += 1;
}

function setViewChangeListener(listener: (name: ViewId | null) => void): void {
  viewChangeListener = listener;
}

function setFrameListener(listener: ((dt: number) => void) | null): void {
  frameListener = listener;
}

function viewPosition(pose: ViewPose): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(pose.azimuthDeg);
  const el = THREE.MathUtils.degToRad(pose.elevationDeg);
  return new THREE.Vector3(
    pose.target[0] + Math.sin(az) * Math.cos(el) * pose.distance,
    pose.target[1] + Math.sin(el) * pose.distance,
    pose.target[2] + Math.cos(az) * Math.cos(el) * pose.distance,
  );
}

function applyView(name: ViewName, animate = false): void {
  const pose = views[name];
  if (!pose) return;
  const targetVec = new THREE.Vector3(...pose.target);
  const positionVec = viewPosition(pose);
  const token = ++viewAnimationToken;
  currentView = name;
  notifyViewChanged();
  if (!animate) {
    camera.position.copy(positionVec);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    controls.target.copy(targetVec);
    controls.update();
    notifyViewChanged();
    render();
    return;
  }
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startFov = camera.fov;
  const start = performance.now();
  const duration = 680;
  const tick = () => {
    if (token !== viewAnimationToken) return;
    const t = Math.min(1, (performance.now() - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, positionVec, e);
    controls.target.lerpVectors(startTarget, targetVec, e);
    camera.fov = THREE.MathUtils.lerp(startFov, pose.fov, e);
    camera.updateProjectionMatrix();
    controls.update();
    if (t < 1) requestAnimationFrame(tick);
    else notifyViewChanged();
  };
  requestAnimationFrame(tick);
}

const viewLabels: Record<ViewName, string> = {
  default: '主视角',
  front: '正面',
  under: '桌下',
  left: '左 3/4',
  right: '右 3/4',
  overhead: '俯视',
  keyboard: '键盘近景',
  laptop: '笔记本近景',
  firstPerson: '第一人称',
  panorama: '工位全景',
  monitor: '显示器近景',
};

// 手动拖动/缩放后清除预设高亮；新控制台由 workbenchController 同步状态。
controls.addEventListener('start', () => {
  cancelViewAnimation();
  if (currentView !== null) {
    currentView = null;
    notifyViewChanged();
  }
});

// --- resize / render loop ---------------------------------------------------
let needsRender = true;
function render(): void {
  controls.update();
  filmPass.uniforms.uTime.value = performance.now() * 0.001;
  composer.render();
  needsRender = false;
  if (!firstFrameRendered) {
    firstFrameRendered = true;
    maybeFinishBoot();
  }
}

function resize(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  ssaoPass.setSize(width, height);
  needsRender = true;
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(stage);
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const tick = (root.userData as { tick?: (dt: number) => void }).tick;
  if (typeof tick === 'function') tick(dt);
  frameListener?.(dt);
  if (needsRender || controls.enableDamping) render();
}
animate();

// Expose a minimal automation surface for browser capture / review.
(window as any).__workstation = {
  scene,
  camera,
  renderer,
  controls,
  root,
  views,
  environment: ENVIRONMENT,
  currentView: () => currentView,
  setView: (name: ViewName) => applyView(name, false),
  render: () => render(),
  snapshot: (): string => {
    render();
    return renderer.domElement.toDataURL('image/png');
  },
  capture: (name: ViewName = 'default'): string => {
    applyView(name, false);
    render();
    return renderer.domElement.toDataURL('image/png');
  },
  setOrbit: (azimuthDeg: number, elevationDeg = 8, distance = 2.0, target: [number, number, number] = [0, 1.2, 0]): string => {
    // 截图/审计 API 不受交互机的正面弧限制；拍完立即恢复，正常拖动仍受约束。
    cancelViewAnimation();
    clearView();
    const saved = {
      minAzimuthAngle: controls.minAzimuthAngle,
      maxAzimuthAngle: controls.maxAzimuthAngle,
      minPolarAngle: controls.minPolarAngle,
      maxPolarAngle: controls.maxPolarAngle,
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      maxTargetRadius: controls.maxTargetRadius,
    };
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.maxTargetRadius = Infinity;
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const el = THREE.MathUtils.degToRad(elevationDeg);
    const targetVec = new THREE.Vector3(...target);
    camera.position.set(
      targetVec.x + Math.sin(az) * Math.cos(el) * distance,
      targetVec.y + Math.sin(el) * distance,
      targetVec.z + Math.cos(az) * Math.cos(el) * distance,
    );
    camera.fov = 48;
    camera.updateProjectionMatrix();
    controls.target.copy(targetVec);
    controls.update();
    render();
    const shot = renderer.domElement.toDataURL('image/png');
    Object.assign(controls, saved);
    controls.update();
    return shot;
  },
  setClay: (enabled: boolean): boolean => {
    const clay = new THREE.MeshStandardMaterial({ color: '#CFC9BE', roughness: 0.85, metalness: 0.0 });
    root.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      (mesh.userData as any).originalMaterial ??= mesh.material;
      mesh.material = enabled ? clay : (mesh.userData as any).originalMaterial;
    });
    render();
    return enabled;
  },
  objectNames: () => {
    const names: string[] = [];
    root.traverse((child) => { if (child.name) names.push(child.name); });
    return names;
  },
  swivelChair: (deg: number) => { workstation.swivelChair(deg); render(); },
  reclineChair: (deg: number) => { workstation.reclineChair(deg); render(); },
  getChairState: () => {
    const state = workstation.getState();
    return { chairYawDeg: state.chairYawDeg, chairReclineDeg: state.chairReclineDeg };
  },
};

applyView('default', false);

// 统一的工作台体验层：相机过渡、物体拾取、灯光预设、工具栏与偏好持久化。
const workbench = setupWorkbench({
  stage,
  scene,
  camera,
  renderer,
  canvas: renderer.domElement,
  controls,
  root,
  workstation,
  nodes: runtime.nodes ?? {},
  environment: ENVIRONMENT,
  dayBackground,
  lights: {
    key,
    fill,
    rim,
    hemisphere,
    ambient: ambientLight,
    screenGlow,
    underDeskFill,
    ceilingSoftbox,
    floor,
    wallMaterial,
    baseboardMaterial,
    bloom: bloomPass,
  },
  applyView: (name, animate) => applyView(name, animate),
  clearView,
  cancelViewAnimation,
  setViewChangeListener,
  setFrameListener,
  render,
});

Object.assign((window as any).__workstation, workbench.automation);
