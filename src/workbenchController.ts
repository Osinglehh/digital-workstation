import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ControlPanel } from './ui/controlPanel';
import {
  RGB_MODE_LABELS,
  SCENE_LABELS,
  SCREEN_CONTENT_LABELS,
} from './ui/types';
import type {
  ActiveSceneId,
  ControlCallbacks,
  DecorOption,
  IconName,
  LightingState,
  ObjectAction,
  ObjectChoiceGroup,
  ObjectMeta,
  ObjectSummary,
  RgbMode,
  SceneId,
  ScreenContent,
  ShortcutHint,
  ShowcaseUiState,
  UiState,
  UiTheme,
  ViewId,
} from './ui/types';
import { ShowcaseController } from './showcase/showcaseController';
import type { ShowcaseHost } from './showcase/showcaseController';
import type { CameraPose } from './showcase/showcaseTimeline';
import { smootherstep } from './showcase/showcaseTimeline';
import type { WorkstationAnimationApi } from './workstationDetails';

export type WorkbenchLightRig = {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  screenGlow: THREE.PointLight;
  underDeskFill: THREE.PointLight;
  ceilingSoftbox: THREE.RectAreaLight;
  floor: THREE.Mesh;
  wallMaterial: THREE.MeshStandardMaterial;
  baseboardMaterial: THREE.MeshStandardMaterial;
  bloom: UnrealBloomPass;
};

export type WorkbenchDeps = {
  stage: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  controls: OrbitControls;
  root: THREE.Object3D;
  workstation: WorkstationAnimationApi;
  nodes: Record<string, THREE.Object3D>;
  environment: {
    wallColorDay: string;
    wallColorNight: string;
    baseboardColorDay: string;
    baseboardColorNight: string;
  };
  dayBackground: THREE.Texture;
  lights: WorkbenchLightRig;
  applyView: (name: ViewId, animate?: boolean) => void;
  clearView: () => void;
  cancelViewAnimation: () => void;
  setViewChangeListener: (listener: (name: ViewId | null) => void) => void;
  setFrameListener: (listener: ((dt: number) => void) | null) => void;
  render: () => void;
};

export type WorkbenchAutomation = {
  setScene: (id: SceneId) => void;
  setScreenPower: (on: boolean) => void;
  setScreenContent: (content: ScreenContent) => void;
  setKeyboardRgb: (mode: RgbMode) => void;
  setKeyboardRgbColor: (color: string) => void;
  setLighting: (patch: Partial<LightingState>) => void;
  getUiState: () => UiState;
  selectObject: (id: string | null) => void;
  focusObject: (id: string) => void;
  toggleAutoOrbit: () => void;
  showcase: {
    start: () => void;
    pause: () => void;
    resume: () => void;
    togglePause: () => void;
    next: () => void;
    restart: () => void;
    exit: () => void;
    seek: (seconds: number) => void;
    setUiHidden: (hidden: boolean) => void;
    toggleUiHidden: () => void;
    getState: () => ShowcaseUiState & {
      active: boolean;
      chapterStart: number;
      nextChapterStart: number | null;
    };
    isActive: () => boolean;
  };
};

const VIEW_ORDER: ViewId[] = [
  'default', 'front', 'left', 'right', 'overhead', 'under',
  'firstPerson', 'keyboard', 'monitor', 'laptop', 'panorama',
];
const VIEW_LABELS: Record<ViewId, string> = {
  default: '主视角',
  front: '正面',
  under: '桌下',
  left: '左 3/4',
  right: '右 3/4',
  overhead: '俯视',
  keyboard: '键盘近景',
  laptop: '笔记本近景',
  firstPerson: '坐姿视角',
  panorama: '工位全景',
  monitor: '显示器近景',
};
const VIEW_ICONS: Record<ViewId, IconName> = {
  default: 'view',
  front: 'eye',
  under: 'down',
  left: 'left',
  right: 'right',
  overhead: 'grid',
  keyboard: 'keyboard',
  laptop: 'laptop',
  firstPerson: 'seat',
  panorama: 'eye',
  monitor: 'monitor',
};
const VIEW_TIPS: Record<ViewId, string> = {
  default: '初始 3/4 视角，同时看到书架、桌面与椅子',
  front: '原有正面构图，椅子会遮住部分键盘',
  under: '低机位检查桌下结构、书包与插座',
  left: '从左前方观察桌面陈设',
  right: '从右前方观察双屏与鼠标垫',
  overhead: '俯视桌面布局',
  keyboard: '贴近观察 98 键键盘与 RGB',
  laptop: '查看耀世 16 Ultra 的键盘面与屏幕',
  firstPerson: '模拟坐在工位前的第一人称视线',
  panorama: '更远距离的完整工位全景',
  monitor: '查看显示器屏幕内容',
};

const RGB_COLORS = [
  { value: '#2BD8FF', label: '青' },
  { value: '#4C7DFF', label: '蓝' },
  { value: '#B06CFF', label: '紫' },
  { value: '#FFD9A0', label: '暖白' },
];

const TIDY_DECOR = new Set(['mug', 'bottle', 'desk-still-life']);

type SceneBase = {
  key: number;
  keyColor: string;
  fill: number;
  rim: number;
  hemi: number;
  ambient: number;
  softbox: number;
  screenGlow: number;
  underFill: number;
  exposure: number;
  environment: number;
  bloom: number;
  background: 'day' | 'solid';
  backgroundColor?: string;
  backgroundIntensity: number;
  wall: string;
  baseboard: string;
  floor: string;
  theme: UiTheme;
  screenGlowColor: string;
  underFillColor: string;
  rgbMode: RgbMode;
  rgbColor: string;
  screenContent: ScreenContent;
  screenPower: boolean;
};

type ViewTween = {
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  fromFov: number;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toFov: number;
  start: number;
  duration: number;
  onComplete?: () => void;
};

type ObjectDefinition = {
  id: string;
  label: string;
  icon: IconName;
  description: string;
};

const OBJECT_DEFINITIONS: Record<string, ObjectDefinition> = {
  monitor: { id: 'monitor', label: '显示器', icon: 'monitor', description: 'AOC 23.8 英寸 · 双屏主显示' },
  laptop: { id: 'laptop', label: '笔记本', icon: 'laptop', description: '耀世 16 Ultra · 双轴铰链开合' },
  keyboard: { id: 'keyboard', label: '键盘', icon: 'keyboard', description: '98 键楔形键盘 · RGB 灯效' },
  mouse: { id: 'mouse', label: '鼠标', icon: 'mouse', description: '英菲克无线鼠标 · 滚轮可动' },
  chair: { id: 'chair', label: '椅子', icon: 'chair', description: '网布人体工学椅 · 旋转与后仰' },
  mug: { id: 'mug', label: '茶杯', icon: 'cup', description: '玻璃茶杯 · 木盖与蒸汽' },
  bottle: { id: 'bottle', label: '水壶', icon: 'bottle', description: 'UZSPACE 750 ml · 右侧挂钩' },
  shelf: { id: 'shelf', label: '书架', icon: 'book', description: '桌顶格架 · 书籍与陈设' },
  backpack: { id: 'backpack', label: '书包', icon: 'backpack', description: '酒红印花书包 · 左侧板旁' },
  wastebin: { id: 'wastebin', label: '垃圾桶', icon: 'trash', description: '白色冲孔垃圾桶 · 绿色垃圾袋' },
};

const OBJECT_SUMMARIES: ObjectSummary[] = Object.values(OBJECT_DEFINITIONS).map((def) => ({
  id: def.id,
  label: def.label,
  icon: def.icon,
}));

const DECOR_OPTIONS: DecorOption[] = [
  { id: 'mug', label: '茶杯', icon: 'cup' },
  { id: 'bottle', label: '水壶', icon: 'bottle' },
  { id: 'backpack', label: '书包', icon: 'backpack' },
  { id: 'wastebin', label: '垃圾桶', icon: 'trash' },
  { id: 'desk-still-life', label: '纸品笔袋', icon: 'book' },
  { id: 'shelf-decor', label: '架上摆件', icon: 'box' },
];

const STORAGE_KEY = 'workstation-ui-v1';
const VALID_VIEWS = new Set<string>(VIEW_ORDER);
const VALID_SCENES = new Set<string>(['day', 'night', 'focus', 'rgb']);
const VALID_RGB = new Set<string>(['off', 'static', 'rainbow', 'breathe', 'soft']);
const VALID_CONTENT = new Set<string>(['dashboard', 'code', 'terminal', 'desktop', 'focus']);
const VALID_DECOR = new Set(DECOR_OPTIONS.map((decor) => decor.id));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type LightingSnapshot = {
  key: number;
  keyColor: string;
  fill: number;
  rim: number;
  hemisphere: number;
  ambient: number;
  softbox: number;
  screenGlow: number;
  underFill: number;
  underFillColor: string;
  screenGlowColor: string;
  exposure: number;
  environment: number;
  bloom: number;
  background: 'day' | 'solid';
  backgroundColor: string;
  backgroundIntensity: number;
  wall: string;
  baseboard: string;
  floor: string;
  theme: UiTheme;
};

type ShowcaseLightingTransition = {
  target: SceneId;
  from: LightingSnapshot;
  to: LightingSnapshot;
  duration: number;
};

type ShowcaseSnapshot = {
  ui: UiState;
  baseScene: SceneId;
  camera: { position: THREE.Vector3; target: THREE.Vector3; fov: number };
};

export function setupWorkbench(deps: WorkbenchDeps): { automation: WorkbenchAutomation } {
  const { scene, camera, renderer, controls, workstation, nodes, lights } = deps;
  const solidBackground = new THREE.Color();
  const floorMaterial = lights.floor.material as THREE.MeshStandardMaterial;
  const CANVAS = deps.canvas;

  const SCENE_BASES: Record<SceneId, SceneBase> = {
    day: {
      key: 1.95, keyColor: '#F2F3F2', fill: 0.24, rim: 0.45, hemi: 0.19, ambient: 0.04, softbox: 0.08,
      screenGlow: 0.32, underFill: 0.34, exposure: 0.74, environment: 0.5, bloom: 0.16,
      background: 'day', backgroundIntensity: 1,
      wall: deps.environment.wallColorDay, baseboard: deps.environment.baseboardColorDay, floor: '#FFFFFF',
      theme: 'light', screenGlowColor: '#3B7BFF', underFillColor: '#FFE8CF',
      rgbMode: 'rainbow', rgbColor: '#2BD8FF', screenContent: 'dashboard', screenPower: true,
    },
    night: {
      key: 0.48, keyColor: '#CBD8FF', fill: 0.1, rim: 0.24, hemi: 0.15, ambient: 0.022, softbox: 0.025,
      screenGlow: 0.55, underFill: 0.15, exposure: 0.82, environment: 0.28, bloom: 0.28,
      background: 'solid', backgroundColor: '#121113', backgroundIntensity: 1,
      wall: deps.environment.wallColorNight, baseboard: deps.environment.baseboardColorNight, floor: '#2A2825',
      theme: 'dark', screenGlowColor: '#6E9CFF', underFillColor: '#FFD8AE',
      rgbMode: 'breathe', rgbColor: '#2BD8FF', screenContent: 'terminal', screenPower: true,
    },
    focus: {
      key: 1.0, keyColor: '#FFE3C5', fill: 0.05, rim: 0.18, hemi: 0.08, ambient: 0.01, softbox: 0.03,
      screenGlow: 0.2, underFill: 0.12, exposure: 0.68, environment: 0.28, bloom: 0.14,
      background: 'day', backgroundIntensity: 0.38,
      wall: '#6D675F', baseboard: '#4C4740', floor: '#D0CABF',
      theme: 'light', screenGlowColor: '#3B7BFF', underFillColor: '#FFDDB8',
      rgbMode: 'static', rgbColor: '#FFD9A0', screenContent: 'focus', screenPower: true,
    },
    rgb: {
      key: 0.72, keyColor: '#D8C7FF', fill: 0.14, rim: 0.26, hemi: 0.15, ambient: 0.02, softbox: 0.04,
      screenGlow: 0.5, underFill: 0.16, exposure: 0.8, environment: 0.3, bloom: 0.26,
      background: 'solid', backgroundColor: '#14151C', backgroundIntensity: 1,
      wall: '#1D1E28', baseboard: '#14151D', floor: '#23232B',
      theme: 'dark', screenGlowColor: '#B06CFF', underFillColor: '#37D7E8',
      rgbMode: 'rainbow', rgbColor: '#B06CFF', screenContent: 'code', screenPower: true,
    },
  };

  let viewState: ViewId | null = 'default';
  let autoOrbit = false;
  let activeBaseScene: SceneId = 'day';
  let activeScene: ActiveSceneId = 'day';
  let uiTheme: UiTheme = 'light';
  let lighting: LightingState = { master: true, ambient: 1, level: 1 };
  let rgbMode: RgbMode = 'rainbow';
  let rgbColor = '#2BD8FF';
  let lastRgbMode: Exclude<RgbMode, 'off'> = 'rainbow';
  let screenPower = true;
  let screenContent: ScreenContent = 'dashboard';
  let lidClosed = false;
  let selectedObjectId: string | null = null;
  let hoverObjectId: string | null = null;
  let tidy = false;
  const hiddenDecor = new Set<string>();
  let chairYawDeg = 0;
  let chairReclineDeg = 0;
  let mugLidOpen = false;
  let steamOn = true;
  let bottleSwayOn = true;
  let ready = false;
  let saveTimer = 0;
  let wheelSpin = 0;
  let cameraTween: ViewTween | null = null;
  let autoOrbitDirection = 1;
  let lastFrameTime = 0;
  let pointerDownOnCanvas = false;
  let pointerMoved = false;
  let pointerStart = { x: 0, y: 0, time: 0 };
  let hoverFrame = 0;
  let pendingHover: { x: number; y: number } | null = null;
  let ui: ControlPanel;
  let showcase: ShowcaseController;
  let showcaseMode = false;
  let showcaseSnapshot: ShowcaseSnapshot | null = null;
  let showcaseLightingTransition: ShowcaseLightingTransition | null = null;
  const showcaseColorA = new THREE.Color();
  const showcaseColorB = new THREE.Color();

  function showcaseLocked(): boolean {
    return showcaseMode || showcase?.isActive() === true;
  }

  // --- object registry -------------------------------------------------------
  const objectTargets: Record<string, THREE.Object3D[]> = {};
  const pickMeshes: THREE.Mesh[] = [];
  const meshToObject = new Map<THREE.Mesh, string>();
  const sceneGroup = (name: string): THREE.Object3D | undefined => scene.getObjectByName(name);

  function addPickTarget(id: string, ...targets: Array<THREE.Object3D | undefined>): void {
    const filtered = targets.filter((target): target is THREE.Object3D => Boolean(target));
    objectTargets[id] = filtered;
    for (const target of filtered) {
      target.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        if (meshToObject.has(mesh)) return;
        meshToObject.set(mesh, id);
        pickMeshes.push(mesh);
      });
    }
  }

  addPickTarget('monitor', nodes.monitor);
  addPickTarget('laptop', nodes.laptopBase, nodes.laptopLid, sceneGroup('laptop-lid-hinge-pivot'));
  addPickTarget('keyboard', nodes.keyboard);
  addPickTarget('mouse', nodes.mouseShell);
  addPickTarget('chair', sceneGroup('ergonomic-chair'));
  addPickTarget('mug', nodes.mug);
  addPickTarget('bottle', nodes.bottle);
  addPickTarget('shelf', sceneGroup('shelf-hutch'));
  addPickTarget('backpack', sceneGroup('backpack'));
  addPickTarget('wastebin', sceneGroup('waste-bin'));

  const decorTargets: Record<string, THREE.Object3D[]> = {
    mug: [nodes.mug, nodes.mugNapkin].filter((item): item is THREE.Object3D => Boolean(item)),
    bottle: [nodes.bottle].filter((item): item is THREE.Object3D => Boolean(item)),
    backpack: [sceneGroup('backpack')].filter((item): item is THREE.Object3D => Boolean(item)),
    wastebin: [sceneGroup('waste-bin')].filter((item): item is THREE.Object3D => Boolean(item)),
    'desk-still-life': [sceneGroup('desk-still-life')].filter((item): item is THREE.Object3D => Boolean(item)),
    'shelf-decor': [sceneGroup('shelf-decor')].filter((item): item is THREE.Object3D => Boolean(item)),
  };

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hoverHelper = new THREE.Box3Helper(new THREE.Box3(), 0x7EC9BA);
  hoverHelper.visible = false;
  const hoverMaterial = hoverHelper.material as THREE.LineBasicMaterial;
  hoverMaterial.transparent = true;
  hoverMaterial.opacity = 0.55;
  hoverMaterial.depthTest = false;
  hoverMaterial.toneMapped = false;
  hoverHelper.renderOrder = 50;
  scene.add(hoverHelper);

  const selectionHelper = new THREE.Box3Helper(new THREE.Box3(), 0xF0B35E);
  selectionHelper.visible = false;
  const selectionMaterial = selectionHelper.material as THREE.LineBasicMaterial;
  selectionMaterial.transparent = true;
  selectionMaterial.opacity = 0.82;
  selectionMaterial.depthTest = false;
  selectionMaterial.toneMapped = false;
  selectionHelper.renderOrder = 51;
  scene.add(selectionHelper);

  // --- helpers ---------------------------------------------------------------
  function isVisible(object: THREE.Object3D | null | undefined): boolean {
    let current: THREE.Object3D | null = object ?? null;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }

  function objectBox(id: string): THREE.Box3 {
    const box = new THREE.Box3();
    for (const target of objectTargets[id] ?? []) {
      if (isVisible(target)) box.expandByObject(target);
    }
    return box;
  }

  function refreshHighlight(): void {
    const apply = (helper: THREE.Box3Helper, id: string | null): void => {
      if (!id) {
        helper.visible = false;
        return;
      }
      const box = objectBox(id);
      if (box.isEmpty()) {
        helper.visible = false;
        return;
      }
      helper.box.copy(box);
      helper.visible = true;
    };
    apply(selectionHelper, selectedObjectId);
    apply(hoverHelper, hoverObjectId && hoverObjectId !== selectedObjectId ? hoverObjectId : null);
  }

  function pickAt(clientX: number, clientY: number): { id: string } | null {
    const rect = CANVAS.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickMeshes, false);
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      const id = meshToObject.get(mesh);
      if (!id) continue;
      if (!isVisible(mesh)) continue;
      return { id };
    }
    return null;
  }

  // --- lighting --------------------------------------------------------------
  function applyLighting(): void {
    const base = SCENE_BASES[activeBaseScene];
    const master = lighting.master;
    const level = lighting.level;
    const ambientScale = lighting.ambient;

    lights.key.intensity = master ? base.key * level : 0;
    lights.key.color.set(base.keyColor);
    lights.fill.intensity = master ? base.fill * level : 0;
    lights.rim.intensity = master ? base.rim * level : 0;
    lights.hemisphere.intensity = base.hemi * ambientScale * (master ? 1 : 0.3);
    lights.ambient.intensity = base.ambient * ambientScale * (master ? 1 : 0.25);
    lights.ceilingSoftbox.intensity = master ? base.softbox * level : 0;
    lights.underDeskFill.intensity = base.underFill * (master ? 1 : 0.3) * (0.85 + 0.15 * level);
    lights.underDeskFill.color.set(base.underFillColor);
    lights.screenGlow.intensity = screenPower ? base.screenGlow * (0.85 + 0.15 * level) : 0;
    lights.screenGlow.color.set(base.screenGlowColor);

    renderer.toneMappingExposure = base.exposure;
    scene.environmentIntensity = base.environment;
    lights.bloom.strength = base.bloom;

    if (base.background === 'day') {
      scene.background = deps.dayBackground;
      scene.backgroundIntensity = base.backgroundIntensity;
    } else {
      solidBackground.set(base.backgroundColor ?? '#141315');
      scene.background = solidBackground;
    }
    lights.wallMaterial.color.set(base.wall);
    lights.baseboardMaterial.color.set(base.baseboard);
    floorMaterial.color.set(base.floor);

    uiTheme = base.theme;
    document.documentElement.style.colorScheme = uiTheme;
    document.documentElement.style.setProperty('--paper', uiTheme === 'dark' ? '#131315' : '#eee9e0');
  }

  // --- camera tween ----------------------------------------------------------
  function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function animateCameraTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    fov: number,
    duration = 700,
    onComplete?: () => void,
  ): void {
    deps.cancelViewAnimation();
    if (prefersReducedMotion()) {
      camera.position.copy(position);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      controls.target.copy(target);
      controls.update();
      onComplete?.();
      deps.render();
      return;
    }
    cameraTween = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      fromFov: camera.fov,
      toPosition: position.clone(),
      toTarget: target.clone(),
      toFov: fov,
      start: performance.now(),
      duration,
      onComplete,
    };
  }

  function stepCameraTween(now: number): void {
    if (!cameraTween) return;
    const tween = cameraTween;
    const progress = Math.min(1, (now - tween.start) / tween.duration);
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, eased);
    camera.updateProjectionMatrix();
    if (progress >= 1) {
      cameraTween = null;
      tween.onComplete?.();
    }
  }

  function goToView(name: ViewId): void {
    if (autoOrbit) setAutoOrbit(false, false);
    cameraTween = null;
    deps.applyView(name, true);
  }

  function setAutoOrbit(on: boolean, announce = true): void {
    if (on === autoOrbit) return;
    autoOrbit = on;
    if (!on) {
      controls.autoRotate = false;
      syncUi();
      scheduleSave();
      if (announce) ui.toast('自动环绕已暂停');
      return;
    }
    deps.clearView();
    cameraTween = null;
    controls.autoRotate = false;
    const target = new THREE.Vector3(0, 0.96, 0.02);
    const offset = camera.position.clone().sub(target);
    const azimuth = Math.atan2(offset.x, offset.z);
    const radius = clamp(offset.length(), 1.95, 2.75);
    const endPosition = new THREE.Vector3(
      target.x + Math.sin(azimuth) * radius,
      target.y + 0.72,
      target.z + Math.cos(azimuth) * radius,
    );
    controls.autoRotate = false;
    autoOrbitDirection = azimuth > 0 ? -1 : 1;
    animateCameraTo(endPosition, target, 50, 900);
    syncUi();
    scheduleSave();
    if (announce) ui.toast('自动环绕已开启');
  }

  function focusObject(id: string): void {
    const targets = objectTargets[id];
    if (!targets || !targets.some((target) => isVisible(target))) return;
    const box = objectBox(id);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const direction = camera.position.clone().sub(center);
    if (direction.lengthSq() < 1e-6) direction.set(0.2, 0.35, 1);
    direction.y = Math.max(direction.y, size.y * 0.35);
    direction.normalize();
    const distance = clamp(size.length() * 0.98, 0.52, 2.3);
    const position = center.clone().addScaledVector(direction, distance);
    if (autoOrbit) setAutoOrbit(false, false);
    deps.clearView();
    deps.cancelViewAnimation();
    cameraTween = null;
    animateCameraTo(position, center, Math.min(camera.fov, 46), 720);
    syncUi();
    ui.toast(`聚焦 ${OBJECT_DEFINITIONS[id]?.label ?? '物体'}`);
  }

  // --- inspector metadata ----------------------------------------------------
  function buildObjectMeta(id: string | null): ObjectMeta | null {
    if (!id) return null;
    const def = OBJECT_DEFINITIONS[id];
    if (!def) return null;
    const actions: ObjectAction[] = [{ id: 'focus', label: '聚焦观察', icon: 'focus' }];
    let choices: ObjectChoiceGroup[] | undefined;
    let status = '';

    if (id === 'monitor' || id === 'laptop') {
      actions.push({ id: 'power', label: screenPower ? '关闭屏幕' : '打开屏幕', icon: 'power', active: screenPower });
      if (id === 'laptop') {
        actions.splice(1, 0, {
          id: 'lid',
          label: lidClosed ? '打开上盖' : '合上上盖',
          icon: 'lid',
          active: !lidClosed,
        });
        status = `上盖${lidClosed ? '已合上' : '已打开'} · 屏幕${screenPower ? '开启' : '息屏'}`;
      } else {
        status = `屏幕${screenPower ? '开启' : '息屏'} · 当前内容：${SCREEN_CONTENT_LABELS[screenContent]}`;
      }
      choices = [{
        label: '屏幕内容',
        options: (Object.keys(SCREEN_CONTENT_LABELS) as ScreenContent[]).map((content) => ({
          id: `content-${content}`,
          label: SCREEN_CONTENT_LABELS[content],
          active: screenContent === content,
        })),
      }];
    } else if (id === 'keyboard') {
      actions.push({
        id: 'rgb-toggle',
        label: rgbMode === 'off' ? '开启 RGB' : '关闭 RGB',
        icon: 'power',
        active: rgbMode !== 'off',
      });
      status = rgbMode === 'off'
        ? 'RGB 已关闭'
        : `${RGB_MODE_LABELS[rgbMode]}灯效 · ${RGB_COLORS.find((color) => color.value === rgbColor)?.label ?? rgbColor}`;
      choices = [
        {
          label: '灯效模式',
          options: (['off', 'static', 'rainbow', 'breathe', 'soft'] as RgbMode[]).map((mode) => ({
            id: `mode-${mode}`,
            label: RGB_MODE_LABELS[mode],
            active: rgbMode === mode,
          })),
        },
        {
          label: '单色配色',
          options: RGB_COLORS.map((color) => ({
            id: `color-${color.value}`,
            label: color.label,
            color: color.value,
            active: rgbMode === 'static' && rgbColor === color.value,
          })),
        },
      ];
    } else if (id === 'mouse') {
      actions.push({ id: 'spin', label: '滚动滚轮', icon: 'rotate' });
      status = '无线连接 · 无 USB 线';
    } else if (id === 'chair') {
      actions.push(
        { id: 'swivel-left', label: '向左旋转', icon: 'left' },
        { id: 'swivel-right', label: '向右旋转', icon: 'right' },
        { id: 'recline', label: chairReclineDeg > 0 ? '恢复直立' : '后仰放松', icon: 'rotate', active: chairReclineDeg > 0 },
        { id: 'reset', label: '复位椅子', icon: 'reset' },
      );
      status = `朝向 ${Math.round(chairYawDeg)}° · ${chairReclineDeg > 0 ? '后仰 10°' : '直立'}`;
    } else if (id === 'mug') {
      actions.push(
        { id: 'steam', label: '蒸汽', icon: 'wind', active: steamOn },
        { id: 'lid', label: mugLidOpen ? '合上杯盖' : '打开杯盖', icon: 'cup', active: mugLidOpen },
      );
      status = `木盖${mugLidOpen ? '打开' : '合上'} · 蒸汽${steamOn ? '开启' : '关闭'}`;
    } else if (id === 'bottle') {
      actions.push({ id: 'sway', label: '轻摆水壶', icon: 'wind', active: bottleSwayOn });
      status = bottleSwayOn ? '挂带承托 · 轻微摆动' : '挂带承托 · 已静止';
    } else if (id === 'shelf') {
      const visible = !hiddenDecor.has('shelf-decor');
      actions.push({ id: 'toggle-decor', label: visible ? '隐藏架上摆件' : '显示架上摆件', icon: visible ? 'eyeOff' : 'eye' });
      status = '16 本书 · 中秋礼盒 · 玻璃罐 · 茶叶罐';
    } else if (id === 'backpack') {
      const visible = !hiddenDecor.has('backpack');
      actions.push({ id: 'toggle-decor', label: visible ? '隐藏书包' : '显示书包', icon: visible ? 'eyeOff' : 'eye' });
      status = '背面靠左侧板 · 包底贴地';
    } else if (id === 'wastebin') {
      const visible = !hiddenDecor.has('wastebin');
      actions.push({ id: 'toggle-decor', label: visible ? '隐藏垃圾桶' : '显示垃圾桶', icon: visible ? 'eyeOff' : 'eye' });
      status = '白色冲孔壳体 · 绿色垃圾袋';
    }

    return { ...def, actions, choices, status };
  }

  // --- state changes ---------------------------------------------------------
  function effectiveHidden(id: string): boolean {
    return hiddenDecor.has(id) || (tidy && TIDY_DECOR.has(id));
  }

  function applyDecorVisibility(): void {
    for (const [id, targets] of Object.entries(decorTargets)) {
      const visible = !effectiveHidden(id);
      for (const target of targets) target.visible = visible;
    }
    if (selectedObjectId) {
      const targets = objectTargets[selectedObjectId];
      if (!targets || !targets.some((target) => isVisible(target))) selectedObjectId = null;
    }
    if (hoverObjectId) {
      const targets = objectTargets[hoverObjectId];
      if (!targets || !targets.some((target) => isVisible(target))) hoverObjectId = null;
    }
    refreshHighlight();
  }

  function selectObject(id: string | null): void {
    if (id) {
      const targets = objectTargets[id];
      if (!targets || !targets.some((target) => isVisible(target))) id = null;
    }
    selectedObjectId = id;
    if (id) {
      ui.setSceneTooltip(null);
    }
    syncUi();
    refreshInspector();
    refreshHighlight();
  }

  function commit(): void {
    syncUi();
    refreshInspector();
    refreshHighlight();
    scheduleSave();
  }

  function toggleTidy(): void {
    tidy = !tidy;
    applyDecorVisibility();
    commit();
    ui.toast(tidy ? '桌面整理已开启' : '桌面整理已关闭');
  }

  function toggleDecor(id: string): void {
    if (tidy && TIDY_DECOR.has(id)) {
      ui.toast('桌面整理开启中，请先关闭整理模式');
      return;
    }
    const label = DECOR_OPTIONS.find((decor) => decor.id === id)?.label ?? '装饰物';
    if (hiddenDecor.has(id)) {
      hiddenDecor.delete(id);
      ui.toast(`${label}已显示`);
    } else {
      hiddenDecor.add(id);
      ui.toast(`${label}已隐藏`);
    }
    applyDecorVisibility();
    commit();
  }

  function toggleScreenPower(): void {
    screenPower = !screenPower;
    workstation.setScreenPower(screenPower);
    applyLighting();
    commit();
    ui.toast(screenPower ? '双屏已点亮' : '双屏已息屏');
  }

  function setScreenContentValue(content: ScreenContent): void {
    if (!(content in SCREEN_CONTENT_LABELS) || screenContent === content) return;
    screenContent = content;
    workstation.setScreenContent(content);
    if (!screenPower) {
      screenPower = true;
      workstation.setScreenPower(true);
      applyLighting();
    }
    commit();
    ui.toast(`屏幕内容：${SCREEN_CONTENT_LABELS[content]}`);
  }

  function setRgbModeValue(mode: RgbMode, announce = false): void {
    rgbMode = mode;
    if (mode !== 'off') lastRgbMode = mode;
    workstation.setKeyboardRgb(mode);
    commit();
    if (announce) ui.toast(`键盘灯效：${RGB_MODE_LABELS[mode]}`);
  }

  function setRgbColorValue(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    rgbColor = color;
    workstation.setKeyboardRgbColor(color);
    if (rgbMode !== 'static') {
      rgbMode = 'static';
      lastRgbMode = 'static';
      workstation.setKeyboardRgb('static');
    }
    commit();
    const label = RGB_COLORS.find((item) => item.value.toLowerCase() === color.toLowerCase())?.label;
    ui.toast(label ? `键盘单色：${label}` : '键盘单色已更新');
  }

  function toggleRgb(): void {
    setRgbModeValue(rgbMode === 'off' ? lastRgbMode : 'off', true);
  }

  function toggleLaptopLid(): void {
    lidClosed = !lidClosed;
    if (lidClosed) workstation.closeLaptop();
    else workstation.openLaptop(105);
    commit();
    ui.toast(lidClosed ? '笔记本已合上' : '笔记本已打开');
  }

  function swivelChairBy(delta: number): void {
    chairYawDeg = clamp(chairYawDeg + delta, -60, 60);
    workstation.swivelChair(chairYawDeg);
    commit();
  }

  function toggleChairRecline(): void {
    chairReclineDeg = chairReclineDeg > 0 ? 0 : 10;
    workstation.reclineChair(chairReclineDeg);
    commit();
  }

  function resetChair(): void {
    chairYawDeg = 0;
    chairReclineDeg = 0;
    workstation.swivelChair(0);
    workstation.reclineChair(0);
    commit();
  }

  function handleObjectAction(id: string, action: string): void {
    if (action === 'focus') {
      focusObject(id);
      return;
    }
    if (id === 'monitor' || id === 'laptop') {
      if (action === 'power') {
        toggleScreenPower();
        return;
      }
      if (id === 'laptop' && action === 'lid') {
        toggleLaptopLid();
        return;
      }
      if (action.startsWith('content-')) {
        setScreenContentValue(action.slice('content-'.length) as ScreenContent);
        return;
      }
    }
    if (id === 'keyboard') {
      if (action === 'rgb-toggle') {
        toggleRgb();
        return;
      }
      if (action.startsWith('mode-')) {
        setRgbModeValue(action.slice('mode-'.length) as RgbMode, true);
        return;
      }
      if (action.startsWith('color-')) {
        setRgbColorValue(action.slice('color-'.length));
        return;
      }
    }
    if (id === 'mouse' && action === 'spin') {
      wheelSpin = Math.max(wheelSpin, 92);
      ui.toast('滚轮演示');
      return;
    }
    if (id === 'chair') {
      if (action === 'swivel-left') swivelChairBy(-18);
      else if (action === 'swivel-right') swivelChairBy(18);
      else if (action === 'recline') toggleChairRecline();
      else if (action === 'reset') resetChair();
      return;
    }
    if (id === 'mug') {
      if (action === 'steam') {
        steamOn = !steamOn;
        workstation.toggleSteam(steamOn);
        commit();
        return;
      }
      if (action === 'lid') {
        mugLidOpen = !mugLidOpen;
        workstation.openMugLid(mugLidOpen);
        commit();
        return;
      }
    }
    if (id === 'bottle' && action === 'sway') {
      bottleSwayOn = !bottleSwayOn;
      workstation.swayBottle(bottleSwayOn ? 2.2 : 0);
      commit();
      return;
    }
    if (action === 'toggle-decor') {
      if (id === 'shelf') toggleDecor('shelf-decor');
      else if (id === 'backpack') toggleDecor('backpack');
      else if (id === 'wastebin') toggleDecor('wastebin');
    }
  }

  function handleLighting(patch: Partial<LightingState>): void {
    if (typeof patch.master === 'boolean') lighting.master = patch.master;
    if (typeof patch.ambient === 'number') lighting.ambient = clamp(patch.ambient, 0, 1.5);
    if (typeof patch.level === 'number') lighting.level = clamp(patch.level, 0.6, 1.4);
    activeScene = 'custom';
    applyLighting();
    syncUi();
    scheduleSave();
  }

  function applyScene(id: SceneId, silent = false): void {
    const base = SCENE_BASES[id];
    if (!base) return;
    activeBaseScene = id;
    activeScene = id;
    lighting = { master: true, ambient: 1, level: 1 };
    screenPower = base.screenPower;
    screenContent = base.screenContent;
    rgbMode = base.rgbMode;
    if (rgbMode !== 'off') lastRgbMode = rgbMode;
    rgbColor = base.rgbColor;
    workstation.setScreenPower(screenPower);
    workstation.setScreenContent(screenContent);
    workstation.setKeyboardRgb(rgbMode);
    workstation.setKeyboardRgbColor(rgbColor);
    applyLighting();
    commit();
    if (!silent) ui.toast(`${SCENE_LABELS[id]}已应用`);
  }

  function getUiState(): UiState {
    const hidden = new Set(hiddenDecor);
    if (tidy) for (const id of TIDY_DECOR) hidden.add(id);
    return {
      view: viewState,
      autoOrbit,
      scene: activeScene,
      theme: uiTheme,
      rgbMode,
      rgbColor,
      screenPower,
      screenContent,
      lidClosed,
      lighting: { ...lighting },
      selectedObjectId,
      tidy,
      hiddenDecor: [...hidden],
    };
  }

  // --- persistence -----------------------------------------------------------
  type PersistedSettings = {
    view: ViewId | null;
    scene: SceneId;
    lightingCustom: boolean;
    lighting: LightingState;
    rgbMode: RgbMode;
    rgbColor: string;
    screenPower: boolean;
    screenContent: ScreenContent;
    lidClosed: boolean;
    tidy: boolean;
    hiddenDecor: string[];
  };

  function readPersisted(): PersistedSettings | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return null;
      const scene = typeof parsed.scene === 'string' && VALID_SCENES.has(parsed.scene)
        ? parsed.scene as SceneId
        : 'day';
      const view = parsed.view === null
        ? null
        : typeof parsed.view === 'string' && VALID_VIEWS.has(parsed.view)
          ? parsed.view as ViewId
          : 'default';
      const rawLighting = (parsed.lighting ?? {}) as Record<string, unknown>;
      const lightingState: LightingState = {
        master: rawLighting.master !== false,
        ambient: typeof rawLighting.ambient === 'number' ? clamp(rawLighting.ambient, 0, 1.5) : 1,
        level: typeof rawLighting.level === 'number' ? clamp(rawLighting.level, 0.6, 1.4) : 1,
      };
      const rgbMode = typeof parsed.rgbMode === 'string' && VALID_RGB.has(parsed.rgbMode)
        ? parsed.rgbMode as RgbMode
        : SCENE_BASES[scene].rgbMode;
      const rgbColor = typeof parsed.rgbColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.rgbColor)
        ? parsed.rgbColor
        : SCENE_BASES[scene].rgbColor;
      const screenContent = typeof parsed.screenContent === 'string' && VALID_CONTENT.has(parsed.screenContent)
        ? parsed.screenContent as ScreenContent
        : SCENE_BASES[scene].screenContent;
      const hidden = Array.isArray(parsed.hiddenDecor)
        ? parsed.hiddenDecor.filter((value): value is string => typeof value === 'string' && VALID_DECOR.has(value))
        : [];
      return {
        view,
        scene,
        lightingCustom: parsed.lightingCustom === true,
        lighting: lightingState,
        rgbMode,
        rgbColor,
        screenPower: parsed.screenPower !== false,
        screenContent,
        lidClosed: parsed.lidClosed === true,
        tidy: parsed.tidy === true,
        hiddenDecor: hidden,
      };
    } catch {
      return null;
    }
  }

  function persistNow(): void {
    if (!ready || showcaseMode) return;
    const settings: PersistedSettings = {
      view: viewState,
      scene: activeBaseScene,
      lightingCustom: activeScene === 'custom',
      lighting: { ...lighting },
      rgbMode,
      rgbColor,
      screenPower,
      screenContent,
      lidClosed,
      tidy,
      hiddenDecor: [...hiddenDecor],
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式下 localStorage 可能不可写，交互不应因此中断。
    }
  }

  function scheduleSave(): void {
    if (!ready || showcaseMode) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistNow, 220);
  }

  // --- UI --------------------------------------------------------------------
  const viewOptions = VIEW_ORDER.map((id) => ({
    id,
    label: VIEW_LABELS[id],
    icon: VIEW_ICONS[id],
    tip: VIEW_TIPS[id],
  }));

  const shortcuts: ShortcutHint[] = [
    { keys: '1–9', label: '切换常用视角' },
    { keys: 'R', label: '恢复默认视角' },
    { keys: '空格', label: '自动环绕；展示中暂停 / 继续' },
    { keys: 'H', label: '展示中隐藏 / 恢复控件栏' },
    { keys: 'Esc', label: '关闭面板 / 取消选中' },
    { keys: '拖动', label: '旋转视角' },
    { keys: '滚轮', label: '缩放远近' },
  ];

  function lockedToast(): void {
    ui.toast('展示进行中：请先退出展示再手动调整');
  }

  const callbacks: ControlCallbacks = {
    onView: (id) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      goToView(id);
    },
    onResetView: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      if (autoOrbit) setAutoOrbit(false, false);
      cameraTween = null;
      deps.applyView('default', true);
      ui.toast('已恢复默认视角');
    },
    onAutoOrbit: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      setAutoOrbit(!autoOrbit);
    },
    onSelectObject: (id) => {
      if (showcaseLocked()) return;
      selectObject(id);
    },
    onObjectAction: (objectId, actionId) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      handleObjectAction(objectId, actionId);
    },
    onDecorToggle: (id) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      toggleDecor(id);
    },
    onTidyToggle: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      toggleTidy();
    },
    onScene: (id) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      applyScene(id);
    },
    onRgbMode: (mode) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      setRgbModeValue(mode, true);
    },
    onRgbColor: (color) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      setRgbColorValue(color);
    },
    onRgbToggle: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      toggleRgb();
    },
    onScreenPower: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      toggleScreenPower();
    },
    onLidToggle: () => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      toggleLaptopLid();
    },
    onLighting: (patch) => {
      if (showcaseLocked()) {
        lockedToast();
        return;
      }
      handleLighting(patch);
    },
    onShowcaseStart: () => showcase.start(),
    onShowcasePause: () => showcase.togglePause(),
    onShowcaseNext: () => showcase.nextChapter(),
    onShowcaseReplay: () => showcase.restart(),
    onShowcaseExit: () => showcase.exit(),
    onShowcaseToggleUi: () => showcase.toggleUiHidden(),
    onShowcaseHideOnStart: (enabled) => showcase.setHideOnStart(enabled),
  };

  ui = new ControlPanel(deps.stage, {
    views: viewOptions,
    objects: OBJECT_SUMMARIES,
    decor: DECOR_OPTIONS,
    shortcuts,
    rgbColors: RGB_COLORS,
    callbacks,
  });

  function syncUi(): void {
    ui.sync(getUiState());
  }

  function refreshInspector(): void {
    ui.setInspector(buildObjectMeta(selectedObjectId));
  }

  // --- 自动展示桥接 ---------------------------------------------------------
  function snapshotFromBase(base: SceneBase): LightingSnapshot {
    return {
      key: base.key,
      keyColor: base.keyColor,
      fill: base.fill,
      rim: base.rim,
      hemisphere: base.hemi,
      ambient: base.ambient,
      softbox: base.softbox,
      screenGlow: base.screenGlow,
      underFill: base.underFill,
      underFillColor: base.underFillColor,
      screenGlowColor: base.screenGlowColor,
      exposure: base.exposure,
      environment: base.environment,
      bloom: base.bloom,
      background: base.background,
      backgroundColor: base.backgroundColor ?? '#141315',
      backgroundIntensity: base.backgroundIntensity,
      wall: base.wall,
      baseboard: base.baseboard,
      floor: base.floor,
      theme: base.theme,
    };
  }

  function captureLightingSnapshot(): LightingSnapshot {
    return {
      key: lights.key.intensity,
      keyColor: `#${lights.key.color.getHexString()}`,
      fill: lights.fill.intensity,
      rim: lights.rim.intensity,
      hemisphere: lights.hemisphere.intensity,
      ambient: lights.ambient.intensity,
      softbox: lights.ceilingSoftbox.intensity,
      screenGlow: lights.screenGlow.intensity,
      underFill: lights.underDeskFill.intensity,
      underFillColor: `#${lights.underDeskFill.color.getHexString()}`,
      screenGlowColor: `#${lights.screenGlow.color.getHexString()}`,
      exposure: renderer.toneMappingExposure,
      environment: scene.environmentIntensity,
      bloom: lights.bloom.strength,
      background: scene.background === deps.dayBackground ? 'day' : 'solid',
      backgroundColor: scene.background instanceof THREE.Color
        ? `#${scene.background.getHexString()}`
        : '#141315',
      backgroundIntensity: scene.backgroundIntensity,
      wall: `#${lights.wallMaterial.color.getHexString()}`,
      baseboard: `#${lights.baseboardMaterial.color.getHexString()}`,
      floor: `#${floorMaterial.color.getHexString()}`,
      theme: uiTheme,
    };
  }

  function setUiTheme(theme: UiTheme, sync = false): void {
    if (uiTheme !== theme) {
      uiTheme = theme;
      document.documentElement.style.colorScheme = theme;
      document.documentElement.style.setProperty('--paper', theme === 'dark' ? '#131315' : '#eee9e0');
    }
    if (sync) syncUi();
  }

  function applyLightingSnapshot(snapshot: LightingSnapshot): void {
    lights.key.intensity = snapshot.key;
    lights.key.color.set(snapshot.keyColor);
    lights.fill.intensity = snapshot.fill;
    lights.rim.intensity = snapshot.rim;
    lights.hemisphere.intensity = snapshot.hemisphere;
    lights.ambient.intensity = snapshot.ambient;
    lights.ceilingSoftbox.intensity = snapshot.softbox;
    lights.screenGlow.intensity = snapshot.screenGlow;
    lights.screenGlow.color.set(snapshot.screenGlowColor);
    lights.underDeskFill.intensity = snapshot.underFill;
    lights.underDeskFill.color.set(snapshot.underFillColor);
    renderer.toneMappingExposure = snapshot.exposure;
    scene.environmentIntensity = snapshot.environment;
    lights.bloom.strength = snapshot.bloom;
    if (snapshot.background === 'day') {
      scene.background = deps.dayBackground;
      scene.backgroundIntensity = snapshot.backgroundIntensity;
    } else {
      solidBackground.set(snapshot.backgroundColor);
      scene.background = solidBackground;
      scene.backgroundIntensity = snapshot.backgroundIntensity;
    }
    lights.wallMaterial.color.set(snapshot.wall);
    lights.baseboardMaterial.color.set(snapshot.baseboard);
    floorMaterial.color.set(snapshot.floor);
    setUiTheme(snapshot.theme, false);
  }

  function blendLightingSnapshots(from: LightingSnapshot, to: LightingSnapshot, progress: number): void {
    const t = smootherstep(progress);
    const mix = (a: number, b: number): number => a + (b - a) * t;
    const mixColor = (target: THREE.Color, a: string, b: string): void => {
      showcaseColorA.set(a);
      showcaseColorB.set(b);
      target.copy(showcaseColorA).lerp(showcaseColorB, t);
    };

    lights.key.intensity = mix(from.key, to.key);
    lights.fill.intensity = mix(from.fill, to.fill);
    lights.rim.intensity = mix(from.rim, to.rim);
    lights.hemisphere.intensity = mix(from.hemisphere, to.hemisphere);
    lights.ambient.intensity = mix(from.ambient, to.ambient);
    lights.ceilingSoftbox.intensity = mix(from.softbox, to.softbox);
    lights.screenGlow.intensity = mix(from.screenGlow, to.screenGlow);
    lights.underDeskFill.intensity = mix(from.underFill, to.underFill);
    renderer.toneMappingExposure = mix(from.exposure, to.exposure);
    scene.environmentIntensity = mix(from.environment, to.environment);
    lights.bloom.strength = mix(from.bloom, to.bloom);

    mixColor(lights.key.color, from.keyColor, to.keyColor);
    mixColor(lights.screenGlow.color, from.screenGlowColor, to.screenGlowColor);
    mixColor(lights.underDeskFill.color, from.underFillColor, to.underFillColor);
    mixColor(lights.wallMaterial.color, from.wall, to.wall);
    mixColor(lights.baseboardMaterial.color, from.baseboard, to.baseboard);
    mixColor(floorMaterial.color, from.floor, to.floor);

    const fromDay = from.background === 'day';
    const toDay = to.background === 'day';
    if (fromDay && toDay) {
      scene.background = deps.dayBackground;
      scene.backgroundIntensity = mix(from.backgroundIntensity, to.backgroundIntensity);
    } else if (!fromDay && !toDay) {
      showcaseColorA.set(from.backgroundColor);
      showcaseColorB.set(to.backgroundColor);
      solidBackground.copy(showcaseColorA).lerp(showcaseColorB, t);
      scene.background = solidBackground;
      scene.backgroundIntensity = 1;
    } else if (fromDay) {
      // 白天贴图与纯色背景之间用亮度过渡，切换瞬间两边都接近黑场，避免硬跳。
      if (t < 0.55) {
        scene.background = deps.dayBackground;
        scene.backgroundIntensity = from.backgroundIntensity * (1 - t / 0.55);
      } else {
        solidBackground.set(to.backgroundColor);
        scene.background = solidBackground;
        scene.backgroundIntensity = 1;
      }
    } else if (t < 0.55) {
      solidBackground.set(from.backgroundColor);
      scene.background = solidBackground;
      scene.backgroundIntensity = 1;
    } else {
      scene.background = deps.dayBackground;
      scene.backgroundIntensity = to.backgroundIntensity * ((t - 0.55) / 0.45);
    }

    if (t >= 0.55) setUiTheme(to.theme, uiTheme !== to.theme);
  }

  function showcaseCameraPose(): CameraPose {
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.max(0.0001, offset.length());
    return {
      target: [controls.target.x, controls.target.y, controls.target.z],
      azimuthDeg: THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z)),
      elevationDeg: THREE.MathUtils.radToDeg(Math.asin(clamp(offset.y / distance, -1, 1))),
      distance,
      fov: camera.fov,
    };
  }

  function applyShowcaseCameraPose(pose: CameraPose): void {
    const az = THREE.MathUtils.degToRad(pose.azimuthDeg);
    const el = THREE.MathUtils.degToRad(pose.elevationDeg);
    controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
    camera.position.set(
      pose.target[0] + Math.sin(az) * Math.cos(el) * pose.distance,
      pose.target[1] + Math.sin(el) * pose.distance,
      pose.target[2] + Math.cos(az) * Math.cos(el) * pose.distance,
    );
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
  }

  function beginShowcase(): void {
    if (showcaseMode) return;
    const state = getUiState();
    // 持久化只保存显式隐藏项；整理模式单独恢复，避免退出后污染用户装饰偏好。
    state.hiddenDecor = [...hiddenDecor];
    showcaseSnapshot = {
      ui: state,
      baseScene: activeBaseScene,
      camera: {
        position: camera.position.clone(),
        target: controls.target.clone(),
        fov: camera.fov,
      },
    };
    showcaseMode = true;
    if (autoOrbit) setAutoOrbit(false, false);
    cameraTween = null;
    deps.cancelViewAnimation();
    deps.clearView();
    clearHover();
    selectedObjectId = null;
    hoverObjectId = null;
    refreshInspector();
    refreshHighlight();
    controls.autoRotate = false;
    controls.enabled = false;
    controls.enableDamping = false;
    CANVAS.style.cursor = 'default';
    ui.setSceneTooltip(null);
    syncUi();
  }

  function endShowcase(): void {
    const snapshot = showcaseSnapshot;
    showcaseSnapshot = null;
    showcaseLightingTransition = null;
    controls.enabled = true;
    controls.enableDamping = true;
    controls.autoRotate = false;
    CANVAS.style.cursor = 'grab';

    if (!snapshot) {
      showcaseMode = false;
      deps.applyView('default', false);
      return;
    }

    applyScene(snapshot.baseScene, true);
    activeBaseScene = snapshot.baseScene;
    activeScene = snapshot.ui.scene === 'custom' ? 'custom' : snapshot.baseScene;
    lighting = { ...snapshot.ui.lighting };
    rgbMode = snapshot.ui.rgbMode;
    rgbColor = snapshot.ui.rgbColor;
    if (rgbMode !== 'off') lastRgbMode = rgbMode;
    screenPower = snapshot.ui.screenPower;
    screenContent = snapshot.ui.screenContent;
    lidClosed = snapshot.ui.lidClosed;
    tidy = snapshot.ui.tidy;
    hiddenDecor.clear();
    for (const id of snapshot.ui.hiddenDecor) hiddenDecor.add(id);
    workstation.setKeyboardRgb(rgbMode);
    workstation.setKeyboardRgbColor(rgbColor);
    workstation.setKeyboardRgbScale(1);
    workstation.setScreenPower(screenPower);
    workstation.setScreenContent(screenContent);
    if (lidClosed) workstation.closeLaptop();
    else workstation.openLaptop(105);
    applyDecorVisibility();
    applyLighting();
    selectObject(snapshot.ui.selectedObjectId);
    syncUi();
    refreshHighlight();

    deps.clearView();
    cameraTween = null;
    animateCameraTo(snapshot.camera.position, snapshot.camera.target, snapshot.camera.fov, 900, () => {
      if (snapshot.ui.view) deps.applyView(snapshot.ui.view, false);
    });
    showcaseMode = false;
    scheduleSave();
    deps.render();
  }

  function beginShowcaseSceneTransition(sceneId: SceneId, duration: number): void {
    const base = SCENE_BASES[sceneId];
    if (!base) return;
    const from = captureLightingSnapshot();
    activeBaseScene = sceneId;
    activeScene = sceneId;
    lighting = { master: true, ambient: 1, level: 1 };
    showcaseLightingTransition = {
      target: sceneId,
      from,
      to: snapshotFromBase(base),
      duration,
    };
  }

  function stepShowcaseSceneTransition(progress: number): void {
    if (!showcaseLightingTransition) return;
    blendLightingSnapshots(showcaseLightingTransition.from, showcaseLightingTransition.to, progress);
  }

  function commitShowcaseScene(sceneId: SceneId): void {
    const base = SCENE_BASES[sceneId];
    if (!base) return;
    activeBaseScene = sceneId;
    activeScene = sceneId;
    lighting = { master: true, ambient: 1, level: 1 };
    applyLightingSnapshot(snapshotFromBase(base));
    showcaseLightingTransition = null;
    syncUi();
  }

  function applyShowcaseSceneInstant(sceneId: SceneId): void {
    const base = SCENE_BASES[sceneId];
    if (!base) return;
    showcaseLightingTransition = null;
    activeBaseScene = sceneId;
    activeScene = sceneId;
    lighting = { master: true, ambient: 1, level: 1 };
    screenPower = base.screenPower;
    screenContent = base.screenContent;
    rgbMode = base.rgbMode;
    if (rgbMode !== 'off') lastRgbMode = rgbMode;
    rgbColor = base.rgbColor;
    workstation.setScreenPower(screenPower);
    workstation.setScreenContent(screenContent);
    workstation.setKeyboardRgb(rgbMode);
    workstation.setKeyboardRgbColor(rgbColor);
    workstation.setKeyboardRgbScale(1);
    applyLightingSnapshot(snapshotFromBase(base));
    syncUi();
  }

  function showcaseSetRgb(mode: RgbMode, color?: string): void {
    rgbMode = mode;
    if (mode !== 'off') lastRgbMode = mode;
    workstation.setKeyboardRgb(mode);
    if (color && /^#[0-9a-f]{6}$/i.test(color)) {
      rgbColor = color;
      workstation.setKeyboardRgbColor(color);
    }
    syncUi();
  }

  function showcaseSetScreenPower(on: boolean): void {
    if (screenPower === on) return;
    screenPower = on;
    workstation.setScreenPower(on);
    syncUi();
  }

  function showcaseSetScreenContent(content: ScreenContent): void {
    screenContent = content;
    if (!screenPower) {
      screenPower = true;
      workstation.setScreenPower(true);
    }
    workstation.setScreenContent(content);
    syncUi();
  }

  function showcaseSetLidClosed(closed: boolean, immediate = false): void {
    lidClosed = closed;
    if (immediate) workstation.setLaptopLidInstant(closed);
    else if (closed) workstation.closeLaptop();
    else workstation.openLaptop(105);
    syncUi();
  }

  function showcaseSetRgbScale(scale: number): void {
    workstation.setKeyboardRgbScale(scale);
  }

  function pauseShowcaseDevices(): void {
    workstation.pauseAnimations();
  }

  function resumeShowcaseDevices(): void {
    workstation.resumeAnimations();
  }

  function setShowcaseUiHidden(hidden: boolean): void {
    ui.setTreeHidden(hidden);
  }

  function publishShowcase(state: ShowcaseUiState): void {
    ui.setShowcase(state);
  }

  const showcaseHost: ShowcaseHost = {
    getCameraPose: showcaseCameraPose,
    applyCameraPose: applyShowcaseCameraPose,
    beginShowcase,
    endShowcase,
    beginSceneTransition: beginShowcaseSceneTransition,
    stepSceneTransition: stepShowcaseSceneTransition,
    commitScene: commitShowcaseScene,
    applySceneInstant: applyShowcaseSceneInstant,
    setRgb: showcaseSetRgb,
    setRgbScale: showcaseSetRgbScale,
    setScreenPower: showcaseSetScreenPower,
    setScreenContent: showcaseSetScreenContent,
    setLidClosed: showcaseSetLidClosed,
    pauseDevices: pauseShowcaseDevices,
    resumeDevices: resumeShowcaseDevices,
    setUiHidden: setShowcaseUiHidden,
    publish: publishShowcase,
    render: () => deps.render(),
  };
  showcase = new ShowcaseController(showcaseHost);
  ui.setShowcase(showcase.getState());

  // --- pointer interactions --------------------------------------------------
  function scheduleHover(clientX: number, clientY: number): void {
    pendingHover = { x: clientX, y: clientY };
    if (hoverFrame) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = 0;
      const point = pendingHover;
      pendingHover = null;
      if (!point) return;
      const hit = pickAt(point.x, point.y);
      const id = hit?.id ?? null;
      if (id === hoverObjectId) {
        if (id) ui.setSceneTooltip(`${OBJECT_DEFINITIONS[id].label} · 点击查看操作`, point.x, point.y);
        return;
      }
      hoverObjectId = id;
      CANVAS.style.cursor = id ? 'pointer' : 'grab';
      refreshHighlight();
      ui.setSceneTooltip(id ? `${OBJECT_DEFINITIONS[id].label} · 点击查看操作` : null, point.x, point.y);
    });
  }

  function clearHover(): void {
    pendingHover = null;
    if (hoverObjectId) {
      hoverObjectId = null;
      refreshHighlight();
    }
    CANVAS.style.cursor = 'grab';
    ui.setSceneTooltip(null);
  }

  CANVAS.style.cursor = 'grab';
  CANVAS.tabIndex = 0;
  CANVAS.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (showcaseLocked()) return;
    CANVAS.focus({ preventScroll: true });
    pointerDownOnCanvas = true;
    pointerMoved = false;
    pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    cancelCameraTween();
    if (autoOrbit) setAutoOrbit(false, false);
    ui.setSceneTooltip(null);
    CANVAS.style.cursor = 'grabbing';
  });

  function cancelCameraTween(): void {
    cameraTween = null;
  }

  window.addEventListener('pointermove', (event) => {
    if (showcaseLocked()) return;
    if (pointerDownOnCanvas) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (!pointerMoved && dx * dx + dy * dy > 16) {
        pointerMoved = true;
        clearHover();
      }
      return;
    }
    if (event.target === CANVAS) scheduleHover(event.clientX, event.clientY);
    else if (hoverObjectId) clearHover();
  });

  window.addEventListener('pointerup', (event) => {
    if (showcaseLocked()) {
      pointerDownOnCanvas = false;
      return;
    }
    if (!pointerDownOnCanvas) return;
    pointerDownOnCanvas = false;
    const wasClick = !pointerMoved && performance.now() - pointerStart.time < 600;
    CANVAS.style.cursor = 'grab';
    if (wasClick && event.target === CANVAS) {
      const hit = pickAt(event.clientX, event.clientY);
      selectObject(hit?.id ?? null);
      if (hit) scheduleHover(event.clientX, event.clientY);
    }
  });

  CANVAS.addEventListener('wheel', () => {
    if (showcaseLocked()) return;
    cancelCameraTween();
    if (autoOrbit) setAutoOrbit(false, false);
  }, { passive: true });

  CANVAS.addEventListener('pointerleave', clearHover);

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const inField = target?.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === 'Escape') {
      if (ui.hasSelection()) selectObject(null);
      else if (ui.hasOpenPanel()) ui.closePanels();
      return;
    }
    if (inField) return;
    const onButton = target?.closest('button, a');
    if (showcaseLocked()) {
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        showcase.toggleUiHidden();
        return;
      }
      if (event.code === 'Space' && !onButton) {
        event.preventDefault();
        showcase.togglePause();
        return;
      }
      if (/^[1-9]$/.test(event.key) || event.key.toLowerCase() === 'r') {
        lockedToast();
        return;
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'r') {
      if (autoOrbit) setAutoOrbit(false, false);
      cameraTween = null;
      deps.applyView('default', true);
      ui.toast('已恢复默认视角');
      return;
    }
    if (event.code === 'Space') {
      if (onButton) return;
      event.preventDefault();
      setAutoOrbit(!autoOrbit);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const view = VIEW_ORDER[Number(event.key) - 1];
      if (view) goToView(view);
    }
  });

  // --- frame listener & sync -------------------------------------------------
  deps.setViewChangeListener((name) => {
    viewState = name;
    cameraTween = null;
    syncUi();
    scheduleSave();
  });

  deps.setFrameListener((dt) => {
    const now = performance.now();
    const realDt = lastFrameTime
      ? Math.min(0.5, (now - lastFrameTime) / 1000)
      : Math.min(dt, 0.05);
    lastFrameTime = now;
    if (showcase?.isActive()) {
      showcase.tick(realDt);
      return;
    }
    stepCameraTween(now);
    if (wheelSpin > 0.05) {
      wheelSpin = Math.max(0, wheelSpin - realDt * 130);
      workstation.spinWheel(wheelSpin * realDt);
    }
    // 自动环绕按真实时间推进，避免无头环境低帧率时几乎不动；
    // 在正面 ±68° 弧内往返，既能看到环绕感，也不会穿到隔间背墙后。
    if (autoOrbit && !cameraTween) {
      const target = controls.target;
      const offset = camera.position.clone().sub(target);
      const radius = Math.hypot(offset.x, offset.z);
      if (radius > 0.05) {
        let azimuth = Math.atan2(offset.x, offset.z);
        const limit = THREE.MathUtils.degToRad(68);
        azimuth += autoOrbitDirection * 0.16 * realDt;
        if (azimuth > limit) {
          azimuth = limit;
          autoOrbitDirection = -1;
        } else if (azimuth < -limit) {
          azimuth = -limit;
          autoOrbitDirection = 1;
        }
        camera.position.x = target.x + Math.sin(azimuth) * radius;
        camera.position.z = target.z + Math.cos(azimuth) * radius;
      }
    }
  });
  controls.addEventListener('start', () => {
    cameraTween = null;
    if (autoOrbit) setAutoOrbit(false, false);
  });

  // --- boot ------------------------------------------------------------------
  function boot(): void {
    const persisted = readPersisted();
    if (persisted) {
      applyScene(persisted.scene, true);
      rgbMode = persisted.rgbMode;
      rgbColor = persisted.rgbColor;
      if (rgbMode !== 'off') lastRgbMode = rgbMode;
      screenPower = persisted.screenPower;
      screenContent = persisted.screenContent;
      lidClosed = persisted.lidClosed;
      tidy = persisted.tidy;
      hiddenDecor.clear();
      for (const id of persisted.hiddenDecor) hiddenDecor.add(id);
      workstation.setKeyboardRgb(rgbMode);
      workstation.setKeyboardRgbColor(rgbColor);
      workstation.setScreenPower(screenPower);
      workstation.setScreenContent(screenContent);
      if (lidClosed) workstation.closeLaptop();
      if (persisted.lightingCustom) {
        activeScene = 'custom';
        lighting = persisted.lighting;
      } else {
        lighting = { master: true, ambient: 1, level: 1 };
      }
      applyLighting();
      applyDecorVisibility();
      deps.applyView(persisted.view ?? 'default', false);
    } else {
      applyScene('day', true);
      deps.applyView('default', false);
    }
    ready = true;
    syncUi();
    refreshInspector();
    refreshHighlight();
    scheduleSave();
    deps.render();
  }

  window.addEventListener('beforeunload', persistNow);
  boot();

  const automation: WorkbenchAutomation = {
    setScene: (id) => applyScene(id),
    setScreenPower: (on) => {
      if (screenPower !== on) toggleScreenPower();
    },
    setScreenContent: (content) => setScreenContentValue(content),
    setKeyboardRgb: (mode) => setRgbModeValue(mode),
    setKeyboardRgbColor: (color) => setRgbColorValue(color),
    setLighting: (patch) => handleLighting(patch),
    getUiState: () => getUiState(),
    selectObject: (id) => selectObject(id),
    focusObject: (id) => focusObject(id),
    toggleAutoOrbit: () => setAutoOrbit(!autoOrbit),
    showcase: {
      start: () => showcase.start(),
      pause: () => showcase.pause(),
      resume: () => showcase.resume(),
      togglePause: () => showcase.togglePause(),
      next: () => showcase.nextChapter(),
      restart: () => showcase.restart(),
      exit: () => showcase.exit(),
      seek: (seconds) => showcase.seek(seconds),
      setUiHidden: (hidden) => showcase.setUiHidden(hidden),
      toggleUiHidden: () => showcase.toggleUiHidden(),
      getState: () => showcase.getState(),
      isActive: () => showcase.isActive(),
    },
  };

  return { automation };
}
