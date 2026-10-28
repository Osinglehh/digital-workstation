# AGENTS.md

> 项目级代理入口 · 第三十一版 · 最后更新 2026-10-28
>
> **自动加载协议（给后续代理，务必遵守）**
> 1. **任何任务先读 L0 + L1**（30 秒速览 + 硬规则，约 80 行），不要一次性读完整个文档。
> 2. 用 **L2 路由表**按任务类型只加载相关 **L3.x**（例如改键盘就读 L3.6），需要时再补对应审计 JSON。
> 3. **动手前**先读相关函数、节点 id、父级变换与审计数据，并确认 `npm run dev` 已在 `http://127.0.0.1:5173/` 运行。
> 4. **收尾前必读 L4 + L5 对应主题 + L6**；未执行的检查必须如实标注，不能把“临时放宽副本”写成“标准测试通过”。
> 5. **事实优先级**：用户口头更正 > 当前代码与本轮实测 > 本文件 + `analysis/*-audit.json` > README > 参考照片/旧截图/旧规格；发现冲突时以高优先级为准，并把结论回写本文件。
> 6. 本仓库可能被多个代理并行修改；写共享文件前重读，清理只删本轮文件（L4.6）。
> 7. **附录 A 只用于追溯，不参与默认加载**；当前事实以 L0–L5 与代码/实测为准。
>
> 用户可见文字、代码注释与项目文档用简体中文；代码标识符保持英文。
>
> **加载示例 A（改设计树）**：L0/L1 → L3.14 + L4.1 + L5「界面与体验层」→ 改 `controlPanel.css/ts` → 跑 `test_interactions` + `final_ui_capture` → 更新本文件 L3.14/L4.1（README 不写设计细节）。
> **加载示例 B（改自动展示）**：L0/L1 → L3.16 + L4.1 + L5「自动展示」→ 改 `src/showcase/*` / `workbenchController` / `controlPanel` → 跑 `test_showcase` + `test_interactions` + `final_ui_capture` → 更新本文件 L3.16/L4.1/附录。
>
> **层级**：L0 速览 → L1 硬规则 → L2 边界/路由 → L3 修改配方 → L4 验证 → L5 已知坑 → L6 交付。

## 阅读路由

| 任务类型 | 必读 | 直接入口 |
|---|---|---|
| 任何任务 | L0、L1、L6 | 黄金路径、交付格式 |
| 视觉/材质微调 | + L2、L3.1/L3.5、L4 | `src/workstationDetails.ts` |
| 布局/间距/落地 | + L3.2 | `analysis/layout-audit.json` |
| 桌顶格架/书籍/礼盒/玻璃罐/茶叶罐/剪刀 | + L3.13 | `analysis/shelf-audit.json`、`buildShelfHutch`、`SHELF_BOOKS` |
| 桌下结构/地面/书包/垃圾桶 | + L3.12 | `analysis/underdesk-audit.json`、`buildUnderDeskArea`、`buildUnderDeskSockets`、`buildUnderDeskCables`、`buildBackpack`、`buildWasteBin` |
| 键盘 | + L3.6 | `slimExternalKeyboard`、`buildWedgeKeyboardCase` |
| 鼠标/鼠标垫 | + L3.7 | `buildInphicMouse`、`MOUSE_STATIONS` |
| 水壶 | + L3.8 | `buildBottleDetails`、`bottleRadiusAt`、`buildBottleHook` |
| 显示器/笔记本 | + L3.9 | `enhanceWorkstation` 的 monitor/laptop 段 |
| 椅子/头枕 | + L3.11 | `buildErgonomicChair`、`analysis/chair-audit.json` |
| 动画/交互/API | + L3.4 | `enhanceWorkstation`、`window.__workstation` |
| 设计树视觉/玻璃/字号/顶栏拖动/Tooltip/检查器/持久化 | + L3.14、L4.1、L5「界面与体验层」 | `src/ui/controlPanel.css`（`--tree-*`）、`controlPanel.ts`（`bindTreeDrag`）、`workbenchController.ts` |
| 自动展示/时间线/暂停跳段/隐藏控件栏/退出恢复 | + L3.16、L4.1、L5「自动展示」 | `src/showcase/showcaseTimeline.ts`、`showcaseController.ts`、`workbenchController.ts`、`controlPanel.ts`、`tools/test_showcase.mjs` |
| 部署/仓库维护/Pages/Qoder Sites | + L3.17、L5「部署与网络」 | `.github/workflows/deploy.yml`、`.gitignore`、`vite.config.ts` |
| 玻璃杯/鼠标垫/桌面小件 | + L3.5/L3.7 | `buildGlassMug`、`createMousepadSurface` |
| 地板/墙体/相机预设/构图/初始机位 | + L3.15 | `analysis/environment-audit.json`、`tools/audit_environment.mjs`、`main.ts` 的 `ENVIRONMENT`/`views` |
| 规格/工厂重建 | + L3.3，全量 L4 | `object-sculpt-spec.json`、`tools/author_spec.py` |
| 截图/最终交付 | + L3.10、L4.1、L4.5 | `tools/final_capture.mjs`、`final_chair_capture.mjs`、`final_shelf_capture.mjs`、`final_ui_capture.mjs` |
| 清理/收尾 | + L4.6、L6 | 只删本轮中间文件，保留最终图与审计 |
| 遇到异常/回归 | + L5 对应小节 | 先取证，再改代码 |

## L0. 30 秒速览

### 0.1 项目一句话

这是一个 **Three.js + TypeScript + Vite** 的程序化办公位数字孪生场景：桌面、隔断、桌顶格架、桌下承重与配电结构、瓷砖地面、双屏、键鼠、水壶、线缆、书包、垃圾桶和人体工学椅均由代码生成，并带有键盘 RGB、屏幕开关、笔记本开合、显示器旋转、椅子旋转/后仰、水壶摆动等运行时交互。外部体验层是左上角、可按住顶栏拖动的 **SolidWorks FeatureManager 风格设计树**：装配体信息、视角/物品/灯光/场景/自动展示/帮助节点、树内物体检查器、11 个机位、4 个场景预设和 localStorage 偏好持久化；自动展示节点内含 7 幕、约 45 秒的一键演出与真实进度/暂停/跳段/重播/隐藏控件栏、底部实时功能字幕，播放完成后自动恢复初始状态。

### 0.2 不可漂移的事实

| 项目 | 当前值 |
|---|---|
| 参考图 | 统一在 `figure/` 按主题命名：`桌面-1..7.jpg`（主参考 `桌面-4.jpg`）；`桌底-1/2.jpg`；`书包-1/2.jpg`；`桌顶架子-1..3.jpg`；`椅子-1..4.jpg`；`水壶-1/2.jpg`；`鼠标-1/2.jpg`；`鼠标垫-1.jpg` |
| 桌面面高 | **0.7575 m**，米制、Y 轴向上 |
| 严格规格 | **84 个组件、33 个材质、7 个重复系统**，严格校验 PASS（`analysis/validation-strict-9.json`） |
| 代码入口 | 工厂 `src/createOfficeCubicleWorkstationDioramaModel.ts`（生成物）；细节层 `src/workstationDetails.ts`（默认修改入口）；体验层 `src/workbenchController.ts` + `src/ui/controlPanel.ts` |
| 界面 | 左上 **SolidWorks FeatureManager 风格 + 玻璃拟态**设计树（品牌/装配体信息/GitHub 仓库横条/视角/物品/灯光/场景/自动展示/帮助/状态栏）、树内物体检查器、Tooltip、Toast；1200×900 全折叠时树位于 `(16, 14)`、宽 **304**、高 **333**（`rgba(245,247,250,0.68)` + `backdrop-filter: blur(12px) saturate(135%)`，夜间深色玻璃）；字号 **13 / 12.5 / 12 / 9.5 / 9 px**，节点行高 **27 / 26 px**；展开多节点时树体内部滚动、页面不撑高；11 机位（主视角/正面/左/右/俯视/桌下/坐姿/键盘/显示器/笔记本/全景）；4 场景（白天/深夜/专注/RGB）；自动展示（约 45 秒 / 7 幕，真实进度、暂停/继续、下一章节、重播、退出、底部实时功能字幕、可选的展示时隐藏设计树与完成后自动恢复初始状态）；本机 `workstation-ui-v1` 持久化，展示隐藏偏好单独存 `workstation-showcase-v1`；**按住顶栏可拖动整棵树**（`transform` 平移、限制在舞台内、初始仍为 `(16,14)`、位置不持久化）。底部 dock 与右侧检查器已移除，不要恢复 |
| 键盘 RGB | 键帽为参考的**由后向前逐行渐变**（F 排近白 `#D9DDDF` → 底排近炭黑 `#4C5458`，字色后三排深、前三排浅）；键缝底光（0.358 × 0.104，`pivot` y=-0.003）+ `keyboard-rgb-light` 点光（0.04–0.10 / 0.55 m / decay 1.9，局部 `(0, 0.095, 0)`）+ 0.55 × 0.15 m 桌面溢光面（`z=-0.055`）；彩虹模式底光不再乘单色；关闭时三层同时熄灭 |
| 紧凑房间 | 浮动 4:3 舞台；地板 **2.4 × 2.25 m**（`y=0`，600 mm 瓷砖）、单面背墙 **2.6 × 2.35 m**（`z=-0.64`）+ 两侧 **0.42 m** 返墙、踢脚 **85 × 18 mm**；工位逐顶点包络 `x -0.855..0.533 / y 0..1.7915 / z -0.34..0.9326`，距背墙 **0.300 m**、距左墙 0.425 m、距右墙 0.587 m；相机正面弧 ±75°、极角 16–88°、距离 0.45–3.15 m、目标半径 0.75 m |
| 默认构图 | `default` 为 3/4 全景（target `[-0.03, 0.78, 0.04]`、az **-26°**、el **20°**、**2.80 m**、fov **52°**）；1200×900 逐顶点投影实测工位高 **80.6%**、上/下留白 **10.3% / 9.1%**；11 个预设参数见 L3.15 |
| 桌下结构 | 落地木侧板 20 mm + 木背板 30 mm + 40 mm 后角铝立柱 + 铝横档（距桌面下表面 1.5 mm）+ 背板底桥架（978×105×45 mm）；旧桌腿 `deskPostFL/FR/RL/RR` 与前/后横梁 `deskRailFront/Back` 已移除；两枚五孔插座 + 敲落孔；仅黑/白 2 条垂落线缆，地面无盘绕线 |
| 地面与地面陈设 | 600 mm 亚光瓷砖（4×4 图集，灰缝约 4 mm）；深酒红书包**背面靠左侧板**、正面朝桌内（**剪切姿态**：包底水平贴地、上半身侧倾约 4.6°，整组距左板 4.9 mm、落地 minY=0；小号散印约 52 + 5 块）；白色冲孔垃圾桶 + 亮绿半透明袋落地置左前外侧（距左板外表面 5.6 mm） |
| 水壶 | UZSPACE 750 ml，实物约 251 × 78 mm；模型瓶身 **206.6 mm**、含盖总高 **251.1 mm**、瓶底距桌面 **161 mm**；薄壁中空 + 不透明深色内胆（液面约 55%）；瓶盖/挂带/挂钩位置保持不动；刻度 650 ml 在上、150 ml 在下 |
| 桌面小件 | 玻璃杯：透明玻璃（opacity 0.05）+ 深色茶汤（约 72% 液面）+ 胡桃木盖；鼠标垫：竖放、偏冷中灰基色 + 深灰折线印花 + 浅灰缝线；桌面无笔 |
| 自动展示 | 设计树一级节点 `自动展示`；**45 s / 7 幕**时间线（整体亮相→空间环绕→桌面细节→设备互动→RGB 灯效→氛围切换→终章全景）；真实进度/章节/时间/百分比与底部白色实时功能字幕；开始/暂停/继续/下一章节/重播/退出；`Space` 暂停、`H` 隐藏控件栏、可选“展示时隐藏设计树”；演示切换相机/灯光/RGB/屏幕/开盖，手动控件互斥；自然完成后停留 2 s 自动恢复快照；证据 `showcase-test.json`（63 项）+ `final-showcase-*.png` |
| 椅子 | 细节层额外物件，不计入 84；中心 `(0, 0, 0.45)`，坐者面向桌子（-z），逐顶点 AABB y 0–**1.241 m**、z 0.102–**0.9326 m**（Box3 旧值 1.249/0.936 因旋转包围盒膨胀约 8 mm）；90 mm 微凹坐垫 + X 背架 + 浅灰翼形腰靠 |
| 头枕 | 网布面 390 × 180 mm（含框外廓约 424 × 226 mm）的叶形网布枕；**正面只有网布与圆框，支撑臂/夹块必须在背面** |
| 桌顶格架 | 搁板面 1.3725 m；净高 330 mm、净宽 1014 mm、净深 290 mm、顶板顶面 1.7275 m、侧板 18 mm、背板 30 mm；格内红书盒 + 16 本书 + 透明 A4 文件盒 + 中秋礼盒（250×150×55）+ 黑果枸杞玻璃罐（Ø90×126）+ 武夷星茶罐（Ø130×212）+ 纸品/黑色剪刀；书高 200–298 mm（三段天际线），最高书顶距顶板 14.7 mm |
| 已移除 | 蓝色中性笔、鼠标编织线、显示器信号线、旧桌腿与前/后横梁、旧搁板铝托架（`shelfBracketL/R`）、旧书列（`shelfProps`/`bookRowB`/`bookEnd`）、旧茶罐（`jarPurple`/`jarOrange`/`teaCanister`）、3 条地面盘绕线缆、架内订书机（实为剪刀，已替换） |
| 最终证据 | `analysis/renders/final/`（`final-under.png`、`final-underdesk*.png`、`final-chair-*.png`、`final-shelf-*.png`、`final-ui-*.png`、`final-showcase-*.png`、`final-keyboard-rgb.png`、`manifest.json`、`shelf-manifest.json`、`ui-manifest.json`）、`analysis/renders/interaction-test.json`、`analysis/renders/showcase-test.json`、`lid-closed.png`、`night-mode.png`、`monitor-pan.png`、`analysis/environment-audit.json`、全部 `analysis/*-audit.json` |
| 构建体积 | 单包约 1,572 kB（2026-10-27 自动展示 45 秒版实测）；Vite 体积提示是已知情况，不是失败 |
| 部署 | GitHub 公开仓库 `Osinglehh/digital-workstation`；push 到 `main` 触发 GitHub Actions 自动构建并部署到 GitHub Pages（`.github/workflows/deploy.yml`，`base: './'` + 相对贴图路径）；线上 https://osinglehh.github.io/digital-workstation/ ；Qoder Sites 公开站点 https://digital-workstation-vcyscgr9sb8.qoder.zone/ （`npm run build` 后 `prepare_site` → `publish_site`，需重新发布时用新 `actionId` + 复用 `projectId`；站点描述文件 `.数字工位 · 可交互 3D 工作区.qoder.site` 由插件生成、含云端 ID，已列入 `.gitignore` 不得提交）；`figure/` 与 `analysis/renders/` 在 `.gitignore` 中、不进 Git |

### 0.3 黄金路径

1. 确认开发服务器已运行：`npm run dev`（`http://127.0.0.1:5173/`）；若共享文件刚被并行任务改写，先重读当前内容。
2. 先读相关函数、节点 id、父级变换和审计数据，再改 `src/workstationDetails.ts`。
3. 尺寸/布局/交互变化同步更新本文件对应事实与 `analysis/*-audit.json`（README 只保留简介与运行/部署说明，不写设计细节）。
4. `npm run typecheck`、`npm run build`。
5. `node tools/test_interactions.mjs`（依赖 dev server），检查 `errors: []`；无头环境阻尼断言可能超时，见 L4.1。
6. 重新截图，并**用图片阅读工具实际查看**；不要只凭命令输出判断视觉正确。改 UI 时运行 `node tools/final_ui_capture.mjs` 更新 `final-ui-*.png` 与 `ui-manifest.json`；改自动展示时运行 `node tools/test_showcase.mjs` 并把关键帧图写入 `analysis/renders/final/final-showcase-*.png`。
7. 按 L4.0 选做对应审计/专项终图（键盘、水壶、椅子、格架、桌下、环境、自动展示）；改 AGENTS 时更新版本/日期与附录。
8. 收尾：按 L4.6 清理本轮临时文件，保留最终图、审计和测试输出。

### 0.4 常用命令

```bash
npm install                         # 首次安装
npm run dev                         # http://127.0.0.1:5173/
npm run typecheck                   # 零错误
npm run build                       # 通过；单包体积提示是已知情况
node tools/test_interactions.mjs    # 交互回归，依赖 dev server
node tools/test_showcase.mjs        # 自动展示回归：播放/暂停/跳段/重播/隐藏/自动恢复与 63 项断言
node tools/final_capture.mjs        # 标准五视图（含 under）、参考构图、白模、转台、manifest
node tools/final_chair_capture.mjs  # 椅子/头枕专项终图
node tools/final_shelf_capture.mjs  # 桌顶格架专项终图
node tools/final_ui_capture.mjs     # 界面终图（桌面/移动、各树节点、检查器、夜景）
node tools/audit_underdesk.mjs      # 桌下结构与地面陈设审计
node tools/audit_shelf.mjs          # 桌顶格架审计
node tools/audit_environment.mjs    # 地板/墙体/工位净距/相机边界/构图留白审计
node tools/capture.mjs front my-view 1200x900
node tools/capture_orbit.mjs label az el dist tx ty tz
```

## L1. 硬规则（默认全部生效）

1. **先理解，后修改**：改代码前先读相关函数、节点 id、父级变换和审计数据；不要只凭变量名猜测。
2. **最小改动**：不引入无关重构、新依赖或全局行为变化；不要为一个视觉微调重置场景。
3. **优先细节层**：视觉、尺寸、动画、材质修正优先改 `src/workstationDetails.ts`；工厂是生成物，手改会在下次生成时被覆盖。
4. **保留用户资产**：`figure/` 参考图、审计 JSON、最终渲染、交互测试输出和用户数据不得删除或覆盖，除非用户明确要求。
5. **不要伪造结果**：只报告实际运行的检查；没跑浏览器/没看截图时必须明确说明；放宽阈值的临时测试不能写成“标准测试通过”。
6. **尺寸与证据同步**：任何改变用户可见尺寸、位置、交互或默认状态的任务，都要更新本文件对应事实与 `analysis/*-audit.json`，并重新截图；README 保持简洁，不写设计细节。
7. **中文交付**：沟通、代码注释、模块说明和项目文档用简体中文；第三方 API、字段名、代码标识符保持原样。
8. **全局记忆需确认**：写入用户级全局记忆前，必须先获得用户明确同意。
9. **Git 与远端**：本项目已托管到公开仓库 `github.com/Osinglehh/digital-workstation`（`main` 分支）；禁止 `git reset --hard`、`git clean`、force push 等破坏性操作；`figure/` 与 `analysis/renders/` 已列入 `.gitignore`，提交时不要强推它们；推送前检查 `git status` 与身份。
10. **清理边界**：只删**本轮自己生成**的临时文件；最终图、审计、参考裁剪、材质证据、测试输出必须保留。无法确认归属的 `_tmp-*` 不要删除，列清单询问用户（见 L4.6）。
11. **用户更正优先**：用户指出的品牌/型号/尺寸/朝向/有无，永远优先于照片与既有规格推断（例：鼠标是英菲克无线、笔记本是耀世 16 Ultra、书包背面靠左侧板、不需要蓝色笔、头枕正面不能有柱子、架内右前方是剪刀不是订书机）。
12. **并发安全**：本仓库可能被多个代理同时修改；写入 `AGENTS.md`、`README.md`、`workstationDetails.ts` 等共享文件前**重新读取当前内容**，避免覆盖他人刚完成的改动。
13. **不要恢复已移除设计**：底部 dock/右侧检查器、蓝色中性笔、旧桌腿/横梁、旧搁板托架/旧书列/旧茶罐、地面盘绕线、架内订书机、实色白底设计树都不要恢复；完整清单见 L2.3。
14. **文档维护**：AGENTS 只保留仍然有效的规则与事实，不堆过程日志；并行任务写入的其他章节不得删除，只改与本任务相关的行。
15. **自动展示只走一条时间线**：展示期间手动视角/灯光/场景控件互斥，暂停同时冻结设备动画；自然完成或手动退出都必须恢复开始前快照，隐藏设计树不暂停时间线，实时字幕与隐藏偏好不得写入场景状态；不要用模拟点击、第二套相机循环或假进度实现（见 L3.16、L5「自动展示」）。

## L2. 架构边界与任务路由

### 2.1 文件边界

| 路径 | 作用 | 修改规则 |
|---|---|---|
| `src/main.ts` | 渲染器、后处理、紧凑房间/墙体、灯光与地面、11 个机位（`views`）、初始相机（必须与 `views.default` 一致）、`window.__workstation` 基础 API、体验层接线；**移动端画质档**（`pointer: coarse` 才启用） | 改光照/机位/地面材质/`ENVIRONMENT` 时进入；UI 逻辑不要写回这里；旧 HUD 已移除，不要恢复；移动端档位参数（像素比上限 1.5、PCF 1024 阴影、跳过 SSAO/辉光）不得影响桌面路径 |
| `src/workbenchController.ts` | 体验层：相机缓动与自动环绕、Raycaster 拾取/包络、灯光与四场景预设、整理/装饰显隐、偏好持久化、快捷键；自动展示桥接（快照恢复、灯光混合、手动互斥、UI 发布） | 改物体检查器行为、场景预设、持久化、设计树节点状态、自动展示状态时进入；保持 `views` 名称与 main 一致；**选中物体不得关闭设计树** |
| `src/ui/controlPanel.ts`、`controlPanel.css` | 左上 SolidWorks 风格玻璃设计树（`--tree-*` 变量、backdrop-filter、字号层级、顶栏拖动/舞台 8px 夹取、视角/物品/灯光/场景/自动展示/帮助）、树内物体检查器、Tooltip、Toast、响应式与暗色主题；自动展示节点（7 幕进度、播放控制、隐藏/恢复控件栏）；**触屏设备（`pointer: coarse`）关闭玻璃模糊、改用 `--tree-bg-fallback`** | 视觉/布局/可访问性/拖动改动入口；拖动只改 `transform`，不要改行内 `left/top`（L5 UI-17）；注意 `:where(.stage-ui) button` 字号重置（L5 UI-13）；不要在这里写 Three.js 场景逻辑；不要恢复底部 dock/右侧浮窗或实色白底；桌面端玻璃效果不得改动 |
| `src/showcase/showcaseTimeline.ts` | 自动展示时间线：45 秒 / 7 幕区间、相机关键帧、场景/RGB/屏幕/开盖事件、RGB 亮度曲线、开场/结尾标题、底部白色实时功能字幕与纯函数求值 | 改镜头、章节时长、事件时间或字幕时从这里改；改后必须跑 `test_showcase` 并同步 L3.16 |
| `src/showcase/showcaseController.ts` | 自动展示状态机：idle/playing/paused/finished/stopped、事件调度、seek/下一章节/重播/退出、真实进度发布、隐藏偏好、自然完成 2 s 后自动恢复、UI 隐藏 | 只通过 `ShowcaseHost` 调用场景；不要在这里直接操作 Three.js 节点或 DOM 控件；不要新增第二个 rAF 循环；自动恢复定时器必须可清理 |
| `src/ui/types.ts`、`src/ui/icons.ts` | UI 状态/预设类型与内联 SVG 图标 | 新增视角/场景/灯效时同步类型、图标与 `workbenchController` |
| `src/createOfficeCubicleWorkstationDioramaModel.ts` | 由 `object-sculpt-spec.json` 生成的工厂，含 84 个组件、材质和节点 id | **生成物**。优先通过规格/生成器修改；直接手改必须同步规格并在交付中注明；贴图 `url` 字段保持相对路径 `textures/...`（Pages 子路径部署需要），不要改回 `/textures/...` |
| `src/workstationDetails.ts` | 运行时细节层：双屏 Canvas、98 键渐变键帽键盘、玻璃杯、书籍、线缆、贴花、材质修正、动画枢轴、英菲克鼠标、薄壁水壶/液体、显示器减薄、竖放鼠标垫、人体工学椅（X 背架/腰靠）/头枕、桌下结构、书包、垃圾桶、桌顶格架 | 默认改动入口；修改前先确定节点 id、父级和已有覆盖函数 |
| `object-sculpt-spec.json` | 场景规格：组件树、尺寸、材质、动画锚点、门禁与评审历史 | 大文件，用 grep 定位 id；结构变化后必须重新严格校验 |
| `tools/author_spec.py` | 规格的可复现编辑脚本，只读写 `object-sculpt-spec.json` | 需要可复现的布局/材质改动时从这里改；运行 `python tools/author_spec.py`，它**不生成工厂** |
| `tools/capture.mjs`、`tools/capture_orbit.mjs` | Playwright 单张 / 指定球坐标机位截图（输出 `analysis/renders/`） | 依赖 5173 端口；试拍图收尾清理 |
| `tools/final_capture.mjs` | 标准交付：五视图（含 `under`）、参考构图、白模、四向转台、`manifest.json` | 含“就绪等待 + 重载重试 + 状态复位”；`shoot()` 必须把机位参数传给 `page.evaluate(fn, arg)`（见 L5-41）；桌下专项隐藏椅子并写 `chairVisible:false` |
| `tools/final_chair_capture.mjs` | 椅子/头枕专项终图 | 依赖 5173 端口 |
| `tools/final_shelf_capture.mjs` | 桌顶格架专项终图（正面、左右 3/4、书列/陈设近景、架顶俯视） | 依赖 5173 端口；写 `analysis/renders/final/shelf-manifest.json` |
| `tools/test_interactions.mjs` | 运行时交互回归（设计树折叠/展开、顶栏拖动、树内检查器、笔记本、RGB、屏幕、场景、视角、自动环绕、持久化 + 显示器/椅子） | 依赖 5173 端口；会覆盖 `interaction-test.json`、`lid-closed.png`、`night-mode.png`、`monitor-pan.png`；无头阻尼阈值见 L4.1 |
| `tools/test_showcase.mjs` | 自动展示回归：节点/播放/暂停/继续/下一章节/重播/退出、手动互斥、树折叠、隐藏与恢复、展示时隐藏选项、实时字幕、设备与场景关键帧、自动恢复、63 项断言 | 依赖 5173 端口；用 `showcase.seek()` 在无头低帧率下定位；写 `analysis/renders/showcase-test.json` 与 `final-showcase-*.png`；截图前把鼠标移开避免 Tooltip 入画 |
| `tools/final_ui_capture.mjs` | 界面终图：桌面设计树、视角/灯光/场景节点、树内检查器、夜景、移动端与键盘 RGB 近景 | 依赖 5173 端口；写 `analysis/renders/final/final-ui-*.png`、`final-keyboard-rgb.png` 与 `ui-manifest.json`；截图前用 `openSection` 展开目标节点 |
| `tools/audit_underdesk.mjs` | 桌下结构与地面陈设审计（逐顶点 AABB、净距、落地、碰撞、旧节点移除） | 输出 `analysis/underdesk-audit.json`；改桌下/地面/书包/垃圾桶/椅子位置后必须重跑 |
| `tools/audit_shelf.mjs` | 桌顶格架审计（逐顶点 AABB，InstancedMesh 叠加实例矩阵；纸张两两与纸张对器物判交；阴影遮挡标志） | 输出 `analysis/shelf-audit.json`；改格架尺寸、书籍尺寸/位置、纸张分层或阴影标志后必须重跑 |
| `tools/audit_environment.mjs` | 环境/相机审计：地板与墙体包络、墙地接缝、踢脚线、工位净距、11 个预设安全边界、逐顶点投影画面留白 | 输出 `analysis/environment-audit.json`；改 `ENVIRONMENT`、`views`、墙体/地面或初始相机后必须重跑 |
| `public/textures/` | 参考 PBR 贴图（约 34 MB），运行时由工厂按相对路径 `textures/...` 加载 | 部署必需；木纹/玻璃/键帽等其余纹理由 Canvas 程序化生成；URL 保持相对路径 |
| `vite.config.ts` | `base: './'` + dev server 配置 | `base` 为 Pages 子路径部署所需，不要改回默认 `/` |
| `analysis/` | 参考裁剪、材质证据、审计 JSON、门禁、渲染 | 可追加证据，不删除被 README 或工具引用的文件 |
| `analysis/renders/final/` | 标准五视图、参考构图、白模、转台、椅子/头枕/格架专项终图、界面终图与 manifest | 交付物，禁止用旧迭代截图覆盖 |
| `analysis/renders/` | 交互测试输出、单张检查图 | 试拍在收尾时清理 |
| `.img2threejs/` | img2threejs 管线状态 | 只在真正走规格重建流程时读取/更新；不是运行时依赖 |
| `dist/` | Vite 构建产物 | 自动生成，不要手改；必要时用 `npm run build` 重建 |
| `.gitignore` | 忽略 `node_modules/`、`dist/`、`figure/`、`analysis/renders/`、`*.qoder.site` | `figure/`（231 MB 参考照片）、`analysis/renders/`（渲染证据）与含云端 ID 的站点描述文件刻意不进 Git |
| `.github/workflows/deploy.yml` | GitHub Pages 自动部署：检出 → `npm ci` → typecheck → build → configure-pages（`enablement: true`）→ upload-pages-artifact → deploy-pages | push `main` 即部署；首次启用 Pages 需在仓库 Settings → Pages 手动把 Source 选为 GitHub Actions（API 令牌无权自动创建站点） |
| `README.md` | 项目简介、在线演示、运行/使用与部署说明 | 保持简洁，不写设计/尺寸/验证细节；开发约定见本文件 |
| `AGENTS.md` | 本文件，项目级代理入口 | 保持 L0–L6 递进结构；版本/日期与附录随任务更新；**不要堆积过程日志** |

### 2.2 症状/主题 → 入口

| 主题或症状 | 优先阅读/修改 |
|---|---|
| 设计树不显示/节点被裁切/主题颜色异常 | `src/ui/controlPanel.css`、`controlPanel.ts`、`workbenchController.ts`；见 L3.14、L4.1、L5-UI |
| 设计树发白/看不到背景/字号回到 16px | `controlPanel.css` 的 `--tree-*`、`backdrop-filter`、`:where(.stage-ui) button`；见 L3.14、L5 UI-13/15 |
| 设计树拖不动/拖出舞台/位置不是 `(16,14)` | 检查 `bindTreeDrag` 的 `transform`、舞台 8px 夹取与 `ResizeObserver`；拖动位置不持久化，刷新应回到 `(16,14)`；见 L3.14、L5 UI-14/UI-17 |
| 玻璃杯茶汤发灰/像陶瓷 | `buildGlassMug`；茶汤保持 `MeshBasicMaterial` 平涂；见 L3.5、L5「桌面小件」 |
| 点击物体无检查器/悬停无高亮/选中框错位 | `workbenchController.ts` 的 `addPickTarget`、`pickAt`、`objectBox`、`refreshHighlight`；检查节点名与可见性 |
| 场景预设/主灯/亮度/RGB 与界面不同步 | `workbenchController.ts` 的 `SCENE_BASES`、`applyLighting`、`applyScene`；`workstationDetails.ts` 的 RGB 状态 |
| 刷新后偏好丢失或恢复错误 | `workbenchController.ts` 的 `STORAGE_KEY='workstation-ui-v1'`、`readPersisted`、`persistNow`；L3.14 |
| 自动展示入口/进度/暂停/跳段/实时字幕/隐藏设计树/完成后自动恢复 | `src/showcase/showcaseTimeline.ts`、`showcaseController.ts`、`workbenchController.ts` 的展示桥接、`controlPanel.ts` 的自动展示节点；见 L3.16、L4.1、L5「自动展示」 |
| 桌顶格架结构/顶板/侧板/背板/安装孔 | `buildShelfHutch`、`shelfPanelWood`；审计 `analysis/shelf-audit.json`；见 L3.13 |
| 格内书籍/书脊印刷/文件盒/书列高度 | `SHELF_BOOKS`、`addShelfBook`、`drawBookSpine`、`addShelfFileBox`；见 L3.13 与 L5-32/42 |
| 中秋礼盒/玻璃罐/茶叶罐/纸品/黑色剪刀 | `addShelfGiftBox`、`drawGiftBoxFront`、`addShelfGlassJar`、`drawJarLabel`、`addShelfTeaTin`、`drawTeaTinWrap`、`addShelfPaperSheet`、`addShelfScissors`；见 L3.13 |
| 键盘楔形、键帽、RGB 不明显/光池过曝 | `slimExternalKeyboard`、`buildWedgeKeyboardCase`、`createKeyLayout`、`drawRgbGlowTexture`、`syncRgbUnderlay`、`keyboard-rgb-light`；见 L3.6 与 L3.14 |
| 笔记本机身/铰链/开合（耀世 16 Ultra） | `buildLaptopHardware`、`LAPTOP_LID_THICKNESS`、开合状态机；审计 `analysis/lid-clearance.json` |
| 英菲克鼠标（无线、放样壳体） | `buildInphicMouse`、`MOUSE_STATIONS`、`buildMouseShellGeometry`、`buildMouseBaseGeometry`（实心底盖，勿移除） |
| 鼠标垫（竖放、印刷、缝线） | `createMousepadSurface`；`nodes.mousepad`：`rotation.y=-π/2`、中心 `(0.330, 0.759, 0.015)`；印刷/缝线是子级随旋转 |
| 水壶（长度、宽颈、瓶盖、刻度、挂钩、摆动支点） | `buildBottleDetails`、`buildBottleHook`、`bottleRadiusAt`、`buildScaledLathe`；摆动见 L3.8 末条 |
| 显示器减薄与后移 | `enhanceWorkstation` 的 `nodes.monitor` 段：面板 9 mm、背壳 14 mm、整机后移 0.070 |
| 椅子/头枕/扶手 | `buildErgonomicChair`，重点看 L3.11；审计 `analysis/chair-audit.json` |
| 椅子正面出现柱子、头枕悬空、夹块穿网 | 先看 L3.11 的“头枕”与 L5-19；用正面/背面/侧面近景各拍一张 |
| 桌下板件/立柱/横档/桥架/插座 | `buildUnderDeskArea`、`buildUnderDeskSockets`；审计 `analysis/underdesk-audit.json`；见 L3.12 |
| 书包（印花/贴片/肩带/靠板/贴地） | `buildBackpack`、`drawBackpackPrintTexture`、`drawBackpackPatchTexture`；审计同 L3.12；见 L5-22 |
| 垃圾桶（冲孔壳体/绿袋/落地） | `buildWasteBin`；alphaMap 冲孔 + 双面材质，见 L3.12 |
| 地面瓷砖/灰缝/夜间地面/桌下补光 | `main.ts` 的 `makeFloorTileMaps`、`floor` 材质、`underDeskFill` 灯光；见 L3.12 |
| 地板/墙体尺寸、墙地接缝、踢脚线、工位离墙净距 | `main.ts` 的 `ENVIRONMENT`、`roomWalls`/`studio-wall-*`/`studio-floor`；审计 `analysis/environment-audit.json`；见 L3.15 |
| 相机预设裁切、留白、初始机位、拖动/缩放边界 | `main.ts` 的 `views`/初始 `camera.position`/`controls`；`tools/audit_environment.mjs`；见 L3.15、L5 的 E-1..E-7 |
| 物体看似悬空/穿面 | L3.2 的 AABB 实测与悬空排查法；不要只凭肉眼调 Y |
| 全局布局、间距、桌面高度 | 本文件 L0.2/L3.x、`analysis/layout-audit.json`、`analysis/collision-report-final.json` |
| 光照、曝光、后处理、机位 | `main.ts` 的渲染器/灯光/composer/`views`（含 `under` 桌下机位）；终图由对应 capture 工具生成 |
| 运行时动画/截图 API | `main.ts` 的 `window.__workstation`，以及 `workstationDetails.ts` 的 `enhanceWorkstation`/`getState` |

### 2.3 当前已实现专项（勿回退）

- 左上 SolidWorks FeatureManager 风格 + 半透明玻璃拟态设计树（304 px / 333 px、13/12.5/12 px 字号、透明头部/装配体/底栏 + 发丝线；夜间深色玻璃）、树内物体检查器、Tooltip/Toast、**顶栏拖动（`transform` 平移、舞台 8px 夹取、位置不持久化）**、暗色主题与移动端；11 机位、4 场景预设、时间制自动环绕、整理/装饰显隐和 localStorage 持久化。底部 dock 与右侧检查器已移除。
- 自动展示（`自动展示` 一级节点）：约 45 秒 / 7 幕（整体亮相、空间环绕、桌面细节、设备互动、RGB 灯效、氛围切换、终章全景）；真实进度条与章节/时间/百分比、底部白色实时功能字幕；开始/暂停/继续/下一章节/重新播放/退出；空格暂停、H 隐藏/恢复控件栏；可选“展示时隐藏设计树”；演示期间手动场景控件互斥，自然完成后停留约 2 秒自动恢复演示前的相机、场景、RGB、屏幕、开盖、装饰与选择状态。
- 键盘：键帽由后向前逐排渐变 + 三层 RGB 氛围光（键缝底光、键帽染色点光与桌面溢光面），关闭模式完全熄灭；彩虹模式保留渐变贴图并让点光/光池色相随时间变化。
- 紧凑舞台：2.4×2.25 m 瓷砖地板（y=0）、2.6×2.35 m 单面背墙 + 0.42 m 返墙、85 mm 踢脚线；工位逐顶点包络与离墙净距已审计；初始/复位 `default` 只显示工位与环境边界，不回到旧的大房间机位。
- 98 键楔形键盘（前低后高、RGB、旋钮、状态灯共享坡度基准）。
- 英菲克无线鼠标（实心放样壳体、侧键/DPI/滚轮）+ 竖放鼠标垫（冷灰基色、深灰折线印花、浅灰缝线）。
- 玻璃茶杯（透明玻璃 + 不透明深色茶汤 + 胡桃木盖、扁提钮、压薄 D 形柄）。
- UZSPACE 宽颈水壶（薄壁中空瓶身、宽颈 lathe、瓶盖零件、刻度贴花、透明粘钩、不透明内胆与约 55% 液面）；瓶身按 750 ml 实物缩短到约 207 mm。
- AOC 薄面板显示器（9 mm 面板、14 mm 背壳）+ 20 mm 耀世 16 Ultra 笔记本。
- 人体工学椅（90 mm 微凹坐垫、X 背架、浅灰翼形腰靠）+ 叶形网布头枕（头枕支撑全部在背面），含旋转/后仰 API。
- 桌下承重与配电结构（落地木侧板/背板、铝立柱、横档、桥架、双插座 + 敲落孔）、2 条垂落线缆（地面无盘绕线）、600 mm 瓷砖地面、深酒红小号散印书包（背面靠左侧板、剪切姿态贴地）、白色冲孔垃圾桶 + 亮绿半透明袋；`under` 机位与桌下专项终图。
- 桌顶格架（参考 `figure/桌顶架子-1/2/3.jpg`）：搁板上方补 330 mm 净高开放格架（顶板 25 mm、侧板 18 mm、加高背板 30 mm + 8 个安装孔），格内为红色书盒 + 16 本程序化印刷书（逐本校准高度，三段天际线）+ 透明 A4 文件盒 + 中秋礼盒（镂空窗印刷）+ 黑果枸杞玻璃罐 + 武夷星茶罐 + 分层纸品/黑色剪刀；架顶另有绿色办公用品盒与白纸。
- 已移除：蓝色中性笔、鼠标编织线、显示器信号线、旧桌腿与前/后横梁、旧搁板铝托架、旧书列与旧茶罐、3 条地面盘绕线缆、架内订书机。

### 2.4 并发任务注意

- `AGENTS.md`、`README.md`、`src/workstationDetails.ts` 可能被其他代理同时改写；写入前重新读取，避免覆盖。
- 并发运行 `final_capture` 等工具会覆盖同名终图；同一个浏览器实例里连续截图较慢（SwiftShader），先确认没有其他任务在拍同一组图再运行。
- 清理只动本轮文件；发现不属于本轮、无法确认归属的 `_tmp-*` 时列清单交给用户（见 L4.6）。

## L3. 修改配方

### L3.1 视觉或尺寸微调（最常见）

1. 在生成工厂中定位节点：`grep -n "节点中文名\|英文id\|__pivot" src/createOfficeCubicleWorkstationDioramaModel.ts`。
2. 阅读 `workstationDetails.ts` 中对应函数，确认是否已覆盖该节点，避免重复创建同名物件。
3. 在细节层修改：
   - 换几何时保留原材质、`castShadow`、`receiveShadow` 和父级变换；优先用现有 `replaceGeometry` 辅助函数。
   - 需要隐藏工厂遗留件时，若后续用 `Box3.setFromObject` 定位，必须把节点从父级移除，而不是只设 `visible = false`。
   - 修改斜面/铰链/键床时，让所有相关子部件共享同一坡度或枢轴，不要逐个凭感觉调 Y。
4. 运行 `npm run typecheck`，随后截图审阅；尺寸变化再补测 AABB 并更新审计。
5. 若改动影响开合、RGB、屏幕、键帽按压、水壶摆动或椅子交互，运行 `node tools/test_interactions.mjs`。

### L3.2 布局、间距与落地

1. 先读本文件 L0.2 与 `analysis/layout-audit.json` 的现有中心点、占地和间距；用户最新实测或明确更正的数值优先于照片比例。
2. 以桌面上表面 `y = 0.7575` 为基准，用世界 AABB 量测落地/悬空，不要只看局部坐标。
3. **悬空排查法**：物体看似悬空时，先实测它的世界 AABB 最低点，再在同一 (x,z) 采样所有可见 mesh 的最高顶面——可能它落在笔袋/支架/副桌面上而不是主桌面。
4. 需要“有意贴合”时（杯垫、触点、纸面），在审计中说明 0–0.5 mm 的接触原因，不要把穿面当成零间距。
5. 对照 `analysis/layout-audit.json` 和 `analysis/collision-report-final.json` 更新数据；重拍正面、侧面或被遮挡方向的近景。
6. 椅子相关布局以 `analysis/chair-audit.json` 为准：椅座前缘 z=0.20 与桌沿齐平，**不能再前移**。

### L3.3 规格或工厂重建

只有在需要改变组件层级、重复系统或工厂级尺寸时才走这条路径：

1. 可复现的改动优先写入 `tools/author_spec.py`（读取 `analysis/pre-spec-assessment.json` 与现有 spec，写回 `object-sculpt-spec.json`），再运行 `python tools/author_spec.py`。
2. 严格校验：
   ```bash
   python forge/stage2_spec/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality
   ```
3. 需要重生成工厂时：
   ```bash
   python forge/stage3_build/generate_threejs_factory.py object-sculpt-spec.json \
     --out src/createOfficeCubicleWorkstationDioramaModel.ts
   ```
   `forge/...` 为 img2threejs 技能目录下的路径；不要把生成器脚本复制进本项目。Windows 下 `python3` 可能是空别名，用 `python`。
4. 重生成后重新应用/检查 `workstationDetails.ts` 的细节补丁，运行类型检查、交互测试和最终截图；生成工厂的手改必须消失或同步回规格。
5. 当前严格校验记录为 PASS（84 组件、33 材质）。若数量变化，同步本文件 L0 与严格校验记录（README 不写设计细节）。

### L3.4 动画、交互与运行时 API

1. 状态和结算放在 `workstationDetails.ts` 的 `enhanceWorkstation`；在 `main.ts` 中加 HUD 按钮或 `window.__workstation` 入口。
2. 动画推进使用真实时间（笔记本开合即如此），避免无头/低帧率下停在半途；测试等待阈值用 **0.999**（闭合）/ **0.001**（重新打开），不要用 0.95。
3. `getState()` 返回可自动断言的状态；新增交互同步更新 `tools/test_interactions.mjs`。
4. 交互测试依赖 dev server；运行后检查 `errors: []`，并实际查看 `lid-closed.png`、`night-mode.png`、`monitor-pan.png`。
5. 需要公开的运行时 API 示例写入 README 的“使用”小节（保持简洁）；设计细节与实测值写本文件。

### L3.5 材质、颜色与光照

1. 参考裁剪与材质证据在 `analysis/crops/`、`analysis/material-crops/`；运行时木纹/玻璃/键帽等贴图由 Canvas 程序化生成。
2. 全局曝光为 `renderer.toneMappingExposure = 0.74`，背景为中灰渐变；改光照或色调后必须重拍正面视图并与参考对照。
3. 共享材质（木饰面、键帽、玻璃）在多个物件间复用；改变体前先确认是否影响其它物件。
4. 纯色小件优先用工具材质 + Canvas decal，避免把无关背景烘进参考贴图；无证据时不要新增外部纹理或模型。
5. **玻璃茶杯（`buildGlassMug`，参考 桌面-4.jpg）**：工厂米色杯体/盖/柄已隐藏，显示件全部由细节层重建。玻璃 `opacity 0.05 / roughness 0.035 / envMap 0.5`，杯底用单独冷绿材质（`#DCE9E2`、opacity 0.14）表现厚玻璃；茶汤是 `MeshBasicMaterial` 平涂（`#150803` 体 / `#1E0C06` 液面，液面在杯高约 72%、局部 y=0.0285），**不要再改回带光材质**——会被主光照成灰棕陶瓷感；木盖 `#6E4B36 / roughness 0.5`、盖顶纹理底 `#7A563F` 已被 `#F2E7DC` 相乘提亮，提钮压扁到 `scale.y 0.46`，杯柄（半环）压薄 `scale.z 0.78`。

### L3.6 键盘专项（当前已实现，勿回退）

- 键盘为 98 键、17 列 × 6 行，键床/键帽/图例/RGB 垫片同属 `98 键渐变键帽矩阵__pivot`。
- 楔形参数：壳前 11 mm、壳后 18 mm，底部水平；脚垫 2 mm；键床坡度 `atan(0.007 / 0.144) ≈ 2.78°`；常量在 `KEYBOARD_CASE_*` / `KEYBOARD_DECK_*`。
- 实测目标：脚垫底面 y=0.7575；前缘约 13.1 mm、后缘约 19.9 mm；键帽顶前排约 24.3 mm、后排约 29.2 mm；旋钮顶约 31.9 mm。
- 楔形通过 `buildWedgeKeyboardCase()` 只抬升 `RoundedBoxGeometry` 的顶部顶点，底面保持平面；不重算法线是有意为之（避免圆角分缝硬边）。
- 定位板、状态灯和旋钮都使用同一坡度/高度基准 `keyboardDeckTop(z)`；不要单独旋转键床或只改旋钮高度。
- 键盘的旧工厂高脚、旧旋钮必须从父级移除（不是仅隐藏），否则 `Box3` 定位会把键盘垫高。
- 徽标贴花在 `keyboardDeckTop(-0.062) + 0.0003` 处；调整楔形后同步检查贴花是否陷入键床。
- **键帽渐变（参考 桌面-4.jpg）**：`createKeyLayout` 的 `rowColors` 按排给定 `#D9DDDF / #C5CACC / #AAB1B4 / #8B9296 / #6B7377 / #4C5458`，修饰键与同排字母键同色；空格 `#3F474B`。图例平面同一张贴图内**按排切字色**（row ≤2 深字、≥3 浅字），改了排色必须同步改字色，否则深色排的字会消失。
- **RGB 三层结构（当前为“渐变键帽 + 氛围溢光”）**：
  - 键缝底光：`createKeyLayout` 的 `underlay` 平面 0.358 × 0.104、`pivot` 局部 y=-0.003，加色混合；彩虹贴图为彩色渐变，单色/呼吸/柔光用灰度渐变由材质 `color` 染色。**彩虹模式必须把材质 `color` 保持白色**，否则整条渐变会被单色相 Multiplication（早期发灰的根因）。深度必须收在 `0.104`：加到 0.116 以上时前排键帽底部 0.7 mm 缝会把它透成一条连续前沿光带。
  - 键帽染色点光：`keyboard-rgb-light`（PointLight，`castShadow=false`）挂在 `nodes.keyboard`，局部 `(0, 0.095, 0)`，distance 0.55、decay 1.9；静态/彩虹 0.09–0.10、呼吸 0.04–0.14、柔光 0.04。位置必须抬到键床上方中央：放在 `(0, 0.07, 0.015)` 时会在机身前沿斜面烧出一条粉色高光带。
  - 桌面溢光面：`keyboard-rgb-desk-glow` 0.55 × 0.15，局部 `(0, 0.00012, -0.055)`，`drawRgbGlowTexture()` 径向柔光 + AdditiveBlending；前缘必须留在机身投影内（`z=-0.055` 时前缘 +0.02），否则会从壳体 2 mm 离地缝里露成前沿硬光带。透明度静态/彩虹 0.44–0.46、呼吸 0.14–0.50、柔光 0.20。
  - 亮度参考：单色/彩虹键缝 opacity 0.95–1.0；呼吸 0.42–0.98；柔光 0.5。关闭时底光、点光、溢光同时隐藏，不能只关键缝。
  - 不要恢复键盘前沿的整条硬 RGB 灯带；键帽本身按参考做渐变，但仍以深灰为主，不要整体改黑。
  - 自检：`node _tmp` 类五模式探针拍 `rainbow/static/breathe/soft/off` 并用图像阅读逐张查看；交付图是 `analysis/renders/final/final-keyboard-rgb.png`，临时五模式图收尾删除。

### L3.7 鼠标专项（英菲克无线，当前已实现，勿回退）

- 壳体为 9 站超椭圆截面放样（`MOUSE_STATIONS`，格式 [z, 半宽, 顶高]），`mouseStationAt(z)` 插值。
- **底盖必须是实心**（`buildMouseBaseGeometry` 返回 RoundedBoxGeometry 0.066×0.0024×0.114）：早期用放样环封底在低角度会因背面剔除/法线朝下看穿成“空心鼠标”。壳体材质同时设 `side: THREE.DoubleSide` 兜底。
- 鼠标是**无线**型号：无出线护套、无编织线；不要重新添加线缆。
- **鼠标垫竖放**：`nodes.mousepad.rotation.y = -Math.PI/2`，中心 `(0.330, 0.759, 0.015)`，占 x 0.205..0.455、z -0.155..0.185。鼠标是垫子子级，朝向补偿 `+π/2`（`shellNode.rotation.y = -0.28 + Math.PI/2`）。
- **垫面**：基色 `#A8ABAE` 偏冷中灰 + 织物贴图（`drawFabricTexture` / `applySurfaceMaps('fabric')`）；印花由 `createMousepadSurface` 的 1024×512 Canvas 绘制（深灰折角带 + 竖条 + `inphic` 与长句 + 角标点列），缝线用 220 段 InstancedMesh、颜色 `#C6C9C9`。改基色时同步看缝线对比。
- `moveMouse` 的 clamp 基于垫子局部坐标（竖放后局部 X=前后 340 mm、局部 Z=左右 250 mm）：x∈[-0.155,0.155]、z∈[-0.11,0.11]。
- 滚轮轴向 +X，`spinWheel(delta)` 已实现；左裙两枚侧键、两道防滑槽、DPI 键、V 形灯标、尾部线条徽标都是子部件，改壳体截面时同步检查位置。

### L3.8 水壶专项（UZSPACE 宽口，当前已实现，勿回退）

- 工厂 lathe 颈部收到 0.24 比例（≈20 mm）与实物不符；细节层已用 `buildScaledLathe` 替换为**薄壁中空**轮廓：外壁保持宽颈肩线（顶口 0.45 比例），内壁按 2–3 mm 壁厚内缩、底部约 5 mm 厚（`neckProfile` 为闭合折线）。早期版本内腔半径只有 0.18 比例（≈15 mm），液体会被嵌进壁里看不见。`bottleRadiusAt` 仍描述外壁：y≥0.05 区间从 0.0408 缓收到 0.0383；压缩后的局部 y 范围是 **[-0.0715, 0.135]**。
- **尺寸基准**：实物 750 ml 规格约 251 × 78 mm。瓶身 `scale.y=0.765`、`position.y=0.135*(1-scale.y)`，瓶身 206.6 mm，含盖总高 251.1 mm；瓶顶/瓶盖/挂带/挂钩连接点保持不动，瓶底距桌面约 161 mm。改长度时两个系数必须成对调整，否则瓶口与瓶盖脱节。
- **材质**：烟灰半透明磨砂塑料——`color '#858B86'`、`roughness 0.7`、`transmission 0.26`、`thickness 0.005`、`ior 1.46`、`clearcoat 0`、`side DoubleSide`，并**必须 `transparent = true`**：`transmission` 只有挂在透明材质上才进入 three.js 的折射采样通道，否则整瓶渲染成实心灰塑料。
- **瓶内液体**：`bottle-liquid` 组挂在 `nodes.bottle`（枢轴空间，不要再挂到 `meshes.bottle`，否则会被 0.765 的纵向压缩二次缩放）。不透明深色 `#232926` 的锥面圆柱 + 液面圆片，液面约在瓶身 55% 高度（局部 y=0.0421）。液体**必须不透明**——透明物体不进入 transmission 采样，液面会整体消失。瓶身加过液体后，改瓶身长度要同步复核液面高度。
- **刻度贴花**：`addBottleWrapDecal`（CylinderGeometry thetaStart=-arcRad/2，theta 从 +Z 起算），`wrap.rotation.y=-50°` 朝向正面相机；贴片高 **0.16**、局部 y=**0.02**，底缘约 -0.06（高于瓶底 -0.0715），不得探出瓶底。数字顺序与实物一致：**650 ml 在最上、150 ml 在最下**。
- 瓶盖为零件拼装（baseRing/lid/sipRecess/hinge/latch/双耳/loopBar，capY=0.015）；工厂 `meshes.bottleCap` 已隐藏。
- 透明粘钩 `buildBottleHook` 替换工厂黑色方块挂钩；水壶由挂带承托，**没有瓶身出线或桌面落座**。
- 摆动动画通过 `swayBottle(deg)` 控制（界面“轻摆水壶”= 2.2°，默认 0.02 rad）。**支点必须取挂带最高处（与挂钩的接触点）**：`bottleSwayPivot` 在初始化时用 `Box3(meshes.bottleStrap).max.y` 换算到父空间，tick 里先按 `rotation.x/z` 摆动，再用 `position = pivot + (basePos − pivot) · R` 补偿，让顶部挂钩处不动、瓶身向下摆（主摆动在前后 ±z，左右 ±x 只用 45%，避免下摆贴到右侧木板）。改法前是绕瓶身原点转，会出现“顶部位移、底部不动”的反向效果。

### L3.9 显示器与笔记本厚度基准（用户已确认）

- **显示器**：面板 9 mm（`RoundedBoxGeometry(0.54, 0.322, 0.009)`）、背壳 14 mm 贴近背面；整机 pivot 后移 0.070、左移 0.0215。圆盘底座与立柱是 monitor pivot 的子级，随整机移动。信号线已删除，只剩电源线。
- **笔记本（耀世 16 Ultra）**：底座 `RoundedBoxGeometry(0.357, 0.0145, 0.264)`、上盖 5.5 mm，总厚 20 mm ≈ 实物 20.6 mm。掌托/键盘井/触控板与 C 面齐平；支架前托钩压扁到 8 mm。
- 两块屏幕面深度差约 16 mm（显示器 -0.197、笔记本 -0.181），这是用户确认的目标状态。

### L3.10 渲染与截图

1. 常规单张：`node tools/capture.mjs front my-view 1200x900`。
2. 指定机位：`node tools/capture_orbit.mjs label az el dist tx ty tz`（输出到 `analysis/renders/`）。
3. 标准交付：`node tools/final_capture.mjs`，生成五视图（含 `under`）、参考构图、白模、四向转台与 `manifest.json`；脚本内置“页面就绪等待 + HMR/并发重载重试 + 状态复位”，改脚本时保留该逻辑。
4. 椅子/头枕交付：`node tools/final_chair_capture.mjs`。
5. 格架交付：`node tools/final_shelf_capture.mjs`。
6. 小件（水壶、鼠标、礼盒、书列等）用 `window.__workstation.setOrbit(az, el, dist, target)` 取近景自检；**`setOrbit()` 直接返回截图 dataURL**，拿到后不要再调 `capture()`（它按命名预设重设机位，会把近景覆盖掉）。自检图属于试拍，收尾删除（除非用户要求保留为证据）。需要判读平面印刷时可临时把 Canvas 贴图 `image.toDataURL()` 导出成平面稿，再与参考裁切并排比对。
6a. **探针驱动交互的两条路**：交互 API 并不都在 `window.__workstation` 上（例如 `swayBottle` 只在 controller 内），需要触发时走界面路径——`document.querySelector('[data-object="bottle"]').click()` 展开检查器后，用按钮文本（如“轻摆水壶”）匹配并点击；只做断言时直接读 `window.__workstation.scene` 里的节点/几何。
6b. **采样动画要留足时间窗**：无头环境 `animate()` 把 `dt` 钳到 0.05 s，`elapsed` 按帧推进（约 1–2 fps ≈ 0.1 s/s），采样正弦类摆动要按 ≥15 s 窗口才能覆盖完整包络，否则会低估幅度（本项目实测曾把 2.2° 摆动误判成 0.3°）。
7. Playwright 使用本机 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）和 SwiftShader 参数；脚本已处理。截图较慢（每张约 15–25 s），批量脚本要留足超时。
8. 截图后必须用图像读取能力实际查看：落地、遮挡、穿面、贴花朝向、印刷正反、前景遮挡、整体色调。**低角度和背面视角必须各拍一张**。

### L3.11 椅子与头枕专项（当前已实现，勿回退）

- 参考为 `figure/椅子-1..4.jpg`，无品牌通用网布转椅；整椅在 `buildErgonomicChair()` 构建，挂到 `enhanceWorkstation` 的 root，不参与工厂规格（组件数仍 84）。
- **位置**：椅子中心 `(0, 0, 0.45)`；坐者面向桌子（-z），椅背朝外（+z），`rotation.y = π`。座面高 `SEAT_TOP = 0.45`；hub y=0.10、底盘 y=0.415、气压杆跨 0.13–0.37。椅座前缘世界 z=0.20，正好贴住桌沿；**不能再前移**。
- **实测 AABB**：y 0–1.241 m（头枕顶）、z 0.102–0.9326 m，见 `analysis/chair-audit.json`。
- **结构**：五星脚（5 条 RoundedBoxGeometry 腿 + 末端叉架 + 五组并排双轮滚轮，轮半径 0.026 落地）→ 双段气压杆 → 底盘/操纵杆 → 坐垫（0.50×0.09×0.50 海绵 + 顶面微凹网布面）→ backPivot（后仰基准 -8°，其上挂背框/网布/X 背架/脊梁/腰靠/头枕）。
- **坐垫网布**：`seatPadGeo` 为 0.46×0.44 的 24×24 平面，中心微凹 8 mm（椭圆碗形）+ 前缘再压 6 mm 形成瀑布前缘，基准 `SEAT_TOP + 0.003`；不要再改回 0.46×0.02×0.45 的平板。
- **背部结构（参考 椅子-1 背面）**：`backPivot` 上除背框/网布外还有——全宽 X 背架（两条 `RoundedBoxGeometry(0.042, 0.58, 0.028)` 局部 `(0, 0.28, -0.09)`、`rotation.z = ±0.38`）、浅灰翼形腰靠（`#8A908E`、中央板 0.21×0.145 + 两侧翼板、孔面朝后，组局部 `(0, 0.15, -0.07)`）、两根金属横杆（r=0.0035、长 0.30、y=0.072/0.098、z=-0.094）、中央脊梁（0.075×0.60×0.030、z=-0.095）。腰靠必须在脊梁前方（更小的 |z|），否则脊梁会把腰靠从中间切开成两块灰板。
- **网布材质**：`chairMeshMaterial()`：**材质色必须为白色**，织纹对比由 `drawMeshWeaveTexture()` 自身负责（底 `#26292C`、孔 `rgb(12–22)`、纱线 `#42474A/#3A3F42`）+ `drawMeshWeaveBump()` 网孔 bump + `sheen 0.06`；早期用 `color '#2A2D30'` 相乘会把整块布压成近黑、织纹不可读。**不要套用 `applySurfaceMaps('fabric')`**。
- **背框/头枕框**：`buildFrameLoop()` 生成 CatmullRom 管；网布面板 `buildMeshPanel()` 必须 `side: DoubleSide`。
- **头枕**：网布面 390 × 180 mm（含框外廓约 424 × 226 mm）的叶形网布枕，组位置 backPivot 局部 `(0, 0.61, -0.058)`、后仰 -6°；正面只有网布与圆框，**不得出现任何支架或柱子**。
  - 背面夹块 0.095×0.10×0.03 局部 `(0, 0.12, -0.043)`；支撑臂 0.07×0.20×0.036 局部 `(0, 0.06, -0.064)`；底夹 0.11×0.06×0.075 局部 `(0, -0.04, -0.040)` 抱住顶梁；铰点螺栓 r=0.015、x=±0.057。
  - 早期 `neck`/`slider` 放在 +z 前脸被用户否定，已移除，勿回退。
- **扶手**：挂在 seat 组，闭合三角框（后立柱 0.25 高 + 0.34 m 扶手垫 + 前斜撑），垫子前后两端都与座垫侧面连接。
- **机位**：`views.front` 为 `[0, 1.72, 2.19]`、目标 `[0, 0.88, 0.10]`（fov 48）；否则椅背会挡住桌面。
- **运行时 API**：`swivelChair(deg)`、`reclineChair(deg)`；`chairYawDeg` / `chairReclineDeg` 已进 `getState()` 并在 `window.__workstation` 暴露。

### L3.12 桌下结构、地面与地面陈设专项（当前已实现，勿回退）

- 参考 `figure/桌底-1/2.jpg`、`figure/书包-1/2.jpg`、`figure/桌面-2.jpg`；整组在 `buildUnderDeskArea()`（含 `buildUnderDeskSockets`/`buildUnderDeskCables`）、`buildBackpack()`、`buildWasteBin()` 构建，挂 root，不计入工厂规格。
- **结构（实测 AABB）**：落地木侧板 20 mm（x ±0.505..±0.525，z -0.30..0.17，高 0..0.7325）；木背板 30 mm（1050 × 732.5，z -0.33..-0.30）；后角铝立柱 40 × 40；铝横档 1050 × 28 × 14（y 0.703..0.731，距桌面下表面 1.5 mm）；背板底桥架 978 × 105 × 45（y 0..0.105）。**旧桌腿与前/后横梁已移除**。
- **配电**：两枚 86 × 86 mm 五孔面板（中心 x=0.105 / 0.205）+ 右侧敲落孔；面板与桥架共用铝材质（`#CDD0CF`、metalness 0.48），立柱 `#D1D3D2`、metalness 0.62。
- **线缆**：仅 `under-desk-black-drop` / `-white-drop` 两条垂落线（末端插入插座）；**地面不画盘绕线**（勿恢复 `-black/white/grey-floor-loop`）。
- **地面**：`makeFloorTileMaps()` 4×4 图集（2048²，600 mm 砖、灰缝 `#7D796F`）；albedo 用 tone 180 起（勿回 210）；夜模式 `floor.material.color` → `#2A2825`、`underDeskFill` 0.30→0.14。
- **书包**：**背面靠左侧板内表面、正面朝桌内（+x）**，姿态用**剪切矩阵**：`matrixAutoUpdate=false`、`matrix = makeShear(0,0,-0.08,0,0,0) · makeRotationY(1.50)`、`setPosition(-0.357, -0.0035, -0.022)`；印花为**小号散印**（约 52 块随机方向含倒置 + 5 块中号 + LE CHRONO 徽标）、底色深酒红 `#4A2A33`、字色 `rgba(226,218,206,0.30–0.56)`、加宽黑前袋（0.286）+ BAP 贴片；肩带落地段局部 y=+0.008。实测：距左板 4.9 mm、落地 minY=0、离椅 42.4 mm。
- **垃圾桶**：`buildWasteBin()`，浅灰冲孔壳体 lathe + `alphaMap`（12×5 竖槽，`alphaTest: 0.5`、`DoubleSide`）+ 亮绿半透明垃圾袋（`#6FBF7C`、opacity 0.55、roughness 0.28；整圈外翻薄壁袋口 `fold` 半径 0.146→0.139 + 顶圈 torus 0.1455）；Ø289 × 359 mm，距左板外表面 5.6 mm。
- **机位与终图**：`views.under` 低位左前；`final_capture.mjs` 拍 `final-underdesk*.png` 时隐藏椅子并写 `chairVisible:false`。
- **审计**：`node tools/audit_underdesk.mjs` → `analysis/underdesk-audit.json`；书包/垃圾桶对椅子用逐子件 AABB + 最小间隙判定。

### L3.13 桌顶格架与格内陈设专项（当前已实现，勿回退）

- 参考 `figure/桌顶架子-1/2/3.jpg`；整组在 `buildShelfHutch()` 构建（`enhanceWorkstation` 内调用，挂 root，不计入工厂规格），子函数：`shelfPanelWood`、`addShelfBook`/`drawBookSpine`、`addShelfFileBox`、`addShelfGiftBox`/`drawGiftBoxFront`（辅助 `drawGiftBoxPavilion`/`drawGiftBoxCloud`/`drawGiftBoxBlossom`/`drawGiftBoxPlum`）、`addShelfGlassJar`/`drawJarLabel`、`addShelfTeaTin`/`drawTeaTinWrap`、`addShelfPaperSheet`、`addShelfScissors`、`addShelfTopClutter`、`addShelfContactShadow`。
- **基准常量**：`SHELF_TOP_Y=1.3725`、`HUTCH_CLEAR_HEIGHT=0.330`（净高，按 A4 文件盒 315 mm + 15 mm 余量反推）、`HUTCH_TOP_THICKNESS=0.025`（顶板顶面 1.7275）、`SHELF_PROP_BASE_Y`（书/文件盒 1.3728）、`SHELF_PAPER_TOP_Y`/`SHELF_PAPER_B_TOP_Y`/`SHELF_PAPER_STACK_TOP_Y`（分层纸面 1.3732/1.3734/1.3741）、`SHELF_GIFT_BASE_Y`/`SHELF_CAN_BASE_Y`（1.3734/1.3736）。改净高后必须同步检查顶板、侧板、背板与所有器物高度。
- **结构（实测 AABB）**：背板 1050 × 330 × 30（z -0.33..-0.30，8 个 Ø7 mm 安装孔在顶板下方 48 mm）；左右侧板 18 mm（x ±0.507..±0.525，z -0.30..-0.01）；顶板 1050 × 25 × 310（前沿 z=0，比侧板前伸 10 mm）；搁板复用工厂 `shelf` 并替换为 25 mm 倒角板。格内净宽 1014、净深 290。
- **阴影遮挡**：`meshes.shelf.castShadow = true` 必须保留，否则架上物件（剪刀等）的影子会穿过搁板落到下方背板；`meshes.partition.receiveShadow = false` 让背板保持参考中的均匀受光，避免主光压出楔形暗带；顶板不参与投影以保持格架内部亮度，架顶绿色盒/本子关闭实时投影并使用 `addShelfContactShadow` 接触阴影贴地。
- **旧件移除**：`shelfBracketL/R`、`shelfProps`、`bookRowB`、`jarPurple`、`jarOrange`、`teaCanister`、`bookEnd` 必须 `parent.remove`（不能只隐藏）。
- **书籍**：`SHELF_BOOKS` 16 项 + 内联 `red-case`；顺序：红书盒 → OpenCV3 编程入门 → 机械设计(第三版) → 机器人加工视觉测量与力控技术 → 机器人学导论 → 2023 年研究生手册 → 机器视觉 → 视觉 SLAM 十四讲 → 机器学习 → 数字图像处理(第三版) → 透明 A4 文件盒 → 机器人学 → 健康营养饮食 → 杀死一只知更鸟 → 当我谈跑步时我谈些什么 → 动物庄园 → 红岩。书脊由 `drawBookSpine` 生成（竖排标题、色带、出版社小标；深色书脊用底部小标、浅色书脊用整条出版社带；Pearson 菱形 / 西瓜标等）。
  - **尺寸按参考逐本校准（单位 mm，高）**：红书盒 288 / OpenCV 280 / 机械设计 262 / 机器人加工 272 / 机器人学导论 256 / 研究生手册 252 / 机器视觉 258 / 视觉 SLAM 256 / 机器学习 274 / 数字图像处理 298 / 文件盒 315 / 机器人学 280 / 健康营养饮食 216 / 杀死一只知更鸟 210 / 当我谈跑步时 208 / 动物庄园 200 / 红岩 222。**三段天际线：左段 256–288、中段 252–280、右段 200–222（右段必须明显矮于中段）**；短书同时取更浅进深（144–150 mm）。
  - 书籍贴后板（`SHELF_BACK_Z=-0.298`），允许 ±8 mm 前后错落与 ±0.012 rad 偏航；书脊朝前（+z）。
- **文件盒**：42 × 315 × 288，透明浅蓝（`clearPlasticMaterial`，opacity 0.48、`depthWrite:false`），内部白色纸块 + 蓝色分隔片，书脊面 3 枚金属铆钉；后沿 z=-0.298。
- **礼盒**：250 × 150 × 55（横向盒面，宽高比 1.667，印刷画布 1024×614）：橙色渐变底 + 底部金色标语带；**月盘是按参考拟合的大圆**（圆心 `(608, 552)`、r=457，弧顶横跨窗口上方，`createRadialGradient` 淡金填充 + 细金描边）；**圆角镂空窗**（`win.x0/x1=300/758`、`yBot=518`、左段顶 `yTL=282`、右段顶 `yTR=196`——**右段更高**，中间用两段贝塞尔做如意收头，奶白描边 + 细金线）；窗内皇家蓝底 + 浅蓝楼阁线稿 + 右上格纹 + 金云 + 梅枝白花；窗内左下角灰蓝插卡只到窗高 58%；淡金色月耀/喻园（`#F4CFA0`）；校徽与“华中科技大学”在月盘内 `(520, 150)`；顶部 MID-AUTUMN/FESTIVAL（`#DFB455`）；底部“月满人团圆 千里共婵娟”与圆点。底面 y=1.3734。**改窗口几何要先重算月盘可见弧带**（改前先用 `_tmp` 探针把 Canvas `toDataURL()` 导出成平面稿比对 `giftbox-ref-full.jpg`）。
- **右侧陈设定位**：`giftCenter = bookRowEnd + 0.010 + 0.125`、`jarCenter = giftCenter + 0.1782`、`tinCenter = jarCenter + 0.1225`；礼盒—玻璃罐 5.3 mm、玻璃罐—茶叶罐 7.0 mm、茶叶罐—折叠纸 3.8 mm。**改礼盒宽度或书列总宽后必须复算这三个中心点并重跑审计**。
- **玻璃罐**：Ø90 × 126（含盖），**高透玻璃**（`color '#E9F2EF'`、opacity 0.14、transmission 0.5、roughness 0.08）+ 深紫内容物（`#1C0F20`，装到约六成、上部留空）+ 46 颗实例化果粒（`#3E2044 / #1B0D20`）+ 银灰旋盖 + 环绕标签（黑果枸杞/QR/净含量）；底面 y=1.3736。玻璃别再加蓝灰色（`#BCD0D5` + 0.32 透明度）——会把整罐洗成灰浊。
- **茶叶罐**：Ø130 × 212（含盖），黑哑光罐身 + 金线、武夷星 logo、山茶枝与花、红印 + 金色盖缝环；底面 y=1.3736。
- **纸品与黑色剪刀**：A 纸 230×210（x -0.02..0.212）、B 纸 280×210（x 0.224..0.503）、前沿带手写散纸 260×90（顶面 1.3741，搭出搁板前缘约 2 mm）；**剪刀**（用户更正，不是订书机）：双刀刃 + 枢轴螺钉 + 双指环，长约 155 mm，`ExtrudeGeometry` 平面轮廓放倒后绕 Y 倾 0.0195 rad 让刀尖贴纸；组 `shelf-scissors` 在 `(0.42, 纸面+0.0045, -0.05)`、`rotation.y=π+0.06`；与茶叶罐保持约 3 mm 净距。
- **架顶**：绿色办公用品盒（160×52×120，二维码标签 50×42 mm 是盒体子级）+ 绿色薄本子 + 两张 A4 白纸，全部落在顶板（1.7275）上。
- **机位与终图**：`tools/final_shelf_capture.mjs` 生成 `final-shelf-front/left34/right34/books/props/top.png` + `shelf-manifest.json`；近景机位：正面 `(0,5,1.45,[0,1.52,-0.15])`、书列 `(-14,4,0.72,[-0.23,1.50,-0.16])`、陈设 `(10,4,0.72,[0.28,1.48,-0.16])`、架顶俯视 `(8,32,0.95,[0,1.55,-0.15])`。
- **审计**：`node tools/audit_shelf.mjs` → `analysis/shelf-audit.json`；InstancedMesh 必须叠加实例矩阵；纸张两两、纸张对书籍/器物也要判交。改格架尺寸、书籍尺寸、器物直径、纸张分层或阴影标志后必须重跑；`shadowOcclusion=true` 是阴影修复的门禁。
- **参考裁切证据**：`analysis/crops/shelf-section-grid.jpg`（带网格剖面）、`shelf-structure-wide.jpg`（整体结构）、`shelf-books-left.jpg`、`shelf-props-right.jpg`、`giftbox-ref-full.jpg`、`giftbox-ref-window.jpg`、`books-grid-2.jpg`、`books-compare.jpg`（参考 / 渲染上下对照）。

### L3.14 左上设计树与体验层专项（当前已实现，勿回退）

- **分层**：`main.ts` 保留场景/灯光/相机/后处理/基础自动化；`workbenchController.ts` 负责相机缓动、Raycaster 拾取、场景预设、灯光状态、整理显隐、持久化与快捷键；`src/ui/*` 只负责 DOM/CSS。不要在 `main.ts` 恢复旧 HUD，也不要把 Three.js 物件逻辑塞进 `ui/`；**不要恢复底部 dock 或右侧浮窗**。
- **设计树结构**：`ControlPanel` 创建 `.design-tree`，默认位于舞台左上、可按住顶栏拖动（`top:14px; left:16px; width:304px`，1200×900 全折叠高 **333**），包含：
  - `.tree-head`：品牌图标、`数字工位`、`FeatureManager · 设计树`、GitHub 图标链接 `.tree-github`、整体折叠按钮 `.tree-collapse`；
  - `.tree-doc`：`工作位装配体` + `84 组件`/`33 材质` 徽标；
  - `.tree-repo-bar`：常驻 GitHub 文字横条（图标 +「GitHub 开源仓库 · 欢迎 Star」+ ↗，整行新窗口打开），在装配体信息与节点区之间；整树折叠时与 doc/body/foot 一起隐藏；
  - `.tree-body`：根行 `数字工位装配体` + `.tree-children` 中的视角/物品/灯光/场景/自动展示/帮助六个 `.tree-node`；
  - `.tree-foot`：状态点、`tree-status-text`（场景 · 视角 · 已选 · 环绕中）、操作提示。
  `.tree-row` 保留 `.dock-group` 类和精确 `aria-label`（视角/物品/灯光/场景/自动展示/帮助），测试与快捷定位依赖它；节点正文 id 为 `ws-section-<name>`，与 `aria-controls` 对应。自动展示节点的正文在 L3.16。帮助节点正文末尾固定一行 `.help-repo-link`（`GitHub 开源仓库 · 欢迎 Star`，新窗口打开）；`.tree-github`、`.tree-repo-bar` 与 `.help-repo-link` 均由 `controlPanel.ts` 的 `REPO_URL` 常量指向公开仓库，不要改成硬编码分支或相对路径。
- **玻璃拟态与字号**：`--tree-bg`（日 `rgba(245,247,250,0.68)` / 夜 `rgba(23,26,31,0.66)`）、`--tree-blur: 12px`、`--tree-saturate: 135%`、`--tree-radius: 14px`；字体变量 `--tree-font-title/node/leaf/meta/micro` = **13/12.5/12/9.5/9px**，行高 `--tree-row-height/--tree-leaf-height` = **27/26px**。头部、装配体信息、底栏只用透明底 + 发丝线，**不要把实色渐变/白底加回去**，否则 `backdrop-filter` 看不到场景。`@supports not ((backdrop-filter) or (-webkit-backdrop-filter))` 时回退 `--tree-bg-fallback`。`design-tree` 不做入场动画：无头 SwiftShader 会把 transform 冻结在偏移位置，污染截图与 `designTree` 实测；`transform` 只用于顶栏拖动，初始必须为 `none`。
- **顶栏拖动**：`.tree-head` 上 `pointerdown`（左键/触摸，排除 `a/button/input/select/textarea`）后 `setPointerCapture`，按指针位移给 `.design-tree` 设 `transform: translate(x, y)`；**不要改行内 `left/top`**，否则 ≤680px 时 `right:10px; width:auto` 的整宽布局会被破坏。平移限制在舞台内（四周 8px 边距），`ResizeObserver` 在展开/折叠、整树折叠、主题或窗口尺寸变化后重新收回舞台；`pointerup/pointercancel/lostpointercapture` 结束拖动并清除 `.is-dragging`。拖动时顶栏 `cursor: grab/grabbing`、`touch-action: none`、禁用文本选择并隐藏 Tooltip。位置只属于当前会话，不写入 `workstation-ui-v1`（刷新回到左上角）。
- **按钮字号优先级**：全局按钮重置用 `:where(.stage-ui) button { font: inherit }`（`:where` 降低优先级）。若改回 `.stage-ui button { font: inherit }`，它会压过 `.tree-row`/`.tree-leaf` 的 `font-size`，所有节点又变回 16px——这是旧版“字体偏大”的根因。
- **展开语义**：点击节点行切换 `aria-expanded` 与 `.tree-node-body.hidden`；可同时展开多个节点，树体内滚动。标题栏 `.tree-collapse` 切换 `is-collapsed`，只折叠整棵树外壳。初始状态所有节点折叠；`setSectionOpen(name, true)` 会同时展开整棵树。`closePanels()` 只折叠所有节点，不隐藏设计树；`hasOpenPanel()` 以是否有展开节点为准。实测（1200×900）：全折叠高 **333**；六节点全展开高 648（72vh 上限）、`.tree-body` 内容 **2146** / 可视 **555**，`pageScrollHeight` 仍为 900。
- **物体检查器**：`.object-inspector.tree-selection` 是物品节点下的子节点，不是右侧浮窗。`setInspector(meta)` 生成头部/状态/动作/选项后，把检查器移动到选中对象按钮之后（`objectButton.after(...)`），自动展开 `物品` 节点并 `scrollIntoView({block:'nearest'})`；取消选中时 `hidden=true`。`selectObject()` **不得调用 `ui.closePanels()`**；点击面板外也不得关闭设计树。
- **Esc/空白语义**：Esc 先取消选中，再在无选中时折叠所有节点（`closePanels`）；点击空白取消选中但不折叠设计树。桌面上节点展开状态属于会话临时状态，不写入持久化。
- **机位**：`views` 使用 `target + azimuthDeg/elevationDeg/distance/fov`；当前 11 个 id：`default/front/left/right/overhead/under/firstPerson/keyboard/monitor/laptop/panorama`。初始/复位为 `default`，`currentView` 会在手动拖动或滚轮后变 `null`。预设切换由 main 的缓动完成；聚焦物体和自动环绕由 controller 自己的 tween 完成，启动前会调用 `cancelViewAnimation()`。各预设参数、默认构图留白与初始相机同步要求见 **L3.15**；改 `views` 后必须运行 `tools/audit_environment.mjs`。
- **相机边界**：保留紧凑房间的正面弧 `minAzimuth=-75° / maxAzimuth=75°`、`maxPolar=88°`、`maxTargetRadius=0.75`、`min/maxDistance=0.45/3.15`；`window.__workstation.setOrbit()` 只在截图期间临时放宽并恢复，不要在正常交互中绕过这些限制。
- **自动环绕**：使用 controller 帧监听器按**真实时间**推进（`±68°` 往返，约 `0.16 rad/s`），**不要改回 `OrbitControls.autoRotate`**：它按帧步进，在无头低帧率下几乎不动，也无法保证不穿墙。
- **场景预设**：`SCENE_BASES` 的 `day/night/focus/rgb` 同时设置 key/fill/rim/hemi/ambient/softbox、屏幕辉光与桌下补光、曝光、环境强度、bloom、背景、墙/踢脚/地面颜色、界面主题、屏幕内容与 RGB。切换场景不改变机位；手动改灯光会把 `activeScene` 置为 `custom`。
- **灯光面板**：主灯开关、环境光倍率 0–1.5、整体亮度 0.6–1.4；RGB 五态 `off/static/rainbow/breathe/soft`，四种单色 `#2BD8FF/#4C7DFF/#B06CFF/#FFD9A0`。场景中没有独立台灯，标签不要写“台灯”。键盘 RGB 的具体三层结构见 L3.6。
- **双屏内容**：`dashboard/code/terminal/desktop/focus` 由 `workstationDetails.ts` 的 Canvas 绘制；屏幕内容改变会同步两台屏幕，屏幕关闭时切换内容会重新点亮。笔记本开合、屏幕开关、内容切换均通过检查器或 API，保持旧 `setKeyboardRgb('sweep')` 兼容为 `rainbow`。
- **拾取与检查器**：`addPickTarget` 建立 mesh→对象 id 映射；`isVisible` 检查整条父链；点击空白/按 Esc 取消；悬停用 `Box3Helper` + 场景 Tooltip；选中框用独立 helper。`Box3` 会包含不可见子件，若某对象定位异常，先检查是否只隐藏而非移除旧件。
- **整理/显隐**：`TIDY_DECOR = mug/bottle/desk-still-life`；整理开启时相关装饰卡不允许单独切换，并提示先关闭整理。`hiddenDecor` 只保存显式隐藏的 id；持久化不保存自动环绕与选中物体。
- **持久化**：`localStorage` key `workstation-ui-v1`，包含 view/scene/lightingCustom/lighting/rgbMode/rgbColor/screenPower/screenContent/lidClosed/tidy/hiddenDecor。读取时必须用 `VALID_VIEWS/SCENES/RGB/CONTENT/DECOR` 白名单校验；非法视角回退 `default`。节点展开状态、自动环绕和选中物体不写入。
- **快捷键**：`1–9` 前九个机位、`R` 默认视角、`Space` 自动环绕（仅在焦点不在输入框/按钮时）、`Esc` 先取消选中、再折叠所有节点；画布 `tabIndex=0`，点击画布后 Space 可用。
- **主题变量**：树使用独立的 `--tree-bg/bg-fallback/sheen/highlight/head/doc/border/hairline/line/hover/active/selection/selection-strong/accent/accent-strong/card/badge/shadow` 以及模糊、圆角、字号、行高变量；暗色主题在 `:root[data-theme='dark']` 同步重定义。节点颜色**不要放进 CSS transition**：无头 SwiftShader 会把颜色过渡冻结在旧主题值，夜间出现深底深字。选中/展开态用 `--tree-selection/active` + 2px 内嵌蓝线，不改变字号字重，避免行内跳动。
- **响应式**：`≤860px` 时树宽 292；`≤680px` 时树左右各 10px、宽 370、`max-height: min(62vh, calc(100% - 20px))`，底部仍留场景，树内滚动；`≤480px` 场景卡单列、隐藏第二个文档徽标；`≤420px` 滑杆与检查器动作单列。Toast 固定在舞台底部居中；Tooltip 仍按舞台边界夹取。
- **动画兼容**：设计树本身不做入场动画（避免无头下 transform 冻结）；Tooltip/Toast 只做位移，不做 `opacity:0` 起始。展开箭头 `transform` 160ms、悬停/选中背景 140ms；主题颜色切换必须即时生效，不要用覆盖在旧主题上的长过渡。
- **证据**：`node tools/final_ui_capture.mjs` → `final-ui-overview/view/lighting/night/inspector/mobile*.png`、`final-keyboard-rgb.png` + `ui-manifest.json`（含 `designTree` 与 `mobileOverflow`）；`node tools/test_interactions.mjs` → `interaction-test.json`（含 `treeCollapsed/treeExpanded`、`treeDrag` 与 `designTree`）；自动展示证据见 L3.16。

### L3.15 小空间、墙体与相机预设（当前已实现，勿回退）

- **环境常量**：`src/main.ts` 的 `ENVIRONMENT`。地板 2.4 × 2.25 m、中心 `(-0.08, 0.485)`、`y=0`；单面背墙 2.6 × 2.35 m、`z=-0.64`；左右返墙深 0.42 m，位于 `x=-1.28 / 1.12`；踢脚高 85 mm、厚 18 mm。日间墙 `#8F8B84`、踢脚 `#6C6861`；夜间由场景预设切到 `#232220 / #1B1A18`。
- **实测包络/净距**：工位逐顶点 `x -0.855..0.533 / y 0..1.7915 / z -0.34..0.9326`；距背墙 **0.300 m**、左墙 0.425 m、右墙 0.587 m、地板前沿 0.677 m、墙顶余量 0.5585 m。全部数据写入 `analysis/environment-audit.json`。
- **墙地接缝**：地板顶面、墙底、踢脚底同为 `y=0`；`wallBaseGap=0`、`baseboardBaseGap=0`。墙体是**朝内单面**，不要把墙改成双面实体房间；默认与自动环绕只允许正面弧，不能绕到背墙后。
- **地面贴图**：`makeFloorTileMaps()` 生成 4 × 4 × 512 px 图集，每张图覆盖 4 × 4 块 600 mm 砖（2.4 m）。`map.repeat=(floorWidth/2.4, floorDepth/2.4)=(1.0, 0.9375)`，`bumpMap.repeat=(4, 3.75)`。改地板尺寸必须同步 repeat，否则砖缝尺寸漂移。
- **预设参数**（`target` / az / el / distance / fov）：

| id | target | az | el | dist | fov |
|---|---|---|---|---|---|
| default | `[-0.03, 0.78, 0.04]` | -26° | 20° | 2.80 | 52° |
| front | `[0, 0.86, 0.03]` | 0° | 16° | 2.90 | 48° |
| left | `[0, 0.80, -0.02]` | -36° | 15° | 2.52 | 54° |
| right | `[0.02, 0.80, -0.02]` | 30° | 15° | 2.52 | 54° |
| overhead | `[0, 0.88, 0]` | 2° | 52° | 2.55 | 50° |
| under | `[-0.18, 0.34, -0.08]` | -28° | 11° | 1.50 | 52° |
| firstPerson | `[0, 0.99, -0.30]` | 0° | 9° | 0.90 | 62° |
| keyboard | `[-0.07, 0.79, 0.06]` | 4° | 20° | 0.73 | 36° |
| monitor | `[0, 1.02, -0.22]` | 1° | 8° | 0.66 | 38° |
| laptop | `[-0.24, 0.89, -0.09]` | -16° | 16° | 0.78 | 36° |
| panorama | `[-0.02, 0.82, 0.05]` | -16° | 21° | 3.00 | 48° |

- **默认构图**：1200×900 逐顶点投影实测工位高 **80.585%**、上/下留白 **10.291% / 9.123%**；`left/right/overhead/panorama` 均完整可见，`front` 完整可见但椅子会遮住键盘。不得用 `Box3` 角点估算留白，必须用 `tools/audit_environment.mjs` 的逐顶点投影。
- **初始机位**：`camera.position=(-1.1834, 1.7377, 2.4049)`、`controls.target=(-0.03, 0.78, 0.04)`、fov 52 必须与 `views.default` 一致；体验层启动会再次应用 default，但截图/首帧可能在接线前读相机，勿留旧值。
- **交互边界**：距离 0.45–3.15 m、方位 ±75°、极角 16–88°、目标半径 0.75 m；`setOrbit()` 仅截图期间临时放宽并恢复。自动环绕用真实时间在 ±68° 往返，不用 `OrbitControls.autoRotate`。
- **改机位流程**：先确定主体与留白 → 用候选机位做逐顶点投影或试拍 → 检查滚轮、椅背/头枕、格架顶不裁切 → 同时改 `views`、初始相机、UI 的 `ViewId`/顺序 → 跑 `audit_environment`、`test_interactions` → 重拍 `final-left/right/overhead` 与 `final-front` → 同步本文件与对应审计（README 只保留简介/运行/部署）。
- **审计**：`node tools/audit_environment.mjs` → `analysis/environment-audit.json`；要求 `floorIsGroundPlane / wallBaseMeetsFloor / baseboardBaseMeetsFloor / wallsClearOfWorkstation / workstationInsideFloor / wallBehindWorkstation / allPresetsSafe / defaultFramingInRange / widePresetsFullyVisible` 全为 true，`pageErrors=[]`。近景/桌下视角不参与整机留白判定。

### L3.16 自动展示与时间线专项（当前已实现，勿回退）

- **分层**：`src/showcase/showcaseTimeline.ts` 只放时间线数据和纯函数（章节、相机关键帧、场景/屏幕/开盖/RGB 事件、RGB 亮度曲线、字幕区间、`poseAt`/`rgbScaleAt`）；`ShowcaseController` 只管状态机、事件调度与真实进度，通过 `ShowcaseHost` 调场景；`workbenchController` 实现 host（快照、灯光混合、设备直控、UI 发布、手动互斥）并在既有帧监听器里推进；`controlPanel` 只画节点、进度与按钮。**不要另建 rAF 循环、不要模拟点击现有按钮。**
- **时间线（45 秒 / 7 幕）**：

| # | 章节 | 区间 | 主要内容 |
|---|---|---|---|
| 01 | 整体亮相 | 0–7 s | 当前机位平滑进入远景，开场标题；日间灯光、屏幕仪表盘 |
| 02 | 空间环绕 | 7–13 s | 主视角 → 左 3/4 → 右 3/4，完整收进格架与椅子 |
| 03 | 桌面细节 | 13–21 s | 抬高越过椅背 → 显示器近景 → 笔记本近景 → 键盘/鼠标/茶杯桌面近景 |
| 04 | 设备互动 | 21–28 s | 笔记本 22.6 s 合盖、25.4 s 开盖；终端/桌面内容切换 |
| 05 | RGB 灯效 | 28–34 s | 单色（青）→ 彩虹 → 呼吸；RGB 亮度先压暗再淡入切换 |
| 06 | 氛围切换 | 34–40 s | 白天→深夜（34 s）→专注（36.6 s）→RGB 氛围（38.8 s） |
| 07 | 终章全景 | 40–45 s | 拉回 3/4 全景；43 s 出现结束标题，自然完成后停留约 2 s 自动恢复 |

- **相机**：关键帧为 `target + azimuth/elevation/distance/fov`，`poseAt` 用 smootherstep 插值；开场从当前相机平滑过渡到 2.4 s 远景，7 s 回主视角，10/13 s 到左右 3/4。右 3/4 推进到显示器时在 13.7 s 经 1.55 m / 仰角 30° 的抬高机位越过椅背，15 s 到显示器近景；18 s 笔记本、20.2 s 桌面细节、22.2 s 回笔记本；26.4 s 坐姿视角、29 s 键盘 RGB 近景。中景（35.4/37.2/38.4/39.4 s）距离 2.35–2.45 m、仰角 30–32°，必须越过椅头（1.241 m）并完整收进格架顶；实测 nightA（2.10 m）投影高 1.036 会裁切，2.45 m 降到 0.872。终章 2.72 m/fov 51° 逐顶点投影工位高 **84.7%**、上/下留白 **9.9% / 5.4%**。**低角度中景会被椅背整块挡住，不要缩回 1.25 m；从远景推进近景也不要直线穿过椅子。**
- **事件与灯光**：场景事件 `day@0/2.0s`、`night@34/1.4s`、`focus@36.6/1.4s`、`rgb@38.8/1.2s`；屏幕 `code@14.5`、`terminal@26.2`、`dashboard@27.2`、`terminal@34.2`、`focus@37.0`、`code@39.2`；开合盖 `22.6/25.4`。host 捕获当前真实灯光（key/fill/rim/hemi/ambient/softbox/screenGlow/underFill 的颜色与强度、曝光、环境强度、bloom、背景、墙/踢脚/地面颜色、主题）再向 `SCENE_BASES` 目标混合；白天贴图与纯色背景在 55% 处经近黑过渡，主题也在 55% 切换。展示期间**不要调用 `applyLighting()/applyScene()`**（会瞬间重置）；过渡结束再 `commitScene()`。退出用快照恢复。
- **RGB 与设备**：只使用已实现的 `off/static/rainbow/breathe/soft`；模式事件 `static@29.2`、`rainbow@31`、`breathe@32.8`、`static warm@36.9`、`rainbow@39.1`。模式切换前后用 `showcaseSetRgbScale` 把三层 RGB 压到 0 再淡入（`workstationDetails` 的 `rgbScale`），彩虹模式底光保持白色不乘单色。正常播放时开盖/合盖走真实阻尼动画；`seek`/下一章节跳段必须用 `setLaptopLidInstant()` 立即落位，否则暂停中跳段会停在半开。开场强制打开屏幕；暂停时 `workstation.pauseAnimations()` 冻结时间、开合、RGB 呼吸、蒸汽、水壶与屏幕刷新，恢复时顺延开合起点。
- **底部实时字幕**：`SHOWCASE_SUBTITLES` 是独立于章节标题的功能字幕轨道（整体工位、AOC 显示器、耀世 16 Ultra、桌面配件、合盖/开盖、RGB 三态、深夜/专注、终章），由 controller 随真实时间发布到 `ShowcaseUiState.subtitle`；`ControlPanel` 用 `.showcase-live` 在底部居中显示白色字幕，带轻量深色衬底与 `aria-live`。暂停时保留当前字幕，结束后显示“展示完成 · 正在恢复初始状态”，自动恢复后隐藏。**字幕是展示的一部分，隐藏设计树时仍要显示；不要只做成静态标题。**
- **状态机**：`idle → playing → paused → playing → finished → stopped`。`nextChapter()` 跳到下一幕起点并保留当前播放/暂停状态；`restart()` 清理旧状态并回到第 1 幕（day、RGB off/scale 0、dashboard、开盖、开场机位）；`seek()` 供调试/取证，跳段时同步设备即时状态且保持暂停。自然播放到 45 s 进入 `finished`，停留 `SHOWCASE_AUTO_RESTORE_MS=2000` 后自动调用 `exit()` 恢复快照；start/restart/seek/exit 必须清理自动恢复定时器，`seek` 到终点不自动恢复（用于取证）。页面失焦返回时 dt 最多推进 0.25 s，不跳帧。
- **树内 UI**：一级节点 `自动展示`（clapper 图标、计数 `7 幕`）内包含状态行、主按钮（待机=开始展示 / 播放=暂停 / 暂停=继续 / 完成=演示结束禁用）、章节与时钟（`03 / 07 · 桌面细节`、`00:17 / 00:45`）、真实百分比与进度条（`role=progressbar`），以及 `下一章节`、`重新播放`、`退出展示`、`隐藏控件栏` 和开关 `展示时隐藏设计树`。快捷键：展示中 `Space` 暂停/继续、`H` 隐藏/恢复控件栏；`1–9/R` 等手动操作会被拦截并提示。
- **隐藏控件栏**：手动隐藏只给设计树加 `.is-hidden` 并显示 30 px 的 `.tree-restore` 图标按钮（`aria-label=显示控件栏`），**不要隐藏整个 `.stage-ui`**（会连带隐藏结束标题/字幕），也不得暂停时间线；树体折叠（`.is-collapsed`）与隐藏是两套独立状态。`展示时隐藏设计树` 是独立偏好，存 `workstation-showcase-v1`；开启后在 start/restart 时立即隐藏，仍可用 `H`/恢复图标显示。自然结束自动恢复时强制显示树，偏好保留供下次启动使用。
- **快照与恢复**：开始展示时保存 `UiState`（`hiddenDecor` 只存显式项）、`baseScene` 与相机 pose；展示期间 `scheduleSave/persistNow` 被抑制，不把演出状态写入 `workstation-ui-v1`。手动退出或自然完成自动恢复时恢复场景、RGB、屏幕、开盖、灯光、整理/显隐、选择与相机（900 ms 回位），关闭隐藏态；自动环绕不恢复（保持关闭）。开始/退出/重播/自动恢复可重复执行，不得叠加监听器、定时器或残留动画。
- **证据**：`node tools/test_showcase.mjs` → `analysis/renders/showcase-test.json` 的 **63 项断言**与 `final-showcase-idle/opening/controls/device/rgb/night/finale.png`；覆盖入口、45 秒真实进度、底部实时字幕、暂停冻结/继续、下一章节、树折叠、隐藏后继续播放与恢复、展示时隐藏设计树选项、RGB 三态、夜间/专注场景、完成状态、三次重播、自然完成自动恢复非默认基线、手动视角恢复与二次启停、`errors: []`。截图前把鼠标移到场景右下角，避免 Tooltip 进画面。

### L3.17 部署与仓库维护（GitHub Pages + Qoder Sites）

- **常规发布**：改代码 → `npm run typecheck`、`npm run build` → 按 L4.0 跑对应测试 → 中文提交说明 → push 到 `main` → GitHub Actions 自动构建并部署到 Pages（约 2–3 分钟）；最后打开 https://osinglehh.github.io/digital-workstation/ 确认。
- **GitHub Pages 工作流**：`.github/workflows/deploy.yml`（checkout → setup-node 24 → `npm ci` → typecheck → build → `configure-pages@v5`（`enablement: true`）→ `upload-pages-artifact`（`dist`）→ `deploy-pages`）。**首次启用必须在仓库 Settings → Pages 把 Source 手动选为 GitHub Actions**：工作流令牌无权创建 Pages 站点，只靠 `enablement` 会报 `Resource not accessible by integration`。
- **Qoder Sites 线上版**：https://digital-workstation-vcyscgr9sb8.qoder.zone/ （`npm run build` 后经 Sites 插件发布，`webDirectory: dist`、`spa: false`）。重新发布沿用原 `projectId`、使用新 `actionId`；描述文件 `*.qoder.site` 含云端 ID 与快照，已在 `.gitignore`，不得提交。两个站点独立发布，推送 GitHub 不会自动更新 Qoder Sites。
- **子路径部署前提**：`vite.config.ts` 的 `base: './'` 与运行时贴图相对路径 `textures/...` 缺一不可（Pages 项目站在 `/<仓库名>/` 子路径下）。验证方法：把 `dist/` 挂到 `/digital-workstation/` 的临时静态服务，用无头浏览器确认 25 张贴图全 200、失败请求与页面错误均为 0；临时探针用完按 L4.6 删除。
- **回滚**：`git revert <提交>` 后 push，Actions 自动把线上退回上一版；禁止 `reset --hard`、`force push`。
- **仓库卫生**：`figure/`、`analysis/renders/`、`*.qoder.site`、`dist/`、`node_modules/` 不进 Git；README 保持简洁（简介/运行/部署），设计事实写本文件与审计 JSON；升级依赖后重跑构建与交互测试。

## L4. 验证与证据

### 4.0 验证矩阵（先查这张表）

| 改动类型 | 必跑 | 必看 / 必更新 |
|---|---|---|
| 任意代码 | `npm run typecheck`、`npm run build` | 构建单包约 1,572 kB，Vite 体积提示可接受 |
| 部署/工作流/站点配置 | `npm run typecheck`、`npm run build`、`git status` 核对忽略项 | `.github/workflows/deploy.yml`；线上 URL 与贴图 200（见 L3.17） |
| UI/设计树 | `test_interactions`、`final_ui_capture` | `final-ui-*.png`、`ui-manifest.json`、`interaction-test.json`（`errors: []` 与 `treeDrag` 三段位置） |
| 自动展示/时间线/隐藏控件栏 | `test_showcase`、`test_interactions`、`final_ui_capture` | `showcase-test.json`（63 项断言、`errors: []`）、`final-showcase-*.png`、`ui-manifest.json` |
| 键盘/鼠标/水壶/杯子/椅子 | `test_interactions` + 最新近景或专项终图 | `final-keyboard-rgb.png`、`final-chair-*`；水壶/小件更新 `layout-audit.json` |
| 桌下/地面/书包/垃圾桶 | `audit_underdesk`、`final_capture`（under） | `underdesk-audit.json`、`final-under*.png` |
| 桌顶格架/礼盒/罐体/纸品/剪刀 | `audit_shelf`、`final_shelf_capture` | `shelf-audit.json`（`shadowOcclusion=true`）、`final-shelf-*.png` |
| 地板/墙体/相机预设/构图 | `audit_environment`、`final_capture` | `environment-audit.json`、`final-front/left/right/overhead/under.png` |
| 文档/注释 | 无需跑测试 | 版本/日期/附录、链接与实测值一致 |

### 4.1 必须通过的检查

- `npm run typecheck`：零错误。
- `npm run build`：通过；单包体积提示是已知情况，不是失败。
- `node tools/test_interactions.mjs`：需要 dev server；当前版本先断言设计树整体折叠/展开、顶栏拖动与拖回原位（`treeDrag`）与检查器挂入树内，再通过树节点执行笔记本开合、RGB（关闭/单色/彩虹）、双屏亮灭、夜间场景与暗色主题、自动环绕、坐姿视角、偏好持久化，并保留显示器旋转/椅子数值断言；检查页面 `errors: []`。
  - **已知问题**：无头 SwiftShader 约 1–2 fps。显示器阻尼断言（`monitorPanDeg > 7`、`monitorTiltDeg < -2.5`）现在等待 45 s；椅子断言等待 20 s；这不是放宽阈值，而是给低帧率足够时间。若仍超时，如实记录实测值，不要伪造通过。
- `node tools/final_ui_capture.mjs`：生成桌面/移动设计树终图、`final-keyboard-rgb.png` 与 `ui-manifest.json`；必须实际查看节点折叠、树内检查器、暗色主题对比度、移动端高度与横向溢出，以及键盘光池是否过曝。
- `node tools/test_showcase.mjs`：需要 dev server；当前 **63 项断言**覆盖自动展示入口、45 秒真实进度与章节、底部实时字幕、暂停时间冻结与设备冻结、继续接续、下一章节、整树折叠不中断、隐藏控件栏后继续播放与恢复不重置、展示时隐藏设计树开关、RGB 单色/彩虹/呼吸、夜间/专注场景、完成状态、三次重播、自然完成自动恢复非默认基线（夜间/静态暖光/代码屏/合盖/左视角）、手动视角恢复与二次启停；必须 `errors: []`。无头环境用 `showcase.seek()` 定位，不要根据墙钟等待推断时间线。
- UI 改动的人工检查：设计树标题箭头可整体折叠/展开；按住顶栏可拖动整树、拖出后仍完整落在舞台内，展开节点或改变窗口尺寸后自动收回舞台，刷新后回到左上角；视角/物品/灯光/场景/自动展示/帮助节点可独立展开与关闭；自动展示节点内的“展示时隐藏设计树”开关可开启/关闭，播放中切换能立即隐藏或恢复树；点击场景物体时检查器出现在对应对象下方；点击空白/Esc 取消选中不关闭树；快捷键 1–9/R/空格/Esc；刷新后恢复场景、RGB、屏幕内容与视角（节点展开状态不恢复）。
- 设计树布局证据：`ui-manifest.json` 的 `designTree` 应为 `x=16,y=14,width=304,height=333`（1200×900 全折叠，六类节点）；`mobileOverflow` 要求 `bodyScrollWidth === viewportWidth === 390`、`inspectorInsideTree=true`（移动端检查器宽 315）。运行时探针还应确认：右上（`right > 62% viewport` 且 `top < 300`）与底部（`top > 62% viewport`）没有交互浮窗；选中物体后 `.object-inspector` 的 `position=static`、`insideTree=true` 且矩形完全落在树边界内（显示器实测 `[67,224,248,155]`）；六节点全展开高度 648、`.tree-body` 内容 2146 / 可视 555、页面仍为 900。
- 玻璃/字号人工检查：面板为半透明玻璃（背后的场景可见且被 12 px 模糊），日间浅色、夜间深色玻璃都保持文字对比；标题 13 px、分类行 12.5 px、叶子 12 px、辅助 9–9.5 px；悬停有轻微底色、选中为浅蓝底 + 2 px 内嵌指示；展开箭头平滑旋转约 160 ms。不得恢复纯白实底、厚重黑色投影、显眼灰色计数胶囊或 16 px 默认按钮字号。
- 键盘 RGB 改动：五种模式（彩虹/单色/呼吸/柔光/关闭）各截一张近景并用图像阅读查看；关闭时键缝/点光/光池全部消失；交付图更新 `final-keyboard-rgb.png`，试拍按 L4.6 删除。
- 视角预设回归：逐个点击 11 个视角按钮，检查 `currentView()`、唯一的 `aria-pressed` 按钮、相机距离与预设一致；手动拖动后 `currentView=null`、无激活按钮；滚轮缩放上限为 3.15 m。无头 SwiftShader 下 rAF 很慢，每步至少等待 2.5 s，不能用 0.9 s 的旧等待判断失败。
- 环境/相机改动：`node tools/audit_environment.mjs` 必须全门禁通过、`pageErrors=[]`；默认构图高 65–82%、上下留白 ≥8%，`left/right/overhead/panorama` 完整可见。改墙体/地板后重拍 `final-under`、`final-front/left/right/overhead`。
- 桌顶格架改动：`node tools/audit_shelf.mjs` 复测（`allInside=true`、`roomItemCollisionCount=0`、`legacyRemoved=true`、`shadowOcclusion=true`、`pageErrors=0`），重拍 `final-shelf-*.png`。
- 桌下/地面改动：`node tools/audit_underdesk.mjs` 复测并更新 `analysis/underdesk-audit.json`，重拍 `final-under.png` 与 `final-underdesk*.png`。
- 水壶/小件尺寸改动：页面内逐顶点 AABB 实测，更新 `analysis/layout-audit.json` 对应字段。
- 视觉复核：至少查看本次改动涉及的正/侧/近景；最终任务还要查看 `analysis/renders/final/final-*.png`。
- 尺寸变化：先在浏览器/Node 页面脚本中实测 AABB、接触高度或法向间隙，再写入审计 JSON。
- 并行任务可能触发热更新或改写截图/审计；截图和交互测试前确认目标代码已落盘且没有其他任务在拍同一组图，必要时重跑，避免跨版本证据混用。

### 4.2 椅子/头枕专项回归

每次改椅子、头枕、扶手或机位后，至少完成：

1. **正面近景**：`final-chair-head-front.png` 中头枕正面只有网布与圆框，没有支架/柱子；最前零件应是网布面板。
2. **背面近景**：`final-chair-head-back.png` 中支撑臂、夹块、两侧螺栓可见；底夹与靠背顶梁接触，不留缝。
3. **侧面/低角度**：`final-chair-side/left/low.png` 中无穿网、无悬空；头枕轮廓完整不被裁切。
4. **AABB**：椅子逐顶点 y 顶约 1.241 m、z 后沿约 0.9326 m；椅座前缘 z=0.20 不变。
5. **交互**：`swivelChair`/`reclineChair` 后 `getState()` 数值正确，`errors: []`。

### 4.3 桌顶格架专项回归

每次改格架、书籍、礼盒/罐体、剪刀或纸张后，至少完成：

1. **正面/左右 3/4**：`final-shelf-front/left34/right34.png` 中顶板与侧板连续，书籍不穿顶板、不露出背板后侧；格架与搁板齐平。
2. **书列近景**：`final-shelf-books.png` 中书籍顺序与参考一致、**三段天际线清晰**（右段明显更矮）、文件盒透明可见铆钉；相邻书不得明显互相穿插。
3. **陈设近景**：`final-shelf-props.png` 中礼盒印刷正对前方（月盘/镂空窗/月耀喻园/底标语）、玻璃罐标签文字朝前、茶叶罐花纹在前脸、剪刀轮廓可辨；器物均落在纸面上，不悬空；**搁板下方墙面不得出现剪刀、书籍或罐体的穿透阴影**。
4. **架顶俯视**：`final-shelf-top.png` 中绿色盒与白纸落在顶板上，二维码标签不超出盒体。
5. **AABB 与阴影**：`analysis/shelf-audit.json` 的 `allInside=true`、`roomItemCollisionCount=0`、`shadowOcclusion=true`、净高 330 mm、净宽 1014 mm、净深 290 mm、最高书顶距顶板 14.7 mm。

### 4.4 测量与审计注意

- `Box3.setFromObject` 会把不可见子物体计入包围盒；只隐藏不删除会得到错误高度。它还会把带旋转子物件的几何包围盒按角点膨胀（椅子高差约 8 mm）；落地面、净距与椅子高度一律用**逐顶点乘 matrixWorld** 的精确包络。
- 对 `InstancedMesh`（键帽、背板安装孔、罐内果粒），逐个读取实例矩阵再乘 `matrixWorld`；`tools/audit_shelf.mjs` 已按此实现。
- 用页面内运行时对象测量时，`window.__workstation` 已暴露 `scene`、`camera`、`renderer`、`root`；不要为了量 AABB 改产品代码。
- 带倾斜的物体（笔记本机身 8°）世界 AABB 高度会远大于真实厚度；真实厚度沿法线，或读取几何 `boundingBox`。
- 结果写入对应 `analysis/*-audit.json`。当前已有：`layout-audit.json`、`keyboard-audit.json`、`lid-clearance.json`、`pen-audit.json`、`monitor-audit.json`、`cable-audit.json`、`chair-audit.json`、`underdesk-audit.json`、`shelf-audit.json`、`environment-audit.json`、`collision-report-final.json`。
- 画面留白/裁切判定必须用**相机投影逐顶点**（NDC 包络），不能拿工位 `Box3` 的八个角点估算；`tools/audit_environment.mjs` 已按此实现，并跳过有意裁切的近景/桌下视角。
- 水壶字段以 `layout-audit.json` 为准：`bottleBodyTopAboveDesk=0.3675`、`bottleBodyBottomAboveDesk=0.161`、`bottleBodyHeight=0.2066`、`bottleTotalHeight=0.2511`、`bottleStrapTop=1.3003`。

### 4.5 证据保留

- 保留：`analysis/renders/final/`（`final-*.png` + `manifest.json` + `shelf-manifest.json` + `final-ui-*.png` + `final-showcase-*.png` + `final-keyboard-rgb.png` + `ui-manifest.json`）、`analysis/renders/interaction-test.json`、`analysis/renders/showcase-test.json`、`lid-closed.png`、`night-mode.png`、`monitor-pan.png`、`keyboard-wedge.png`、`analysis/crops/`、`analysis/material-crops/`、`analysis/gates/`、所有审计 JSON、`analysis/validation-strict-9.json`。
- 最终图被新版本替换时，保留同名的当前版本；不要用旧迭代截图冒充新结果。
- 小件专项自检图默认不进入交付；参考裁切只保留有判读价值的少数几张，多余裁切在收尾清理。

### 4.6 清理协议

1. 删除**本轮自己创建**的：`_tmp*`（含仓库根目录的探针脚本，如 `_tmp_*.mjs`）、试拍、before/after、probe/verify、blockout、临时导出图与临时 JSON。
2. 删除前先列清单核对时间戳与命名：`find . -maxdepth 3 -name "_tmp*" -not -path "./node_modules/*" -not -path "./dist/*"`。
3. **不属于本轮、无法确认归属的 `_tmp-*` 不要删除**——列清单交给用户确认（并行任务可能仍在用）。
4. 不删除：`figure/`、所有审计 JSON、`analysis/renders/final/`、交互测试输出、`analysis/crops/` 中被本文件或 README 引用的参考裁切、`analysis/material-crops/`、其它任务产物、`dist/`。
5. 交付时列出“已删除 / 保留”的关键项：保留项不逐文件罗列，但必须说明最终图、审计与测试输出仍在。

## L5. 已知坑与常见回归

### 场景与工厂

1. **工厂遗留件**：旧笔记本屏轴、旧触控板、青色贴纸、旧键帽矩阵/高脚/旋钮等可能仍在层级中；它们会影响 `Box3` 和画面，需显式移除或隐藏，且不要重新启用。
2. **重复物件**：蓝色中性笔已按用户确认彻底移除（`createDeskPen` 已删除，工厂遗留笔继续隐藏）；不要重新创建任何桌面笔。
3. **旧桌腿/横梁勿恢复**：`deskPostFL/FR/RL/RR`、`deskRailFront/Back` 已从层级移除；工厂重生成或细节层改动后要复查。
4. **自动门禁误报**：`self_intersection` 对程序化倒角盒体大量误报，不能作为唯一阻断；以语义分组 AABB/射线检查和人工多角度目检为准。
5. **构建体积**：单包 >500 kB 警告是当前已知状态，不要为此引入无关拆包重构。
6. **依赖**：不要因小型视觉需求增加 npm 依赖或引入外部模型/贴图；现有 Three.js + Canvas + 程序化几何已足够。
7. **版本控制**：已托管 GitHub 公开仓库（`Osinglehh/digital-workstation`，`main` 分支）；不要 force push、`reset --hard` 或不可逆清理，删除任何非本轮生成文件前先确认。
8. **全局记忆**：写入用户级 `memory` 前，必须再次向用户确认并获得同意。

### 键盘、鼠标、屏幕

9. **垫子旋转连带影响**：鼠标垫旋转后，`mouseShell` 朝向与 `moveMouse` 的局部 clamp 都会失效；改朝向后必须同步补偿鼠标 `rotation.y` 并重算 clamp（见 L3.7）。
10. **笔记本闭合**：测试必须等到 `lidClosed > 0.999` 且 `lidAngleDeg ≈ 0`；旧铰链黑条已通过重建双轴套解决。
11. **键盘 AABB**：旧脚/旧旋钮留在层级里会把整机抬高；先 `Box3` 计算再按桌面高度回填。
12. **楔形同步**：底壳、定位板、键床、状态灯、旋钮、徽标共享坡度基准；改一处要同步检查其余部件和键帽顶高度。
13. **放样壳体空心**：自定义 BufferGeometry 放样必须有实心底盖 + `side: DoubleSide` 兜底；只用放样环封底在低角度会被背面剔除看穿。
14. **屏幕 z-fighting**：笔记本屏幕 mesh 必须贴在 bezel 前表面之外 ≥0.9 mm（当前 z=0.0041）并加 `polygonOffset: -2`。
14A. **键帽只按排着色会“丢掉渐变”**：本项目参考键帽是**由后向前逐排变深**的渐变键帽而不是纯白键帽；只改单色或窄幅行差（旧 `#D2D6D8…#B9C0C3`）在渲染里读不出渐变。改排色时同步改图例字色，否则前三排的字会看不见。
14B. **RGB 前沿硬光带三来源**：① 桌面溢光面前缘探出机身（`z=-0.055` 起才安全）；② 点光压在 `(0, 0.07, 0.015)` 时在机身前沿斜面烧出的高光；③ 底光面深度加到 0.116 以上时从前排键帽 0.7 mm 底缝透出的连续亮线。三层任一处越界都会在正面视角形成一条彩色硬带。

### 桌面小件（杯子/鼠标垫）

14C. **玻璃杯茶汤必须平涂**：茶汤用 `MeshBasicMaterial`（体 `#150803` / 液面 `#1E0C06`），玻璃 `opacity 0.05 / roughness 0.035 / envMap 0.5`；改回带光材质会被主光照成灰棕陶瓷感。杯底厚玻璃用单独冷绿材质，木盖不要提亮成塑料。
14D. **鼠标垫基色与缝线联动**：基色 `#A8ABAE`、缝线 `#C6C9C9`，印花由 1024×512 Canvas 绘制；改基色会改变缝线对比。鼠标垫竖放后，鼠标朝向补偿和 `moveMouse` 的 clamp 必须同步检查（见 L3.7）。

### 水壶

15. **长度压缩必须成对改系数**：`scale.y=0.765` 与 `position.y=0.135*(1-scale.y)` 必须同时调整；当前瓶身 206.6 mm、含盖 251.1 mm。
16. **贴片底缘**：刻度贴片高 0.16、中心 y=0.02，底缘约 -0.06，必须高于瓶底 -0.0715；改尺寸后先检查贴片是否探出瓶底。
17. **刻度顺序**：数字按实物 **650 ml 在上、150 ml 在下**；贴片仍用 `rotation.y=-50°` 朝向正面。
18. **挂带承托关系**：瓶盖/挂带/挂钩连接点保持不动，缩短只抬瓶底（当前瓶底距桌面 161 mm）。
18A. **transmission 三件套缺一不可**：`MeshPhysicalMaterial` 要真的“半透明”必须同时给出 `transmission`、`transparent: true`（否则整块渲染成实心），且被观察的内部物体必须是**不透明**网格（透明物体不进入 transmission 采样，液面会消失）。瓶身 lathe 还要是薄壁闭合折线（内腔半径 ≥0.42 比例），厚壁剖面的内腔只有 ≈15 mm，会把内胆埋进壁里。
18B. **摆动支点必须在挂钩处**：钟摆式摆动要绕挂带最高点（与挂钩的接触点）旋转，并做位置补偿；绕瓶身原点转会变成“上部摆、下部不动”。实现与实测见 L3.8 末条。

### 椅子与头枕

19. **头枕支撑方向**：支撑臂/夹块/螺栓只能放在头枕背面（局部 -z），**任何件都不能放到 +z 前脸**；底夹要抱住靠背顶梁。
20. **椅子高度与机位联动**：椅子逐顶点顶高 1.241 m、后沿 0.9326 m；`final-chair-*` 机位必须容纳完整头枕，低角度/后视最容易裁切顶部。
21. **椅座前缘**：z=0.20 与桌沿齐平，不能再前移。
21A. **腰靠必须比脊梁更靠前**：腰靠组 `z=-0.07`、脊梁 `z=-0.095`；若把腰靠放到脊梁后方，中央脊梁会把腰靠切成两块灰板。腰靠孔面朝后（`rotation.y=π`），颜色 `#8A908E`、别用高亮白。
21B. **网布材质色必须是白**：`chairMeshMaterial` 的织纹对比在贴图里，材质 `color` 若给深色（旧 `#2A2D30`）会与贴图相乘成近黑。坐面改用微凹面片（`seatPadGeo`）后，不要再塞回平面方形网布块。

### 桌下、地面与书包

22. **书包姿态用剪切，不要用整体旋转**：整体旋转必然把包底一侧抬离地面。现用 `makeShear(0,0,-0.08,0,0,0) · makeRotationY(1.50)`，包底水平贴地、上半身侧倾约 4.6°；肩带落地段局部 y=+0.008。印花必须是小号散印（约 52 块 + 5 块中号），底色深酒红 `#4A2A33`、字色不高于 0.56 透明度；密度翻倍或字色加亮都会显著偏离参考。前袋几乎占满包宽。
23. **地面砖过曝**：albedo 从 tone 210 起步会过曝；保持 180 起、灰缝 `#7D796F`、`roughness 0.94`。
24. **桌下机位被椅子遮挡**：`final-underdesk*.png` 必须临时隐藏 `ergonomic-chair` 并在 manifest 写 `chairVisible:false`；常规视图不能沿用隐藏状态。
25. **桌下木饰面色偏**：侧板 `#D0C9BC`、背板 `#D6CFC3`；不要改回暖黄，也不要直接复用桌面 `#DFCBAE`。
26. **地面盘绕线勿恢复**：用户已明确只要 2 条垂落线缆。

### 桌顶格架

27. **格架净高来源**：330 mm 按 A4 透明文件盒（315 mm）反推；调整时必须同时检查书籍最高点（298 mm）与文件盒顶（315 mm）到顶板的余量。
28. **格架旧件必须删除而非隐藏**：`shelfBracketL/R`、`shelfProps`、`bookRowB`、`jarPurple/jarOrange/teaCanister`、`bookEnd` 只设 `visible=false` 仍会被 AABB 计入。
29. **纸张分层要判交**：A 纸 1.3732、B 纸 1.3734、前沿散纸 1.3741，厚度仅 0.7 mm；改中心或尺寸后必须用 `audit_shelf.mjs` 判纸张两两与纸张对器物。
30. **架顶标签要挂成盒体子级**：绿色盒二维码标签用局部 `(0,0,0.0604)`，尺寸不得超过盒面（50 × 42 mm）。
31. **玻璃罐内容物要够深**：内容物须为深紫（`#1C0F20` 量级），否则会被 transmission + opacity 洗成灰色；玻璃用高透（opacity 0.14 / transmission 0.5 / roughness 0.08），装到约六成、上部留空；改玻璃参数时同步检查对比。
32. **书脊出版社版式分两类**：深色书脊用底部小标（`roundedRectPath` 164 × 74），浅色书脊才用整条出版社带。
33. **书列高度必须按参考三段天际线**：不要让书列“齐平”；左段 256–288、中段 252–280、右段 200–222 mm，短书同时用更浅进深（144–150 mm）。参考测量见 `analysis/crops/books-grid-2.jpg` 与 `books-compare.jpg`。
34. **礼盒印刷要按“镂空窗”构图**：月盘是**圆心在盒面下方的大圆**（弧顶横跨窗口上方，不是穿过窗口的圆弧，窗内不得再叠月盘）；窗口**左段低、右段高**（`yTL=282 / yTR=196`，如意收头在中间）；皇家蓝窗内线稿 + 淡金月耀/喻园 + 校徽落在月盘内 + 底部标语带。改印刷时先把 Canvas `toDataURL()` 导出成平面稿与 `giftbox-ref-full/window.jpg` 对照，再回三维验证。
35. **格架专项机位**：`final-shelf-*` 用 `tools/final_shelf_capture.mjs` 或 L3.13 记录的四个近景机位；正面截图退太远时书脊文字与罐体印刷无法判读。
35A. **搁板投影不能关闭**：搁板 `castShadow=false` 时架上物件的阴影会穿过板体落到下方背板（典型是剪刀鬼影）。必须保持搁板投影；下方背板 `receiveShadow=false` 以保持均匀受光；顶板仍不投影（避免压暗格架内部），架顶绿盒/绿书关闭实时投影并改用接触阴影。回归检查 `shadowOcclusion=true` 且 `final-shelf-props.png` 搁板下方无鬼影。

### 界面与体验层

- **UI-1 面板透明但存在**：无头 SwiftShader 下 CSS opacity 动画可能冻结在 0，导致设计树/检查器 `display:block`、`opacity:0`。进入动画只做 `transform`，不要从 `opacity:0` 开始；toast 同理。
- **UI-2 设计树节点状态**：节点行的 `aria-expanded`、`.tree-node-body.hidden`、`aria-controls="ws-section-<name>"` 必须同步；整树折叠用 `.design-tree.is-collapsed`，不要用 `hidden` 把整棵树从布局中移除。改 DOM 后检查 `.dock-group` 的精确 `aria-label` 仍是视角/物品/灯光/场景/自动展示/帮助（测试依赖）。
- **UI-3 快捷键焦点**：`Space` 在聚焦按钮时让给按钮，画布需 `tabIndex=0` 且点击后 `focus()`；否则用户点完树节点后空格无法启动自动环绕。Esc 语义是“先取消选中、再折叠所有节点”，不要反过来。
- **UI-4 持久化白名单**：读写 `workstation-ui-v1` 时必须校验视角/场景/RGB/内容/装饰 id；非法视角回退 `default`。不要把 autoOrbit、选中物体或节点展开状态写进持久化。
- **UI-5 自动环绕必须按时间推进**：不要使用 `OrbitControls.autoRotate`（按帧步进，低帧率下停滞）；用 controller 帧监听器 + 真实 dt，在 ±68° 弧内往返，避免穿背墙。
- **UI-6 场景主题与对比度**：`applyLighting` 同时更新墙体/踢脚/地面/背景与 CSS 主题；树色由 `--tree-*` 控制。**不要给 `.tree-row`/`.tree-leaf` 的颜色加 transition**：无头 SwiftShader 会冻结在旧主题颜色，夜间出现深底深字（本轮实测复现并修复）。暗色卡片标题显式用 `--ui-ink`。
- **UI-7 舞台与树高度**：窄屏（≤860px）或高度 ≤560px 时舞台铺满窗口；设计树桌面 `max-height: min(72vh, calc(100% - 28px))`，≤680px 改为 `min(62vh, calc(100% - 20px))`。不要把移动端树设成 `calc(100% - 20px)`，否则展开检查器会盖满整屏、看不到场景。改高度后重拍 `final-ui-mobile*.png`。
- **UI-8 并发可视化**：`main.ts` 的 `ENVIRONMENT`、墙体和 11 个机位可能由并行任务迭代；本任务的 UI 只通过 `views`/`setOrbit`/灯光依赖接入，不要整体重写这些场景值。
- **UI-9 检查器必须嵌在树里**：`.object-inspector` 的 `position` 必须是 `static`，由 `setInspector` 移动到选中的 `[data-object]` 按钮之后；禁止恢复 `position:absolute; right:16px` 的右侧浮窗。`selectObject()` 不得调用 `ui.closePanels()`，面板外点击也不得折叠树；检查器只在取消选中时 `hidden`。
- **UI-10 树内滚动**：树体 `.tree-body` 是唯一滚动容器；展开多个节点后高度超出时不能把整页撑高。选中对象后 `scrollIntoView({block:'nearest'})` 必须落在树体内；移动端验证 `bodyScrollWidth === viewportWidth`。
- **UI-11 节点内容惰性**：所有节点正文都在构造时创建，只通过 `hidden` 切换；不要每次点击重建 DOM，否则会丢失 `aria-pressed` 同步、焦点和测试选择器。`innerHTML` 只接受本文件内的静态标签/图标字符串，不接收用户输入。
- **UI-12 Tooltip/Toast**：Tooltip 只在 `:focus-visible`（键盘）或悬停时显示，鼠标点击后隐藏；Toast 固定在舞台底部居中（`.toast` 绝对定位），不要放回已删除的 dockWrap。
- **UI-13 按钮字号被全局重置压过**：`.stage-ui button { font: inherit }` 的优先级 (0,1,1) 高于 `.tree-row`/`.tree-leaf` (0,1,0)，会让所有节点回退到 16 px——这是旧版字体偏大的根因。当前重置已改为 `:where(.stage-ui) button`；调整节点字号时不要改回高优先级写法。
- **UI-14 设计树不要加入场动画**：`transform` 入场动画在无头 SwiftShader 下会冻结在偏移位置，导致截图中的面板下移、`designTree` 测成 `x=17,y=22` 一类错误值。只保留悬停/选中底色与箭头旋转过渡。
- **UI-15 玻璃不能被实色底挡住**：`.tree-head`/`.tree-doc`/`.tree-foot` 必须保持透明或半透明 + 发丝线；加回白色渐变、实色底或大黑阴影会让面板重新变成后台白卡。面板背景保持 `--tree-bg` 的 0.68/0.66 透明度，夜间由 `data-theme='dark'` 切换深色玻璃。
- **UI-16 状态切换不要改字号字重**：选中/展开/悬停只改背景、颜色和 2 px 内嵌蓝线；改字重会让计数与文字横向跳动，违反设计树的稳定对齐要求。
- **UI-17 拖动只改 transform**：顶栏拖动用 `setPointerCapture` + `transform: translate()`，不要用行内 `left/top`（≤680px 的 `right:10px; width:auto` 会被破坏），也不要给 transform 加入场或过渡动画（无头 SwiftShader 会冻结在偏移位置）。初始 `transform` 必须是 `none`，否则 `designTree` 的 `(16,14)` 证据失真；拖动位置属于会话状态，刷新回左上角；`pointercancel/lostpointercapture` 必须结束拖动，避免停在抓取态。

### 自动展示

- **SHOWCASE-1 单时间线**：所有播放入口必须走同一个 `ShowcaseController`；当前总时长 **45 秒**。`start` 在 active 时必须 no-op，重播/下一章节只重置或跳转该实例。不要为每个按钮创建 tween/timer，也不要另开 rAF 循环；控制器依赖 `workbenchController` 的现有帧监听器，自动恢复只允许使用一个可清理的结束定时器。
- **SHOWCASE-2 暂停必须冻结设备**：只停相机/时间不够；`pauseDevices()` 调 `workstation.pauseAnimations()`，冻结 `elapsed`、开合（恢复时平移 `animStart`）、RGB 呼吸、蒸汽、水壶与屏幕刷新。只暂停镜头会留下还在摆动的设备和继续脉冲的灯。
- **SHOWCASE-3 跳段要即时落位**：`seek`/下一章节在暂停状态下跳段时，笔记本用 `setLaptopLidInstant()`；正常播放仍用 `openLaptop/closeLaptop` 的真实动画（22.6 s 合盖、25.4 s 开盖）。否则从合盖幕跳到开盖幕会一直停在半开/合盖。
- **SHOWCASE-4 隐藏不是暂停**：`隐藏控件栏` 只给 `.design-tree` 加 `.is-hidden` 并显示 `.tree-restore`；**绝不能隐藏 `.stage-ui`**（会连带隐藏开场/结束标题和字幕），也不能暂停时间线。恢复控件栏不得重建控制器或重置 `time`。`H` 与恢复图标都要可用。`展示时隐藏设计树` 开关只是让 start/restart 自动触发同一隐藏态；自然结束自动恢复时必须重新显示树。
- **SHOWCASE-5 灯光混合与快照**：展示中直接对 `lights` 数值/颜色、曝光、环境、bloom、背景做 smootherstep 混合；**不要调用 `applyLighting()`/`applyScene()`**，它们会按基础值瞬间重置。自然完成或手动退出都必须恢复开始前的 `UiState`、`baseScene`、相机 pose；展示期间抑制 `persistNow/scheduleSave`，避免把演出状态写进 `workstation-ui-v1`。
- **SHOWCASE-6 中景机位**：椅头顶 1.241 m，低距离中景会被黑色椅背整块挡住/裁掉格架顶；`night`/`focus` 使用 2.35–2.45 m、仰角 30–32°，不要缩回 1.25 m。终章 2.72 m/fov 51° 逐顶点投影工位高 84.7%、上/下 9.9%/5.4%；改机位后按 L3.16 重新投影。
- **SHOWCASE-7 RGB 缩放**：模式切换先在 `rgbScale=0` 时换模式再淡入，避免单色/彩虹/呼吸硬切；退出必须把 `setKeyboardRgbScale(1)` 复位。彩虹模式底光颜色保持白色，不要乘单色。
- **SHOWCASE-8 手动互斥**：展示 active 时所有普通场景回调、指针拾取与 1–9/R 快捷键必须拦截并提示；只放行树展开/折叠、自动展示按钮、`Space`、`H` 与“展示时隐藏设计树”开关。不要在锁定期间允许第二套相机/灯光控制。
- **SHOWCASE-9 无头截图**：展示期间 `controls.enableDamping=false`，控制器自己 `render()`；暂停/完成时主动停止推进是正确的。截图前把鼠标移开，避免 Tooltip 进入 `final-showcase-*.png`；无头下用 `seek()` 定位，不要按墙钟等完整的 45 秒。
- **SHOWCASE-10 可重复执行**：开始→退出→再开始不能重复注册监听器、叠加时间线、残留自动恢复定时器或保留 `animationsPaused` / `rgbScale`；start/restart/seek/exit 都要清理结束定时器；退出时 `showcaseMode=false`、`resumeAnimations()`、`setKeyboardRgbScale(1)`、隐藏态清除后再持久化恢复状态。
- **SHOWCASE-11 实时字幕**：底部白色字幕必须来自 `SHOWCASE_SUBTITLES` 的真实时间轨道，并由 controller 发布到 `ShowcaseUiState.subtitle`；不要把它写成固定的章节标题或一次性开场文字。隐藏设计树时字幕仍显示，暂停时保留，自动恢复后隐藏。结束后文案“展示完成 · 正在恢复初始状态”属于 `finished` 状态，不要在此之前自动退出。
- **SHOWCASE-12 恢复偏好分离**：`展示时隐藏设计树` 偏好存 `workstation-showcase-v1`，不能混入 `workstation-ui-v1` 的场景状态；自动恢复只恢复演示开始时保存的 `UiState`/相机/灯光快照，不把偏好当成场景状态。自然完成停留 **2 s** 后自动调用 `exit()`；如果用户在这 2 s 内点重播，必须先取消自动恢复定时器。

### 环境与相机

- **E-1 墙地接缝**：地板顶面、背墙/返墙底、踢脚底都在 `y=0`；改 `ENVIRONMENT` 后必须检查 `wallBaseGap` 与 `baseboardBaseGap` 为 0。墙体是朝内单面，背面机位会直接透过去，不要用背面截图判断“缺墙”。
- **E-2 地砖尺寸联动**：600 mm 砖来自 4×4 图集；`map.repeat` 必须按 `floorWidth/2.4`、`floorDepth/2.4` 计算。只改地板尺寸不改 repeat 会让砖缝不再是 600 mm。
- **E-3 裁切必须投影量**：默认/正面/左右/俯视用逐顶点投影判留白，不能看 `Box3` 或只凭肉眼；default 当前高 80.6%、上/下 10.3%/9.1%，左/右底部仅约 2.9%/3.4%，所以不要再把 target 抬高或把距离缩到 2.5 m 以下，否则滚轮会被裁。
- **E-4 初始相机与 default 同步**：`main.ts` 顶部的 `camera.position`、`controls.target` 必须与 `views.default` 一致；否则体验层接线前的首帧、或直接调用 `render()` 的自动化截图会回到旧机位。
- **E-5 视角切换在无头下很慢**：缓动走 rAF，SwiftShader 每帧可能 >1 s；切换后至少等 2.5 s 再读 `currentView`/距离。手动拖动/滚轮要清空激活态与 `currentView`；11 个按钮的 `aria-pressed` 必须唯一。
- **E-6 舞台边缘是已知设计边界**：低角度左/右 3/4 时，画面角落可能看到 2.4×2.25 m 地台边缘。不要用“恢复 5×4 m 大地面”解决；若用户要求完全无缝地面，另做带环境包围的地面并重跑环境审计与全部终图。
- **E-7 截图机位例外**：`setOrbit()` 会临时放宽交互限制，只用于取证/终图；正常交互必须保留 `min/maxDistance`、`±75°`、`16–88°`、`maxTargetRadius`。

### 流程与环境

36. **悬空误判**：先实测物体正下方所有 mesh 的顶面——可能落在笔袋、支架等更高家具上，而不是主桌面 0.7575。
37. **线缆穿越陈设**：新增/移动桌面陈设后检查现有线缆是否横穿；`createCables` 的 `makeCable` 只按世界坐标布线，不会自动避让。
38. **参考照片差异**：`figure/桌面-1.jpg` 的键鼠款式与 `桌面-2..4.jpg` 不同；当前场景以 `桌面-4.jpg` 的渐变灰 98 键键盘为准。用户实测/品牌更正优先于照片比例。
39. **尺寸来源**：本文件 L0.2/L3.x 与 `analysis/*-audit.json` 是尺寸的权威记录（README 不含设计细节）；用户最新更正优先级最高。
40. **截图机位**：低角度侧视容易被鼠标、杯子、显示器或桌面挡住；换角度或近景，不要用穿模机位假装已检查。
41. **阻尼动画在无头环境收敛慢**：`swivelChair`/`reclineChair`/`monitorPan` 用 `damp` 推进，无头 SwiftShader 低帧率下 10 s 只推进约 0.02 s 仿真时间；交互测试按“明显位移”断言。
42. **终图脚本的参数传递**：`tools/final_capture.mjs` 的 `shoot(fileName, shot, arg)` 必须把机位名/方位角作为第三个参数传给 `page.evaluate(fn, arg)`；漏传时 `capture(undefined)` 退回默认 `'front'`，六视图与四向转台会全部拍成同一张正面图（已修复；回归时先比较各视图像素差，正常应远大于 10）。
43. **并发任务**：本仓库可能同时有多个代理；写共享文件前重新读取，清理只删本轮文件。
44. **根目录临时脚本**：探针/导出类脚本不要留在仓库根目录（`_tmp_*.mjs` 等）；会在清理时按 L4.6 删除。

### 部署与网络

45. **Pages 首次启用必须手动**：`configure-pages` 的 `enablement: true` 也受令牌权限限制；工作流令牌创建站点会报 `Resource not accessible by integration`，需在 Settings → Pages 手动把 Source 选为 GitHub Actions（一次性操作）。
46. **github.com 可能间歇不可达**：直连 `github.com:443` 会被重置或超时，而 `api.github.com` 通常正常；推送先重试，仍失败用一次性代理 `git -c http.proxy=http://127.0.0.1:7897 push`（Clash 混合端口可能变动，先 `netstat` 确认；不要写进全局配置）。
47. **子路径 404 回归**：只改 `base` 或只改贴图路径都会让 Pages 白屏/材质变黑；验收标准是子路径静态服务下 25/25 贴图 200，本地 `npm run dev` 正常不代表部署正常。
48. **两个线上站点独立**：GitHub Pages 与 Qoder Sites 各自发布、各自更新；不要假设 push 后两边同步。`*.qoder.site` 含云端 ID，禁止提交。

## L6. 交付规范

最终回复使用以下结构（中文）：

- **任务结果**：已完成 / 部分完成 / 未完成。
- **主要修改**：说明行为或视觉上的关键变化，不逐行复述 diff。
- **修改文件**：列出主要新增/修改文件，使用带绝对路径和行号的 Markdown 链接。
- **验证情况**：列出实际运行的命令、结果、关键实测值和最终截图路径；未执行的检查要明确标注；放宽阈值的临时测试要注明。
- **遗留问题**：说明已知限制、风险或需要用户确认的事项；没有阻塞也要写“无”。

任务结束前：

1. 按 L4.6 删除本轮临时脚本、试拍和未使用的中间产物；不要删并行任务的文件。
2. 确认最终渲染、审计 JSON 和交互测试输出仍在；椅子改动确认 `final-chair-*` 已重拍，格架改动确认 `final-shelf-*` 与 `analysis/shelf-audit.json` 已更新，水壶/尺寸改动确认 `layout-audit.json` 对应字段已更新；UI 改动确认 `final-ui-*`、`final-keyboard-rgb.png` 与 `ui-manifest.json` 已更新，并保留 `interaction-test.json` 的 `errors: []` 与 `treeDrag` 三段位置（拖动改动的必查项）；自动展示改动确认 `showcase-test.json` 的 63 项断言全部通过、`errors: []`，且 `final-showcase-idle/opening/controls/device/rgb/night/finale.png` 已重拍并实际查看；环境/相机改动确认 `analysis/environment-audit.json` 全门禁为 true，且 `final-front/left/right/overhead/under` 已重拍。
3. 若尺寸/交互/工作流发生变化，更新本文件（必要时同步 README 的运行/部署说明）；**本文件只保留仍然有效的规则与事实，不堆积过程日志**。
4. 不要在未获同意时写全局记忆，也不要主动执行 Git 提交/推送。
5. 若修改了本文件，更新顶部版本/日期，并在附录 A 追加一条简短变更记录；附录只用于追溯，当前事实以 L0–L5 为准。

## 附录 A. 最近变更

> 附录只记录里程碑，不作为当前事实来源；尺寸、交互与验证以 L0–L5 和当前代码/实测为准。

- **2026-10-28（第三十一版）**：移动端画质档（方案 A）——
  - **触发条件**：`window.matchMedia('(pointer: coarse)')` 为真（触屏主指针）才启用，桌面/鼠标设备完全走原路径。
  - **降级项**：像素比上限 2 → **1.5**；阴影 PCFSoft 2048 → **PCF 1024**；跳过 **SSAOPass 与 UnrealBloomPass** 两道全屏重通道（其余 film/vignette 保留）；设计树关闭 `backdrop-filter`、改用 `--tree-bg-fallback`（0.97 不透明玻璃底）。
  - **实测**：桌面仿真（DPR 3，fine pointer）像素比 2、PCFSoft(2)、阴影 2048、模糊 `blur(12px) saturate(1.35)`、树底 0.68 —— 与改动前完全一致；手机仿真（390×844，DPR 3，coarse）像素比 1.5、PCF(1)、阴影 1024、模糊 `none`、树底 0.97；两档 `errors: []`。`test_interactions` 与 `final_ui_capture` 通过，`designTree (16,14,304×333)` 不变。
- **2026-10-28（第三十版）**：递进文档校准与拖动入口补齐——
  - **自动加载**：保留 L0–L6 + 附录结构；加载示例统一为“更新本文件”，阅读路由、文件边界与症状表补齐“顶栏拖动 / `bindTreeDrag` / `transform` 夹取”入口。
  - **事实校准**：L2.3 设计树高度 289 → **333**；L3.14 证据补 `treeDrag`；L5 UI-2 节点清单补“自动展示”；`.gitignore` 行补 `*.qoder.site`。
  - **过期引用**：删除“README 含尺寸/API/设计细节”的旧表述（L2.2、L3.2、L3.3、L3.4、L3.15），统一为“本文件 + 审计 JSON 为权威，README 只保留简介/运行/使用/部署”。
  - **范围**：本轮只改文档（代码与拖动实现沿用第二十七版），未重跑测试；引用数据仍以最新 `interaction-test.json` / `ui-manifest.json` 为准。
- **2026-10-28（第二十九版）**：部署维护知识纳入递进结构——
  - **L3.17**：新增「部署与仓库维护」配方（常规发布、GitHub Pages 工作流与首次启用、Qoder Sites、子路径验证、回滚、仓库卫生）。
  - **路由与门禁**：阅读路由新增「部署/仓库维护/Pages/Qoder Sites」行；L4.0 验证矩阵新增部署行。
  - **L5**：新增「部署与网络」四条坑（Pages 首次启用、github.com 间歇不可达与一次性代理、子路径 404、双站点独立发布）。
- **2026-10-28（第二十八版）**：新增 Qoder Sites 公开托管——
  - **部署**：`npm run build` 后经 Qoder Sites 上传（`webDirectory: dist`、`spa: false`），发布为公开站点 https://digital-workstation-vcyscgr9sb8.qoder.zone/ ，GitHub Pages 部署保留不变。
  - **访问与验证**：访问模式由 private 改为 public（改前 401）；线上 1200×900 无头实测 597 个 mesh、86/86 唯一贴图加载完成、`designTree (16,14,304×333)`、6 个节点、失败请求 0、页面错误 0；控制台 385 条 Canvas 贴图警告与本地 dev 完全一致，为既有现象。
  - **仓库**：插件生成的 `.数字工位 · 可交互 3D 工作区.qoder.site`（含云端 ID 与快照）加入 `.gitignore` 不提交；README 增加 Qoder Sites 线上地址。
- **2026-10-28（第二十七版）**：设计树顶栏可拖动——
  - **交互**：`.tree-head` 按住左键或触摸拖动即可平移整棵树；折叠按钮、GitHub 图标与链接不触发拖动。平移用 `transform`（不改行内 `left/top`），限制在舞台四周 8px 内；展开/折叠、整树折叠、主题或窗口尺寸变化后由 `ResizeObserver`/`resize` 自动收回舞台；`pointercancel/lostpointercapture` 会结束拖动。拖动时抓手光标、禁用文本选择、隐藏 Tooltip 并加深投影。
  - **边界**：初始位置仍为 `(16,14,304×333)`，位置不写入 `workstation-ui-v1`（刷新回到左上角）；≤680px 仍保持 `right:10px; width:auto` 的整宽布局，实测窗口从 1200 缩到 390 后树宽仍为 370、只保留纵向平移。
  - **实测**：`typecheck`/`build` 通过（单包 1,574.5 kB）；`test_interactions` 新增 `treeDrag` 断言（16,14 → 166,154 → 16,14），`errors: []`；`final_ui_capture` 记录 `designTree (16,14,304×333)`、移动端 `bodyScrollWidth=390`、`mobileErrors=[]`；临时自检图确认桌面拖到 (276,234)、窄屏纵向拖动后玻璃与布局正常（试拍已删除）。
- **2026-10-28（第二十六版）**：设计树常驻 GitHub 文字横条——
  - **入口**：装配体信息与节点区之间新增整宽横条 `.tree-repo-bar`（GitHub 图标 +「GitHub 开源仓库 · 欢迎 Star」+ ↗，278 × 32，整行新窗口打开）；标题栏图标与帮助链接保留。
  - **样式**：`--tree-card` 玻璃底 + 发丝线 + 内高光，悬停切换 `--tree-hover`/`--tree-accent`；整树折叠时随 doc/body/foot 隐藏；设计树默认高度 **289 → 333**（宽 304 不变，整树折叠仍为 48）。
  - **实测**：`typecheck`/`build` 通过；`test_interactions` `errors: []`；`final_ui_capture` 记录 `designTree (16,14,304×333)`、移动端 `bodyScrollWidth=390`、`mobileErrors=[]`；探针确认横条在树内、`href/target/rel` 正确、折叠后 `display:none`、无页面错误。
- **2026-10-28（第二十五版）**：README 精简——
  - **README**：由 210 行的设计文档精简为约 30 行的项目说明（简介、在线演示、运行、使用、部署、开发说明），移除尺寸表、材质、代码结构、验证与限制等设计细节；设计事实继续以本文件与审计 JSON 为准。
  - **规则同步**：L0.3、L1.6、L2.1、L5-39、L6.3 中“README 是尺寸表/需同步 README”的表述改为“本文件 + 审计 JSON 为权威记录，README 保持简洁不写设计细节”。
- **2026-10-28（第二十四版）**：设计树新增 GitHub 仓库入口——
  - **入口**：标题栏 `.tree-head` 增加 GitHub 图标链接 `.tree-github`（24×24，悬停显示「GitHub 开源仓库 · 欢迎 Star」），帮助节点正文末尾增加 `.help-repo-link` 文字链接；两者都新窗口打开（`target=_blank` + `noopener noreferrer`），指向 `github.com/Osinglehh/digital-workstation`。
  - **样式**：`.tree-github` 与折叠按钮同一套悬停样式；`.help-repo-link` 使用 `--tree-card`/`--tree-hover` 玻璃底色，日夜主题自适应；树宽 **304**、全折叠高 **289** 不变。
  - **实测**：`typecheck`/`build` 通过；`test_interactions` `errors: []`；`final_ui_capture` 记录 `designTree (16,14,304×289)`、移动端 `bodyScrollWidth=390`；运行时探针测得标题栏无挤压（head scrollWidth=clientWidth=302、副标题未截断）、帮助链接 250×29 且完全落在树内、`errors: []`。
- **2026-10-28（第二十三版）**：托管 GitHub 并上线 Pages——
  - **仓库**：`git init` 并推送到公开仓库 `github.com/Osinglehh/digital-workstation`（`main` 分支）；`.gitignore` 排除 `node_modules/`、`dist/`、`figure/`（231 MB 参考照片）与 `analysis/renders/`（65 MB 渲染证据），其余 190 个文件入库。
  - **部署适配**：`vite.config.ts` 加 `base: './'`；工厂与 `object-sculpt-spec.json` 中 25 个运行时贴图 `url` 由 `/textures/...` 改为相对路径 `textures/...`，子路径部署不再 404。
  - **自动部署**：新增 `.github/workflows/deploy.yml`（npm ci → typecheck → build → configure-pages `enablement: true` → upload/deploy-pages），push `main` 即上线；首次启用需在仓库 Settings → Pages 手动选择 GitHub Actions 来源（工作流令牌无权自动创建 Pages 站点，`enablement` 与 API 调用均被拒绝）。
  - **实测**：本地子路径静态服务 + 无头浏览器探针 25/25 贴图 200、`errors: []`；线上 https://osinglehh.github.io/digital-workstation/ 首页/JS（1,571,573 B）/woodOak albedo 贴图均 200。
- **2026-10-27（第二十二版）**：45 秒自动展示、实时字幕、隐藏选项与自动恢复——
  - **时长**：时间线从 94 秒压缩到 **45 秒 / 7 幕**；第 1–7 幕为 0–7 / 7–13 / 13–21 / 21–28 / 28–34 / 34–40 / 40–45 秒。相机关键帧、场景/屏幕/开盖/RGB 事件与底部字幕同步重排；右 3/4 到显示器仍保留 13.7 s 抬高过椅背的过渡，中景保持 2.35–2.45 m。
  - **实时字幕**：新增 `SHOWCASE_SUBTITLES` 白色功能字幕轨道，底部 `.showcase-live` 随真实时间更新（整体工位、显示器、笔记本、桌面配件、合盖/开盖、RGB 三态、深夜/专注、终章），暂停保留、隐藏控件栏仍显示。
  - **隐藏选择**：自动展示节点新增 `展示时隐藏设计树` 开关，偏好写入独立 key `workstation-showcase-v1`；开启后 start/restart 自动隐藏，`H`/恢复图标随时显示，自然结束恢复时强制显示。
  - **自动恢复**：自然播放到 45 s 后显示结束状态，停留 **2 s** 自动 `exit()` 恢复演示前相机、场景、RGB、屏幕、开盖、灯光、整理/显隐与选择；启动/重播/跳段/退出都会清理自动恢复定时器。
  - **实测**：`typecheck`/`build` 通过（单包约 1,572 kB）；`node tools/test_showcase.mjs` **63 项断言全部通过、`errors: []`**，覆盖字幕、隐藏选项、45 s 总长、暂停冻结、三次重播、自然完成自动恢复基线、手动退出与二次启停；`final_ui_capture` 记录全折叠树 `(16,14,304×289)`，运行时探针测得六节点内容 **2146** / 可视 555；已重拍 `final-showcase-*.png` 并逐张查看。
- **2026-10-27（第二十一版）**：树内「自动展示」与 94 秒演出上线——
  - **新功能**：在原有设计树中加入 `自动展示` 一级节点，一键播放 7 幕（整体亮相 / 空间环绕 / 桌面细节 / 设备互动 / RGB 灯效 / 氛围切换 / 终章全景），总时长 **94 秒**；进度、章节、时间与百分比均来自真实时间线；支持暂停/继续、下一章节、重新播放、退出、隐藏控件栏（H）与展示中空格暂停。
  - **实现分层**：新增 `src/showcase/showcaseTimeline.ts`（时间线/相机/事件纯数据）、`showcaseController.ts`（状态机与事件调度），`workbenchController.ts` 增加快照恢复、灯光渐变、设备直控与手动互斥，`controlPanel.ts/css` 增加展示节点、进度与隐藏恢复入口；`workstationDetails.ts` 增加 RGB 亮度缩放、动画暂停/恢复与开盖即时落位。
  - **镜头/灯光**：场景事件 day@0 → night@61 → focus@68.6 → rgb@74.6，灯光按真实当前值向场景基线渐变；中景抬高到 2.35–2.45 m 避开椅背并完整收进格架，终章 2.72 m/fov 51° 实测工位高 84.7%、上下留白 9.9%/5.4%；RGB 模式切换先压暗再淡入；笔记本合盖/开盖使用真实动画，跳段使用即时落位。
  - **交互与安全**：展示期间手动视角/场景/拾取快捷键互斥并提示；树整体折叠不中断；隐藏只隐藏树，保留小型恢复图标与标题字幕；退出恢复演示前的相机、场景、RGB、屏幕、开盖、装饰与选择，且不把演出状态写入 `workstation-ui-v1`。
  - **实测**：`npm run typecheck`、`npm run build` 通过（单包 1,568 kB）；`node tools/test_showcase.mjs` **51 项断言全部通过、`errors: []`**，覆盖暂停冻结/继续、下一章节、隐藏继续播放与恢复、三次重播、退出恢复非默认基线与二次启停；`test_interactions.mjs` 通过；`final_ui_capture.mjs` 记录全折叠树 `(16,14,304×289)`、六节点全展开 648 / 内容 2087 / 可视 555；已重拍 `final-showcase-*.png` 并逐张查看。
  - **清理**：删除本轮探针脚本与 `_tmp-showcase-*` 试拍；保留 `showcase-test.json`、`final-showcase-*.png`、`final-ui-*.png`、`ui-manifest.json`、`interaction-test.json` 及全部审计/最终图。未做 94 秒无头逐帧录屏，时间线以 seek + 状态断言 + 关键帧截图验证。
- **2026-10-27（第二十版）**：清理收口与文档校订——
  - **清理**：本轮探针脚本（7 个 `_tmp_*.mjs`）与试拍/平面稿（25 张 `_tmp-*`）全部删除；仓库根目录、`analysis/` 无 `_tmp` 残留；最终图（含 11:30 重拍的五视图/参考构图/转台）、四份审计 JSON、`interaction-test.json` 与三份 manifest 均保留。
  - **文档**：核对 L0–L6 与当前代码一致（键盘渐变/桌面小件/薄壁水壶/椅子 X 背架/礼盒罐体/书包绿袋等）；阅读路由与症状表补“水壶摆动支点”入口；L3.10 新增 6a/6b 两条探针约定（`setOrbit` 自带截图、交互 API 需走界面路径、动画采样要留 ≥15 s 窗口）；L5 补 18B 摆动支点坑。
- **2026-10-27（第十九版）**：水壶摆动的支点修正（用户实测反馈）——
  - **问题**：原实现的摆动绕瓶身原点旋转，表现为“上部摆动、下部不动”，与实物挂在挂钩上的钟摆相反。
  - **修正**：`enhanceWorkstation` 初始化时以挂带最高顶点（挂钩接触点）为支点（`bottleSwayPivot`），tick 内摆动后再做位置补偿；主摆动移到前后方向（±z），左右方向（±x）只用 45%。
  - **实测**（界面 2.2° 幅度）：挂带顶部 X/Z 位移 ≤0.02 mm、Y 抖动 ≤0.8 mm；瓶底摆幅 13.8 mm（z）/ 4.0 mm（x）；`rotation.x` 峰值 0.0363 rad ≈ 2.08°，右侧木板净距保持 ≥6 mm。
  - **回归**：`typecheck`/`build` 通过，`test_interactions.mjs` `errors: []`，`final_capture.mjs` 十张标准图（含参考构图）已按新姿态重拍；试拍脚本已清理。
- **2026-10-27（第十八版）**：AGENTS 递进结构校准与自动加载优化——
  - **事实同步**：把 L0/L2 的键盘渐变、玻璃杯、薄壁水壶 + 液体、X 背架/翼形腰靠/90 mm 微凹坐垫、书包小印 + 亮绿袋、鼠标垫印花同步到最新实现；新增“桌面小件”速览行。
  - **加载优化**：扩展阅读路由（设计树视觉/玻璃/字号、桌面小件、文档维护），新增 L4.0 验证矩阵；补充 UI-15/16 与桌面小件 L5 坑（玻璃不能实底、茶汤材质、缝线对比）。
  - **维护约定**：附录只作历史追溯；并行任务章节不得删除；本版只改文档，不改代码，最终图、审计与交互测试输出保持不动。
- **2026-10-27（第十七版）**：参考图全面复核后的 12 项细节修正——
  - **键盘**：键帽改为参考的**由后向前逐排渐变**（`#D9DDDF → #4C5458`，空格 `#3F474B`），图例按排切深/浅字色；键缝底光收深到 0.104、点光抬到 `(0, 0.095, 0)` 并降到 0.04–0.10、桌面溢光面收到 0.55 × 0.15 `z=-0.055`，正面视角不再出现粉色硬光带。
  - **杯子**：玻璃杯重建为透明玻璃 + 近乎全黑的深色茶汤（液面约 72%），木盖改哑光胡桃、扁提钮、压薄 D 形柄。
  - **水壶**：瓶身改为薄壁中空（内腔 ≈40 mm），烟灰磨砂材质（roughness 0.7、transmission 0.26、`transparent: true`），新增不透明内胆与约 55% 液面。
  - **椅子**：坐垫加厚到 90 mm 并改用微凹网面（中心 8 mm 碗形 + 前缘瀑布压边）；新增全宽 X 背架、浅灰翼形腰靠（孔面朝后）、两根金属横杆；`chairMeshMaterial` 材质色改白、织纹贴图独立控制对比，网布三米外可读。
  - **桌顶**：礼盒印刷重绘（圆心在盒面下方的大月盘 + 左低右高的如意镂空窗 + 校徽落在月盘内 + 灰蓝插卡只到窗高 58%）；玻璃罐改高透玻璃、果料降到约六成并加深紫色。
  - **桌下/桌面**：书包底色改深酒红 `#4A2A33`、印花减到约 52 块小印 + 5 块中号并压暗；垃圾桶改亮绿半透明袋 + 整圈外翻薄壁袋口；鼠标垫改偏冷中灰基色、重绘深灰折角带印花、缝线改浅灰。
  - **工具**：`final_capture.mjs` 的参考构图隐藏椅子（`chairVisible:false`）并对齐坐位视角，不再被椅背挡住键盘。
  - **验证**：`typecheck`/`build` 通过；`test_interactions.mjs` `errors: []`；`audit_environment`/`audit_underdesk`/`audit_shelf` 全门禁通过；已重拍 `final-*`、`final-chair-*`、`final-shelf-*` 并用图像阅读逐张复核。
- **2026-10-27（第十六版）**：设计树改为半透明玻璃拟态悬浮面板——
  - **视觉**：304 px 宽、14 px 圆角；`rgba(245,247,250,0.68)` + `backdrop-filter: blur(12px) saturate(135%)` 雾面玻璃，头部/装配体/底栏改为透明底 + 发丝线，夜间切换深色玻璃并提供 `@supports` 回退；阴影收敛为小范围柔和投影。
  - **字号与密度**：标题 13 / 分类 12.5 / 叶子 12 / 辅助 9.5 / 小微 9 px，行高 27 / 26 px，图标 12–14 px；计数改为低对比文字徽标；选中/展开态为浅蓝底 + 2 px 内嵌蓝线，不改变字重，避免行内跳动。
  - **根因与稳定性**：`:where(.stage-ui) button` 降低全局按钮 `font: inherit` 优先级，节点字号才真正生效（此前按钮实际 16 px）；移除设计树入场 transform 动画，避免无头截图冻结偏移。
  - **实测**：全折叠 `(16,14,304×262)`、五节点全展开 648（`tree-body` 内容 1761 / 可视 555、页面 900 不撑高）；移动端树宽 370、检查器 315、`bodyScrollWidth=390`；交互回归 `errors: []`，`final-ui-*.png` 与 `ui-manifest.json` 已更新。
- **2026-10-26（第十五版）**：文档校准与清理收口——
  - **设计与实测**：左上设计树（品牌/装配体信息/五类节点/状态栏）与树内检查器已定稿；运行时实测全折叠 `(16,14,326×269)`、四节点全展开 648（树内滚动、页面不撑高）、右上/底部无交互浮窗、选中显示器检查器 `position=static` 且完全落在树内、`errors: []`。
  - **文档**：阅读路由改称“左上设计树”；L0.2 补充“展开时树内滚动”；L3.14/L4.1 补入上述实测指标，便于后续代理直接断言。
  - **清理**：本轮仅生成 `_tmp_tree_check.mjs` 与一张试拍，均已删除；仓库根目录、`analysis/renders/` 无 `_tmp` 残留；最终图、审计、交互测试输出保留。
- **2026-10-26（第十四版）**：键盘 RGB 氛围光增强 + 左上 SolidWorks 风格设计树——
  - **RGB**：保留白色键帽，新增键缝彩色底光、`keyboard-rgb-light` 键帽染色点光与 0.58 × 0.21 m 桌面溢光面；修复彩虹模式底光被单色相乘发灰的问题；五种模式与关闭状态逐张截图复核。
  - **设计树**：移除底部 dock 与右侧检查器，统一为舞台左上常驻设计树（品牌/装配体信息/视角/物品/灯光/场景/帮助/状态栏）；节点可独立展开折叠、整树可折叠；物体检查器挂到选中对象下方并自动滚入视野；桌面 326 px、移动端 370 px 且高度 ≤62vh。
  - **交互**：`selectObject` 不再关闭面板，点击空白不折叠树，Esc 先取消选中再折叠节点；主题切换即时生效，移除树节点颜色过渡以避免无头冻结。
  - **测试与证据**：`test_interactions.mjs` 增加整树折叠/展开与 `inspectorInsideTree` 断言；`final_ui_capture.mjs` 增加 `designTree`/`mobileOverflow` 与 `final-keyboard-rgb.png`；`ui-manifest.json` 记录树尺寸，`interaction-test.json` 保留 `errors: []`。
- **2026-10-26（第十三版）**：修复桌顶格架阴影穿板——
  - **根因**：搁板板件 `castShadow=false`，架上物件（剪刀、书籍、罐体）的实时阴影直接穿过搁板落到下方背板，形成剪刀鬼影。
  - **修复**：搁板参与投影；下方背板 `receiveShadow=false` 保持参考墙面的均匀受光；顶板仍不投影以保持格架内部亮度，架顶绿色盒/本子关闭实时投影并补接触阴影。
  - **验证**：`audit_shelf.mjs` 新增 `shadowOcclusion` 门禁；重拍 `final-shelf-*`、`final-*.png` 与 `final-ui-*`，`shadowOcclusion=true`、交互回归 `errors: []`。
- **2026-10-26（第十二版）**：紧凑舞台与相机预设定稿——
  - **环境**：地板 2.4×2.25 m（`y=0`、600 mm 瓷砖）、背墙 2.6×2.35 m（`z=-0.64`）+ 0.42 m 返墙、85 mm 踢脚；工位逐顶点包络 `x -0.855..0.533 / y 0..1.7915 / z -0.34..0.9326`，距背墙 0.300 m；墙底/踢脚/地板同基准，无缝隙。
  - **相机**：11 个预设重新校准；`default` 改为 target `[-0.03,0.78,0.04]`、az -26°/el 20°/2.80 m/fov 52°，1200×900 实测工位高 80.6%、上下留白 10.3%/9.1%；`front/left/right/overhead/panorama` 完整可见，左右 3/4 不再裁滚轮；初始相机与 `views.default` 同步。
  - **工具**：新增 `tools/audit_environment.mjs` 与 `analysis/environment-audit.json`，用逐顶点投影审计墙地接缝、净距、预设安全边界与留白；新增阅读路由、L3.15、L4 检查与 L5-E 条目。
  - **清理**：删除本轮相机/环境探针脚本、候选机位试拍、角落裁切图与日志；保留最终图、`environment-audit.json`、交互测试输出。
- **2026-10-26（第十一版）**：界面收尾与窄屏修正——
  - **窄屏**：860px 以下或高度 ≤560px 时舞台铺满窗口（含 `100dvh`）；680px 以下 dock 固定宽度（≤560px）、按钮强制单行，面板与 dock 同宽，消除面板展开时的按钮重排和横向溢出。
  - **提示层**：Tooltip 仅在键盘 `:focus-visible` 时随焦点显示，鼠标点击后隐藏；Toast 移入 `dockWrap`，位于面板与 dock 之间，不再遮挡面板说明。
  - **证据与工具**：新增 `final-ui-mobile-inspector.png` 与 `mobileOverflow` 测量；`test_interactions.mjs` 的重载等待改为“新文档 + 完整 API”判据，避免无头环境在旧执行上下文提前返回。
- **2026-10-26（第十版）**：新增悬浮“数字工位”控制台与体验层——
  - **界面**：`src/ui/*` 四组控制台（视角/物品/灯光/场景 + 帮助）、物体检查器、Tooltip/Toast、暗色主题与窄屏单列；旧底部 HUD 移除。
  - **交互**：Raycaster 悬停/点击、Box3 选中框、聚焦观察、桌面整理/装饰显隐；11 机位（新增显示器近景）、4 场景预设；自动环绕改为真实时间 ±68° 往返。
  - **内容**：双屏新增代码/终端/桌面/专注四种 Canvas 内容；键盘 RGB 改为关闭/单色/彩虹/呼吸/柔光 + 四色，保留 `'sweep'` 兼容。
  - **持久化**：`workstation-ui-v1` 恢复视角/场景/灯光/RGB/屏幕/合盖/整理/显隐。
  - **工具与文档**：更新 `tools/test_interactions.mjs`（新 UI 路径、45 s 低帧率等待）、新增 `tools/final_ui_capture.mjs`；README 与 AGENTS 增加 L3.14、UI 证据与 L5-UI 条目。
- **2026-10-26（第九版）**：按用户要求清理并重整——
  - **桌顶格架定稿**：礼盒印刷重做为 250 × 150 × 55 横向“月盘 + 镂空窗”构图（月耀/喻园改淡金、窗内皇家蓝楼阁线稿、校徽与底部标语带）；架内右前方订书机按用户更正替换为**黑色剪刀**；16 本书按参考**逐本校准高度**（三段天际线 256–288 / 252–280 / 200–222 mm），短书同时收浅进深；右侧陈设中心点改为由 `bookRowEnd` 派生并复算净距（5.3 / 7.0 / 3.8 mm）。
  - **工具修复**：`final_capture.mjs` 的 `shoot()` 补齐 `page.evaluate(fn, arg)` 参数（此前六视图会全部拍成正面）；`capture_orbit.mjs` 改用 `domcontentloaded + 90 s` 等待。
  - **清理**：删除本轮 18 张 `analysis/renders/_tmp-*` 试拍、6 张冗余参考裁切与根目录探针脚本；保留 8 张有判读价值的参考裁切（见 L3.13 证据清单）。
  - **文档**：本文件重写为第九版递进式结构，补齐 L2 路由、L4.3 格架回归、L4.6 新清理协议与 L5 相关条目。
- **2026-10-26（第八版）**：书包印花改为小号散印、前袋加宽 0.286；姿态由整体旋转改为**剪切矩阵**（包底水平贴地、上半身侧倾约 4.6° 靠左板），肩带落地段补偿 +0.008；`audit_underdesk.mjs` 复测整组落地 minY=0、距左板 4.9 mm、离椅 42.4 mm。
- **2026-10-26（第七版）**：按 UZSPACE 750 ml 实物缩短瓶身到 206.6 mm（含盖 251.1 mm、瓶底距桌面 161 mm），刻度改为 0.16 m/y=0.02 且 650 ml 在上。
- **2026-10-26（第六版）**：书包改为背面靠左侧板；移除三条地面盘绕线缆；`audit_underdesk.mjs` 改为逐子件 AABB 判定；`final_capture.mjs` 增加重试与状态复位。
- **2026-10-26（第五版）**：按 `figure/桌顶架子-1/2/3.jpg` 重建桌顶格架（330 mm 净高、顶板/侧板/背板 + 安装孔、16 本书 + 文件盒 + 礼盒 + 玻璃罐 + 茶罐 + 纸品），移除旧托架/旧书列/旧茶罐，新增 `audit_shelf.mjs`、`final_shelf_capture.mjs` 与 L3.13。
- **2026-10-26（第四版）**：重建桌下（落地木侧板/背板 + 铝立柱/横档/桥架 + 插座）、600 mm 瓷砖地面、书包与垃圾桶；椅子 AABB 逐顶点复测为 y 0–1.241 / z 0.102–0.9326。
- **2026-10-26（第三版）**：重建椅子头枕（390×180 mm 叶形网布枕，支撑全在背面）；新增 `final_chair_capture.mjs`；本文件改为 L0–L6 递进式结构。
- **2026-10-26（第二版）**：椅子扶手闭合三角框、椅座前移贴桌、椅子 AABB/机位审计。
- **2026-10-25（第一版）**：场景、键鼠、水壶、显示器、笔记本、交互与最终渲染基线。