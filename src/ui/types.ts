export type ViewId =
  | 'default'
  | 'front'
  | 'under'
  | 'left'
  | 'right'
  | 'overhead'
  | 'keyboard'
  | 'laptop'
  | 'firstPerson'
  | 'panorama'
  | 'monitor';

export type RgbMode = 'off' | 'static' | 'rainbow' | 'breathe' | 'soft';
export type ScreenContent = 'dashboard' | 'code' | 'terminal' | 'desktop' | 'focus';
export type SceneId = 'day' | 'night' | 'focus' | 'rgb';
export type ActiveSceneId = SceneId | 'custom';
export type UiTheme = 'light' | 'dark';

export type ShowcaseStatus = 'idle' | 'playing' | 'paused' | 'finished' | 'stopped';
export type ShowcaseCaption = 'none' | 'intro' | 'outro';

export type ShowcaseUiState = {
  status: ShowcaseStatus;
  chapterIndex: number;
  chapterCount: number;
  chapterTitle: string;
  chapterSubtitle: string;
  /** 底部白色实时功能字幕。 */
  subtitle: string;
  elapsed: number;
  total: number;
  progress: number;
  caption: ShowcaseCaption;
  uiHidden: boolean;
  hideOnStart: boolean;
};

export type LightingState = {
  master: boolean;
  /** 环境光倍率，1 表示预设值。 */
  ambient: number;
  /** 整体灯光倍率，1 表示预设值。 */
  level: number;
};

export type UiState = {
  view: ViewId | null;
  autoOrbit: boolean;
  scene: ActiveSceneId;
  theme: UiTheme;
  rgbMode: RgbMode;
  rgbColor: string;
  screenPower: boolean;
  screenContent: ScreenContent;
  lidClosed: boolean;
  lighting: LightingState;
  selectedObjectId: string | null;
  tidy: boolean;
  hiddenDecor: string[];
};

export type IconName =
  | 'view'
  | 'objects'
  | 'light'
  | 'scenes'
  | 'eye'
  | 'eyeOff'
  | 'box'
  | 'sun'
  | 'moon'
  | 'focus'
  | 'sparkles'
  | 'rotate'
  | 'reset'
  | 'play'
  | 'pause'
  | 'monitor'
  | 'laptop'
  | 'keyboard'
  | 'mouse'
  | 'chair'
  | 'book'
  | 'cup'
  | 'bottle'
  | 'trash'
  | 'backpack'
  | 'power'
  | 'lid'
  | 'sliders'
  | 'close'
  | 'check'
  | 'help'
  | 'chevron'
  | 'wind'
  | 'grid'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'seat'
  | 'broom'
  | 'palette'
  | 'clapper'
  | 'skip'
  | 'replay'
  | 'hide'
  | 'github'
  | 'douyin'
  | 'xiaohongshu'
  | 'volume'
  | 'volumeOff';

export type ViewOption = {
  id: ViewId;
  label: string;
  icon: IconName;
  tip: string;
};

export type ObjectSummary = {
  id: string;
  label: string;
  icon: IconName;
};

export type DecorOption = {
  id: string;
  label: string;
  icon: IconName;
};

export type ObjectAction = {
  id: string;
  label: string;
  icon?: IconName;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'primary';
};

export type ObjectChoice = {
  id: string;
  label: string;
  active?: boolean;
  color?: string;
};

export type ObjectChoiceGroup = {
  label: string;
  options: ObjectChoice[];
};

export type ObjectMeta = {
  id: string;
  label: string;
  icon: IconName;
  description: string;
  status?: string;
  actions: ObjectAction[];
  choices?: ObjectChoiceGroup[];
};

export type ShortcutHint = {
  keys: string;
  label: string;
};

export type ControlCallbacks = {
  onView: (id: ViewId) => void;
  onResetView: () => void;
  onAutoOrbit: () => void;
  onSelectObject: (id: string | null) => void;
  onObjectAction: (objectId: string, actionId: string) => void;
  onDecorToggle: (id: string) => void;
  onTidyToggle: () => void;
  onScene: (id: SceneId) => void;
  onRgbMode: (mode: RgbMode) => void;
  onRgbColor: (color: string) => void;
  onRgbToggle: () => void;
  onScreenPower: () => void;
  onLidToggle: () => void;
  onLighting: (patch: Partial<LightingState>) => void;
  onShowcaseStart: () => void;
  onShowcasePause: () => void;
  onShowcaseNext: () => void;
  onShowcaseReplay: () => void;
  onShowcaseExit: () => void;
  onShowcaseToggleUi: () => void;
  onShowcaseHideOnStart: (enabled: boolean) => void;
  onMusicToggle: () => void;
  onMusicVolume: (volume: number) => void;
  onIntroReplay: () => void;
};

export type ControlPanelOptions = {
  views: ViewOption[];
  objects: ObjectSummary[];
  decor: DecorOption[];
  shortcuts: ShortcutHint[];
  rgbColors: { value: string; label: string }[];
  callbacks: ControlCallbacks;
};

export const SCREEN_CONTENT_LABELS: Record<ScreenContent, string> = {
  dashboard: '仪表盘',
  code: '代码',
  terminal: '终端',
  desktop: '桌面',
  focus: '专注',
};

export const RGB_MODE_LABELS: Record<RgbMode, string> = {
  off: '关闭',
  static: '单色',
  rainbow: '彩虹',
  breathe: '呼吸',
  soft: '柔光',
};

export const SCENE_LABELS: Record<ActiveSceneId, string> = {
  day: '白天模式',
  night: '深夜模式',
  focus: '专注模式',
  rgb: 'RGB 氛围',
  custom: '自定义光照',
};

export const SCENE_DESCRIPTIONS: Record<SceneId, string> = {
  day: '自然明亮，适合日常查看与截图',
  night: '压低环境光，让双屏成为视觉焦点',
  focus: '收敛周边亮度，突出屏幕与工作区',
  rgb: '键盘与屏幕形成克制的彩色氛围',
};
