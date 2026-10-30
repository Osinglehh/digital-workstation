import './introCard.css';
import { icon } from './icons';
import { REPO_URL, VIDEO_LINKS } from './links';

const STORAGE_KEY = 'workstation-intro-v1';

type IntroCardOptions = {
  onStartShowcase: () => void;
};

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'seen';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'seen');
  } catch {
    // 隐私模式禁用 localStorage 时，仅本次会话内保持已关闭。
  }
}

function forcedState(): 'show' | 'hide' | null {
  const value = new URLSearchParams(window.location.search).get('intro');
  if (value === '1') return 'show';
  if (value === '0') return 'hide';
  return null;
}

/**
 * 首访欢迎卡片：首次进入在 3D 场景加载完成后出现，只展示一次。
 * 自动化环境（navigator.webdriver）默认跳过，可用 ?intro=1 强制展示取证。
 */
export class IntroCard {
  private readonly options: IntroCardOptions;
  private readonly layer: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private lastFocus: HTMLElement | null = null;
  private open = false;

  constructor(stage: HTMLElement, options: IntroCardOptions) {
    this.options = options;

    this.layer = document.createElement('div');
    this.layer.className = 'stage-ui intro-layer';
    this.layer.hidden = true;
    this.layer.setAttribute('data-workstation-intro', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'intro-backdrop';
    backdrop.addEventListener('click', () => this.dismiss());

    this.card = document.createElement('section');
    this.card.className = 'intro-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'intro-title');
    this.card.setAttribute('aria-describedby', 'intro-lead');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'intro-close';
    closeButton.setAttribute('aria-label', '关闭欢迎卡片');
    closeButton.dataset.introAction = 'close';
    closeButton.innerHTML = icon('close', 15);
    closeButton.addEventListener('click', () => this.dismiss());

    const head = document.createElement('div');
    head.className = 'intro-head';
    const mark = document.createElement('div');
    mark.className = 'intro-mark';
    mark.innerHTML = icon('box', 18);
    const kicker = document.createElement('p');
    kicker.className = 'intro-kicker';
    kicker.textContent = 'QODER · IMG2THREEJS';
    head.append(mark, kicker);

    const title = document.createElement('h2');
    title.className = 'intro-title';
    title.id = 'intro-title';
    title.textContent = '数字工位';

    const lead = document.createElement('p');
    lead.className = 'intro-lead';
    lead.id = 'intro-lead';
    lead.textContent = '一张手机照片，变成一个可以逛的 3D 工位。';

    const chips = document.createElement('ul');
    chips.className = 'intro-chips';
    for (const [iconName, label] of [
      ['rotate', '拖动旋转'],
      ['focus', '点物品操作'],
      ['clapper', '45 秒自动导览'],
    ] as const) {
      const item = document.createElement('li');
      item.className = 'intro-chip';
      item.innerHTML = `${icon(iconName, 12)}<span>${label}</span>`;
      chips.append(item);
    }

    const meta = document.createElement('p');
    meta.className = 'intro-meta';
    meta.textContent = '84 组件 · 33 材质 · 全部由代码生成';

    const actions = document.createElement('div');
    actions.className = 'intro-actions';
    this.primary = document.createElement('button');
    this.primary.type = 'button';
    this.primary.className = 'intro-primary';
    this.primary.dataset.introAction = 'start';
    this.primary.innerHTML = `${icon('play', 14)}<span>播放 45 秒导览</span>`;
    this.primary.addEventListener('click', () => {
      this.dismiss();
      this.options.onStartShowcase();
    });
    const explore = document.createElement('button');
    explore.type = 'button';
    explore.className = 'intro-secondary';
    explore.dataset.introAction = 'explore';
    explore.textContent = '自由探索';
    explore.addEventListener('click', () => this.dismiss());
    actions.append(this.primary, explore);

    const links = document.createElement('div');
    links.className = 'intro-links';
    for (const video of VIDEO_LINKS) {
      const link = document.createElement('a');
      link.className = 'intro-link';
      link.href = video.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.video = video.id;
      link.setAttribute('aria-label', `${video.title}（新窗口）`);
      link.innerHTML = `${icon(video.icon, 12)}<span>${video.label}</span><span aria-hidden="true">↗</span>`;
      links.append(link);
    }
    const repo = document.createElement('a');
    repo.className = 'intro-link';
    repo.href = REPO_URL;
    repo.target = '_blank';
    repo.rel = 'noopener noreferrer';
    repo.setAttribute('aria-label', 'GitHub 开源仓库（新窗口）');
    repo.innerHTML = `${icon('github', 12)}<span>GitHub 仓库</span><span aria-hidden="true">↗</span>`;
    links.append(repo);

    const footnote = document.createElement('p');
    footnote.className = 'intro-footnote';
    footnote.textContent = '可在「帮助」节点里重新打开这张卡片。';

    this.card.append(closeButton, head, title, lead, chips, meta, actions, links, footnote);
    this.layer.append(backdrop, this.card);
    stage.append(this.layer);

    window.addEventListener('keydown', (event) => {
      if (!this.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
      }
    }, true);
  }

  maybeShow(): void {
    if (this.open) return;
    const forced = forcedState();
    if (forced === 'hide') return;
    if (forced !== 'show') {
      if (readSeen() || navigator.webdriver) return;
    }
    this.show();
  }

  show(): void {
    if (this.open) return;
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.open = true;
    this.layer.hidden = false;
    this.card.classList.remove('is-open');
    // 强制重排，保证每次重开都能重新播放一次性入场位移
    void this.card.offsetWidth;
    this.card.classList.add('is-open');
    this.primary.focus({ preventScroll: true });
  }

  dismiss(): void {
    if (!this.open) return;
    this.open = false;
    markSeen();
    this.layer.hidden = true;
    this.card.classList.remove('is-open');
    const canvas = document.querySelector<HTMLElement>('#stage canvas');
    if (this.lastFocus && this.lastFocus !== document.body && !this.card.contains(this.lastFocus)) {
      this.lastFocus.focus({ preventScroll: true });
    } else if (canvas) {
      canvas.focus({ preventScroll: true });
    }
    this.lastFocus = null;
  }

  isOpen(): boolean {
    return this.open;
  }
}
