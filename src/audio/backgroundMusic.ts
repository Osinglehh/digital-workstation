export type MusicPlayback = 'off' | 'loading' | 'playing' | 'blocked' | 'paused' | 'error';

export type BackgroundMusicState = {
  enabled: boolean;
  /** 0–100 的整数音量。 */
  volume: number;
  playback: MusicPlayback;
};

/** public/ 下的相对路径：GitHub Pages 子路径与本地 dev 都能直接解析。 */
export const BACKGROUND_MUSIC_SRC = 'audio/background_music.mp3';
export const DEFAULT_MUSIC_VOLUME = 35;

type BackgroundMusicOptions = {
  src?: string;
  enabled?: boolean;
  volume?: number;
  onStateChange?: (state: BackgroundMusicState) => void;
};

/**
 * 背景音乐服务：进入页面尝试自动循环播放；被浏览器自动播放策略拦截时，
 * 挂一次性手势监听，用户第一次点击或按键后继续播放。
 */
export class BackgroundMusic {
  private readonly audio: HTMLAudioElement;
  private readonly onStateChange?: (state: BackgroundMusicState) => void;
  private enabled: boolean;
  private volume: number;
  private started = false;
  private blocked = false;
  private failed = false;
  private gestureArmed = false;
  private gestureHandler: (() => void) | null = null;

  constructor(options: BackgroundMusicOptions = {}) {
    this.onStateChange = options.onStateChange;
    this.enabled = options.enabled !== false;
    this.volume = clampVolume(options.volume ?? DEFAULT_MUSIC_VOLUME);

    this.audio = new Audio(options.src ?? BACKGROUND_MUSIC_SRC);
    this.audio.loop = true;
    // 首屏不预取 6 MB 音频：自动播放被拦截时不会白白下载，首次手势播放再加载。
    this.audio.preload = 'none';
    this.audio.volume = this.volume / 100;

    this.audio.addEventListener('playing', () => {
      this.started = true;
      this.blocked = false;
      this.publish();
    });
    this.audio.addEventListener('pause', () => this.publish());
    this.audio.addEventListener('error', () => {
      this.failed = true;
      this.publish();
    });
  }

  getState(): BackgroundMusicState {
    return {
      enabled: this.enabled,
      volume: this.volume,
      playback: this.playback(),
    };
  }

  /** 页面启动时调用：尝试免交互播放，失败则等待第一次用户手势。 */
  start(): void {
    if (!this.enabled || this.failed) return;
    this.tryPlay();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.blocked = false;
      this.disarmGesture();
      this.audio.pause();
    } else {
      // 由点击开关触发时处于用户手势内，play() 可以立即通过策略检查。
      this.tryPlay();
    }
    this.publish();
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    this.audio.volume = this.volume / 100;
    this.publish();
  }

  private playback(): MusicPlayback {
    if (!this.enabled) return 'off';
    if (this.failed) return 'error';
    if (!this.audio.paused) return 'playing';
    if (this.blocked) return 'blocked';
    return this.started ? 'paused' : 'loading';
  }

  private tryPlay(): void {
    if (!this.enabled || this.failed) return;
    this.blocked = false;
    const attempt = this.audio.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        this.blocked = true;
        this.armGesture();
        this.publish();
      });
    }
    this.publish();
  }

  private armGesture(): void {
    if (this.gestureArmed) return;
    this.gestureArmed = true;
    const handler = (): void => {
      this.disarmGesture();
      if (this.enabled) this.tryPlay();
    };
    this.gestureHandler = handler;
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
  }

  private disarmGesture(): void {
    if (this.gestureHandler) {
      window.removeEventListener('pointerdown', this.gestureHandler, true);
      window.removeEventListener('keydown', this.gestureHandler, true);
      this.gestureHandler = null;
    }
    this.gestureArmed = false;
  }

  private publish(): void {
    this.onStateChange?.(this.getState());
  }
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MUSIC_VOLUME;
  return Math.round(Math.min(100, Math.max(0, value)));
}
