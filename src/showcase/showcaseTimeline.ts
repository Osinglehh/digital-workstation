import type { RgbMode, SceneId, ScreenContent } from '../ui/types';

export type CameraPose = {
  target: [number, number, number];
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
  fov: number;
};

export type ShowcaseChapter = {
  id: string;
  title: string;
  subtitle: string;
  start: number;
  duration: number;
};

export type ShowcaseEvent =
  | { t: number; type: 'scene'; scene: SceneId; transition: number }
  | { t: number; type: 'rgb'; mode: RgbMode; color?: string }
  | { t: number; type: 'screen'; content: ScreenContent }
  | { t: number; type: 'lid'; closed: boolean };

export type RgbScaleKey = { t: number; value: number };
export type CaptionRange = { mode: 'intro' | 'outro'; start: number; end: number };
export type LiveSubtitle = { start: number; end: number; text: string };

export type CameraKey = { t: number; pose: CameraPose };

export const SHOWCASE_TOTAL = 45;
export const SHOWCASE_AUTO_RESTORE_MS = 2000;

export const SHOWCASE_CHAPTERS: ShowcaseChapter[] = [
  { id: 'opening', title: '整体亮相', subtitle: '远景推进，先看清完整工位', start: 0, duration: 7 },
  { id: 'space', title: '空间环绕', subtitle: '左右 3/4 视角展示布局与结构', start: 7, duration: 6 },
  { id: 'detail', title: '桌面细节', subtitle: '显示器、笔记本、键盘与桌面配件', start: 13, duration: 8 },
  { id: 'device', title: '设备互动', subtitle: '笔记本开合与屏幕内容切换', start: 21, duration: 7 },
  { id: 'rgb', title: 'RGB 灯效', subtitle: '单色、彩虹与呼吸灯效', start: 28, duration: 6 },
  { id: 'mood', title: '氛围切换', subtitle: '深夜、专注与 RGB 场景氛围', start: 34, duration: 6 },
  { id: 'finale', title: '终章全景', subtitle: '拉回全景，定格 3/4 收尾', start: 40, duration: 5 },
];

// 机位与 main.ts 的预设保持同一坐标语言：目标点 + 方位角/仰角/距离 + fov。
export const SHOWCASE_CAMERA_KEYS: CameraKey[] = [
  { t: 2.4, pose: { target: [0.02, 0.82, 0.06], azimuthDeg: -32, elevationDeg: 24, distance: 3.10, fov: 50 } },
  { t: 3.4, pose: { target: [0.02, 0.82, 0.06], azimuthDeg: -32, elevationDeg: 24, distance: 3.10, fov: 50 } },
  { t: 7, pose: { target: [-0.03, 0.78, 0.04], azimuthDeg: -26, elevationDeg: 20, distance: 2.80, fov: 52 } },
  { t: 10, pose: { target: [0.0, 0.80, -0.02], azimuthDeg: -36, elevationDeg: 15, distance: 2.52, fov: 54 } },
  { t: 13, pose: { target: [0.02, 0.80, -0.02], azimuthDeg: 30, elevationDeg: 15, distance: 2.52, fov: 54 } },
  // 从右 3/4 推进到显示器时先抬高越过椅背，避免穿过椅背网格。
  { t: 13.7, pose: { target: [0.01, 0.90, -0.10], azimuthDeg: 20, elevationDeg: 30, distance: 1.55, fov: 42 } },
  { t: 15, pose: { target: [0.0, 1.02, -0.22], azimuthDeg: 1, elevationDeg: 8, distance: 0.66, fov: 38 } },
  { t: 16.8, pose: { target: [0.0, 1.02, -0.22], azimuthDeg: 3, elevationDeg: 10, distance: 0.62, fov: 38 } },
  { t: 18, pose: { target: [-0.24, 0.89, -0.09], azimuthDeg: -16, elevationDeg: 16, distance: 0.78, fov: 36 } },
  { t: 19.2, pose: { target: [-0.24, 0.89, -0.09], azimuthDeg: -13, elevationDeg: 18, distance: 0.74, fov: 36 } },
  { t: 20.2, pose: { target: [0.04, 0.80, 0.04], azimuthDeg: 14, elevationDeg: 26, distance: 0.92, fov: 40 } },
  { t: 21, pose: { target: [0.04, 0.80, 0.04], azimuthDeg: 10, elevationDeg: 24, distance: 0.88, fov: 40 } },
  { t: 22.2, pose: { target: [-0.24, 0.89, -0.09], azimuthDeg: -13, elevationDeg: 18, distance: 0.74, fov: 36 } },
  { t: 25, pose: { target: [-0.24, 0.89, -0.09], azimuthDeg: -13, elevationDeg: 18, distance: 0.74, fov: 36 } },
  { t: 26.4, pose: { target: [0.0, 0.99, -0.30], azimuthDeg: 0, elevationDeg: 9, distance: 0.90, fov: 62 } },
  { t: 28, pose: { target: [0.0, 0.99, -0.30], azimuthDeg: 0, elevationDeg: 9, distance: 0.90, fov: 62 } },
  { t: 29, pose: { target: [-0.05, 0.80, 0.02], azimuthDeg: 16, elevationDeg: 27, distance: 0.80, fov: 38 } },
  { t: 33.2, pose: { target: [-0.05, 0.80, 0.03], azimuthDeg: 9, elevationDeg: 24, distance: 0.76, fov: 38 } },
  { t: 34, pose: { target: [-0.05, 0.80, 0.03], azimuthDeg: 9, elevationDeg: 24, distance: 0.76, fov: 38 } },
  // 中景抬高并拉远，越过椅背并完整收进格架顶部。
  { t: 35.4, pose: { target: [-0.02, 0.90, -0.02], azimuthDeg: -28, elevationDeg: 32, distance: 2.45, fov: 48 } },
  { t: 37.2, pose: { target: [-0.02, 0.90, -0.02], azimuthDeg: -24, elevationDeg: 30, distance: 2.35, fov: 48 } },
  { t: 38.4, pose: { target: [0.0, 0.90, -0.02], azimuthDeg: 24, elevationDeg: 32, distance: 2.45, fov: 46 } },
  { t: 39.4, pose: { target: [0.0, 0.90, -0.02], azimuthDeg: 28, elevationDeg: 30, distance: 2.40, fov: 46 } },
  { t: 40, pose: { target: [0.0, 0.90, -0.02], azimuthDeg: 28, elevationDeg: 30, distance: 2.40, fov: 46 } },
  { t: 42.8, pose: { target: [-0.02, 0.82, 0.05], azimuthDeg: -23, elevationDeg: 20, distance: 2.72, fov: 51 } },
  { t: 45, pose: { target: [-0.02, 0.82, 0.05], azimuthDeg: -23, elevationDeg: 20, distance: 2.72, fov: 51 } },
];

export const SHOWCASE_EVENTS: ShowcaseEvent[] = [
  { t: 0, type: 'scene', scene: 'day', transition: 2.0 },
  { t: 0.3, type: 'screen', content: 'dashboard' },
  { t: 0.3, type: 'lid', closed: false },
  { t: 0.5, type: 'rgb', mode: 'off' },
  { t: 14.5, type: 'screen', content: 'code' },
  { t: 22.6, type: 'lid', closed: true },
  { t: 25.4, type: 'lid', closed: false },
  { t: 26.2, type: 'screen', content: 'terminal' },
  { t: 27.2, type: 'screen', content: 'dashboard' },
  { t: 29.2, type: 'rgb', mode: 'static', color: '#2BD8FF' },
  { t: 31.0, type: 'rgb', mode: 'rainbow' },
  { t: 32.8, type: 'rgb', mode: 'breathe', color: '#2BD8FF' },
  { t: 34.0, type: 'scene', scene: 'night', transition: 1.4 },
  { t: 34.2, type: 'screen', content: 'terminal' },
  { t: 36.6, type: 'scene', scene: 'focus', transition: 1.4 },
  { t: 36.9, type: 'rgb', mode: 'static', color: '#FFD9A0' },
  { t: 37.0, type: 'screen', content: 'focus' },
  { t: 38.8, type: 'scene', scene: 'rgb', transition: 1.2 },
  { t: 39.1, type: 'rgb', mode: 'rainbow', color: '#B06CFF' },
  { t: 39.2, type: 'screen', content: 'code' },
];

// RGB 模式切换先压暗再淡入，避免单色/彩虹/呼吸之间突然闪变。
export const SHOWCASE_RGB_SCALE_KEYS: RgbScaleKey[] = [
  { t: 0, value: 1 },
  { t: 0.35, value: 0 },
  { t: 28.6, value: 0 },
  { t: 29.6, value: 1 },
  { t: 30.7, value: 1 },
  { t: 31.0, value: 0 },
  { t: 31.4, value: 1 },
  { t: 32.5, value: 1 },
  { t: 32.8, value: 0 },
  { t: 33.2, value: 1 },
  { t: 36.6, value: 1 },
  { t: 36.9, value: 0 },
  { t: 37.3, value: 1 },
  { t: 38.5, value: 1 },
  { t: 38.8, value: 0 },
  { t: 39.3, value: 1 },
  { t: 45, value: 1 },
];

export const SHOWCASE_CAPTIONS: CaptionRange[] = [
  { mode: 'intro', start: 2.4, end: 5.2 },
  { mode: 'outro', start: 43.0, end: SHOWCASE_TOTAL },
];

// 底部白色实时字幕：描述镜头当前展示的功能，而不是重复章节标题。
export const SHOWCASE_SUBTITLES: LiveSubtitle[] = [
  { start: 0, end: 2.4, text: '整体工位 · 双屏 / 桌顶格架 / 人体工学椅' },
  { start: 2.4, end: 5.2, text: '整体亮相 · 远景推近与日间灯光' },
  { start: 5.2, end: 7, text: '主视角 · 双屏与桌面设备' },
  { start: 7, end: 10, text: '空间环绕 · 主视角 → 左 3/4' },
  { start: 10, end: 13, text: '空间结构 · 左 3/4 → 右 3/4' },
  { start: 13, end: 15, text: '抬高越过椅背 · 推进显示器' },
  { start: 15, end: 18, text: 'AOC 显示器 · 代码屏幕内容' },
  { start: 18, end: 20.2, text: '耀世 16 Ultra · 机身与键盘面' },
  { start: 20.2, end: 22.6, text: '桌面配件 · 键盘 / 鼠标 / 茶杯' },
  { start: 22.6, end: 25.4, text: '设备互动 · 笔记本真实合盖' },
  { start: 25.4, end: 28, text: '设备互动 · 开盖与屏幕内容切换' },
  { start: 28, end: 29.2, text: '键盘近景 · 进入 RGB 灯效' },
  { start: 29.2, end: 31, text: '键盘 RGB · 单色青灯效' },
  { start: 31, end: 32.8, text: '键盘 RGB · 彩虹渐变' },
  { start: 32.8, end: 34, text: '键盘 RGB · 呼吸灯效' },
  { start: 34, end: 36.6, text: '深夜模式 · 双屏成为视觉焦点' },
  { start: 36.6, end: 38.8, text: '专注模式 · 暖色工作氛围' },
  { start: 38.8, end: 40, text: 'RGB 氛围 · 彩色灯光' },
  { start: 40, end: 43.2, text: '终章全景 · 拉回 3/4 视角' },
  { start: 43.2, end: 45, text: '终章全景 · 完整工位收尾' },
];

export function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function lerpPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = smootherstep(t);
  return {
    target: [
      from.target[0] + (to.target[0] - from.target[0]) * k,
      from.target[1] + (to.target[1] - from.target[1]) * k,
      from.target[2] + (to.target[2] - from.target[2]) * k,
    ],
    azimuthDeg: from.azimuthDeg + (to.azimuthDeg - from.azimuthDeg) * k,
    elevationDeg: from.elevationDeg + (to.elevationDeg - from.elevationDeg) * k,
    distance: from.distance + (to.distance - from.distance) * k,
    fov: from.fov + (to.fov - from.fov) * k,
  };
}

export function poseAt(keys: CameraKey[], time: number, firstPose?: CameraPose): CameraPose {
  const sorted = keys;
  if (!sorted.length) {
    return firstPose ?? { target: [0, 0.8, 0], azimuthDeg: 0, elevationDeg: 20, distance: 2.8, fov: 52 };
  }
  if (time <= sorted[0].t) {
    if (firstPose) {
      const span = sorted[0].t;
      if (span > 0.001) return lerpPose(firstPose, sorted[0].pose, time / span);
      return { ...sorted[0].pose };
    }
    return { ...sorted[0].pose };
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      return lerpPose(a.pose, b.pose, (time - a.t) / span);
    }
  }
  return { ...sorted[sorted.length - 1].pose };
}

export function rgbScaleAt(time: number): number {
  const keys = SHOWCASE_RGB_SCALE_KEYS;
  if (time <= keys[0].t) return keys[0].value;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      const k = smootherstep((time - a.t) / span);
      return a.value + (b.value - a.value) * k;
    }
  }
  return keys[keys.length - 1].value;
}

export function chapterIndexAt(time: number): number {
  for (let i = SHOWCASE_CHAPTERS.length - 1; i >= 0; i -= 1) {
    if (time >= SHOWCASE_CHAPTERS[i].start) return i;
  }
  return 0;
}

export function chapterStart(index: number): number {
  return SHOWCASE_CHAPTERS[Math.max(0, Math.min(SHOWCASE_CHAPTERS.length - 1, index))].start;
}

export function captionAt(time: number): 'intro' | 'outro' | null {
  const hit = SHOWCASE_CAPTIONS.find((range) => time >= range.start && time < range.end);
  return hit?.mode ?? null;
}

export function subtitleAt(time: number): string {
  const hit = SHOWCASE_SUBTITLES.find((range) => time >= range.start && time < range.end);
  return hit?.text ?? '';
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
