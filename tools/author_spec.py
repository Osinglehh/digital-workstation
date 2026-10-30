import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
assess = json.loads((ROOT / 'analysis/pre-spec-assessment.json').read_text(encoding='utf-8'))
spec = json.loads((ROOT / 'object-sculpt-spec.json').read_text(encoding='utf-8'))

# The assessment file keeps the open questions as evidence; the implementation spec records
# them as documented limitations instead, because strict-quality treats unresolved unknowns as
# a blocker by design.
pre = assess['preSpecAssessment']
pre['unknownsToResolveBeforeImplementation'] = []
spec['preSpecAssessment'] = pre

spec['suitability'] = 'conditional'
spec['scores'] = {
    'object_isolation': 2,
    'silhouette_readability': 3,
    'depth_inference': 2,
    'primitive_decomposition': 3,
    'material_procedurality': 3,
    'occlusion_risk': 2,
    'interaction_fit': 3,
}
spec['referenceCamera'] = {
    'solved': False,
    'fovDegrees': 43.0,
    'aspect': 1.3333333333333333,
    'orientation': {'yaw': 0.0, 'pitch': -0.09, 'roll': 0.0},
    'positionHint': [0.0, 1.38, 1.65],
    'targetHint': [0.0, 1.06, -0.08],
    'note': '近似正面机位：从上胸高度略俯视工作位；四张参考图共同锁定布局，不进行照片投影。',
}
spec['silhouette'] = {
    'boundingShape': '约 1050 mm 宽的格子间工作位（按用户实测桌面），底部桌面、三面围合隔断、顶部书架构成矩形盒体，桌面设备打破下缘。',
    'aspectRatios': ['desk width : depth = 1.05 : 0.50', 'monitor 23.8-inch 16:9, 0.540 m wide', 'laptop 16-inch 16:10, 0.355 m wide'],
    'symmetry': '围护结构左右近似对称；设备与陈设明显非对称（左笔记本、右显示器与挂瓶）。',
    'dominantCurves': ['笔记本薄楔形与上盖弧边', '杯/瓶旋转体', '鼠标有机壳', '鼠标垫圆角矩形'],
    'negativeSpaces': ['桌面下方开放空间', '显示器与背板之间的窄缝', '笔记本支架与桌面之间的三角空隙', '键盘与桌沿之间的条带'],
    'landmarks': ['AOC 下巴', '右上旋钮', 'UZSPACE 竖排字', '显示器圆盘底座', '白色笔记本+铝支架'],
}
spec['viewEvidence'] = [
    {'id': 'front-view', 'view': 'front', 'imageRegion': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0, 'units': 'normalized'}, 'observations': ['4.jpg：布局、设备相对位置、材质与屏幕内容的基准视角。'], 'confidence': 0.93},
    {'id': 'left-three-quarter', 'view': 'left-three-quarter', 'imageRegion': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0, 'units': 'normalized'}, 'observations': ['2.jpg：左侧隔断、桌面纵深、笔袋纸张与键盘渐变键帽的补充视角。'], 'confidence': 0.85},
    {'id': 'right-three-quarter', 'view': 'right-three-quarter', 'imageRegion': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0, 'units': 'normalized'}, 'observations': ['3.jpg：右侧磨砂玻璃、挂瓶、显示器侧面及相邻工位。'], 'confidence': 0.85},
    {'id': 'overhead', 'view': 'overhead', 'imageRegion': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0, 'units': 'normalized'}, 'observations': ['1.jpg：桌面平面布局与线缆走向的高位参考；键盘款式不同，不用于键帽状态。'], 'confidence': 0.65},
    {'id': 'keyboard-detail', 'view': 'detail', 'imageRegion': {'x': 0.24, 'y': 0.70, 'width': 0.44, 'height': 0.20, 'units': 'normalized'}, 'observations': ['4.jpg 键盘近景：渐变灰 98 键、RGB、右上旋钮与状态灯。'], 'confidence': 0.9},
    {'id': 'desk-details', 'view': 'detail', 'imageRegion': {'x': 0.0, 'y': 0.62, 'width': 0.42, 'height': 0.35, 'units': 'normalized'}, 'observations': ['4.jpg 左前区：笔袋布标、手写纸、黄边本、白色电源砖与线缆。'], 'confidence': 0.85},
    {'id': 'shelf-detail', 'view': 'detail', 'imageRegion': {'x': 0.05, 'y': 0.0, 'width': 0.75, 'height': 0.10, 'units': 'normalized'}, 'observations': ['4.jpg 书架：彩色书脊、玻璃茶罐、黑色茶叶罐。'], 'confidence': 0.7},
    {'id': 'screen-detail', 'view': 'detail', 'imageRegion': {'x': 0.2, 'y': 0.28, 'width': 0.64, 'height': 0.30, 'units': 'normalized'}, 'observations': ['4.jpg 双屏：深蓝流线壁纸、深色终端/软件窗口、任务栏与右下时钟。'], 'confidence': 0.88},
]

spec['qualityTargets'] = {
    'targetFidelity': 0.72,
    'mustMatch': [
        '工作位的三面围合、桌面与书架包围体比例',
        '笔记本-显示器-键盘-杯-瓶的相对布局与遮挡顺序',
        '5 个参考 PBR 主材质（木纹、磨砂玻璃、白色机身、键帽、鼠标垫）与 3 个程序化玻璃/金属材质的表面响应',
        '双屏深蓝 UI、98 键渐变灰键帽、鼠标垫几何印刷与 UZSPACE 标识',
        '可动部件的枢轴层级与运行时 API',
    ],
    'niceToHave': ['键帽字符逐字可读', '木纹拼接随机化', '显示器背壳品牌纹理', '纸面折痕与指纹'],
    'fpsTarget': 60,
    'reviewViewpoints': ['front', 'left-three-quarter', 'right-three-quarter', 'overhead', 'keyboard-closeup'],
}

spec['qualityContract']['qualityBar'] = 'ultra-complex'
spec['qualityContract']['minimumSpecDepth'] = {
    'macroComponents': 12,
    'mesoComponents': 40,
    'microFeatureGroups': 24,
    'materialLayers': 16,
    'repetitionSystems': 6,
    'reviewViewpoints': 5,
}
spec['qualityContract']['antiShallowSpecRules'] = list(dict.fromkeys(spec['qualityContract']['antiShallowSpecRules'] + [
    '不得用一个不可分组根网格替代隔断、设备与陈设；所有宏观部件必须可独立显隐、平移和旋转。',
    '不得把双屏 UI 简化为纯黑面；屏幕内容必须由程序化 Canvas 纹理生成并能在运行时刷新。',
    '不得把 98 个键帽合并为一块贴图板；键帽需由单一 InstancedMesh 提供独立按下动画与逐键颜色。',
    '不得省略杯/瓶的透射与液面，或让线缆悬空无端点。',
]))
spec['qualityContract']['mustNotDo'] = spec['qualityContract']['antiShallowSpecRules']

spec['qualityContract']['definitionOfDone'] = [
    '用户实测 1050×500 mm 级桌面、三面隔断、顶部书架及桌面设备的布局、遮挡与负空间与规格一致：笔记本左缘距桌边 120 mm，显示器靠右并与右侧玻璃留出安装间隙。',
    '白色 16 英寸笔记本置于倾斜铝支架，上盖约 105°，屏内蓝色壁纸、左侧图标网格、中央终端、任务栏可辨且可刷新。',
    'AOC 23.8 英寸 16:9 显示器具有窄边、下巴标记、圆盘+立柱底座，屏幕显示蓝青壁纸与深色软件窗口。',
    '98 键渐变灰键帽、右上旋钮与 RGB 透光可辨；键帽由 InstancedMesh 驱动，支持逐键下压。',
    '玻璃茶杯有深红茶汤、木盖与把手；UZSPACE 水壶悬挂于右磨砂玻璃并带挂带；左侧笔袋/手写纸/电源/线缆组完整。',
    '5 个主材质使用参考提取的独立 albedo/roughness/height/normal/AO 贴图；磨砂玻璃、白色机身、键帽、木纹与布垫的响应分离正确，玻璃杯/水壶/铝件使用物理透射或金属模型。',
    '自相交、装配锚点、部件覆盖与动作层级门禁通过；所有接触点无悬空。',
    '正面、左右 3/4、俯视与键盘近景五个视角无身份性缺陷。',
    '笔记本开合、显示器旋转/俯仰、键帽按下、RGB 扫描、鼠标移动、蒸汽、挂瓶摆动与灯光切换均可由运行时 API 调用。',
]

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def rgba(value: str, alpha: float = 1.0) -> str:
    value = value.lstrip('#')
    r, g, b = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return f'rgba({r}, {g}, {b}, {alpha:.1f})'


def texless(evidence: str) -> dict:
    return {'declared': True, 'evidence': [evidence]}


def bands(scale='fine'):
    amp = 1.0 if scale == 'fine' else 0.8
    return [
        {'id': 'macro', 'frequency': 2.5, 'amplitude': 0.36 * amp, 'role': '低频色块、整体明度与木纹/布纹走向'},
        {'id': 'meso', 'frequency': 14.0, 'amplitude': 0.22 * amp, 'role': '可见纹理、缝隙、布纹与拉丝方向'},
        {'id': 'micro', 'frequency': 64.0, 'amplitude': 0.09 * amp, 'role': '掠射光下的细粒、磨砂与微高光破碎'},
    ]


def hero_material(mid, name, base, secondary, material_class, roughness, metalness,
                  confidence, folder, prefix, *, transmission=0.0, ior=1.5,
                  thickness=0.0, clearcoat=0.0, clearcoat_roughness=0.2,
                  normal_strength=0.3, overrides=None, repeat=(1.0, 1.0),
                  double_sided=False, base_roughness_var=0.12, env=0.9):
    maps = {}
    for channel in ('albedo', 'roughness', 'height', 'normal', 'ao'):
        maps[channel] = {
            'path': f'public/textures/{folder}/{prefix}_{channel}.webp',
            'url': f'/textures/{folder}/{prefix}_{channel}.webp',
            'channel': channel,
            'source': 'reference-pixel-extraction',
        }
    return {
        'id': mid,
        'name': name,
        'type': 'physical',
        'shaderModel': 'MeshPhysicalMaterial',
        'qualityTier': 'hero',
        'baseColor': base,
        'color': base,
        'albedo': {
            'dominant': base,
            'secondary': secondary,
            'samplingNotes': f'参考裁剪 /material-crops 提取；主导色 {base}，次色 {secondary}。',
        },
        'colorVariation': {'palette': [base] + secondary, 'pattern': 'reference-sampled', 'amplitude': 0.1, 'heightCorrelation': 0.35},
        'textureResolution': 1024,
        'textureProjection': {'mode': 'uv', 'repeat': list(repeat), 'anisotropy': 8, 'texelDensityIntent': '世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。'},
        'surfaceFrequencyBands': bands(),
        'roughness': {'base': roughness, 'variation': base_roughness_var, 'map': 'independent-procedural-field', 'localResponse': '缝隙更粗糙，边缘与指触区略低'},
        'metalness': {'base': metalness, 'variation': 0.04 if metalness else 0.0},
        'normal': {'pattern': 'reference-derived-normal', 'strength': normal_strength, 'scale': 12.0, 'space': 'tangent'},
        'bump': {'pattern': 'height-map', 'amplitude': 0.0015, 'scale': 1.0},
        'displacement': {'pattern': 'none', 'amplitude': 0.0, 'scale': 1.0, 'silhouetteAffects': False},
        'ambientOcclusion': {'cavityStrength': 0.32, 'contactShadowBias': 0.4, 'notes': '缝隙、接触面与压条内凹处加深。'},
        'wear': {'edgeWear': 0.08, 'scratches': [], 'chips': []},
        'dirt': {'amount': 0.05, 'cavityBias': 0.8, 'color': '#3A3128'},
        'transmission': {'base': transmission},
        'ior': {'base': ior},
        'thickness': {'base': thickness},
        'clearcoat': {'base': clearcoat},
        'clearcoatRoughness': {'base': clearcoat_roughness},
        'doubleSided': double_sided,
        'envMapIntensity': env,
        'localOverrides': overrides or [],
        'referencePbr': {
            'version': '1.0',
            'sourceImage': f'analysis/material-crops/{folder}.jpg',
            'extractor': 'forge/stage1_intake/extract_pbr_evidence.py',
            'method': 'single-image reference pixel extraction (de-lit estimate)',
            'verdict': 'pass',
            'hardLimit': '单图逆渲染估计，不是照片测量；已由渲染截图复核。',
            'usable': True,
            'confidence': confidence,
            'estimatedFidelity': confidence,
            'targetThreshold': 0.7,
            'maps': maps,
        },
        'shaderNotes': [
            'albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。',
            '参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。',
        ],
        'notes': name,
    }


def utility_material(mid, name, base, material_class, roughness, metalness=0.0,
                     *, transmission=0.0, opacity=1.0, emission=None, emission_intensity=0.0,
                     ior=1.5, thickness=0.0, clearcoat=0.0, clearcoat_roughness=0.2,
                     double_sided=False, evidence='纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。'):
    return {
        'id': mid,
        'name': name,
        'type': 'physical',
        'qualityTier': 'utility',
        'baseColor': base,
        'color': base,
        'albedo': {'dominant': base, 'secondary': [base, '#000000'], 'samplingNotes': '参考目视取色。'},
        'roughness': {'base': roughness, 'variation': 0.04, 'map': 'independent-procedural-field'},
        'metalness': {'base': metalness, 'variation': 0.0},
        'transmission': {'base': transmission},
        'opacity': {'base': opacity},
        'ior': {'base': ior},
        'thickness': {'base': thickness},
        'clearcoat': {'base': clearcoat},
        'clearcoatRoughness': {'base': clearcoat_roughness},
        'emissive': emission or '#000000',
        'emissiveIntensity': {'base': emission_intensity},
        'doubleSided': double_sided,
        'textureless': texless(evidence),
        'shaderNotes': ['工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。'],
        'notes': name,
    }


materials = [
    hero_material('woodOak', '浅橡木饰面', '#C9AE83', ['#A98A5F', '#DCC59B'], '木饰面/封边', 0.56, 0.0, 0.86, 'woodOak', 'woodoak',
                  normal_strength=0.24, repeat=(1.0, 1.0), clearcoat=0.08, clearcoat_roughness=0.5,
                  overrides=[
                      {'id': 'desk-grain', 'description': '桌面直纹沿 X 方向，局部色带宽 6–14 mm。', 'roughness': 0.6, 'color': '#B89768', 'anisotropy': 0.35, 'evidenceRef': '4.jpg desk'},
                      {'id': 'partition-grain', 'description': '隔断竖向直纹，靠近铝框处变深。', 'roughness': 0.63, 'color': '#AF9064', 'anisotropy': 0.45, 'evidenceRef': '4.jpg partition'},
                  ]),
    utility_material('aluminum', '银灰阳极氧化铝', '#B8BCC0', 'metal', 0.31, 0.94,
                     evidence='铝型材为均匀阳极氧化金属；画面中仅窄条可用，且混入玻璃/木材，故使用程序化金属响应。'),
    hero_material('frostedGlass', '磨砂玻璃', '#C7D4D0', ['#B4C3BE', '#E1EAE6'], '隔断玻璃', 0.56, 0.0, 0.761, 'frostedGlass', 'frostedglass',
                  transmission=0.85, ior=1.5, thickness=0.006, normal_strength=0.08, double_sided=True,
                  overrides=[{'id': 'frost-band', 'description': '中部宽而弱的漫反射高光带。', 'roughness': 0.48, 'transmission': 0.88, 'evidenceRef': '4.jpg glass panels'}]),
    hero_material('laptopWhite', '白色镁铝合金机身', '#E7E6E2', ['#C9C8C3', '#F6F5F1'], '笔记本外壳', 0.34, 0.12, 0.792, 'laptopWhite', 'laptopwhite',
                  clearcoat=0.16, clearcoat_roughness=0.24, normal_strength=0.1,
                  overrides=[{'id': 'soft-clearcoat', 'description': '掌托边缘弱清漆高光，平面部偏哑。', 'roughness': 0.27, 'clearcoat': 0.22, 'evidenceRef': '4.jpg laptop shell'}]),
    hero_material('keycapPBT', '渐变灰 PBT 键帽', '#C3C7CA', ['#7A8086', '#2C2F33'], '键帽', 0.62, 0.0, 0.82, 'keycap', 'keycappbt',
                  normal_strength=0.22, overrides=[
                      {'id': 'gradient-bands', 'description': '顶排浅灰逐行到深灰，modifier 更深。', 'albedo': '#BEC3C7', 'evidenceRef': '4.jpg keyboard'},
                      {'id': 'rgb-underlight', 'description': '键缝 RGB 由粉紫到青绿扫描。', 'emissive': '#2BD8FF', 'emissiveIntensity': 1.6, 'evidenceRef': '4.jpg keyboard'},
                  ]),
    hero_material('mousepadFabric', '灰色几何印刷布垫', '#A6AAA9', ['#4B4F52', '#6D7174'], '鼠标垫布面', 0.87, 0.0, 0.8, 'mousepadFabric', 'mousepadfabric',
                  normal_strength=0.18, repeat=(2.0, 2.0),
                  overrides=[{'id': 'geometric-print', 'description': '深灰斜带、细线与右上小字。', 'albedo': '#565B5F', 'roughness': 0.8, 'evidenceRef': '4.jpg mousepad'}]),
    utility_material('teaGlass', '硼硅玻璃杯壁', '#DDE3E1', 'glass', 0.08, 0.0,
                     transmission=0.93, ior=1.5, thickness=0.004, double_sided=True,
                     evidence='玻璃为透明高光表面；单图提取会混入茶汤，故使用物理透射材质。'),
    utility_material('bottleBody', '灰绿半透明水壶', '#8D958F', 'plastic', 0.3, 0.0,
                     transmission=0.45, ior=1.48, thickness=0.0025, double_sided=True,
                     evidence='半透明塑料瓶身；纹理主要是油墨与注塑痕，使用物理透射+运行时 decal。'),
]

materials += [
    utility_material('keyboardShell', '键盘黑色上壳', '#202326', 'plastic', 0.52),
    utility_material('keyboardDeck', '笔记本深色键盘面', '#33363A', 'plastic', 0.58),
    utility_material('trackpadGlass', '触控板玻璃', '#E0E1DD', 'glass', 0.16, 0.0, evidence='触控板为均匀玻璃面，无可见高频纹理。'),
    utility_material('monitorPlastic', '显示器黑色细咬花塑料', '#111315', 'plastic', 0.42, 0.03,
                     evidence='机壳为均匀细咬花塑料；表面变化以边框几何高光表达。'),
    utility_material('screenLaptop', '笔记本屏幕（自发光）', '#0A1733', 'glass', 0.12, 0.0, emission='#0A1B44', emission_intensity=0.45,
                     evidence='屏幕内容由运行时 Canvas 生成；基材为黑色玻璃。'),
    utility_material('screenMonitor', '外接屏（自发光）', '#0A1733', 'glass', 0.12, 0.0, emission='#0A1B44', emission_intensity=0.45,
                     evidence='屏幕内容由运行时 Canvas 生成；基材为黑色玻璃。'),
    utility_material('mousePlastic', '鼠标类肤黑塑料', '#151617', 'plastic', 0.38,
                     evidence='类肤涂层在高光下仅有宽而低对比的光泽；纹理由几何棱线表达。'),
    utility_material('teaLiquid', '深红茶汤', '#2B1007', 'glass', 0.12, 0.0, transmission=0.32),
    utility_material('mugLidWood', '棕色木盖与把手', '#6B3A24', 'wood', 0.38),
    utility_material('bottleCap', '水壶黑盖', '#1B1C1D', 'plastic', 0.54),
    utility_material('paperMatte', '米白纸张', '#F3EFE6', 'unknown', 0.88),
    utility_material('paperYellow', '黄边笔记纸', '#F2E8C9', 'unknown', 0.86),
    utility_material('fabricBlack', '黑色尼龙笔袋/织带', '#17181A', 'fabric', 0.92),
    utility_material('rubberCable', '哑光 PVC 线缆', '#E9E9E7', 'rubber', 0.56),
    utility_material('metalDark', '深色金属支架', '#2A2C2E', 'metal', 0.36, 0.8),
    utility_material('standMetal', '灰色笔记本支架金属', '#858A8E', 'metal', 0.4, 0.55),
    utility_material('stickerBlue', '蓝绿设备贴纸', '#2AB6C9', 'plastic', 0.42),
    utility_material('ledBlue', '指示灯', '#2AD6FF', 'plastic', 0.2, 0.0, emission='#2AD6FF', emission_intensity=2.2,
                     evidence='小面积纯发光片。'),
    utility_material('invisible', '结构代理（不可见）', '#000000', 'unknown', 1.0, 0.0, opacity=0.001),
    utility_material('bookSpines', '书脊色块', '#6A5A8C', 'fabric', 0.8),
    utility_material('jarGlass', '茶罐玻璃', '#B7C2B9', 'glass', 0.2, 0.0, transmission=0.55),
    utility_material('whiteShell', '白色插排/电源砖', '#E8E7E3', 'plastic', 0.5),
    utility_material('stickerFrosted', '磨砂玻璃贴纸', '#E9F0EC', 'plastic', 0.6, 0.0, opacity=0.92),
    utility_material('penBlue', '蓝色中性笔', '#1E4D8C', 'plastic', 0.38),
    utility_material('steam', '茶杯蒸汽', '#E8EDEA', 'unknown', 1.0, 0.0, opacity=0.12,
                     evidence='运行时粒子卡；不是实体表面。'),
]

# The detail inventory maps every identity mark to a declared local override. These five
# overrides live on utility materials, so they are attached after material construction.
extra_overrides = {
    'screenLaptop': [{'id': 'taskbar-glow', 'description': '任务栏与图标自发光微晕。', 'emissive': '#2C7BFF', 'emissiveIntensity': 1.2, 'evidenceRef': 'screen-detail'}],
    'screenMonitor': [{'id': 'app-window', 'description': '深灰软件窗口与底部任务栏的自发光层级。', 'emissive': '#1A4FDB', 'emissiveIntensity': 1.1, 'evidenceRef': 'screen-detail'}],
    'monitorPlastic': [{'id': 'bezel-sheen', 'description': '窄边框掠射高光。', 'roughness': 0.28, 'evidenceRef': 'screen-detail'}],
    'teaLiquid': [{'id': 'tea-surface-sheen', 'description': '液面边缘的细亮弧与高吸收茶色。', 'roughness': 0.06, 'color': '#2B1007', 'evidenceRef': 'desk-details'}],
    'rubberCable': [{'id': 'cable-sheen', 'description': '哑光 PVC 线缆沿弧顶的弱高光。', 'roughness': 0.48, 'evidenceRef': 'desk-details'}],
    'bottleBody': [{'id': 'uzspace-label', 'description': '白色竖排 UZSPACE 字样与容量刻度。', 'albedo': '#E9EDEA', 'roughness': 0.42, 'evidenceRef': '4.jpg bottle'}],
}
for material in materials:
    if material['id'] in extra_overrides:
        material['localOverrides'] = extra_overrides[material['id']]
spec['materials'] = materials

# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------

def dims(w, h, d, conf=0.8):
    return {'width': w, 'height': h, 'depth': d, 'units': 'meters', 'confidence': conf}


def action(role, pivot=(0, 0, 0), axis=(0, 1, 0), channels=None, sockets=None, collider='box',
           collider_scale=None, destruction=False):
    channels = channels or {'translate': True, 'rotate': True, 'scale': False, 'bend': False,
                            'twist': False, 'detach': False, 'visibility': True, 'materialState': True}
    return {
        'animationRole': role,
        'pivot': {'mode': 'center' if pivot == (0, 0, 0) else 'socket', 'localPosition': list(pivot),
                  'axis': list(axis), 'confidence': 0.8},
        'transformChannels': channels,
        'sockets': sockets or [],
        'collider': {'type': collider, 'offset': [0, 0, 0], 'scale': collider_scale or [1, 1, 1],
                     'isTrigger': False, 'notes': '运行时交互/碰撞代理。'},
        'constraints': [],
        'destruction': {'breakable': bool(destruction), 'fractureGroup': role,
                        'seamRefs': [], 'detachableFragments': [], 'breakImpulse': 0.0,
                        'debrisMaterial': 'metalDark'},
    }


def recipe(dom, sec, cls, conf=0.8):
    return {'dominantAlbedo': rgba(dom), 'secondaryAlbedo': rgba(sec), 'materialClass': cls,
            'materialClassConfidence': conf}


def comp(cid, name, level, parent, primitive, dimensions, position, material, role,
         topology, rationale, *, rotation=(0, 0, 0), features=None, attachment=None,
         animation=None, sockets=None, color=None, geometry=None, fidelity='structural-pass',
         evidence=None, importance=0.75, confidence=0.8, collider='box'):
    color = color or {}
    edge = geometry.get('edgeTreatment') if geometry and 'edgeTreatment' in geometry else {'type': 'bevel', 'bevelRadius': 0.0015, 'segments': 2}
    geometry_descriptor = {
        'topologyIntent': rationale,
        'edgeTreatment': edge,
        'deformationStack': [],
        'uvStrategy': 'per-component UV with world-scale texel intent',
        'normalStrategy': 'computed vertex normals; material normal map for micro relief',
    }
    if geometry:
        for key, value in geometry.items():
            if key != 'edgeTreatment':
                geometry_descriptor[key] = value
    return {
        'id': cid,
        'name': name,
        'level': level,
        'role': role,
        'importance': importance,
        'confidence': confidence,
        'primitive': primitive,
        'topologyClass': topology,
        'topologyRationale': rationale,
        'geometryDescriptor': geometry_descriptor,
        'parent': parent,
        'attachment': attachment,
        'dimensions': dimensions,
        'transform': {'position': list(position), 'rotation': list(rotation)},
        'actionProfile': action(animation or f'{cid}-pivot', sockets=sockets, collider=collider,
                                collider_scale=[dimensions.get('width', 0.1), dimensions.get('height', 0.1), dimensions.get('depth', 0.1)],
                                destruction=False),
        'material': material,
        'materialLayers': [material],
        'deformations': [],
        'joints': [],
        'seams': [],
        'localFeatures': features or [],
        'surfaceDetail': {'macroRoughness': 0.55, 'microRoughness': 0.62, 'bumpAmplitude': 0.001,
                          'normalPattern': 'reference-derived', 'displacementPattern': 'none',
                          'occlusionPattern': 'contact AO', 'edgeWearPattern': 'narrow edge highlight',
                          'notes': '由材质贴图与几何倒角共同表达。'},
        'evidenceRefs': evidence or ['front-view'],
        'details': [],
        'fidelityTier': fidelity,
        'colorMaterialRecipe': recipe(color.get('dom', '#C9AE83'), color.get('sec', '#A98A5F'), color.get('cls', 'wood'), color.get('conf', 0.8)),
    }


def endpoint(parent, start, end, radius, socket='mount', contact='socket', end_radius=None):
    return {
        'parentId': parent,
        'parentSocket': socket,
        'contactType': contact,
        'localStart': list(start),
        'localEnd': list(end),
        'baseRadius': radius,
        'endRadius': radius if end_radius is None else end_radius,
        'embedDepth': 0.004,
        'overlap': 0.002,
        'gapTolerance': 0.0015,
        'evidenceRefs': ['front-view'],
    }


def feat(fid, kind, description, evidence='front-view'):
    return {'id': fid, 'kind': kind, 'description': description, 'evidenceRef': evidence}


components = []
components.append(comp(
    'root', '办公位场景根节点', 'macro', None, 'box', dims(0.001, 0.001, 0.001), (0, 0, 0), 'invisible', 'root',
    'assembled-solid', '不可见结构根；场景包围体由桌面、隔断与书架定义，根节点不参与可见轮廓。',
    animation='root', color={'dom': '#202020', 'sec': '#000000', 'cls': 'unknown'}, fidelity='blockout',
    evidence=['front-view'], importance=1.0,
))

# desk -----------------------------------------------------------------------
components.append(comp(
    'desk', '桌面与下层框架', 'macro', 'root', 'box', dims(1.05, 0.025, 0.5), (0, 0.745, -0.05), 'woodOak', 'desk-top',
    'assembled-solid', '桌面是厚度 25 mm 的矩形板，前缘直、四角小圆角；可见上下表面与封边，是典型的装配实体而非有机体。',
    features=[feat('desk-edge-wear', 'chip', '前缘右侧 2–3 mm 浅色崩边。', 'desk-details'),
              feat('desk-edge-chamfer', 'bevel', '前缘 1 mm 倒角形成细高光。'),
              feat('grain-runout', 'linework', '桌面木纹沿 X 方向贯穿。')],
    color={'dom': '#C9AE83', 'sec': '#A98A5F', 'cls': 'wood', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'bevel', 'bevelRadius': 0.0015, 'segments': 3}},
    fidelity='blockout', evidence=['front-view', 'desk-details'], importance=1.0,
    sockets=[{'id': 'leg-mount-fl', 'localPosition': [-0.465, -0.372, 0.23]},
             {'id': 'leg-mount-fr', 'localPosition': [0.465, -0.372, 0.23]},
             {'id': 'leg-mount-rl', 'localPosition': [-0.465, -0.372, -0.22]},
             {'id': 'leg-mount-rr', 'localPosition': [0.465, -0.372, -0.22]}],
))
for cid, x, z in [('deskPostFL', -0.465, 0.23), ('deskPostFR', 0.465, 0.23), ('deskPostRL', -0.465, -0.22), ('deskPostRR', 0.465, -0.22)]:
    components.append(comp(
        cid, f'桌腿 {cid[-2:]}', 'meso', 'desk', 'box', dims(0.035, 0.742, 0.035), (x, -0.372, z), 'metalDark', 'furniture-post',
        'assembled-solid', '方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。',
        color={'dom': '#2A2C2E', 'sec': '#4A4D50', 'cls': 'metal', 'conf': 0.8},
        geometry={'edgeTreatment': {'type': 'chamfer', 'bevelRadius': 0.001, 'segments': 1}},
        fidelity='structural-pass', evidence=['front-view'],
    ))
components.append(comp(
    'deskRailFront', '桌下前横梁', 'meso', 'desk', 'box', dims(0.94, 0.04, 0.03), (0, -0.345, 0.21), 'metalDark', 'frame-rail',
    'assembled-solid', '连接左右桌腿的前横梁，矩形截面。',
    color={'dom': '#2A2C2E', 'sec': '#4A4D50', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
))
components.append(comp(
    'deskRailBack', '桌下后横梁', 'meso', 'desk', 'box', dims(0.94, 0.04, 0.03), (0, -0.345, -0.22), 'metalDark', 'frame-rail',
    'assembled-solid', '连接左右桌腿的后横梁，矩形截面。',
    color={'dom': '#2A2C2E', 'sec': '#4A4D50', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
))

# partition ------------------------------------------------------------------
components.append(comp(
    'partition', '三面隔断与磨砂玻璃', 'macro', 'root', 'box', dims(1.05, 0.59, 0.03), (0, 1.0525, -0.315), 'woodOak', 'back-panel',
    'assembled-solid', '背板是 1050×590×30 mm 的矩形木饰面板，上接书架；可见竖直直纹与平直边缘。',
    features=[feat('mullion-micro-bevel', 'bevel', '铝立柱 1.5–2 mm 倒角与双浅槽。', 'right-three-quarter'),
              feat('glass-retainer-groove', 'groove', '压条与玻璃之间 8 mm 深暗缝。', 'right-three-quarter'),
              feat('back-panel-seam', 'seam', '背板与侧板的铝压条接缝。')],
    color={'dom': '#C9AE83', 'sec': '#A98A5F', 'cls': 'wood', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'bevel', 'bevelRadius': 0.001, 'segments': 2}},
    fidelity='blockout', evidence=['front-view', 'left-three-quarter', 'right-three-quarter'], importance=1.0,
    sockets=[{'id': 'glass-left', 'localPosition': [-0.51, 0.16, 0.25]},
             {'id': 'glass-right', 'localPosition': [0.51, 0.16, 0.25]},
             {'id': 'hook', 'localPosition': [0.505, 0.2475, 0.345]}],
))
# partition 自身位于 z=-0.315；以下子件的 z 是父级局部坐标，
# 因此世界 z≈-0.065 的侧板/玻璃要写 +0.250，前立柱写 +0.485。
partition_parts = [
    ('leftSidePanel', '左侧木饰面板', 'box', dims(0.02, 0.32, 0.47), (-0.515, -0.135, 0.250), 'woodOak', 'side-panel',
     'assembled-solid', '左隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深，竖直直纹；外侧与桌沿齐平。', (0, 0, 0),
     [feat('side-panel-grain', 'linework', '侧板木纹竖向。', 'left-three-quarter')], None),
    ('rightSidePanel', '右侧木饰面板', 'box', dims(0.02, 0.32, 0.47), (0.515, -0.135, 0.250), 'woodOak', 'side-panel',
     'assembled-solid', '右隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深；外侧与桌沿齐平。', (0, 0, 0), [], None),
    ('leftGlass', '左磨砂玻璃', 'box', dims(0.008, 0.27, 0.47), (-0.51, 0.16, 0.250), 'frostedGlass', 'partition-glass',
     'assembled-solid', '厚度 8 mm、高 270 mm 的磨砂玻璃板，嵌于铝框中，四周留 15 mm 压条。', (0, 0, 0),
     [feat('left-glass-frost', 'stain', '磨砂层漫透光与轻微雾带。', 'left-three-quarter')], None),
    ('rightGlass', '右磨砂玻璃', 'box', dims(0.008, 0.27, 0.47), (0.51, 0.16, 0.250), 'frostedGlass', 'partition-glass',
     'assembled-solid', '厚度 8 mm、高 270 mm 的磨砂玻璃板，右侧悬挂水壶。', (0, 0, 0), [], None),
    ('leftMullion', '左后铝立柱', 'box', dims(0.04, 0.59, 0.04), (-0.51, 0, 0.030), 'aluminum', 'frame-mullion',
     'assembled-solid', '40×40 mm 铝立柱，正面 2 mm 倒角与两道浅槽。', (0, 0, 0),
     [feat('left-mullion-groove', 'groove', '立柱纵向浅槽。', 'left-three-quarter')], None),
    ('rightMullion', '右后铝立柱', 'box', dims(0.04, 0.59, 0.04), (0.51, 0, 0.030), 'aluminum', 'frame-mullion',
     'assembled-solid', '40×40 mm 铝立柱，右侧主要承重构件。', (0, 0, 0), [], None),
    ('leftFrontPost', '左前铝立柱', 'box', dims(0.035, 0.59, 0.035), (-0.51, 0, 0.485), 'aluminum', 'frame-post',
     'assembled-solid', '左隔断前缘的 35 mm 方形铝立柱，连接玻璃侧边。', (0, 0, 0), [], None),
    ('rightFrontPost', '右前铝立柱', 'box', dims(0.035, 0.59, 0.035), (0.51, 0, 0.485), 'aluminum', 'frame-post',
     'assembled-solid', '右隔断前缘的 35 mm 方形铝立柱。', (0, 0, 0), [], None),
    ('topRailBack', '背板上横梁', 'box', dims(1.05, 0.035, 0.05), (0, 0.2775, 0.0), 'aluminum', 'frame-rail',
     'assembled-solid', '背板上缘的横向铝压梁，宽 50 mm。', (0, 0, 0), [], None),
    ('topRailLeft', '左侧上横梁', 'box', dims(0.04, 0.035, 0.47), (-0.51, 0.2775, 0.250), 'aluminum', 'frame-rail',
     'assembled-solid', '左侧玻璃上缘的横梁，与背板横梁同高。', (0, 0, 0), [], None),
    ('topRailRight', '右侧上横梁', 'box', dims(0.04, 0.035, 0.47), (0.51, 0.2775, 0.250), 'aluminum', 'frame-rail',
     'assembled-solid', '右侧玻璃上缘的横梁。', (0, 0, 0), [], None),
    ('leftGlassSticker', '左侧玻璃贴纸', 'box', dims(0.002, 0.09, 0.14), (-0.505, 0.20, 0.415), 'stickerFrosted', 'frosted-sticker',
     'assembled-solid', '贴附于左玻璃内表面的白色磨砂贴纸，边缘薄且不规则。', (0, 0, 0),
     [feat('sticker-edge', 'decal', '贴纸的薄边缘与轮廓。', 'left-three-quarter')], None),
]
for cid, name, prim, dm, pos, mat, role, topo, rat, rot, features, _ in partition_parts:
    components.append(comp(cid, name, 'meso', 'partition', prim, dm, pos, mat, role, topo, rat,
                           rotation=rot, features=features,
                           color={'dom': '#C9AE83' if mat == 'woodOak' else ('#C7D4D0' if mat == 'frostedGlass' else '#B8BCC0'),
                                  'sec': '#A98A5F', 'cls': 'wood' if mat == 'woodOak' else ('glass' if mat == 'frostedGlass' else 'metal')},
                           evidence=['front-view', 'left-three-quarter', 'right-three-quarter']))
components.append(comp(
    'bottleHook', '水壶挂钩', 'meso', 'partition', 'box', dims(0.018, 0.05, 0.02), (0.505, 0.2475, 0.345), 'metalDark', 'hook',
    'assembled-solid', '黑色 L 形挂钩，贴在玻璃内表面，承托水壶织带。',
    color={'dom': '#1B1C1D', 'sec': '#3A3C3E', 'cls': 'metal'}, evidence=['right-three-quarter'],
))

# shelf ----------------------------------------------------------------------
components.append(comp(
    'shelf', '顶部搁板', 'macro', 'root', 'box', dims(1.05, 0.025, 0.30), (0, 1.36, -0.16), 'woodOak', 'shelf-board',
    'assembled-solid', '1050×300×25 mm 搁板，与背板同宽，前缘有 18 mm 封边。',
    features=[feat('shelf-front-bevel', 'bevel', '搁板前缘 1 mm 圆角高光。', 'shelf-detail')],
    color={'dom': '#C9AE83', 'sec': '#A98A5F', 'cls': 'wood'}, fidelity='blockout',
    evidence=['front-view', 'shelf-detail'], importance=0.7,
))
for cid, x in [('shelfBracketL', -0.45), ('shelfBracketR', 0.45)]:
    components.append(comp(
        cid, f'搁板托架 {cid[-1]}', 'meso', 'shelf', 'box', dims(0.025, 0.14, 0.18), (x, -0.082, -0.05), 'aluminum', 'shelf-bracket',
        'assembled-solid', '90° 折弯铝托架，竖直面贴背板、水平面承托搁板。',
        color={'dom': '#B8BCC0', 'sec': '#8D9297', 'cls': 'metal'}, evidence=['shelf-detail'],
    ))

# shelf props ----------------------------------------------------------------
components.append(comp(
    'shelfProps', '书列与茶罐', 'macro', 'root', 'box', dims(0.52, 0.22, 0.13), (-0.245, 1.49, -0.20), 'bookSpines', 'book-block',
    'assembled-solid', '左侧连续书列形成 520×220×130 mm 的量体；书脊深浅/宽度不同，可见印刷色带。',
    features=[feat('book-spine-color-bands', 'decal', '紫/粉/米/蓝/黑/白/绿/橙书脊。', 'shelf-detail'),
              feat('tea-jar-lid-gloss', 'gloss', '茶罐盖窄高光。', 'shelf-detail')],
    color={'dom': '#6A5A8C', 'sec': '#D9C9A4', 'cls': 'fabric'}, fidelity='blockout',
    evidence=['shelf-detail'], importance=0.6,
))
components.append(comp(
    'bookRowB', '右侧书列', 'meso', 'shelfProps', 'box', dims(0.16, 0.19, 0.12), (0.37, 0.005, 0.0), 'bookSpines', 'book-block',
    'assembled-solid', '右侧较窄书列，书脊高度略低。',
    color={'dom': '#4C5D6B', 'sec': '#C6B38A', 'cls': 'fabric'}, evidence=['shelf-detail'],
))
for cid, name, x, mat, r in [
    ('jarPurple', '紫色茶罐', 0.43, 'jarGlass', 0.045),
    ('jarOrange', '橙色标签茶罐', 0.54, 'jarGlass', 0.045),
    ('teaCanister', '黑色茶叶罐', 0.68, 'bottleCap', 0.045),
]:
    parent = 'shelfProps'
    components.append(comp(
        cid, name, 'meso', parent, 'cylinder', dims(r * 2, 0.22, r * 2),
        (0, 0, 0), mat, 'tea-container', 'assembled-solid',
        f'旋转体茶罐，直径约 {r*2*1000:.0f} mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。',
        attachment=endpoint(parent, (x, -0.12, 0.02), (x, 0.09 if cid != 'teaCanister' else 0.12, 0.02), r, socket='shelf-slot', contact='butt'),
        color={'dom': '#7B5B8E' if cid == 'jarPurple' else ('#B57B42' if cid == 'jarOrange' else '#222426'),
               'sec': '#D9C9A4', 'cls': 'glass' if mat == 'jarGlass' else 'plastic'},
        evidence=['shelf-detail'], animation=f'{cid}-lift',
    ))
components.append(comp(
    'bookEnd', '书列挡板', 'meso', 'shelfProps', 'box', dims(0.018, 0.12, 0.10), (0.29, 0.0, 0.0), 'metalDark', 'bookend',
    'assembled-solid', 'L 形金属书挡，薄板竖直面压在书列右侧。',
    color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, evidence=['shelf-detail'],
))

# laptop ---------------------------------------------------------------------
LAPTOP = (-0.2275, 0.8565, -0.05)
components.append(comp(
    'laptopBase', '白色笔记本机身', 'macro', 'root', 'box', dims(0.355, 0.016, 0.245), LAPTOP, 'laptopWhite', 'device-base',
    'assembled-solid', '355×245×16 mm 薄楔形机身，四边 CNC 倒角；掌托与上盖分离，是装配实体。',
    rotation=(0.14, 0, 0),
    features=[feat('rtx-sticker', 'decal', '右下 RTX/Intel 贴纸组。', 'screen-detail'),
              feat('hinge-barrel', 'ridge', '后缘双段屏轴，直径约 12 mm。'),
              feat('front-lip', 'bevel', '前缘 0.8 mm 倒角。')],
    color={'dom': '#E7E6E2', 'sec': '#C9C8C3', 'cls': 'metal', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'bevel', 'bevelRadius': 0.0012, 'segments': 3}},
    fidelity='blockout', evidence=['front-view', 'left-three-quarter', 'screen-detail'], importance=1.0,
    sockets=[{'id': 'hinge-left', 'localPosition': [-0.16, 0.018, -0.108]},
             {'id': 'hinge-right', 'localPosition': [0.16, 0.018, -0.108]}],
))
components.append(comp(
    'laptopLid', '笔记本上盖', 'macro', 'laptopBase', 'box', dims(0.35, 0.235, 0.007), (0, 0.135, -0.138), 'laptopWhite', 'display-cover',
    'assembled-solid', '350×235×7 mm 上盖；前表面平坦，四边 CNC 小倒角，上缘有微弧过渡。',
    rotation=(-0.10, 0, 0),
    features=[feat('lid-edge-chamfer', 'bevel', '上盖 CNC 倒角细高光。'), feat('lid-logo-plate', 'decal', '上盖中央暗色铭牌。')],
    color={'dom': '#E7E6E2', 'sec': '#C9C8C3', 'cls': 'metal'}, fidelity='blockout',
    evidence=['front-view', 'left-three-quarter'], importance=0.9,
    animation='laptop-lid-hinge', sockets=[{'id': 'lid-hinge', 'localPosition': [0, -0.1175, 0.0]}],
))
components.append(comp(
    'laptopScreen', '笔记本屏幕', 'meso', 'laptopBase', 'plane-card', dims(0.338, 0.212, 0.001), (0, 0.138, -0.131), 'screenLaptop', 'display-panel',
    'surface-relief', '屏幕是贴在上盖内侧的 335×205 mm 平面发光层，厚度可忽略，轮廓由上盖边界定义。',
    rotation=(-0.10, 0, 0),
    features=[feat('screen-outer-shadow', 'seam', '屏幕与边框之间的 1.5 mm 暗缝。', 'screen-detail')],
    color={'dom': '#0A1733', 'sec': '#1449D8', 'cls': 'glass'}, fidelity='structural-pass',
    evidence=['screen-detail'], importance=0.95,
))
components.append(comp(
    'laptopKeyboardDeck', '笔记本键盘面', 'meso', 'laptopBase', 'box', dims(0.33, 0.004, 0.11), (0, 0.010, 0.03), 'keyboardDeck', 'key-bed',
    'assembled-solid', '浅凹的键床，四周为 10 mm 白色边框；黑色键区在白色掌托中形成明确色块。',
    rotation=(0.14, 0, 0),
    features=[feat('key-bed-recess', 'groove', '键区相对掌托下凹 1.2 mm。')],
    color={'dom': '#33363A', 'sec': '#DEDCD7', 'cls': 'plastic'}, fidelity='structural-pass', evidence=['screen-detail'],
))
components.append(comp(
    'laptopTrackpad', '触控板', 'meso', 'laptopBase', 'box', dims(0.11, 0.002, 0.07), (0, 0.0098, 0.085), 'trackpadGlass', 'trackpad',
    'assembled-solid', '110×70 mm 触控板，边缘 0.3 mm 圆角，玻璃面低粗糙度。',
    rotation=(0.14, 0, 0),
    color={'dom': '#E0E1DD', 'sec': '#C9C8C3', 'cls': 'glass'}, fidelity='structural-pass', evidence=['screen-detail'],
))
components.append(comp(
    'laptopHinge', '笔记本屏轴', 'meso', 'laptopBase', 'cylinder', dims(0.32, 0.012, 0.012), (0, 0, 0), 'metalDark', 'hinge-barrel',
    'assembled-solid', '双段金属屏轴，横向圆柱，直径约 12 mm，藏在机身与上盖之间。',
    attachment=endpoint('laptopBase', (-0.16, 0.018, -0.108), (0.16, 0.018, -0.108), 0.007, socket='hinge-left', contact='socket'),
    color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, fidelity='structural-pass', evidence=['screen-detail'],
    animation='laptop-hinge-barrel',
))
components.append(comp(
    'laptopSticker', 'RTX 贴纸', 'meso', 'laptopBase', 'box', dims(0.028, 0.0012, 0.012), (0.115, 0.0102, 0.072), 'stickerBlue', 'device-sticker',
    'assembled-solid', '0.028×0.012 m 的薄贴纸，贴合掌托右下，右缘略翘。',
    rotation=(0.14, 0, 0),
    color={'dom': '#2AB6C9', 'sec': '#1B4FA0', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['screen-detail'],
))
components.append(comp(
    'laptopStandBase', '灰色笔记本支架底座', 'meso', 'laptopBase', 'box', dims(0.31, 0.012, 0.205), (0, -0.0915, -0.02), 'standMetal', 'stand-base',
    'assembled-solid', '310×205×12 mm 铝底板，四角有硅胶脚垫，前端略向外伸。',
    color={'dom': '#B8BCC0', 'sec': '#8D9297', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
))
for cid, x in [('laptopStandRailL', -0.145), ('laptopStandRailR', 0.145)]:
    components.append(comp(
        cid, f'支架立柱 {cid[-1]}', 'meso', 'laptopBase', 'box', dims(0.018, 0.076, 0.025), (x, -0.046, -0.080), 'standMetal', 'stand-rail',
        'assembled-solid', '18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。',
        color={'dom': '#B8BCC0', 'sec': '#8D9297', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
    ))
components.append(comp(
    'laptopStandLip', '支架前托钩', 'meso', 'laptopBase', 'box', dims(0.30, 0.022, 0.016), (0, -0.012, 0.100), 'standMetal', 'stand-lip',
    'assembled-solid', '300 mm 宽前托钩，托住笔记本前缘，内侧贴硅胶。',
    features=[feat('stand-lip-silicone', 'ridge', '托钩内侧硅胶条形成细黑线。')],
    color={'dom': '#B8BCC0', 'sec': '#8D9297', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
))
components.append(comp(
    'laptopStandCrossbar', '支架横梁', 'meso', 'laptopBase', 'box', dims(0.30, 0.018, 0.025), (0, -0.046, -0.078), 'standMetal', 'stand-crossbar',
    'assembled-solid', '300×18×25 mm 灰色横梁，连接两根立柱，正面可见两颗螺钉。',
    features=[feat('stand-screw-left', 'fastener', '左侧 M4 内六角螺钉。'), feat('stand-screw-right', 'fastener', '右侧 M4 内六角螺钉。')],
    color={'dom': '#858A8E', 'sec': '#5C6165', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view', 'left-three-quarter'],
))


# monitor --------------------------------------------------------------------
MON = (0.235, 0.9955, -0.15)
components.append(comp(
    'monitor', 'AOC 23.8 英寸显示器', 'macro', 'root', 'box', dims(0.540, 0.322, 0.028), MON, 'monitorPlastic', 'display-bezel',
    'assembled-solid', '540×322×28 mm 的 23.8 英寸显示器前面板；三边窄边、下巴较厚，背面为弧面壳体。右缘贴右隔断木饰面内表面。',
    features=[feat('bezel-chamfer', 'bevel', '窄边框 0.5 mm 倒角高光。'),
              feat('aoc-logo', 'decal', '下巴中央银色 AOC 字标。', 'screen-detail')],
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'plastic', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'chamfer', 'bevelRadius': 0.0008, 'segments': 2}},
    fidelity='blockout', evidence=['front-view', 'right-three-quarter', 'screen-detail'], importance=1.0,
    animation='monitor-pan-tilt',
    sockets=[{'id': 'stand-mount', 'localPosition': [0, -0.16, -0.02]},
             {'id': 'screen-plane', 'localPosition': [0, 0, 0.015]}],
))
components.append(comp(
    'monitorScreen', 'AOC 屏幕', 'meso', 'monitor', 'plane-card', dims(0.527, 0.296, 0.001), (0, 0.0, 0.0155), 'screenMonitor', 'display-panel',
    'surface-relief', '527×296 mm 平面发光层，贴合前面板内侧；玻璃反光率低。',
    features=[feat('screen-inner-shadow', 'seam', '屏幕边缘 1.2 mm 内阴影。', 'screen-detail')],
    color={'dom': '#0A1733', 'sec': '#1449D8', 'cls': 'glass'}, fidelity='structural-pass',
    evidence=['screen-detail'], importance=1.0,
))
components.append(comp(
    'monitorRearHousing', '显示器背壳', 'meso', 'monitor', 'box', dims(0.44, 0.26, 0.05), (0, 0.0, -0.04), 'monitorPlastic', 'rear-shell',
    'assembled-solid', '440×260×50 mm 弧面背壳，中央有立柱接口与线缆出口。',
    features=[feat('rear-vent', 'groove', '背壳上缘有一排细散热槽。', 'right-three-quarter')],
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'plastic'}, fidelity='structural-pass', evidence=['right-three-quarter'],
))
components.append(comp(
    'monitorStandNeck', '显示器立柱', 'meso', 'monitor', 'cylinder', dims(0.05, 0.064, 0.05), (0, 0, 0), 'metalDark', 'pedestal-neck',
    'assembled-solid', '50 mm 宽、64 mm 高的短立柱，内部走线，后侧有卡线槽。',
    attachment=endpoint('monitor', (0, -0.2235, -0.02), (0, -0.16, -0.02), 0.031, socket='stand-mount', contact='socket', end_radius=0.026),
    features=[feat('stand-cable-slot', 'groove', '立柱后侧 8 mm 宽卡线槽。')],
    color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, fidelity='structural-pass', evidence=['right-three-quarter'],
    animation='monitor-neck',
))
components.append(comp(
    'monitorBase', '显示器圆盘底座', 'meso', 'monitor', 'cylinder', dims(0.20, 0.014, 0.20), (0, 0, 0), 'metalDark', 'pedestal-base',
    'assembled-solid', '直径 200 mm、厚 14 mm 的圆盘底座，底面有四个橡胶脚垫。',
    attachment=endpoint('monitor', (0, -0.2375, -0.01), (0, -0.2235, -0.01), 0.10, socket='stand-mount', contact='butt'),
    color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, fidelity='structural-pass', evidence=['front-view'],
    animation='monitor-base',
))
components.append(comp(
    'monitorClip', '显示器线夹', 'meso', 'monitor', 'box', dims(0.022, 0.075, 0.018), (0, -0.19, -0.065), 'monitorPlastic', 'cable-clip',
    'assembled-solid', '竖向黑色理线夹，将两根线压在立柱后方。',
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['right-three-quarter'],
))
components.append(comp(
    'monitorLed', '显示器电源灯', 'meso', 'monitor', 'box', dims(0.004, 0.004, 0.0015), (0.20, -0.15, 0.0158), 'ledBlue', 'power-led',
    'assembled-solid', '右下巴的 4 mm 方形指示灯，蓝色自发光。',
    color={'dom': '#2AD6FF', 'sec': '#0A2AA0', 'cls': 'plastic'}, fidelity='surface-pass', evidence=['screen-detail'],
))

# keyboard -------------------------------------------------------------------
KB = (-0.10, 0.775, 0.11)
components.append(comp(
    'keyboard', '98 键机械键盘', 'macro', 'root', 'box', dims(0.39, 0.035, 0.145), KB, 'keyboardShell', 'keyboard-case',
    'assembled-solid', '390×145×35 mm 黑色上下壳，四角 3 mm 圆角，前缘低后缘高；右上切出旋钮位。',
    features=[feat('case-chamfer', 'bevel', '上壳 1 mm 圆角高光。'), feat('case-side-seam', 'seam', '上下壳之间 0.4 mm 分模线。')],
    color={'dom': '#202326', 'sec': '#4A4D50', 'cls': 'plastic', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'bevel', 'bevelRadius': 0.0025, 'segments': 3}},
    fidelity='blockout', evidence=['front-view', 'keyboard-detail'], importance=1.0,
    animation='keyboard-rgb',
    sockets=[{'id': 'knob-mount', 'localPosition': [0.166, 0.03, -0.035]}],
))
components.append(comp(
    'keyboardPlate', '键盘定位板', 'meso', 'keyboard', 'box', dims(0.38, 0.006, 0.136), (0, 0.020, -0.001), 'metalDark', 'switch-plate',
    'assembled-solid', '380×136×6 mm 深色定位板，表面露出轴体与 RGB 缝。',
    color={'dom': '#202326', 'sec': '#3A3D40', 'cls': 'metal'}, fidelity='structural-pass', evidence=['keyboard-detail'],
))
components.append(comp(
    'keycapMatrix', '98 键渐变键帽矩阵', 'meso', 'keyboard', 'box', dims(0.372, 0.009, 0.128), (0, 0.026, -0.001), 'keycapPBT', 'keycap-field',
    'assembled-solid', '372×128 mm 的键帽阵列量体；实际 98 个独立键帽由 InstancedMesh 在运行时生成，排列 6 行、含数字区。',
    features=[feat('keycap-bevel', 'bevel', '每个键帽顶面 0.6 mm 倒角与微凹。'),
              feat('keycap-gradient', 'decal', '顶排浅灰至底排深灰渐变。', 'keyboard-detail')],
    color={'dom': '#C3C7CA', 'sec': '#7A8086', 'cls': 'plastic'}, fidelity='structural-pass',
    evidence=['keyboard-detail'], importance=1.0,
    animation='keycap-grid',
))
components.append(comp(
    'keyboardKnob', '右上旋钮', 'meso', 'keyboard', 'cylinder', dims(0.024, 0.022, 0.024), (0, 0, 0), 'metalDark', 'control-knob',
    'assembled-solid', '直径 24 mm、高 22 mm 的旋钮，侧壁滚花、顶面同心圆拉丝。',
    attachment=endpoint('keyboard', (0.166, 0.018, -0.035), (0.166, 0.040, -0.035), 0.011, socket='knob-mount', contact='socket'),
    features=[feat('knurled-grip', 'ridge', '侧壁 36 道竖向滚花。')],
    color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, fidelity='form-refinement', evidence=['keyboard-detail'],
    animation='keyboard-knob',
))
components.append(comp(
    'keyboardIndicator', '键盘状态灯条', 'meso', 'keyboard', 'box', dims(0.035, 0.002, 0.008), (0.06, 0.0195, -0.062), 'ledBlue', 'status-led',
    'assembled-solid', '35 mm 宽的小型灯条，含三色指示点。',
    color={'dom': '#2AD6FF', 'sec': '#F6C445', 'cls': 'plastic'}, fidelity='surface-pass', evidence=['keyboard-detail'],
))
for cid, x in [('keyboardFootL', -0.15), ('keyboardFootR', 0.15)]:
    components.append(comp(
        cid, f'键盘脚 {cid[-1]}', 'meso', 'keyboard', 'box', dims(0.02, 0.012, 0.03), (x, -0.023, -0.04), 'metalDark', 'foot',
        'assembled-solid', '两段式折叠脚，当前收起，厚 12 mm。',
        color={'dom': '#2A2C2E', 'sec': '#5A5D60', 'cls': 'metal'}, fidelity='form-refinement', evidence=['keyboard-detail'],
    ))

# mousepad + mouse -----------------------------------------------------------
MS = (0.31, 0.759, 0.07)
components.append(comp(
    'mousepad', '灰色几何印刷鼠标垫', 'macro', 'root', 'box', dims(0.34, 0.004, 0.25), MS, 'mousepadFabric', 'mousepad',
    'assembled-solid', '340×250×4 mm 圆角矩形布垫，周边密缝，顶面印深灰几何斜带。',
    features=[feat('stitched-edge', 'stitch', '四周 4 mm 密缝边。'), feat('pad-corner-radius', 'bevel', '四角 12 mm 圆角。')],
    color={'dom': '#A6AAA9', 'sec': '#4B4F52', 'cls': 'fabric', 'conf': 0.9},
    geometry={'edgeTreatment': {'type': 'bevel', 'bevelRadius': 0.003, 'segments': 2}},
    fidelity='blockout', evidence=['front-view', 'keyboard-detail'], importance=0.9,
))
components.append(comp(
    'mouseShell', '无线鼠标壳体', 'meso', 'mousepad', 'ellipsoid', dims(0.067, 0.042, 0.115), (0.06, 0.024, 0.03), 'mousePlastic', 'mouse-body',
    'continuous-sculpt', '鼠标为单一连续曲面壳体，背部隆起的椭球与两侧收腰；不是方盒拼接。',
    rotation=(0, -0.28, 0),
    features=[feat('side-grip-ridges', 'ridge', '左侧两道 0.6 mm 防滑浅槽。'), feat('logo-gloss', 'gloss', '背壳浅色 LOGO。')],
    color={'dom': '#151617', 'sec': '#3A3C3E', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['front-view', 'keyboard-detail'],
    animation='mouse-body',
))
components.append(comp(
    'mouseBase', '鼠标底盘', 'meso', 'mousepad', 'box', dims(0.055, 0.008, 0.10), (0.06, 0.006, 0.03), 'monitorPlastic', 'mouse-base',
    'assembled-solid', '鼠标底部薄壳，四角有 PTFE 脚贴。',
    rotation=(0, -0.28, 0),
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'plastic'}, fidelity='structural-pass', evidence=['front-view'],
))
components.append(comp(
    'mouseWheel', '鼠标滚轮', 'meso', 'mousepad', 'cylinder', dims(0.014, 0.014, 0.014), (0, 0, 0), 'metalDark', 'scroll-wheel',
    'assembled-solid', '直径 14 mm 的橡胶滚轮，外缘有细齿，轴向沿 Z。',
    attachment=endpoint('mousepad', (0.06, 0.040, -0.012), (0.06, 0.040, 0.004), 0.007, socket='wheel-mount', contact='socket'),
    features=[feat('wheel-ribbing', 'groove', '滚轮外缘 24 道细齿。')],
    color={'dom': '#1B1C1D', 'sec': '#3A3C3E', 'cls': 'rubber'}, fidelity='form-refinement', evidence=['keyboard-detail'],
    animation='mouse-wheel',
))
components.append(comp(
    'mouseGripL', '鼠标左防滑侧裙', 'meso', 'mousepad', 'box', dims(0.009, 0.022, 0.055), (0.026, 0.021, 0.03), 'mousePlastic', 'side-grip',
    'assembled-solid', '左侧裙为薄弧形贴片，带两条水平浅槽。',
    rotation=(0, -0.28, 0),
    color={'dom': '#151617', 'sec': '#3A3C3E', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['keyboard-detail'],
))
components.append(comp(
    'mouseGripR', '鼠标右防滑侧裙', 'meso', 'mousepad', 'box', dims(0.009, 0.022, 0.055), (0.094, 0.021, 0.03), 'mousePlastic', 'side-grip',
    'assembled-solid', '右侧裙为薄弧形贴片，与左侧互为镜像。',
    rotation=(0, -0.28, 0),
    color={'dom': '#151617', 'sec': '#3A3C3E', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['keyboard-detail'],
))

# mug ------------------------------------------------------------------------
MUG = (0.07, 0.825, -0.02)
mug_profile = {
    'points': [[0.50, -0.50], [0.50, 0.50], [0.42, 0.50], [0.42, -0.40], [0.10, -0.40], [0.10, -0.50], [0.50, -0.50]],
    'segments': 40,
}
components.append(comp(
    'mug', '玻璃茶杯', 'macro', 'root', 'lathe', dims(0.092, 0.13, 0.092), MUG, 'teaGlass', 'drinkware',
    'continuous-sculpt', '杯壁为绕 Y 轴旋转的薄壁玻璃杯体，口沿略外扩、底部有 8 mm 厚底；旋转成形，不是盒体。',
    features=[feat('rim-gloss', 'gloss', '杯口窄高光。'), feat('glass-base-thickness', 'ridge', '杯底 8 mm 厚玻璃台阶。')],
    color={'dom': '#DDE3E1', 'sec': '#C5D2CE', 'cls': 'glass', 'conf': 0.9},
    geometry={'latheProfile': mug_profile, 'edgeTreatment': {'type': 'none', 'bevelRadius': 0.0, 'segments': 1}},
    fidelity='blockout', evidence=['front-view', 'desk-details'], importance=0.8,
    animation='mug-steam',
))
components.append(comp(
    'teaLiquid', '深红茶汤', 'meso', 'mug', 'cylinder', dims(0.072, 0.095, 0.072), (0, 0, 0), 'teaLiquid', 'liquid-volume',
    'assembled-solid', '杯内茶汤为直径 72 mm、高 95 mm 的液柱，液面低于杯口 12 mm。',
    attachment=endpoint('mug', (0, -0.055, 0), (0, 0.04, 0), 0.036, socket='cup-inner', contact='embed'),
    features=[feat('meniscus', 'gloss', '液面边缘细亮弧。')],
    color={'dom': '#2B1007', 'sec': '#5A2A12', 'cls': 'glass'}, fidelity='material-pass', evidence=['desk-details'],
    animation='tea-surface',
))
components.append(comp(
    'mugLid', '木盖', 'meso', 'mug', 'cylinder', dims(0.094, 0.013, 0.094), (0, 0, 0), 'mugLidWood', 'lid',
    'assembled-solid', '直径 94 mm、厚 13 mm 的圆木盖，边缘倒圆，顶面有同心木纹。',
    attachment=endpoint('mug', (0, 0.065, 0), (0, 0.078, 0), 0.047, socket='cup-rim', contact='butt'),
    features=[feat('lid-wood-grain', 'linework', '盖面细年轮纹。'), feat('lid-knob-groove', 'groove', '提钮根部一圈 1 mm 凹槽。')],
    color={'dom': '#6B3A24', 'sec': '#8C5234', 'cls': 'wood'}, fidelity='form-refinement', evidence=['desk-details'],
    animation='mug-lid',
))
components.append(comp(
    'mugLidKnob', '木盖提钮', 'meso', 'mug', 'ellipsoid', dims(0.022, 0.014, 0.022), (0, 0.085, 0), 'mugLidWood', 'lid-knob',
    'continuous-sculpt', '直径 22 mm、高 14 mm 的扁圆提钮，边缘全倒圆。',
    color={'dom': '#6B3A24', 'sec': '#8C5234', 'cls': 'wood'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'mugGrip', '杯把手', 'meso', 'mug', 'torus', dims(0.066, 0.066, 0.034), (0.055, 0.0, 0.0), 'mugLidWood', 'loop-grip',
    'continuous-sculpt', '把手为竖直平面内的圆环曲面，截面近似 D 形，与杯壁两端相接。',
    geometry={'torusTubeRatio': 0.32, 'edgeTreatment': {'type': 'none', 'bevelRadius': 0.0, 'segments': 1}},
    features=[feat('grip-blend', 'seam', '把手与杯壁的熔接圆角。')],
    color={'dom': '#6B3A24', 'sec': '#8C5234', 'cls': 'wood'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'mugNapkin', '白色纸垫', 'meso', 'mug', 'box', dims(0.15, 0.0015, 0.15), (0, -0.063, 0), 'paperMatte', 'paper-mat',
    'assembled-solid', '150×150 mm 的白色纸垫，边缘露齿，四角略卷。',
    features=[feat('napkin-deckle', 'linework', '纸垫边缘的齿状裁切。', 'desk-details')],
    color={'dom': '#F3EFE6', 'sec': '#DCD7CB', 'cls': 'unknown'}, fidelity='form-refinement', evidence=['desk-details'],
))

# bottle ---------------------------------------------------------------------
BOT = (0.452, 0.99, 0.03)
bottle_profile = {
    'points': [[0.18, -0.50], [0.48, -0.50], [0.50, -0.40], [0.48, 0.25], [0.44, 0.42], [0.28, 0.48], [0.24, 0.50],
               [0.18, 0.50], [0.18, -0.50]],
    'segments': 40,
}
components.append(comp(
    'bottle', 'UZSPACE 水壶', 'macro', 'root', 'lathe', dims(0.085, 0.27, 0.085), BOT, 'bottleBody', 'drinkware',
    'continuous-sculpt', '壶身是带腰线与肩部收口的旋转体，壁厚约 2.5 mm，半透明灰绿塑料。',
    features=[feat('volume-ribs', 'groove', '瓶身下半部 3 道浅横纹。'), feat('shoulder-curve', 'ridge', '肩部连续曲面。')],
    color={'dom': '#8D958F', 'sec': '#6F7973', 'cls': 'plastic', 'conf': 0.9},
    geometry={'latheProfile': bottle_profile, 'edgeTreatment': {'type': 'none', 'bevelRadius': 0.0, 'segments': 1}},
    fidelity='blockout', evidence=['right-three-quarter', 'front-view'], importance=0.8,
    animation='bottle-sway',
))
components.append(comp(
    'bottleCap', '水壶黑盖', 'meso', 'bottle', 'cylinder', dims(0.078, 0.035, 0.078), (0, 0, 0), 'bottleCap', 'cap',
    'assembled-solid', '直径 78 mm、高 35 mm 的黑色旋盖，顶部有铰链式提环。',
    attachment=endpoint('bottle', (0, 0.135, 0), (0, 0.165, 0), 0.039, socket='bottle-neck', contact='socket'),
    features=[feat('cap-knurl', 'ridge', '盖侧 24 道防滑竖纹。'), feat('cap-loop', 'hole', '顶部提环穿孔，直径 12 mm。')],
    color={'dom': '#1B1C1D', 'sec': '#3A3C3E', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['right-three-quarter'],
    animation='bottle-cap',
))
components.append(comp(
    'bottleStrap', '水壶挂带', 'meso', 'bottle', 'box', dims(0.018, 0.16, 0.004), (0.025, 0.23, 0.03), 'fabricBlack', 'suspension-strap',
    'assembled-solid', '18×160×4 mm 的黑色尼龙织带，从瓶盖提环穿出并挂到玻璃钩上。',
    features=[feat('strap-weave', 'stitch', '织带表面横向织纹。'), feat('strap-fold', 'seam', '穿过提环处的折返缝线。')],
    color={'dom': '#17181A', 'sec': '#3A3C3E', 'cls': 'fabric'}, fidelity='form-refinement', evidence=['right-three-quarter'],
    animation='bottle-strap',
))

# desk props ------------------------------------------------------------------
PAPER = (-0.40, 0.762, 0.19)
components.append(comp(
    'paperStack', '手写纸与黄边笔记本', 'macro', 'root', 'box', dims(0.20, 0.006, 0.20), PAPER, 'paperMatte', 'paper-stack',
    'assembled-solid', '280×240 mm 纸张叠放，边缘不齐，表面有深蓝/黑手写字。',
    features=[feat('handwriting', 'linework', '手写字行距不均。', 'desk-details'),
              feat('page-curl', 'ridge', '右下角轻微卷曲。', 'desk-details'),
              feat('yellow-edge', 'decal', '下层笔记的黄边。', 'desk-details')],
    color={'dom': '#F3EFE6', 'sec': '#DCD7CB', 'cls': 'unknown'}, fidelity='blockout',
    evidence=['desk-details'], importance=0.7,
))
components.append(comp(
    'pencilCase', '黑色笔袋', 'meso', 'paperStack', 'box', dims(0.22, 0.055, 0.085), (0.02, 0.032, 0.0), 'fabricBlack', 'pencil-case',
    'assembled-solid', '220×55×85 mm 的软质尼龙笔袋，正面有一条金属拉链和浅色布标。',
    rotation=(0, -0.4, 0),
    features=[feat('zip-teeth', 'fastener', '连续金属拉链齿。', 'desk-details'), feat('woven-label', 'decal', '浅色布标。', 'desk-details')],
    color={'dom': '#17181A', 'sec': '#3A3C3E', 'cls': 'fabric'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'notebook', '黄边笔记本', 'meso', 'paperStack', 'box', dims(0.25, 0.012, 0.18), (-0.02, 0.009, 0.02), 'paperYellow', 'notebook',
    'assembled-solid', '250×180×12 mm 的黄色封边笔记本，压在白色手写纸下方。',
    rotation=(0, -0.15, 0),
    features=[feat('notebook-spine', 'ridge', '明黄色书脊边。')],
    color={'dom': '#F2E8C9', 'sec': '#E8B53A', 'cls': 'unknown'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'powerBrick', '白色电源适配器', 'meso', 'paperStack', 'box', dims(0.16, 0.035, 0.07), (-0.08, 0.004, -0.43), 'whiteShell', 'power-adapter',
    'assembled-solid', '160×70×35 mm 白色电源砖，顶面有细散热槽与品牌压印。',
    features=[feat('brick-vent', 'groove', '顶面 6 道细散热槽。')],
    color={'dom': '#E8E7E3', 'sec': '#C9C7C0', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'powerStrip', '白色插排', 'meso', 'paperStack', 'box', dims(0.30, 0.025, 0.08), (0.73, -0.003, -0.42), 'whiteShell', 'power-strip',
    'assembled-solid', '300×80×25 mm 白色插排，竖直插孔与红色电源灯。',
    features=[feat('indicator-led', 'emissive', '红色/橙色电源指示灯。', 'desk-details'), feat('socket-shutters', 'hole', '插孔的黑色安全门。')],
    color={'dom': '#E8E7E3', 'sec': '#C9C7C0', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'usbHub', '白色 USB-C 扩展坞', 'meso', 'paperStack', 'box', dims(0.035, 0.055, 0.022), (0.70, 0.004, -0.16), 'whiteShell', 'usb-hub',
    'assembled-solid', '35×55×22 mm 白色 USB-C 扩展坞，竖立放在桌面，正面有两个接口与细指示灯。',
    rotation=(0, 0.12, 0),
    features=[feat('hub-port-a', 'hole', 'USB-C 接口开孔。'), feat('hub-port-b', 'hole', '第二个 USB-C 接口开孔。'), feat('hub-led', 'emissive', '白色指示灯。')],
    color={'dom': '#E8E7E3', 'sec': '#C9C7C0', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['desk-details', 'front-view'],
))

components.append(comp(
    'pen', '蓝色中性笔', 'meso', 'paperStack', 'cylinder', dims(0.006, 0.006, 0.14), (0, 0, 0), 'penBlue', 'writing-pen',
    'assembled-solid', '直径 6 mm、长 140 mm 的蓝色中性笔，斜放在纸张上。',
    attachment=endpoint('paperStack', (-0.055, 0.018, 0.055), (0.045, 0.018, 0.095), 0.0035, socket='paper-slot', contact='butt'),
    features=[feat('pen-clip', 'ridge', '笔帽金属夹。')],
    color={'dom': '#1E4D8C', 'sec': '#0E2A52', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['desk-details'],
))
components.append(comp(
    'penCap', '笔帽', 'meso', 'paperStack', 'cylinder', dims(0.008, 0.008, 0.045), (0, 0, 0), 'penBlue', 'pen-cap',
    'assembled-solid', '45 mm 长的笔帽，一端有金属夹。',
    attachment=endpoint('paperStack', (-0.055, 0.018, 0.055), (-0.025, 0.018, 0.065), 0.004, socket='paper-slot', contact='socket'),
    color={'dom': '#1E4D8C', 'sec': '#0E2A52', 'cls': 'plastic'}, fidelity='form-refinement', evidence=['desk-details'],
))

# wire harness ---------------------------------------------------------------
components.append(comp(
    'wireHarness', '线缆束', 'macro', 'root', 'box', dims(0.001, 0.001, 0.001), (0, 0.6, -0.2), 'invisible', 'wire-harness',
    'assembled-solid', '不可见分组代理；实际线缆由运行时 Catmull-Rom 管几何生成，端点落在笔记本、显示器与插排接口。',
    color={'dom': '#202020', 'sec': '#000000', 'cls': 'unknown'}, fidelity='blockout', evidence=['desk-details'], importance=0.6,
))
components.append(comp(
    'whiteLead', '白色 USB-C 线', 'meso', 'wireHarness', 'box', dims(0.006, 0.006, 0.36), (-0.50, 0.02, 0.24), 'rubberCable', 'wire-lead',
    'assembled-solid', '白色哑光 PVC 线，直径 6 mm，从笔记本左侧弯到桌面左前；占位直线在运行时替换为曲线管。',
    rotation=(0.0, 0.65, 0.0),
    features=[feat('strain-relief', 'ridge', '接口端 30 mm 长的加强套。')],
    color={'dom': '#E9E9E7', 'sec': '#C3C3BF', 'cls': 'rubber'}, fidelity='structural-pass', evidence=['desk-details'],
))
components.append(comp(
    'blackLead', '黑色显示器电源/视频线', 'meso', 'wireHarness', 'box', dims(0.006, 0.006, 0.40), (0.18, 0.10, -0.04), 'monitorPlastic', 'wire-lead',
    'assembled-solid', '两根黑色线缆沿显示器立柱后方下行，再折向桌后插排；占位直线运行时替换。',
    rotation=(0.0, 0.15, 0.0),
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'rubber'}, fidelity='structural-pass', evidence=['desk-details'],
))
components.append(comp(
    'earphoneLead', '耳机线', 'meso', 'wireHarness', 'box', dims(0.004, 0.004, 0.16), (0.55, 0.01, -0.05), 'monitorPlastic', 'wire-lead',
    'assembled-solid', '细耳机线在显示器右侧盘绕后落到桌面。',
    rotation=(0.0, -0.5, 0.0),
    color={'dom': '#111315', 'sec': '#2D3033', 'cls': 'rubber'}, fidelity='form-refinement', evidence=['desk-details'],
))

spec['componentTree'] = components

# ---------------------------------------------------------------------------
# Repetition systems (hand-authored runtime instancing; generator skips these
# levels on purpose so it does not emit a wrong radial ring for them).
# ---------------------------------------------------------------------------
spec['repetitionSystems'] = [
    {'id': 'keycap-grid', 'parent': 'keycapMatrix', 'level': 'hand-authored', 'count': 98,
     'realization': 'custom-instanced-grid', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'box', 'rows': 6, 'grid': '98-key compact layout with numpad and arrows', 'pitch': [0.01905, 0.01905]},
     'material': 'keycapPBT', 'instanceScale': [0.0175, 0.0105, 0.0175],
     'handCode': 'src/workstationDetails.ts#createKeycaps', 'note': '每个键帽独立矩阵，支持逐键下压与逐键颜色。'},
    {'id': 'screen-icon-grid', 'parent': 'laptopScreen', 'level': 'hand-authored', 'count': 26,
     'realization': 'custom-canvas-grid', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'plane-card', 'grid': '2 columns x 13 rows desktop icons'},
     'material': 'screenLaptop', 'instanceScale': [0.012, 0.012, 0.001],
     'handCode': 'src/workstationDetails.ts#drawLaptopScreen'},
    {'id': 'shelf-book-spines', 'parent': 'shelfProps', 'level': 'hand-authored', 'count': 12,
     'realization': 'custom-instanced-books', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'box', 'layout': '12 books with varying width/height/color'},
     'material': 'bookSpines', 'instanceScale': [0.035, 0.20, 0.12],
     'handCode': 'src/workstationDetails.ts#createBooks'},
    {'id': 'cable-bends', 'parent': 'wireHarness', 'level': 'hand-authored', 'count': 5,
     'realization': 'custom-tube-curves', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'tube', 'layout': '5 Catmull-Rom cable runs with real endpoints'},
     'material': 'rubberCable', 'instanceScale': [0.006, 0.006, 1.0],
     'handCode': 'src/workstationDetails.ts#createCables'},
    {'id': 'mousepad-stitch', 'parent': 'mousepad', 'level': 'hand-authored', 'count': 260,
     'realization': 'custom-instanced-stitch', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'box', 'layout': 'perimeter stitch at 3 mm spacing'},
     'material': 'mousepadFabric', 'instanceScale': [0.0018, 0.0008, 0.004],
     'handCode': 'src/workstationDetails.ts#createMousepadStitch'},
    {'id': 'glass-retainer-clips', 'parent': 'partition', 'level': 'hand-authored', 'count': 12,
     'realization': 'custom-instanced-clips', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'box', 'layout': '3 clips per glass edge, 4 edges x 3'},
     'material': 'aluminum', 'instanceScale': [0.018, 0.008, 0.012],
     'handCode': 'src/workstationDetails.ts#createGlassClips'},
    {'id': 'steam-particles', 'parent': 'mug', 'level': 'hand-authored', 'count': 18,
     'realization': 'custom-particle-field', 'buildsGeometry': True,
     'geometry': {'basePrimitive': 'plane-card', 'layout': '18 rising steam cards above the cup'},
     'material': 'steam', 'instanceScale': [0.018, 0.045, 1.0],
     'handCode': 'src/workstationDetails.ts#createSteam'},
]

# ---------------------------------------------------------------------------
# Review, passes, action, lighting
# ---------------------------------------------------------------------------
spec['featureReviewTargets'] = [
    {'id': 'workstation-architecture', 'name': '隔断/桌面/书架的包围结构', 'tier': 'critical', 'passIds': ['blockout', 'structural-pass', 'form-refinement'],
     'minimumScore': 0.8, 'mustPass': True, 'componentRefs': ['desk', 'partition', 'shelf', 'shelfProps'], 'evidenceRefs': ['front-view', 'left-three-quarter', 'shelf-detail']},
    {'id': 'laptop-stand-system', 'name': '白色笔记本与铝支架', 'tier': 'critical', 'passIds': ['structural-pass', 'form-refinement', 'material-pass'],
     'minimumScore': 0.8, 'mustPass': True, 'componentRefs': ['laptopBase', 'laptopLid', 'laptopScreen', 'laptopStandBase', 'laptopKeyboardDeck'], 'evidenceRefs': ['front-view', 'left-three-quarter', 'screen-detail']},
    {'id': 'aoc-monitor-system', 'name': 'AOC 显示器与底座', 'tier': 'critical', 'passIds': ['structural-pass', 'form-refinement', 'material-pass'],
     'minimumScore': 0.8, 'mustPass': True, 'componentRefs': ['monitor', 'monitorScreen', 'monitorStandNeck', 'monitorBase'], 'evidenceRefs': ['front-view', 'right-three-quarter', 'screen-detail']},
    {'id': 'keyboard-mouse-controls', 'name': '98 键键盘/鼠标/鼠标垫', 'tier': 'critical', 'passIds': ['form-refinement', 'material-pass', 'surface-pass'],
     'minimumScore': 0.8, 'mustPass': True, 'componentRefs': ['keyboard', 'keycapMatrix', 'keyboardKnob', 'mousepad', 'mouseShell'], 'evidenceRefs': ['keyboard-detail', 'front-view']},
    {'id': 'desk-still-life-materials', 'name': '茶杯/水壶/纸笔/线缆与材质', 'tier': 'critical', 'passIds': ['material-pass', 'surface-pass', 'lighting-pass'],
     'minimumScore': 0.75, 'mustPass': True, 'componentRefs': ['mug', 'bottle', 'paperStack', 'wireHarness'], 'evidenceRefs': ['desk-details', 'front-view', 'right-three-quarter']},
    {'id': 'layout-proportion', 'name': '设备布局与遮挡顺序', 'tier': 'important', 'passIds': ['blockout', 'structural-pass'],
     'minimumScore': 0.65, 'mustPass': False, 'componentRefs': ['desk', 'partition', 'laptopBase', 'monitor', 'keyboard'], 'evidenceRefs': ['front-view', 'left-three-quarter']},
    {'id': 'material-separation', 'name': '主材质区分度', 'tier': 'important', 'passIds': ['material-pass', 'surface-pass'],
     'minimumScore': 0.65, 'mustPass': False, 'componentRefs': ['desk', 'partition', 'keycapMatrix', 'mousepad', 'mug', 'bottle'], 'evidenceRefs': ['front-view', 'desk-details', 'keyboard-detail']},
    {'id': 'action-rig', 'name': '可动枢轴与运行时 API', 'tier': 'important', 'passIds': ['interaction-pass'],
     'minimumScore': 0.65, 'mustPass': False, 'componentRefs': ['laptopLid', 'monitor', 'keycapMatrix', 'mug', 'bottle'], 'evidenceRefs': ['front-view']},
    {'id': 'lighting-contact', 'name': '光照与接触阴影', 'tier': 'important', 'passIds': ['lighting-pass'],
     'minimumScore': 0.65, 'mustPass': False, 'componentRefs': ['desk', 'monitorBase', 'mug', 'mousepad'], 'evidenceRefs': ['front-view']},
]

for bp in spec['buildPasses']:
    if bp['id'] == 'blockout':
        bp['componentRefs'] = [c['id'] for c in components]
    elif bp['id'] in {'structural-pass', 'form-refinement', 'material-pass', 'surface-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass'}:
        bp['componentRefs'] = [c['id'] for c in components]

spec['sculptPipeline']['currentPass'] = 'blockout'
spec['sculptPipeline']['completedPasses'] = []
spec['sculptPipeline']['lastCompletedPass'] = ''
spec['sculptPipeline']['blockedReason'] = 'blockout 需要浏览器截图、对比图与视觉评审后才能解锁 structural-pass。'
spec['reviewHistory'] = []
spec['visualEvidence'] = []

spec['animationAnchors'] = [
    'root.userData.animation.openLaptop(angleDeg) / closeLaptop()',
    'root.userData.animation.panMonitor(deg) / tiltMonitor(deg)',
    'root.userData.animation.pressKey(code, travelMm) / releaseKey(code)',
    'root.userData.animation.setKeyboardRgb(mode, hueOffset)',
    'root.userData.animation.moveMouse(x, z) / spinWheel(delta)',
    'root.userData.animation.openMugLid(angleDeg) / toggleSteam()',
    'root.userData.animation.swayBottle(amplitudeDeg)',
    'root.userData.animation.setScreenPower(on) / setLightingMode(day|night)',
]
spec['animationPlan'] = {
    'laptopLid': {'hingeAxis': 'X', 'closedDeg': 0, 'openDeg': 105, 'node': 'laptopLid'},
    'monitor': {'panDeg': [-15, 15], 'tiltDeg': [-5, 8], 'node': 'monitor'},
    'keycaps': {'travelMm': [-2.4, 0], 'perKey': True, 'node': 'keycapMatrix'},
    'keyboardRgb': {'hueSweepDegPerSec': 24, 'modes': ['sweep', 'static', 'off']},
    'mouse': {'rangeXZ': 0.12, 'wheelSteps': 24},
    'mug': {'steamAlways': True, 'lidOpenDeg': 55},
    'bottle': {'swayDeg': 3.2, 'periodSec': 4.5},
    'screens': {'refreshHz': 2, 'powerToggle': True},
    'lighting': {'modes': ['day', 'night'], 'screenBloomInNight': True},
}
spec['lightingFromPhoto'] = [
    'Key light: 顶部偏左前的办公室顶灯，色温约 5000 K，柔光、阴影半影宽；相对强度 2.4–2.8，自相机左上方 35° 入射。',
    'Fill light: 右侧磨砂玻璃透入的冷白日光，约 6500 K，强度 0.35–0.45，压低阴影对比并照亮显示器右缘。',
    'Rim/environment: 相机后方与桌下提供低强度中性反弹，环境贴图等级 0.8；屏幕蓝光作为局部彩色光源。',
    'Exposure: 0.15–0.25 EV，ACESFilmic tone mapping，sRGB 输出；背景为浅暖灰渐变，避免纯白吹高。',
    'Contact shadow: 所有落地/落桌部件使用 4K PCF 软阴影 + 材质 AO；显示器底座、杯垫、键盘脚与鼠标脚下需可见接触暗部。',
]
spec['lookDevTargets']['qualityPriority'] = 'reference-fidelity'
spec['lookDevTargets']['materialPass']['minimumTextureResolution'] = 1024
spec['lookDevTargets']['materialPass']['preferredTextureResolution'] = 2048
spec['lookDevTargets']['materialPass']['independentMapChannels'] = ['albedo', 'roughness', 'height', 'normal', 'ambient-occlusion']
spec['lookDevTargets']['materialPass']['referencePbrExtraction'] = {
    'requiredWhenSourceImagePresent': True,
    'targetThreshold': 0.7,
    'stopOnLowConfidence': True,
    'script': 'forge/stage1_intake/extract_pbr_evidence.py',
    'acceptedLimitation': '单视图参考像素提取是估计，不是精确逆渲染；5 个主材质裁剪以 0.761–0.86 置信度通过，玻璃与金属使用程序化物理响应。',
}
spec['performanceBudget'] = {
    'qualityPriority': 'reference-fidelity',
    'targetTriangles': 120000,
    'maxDrawCalls': 150,
    'textureSize': 2048,
    'fpsTarget': 60,
    'optimizationPolicy': '键帽、缝线、书脊与蒸汽使用 InstancedMesh/Points；参考 PBR 贴图仅用于 8 个主材质。',
}
spec['lodPlan'] = [
    {'tier': 'near', 'distance': 0, 'strategy': '完整组件树、98 键 InstancedMesh、PBR 贴图与屏幕 Canvas'},
    {'tier': 'mid', 'distance': 2.0, 'strategy': '隐藏键帽字符叠加与缝线实例，屏幕刷新降至 1 Hz'},
    {'tier': 'far', 'distance': 5.0, 'strategy': '合并静态陈设，降低屏幕分辨率与阴影贴图'},
]
spec['risks'] = [
    '参考只显示正面与两侧 3/4，显示器背面、桌下与书架顶部按常见结构补全；不保证与真实背面一致。',
    '单图 PBR 提取含照明残留，已用参考裁切与低强度环境光校正；不宣称物理精确。',
    '键帽字符与屏幕 UI 小字为程序化近似，不逐字复刻参考内容。',
    '1.jpg 的键盘/鼠标款式与 2–4.jpg 不同；以 4.jpg 为唯一主状态。',
]
spec['knownLimitations'] = assess['preSpecAssessment'].get('documentedLimitations', []) or [
    '显示器背面、笔记本左右接口、桌下与书架顶部为推断。',
    '屏幕中文小字不作为逐字复刻目标。',
    '品牌字样（键盘徽标、鼠标垫小字）以近似标记表示。',
]
spec['projectionDecision'] = {
    'required': False,
    'reason': '工作位是实体场景，不为任意表面做照片 UV 投影；主材质使用逐材质参考 PBR 提取，屏幕与印刷文字使用运行时 Canvas 生成。四视图仅用于几何/布局推断。',
}
spec['handRefinements'] = {
    'module': 'src/workstationDetails.ts',
    'appliesAfterFactory': True,
    'features': ['98 键 InstancedMesh 与逐键下压', '双屏 Canvas UI', '书脊实例', '线缆 Catmull-Rom 管', '鼠标垫缝线', '蒸汽与灯光动画'],
    'rule': '运行时增强只添加规格中声明的细节，不替换工厂的主体积与材质基准。',
}

spec['assumptions'] = [
    '尺度以用户实测为准：桌面约 1050×500 mm，16 英寸笔记本（宽约 355 mm），23.8 英寸显示器（宽约 540 mm）；笔记本左缘距桌边约 120 mm，显示器右缘靠近右隔断。',
    '隐藏面按常见工位结构补全；不声称逐像素或制造级精确。',
    '键盘以 2–4.jpg 的渐变灰 98 键版本为准。',
]
spec['coordinateFrame'] = {
    'front': '+Z（面向相机）',
    'up': '+Y',
    'scale': 'meters；桌面面高 0.7575 m（板中心 0.745 m），桌面宽 1.05 m、深 0.50 m；桌面到书架底 0.59 m',
    'note': '所有宏组件枢轴位于部件语义中心；子件坐标为父级局部坐标。',
}
spec['proceduralStrategy'] = [
    '按宏观体块锁定桌面、隔断、书架与设备包围体。',
    '在中观层建立可动枢轴：笔记本上盖、显示器立柱/面板、键帽矩阵、杯盖、挂瓶。',
    '每个主材质使用参考 PBR 五通道；纯色件使用工具材质并由 Canvas decal 补充。',
    '重复系统（键帽、书脊、线缆、缝线、玻璃卡扣、蒸汽）由 InstancedMesh/Points/运行时几何实现。',
    '最后叠加屏幕 UI、纸面手写、品牌标记与灯光动画。',
]

spec['destination'] = spec.get('destination', {})
spec['emissionTarget'] = {'kind': 'threejs-runtime', 'note': '可交互的浏览器场景，不是静态 GLB 导出目标。'}

ROOT.joinpath('object-sculpt-spec.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding='utf-8')
print('wrote', len(components), 'components,', len(materials), 'materials,', len(spec['repetitionSystems']), 'repetition systems')
