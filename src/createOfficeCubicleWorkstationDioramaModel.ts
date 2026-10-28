import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Office Cubicle Workstation Diorama
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createOfficeCubicleWorkstationDioramaModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Office Cubicle Workstation Diorama";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 43.0, "aspect": 1.3333333333333333, "orientation": {"yaw": 0.0, "pitch": -0.09, "roll": 0.0}, "positionHint": [0.0, 1.38, 1.65], "targetHint": [0.0, 1.06, -0.08], "note": "近似正面机位：从上胸高度略俯视工作位；四张参考图共同锁定布局，不进行照片投影。"}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["woodOak"] = createSculptMaterial(
    "woodOak",
    {"id": "woodOak", "name": "浅橡木饰面", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "qualityTier": "hero", "baseColor": "#C9AE83", "color": "#C9AE83", "albedo": {"dominant": "#C9AE83", "secondary": ["#A98A5F", "#DCC59B"], "samplingNotes": "参考裁剪 /material-crops 提取；主导色 #C9AE83，次色 ['#A98A5F', '#DCC59B']。"}, "colorVariation": {"palette": ["#C9AE83", "#A98A5F", "#DCC59B"], "pattern": "reference-sampled", "amplitude": 0.1, "heightCorrelation": 0.35}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.5, "amplitude": 0.36, "role": "低频色块、整体明度与木纹/布纹走向"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "可见纹理、缝隙、布纹与拉丝方向"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.09, "role": "掠射光下的细粒、磨砂与微高光破碎"}], "roughness": {"base": 0.56, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "缝隙更粗糙，边缘与指触区略低"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived-normal", "strength": 0.24, "scale": 12.0, "space": "tangent"}, "bump": {"pattern": "height-map", "amplitude": 0.0015, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.4, "notes": "缝隙、接触面与压条内凹处加深。"}, "wear": {"edgeWear": 0.08, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.8, "color": "#3A3128"}, "transmission": {"base": 0.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.08}, "clearcoatRoughness": {"base": 0.5}, "doubleSided": false, "envMapIntensity": 0.9, "localOverrides": [{"id": "desk-grain", "description": "桌面直纹沿 X 方向，局部色带宽 6–14 mm。", "roughness": 0.6, "color": "#B89768", "anisotropy": 0.35, "evidenceRef": "4.jpg desk"}, {"id": "partition-grain", "description": "隔断竖向直纹，靠近铝框处变深。", "roughness": 0.63, "color": "#AF9064", "anisotropy": 0.45, "evidenceRef": "4.jpg partition"}], "referencePbr": {"version": "1.0", "sourceImage": "analysis/material-crops/woodOak.jpg", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image reference pixel extraction (de-lit estimate)", "verdict": "pass", "hardLimit": "单图逆渲染估计，不是照片测量；已由渲染截图复核。", "usable": true, "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "maps": {"albedo": {"path": "public/textures/woodOak/woodoak_albedo.png", "url": "textures/woodOak/woodoak_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/textures/woodOak/woodoak_roughness.png", "url": "textures/woodOak/woodoak_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/textures/woodOak/woodoak_height.png", "url": "textures/woodOak/woodoak_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/textures/woodOak/woodoak_normal.png", "url": "textures/woodOak/woodoak_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/textures/woodOak/woodoak_ao.png", "url": "textures/woodOak/woodoak_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "shaderNotes": ["albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。", "参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。"], "notes": "浅橡木饰面"},
    options
  );
  materialMap["aluminum"] = createSculptMaterial(
    "aluminum",
    {"id": "aluminum", "name": "银灰阳极氧化铝", "type": "physical", "qualityTier": "utility", "baseColor": "#B8BCC0", "color": "#B8BCC0", "albedo": {"dominant": "#B8BCC0", "secondary": ["#B8BCC0", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.31, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.94, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["铝型材为均匀阳极氧化金属；画面中仅窄条可用，且混入玻璃/木材，故使用程序化金属响应。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "银灰阳极氧化铝"},
    options
  );
  materialMap["frostedGlass"] = createSculptMaterial(
    "frostedGlass",
    {"id": "frostedGlass", "name": "磨砂玻璃", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "qualityTier": "hero", "baseColor": "#C7D4D0", "color": "#C7D4D0", "albedo": {"dominant": "#C7D4D0", "secondary": ["#B4C3BE", "#E1EAE6"], "samplingNotes": "参考裁剪 /material-crops 提取；主导色 #C7D4D0，次色 ['#B4C3BE', '#E1EAE6']。"}, "colorVariation": {"palette": ["#C7D4D0", "#B4C3BE", "#E1EAE6"], "pattern": "reference-sampled", "amplitude": 0.1, "heightCorrelation": 0.35}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.5, "amplitude": 0.36, "role": "低频色块、整体明度与木纹/布纹走向"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "可见纹理、缝隙、布纹与拉丝方向"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.09, "role": "掠射光下的细粒、磨砂与微高光破碎"}], "roughness": {"base": 0.56, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "缝隙更粗糙，边缘与指触区略低"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived-normal", "strength": 0.08, "scale": 12.0, "space": "tangent"}, "bump": {"pattern": "height-map", "amplitude": 0.0015, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.4, "notes": "缝隙、接触面与压条内凹处加深。"}, "wear": {"edgeWear": 0.08, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.8, "color": "#3A3128"}, "transmission": {"base": 0.85}, "ior": {"base": 1.5}, "thickness": {"base": 0.006}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "doubleSided": true, "envMapIntensity": 0.9, "localOverrides": [{"id": "frost-band", "description": "中部宽而弱的漫反射高光带。", "roughness": 0.48, "transmission": 0.88, "evidenceRef": "4.jpg glass panels"}], "referencePbr": {"version": "1.0", "sourceImage": "analysis/material-crops/frostedGlass.jpg", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image reference pixel extraction (de-lit estimate)", "verdict": "pass", "hardLimit": "单图逆渲染估计，不是照片测量；已由渲染截图复核。", "usable": true, "confidence": 0.761, "estimatedFidelity": 0.761, "targetThreshold": 0.7, "maps": {"albedo": {"path": "public/textures/frostedGlass/frostedglass_albedo.png", "url": "textures/frostedGlass/frostedglass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/textures/frostedGlass/frostedglass_roughness.png", "url": "textures/frostedGlass/frostedglass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/textures/frostedGlass/frostedglass_height.png", "url": "textures/frostedGlass/frostedglass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/textures/frostedGlass/frostedglass_normal.png", "url": "textures/frostedGlass/frostedglass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/textures/frostedGlass/frostedglass_ao.png", "url": "textures/frostedGlass/frostedglass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "shaderNotes": ["albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。", "参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。"], "notes": "磨砂玻璃"},
    options
  );
  materialMap["laptopWhite"] = createSculptMaterial(
    "laptopWhite",
    {"id": "laptopWhite", "name": "白色镁铝合金机身", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "qualityTier": "hero", "baseColor": "#E7E6E2", "color": "#E7E6E2", "albedo": {"dominant": "#E7E6E2", "secondary": ["#C9C8C3", "#F6F5F1"], "samplingNotes": "参考裁剪 /material-crops 提取；主导色 #E7E6E2，次色 ['#C9C8C3', '#F6F5F1']。"}, "colorVariation": {"palette": ["#E7E6E2", "#C9C8C3", "#F6F5F1"], "pattern": "reference-sampled", "amplitude": 0.1, "heightCorrelation": 0.35}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.5, "amplitude": 0.36, "role": "低频色块、整体明度与木纹/布纹走向"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "可见纹理、缝隙、布纹与拉丝方向"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.09, "role": "掠射光下的细粒、磨砂与微高光破碎"}], "roughness": {"base": 0.34, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "缝隙更粗糙，边缘与指触区略低"}, "metalness": {"base": 0.12, "variation": 0.04}, "normal": {"pattern": "reference-derived-normal", "strength": 0.1, "scale": 12.0, "space": "tangent"}, "bump": {"pattern": "height-map", "amplitude": 0.0015, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.4, "notes": "缝隙、接触面与压条内凹处加深。"}, "wear": {"edgeWear": 0.08, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.8, "color": "#3A3128"}, "transmission": {"base": 0.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.16}, "clearcoatRoughness": {"base": 0.24}, "doubleSided": false, "envMapIntensity": 0.9, "localOverrides": [{"id": "soft-clearcoat", "description": "掌托边缘弱清漆高光，平面部偏哑。", "roughness": 0.27, "clearcoat": 0.22, "evidenceRef": "4.jpg laptop shell"}], "referencePbr": {"version": "1.0", "sourceImage": "analysis/material-crops/laptopWhite.jpg", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image reference pixel extraction (de-lit estimate)", "verdict": "pass", "hardLimit": "单图逆渲染估计，不是照片测量；已由渲染截图复核。", "usable": true, "confidence": 0.792, "estimatedFidelity": 0.792, "targetThreshold": 0.7, "maps": {"albedo": {"path": "public/textures/laptopWhite/laptopwhite_albedo.png", "url": "textures/laptopWhite/laptopwhite_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/textures/laptopWhite/laptopwhite_roughness.png", "url": "textures/laptopWhite/laptopwhite_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/textures/laptopWhite/laptopwhite_height.png", "url": "textures/laptopWhite/laptopwhite_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/textures/laptopWhite/laptopwhite_normal.png", "url": "textures/laptopWhite/laptopwhite_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/textures/laptopWhite/laptopwhite_ao.png", "url": "textures/laptopWhite/laptopwhite_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "shaderNotes": ["albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。", "参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。"], "notes": "白色镁铝合金机身"},
    options
  );
  materialMap["keycapPBT"] = createSculptMaterial(
    "keycapPBT",
    {"id": "keycapPBT", "name": "渐变灰 PBT 键帽", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "qualityTier": "hero", "baseColor": "#C3C7CA", "color": "#C3C7CA", "albedo": {"dominant": "#C3C7CA", "secondary": ["#7A8086", "#2C2F33"], "samplingNotes": "参考裁剪 /material-crops 提取；主导色 #C3C7CA，次色 ['#7A8086', '#2C2F33']。"}, "colorVariation": {"palette": ["#C3C7CA", "#7A8086", "#2C2F33"], "pattern": "reference-sampled", "amplitude": 0.1, "heightCorrelation": 0.35}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.5, "amplitude": 0.36, "role": "低频色块、整体明度与木纹/布纹走向"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "可见纹理、缝隙、布纹与拉丝方向"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.09, "role": "掠射光下的细粒、磨砂与微高光破碎"}], "roughness": {"base": 0.62, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "缝隙更粗糙，边缘与指触区略低"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived-normal", "strength": 0.22, "scale": 12.0, "space": "tangent"}, "bump": {"pattern": "height-map", "amplitude": 0.0015, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.4, "notes": "缝隙、接触面与压条内凹处加深。"}, "wear": {"edgeWear": 0.08, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.8, "color": "#3A3128"}, "transmission": {"base": 0.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "doubleSided": false, "envMapIntensity": 0.9, "localOverrides": [{"id": "gradient-bands", "description": "顶排浅灰逐行到深灰，modifier 更深。", "albedo": "#BEC3C7", "evidenceRef": "4.jpg keyboard"}, {"id": "rgb-underlight", "description": "键缝 RGB 由粉紫到青绿扫描。", "emissive": "#2BD8FF", "emissiveIntensity": 1.6, "evidenceRef": "4.jpg keyboard"}], "referencePbr": {"version": "1.0", "sourceImage": "analysis/material-crops/keycap.jpg", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image reference pixel extraction (de-lit estimate)", "verdict": "pass", "hardLimit": "单图逆渲染估计，不是照片测量；已由渲染截图复核。", "usable": true, "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "maps": {"albedo": {"path": "public/textures/keycap/keycappbt_albedo.png", "url": "textures/keycap/keycappbt_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/textures/keycap/keycappbt_roughness.png", "url": "textures/keycap/keycappbt_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/textures/keycap/keycappbt_height.png", "url": "textures/keycap/keycappbt_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/textures/keycap/keycappbt_normal.png", "url": "textures/keycap/keycappbt_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/textures/keycap/keycappbt_ao.png", "url": "textures/keycap/keycappbt_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "shaderNotes": ["albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。", "参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。"], "notes": "渐变灰 PBT 键帽"},
    options
  );
  materialMap["mousepadFabric"] = createSculptMaterial(
    "mousepadFabric",
    {"id": "mousepadFabric", "name": "灰色几何印刷布垫", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "qualityTier": "hero", "baseColor": "#A6AAA9", "color": "#A6AAA9", "albedo": {"dominant": "#A6AAA9", "secondary": ["#4B4F52", "#6D7174"], "samplingNotes": "参考裁剪 /material-crops 提取；主导色 #A6AAA9，次色 ['#4B4F52', '#6D7174']。"}, "colorVariation": {"palette": ["#A6AAA9", "#4B4F52", "#6D7174"], "pattern": "reference-sampled", "amplitude": 0.1, "heightCorrelation": 0.35}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "世界尺度约 1–3 mm/texel，避免随部件缩放拉伸。"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.5, "amplitude": 0.36, "role": "低频色块、整体明度与木纹/布纹走向"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "可见纹理、缝隙、布纹与拉丝方向"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.09, "role": "掠射光下的细粒、磨砂与微高光破碎"}], "roughness": {"base": 0.87, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "缝隙更粗糙，边缘与指触区略低"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived-normal", "strength": 0.18, "scale": 12.0, "space": "tangent"}, "bump": {"pattern": "height-map", "amplitude": 0.0015, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.4, "notes": "缝隙、接触面与压条内凹处加深。"}, "wear": {"edgeWear": 0.08, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.8, "color": "#3A3128"}, "transmission": {"base": 0.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "doubleSided": false, "envMapIntensity": 0.9, "localOverrides": [{"id": "geometric-print", "description": "深灰斜带、细线与右上小字。", "albedo": "#565B5F", "roughness": 0.8, "evidenceRef": "4.jpg mousepad"}], "referencePbr": {"version": "1.0", "sourceImage": "analysis/material-crops/mousepadFabric.jpg", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image reference pixel extraction (de-lit estimate)", "verdict": "pass", "hardLimit": "单图逆渲染估计，不是照片测量；已由渲染截图复核。", "usable": true, "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "maps": {"albedo": {"path": "public/textures/mousepadFabric/mousepadfabric_albedo.png", "url": "textures/mousepadFabric/mousepadfabric_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/textures/mousepadFabric/mousepadfabric_roughness.png", "url": "textures/mousepadFabric/mousepadfabric_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/textures/mousepadFabric/mousepadfabric_height.png", "url": "textures/mousepadFabric/mousepadfabric_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/textures/mousepadFabric/mousepadfabric_normal.png", "url": "textures/mousepadFabric/mousepadfabric_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/textures/mousepadFabric/mousepadfabric_ao.png", "url": "textures/mousepadFabric/mousepadfabric_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "shaderNotes": ["albedo / roughness / height / normal / AO 通道相互独立；roughness 不复用 albedo。", "参考 PBR 贴图用于主材质；局部印刷/文字由运行时 Canvas 叠加。"], "notes": "灰色几何印刷布垫"},
    options
  );
  materialMap["teaGlass"] = createSculptMaterial(
    "teaGlass",
    {"id": "teaGlass", "name": "硼硅玻璃杯壁", "type": "physical", "qualityTier": "utility", "baseColor": "#DDE3E1", "color": "#DDE3E1", "albedo": {"dominant": "#DDE3E1", "secondary": ["#DDE3E1", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.08, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.93}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.004}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": true, "textureless": {"declared": true, "evidence": ["玻璃为透明高光表面；单图提取会混入茶汤，故使用物理透射材质。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "硼硅玻璃杯壁"},
    options
  );
  materialMap["bottleBody"] = createSculptMaterial(
    "bottleBody",
    {"id": "bottleBody", "name": "灰绿半透明水壶", "type": "physical", "qualityTier": "utility", "baseColor": "#8D958F", "color": "#8D958F", "albedo": {"dominant": "#8D958F", "secondary": ["#8D958F", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.3, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.45}, "opacity": {"base": 1.0}, "ior": {"base": 1.48}, "thickness": {"base": 0.0025}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": true, "textureless": {"declared": true, "evidence": ["半透明塑料瓶身；纹理主要是油墨与注塑痕，使用物理透射+运行时 decal。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "灰绿半透明水壶", "localOverrides": [{"id": "uzspace-label", "description": "白色竖排 UZSPACE 字样与容量刻度。", "albedo": "#E9EDEA", "roughness": 0.42, "evidenceRef": "4.jpg bottle"}]},
    options
  );
  materialMap["keyboardShell"] = createSculptMaterial(
    "keyboardShell",
    {"id": "keyboardShell", "name": "键盘黑色上壳", "type": "physical", "qualityTier": "utility", "baseColor": "#202326", "color": "#202326", "albedo": {"dominant": "#202326", "secondary": ["#202326", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.52, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "键盘黑色上壳"},
    options
  );
  materialMap["keyboardDeck"] = createSculptMaterial(
    "keyboardDeck",
    {"id": "keyboardDeck", "name": "笔记本深色键盘面", "type": "physical", "qualityTier": "utility", "baseColor": "#33363A", "color": "#33363A", "albedo": {"dominant": "#33363A", "secondary": ["#33363A", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.58, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "笔记本深色键盘面"},
    options
  );
  materialMap["trackpadGlass"] = createSculptMaterial(
    "trackpadGlass",
    {"id": "trackpadGlass", "name": "触控板玻璃", "type": "physical", "qualityTier": "utility", "baseColor": "#E0E1DD", "color": "#E0E1DD", "albedo": {"dominant": "#E0E1DD", "secondary": ["#E0E1DD", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.16, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["触控板为均匀玻璃面，无可见高频纹理。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "触控板玻璃"},
    options
  );
  materialMap["monitorPlastic"] = createSculptMaterial(
    "monitorPlastic",
    {"id": "monitorPlastic", "name": "显示器黑色细咬花塑料", "type": "physical", "qualityTier": "utility", "baseColor": "#111315", "color": "#111315", "albedo": {"dominant": "#111315", "secondary": ["#111315", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.03, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["机壳为均匀细咬花塑料；表面变化以边框几何高光表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "显示器黑色细咬花塑料", "localOverrides": [{"id": "bezel-sheen", "description": "窄边框掠射高光。", "roughness": 0.28, "evidenceRef": "screen-detail"}]},
    options
  );
  materialMap["screenLaptop"] = createSculptMaterial(
    "screenLaptop",
    {"id": "screenLaptop", "name": "笔记本屏幕（自发光）", "type": "physical", "qualityTier": "utility", "baseColor": "#0A1733", "color": "#0A1733", "albedo": {"dominant": "#0A1733", "secondary": ["#0A1733", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.12, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#0A1B44", "emissiveIntensity": {"base": 0.45}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["屏幕内容由运行时 Canvas 生成；基材为黑色玻璃。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "笔记本屏幕（自发光）", "localOverrides": [{"id": "taskbar-glow", "description": "任务栏与图标自发光微晕。", "emissive": "#2C7BFF", "emissiveIntensity": 1.2, "evidenceRef": "screen-detail"}]},
    options
  );
  materialMap["screenMonitor"] = createSculptMaterial(
    "screenMonitor",
    {"id": "screenMonitor", "name": "外接屏（自发光）", "type": "physical", "qualityTier": "utility", "baseColor": "#0A1733", "color": "#0A1733", "albedo": {"dominant": "#0A1733", "secondary": ["#0A1733", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.12, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#0A1B44", "emissiveIntensity": {"base": 0.45}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["屏幕内容由运行时 Canvas 生成；基材为黑色玻璃。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "外接屏（自发光）", "localOverrides": [{"id": "app-window", "description": "深灰软件窗口与底部任务栏的自发光层级。", "emissive": "#1A4FDB", "emissiveIntensity": 1.1, "evidenceRef": "screen-detail"}]},
    options
  );
  materialMap["mousePlastic"] = createSculptMaterial(
    "mousePlastic",
    {"id": "mousePlastic", "name": "鼠标类肤黑塑料", "type": "physical", "qualityTier": "utility", "baseColor": "#151617", "color": "#151617", "albedo": {"dominant": "#151617", "secondary": ["#151617", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.38, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["类肤涂层在高光下仅有宽而低对比的光泽；纹理由几何棱线表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "鼠标类肤黑塑料"},
    options
  );
  materialMap["teaLiquid"] = createSculptMaterial(
    "teaLiquid",
    {"id": "teaLiquid", "name": "深红茶汤", "type": "physical", "qualityTier": "utility", "baseColor": "#2B1007", "color": "#2B1007", "albedo": {"dominant": "#2B1007", "secondary": ["#2B1007", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.12, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.32}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "深红茶汤", "localOverrides": [{"id": "tea-surface-sheen", "description": "液面边缘的细亮弧与高吸收茶色。", "roughness": 0.06, "color": "#2B1007", "evidenceRef": "desk-details"}]},
    options
  );
  materialMap["mugLidWood"] = createSculptMaterial(
    "mugLidWood",
    {"id": "mugLidWood", "name": "棕色木盖与把手", "type": "physical", "qualityTier": "utility", "baseColor": "#6B3A24", "color": "#6B3A24", "albedo": {"dominant": "#6B3A24", "secondary": ["#6B3A24", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.38, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "棕色木盖与把手"},
    options
  );
  materialMap["bottleCap"] = createSculptMaterial(
    "bottleCap",
    {"id": "bottleCap", "name": "水壶黑盖", "type": "physical", "qualityTier": "utility", "baseColor": "#1B1C1D", "color": "#1B1C1D", "albedo": {"dominant": "#1B1C1D", "secondary": ["#1B1C1D", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.54, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "水壶黑盖"},
    options
  );
  materialMap["paperMatte"] = createSculptMaterial(
    "paperMatte",
    {"id": "paperMatte", "name": "米白纸张", "type": "physical", "qualityTier": "utility", "baseColor": "#F3EFE6", "color": "#F3EFE6", "albedo": {"dominant": "#F3EFE6", "secondary": ["#F3EFE6", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.88, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "米白纸张"},
    options
  );
  materialMap["paperYellow"] = createSculptMaterial(
    "paperYellow",
    {"id": "paperYellow", "name": "黄边笔记纸", "type": "physical", "qualityTier": "utility", "baseColor": "#F2E8C9", "color": "#F2E8C9", "albedo": {"dominant": "#F2E8C9", "secondary": ["#F2E8C9", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.86, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "黄边笔记纸"},
    options
  );
  materialMap["fabricBlack"] = createSculptMaterial(
    "fabricBlack",
    {"id": "fabricBlack", "name": "黑色尼龙笔袋/织带", "type": "physical", "qualityTier": "utility", "baseColor": "#17181A", "color": "#17181A", "albedo": {"dominant": "#17181A", "secondary": ["#17181A", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.92, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "黑色尼龙笔袋/织带"},
    options
  );
  materialMap["rubberCable"] = createSculptMaterial(
    "rubberCable",
    {"id": "rubberCable", "name": "哑光 PVC 线缆", "type": "physical", "qualityTier": "utility", "baseColor": "#E9E9E7", "color": "#E9E9E7", "albedo": {"dominant": "#E9E9E7", "secondary": ["#E9E9E7", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.56, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "哑光 PVC 线缆", "localOverrides": [{"id": "cable-sheen", "description": "哑光 PVC 线缆沿弧顶的弱高光。", "roughness": 0.48, "evidenceRef": "desk-details"}]},
    options
  );
  materialMap["metalDark"] = createSculptMaterial(
    "metalDark",
    {"id": "metalDark", "name": "深色金属支架", "type": "physical", "qualityTier": "utility", "baseColor": "#2A2C2E", "color": "#2A2C2E", "albedo": {"dominant": "#2A2C2E", "secondary": ["#2A2C2E", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.36, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.8, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "深色金属支架"},
    options
  );
  materialMap["standMetal"] = createSculptMaterial(
    "standMetal",
    {"id": "standMetal", "name": "灰色笔记本支架金属", "type": "physical", "qualityTier": "utility", "baseColor": "#858A8E", "color": "#858A8E", "albedo": {"dominant": "#858A8E", "secondary": ["#858A8E", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.4, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.55, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "灰色笔记本支架金属"},
    options
  );
  materialMap["stickerBlue"] = createSculptMaterial(
    "stickerBlue",
    {"id": "stickerBlue", "name": "蓝绿设备贴纸", "type": "physical", "qualityTier": "utility", "baseColor": "#2AB6C9", "color": "#2AB6C9", "albedo": {"dominant": "#2AB6C9", "secondary": ["#2AB6C9", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.42, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "蓝绿设备贴纸"},
    options
  );
  materialMap["ledBlue"] = createSculptMaterial(
    "ledBlue",
    {"id": "ledBlue", "name": "指示灯", "type": "physical", "qualityTier": "utility", "baseColor": "#2AD6FF", "color": "#2AD6FF", "albedo": {"dominant": "#2AD6FF", "secondary": ["#2AD6FF", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.2, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#2AD6FF", "emissiveIntensity": {"base": 2.2}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["小面积纯发光片。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "指示灯"},
    options
  );
  materialMap["invisible"] = createSculptMaterial(
    "invisible",
    {"id": "invisible", "name": "结构代理（不可见）", "type": "physical", "qualityTier": "utility", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 1.0, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 0.001}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "结构代理（不可见）"},
    options
  );
  materialMap["bookSpines"] = createSculptMaterial(
    "bookSpines",
    {"id": "bookSpines", "name": "书脊色块", "type": "physical", "qualityTier": "utility", "baseColor": "#6A5A8C", "color": "#6A5A8C", "albedo": {"dominant": "#6A5A8C", "secondary": ["#6A5A8C", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.8, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "书脊色块"},
    options
  );
  materialMap["jarGlass"] = createSculptMaterial(
    "jarGlass",
    {"id": "jarGlass", "name": "茶罐玻璃", "type": "physical", "qualityTier": "utility", "baseColor": "#B7C2B9", "color": "#B7C2B9", "albedo": {"dominant": "#B7C2B9", "secondary": ["#B7C2B9", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.2, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.55}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "茶罐玻璃"},
    options
  );
  materialMap["whiteShell"] = createSculptMaterial(
    "whiteShell",
    {"id": "whiteShell", "name": "白色插排/电源砖", "type": "physical", "qualityTier": "utility", "baseColor": "#E8E7E3", "color": "#E8E7E3", "albedo": {"dominant": "#E8E7E3", "secondary": ["#E8E7E3", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.5, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "白色插排/电源砖"},
    options
  );
  materialMap["stickerFrosted"] = createSculptMaterial(
    "stickerFrosted",
    {"id": "stickerFrosted", "name": "磨砂玻璃贴纸", "type": "physical", "qualityTier": "utility", "baseColor": "#E9F0EC", "color": "#E9F0EC", "albedo": {"dominant": "#E9F0EC", "secondary": ["#E9F0EC", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.6, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 0.92}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "磨砂玻璃贴纸"},
    options
  );
  materialMap["penBlue"] = createSculptMaterial(
    "penBlue",
    {"id": "penBlue", "name": "蓝色中性笔", "type": "physical", "qualityTier": "utility", "baseColor": "#1E4D8C", "color": "#1E4D8C", "albedo": {"dominant": "#1E4D8C", "secondary": ["#1E4D8C", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 0.38, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 1.0}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["纯色/低纹理部件，在主视角 1:1 下无可见高频表面纹理；颜色由基色与局部 Canvas decal 表达。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "蓝色中性笔"},
    options
  );
  materialMap["steam"] = createSculptMaterial(
    "steam",
    {"id": "steam", "name": "茶杯蒸汽", "type": "physical", "qualityTier": "utility", "baseColor": "#E8EDEA", "color": "#E8EDEA", "albedo": {"dominant": "#E8EDEA", "secondary": ["#E8EDEA", "#000000"], "samplingNotes": "参考目视取色。"}, "roughness": {"base": 1.0, "variation": 0.04, "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0}, "opacity": {"base": 0.12}, "ior": {"base": 1.5}, "thickness": {"base": 0.0}, "clearcoat": {"base": 0.0}, "clearcoatRoughness": {"base": 0.2}, "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "doubleSided": false, "textureless": {"declared": true, "evidence": ["运行时粒子卡；不是实体表面。"]}, "shaderNotes": ["工具材质：保持低 draw call 与低纹理占用；细节由几何/Canvas decal 提供。"], "notes": "茶杯蒸汽"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "\u529e\u516c\u4f4d\u573a\u666f\u6839\u8282\u70b9__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "办公位场景根节点", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "不可见结构根；场景包围体由桌面、隔断与书架定义，根节点不参与可见轮廓。", "geometryDescriptor": {"topologyIntent": "不可见结构根；场景包围体由桌面、隔断与书架定义，根节点不参与可见轮廓。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "invisible", "materialLayers": ["invisible"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 32, 32, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["invisible"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "\u529e\u516c\u4f4d\u573a\u666f\u6839\u8282\u70b9";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "办公位场景根节点", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "不可见结构根；场景包围体由桌面、隔断与书架定义，根节点不参与可见轮廓。", "geometryDescriptor": {"topologyIntent": "不可见结构根；场景包围体由桌面、隔断与书架定义，根节点不参与可见轮廓。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "invisible", "materialLayers": ["invisible"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 32, 32, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_desk_1 = makeAttachmentEndpoint(null);
  const node_desk_1 = new THREE.Group();
  node_desk_1.name = "\u684c\u9762\u4e0e\u4e0b\u5c42\u6846\u67b6__pivot";
  node_desk_1.scale.set(1, 1, 1);
  if (endpoint_desk_1) {
    node_desk_1.position.copy(endpoint_desk_1.start);
    node_desk_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_desk_1.position.set(0.0, 0.745, -0.05);
    node_desk_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_desk_1.userData.sculptComponent = {"id": "desk", "name": "桌面与下层框架", "level": "macro", "role": "desk-top", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "桌面是厚度 25 mm 的矩形板，前缘直、四角小圆角；可见上下表面与封边，是典型的装配实体而非有机体。", "geometryDescriptor": {"topologyIntent": "桌面是厚度 25 mm 的矩形板，前缘直、四角小圆角；可见上下表面与封边，是典型的装配实体而非有机体。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.025, "depth": 0.5, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.745, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "desk-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "leg-mount-fl", "localPosition": [-0.465, -0.372, 0.23]}, {"id": "leg-mount-fr", "localPosition": [0.465, -0.372, 0.23]}, {"id": "leg-mount-rl", "localPosition": [-0.465, -0.372, -0.22]}, {"id": "leg-mount-rr", "localPosition": [0.465, -0.372, -0.22]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.5], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "desk-edge-wear", "kind": "chip", "description": "前缘右侧 2–3 mm 浅色崩边。", "evidenceRef": "desk-details"}, {"id": "desk-edge-chamfer", "kind": "bevel", "description": "前缘 1 mm 倒角形成细高光。", "evidenceRef": "front-view"}, {"id": "grain-runout", "kind": "linework", "description": "桌面木纹沿 X 方向贯穿。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9}};
  node_desk_1.userData.actionProfile = {"animationRole": "desk-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "leg-mount-fl", "localPosition": [-0.465, -0.372, 0.23]}, {"id": "leg-mount-fr", "localPosition": [0.465, -0.372, 0.23]}, {"id": "leg-mount-rl", "localPosition": [-0.465, -0.372, -0.22]}, {"id": "leg-mount-rr", "localPosition": [0.465, -0.372, -0.22]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.5], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_desk_1);
  nodes["desk"] = node_desk_1;
  const mesh_desk_1Geometry = endpoint_desk_1
    ? new THREE.CylinderGeometry(endpoint_desk_1.endRadius, endpoint_desk_1.baseRadius, endpoint_desk_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_desk_1) {
    mesh_desk_1Geometry.scale(1.05, 0.025, 0.5);
  }
  const mesh_desk_1 = new THREE.Mesh(
    mesh_desk_1Geometry,
    materialMap["woodOak"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_desk_1.name = "\u684c\u9762\u4e0e\u4e0b\u5c42\u6846\u67b6";
  if (endpoint_desk_1) {
    mesh_desk_1.position.copy(endpoint_desk_1.midpoint);
    mesh_desk_1.quaternion.copy(endpoint_desk_1.quaternion);
  }
  mesh_desk_1.castShadow = options.castShadow ?? true;
  mesh_desk_1.receiveShadow = options.receiveShadow ?? true;
  mesh_desk_1.userData.sculptComponent = {"id": "desk", "name": "桌面与下层框架", "level": "macro", "role": "desk-top", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "桌面是厚度 25 mm 的矩形板，前缘直、四角小圆角；可见上下表面与封边，是典型的装配实体而非有机体。", "geometryDescriptor": {"topologyIntent": "桌面是厚度 25 mm 的矩形板，前缘直、四角小圆角；可见上下表面与封边，是典型的装配实体而非有机体。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.025, "depth": 0.5, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.745, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "desk-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "leg-mount-fl", "localPosition": [-0.465, -0.372, 0.23]}, {"id": "leg-mount-fr", "localPosition": [0.465, -0.372, 0.23]}, {"id": "leg-mount-rl", "localPosition": [-0.465, -0.372, -0.22]}, {"id": "leg-mount-rr", "localPosition": [0.465, -0.372, -0.22]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.5], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "desk-edge-wear", "kind": "chip", "description": "前缘右侧 2–3 mm 浅色崩边。", "evidenceRef": "desk-details"}, {"id": "desk-edge-chamfer", "kind": "bevel", "description": "前缘 1 mm 倒角形成细高光。", "evidenceRef": "front-view"}, {"id": "grain-runout", "kind": "linework", "description": "桌面木纹沿 X 方向贯穿。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9}};
  node_desk_1.add(mesh_desk_1);
  meshes["desk"] = mesh_desk_1;
  colliders["desk"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.5], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["desk-pivot"] ??= [];
  destructionGroups["desk-pivot"].push(node_desk_1);
  const socket_desk_leg_mount_fl_0 = new THREE.Object3D();
  socket_desk_leg_mount_fl_0.name = "leg-mount-fl";
  socket_desk_leg_mount_fl_0.position.set(-0.465, -0.372, 0.23);
  socket_desk_leg_mount_fl_0.rotation.set(0, 0, 0);
  socket_desk_leg_mount_fl_0.userData.socket = {"id": "leg-mount-fl", "localPosition": [-0.465, -0.372, 0.23]};
  node_desk_1.add(socket_desk_leg_mount_fl_0);
  sockets["desk:leg-mount-fl"] = socket_desk_leg_mount_fl_0;
  const socket_desk_leg_mount_fr_1 = new THREE.Object3D();
  socket_desk_leg_mount_fr_1.name = "leg-mount-fr";
  socket_desk_leg_mount_fr_1.position.set(0.465, -0.372, 0.23);
  socket_desk_leg_mount_fr_1.rotation.set(0, 0, 0);
  socket_desk_leg_mount_fr_1.userData.socket = {"id": "leg-mount-fr", "localPosition": [0.465, -0.372, 0.23]};
  node_desk_1.add(socket_desk_leg_mount_fr_1);
  sockets["desk:leg-mount-fr"] = socket_desk_leg_mount_fr_1;
  const socket_desk_leg_mount_rl_2 = new THREE.Object3D();
  socket_desk_leg_mount_rl_2.name = "leg-mount-rl";
  socket_desk_leg_mount_rl_2.position.set(-0.465, -0.372, -0.22);
  socket_desk_leg_mount_rl_2.rotation.set(0, 0, 0);
  socket_desk_leg_mount_rl_2.userData.socket = {"id": "leg-mount-rl", "localPosition": [-0.465, -0.372, -0.22]};
  node_desk_1.add(socket_desk_leg_mount_rl_2);
  sockets["desk:leg-mount-rl"] = socket_desk_leg_mount_rl_2;
  const socket_desk_leg_mount_rr_3 = new THREE.Object3D();
  socket_desk_leg_mount_rr_3.name = "leg-mount-rr";
  socket_desk_leg_mount_rr_3.position.set(0.465, -0.372, -0.22);
  socket_desk_leg_mount_rr_3.rotation.set(0, 0, 0);
  socket_desk_leg_mount_rr_3.userData.socket = {"id": "leg-mount-rr", "localPosition": [0.465, -0.372, -0.22]};
  node_desk_1.add(socket_desk_leg_mount_rr_3);
  sockets["desk:leg-mount-rr"] = socket_desk_leg_mount_rr_3;

  const endpoint_deskPostFL_2 = makeAttachmentEndpoint(null);
  const node_deskPostFL_2 = new THREE.Group();
  node_deskPostFL_2.name = "\u684c\u817f FL__pivot";
  node_deskPostFL_2.scale.set(1, 1, 1);
  if (endpoint_deskPostFL_2) {
    node_deskPostFL_2.position.copy(endpoint_deskPostFL_2.start);
    node_deskPostFL_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskPostFL_2.position.set(-0.465, -0.372, 0.23);
    node_deskPostFL_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskPostFL_2.userData.sculptComponent = {"id": "deskPostFL", "name": "桌腿 FL", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.465, -0.372, 0.23], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostFL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostFL_2.userData.actionProfile = {"animationRole": "deskPostFL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskPostFL_2);
  nodes["deskPostFL"] = node_deskPostFL_2;
  const mesh_deskPostFL_2Geometry = endpoint_deskPostFL_2
    ? new THREE.CylinderGeometry(endpoint_deskPostFL_2.endRadius, endpoint_deskPostFL_2.baseRadius, endpoint_deskPostFL_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskPostFL_2) {
    mesh_deskPostFL_2Geometry.scale(0.035, 0.742, 0.035);
  }
  const mesh_deskPostFL_2 = new THREE.Mesh(
    mesh_deskPostFL_2Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskPostFL_2.name = "\u684c\u817f FL";
  if (endpoint_deskPostFL_2) {
    mesh_deskPostFL_2.position.copy(endpoint_deskPostFL_2.midpoint);
    mesh_deskPostFL_2.quaternion.copy(endpoint_deskPostFL_2.quaternion);
  }
  mesh_deskPostFL_2.castShadow = options.castShadow ?? true;
  mesh_deskPostFL_2.receiveShadow = options.receiveShadow ?? true;
  mesh_deskPostFL_2.userData.sculptComponent = {"id": "deskPostFL", "name": "桌腿 FL", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.465, -0.372, 0.23], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostFL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostFL_2.add(mesh_deskPostFL_2);
  meshes["deskPostFL"] = mesh_deskPostFL_2;
  colliders["deskPostFL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskPostFL-pivot"] ??= [];
  destructionGroups["deskPostFL-pivot"].push(node_deskPostFL_2);

  const endpoint_deskPostFR_3 = makeAttachmentEndpoint(null);
  const node_deskPostFR_3 = new THREE.Group();
  node_deskPostFR_3.name = "\u684c\u817f FR__pivot";
  node_deskPostFR_3.scale.set(1, 1, 1);
  if (endpoint_deskPostFR_3) {
    node_deskPostFR_3.position.copy(endpoint_deskPostFR_3.start);
    node_deskPostFR_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskPostFR_3.position.set(0.465, -0.372, 0.23);
    node_deskPostFR_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskPostFR_3.userData.sculptComponent = {"id": "deskPostFR", "name": "桌腿 FR", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.465, -0.372, 0.23], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostFR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostFR_3.userData.actionProfile = {"animationRole": "deskPostFR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskPostFR_3);
  nodes["deskPostFR"] = node_deskPostFR_3;
  const mesh_deskPostFR_3Geometry = endpoint_deskPostFR_3
    ? new THREE.CylinderGeometry(endpoint_deskPostFR_3.endRadius, endpoint_deskPostFR_3.baseRadius, endpoint_deskPostFR_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskPostFR_3) {
    mesh_deskPostFR_3Geometry.scale(0.035, 0.742, 0.035);
  }
  const mesh_deskPostFR_3 = new THREE.Mesh(
    mesh_deskPostFR_3Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskPostFR_3.name = "\u684c\u817f FR";
  if (endpoint_deskPostFR_3) {
    mesh_deskPostFR_3.position.copy(endpoint_deskPostFR_3.midpoint);
    mesh_deskPostFR_3.quaternion.copy(endpoint_deskPostFR_3.quaternion);
  }
  mesh_deskPostFR_3.castShadow = options.castShadow ?? true;
  mesh_deskPostFR_3.receiveShadow = options.receiveShadow ?? true;
  mesh_deskPostFR_3.userData.sculptComponent = {"id": "deskPostFR", "name": "桌腿 FR", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.465, -0.372, 0.23], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostFR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostFR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostFR_3.add(mesh_deskPostFR_3);
  meshes["deskPostFR"] = mesh_deskPostFR_3;
  colliders["deskPostFR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskPostFR-pivot"] ??= [];
  destructionGroups["deskPostFR-pivot"].push(node_deskPostFR_3);

  const endpoint_deskPostRL_4 = makeAttachmentEndpoint(null);
  const node_deskPostRL_4 = new THREE.Group();
  node_deskPostRL_4.name = "\u684c\u817f RL__pivot";
  node_deskPostRL_4.scale.set(1, 1, 1);
  if (endpoint_deskPostRL_4) {
    node_deskPostRL_4.position.copy(endpoint_deskPostRL_4.start);
    node_deskPostRL_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskPostRL_4.position.set(-0.465, -0.372, -0.22);
    node_deskPostRL_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskPostRL_4.userData.sculptComponent = {"id": "deskPostRL", "name": "桌腿 RL", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.465, -0.372, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostRL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostRL_4.userData.actionProfile = {"animationRole": "deskPostRL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskPostRL_4);
  nodes["deskPostRL"] = node_deskPostRL_4;
  const mesh_deskPostRL_4Geometry = endpoint_deskPostRL_4
    ? new THREE.CylinderGeometry(endpoint_deskPostRL_4.endRadius, endpoint_deskPostRL_4.baseRadius, endpoint_deskPostRL_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskPostRL_4) {
    mesh_deskPostRL_4Geometry.scale(0.035, 0.742, 0.035);
  }
  const mesh_deskPostRL_4 = new THREE.Mesh(
    mesh_deskPostRL_4Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskPostRL_4.name = "\u684c\u817f RL";
  if (endpoint_deskPostRL_4) {
    mesh_deskPostRL_4.position.copy(endpoint_deskPostRL_4.midpoint);
    mesh_deskPostRL_4.quaternion.copy(endpoint_deskPostRL_4.quaternion);
  }
  mesh_deskPostRL_4.castShadow = options.castShadow ?? true;
  mesh_deskPostRL_4.receiveShadow = options.receiveShadow ?? true;
  mesh_deskPostRL_4.userData.sculptComponent = {"id": "deskPostRL", "name": "桌腿 RL", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.465, -0.372, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostRL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostRL_4.add(mesh_deskPostRL_4);
  meshes["deskPostRL"] = mesh_deskPostRL_4;
  colliders["deskPostRL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskPostRL-pivot"] ??= [];
  destructionGroups["deskPostRL-pivot"].push(node_deskPostRL_4);

  const endpoint_deskPostRR_5 = makeAttachmentEndpoint(null);
  const node_deskPostRR_5 = new THREE.Group();
  node_deskPostRR_5.name = "\u684c\u817f RR__pivot";
  node_deskPostRR_5.scale.set(1, 1, 1);
  if (endpoint_deskPostRR_5) {
    node_deskPostRR_5.position.copy(endpoint_deskPostRR_5.start);
    node_deskPostRR_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskPostRR_5.position.set(0.465, -0.372, -0.22);
    node_deskPostRR_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskPostRR_5.userData.sculptComponent = {"id": "deskPostRR", "name": "桌腿 RR", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.465, -0.372, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostRR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostRR_5.userData.actionProfile = {"animationRole": "deskPostRR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskPostRR_5);
  nodes["deskPostRR"] = node_deskPostRR_5;
  const mesh_deskPostRR_5Geometry = endpoint_deskPostRR_5
    ? new THREE.CylinderGeometry(endpoint_deskPostRR_5.endRadius, endpoint_deskPostRR_5.baseRadius, endpoint_deskPostRR_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskPostRR_5) {
    mesh_deskPostRR_5Geometry.scale(0.035, 0.742, 0.035);
  }
  const mesh_deskPostRR_5 = new THREE.Mesh(
    mesh_deskPostRR_5Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskPostRR_5.name = "\u684c\u817f RR";
  if (endpoint_deskPostRR_5) {
    mesh_deskPostRR_5.position.copy(endpoint_deskPostRR_5.midpoint);
    mesh_deskPostRR_5.quaternion.copy(endpoint_deskPostRR_5.quaternion);
  }
  mesh_deskPostRR_5.castShadow = options.castShadow ?? true;
  mesh_deskPostRR_5.receiveShadow = options.receiveShadow ?? true;
  mesh_deskPostRR_5.userData.sculptComponent = {"id": "deskPostRR", "name": "桌腿 RR", "level": "meso", "role": "furniture-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "geometryDescriptor": {"topologyIntent": "方形金属桌腿，垂直支撑桌面；截面为矩形，接触地面处以脚垫收口。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.001, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.035, "height": 0.742, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.465, -0.372, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskPostRR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskPostRR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskPostRR_5.add(mesh_deskPostRR_5);
  meshes["deskPostRR"] = mesh_deskPostRR_5;
  colliders["deskPostRR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.742, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskPostRR-pivot"] ??= [];
  destructionGroups["deskPostRR-pivot"].push(node_deskPostRR_5);

  const endpoint_deskRailFront_6 = makeAttachmentEndpoint(null);
  const node_deskRailFront_6 = new THREE.Group();
  node_deskRailFront_6.name = "\u684c\u4e0b\u524d\u6a2a\u6881__pivot";
  node_deskRailFront_6.scale.set(1, 1, 1);
  if (endpoint_deskRailFront_6) {
    node_deskRailFront_6.position.copy(endpoint_deskRailFront_6.start);
    node_deskRailFront_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskRailFront_6.position.set(0.0, -0.345, 0.21);
    node_deskRailFront_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskRailFront_6.userData.sculptComponent = {"id": "deskRailFront", "name": "桌下前横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "连接左右桌腿的前横梁，矩形截面。", "geometryDescriptor": {"topologyIntent": "连接左右桌腿的前横梁，矩形截面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.94, "height": 0.04, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.345, 0.21], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskRailFront-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailFront-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskRailFront_6.userData.actionProfile = {"animationRole": "deskRailFront-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailFront-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskRailFront_6);
  nodes["deskRailFront"] = node_deskRailFront_6;
  const mesh_deskRailFront_6Geometry = endpoint_deskRailFront_6
    ? new THREE.CylinderGeometry(endpoint_deskRailFront_6.endRadius, endpoint_deskRailFront_6.baseRadius, endpoint_deskRailFront_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskRailFront_6) {
    mesh_deskRailFront_6Geometry.scale(0.94, 0.04, 0.03);
  }
  const mesh_deskRailFront_6 = new THREE.Mesh(
    mesh_deskRailFront_6Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskRailFront_6.name = "\u684c\u4e0b\u524d\u6a2a\u6881";
  if (endpoint_deskRailFront_6) {
    mesh_deskRailFront_6.position.copy(endpoint_deskRailFront_6.midpoint);
    mesh_deskRailFront_6.quaternion.copy(endpoint_deskRailFront_6.quaternion);
  }
  mesh_deskRailFront_6.castShadow = options.castShadow ?? true;
  mesh_deskRailFront_6.receiveShadow = options.receiveShadow ?? true;
  mesh_deskRailFront_6.userData.sculptComponent = {"id": "deskRailFront", "name": "桌下前横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "连接左右桌腿的前横梁，矩形截面。", "geometryDescriptor": {"topologyIntent": "连接左右桌腿的前横梁，矩形截面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.94, "height": 0.04, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.345, 0.21], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskRailFront-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailFront-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskRailFront_6.add(mesh_deskRailFront_6);
  meshes["deskRailFront"] = mesh_deskRailFront_6;
  colliders["deskRailFront"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskRailFront-pivot"] ??= [];
  destructionGroups["deskRailFront-pivot"].push(node_deskRailFront_6);

  const endpoint_deskRailBack_7 = makeAttachmentEndpoint(null);
  const node_deskRailBack_7 = new THREE.Group();
  node_deskRailBack_7.name = "\u684c\u4e0b\u540e\u6a2a\u6881__pivot";
  node_deskRailBack_7.scale.set(1, 1, 1);
  if (endpoint_deskRailBack_7) {
    node_deskRailBack_7.position.copy(endpoint_deskRailBack_7.start);
    node_deskRailBack_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_deskRailBack_7.position.set(0.0, -0.345, -0.22);
    node_deskRailBack_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_deskRailBack_7.userData.sculptComponent = {"id": "deskRailBack", "name": "桌下后横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "连接左右桌腿的后横梁，矩形截面。", "geometryDescriptor": {"topologyIntent": "连接左右桌腿的后横梁，矩形截面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.94, "height": 0.04, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.345, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskRailBack_7.userData.actionProfile = {"animationRole": "deskRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["desk"] ?? root).add(node_deskRailBack_7);
  nodes["deskRailBack"] = node_deskRailBack_7;
  const mesh_deskRailBack_7Geometry = endpoint_deskRailBack_7
    ? new THREE.CylinderGeometry(endpoint_deskRailBack_7.endRadius, endpoint_deskRailBack_7.baseRadius, endpoint_deskRailBack_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_deskRailBack_7) {
    mesh_deskRailBack_7Geometry.scale(0.94, 0.04, 0.03);
  }
  const mesh_deskRailBack_7 = new THREE.Mesh(
    mesh_deskRailBack_7Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deskRailBack_7.name = "\u684c\u4e0b\u540e\u6a2a\u6881";
  if (endpoint_deskRailBack_7) {
    mesh_deskRailBack_7.position.copy(endpoint_deskRailBack_7.midpoint);
    mesh_deskRailBack_7.quaternion.copy(endpoint_deskRailBack_7.quaternion);
  }
  mesh_deskRailBack_7.castShadow = options.castShadow ?? true;
  mesh_deskRailBack_7.receiveShadow = options.receiveShadow ?? true;
  mesh_deskRailBack_7.userData.sculptComponent = {"id": "deskRailBack", "name": "桌下后横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "连接左右桌腿的后横梁，矩形截面。", "geometryDescriptor": {"topologyIntent": "连接左右桌腿的后横梁，矩形截面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "desk", "attachment": null, "dimensions": {"width": 0.94, "height": 0.04, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.345, -0.22], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "deskRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "deskRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_deskRailBack_7.add(mesh_deskRailBack_7);
  meshes["deskRailBack"] = mesh_deskRailBack_7;
  colliders["deskRailBack"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.94, 0.04, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["deskRailBack-pivot"] ??= [];
  destructionGroups["deskRailBack-pivot"].push(node_deskRailBack_7);

  const endpoint_partition_8 = makeAttachmentEndpoint(null);
  const node_partition_8 = new THREE.Group();
  node_partition_8.name = "\u4e09\u9762\u9694\u65ad\u4e0e\u78e8\u7802\u73bb\u7483__pivot";
  node_partition_8.scale.set(1, 1, 1);
  if (endpoint_partition_8) {
    node_partition_8.position.copy(endpoint_partition_8.start);
    node_partition_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_partition_8.position.set(0.0, 1.0525, -0.315);
    node_partition_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_partition_8.userData.sculptComponent = {"id": "partition", "name": "三面隔断与磨砂玻璃", "level": "macro", "role": "back-panel", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "背板是 1050×590×30 mm 的矩形木饰面板，上接书架；可见竖直直纹与平直边缘。", "geometryDescriptor": {"topologyIntent": "背板是 1050×590×30 mm 的矩形木饰面板，上接书架；可见竖直直纹与平直边缘。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.001, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.59, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 1.0525, -0.315], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "partition-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left", "localPosition": [-0.51, 0.16, 0.25]}, {"id": "glass-right", "localPosition": [0.51, 0.16, 0.25]}, {"id": "hook", "localPosition": [0.505, 0.2475, 0.345]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.59, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "partition-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mullion-micro-bevel", "kind": "bevel", "description": "铝立柱 1.5–2 mm 倒角与双浅槽。", "evidenceRef": "right-three-quarter"}, {"id": "glass-retainer-groove", "kind": "groove", "description": "压条与玻璃之间 8 mm 深暗缝。", "evidenceRef": "right-three-quarter"}, {"id": "back-panel-seam", "kind": "seam", "description": "背板与侧板的铝压条接缝。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9}};
  node_partition_8.userData.actionProfile = {"animationRole": "partition-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left", "localPosition": [-0.51, 0.16, 0.25]}, {"id": "glass-right", "localPosition": [0.51, 0.16, 0.25]}, {"id": "hook", "localPosition": [0.505, 0.2475, 0.345]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.59, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "partition-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_partition_8);
  nodes["partition"] = node_partition_8;
  const mesh_partition_8Geometry = endpoint_partition_8
    ? new THREE.CylinderGeometry(endpoint_partition_8.endRadius, endpoint_partition_8.baseRadius, endpoint_partition_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_partition_8) {
    mesh_partition_8Geometry.scale(1.05, 0.59, 0.03);
  }
  const mesh_partition_8 = new THREE.Mesh(
    mesh_partition_8Geometry,
    materialMap["woodOak"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_partition_8.name = "\u4e09\u9762\u9694\u65ad\u4e0e\u78e8\u7802\u73bb\u7483";
  if (endpoint_partition_8) {
    mesh_partition_8.position.copy(endpoint_partition_8.midpoint);
    mesh_partition_8.quaternion.copy(endpoint_partition_8.quaternion);
  }
  mesh_partition_8.castShadow = options.castShadow ?? true;
  mesh_partition_8.receiveShadow = options.receiveShadow ?? true;
  mesh_partition_8.userData.sculptComponent = {"id": "partition", "name": "三面隔断与磨砂玻璃", "level": "macro", "role": "back-panel", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "背板是 1050×590×30 mm 的矩形木饰面板，上接书架；可见竖直直纹与平直边缘。", "geometryDescriptor": {"topologyIntent": "背板是 1050×590×30 mm 的矩形木饰面板，上接书架；可见竖直直纹与平直边缘。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.001, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.59, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 1.0525, -0.315], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "partition-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left", "localPosition": [-0.51, 0.16, 0.25]}, {"id": "glass-right", "localPosition": [0.51, 0.16, 0.25]}, {"id": "hook", "localPosition": [0.505, 0.2475, 0.345]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.59, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "partition-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mullion-micro-bevel", "kind": "bevel", "description": "铝立柱 1.5–2 mm 倒角与双浅槽。", "evidenceRef": "right-three-quarter"}, {"id": "glass-retainer-groove", "kind": "groove", "description": "压条与玻璃之间 8 mm 深暗缝。", "evidenceRef": "right-three-quarter"}, {"id": "back-panel-seam", "kind": "seam", "description": "背板与侧板的铝压条接缝。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9}};
  node_partition_8.add(mesh_partition_8);
  meshes["partition"] = mesh_partition_8;
  colliders["partition"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.59, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["partition-pivot"] ??= [];
  destructionGroups["partition-pivot"].push(node_partition_8);
  const socket_partition_glass_left_0 = new THREE.Object3D();
  socket_partition_glass_left_0.name = "glass-left";
  socket_partition_glass_left_0.position.set(-0.51, 0.16, 0.25);
  socket_partition_glass_left_0.rotation.set(0, 0, 0);
  socket_partition_glass_left_0.userData.socket = {"id": "glass-left", "localPosition": [-0.51, 0.16, 0.25]};
  node_partition_8.add(socket_partition_glass_left_0);
  sockets["partition:glass-left"] = socket_partition_glass_left_0;
  const socket_partition_glass_right_1 = new THREE.Object3D();
  socket_partition_glass_right_1.name = "glass-right";
  socket_partition_glass_right_1.position.set(0.51, 0.16, 0.25);
  socket_partition_glass_right_1.rotation.set(0, 0, 0);
  socket_partition_glass_right_1.userData.socket = {"id": "glass-right", "localPosition": [0.51, 0.16, 0.25]};
  node_partition_8.add(socket_partition_glass_right_1);
  sockets["partition:glass-right"] = socket_partition_glass_right_1;
  const socket_partition_hook_2 = new THREE.Object3D();
  socket_partition_hook_2.name = "hook";
  socket_partition_hook_2.position.set(0.505, 0.2475, 0.345);
  socket_partition_hook_2.rotation.set(0, 0, 0);
  socket_partition_hook_2.userData.socket = {"id": "hook", "localPosition": [0.505, 0.2475, 0.345]};
  node_partition_8.add(socket_partition_hook_2);
  sockets["partition:hook"] = socket_partition_hook_2;

  const endpoint_leftSidePanel_9 = makeAttachmentEndpoint(null);
  const node_leftSidePanel_9 = new THREE.Group();
  node_leftSidePanel_9.name = "\u5de6\u4fa7\u6728\u9970\u9762\u677f__pivot";
  node_leftSidePanel_9.scale.set(1, 1, 1);
  if (endpoint_leftSidePanel_9) {
    node_leftSidePanel_9.position.copy(endpoint_leftSidePanel_9.start);
    node_leftSidePanel_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leftSidePanel_9.position.set(-0.515, -0.135, 0.25);
    node_leftSidePanel_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_leftSidePanel_9.userData.sculptComponent = {"id": "leftSidePanel", "name": "左侧木饰面板", "level": "meso", "role": "side-panel", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深，竖直直纹；外侧与桌沿齐平。", "geometryDescriptor": {"topologyIntent": "左隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深，竖直直纹；外侧与桌沿齐平。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.02, "height": 0.32, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.515, -0.135, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "side-panel-grain", "kind": "linework", "description": "侧板木纹竖向。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_leftSidePanel_9.userData.actionProfile = {"animationRole": "leftSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_leftSidePanel_9);
  nodes["leftSidePanel"] = node_leftSidePanel_9;
  const mesh_leftSidePanel_9Geometry = endpoint_leftSidePanel_9
    ? new THREE.CylinderGeometry(endpoint_leftSidePanel_9.endRadius, endpoint_leftSidePanel_9.baseRadius, endpoint_leftSidePanel_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_leftSidePanel_9) {
    mesh_leftSidePanel_9Geometry.scale(0.02, 0.32, 0.47);
  }
  const mesh_leftSidePanel_9 = new THREE.Mesh(
    mesh_leftSidePanel_9Geometry,
    materialMap["woodOak"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leftSidePanel_9.name = "\u5de6\u4fa7\u6728\u9970\u9762\u677f";
  if (endpoint_leftSidePanel_9) {
    mesh_leftSidePanel_9.position.copy(endpoint_leftSidePanel_9.midpoint);
    mesh_leftSidePanel_9.quaternion.copy(endpoint_leftSidePanel_9.quaternion);
  }
  mesh_leftSidePanel_9.castShadow = options.castShadow ?? true;
  mesh_leftSidePanel_9.receiveShadow = options.receiveShadow ?? true;
  mesh_leftSidePanel_9.userData.sculptComponent = {"id": "leftSidePanel", "name": "左侧木饰面板", "level": "meso", "role": "side-panel", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深，竖直直纹；外侧与桌沿齐平。", "geometryDescriptor": {"topologyIntent": "左隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深，竖直直纹；外侧与桌沿齐平。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.02, "height": 0.32, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.515, -0.135, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "side-panel-grain", "kind": "linework", "description": "侧板木纹竖向。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_leftSidePanel_9.add(mesh_leftSidePanel_9);
  meshes["leftSidePanel"] = mesh_leftSidePanel_9;
  colliders["leftSidePanel"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["leftSidePanel-pivot"] ??= [];
  destructionGroups["leftSidePanel-pivot"].push(node_leftSidePanel_9);

  const endpoint_rightSidePanel_10 = makeAttachmentEndpoint(null);
  const node_rightSidePanel_10 = new THREE.Group();
  node_rightSidePanel_10.name = "\u53f3\u4fa7\u6728\u9970\u9762\u677f__pivot";
  node_rightSidePanel_10.scale.set(1, 1, 1);
  if (endpoint_rightSidePanel_10) {
    node_rightSidePanel_10.position.copy(endpoint_rightSidePanel_10.start);
    node_rightSidePanel_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rightSidePanel_10.position.set(0.515, -0.135, 0.25);
    node_rightSidePanel_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_rightSidePanel_10.userData.sculptComponent = {"id": "rightSidePanel", "name": "右侧木饰面板", "level": "meso", "role": "side-panel", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深；外侧与桌沿齐平。", "geometryDescriptor": {"topologyIntent": "右隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深；外侧与桌沿齐平。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.02, "height": 0.32, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.515, -0.135, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_rightSidePanel_10.userData.actionProfile = {"animationRole": "rightSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_rightSidePanel_10);
  nodes["rightSidePanel"] = node_rightSidePanel_10;
  const mesh_rightSidePanel_10Geometry = endpoint_rightSidePanel_10
    ? new THREE.CylinderGeometry(endpoint_rightSidePanel_10.endRadius, endpoint_rightSidePanel_10.baseRadius, endpoint_rightSidePanel_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_rightSidePanel_10) {
    mesh_rightSidePanel_10Geometry.scale(0.02, 0.32, 0.47);
  }
  const mesh_rightSidePanel_10 = new THREE.Mesh(
    mesh_rightSidePanel_10Geometry,
    materialMap["woodOak"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rightSidePanel_10.name = "\u53f3\u4fa7\u6728\u9970\u9762\u677f";
  if (endpoint_rightSidePanel_10) {
    mesh_rightSidePanel_10.position.copy(endpoint_rightSidePanel_10.midpoint);
    mesh_rightSidePanel_10.quaternion.copy(endpoint_rightSidePanel_10.quaternion);
  }
  mesh_rightSidePanel_10.castShadow = options.castShadow ?? true;
  mesh_rightSidePanel_10.receiveShadow = options.receiveShadow ?? true;
  mesh_rightSidePanel_10.userData.sculptComponent = {"id": "rightSidePanel", "name": "右侧木饰面板", "level": "meso", "role": "side-panel", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深；外侧与桌沿齐平。", "geometryDescriptor": {"topologyIntent": "右隔断下段为 320 mm 高木饰面，厚 20 mm，贯穿 470 mm 桌深；外侧与桌沿齐平。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.02, "height": 0.32, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.515, -0.135, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightSidePanel-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightSidePanel-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_rightSidePanel_10.add(mesh_rightSidePanel_10);
  meshes["rightSidePanel"] = mesh_rightSidePanel_10;
  colliders["rightSidePanel"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.32, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["rightSidePanel-pivot"] ??= [];
  destructionGroups["rightSidePanel-pivot"].push(node_rightSidePanel_10);

  const endpoint_leftGlass_11 = makeAttachmentEndpoint(null);
  const node_leftGlass_11 = new THREE.Group();
  node_leftGlass_11.name = "\u5de6\u78e8\u7802\u73bb\u7483__pivot";
  node_leftGlass_11.scale.set(1, 1, 1);
  if (endpoint_leftGlass_11) {
    node_leftGlass_11.position.copy(endpoint_leftGlass_11.start);
    node_leftGlass_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leftGlass_11.position.set(-0.51, 0.16, 0.25);
    node_leftGlass_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_leftGlass_11.userData.sculptComponent = {"id": "leftGlass", "name": "左磨砂玻璃", "level": "meso", "role": "partition-glass", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "厚度 8 mm、高 270 mm 的磨砂玻璃板，嵌于铝框中，四周留 15 mm 压条。", "geometryDescriptor": {"topologyIntent": "厚度 8 mm、高 270 mm 的磨砂玻璃板，嵌于铝框中，四周留 15 mm 压条。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.008, "height": 0.27, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0.16, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "frostedGlass", "materialLayers": ["frostedGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "left-glass-frost", "kind": "stain", "description": "磨砂层漫透光与轻微雾带。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 212, 208, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_leftGlass_11.userData.actionProfile = {"animationRole": "leftGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_leftGlass_11);
  nodes["leftGlass"] = node_leftGlass_11;
  const mesh_leftGlass_11Geometry = endpoint_leftGlass_11
    ? new THREE.CylinderGeometry(endpoint_leftGlass_11.endRadius, endpoint_leftGlass_11.baseRadius, endpoint_leftGlass_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_leftGlass_11) {
    mesh_leftGlass_11Geometry.scale(0.008, 0.27, 0.47);
  }
  const mesh_leftGlass_11 = new THREE.Mesh(
    mesh_leftGlass_11Geometry,
    materialMap["frostedGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leftGlass_11.name = "\u5de6\u78e8\u7802\u73bb\u7483";
  if (endpoint_leftGlass_11) {
    mesh_leftGlass_11.position.copy(endpoint_leftGlass_11.midpoint);
    mesh_leftGlass_11.quaternion.copy(endpoint_leftGlass_11.quaternion);
  }
  mesh_leftGlass_11.castShadow = options.castShadow ?? true;
  mesh_leftGlass_11.receiveShadow = options.receiveShadow ?? true;
  mesh_leftGlass_11.userData.sculptComponent = {"id": "leftGlass", "name": "左磨砂玻璃", "level": "meso", "role": "partition-glass", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "厚度 8 mm、高 270 mm 的磨砂玻璃板，嵌于铝框中，四周留 15 mm 压条。", "geometryDescriptor": {"topologyIntent": "厚度 8 mm、高 270 mm 的磨砂玻璃板，嵌于铝框中，四周留 15 mm 压条。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.008, "height": 0.27, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0.16, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "frostedGlass", "materialLayers": ["frostedGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "left-glass-frost", "kind": "stain", "description": "磨砂层漫透光与轻微雾带。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 212, 208, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_leftGlass_11.add(mesh_leftGlass_11);
  meshes["leftGlass"] = mesh_leftGlass_11;
  colliders["leftGlass"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["leftGlass-pivot"] ??= [];
  destructionGroups["leftGlass-pivot"].push(node_leftGlass_11);

  const endpoint_rightGlass_12 = makeAttachmentEndpoint(null);
  const node_rightGlass_12 = new THREE.Group();
  node_rightGlass_12.name = "\u53f3\u78e8\u7802\u73bb\u7483__pivot";
  node_rightGlass_12.scale.set(1, 1, 1);
  if (endpoint_rightGlass_12) {
    node_rightGlass_12.position.copy(endpoint_rightGlass_12.start);
    node_rightGlass_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rightGlass_12.position.set(0.51, 0.16, 0.25);
    node_rightGlass_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_rightGlass_12.userData.sculptComponent = {"id": "rightGlass", "name": "右磨砂玻璃", "level": "meso", "role": "partition-glass", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "厚度 8 mm、高 270 mm 的磨砂玻璃板，右侧悬挂水壶。", "geometryDescriptor": {"topologyIntent": "厚度 8 mm、高 270 mm 的磨砂玻璃板，右侧悬挂水壶。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.008, "height": 0.27, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0.16, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "frostedGlass", "materialLayers": ["frostedGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 212, 208, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_rightGlass_12.userData.actionProfile = {"animationRole": "rightGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_rightGlass_12);
  nodes["rightGlass"] = node_rightGlass_12;
  const mesh_rightGlass_12Geometry = endpoint_rightGlass_12
    ? new THREE.CylinderGeometry(endpoint_rightGlass_12.endRadius, endpoint_rightGlass_12.baseRadius, endpoint_rightGlass_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_rightGlass_12) {
    mesh_rightGlass_12Geometry.scale(0.008, 0.27, 0.47);
  }
  const mesh_rightGlass_12 = new THREE.Mesh(
    mesh_rightGlass_12Geometry,
    materialMap["frostedGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rightGlass_12.name = "\u53f3\u78e8\u7802\u73bb\u7483";
  if (endpoint_rightGlass_12) {
    mesh_rightGlass_12.position.copy(endpoint_rightGlass_12.midpoint);
    mesh_rightGlass_12.quaternion.copy(endpoint_rightGlass_12.quaternion);
  }
  mesh_rightGlass_12.castShadow = options.castShadow ?? true;
  mesh_rightGlass_12.receiveShadow = options.receiveShadow ?? true;
  mesh_rightGlass_12.userData.sculptComponent = {"id": "rightGlass", "name": "右磨砂玻璃", "level": "meso", "role": "partition-glass", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "厚度 8 mm、高 270 mm 的磨砂玻璃板，右侧悬挂水壶。", "geometryDescriptor": {"topologyIntent": "厚度 8 mm、高 270 mm 的磨砂玻璃板，右侧悬挂水壶。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.008, "height": 0.27, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0.16, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightGlass-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightGlass-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "frostedGlass", "materialLayers": ["frostedGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 212, 208, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_rightGlass_12.add(mesh_rightGlass_12);
  meshes["rightGlass"] = mesh_rightGlass_12;
  colliders["rightGlass"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.27, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["rightGlass-pivot"] ??= [];
  destructionGroups["rightGlass-pivot"].push(node_rightGlass_12);

  const endpoint_leftMullion_13 = makeAttachmentEndpoint(null);
  const node_leftMullion_13 = new THREE.Group();
  node_leftMullion_13.name = "\u5de6\u540e\u94dd\u7acb\u67f1__pivot";
  node_leftMullion_13.scale.set(1, 1, 1);
  if (endpoint_leftMullion_13) {
    node_leftMullion_13.position.copy(endpoint_leftMullion_13.start);
    node_leftMullion_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leftMullion_13.position.set(-0.51, 0.0, 0.03);
    node_leftMullion_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_leftMullion_13.userData.sculptComponent = {"id": "leftMullion", "name": "左后铝立柱", "level": "meso", "role": "frame-mullion", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "40×40 mm 铝立柱，正面 2 mm 倒角与两道浅槽。", "geometryDescriptor": {"topologyIntent": "40×40 mm 铝立柱，正面 2 mm 倒角与两道浅槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.59, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "left-mullion-groove", "kind": "groove", "description": "立柱纵向浅槽。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftMullion_13.userData.actionProfile = {"animationRole": "leftMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_leftMullion_13);
  nodes["leftMullion"] = node_leftMullion_13;
  const mesh_leftMullion_13Geometry = endpoint_leftMullion_13
    ? new THREE.CylinderGeometry(endpoint_leftMullion_13.endRadius, endpoint_leftMullion_13.baseRadius, endpoint_leftMullion_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_leftMullion_13) {
    mesh_leftMullion_13Geometry.scale(0.04, 0.59, 0.04);
  }
  const mesh_leftMullion_13 = new THREE.Mesh(
    mesh_leftMullion_13Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leftMullion_13.name = "\u5de6\u540e\u94dd\u7acb\u67f1";
  if (endpoint_leftMullion_13) {
    mesh_leftMullion_13.position.copy(endpoint_leftMullion_13.midpoint);
    mesh_leftMullion_13.quaternion.copy(endpoint_leftMullion_13.quaternion);
  }
  mesh_leftMullion_13.castShadow = options.castShadow ?? true;
  mesh_leftMullion_13.receiveShadow = options.receiveShadow ?? true;
  mesh_leftMullion_13.userData.sculptComponent = {"id": "leftMullion", "name": "左后铝立柱", "level": "meso", "role": "frame-mullion", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "40×40 mm 铝立柱，正面 2 mm 倒角与两道浅槽。", "geometryDescriptor": {"topologyIntent": "40×40 mm 铝立柱，正面 2 mm 倒角与两道浅槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.59, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "left-mullion-groove", "kind": "groove", "description": "立柱纵向浅槽。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftMullion_13.add(mesh_leftMullion_13);
  meshes["leftMullion"] = mesh_leftMullion_13;
  colliders["leftMullion"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["leftMullion-pivot"] ??= [];
  destructionGroups["leftMullion-pivot"].push(node_leftMullion_13);

  const endpoint_rightMullion_14 = makeAttachmentEndpoint(null);
  const node_rightMullion_14 = new THREE.Group();
  node_rightMullion_14.name = "\u53f3\u540e\u94dd\u7acb\u67f1__pivot";
  node_rightMullion_14.scale.set(1, 1, 1);
  if (endpoint_rightMullion_14) {
    node_rightMullion_14.position.copy(endpoint_rightMullion_14.start);
    node_rightMullion_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rightMullion_14.position.set(0.51, 0.0, 0.03);
    node_rightMullion_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_rightMullion_14.userData.sculptComponent = {"id": "rightMullion", "name": "右后铝立柱", "level": "meso", "role": "frame-mullion", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "40×40 mm 铝立柱，右侧主要承重构件。", "geometryDescriptor": {"topologyIntent": "40×40 mm 铝立柱，右侧主要承重构件。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.59, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rightMullion_14.userData.actionProfile = {"animationRole": "rightMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_rightMullion_14);
  nodes["rightMullion"] = node_rightMullion_14;
  const mesh_rightMullion_14Geometry = endpoint_rightMullion_14
    ? new THREE.CylinderGeometry(endpoint_rightMullion_14.endRadius, endpoint_rightMullion_14.baseRadius, endpoint_rightMullion_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_rightMullion_14) {
    mesh_rightMullion_14Geometry.scale(0.04, 0.59, 0.04);
  }
  const mesh_rightMullion_14 = new THREE.Mesh(
    mesh_rightMullion_14Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rightMullion_14.name = "\u53f3\u540e\u94dd\u7acb\u67f1";
  if (endpoint_rightMullion_14) {
    mesh_rightMullion_14.position.copy(endpoint_rightMullion_14.midpoint);
    mesh_rightMullion_14.quaternion.copy(endpoint_rightMullion_14.quaternion);
  }
  mesh_rightMullion_14.castShadow = options.castShadow ?? true;
  mesh_rightMullion_14.receiveShadow = options.receiveShadow ?? true;
  mesh_rightMullion_14.userData.sculptComponent = {"id": "rightMullion", "name": "右后铝立柱", "level": "meso", "role": "frame-mullion", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "40×40 mm 铝立柱，右侧主要承重构件。", "geometryDescriptor": {"topologyIntent": "40×40 mm 铝立柱，右侧主要承重构件。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.59, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightMullion-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightMullion-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rightMullion_14.add(mesh_rightMullion_14);
  meshes["rightMullion"] = mesh_rightMullion_14;
  colliders["rightMullion"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.59, 0.04], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["rightMullion-pivot"] ??= [];
  destructionGroups["rightMullion-pivot"].push(node_rightMullion_14);

  const endpoint_leftFrontPost_15 = makeAttachmentEndpoint(null);
  const node_leftFrontPost_15 = new THREE.Group();
  node_leftFrontPost_15.name = "\u5de6\u524d\u94dd\u7acb\u67f1__pivot";
  node_leftFrontPost_15.scale.set(1, 1, 1);
  if (endpoint_leftFrontPost_15) {
    node_leftFrontPost_15.position.copy(endpoint_leftFrontPost_15.start);
    node_leftFrontPost_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leftFrontPost_15.position.set(-0.51, 0.0, 0.485);
    node_leftFrontPost_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_leftFrontPost_15.userData.sculptComponent = {"id": "leftFrontPost", "name": "左前铝立柱", "level": "meso", "role": "frame-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左隔断前缘的 35 mm 方形铝立柱，连接玻璃侧边。", "geometryDescriptor": {"topologyIntent": "左隔断前缘的 35 mm 方形铝立柱，连接玻璃侧边。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.035, "height": 0.59, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0, 0.485], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftFrontPost_15.userData.actionProfile = {"animationRole": "leftFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_leftFrontPost_15);
  nodes["leftFrontPost"] = node_leftFrontPost_15;
  const mesh_leftFrontPost_15Geometry = endpoint_leftFrontPost_15
    ? new THREE.CylinderGeometry(endpoint_leftFrontPost_15.endRadius, endpoint_leftFrontPost_15.baseRadius, endpoint_leftFrontPost_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_leftFrontPost_15) {
    mesh_leftFrontPost_15Geometry.scale(0.035, 0.59, 0.035);
  }
  const mesh_leftFrontPost_15 = new THREE.Mesh(
    mesh_leftFrontPost_15Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leftFrontPost_15.name = "\u5de6\u524d\u94dd\u7acb\u67f1";
  if (endpoint_leftFrontPost_15) {
    mesh_leftFrontPost_15.position.copy(endpoint_leftFrontPost_15.midpoint);
    mesh_leftFrontPost_15.quaternion.copy(endpoint_leftFrontPost_15.quaternion);
  }
  mesh_leftFrontPost_15.castShadow = options.castShadow ?? true;
  mesh_leftFrontPost_15.receiveShadow = options.receiveShadow ?? true;
  mesh_leftFrontPost_15.userData.sculptComponent = {"id": "leftFrontPost", "name": "左前铝立柱", "level": "meso", "role": "frame-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左隔断前缘的 35 mm 方形铝立柱，连接玻璃侧边。", "geometryDescriptor": {"topologyIntent": "左隔断前缘的 35 mm 方形铝立柱，连接玻璃侧边。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.035, "height": 0.59, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0, 0.485], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftFrontPost_15.add(mesh_leftFrontPost_15);
  meshes["leftFrontPost"] = mesh_leftFrontPost_15;
  colliders["leftFrontPost"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["leftFrontPost-pivot"] ??= [];
  destructionGroups["leftFrontPost-pivot"].push(node_leftFrontPost_15);

  const endpoint_rightFrontPost_16 = makeAttachmentEndpoint(null);
  const node_rightFrontPost_16 = new THREE.Group();
  node_rightFrontPost_16.name = "\u53f3\u524d\u94dd\u7acb\u67f1__pivot";
  node_rightFrontPost_16.scale.set(1, 1, 1);
  if (endpoint_rightFrontPost_16) {
    node_rightFrontPost_16.position.copy(endpoint_rightFrontPost_16.start);
    node_rightFrontPost_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rightFrontPost_16.position.set(0.51, 0.0, 0.485);
    node_rightFrontPost_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_rightFrontPost_16.userData.sculptComponent = {"id": "rightFrontPost", "name": "右前铝立柱", "level": "meso", "role": "frame-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右隔断前缘的 35 mm 方形铝立柱。", "geometryDescriptor": {"topologyIntent": "右隔断前缘的 35 mm 方形铝立柱。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.035, "height": 0.59, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0, 0.485], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rightFrontPost_16.userData.actionProfile = {"animationRole": "rightFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_rightFrontPost_16);
  nodes["rightFrontPost"] = node_rightFrontPost_16;
  const mesh_rightFrontPost_16Geometry = endpoint_rightFrontPost_16
    ? new THREE.CylinderGeometry(endpoint_rightFrontPost_16.endRadius, endpoint_rightFrontPost_16.baseRadius, endpoint_rightFrontPost_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_rightFrontPost_16) {
    mesh_rightFrontPost_16Geometry.scale(0.035, 0.59, 0.035);
  }
  const mesh_rightFrontPost_16 = new THREE.Mesh(
    mesh_rightFrontPost_16Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rightFrontPost_16.name = "\u53f3\u524d\u94dd\u7acb\u67f1";
  if (endpoint_rightFrontPost_16) {
    mesh_rightFrontPost_16.position.copy(endpoint_rightFrontPost_16.midpoint);
    mesh_rightFrontPost_16.quaternion.copy(endpoint_rightFrontPost_16.quaternion);
  }
  mesh_rightFrontPost_16.castShadow = options.castShadow ?? true;
  mesh_rightFrontPost_16.receiveShadow = options.receiveShadow ?? true;
  mesh_rightFrontPost_16.userData.sculptComponent = {"id": "rightFrontPost", "name": "右前铝立柱", "level": "meso", "role": "frame-post", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右隔断前缘的 35 mm 方形铝立柱。", "geometryDescriptor": {"topologyIntent": "右隔断前缘的 35 mm 方形铝立柱。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.035, "height": 0.59, "depth": 0.035, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0, 0.485], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rightFrontPost-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rightFrontPost-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rightFrontPost_16.add(mesh_rightFrontPost_16);
  meshes["rightFrontPost"] = mesh_rightFrontPost_16;
  colliders["rightFrontPost"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.59, 0.035], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["rightFrontPost-pivot"] ??= [];
  destructionGroups["rightFrontPost-pivot"].push(node_rightFrontPost_16);

  const endpoint_topRailBack_17 = makeAttachmentEndpoint(null);
  const node_topRailBack_17 = new THREE.Group();
  node_topRailBack_17.name = "\u80cc\u677f\u4e0a\u6a2a\u6881__pivot";
  node_topRailBack_17.scale.set(1, 1, 1);
  if (endpoint_topRailBack_17) {
    node_topRailBack_17.position.copy(endpoint_topRailBack_17.start);
    node_topRailBack_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topRailBack_17.position.set(0.0, 0.2775, 0.0);
    node_topRailBack_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_topRailBack_17.userData.sculptComponent = {"id": "topRailBack", "name": "背板上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "背板上缘的横向铝压梁，宽 50 mm。", "geometryDescriptor": {"topologyIntent": "背板上缘的横向铝压梁，宽 50 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 1.05, "height": 0.035, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.2775, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.035, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailBack_17.userData.actionProfile = {"animationRole": "topRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.035, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_topRailBack_17);
  nodes["topRailBack"] = node_topRailBack_17;
  const mesh_topRailBack_17Geometry = endpoint_topRailBack_17
    ? new THREE.CylinderGeometry(endpoint_topRailBack_17.endRadius, endpoint_topRailBack_17.baseRadius, endpoint_topRailBack_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_topRailBack_17) {
    mesh_topRailBack_17Geometry.scale(1.05, 0.035, 0.05);
  }
  const mesh_topRailBack_17 = new THREE.Mesh(
    mesh_topRailBack_17Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_topRailBack_17.name = "\u80cc\u677f\u4e0a\u6a2a\u6881";
  if (endpoint_topRailBack_17) {
    mesh_topRailBack_17.position.copy(endpoint_topRailBack_17.midpoint);
    mesh_topRailBack_17.quaternion.copy(endpoint_topRailBack_17.quaternion);
  }
  mesh_topRailBack_17.castShadow = options.castShadow ?? true;
  mesh_topRailBack_17.receiveShadow = options.receiveShadow ?? true;
  mesh_topRailBack_17.userData.sculptComponent = {"id": "topRailBack", "name": "背板上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "背板上缘的横向铝压梁，宽 50 mm。", "geometryDescriptor": {"topologyIntent": "背板上缘的横向铝压梁，宽 50 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 1.05, "height": 0.035, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.2775, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailBack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.035, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailBack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailBack_17.add(mesh_topRailBack_17);
  meshes["topRailBack"] = mesh_topRailBack_17;
  colliders["topRailBack"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.035, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["topRailBack-pivot"] ??= [];
  destructionGroups["topRailBack-pivot"].push(node_topRailBack_17);

  const endpoint_topRailLeft_18 = makeAttachmentEndpoint(null);
  const node_topRailLeft_18 = new THREE.Group();
  node_topRailLeft_18.name = "\u5de6\u4fa7\u4e0a\u6a2a\u6881__pivot";
  node_topRailLeft_18.scale.set(1, 1, 1);
  if (endpoint_topRailLeft_18) {
    node_topRailLeft_18.position.copy(endpoint_topRailLeft_18.start);
    node_topRailLeft_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topRailLeft_18.position.set(-0.51, 0.2775, 0.25);
    node_topRailLeft_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_topRailLeft_18.userData.sculptComponent = {"id": "topRailLeft", "name": "左侧上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧玻璃上缘的横梁，与背板横梁同高。", "geometryDescriptor": {"topologyIntent": "左侧玻璃上缘的横梁，与背板横梁同高。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.035, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0.2775, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailLeft-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailLeft-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailLeft_18.userData.actionProfile = {"animationRole": "topRailLeft-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailLeft-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_topRailLeft_18);
  nodes["topRailLeft"] = node_topRailLeft_18;
  const mesh_topRailLeft_18Geometry = endpoint_topRailLeft_18
    ? new THREE.CylinderGeometry(endpoint_topRailLeft_18.endRadius, endpoint_topRailLeft_18.baseRadius, endpoint_topRailLeft_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_topRailLeft_18) {
    mesh_topRailLeft_18Geometry.scale(0.04, 0.035, 0.47);
  }
  const mesh_topRailLeft_18 = new THREE.Mesh(
    mesh_topRailLeft_18Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_topRailLeft_18.name = "\u5de6\u4fa7\u4e0a\u6a2a\u6881";
  if (endpoint_topRailLeft_18) {
    mesh_topRailLeft_18.position.copy(endpoint_topRailLeft_18.midpoint);
    mesh_topRailLeft_18.quaternion.copy(endpoint_topRailLeft_18.quaternion);
  }
  mesh_topRailLeft_18.castShadow = options.castShadow ?? true;
  mesh_topRailLeft_18.receiveShadow = options.receiveShadow ?? true;
  mesh_topRailLeft_18.userData.sculptComponent = {"id": "topRailLeft", "name": "左侧上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧玻璃上缘的横梁，与背板横梁同高。", "geometryDescriptor": {"topologyIntent": "左侧玻璃上缘的横梁，与背板横梁同高。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.035, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.51, 0.2775, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailLeft-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailLeft-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailLeft_18.add(mesh_topRailLeft_18);
  meshes["topRailLeft"] = mesh_topRailLeft_18;
  colliders["topRailLeft"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["topRailLeft-pivot"] ??= [];
  destructionGroups["topRailLeft-pivot"].push(node_topRailLeft_18);

  const endpoint_topRailRight_19 = makeAttachmentEndpoint(null);
  const node_topRailRight_19 = new THREE.Group();
  node_topRailRight_19.name = "\u53f3\u4fa7\u4e0a\u6a2a\u6881__pivot";
  node_topRailRight_19.scale.set(1, 1, 1);
  if (endpoint_topRailRight_19) {
    node_topRailRight_19.position.copy(endpoint_topRailRight_19.start);
    node_topRailRight_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topRailRight_19.position.set(0.51, 0.2775, 0.25);
    node_topRailRight_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_topRailRight_19.userData.sculptComponent = {"id": "topRailRight", "name": "右侧上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧玻璃上缘的横梁。", "geometryDescriptor": {"topologyIntent": "右侧玻璃上缘的横梁。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.035, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0.2775, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailRight-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailRight-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailRight_19.userData.actionProfile = {"animationRole": "topRailRight-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailRight-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_topRailRight_19);
  nodes["topRailRight"] = node_topRailRight_19;
  const mesh_topRailRight_19Geometry = endpoint_topRailRight_19
    ? new THREE.CylinderGeometry(endpoint_topRailRight_19.endRadius, endpoint_topRailRight_19.baseRadius, endpoint_topRailRight_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_topRailRight_19) {
    mesh_topRailRight_19Geometry.scale(0.04, 0.035, 0.47);
  }
  const mesh_topRailRight_19 = new THREE.Mesh(
    mesh_topRailRight_19Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_topRailRight_19.name = "\u53f3\u4fa7\u4e0a\u6a2a\u6881";
  if (endpoint_topRailRight_19) {
    mesh_topRailRight_19.position.copy(endpoint_topRailRight_19.midpoint);
    mesh_topRailRight_19.quaternion.copy(endpoint_topRailRight_19.quaternion);
  }
  mesh_topRailRight_19.castShadow = options.castShadow ?? true;
  mesh_topRailRight_19.receiveShadow = options.receiveShadow ?? true;
  mesh_topRailRight_19.userData.sculptComponent = {"id": "topRailRight", "name": "右侧上横梁", "level": "meso", "role": "frame-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧玻璃上缘的横梁。", "geometryDescriptor": {"topologyIntent": "右侧玻璃上缘的横梁。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.04, "height": 0.035, "depth": 0.47, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.51, 0.2775, 0.25], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "topRailRight-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topRailRight-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_topRailRight_19.add(mesh_topRailRight_19);
  meshes["topRailRight"] = mesh_topRailRight_19;
  colliders["topRailRight"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.04, 0.035, 0.47], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["topRailRight-pivot"] ??= [];
  destructionGroups["topRailRight-pivot"].push(node_topRailRight_19);

  const endpoint_leftGlassSticker_20 = makeAttachmentEndpoint(null);
  const node_leftGlassSticker_20 = new THREE.Group();
  node_leftGlassSticker_20.name = "\u5de6\u4fa7\u73bb\u7483\u8d34\u7eb8__pivot";
  node_leftGlassSticker_20.scale.set(1, 1, 1);
  if (endpoint_leftGlassSticker_20) {
    node_leftGlassSticker_20.position.copy(endpoint_leftGlassSticker_20.start);
    node_leftGlassSticker_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leftGlassSticker_20.position.set(-0.505, 0.2, 0.415);
    node_leftGlassSticker_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_leftGlassSticker_20.userData.sculptComponent = {"id": "leftGlassSticker", "name": "左侧玻璃贴纸", "level": "meso", "role": "frosted-sticker", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "贴附于左玻璃内表面的白色磨砂贴纸，边缘薄且不规则。", "geometryDescriptor": {"topologyIntent": "贴附于左玻璃内表面的白色磨砂贴纸，边缘薄且不规则。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.002, "height": 0.09, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.505, 0.2, 0.415], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftGlassSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.002, 0.09, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlassSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "stickerFrosted", "materialLayers": ["stickerFrosted"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sticker-edge", "kind": "decal", "description": "贴纸的薄边缘与轮廓。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftGlassSticker_20.userData.actionProfile = {"animationRole": "leftGlassSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.002, 0.09, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlassSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_leftGlassSticker_20);
  nodes["leftGlassSticker"] = node_leftGlassSticker_20;
  const mesh_leftGlassSticker_20Geometry = endpoint_leftGlassSticker_20
    ? new THREE.CylinderGeometry(endpoint_leftGlassSticker_20.endRadius, endpoint_leftGlassSticker_20.baseRadius, endpoint_leftGlassSticker_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_leftGlassSticker_20) {
    mesh_leftGlassSticker_20Geometry.scale(0.002, 0.09, 0.14);
  }
  const mesh_leftGlassSticker_20 = new THREE.Mesh(
    mesh_leftGlassSticker_20Geometry,
    materialMap["stickerFrosted"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leftGlassSticker_20.name = "\u5de6\u4fa7\u73bb\u7483\u8d34\u7eb8";
  if (endpoint_leftGlassSticker_20) {
    mesh_leftGlassSticker_20.position.copy(endpoint_leftGlassSticker_20.midpoint);
    mesh_leftGlassSticker_20.quaternion.copy(endpoint_leftGlassSticker_20.quaternion);
  }
  mesh_leftGlassSticker_20.castShadow = options.castShadow ?? true;
  mesh_leftGlassSticker_20.receiveShadow = options.receiveShadow ?? true;
  mesh_leftGlassSticker_20.userData.sculptComponent = {"id": "leftGlassSticker", "name": "左侧玻璃贴纸", "level": "meso", "role": "frosted-sticker", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "贴附于左玻璃内表面的白色磨砂贴纸，边缘薄且不规则。", "geometryDescriptor": {"topologyIntent": "贴附于左玻璃内表面的白色磨砂贴纸，边缘薄且不规则。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.002, "height": 0.09, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.505, 0.2, 0.415], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "leftGlassSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.002, 0.09, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leftGlassSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "stickerFrosted", "materialLayers": ["stickerFrosted"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sticker-edge", "kind": "decal", "description": "贴纸的薄边缘与轮廓。", "evidenceRef": "left-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_leftGlassSticker_20.add(mesh_leftGlassSticker_20);
  meshes["leftGlassSticker"] = mesh_leftGlassSticker_20;
  colliders["leftGlassSticker"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.002, 0.09, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["leftGlassSticker-pivot"] ??= [];
  destructionGroups["leftGlassSticker-pivot"].push(node_leftGlassSticker_20);

  const endpoint_bottleHook_21 = makeAttachmentEndpoint(null);
  const node_bottleHook_21 = new THREE.Group();
  node_bottleHook_21.name = "\u6c34\u58f6\u6302\u94a9__pivot";
  node_bottleHook_21.scale.set(1, 1, 1);
  if (endpoint_bottleHook_21) {
    node_bottleHook_21.position.copy(endpoint_bottleHook_21.start);
    node_bottleHook_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bottleHook_21.position.set(0.505, 0.2475, 0.345);
    node_bottleHook_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_bottleHook_21.userData.sculptComponent = {"id": "bottleHook", "name": "水壶挂钩", "level": "meso", "role": "hook", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "黑色 L 形挂钩，贴在玻璃内表面，承托水壶织带。", "geometryDescriptor": {"topologyIntent": "黑色 L 形挂钩，贴在玻璃内表面，承托水壶织带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.018, "height": 0.05, "depth": 0.02, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.505, 0.2475, 0.345], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottleHook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.05, 0.02], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottleHook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bottleHook_21.userData.actionProfile = {"animationRole": "bottleHook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.05, 0.02], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottleHook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["partition"] ?? root).add(node_bottleHook_21);
  nodes["bottleHook"] = node_bottleHook_21;
  const mesh_bottleHook_21Geometry = endpoint_bottleHook_21
    ? new THREE.CylinderGeometry(endpoint_bottleHook_21.endRadius, endpoint_bottleHook_21.baseRadius, endpoint_bottleHook_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_bottleHook_21) {
    mesh_bottleHook_21Geometry.scale(0.018, 0.05, 0.02);
  }
  const mesh_bottleHook_21 = new THREE.Mesh(
    mesh_bottleHook_21Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bottleHook_21.name = "\u6c34\u58f6\u6302\u94a9";
  if (endpoint_bottleHook_21) {
    mesh_bottleHook_21.position.copy(endpoint_bottleHook_21.midpoint);
    mesh_bottleHook_21.quaternion.copy(endpoint_bottleHook_21.quaternion);
  }
  mesh_bottleHook_21.castShadow = options.castShadow ?? true;
  mesh_bottleHook_21.receiveShadow = options.receiveShadow ?? true;
  mesh_bottleHook_21.userData.sculptComponent = {"id": "bottleHook", "name": "水壶挂钩", "level": "meso", "role": "hook", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "黑色 L 形挂钩，贴在玻璃内表面，承托水壶织带。", "geometryDescriptor": {"topologyIntent": "黑色 L 形挂钩，贴在玻璃内表面，承托水壶织带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "partition", "attachment": null, "dimensions": {"width": 0.018, "height": 0.05, "depth": 0.02, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.505, 0.2475, 0.345], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottleHook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.05, 0.02], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottleHook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bottleHook_21.add(mesh_bottleHook_21);
  meshes["bottleHook"] = mesh_bottleHook_21;
  colliders["bottleHook"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.05, 0.02], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bottleHook-pivot"] ??= [];
  destructionGroups["bottleHook-pivot"].push(node_bottleHook_21);

  const endpoint_shelf_22 = makeAttachmentEndpoint(null);
  const node_shelf_22 = new THREE.Group();
  node_shelf_22.name = "\u9876\u90e8\u6401\u677f__pivot";
  node_shelf_22.scale.set(1, 1, 1);
  if (endpoint_shelf_22) {
    node_shelf_22.position.copy(endpoint_shelf_22.start);
    node_shelf_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_22.position.set(0.0, 1.36, -0.16);
    node_shelf_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_22.userData.sculptComponent = {"id": "shelf", "name": "顶部搁板", "level": "macro", "role": "shelf-board", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "1050×300×25 mm 搁板，与背板同宽，前缘有 18 mm 封边。", "geometryDescriptor": {"topologyIntent": "1050×300×25 mm 搁板，与背板同宽，前缘有 18 mm 封边。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.025, "depth": 0.3, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 1.36, -0.16], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelf-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.3], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shelf-front-bevel", "kind": "bevel", "description": "搁板前缘 1 mm 圆角高光。", "evidenceRef": "shelf-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "shelf-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_shelf_22.userData.actionProfile = {"animationRole": "shelf-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.3], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_shelf_22);
  nodes["shelf"] = node_shelf_22;
  const mesh_shelf_22Geometry = endpoint_shelf_22
    ? new THREE.CylinderGeometry(endpoint_shelf_22.endRadius, endpoint_shelf_22.baseRadius, endpoint_shelf_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_shelf_22) {
    mesh_shelf_22Geometry.scale(1.05, 0.025, 0.3);
  }
  const mesh_shelf_22 = new THREE.Mesh(
    mesh_shelf_22Geometry,
    materialMap["woodOak"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_22.name = "\u9876\u90e8\u6401\u677f";
  if (endpoint_shelf_22) {
    mesh_shelf_22.position.copy(endpoint_shelf_22.midpoint);
    mesh_shelf_22.quaternion.copy(endpoint_shelf_22.quaternion);
  }
  mesh_shelf_22.castShadow = options.castShadow ?? true;
  mesh_shelf_22.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_22.userData.sculptComponent = {"id": "shelf", "name": "顶部搁板", "level": "macro", "role": "shelf-board", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "1050×300×25 mm 搁板，与背板同宽，前缘有 18 mm 封边。", "geometryDescriptor": {"topologyIntent": "1050×300×25 mm 搁板，与背板同宽，前缘有 18 mm 封边。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.05, "height": 0.025, "depth": 0.3, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 1.36, -0.16], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelf-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.3], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "woodOak", "materialLayers": ["woodOak"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shelf-front-bevel", "kind": "bevel", "description": "搁板前缘 1 mm 圆角高光。", "evidenceRef": "shelf-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "shelf-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 174, 131, 1.0)", "secondaryAlbedo": "rgba(169, 138, 95, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_shelf_22.add(mesh_shelf_22);
  meshes["shelf"] = mesh_shelf_22;
  colliders["shelf"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.05, 0.025, 0.3], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["shelf-pivot"] ??= [];
  destructionGroups["shelf-pivot"].push(node_shelf_22);

  const endpoint_shelfBracketL_23 = makeAttachmentEndpoint(null);
  const node_shelfBracketL_23 = new THREE.Group();
  node_shelfBracketL_23.name = "\u6401\u677f\u6258\u67b6 L__pivot";
  node_shelfBracketL_23.scale.set(1, 1, 1);
  if (endpoint_shelfBracketL_23) {
    node_shelfBracketL_23.position.copy(endpoint_shelfBracketL_23.start);
    node_shelfBracketL_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelfBracketL_23.position.set(-0.45, -0.082, -0.05);
    node_shelfBracketL_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelfBracketL_23.userData.sculptComponent = {"id": "shelfBracketL", "name": "搁板托架 L", "level": "meso", "role": "shelf-bracket", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "geometryDescriptor": {"topologyIntent": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelf", "attachment": null, "dimensions": {"width": 0.025, "height": 0.14, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.45, -0.082, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfBracketL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_shelfBracketL_23.userData.actionProfile = {"animationRole": "shelfBracketL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelf"] ?? root).add(node_shelfBracketL_23);
  nodes["shelfBracketL"] = node_shelfBracketL_23;
  const mesh_shelfBracketL_23Geometry = endpoint_shelfBracketL_23
    ? new THREE.CylinderGeometry(endpoint_shelfBracketL_23.endRadius, endpoint_shelfBracketL_23.baseRadius, endpoint_shelfBracketL_23.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_shelfBracketL_23) {
    mesh_shelfBracketL_23Geometry.scale(0.025, 0.14, 0.18);
  }
  const mesh_shelfBracketL_23 = new THREE.Mesh(
    mesh_shelfBracketL_23Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelfBracketL_23.name = "\u6401\u677f\u6258\u67b6 L";
  if (endpoint_shelfBracketL_23) {
    mesh_shelfBracketL_23.position.copy(endpoint_shelfBracketL_23.midpoint);
    mesh_shelfBracketL_23.quaternion.copy(endpoint_shelfBracketL_23.quaternion);
  }
  mesh_shelfBracketL_23.castShadow = options.castShadow ?? true;
  mesh_shelfBracketL_23.receiveShadow = options.receiveShadow ?? true;
  mesh_shelfBracketL_23.userData.sculptComponent = {"id": "shelfBracketL", "name": "搁板托架 L", "level": "meso", "role": "shelf-bracket", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "geometryDescriptor": {"topologyIntent": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelf", "attachment": null, "dimensions": {"width": 0.025, "height": 0.14, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.45, -0.082, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfBracketL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_shelfBracketL_23.add(mesh_shelfBracketL_23);
  meshes["shelfBracketL"] = mesh_shelfBracketL_23;
  colliders["shelfBracketL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["shelfBracketL-pivot"] ??= [];
  destructionGroups["shelfBracketL-pivot"].push(node_shelfBracketL_23);

  const endpoint_shelfBracketR_24 = makeAttachmentEndpoint(null);
  const node_shelfBracketR_24 = new THREE.Group();
  node_shelfBracketR_24.name = "\u6401\u677f\u6258\u67b6 R__pivot";
  node_shelfBracketR_24.scale.set(1, 1, 1);
  if (endpoint_shelfBracketR_24) {
    node_shelfBracketR_24.position.copy(endpoint_shelfBracketR_24.start);
    node_shelfBracketR_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelfBracketR_24.position.set(0.45, -0.082, -0.05);
    node_shelfBracketR_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelfBracketR_24.userData.sculptComponent = {"id": "shelfBracketR", "name": "搁板托架 R", "level": "meso", "role": "shelf-bracket", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "geometryDescriptor": {"topologyIntent": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelf", "attachment": null, "dimensions": {"width": 0.025, "height": 0.14, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.45, -0.082, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfBracketR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_shelfBracketR_24.userData.actionProfile = {"animationRole": "shelfBracketR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelf"] ?? root).add(node_shelfBracketR_24);
  nodes["shelfBracketR"] = node_shelfBracketR_24;
  const mesh_shelfBracketR_24Geometry = endpoint_shelfBracketR_24
    ? new THREE.CylinderGeometry(endpoint_shelfBracketR_24.endRadius, endpoint_shelfBracketR_24.baseRadius, endpoint_shelfBracketR_24.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_shelfBracketR_24) {
    mesh_shelfBracketR_24Geometry.scale(0.025, 0.14, 0.18);
  }
  const mesh_shelfBracketR_24 = new THREE.Mesh(
    mesh_shelfBracketR_24Geometry,
    materialMap["aluminum"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelfBracketR_24.name = "\u6401\u677f\u6258\u67b6 R";
  if (endpoint_shelfBracketR_24) {
    mesh_shelfBracketR_24.position.copy(endpoint_shelfBracketR_24.midpoint);
    mesh_shelfBracketR_24.quaternion.copy(endpoint_shelfBracketR_24.quaternion);
  }
  mesh_shelfBracketR_24.castShadow = options.castShadow ?? true;
  mesh_shelfBracketR_24.receiveShadow = options.receiveShadow ?? true;
  mesh_shelfBracketR_24.userData.sculptComponent = {"id": "shelfBracketR", "name": "搁板托架 R", "level": "meso", "role": "shelf-bracket", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "geometryDescriptor": {"topologyIntent": "90° 折弯铝托架，竖直面贴背板、水平面承托搁板。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelf", "attachment": null, "dimensions": {"width": 0.025, "height": 0.14, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.45, -0.082, -0.05], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfBracketR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfBracketR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "aluminum", "materialLayers": ["aluminum"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_shelfBracketR_24.add(mesh_shelfBracketR_24);
  meshes["shelfBracketR"] = mesh_shelfBracketR_24;
  colliders["shelfBracketR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.025, 0.14, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["shelfBracketR-pivot"] ??= [];
  destructionGroups["shelfBracketR-pivot"].push(node_shelfBracketR_24);

  const endpoint_shelfProps_25 = makeAttachmentEndpoint(null);
  const node_shelfProps_25 = new THREE.Group();
  node_shelfProps_25.name = "\u4e66\u5217\u4e0e\u8336\u7f50__pivot";
  node_shelfProps_25.scale.set(1, 1, 1);
  if (endpoint_shelfProps_25) {
    node_shelfProps_25.position.copy(endpoint_shelfProps_25.start);
    node_shelfProps_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelfProps_25.position.set(-0.245, 1.49, -0.2);
    node_shelfProps_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelfProps_25.userData.sculptComponent = {"id": "shelfProps", "name": "书列与茶罐", "level": "macro", "role": "book-block", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧连续书列形成 520×220×130 mm 的量体；书脊深浅/宽度不同，可见印刷色带。", "geometryDescriptor": {"topologyIntent": "左侧连续书列形成 520×220×130 mm 的量体；书脊深浅/宽度不同，可见印刷色带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.52, "height": 0.22, "depth": 0.13, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.245, 1.49, -0.2], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfProps-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.22, 0.13], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfProps-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bookSpines", "materialLayers": ["bookSpines"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "book-spine-color-bands", "kind": "decal", "description": "紫/粉/米/蓝/黑/白/绿/橙书脊。", "evidenceRef": "shelf-detail"}, {"id": "tea-jar-lid-gloss", "kind": "gloss", "description": "茶罐盖窄高光。", "evidenceRef": "shelf-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 90, 140, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_shelfProps_25.userData.actionProfile = {"animationRole": "shelfProps-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.22, 0.13], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfProps-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_shelfProps_25);
  nodes["shelfProps"] = node_shelfProps_25;
  const mesh_shelfProps_25Geometry = endpoint_shelfProps_25
    ? new THREE.CylinderGeometry(endpoint_shelfProps_25.endRadius, endpoint_shelfProps_25.baseRadius, endpoint_shelfProps_25.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_shelfProps_25) {
    mesh_shelfProps_25Geometry.scale(0.52, 0.22, 0.13);
  }
  const mesh_shelfProps_25 = new THREE.Mesh(
    mesh_shelfProps_25Geometry,
    materialMap["bookSpines"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelfProps_25.name = "\u4e66\u5217\u4e0e\u8336\u7f50";
  if (endpoint_shelfProps_25) {
    mesh_shelfProps_25.position.copy(endpoint_shelfProps_25.midpoint);
    mesh_shelfProps_25.quaternion.copy(endpoint_shelfProps_25.quaternion);
  }
  mesh_shelfProps_25.castShadow = options.castShadow ?? true;
  mesh_shelfProps_25.receiveShadow = options.receiveShadow ?? true;
  mesh_shelfProps_25.userData.sculptComponent = {"id": "shelfProps", "name": "书列与茶罐", "level": "macro", "role": "book-block", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧连续书列形成 520×220×130 mm 的量体；书脊深浅/宽度不同，可见印刷色带。", "geometryDescriptor": {"topologyIntent": "左侧连续书列形成 520×220×130 mm 的量体；书脊深浅/宽度不同，可见印刷色带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.52, "height": 0.22, "depth": 0.13, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.245, 1.49, -0.2], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "shelfProps-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.22, 0.13], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelfProps-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bookSpines", "materialLayers": ["bookSpines"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "book-spine-color-bands", "kind": "decal", "description": "紫/粉/米/蓝/黑/白/绿/橙书脊。", "evidenceRef": "shelf-detail"}, {"id": "tea-jar-lid-gloss", "kind": "gloss", "description": "茶罐盖窄高光。", "evidenceRef": "shelf-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 90, 140, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_shelfProps_25.add(mesh_shelfProps_25);
  meshes["shelfProps"] = mesh_shelfProps_25;
  colliders["shelfProps"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.52, 0.22, 0.13], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["shelfProps-pivot"] ??= [];
  destructionGroups["shelfProps-pivot"].push(node_shelfProps_25);

  const endpoint_bookRowB_26 = makeAttachmentEndpoint(null);
  const node_bookRowB_26 = new THREE.Group();
  node_bookRowB_26.name = "\u53f3\u4fa7\u4e66\u5217__pivot";
  node_bookRowB_26.scale.set(1, 1, 1);
  if (endpoint_bookRowB_26) {
    node_bookRowB_26.position.copy(endpoint_bookRowB_26.start);
    node_bookRowB_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bookRowB_26.position.set(0.37, 0.005, 0.0);
    node_bookRowB_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_bookRowB_26.userData.sculptComponent = {"id": "bookRowB", "name": "右侧书列", "level": "meso", "role": "book-block", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧较窄书列，书脊高度略低。", "geometryDescriptor": {"topologyIntent": "右侧较窄书列，书脊高度略低。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": null, "dimensions": {"width": 0.16, "height": 0.19, "depth": 0.12, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.37, 0.005, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bookRowB-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.19, 0.12], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookRowB-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bookSpines", "materialLayers": ["bookSpines"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(76, 93, 107, 1.0)", "secondaryAlbedo": "rgba(198, 179, 138, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_bookRowB_26.userData.actionProfile = {"animationRole": "bookRowB-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.19, 0.12], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookRowB-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelfProps"] ?? root).add(node_bookRowB_26);
  nodes["bookRowB"] = node_bookRowB_26;
  const mesh_bookRowB_26Geometry = endpoint_bookRowB_26
    ? new THREE.CylinderGeometry(endpoint_bookRowB_26.endRadius, endpoint_bookRowB_26.baseRadius, endpoint_bookRowB_26.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_bookRowB_26) {
    mesh_bookRowB_26Geometry.scale(0.16, 0.19, 0.12);
  }
  const mesh_bookRowB_26 = new THREE.Mesh(
    mesh_bookRowB_26Geometry,
    materialMap["bookSpines"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bookRowB_26.name = "\u53f3\u4fa7\u4e66\u5217";
  if (endpoint_bookRowB_26) {
    mesh_bookRowB_26.position.copy(endpoint_bookRowB_26.midpoint);
    mesh_bookRowB_26.quaternion.copy(endpoint_bookRowB_26.quaternion);
  }
  mesh_bookRowB_26.castShadow = options.castShadow ?? true;
  mesh_bookRowB_26.receiveShadow = options.receiveShadow ?? true;
  mesh_bookRowB_26.userData.sculptComponent = {"id": "bookRowB", "name": "右侧书列", "level": "meso", "role": "book-block", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧较窄书列，书脊高度略低。", "geometryDescriptor": {"topologyIntent": "右侧较窄书列，书脊高度略低。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": null, "dimensions": {"width": 0.16, "height": 0.19, "depth": 0.12, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.37, 0.005, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bookRowB-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.19, 0.12], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookRowB-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bookSpines", "materialLayers": ["bookSpines"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(76, 93, 107, 1.0)", "secondaryAlbedo": "rgba(198, 179, 138, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_bookRowB_26.add(mesh_bookRowB_26);
  meshes["bookRowB"] = mesh_bookRowB_26;
  colliders["bookRowB"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.19, 0.12], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bookRowB-pivot"] ??= [];
  destructionGroups["bookRowB-pivot"].push(node_bookRowB_26);

  const attachment_jarPurple_27 = {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.43, -0.12, 0.02], "localEnd": [0.43, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_jarPurple_27 = makeAttachmentEndpoint(attachment_jarPurple_27);
  const node_jarPurple_27 = new THREE.Group();
  node_jarPurple_27.name = "\u7d2b\u8272\u8336\u7f50__pivot";
  node_jarPurple_27.scale.set(1, 1, 1);
  if (endpoint_jarPurple_27) {
    node_jarPurple_27.position.copy(endpoint_jarPurple_27.start);
    node_jarPurple_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_jarPurple_27.position.set(0.0, 0.0, 0.0);
    node_jarPurple_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_jarPurple_27.userData.sculptComponent = {"id": "jarPurple", "name": "紫色茶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.43, -0.12, 0.02], "localEnd": [0.43, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "jarPurple-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarPurple-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "jarGlass", "materialLayers": ["jarGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(123, 91, 142, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_jarPurple_27.userData.actionProfile = {"animationRole": "jarPurple-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarPurple-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelfProps"] ?? root).add(node_jarPurple_27);
  nodes["jarPurple"] = node_jarPurple_27;
  const mesh_jarPurple_27Geometry = endpoint_jarPurple_27
    ? new THREE.CylinderGeometry(endpoint_jarPurple_27.endRadius, endpoint_jarPurple_27.baseRadius, endpoint_jarPurple_27.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_jarPurple_27) {
    mesh_jarPurple_27Geometry.scale(0.09, 0.22, 0.09);
  }
  const mesh_jarPurple_27 = new THREE.Mesh(
    mesh_jarPurple_27Geometry,
    materialMap["jarGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_jarPurple_27.name = "\u7d2b\u8272\u8336\u7f50";
  if (endpoint_jarPurple_27) {
    mesh_jarPurple_27.position.copy(endpoint_jarPurple_27.midpoint);
    mesh_jarPurple_27.quaternion.copy(endpoint_jarPurple_27.quaternion);
  }
  mesh_jarPurple_27.castShadow = options.castShadow ?? true;
  mesh_jarPurple_27.receiveShadow = options.receiveShadow ?? true;
  mesh_jarPurple_27.userData.sculptComponent = {"id": "jarPurple", "name": "紫色茶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.43, -0.12, 0.02], "localEnd": [0.43, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "jarPurple-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarPurple-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "jarGlass", "materialLayers": ["jarGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(123, 91, 142, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_jarPurple_27.add(mesh_jarPurple_27);
  meshes["jarPurple"] = mesh_jarPurple_27;
  colliders["jarPurple"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["jarPurple-lift"] ??= [];
  destructionGroups["jarPurple-lift"].push(node_jarPurple_27);

  const attachment_jarOrange_28 = {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.54, -0.12, 0.02], "localEnd": [0.54, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_jarOrange_28 = makeAttachmentEndpoint(attachment_jarOrange_28);
  const node_jarOrange_28 = new THREE.Group();
  node_jarOrange_28.name = "\u6a59\u8272\u6807\u7b7e\u8336\u7f50__pivot";
  node_jarOrange_28.scale.set(1, 1, 1);
  if (endpoint_jarOrange_28) {
    node_jarOrange_28.position.copy(endpoint_jarOrange_28.start);
    node_jarOrange_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_jarOrange_28.position.set(0.0, 0.0, 0.0);
    node_jarOrange_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_jarOrange_28.userData.sculptComponent = {"id": "jarOrange", "name": "橙色标签茶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.54, -0.12, 0.02], "localEnd": [0.54, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "jarOrange-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarOrange-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "jarGlass", "materialLayers": ["jarGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 123, 66, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_jarOrange_28.userData.actionProfile = {"animationRole": "jarOrange-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarOrange-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelfProps"] ?? root).add(node_jarOrange_28);
  nodes["jarOrange"] = node_jarOrange_28;
  const mesh_jarOrange_28Geometry = endpoint_jarOrange_28
    ? new THREE.CylinderGeometry(endpoint_jarOrange_28.endRadius, endpoint_jarOrange_28.baseRadius, endpoint_jarOrange_28.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_jarOrange_28) {
    mesh_jarOrange_28Geometry.scale(0.09, 0.22, 0.09);
  }
  const mesh_jarOrange_28 = new THREE.Mesh(
    mesh_jarOrange_28Geometry,
    materialMap["jarGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_jarOrange_28.name = "\u6a59\u8272\u6807\u7b7e\u8336\u7f50";
  if (endpoint_jarOrange_28) {
    mesh_jarOrange_28.position.copy(endpoint_jarOrange_28.midpoint);
    mesh_jarOrange_28.quaternion.copy(endpoint_jarOrange_28.quaternion);
  }
  mesh_jarOrange_28.castShadow = options.castShadow ?? true;
  mesh_jarOrange_28.receiveShadow = options.receiveShadow ?? true;
  mesh_jarOrange_28.userData.sculptComponent = {"id": "jarOrange", "name": "橙色标签茶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.54, -0.12, 0.02], "localEnd": [0.54, 0.09, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "jarOrange-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "jarOrange-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "jarGlass", "materialLayers": ["jarGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 123, 66, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_jarOrange_28.add(mesh_jarOrange_28);
  meshes["jarOrange"] = mesh_jarOrange_28;
  colliders["jarOrange"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["jarOrange-lift"] ??= [];
  destructionGroups["jarOrange-lift"].push(node_jarOrange_28);

  const attachment_teaCanister_29 = {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.68, -0.12, 0.02], "localEnd": [0.68, 0.12, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_teaCanister_29 = makeAttachmentEndpoint(attachment_teaCanister_29);
  const node_teaCanister_29 = new THREE.Group();
  node_teaCanister_29.name = "\u9ed1\u8272\u8336\u53f6\u7f50__pivot";
  node_teaCanister_29.scale.set(1, 1, 1);
  if (endpoint_teaCanister_29) {
    node_teaCanister_29.position.copy(endpoint_teaCanister_29.start);
    node_teaCanister_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_teaCanister_29.position.set(0.0, 0.0, 0.0);
    node_teaCanister_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_teaCanister_29.userData.sculptComponent = {"id": "teaCanister", "name": "黑色茶叶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.68, -0.12, 0.02], "localEnd": [0.68, 0.12, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "teaCanister-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "teaCanister-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleCap", "materialLayers": ["bottleCap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 36, 38, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_teaCanister_29.userData.actionProfile = {"animationRole": "teaCanister-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "teaCanister-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelfProps"] ?? root).add(node_teaCanister_29);
  nodes["teaCanister"] = node_teaCanister_29;
  const mesh_teaCanister_29Geometry = endpoint_teaCanister_29
    ? new THREE.CylinderGeometry(endpoint_teaCanister_29.endRadius, endpoint_teaCanister_29.baseRadius, endpoint_teaCanister_29.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_teaCanister_29) {
    mesh_teaCanister_29Geometry.scale(0.09, 0.22, 0.09);
  }
  const mesh_teaCanister_29 = new THREE.Mesh(
    mesh_teaCanister_29Geometry,
    materialMap["bottleCap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_teaCanister_29.name = "\u9ed1\u8272\u8336\u53f6\u7f50";
  if (endpoint_teaCanister_29) {
    mesh_teaCanister_29.position.copy(endpoint_teaCanister_29.midpoint);
    mesh_teaCanister_29.quaternion.copy(endpoint_teaCanister_29.quaternion);
  }
  mesh_teaCanister_29.castShadow = options.castShadow ?? true;
  mesh_teaCanister_29.receiveShadow = options.receiveShadow ?? true;
  mesh_teaCanister_29.userData.sculptComponent = {"id": "teaCanister", "name": "黑色茶叶罐", "level": "meso", "role": "tea-container", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "geometryDescriptor": {"topologyIntent": "旋转体茶罐，直径约 90 mm；玻璃罐有薄壁与独立盖体，罐内茶叶为深色颗粒。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": {"parentId": "shelfProps", "parentSocket": "shelf-slot", "contactType": "butt", "localStart": [0.68, -0.12, 0.02], "localEnd": [0.68, 0.12, 0.02], "baseRadius": 0.045, "endRadius": 0.045, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.09, "height": 0.22, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "teaCanister-lift", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "teaCanister-lift", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleCap", "materialLayers": ["bottleCap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 36, 38, 1.0)", "secondaryAlbedo": "rgba(217, 201, 164, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_teaCanister_29.add(mesh_teaCanister_29);
  meshes["teaCanister"] = mesh_teaCanister_29;
  colliders["teaCanister"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.09, 0.22, 0.09], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["teaCanister-lift"] ??= [];
  destructionGroups["teaCanister-lift"].push(node_teaCanister_29);

  const endpoint_bookEnd_30 = makeAttachmentEndpoint(null);
  const node_bookEnd_30 = new THREE.Group();
  node_bookEnd_30.name = "\u4e66\u5217\u6321\u677f__pivot";
  node_bookEnd_30.scale.set(1, 1, 1);
  if (endpoint_bookEnd_30) {
    node_bookEnd_30.position.copy(endpoint_bookEnd_30.start);
    node_bookEnd_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bookEnd_30.position.set(0.29, 0.0, 0.0);
    node_bookEnd_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_bookEnd_30.userData.sculptComponent = {"id": "bookEnd", "name": "书列挡板", "level": "meso", "role": "bookend", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "L 形金属书挡，薄板竖直面压在书列右侧。", "geometryDescriptor": {"topologyIntent": "L 形金属书挡，薄板竖直面压在书列右侧。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": null, "dimensions": {"width": 0.018, "height": 0.12, "depth": 0.1, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.29, 0.0, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bookEnd-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.12, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookEnd-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bookEnd_30.userData.actionProfile = {"animationRole": "bookEnd-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.12, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookEnd-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["shelfProps"] ?? root).add(node_bookEnd_30);
  nodes["bookEnd"] = node_bookEnd_30;
  const mesh_bookEnd_30Geometry = endpoint_bookEnd_30
    ? new THREE.CylinderGeometry(endpoint_bookEnd_30.endRadius, endpoint_bookEnd_30.baseRadius, endpoint_bookEnd_30.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_bookEnd_30) {
    mesh_bookEnd_30Geometry.scale(0.018, 0.12, 0.1);
  }
  const mesh_bookEnd_30 = new THREE.Mesh(
    mesh_bookEnd_30Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bookEnd_30.name = "\u4e66\u5217\u6321\u677f";
  if (endpoint_bookEnd_30) {
    mesh_bookEnd_30.position.copy(endpoint_bookEnd_30.midpoint);
    mesh_bookEnd_30.quaternion.copy(endpoint_bookEnd_30.quaternion);
  }
  mesh_bookEnd_30.castShadow = options.castShadow ?? true;
  mesh_bookEnd_30.receiveShadow = options.receiveShadow ?? true;
  mesh_bookEnd_30.userData.sculptComponent = {"id": "bookEnd", "name": "书列挡板", "level": "meso", "role": "bookend", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "L 形金属书挡，薄板竖直面压在书列右侧。", "geometryDescriptor": {"topologyIntent": "L 形金属书挡，薄板竖直面压在书列右侧。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "shelfProps", "attachment": null, "dimensions": {"width": 0.018, "height": 0.12, "depth": 0.1, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.29, 0.0, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bookEnd-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.12, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bookEnd-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["shelf-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bookEnd_30.add(mesh_bookEnd_30);
  meshes["bookEnd"] = mesh_bookEnd_30;
  colliders["bookEnd"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.12, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bookEnd-pivot"] ??= [];
  destructionGroups["bookEnd-pivot"].push(node_bookEnd_30);

  const endpoint_laptopBase_31 = makeAttachmentEndpoint(null);
  const node_laptopBase_31 = new THREE.Group();
  node_laptopBase_31.name = "\u767d\u8272\u7b14\u8bb0\u672c\u673a\u8eab__pivot";
  node_laptopBase_31.scale.set(1, 1, 1);
  if (endpoint_laptopBase_31) {
    node_laptopBase_31.position.copy(endpoint_laptopBase_31.start);
    node_laptopBase_31.rotation.set(0.14, 0.0, 0.0);
  } else {
    node_laptopBase_31.position.set(-0.2275, 0.8565, -0.05);
    node_laptopBase_31.rotation.set(0.14, 0.0, 0.0);
  }
  node_laptopBase_31.userData.sculptComponent = {"id": "laptopBase", "name": "白色笔记本机身", "level": "macro", "role": "device-base", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "355×245×16 mm 薄楔形机身，四边 CNC 倒角；掌托与上盖分离，是装配实体。", "geometryDescriptor": {"topologyIntent": "355×245×16 mm 薄楔形机身，四边 CNC 倒角；掌托与上盖分离，是装配实体。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0012, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.355, "height": 0.016, "depth": 0.245, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.2275, 0.8565, -0.05], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hinge-left", "localPosition": [-0.16, 0.018, -0.108]}, {"id": "hinge-right", "localPosition": [0.16, 0.018, -0.108]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.355, 0.016, 0.245], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "laptopWhite", "materialLayers": ["laptopWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rtx-sticker", "kind": "decal", "description": "右下 RTX/Intel 贴纸组。", "evidenceRef": "screen-detail"}, {"id": "hinge-barrel", "kind": "ridge", "description": "后缘双段屏轴，直径约 12 mm。", "evidenceRef": "front-view"}, {"id": "front-lip", "kind": "bevel", "description": "前缘 0.8 mm 倒角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "screen-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_laptopBase_31.userData.actionProfile = {"animationRole": "laptopBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hinge-left", "localPosition": [-0.16, 0.018, -0.108]}, {"id": "hinge-right", "localPosition": [0.16, 0.018, -0.108]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.355, 0.016, 0.245], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_laptopBase_31);
  nodes["laptopBase"] = node_laptopBase_31;
  const mesh_laptopBase_31Geometry = endpoint_laptopBase_31
    ? new THREE.CylinderGeometry(endpoint_laptopBase_31.endRadius, endpoint_laptopBase_31.baseRadius, endpoint_laptopBase_31.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopBase_31) {
    mesh_laptopBase_31Geometry.scale(0.355, 0.016, 0.245);
  }
  const mesh_laptopBase_31 = new THREE.Mesh(
    mesh_laptopBase_31Geometry,
    materialMap["laptopWhite"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopBase_31.name = "\u767d\u8272\u7b14\u8bb0\u672c\u673a\u8eab";
  if (endpoint_laptopBase_31) {
    mesh_laptopBase_31.position.copy(endpoint_laptopBase_31.midpoint);
    mesh_laptopBase_31.quaternion.copy(endpoint_laptopBase_31.quaternion);
  }
  mesh_laptopBase_31.castShadow = options.castShadow ?? true;
  mesh_laptopBase_31.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopBase_31.userData.sculptComponent = {"id": "laptopBase", "name": "白色笔记本机身", "level": "macro", "role": "device-base", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "355×245×16 mm 薄楔形机身，四边 CNC 倒角；掌托与上盖分离，是装配实体。", "geometryDescriptor": {"topologyIntent": "355×245×16 mm 薄楔形机身，四边 CNC 倒角；掌托与上盖分离，是装配实体。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0012, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.355, "height": 0.016, "depth": 0.245, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.2275, 0.8565, -0.05], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hinge-left", "localPosition": [-0.16, 0.018, -0.108]}, {"id": "hinge-right", "localPosition": [0.16, 0.018, -0.108]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.355, 0.016, 0.245], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "laptopWhite", "materialLayers": ["laptopWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rtx-sticker", "kind": "decal", "description": "右下 RTX/Intel 贴纸组。", "evidenceRef": "screen-detail"}, {"id": "hinge-barrel", "kind": "ridge", "description": "后缘双段屏轴，直径约 12 mm。", "evidenceRef": "front-view"}, {"id": "front-lip", "kind": "bevel", "description": "前缘 0.8 mm 倒角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter", "screen-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_laptopBase_31.add(mesh_laptopBase_31);
  meshes["laptopBase"] = mesh_laptopBase_31;
  colliders["laptopBase"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.355, 0.016, 0.245], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopBase-pivot"] ??= [];
  destructionGroups["laptopBase-pivot"].push(node_laptopBase_31);
  const socket_laptopBase_hinge_left_0 = new THREE.Object3D();
  socket_laptopBase_hinge_left_0.name = "hinge-left";
  socket_laptopBase_hinge_left_0.position.set(-0.16, 0.018, -0.108);
  socket_laptopBase_hinge_left_0.rotation.set(0, 0, 0);
  socket_laptopBase_hinge_left_0.userData.socket = {"id": "hinge-left", "localPosition": [-0.16, 0.018, -0.108]};
  node_laptopBase_31.add(socket_laptopBase_hinge_left_0);
  sockets["laptopBase:hinge-left"] = socket_laptopBase_hinge_left_0;
  const socket_laptopBase_hinge_right_1 = new THREE.Object3D();
  socket_laptopBase_hinge_right_1.name = "hinge-right";
  socket_laptopBase_hinge_right_1.position.set(0.16, 0.018, -0.108);
  socket_laptopBase_hinge_right_1.rotation.set(0, 0, 0);
  socket_laptopBase_hinge_right_1.userData.socket = {"id": "hinge-right", "localPosition": [0.16, 0.018, -0.108]};
  node_laptopBase_31.add(socket_laptopBase_hinge_right_1);
  sockets["laptopBase:hinge-right"] = socket_laptopBase_hinge_right_1;

  const endpoint_laptopLid_32 = makeAttachmentEndpoint(null);
  const node_laptopLid_32 = new THREE.Group();
  node_laptopLid_32.name = "\u7b14\u8bb0\u672c\u4e0a\u76d6__pivot";
  node_laptopLid_32.scale.set(1, 1, 1);
  if (endpoint_laptopLid_32) {
    node_laptopLid_32.position.copy(endpoint_laptopLid_32.start);
    node_laptopLid_32.rotation.set(-0.1, 0.0, 0.0);
  } else {
    node_laptopLid_32.position.set(0.0, 0.135, -0.138);
    node_laptopLid_32.rotation.set(-0.1, 0.0, 0.0);
  }
  node_laptopLid_32.userData.sculptComponent = {"id": "laptopLid", "name": "笔记本上盖", "level": "macro", "role": "display-cover", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "350×235×7 mm 上盖；前表面平坦，四边 CNC 小倒角，上缘有微弧过渡。", "geometryDescriptor": {"topologyIntent": "350×235×7 mm 上盖；前表面平坦，四边 CNC 小倒角，上缘有微弧过渡。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.35, "height": 0.235, "depth": 0.007, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.135, -0.138], "rotation": [-0.1, 0, 0]}, "actionProfile": {"animationRole": "laptop-lid-hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "lid-hinge", "localPosition": [0, -0.1175, 0.0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.35, 0.235, 0.007], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid-hinge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "laptopWhite", "materialLayers": ["laptopWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lid-edge-chamfer", "kind": "bevel", "description": "上盖 CNC 倒角细高光。", "evidenceRef": "front-view"}, {"id": "lid-logo-plate", "kind": "decal", "description": "上盖中央暗色铭牌。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopLid_32.userData.actionProfile = {"animationRole": "laptop-lid-hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "lid-hinge", "localPosition": [0, -0.1175, 0.0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.35, 0.235, 0.007], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid-hinge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopLid_32);
  nodes["laptopLid"] = node_laptopLid_32;
  const mesh_laptopLid_32Geometry = endpoint_laptopLid_32
    ? new THREE.CylinderGeometry(endpoint_laptopLid_32.endRadius, endpoint_laptopLid_32.baseRadius, endpoint_laptopLid_32.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopLid_32) {
    mesh_laptopLid_32Geometry.scale(0.35, 0.235, 0.007);
  }
  const mesh_laptopLid_32 = new THREE.Mesh(
    mesh_laptopLid_32Geometry,
    materialMap["laptopWhite"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopLid_32.name = "\u7b14\u8bb0\u672c\u4e0a\u76d6";
  if (endpoint_laptopLid_32) {
    mesh_laptopLid_32.position.copy(endpoint_laptopLid_32.midpoint);
    mesh_laptopLid_32.quaternion.copy(endpoint_laptopLid_32.quaternion);
  }
  mesh_laptopLid_32.castShadow = options.castShadow ?? true;
  mesh_laptopLid_32.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopLid_32.userData.sculptComponent = {"id": "laptopLid", "name": "笔记本上盖", "level": "macro", "role": "display-cover", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "350×235×7 mm 上盖；前表面平坦，四边 CNC 小倒角，上缘有微弧过渡。", "geometryDescriptor": {"topologyIntent": "350×235×7 mm 上盖；前表面平坦，四边 CNC 小倒角，上缘有微弧过渡。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.35, "height": 0.235, "depth": 0.007, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.135, -0.138], "rotation": [-0.1, 0, 0]}, "actionProfile": {"animationRole": "laptop-lid-hinge", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "lid-hinge", "localPosition": [0, -0.1175, 0.0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.35, 0.235, 0.007], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid-hinge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "laptopWhite", "materialLayers": ["laptopWhite"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lid-edge-chamfer", "kind": "bevel", "description": "上盖 CNC 倒角细高光。", "evidenceRef": "front-view"}, {"id": "lid-logo-plate", "kind": "decal", "description": "上盖中央暗色铭牌。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 230, 226, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopLid_32.add(mesh_laptopLid_32);
  meshes["laptopLid"] = mesh_laptopLid_32;
  colliders["laptopLid"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.35, 0.235, 0.007], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptop-lid-hinge"] ??= [];
  destructionGroups["laptop-lid-hinge"].push(node_laptopLid_32);
  const socket_laptopLid_lid_hinge_0 = new THREE.Object3D();
  socket_laptopLid_lid_hinge_0.name = "lid-hinge";
  socket_laptopLid_lid_hinge_0.position.set(0.0, -0.1175, 0.0);
  socket_laptopLid_lid_hinge_0.rotation.set(0, 0, 0);
  socket_laptopLid_lid_hinge_0.userData.socket = {"id": "lid-hinge", "localPosition": [0, -0.1175, 0.0]};
  node_laptopLid_32.add(socket_laptopLid_lid_hinge_0);
  sockets["laptopLid:lid-hinge"] = socket_laptopLid_lid_hinge_0;

  const endpoint_laptopScreen_33 = makeAttachmentEndpoint(null);
  const node_laptopScreen_33 = new THREE.Group();
  node_laptopScreen_33.name = "\u7b14\u8bb0\u672c\u5c4f\u5e55__pivot";
  node_laptopScreen_33.scale.set(1, 1, 1);
  if (endpoint_laptopScreen_33) {
    node_laptopScreen_33.position.copy(endpoint_laptopScreen_33.start);
    node_laptopScreen_33.rotation.set(-0.1, 0.0, 0.0);
  } else {
    node_laptopScreen_33.position.set(0.0, 0.138, -0.131);
    node_laptopScreen_33.rotation.set(-0.1, 0.0, 0.0);
  }
  node_laptopScreen_33.userData.sculptComponent = {"id": "laptopScreen", "name": "笔记本屏幕", "level": "meso", "role": "display-panel", "importance": 0.95, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "屏幕是贴在上盖内侧的 335×205 mm 平面发光层，厚度可忽略，轮廓由上盖边界定义。", "geometryDescriptor": {"topologyIntent": "屏幕是贴在上盖内侧的 335×205 mm 平面发光层，厚度可忽略，轮廓由上盖边界定义。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.338, "height": 0.212, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.138, -0.131], "rotation": [-0.1, 0, 0]}, "actionProfile": {"animationRole": "laptopScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.338, 0.212, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "screenLaptop", "materialLayers": ["screenLaptop"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-outer-shadow", "kind": "seam", "description": "屏幕与边框之间的 1.5 mm 暗缝。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 23, 51, 1.0)", "secondaryAlbedo": "rgba(20, 73, 216, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_laptopScreen_33.userData.actionProfile = {"animationRole": "laptopScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.338, 0.212, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopScreen_33);
  nodes["laptopScreen"] = node_laptopScreen_33;
  const mesh_laptopScreen_33Geometry = endpoint_laptopScreen_33
    ? new THREE.CylinderGeometry(endpoint_laptopScreen_33.endRadius, endpoint_laptopScreen_33.baseRadius, endpoint_laptopScreen_33.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  if (!endpoint_laptopScreen_33) {
    mesh_laptopScreen_33Geometry.scale(0.338, 0.212, 0.001);
  }
  const mesh_laptopScreen_33 = new THREE.Mesh(
    mesh_laptopScreen_33Geometry,
    materialMap["screenLaptop"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopScreen_33.name = "\u7b14\u8bb0\u672c\u5c4f\u5e55";
  if (endpoint_laptopScreen_33) {
    mesh_laptopScreen_33.position.copy(endpoint_laptopScreen_33.midpoint);
    mesh_laptopScreen_33.quaternion.copy(endpoint_laptopScreen_33.quaternion);
  }
  mesh_laptopScreen_33.castShadow = options.castShadow ?? true;
  mesh_laptopScreen_33.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopScreen_33.userData.sculptComponent = {"id": "laptopScreen", "name": "笔记本屏幕", "level": "meso", "role": "display-panel", "importance": 0.95, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "屏幕是贴在上盖内侧的 335×205 mm 平面发光层，厚度可忽略，轮廓由上盖边界定义。", "geometryDescriptor": {"topologyIntent": "屏幕是贴在上盖内侧的 335×205 mm 平面发光层，厚度可忽略，轮廓由上盖边界定义。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.338, "height": 0.212, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.138, -0.131], "rotation": [-0.1, 0, 0]}, "actionProfile": {"animationRole": "laptopScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.338, 0.212, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "screenLaptop", "materialLayers": ["screenLaptop"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-outer-shadow", "kind": "seam", "description": "屏幕与边框之间的 1.5 mm 暗缝。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 23, 51, 1.0)", "secondaryAlbedo": "rgba(20, 73, 216, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_laptopScreen_33.add(mesh_laptopScreen_33);
  meshes["laptopScreen"] = mesh_laptopScreen_33;
  colliders["laptopScreen"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.338, 0.212, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopScreen-pivot"] ??= [];
  destructionGroups["laptopScreen-pivot"].push(node_laptopScreen_33);

  const endpoint_laptopKeyboardDeck_34 = makeAttachmentEndpoint(null);
  const node_laptopKeyboardDeck_34 = new THREE.Group();
  node_laptopKeyboardDeck_34.name = "\u7b14\u8bb0\u672c\u952e\u76d8\u9762__pivot";
  node_laptopKeyboardDeck_34.scale.set(1, 1, 1);
  if (endpoint_laptopKeyboardDeck_34) {
    node_laptopKeyboardDeck_34.position.copy(endpoint_laptopKeyboardDeck_34.start);
    node_laptopKeyboardDeck_34.rotation.set(0.14, 0.0, 0.0);
  } else {
    node_laptopKeyboardDeck_34.position.set(0.0, 0.01, 0.03);
    node_laptopKeyboardDeck_34.rotation.set(0.14, 0.0, 0.0);
  }
  node_laptopKeyboardDeck_34.userData.sculptComponent = {"id": "laptopKeyboardDeck", "name": "笔记本键盘面", "level": "meso", "role": "key-bed", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "浅凹的键床，四周为 10 mm 白色边框；黑色键区在白色掌托中形成明确色块。", "geometryDescriptor": {"topologyIntent": "浅凹的键床，四周为 10 mm 白色边框；黑色键区在白色掌托中形成明确色块。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.33, "height": 0.004, "depth": 0.11, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.01, 0.03], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopKeyboardDeck-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.33, 0.004, 0.11], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopKeyboardDeck-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keyboardDeck", "materialLayers": ["keyboardDeck"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "key-bed-recess", "kind": "groove", "description": "键区相对掌托下凹 1.2 mm。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 54, 58, 1.0)", "secondaryAlbedo": "rgba(222, 220, 215, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_laptopKeyboardDeck_34.userData.actionProfile = {"animationRole": "laptopKeyboardDeck-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.33, 0.004, 0.11], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopKeyboardDeck-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopKeyboardDeck_34);
  nodes["laptopKeyboardDeck"] = node_laptopKeyboardDeck_34;
  const mesh_laptopKeyboardDeck_34Geometry = endpoint_laptopKeyboardDeck_34
    ? new THREE.CylinderGeometry(endpoint_laptopKeyboardDeck_34.endRadius, endpoint_laptopKeyboardDeck_34.baseRadius, endpoint_laptopKeyboardDeck_34.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopKeyboardDeck_34) {
    mesh_laptopKeyboardDeck_34Geometry.scale(0.33, 0.004, 0.11);
  }
  const mesh_laptopKeyboardDeck_34 = new THREE.Mesh(
    mesh_laptopKeyboardDeck_34Geometry,
    materialMap["keyboardDeck"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopKeyboardDeck_34.name = "\u7b14\u8bb0\u672c\u952e\u76d8\u9762";
  if (endpoint_laptopKeyboardDeck_34) {
    mesh_laptopKeyboardDeck_34.position.copy(endpoint_laptopKeyboardDeck_34.midpoint);
    mesh_laptopKeyboardDeck_34.quaternion.copy(endpoint_laptopKeyboardDeck_34.quaternion);
  }
  mesh_laptopKeyboardDeck_34.castShadow = options.castShadow ?? true;
  mesh_laptopKeyboardDeck_34.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopKeyboardDeck_34.userData.sculptComponent = {"id": "laptopKeyboardDeck", "name": "笔记本键盘面", "level": "meso", "role": "key-bed", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "浅凹的键床，四周为 10 mm 白色边框；黑色键区在白色掌托中形成明确色块。", "geometryDescriptor": {"topologyIntent": "浅凹的键床，四周为 10 mm 白色边框；黑色键区在白色掌托中形成明确色块。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.33, "height": 0.004, "depth": 0.11, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.01, 0.03], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopKeyboardDeck-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.33, 0.004, 0.11], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopKeyboardDeck-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keyboardDeck", "materialLayers": ["keyboardDeck"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "key-bed-recess", "kind": "groove", "description": "键区相对掌托下凹 1.2 mm。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(51, 54, 58, 1.0)", "secondaryAlbedo": "rgba(222, 220, 215, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_laptopKeyboardDeck_34.add(mesh_laptopKeyboardDeck_34);
  meshes["laptopKeyboardDeck"] = mesh_laptopKeyboardDeck_34;
  colliders["laptopKeyboardDeck"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.33, 0.004, 0.11], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopKeyboardDeck-pivot"] ??= [];
  destructionGroups["laptopKeyboardDeck-pivot"].push(node_laptopKeyboardDeck_34);

  const endpoint_laptopTrackpad_35 = makeAttachmentEndpoint(null);
  const node_laptopTrackpad_35 = new THREE.Group();
  node_laptopTrackpad_35.name = "\u89e6\u63a7\u677f__pivot";
  node_laptopTrackpad_35.scale.set(1, 1, 1);
  if (endpoint_laptopTrackpad_35) {
    node_laptopTrackpad_35.position.copy(endpoint_laptopTrackpad_35.start);
    node_laptopTrackpad_35.rotation.set(0.14, 0.0, 0.0);
  } else {
    node_laptopTrackpad_35.position.set(0.0, 0.0098, 0.085);
    node_laptopTrackpad_35.rotation.set(0.14, 0.0, 0.0);
  }
  node_laptopTrackpad_35.userData.sculptComponent = {"id": "laptopTrackpad", "name": "触控板", "level": "meso", "role": "trackpad", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "110×70 mm 触控板，边缘 0.3 mm 圆角，玻璃面低粗糙度。", "geometryDescriptor": {"topologyIntent": "110×70 mm 触控板，边缘 0.3 mm 圆角，玻璃面低粗糙度。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.11, "height": 0.002, "depth": 0.07, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0098, 0.085], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopTrackpad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.11, 0.002, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopTrackpad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "trackpadGlass", "materialLayers": ["trackpadGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 225, 221, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_laptopTrackpad_35.userData.actionProfile = {"animationRole": "laptopTrackpad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.11, 0.002, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopTrackpad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopTrackpad_35);
  nodes["laptopTrackpad"] = node_laptopTrackpad_35;
  const mesh_laptopTrackpad_35Geometry = endpoint_laptopTrackpad_35
    ? new THREE.CylinderGeometry(endpoint_laptopTrackpad_35.endRadius, endpoint_laptopTrackpad_35.baseRadius, endpoint_laptopTrackpad_35.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopTrackpad_35) {
    mesh_laptopTrackpad_35Geometry.scale(0.11, 0.002, 0.07);
  }
  const mesh_laptopTrackpad_35 = new THREE.Mesh(
    mesh_laptopTrackpad_35Geometry,
    materialMap["trackpadGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopTrackpad_35.name = "\u89e6\u63a7\u677f";
  if (endpoint_laptopTrackpad_35) {
    mesh_laptopTrackpad_35.position.copy(endpoint_laptopTrackpad_35.midpoint);
    mesh_laptopTrackpad_35.quaternion.copy(endpoint_laptopTrackpad_35.quaternion);
  }
  mesh_laptopTrackpad_35.castShadow = options.castShadow ?? true;
  mesh_laptopTrackpad_35.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopTrackpad_35.userData.sculptComponent = {"id": "laptopTrackpad", "name": "触控板", "level": "meso", "role": "trackpad", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "110×70 mm 触控板，边缘 0.3 mm 圆角，玻璃面低粗糙度。", "geometryDescriptor": {"topologyIntent": "110×70 mm 触控板，边缘 0.3 mm 圆角，玻璃面低粗糙度。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.11, "height": 0.002, "depth": 0.07, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0098, 0.085], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopTrackpad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.11, 0.002, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopTrackpad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "trackpadGlass", "materialLayers": ["trackpadGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 225, 221, 1.0)", "secondaryAlbedo": "rgba(201, 200, 195, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_laptopTrackpad_35.add(mesh_laptopTrackpad_35);
  meshes["laptopTrackpad"] = mesh_laptopTrackpad_35;
  colliders["laptopTrackpad"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.11, 0.002, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopTrackpad-pivot"] ??= [];
  destructionGroups["laptopTrackpad-pivot"].push(node_laptopTrackpad_35);

  const attachment_laptopHinge_36 = {"parentId": "laptopBase", "parentSocket": "hinge-left", "contactType": "socket", "localStart": [-0.16, 0.018, -0.108], "localEnd": [0.16, 0.018, -0.108], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_laptopHinge_36 = makeAttachmentEndpoint(attachment_laptopHinge_36);
  const node_laptopHinge_36 = new THREE.Group();
  node_laptopHinge_36.name = "\u7b14\u8bb0\u672c\u5c4f\u8f74__pivot";
  node_laptopHinge_36.scale.set(1, 1, 1);
  if (endpoint_laptopHinge_36) {
    node_laptopHinge_36.position.copy(endpoint_laptopHinge_36.start);
    node_laptopHinge_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopHinge_36.position.set(0.0, 0.0, 0.0);
    node_laptopHinge_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopHinge_36.userData.sculptComponent = {"id": "laptopHinge", "name": "笔记本屏轴", "level": "meso", "role": "hinge-barrel", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "双段金属屏轴，横向圆柱，直径约 12 mm，藏在机身与上盖之间。", "geometryDescriptor": {"topologyIntent": "双段金属屏轴，横向圆柱，直径约 12 mm，藏在机身与上盖之间。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": {"parentId": "laptopBase", "parentSocket": "hinge-left", "contactType": "socket", "localStart": [-0.16, 0.018, -0.108], "localEnd": [0.16, 0.018, -0.108], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.32, "height": 0.012, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptop-hinge-barrel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-hinge-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopHinge_36.userData.actionProfile = {"animationRole": "laptop-hinge-barrel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-hinge-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopHinge_36);
  nodes["laptopHinge"] = node_laptopHinge_36;
  const mesh_laptopHinge_36Geometry = endpoint_laptopHinge_36
    ? new THREE.CylinderGeometry(endpoint_laptopHinge_36.endRadius, endpoint_laptopHinge_36.baseRadius, endpoint_laptopHinge_36.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_laptopHinge_36) {
    mesh_laptopHinge_36Geometry.scale(0.32, 0.012, 0.012);
  }
  const mesh_laptopHinge_36 = new THREE.Mesh(
    mesh_laptopHinge_36Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopHinge_36.name = "\u7b14\u8bb0\u672c\u5c4f\u8f74";
  if (endpoint_laptopHinge_36) {
    mesh_laptopHinge_36.position.copy(endpoint_laptopHinge_36.midpoint);
    mesh_laptopHinge_36.quaternion.copy(endpoint_laptopHinge_36.quaternion);
  }
  mesh_laptopHinge_36.castShadow = options.castShadow ?? true;
  mesh_laptopHinge_36.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopHinge_36.userData.sculptComponent = {"id": "laptopHinge", "name": "笔记本屏轴", "level": "meso", "role": "hinge-barrel", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "双段金属屏轴，横向圆柱，直径约 12 mm，藏在机身与上盖之间。", "geometryDescriptor": {"topologyIntent": "双段金属屏轴，横向圆柱，直径约 12 mm，藏在机身与上盖之间。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": {"parentId": "laptopBase", "parentSocket": "hinge-left", "contactType": "socket", "localStart": [-0.16, 0.018, -0.108], "localEnd": [0.16, 0.018, -0.108], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.32, "height": 0.012, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptop-hinge-barrel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-hinge-barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopHinge_36.add(mesh_laptopHinge_36);
  meshes["laptopHinge"] = mesh_laptopHinge_36;
  colliders["laptopHinge"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptop-hinge-barrel"] ??= [];
  destructionGroups["laptop-hinge-barrel"].push(node_laptopHinge_36);

  const endpoint_laptopSticker_37 = makeAttachmentEndpoint(null);
  const node_laptopSticker_37 = new THREE.Group();
  node_laptopSticker_37.name = "RTX \u8d34\u7eb8__pivot";
  node_laptopSticker_37.scale.set(1, 1, 1);
  if (endpoint_laptopSticker_37) {
    node_laptopSticker_37.position.copy(endpoint_laptopSticker_37.start);
    node_laptopSticker_37.rotation.set(0.14, 0.0, 0.0);
  } else {
    node_laptopSticker_37.position.set(0.115, 0.0102, 0.072);
    node_laptopSticker_37.rotation.set(0.14, 0.0, 0.0);
  }
  node_laptopSticker_37.userData.sculptComponent = {"id": "laptopSticker", "name": "RTX 贴纸", "level": "meso", "role": "device-sticker", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "0.028×0.012 m 的薄贴纸，贴合掌托右下，右缘略翘。", "geometryDescriptor": {"topologyIntent": "0.028×0.012 m 的薄贴纸，贴合掌托右下，右缘略翘。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.028, "height": 0.0012, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.115, 0.0102, 0.072], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.0012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "stickerBlue", "materialLayers": ["stickerBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 182, 201, 1.0)", "secondaryAlbedo": "rgba(27, 79, 160, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_laptopSticker_37.userData.actionProfile = {"animationRole": "laptopSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.0012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopSticker_37);
  nodes["laptopSticker"] = node_laptopSticker_37;
  const mesh_laptopSticker_37Geometry = endpoint_laptopSticker_37
    ? new THREE.CylinderGeometry(endpoint_laptopSticker_37.endRadius, endpoint_laptopSticker_37.baseRadius, endpoint_laptopSticker_37.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopSticker_37) {
    mesh_laptopSticker_37Geometry.scale(0.028, 0.0012, 0.012);
  }
  const mesh_laptopSticker_37 = new THREE.Mesh(
    mesh_laptopSticker_37Geometry,
    materialMap["stickerBlue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopSticker_37.name = "RTX \u8d34\u7eb8";
  if (endpoint_laptopSticker_37) {
    mesh_laptopSticker_37.position.copy(endpoint_laptopSticker_37.midpoint);
    mesh_laptopSticker_37.quaternion.copy(endpoint_laptopSticker_37.quaternion);
  }
  mesh_laptopSticker_37.castShadow = options.castShadow ?? true;
  mesh_laptopSticker_37.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopSticker_37.userData.sculptComponent = {"id": "laptopSticker", "name": "RTX 贴纸", "level": "meso", "role": "device-sticker", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "0.028×0.012 m 的薄贴纸，贴合掌托右下，右缘略翘。", "geometryDescriptor": {"topologyIntent": "0.028×0.012 m 的薄贴纸，贴合掌托右下，右缘略翘。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.028, "height": 0.0012, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.115, 0.0102, 0.072], "rotation": [0.14, 0, 0]}, "actionProfile": {"animationRole": "laptopSticker-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.0012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopSticker-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "stickerBlue", "materialLayers": ["stickerBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 182, 201, 1.0)", "secondaryAlbedo": "rgba(27, 79, 160, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_laptopSticker_37.add(mesh_laptopSticker_37);
  meshes["laptopSticker"] = mesh_laptopSticker_37;
  colliders["laptopSticker"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.0012, 0.012], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopSticker-pivot"] ??= [];
  destructionGroups["laptopSticker-pivot"].push(node_laptopSticker_37);

  const endpoint_laptopStandBase_38 = makeAttachmentEndpoint(null);
  const node_laptopStandBase_38 = new THREE.Group();
  node_laptopStandBase_38.name = "\u7070\u8272\u7b14\u8bb0\u672c\u652f\u67b6\u5e95\u5ea7__pivot";
  node_laptopStandBase_38.scale.set(1, 1, 1);
  if (endpoint_laptopStandBase_38) {
    node_laptopStandBase_38.position.copy(endpoint_laptopStandBase_38.start);
    node_laptopStandBase_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopStandBase_38.position.set(0.0, -0.0915, -0.02);
    node_laptopStandBase_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopStandBase_38.userData.sculptComponent = {"id": "laptopStandBase", "name": "灰色笔记本支架底座", "level": "meso", "role": "stand-base", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "310×205×12 mm 铝底板，四角有硅胶脚垫，前端略向外伸。", "geometryDescriptor": {"topologyIntent": "310×205×12 mm 铝底板，四角有硅胶脚垫，前端略向外伸。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.31, "height": 0.012, "depth": 0.205, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.0915, -0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.31, 0.012, 0.205], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandBase_38.userData.actionProfile = {"animationRole": "laptopStandBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.31, 0.012, 0.205], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopStandBase_38);
  nodes["laptopStandBase"] = node_laptopStandBase_38;
  const mesh_laptopStandBase_38Geometry = endpoint_laptopStandBase_38
    ? new THREE.CylinderGeometry(endpoint_laptopStandBase_38.endRadius, endpoint_laptopStandBase_38.baseRadius, endpoint_laptopStandBase_38.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopStandBase_38) {
    mesh_laptopStandBase_38Geometry.scale(0.31, 0.012, 0.205);
  }
  const mesh_laptopStandBase_38 = new THREE.Mesh(
    mesh_laptopStandBase_38Geometry,
    materialMap["standMetal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopStandBase_38.name = "\u7070\u8272\u7b14\u8bb0\u672c\u652f\u67b6\u5e95\u5ea7";
  if (endpoint_laptopStandBase_38) {
    mesh_laptopStandBase_38.position.copy(endpoint_laptopStandBase_38.midpoint);
    mesh_laptopStandBase_38.quaternion.copy(endpoint_laptopStandBase_38.quaternion);
  }
  mesh_laptopStandBase_38.castShadow = options.castShadow ?? true;
  mesh_laptopStandBase_38.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopStandBase_38.userData.sculptComponent = {"id": "laptopStandBase", "name": "灰色笔记本支架底座", "level": "meso", "role": "stand-base", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "310×205×12 mm 铝底板，四角有硅胶脚垫，前端略向外伸。", "geometryDescriptor": {"topologyIntent": "310×205×12 mm 铝底板，四角有硅胶脚垫，前端略向外伸。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.31, "height": 0.012, "depth": 0.205, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.0915, -0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.31, 0.012, 0.205], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandBase_38.add(mesh_laptopStandBase_38);
  meshes["laptopStandBase"] = mesh_laptopStandBase_38;
  colliders["laptopStandBase"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.31, 0.012, 0.205], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopStandBase-pivot"] ??= [];
  destructionGroups["laptopStandBase-pivot"].push(node_laptopStandBase_38);

  const endpoint_laptopStandRailL_39 = makeAttachmentEndpoint(null);
  const node_laptopStandRailL_39 = new THREE.Group();
  node_laptopStandRailL_39.name = "\u652f\u67b6\u7acb\u67f1 L__pivot";
  node_laptopStandRailL_39.scale.set(1, 1, 1);
  if (endpoint_laptopStandRailL_39) {
    node_laptopStandRailL_39.position.copy(endpoint_laptopStandRailL_39.start);
    node_laptopStandRailL_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopStandRailL_39.position.set(-0.145, -0.046, -0.08);
    node_laptopStandRailL_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopStandRailL_39.userData.sculptComponent = {"id": "laptopStandRailL", "name": "支架立柱 L", "level": "meso", "role": "stand-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "geometryDescriptor": {"topologyIntent": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.018, "height": 0.076, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.145, -0.046, -0.08], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandRailL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandRailL_39.userData.actionProfile = {"animationRole": "laptopStandRailL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopStandRailL_39);
  nodes["laptopStandRailL"] = node_laptopStandRailL_39;
  const mesh_laptopStandRailL_39Geometry = endpoint_laptopStandRailL_39
    ? new THREE.CylinderGeometry(endpoint_laptopStandRailL_39.endRadius, endpoint_laptopStandRailL_39.baseRadius, endpoint_laptopStandRailL_39.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopStandRailL_39) {
    mesh_laptopStandRailL_39Geometry.scale(0.018, 0.076, 0.025);
  }
  const mesh_laptopStandRailL_39 = new THREE.Mesh(
    mesh_laptopStandRailL_39Geometry,
    materialMap["standMetal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopStandRailL_39.name = "\u652f\u67b6\u7acb\u67f1 L";
  if (endpoint_laptopStandRailL_39) {
    mesh_laptopStandRailL_39.position.copy(endpoint_laptopStandRailL_39.midpoint);
    mesh_laptopStandRailL_39.quaternion.copy(endpoint_laptopStandRailL_39.quaternion);
  }
  mesh_laptopStandRailL_39.castShadow = options.castShadow ?? true;
  mesh_laptopStandRailL_39.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopStandRailL_39.userData.sculptComponent = {"id": "laptopStandRailL", "name": "支架立柱 L", "level": "meso", "role": "stand-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "geometryDescriptor": {"topologyIntent": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.018, "height": 0.076, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.145, -0.046, -0.08], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandRailL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandRailL_39.add(mesh_laptopStandRailL_39);
  meshes["laptopStandRailL"] = mesh_laptopStandRailL_39;
  colliders["laptopStandRailL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopStandRailL-pivot"] ??= [];
  destructionGroups["laptopStandRailL-pivot"].push(node_laptopStandRailL_39);

  const endpoint_laptopStandRailR_40 = makeAttachmentEndpoint(null);
  const node_laptopStandRailR_40 = new THREE.Group();
  node_laptopStandRailR_40.name = "\u652f\u67b6\u7acb\u67f1 R__pivot";
  node_laptopStandRailR_40.scale.set(1, 1, 1);
  if (endpoint_laptopStandRailR_40) {
    node_laptopStandRailR_40.position.copy(endpoint_laptopStandRailR_40.start);
    node_laptopStandRailR_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopStandRailR_40.position.set(0.145, -0.046, -0.08);
    node_laptopStandRailR_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopStandRailR_40.userData.sculptComponent = {"id": "laptopStandRailR", "name": "支架立柱 R", "level": "meso", "role": "stand-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "geometryDescriptor": {"topologyIntent": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.018, "height": 0.076, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.145, -0.046, -0.08], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandRailR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandRailR_40.userData.actionProfile = {"animationRole": "laptopStandRailR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopStandRailR_40);
  nodes["laptopStandRailR"] = node_laptopStandRailR_40;
  const mesh_laptopStandRailR_40Geometry = endpoint_laptopStandRailR_40
    ? new THREE.CylinderGeometry(endpoint_laptopStandRailR_40.endRadius, endpoint_laptopStandRailR_40.baseRadius, endpoint_laptopStandRailR_40.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopStandRailR_40) {
    mesh_laptopStandRailR_40Geometry.scale(0.018, 0.076, 0.025);
  }
  const mesh_laptopStandRailR_40 = new THREE.Mesh(
    mesh_laptopStandRailR_40Geometry,
    materialMap["standMetal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopStandRailR_40.name = "\u652f\u67b6\u7acb\u67f1 R";
  if (endpoint_laptopStandRailR_40) {
    mesh_laptopStandRailR_40.position.copy(endpoint_laptopStandRailR_40.midpoint);
    mesh_laptopStandRailR_40.quaternion.copy(endpoint_laptopStandRailR_40.quaternion);
  }
  mesh_laptopStandRailR_40.castShadow = options.castShadow ?? true;
  mesh_laptopStandRailR_40.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopStandRailR_40.userData.sculptComponent = {"id": "laptopStandRailR", "name": "支架立柱 R", "level": "meso", "role": "stand-rail", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "geometryDescriptor": {"topologyIntent": "18×76×25 mm 灰色金属立柱，从底板升至笔记本后缘，形成双层支架。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.018, "height": 0.076, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.145, -0.046, -0.08], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandRailR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandRailR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandRailR_40.add(mesh_laptopStandRailR_40);
  meshes["laptopStandRailR"] = mesh_laptopStandRailR_40;
  colliders["laptopStandRailR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.076, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopStandRailR-pivot"] ??= [];
  destructionGroups["laptopStandRailR-pivot"].push(node_laptopStandRailR_40);

  const endpoint_laptopStandLip_41 = makeAttachmentEndpoint(null);
  const node_laptopStandLip_41 = new THREE.Group();
  node_laptopStandLip_41.name = "\u652f\u67b6\u524d\u6258\u94a9__pivot";
  node_laptopStandLip_41.scale.set(1, 1, 1);
  if (endpoint_laptopStandLip_41) {
    node_laptopStandLip_41.position.copy(endpoint_laptopStandLip_41.start);
    node_laptopStandLip_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopStandLip_41.position.set(0.0, -0.012, 0.1);
    node_laptopStandLip_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopStandLip_41.userData.sculptComponent = {"id": "laptopStandLip", "name": "支架前托钩", "level": "meso", "role": "stand-lip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300 mm 宽前托钩，托住笔记本前缘，内侧贴硅胶。", "geometryDescriptor": {"topologyIntent": "300 mm 宽前托钩，托住笔记本前缘，内侧贴硅胶。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.3, "height": 0.022, "depth": 0.016, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.012, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandLip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.022, 0.016], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandLip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-lip-silicone", "kind": "ridge", "description": "托钩内侧硅胶条形成细黑线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandLip_41.userData.actionProfile = {"animationRole": "laptopStandLip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.022, 0.016], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandLip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopStandLip_41);
  nodes["laptopStandLip"] = node_laptopStandLip_41;
  const mesh_laptopStandLip_41Geometry = endpoint_laptopStandLip_41
    ? new THREE.CylinderGeometry(endpoint_laptopStandLip_41.endRadius, endpoint_laptopStandLip_41.baseRadius, endpoint_laptopStandLip_41.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopStandLip_41) {
    mesh_laptopStandLip_41Geometry.scale(0.3, 0.022, 0.016);
  }
  const mesh_laptopStandLip_41 = new THREE.Mesh(
    mesh_laptopStandLip_41Geometry,
    materialMap["standMetal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopStandLip_41.name = "\u652f\u67b6\u524d\u6258\u94a9";
  if (endpoint_laptopStandLip_41) {
    mesh_laptopStandLip_41.position.copy(endpoint_laptopStandLip_41.midpoint);
    mesh_laptopStandLip_41.quaternion.copy(endpoint_laptopStandLip_41.quaternion);
  }
  mesh_laptopStandLip_41.castShadow = options.castShadow ?? true;
  mesh_laptopStandLip_41.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopStandLip_41.userData.sculptComponent = {"id": "laptopStandLip", "name": "支架前托钩", "level": "meso", "role": "stand-lip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300 mm 宽前托钩，托住笔记本前缘，内侧贴硅胶。", "geometryDescriptor": {"topologyIntent": "300 mm 宽前托钩，托住笔记本前缘，内侧贴硅胶。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.3, "height": 0.022, "depth": 0.016, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.012, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandLip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.022, 0.016], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandLip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-lip-silicone", "kind": "ridge", "description": "托钩内侧硅胶条形成细黑线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 192, 1.0)", "secondaryAlbedo": "rgba(141, 146, 151, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandLip_41.add(mesh_laptopStandLip_41);
  meshes["laptopStandLip"] = mesh_laptopStandLip_41;
  colliders["laptopStandLip"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.022, 0.016], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopStandLip-pivot"] ??= [];
  destructionGroups["laptopStandLip-pivot"].push(node_laptopStandLip_41);

  const endpoint_laptopStandCrossbar_42 = makeAttachmentEndpoint(null);
  const node_laptopStandCrossbar_42 = new THREE.Group();
  node_laptopStandCrossbar_42.name = "\u652f\u67b6\u6a2a\u6881__pivot";
  node_laptopStandCrossbar_42.scale.set(1, 1, 1);
  if (endpoint_laptopStandCrossbar_42) {
    node_laptopStandCrossbar_42.position.copy(endpoint_laptopStandCrossbar_42.start);
    node_laptopStandCrossbar_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptopStandCrossbar_42.position.set(0.0, -0.046, -0.078);
    node_laptopStandCrossbar_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptopStandCrossbar_42.userData.sculptComponent = {"id": "laptopStandCrossbar", "name": "支架横梁", "level": "meso", "role": "stand-crossbar", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300×18×25 mm 灰色横梁，连接两根立柱，正面可见两颗螺钉。", "geometryDescriptor": {"topologyIntent": "300×18×25 mm 灰色横梁，连接两根立柱，正面可见两颗螺钉。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.3, "height": 0.018, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.046, -0.078], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandCrossbar-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.018, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandCrossbar-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-screw-left", "kind": "fastener", "description": "左侧 M4 内六角螺钉。", "evidenceRef": "front-view"}, {"id": "stand-screw-right", "kind": "fastener", "description": "右侧 M4 内六角螺钉。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(133, 138, 142, 1.0)", "secondaryAlbedo": "rgba(92, 97, 101, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandCrossbar_42.userData.actionProfile = {"animationRole": "laptopStandCrossbar-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.018, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandCrossbar-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["laptopBase"] ?? root).add(node_laptopStandCrossbar_42);
  nodes["laptopStandCrossbar"] = node_laptopStandCrossbar_42;
  const mesh_laptopStandCrossbar_42Geometry = endpoint_laptopStandCrossbar_42
    ? new THREE.CylinderGeometry(endpoint_laptopStandCrossbar_42.endRadius, endpoint_laptopStandCrossbar_42.baseRadius, endpoint_laptopStandCrossbar_42.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_laptopStandCrossbar_42) {
    mesh_laptopStandCrossbar_42Geometry.scale(0.3, 0.018, 0.025);
  }
  const mesh_laptopStandCrossbar_42 = new THREE.Mesh(
    mesh_laptopStandCrossbar_42Geometry,
    materialMap["standMetal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptopStandCrossbar_42.name = "\u652f\u67b6\u6a2a\u6881";
  if (endpoint_laptopStandCrossbar_42) {
    mesh_laptopStandCrossbar_42.position.copy(endpoint_laptopStandCrossbar_42.midpoint);
    mesh_laptopStandCrossbar_42.quaternion.copy(endpoint_laptopStandCrossbar_42.quaternion);
  }
  mesh_laptopStandCrossbar_42.castShadow = options.castShadow ?? true;
  mesh_laptopStandCrossbar_42.receiveShadow = options.receiveShadow ?? true;
  mesh_laptopStandCrossbar_42.userData.sculptComponent = {"id": "laptopStandCrossbar", "name": "支架横梁", "level": "meso", "role": "stand-crossbar", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300×18×25 mm 灰色横梁，连接两根立柱，正面可见两颗螺钉。", "geometryDescriptor": {"topologyIntent": "300×18×25 mm 灰色横梁，连接两根立柱，正面可见两颗螺钉。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "laptopBase", "attachment": null, "dimensions": {"width": 0.3, "height": 0.018, "depth": 0.025, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.046, -0.078], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "laptopStandCrossbar-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.018, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptopStandCrossbar-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "standMetal", "materialLayers": ["standMetal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-screw-left", "kind": "fastener", "description": "左侧 M4 内六角螺钉。", "evidenceRef": "front-view"}, {"id": "stand-screw-right", "kind": "fastener", "description": "右侧 M4 内六角螺钉。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "left-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(133, 138, 142, 1.0)", "secondaryAlbedo": "rgba(92, 97, 101, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_laptopStandCrossbar_42.add(mesh_laptopStandCrossbar_42);
  meshes["laptopStandCrossbar"] = mesh_laptopStandCrossbar_42;
  colliders["laptopStandCrossbar"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.018, 0.025], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["laptopStandCrossbar-pivot"] ??= [];
  destructionGroups["laptopStandCrossbar-pivot"].push(node_laptopStandCrossbar_42);

  const endpoint_monitor_43 = makeAttachmentEndpoint(null);
  const node_monitor_43 = new THREE.Group();
  node_monitor_43.name = "AOC 23.8 \u82f1\u5bf8\u663e\u793a\u5668__pivot";
  node_monitor_43.scale.set(1, 1, 1);
  if (endpoint_monitor_43) {
    node_monitor_43.position.copy(endpoint_monitor_43.start);
    node_monitor_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitor_43.position.set(0.235, 0.9955, -0.15);
    node_monitor_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitor_43.userData.sculptComponent = {"id": "monitor", "name": "AOC 23.8 英寸显示器", "level": "macro", "role": "display-bezel", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "540×322×28 mm 的 23.8 英寸显示器前面板；三边窄边、下巴较厚，背面为弧面壳体。右缘贴右隔断木饰面内表面。", "geometryDescriptor": {"topologyIntent": "540×322×28 mm 的 23.8 英寸显示器前面板；三边窄边、下巴较厚，背面为弧面壳体。右缘贴右隔断木饰面内表面。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0008, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.54, "height": 0.322, "depth": 0.028, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.235, 0.9955, -0.15], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-pan-tilt", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "stand-mount", "localPosition": [0, -0.16, -0.02]}, {"id": "screen-plane", "localPosition": [0, 0, 0.015]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.54, 0.322, 0.028], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-pan-tilt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bezel-chamfer", "kind": "bevel", "description": "窄边框 0.5 mm 倒角高光。", "evidenceRef": "front-view"}, {"id": "aoc-logo", "kind": "decal", "description": "下巴中央银色 AOC 字标。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "right-three-quarter", "screen-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_monitor_43.userData.actionProfile = {"animationRole": "monitor-pan-tilt", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "stand-mount", "localPosition": [0, -0.16, -0.02]}, {"id": "screen-plane", "localPosition": [0, 0, 0.015]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.54, 0.322, 0.028], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-pan-tilt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_monitor_43);
  nodes["monitor"] = node_monitor_43;
  const mesh_monitor_43Geometry = endpoint_monitor_43
    ? new THREE.CylinderGeometry(endpoint_monitor_43.endRadius, endpoint_monitor_43.baseRadius, endpoint_monitor_43.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_monitor_43) {
    mesh_monitor_43Geometry.scale(0.54, 0.322, 0.028);
  }
  const mesh_monitor_43 = new THREE.Mesh(
    mesh_monitor_43Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitor_43.name = "AOC 23.8 \u82f1\u5bf8\u663e\u793a\u5668";
  if (endpoint_monitor_43) {
    mesh_monitor_43.position.copy(endpoint_monitor_43.midpoint);
    mesh_monitor_43.quaternion.copy(endpoint_monitor_43.quaternion);
  }
  mesh_monitor_43.castShadow = options.castShadow ?? true;
  mesh_monitor_43.receiveShadow = options.receiveShadow ?? true;
  mesh_monitor_43.userData.sculptComponent = {"id": "monitor", "name": "AOC 23.8 英寸显示器", "level": "macro", "role": "display-bezel", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "540×322×28 mm 的 23.8 英寸显示器前面板；三边窄边、下巴较厚，背面为弧面壳体。右缘贴右隔断木饰面内表面。", "geometryDescriptor": {"topologyIntent": "540×322×28 mm 的 23.8 英寸显示器前面板；三边窄边、下巴较厚，背面为弧面壳体。右缘贴右隔断木饰面内表面。", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0008, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.54, "height": 0.322, "depth": 0.028, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.235, 0.9955, -0.15], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-pan-tilt", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "stand-mount", "localPosition": [0, -0.16, -0.02]}, {"id": "screen-plane", "localPosition": [0, 0, 0.015]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.54, 0.322, 0.028], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-pan-tilt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bezel-chamfer", "kind": "bevel", "description": "窄边框 0.5 mm 倒角高光。", "evidenceRef": "front-view"}, {"id": "aoc-logo", "kind": "decal", "description": "下巴中央银色 AOC 字标。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "right-three-quarter", "screen-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_monitor_43.add(mesh_monitor_43);
  meshes["monitor"] = mesh_monitor_43;
  colliders["monitor"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.54, 0.322, 0.028], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitor-pan-tilt"] ??= [];
  destructionGroups["monitor-pan-tilt"].push(node_monitor_43);
  const socket_monitor_stand_mount_0 = new THREE.Object3D();
  socket_monitor_stand_mount_0.name = "stand-mount";
  socket_monitor_stand_mount_0.position.set(0.0, -0.16, -0.02);
  socket_monitor_stand_mount_0.rotation.set(0, 0, 0);
  socket_monitor_stand_mount_0.userData.socket = {"id": "stand-mount", "localPosition": [0, -0.16, -0.02]};
  node_monitor_43.add(socket_monitor_stand_mount_0);
  sockets["monitor:stand-mount"] = socket_monitor_stand_mount_0;
  const socket_monitor_screen_plane_1 = new THREE.Object3D();
  socket_monitor_screen_plane_1.name = "screen-plane";
  socket_monitor_screen_plane_1.position.set(0.0, 0.0, 0.015);
  socket_monitor_screen_plane_1.rotation.set(0, 0, 0);
  socket_monitor_screen_plane_1.userData.socket = {"id": "screen-plane", "localPosition": [0, 0, 0.015]};
  node_monitor_43.add(socket_monitor_screen_plane_1);
  sockets["monitor:screen-plane"] = socket_monitor_screen_plane_1;

  const endpoint_monitorScreen_44 = makeAttachmentEndpoint(null);
  const node_monitorScreen_44 = new THREE.Group();
  node_monitorScreen_44.name = "AOC \u5c4f\u5e55__pivot";
  node_monitorScreen_44.scale.set(1, 1, 1);
  if (endpoint_monitorScreen_44) {
    node_monitorScreen_44.position.copy(endpoint_monitorScreen_44.start);
    node_monitorScreen_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorScreen_44.position.set(0.0, 0.0, 0.0155);
    node_monitorScreen_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorScreen_44.userData.sculptComponent = {"id": "monitorScreen", "name": "AOC 屏幕", "level": "meso", "role": "display-panel", "importance": 1.0, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "527×296 mm 平面发光层，贴合前面板内侧；玻璃反光率低。", "geometryDescriptor": {"topologyIntent": "527×296 mm 平面发光层，贴合前面板内侧；玻璃反光率低。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.527, "height": 0.296, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0, 0.0155], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.527, 0.296, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "screenMonitor", "materialLayers": ["screenMonitor"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-inner-shadow", "kind": "seam", "description": "屏幕边缘 1.2 mm 内阴影。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 23, 51, 1.0)", "secondaryAlbedo": "rgba(20, 73, 216, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_monitorScreen_44.userData.actionProfile = {"animationRole": "monitorScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.527, 0.296, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorScreen_44);
  nodes["monitorScreen"] = node_monitorScreen_44;
  const mesh_monitorScreen_44Geometry = endpoint_monitorScreen_44
    ? new THREE.CylinderGeometry(endpoint_monitorScreen_44.endRadius, endpoint_monitorScreen_44.baseRadius, endpoint_monitorScreen_44.length, 32, 12)
    : new THREE.PlaneGeometry(1, 1, 24, 24);
  if (!endpoint_monitorScreen_44) {
    mesh_monitorScreen_44Geometry.scale(0.527, 0.296, 0.001);
  }
  const mesh_monitorScreen_44 = new THREE.Mesh(
    mesh_monitorScreen_44Geometry,
    materialMap["screenMonitor"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorScreen_44.name = "AOC \u5c4f\u5e55";
  if (endpoint_monitorScreen_44) {
    mesh_monitorScreen_44.position.copy(endpoint_monitorScreen_44.midpoint);
    mesh_monitorScreen_44.quaternion.copy(endpoint_monitorScreen_44.quaternion);
  }
  mesh_monitorScreen_44.castShadow = options.castShadow ?? true;
  mesh_monitorScreen_44.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorScreen_44.userData.sculptComponent = {"id": "monitorScreen", "name": "AOC 屏幕", "level": "meso", "role": "display-panel", "importance": 1.0, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "527×296 mm 平面发光层，贴合前面板内侧；玻璃反光率低。", "geometryDescriptor": {"topologyIntent": "527×296 mm 平面发光层，贴合前面板内侧；玻璃反光率低。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.527, "height": 0.296, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0, 0.0155], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorScreen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.527, 0.296, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorScreen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "screenMonitor", "materialLayers": ["screenMonitor"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-inner-shadow", "kind": "seam", "description": "屏幕边缘 1.2 mm 内阴影。", "evidenceRef": "screen-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 23, 51, 1.0)", "secondaryAlbedo": "rgba(20, 73, 216, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_monitorScreen_44.add(mesh_monitorScreen_44);
  meshes["monitorScreen"] = mesh_monitorScreen_44;
  colliders["monitorScreen"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.527, 0.296, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitorScreen-pivot"] ??= [];
  destructionGroups["monitorScreen-pivot"].push(node_monitorScreen_44);

  const endpoint_monitorRearHousing_45 = makeAttachmentEndpoint(null);
  const node_monitorRearHousing_45 = new THREE.Group();
  node_monitorRearHousing_45.name = "\u663e\u793a\u5668\u80cc\u58f3__pivot";
  node_monitorRearHousing_45.scale.set(1, 1, 1);
  if (endpoint_monitorRearHousing_45) {
    node_monitorRearHousing_45.position.copy(endpoint_monitorRearHousing_45.start);
    node_monitorRearHousing_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorRearHousing_45.position.set(0.0, 0.0, -0.04);
    node_monitorRearHousing_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorRearHousing_45.userData.sculptComponent = {"id": "monitorRearHousing", "name": "显示器背壳", "level": "meso", "role": "rear-shell", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "440×260×50 mm 弧面背壳，中央有立柱接口与线缆出口。", "geometryDescriptor": {"topologyIntent": "440×260×50 mm 弧面背壳，中央有立柱接口与线缆出口。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.44, "height": 0.26, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorRearHousing-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.44, 0.26, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorRearHousing-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-vent", "kind": "groove", "description": "背壳上缘有一排细散热槽。", "evidenceRef": "right-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorRearHousing_45.userData.actionProfile = {"animationRole": "monitorRearHousing-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.44, 0.26, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorRearHousing-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorRearHousing_45);
  nodes["monitorRearHousing"] = node_monitorRearHousing_45;
  const mesh_monitorRearHousing_45Geometry = endpoint_monitorRearHousing_45
    ? new THREE.CylinderGeometry(endpoint_monitorRearHousing_45.endRadius, endpoint_monitorRearHousing_45.baseRadius, endpoint_monitorRearHousing_45.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_monitorRearHousing_45) {
    mesh_monitorRearHousing_45Geometry.scale(0.44, 0.26, 0.05);
  }
  const mesh_monitorRearHousing_45 = new THREE.Mesh(
    mesh_monitorRearHousing_45Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorRearHousing_45.name = "\u663e\u793a\u5668\u80cc\u58f3";
  if (endpoint_monitorRearHousing_45) {
    mesh_monitorRearHousing_45.position.copy(endpoint_monitorRearHousing_45.midpoint);
    mesh_monitorRearHousing_45.quaternion.copy(endpoint_monitorRearHousing_45.quaternion);
  }
  mesh_monitorRearHousing_45.castShadow = options.castShadow ?? true;
  mesh_monitorRearHousing_45.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorRearHousing_45.userData.sculptComponent = {"id": "monitorRearHousing", "name": "显示器背壳", "level": "meso", "role": "rear-shell", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "440×260×50 mm 弧面背壳，中央有立柱接口与线缆出口。", "geometryDescriptor": {"topologyIntent": "440×260×50 mm 弧面背壳，中央有立柱接口与线缆出口。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.44, "height": 0.26, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorRearHousing-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.44, 0.26, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorRearHousing-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-vent", "kind": "groove", "description": "背壳上缘有一排细散热槽。", "evidenceRef": "right-three-quarter"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorRearHousing_45.add(mesh_monitorRearHousing_45);
  meshes["monitorRearHousing"] = mesh_monitorRearHousing_45;
  colliders["monitorRearHousing"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.44, 0.26, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitorRearHousing-pivot"] ??= [];
  destructionGroups["monitorRearHousing-pivot"].push(node_monitorRearHousing_45);

  const attachment_monitorStandNeck_46 = {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "socket", "localStart": [0, -0.2235, -0.02], "localEnd": [0, -0.16, -0.02], "baseRadius": 0.031, "endRadius": 0.026, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_monitorStandNeck_46 = makeAttachmentEndpoint(attachment_monitorStandNeck_46);
  const node_monitorStandNeck_46 = new THREE.Group();
  node_monitorStandNeck_46.name = "\u663e\u793a\u5668\u7acb\u67f1__pivot";
  node_monitorStandNeck_46.scale.set(1, 1, 1);
  if (endpoint_monitorStandNeck_46) {
    node_monitorStandNeck_46.position.copy(endpoint_monitorStandNeck_46.start);
    node_monitorStandNeck_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorStandNeck_46.position.set(0.0, 0.0, 0.0);
    node_monitorStandNeck_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorStandNeck_46.userData.sculptComponent = {"id": "monitorStandNeck", "name": "显示器立柱", "level": "meso", "role": "pedestal-neck", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "50 mm 宽、64 mm 高的短立柱，内部走线，后侧有卡线槽。", "geometryDescriptor": {"topologyIntent": "50 mm 宽、64 mm 高的短立柱，内部走线，后侧有卡线槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "socket", "localStart": [0, -0.2235, -0.02], "localEnd": [0, -0.16, -0.02], "baseRadius": 0.031, "endRadius": 0.026, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.05, "height": 0.064, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-neck", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.064, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-cable-slot", "kind": "groove", "description": "立柱后侧 8 mm 宽卡线槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_monitorStandNeck_46.userData.actionProfile = {"animationRole": "monitor-neck", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.064, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorStandNeck_46);
  nodes["monitorStandNeck"] = node_monitorStandNeck_46;
  const mesh_monitorStandNeck_46Geometry = endpoint_monitorStandNeck_46
    ? new THREE.CylinderGeometry(endpoint_monitorStandNeck_46.endRadius, endpoint_monitorStandNeck_46.baseRadius, endpoint_monitorStandNeck_46.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_monitorStandNeck_46) {
    mesh_monitorStandNeck_46Geometry.scale(0.05, 0.064, 0.05);
  }
  const mesh_monitorStandNeck_46 = new THREE.Mesh(
    mesh_monitorStandNeck_46Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorStandNeck_46.name = "\u663e\u793a\u5668\u7acb\u67f1";
  if (endpoint_monitorStandNeck_46) {
    mesh_monitorStandNeck_46.position.copy(endpoint_monitorStandNeck_46.midpoint);
    mesh_monitorStandNeck_46.quaternion.copy(endpoint_monitorStandNeck_46.quaternion);
  }
  mesh_monitorStandNeck_46.castShadow = options.castShadow ?? true;
  mesh_monitorStandNeck_46.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorStandNeck_46.userData.sculptComponent = {"id": "monitorStandNeck", "name": "显示器立柱", "level": "meso", "role": "pedestal-neck", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "50 mm 宽、64 mm 高的短立柱，内部走线，后侧有卡线槽。", "geometryDescriptor": {"topologyIntent": "50 mm 宽、64 mm 高的短立柱，内部走线，后侧有卡线槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "socket", "localStart": [0, -0.2235, -0.02], "localEnd": [0, -0.16, -0.02], "baseRadius": 0.031, "endRadius": 0.026, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.05, "height": 0.064, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-neck", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.064, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stand-cable-slot", "kind": "groove", "description": "立柱后侧 8 mm 宽卡线槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_monitorStandNeck_46.add(mesh_monitorStandNeck_46);
  meshes["monitorStandNeck"] = mesh_monitorStandNeck_46;
  colliders["monitorStandNeck"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.064, 0.05], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitor-neck"] ??= [];
  destructionGroups["monitor-neck"].push(node_monitorStandNeck_46);

  const attachment_monitorBase_47 = {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "butt", "localStart": [0, -0.2375, -0.01], "localEnd": [0, -0.2235, -0.01], "baseRadius": 0.1, "endRadius": 0.1, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_monitorBase_47 = makeAttachmentEndpoint(attachment_monitorBase_47);
  const node_monitorBase_47 = new THREE.Group();
  node_monitorBase_47.name = "\u663e\u793a\u5668\u5706\u76d8\u5e95\u5ea7__pivot";
  node_monitorBase_47.scale.set(1, 1, 1);
  if (endpoint_monitorBase_47) {
    node_monitorBase_47.position.copy(endpoint_monitorBase_47.start);
    node_monitorBase_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorBase_47.position.set(0.0, 0.0, 0.0);
    node_monitorBase_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorBase_47.userData.sculptComponent = {"id": "monitorBase", "name": "显示器圆盘底座", "level": "meso", "role": "pedestal-base", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 200 mm、厚 14 mm 的圆盘底座，底面有四个橡胶脚垫。", "geometryDescriptor": {"topologyIntent": "直径 200 mm、厚 14 mm 的圆盘底座，底面有四个橡胶脚垫。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "butt", "localStart": [0, -0.2375, -0.01], "localEnd": [0, -0.2235, -0.01], "baseRadius": 0.1, "endRadius": 0.1, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.2, "height": 0.014, "depth": 0.2, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-base", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.014, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_monitorBase_47.userData.actionProfile = {"animationRole": "monitor-base", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.014, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorBase_47);
  nodes["monitorBase"] = node_monitorBase_47;
  const mesh_monitorBase_47Geometry = endpoint_monitorBase_47
    ? new THREE.CylinderGeometry(endpoint_monitorBase_47.endRadius, endpoint_monitorBase_47.baseRadius, endpoint_monitorBase_47.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_monitorBase_47) {
    mesh_monitorBase_47Geometry.scale(0.2, 0.014, 0.2);
  }
  const mesh_monitorBase_47 = new THREE.Mesh(
    mesh_monitorBase_47Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorBase_47.name = "\u663e\u793a\u5668\u5706\u76d8\u5e95\u5ea7";
  if (endpoint_monitorBase_47) {
    mesh_monitorBase_47.position.copy(endpoint_monitorBase_47.midpoint);
    mesh_monitorBase_47.quaternion.copy(endpoint_monitorBase_47.quaternion);
  }
  mesh_monitorBase_47.castShadow = options.castShadow ?? true;
  mesh_monitorBase_47.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorBase_47.userData.sculptComponent = {"id": "monitorBase", "name": "显示器圆盘底座", "level": "meso", "role": "pedestal-base", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 200 mm、厚 14 mm 的圆盘底座，底面有四个橡胶脚垫。", "geometryDescriptor": {"topologyIntent": "直径 200 mm、厚 14 mm 的圆盘底座，底面有四个橡胶脚垫。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": {"parentId": "monitor", "parentSocket": "stand-mount", "contactType": "butt", "localStart": [0, -0.2375, -0.01], "localEnd": [0, -0.2235, -0.01], "baseRadius": 0.1, "endRadius": 0.1, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.2, "height": 0.014, "depth": 0.2, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitor-base", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.014, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_monitorBase_47.add(mesh_monitorBase_47);
  meshes["monitorBase"] = mesh_monitorBase_47;
  colliders["monitorBase"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.014, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitor-base"] ??= [];
  destructionGroups["monitor-base"].push(node_monitorBase_47);

  const endpoint_monitorClip_48 = makeAttachmentEndpoint(null);
  const node_monitorClip_48 = new THREE.Group();
  node_monitorClip_48.name = "\u663e\u793a\u5668\u7ebf\u5939__pivot";
  node_monitorClip_48.scale.set(1, 1, 1);
  if (endpoint_monitorClip_48) {
    node_monitorClip_48.position.copy(endpoint_monitorClip_48.start);
    node_monitorClip_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorClip_48.position.set(0.0, -0.19, -0.065);
    node_monitorClip_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorClip_48.userData.sculptComponent = {"id": "monitorClip", "name": "显示器线夹", "level": "meso", "role": "cable-clip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "竖向黑色理线夹，将两根线压在立柱后方。", "geometryDescriptor": {"topologyIntent": "竖向黑色理线夹，将两根线压在立柱后方。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.022, "height": 0.075, "depth": 0.018, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.19, -0.065], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorClip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.075, 0.018], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorClip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorClip_48.userData.actionProfile = {"animationRole": "monitorClip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.075, 0.018], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorClip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorClip_48);
  nodes["monitorClip"] = node_monitorClip_48;
  const mesh_monitorClip_48Geometry = endpoint_monitorClip_48
    ? new THREE.CylinderGeometry(endpoint_monitorClip_48.endRadius, endpoint_monitorClip_48.baseRadius, endpoint_monitorClip_48.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_monitorClip_48) {
    mesh_monitorClip_48Geometry.scale(0.022, 0.075, 0.018);
  }
  const mesh_monitorClip_48 = new THREE.Mesh(
    mesh_monitorClip_48Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorClip_48.name = "\u663e\u793a\u5668\u7ebf\u5939";
  if (endpoint_monitorClip_48) {
    mesh_monitorClip_48.position.copy(endpoint_monitorClip_48.midpoint);
    mesh_monitorClip_48.quaternion.copy(endpoint_monitorClip_48.quaternion);
  }
  mesh_monitorClip_48.castShadow = options.castShadow ?? true;
  mesh_monitorClip_48.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorClip_48.userData.sculptComponent = {"id": "monitorClip", "name": "显示器线夹", "level": "meso", "role": "cable-clip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "竖向黑色理线夹，将两根线压在立柱后方。", "geometryDescriptor": {"topologyIntent": "竖向黑色理线夹，将两根线压在立柱后方。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.022, "height": 0.075, "depth": 0.018, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.19, -0.065], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorClip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.075, 0.018], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorClip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorClip_48.add(mesh_monitorClip_48);
  meshes["monitorClip"] = mesh_monitorClip_48;
  colliders["monitorClip"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.075, 0.018], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitorClip-pivot"] ??= [];
  destructionGroups["monitorClip-pivot"].push(node_monitorClip_48);

  const endpoint_monitorLed_49 = makeAttachmentEndpoint(null);
  const node_monitorLed_49 = new THREE.Group();
  node_monitorLed_49.name = "\u663e\u793a\u5668\u7535\u6e90\u706f__pivot";
  node_monitorLed_49.scale.set(1, 1, 1);
  if (endpoint_monitorLed_49) {
    node_monitorLed_49.position.copy(endpoint_monitorLed_49.start);
    node_monitorLed_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitorLed_49.position.set(0.2, -0.15, 0.0158);
    node_monitorLed_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitorLed_49.userData.sculptComponent = {"id": "monitorLed", "name": "显示器电源灯", "level": "meso", "role": "power-led", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右下巴的 4 mm 方形指示灯，蓝色自发光。", "geometryDescriptor": {"topologyIntent": "右下巴的 4 mm 方形指示灯，蓝色自发光。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.004, "height": 0.004, "depth": 0.0015, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.2, -0.15, 0.0158], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorLed-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.0015], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorLed-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "ledBlue", "materialLayers": ["ledBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 214, 255, 1.0)", "secondaryAlbedo": "rgba(10, 42, 160, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorLed_49.userData.actionProfile = {"animationRole": "monitorLed-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.0015], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorLed-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["monitor"] ?? root).add(node_monitorLed_49);
  nodes["monitorLed"] = node_monitorLed_49;
  const mesh_monitorLed_49Geometry = endpoint_monitorLed_49
    ? new THREE.CylinderGeometry(endpoint_monitorLed_49.endRadius, endpoint_monitorLed_49.baseRadius, endpoint_monitorLed_49.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_monitorLed_49) {
    mesh_monitorLed_49Geometry.scale(0.004, 0.004, 0.0015);
  }
  const mesh_monitorLed_49 = new THREE.Mesh(
    mesh_monitorLed_49Geometry,
    materialMap["ledBlue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitorLed_49.name = "\u663e\u793a\u5668\u7535\u6e90\u706f";
  if (endpoint_monitorLed_49) {
    mesh_monitorLed_49.position.copy(endpoint_monitorLed_49.midpoint);
    mesh_monitorLed_49.quaternion.copy(endpoint_monitorLed_49.quaternion);
  }
  mesh_monitorLed_49.castShadow = options.castShadow ?? true;
  mesh_monitorLed_49.receiveShadow = options.receiveShadow ?? true;
  mesh_monitorLed_49.userData.sculptComponent = {"id": "monitorLed", "name": "显示器电源灯", "level": "meso", "role": "power-led", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右下巴的 4 mm 方形指示灯，蓝色自发光。", "geometryDescriptor": {"topologyIntent": "右下巴的 4 mm 方形指示灯，蓝色自发光。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "monitor", "attachment": null, "dimensions": {"width": 0.004, "height": 0.004, "depth": 0.0015, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.2, -0.15, 0.0158], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "monitorLed-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.0015], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitorLed-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "ledBlue", "materialLayers": ["ledBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["screen-detail"], "details": [], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 214, 255, 1.0)", "secondaryAlbedo": "rgba(10, 42, 160, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_monitorLed_49.add(mesh_monitorLed_49);
  meshes["monitorLed"] = mesh_monitorLed_49;
  colliders["monitorLed"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.0015], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["monitorLed-pivot"] ??= [];
  destructionGroups["monitorLed-pivot"].push(node_monitorLed_49);

  const endpoint_keyboard_50 = makeAttachmentEndpoint(null);
  const node_keyboard_50 = new THREE.Group();
  node_keyboard_50.name = "98 \u952e\u673a\u68b0\u952e\u76d8__pivot";
  node_keyboard_50.scale.set(1, 1, 1);
  if (endpoint_keyboard_50) {
    node_keyboard_50.position.copy(endpoint_keyboard_50.start);
    node_keyboard_50.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboard_50.position.set(-0.1, 0.775, 0.11);
    node_keyboard_50.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboard_50.userData.sculptComponent = {"id": "keyboard", "name": "98 键机械键盘", "level": "macro", "role": "keyboard-case", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "390×145×35 mm 黑色上下壳，四角 3 mm 圆角，前缘低后缘高；右上切出旋钮位。", "geometryDescriptor": {"topologyIntent": "390×145×35 mm 黑色上下壳，四角 3 mm 圆角，前缘低后缘高；右上切出旋钮位。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0025, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.39, "height": 0.035, "depth": 0.145, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1, 0.775, 0.11], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboard-rgb", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "knob-mount", "localPosition": [0.166, 0.03, -0.035]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.035, 0.145], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-rgb", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keyboardShell", "materialLayers": ["keyboardShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "case-chamfer", "kind": "bevel", "description": "上壳 1 mm 圆角高光。", "evidenceRef": "front-view"}, {"id": "case-side-seam", "kind": "seam", "description": "上下壳之间 0.4 mm 分模线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 35, 38, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_keyboard_50.userData.actionProfile = {"animationRole": "keyboard-rgb", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "knob-mount", "localPosition": [0.166, 0.03, -0.035]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.035, 0.145], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-rgb", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_keyboard_50);
  nodes["keyboard"] = node_keyboard_50;
  const mesh_keyboard_50Geometry = endpoint_keyboard_50
    ? new THREE.CylinderGeometry(endpoint_keyboard_50.endRadius, endpoint_keyboard_50.baseRadius, endpoint_keyboard_50.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keyboard_50) {
    mesh_keyboard_50Geometry.scale(0.39, 0.035, 0.145);
  }
  const mesh_keyboard_50 = new THREE.Mesh(
    mesh_keyboard_50Geometry,
    materialMap["keyboardShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboard_50.name = "98 \u952e\u673a\u68b0\u952e\u76d8";
  if (endpoint_keyboard_50) {
    mesh_keyboard_50.position.copy(endpoint_keyboard_50.midpoint);
    mesh_keyboard_50.quaternion.copy(endpoint_keyboard_50.quaternion);
  }
  mesh_keyboard_50.castShadow = options.castShadow ?? true;
  mesh_keyboard_50.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboard_50.userData.sculptComponent = {"id": "keyboard", "name": "98 键机械键盘", "level": "macro", "role": "keyboard-case", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "390×145×35 mm 黑色上下壳，四角 3 mm 圆角，前缘低后缘高；右上切出旋钮位。", "geometryDescriptor": {"topologyIntent": "390×145×35 mm 黑色上下壳，四角 3 mm 圆角，前缘低后缘高；右上切出旋钮位。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0025, "segments": 3}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.39, "height": 0.035, "depth": 0.145, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1, 0.775, 0.11], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboard-rgb", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "knob-mount", "localPosition": [0.166, 0.03, -0.035]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.035, 0.145], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-rgb", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keyboardShell", "materialLayers": ["keyboardShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "case-chamfer", "kind": "bevel", "description": "上壳 1 mm 圆角高光。", "evidenceRef": "front-view"}, {"id": "case-side-seam", "kind": "seam", "description": "上下壳之间 0.4 mm 分模线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 35, 38, 1.0)", "secondaryAlbedo": "rgba(74, 77, 80, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_keyboard_50.add(mesh_keyboard_50);
  meshes["keyboard"] = mesh_keyboard_50;
  colliders["keyboard"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.39, 0.035, 0.145], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboard-rgb"] ??= [];
  destructionGroups["keyboard-rgb"].push(node_keyboard_50);
  const socket_keyboard_knob_mount_0 = new THREE.Object3D();
  socket_keyboard_knob_mount_0.name = "knob-mount";
  socket_keyboard_knob_mount_0.position.set(0.166, 0.03, -0.035);
  socket_keyboard_knob_mount_0.rotation.set(0, 0, 0);
  socket_keyboard_knob_mount_0.userData.socket = {"id": "knob-mount", "localPosition": [0.166, 0.03, -0.035]};
  node_keyboard_50.add(socket_keyboard_knob_mount_0);
  sockets["keyboard:knob-mount"] = socket_keyboard_knob_mount_0;

  const endpoint_keyboardPlate_51 = makeAttachmentEndpoint(null);
  const node_keyboardPlate_51 = new THREE.Group();
  node_keyboardPlate_51.name = "\u952e\u76d8\u5b9a\u4f4d\u677f__pivot";
  node_keyboardPlate_51.scale.set(1, 1, 1);
  if (endpoint_keyboardPlate_51) {
    node_keyboardPlate_51.position.copy(endpoint_keyboardPlate_51.start);
    node_keyboardPlate_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboardPlate_51.position.set(0.0, 0.02, -0.001);
    node_keyboardPlate_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboardPlate_51.userData.sculptComponent = {"id": "keyboardPlate", "name": "键盘定位板", "level": "meso", "role": "switch-plate", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "380×136×6 mm 深色定位板，表面露出轴体与 RGB 缝。", "geometryDescriptor": {"topologyIntent": "380×136×6 mm 深色定位板，表面露出轴体与 RGB 缝。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.38, "height": 0.006, "depth": 0.136, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.02, -0.001], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardPlate-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.38, 0.006, 0.136], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardPlate-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 35, 38, 1.0)", "secondaryAlbedo": "rgba(58, 61, 64, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardPlate_51.userData.actionProfile = {"animationRole": "keyboardPlate-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.38, 0.006, 0.136], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardPlate-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keyboardPlate_51);
  nodes["keyboardPlate"] = node_keyboardPlate_51;
  const mesh_keyboardPlate_51Geometry = endpoint_keyboardPlate_51
    ? new THREE.CylinderGeometry(endpoint_keyboardPlate_51.endRadius, endpoint_keyboardPlate_51.baseRadius, endpoint_keyboardPlate_51.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keyboardPlate_51) {
    mesh_keyboardPlate_51Geometry.scale(0.38, 0.006, 0.136);
  }
  const mesh_keyboardPlate_51 = new THREE.Mesh(
    mesh_keyboardPlate_51Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboardPlate_51.name = "\u952e\u76d8\u5b9a\u4f4d\u677f";
  if (endpoint_keyboardPlate_51) {
    mesh_keyboardPlate_51.position.copy(endpoint_keyboardPlate_51.midpoint);
    mesh_keyboardPlate_51.quaternion.copy(endpoint_keyboardPlate_51.quaternion);
  }
  mesh_keyboardPlate_51.castShadow = options.castShadow ?? true;
  mesh_keyboardPlate_51.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboardPlate_51.userData.sculptComponent = {"id": "keyboardPlate", "name": "键盘定位板", "level": "meso", "role": "switch-plate", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "380×136×6 mm 深色定位板，表面露出轴体与 RGB 缝。", "geometryDescriptor": {"topologyIntent": "380×136×6 mm 深色定位板，表面露出轴体与 RGB 缝。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.38, "height": 0.006, "depth": 0.136, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.02, -0.001], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardPlate-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.38, 0.006, 0.136], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardPlate-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 35, 38, 1.0)", "secondaryAlbedo": "rgba(58, 61, 64, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardPlate_51.add(mesh_keyboardPlate_51);
  meshes["keyboardPlate"] = mesh_keyboardPlate_51;
  colliders["keyboardPlate"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.38, 0.006, 0.136], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboardPlate-pivot"] ??= [];
  destructionGroups["keyboardPlate-pivot"].push(node_keyboardPlate_51);

  const endpoint_keycapMatrix_52 = makeAttachmentEndpoint(null);
  const node_keycapMatrix_52 = new THREE.Group();
  node_keycapMatrix_52.name = "98 \u952e\u6e10\u53d8\u952e\u5e3d\u77e9\u9635__pivot";
  node_keycapMatrix_52.scale.set(1, 1, 1);
  if (endpoint_keycapMatrix_52) {
    node_keycapMatrix_52.position.copy(endpoint_keycapMatrix_52.start);
    node_keycapMatrix_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keycapMatrix_52.position.set(0.0, 0.026, -0.001);
    node_keycapMatrix_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_keycapMatrix_52.userData.sculptComponent = {"id": "keycapMatrix", "name": "98 键渐变键帽矩阵", "level": "meso", "role": "keycap-field", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "372×128 mm 的键帽阵列量体；实际 98 个独立键帽由 InstancedMesh 在运行时生成，排列 6 行、含数字区。", "geometryDescriptor": {"topologyIntent": "372×128 mm 的键帽阵列量体；实际 98 个独立键帽由 InstancedMesh 在运行时生成，排列 6 行、含数字区。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.372, "height": 0.009, "depth": 0.128, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.026, -0.001], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keycap-grid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.372, 0.009, 0.128], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keycap-grid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keycapPBT", "materialLayers": ["keycapPBT"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "keycap-bevel", "kind": "bevel", "description": "每个键帽顶面 0.6 mm 倒角与微凹。", "evidenceRef": "front-view"}, {"id": "keycap-gradient", "kind": "decal", "description": "顶排浅灰至底排深灰渐变。", "evidenceRef": "keyboard-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(195, 199, 202, 1.0)", "secondaryAlbedo": "rgba(122, 128, 134, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_keycapMatrix_52.userData.actionProfile = {"animationRole": "keycap-grid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.372, 0.009, 0.128], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keycap-grid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keycapMatrix_52);
  nodes["keycapMatrix"] = node_keycapMatrix_52;
  const mesh_keycapMatrix_52Geometry = endpoint_keycapMatrix_52
    ? new THREE.CylinderGeometry(endpoint_keycapMatrix_52.endRadius, endpoint_keycapMatrix_52.baseRadius, endpoint_keycapMatrix_52.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keycapMatrix_52) {
    mesh_keycapMatrix_52Geometry.scale(0.372, 0.009, 0.128);
  }
  const mesh_keycapMatrix_52 = new THREE.Mesh(
    mesh_keycapMatrix_52Geometry,
    materialMap["keycapPBT"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keycapMatrix_52.name = "98 \u952e\u6e10\u53d8\u952e\u5e3d\u77e9\u9635";
  if (endpoint_keycapMatrix_52) {
    mesh_keycapMatrix_52.position.copy(endpoint_keycapMatrix_52.midpoint);
    mesh_keycapMatrix_52.quaternion.copy(endpoint_keycapMatrix_52.quaternion);
  }
  mesh_keycapMatrix_52.castShadow = options.castShadow ?? true;
  mesh_keycapMatrix_52.receiveShadow = options.receiveShadow ?? true;
  mesh_keycapMatrix_52.userData.sculptComponent = {"id": "keycapMatrix", "name": "98 键渐变键帽矩阵", "level": "meso", "role": "keycap-field", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "372×128 mm 的键帽阵列量体；实际 98 个独立键帽由 InstancedMesh 在运行时生成，排列 6 行、含数字区。", "geometryDescriptor": {"topologyIntent": "372×128 mm 的键帽阵列量体；实际 98 个独立键帽由 InstancedMesh 在运行时生成，排列 6 行、含数字区。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.372, "height": 0.009, "depth": 0.128, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.026, -0.001], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keycap-grid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.372, 0.009, 0.128], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keycap-grid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "keycapPBT", "materialLayers": ["keycapPBT"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "keycap-bevel", "kind": "bevel", "description": "每个键帽顶面 0.6 mm 倒角与微凹。", "evidenceRef": "front-view"}, {"id": "keycap-gradient", "kind": "decal", "description": "顶排浅灰至底排深灰渐变。", "evidenceRef": "keyboard-detail"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(195, 199, 202, 1.0)", "secondaryAlbedo": "rgba(122, 128, 134, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_keycapMatrix_52.add(mesh_keycapMatrix_52);
  meshes["keycapMatrix"] = mesh_keycapMatrix_52;
  colliders["keycapMatrix"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.372, 0.009, 0.128], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keycap-grid"] ??= [];
  destructionGroups["keycap-grid"].push(node_keycapMatrix_52);

  const attachment_keyboardKnob_53 = {"parentId": "keyboard", "parentSocket": "knob-mount", "contactType": "socket", "localStart": [0.166, 0.018, -0.035], "localEnd": [0.166, 0.04, -0.035], "baseRadius": 0.011, "endRadius": 0.011, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_keyboardKnob_53 = makeAttachmentEndpoint(attachment_keyboardKnob_53);
  const node_keyboardKnob_53 = new THREE.Group();
  node_keyboardKnob_53.name = "\u53f3\u4e0a\u65cb\u94ae__pivot";
  node_keyboardKnob_53.scale.set(1, 1, 1);
  if (endpoint_keyboardKnob_53) {
    node_keyboardKnob_53.position.copy(endpoint_keyboardKnob_53.start);
    node_keyboardKnob_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboardKnob_53.position.set(0.0, 0.0, 0.0);
    node_keyboardKnob_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboardKnob_53.userData.sculptComponent = {"id": "keyboardKnob", "name": "右上旋钮", "level": "meso", "role": "control-knob", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 24 mm、高 22 mm 的旋钮，侧壁滚花、顶面同心圆拉丝。", "geometryDescriptor": {"topologyIntent": "直径 24 mm、高 22 mm 的旋钮，侧壁滚花、顶面同心圆拉丝。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": {"parentId": "keyboard", "parentSocket": "knob-mount", "contactType": "socket", "localStart": [0.166, 0.018, -0.035], "localEnd": [0.166, 0.04, -0.035], "baseRadius": 0.011, "endRadius": 0.011, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.024, "height": 0.022, "depth": 0.024, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboard-knob", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.024, 0.022, 0.024], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "knurled-grip", "kind": "ridge", "description": "侧壁 36 道竖向滚花。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardKnob_53.userData.actionProfile = {"animationRole": "keyboard-knob", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.024, 0.022, 0.024], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keyboardKnob_53);
  nodes["keyboardKnob"] = node_keyboardKnob_53;
  const mesh_keyboardKnob_53Geometry = endpoint_keyboardKnob_53
    ? new THREE.CylinderGeometry(endpoint_keyboardKnob_53.endRadius, endpoint_keyboardKnob_53.baseRadius, endpoint_keyboardKnob_53.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_keyboardKnob_53) {
    mesh_keyboardKnob_53Geometry.scale(0.024, 0.022, 0.024);
  }
  const mesh_keyboardKnob_53 = new THREE.Mesh(
    mesh_keyboardKnob_53Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboardKnob_53.name = "\u53f3\u4e0a\u65cb\u94ae";
  if (endpoint_keyboardKnob_53) {
    mesh_keyboardKnob_53.position.copy(endpoint_keyboardKnob_53.midpoint);
    mesh_keyboardKnob_53.quaternion.copy(endpoint_keyboardKnob_53.quaternion);
  }
  mesh_keyboardKnob_53.castShadow = options.castShadow ?? true;
  mesh_keyboardKnob_53.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboardKnob_53.userData.sculptComponent = {"id": "keyboardKnob", "name": "右上旋钮", "level": "meso", "role": "control-knob", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 24 mm、高 22 mm 的旋钮，侧壁滚花、顶面同心圆拉丝。", "geometryDescriptor": {"topologyIntent": "直径 24 mm、高 22 mm 的旋钮，侧壁滚花、顶面同心圆拉丝。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": {"parentId": "keyboard", "parentSocket": "knob-mount", "contactType": "socket", "localStart": [0.166, 0.018, -0.035], "localEnd": [0.166, 0.04, -0.035], "baseRadius": 0.011, "endRadius": 0.011, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.024, "height": 0.022, "depth": 0.024, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboard-knob", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.024, 0.022, 0.024], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard-knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "knurled-grip", "kind": "ridge", "description": "侧壁 36 道竖向滚花。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardKnob_53.add(mesh_keyboardKnob_53);
  meshes["keyboardKnob"] = mesh_keyboardKnob_53;
  colliders["keyboardKnob"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.024, 0.022, 0.024], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboard-knob"] ??= [];
  destructionGroups["keyboard-knob"].push(node_keyboardKnob_53);

  const endpoint_keyboardIndicator_54 = makeAttachmentEndpoint(null);
  const node_keyboardIndicator_54 = new THREE.Group();
  node_keyboardIndicator_54.name = "\u952e\u76d8\u72b6\u6001\u706f\u6761__pivot";
  node_keyboardIndicator_54.scale.set(1, 1, 1);
  if (endpoint_keyboardIndicator_54) {
    node_keyboardIndicator_54.position.copy(endpoint_keyboardIndicator_54.start);
    node_keyboardIndicator_54.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboardIndicator_54.position.set(0.06, 0.0195, -0.062);
    node_keyboardIndicator_54.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboardIndicator_54.userData.sculptComponent = {"id": "keyboardIndicator", "name": "键盘状态灯条", "level": "meso", "role": "status-led", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "35 mm 宽的小型灯条，含三色指示点。", "geometryDescriptor": {"topologyIntent": "35 mm 宽的小型灯条，含三色指示点。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.035, "height": 0.002, "depth": 0.008, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.0195, -0.062], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardIndicator-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.002, 0.008], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardIndicator-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "ledBlue", "materialLayers": ["ledBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 214, 255, 1.0)", "secondaryAlbedo": "rgba(246, 196, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_keyboardIndicator_54.userData.actionProfile = {"animationRole": "keyboardIndicator-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.002, 0.008], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardIndicator-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keyboardIndicator_54);
  nodes["keyboardIndicator"] = node_keyboardIndicator_54;
  const mesh_keyboardIndicator_54Geometry = endpoint_keyboardIndicator_54
    ? new THREE.CylinderGeometry(endpoint_keyboardIndicator_54.endRadius, endpoint_keyboardIndicator_54.baseRadius, endpoint_keyboardIndicator_54.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keyboardIndicator_54) {
    mesh_keyboardIndicator_54Geometry.scale(0.035, 0.002, 0.008);
  }
  const mesh_keyboardIndicator_54 = new THREE.Mesh(
    mesh_keyboardIndicator_54Geometry,
    materialMap["ledBlue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboardIndicator_54.name = "\u952e\u76d8\u72b6\u6001\u706f\u6761";
  if (endpoint_keyboardIndicator_54) {
    mesh_keyboardIndicator_54.position.copy(endpoint_keyboardIndicator_54.midpoint);
    mesh_keyboardIndicator_54.quaternion.copy(endpoint_keyboardIndicator_54.quaternion);
  }
  mesh_keyboardIndicator_54.castShadow = options.castShadow ?? true;
  mesh_keyboardIndicator_54.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboardIndicator_54.userData.sculptComponent = {"id": "keyboardIndicator", "name": "键盘状态灯条", "level": "meso", "role": "status-led", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "35 mm 宽的小型灯条，含三色指示点。", "geometryDescriptor": {"topologyIntent": "35 mm 宽的小型灯条，含三色指示点。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.035, "height": 0.002, "depth": 0.008, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.0195, -0.062], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardIndicator-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.002, 0.008], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardIndicator-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "ledBlue", "materialLayers": ["ledBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 214, 255, 1.0)", "secondaryAlbedo": "rgba(246, 196, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_keyboardIndicator_54.add(mesh_keyboardIndicator_54);
  meshes["keyboardIndicator"] = mesh_keyboardIndicator_54;
  colliders["keyboardIndicator"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.002, 0.008], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboardIndicator-pivot"] ??= [];
  destructionGroups["keyboardIndicator-pivot"].push(node_keyboardIndicator_54);

  const endpoint_keyboardFootL_55 = makeAttachmentEndpoint(null);
  const node_keyboardFootL_55 = new THREE.Group();
  node_keyboardFootL_55.name = "\u952e\u76d8\u811a L__pivot";
  node_keyboardFootL_55.scale.set(1, 1, 1);
  if (endpoint_keyboardFootL_55) {
    node_keyboardFootL_55.position.copy(endpoint_keyboardFootL_55.start);
    node_keyboardFootL_55.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboardFootL_55.position.set(-0.15, -0.023, -0.04);
    node_keyboardFootL_55.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboardFootL_55.userData.sculptComponent = {"id": "keyboardFootL", "name": "键盘脚 L", "level": "meso", "role": "foot", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两段式折叠脚，当前收起，厚 12 mm。", "geometryDescriptor": {"topologyIntent": "两段式折叠脚，当前收起，厚 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.02, "height": 0.012, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.15, -0.023, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardFootL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardFootL_55.userData.actionProfile = {"animationRole": "keyboardFootL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keyboardFootL_55);
  nodes["keyboardFootL"] = node_keyboardFootL_55;
  const mesh_keyboardFootL_55Geometry = endpoint_keyboardFootL_55
    ? new THREE.CylinderGeometry(endpoint_keyboardFootL_55.endRadius, endpoint_keyboardFootL_55.baseRadius, endpoint_keyboardFootL_55.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keyboardFootL_55) {
    mesh_keyboardFootL_55Geometry.scale(0.02, 0.012, 0.03);
  }
  const mesh_keyboardFootL_55 = new THREE.Mesh(
    mesh_keyboardFootL_55Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboardFootL_55.name = "\u952e\u76d8\u811a L";
  if (endpoint_keyboardFootL_55) {
    mesh_keyboardFootL_55.position.copy(endpoint_keyboardFootL_55.midpoint);
    mesh_keyboardFootL_55.quaternion.copy(endpoint_keyboardFootL_55.quaternion);
  }
  mesh_keyboardFootL_55.castShadow = options.castShadow ?? true;
  mesh_keyboardFootL_55.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboardFootL_55.userData.sculptComponent = {"id": "keyboardFootL", "name": "键盘脚 L", "level": "meso", "role": "foot", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两段式折叠脚，当前收起，厚 12 mm。", "geometryDescriptor": {"topologyIntent": "两段式折叠脚，当前收起，厚 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.02, "height": 0.012, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.15, -0.023, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardFootL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardFootL_55.add(mesh_keyboardFootL_55);
  meshes["keyboardFootL"] = mesh_keyboardFootL_55;
  colliders["keyboardFootL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboardFootL-pivot"] ??= [];
  destructionGroups["keyboardFootL-pivot"].push(node_keyboardFootL_55);

  const endpoint_keyboardFootR_56 = makeAttachmentEndpoint(null);
  const node_keyboardFootR_56 = new THREE.Group();
  node_keyboardFootR_56.name = "\u952e\u76d8\u811a R__pivot";
  node_keyboardFootR_56.scale.set(1, 1, 1);
  if (endpoint_keyboardFootR_56) {
    node_keyboardFootR_56.position.copy(endpoint_keyboardFootR_56.start);
    node_keyboardFootR_56.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboardFootR_56.position.set(0.15, -0.023, -0.04);
    node_keyboardFootR_56.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboardFootR_56.userData.sculptComponent = {"id": "keyboardFootR", "name": "键盘脚 R", "level": "meso", "role": "foot", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两段式折叠脚，当前收起，厚 12 mm。", "geometryDescriptor": {"topologyIntent": "两段式折叠脚，当前收起，厚 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.02, "height": 0.012, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.15, -0.023, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardFootR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardFootR_56.userData.actionProfile = {"animationRole": "keyboardFootR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["keyboard"] ?? root).add(node_keyboardFootR_56);
  nodes["keyboardFootR"] = node_keyboardFootR_56;
  const mesh_keyboardFootR_56Geometry = endpoint_keyboardFootR_56
    ? new THREE.CylinderGeometry(endpoint_keyboardFootR_56.endRadius, endpoint_keyboardFootR_56.baseRadius, endpoint_keyboardFootR_56.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_keyboardFootR_56) {
    mesh_keyboardFootR_56Geometry.scale(0.02, 0.012, 0.03);
  }
  const mesh_keyboardFootR_56 = new THREE.Mesh(
    mesh_keyboardFootR_56Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboardFootR_56.name = "\u952e\u76d8\u811a R";
  if (endpoint_keyboardFootR_56) {
    mesh_keyboardFootR_56.position.copy(endpoint_keyboardFootR_56.midpoint);
    mesh_keyboardFootR_56.quaternion.copy(endpoint_keyboardFootR_56.quaternion);
  }
  mesh_keyboardFootR_56.castShadow = options.castShadow ?? true;
  mesh_keyboardFootR_56.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboardFootR_56.userData.sculptComponent = {"id": "keyboardFootR", "name": "键盘脚 R", "level": "meso", "role": "foot", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两段式折叠脚，当前收起，厚 12 mm。", "geometryDescriptor": {"topologyIntent": "两段式折叠脚，当前收起，厚 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "keyboard", "attachment": null, "dimensions": {"width": 0.02, "height": 0.012, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.15, -0.023, -0.04], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "keyboardFootR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboardFootR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 44, 46, 1.0)", "secondaryAlbedo": "rgba(90, 93, 96, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_keyboardFootR_56.add(mesh_keyboardFootR_56);
  meshes["keyboardFootR"] = mesh_keyboardFootR_56;
  colliders["keyboardFootR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.012, 0.03], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["keyboardFootR-pivot"] ??= [];
  destructionGroups["keyboardFootR-pivot"].push(node_keyboardFootR_56);

  const endpoint_mousepad_57 = makeAttachmentEndpoint(null);
  const node_mousepad_57 = new THREE.Group();
  node_mousepad_57.name = "\u7070\u8272\u51e0\u4f55\u5370\u5237\u9f20\u6807\u57ab__pivot";
  node_mousepad_57.scale.set(1, 1, 1);
  if (endpoint_mousepad_57) {
    node_mousepad_57.position.copy(endpoint_mousepad_57.start);
    node_mousepad_57.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mousepad_57.position.set(0.31, 0.759, 0.07);
    node_mousepad_57.rotation.set(0.0, 0.0, 0.0);
  }
  node_mousepad_57.userData.sculptComponent = {"id": "mousepad", "name": "灰色几何印刷鼠标垫", "level": "macro", "role": "mousepad", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "340×250×4 mm 圆角矩形布垫，周边密缝，顶面印深灰几何斜带。", "geometryDescriptor": {"topologyIntent": "340×250×4 mm 圆角矩形布垫，周边密缝，顶面印深灰几何斜带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.003, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.004, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.31, 0.759, 0.07], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mousepad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.004, 0.25], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mousepad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousepadFabric", "materialLayers": ["mousepadFabric"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stitched-edge", "kind": "stitch", "description": "四周 4 mm 密缝边。", "evidenceRef": "front-view"}, {"id": "pad-corner-radius", "kind": "bevel", "description": "四角 12 mm 圆角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(166, 170, 169, 1.0)", "secondaryAlbedo": "rgba(75, 79, 82, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_mousepad_57.userData.actionProfile = {"animationRole": "mousepad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.004, 0.25], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mousepad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_mousepad_57);
  nodes["mousepad"] = node_mousepad_57;
  const mesh_mousepad_57Geometry = endpoint_mousepad_57
    ? new THREE.CylinderGeometry(endpoint_mousepad_57.endRadius, endpoint_mousepad_57.baseRadius, endpoint_mousepad_57.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mousepad_57) {
    mesh_mousepad_57Geometry.scale(0.34, 0.004, 0.25);
  }
  const mesh_mousepad_57 = new THREE.Mesh(
    mesh_mousepad_57Geometry,
    materialMap["mousepadFabric"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mousepad_57.name = "\u7070\u8272\u51e0\u4f55\u5370\u5237\u9f20\u6807\u57ab";
  if (endpoint_mousepad_57) {
    mesh_mousepad_57.position.copy(endpoint_mousepad_57.midpoint);
    mesh_mousepad_57.quaternion.copy(endpoint_mousepad_57.quaternion);
  }
  mesh_mousepad_57.castShadow = options.castShadow ?? true;
  mesh_mousepad_57.receiveShadow = options.receiveShadow ?? true;
  mesh_mousepad_57.userData.sculptComponent = {"id": "mousepad", "name": "灰色几何印刷鼠标垫", "level": "macro", "role": "mousepad", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "340×250×4 mm 圆角矩形布垫，周边密缝，顶面印深灰几何斜带。", "geometryDescriptor": {"topologyIntent": "340×250×4 mm 圆角矩形布垫，周边密缝，顶面印深灰几何斜带。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.003, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.004, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.31, 0.759, 0.07], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mousepad-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.004, 0.25], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mousepad-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousepadFabric", "materialLayers": ["mousepadFabric"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stitched-edge", "kind": "stitch", "description": "四周 4 mm 密缝边。", "evidenceRef": "front-view"}, {"id": "pad-corner-radius", "kind": "bevel", "description": "四角 12 mm 圆角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(166, 170, 169, 1.0)", "secondaryAlbedo": "rgba(75, 79, 82, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_mousepad_57.add(mesh_mousepad_57);
  meshes["mousepad"] = mesh_mousepad_57;
  colliders["mousepad"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.004, 0.25], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mousepad-pivot"] ??= [];
  destructionGroups["mousepad-pivot"].push(node_mousepad_57);

  const endpoint_mouseShell_58 = makeAttachmentEndpoint(null);
  const node_mouseShell_58 = new THREE.Group();
  node_mouseShell_58.name = "\u65e0\u7ebf\u9f20\u6807\u58f3\u4f53__pivot";
  node_mouseShell_58.scale.set(1, 1, 1);
  if (endpoint_mouseShell_58) {
    node_mouseShell_58.position.copy(endpoint_mouseShell_58.start);
    node_mouseShell_58.rotation.set(0.0, -0.28, 0.0);
  } else {
    node_mouseShell_58.position.set(0.06, 0.024, 0.03);
    node_mouseShell_58.rotation.set(0.0, -0.28, 0.0);
  }
  node_mouseShell_58.userData.sculptComponent = {"id": "mouseShell", "name": "无线鼠标壳体", "level": "meso", "role": "mouse-body", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "鼠标为单一连续曲面壳体，背部隆起的椭球与两侧收腰；不是方盒拼接。", "geometryDescriptor": {"topologyIntent": "鼠标为单一连续曲面壳体，背部隆起的椭球与两侧收腰；不是方盒拼接。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.067, "height": 0.042, "depth": 0.115, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.024, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouse-body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.067, 0.042, 0.115], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "side-grip-ridges", "kind": "ridge", "description": "左侧两道 0.6 mm 防滑浅槽。", "evidenceRef": "front-view"}, {"id": "logo-gloss", "kind": "gloss", "description": "背壳浅色 LOGO。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseShell_58.userData.actionProfile = {"animationRole": "mouse-body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.067, 0.042, 0.115], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mousepad"] ?? root).add(node_mouseShell_58);
  nodes["mouseShell"] = node_mouseShell_58;
  const mesh_mouseShell_58Geometry = endpoint_mouseShell_58
    ? new THREE.CylinderGeometry(endpoint_mouseShell_58.endRadius, endpoint_mouseShell_58.baseRadius, endpoint_mouseShell_58.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_mouseShell_58) {
    mesh_mouseShell_58Geometry.scale(0.067, 0.042, 0.115);
  }
  const mesh_mouseShell_58 = new THREE.Mesh(
    mesh_mouseShell_58Geometry,
    materialMap["mousePlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouseShell_58.name = "\u65e0\u7ebf\u9f20\u6807\u58f3\u4f53";
  if (endpoint_mouseShell_58) {
    mesh_mouseShell_58.position.copy(endpoint_mouseShell_58.midpoint);
    mesh_mouseShell_58.quaternion.copy(endpoint_mouseShell_58.quaternion);
  }
  mesh_mouseShell_58.castShadow = options.castShadow ?? true;
  mesh_mouseShell_58.receiveShadow = options.receiveShadow ?? true;
  mesh_mouseShell_58.userData.sculptComponent = {"id": "mouseShell", "name": "无线鼠标壳体", "level": "meso", "role": "mouse-body", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "鼠标为单一连续曲面壳体，背部隆起的椭球与两侧收腰；不是方盒拼接。", "geometryDescriptor": {"topologyIntent": "鼠标为单一连续曲面壳体，背部隆起的椭球与两侧收腰；不是方盒拼接。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.067, "height": 0.042, "depth": 0.115, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.024, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouse-body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.067, 0.042, 0.115], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "side-grip-ridges", "kind": "ridge", "description": "左侧两道 0.6 mm 防滑浅槽。", "evidenceRef": "front-view"}, {"id": "logo-gloss", "kind": "gloss", "description": "背壳浅色 LOGO。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseShell_58.add(mesh_mouseShell_58);
  meshes["mouseShell"] = mesh_mouseShell_58;
  colliders["mouseShell"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.067, 0.042, 0.115], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mouse-body"] ??= [];
  destructionGroups["mouse-body"].push(node_mouseShell_58);

  const endpoint_mouseBase_59 = makeAttachmentEndpoint(null);
  const node_mouseBase_59 = new THREE.Group();
  node_mouseBase_59.name = "\u9f20\u6807\u5e95\u76d8__pivot";
  node_mouseBase_59.scale.set(1, 1, 1);
  if (endpoint_mouseBase_59) {
    node_mouseBase_59.position.copy(endpoint_mouseBase_59.start);
    node_mouseBase_59.rotation.set(0.0, -0.28, 0.0);
  } else {
    node_mouseBase_59.position.set(0.06, 0.006, 0.03);
    node_mouseBase_59.rotation.set(0.0, -0.28, 0.0);
  }
  node_mouseBase_59.userData.sculptComponent = {"id": "mouseBase", "name": "鼠标底盘", "level": "meso", "role": "mouse-base", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "鼠标底部薄壳，四角有 PTFE 脚贴。", "geometryDescriptor": {"topologyIntent": "鼠标底部薄壳，四角有 PTFE 脚贴。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.055, "height": 0.008, "depth": 0.1, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.006, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.008, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseBase_59.userData.actionProfile = {"animationRole": "mouseBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.008, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mousepad"] ?? root).add(node_mouseBase_59);
  nodes["mouseBase"] = node_mouseBase_59;
  const mesh_mouseBase_59Geometry = endpoint_mouseBase_59
    ? new THREE.CylinderGeometry(endpoint_mouseBase_59.endRadius, endpoint_mouseBase_59.baseRadius, endpoint_mouseBase_59.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouseBase_59) {
    mesh_mouseBase_59Geometry.scale(0.055, 0.008, 0.1);
  }
  const mesh_mouseBase_59 = new THREE.Mesh(
    mesh_mouseBase_59Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouseBase_59.name = "\u9f20\u6807\u5e95\u76d8";
  if (endpoint_mouseBase_59) {
    mesh_mouseBase_59.position.copy(endpoint_mouseBase_59.midpoint);
    mesh_mouseBase_59.quaternion.copy(endpoint_mouseBase_59.quaternion);
  }
  mesh_mouseBase_59.castShadow = options.castShadow ?? true;
  mesh_mouseBase_59.receiveShadow = options.receiveShadow ?? true;
  mesh_mouseBase_59.userData.sculptComponent = {"id": "mouseBase", "name": "鼠标底盘", "level": "meso", "role": "mouse-base", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "鼠标底部薄壳，四角有 PTFE 脚贴。", "geometryDescriptor": {"topologyIntent": "鼠标底部薄壳，四角有 PTFE 脚贴。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.055, "height": 0.008, "depth": 0.1, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.06, 0.006, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseBase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.008, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseBase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseBase_59.add(mesh_mouseBase_59);
  meshes["mouseBase"] = mesh_mouseBase_59;
  colliders["mouseBase"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.008, 0.1], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mouseBase-pivot"] ??= [];
  destructionGroups["mouseBase-pivot"].push(node_mouseBase_59);

  const attachment_mouseWheel_60 = {"parentId": "mousepad", "parentSocket": "wheel-mount", "contactType": "socket", "localStart": [0.06, 0.04, -0.012], "localEnd": [0.06, 0.04, 0.004], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_mouseWheel_60 = makeAttachmentEndpoint(attachment_mouseWheel_60);
  const node_mouseWheel_60 = new THREE.Group();
  node_mouseWheel_60.name = "\u9f20\u6807\u6eda\u8f6e__pivot";
  node_mouseWheel_60.scale.set(1, 1, 1);
  if (endpoint_mouseWheel_60) {
    node_mouseWheel_60.position.copy(endpoint_mouseWheel_60.start);
    node_mouseWheel_60.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouseWheel_60.position.set(0.0, 0.0, 0.0);
    node_mouseWheel_60.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouseWheel_60.userData.sculptComponent = {"id": "mouseWheel", "name": "鼠标滚轮", "level": "meso", "role": "scroll-wheel", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 14 mm 的橡胶滚轮，外缘有细齿，轴向沿 Z。", "geometryDescriptor": {"topologyIntent": "直径 14 mm 的橡胶滚轮，外缘有细齿，轴向沿 Z。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": {"parentId": "mousepad", "parentSocket": "wheel-mount", "contactType": "socket", "localStart": [0.06, 0.04, -0.012], "localEnd": [0.06, 0.04, 0.004], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.014, "height": 0.014, "depth": 0.014, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mouse-wheel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.014, 0.014, 0.014], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ribbing", "kind": "groove", "description": "滚轮外缘 24 道细齿。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_mouseWheel_60.userData.actionProfile = {"animationRole": "mouse-wheel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.014, 0.014, 0.014], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mousepad"] ?? root).add(node_mouseWheel_60);
  nodes["mouseWheel"] = node_mouseWheel_60;
  const mesh_mouseWheel_60Geometry = endpoint_mouseWheel_60
    ? new THREE.CylinderGeometry(endpoint_mouseWheel_60.endRadius, endpoint_mouseWheel_60.baseRadius, endpoint_mouseWheel_60.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_mouseWheel_60) {
    mesh_mouseWheel_60Geometry.scale(0.014, 0.014, 0.014);
  }
  const mesh_mouseWheel_60 = new THREE.Mesh(
    mesh_mouseWheel_60Geometry,
    materialMap["metalDark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouseWheel_60.name = "\u9f20\u6807\u6eda\u8f6e";
  if (endpoint_mouseWheel_60) {
    mesh_mouseWheel_60.position.copy(endpoint_mouseWheel_60.midpoint);
    mesh_mouseWheel_60.quaternion.copy(endpoint_mouseWheel_60.quaternion);
  }
  mesh_mouseWheel_60.castShadow = options.castShadow ?? true;
  mesh_mouseWheel_60.receiveShadow = options.receiveShadow ?? true;
  mesh_mouseWheel_60.userData.sculptComponent = {"id": "mouseWheel", "name": "鼠标滚轮", "level": "meso", "role": "scroll-wheel", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 14 mm 的橡胶滚轮，外缘有细齿，轴向沿 Z。", "geometryDescriptor": {"topologyIntent": "直径 14 mm 的橡胶滚轮，外缘有细齿，轴向沿 Z。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": {"parentId": "mousepad", "parentSocket": "wheel-mount", "contactType": "socket", "localStart": [0.06, 0.04, -0.012], "localEnd": [0.06, 0.04, 0.004], "baseRadius": 0.007, "endRadius": 0.007, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.014, "height": 0.014, "depth": 0.014, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mouse-wheel", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.014, 0.014, 0.014], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouse-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "metalDark", "materialLayers": ["metalDark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ribbing", "kind": "groove", "description": "滚轮外缘 24 道细齿。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_mouseWheel_60.add(mesh_mouseWheel_60);
  meshes["mouseWheel"] = mesh_mouseWheel_60;
  colliders["mouseWheel"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.014, 0.014, 0.014], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mouse-wheel"] ??= [];
  destructionGroups["mouse-wheel"].push(node_mouseWheel_60);

  const endpoint_mouseGripL_61 = makeAttachmentEndpoint(null);
  const node_mouseGripL_61 = new THREE.Group();
  node_mouseGripL_61.name = "\u9f20\u6807\u5de6\u9632\u6ed1\u4fa7\u88d9__pivot";
  node_mouseGripL_61.scale.set(1, 1, 1);
  if (endpoint_mouseGripL_61) {
    node_mouseGripL_61.position.copy(endpoint_mouseGripL_61.start);
    node_mouseGripL_61.rotation.set(0.0, -0.28, 0.0);
  } else {
    node_mouseGripL_61.position.set(0.026, 0.021, 0.03);
    node_mouseGripL_61.rotation.set(0.0, -0.28, 0.0);
  }
  node_mouseGripL_61.userData.sculptComponent = {"id": "mouseGripL", "name": "鼠标左防滑侧裙", "level": "meso", "role": "side-grip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧裙为薄弧形贴片，带两条水平浅槽。", "geometryDescriptor": {"topologyIntent": "左侧裙为薄弧形贴片，带两条水平浅槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.009, "height": 0.022, "depth": 0.055, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.026, 0.021, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseGripL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseGripL_61.userData.actionProfile = {"animationRole": "mouseGripL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mousepad"] ?? root).add(node_mouseGripL_61);
  nodes["mouseGripL"] = node_mouseGripL_61;
  const mesh_mouseGripL_61Geometry = endpoint_mouseGripL_61
    ? new THREE.CylinderGeometry(endpoint_mouseGripL_61.endRadius, endpoint_mouseGripL_61.baseRadius, endpoint_mouseGripL_61.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouseGripL_61) {
    mesh_mouseGripL_61Geometry.scale(0.009, 0.022, 0.055);
  }
  const mesh_mouseGripL_61 = new THREE.Mesh(
    mesh_mouseGripL_61Geometry,
    materialMap["mousePlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouseGripL_61.name = "\u9f20\u6807\u5de6\u9632\u6ed1\u4fa7\u88d9";
  if (endpoint_mouseGripL_61) {
    mesh_mouseGripL_61.position.copy(endpoint_mouseGripL_61.midpoint);
    mesh_mouseGripL_61.quaternion.copy(endpoint_mouseGripL_61.quaternion);
  }
  mesh_mouseGripL_61.castShadow = options.castShadow ?? true;
  mesh_mouseGripL_61.receiveShadow = options.receiveShadow ?? true;
  mesh_mouseGripL_61.userData.sculptComponent = {"id": "mouseGripL", "name": "鼠标左防滑侧裙", "level": "meso", "role": "side-grip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "左侧裙为薄弧形贴片，带两条水平浅槽。", "geometryDescriptor": {"topologyIntent": "左侧裙为薄弧形贴片，带两条水平浅槽。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.009, "height": 0.022, "depth": 0.055, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.026, 0.021, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseGripL-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripL-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseGripL_61.add(mesh_mouseGripL_61);
  meshes["mouseGripL"] = mesh_mouseGripL_61;
  colliders["mouseGripL"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mouseGripL-pivot"] ??= [];
  destructionGroups["mouseGripL-pivot"].push(node_mouseGripL_61);

  const endpoint_mouseGripR_62 = makeAttachmentEndpoint(null);
  const node_mouseGripR_62 = new THREE.Group();
  node_mouseGripR_62.name = "\u9f20\u6807\u53f3\u9632\u6ed1\u4fa7\u88d9__pivot";
  node_mouseGripR_62.scale.set(1, 1, 1);
  if (endpoint_mouseGripR_62) {
    node_mouseGripR_62.position.copy(endpoint_mouseGripR_62.start);
    node_mouseGripR_62.rotation.set(0.0, -0.28, 0.0);
  } else {
    node_mouseGripR_62.position.set(0.094, 0.021, 0.03);
    node_mouseGripR_62.rotation.set(0.0, -0.28, 0.0);
  }
  node_mouseGripR_62.userData.sculptComponent = {"id": "mouseGripR", "name": "鼠标右防滑侧裙", "level": "meso", "role": "side-grip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧裙为薄弧形贴片，与左侧互为镜像。", "geometryDescriptor": {"topologyIntent": "右侧裙为薄弧形贴片，与左侧互为镜像。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.009, "height": 0.022, "depth": 0.055, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.094, 0.021, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseGripR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseGripR_62.userData.actionProfile = {"animationRole": "mouseGripR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mousepad"] ?? root).add(node_mouseGripR_62);
  nodes["mouseGripR"] = node_mouseGripR_62;
  const mesh_mouseGripR_62Geometry = endpoint_mouseGripR_62
    ? new THREE.CylinderGeometry(endpoint_mouseGripR_62.endRadius, endpoint_mouseGripR_62.baseRadius, endpoint_mouseGripR_62.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouseGripR_62) {
    mesh_mouseGripR_62Geometry.scale(0.009, 0.022, 0.055);
  }
  const mesh_mouseGripR_62 = new THREE.Mesh(
    mesh_mouseGripR_62Geometry,
    materialMap["mousePlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouseGripR_62.name = "\u9f20\u6807\u53f3\u9632\u6ed1\u4fa7\u88d9";
  if (endpoint_mouseGripR_62) {
    mesh_mouseGripR_62.position.copy(endpoint_mouseGripR_62.midpoint);
    mesh_mouseGripR_62.quaternion.copy(endpoint_mouseGripR_62.quaternion);
  }
  mesh_mouseGripR_62.castShadow = options.castShadow ?? true;
  mesh_mouseGripR_62.receiveShadow = options.receiveShadow ?? true;
  mesh_mouseGripR_62.userData.sculptComponent = {"id": "mouseGripR", "name": "鼠标右防滑侧裙", "level": "meso", "role": "side-grip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "右侧裙为薄弧形贴片，与左侧互为镜像。", "geometryDescriptor": {"topologyIntent": "右侧裙为薄弧形贴片，与左侧互为镜像。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mousepad", "attachment": null, "dimensions": {"width": 0.009, "height": 0.022, "depth": 0.055, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.094, 0.021, 0.03], "rotation": [0, -0.28, 0]}, "actionProfile": {"animationRole": "mouseGripR-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouseGripR-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mousePlastic", "materialLayers": ["mousePlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["keyboard-detail"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 22, 23, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_mouseGripR_62.add(mesh_mouseGripR_62);
  meshes["mouseGripR"] = mesh_mouseGripR_62;
  colliders["mouseGripR"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.009, 0.022, 0.055], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mouseGripR-pivot"] ??= [];
  destructionGroups["mouseGripR-pivot"].push(node_mouseGripR_62);

  const endpoint_mug_63 = makeAttachmentEndpoint(null);
  const node_mug_63 = new THREE.Group();
  node_mug_63.name = "\u73bb\u7483\u8336\u676f__pivot";
  node_mug_63.scale.set(1, 1, 1);
  if (endpoint_mug_63) {
    node_mug_63.position.copy(endpoint_mug_63.start);
    node_mug_63.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mug_63.position.set(0.07, 0.825, -0.02);
    node_mug_63.rotation.set(0.0, 0.0, 0.0);
  }
  node_mug_63.userData.sculptComponent = {"id": "mug", "name": "玻璃茶杯", "level": "macro", "role": "drinkware", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "杯壁为绕 Y 轴旋转的薄壁玻璃杯体，口沿略外扩、底部有 8 mm 厚底；旋转成形，不是盒体。", "geometryDescriptor": {"topologyIntent": "杯壁为绕 Y 轴旋转的薄壁玻璃杯体，口沿略外扩、底部有 8 mm 厚底；旋转成形，不是盒体。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.42, 0.5], [0.42, -0.4], [0.1, -0.4], [0.1, -0.5], [0.5, -0.5]], "segments": 40}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.092, "height": 0.13, "depth": 0.092, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.07, 0.825, -0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mug-steam", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.092, 0.13, 0.092], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-steam", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "teaGlass", "materialLayers": ["teaGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-gloss", "kind": "gloss", "description": "杯口窄高光。", "evidenceRef": "front-view"}, {"id": "glass-base-thickness", "kind": "ridge", "description": "杯底 8 mm 厚玻璃台阶。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(221, 227, 225, 1.0)", "secondaryAlbedo": "rgba(197, 210, 206, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9}};
  node_mug_63.userData.actionProfile = {"animationRole": "mug-steam", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.092, 0.13, 0.092], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-steam", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_mug_63);
  nodes["mug"] = node_mug_63;
  const mesh_mug_63Geometry = endpoint_mug_63
    ? new THREE.CylinderGeometry(endpoint_mug_63.endRadius, endpoint_mug_63.baseRadius, endpoint_mug_63.length, 32, 12)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.42, 0.5], [0.42, -0.4], [0.1, -0.4], [0.1, -0.5], [0.5, -0.5]], "segments": 40});
  if (!endpoint_mug_63) {
    mesh_mug_63Geometry.scale(0.092, 0.13, 0.092);
  }
  const mesh_mug_63 = new THREE.Mesh(
    mesh_mug_63Geometry,
    materialMap["teaGlass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mug_63.name = "\u73bb\u7483\u8336\u676f";
  if (endpoint_mug_63) {
    mesh_mug_63.position.copy(endpoint_mug_63.midpoint);
    mesh_mug_63.quaternion.copy(endpoint_mug_63.quaternion);
  }
  mesh_mug_63.castShadow = options.castShadow ?? true;
  mesh_mug_63.receiveShadow = options.receiveShadow ?? true;
  mesh_mug_63.userData.sculptComponent = {"id": "mug", "name": "玻璃茶杯", "level": "macro", "role": "drinkware", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "杯壁为绕 Y 轴旋转的薄壁玻璃杯体，口沿略外扩、底部有 8 mm 厚底；旋转成形，不是盒体。", "geometryDescriptor": {"topologyIntent": "杯壁为绕 Y 轴旋转的薄壁玻璃杯体，口沿略外扩、底部有 8 mm 厚底；旋转成形，不是盒体。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.42, 0.5], [0.42, -0.4], [0.1, -0.4], [0.1, -0.5], [0.5, -0.5]], "segments": 40}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.092, "height": 0.13, "depth": 0.092, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.07, 0.825, -0.02], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mug-steam", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.092, 0.13, 0.092], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-steam", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "teaGlass", "materialLayers": ["teaGlass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-gloss", "kind": "gloss", "description": "杯口窄高光。", "evidenceRef": "front-view"}, {"id": "glass-base-thickness", "kind": "ridge", "description": "杯底 8 mm 厚玻璃台阶。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["front-view", "desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(221, 227, 225, 1.0)", "secondaryAlbedo": "rgba(197, 210, 206, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9}};
  node_mug_63.add(mesh_mug_63);
  meshes["mug"] = mesh_mug_63;
  colliders["mug"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.092, 0.13, 0.092], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mug-steam"] ??= [];
  destructionGroups["mug-steam"].push(node_mug_63);

  const attachment_teaLiquid_64 = {"parentId": "mug", "parentSocket": "cup-inner", "contactType": "embed", "localStart": [0, -0.055, 0], "localEnd": [0, 0.04, 0], "baseRadius": 0.036, "endRadius": 0.036, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_teaLiquid_64 = makeAttachmentEndpoint(attachment_teaLiquid_64);
  const node_teaLiquid_64 = new THREE.Group();
  node_teaLiquid_64.name = "\u6df1\u7ea2\u8336\u6c64__pivot";
  node_teaLiquid_64.scale.set(1, 1, 1);
  if (endpoint_teaLiquid_64) {
    node_teaLiquid_64.position.copy(endpoint_teaLiquid_64.start);
    node_teaLiquid_64.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_teaLiquid_64.position.set(0.0, 0.0, 0.0);
    node_teaLiquid_64.rotation.set(0.0, 0.0, 0.0);
  }
  node_teaLiquid_64.userData.sculptComponent = {"id": "teaLiquid", "name": "深红茶汤", "level": "meso", "role": "liquid-volume", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "杯内茶汤为直径 72 mm、高 95 mm 的液柱，液面低于杯口 12 mm。", "geometryDescriptor": {"topologyIntent": "杯内茶汤为直径 72 mm、高 95 mm 的液柱，液面低于杯口 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": {"parentId": "mug", "parentSocket": "cup-inner", "contactType": "embed", "localStart": [0, -0.055, 0], "localEnd": [0, 0.04, 0], "baseRadius": 0.036, "endRadius": 0.036, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.072, "height": 0.095, "depth": 0.072, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "tea-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tea-surface", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "teaLiquid", "materialLayers": ["teaLiquid"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "meniscus", "kind": "gloss", "description": "液面边缘细亮弧。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 16, 7, 1.0)", "secondaryAlbedo": "rgba(90, 42, 18, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_teaLiquid_64.userData.actionProfile = {"animationRole": "tea-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tea-surface", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mug"] ?? root).add(node_teaLiquid_64);
  nodes["teaLiquid"] = node_teaLiquid_64;
  const mesh_teaLiquid_64Geometry = endpoint_teaLiquid_64
    ? new THREE.CylinderGeometry(endpoint_teaLiquid_64.endRadius, endpoint_teaLiquid_64.baseRadius, endpoint_teaLiquid_64.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_teaLiquid_64) {
    mesh_teaLiquid_64Geometry.scale(0.072, 0.095, 0.072);
  }
  const mesh_teaLiquid_64 = new THREE.Mesh(
    mesh_teaLiquid_64Geometry,
    materialMap["teaLiquid"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_teaLiquid_64.name = "\u6df1\u7ea2\u8336\u6c64";
  if (endpoint_teaLiquid_64) {
    mesh_teaLiquid_64.position.copy(endpoint_teaLiquid_64.midpoint);
    mesh_teaLiquid_64.quaternion.copy(endpoint_teaLiquid_64.quaternion);
  }
  mesh_teaLiquid_64.castShadow = options.castShadow ?? true;
  mesh_teaLiquid_64.receiveShadow = options.receiveShadow ?? true;
  mesh_teaLiquid_64.userData.sculptComponent = {"id": "teaLiquid", "name": "深红茶汤", "level": "meso", "role": "liquid-volume", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "杯内茶汤为直径 72 mm、高 95 mm 的液柱，液面低于杯口 12 mm。", "geometryDescriptor": {"topologyIntent": "杯内茶汤为直径 72 mm、高 95 mm 的液柱，液面低于杯口 12 mm。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": {"parentId": "mug", "parentSocket": "cup-inner", "contactType": "embed", "localStart": [0, -0.055, 0], "localEnd": [0, 0.04, 0], "baseRadius": 0.036, "endRadius": 0.036, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.072, "height": 0.095, "depth": 0.072, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "tea-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tea-surface", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "teaLiquid", "materialLayers": ["teaLiquid"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "meniscus", "kind": "gloss", "description": "液面边缘细亮弧。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 16, 7, 1.0)", "secondaryAlbedo": "rgba(90, 42, 18, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_teaLiquid_64.add(mesh_teaLiquid_64);
  meshes["teaLiquid"] = mesh_teaLiquid_64;
  colliders["teaLiquid"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["tea-surface"] ??= [];
  destructionGroups["tea-surface"].push(node_teaLiquid_64);

  const attachment_mugLid_65 = {"parentId": "mug", "parentSocket": "cup-rim", "contactType": "butt", "localStart": [0, 0.065, 0], "localEnd": [0, 0.078, 0], "baseRadius": 0.047, "endRadius": 0.047, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_mugLid_65 = makeAttachmentEndpoint(attachment_mugLid_65);
  const node_mugLid_65 = new THREE.Group();
  node_mugLid_65.name = "\u6728\u76d6__pivot";
  node_mugLid_65.scale.set(1, 1, 1);
  if (endpoint_mugLid_65) {
    node_mugLid_65.position.copy(endpoint_mugLid_65.start);
    node_mugLid_65.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mugLid_65.position.set(0.0, 0.0, 0.0);
    node_mugLid_65.rotation.set(0.0, 0.0, 0.0);
  }
  node_mugLid_65.userData.sculptComponent = {"id": "mugLid", "name": "木盖", "level": "meso", "role": "lid", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 94 mm、厚 13 mm 的圆木盖，边缘倒圆，顶面有同心木纹。", "geometryDescriptor": {"topologyIntent": "直径 94 mm、厚 13 mm 的圆木盖，边缘倒圆，顶面有同心木纹。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": {"parentId": "mug", "parentSocket": "cup-rim", "contactType": "butt", "localStart": [0, 0.065, 0], "localEnd": [0, 0.078, 0], "baseRadius": 0.047, "endRadius": 0.047, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.094, "height": 0.013, "depth": 0.094, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mug-lid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.094, 0.013, 0.094], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lid-wood-grain", "kind": "linework", "description": "盖面细年轮纹。", "evidenceRef": "front-view"}, {"id": "lid-knob-groove", "kind": "groove", "description": "提钮根部一圈 1 mm 凹槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugLid_65.userData.actionProfile = {"animationRole": "mug-lid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.094, 0.013, 0.094], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mug"] ?? root).add(node_mugLid_65);
  nodes["mugLid"] = node_mugLid_65;
  const mesh_mugLid_65Geometry = endpoint_mugLid_65
    ? new THREE.CylinderGeometry(endpoint_mugLid_65.endRadius, endpoint_mugLid_65.baseRadius, endpoint_mugLid_65.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_mugLid_65) {
    mesh_mugLid_65Geometry.scale(0.094, 0.013, 0.094);
  }
  const mesh_mugLid_65 = new THREE.Mesh(
    mesh_mugLid_65Geometry,
    materialMap["mugLidWood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mugLid_65.name = "\u6728\u76d6";
  if (endpoint_mugLid_65) {
    mesh_mugLid_65.position.copy(endpoint_mugLid_65.midpoint);
    mesh_mugLid_65.quaternion.copy(endpoint_mugLid_65.quaternion);
  }
  mesh_mugLid_65.castShadow = options.castShadow ?? true;
  mesh_mugLid_65.receiveShadow = options.receiveShadow ?? true;
  mesh_mugLid_65.userData.sculptComponent = {"id": "mugLid", "name": "木盖", "level": "meso", "role": "lid", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 94 mm、厚 13 mm 的圆木盖，边缘倒圆，顶面有同心木纹。", "geometryDescriptor": {"topologyIntent": "直径 94 mm、厚 13 mm 的圆木盖，边缘倒圆，顶面有同心木纹。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": {"parentId": "mug", "parentSocket": "cup-rim", "contactType": "butt", "localStart": [0, 0.065, 0], "localEnd": [0, 0.078, 0], "baseRadius": 0.047, "endRadius": 0.047, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.094, "height": 0.013, "depth": 0.094, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mug-lid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.094, 0.013, 0.094], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mug-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lid-wood-grain", "kind": "linework", "description": "盖面细年轮纹。", "evidenceRef": "front-view"}, {"id": "lid-knob-groove", "kind": "groove", "description": "提钮根部一圈 1 mm 凹槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugLid_65.add(mesh_mugLid_65);
  meshes["mugLid"] = mesh_mugLid_65;
  colliders["mugLid"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.094, 0.013, 0.094], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mug-lid"] ??= [];
  destructionGroups["mug-lid"].push(node_mugLid_65);

  const endpoint_mugLidKnob_66 = makeAttachmentEndpoint(null);
  const node_mugLidKnob_66 = new THREE.Group();
  node_mugLidKnob_66.name = "\u6728\u76d6\u63d0\u94ae__pivot";
  node_mugLidKnob_66.scale.set(1, 1, 1);
  if (endpoint_mugLidKnob_66) {
    node_mugLidKnob_66.position.copy(endpoint_mugLidKnob_66.start);
    node_mugLidKnob_66.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mugLidKnob_66.position.set(0.0, 0.085, 0.0);
    node_mugLidKnob_66.rotation.set(0.0, 0.0, 0.0);
  }
  node_mugLidKnob_66.userData.sculptComponent = {"id": "mugLidKnob", "name": "木盖提钮", "level": "meso", "role": "lid-knob", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "直径 22 mm、高 14 mm 的扁圆提钮，边缘全倒圆。", "geometryDescriptor": {"topologyIntent": "直径 22 mm、高 14 mm 的扁圆提钮，边缘全倒圆。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.022, "height": 0.014, "depth": 0.022, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.085, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugLidKnob-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.014, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugLidKnob-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugLidKnob_66.userData.actionProfile = {"animationRole": "mugLidKnob-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.014, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugLidKnob-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mug"] ?? root).add(node_mugLidKnob_66);
  nodes["mugLidKnob"] = node_mugLidKnob_66;
  const mesh_mugLidKnob_66Geometry = endpoint_mugLidKnob_66
    ? new THREE.CylinderGeometry(endpoint_mugLidKnob_66.endRadius, endpoint_mugLidKnob_66.baseRadius, endpoint_mugLidKnob_66.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_mugLidKnob_66) {
    mesh_mugLidKnob_66Geometry.scale(0.022, 0.014, 0.022);
  }
  const mesh_mugLidKnob_66 = new THREE.Mesh(
    mesh_mugLidKnob_66Geometry,
    materialMap["mugLidWood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mugLidKnob_66.name = "\u6728\u76d6\u63d0\u94ae";
  if (endpoint_mugLidKnob_66) {
    mesh_mugLidKnob_66.position.copy(endpoint_mugLidKnob_66.midpoint);
    mesh_mugLidKnob_66.quaternion.copy(endpoint_mugLidKnob_66.quaternion);
  }
  mesh_mugLidKnob_66.castShadow = options.castShadow ?? true;
  mesh_mugLidKnob_66.receiveShadow = options.receiveShadow ?? true;
  mesh_mugLidKnob_66.userData.sculptComponent = {"id": "mugLidKnob", "name": "木盖提钮", "level": "meso", "role": "lid-knob", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "直径 22 mm、高 14 mm 的扁圆提钮，边缘全倒圆。", "geometryDescriptor": {"topologyIntent": "直径 22 mm、高 14 mm 的扁圆提钮，边缘全倒圆。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.022, "height": 0.014, "depth": 0.022, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.085, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugLidKnob-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.014, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugLidKnob-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugLidKnob_66.add(mesh_mugLidKnob_66);
  meshes["mugLidKnob"] = mesh_mugLidKnob_66;
  colliders["mugLidKnob"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.022, 0.014, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mugLidKnob-pivot"] ??= [];
  destructionGroups["mugLidKnob-pivot"].push(node_mugLidKnob_66);

  const endpoint_mugGrip_67 = makeAttachmentEndpoint(null);
  const node_mugGrip_67 = new THREE.Group();
  node_mugGrip_67.name = "\u676f\u628a\u624b__pivot";
  node_mugGrip_67.scale.set(1, 1, 1);
  if (endpoint_mugGrip_67) {
    node_mugGrip_67.position.copy(endpoint_mugGrip_67.start);
    node_mugGrip_67.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mugGrip_67.position.set(0.055, 0.0, 0.0);
    node_mugGrip_67.rotation.set(0.0, 0.0, 0.0);
  }
  node_mugGrip_67.userData.sculptComponent = {"id": "mugGrip", "name": "杯把手", "level": "meso", "role": "loop-grip", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "把手为竖直平面内的圆环曲面，截面近似 D 形，与杯壁两端相接。", "geometryDescriptor": {"topologyIntent": "把手为竖直平面内的圆环曲面，截面近似 D 形，与杯壁两端相接。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "torusTubeRatio": 0.32}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.034, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.055, 0.0, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugGrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.066, 0.066, 0.034], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugGrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-blend", "kind": "seam", "description": "把手与杯壁的熔接圆角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugGrip_67.userData.actionProfile = {"animationRole": "mugGrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.066, 0.066, 0.034], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugGrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mug"] ?? root).add(node_mugGrip_67);
  nodes["mugGrip"] = node_mugGrip_67;
  const mesh_mugGrip_67Geometry = endpoint_mugGrip_67
    ? new THREE.CylinderGeometry(endpoint_mugGrip_67.endRadius, endpoint_mugGrip_67.baseRadius, endpoint_mugGrip_67.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.144, 24, 96);
  if (!endpoint_mugGrip_67) {
    mesh_mugGrip_67Geometry.scale(0.066, 0.066, 0.034);
  }
  const mesh_mugGrip_67 = new THREE.Mesh(
    mesh_mugGrip_67Geometry,
    materialMap["mugLidWood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mugGrip_67.name = "\u676f\u628a\u624b";
  if (endpoint_mugGrip_67) {
    mesh_mugGrip_67.position.copy(endpoint_mugGrip_67.midpoint);
    mesh_mugGrip_67.quaternion.copy(endpoint_mugGrip_67.quaternion);
  }
  mesh_mugGrip_67.castShadow = options.castShadow ?? true;
  mesh_mugGrip_67.receiveShadow = options.receiveShadow ?? true;
  mesh_mugGrip_67.userData.sculptComponent = {"id": "mugGrip", "name": "杯把手", "level": "meso", "role": "loop-grip", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "把手为竖直平面内的圆环曲面，截面近似 D 形，与杯壁两端相接。", "geometryDescriptor": {"topologyIntent": "把手为竖直平面内的圆环曲面，截面近似 D 形，与杯壁两端相接。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "torusTubeRatio": 0.32}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.066, "height": 0.066, "depth": 0.034, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.055, 0.0, 0.0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugGrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.066, 0.066, 0.034], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugGrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "mugLidWood", "materialLayers": ["mugLidWood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-blend", "kind": "seam", "description": "把手与杯壁的熔接圆角。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 58, 36, 1.0)", "secondaryAlbedo": "rgba(140, 82, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_mugGrip_67.add(mesh_mugGrip_67);
  meshes["mugGrip"] = mesh_mugGrip_67;
  colliders["mugGrip"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.066, 0.066, 0.034], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mugGrip-pivot"] ??= [];
  destructionGroups["mugGrip-pivot"].push(node_mugGrip_67);

  const endpoint_mugNapkin_68 = makeAttachmentEndpoint(null);
  const node_mugNapkin_68 = new THREE.Group();
  node_mugNapkin_68.name = "\u767d\u8272\u7eb8\u57ab__pivot";
  node_mugNapkin_68.scale.set(1, 1, 1);
  if (endpoint_mugNapkin_68) {
    node_mugNapkin_68.position.copy(endpoint_mugNapkin_68.start);
    node_mugNapkin_68.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mugNapkin_68.position.set(0.0, -0.063, 0.0);
    node_mugNapkin_68.rotation.set(0.0, 0.0, 0.0);
  }
  node_mugNapkin_68.userData.sculptComponent = {"id": "mugNapkin", "name": "白色纸垫", "level": "meso", "role": "paper-mat", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "150×150 mm 的白色纸垫，边缘露齿，四角略卷。", "geometryDescriptor": {"topologyIntent": "150×150 mm 的白色纸垫，边缘露齿，四角略卷。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.15, "height": 0.0015, "depth": 0.15, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.063, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugNapkin-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.0015, 0.15], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugNapkin-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperMatte", "materialLayers": ["paperMatte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "napkin-deckle", "kind": "linework", "description": "纸垫边缘的齿状裁切。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 239, 230, 1.0)", "secondaryAlbedo": "rgba(220, 215, 203, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_mugNapkin_68.userData.actionProfile = {"animationRole": "mugNapkin-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.0015, 0.15], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugNapkin-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["mug"] ?? root).add(node_mugNapkin_68);
  nodes["mugNapkin"] = node_mugNapkin_68;
  const mesh_mugNapkin_68Geometry = endpoint_mugNapkin_68
    ? new THREE.CylinderGeometry(endpoint_mugNapkin_68.endRadius, endpoint_mugNapkin_68.baseRadius, endpoint_mugNapkin_68.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mugNapkin_68) {
    mesh_mugNapkin_68Geometry.scale(0.15, 0.0015, 0.15);
  }
  const mesh_mugNapkin_68 = new THREE.Mesh(
    mesh_mugNapkin_68Geometry,
    materialMap["paperMatte"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mugNapkin_68.name = "\u767d\u8272\u7eb8\u57ab";
  if (endpoint_mugNapkin_68) {
    mesh_mugNapkin_68.position.copy(endpoint_mugNapkin_68.midpoint);
    mesh_mugNapkin_68.quaternion.copy(endpoint_mugNapkin_68.quaternion);
  }
  mesh_mugNapkin_68.castShadow = options.castShadow ?? true;
  mesh_mugNapkin_68.receiveShadow = options.receiveShadow ?? true;
  mesh_mugNapkin_68.userData.sculptComponent = {"id": "mugNapkin", "name": "白色纸垫", "level": "meso", "role": "paper-mat", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "150×150 mm 的白色纸垫，边缘露齿，四角略卷。", "geometryDescriptor": {"topologyIntent": "150×150 mm 的白色纸垫，边缘露齿，四角略卷。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "mug", "attachment": null, "dimensions": {"width": 0.15, "height": 0.0015, "depth": 0.15, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, -0.063, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mugNapkin-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.0015, 0.15], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mugNapkin-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperMatte", "materialLayers": ["paperMatte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "napkin-deckle", "kind": "linework", "description": "纸垫边缘的齿状裁切。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 239, 230, 1.0)", "secondaryAlbedo": "rgba(220, 215, 203, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_mugNapkin_68.add(mesh_mugNapkin_68);
  meshes["mugNapkin"] = mesh_mugNapkin_68;
  colliders["mugNapkin"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.0015, 0.15], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["mugNapkin-pivot"] ??= [];
  destructionGroups["mugNapkin-pivot"].push(node_mugNapkin_68);

  const endpoint_bottle_69 = makeAttachmentEndpoint(null);
  const node_bottle_69 = new THREE.Group();
  node_bottle_69.name = "UZSPACE \u6c34\u58f6__pivot";
  node_bottle_69.scale.set(1, 1, 1);
  if (endpoint_bottle_69) {
    node_bottle_69.position.copy(endpoint_bottle_69.start);
    node_bottle_69.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bottle_69.position.set(0.452, 0.99, 0.03);
    node_bottle_69.rotation.set(0.0, 0.0, 0.0);
  }
  node_bottle_69.userData.sculptComponent = {"id": "bottle", "name": "UZSPACE 水壶", "level": "macro", "role": "drinkware", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "壶身是带腰线与肩部收口的旋转体，壁厚约 2.5 mm，半透明灰绿塑料。", "geometryDescriptor": {"topologyIntent": "壶身是带腰线与肩部收口的旋转体，壁厚约 2.5 mm，半透明灰绿塑料。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "latheProfile": {"points": [[0.18, -0.5], [0.48, -0.5], [0.5, -0.4], [0.48, 0.25], [0.44, 0.42], [0.28, 0.48], [0.24, 0.5], [0.18, 0.5], [0.18, -0.5]], "segments": 40}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.085, "height": 0.27, "depth": 0.085, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.452, 0.99, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-sway", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 0.27, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-sway", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleBody", "materialLayers": ["bottleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "volume-ribs", "kind": "groove", "description": "瓶身下半部 3 道浅横纹。", "evidenceRef": "front-view"}, {"id": "shoulder-curve", "kind": "ridge", "description": "肩部连续曲面。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter", "front-view"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 149, 143, 1.0)", "secondaryAlbedo": "rgba(111, 121, 115, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_bottle_69.userData.actionProfile = {"animationRole": "bottle-sway", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 0.27, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-sway", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_bottle_69);
  nodes["bottle"] = node_bottle_69;
  const mesh_bottle_69Geometry = endpoint_bottle_69
    ? new THREE.CylinderGeometry(endpoint_bottle_69.endRadius, endpoint_bottle_69.baseRadius, endpoint_bottle_69.length, 32, 12)
    : buildLatheGeometry({"points": [[0.18, -0.5], [0.48, -0.5], [0.5, -0.4], [0.48, 0.25], [0.44, 0.42], [0.28, 0.48], [0.24, 0.5], [0.18, 0.5], [0.18, -0.5]], "segments": 40});
  if (!endpoint_bottle_69) {
    mesh_bottle_69Geometry.scale(0.085, 0.27, 0.085);
  }
  const mesh_bottle_69 = new THREE.Mesh(
    mesh_bottle_69Geometry,
    materialMap["bottleBody"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bottle_69.name = "UZSPACE \u6c34\u58f6";
  if (endpoint_bottle_69) {
    mesh_bottle_69.position.copy(endpoint_bottle_69.midpoint);
    mesh_bottle_69.quaternion.copy(endpoint_bottle_69.quaternion);
  }
  mesh_bottle_69.castShadow = options.castShadow ?? true;
  mesh_bottle_69.receiveShadow = options.receiveShadow ?? true;
  mesh_bottle_69.userData.sculptComponent = {"id": "bottle", "name": "UZSPACE 水壶", "level": "macro", "role": "drinkware", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "壶身是带腰线与肩部收口的旋转体，壁厚约 2.5 mm，半透明灰绿塑料。", "geometryDescriptor": {"topologyIntent": "壶身是带腰线与肩部收口的旋转体，壁厚约 2.5 mm，半透明灰绿塑料。", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief", "latheProfile": {"points": [[0.18, -0.5], [0.48, -0.5], [0.5, -0.4], [0.48, 0.25], [0.44, 0.42], [0.28, 0.48], [0.24, 0.5], [0.18, 0.5], [0.18, -0.5]], "segments": 40}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.085, "height": 0.27, "depth": 0.085, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.452, 0.99, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-sway", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 0.27, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-sway", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleBody", "materialLayers": ["bottleBody"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "volume-ribs", "kind": "groove", "description": "瓶身下半部 3 道浅横纹。", "evidenceRef": "front-view"}, {"id": "shoulder-curve", "kind": "ridge", "description": "肩部连续曲面。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter", "front-view"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 149, 143, 1.0)", "secondaryAlbedo": "rgba(111, 121, 115, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_bottle_69.add(mesh_bottle_69);
  meshes["bottle"] = mesh_bottle_69;
  colliders["bottle"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 0.27, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bottle-sway"] ??= [];
  destructionGroups["bottle-sway"].push(node_bottle_69);

  const attachment_bottleCap_70 = {"parentId": "bottle", "parentSocket": "bottle-neck", "contactType": "socket", "localStart": [0, 0.135, 0], "localEnd": [0, 0.165, 0], "baseRadius": 0.039, "endRadius": 0.039, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_bottleCap_70 = makeAttachmentEndpoint(attachment_bottleCap_70);
  const node_bottleCap_70 = new THREE.Group();
  node_bottleCap_70.name = "\u6c34\u58f6\u9ed1\u76d6__pivot";
  node_bottleCap_70.scale.set(1, 1, 1);
  if (endpoint_bottleCap_70) {
    node_bottleCap_70.position.copy(endpoint_bottleCap_70.start);
    node_bottleCap_70.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bottleCap_70.position.set(0.0, 0.0, 0.0);
    node_bottleCap_70.rotation.set(0.0, 0.0, 0.0);
  }
  node_bottleCap_70.userData.sculptComponent = {"id": "bottleCap", "name": "水壶黑盖", "level": "meso", "role": "cap", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 78 mm、高 35 mm 的黑色旋盖，顶部有铰链式提环。", "geometryDescriptor": {"topologyIntent": "直径 78 mm、高 35 mm 的黑色旋盖，顶部有铰链式提环。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "bottle", "attachment": {"parentId": "bottle", "parentSocket": "bottle-neck", "contactType": "socket", "localStart": [0, 0.135, 0], "localEnd": [0, 0.165, 0], "baseRadius": 0.039, "endRadius": 0.039, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.078, "height": 0.035, "depth": 0.078, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-cap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.078, 0.035, 0.078], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleCap", "materialLayers": ["bottleCap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-knurl", "kind": "ridge", "description": "盖侧 24 道防滑竖纹。", "evidenceRef": "front-view"}, {"id": "cap-loop", "kind": "hole", "description": "顶部提环穿孔，直径 12 mm。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_bottleCap_70.userData.actionProfile = {"animationRole": "bottle-cap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.078, 0.035, 0.078], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["bottle"] ?? root).add(node_bottleCap_70);
  nodes["bottleCap"] = node_bottleCap_70;
  const mesh_bottleCap_70Geometry = endpoint_bottleCap_70
    ? new THREE.CylinderGeometry(endpoint_bottleCap_70.endRadius, endpoint_bottleCap_70.baseRadius, endpoint_bottleCap_70.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_bottleCap_70) {
    mesh_bottleCap_70Geometry.scale(0.078, 0.035, 0.078);
  }
  const mesh_bottleCap_70 = new THREE.Mesh(
    mesh_bottleCap_70Geometry,
    materialMap["bottleCap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bottleCap_70.name = "\u6c34\u58f6\u9ed1\u76d6";
  if (endpoint_bottleCap_70) {
    mesh_bottleCap_70.position.copy(endpoint_bottleCap_70.midpoint);
    mesh_bottleCap_70.quaternion.copy(endpoint_bottleCap_70.quaternion);
  }
  mesh_bottleCap_70.castShadow = options.castShadow ?? true;
  mesh_bottleCap_70.receiveShadow = options.receiveShadow ?? true;
  mesh_bottleCap_70.userData.sculptComponent = {"id": "bottleCap", "name": "水壶黑盖", "level": "meso", "role": "cap", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 78 mm、高 35 mm 的黑色旋盖，顶部有铰链式提环。", "geometryDescriptor": {"topologyIntent": "直径 78 mm、高 35 mm 的黑色旋盖，顶部有铰链式提环。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "bottle", "attachment": {"parentId": "bottle", "parentSocket": "bottle-neck", "contactType": "socket", "localStart": [0, 0.135, 0], "localEnd": [0, 0.165, 0], "baseRadius": 0.039, "endRadius": 0.039, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.078, "height": 0.035, "depth": 0.078, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-cap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.078, 0.035, 0.078], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "bottleCap", "materialLayers": ["bottleCap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-knurl", "kind": "ridge", "description": "盖侧 24 道防滑竖纹。", "evidenceRef": "front-view"}, {"id": "cap-loop", "kind": "hole", "description": "顶部提环穿孔，直径 12 mm。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_bottleCap_70.add(mesh_bottleCap_70);
  meshes["bottleCap"] = mesh_bottleCap_70;
  colliders["bottleCap"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.078, 0.035, 0.078], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bottle-cap"] ??= [];
  destructionGroups["bottle-cap"].push(node_bottleCap_70);

  const endpoint_bottleStrap_71 = makeAttachmentEndpoint(null);
  const node_bottleStrap_71 = new THREE.Group();
  node_bottleStrap_71.name = "\u6c34\u58f6\u6302\u5e26__pivot";
  node_bottleStrap_71.scale.set(1, 1, 1);
  if (endpoint_bottleStrap_71) {
    node_bottleStrap_71.position.copy(endpoint_bottleStrap_71.start);
    node_bottleStrap_71.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bottleStrap_71.position.set(0.025, 0.23, 0.03);
    node_bottleStrap_71.rotation.set(0.0, 0.0, 0.0);
  }
  node_bottleStrap_71.userData.sculptComponent = {"id": "bottleStrap", "name": "水壶挂带", "level": "meso", "role": "suspension-strap", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×160×4 mm 的黑色尼龙织带，从瓶盖提环穿出并挂到玻璃钩上。", "geometryDescriptor": {"topologyIntent": "18×160×4 mm 的黑色尼龙织带，从瓶盖提环穿出并挂到玻璃钩上。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "bottle", "attachment": null, "dimensions": {"width": 0.018, "height": 0.16, "depth": 0.004, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0.23, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-strap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.16, 0.004], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-strap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "fabricBlack", "materialLayers": ["fabricBlack"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strap-weave", "kind": "stitch", "description": "织带表面横向织纹。", "evidenceRef": "front-view"}, {"id": "strap-fold", "kind": "seam", "description": "穿过提环处的折返缝线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 24, 26, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_bottleStrap_71.userData.actionProfile = {"animationRole": "bottle-strap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.16, 0.004], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-strap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["bottle"] ?? root).add(node_bottleStrap_71);
  nodes["bottleStrap"] = node_bottleStrap_71;
  const mesh_bottleStrap_71Geometry = endpoint_bottleStrap_71
    ? new THREE.CylinderGeometry(endpoint_bottleStrap_71.endRadius, endpoint_bottleStrap_71.baseRadius, endpoint_bottleStrap_71.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_bottleStrap_71) {
    mesh_bottleStrap_71Geometry.scale(0.018, 0.16, 0.004);
  }
  const mesh_bottleStrap_71 = new THREE.Mesh(
    mesh_bottleStrap_71Geometry,
    materialMap["fabricBlack"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bottleStrap_71.name = "\u6c34\u58f6\u6302\u5e26";
  if (endpoint_bottleStrap_71) {
    mesh_bottleStrap_71.position.copy(endpoint_bottleStrap_71.midpoint);
    mesh_bottleStrap_71.quaternion.copy(endpoint_bottleStrap_71.quaternion);
  }
  mesh_bottleStrap_71.castShadow = options.castShadow ?? true;
  mesh_bottleStrap_71.receiveShadow = options.receiveShadow ?? true;
  mesh_bottleStrap_71.userData.sculptComponent = {"id": "bottleStrap", "name": "水壶挂带", "level": "meso", "role": "suspension-strap", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "18×160×4 mm 的黑色尼龙织带，从瓶盖提环穿出并挂到玻璃钩上。", "geometryDescriptor": {"topologyIntent": "18×160×4 mm 的黑色尼龙织带，从瓶盖提环穿出并挂到玻璃钩上。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "bottle", "attachment": null, "dimensions": {"width": 0.018, "height": 0.16, "depth": 0.004, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0.23, 0.03], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "bottle-strap", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.16, 0.004], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottle-strap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "fabricBlack", "materialLayers": ["fabricBlack"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strap-weave", "kind": "stitch", "description": "织带表面横向织纹。", "evidenceRef": "front-view"}, {"id": "strap-fold", "kind": "seam", "description": "穿过提环处的折返缝线。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["right-three-quarter"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 24, 26, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_bottleStrap_71.add(mesh_bottleStrap_71);
  meshes["bottleStrap"] = mesh_bottleStrap_71;
  colliders["bottleStrap"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.018, 0.16, 0.004], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["bottle-strap"] ??= [];
  destructionGroups["bottle-strap"].push(node_bottleStrap_71);

  const endpoint_paperStack_72 = makeAttachmentEndpoint(null);
  const node_paperStack_72 = new THREE.Group();
  node_paperStack_72.name = "\u624b\u5199\u7eb8\u4e0e\u9ec4\u8fb9\u7b14\u8bb0\u672c__pivot";
  node_paperStack_72.scale.set(1, 1, 1);
  if (endpoint_paperStack_72) {
    node_paperStack_72.position.copy(endpoint_paperStack_72.start);
    node_paperStack_72.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_paperStack_72.position.set(-0.4, 0.762, 0.19);
    node_paperStack_72.rotation.set(0.0, 0.0, 0.0);
  }
  node_paperStack_72.userData.sculptComponent = {"id": "paperStack", "name": "手写纸与黄边笔记本", "level": "macro", "role": "paper-stack", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "280×240 mm 纸张叠放，边缘不齐，表面有深蓝/黑手写字。", "geometryDescriptor": {"topologyIntent": "280×240 mm 纸张叠放，边缘不齐，表面有深蓝/黑手写字。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2, "height": 0.006, "depth": 0.2, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.4, 0.762, 0.19], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "paperStack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.006, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paperStack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperMatte", "materialLayers": ["paperMatte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handwriting", "kind": "linework", "description": "手写字行距不均。", "evidenceRef": "desk-details"}, {"id": "page-curl", "kind": "ridge", "description": "右下角轻微卷曲。", "evidenceRef": "desk-details"}, {"id": "yellow-edge", "kind": "decal", "description": "下层笔记的黄边。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 239, 230, 1.0)", "secondaryAlbedo": "rgba(220, 215, 203, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_paperStack_72.userData.actionProfile = {"animationRole": "paperStack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.006, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paperStack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_paperStack_72);
  nodes["paperStack"] = node_paperStack_72;
  const mesh_paperStack_72Geometry = endpoint_paperStack_72
    ? new THREE.CylinderGeometry(endpoint_paperStack_72.endRadius, endpoint_paperStack_72.baseRadius, endpoint_paperStack_72.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_paperStack_72) {
    mesh_paperStack_72Geometry.scale(0.2, 0.006, 0.2);
  }
  const mesh_paperStack_72 = new THREE.Mesh(
    mesh_paperStack_72Geometry,
    materialMap["paperMatte"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_paperStack_72.name = "\u624b\u5199\u7eb8\u4e0e\u9ec4\u8fb9\u7b14\u8bb0\u672c";
  if (endpoint_paperStack_72) {
    mesh_paperStack_72.position.copy(endpoint_paperStack_72.midpoint);
    mesh_paperStack_72.quaternion.copy(endpoint_paperStack_72.quaternion);
  }
  mesh_paperStack_72.castShadow = options.castShadow ?? true;
  mesh_paperStack_72.receiveShadow = options.receiveShadow ?? true;
  mesh_paperStack_72.userData.sculptComponent = {"id": "paperStack", "name": "手写纸与黄边笔记本", "level": "macro", "role": "paper-stack", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "280×240 mm 纸张叠放，边缘不齐，表面有深蓝/黑手写字。", "geometryDescriptor": {"topologyIntent": "280×240 mm 纸张叠放，边缘不齐，表面有深蓝/黑手写字。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2, "height": 0.006, "depth": 0.2, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.4, 0.762, 0.19], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "paperStack-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.006, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "paperStack-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperMatte", "materialLayers": ["paperMatte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handwriting", "kind": "linework", "description": "手写字行距不均。", "evidenceRef": "desk-details"}, {"id": "page-curl", "kind": "ridge", "description": "右下角轻微卷曲。", "evidenceRef": "desk-details"}, {"id": "yellow-edge", "kind": "decal", "description": "下层笔记的黄边。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 239, 230, 1.0)", "secondaryAlbedo": "rgba(220, 215, 203, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_paperStack_72.add(mesh_paperStack_72);
  meshes["paperStack"] = mesh_paperStack_72;
  colliders["paperStack"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.006, 0.2], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["paperStack-pivot"] ??= [];
  destructionGroups["paperStack-pivot"].push(node_paperStack_72);

  const endpoint_pencilCase_73 = makeAttachmentEndpoint(null);
  const node_pencilCase_73 = new THREE.Group();
  node_pencilCase_73.name = "\u9ed1\u8272\u7b14\u888b__pivot";
  node_pencilCase_73.scale.set(1, 1, 1);
  if (endpoint_pencilCase_73) {
    node_pencilCase_73.position.copy(endpoint_pencilCase_73.start);
    node_pencilCase_73.rotation.set(0.0, -0.4, 0.0);
  } else {
    node_pencilCase_73.position.set(0.02, 0.032, 0.0);
    node_pencilCase_73.rotation.set(0.0, -0.4, 0.0);
  }
  node_pencilCase_73.userData.sculptComponent = {"id": "pencilCase", "name": "黑色笔袋", "level": "meso", "role": "pencil-case", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "220×55×85 mm 的软质尼龙笔袋，正面有一条金属拉链和浅色布标。", "geometryDescriptor": {"topologyIntent": "220×55×85 mm 的软质尼龙笔袋，正面有一条金属拉链和浅色布标。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.22, "height": 0.055, "depth": 0.085, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.02, 0.032, 0.0], "rotation": [0, -0.4, 0]}, "actionProfile": {"animationRole": "pencilCase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.055, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pencilCase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "fabricBlack", "materialLayers": ["fabricBlack"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "zip-teeth", "kind": "fastener", "description": "连续金属拉链齿。", "evidenceRef": "desk-details"}, {"id": "woven-label", "kind": "decal", "description": "浅色布标。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 24, 26, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_pencilCase_73.userData.actionProfile = {"animationRole": "pencilCase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.055, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pencilCase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_pencilCase_73);
  nodes["pencilCase"] = node_pencilCase_73;
  const mesh_pencilCase_73Geometry = endpoint_pencilCase_73
    ? new THREE.CylinderGeometry(endpoint_pencilCase_73.endRadius, endpoint_pencilCase_73.baseRadius, endpoint_pencilCase_73.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_pencilCase_73) {
    mesh_pencilCase_73Geometry.scale(0.22, 0.055, 0.085);
  }
  const mesh_pencilCase_73 = new THREE.Mesh(
    mesh_pencilCase_73Geometry,
    materialMap["fabricBlack"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pencilCase_73.name = "\u9ed1\u8272\u7b14\u888b";
  if (endpoint_pencilCase_73) {
    mesh_pencilCase_73.position.copy(endpoint_pencilCase_73.midpoint);
    mesh_pencilCase_73.quaternion.copy(endpoint_pencilCase_73.quaternion);
  }
  mesh_pencilCase_73.castShadow = options.castShadow ?? true;
  mesh_pencilCase_73.receiveShadow = options.receiveShadow ?? true;
  mesh_pencilCase_73.userData.sculptComponent = {"id": "pencilCase", "name": "黑色笔袋", "level": "meso", "role": "pencil-case", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "220×55×85 mm 的软质尼龙笔袋，正面有一条金属拉链和浅色布标。", "geometryDescriptor": {"topologyIntent": "220×55×85 mm 的软质尼龙笔袋，正面有一条金属拉链和浅色布标。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.22, "height": 0.055, "depth": 0.085, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.02, 0.032, 0.0], "rotation": [0, -0.4, 0]}, "actionProfile": {"animationRole": "pencilCase-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.055, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pencilCase-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "fabricBlack", "materialLayers": ["fabricBlack"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "zip-teeth", "kind": "fastener", "description": "连续金属拉链齿。", "evidenceRef": "desk-details"}, {"id": "woven-label", "kind": "decal", "description": "浅色布标。", "evidenceRef": "desk-details"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 24, 26, 1.0)", "secondaryAlbedo": "rgba(58, 60, 62, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.8}};
  node_pencilCase_73.add(mesh_pencilCase_73);
  meshes["pencilCase"] = mesh_pencilCase_73;
  colliders["pencilCase"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.055, 0.085], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["pencilCase-pivot"] ??= [];
  destructionGroups["pencilCase-pivot"].push(node_pencilCase_73);

  const endpoint_notebook_74 = makeAttachmentEndpoint(null);
  const node_notebook_74 = new THREE.Group();
  node_notebook_74.name = "\u9ec4\u8fb9\u7b14\u8bb0\u672c__pivot";
  node_notebook_74.scale.set(1, 1, 1);
  if (endpoint_notebook_74) {
    node_notebook_74.position.copy(endpoint_notebook_74.start);
    node_notebook_74.rotation.set(0.0, -0.15, 0.0);
  } else {
    node_notebook_74.position.set(-0.02, 0.009, 0.02);
    node_notebook_74.rotation.set(0.0, -0.15, 0.0);
  }
  node_notebook_74.userData.sculptComponent = {"id": "notebook", "name": "黄边笔记本", "level": "meso", "role": "notebook", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "250×180×12 mm 的黄色封边笔记本，压在白色手写纸下方。", "geometryDescriptor": {"topologyIntent": "250×180×12 mm 的黄色封边笔记本，压在白色手写纸下方。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.25, "height": 0.012, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.02, 0.009, 0.02], "rotation": [0, -0.15, 0]}, "actionProfile": {"animationRole": "notebook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.012, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "notebook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperYellow", "materialLayers": ["paperYellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "notebook-spine", "kind": "ridge", "description": "明黄色书脊边。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 232, 201, 1.0)", "secondaryAlbedo": "rgba(232, 181, 58, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_notebook_74.userData.actionProfile = {"animationRole": "notebook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.012, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "notebook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_notebook_74);
  nodes["notebook"] = node_notebook_74;
  const mesh_notebook_74Geometry = endpoint_notebook_74
    ? new THREE.CylinderGeometry(endpoint_notebook_74.endRadius, endpoint_notebook_74.baseRadius, endpoint_notebook_74.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_notebook_74) {
    mesh_notebook_74Geometry.scale(0.25, 0.012, 0.18);
  }
  const mesh_notebook_74 = new THREE.Mesh(
    mesh_notebook_74Geometry,
    materialMap["paperYellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_notebook_74.name = "\u9ec4\u8fb9\u7b14\u8bb0\u672c";
  if (endpoint_notebook_74) {
    mesh_notebook_74.position.copy(endpoint_notebook_74.midpoint);
    mesh_notebook_74.quaternion.copy(endpoint_notebook_74.quaternion);
  }
  mesh_notebook_74.castShadow = options.castShadow ?? true;
  mesh_notebook_74.receiveShadow = options.receiveShadow ?? true;
  mesh_notebook_74.userData.sculptComponent = {"id": "notebook", "name": "黄边笔记本", "level": "meso", "role": "notebook", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "250×180×12 mm 的黄色封边笔记本，压在白色手写纸下方。", "geometryDescriptor": {"topologyIntent": "250×180×12 mm 的黄色封边笔记本，压在白色手写纸下方。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.25, "height": 0.012, "depth": 0.18, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.02, 0.009, 0.02], "rotation": [0, -0.15, 0]}, "actionProfile": {"animationRole": "notebook-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.012, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "notebook-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "paperYellow", "materialLayers": ["paperYellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "notebook-spine", "kind": "ridge", "description": "明黄色书脊边。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 232, 201, 1.0)", "secondaryAlbedo": "rgba(232, 181, 58, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_notebook_74.add(mesh_notebook_74);
  meshes["notebook"] = mesh_notebook_74;
  colliders["notebook"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.012, 0.18], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["notebook-pivot"] ??= [];
  destructionGroups["notebook-pivot"].push(node_notebook_74);

  const endpoint_powerBrick_75 = makeAttachmentEndpoint(null);
  const node_powerBrick_75 = new THREE.Group();
  node_powerBrick_75.name = "\u767d\u8272\u7535\u6e90\u9002\u914d\u5668__pivot";
  node_powerBrick_75.scale.set(1, 1, 1);
  if (endpoint_powerBrick_75) {
    node_powerBrick_75.position.copy(endpoint_powerBrick_75.start);
    node_powerBrick_75.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_powerBrick_75.position.set(-0.08, 0.004, -0.43);
    node_powerBrick_75.rotation.set(0.0, 0.0, 0.0);
  }
  node_powerBrick_75.userData.sculptComponent = {"id": "powerBrick", "name": "白色电源适配器", "level": "meso", "role": "power-adapter", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "160×70×35 mm 白色电源砖，顶面有细散热槽与品牌压印。", "geometryDescriptor": {"topologyIntent": "160×70×35 mm 白色电源砖，顶面有细散热槽与品牌压印。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.16, "height": 0.035, "depth": 0.07, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.08, 0.004, -0.43], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "powerBrick-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.035, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerBrick-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "brick-vent", "kind": "groove", "description": "顶面 6 道细散热槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_powerBrick_75.userData.actionProfile = {"animationRole": "powerBrick-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.035, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerBrick-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_powerBrick_75);
  nodes["powerBrick"] = node_powerBrick_75;
  const mesh_powerBrick_75Geometry = endpoint_powerBrick_75
    ? new THREE.CylinderGeometry(endpoint_powerBrick_75.endRadius, endpoint_powerBrick_75.baseRadius, endpoint_powerBrick_75.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_powerBrick_75) {
    mesh_powerBrick_75Geometry.scale(0.16, 0.035, 0.07);
  }
  const mesh_powerBrick_75 = new THREE.Mesh(
    mesh_powerBrick_75Geometry,
    materialMap["whiteShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_powerBrick_75.name = "\u767d\u8272\u7535\u6e90\u9002\u914d\u5668";
  if (endpoint_powerBrick_75) {
    mesh_powerBrick_75.position.copy(endpoint_powerBrick_75.midpoint);
    mesh_powerBrick_75.quaternion.copy(endpoint_powerBrick_75.quaternion);
  }
  mesh_powerBrick_75.castShadow = options.castShadow ?? true;
  mesh_powerBrick_75.receiveShadow = options.receiveShadow ?? true;
  mesh_powerBrick_75.userData.sculptComponent = {"id": "powerBrick", "name": "白色电源适配器", "level": "meso", "role": "power-adapter", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "160×70×35 mm 白色电源砖，顶面有细散热槽与品牌压印。", "geometryDescriptor": {"topologyIntent": "160×70×35 mm 白色电源砖，顶面有细散热槽与品牌压印。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.16, "height": 0.035, "depth": 0.07, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.08, 0.004, -0.43], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "powerBrick-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.035, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerBrick-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "brick-vent", "kind": "groove", "description": "顶面 6 道细散热槽。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_powerBrick_75.add(mesh_powerBrick_75);
  meshes["powerBrick"] = mesh_powerBrick_75;
  colliders["powerBrick"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.035, 0.07], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["powerBrick-pivot"] ??= [];
  destructionGroups["powerBrick-pivot"].push(node_powerBrick_75);

  const endpoint_powerStrip_76 = makeAttachmentEndpoint(null);
  const node_powerStrip_76 = new THREE.Group();
  node_powerStrip_76.name = "\u767d\u8272\u63d2\u6392__pivot";
  node_powerStrip_76.scale.set(1, 1, 1);
  if (endpoint_powerStrip_76) {
    node_powerStrip_76.position.copy(endpoint_powerStrip_76.start);
    node_powerStrip_76.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_powerStrip_76.position.set(0.73, -0.003, -0.42);
    node_powerStrip_76.rotation.set(0.0, 0.0, 0.0);
  }
  node_powerStrip_76.userData.sculptComponent = {"id": "powerStrip", "name": "白色插排", "level": "meso", "role": "power-strip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300×80×25 mm 白色插排，竖直插孔与红色电源灯。", "geometryDescriptor": {"topologyIntent": "300×80×25 mm 白色插排，竖直插孔与红色电源灯。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.3, "height": 0.025, "depth": 0.08, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.73, -0.003, -0.42], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "powerStrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.025, 0.08], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerStrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "indicator-led", "kind": "emissive", "description": "红色/橙色电源指示灯。", "evidenceRef": "desk-details"}, {"id": "socket-shutters", "kind": "hole", "description": "插孔的黑色安全门。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_powerStrip_76.userData.actionProfile = {"animationRole": "powerStrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.025, 0.08], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerStrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_powerStrip_76);
  nodes["powerStrip"] = node_powerStrip_76;
  const mesh_powerStrip_76Geometry = endpoint_powerStrip_76
    ? new THREE.CylinderGeometry(endpoint_powerStrip_76.endRadius, endpoint_powerStrip_76.baseRadius, endpoint_powerStrip_76.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_powerStrip_76) {
    mesh_powerStrip_76Geometry.scale(0.3, 0.025, 0.08);
  }
  const mesh_powerStrip_76 = new THREE.Mesh(
    mesh_powerStrip_76Geometry,
    materialMap["whiteShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_powerStrip_76.name = "\u767d\u8272\u63d2\u6392";
  if (endpoint_powerStrip_76) {
    mesh_powerStrip_76.position.copy(endpoint_powerStrip_76.midpoint);
    mesh_powerStrip_76.quaternion.copy(endpoint_powerStrip_76.quaternion);
  }
  mesh_powerStrip_76.castShadow = options.castShadow ?? true;
  mesh_powerStrip_76.receiveShadow = options.receiveShadow ?? true;
  mesh_powerStrip_76.userData.sculptComponent = {"id": "powerStrip", "name": "白色插排", "level": "meso", "role": "power-strip", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "300×80×25 mm 白色插排，竖直插孔与红色电源灯。", "geometryDescriptor": {"topologyIntent": "300×80×25 mm 白色插排，竖直插孔与红色电源灯。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.3, "height": 0.025, "depth": 0.08, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.73, -0.003, -0.42], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "powerStrip-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.025, 0.08], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "powerStrip-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "indicator-led", "kind": "emissive", "description": "红色/橙色电源指示灯。", "evidenceRef": "desk-details"}, {"id": "socket-shutters", "kind": "hole", "description": "插孔的黑色安全门。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_powerStrip_76.add(mesh_powerStrip_76);
  meshes["powerStrip"] = mesh_powerStrip_76;
  colliders["powerStrip"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.025, 0.08], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["powerStrip-pivot"] ??= [];
  destructionGroups["powerStrip-pivot"].push(node_powerStrip_76);

  const endpoint_usbHub_77 = makeAttachmentEndpoint(null);
  const node_usbHub_77 = new THREE.Group();
  node_usbHub_77.name = "\u767d\u8272 USB-C \u6269\u5c55\u575e__pivot";
  node_usbHub_77.scale.set(1, 1, 1);
  if (endpoint_usbHub_77) {
    node_usbHub_77.position.copy(endpoint_usbHub_77.start);
    node_usbHub_77.rotation.set(0.0, 0.12, 0.0);
  } else {
    node_usbHub_77.position.set(0.7, 0.004, -0.16);
    node_usbHub_77.rotation.set(0.0, 0.12, 0.0);
  }
  node_usbHub_77.userData.sculptComponent = {"id": "usbHub", "name": "白色 USB-C 扩展坞", "level": "meso", "role": "usb-hub", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "35×55×22 mm 白色 USB-C 扩展坞，竖立放在桌面，正面有两个接口与细指示灯。", "geometryDescriptor": {"topologyIntent": "35×55×22 mm 白色 USB-C 扩展坞，竖立放在桌面，正面有两个接口与细指示灯。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.035, "height": 0.055, "depth": 0.022, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.7, 0.004, -0.16], "rotation": [0, 0.12, 0]}, "actionProfile": {"animationRole": "usbHub-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.055, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "usbHub-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-port-a", "kind": "hole", "description": "USB-C 接口开孔。", "evidenceRef": "front-view"}, {"id": "hub-port-b", "kind": "hole", "description": "第二个 USB-C 接口开孔。", "evidenceRef": "front-view"}, {"id": "hub-led", "kind": "emissive", "description": "白色指示灯。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details", "front-view"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_usbHub_77.userData.actionProfile = {"animationRole": "usbHub-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.055, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "usbHub-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_usbHub_77);
  nodes["usbHub"] = node_usbHub_77;
  const mesh_usbHub_77Geometry = endpoint_usbHub_77
    ? new THREE.CylinderGeometry(endpoint_usbHub_77.endRadius, endpoint_usbHub_77.baseRadius, endpoint_usbHub_77.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_usbHub_77) {
    mesh_usbHub_77Geometry.scale(0.035, 0.055, 0.022);
  }
  const mesh_usbHub_77 = new THREE.Mesh(
    mesh_usbHub_77Geometry,
    materialMap["whiteShell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_usbHub_77.name = "\u767d\u8272 USB-C \u6269\u5c55\u575e";
  if (endpoint_usbHub_77) {
    mesh_usbHub_77.position.copy(endpoint_usbHub_77.midpoint);
    mesh_usbHub_77.quaternion.copy(endpoint_usbHub_77.quaternion);
  }
  mesh_usbHub_77.castShadow = options.castShadow ?? true;
  mesh_usbHub_77.receiveShadow = options.receiveShadow ?? true;
  mesh_usbHub_77.userData.sculptComponent = {"id": "usbHub", "name": "白色 USB-C 扩展坞", "level": "meso", "role": "usb-hub", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "35×55×22 mm 白色 USB-C 扩展坞，竖立放在桌面，正面有两个接口与细指示灯。", "geometryDescriptor": {"topologyIntent": "35×55×22 mm 白色 USB-C 扩展坞，竖立放在桌面，正面有两个接口与细指示灯。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": null, "dimensions": {"width": 0.035, "height": 0.055, "depth": 0.022, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.7, 0.004, -0.16], "rotation": [0, 0.12, 0]}, "actionProfile": {"animationRole": "usbHub-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.055, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "usbHub-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "whiteShell", "materialLayers": ["whiteShell"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-port-a", "kind": "hole", "description": "USB-C 接口开孔。", "evidenceRef": "front-view"}, {"id": "hub-port-b", "kind": "hole", "description": "第二个 USB-C 接口开孔。", "evidenceRef": "front-view"}, {"id": "hub-led", "kind": "emissive", "description": "白色指示灯。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details", "front-view"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 231, 227, 1.0)", "secondaryAlbedo": "rgba(201, 199, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_usbHub_77.add(mesh_usbHub_77);
  meshes["usbHub"] = mesh_usbHub_77;
  colliders["usbHub"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.035, 0.055, 0.022], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["usbHub-pivot"] ??= [];
  destructionGroups["usbHub-pivot"].push(node_usbHub_77);

  const attachment_pen_78 = {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "butt", "localStart": [-0.055, 0.018, 0.055], "localEnd": [0.045, 0.018, 0.095], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_pen_78 = makeAttachmentEndpoint(attachment_pen_78);
  const node_pen_78 = new THREE.Group();
  node_pen_78.name = "\u84dd\u8272\u4e2d\u6027\u7b14__pivot";
  node_pen_78.scale.set(1, 1, 1);
  if (endpoint_pen_78) {
    node_pen_78.position.copy(endpoint_pen_78.start);
    node_pen_78.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pen_78.position.set(0.0, 0.0, 0.0);
    node_pen_78.rotation.set(0.0, 0.0, 0.0);
  }
  node_pen_78.userData.sculptComponent = {"id": "pen", "name": "蓝色中性笔", "level": "meso", "role": "writing-pen", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 6 mm、长 140 mm 的蓝色中性笔，斜放在纸张上。", "geometryDescriptor": {"topologyIntent": "直径 6 mm、长 140 mm 的蓝色中性笔，斜放在纸张上。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "butt", "localStart": [-0.055, 0.018, 0.055], "localEnd": [0.045, 0.018, 0.095], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "pen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "penBlue", "materialLayers": ["penBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pen-clip", "kind": "ridge", "description": "笔帽金属夹。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 77, 140, 1.0)", "secondaryAlbedo": "rgba(14, 42, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_pen_78.userData.actionProfile = {"animationRole": "pen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_pen_78);
  nodes["pen"] = node_pen_78;
  const mesh_pen_78Geometry = endpoint_pen_78
    ? new THREE.CylinderGeometry(endpoint_pen_78.endRadius, endpoint_pen_78.baseRadius, endpoint_pen_78.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_pen_78) {
    mesh_pen_78Geometry.scale(0.006, 0.006, 0.14);
  }
  const mesh_pen_78 = new THREE.Mesh(
    mesh_pen_78Geometry,
    materialMap["penBlue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pen_78.name = "\u84dd\u8272\u4e2d\u6027\u7b14";
  if (endpoint_pen_78) {
    mesh_pen_78.position.copy(endpoint_pen_78.midpoint);
    mesh_pen_78.quaternion.copy(endpoint_pen_78.quaternion);
  }
  mesh_pen_78.castShadow = options.castShadow ?? true;
  mesh_pen_78.receiveShadow = options.receiveShadow ?? true;
  mesh_pen_78.userData.sculptComponent = {"id": "pen", "name": "蓝色中性笔", "level": "meso", "role": "writing-pen", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "直径 6 mm、长 140 mm 的蓝色中性笔，斜放在纸张上。", "geometryDescriptor": {"topologyIntent": "直径 6 mm、长 140 mm 的蓝色中性笔，斜放在纸张上。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "butt", "localStart": [-0.055, 0.018, 0.055], "localEnd": [0.045, 0.018, 0.095], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "pen-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pen-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "penBlue", "materialLayers": ["penBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pen-clip", "kind": "ridge", "description": "笔帽金属夹。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 77, 140, 1.0)", "secondaryAlbedo": "rgba(14, 42, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_pen_78.add(mesh_pen_78);
  meshes["pen"] = mesh_pen_78;
  colliders["pen"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.14], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["pen-pivot"] ??= [];
  destructionGroups["pen-pivot"].push(node_pen_78);

  const attachment_penCap_79 = {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "socket", "localStart": [-0.055, 0.018, 0.055], "localEnd": [-0.025, 0.018, 0.065], "baseRadius": 0.004, "endRadius": 0.004, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]};
  const endpoint_penCap_79 = makeAttachmentEndpoint(attachment_penCap_79);
  const node_penCap_79 = new THREE.Group();
  node_penCap_79.name = "\u7b14\u5e3d__pivot";
  node_penCap_79.scale.set(1, 1, 1);
  if (endpoint_penCap_79) {
    node_penCap_79.position.copy(endpoint_penCap_79.start);
    node_penCap_79.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_penCap_79.position.set(0.0, 0.0, 0.0);
    node_penCap_79.rotation.set(0.0, 0.0, 0.0);
  }
  node_penCap_79.userData.sculptComponent = {"id": "penCap", "name": "笔帽", "level": "meso", "role": "pen-cap", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "45 mm 长的笔帽，一端有金属夹。", "geometryDescriptor": {"topologyIntent": "45 mm 长的笔帽，一端有金属夹。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "socket", "localStart": [-0.055, 0.018, 0.055], "localEnd": [-0.025, 0.018, 0.065], "baseRadius": 0.004, "endRadius": 0.004, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.008, "height": 0.008, "depth": 0.045, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "penCap-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.008, 0.045], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "penCap-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "penBlue", "materialLayers": ["penBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 77, 140, 1.0)", "secondaryAlbedo": "rgba(14, 42, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_penCap_79.userData.actionProfile = {"animationRole": "penCap-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.008, 0.045], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "penCap-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["paperStack"] ?? root).add(node_penCap_79);
  nodes["penCap"] = node_penCap_79;
  const mesh_penCap_79Geometry = endpoint_penCap_79
    ? new THREE.CylinderGeometry(endpoint_penCap_79.endRadius, endpoint_penCap_79.baseRadius, endpoint_penCap_79.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_penCap_79) {
    mesh_penCap_79Geometry.scale(0.008, 0.008, 0.045);
  }
  const mesh_penCap_79 = new THREE.Mesh(
    mesh_penCap_79Geometry,
    materialMap["penBlue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_penCap_79.name = "\u7b14\u5e3d";
  if (endpoint_penCap_79) {
    mesh_penCap_79.position.copy(endpoint_penCap_79.midpoint);
    mesh_penCap_79.quaternion.copy(endpoint_penCap_79.quaternion);
  }
  mesh_penCap_79.castShadow = options.castShadow ?? true;
  mesh_penCap_79.receiveShadow = options.receiveShadow ?? true;
  mesh_penCap_79.userData.sculptComponent = {"id": "penCap", "name": "笔帽", "level": "meso", "role": "pen-cap", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "45 mm 长的笔帽，一端有金属夹。", "geometryDescriptor": {"topologyIntent": "45 mm 长的笔帽，一端有金属夹。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "paperStack", "attachment": {"parentId": "paperStack", "parentSocket": "paper-slot", "contactType": "socket", "localStart": [-0.055, 0.018, 0.055], "localEnd": [-0.025, 0.018, 0.065], "baseRadius": 0.004, "endRadius": 0.004, "embedDepth": 0.004, "overlap": 0.002, "gapTolerance": 0.0015, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.008, "height": 0.008, "depth": 0.045, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "penCap-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.008, 0.045], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "penCap-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "penBlue", "materialLayers": ["penBlue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 77, 140, 1.0)", "secondaryAlbedo": "rgba(14, 42, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_penCap_79.add(mesh_penCap_79);
  meshes["penCap"] = mesh_penCap_79;
  colliders["penCap"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.008, 0.008, 0.045], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["penCap-pivot"] ??= [];
  destructionGroups["penCap-pivot"].push(node_penCap_79);

  const endpoint_wireHarness_80 = makeAttachmentEndpoint(null);
  const node_wireHarness_80 = new THREE.Group();
  node_wireHarness_80.name = "\u7ebf\u7f06\u675f__pivot";
  node_wireHarness_80.scale.set(1, 1, 1);
  if (endpoint_wireHarness_80) {
    node_wireHarness_80.position.copy(endpoint_wireHarness_80.start);
    node_wireHarness_80.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wireHarness_80.position.set(0.0, 0.6, -0.2);
    node_wireHarness_80.rotation.set(0.0, 0.0, 0.0);
  }
  node_wireHarness_80.userData.sculptComponent = {"id": "wireHarness", "name": "线缆束", "level": "macro", "role": "wire-harness", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "不可见分组代理；实际线缆由运行时 Catmull-Rom 管几何生成，端点落在笔记本、显示器与插排接口。", "geometryDescriptor": {"topologyIntent": "不可见分组代理；实际线缆由运行时 Catmull-Rom 管几何生成，端点落在笔记本、显示器与插排接口。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.6, -0.2], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "wireHarness-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wireHarness-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "invisible", "materialLayers": ["invisible"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 32, 32, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_wireHarness_80.userData.actionProfile = {"animationRole": "wireHarness-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wireHarness-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["root"] ?? root).add(node_wireHarness_80);
  nodes["wireHarness"] = node_wireHarness_80;
  const mesh_wireHarness_80Geometry = endpoint_wireHarness_80
    ? new THREE.CylinderGeometry(endpoint_wireHarness_80.endRadius, endpoint_wireHarness_80.baseRadius, endpoint_wireHarness_80.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_wireHarness_80) {
    mesh_wireHarness_80Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_wireHarness_80 = new THREE.Mesh(
    mesh_wireHarness_80Geometry,
    materialMap["invisible"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wireHarness_80.name = "\u7ebf\u7f06\u675f";
  if (endpoint_wireHarness_80) {
    mesh_wireHarness_80.position.copy(endpoint_wireHarness_80.midpoint);
    mesh_wireHarness_80.quaternion.copy(endpoint_wireHarness_80.quaternion);
  }
  mesh_wireHarness_80.castShadow = options.castShadow ?? true;
  mesh_wireHarness_80.receiveShadow = options.receiveShadow ?? true;
  mesh_wireHarness_80.userData.sculptComponent = {"id": "wireHarness", "name": "线缆束", "level": "macro", "role": "wire-harness", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "不可见分组代理；实际线缆由运行时 Catmull-Rom 管几何生成，端点落在笔记本、显示器与插排接口。", "geometryDescriptor": {"topologyIntent": "不可见分组代理；实际线缆由运行时 Catmull-Rom 管几何生成，端点落在笔记本、显示器与插排接口。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.6, -0.2], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "wireHarness-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wireHarness-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "invisible", "materialLayers": ["invisible"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 32, 32, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8}};
  node_wireHarness_80.add(mesh_wireHarness_80);
  meshes["wireHarness"] = mesh_wireHarness_80;
  colliders["wireHarness"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["wireHarness-pivot"] ??= [];
  destructionGroups["wireHarness-pivot"].push(node_wireHarness_80);

  const endpoint_whiteLead_81 = makeAttachmentEndpoint(null);
  const node_whiteLead_81 = new THREE.Group();
  node_whiteLead_81.name = "\u767d\u8272 USB-C \u7ebf__pivot";
  node_whiteLead_81.scale.set(1, 1, 1);
  if (endpoint_whiteLead_81) {
    node_whiteLead_81.position.copy(endpoint_whiteLead_81.start);
    node_whiteLead_81.rotation.set(0.0, 0.65, 0.0);
  } else {
    node_whiteLead_81.position.set(-0.5, 0.02, 0.24);
    node_whiteLead_81.rotation.set(0.0, 0.65, 0.0);
  }
  node_whiteLead_81.userData.sculptComponent = {"id": "whiteLead", "name": "白色 USB-C 线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "白色哑光 PVC 线，直径 6 mm，从笔记本左侧弯到桌面左前；占位直线在运行时替换为曲线管。", "geometryDescriptor": {"topologyIntent": "白色哑光 PVC 线，直径 6 mm，从笔记本左侧弯到桌面左前；占位直线在运行时替换为曲线管。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.36, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.5, 0.02, 0.24], "rotation": [0.0, 0.65, 0.0]}, "actionProfile": {"animationRole": "whiteLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.36], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "whiteLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "rubberCable", "materialLayers": ["rubberCable"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strain-relief", "kind": "ridge", "description": "接口端 30 mm 长的加强套。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 231, 1.0)", "secondaryAlbedo": "rgba(195, 195, 191, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_whiteLead_81.userData.actionProfile = {"animationRole": "whiteLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.36], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "whiteLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["wireHarness"] ?? root).add(node_whiteLead_81);
  nodes["whiteLead"] = node_whiteLead_81;
  const mesh_whiteLead_81Geometry = endpoint_whiteLead_81
    ? new THREE.CylinderGeometry(endpoint_whiteLead_81.endRadius, endpoint_whiteLead_81.baseRadius, endpoint_whiteLead_81.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_whiteLead_81) {
    mesh_whiteLead_81Geometry.scale(0.006, 0.006, 0.36);
  }
  const mesh_whiteLead_81 = new THREE.Mesh(
    mesh_whiteLead_81Geometry,
    materialMap["rubberCable"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_whiteLead_81.name = "\u767d\u8272 USB-C \u7ebf";
  if (endpoint_whiteLead_81) {
    mesh_whiteLead_81.position.copy(endpoint_whiteLead_81.midpoint);
    mesh_whiteLead_81.quaternion.copy(endpoint_whiteLead_81.quaternion);
  }
  mesh_whiteLead_81.castShadow = options.castShadow ?? true;
  mesh_whiteLead_81.receiveShadow = options.receiveShadow ?? true;
  mesh_whiteLead_81.userData.sculptComponent = {"id": "whiteLead", "name": "白色 USB-C 线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "白色哑光 PVC 线，直径 6 mm，从笔记本左侧弯到桌面左前；占位直线在运行时替换为曲线管。", "geometryDescriptor": {"topologyIntent": "白色哑光 PVC 线，直径 6 mm，从笔记本左侧弯到桌面左前；占位直线在运行时替换为曲线管。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.36, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.5, 0.02, 0.24], "rotation": [0.0, 0.65, 0.0]}, "actionProfile": {"animationRole": "whiteLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.36], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "whiteLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "rubberCable", "materialLayers": ["rubberCable"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strain-relief", "kind": "ridge", "description": "接口端 30 mm 长的加强套。", "evidenceRef": "front-view"}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 231, 1.0)", "secondaryAlbedo": "rgba(195, 195, 191, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_whiteLead_81.add(mesh_whiteLead_81);
  meshes["whiteLead"] = mesh_whiteLead_81;
  colliders["whiteLead"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.36], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["whiteLead-pivot"] ??= [];
  destructionGroups["whiteLead-pivot"].push(node_whiteLead_81);

  const endpoint_blackLead_82 = makeAttachmentEndpoint(null);
  const node_blackLead_82 = new THREE.Group();
  node_blackLead_82.name = "\u9ed1\u8272\u663e\u793a\u5668\u7535\u6e90/\u89c6\u9891\u7ebf__pivot";
  node_blackLead_82.scale.set(1, 1, 1);
  if (endpoint_blackLead_82) {
    node_blackLead_82.position.copy(endpoint_blackLead_82.start);
    node_blackLead_82.rotation.set(0.0, 0.15, 0.0);
  } else {
    node_blackLead_82.position.set(0.18, 0.1, -0.04);
    node_blackLead_82.rotation.set(0.0, 0.15, 0.0);
  }
  node_blackLead_82.userData.sculptComponent = {"id": "blackLead", "name": "黑色显示器电源/视频线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两根黑色线缆沿显示器立柱后方下行，再折向桌后插排；占位直线运行时替换。", "geometryDescriptor": {"topologyIntent": "两根黑色线缆沿显示器立柱后方下行，再折向桌后插排；占位直线运行时替换。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.4, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.18, 0.1, -0.04], "rotation": [0.0, 0.15, 0.0]}, "actionProfile": {"animationRole": "blackLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.4], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "blackLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_blackLead_82.userData.actionProfile = {"animationRole": "blackLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.4], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "blackLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["wireHarness"] ?? root).add(node_blackLead_82);
  nodes["blackLead"] = node_blackLead_82;
  const mesh_blackLead_82Geometry = endpoint_blackLead_82
    ? new THREE.CylinderGeometry(endpoint_blackLead_82.endRadius, endpoint_blackLead_82.baseRadius, endpoint_blackLead_82.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_blackLead_82) {
    mesh_blackLead_82Geometry.scale(0.006, 0.006, 0.4);
  }
  const mesh_blackLead_82 = new THREE.Mesh(
    mesh_blackLead_82Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_blackLead_82.name = "\u9ed1\u8272\u663e\u793a\u5668\u7535\u6e90/\u89c6\u9891\u7ebf";
  if (endpoint_blackLead_82) {
    mesh_blackLead_82.position.copy(endpoint_blackLead_82.midpoint);
    mesh_blackLead_82.quaternion.copy(endpoint_blackLead_82.quaternion);
  }
  mesh_blackLead_82.castShadow = options.castShadow ?? true;
  mesh_blackLead_82.receiveShadow = options.receiveShadow ?? true;
  mesh_blackLead_82.userData.sculptComponent = {"id": "blackLead", "name": "黑色显示器电源/视频线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "两根黑色线缆沿显示器立柱后方下行，再折向桌后插排；占位直线运行时替换。", "geometryDescriptor": {"topologyIntent": "两根黑色线缆沿显示器立柱后方下行，再折向桌后插排；占位直线运行时替换。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.006, "height": 0.006, "depth": 0.4, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.18, 0.1, -0.04], "rotation": [0.0, 0.15, 0.0]}, "actionProfile": {"animationRole": "blackLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.4], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "blackLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_blackLead_82.add(mesh_blackLead_82);
  meshes["blackLead"] = mesh_blackLead_82;
  colliders["blackLead"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.006, 0.006, 0.4], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["blackLead-pivot"] ??= [];
  destructionGroups["blackLead-pivot"].push(node_blackLead_82);

  const endpoint_earphoneLead_83 = makeAttachmentEndpoint(null);
  const node_earphoneLead_83 = new THREE.Group();
  node_earphoneLead_83.name = "\u8033\u673a\u7ebf__pivot";
  node_earphoneLead_83.scale.set(1, 1, 1);
  if (endpoint_earphoneLead_83) {
    node_earphoneLead_83.position.copy(endpoint_earphoneLead_83.start);
    node_earphoneLead_83.rotation.set(0.0, -0.5, 0.0);
  } else {
    node_earphoneLead_83.position.set(0.55, 0.01, -0.05);
    node_earphoneLead_83.rotation.set(0.0, -0.5, 0.0);
  }
  node_earphoneLead_83.userData.sculptComponent = {"id": "earphoneLead", "name": "耳机线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "细耳机线在显示器右侧盘绕后落到桌面。", "geometryDescriptor": {"topologyIntent": "细耳机线在显示器右侧盘绕后落到桌面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.004, "height": 0.004, "depth": 0.16, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.55, 0.01, -0.05], "rotation": [0.0, -0.5, 0.0]}, "actionProfile": {"animationRole": "earphoneLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.16], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earphoneLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_earphoneLead_83.userData.actionProfile = {"animationRole": "earphoneLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.16], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earphoneLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}};
  (nodes["wireHarness"] ?? root).add(node_earphoneLead_83);
  nodes["earphoneLead"] = node_earphoneLead_83;
  const mesh_earphoneLead_83Geometry = endpoint_earphoneLead_83
    ? new THREE.CylinderGeometry(endpoint_earphoneLead_83.endRadius, endpoint_earphoneLead_83.baseRadius, endpoint_earphoneLead_83.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_earphoneLead_83) {
    mesh_earphoneLead_83Geometry.scale(0.004, 0.004, 0.16);
  }
  const mesh_earphoneLead_83 = new THREE.Mesh(
    mesh_earphoneLead_83Geometry,
    materialMap["monitorPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_earphoneLead_83.name = "\u8033\u673a\u7ebf";
  if (endpoint_earphoneLead_83) {
    mesh_earphoneLead_83.position.copy(endpoint_earphoneLead_83.midpoint);
    mesh_earphoneLead_83.quaternion.copy(endpoint_earphoneLead_83.quaternion);
  }
  mesh_earphoneLead_83.castShadow = options.castShadow ?? true;
  mesh_earphoneLead_83.receiveShadow = options.receiveShadow ?? true;
  mesh_earphoneLead_83.userData.sculptComponent = {"id": "earphoneLead", "name": "耳机线", "level": "meso", "role": "wire-lead", "importance": 0.75, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "细耳机线在显示器右侧盘绕后落到桌面。", "geometryDescriptor": {"topologyIntent": "细耳机线在显示器右侧盘绕后落到桌面。", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.0015, "segments": 2}, "deformationStack": [], "uvStrategy": "per-component UV with world-scale texel intent", "normalStrategy": "computed vertex normals; material normal map for micro relief"}, "parent": "wireHarness", "attachment": null, "dimensions": {"width": 0.004, "height": 0.004, "depth": 0.16, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.55, 0.01, -0.05], "rotation": [0.0, -0.5, 0.0]}, "actionProfile": {"animationRole": "earphoneLead-pivot", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.16], "isTrigger": false, "notes": "运行时交互/碰撞代理。"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "earphoneLead-pivot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "metalDark"}}, "material": "monitorPlastic", "materialLayers": ["monitorPlastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.62, "bumpAmplitude": 0.001, "normalPattern": "reference-derived", "displacementPattern": "none", "occlusionPattern": "contact AO", "edgeWearPattern": "narrow edge highlight", "notes": "由材质贴图与几何倒角共同表达。"}, "evidenceRefs": ["desk-details"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 19, 21, 1.0)", "secondaryAlbedo": "rgba(45, 48, 51, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_earphoneLead_83.add(mesh_earphoneLead_83);
  meshes["earphoneLead"] = mesh_earphoneLead_83;
  colliders["earphoneLead"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.004, 0.004, 0.16], "isTrigger": false, "notes": "运行时交互/碰撞代理。"};
  destructionGroups["earphoneLead-pivot"] ??= [];
  destructionGroups["earphoneLead-pivot"].push(node_earphoneLead_83);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "单视图参考像素提取是估计，不是精确逆渲染；5 个主材质裁剪以 0.761–0.86 置信度通过，玻璃与金属使用程序化物理响应。"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createOfficeCubicleWorkstationDioramaLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Office Cubicle Workstation Diorama look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: 顶部偏左前的办公室顶灯，色温约 5000 K，柔光、阴影半影宽；相对强度 2.4–2.8，自相机左上方 35° 入射。", "Fill light: 右侧磨砂玻璃透入的冷白日光，约 6500 K，强度 0.35–0.45，压低阴影对比并照亮显示器右缘。", "Rim/environment: 相机后方与桌下提供低强度中性反弹，环境贴图等级 0.8；屏幕蓝光作为局部彩色光源。", "Exposure: 0.15–0.25 EV，ACESFilmic tone mapping，sRGB 输出；背景为浅暖灰渐变，避免纯白吹高。", "Contact shadow: 所有落地/落桌部件使用 4K PCF 软阴影 + 材质 AO；显示器底座、杯垫、键盘脚与鼠标脚下需可见接触暗部。"];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "单视图参考像素提取是估计，不是精确逆渲染；5 个主材质裁剪以 0.761–0.86 置信度通过，玻璃与金属使用程序化物理响应。"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createOfficeCubicleWorkstationDioramaEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameOfficeCubicleWorkstationDioramaCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createOfficeCubicleWorkstationDioramaPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureOfficeCubicleWorkstationDioramaRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createOfficeCubicleWorkstationDioramaInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
