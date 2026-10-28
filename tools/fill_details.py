import json
from pathlib import Path

p = Path('analysis/pre-spec-assessment.json')
d = json.loads(p.read_text(encoding='utf-8'))
a = d['preSpecAssessment']
inv = a['detailInventory']
inv['scanMethod'] = 'grid-3x3'
inv['note'] = (
    '按 4.jpg 的 3×3 分区逐格扫描，再以高清局部裁剪复核。'
    '每条细节映射到最终 spec 的 component.localFeatures 或 material.localOverrides。'
)

rows = [
    ('wood-desk-grain', 'linework', '桌面浅木纹：暖米黄底、细直纹沿 X 方向贯穿，局部有轻微色带与木节；不是均匀噪点。', 'large', 'albedo/roughness/height', 'woodOak/desk-grain', '4.jpg 桌面 0.02-0.95,0.86-0.99', 0.9),
    ('wood-partition-grain', 'linework', '隔断木饰面的直纹为竖向，纹理比桌面更细，靠近铝框处略深。', 'large', 'albedo/normal direction', 'woodOak/partition-grain', '4.jpg 背板 0.18-0.82,0.30-0.48', 0.88),
    ('desk-edge-wear', 'chip', '桌面前缘右侧有约 2-3 mm 的浅色崩边，边缘清漆局部磨失。', 'small', 'silhouette/roughness', 'deskTop/desk-edge-wear', '4.jpg 前缘 0.55-0.85,0.93-0.96', 0.6),
    ('mullion-chamfer', 'bevel', '铝立柱正面有 1.5-2 mm 倒角，窄高光连续；立柱截面带两道纵向浅槽。', 'medium', 'geometry highlight', 'partition/mullion-micro-bevel', '4.jpg 立柱 0.165-0.19 与 0.80-0.83', 0.82),
    ('frosted-sheen', 'gloss', '磨砂玻璃呈漫反射灰绿，表面有弱宽高光带，能透出背后轮廓但不清晰。', 'large', 'roughness/transmission', 'frostedGlass/frost-band', '4.jpg 左右玻璃 0.00-0.15,0.12-0.45', 0.84),
    ('glass-retainer-groove', 'groove', '玻璃四周被铝压条夹持，压条与玻璃之间形成约 8 mm 深的暗缝。', 'medium', 'AO geometry', 'partition/glass-retainer-groove', '4.jpg 右玻璃边 0.83-0.87,0.22-0.48', 0.8),
    ('laptop-lid-chamfer', 'bevel', '白色上盖四周为 CNC 小倒角，边缘在办公室顶灯下形成细亮线。', 'medium', 'geometry highlight', 'laptopLid/lid-edge-chamfer', '4.jpg 上盖 0.20-0.46,0.40-0.47', 0.86),
    ('laptop-rtx-sticker', 'decal', '掌托右下的蓝绿色 RTX/Intel 贴纸组，约 28x12 mm，边缘略有翘起。', 'small', 'albedo', 'laptopBase/rtx-sticker', '4.jpg 0.43-0.47,0.59-0.62', 0.78),
    ('laptop-screen-ui', 'emissive', '屏幕为深蓝 Windows 壁纸，左上两列彩色图标，中央深色终端窗，底部任务栏。', 'large', 'emissive/albedo', 'screenLaptop/taskbar-glow', '4.jpg 0.22-0.44,0.38-0.55', 0.9),
    ('laptop-shell-sheen', 'gloss', '白色镁铝机身有柔和各向同性高光，掌托边缘亮、平面部略哑。', 'medium', 'roughness/clearcoat', 'laptopWhite/soft-clearcoat', '4.jpg 掌托 0.25-0.44,0.57-0.64', 0.82),
    ('monitor-bezel-sheen', 'gloss', '显示器黑边为细咬花塑料，窄边处因角度呈现一条锐利高光。', 'small', 'roughness', 'monitorPlastic/bezel-sheen', '4.jpg 边框 0.49-0.88,0.30-0.36', 0.8),
    ('aoc-logo', 'decal', '下巴中央银色 AOC 字标，宽约 35 mm，字距紧。', 'small', 'albedo', 'monitorBase/aoc-logo', '4.jpg 0.645-0.68,0.48-0.50', 0.9),
    ('monitor-app-window', 'emissive', '外接屏中央为深灰软件窗口，含中文列表与右侧说明栏；底部蓝条任务栏、右下时钟。', 'large', 'emissive/albedo', 'screenMonitor/app-window', '4.jpg 0.53-0.79,0.32-0.47', 0.88),
    ('keycap-gradient', 'decal', '键帽颜色由 F 区浅灰渐到底排深灰，modifier 明显更深，整体偏冷灰。', 'large', 'albedo', 'keycapPBT/gradient-bands', '4.jpg 0.27-0.64,0.73-0.84', 0.9),
    ('keycap-bevel', 'bevel', '每个键帽为倒角方台，顶面微凹；倒角在 RGB 透光下形成一圈亮边。', 'medium', 'geometry highlight', 'keycapMatrix/keycap-bevel', '4.jpg 键盘近景 0.28-0.62,0.74-0.83', 0.86),
    ('keyboard-rgb', 'emissive', 'RGB 从键缝与轴体透出：左侧粉紫、中央蓝、右侧青绿到黄绿，亮度沿行变化。', 'medium', 'emissive', 'keycapPBT/rgb-underlight', '4.jpg 键盘 0.28-0.64,0.74-0.84', 0.9),
    ('keyboard-knob-knurl', 'ridge', '右上旋钮侧壁有细密竖向滚花，顶面为同心圆拉丝。', 'small', 'geometry highlight', 'keyboardKnob/knurled-grip', '4.jpg 0.60-0.63,0.73-0.76', 0.72),
    ('mousepad-print', 'decal', '鼠标垫灰底上印深灰/近黑几何斜带与细线，右上角有小字标识。', 'large', 'albedo', 'mousepadFabric/geometric-print', '4.jpg 0.66-0.97,0.67-0.90', 0.86),
    ('mousepad-stitch', 'stitch', '鼠标垫四周有约 4 mm 高的密缝边，线色比布面浅。', 'medium', 'geometry/roughness', 'mousepad/stitched-edge', '4.jpg 垫边 0.65-0.97,0.66-0.91', 0.75),
    ('mouse-grip-ridge', 'ridge', '鼠标左侧裙有两道浅凹槽/防滑棱，表面为细类肤涂层。', 'small', 'normal/AO', 'mouseShell/side-grip-ridges', '4.jpg 鼠标 0.79-0.88,0.73-0.82', 0.7),
    ('tea-meniscus', 'gloss', '深红茶汤液面靠近杯壁处有一圈细亮弧，液面略低于杯口约 12 mm。', 'small', 'specular/transmission', 'teaLiquid/tea-surface-sheen', '4.jpg 茶杯 0.62-0.67,0.64-0.75', 0.8),
    ('mug-lid-grain', 'linework', '棕色木盖有细年轮/直纹，边缘倒圆，顶面有一个同色小提钮。', 'small', 'albedo/normal', 'mugLid/lid-wood-grain', '4.jpg 0.615-0.675,0.615-0.66', 0.8),
    ('bottle-uzspace-label', 'decal', '灰绿水壶右侧有白色竖排 UZSPACE 字样，字高约 8 mm，下方有容量刻度。', 'medium', 'albedo', 'bottleBody/uzspace-label', '4.jpg 0.905-0.96,0.35-0.55', 0.92),
    ('bottle-strap-weave', 'stitch', '黑色挂带为尼龙织带，表面有横向织纹，从瓶盖环穿过并挂在玻璃钩上。', 'small', 'normal', 'bottleStrap/strap-weave', '4.jpg 0.91-0.97,0.20-0.32', 0.78),
    ('paper-handwriting', 'linework', '左侧白纸上有深蓝/黑手写字，行距不均，纸张局部卷曲并压住黄边笔记本。', 'large', 'albedo/height', 'paperStack/handwriting', '4.jpg 0.00-0.24,0.78-0.96', 0.88),
    ('pencilcase-zip', 'fastener', '黑色笔袋正面有连续金属拉链齿与拉头，旁边缝有浅色布标。', 'small', 'geometry highlight', 'pencilCase/zip-teeth', '4.jpg 0.02-0.17,0.72-0.85', 0.72),
    ('powerstrip-led', 'emissive', '白色插排靠近显示器底座处有一枚很小的红色/橙色电源指示灯。', 'small', 'emissive', 'powerStrip/indicator-led', '4.jpg 0.50-0.60,0.62-0.67', 0.65),
    ('white-cable-sheen', 'gloss', '白色 USB-C 线从笔记本左侧绕到桌后，表面为哑光 PVC，局部有弱高光。', 'large', 'specular/roughness', 'rubberCable/cable-sheen', '4.jpg 0.06-0.26,0.51-0.72', 0.7),
    ('shelf-book-bands', 'decal', '书架左侧书列有紫、粉、米、深蓝、黑、白、绿、橙等书脊，宽窄与高度不一。', 'large', 'albedo', 'shelfProps/book-spine-color-bands', '4.jpg 0.10-0.40,0.00-0.08', 0.8),
    ('teajar-lid-gloss', 'gloss', '书架两只玻璃茶罐的金属/塑料盖上各有一圈窄高光，罐内茶叶为深褐/紫色。', 'small', 'specular', 'shelfProps/tea-jar-lid-gloss', '4.jpg 0.50-0.59 与 0.56-0.62,0.00-0.08', 0.7),
]

comp_prefixes = {
    'deskTop', 'partition', 'shelf', 'shelfProps', 'laptopStand', 'laptopLid', 'laptopBase',
    'monitorBezel', 'monitorStand', 'monitorBase', 'keyboardCase', 'keyboardKnob', 'keycapMatrix',
    'mouseShell', 'mouseWheel', 'mousepad', 'mugGlass', 'mugLid', 'bottleBody', 'bottleStrap',
    'pencilCase', 'paperStack', 'powerStrip', 'powerBrick', 'whiteCableLaptop', 'chairBack',
}

details = []
for did, kind, desc, scale, affects, ref, ev, conf in rows:
    owner = ref.split('/')[0]
    details.append({
        'id': did,
        'kind': kind,
        'description': desc,
        'region': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0, 'units': 'normalized'},
        'scale': scale,
        'affects': affects,
        'mapsTo': {
            'type': 'component.localFeatures' if owner in comp_prefixes else 'material.localOverrides',
            'ref': ref,
        },
        'evidenceRef': ev,
        'confidence': conf,
    })

inv['details'] = details
p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
print('details', len(details))
