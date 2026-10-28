import type {
  RgbMode,
  SceneId,
  ScreenContent,
  ShowcaseCaption,
  ShowcaseStatus,
  ShowcaseUiState,
} from '../ui/types';
import {
  SHOWCASE_AUTO_RESTORE_MS,
  SHOWCASE_CHAPTERS,
  SHOWCASE_CAMERA_KEYS,
  SHOWCASE_EVENTS,
  SHOWCASE_TOTAL,
  captionAt,
  chapterIndexAt,
  chapterStart,
  poseAt,
  rgbScaleAt,
  subtitleAt,
} from './showcaseTimeline';
import type { CameraPose, ShowcaseEvent } from './showcaseTimeline';

export type ShowcaseHost = {
  getCameraPose: () => CameraPose;
  applyCameraPose: (pose: CameraPose) => void;
  beginShowcase: () => void;
  endShowcase: () => void;
  beginSceneTransition: (scene: SceneId, duration: number) => void;
  stepSceneTransition: (progress: number) => void;
  commitScene: (scene: SceneId) => void;
  applySceneInstant: (scene: SceneId) => void;
  setRgb: (mode: RgbMode, color?: string) => void;
  setRgbScale: (scale: number) => void;
  setScreenPower: (on: boolean) => void;
  setScreenContent: (content: ScreenContent) => void;
  setLidClosed: (closed: boolean, immediate?: boolean) => void;
  pauseDevices: () => void;
  resumeDevices: () => void;
  setUiHidden: (hidden: boolean) => void;
  publish: (state: ShowcaseUiState) => void;
  render: () => void;
};

type SceneTransition = {
  target: SceneId;
  start: number;
  duration: number;
};

const SHOWCASE_PREFERENCES_KEY = 'workstation-showcase-v1';

export class ShowcaseController {
  private readonly host: ShowcaseHost;
  private status: ShowcaseStatus = 'idle';
  private active = false;
  private time = 0;
  private eventCursor = 0;
  private sceneTransition: SceneTransition | null = null;
  private entrancePose: CameraPose | null = null;
  private caption: ShowcaseCaption = 'none';
  private uiHidden = false;
  private hideOnStart = false;
  private autoRestoreTimer = 0;
  private lastPublishAt = 0;
  private lastChapter = -1;
  private lastStatus: ShowcaseStatus = 'idle';
  private lastCaption: ShowcaseCaption = 'none';
  private lastRgbScale = -1;

  constructor(host: ShowcaseHost) {
    this.host = host;
    try {
      const raw = window.localStorage.getItem(SHOWCASE_PREFERENCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { hideOnStart?: unknown };
        this.hideOnStart = parsed?.hideOnStart === true;
      }
    } catch {
      this.hideOnStart = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  getStatus(): ShowcaseStatus {
    return this.status;
  }

  getTime(): number {
    return this.time;
  }

  start(): void {
    if (this.active) return;
    this.clearAutoRestore();
    this.active = true;
    this.status = 'playing';
    this.time = 0;
    this.eventCursor = 0;
    this.sceneTransition = null;
    this.entrancePose = this.host.getCameraPose();
    this.caption = 'none';
    this.uiHidden = false;
    this.lastChapter = -1;
    this.lastStatus = 'playing';
    this.lastCaption = 'none';
    this.lastRgbScale = -1;
    this.host.setUiHidden(false);
    this.host.beginShowcase();
    this.host.setScreenPower(true);
    this.host.setRgbScale(1);
    if (this.hideOnStart) {
      this.uiHidden = true;
      this.host.setUiHidden(true);
    }
    this.applyCamera();
    this.publish(true);
    this.host.render();
  }

  pause(): void {
    if (!this.active || this.status !== 'playing') return;
    this.status = 'paused';
    this.host.pauseDevices();
    this.publish(true);
    this.host.render();
  }

  resume(): void {
    if (!this.active || this.status !== 'paused') return;
    this.status = 'playing';
    this.host.resumeDevices();
    this.publish(true);
  }

  togglePause(): void {
    if (this.status === 'playing') this.pause();
    else if (this.status === 'paused') this.resume();
  }

  nextChapter(): void {
    if (!this.active || this.status === 'finished') return;
    const current = chapterIndexAt(this.time);
    if (current >= SHOWCASE_CHAPTERS.length - 1) {
      this.jumpTo(SHOWCASE_TOTAL);
      this.publish(true);
      this.host.render();
      return;
    }
    this.jumpTo(chapterStart(current + 1));
    this.publish(true);
    this.host.render();
  }

  restart(): void {
    if (!this.active) {
      this.start();
      return;
    }
    this.clearAutoRestore();
    this.host.resumeDevices();
    this.status = 'playing';
    this.time = 0;
    this.eventCursor = 0;
    this.sceneTransition = null;
    this.entrancePose = { ...SHOWCASE_CAMERA_KEYS[0].pose };
    this.caption = 'none';
    this.lastChapter = -1;
    this.lastStatus = 'playing';
    this.lastCaption = 'none';
    this.lastRgbScale = -1;
    this.host.applySceneInstant('day');
    this.host.setScreenPower(true);
    this.host.setRgb('off');
    this.host.setRgbScale(0);
    this.host.setScreenContent('dashboard');
    this.host.setLidClosed(false, true);
    if (this.hideOnStart && !this.uiHidden) {
      this.uiHidden = true;
      this.host.setUiHidden(true);
    }
    this.time = 0;
    this.eventCursor = 0;
    this.applyCamera();
    this.publish(true);
    this.host.render();
  }

  seek(seconds: number): void {
    if (!this.active) return;
    this.clearAutoRestore();
    this.jumpTo(seconds);
    this.publish(true);
    this.host.render();
  }

  setUiHidden(hidden: boolean): void {
    if (this.uiHidden === hidden) return;
    this.uiHidden = hidden;
    this.host.setUiHidden(hidden);
    this.publish(true);
  }

  toggleUiHidden(): void {
    this.setUiHidden(!this.uiHidden);
  }

  setHideOnStart(enabled: boolean): void {
    this.hideOnStart = enabled;
    try {
      window.localStorage.setItem(SHOWCASE_PREFERENCES_KEY, JSON.stringify({ hideOnStart: enabled }));
    } catch {
      // 隐私模式下 localStorage 可能不可写；只影响偏好记忆，不中断展示。
    }
    if (this.active) {
      if (enabled && !this.uiHidden) this.setUiHidden(true);
      else if (!enabled && this.uiHidden) this.setUiHidden(false);
    }
    this.publish(true);
  }

  exit(): void {
    if (!this.active) return;
    this.clearAutoRestore();
    this.host.resumeDevices();
    this.active = false;
    this.status = 'stopped';
    this.time = 0;
    this.eventCursor = 0;
    this.sceneTransition = null;
    this.caption = 'none';
    this.uiHidden = false;
    this.host.setRgbScale(1);
    this.host.setUiHidden(false);
    this.host.endShowcase();
    this.publish(true);
    this.host.render();
  }

  tick(dt: number): void {
    if (!this.active || this.status !== 'playing') return;
    const step = Math.min(Math.max(dt, 0), 0.25);
    if (step <= 0) return;
    this.time = Math.min(SHOWCASE_TOTAL, this.time + step);
    this.processEvents();
    this.updateSceneTransition();
    this.applyRgbScale();
    this.applyCamera();
    const nextCaption = captionAt(this.time) ?? 'none';
    if (nextCaption !== this.caption) this.caption = nextCaption;
    if (this.time >= SHOWCASE_TOTAL) this.finish();
    else this.publish();
    this.host.render();
  }

  getState(): ShowcaseUiState & {
    active: boolean;
    chapterStart: number;
    nextChapterStart: number | null;
  } {
    const chapter = SHOWCASE_CHAPTERS[chapterIndexAt(this.time)];
    const chapterIndex = chapterIndexAt(this.time);
    return {
      ...this.buildUiState(chapterIndex, chapter.title, chapter.subtitle),
      active: this.active,
      chapterStart: chapter.start,
      nextChapterStart: chapterIndex < SHOWCASE_CHAPTERS.length - 1
        ? SHOWCASE_CHAPTERS[chapterIndex + 1].start
        : null,
    };
  }

  private jumpTo(seconds: number): void {
    this.time = Math.min(SHOWCASE_TOTAL, Math.max(0, seconds));
    this.sceneTransition = null;
    const latestScene = this.latestSceneAt(this.time);
    this.host.applySceneInstant(latestScene);
    for (const event of SHOWCASE_EVENTS) {
      if (event.t > this.time) break;
      if (event.type === 'scene') continue;
      this.applyDeviceEvent(event, true);
    }
    this.host.setRgbScale(rgbScaleAt(this.time));
    this.lastRgbScale = rgbScaleAt(this.time);
    this.eventCursor = SHOWCASE_EVENTS.findIndex((event) => event.t > this.time);
    if (this.eventCursor < 0) this.eventCursor = SHOWCASE_EVENTS.length;
    if (this.time >= SHOWCASE_TOTAL) {
      this.status = 'finished';
      this.caption = 'outro';
    } else {
      if (this.status === 'finished') this.status = 'paused';
      this.caption = captionAt(this.time) ?? 'none';
    }
    this.applyCamera();
  }

  private latestSceneAt(time: number): SceneId {
    let scene: SceneId = 'day';
    for (const event of SHOWCASE_EVENTS) {
      if (event.t > time) break;
      if (event.type === 'scene') scene = event.scene;
    }
    return scene;
  }

  private processEvents(): void {
    while (this.eventCursor < SHOWCASE_EVENTS.length) {
      const event = SHOWCASE_EVENTS[this.eventCursor];
      if (event.t > this.time) break;
      if (event.type === 'scene') {
        this.host.beginSceneTransition(event.scene, Math.max(0.2, event.transition));
        this.sceneTransition = {
          target: event.scene,
          start: this.time,
          duration: Math.max(0.2, event.transition),
        };
      } else {
        this.applyDeviceEvent(event);
      }
      this.eventCursor += 1;
    }
  }

  private applyDeviceEvent(event: ShowcaseEvent, immediate = false): void {
    if (event.type === 'scene') return;
    if (event.type === 'rgb') this.host.setRgb(event.mode, event.color);
    else if (event.type === 'screen') this.host.setScreenContent(event.content);
    else if (event.type === 'lid') this.host.setLidClosed(event.closed, immediate);
  }

  private updateSceneTransition(): void {
    if (!this.sceneTransition) return;
    const { target, start, duration } = this.sceneTransition;
    const progress = Math.min(1, (this.time - start) / duration);
    this.host.stepSceneTransition(progress);
    if (progress >= 1) {
      this.host.commitScene(target);
      this.sceneTransition = null;
    }
  }

  private applyRgbScale(): void {
    const scale = rgbScaleAt(this.time);
    if (Math.abs(scale - this.lastRgbScale) < 0.003) return;
    this.lastRgbScale = scale;
    this.host.setRgbScale(scale);
  }

  private applyCamera(): void {
    this.host.applyCameraPose(poseAt(SHOWCASE_CAMERA_KEYS, this.time, this.entrancePose ?? undefined));
  }

  private finish(): void {
    this.time = SHOWCASE_TOTAL;
    if (this.sceneTransition) {
      this.host.stepSceneTransition(1);
      this.host.commitScene(this.sceneTransition.target);
      this.sceneTransition = null;
    }
    this.host.setRgbScale(1);
    this.lastRgbScale = 1;
    this.status = 'finished';
    this.caption = 'outro';
    this.applyCamera();
    this.publish(true);
    this.scheduleAutoRestore();
  }

  private clearAutoRestore(): void {
    if (!this.autoRestoreTimer) return;
    window.clearTimeout(this.autoRestoreTimer);
    this.autoRestoreTimer = 0;
  }

  private scheduleAutoRestore(): void {
    this.clearAutoRestore();
    this.autoRestoreTimer = window.setTimeout(() => {
      this.autoRestoreTimer = 0;
      if (this.active && this.status === 'finished') this.exit();
    }, SHOWCASE_AUTO_RESTORE_MS);
  }

  private buildUiState(chapterIndex: number, chapterTitle: string, chapterSubtitle: string): ShowcaseUiState {
    const idle = this.status === 'idle' || this.status === 'stopped';
    const elapsed = idle ? 0 : this.time;
    const subtitle = idle
      ? ''
      : this.status === 'finished'
        ? '展示完成 · 正在恢复初始状态'
        : subtitleAt(elapsed);
    return {
      status: this.status,
      chapterIndex,
      chapterCount: SHOWCASE_CHAPTERS.length,
      chapterTitle,
      chapterSubtitle,
      subtitle,
      elapsed,
      total: SHOWCASE_TOTAL,
      progress: Math.min(1, elapsed / SHOWCASE_TOTAL),
      caption: idle ? 'none' : this.caption,
      uiHidden: this.uiHidden,
      hideOnStart: this.hideOnStart,
    };
  }

  private publish(force = false): void {
    const now = performance.now();
    const chapterIndex = chapterIndexAt(this.time);
    const changed = force
      || chapterIndex !== this.lastChapter
      || this.status !== this.lastStatus
      || this.caption !== this.lastCaption
      || now - this.lastPublishAt >= 100;
    if (!changed) return;
    this.lastPublishAt = now;
    this.lastChapter = chapterIndex;
    this.lastStatus = this.status;
    this.lastCaption = this.caption;
    const chapter = SHOWCASE_CHAPTERS[chapterIndex];
    this.host.publish(this.buildUiState(chapterIndex, chapter.title, chapter.subtitle));
  }
}
