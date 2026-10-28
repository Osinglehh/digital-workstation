import './controlPanel.css';
import { icon } from './icons';
import {
  RGB_MODE_LABELS,
  SCENE_DESCRIPTIONS,
  SCENE_LABELS,
} from './types';
import type {
  ControlCallbacks,
  ControlPanelOptions,
  ObjectAction,
  ObjectMeta,
  RgbMode,
  SceneId,
  ShowcaseCaption,
  ShowcaseStatus,
  ShowcaseUiState,
  UiState,
  ViewId,
} from './types';

const VIEW_SECTION = 'view';
const OBJECT_SECTION = 'objects';
const LIGHT_SECTION = 'lighting';
const SCENE_SECTION = 'scenes';
const SHOWCASE_SECTION = 'showcase';
const HELP_SECTION = 'help';

type SectionName =
  | typeof VIEW_SECTION
  | typeof OBJECT_SECTION
  | typeof LIGHT_SECTION
  | typeof SCENE_SECTION
  | typeof SHOWCASE_SECTION
  | typeof HELP_SECTION;

const SHOWCASE_STATUS_LABELS: Record<ShowcaseStatus, string> = {
  idle: '待机',
  playing: '正在播放',
  paused: '已暂停',
  finished: '已完成',
  stopped: '已退出',
};

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeButton(className: string, html: string, tip?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = html;
  if (tip) button.dataset.tip = tip;
  return button;
}

function closeButton(label: string): HTMLButtonElement {
  const button = makeButton('icon-button', icon('close', 14), `关闭${label}`);
  button.setAttribute('aria-label', `关闭${label}`);
  return button;
}

export class ControlPanel {
  private readonly stage: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly options: ControlPanelOptions;
  private readonly callbacks: ControlCallbacks;

  private readonly tree: HTMLElement;
  private readonly treeToggle: HTMLButtonElement;
  private readonly sections = new Map<SectionName, { row: HTMLButtonElement; body: HTMLElement }>();
  private readonly viewButtons = new Map<ViewId, HTMLButtonElement>();
  private readonly objectButtons = new Map<string, HTMLButtonElement>();
  private readonly sceneButtons = new Map<SceneId, HTMLButtonElement>();
  private readonly rgbModeButtons = new Map<RgbMode, HTMLButtonElement>();
  private readonly swatchButtons = new Map<string, HTMLButtonElement>();
  private readonly decorButtons = new Map<string, HTMLButtonElement>();

  private readonly statusText: HTMLSpanElement;
  private readonly inspector: HTMLElement;
  private readonly inspectorBody: HTMLElement;
  private objectList: HTMLElement;
  private readonly sceneTooltip: HTMLElement;
  private readonly uiTooltip: HTMLElement;
  private readonly toastEl: HTMLElement;
  private helpButton: HTMLButtonElement;
  private autoButton: HTMLButtonElement;
  private masterSwitch: HTMLButtonElement;
  private rgbSwitch: HTMLButtonElement;
  private tidySwitch: HTMLButtonElement;
  private ambientRange: HTMLInputElement;
  private levelRange: HTMLInputElement;
  private ambientOutput: HTMLOutputElement;
  private levelOutput: HTMLOutputElement;

  private showcasePrimary!: HTMLButtonElement;
  private showcaseNext!: HTMLButtonElement;
  private showcaseReplay!: HTMLButtonElement;
  private showcaseExit!: HTMLButtonElement;
  private showcaseHide!: HTMLButtonElement;
  private showcaseHideOnStart!: HTMLButtonElement;
  private showcaseStatusText!: HTMLSpanElement;
  private showcaseChapter!: HTMLSpanElement;
  private showcaseClock!: HTMLSpanElement;
  private showcaseSubtitle!: HTMLSpanElement;
  private showcasePercent!: HTMLSpanElement;
  private showcaseFill!: HTMLSpanElement;
  private showcaseTrack!: HTMLDivElement;
  private showcaseCaption!: HTMLElement;
  private showcaseCaptionKicker!: HTMLElement;
  private showcaseCaptionSub!: HTMLElement;
  private showcaseLive!: HTMLElement;
  private restoreButton!: HTMLButtonElement;
  private showcaseState: ShowcaseUiState = {
    status: 'idle',
    chapterIndex: 0,
    chapterCount: 7,
    chapterTitle: '整体亮相',
    chapterSubtitle: '点击开始展示，播放完整的工位演出',
    subtitle: '',
    elapsed: 0,
    total: 45,
    progress: 0,
    caption: 'none',
    uiHidden: false,
    hideOnStart: false,
  };
  private captionMode: ShowcaseCaption = 'none';

  private readonly openSections = new Set<SectionName>();
  private selectedMeta: ObjectMeta | null = null;
  private lastAutoOrbit = false;
  private toastTimer = 0;
  private uiTipTarget: HTMLElement | null = null;

  private state: UiState = {
    view: null,
    autoOrbit: false,
    scene: 'day',
    theme: 'light',
    rgbMode: 'rainbow',
    rgbColor: '#2BD8FF',
    screenPower: true,
    screenContent: 'dashboard',
    lidClosed: false,
    lighting: { master: true, ambient: 1, level: 1 },
    selectedObjectId: null,
    tidy: false,
    hiddenDecor: [],
  };

  constructor(stage: HTMLElement, options: ControlPanelOptions) {
    this.stage = stage;
    this.options = options;
    this.callbacks = options.callbacks;

    this.root = make('div', 'stage-ui');
    this.root.setAttribute('data-workstation-ui', 'true');

    // ---- 设计树外壳 -----------------------------------------------------------
    this.tree = make('section', 'design-tree');
    this.tree.setAttribute('aria-label', '工位设计树');

    const head = make('div', 'tree-head');
    const brand = make('div', 'tree-brand');
    const mark = make('div', 'brand-mark tree-mark');
    mark.innerHTML = icon('box', 15);
    const brandCopy = make('div', 'tree-brand-copy');
    brandCopy.append(
      make('h1', undefined, '数字工位'),
      make('p', undefined, 'FeatureManager · 设计树'),
    );
    brand.append(mark, brandCopy);
    this.treeToggle = makeButton('tree-collapse', icon('chevron', 15), '收起设计树');
    this.treeToggle.setAttribute('aria-label', '收起设计树');
    this.treeToggle.setAttribute('aria-expanded', 'true');
    this.treeToggle.addEventListener('click', () => {
      this.setTreeCollapsed(!this.tree.classList.contains('is-collapsed'));
    });
    head.append(brand, this.treeToggle);

    const doc = make('div', 'tree-doc');
    const docName = make('span', 'tree-doc-name');
    docName.innerHTML = `${icon('box', 12)}<span>工作位装配体</span>`;
    const docBadges = make('span', 'tree-doc-badges');
    docBadges.append(make('span', 'tree-badge', '84 组件'), make('span', 'tree-badge', '33 材质'));
    doc.append(docName, docBadges);

    const treeBody = make('div', 'tree-body');
    const rootRow = make('div', 'tree-root');
    rootRow.innerHTML = `${icon('box', 13)}<span>数字工位装配体</span><span class="tree-count">84</span>`;

    // 物体检查器是设计树里的选中节点，而不是右侧浮窗。
    this.inspector = make('aside', 'object-inspector tree-selection');
    this.inspector.setAttribute('aria-label', '物体操作');
    this.inspector.hidden = true;
    this.inspectorBody = make('div', 'inspector-body');
    this.inspector.append(this.inspectorBody);

    const children = make('div', 'tree-children');
    children.append(
      this.buildViewSection(),
      this.buildObjectSection(),
      this.buildLightingSection(),
      this.buildSceneSection(),
      this.buildShowcaseSection(),
      this.buildHelpSection(),
    );
    treeBody.append(rootRow, children);

    const foot = make('div', 'tree-foot');
    const footStatus = make('span', 'tree-status');
    footStatus.append(make('span', 'status-dot'));
    this.statusText = make('span', 'tree-status-text', SCENE_LABELS.day);
    this.statusText.setAttribute('aria-live', 'polite');
    footStatus.append(this.statusText);
    foot.append(footStatus, make('span', 'tree-hint', '拖动 · 滚轮 · 点击'));
    this.tree.append(head, doc, treeBody, foot);

    // ---- 瞬时图层 -------------------------------------------------------------
    this.sceneTooltip = make('div', 'scene-tooltip');
    this.sceneTooltip.hidden = true;
    this.uiTooltip = make('div', 'scene-tooltip ui-tooltip');
    this.uiTooltip.hidden = true;
    this.toastEl = make('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.toastEl.hidden = true;

    // 录制用的纯净画面：隐藏整棵树后只保留一个轻量恢复入口。
    this.restoreButton = makeButton(
      'tree-restore',
      icon('eye', 13),
      '显示控件栏 · 快捷键 H',
    );
    this.restoreButton.setAttribute('aria-label', '显示控件栏');
    this.restoreButton.hidden = true;
    this.restoreButton.addEventListener('click', () => this.callbacks.onShowcaseToggleUi());

    this.showcaseCaption = make('div', 'showcase-caption');
    this.showcaseCaption.setAttribute('aria-live', 'polite');
    this.showcaseCaptionKicker = make('p', 'showcase-caption-kicker', 'OFFICE CUBICLE · INTERACTIVE SHOWCASE');
    const captionTitle = make('h2', 'showcase-caption-title', '我的 3D 数字工位');
    this.showcaseCaptionSub = make('p', 'showcase-caption-sub', 'A Personal Interactive Workspace');
    this.showcaseCaption.append(this.showcaseCaptionKicker, captionTitle, this.showcaseCaptionSub);

    // 底部白色实时功能字幕；与开场/结尾标题分开，播放全程可读。
    this.showcaseLive = make('div', 'showcase-live');
    this.showcaseLive.setAttribute('aria-live', 'polite');

    this.root.append(
      this.tree,
      this.restoreButton,
      this.showcaseCaption,
      this.showcaseLive,
      this.sceneTooltip,
      this.uiTooltip,
      this.toastEl,
    );
    this.stage.append(this.root);
    this.bindTooltipEvents();
  }

  // ---------------------------------------------------------------------------
  // 设计树节点
  // ---------------------------------------------------------------------------
  private buildSection(
    name: SectionName,
    label: string,
    iconName: Parameters<typeof icon>[0],
    subtitle: string,
    body: HTMLElement,
    count?: string,
  ): HTMLElement {
    const node = make('section', 'tree-node');
    node.dataset.node = name;
    const row = makeButton(
      'tree-row dock-group',
      `<span class="tree-chevron">${icon('chevron', 12)}</span>`
        + `<span class="tree-node-icon">${icon(iconName, 14)}</span>`
        + `<span class="tree-label">${label}</span>`
        + (count ? `<span class="tree-count">${count}</span>` : ''),
      `${label}面板`,
    );
    row.setAttribute('aria-label', label);
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-controls', `ws-section-${name}`);

    const content = make('div', 'tree-node-body');
    content.id = `ws-section-${name}`;
    content.hidden = true;
    const inner = make('div', 'tree-node-content');
    inner.append(make('p', 'tree-node-desc', subtitle), body);
    content.append(inner);
    node.append(row, content);

    row.addEventListener('click', () => this.setSectionOpen(name, content.hidden));
    this.sections.set(name, { row, body: content });
    return node;
  }

  private setSectionOpen(name: SectionName, open: boolean): void {
    const section = this.sections.get(name);
    if (!section) return;
    section.body.hidden = !open;
    section.row.setAttribute('aria-expanded', String(open));
    if (open) {
      this.openSections.add(name);
      this.setTreeCollapsed(false);
    } else {
      this.openSections.delete(name);
    }
    this.hideUiTooltip();
  }

  private setTreeCollapsed(collapsed: boolean): void {
    this.tree.classList.toggle('is-collapsed', collapsed);
    this.treeToggle.setAttribute('aria-expanded', String(!collapsed));
    this.treeToggle.setAttribute('aria-label', collapsed ? '展开设计树' : '收起设计树');
    this.treeToggle.dataset.tip = collapsed ? '展开设计树' : '收起设计树';
    this.treeToggle.innerHTML = icon('chevron', 15);
    this.hideUiTooltip();
  }

  private buildViewSection(): HTMLElement {
    const body = make('div');
    const list = make('div', 'tree-list view-list');
    this.options.views.forEach((view, index) => {
      const shortcut = index < 9 ? String(index + 1) : '';
      const button = makeButton(
        'tree-leaf view-item',
        `<span class="tree-shortcut" aria-hidden="true">${shortcut}</span>`
          + `${icon(view.icon, 13)}<span>${view.label}</span>`,
        view.tip,
      );
      button.dataset.view = view.id;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.callbacks.onView(view.id));
      this.viewButtons.set(view.id, button);
      list.append(button);
    });

    const actions = make('div', 'tree-actions');
    this.autoButton = makeButton(
      'tree-leaf tree-action',
      `${icon('play', 13)}<span>自动环绕</span>`,
      '开启后镜头缓慢环绕工位',
    );
    this.autoButton.setAttribute('aria-pressed', 'false');
    this.autoButton.addEventListener('click', () => this.callbacks.onAutoOrbit());
    const reset = makeButton(
      'tree-leaf tree-action',
      `${icon('reset', 13)}<span>恢复默认视角</span>`,
      '回到初始工位全景，快捷键 R',
    );
    reset.addEventListener('click', () => this.callbacks.onResetView());
    actions.append(this.autoButton, reset);
    body.append(list, actions);
    return this.buildSection(
      VIEW_SECTION,
      '视角',
      'view',
      '数字键 1–9 快速切换，切换过程带缓动。',
      body,
      String(this.options.views.length),
    );
  }

  private buildObjectSection(): HTMLElement {
    const body = make('div');
    const list = make('div', 'tree-list object-tree');
    this.objectList = list;
    for (const object of this.options.objects) {
      const button = makeButton(
        'tree-leaf object-item',
        `${icon(object.icon, 13)}<span>${object.label}</span>`,
        `查看${object.label}的操作`,
      );
      button.dataset.object = object.id;
      button.setAttribute('aria-label', object.label);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.callbacks.onSelectObject(object.id));
      this.objectButtons.set(object.id, button);
      list.append(button);
    }
    list.append(this.inspector);

    const tidyHead = make('div', 'panel-subhead', '桌面整理');
    const tidyRow = make('div', 'switch-row');
    const tidyCopy = make('div', 'switch-copy');
    tidyCopy.append(
      make('strong', undefined, '收起桌面陈设'),
      make('span', undefined, '收起纸品、笔袋、水杯与水壶，保留主设备。'),
    );
    this.tidySwitch = makeButton('ui-switch', '', '切换桌面整理');
    this.tidySwitch.setAttribute('role', 'switch');
    this.tidySwitch.setAttribute('aria-checked', 'false');
    this.tidySwitch.setAttribute('aria-label', '桌面整理');
    this.tidySwitch.addEventListener('click', () => this.callbacks.onTidyToggle());
    tidyRow.append(tidyCopy, this.tidySwitch);

    const decorHead = make('div', 'panel-subhead', '装饰物显隐');
    const decorGrid = make('div', 'decor-grid');
    for (const decor of this.options.decor) {
      const chip = makeButton('chip', `${icon(decor.icon, 12)}<span>${decor.label}</span>`);
      chip.setAttribute('aria-pressed', 'true');
      chip.setAttribute('aria-label', `显示或隐藏${decor.label}`);
      chip.addEventListener('click', () => this.callbacks.onDecorToggle(decor.id));
      this.decorButtons.set(decor.id, chip);
      decorGrid.append(chip);
    }
    body.append(list, tidyHead, tidyRow, decorHead, decorGrid);
    return this.buildSection(
      OBJECT_SECTION,
      '物品',
      'objects',
      '点击场景中的物体，或展开下面的对象列表。',
      body,
      String(this.options.objects.length),
    );
  }

  private buildLightingSection(): HTMLElement {
    const body = make('div');

    const masterRow = make('div', 'switch-row');
    const masterCopy = make('div', 'switch-copy');
    masterCopy.append(
      make('strong', undefined, '主灯'),
      make('span', undefined, '关闭后仅保留屏幕、键盘与少量环境光。'),
    );
    this.masterSwitch = makeButton('ui-switch', '', '切换主灯');
    this.masterSwitch.setAttribute('role', 'switch');
    this.masterSwitch.setAttribute('aria-checked', 'true');
    this.masterSwitch.setAttribute('aria-label', '主灯');
    this.masterSwitch.addEventListener('click', () => {
      this.callbacks.onLighting({ master: this.masterSwitch.getAttribute('aria-checked') !== 'true' });
    });
    masterRow.append(masterCopy, this.masterSwitch);

    const ambientRow = make('div', 'slider-row');
    const ambientLabel = make('label', undefined, '环境光');
    this.ambientRange = make('input', 'ui-range');
    this.ambientRange.type = 'range';
    this.ambientRange.min = '0';
    this.ambientRange.max = '150';
    this.ambientRange.step = '1';
    this.ambientRange.value = '100';
    this.ambientRange.setAttribute('aria-label', '环境光强度');
    this.ambientOutput = make('output', undefined, '100%');
    this.ambientRange.addEventListener('input', () => {
      const value = Number(this.ambientRange.value) / 100;
      this.setRangeFill(this.ambientRange);
      this.ambientOutput.textContent = `${Math.round(value * 100)}%`;
      this.callbacks.onLighting({ ambient: value });
    });
    ambientRow.append(ambientLabel, this.ambientRange, this.ambientOutput);

    const levelRow = make('div', 'slider-row');
    const levelLabel = make('label', undefined, '整体亮度');
    this.levelRange = make('input', 'ui-range');
    this.levelRange.type = 'range';
    this.levelRange.min = '60';
    this.levelRange.max = '140';
    this.levelRange.step = '1';
    this.levelRange.value = '100';
    this.levelRange.setAttribute('aria-label', '整体亮度');
    this.levelOutput = make('output', undefined, '100%');
    this.levelRange.addEventListener('input', () => {
      const value = Number(this.levelRange.value) / 100;
      this.setRangeFill(this.levelRange);
      this.levelOutput.textContent = `${Math.round(value * 100)}%`;
      this.callbacks.onLighting({ level: value });
    });
    levelRow.append(levelLabel, this.levelRange, this.levelOutput);

    const rgbRow = make('div', 'switch-row');
    const rgbCopy = make('div', 'switch-copy');
    rgbCopy.append(
      make('strong', undefined, '键盘 RGB'),
      make('span', undefined, '键缝透光 + 桌面溢光，五种灯效共用一组更新。'),
    );
    this.rgbSwitch = makeButton('ui-switch', '', '切换键盘 RGB');
    this.rgbSwitch.setAttribute('role', 'switch');
    this.rgbSwitch.setAttribute('aria-checked', 'true');
    this.rgbSwitch.setAttribute('aria-label', '键盘 RGB');
    this.rgbSwitch.addEventListener('click', () => this.callbacks.onRgbToggle());
    rgbRow.append(rgbCopy, this.rgbSwitch);

    const modeLabel = make('div', 'choice-label', '灯效模式');
    const modeRow = make('div', 'choice-row');
    const modes: RgbMode[] = ['static', 'rainbow', 'breathe', 'soft'];
    for (const mode of modes) {
      const chip = makeButton('chip', `<span>${RGB_MODE_LABELS[mode]}</span>`);
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => this.callbacks.onRgbMode(mode));
      this.rgbModeButtons.set(mode, chip);
      modeRow.append(chip);
    }

    const swatchLabel = make('div', 'choice-label', '单色配色');
    const swatchRow = make('div', 'swatches');
    for (const color of this.options.rgbColors) {
      const swatch = makeButton('swatch', '', color.label);
      swatch.style.setProperty('--swatch', color.value);
      swatch.setAttribute('aria-label', `${color.label}键盘灯`);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.addEventListener('click', () => this.callbacks.onRgbColor(color.value));
      this.swatchButtons.set(color.value, swatch);
      swatchRow.append(swatch);
    }

    const note = make('p', 'panel-note', '场景中没有独立台灯，这里只调节现有环境光、主光、屏幕辉光与键盘灯效。');
    const lightingGrid = make('div', 'lighting-grid');
    const lightingLeft = make('div', 'lighting-col');
    const lightingRight = make('div', 'lighting-col');
    lightingLeft.append(masterRow, ambientRow, levelRow);
    lightingRight.append(rgbRow, modeLabel, modeRow, swatchLabel, swatchRow);
    lightingGrid.append(lightingLeft, lightingRight);
    body.append(lightingGrid, note);
    this.setRangeFill(this.ambientRange);
    this.setRangeFill(this.levelRange);
    return this.buildSection(
      LIGHT_SECTION,
      '灯光',
      'light',
      '场景预设会重置倍率，手动调整后进入自定义光照。',
      body,
    );
  }

  private buildSceneSection(): HTMLElement {
    const body = make('div');
    const grid = make('div', 'scene-grid');
    const defs: { id: SceneId; icon: Parameters<typeof icon>[0] }[] = [
      { id: 'day', icon: 'sun' },
      { id: 'night', icon: 'moon' },
      { id: 'focus', icon: 'focus' },
      { id: 'rgb', icon: 'sparkles' },
    ];
    for (const def of defs) {
      const card = make('button', 'scene-card');
      card.type = 'button';
      card.dataset.scene = def.id;
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML = `<span class="scene-icon">${icon(def.icon, 15)}</span><span><strong>${SCENE_LABELS[def.id]}</strong><span>${SCENE_DESCRIPTIONS[def.id]}</span></span>`;
      card.addEventListener('click', () => this.callbacks.onScene(def.id));
      this.sceneButtons.set(def.id, card);
      grid.append(card);
    }
    body.append(grid, make('p', 'panel-note', '一次应用灯光、屏幕内容、键盘灯效与界面主题；视角不会被强制切换。'));
    return this.buildSection(
      SCENE_SECTION,
      '场景',
      'scenes',
      '四种预设覆盖白天、深夜、专注与彩色氛围。',
      body,
      '4',
    );
  }

  private buildShowcaseSection(): HTMLElement {
    const body = make('div', 'showcase-panel');

    const stateRow = make('div', 'showcase-state');
    const dot = make('span', 'showcase-state-dot');
    dot.setAttribute('aria-hidden', 'true');
    this.showcaseStatusText = make('span', 'showcase-state-label', '待机');
    this.showcaseStatusText.setAttribute('aria-live', 'polite');
    const meta = make('span', 'showcase-state-meta', '7 幕 · 00:45');
    stateRow.append(dot, this.showcaseStatusText, meta);

    this.showcasePrimary = makeButton(
      'showcase-primary',
      `${icon('play', 13)}<span>开始展示</span>`,
      '播放完整的 7 幕工位演出',
    );
    this.showcasePrimary.setAttribute('aria-label', '开始展示');
    this.showcasePrimary.addEventListener('click', () => {
      const status = this.showcaseState.status;
      if (status === 'idle' || status === 'stopped') this.callbacks.onShowcaseStart();
      else if (status === 'playing' || status === 'paused') this.callbacks.onShowcasePause();
    });

    const progress = make('div', 'showcase-progress');
    const head = make('div', 'showcase-progress-head');
    this.showcaseChapter = make('span', 'showcase-chapter', '01 / 07 · 整体亮相');
    this.showcaseClock = make('span', 'showcase-clock', '00:00 / 00:45');
    head.append(this.showcaseChapter, this.showcaseClock);
    this.showcaseTrack = make('div', 'showcase-track');
    this.showcaseTrack.setAttribute('role', 'progressbar');
    this.showcaseTrack.setAttribute('aria-label', '展示进度');
    this.showcaseTrack.setAttribute('aria-valuemin', '0');
    this.showcaseTrack.setAttribute('aria-valuemax', '100');
    this.showcaseTrack.setAttribute('aria-valuenow', '0');
    this.showcaseFill = make('span', 'showcase-fill');
    this.showcaseTrack.append(this.showcaseFill);
    const foot = make('div', 'showcase-progress-foot');
    this.showcaseSubtitle = make('span', 'showcase-subtitle', '点击开始展示，播放完整的工位演出');
    this.showcasePercent = make('span', 'showcase-percent', '0%');
    foot.append(this.showcaseSubtitle, this.showcasePercent);
    progress.append(head, this.showcaseTrack, foot);

    const hideRow = make('div', 'switch-row showcase-hide-row');
    const hideCopy = make('div', 'switch-copy');
    hideCopy.append(
      make('strong', undefined, '展示时隐藏设计树'),
      make('span', undefined, '开启后开始展示即隐藏；演示继续，按 H 或左上角图标恢复。'),
    );
    this.showcaseHideOnStart = makeButton('ui-switch', '', '切换展示时隐藏设计树');
    this.showcaseHideOnStart.setAttribute('role', 'switch');
    this.showcaseHideOnStart.setAttribute('aria-checked', 'false');
    this.showcaseHideOnStart.setAttribute('aria-label', '展示时隐藏设计树');
    this.showcaseHideOnStart.addEventListener('click', () => {
      const next = this.showcaseHideOnStart.getAttribute('aria-checked') !== 'true';
      this.callbacks.onShowcaseHideOnStart(next);
    });
    hideRow.append(hideCopy, this.showcaseHideOnStart);

    const actions = make('div', 'showcase-actions');
    this.showcaseNext = makeButton(
      'tree-leaf showcase-action',
      `${icon('skip', 13)}<span>下一章节</span>`,
      '立即跳到下一幕并继续',
    );
    this.showcaseReplay = makeButton(
      'tree-leaf showcase-action',
      `${icon('replay', 13)}<span>重新播放</span>`,
      '清理当前演出并从第一幕重播',
    );
    this.showcaseExit = makeButton(
      'tree-leaf showcase-action',
      `${icon('close', 13)}<span>退出展示</span>`,
      '停止演出并恢复演示前的场景与手动控制',
    );
    this.showcaseHide = makeButton(
      'tree-leaf showcase-action showcase-wide',
      `${icon('hide', 13)}<span>隐藏控件栏</span>`,
      '录制时隐藏设计树，演示继续播放；按 H 恢复',
    );
    this.showcaseNext.addEventListener('click', () => this.callbacks.onShowcaseNext());
    this.showcaseReplay.addEventListener('click', () => this.callbacks.onShowcaseReplay());
    this.showcaseExit.addEventListener('click', () => this.callbacks.onShowcaseExit());
    this.showcaseHide.addEventListener('click', () => this.callbacks.onShowcaseToggleUi());
    actions.append(this.showcaseNext, this.showcaseReplay, this.showcaseExit, this.showcaseHide);

    body.append(
      stateRow,
      this.showcasePrimary,
      progress,
      hideRow,
      actions,
      make('p', 'panel-note', '空格暂停 / 继续，H 隐藏或恢复控件栏；演示完成后自动恢复开始前的状态。'),
    );
    this.applyShowcaseState();
    return this.buildSection(
      SHOWCASE_SECTION,
      '自动展示',
      'clapper',
      '一键播放约 45 秒的 7 幕镜头、灯光与设备演出。',
      body,
      '7 幕',
    );
  }

  private buildHelpSection(): HTMLElement {
    const body = make('div');
    const list = make('div', 'shortcut-list');
    for (const shortcut of this.options.shortcuts) {
      const row = make('div', 'shortcut-row');
      row.append(make('span', undefined, shortcut.label));
      const keys = make('kbd', undefined, shortcut.keys);
      row.append(keys);
      list.append(row);
    }
    body.append(
      list,
      make('p', 'panel-note', '点击场景中的物体在设计树里展开操作节点，点击空白处或按 Esc 取消选择。'),
    );
    this.helpButton = makeButton('tree-row dock-group', `<span class="tree-chevron">${icon('chevron', 12)}</span><span class="tree-node-icon">${icon('help', 14)}</span><span class="tree-label">帮助</span>`, '快捷键与帮助');
    this.helpButton.setAttribute('aria-label', '帮助');
    this.helpButton.setAttribute('aria-expanded', 'false');
    this.helpButton.setAttribute('aria-controls', 'ws-section-help');
    const content = make('div', 'tree-node-body');
    content.id = 'ws-section-help';
    content.hidden = true;
    const inner = make('div', 'tree-node-content');
    inner.append(make('p', 'tree-node-desc', '快捷键只在焦点不位于输入控件时生效。'), body);
    content.append(inner);
    const node = make('section', 'tree-node');
    node.dataset.node = HELP_SECTION;
    node.append(this.helpButton, content);
    this.helpButton.addEventListener('click', () => this.setSectionOpen(HELP_SECTION, content.hidden));
    this.sections.set(HELP_SECTION, { row: this.helpButton, body: content });
    return node;
  }

  // ---------------------------------------------------------------------------
  // 状态同步
  // ---------------------------------------------------------------------------
  sync(state: UiState): void {
    this.state = state;
    document.documentElement.dataset.theme = state.theme;

    const viewLabel = state.view ? this.options.views.find((v) => v.id === state.view)?.label : null;
    const selected = state.selectedObjectId
      ? this.options.objects.find((o) => o.id === state.selectedObjectId)?.label
      : null;
    const parts = [SCENE_LABELS[state.scene]];
    if (viewLabel) parts.push(viewLabel);
    if (selected) parts.push(`已选 ${selected}`);
    if (state.autoOrbit) parts.push('环绕中');
    this.statusText.textContent = parts.join(' · ');
    this.statusText.title = parts.join(' · ');

    for (const [id, button] of this.viewButtons) {
      button.setAttribute('aria-pressed', String(state.view === id));
    }
    if (this.lastAutoOrbit !== state.autoOrbit) {
      this.lastAutoOrbit = state.autoOrbit;
      this.autoButton.innerHTML = `${icon(state.autoOrbit ? 'pause' : 'play', 13)}<span>${state.autoOrbit ? '暂停环绕' : '自动环绕'}</span>`;
      this.autoButton.dataset.tip = state.autoOrbit ? '暂停镜头环绕' : '开启后镜头缓慢环绕工位';
    }
    this.autoButton.setAttribute('aria-pressed', String(state.autoOrbit));

    for (const [id, button] of this.objectButtons) {
      button.setAttribute('aria-pressed', String(state.selectedObjectId === id));
    }
    for (const [id, button] of this.sceneButtons) {
      button.setAttribute('aria-pressed', String(state.scene === id));
    }

    this.masterSwitch.setAttribute('aria-checked', String(state.lighting.master));
    this.rgbSwitch.setAttribute('aria-checked', String(state.rgbMode !== 'off'));
    this.tidySwitch.setAttribute('aria-checked', String(state.tidy));

    const ambientPercent = Math.round(state.lighting.ambient * 100);
    const levelPercent = Math.round(state.lighting.level * 100);
    if (document.activeElement !== this.ambientRange) this.ambientRange.value = String(ambientPercent);
    if (document.activeElement !== this.levelRange) this.levelRange.value = String(levelPercent);
    this.ambientRange.style.setProperty(
      '--fill',
      `${Math.max(0, Math.min(100, (ambientPercent / 150) * 100))}%`,
    );
    this.levelRange.style.setProperty(
      '--fill',
      `${Math.max(0, Math.min(100, ((levelPercent - 60) / 80) * 100))}%`,
    );
    this.ambientOutput.textContent = `${ambientPercent}%`;
    this.levelOutput.textContent = `${levelPercent}%`;

    for (const [mode, button] of this.rgbModeButtons) {
      button.setAttribute('aria-pressed', String(state.rgbMode === mode));
    }
    for (const [color, button] of this.swatchButtons) {
      button.setAttribute('aria-pressed', String(state.rgbColor === color && state.rgbMode !== 'off'));
    }
    for (const [id, button] of this.decorButtons) {
      const visible = !state.hiddenDecor.includes(id);
      button.setAttribute('aria-pressed', String(visible));
      const label = this.options.decor.find((d) => d.id === id)?.label ?? id;
      button.innerHTML = `${icon(visible ? 'eye' : 'eyeOff', 12)}<span>${label}</span>`;
      button.dataset.tip = visible ? `隐藏${label}` : `显示${label}`;
    }
  }

  setShowcase(state: ShowcaseUiState): void {
    this.showcaseState = state;
    this.applyShowcaseState();
  }

  isTreeHidden(): boolean {
    return this.tree.classList.contains('is-hidden');
  }

  setTreeHidden(hidden: boolean): void {
    this.tree.classList.toggle('is-hidden', hidden);
    this.restoreButton.hidden = !hidden;
    if (hidden) {
      this.hideUiTooltip();
      this.setSceneTooltip(null);
      this.toastEl.hidden = true;
    }
  }

  private applyShowcaseState(): void {
    const state = this.showcaseState;
    const active = state.status === 'playing' || state.status === 'paused' || state.status === 'finished';
    const controllable = state.status === 'playing' || state.status === 'paused';

    this.showcaseStatusText.textContent = SHOWCASE_STATUS_LABELS[state.status];
    this.showcaseStatusText.dataset.status = state.status;

    let primaryLabel = '开始展示';
    let primaryIcon: Parameters<typeof icon>[0] = 'play';
    let primaryTip = '播放完整的 7 幕工位演出';
    let primaryDisabled = false;
    if (state.status === 'playing') {
      primaryLabel = '暂停';
      primaryIcon = 'pause';
      primaryTip = '暂停整条演示时间线';
    } else if (state.status === 'paused') {
      primaryLabel = '继续';
      primaryIcon = 'play';
      primaryTip = '从暂停位置继续播放';
    } else if (state.status === 'finished') {
      primaryLabel = '演示结束';
      primaryIcon = 'check';
      primaryTip = '即将自动恢复开始前的状态';
      primaryDisabled = true;
    }
    this.showcasePrimary.innerHTML = `${icon(primaryIcon, 13)}<span>${primaryLabel}</span>`;
    this.showcasePrimary.setAttribute('aria-label', primaryLabel);
    this.showcasePrimary.dataset.tip = primaryTip;
    this.showcasePrimary.disabled = primaryDisabled;

    const index = Math.min(state.chapterCount, Math.max(1, state.chapterIndex + 1));
    const pad = (value: number): string => String(value).padStart(2, '0');
    this.showcaseChapter.textContent = `${pad(index)} / ${pad(state.chapterCount)} · ${state.chapterTitle}`;
    this.showcaseClock.textContent = `${formatClock(state.elapsed)} / ${formatClock(state.total)}`;
    this.showcaseSubtitle.textContent = state.chapterSubtitle;
    const percent = Math.round(Math.min(1, Math.max(0, state.progress)) * 100);
    this.showcasePercent.textContent = `${percent}%`;
    this.showcaseFill.style.width = `${Math.min(100, Math.max(0, state.progress * 100))}%`;
    this.showcaseTrack.setAttribute('aria-valuenow', String(percent));

    this.showcaseNext.disabled = !controllable || state.chapterIndex >= state.chapterCount - 1;
    this.showcaseReplay.disabled = !active;
    this.showcaseExit.disabled = !active;
    this.showcaseHide.disabled = !active;
    this.showcaseHideOnStart.setAttribute('aria-checked', String(state.hideOnStart));

    if (this.showcaseLive) {
      const liveVisible = active && state.subtitle.trim().length > 0;
      if (this.showcaseLive.textContent !== state.subtitle) this.showcaseLive.textContent = state.subtitle;
      this.showcaseLive.classList.toggle('is-visible', liveVisible);
      this.showcaseLive.setAttribute('aria-hidden', String(!liveVisible));
    }

    this.setShowcaseCaption(state.caption);
  }

  private setShowcaseCaption(mode: ShowcaseCaption): void {
    if (this.captionMode === mode) return;
    this.captionMode = mode;
    const visible = mode !== 'none';
    this.showcaseCaption.classList.toggle('is-visible', visible);
    this.showcaseCaption.setAttribute('aria-hidden', String(!visible));
    if (mode === 'intro') {
      this.showcaseCaptionKicker.textContent = 'OFFICE CUBICLE · INTERACTIVE SHOWCASE';
      this.showcaseCaptionSub.textContent = '数字工位 · 沉浸式展示';
    } else if (mode === 'outro') {
      this.showcaseCaptionKicker.textContent = 'INTERACTIVE WORKSPACE';
      this.showcaseCaptionSub.textContent = 'A Personal Interactive Workspace';
    }
  }

  setInspector(meta: ObjectMeta | null): void {
    const previousId = this.selectedMeta?.id ?? null;
    this.selectedMeta = meta;
    this.inspectorBody.replaceChildren();
    if (!meta) {
      this.inspector.hidden = true;
      return;
    }
    const head = make('div', 'inspector-head');
    const iconBox = make('div', 'inspector-icon');
    iconBox.innerHTML = icon(meta.icon, 15);
    const copy = make('div', 'inspector-title');
    copy.append(make('h2', undefined, meta.label), make('p', undefined, meta.description));
    const close = closeButton(meta.label);
    close.addEventListener('click', () => this.callbacks.onSelectObject(null));
    head.append(iconBox, copy, close);
    this.inspectorBody.append(head);

    if (meta.status) {
      const status = make('div', 'inspector-status', meta.status);
      this.inspectorBody.append(status);
    }

    if (meta.actions.length) {
      const actions = make('div', 'inspector-actions');
      for (const action of meta.actions) {
        actions.append(this.makeActionButton(meta.id, action));
      }
      this.inspectorBody.append(actions);
    }

    for (const group of meta.choices ?? []) {
      this.inspectorBody.append(make('div', 'choice-label', group.label));
      const row = make('div', 'choice-row');
      for (const choice of group.options) {
        const dot = choice.color
          ? `<span class="choice-dot" style="--choice-color:${choice.color}"></span>`
          : '';
        const chip = makeButton('chip', `${dot}<span>${choice.label}</span>`);
        chip.setAttribute('aria-pressed', String(choice.active === true));
        chip.addEventListener('click', () => this.callbacks.onObjectAction(meta.id, choice.id));
        row.append(chip);
      }
      this.inspectorBody.append(row);
    }

    this.inspector.hidden = false;
    const objectButton = this.objectButtons.get(meta.id);
    if (objectButton && objectButton.parentElement === this.objectList) {
      objectButton.after(this.inspector);
    } else {
      this.objectList.append(this.inspector);
    }
    this.setSectionOpen(OBJECT_SECTION, true);
    if (previousId !== meta.id) {
      window.requestAnimationFrame(() => this.inspector.scrollIntoView({ block: 'nearest' }));
    }
  }

  private makeActionButton(objectId: string, action: ObjectAction): HTMLButtonElement {
    const button = makeButton('action-button', `${action.icon ? icon(action.icon, 13) : ''}<span>${action.label}</span>`);
    if (action.active !== undefined) button.setAttribute('aria-pressed', String(action.active));
    if (action.disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
    button.addEventListener('click', () => this.callbacks.onObjectAction(objectId, action.id));
    return button;
  }

  // ---------------------------------------------------------------------------
  // 面板与浮层
  // ---------------------------------------------------------------------------
  closePanels(): void {
    for (const name of Array.from(this.openSections)) {
      this.setSectionOpen(name, false);
    }
  }

  hasOpenPanel(): boolean {
    return this.openSections.size > 0;
  }

  hasSelection(): boolean {
    return this.inspector.hidden === false;
  }

  toast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 1900);
  }

  setSceneTooltip(text: string | null, clientX = 0, clientY = 0): void {
    if (!text) {
      this.sceneTooltip.hidden = true;
      return;
    }
    this.sceneTooltip.textContent = text;
    this.sceneTooltip.hidden = false;
    const rect = this.stage.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top + 18;
    const width = this.sceneTooltip.offsetWidth;
    const height = this.sceneTooltip.offsetHeight;
    x = Math.max(8, Math.min(rect.width - width - 8, x));
    y = Math.max(8, Math.min(rect.height - height - 8, y));
    this.sceneTooltip.style.left = `${x}px`;
    this.sceneTooltip.style.top = `${y}px`;
  }

  // ---------------------------------------------------------------------------
  // 辅助
  // ---------------------------------------------------------------------------
  private setRangeFill(input: HTMLInputElement): void {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${percent}%`);
  }

  private bindTooltipEvents(): void {
    this.root.addEventListener('pointerover', (event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (!target || !target.dataset.tip) return;
      this.showUiTooltip(target);
    });
    this.root.addEventListener('pointerout', (event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (!target) return;
      const related = event.relatedTarget as Node | null;
      if (related && target.contains(related)) return;
      if (target === this.uiTipTarget) this.hideUiTooltip();
    });
    this.root.addEventListener('focusin', (event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (target && target.dataset.tip && target.matches(':focus-visible')) this.showUiTooltip(target);
    });
    this.root.addEventListener('focusout', () => this.hideUiTooltip());
  }

  private showUiTooltip(target: HTMLElement): void {
    const tip = target.dataset.tip;
    if (!tip) return;
    this.uiTipTarget = target;
    this.uiTooltip.textContent = tip;
    this.uiTooltip.hidden = false;
    const stageRect = this.stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const width = this.uiTooltip.offsetWidth;
    const height = this.uiTooltip.offsetHeight;
    let left = targetRect.left - stageRect.left + targetRect.width / 2;
    left = Math.max(width / 2 + 8, Math.min(stageRect.width - width / 2 - 8, left));
    let top = targetRect.top - stageRect.top - height - 8;
    if (top < 8) top = targetRect.bottom - stageRect.top + 8;
    this.uiTooltip.style.left = `${left}px`;
    this.uiTooltip.style.top = `${top}px`;
    this.uiTooltip.style.transform = 'translateX(-50%)';
  }

  private hideUiTooltip(): void {
    this.uiTipTarget = null;
    this.uiTooltip.hidden = true;
  }
}
