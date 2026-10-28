# 办公位工作区数字孪生

基于 Three.js + TypeScript + Vite 的程序化办公位场景：工位、双屏、键鼠、水壶、桌椅、书架等均由代码生成，支持视角切换、设备交互、灯光场景与自动展示。

- **在线体验**：https://osinglehh.github.io/digital-workstation/
- **开源仓库**：[Osinglehh/digital-workstation](https://github.com/Osinglehh/digital-workstation) · 欢迎 Star

## 运行

```bash
npm install
npm run dev      # 默认 http://127.0.0.1:5173/
```

类型检查与生产构建：

```bash
npm run typecheck
npm run build
npm run preview
```

## 使用

- 鼠标拖动旋转、滚轮缩放；点击场景物体，在左上设计树中打开操作面板。
- 设计树包含视角、物品、灯光、场景、自动展示与帮助，可从标题栏整体折叠；顶部的 GitHub 横条可直接打开开源仓库，欢迎 Star。
- “自动展示”一键播放约 45 秒的镜头、灯光与设备演出，结束后自动恢复初始状态。
- 快捷键：`1–9` 切换常用视角，`R` 恢复主视角，`Esc` 取消选中；自动展示中 `Space` 暂停/继续、`H` 隐藏控件栏。

## 部署

推送 `main` 分支即自动构建并部署到 GitHub Pages（见 `.github/workflows/deploy.yml`）。首次启用需在仓库 Settings → Pages 中将 Source 选为 GitHub Actions。

## 开发说明

开发约定、场景尺寸、审计数据与验证流程见 [AGENTS.md](AGENTS.md)。`figure/`（参考照片）与 `analysis/renders/`（渲染证据）体积较大，不进入 Git。
