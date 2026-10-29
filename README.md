# 办公位工作区数字孪生

基于 Three.js + TypeScript + Vite 的程序化办公位场景：工位、双屏、键鼠、水壶、桌椅、书架等均由代码生成，支持视角切换、设备交互、灯光场景与自动展示。

- **在线体验**：https://osinglehh.github.io/digital-workstation/
- **Qoder Sites 线上版**：https://digital-workstation-vcyscgr9sb8.qoder.zone/
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
- 设计树包含视角、物品、灯光、场景、声音、自动展示与帮助，按住顶栏可拖动整棵树，也可从标题栏整体折叠；顶部的 GitHub 横条可直接打开开源仓库，欢迎 Star。
- “声音”节点控制背景音乐：进入页面自动循环播放；浏览器拦截自动播放时，点击页面任意位置即可开始。可调节音量或关闭音乐，开关与音量会被记住。
- “自动展示”一键播放约 45 秒的镜头、灯光与设备演出，结束后自动恢复初始状态。
- 快捷键：`1–9` 切换常用视角，`R` 恢复主视角，`Esc` 取消选中；自动展示中 `Space` 暂停/继续、`H` 隐藏控件栏。

## 部署

推送 `main` 分支即自动构建并部署到 GitHub Pages（见 `.github/workflows/deploy.yml`）。首次启用需在仓库 Settings → Pages 中将 Source 选为 GitHub Actions。
