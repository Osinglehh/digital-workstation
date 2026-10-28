import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { RgbMode, ScreenContent } from './ui/types';

type Runtime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type LidState = {
  group: THREE.Group;
  targetClosed: number;
  closed: number;
  openTilt: number;
  closedAngle: number;
  fromClosed: number;
  animStart: number;
  duration: number;
};

type LaptopKeySpec = {
  u: number;
  row: number;
  w: number;
  h: number;
  label: string;
  modifier: boolean;
};
type ScreenState = {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  kind: 'laptop' | 'monitor';
  power: boolean;
  nextClock: number;
};

const woodPalette = ['#BCA079', '#AD926C', '#CBB28C', '#9A815C', '#D6C3A0'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function makeTexture(canvas: HTMLCanvasElement, colorSpace = THREE.SRGBColorSpace): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawRoundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawWoodTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 1024);
  const rand = rng(4815);
  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#DBC6A6');
  grad.addColorStop(0.5, '#D5BF9E');
  grad.addColorStop(1, '#D9C3A2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  // Broad tonal bands first, then fine grain: plywood veneer reads as low-frequency
  // colour ribbons with a much finer fibre line on top.
  for (let i = 0; i < 26; i += 1) {
    const y = rand() * 1024;
    const h = 8 + rand() * 46;
    ctx.fillStyle = rand() > 0.5 ? '#CDB48F' : '#E6D6BD';
    ctx.globalAlpha = 0.03 + rand() * 0.05;
    ctx.fillRect(0, y, 1024, h);
  }
  for (let i = 0; i < 760; i += 1) {
    const y = rand() * 1024;
    const amp = 0.3 + rand() * 1.1;
    const freq = 0.002 + rand() * 0.005;
    const phase = rand() * Math.PI * 2;
    ctx.beginPath();
    for (let x = -10; x <= 1034; x += 12) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === -10) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = woodPalette[Math.floor(rand() * woodPalette.length)];
    ctx.globalAlpha = 0.05 + rand() * 0.1;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.stroke();
  }
  for (let i = 0; i < 9000; i += 1) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    ctx.fillStyle = rand() > 0.55 ? '#A68A64' : '#EDE0C9';
    ctx.globalAlpha = 0.025 + rand() * 0.045;
    ctx.fillRect(x, y, 0.8 + rand() * 2.2, 0.5 + rand() * 1.1);
  }
  ctx.globalAlpha = 1;
  const texture = makeTexture(canvas);
  texture.repeat.set(1.15, 1.15);
  return texture;
}

function drawFabricTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 512);
  const rand = rng(8821);
  ctx.fillStyle = '#A7ABAA';
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 13000; i += 1) {
    const x = rand() * 1024;
    const y = rand() * 512;
    ctx.fillStyle = rand() > 0.5 ? '#8F9492' : '#C0C4C2';
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  for (let i = 0; i < 700; i += 1) {
    const x = rand() * 1024;
    const y = rand() * 512;
    ctx.strokeStyle = '#7B807F';
    ctx.globalAlpha = 0.05 + rand() * 0.08;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + rand() * 30, y + rand() * 2 - 1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = makeTexture(canvas);
  texture.repeat.set(1.6, 1.6);
  return texture;
}

function surfaceTexture(kind: 'wood' | 'fabric' | 'metal' | 'frost' | 'micro', size = 512, repeat = 2): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = rng(kind === 'wood' ? 661 : kind === 'fabric' ? 662 : kind === 'metal' ? 663 : kind === 'frost' ? 664 : 665);
  const base = kind === 'metal' ? 120 : kind === 'frost' ? 186 : kind === 'fabric' ? 150 : 176;
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  if (kind === 'wood') {
    for (let i = 0; i < 220; i += 1) {
      const y = rand() * size;
      const amp = 1 + rand() * 5;
      const freq = 0.004 + rand() * 0.012;
      const phase = rand() * Math.PI * 2;
      ctx.beginPath();
      for (let x = -10; x <= size + 10; x += 8) {
        const yy = y + Math.sin(x * freq + phase) * amp;
        if (x === -10) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      const v = 115 + Math.floor(rand() * 55);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.08 + rand() * 0.16})`;
      ctx.lineWidth = 0.6 + rand() * 2.4;
      ctx.stroke();
    }
  } else if (kind === 'fabric') {
    for (let y = 0; y < size; y += 3) {
      ctx.fillStyle = `rgba(${110 + Math.floor(rand() * 45)},${110 + Math.floor(rand() * 45)},${110 + Math.floor(rand() * 45)},0.16)`;
      ctx.fillRect(0, y, size, 1);
    }
    for (let x = 0; x < size; x += 4) {
      ctx.fillStyle = `rgba(${130 + Math.floor(rand() * 50)},${130 + Math.floor(rand() * 50)},${130 + Math.floor(rand() * 50)},0.1)`;
      ctx.fillRect(x, 0, 1, size);
    }
    for (let i = 0; i < 9000; i += 1) {
      const v = 55 + Math.floor(rand() * 120);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rand() * 0.12})`;
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    }
  } else if (kind === 'metal') {
    for (let i = 0; i < 900; i += 1) {
      const x = rand() * size;
      const v = 90 + Math.floor(rand() * 100);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.06 + rand() * 0.12})`;
      ctx.lineWidth = 0.5 + rand() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rand() - 0.5) * 2, size);
      ctx.stroke();
    }
  } else if (kind === 'frost') {
    for (let i = 0; i < 1100; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 2 + rand() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(230,235,232,${0.05 + rand() * 0.1})`);
      g.addColorStop(1, 'rgba(230,235,232,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 18000; i += 1) {
      const v = 80 + Math.floor(rand() * 110);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rand() * 0.16})`;
      ctx.fillRect(rand() * size, rand() * size, 0.7 + rand() * 1.6, 0.7 + rand() * 1.6);
    }
  }
  const texture = makeTexture(canvas, THREE.NoColorSpace);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

function surfaceRoughness(kind: 'wood' | 'fabric' | 'metal' | 'frost' | 'micro', size = 512, repeat = 2, level = 0.82): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = rng(kind === 'wood' ? 771 : kind === 'fabric' ? 772 : kind === 'metal' ? 773 : kind === 'frost' ? 774 : 775);
  const base = Math.floor(255 * level);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  const strokes = kind === 'metal' ? 550 : kind === 'fabric' ? 760 : 460;
  for (let i = 0; i < strokes; i += 1) {
    const v = Math.floor(150 + rand() * 100);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.06 + rand() * 0.14})`;
    ctx.lineWidth = 0.5 + rand() * 2.2;
    ctx.beginPath();
    if (kind === 'wood') {
      const y = rand() * size;
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rand() - 0.5) * 12);
    } else if (kind === 'metal') {
      const x = rand() * size;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
    } else {
      const x = rand() * size;
      const y = rand() * size;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 10, y + (rand() - 0.5) * 10);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 9000; i += 1) {
    const v = 135 + Math.floor(rand() * 105);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rand() * 0.12})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  const texture = makeTexture(canvas, THREE.NoColorSpace);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

function applySurfaceMaps(material: THREE.MeshPhysicalMaterial, kind: 'wood' | 'fabric' | 'metal' | 'frost' | 'micro', bumpScale: number, repeat = 2, roughness = 0.82): void {
  material.bumpMap = surfaceTexture(kind, 512, repeat);
  material.bumpScale = bumpScale;
  material.roughnessMap = surfaceRoughness(kind, 512, repeat, roughness);
  material.needsUpdate = true;
}

function drawContactShadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 124);
  g.addColorStop(0, 'rgba(24,20,16,0.52)');
  g.addColorStop(0.32, 'rgba(24,20,16,0.36)');
  g.addColorStop(0.72, 'rgba(24,20,16,0.12)');
  g.addColorStop(1, 'rgba(24,20,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return makeTexture(canvas);
}

function drawRgbGlowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 160);
  ctx.clearRect(0, 0, 256, 160);
  ctx.save();
  ctx.translate(128, 80);
  ctx.scale(1, 0.62);
  const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 126);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.76, 'rgba(255,255,255,0.11)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function drawScreenReflectionTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.035)');
  g.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const shine = ctx.createLinearGradient(0, 0, 512, 0);
  shine.addColorStop(0, 'rgba(255,255,255,0)');
  shine.addColorStop(0.48, 'rgba(255,255,255,0.07)');
  shine.addColorStop(0.56, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, 512, 512);
  return makeTexture(canvas);
}

function drawLidRingTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  const rand = rng(9021);
  ctx.fillStyle = '#7A563F';
  ctx.fillRect(0, 0, 512, 512);
  for (let r = 10; r < 430; r += 7 + rand() * 9) {
    const cx = 256 + (rand() - 0.5) * 12;
    const cy = 256 + (rand() - 0.5) * 12;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.86 + rand() * 0.12), rand() * 0.3, 0, Math.PI * 2);
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(52,32,20,0.3)' : 'rgba(160,120,90,0.24)';
    ctx.lineWidth = 1 + rand() * 2.4;
    ctx.stroke();
  }
  for (let i = 0; i < 4200; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(48,29,18,0.12)' : 'rgba(172,132,100,0.1)';
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 0.6 + rand() * 1.2);
  }
  return makeTexture(canvas);
}

function drawGlassHighlightTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 512);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.34, 'rgba(255,255,255,0.14)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 512);
  const fade = ctx.createLinearGradient(0, 0, 0, 512);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.16, 'rgba(0,0,0,0)');
  fade.addColorStop(0.8, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 512);
  ctx.globalCompositeOperation = 'source-over';
  return makeTexture(canvas);
}

// The reference tumbler is a straight clear-glass beaker with a dark walnut lid and
// D-grip. The generated closed lathe reads as a milky shell under real-time
// transmission, so the display mug is rebuilt from open shells and an opaque tea volume.
function buildGlassMug(mug: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'displayMug';
  mug.add(group);

  const glass = new THREE.MeshPhysicalMaterial({
    color: '#F4F8F5', metalness: 0.0, roughness: 0.035, ior: 1.5,
    transparent: true, opacity: 0.05, depthWrite: false,
    clearcoat: 0.08, clearcoatRoughness: 0.04, envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
  const glassEdge = new THREE.MeshBasicMaterial({
    color: '#F8FCF9', transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false,
  });
  // 厚玻璃杯底带一点冷绿，和透明杯壁拉开层次。
  const glassBase = new THREE.MeshPhysicalMaterial({
    color: '#DCE9E2', metalness: 0.0, roughness: 0.06,
    transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide,
  });

  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.0433, 0.0416, 0.130, 64, 1, true), glass);
  wall.renderOrder = 3;
  group.add(wall);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.0416, 0.0416, 0.008, 64), glassBase);
  bottom.position.y = -0.061;
  bottom.renderOrder = 3;
  group.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0424, 0.0007, 8, 72), glassEdge);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.0648;
  rim.renderOrder = 4;
  group.add(rim);
  const foot = new THREE.Mesh(new THREE.TorusGeometry(0.0412, 0.0013, 8, 72), glassEdge);
  foot.rotation.x = Math.PI / 2;
  foot.position.y = -0.0642;
  foot.renderOrder = 4;
  group.add(foot);

  // Dark, dense tea reads nearly unlit in the reference; a lit PBR volume kept
  // picking up the key light and turning grey, so the body is deliberately flat.
  const teaBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0397, 0.0384, 0.0855, 64),
    new THREE.MeshBasicMaterial({ color: '#150803', toneMapped: false }),
  );
  teaBody.position.y = -0.0142;
  teaBody.renderOrder = 1;
  group.add(teaBody);
  const teaSurface = new THREE.Mesh(
    new THREE.CircleGeometry(0.0397, 64),
    new THREE.MeshBasicMaterial({ color: '#1E0C06', toneMapped: false }),
  );
  teaSurface.rotation.x = -Math.PI / 2;
  teaSurface.position.y = 0.0285;
  teaSurface.renderOrder = 2;
  group.add(teaSurface);
  addDecal(group, drawScreenReflectionTexture(), 0.05, 0.034,
    [0.012, 0.0288, 0.0], [-Math.PI / 2, 0, 0.5], 0.22, 4);
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(0.0396, 0.0005, 6, 72),
    new THREE.MeshBasicMaterial({ color: '#3C1B0D', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }),
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.position.y = 0.0286;
  meniscus.renderOrder = 4;
  group.add(meniscus);

  const lid = new THREE.Group();
  lid.position.y = 0.0705;
  const lidWood = new THREE.MeshPhysicalMaterial({
    color: '#6E4B36', roughness: 0.5, metalness: 0.0, clearcoat: 0.08,
    clearcoatRoughness: 0.4, envMapIntensity: 0.55,
  });
  const lidBody = new THREE.Mesh(new THREE.CylinderGeometry(0.0461, 0.0453, 0.012, 64), lidWood);
  lidBody.castShadow = true;
  lidBody.receiveShadow = true;
  lid.add(lidBody);
  const lidTop = new THREE.Mesh(
    new THREE.CircleGeometry(0.0452, 64),
    new THREE.MeshPhysicalMaterial({
      map: drawLidRingTexture(), color: '#F2E7DC', roughness: 0.52, clearcoat: 0.06,
      clearcoatRoughness: 0.4, envMapIntensity: 0.55,
    }),
  );
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.0061;
  lid.add(lidTop);
  const lidBevel = new THREE.Mesh(
    new THREE.TorusGeometry(0.0455, 0.0012, 8, 72),
    new THREE.MeshPhysicalMaterial({ color: '#4B2F20', roughness: 0.5, clearcoat: 0.05 }),
  );
  lidBevel.rotation.x = Math.PI / 2;
  lidBevel.position.y = 0.0058;
  lid.add(lidBevel);
  const knobNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0058, 0.004, 24), lidWood);
  knobNeck.position.y = 0.0085;
  lid.add(knobNeck);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0104, 28, 18), lidWood);
  // 参考中的提钮是扁平的木片，不是圆球。
  knob.scale.y = 0.46;
  knob.position.y = 0.0128;
  knob.castShadow = true;
  lid.add(knob);
  group.add(lid);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0094, 16, 56, Math.PI), lidWood);
  handle.position.set(0.0475, 0.002, 0);
  handle.rotation.z = -Math.PI / 2;
  // 木柄是扁的 D 形截面，压薄厚度以贴近参考。
  handle.scale.set(1, 1, 0.78);
  handle.castShadow = true;
  group.add(handle);

  const highlightTex = drawGlassHighlightTexture();
  const highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0105, 0.1),
    new THREE.MeshBasicMaterial({ map: highlightTex, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }),
  );
  highlight.position.set(-0.0105, 0.004, 0.0438);
  highlight.renderOrder = 6;
  group.add(highlight);
  const highlight2 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.004, 0.092),
    new THREE.MeshBasicMaterial({ map: highlightTex, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
  );
  highlight2.position.set(0.0185, 0.0, 0.0434);
  highlight2.rotation.z = 0.015;
  highlight2.renderOrder = 6;
  group.add(highlight2);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(0.155, 0.155),
    new THREE.MeshBasicMaterial({
      map: drawContactShadowTexture(), transparent: true, opacity: 0.8,
      depthWrite: false, toneMapped: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0.006, -0.0619, 0.002);
  contact.renderOrder = 2;
  group.add(contact);

  // 参考照片中的玻璃杯更矮；以杯底为基准整体压低，杯径与桌面落点保持不变。
  const mugHeightScale = 0.81;
  group.scale.y = mugHeightScale;
  group.position.y = -0.065 * (1 - mugHeightScale);

  return lid;
}

function drawSmokeTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(245,250,247,0.55)');
  grad.addColorStop(0.4, 'rgba(238,244,240,0.22)');
  grad.addColorStop(1, 'rgba(238,244,240,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return makeTexture(canvas);
}

function wallpaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#0A2050');
  base.addColorStop(0.55, '#124089');
  base.addColorStop(1, '#0C2459');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const ribbons = [
    { x: -0.12 * w, y: 0.58 * h, c1: '#1668FF', c2: '#41E4FF', w: 0.16 * w, amp: 0.19 * h, phase: 0.2 },
    { x: 0.14 * w, y: 0.37 * h, c1: '#1450FF', c2: '#39C8FF', w: 0.11 * w, amp: 0.13 * h, phase: 2.1 },
    { x: 0.48 * w, y: 0.7 * h, c1: '#1A49E0', c2: '#63F0FF', w: 0.08 * w, amp: 0.1 * h, phase: 4.2 },
  ];
  for (const r of ribbons) {
    ctx.beginPath();
    ctx.moveTo(r.x, h);
    ctx.bezierCurveTo(r.x + 0.06 * w, r.y + r.amp, r.x + 0.29 * w, r.y - r.amp, r.x + 0.5 * w, r.y + r.amp * 0.2);
    ctx.bezierCurveTo(r.x + 0.7 * w, r.y + r.amp * 0.6, r.x + 0.86 * w, r.y - r.amp * 0.3, w + 40, r.y + r.amp * 0.6);
    ctx.lineTo(w + 40, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, r.y - r.amp, 0, h);
    g.addColorStop(0, r.c2);
    g.addColorStop(0.45, r.c1);
    g.addColorStop(1, '#06122D');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.72;
    ctx.fill();
    ctx.strokeStyle = r.c2;
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = 3;
    for (let k = 1; k <= 5; k += 1) {
      ctx.beginPath();
      ctx.moveTo(r.x + k * 8, h);
      ctx.bezierCurveTo(r.x + 0.1 * w, r.y - r.amp * 0.7 + k * 7, r.x + 0.34 * w, r.y + r.amp * 0.5 + k * 5, r.x + 0.56 * w, r.y + r.amp * 0.15);
      ctx.stroke();
    }
  }
  ctx.restore();
  const vignette = ctx.createRadialGradient(w * 0.55, h * 0.48, h * 0.08, w * 0.55, h * 0.5, w * 0.8);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(180,215,255,0.06)';
  for (let i = 0; i < 40; i += 1) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

function drawTaskbar(ctx: CanvasRenderingContext2D, w: number, h: number, scale = 1): void {
  const barH = 42 * scale;
  ctx.fillStyle = 'rgba(9, 17, 35, 0.84)';
  ctx.fillRect(0, h - barH, w, barH);
  ctx.strokeStyle = 'rgba(175, 205, 255, 0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - barH);
  ctx.lineTo(w, h - barH);
  ctx.stroke();
  const iconY = h - barH / 2;
  ctx.fillStyle = '#53a6ff';
  ctx.beginPath();
  ctx.roundRect(22 * scale, iconY - 12 * scale, 24 * scale, 24 * scale, 6 * scale);
  ctx.fill();
  ctx.fillStyle = '#0b1a36';
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect((25 + (i % 2) * 8) * scale, (iconY - 9 + Math.floor(i / 2) * 8) * scale, 6 * scale, 6 * scale);
  }
  const cols = ['#f0b85e', '#5ec6b0', '#6d8ff5', '#e18f66', '#d7d7d7'];
  for (let i = 0; i < 6; i += 1) {
    drawRoundedBox(ctx, (58 + i * 34) * scale, iconY - 10 * scale, 20 * scale, 20 * scale, 5 * scale, cols[i % cols.length]);
  }
  ctx.font = `500 ${10 * scale}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = 'rgba(230,238,250,0.8)';
  ctx.textAlign = 'right';
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  ctx.fillText(time, w - 14 * scale, h - 24 * scale);
  ctx.fillStyle = 'rgba(185,202,224,0.62)';
  ctx.fillText(date, w - 14 * scale, h - 10 * scale);
  ctx.textAlign = 'left';
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, scale = 1): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 24 * scale;
  drawRoundedBox(ctx, x, y, w, h, 8 * scale, 'rgba(21,24,31,0.94)');
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  roundedRectPath(ctx, x, y, w, h, 8 * scale);
  ctx.stroke();
  ctx.fillStyle = 'rgba(36,40,49,0.96)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 28 * scale, [8 * scale, 8 * scale, 0, 0]);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,235,242,0.68)';
  ctx.font = `500 ${11 * scale}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillText(title, x + 14 * scale, y + 18 * scale);
  ctx.fillStyle = 'rgba(225,231,240,0.46)';
  ['–', '▢', '×'].forEach((ch, i) => {
    ctx.fillText(ch, x + w - (50 - i * 17) * scale, y + 18 * scale);
  });
}

function drawDashboardLaptop(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const w = canvas.width;
  const h = canvas.height;
  wallpaper(ctx, w, h);
  const icons = [
    ['此电脑', '#59a7e8'], ['回收站', '#8a98a8'], ['Terminal', '#2b3138'], ['Code', '#3f78b9'],
    ['Blender', '#dd7d3f'], ['Docs', '#d8d8d8'], ['Qoder', '#486eb9'], ['Model', '#7796b8'],
    ['GPU', '#66b06b'], ['Notes', '#e0b75e'], ['Assets', '#ad86c4'], ['Render', '#d47871'],
  ];
  ctx.font = '500 10px "Segoe UI", "Microsoft YaHei", sans-serif';
  for (let i = 0; i < 20; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 30 + col * 68;
    const y = 38 + row * 43;
    const [label, color] = icons[i % icons.length];
    drawRoundedBox(ctx, x, y, 23, 23, 5, color);
    ctx.fillStyle = 'rgba(235,242,252,0.8)';
    ctx.globalAlpha = 0.7;
    ctx.fillText(label, x - 2, y + 34);
    ctx.globalAlpha = 1;
  }

  drawWindow(ctx, 245, 98, 520, 350, 'C:\\Users\\26922 — Windows PowerShell', 1.05);
  ctx.save();
  ctx.beginPath();
  ctx.rect(245, 126, 520, 322);
  ctx.clip();
  ctx.font = '500 11px Consolas, "Cascadia Mono", monospace';
  const lines = [
    'PS C:\\Users\\26922> npm install -g @qoder/cli',
    'added 128 packages in 14s',
    'PS C:\\Users\\26922> img2 add img2threejs/plugin-character --ref v1.5',
    '✓ plugin-character installed',
    'PS C:\\Users\\26922> python forge/next.py --state .img2threejs/state.json',
    'STATE status=active step=form-refinement pass=form-refinement',
    'PASS structural  complete',
    'PASS form       in review',
    'PASS material   locked',
    '',
    'PS C:\\Users\\26922> node runtime/scripts/export_mesh_geometry.mjs',
    'exported 82 components · 121420 triangles',
    'gates: turntable 4/4 · attachment 12/12 · self-intersection clean',
    '',
    'PS C:\\Users\\26922> █',
  ];
  lines.forEach((line, i) => {
    ctx.fillStyle = line.startsWith('✓') ? '#7ddca4' : line.startsWith('PASS') ? '#87b9ff' : 'rgba(220,230,240,0.78)';
    ctx.fillText(line, 260, 158 + i * 18);
  });
  ctx.fillStyle = '#49d4ff';
  ctx.fillRect(260, 158 + lines.length * 18 - 12, 7, 12);
  ctx.restore();
  drawTaskbar(ctx, w, h, 1);
}

function drawDashboardMonitor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const w = canvas.width;
  const h = canvas.height;
  wallpaper(ctx, w, h);
  ctx.fillStyle = 'rgba(10, 18, 34, 0.18)';
  ctx.fillRect(0, 0, w, h);
  // A few desktop icons stay visible left of the review window, as on the photo's monitor.
  ctx.font = '500 11px "Segoe UI", "Microsoft YaHei", sans-serif';
  [['工作区', '#59a7e8'], ['渲染', '#d58a4a'], ['终端', '#333b42'], ['资料', '#d7c9a8']].forEach(([label, color], i) => {
    drawRoundedBox(ctx, 38, 52 + i * 66, 24, 24, 5, color);
    ctx.fillStyle = 'rgba(235,242,252,0.72)';
    ctx.fillText(label, 30, 96 + i * 66);
  });
  drawWindow(ctx, 205, 100, 930, 466, '工作位数字孪生 · 规格评审', 1.25);
  const x = 205;
  const y = 100;
  const sidebarW = 210 * 1.25;
  ctx.fillStyle = 'rgba(43,48,59,0.8)';
  ctx.fillRect(x, y + 35, sidebarW, 466 - 35);
  ctx.fillStyle = 'rgba(196,210,230,0.65)';
  ctx.font = '500 14px "Microsoft YaHei", "Segoe UI", sans-serif';
  const nav = ['新的任务', '搜索', '自动化', '工作区', '毕业设计 - 工作位孪生', 'img2threejs 插件', '渲染队列 ✓', '交互与动效'];
  nav.forEach((item, i) => {
    if (i === 4) {
      ctx.fillStyle = 'rgba(65,92,150,0.72)';
      ctx.fillRect(x + 10, y + 50 + i * 38, sidebarW - 20, 28);
      ctx.fillStyle = 'rgba(247,250,255,0.94)';
    } else {
      ctx.fillStyle = 'rgba(188,203,222,0.62)';
    }
    ctx.fillText(item, x + 24, y + 69 + i * 38);
  });
  ctx.fillStyle = 'rgba(240,246,255,0.92)';
  ctx.font = '600 23px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText('工作位数字孪生', x + 270, y + 78);
  ctx.font = '500 13px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(171,191,218,0.75)';
  ctx.fillText('可动画 · 程序化 · 参考重构', x + 270, y + 102);
  const columns = [
    ['目标与约束', '· 以四张参考图锁定布局', '· 桌面 1050×500 mm', '· 23.8 英寸 AOC + 16 英寸笔记本', '· 隐藏背面按常见结构补全', '· 不追求逐字复刻 UI'],
    ['几何层级', '· 隔断/桌面/书架为建筑层', '· 设备为可动电子层', '· 98 键 InstancedMesh', '· 线缆 Catmull-Rom 管', '· 书脊/缝线实例化'],
    ['视觉门禁', '· 正面、左右 3/4、俯视', '· 自相交与装配锚点', '· 参考 PBR 提取 ≥ 0.7', '· 关键特征独立评分', '· 每轮仅修正一个组'],
  ];
  columns.forEach((col, i) => {
    const cx = x + 270 + i * 285;
    ctx.fillStyle = 'rgba(147,194,255,0.76)';
    ctx.font = '600 13px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillText(col[0], cx, y + 150);
    ctx.fillStyle = 'rgba(200,213,230,0.68)';
    ctx.font = '500 12px "Microsoft YaHei", "Segoe UI", sans-serif';
    for (let j = 1; j < col.length; j += 1) {
      ctx.fillText(col[j], cx, y + 178 + (j - 1) * 27);
    }
  });
  ctx.strokeStyle = 'rgba(92,134,205,0.34)';
  ctx.beginPath();
  ctx.moveTo(x + 270, y + 124);
  ctx.lineTo(x + 900, y + 124);
  ctx.stroke();
  ctx.fillStyle = 'rgba(212,225,242,0.46)';
  ctx.font = '400 11px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText('渲染预览 · 1280×720 · ACESFilmic · 参考相机 42°', x + 270, y + 410);
  drawRoundedBox(ctx, x + 270, y + 430, 120, 24, 6, 'rgba(58,111,185,0.75)');
  ctx.fillStyle = '#eef6ff';
  ctx.font = '600 11px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText('开始校验', x + 289, y + 446);
  drawTaskbar(ctx, w, h, 1.0);
}


// 双屏内容：仪表盘 / 代码 / 终端 / 桌面 / 专注。绘制函数只读写自己的 Canvas，
// 每秒刷新一次，不产生额外的 Three.js 材质或纹理。
type ScreenKind = 'laptop' | 'monitor';
let activeScreenContent: ScreenContent = 'dashboard';

const CODE_KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'var', 'function', 'return', 'type',
  'interface', 'new', 'if', 'else', 'for', 'while', 'true', 'false', 'null',
  'undefined', 'await', 'async', 'class', 'of', 'in',
]);
const CODE_TOKEN_RE = /(\/\/[^\n]*|'[^']*'|"[^"]*"|`[^`]*`|\b(?:import|from|export|const|let|var|function|return|type|interface|new|if|else|for|while|true|false|null|undefined|await|async|class|of|in)\b|\b\d+(?:\.\d+)?\b)/g;

function screenFont(size: number, weight = 500): string {
  return `${weight} ${size}px Consolas, "Cascadia Mono", "Microsoft YaHei", monospace`;
}

function codeTokenColor(token: string): string {
  if (token.startsWith('//')) return '#6A9955';
  if (/^['"`]/.test(token)) return '#CE9178';
  if (CODE_KEYWORDS.has(token)) {
    if (['import', 'from', 'export', 'return', 'new'].includes(token)) return '#C586C0';
    return '#569CD6';
  }
  if (/^\d/.test(token)) return '#B5CEA8';
  return '#D4D4D4';
}

function drawCodeLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  line: string,
): number {
  let cursor = x;
  const parts = line.split(CODE_TOKEN_RE);
  for (const part of parts) {
    if (!part) continue;
    ctx.fillStyle = codeTokenColor(part);
    ctx.fillText(part, cursor, y);
    cursor += ctx.measureText(part).width;
  }
  return cursor;
}

function drawCodeScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: ScreenKind): void {
  const w = canvas.width;
  const h = canvas.height;
  const compact = kind === 'laptop';
  const topH = Math.round(h * 0.05);
  const statusH = Math.round(h * 0.038);
  const activityW = compact ? 0 : Math.round(w * 0.036);
  const sideW = compact ? 0 : Math.round(w * 0.15);
  const gap = compact ? 14 : 18;
  const lineNoW = compact ? 22 : 26;
  const codeX = activityW + sideW + gap + lineNoW;
  const codeRight = w - (compact ? 16 : Math.round(w * 0.075) + 18);

  ctx.fillStyle = '#0B0F14';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#10151C';
  ctx.fillRect(0, 0, w, topH);
  const dots = ['#FF5F57', '#FEBC2E', '#28C840'];
  dots.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(18 + i * 15, topH / 2, 4.2, 0, Math.PI * 2);
    ctx.fill();
  });
  const tabs = compact ? ['workstation.ts', 'main.ts'] : ['workstation.ts', 'main.ts', 'controlPanel.ts', 'types.ts'];
  let tabX = compact ? 70 : 82;
  ctx.textBaseline = 'middle';
  ctx.font = screenFont(compact ? 10.5 : 11.5);
  tabs.forEach((tab, i) => {
    const tabW = ctx.measureText(tab).width + (compact ? 26 : 30);
    if (i === 0) {
      ctx.fillStyle = '#0B0F14';
      ctx.fillRect(tabX, 0, tabW, topH);
      ctx.fillStyle = '#4FA3A0';
      ctx.fillRect(tabX, 0, tabW, 2);
      ctx.fillStyle = '#E6EDF3';
    } else {
      ctx.fillStyle = '#7D8590';
    }
    ctx.fillText(tab, tabX + 13, topH / 2 + 1);
    tabX += tabW;
  });
  ctx.fillStyle = '#0B0F14';
  ctx.fillRect(0, topH, w, 2);

  if (!compact) {
    ctx.fillStyle = '#0D1218';
    ctx.fillRect(0, topH, activityW, h - topH - statusH);
    const iconsY = topH + 34;
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = i === 0 ? 'rgba(122, 214, 200, 0.85)' : 'rgba(160, 172, 186, 0.32)';
      ctx.beginPath();
      ctx.roundRect(activityW / 2 - 8, iconsY + i * 40, 16, 16, 4);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(122, 214, 200, 0.9)';
    ctx.fillRect(0, topH, 2, h - topH - statusH);
  }

  if (!compact) {
    ctx.fillStyle = '#0E131A';
    ctx.fillRect(activityW, topH, sideW, h - topH - statusH);
    ctx.fillStyle = '#8B949E';
    ctx.font = screenFont(10.5);
    ctx.fillText('资源管理器', activityW + 16, topH + 26);
    const tree: Array<[string, number, string]> = [
      ['▾ src', 0, '#C9D1D9'],
      ['  workstation.ts', 1, '#E6EDF3'],
      ['  main.ts', 1, '#9DA7B3'],
      ['  ui', 1, '#C9D1D9'],
      ['    controlPanel.ts', 2, '#8B949E'],
      ['    types.ts', 2, '#8B949E'],
      ['  object-sculpt-spec.json', 1, '#8B949E'],
      ['▸ tools', 0, '#8B949E'],
      ['▸ analysis', 0, '#8B949E'],
    ];
    tree.forEach(([label, indent, color], i) => {
      const y = topH + 52 + i * 23;
      if (i === 1) {
        ctx.fillStyle = 'rgba(79, 163, 160, 0.18)';
        ctx.fillRect(activityW + 8, y - 11, sideW - 16, 22);
        ctx.fillStyle = '#4FA3A0';
        ctx.fillRect(activityW + 8, y - 11, 2, 22);
      }
      ctx.fillStyle = color;
      ctx.font = screenFont(10.5);
      ctx.fillText(label, activityW + 18 + indent * 9, y);
    });
    ctx.fillStyle = 'rgba(139, 148, 158, 0.2)';
    ctx.fillRect(activityW + sideW - 1, topH, 1, h - topH - statusH);
    ctx.fillStyle = '#7D8590';
    ctx.font = screenFont(10);
    ctx.fillText('src  ›  workstation.ts  ›  applyPreset', activityW + sideW + 18, topH + 28);
  }

  const codeLines = [
    "import * as THREE from 'three';",
    "import { ControlPanel } from './ui/controlPanel';",
    '',
    "type ViewId = 'overview' | 'seated' | 'monitor';",
    "type RgbMode = 'rainbow' | 'static' | 'breathe' | 'soft';",
    '',
    'const panel = new ControlPanel(stage, {',
    '  views: [overview, seated, monitor],',
    "  rgbColors: ['#2BD8FF', '#FFD9A0'],",
    "  persist: 'workstation-ui-v1',",
    '});',
    '',
    'export function applyPreset(scene: SceneId) {',
    '  const preset = PRESETS[scene];',
    '  lighting.set(preset.lighting);',
    '  panel.setScene(scene);',
    '',
    '  // 统一状态源，避免相机、灯光与 UI 互相覆盖。',
    '  state.scene = scene;',
    "  state.view = 'overview';",
    '  savePreferences(state);',
    '}',
    '',
    'export function tick(dt: number) {',
    '  camera.update(dt);',
    '  panel.sync(state);',
    '}',
    '',
    '// 中央循环只保留一条，灯效由模式驱动。',
    'renderer.setAnimationLoop(tick);',
  ];
  const lineH = compact ? 17.5 : 19.5;
  const codeTop = topH + (compact ? 30 : 40);
  const activeLine = 17;
  const highlightTop = codeTop + activeLine * lineH - lineH / 2;
  ctx.fillStyle = 'rgba(56, 110, 120, 0.14)';
  ctx.fillRect(activityW + sideW, highlightTop, codeRight - (activityW + sideW) + 12, lineH);
  ctx.fillStyle = '#4FA3A0';
  ctx.fillRect(activityW + sideW, highlightTop, 2, lineH);

  ctx.font = screenFont(compact ? 12.5 : 14);
  ctx.textBaseline = 'middle';
  codeLines.forEach((line, i) => {
    const y = codeTop + i * lineH;
    if (y > h - statusH - lineH) return;
    ctx.fillStyle = i === activeLine ? '#5E6A76' : '#3F4954';
    ctx.font = screenFont(compact ? 9.5 : 10.5);
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), activityW + sideW + gap + lineNoW - 8, y);
    ctx.textAlign = 'left';
    ctx.font = screenFont(compact ? 12.5 : 14);
    const endX = drawCodeLine(ctx, codeX, y, line);
    if (i === activeLine) {
      ctx.fillStyle = '#C6D0DA';
      ctx.fillRect(endX + 3, y - 7, 1.6, 14);
    }
  });

  if (!compact) {
    const mapX = w - Math.round(w * 0.075) - 6;
    const mapW = Math.round(w * 0.062);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(mapX, topH + 10, mapW, h - topH - statusH - 20);
    for (let i = 0; i < codeLines.length; i += 1) {
      const line = codeLines[i];
      if (!line) continue;
      const yy = topH + 18 + i * 5.4;
      const indent = line.length - line.trimStart().length;
      ctx.fillStyle = i === activeLine ? 'rgba(122, 214, 200, 0.65)'
        : i % 5 === 0 ? 'rgba(197, 134, 192, 0.45)' : 'rgba(140, 170, 190, 0.28)';
      ctx.fillRect(mapX + 4 + indent * 0.5, yy, Math.min(mapW - 8, line.trim().length * 0.48), 1.6);
    }
  }

  ctx.fillStyle = '#0B5A4E';
  ctx.fillRect(0, h - statusH, w, statusH);
  ctx.fillStyle = 'rgba(240, 255, 250, 0.92)';
  ctx.font = screenFont(compact ? 9.5 : 10.5);
  ctx.fillText('main*', 14, h - statusH / 2);
  ctx.fillText('TypeScript', compact ? 70 : 82, h - statusH / 2);
  ctx.fillStyle = 'rgba(215, 245, 238, 0.7)';
  ctx.textAlign = 'right';
  ctx.fillText('UTF-8   ·   Prettier   ·   Ln 18, Col 24', w - 14, h - statusH / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawTerminalScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: ScreenKind): void {
  const w = canvas.width;
  const h = canvas.height;
  const compact = kind === 'laptop';
  const headerH = Math.round(h * 0.052);
  const footerH = Math.round(h * 0.036);
  ctx.fillStyle = '#0A0C0E';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#12161A';
  ctx.fillRect(0, 0, w, headerH);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(19 + i * 16, headerH / 2, 4.4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(208, 220, 230, 0.7)';
  ctx.font = screenFont(compact ? 10.5 : 11.5);
  ctx.textBaseline = 'middle';
  ctx.fillText('PowerShell  ·  127.0.0.1:5173', compact ? 80 : 92, headerH / 2 + 1);
  ctx.fillStyle = 'rgba(160, 176, 188, 0.4)';
  ctx.textAlign = 'right';
  ctx.fillText('—  □  ×', w - 18, headerH / 2 + 1);
  ctx.textAlign = 'left';

  const lines: Array<{ text: string; color: string }> = [
    { text: 'Windows PowerShell', color: 'rgba(158, 176, 190, 0.68)' },
    { text: 'Copyright (C) Microsoft Corporation. All rights reserved.', color: 'rgba(128, 144, 158, 0.56)' },
    { text: '', color: '#D4DCE5' },
    { text: 'PS D:\\play> npm run dev', color: '#E6EDF3' },
    { text: '  VITE v7.1.12  ready in 412 ms', color: '#7EDCA4' },
    { text: '  ➜  Local:   http://127.0.0.1:5173/', color: '#8FBBFF' },
    { text: '  ➜  press h + enter to show help', color: 'rgba(145, 165, 182, 0.7)' },
    { text: '', color: '#D4DCE5' },
    { text: 'PS D:\\play> npm run typecheck', color: '#E6EDF3' },
    { text: '  tsc --noEmit  ·  0 errors', color: '#7EDCA4' },
    { text: '', color: '#D4DCE5' },
    { text: 'PS D:\\play> node tools/test_interactions.mjs', color: '#E6EDF3' },
    { text: '  ✓ 笔记本开合      lidClosed=1', color: '#7EDCA4' },
    { text: '  ✓ 键盘 RGB        rainbow / static / off', color: '#7EDCA4' },
    { text: '  ✓ 双屏内容        dashboard · code · terminal', color: '#7EDCA4' },
    { text: '  ✓ 场景预设        day · night · focus · rgb', color: '#7EDCA4' },
    { text: '  errors: []', color: 'rgba(158, 176, 190, 0.72)' },
    { text: '', color: '#D4DCE5' },
    { text: 'PS D:\\play> _', color: '#E6EDF3' },
  ];

  const fontPx = compact ? 12.5 : 14.5;
  const lineH = compact ? 21 : 24;
  const startX = compact ? 22 : 34;
  const startY = headerH + (compact ? 28 : 34);
  ctx.font = screenFont(fontPx);
  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    if (y > h - footerH - 8) return;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, startX, y);
    if (i === lines.length - 1) {
      const cursorX = startX + ctx.measureText('PS D:\\play> ').width;
      ctx.fillStyle = '#57D6B3';
      ctx.fillRect(cursorX, y - fontPx * 0.7, 7, fontPx);
    }
  });

  if (!compact) {
    const cardX = w * 0.66;
    const cardY = headerH + 74;
    const cardW = w * 0.28;
    drawRoundedBox(ctx, cardX, cardY, cardW, 210, 12, 'rgba(255,255,255,0.035)');
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundedRectPath(ctx, cardX, cardY, cardW, 210, 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(154, 178, 194, 0.62)';
    ctx.font = screenFont(10.5, 600);
    ctx.fillText('SESSION', cardX + 20, cardY + 28);
    const rows: Array<[string, string]> = [
      ['Node', 'v24.18.0'],
      ['Vite', '7.1.12'],
      ['Three', 'r180'],
      ['Mode', 'development'],
      ['Renderer', 'WebGL 2'],
    ];
    rows.forEach(([key, value], i) => {
      const y = cardY + 60 + i * 28;
      ctx.fillStyle = 'rgba(140, 158, 172, 0.6)';
      ctx.font = screenFont(10.5);
      ctx.fillText(key, cardX + 20, y);
      ctx.fillStyle = 'rgba(219, 232, 240, 0.84)';
      ctx.textAlign = 'right';
      ctx.fillText(value, cardX + cardW - 20, y);
      ctx.textAlign = 'left';
    });
  }

  ctx.fillStyle = '#0F1A1E';
  ctx.fillRect(0, h - footerH, w, footerH);
  ctx.fillStyle = 'rgba(112, 201, 180, 0.78)';
  ctx.font = screenFont(9.5);
  ctx.fillText('PowerShell 7.4', 16, h - footerH / 2);
  ctx.fillStyle = 'rgba(150, 168, 180, 0.6)';
  ctx.textAlign = 'right';
  ctx.fillText('UTF-8   ·   120 × 36   ·   dev server', w - 16, h - footerH / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawDesktopScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: ScreenKind): void {
  const w = canvas.width;
  const h = canvas.height;
  const compact = kind === 'laptop';
  wallpaper(ctx, w, h);
  ctx.fillStyle = 'rgba(7, 16, 33, 0.10)';
  ctx.fillRect(0, 0, w, h);

  const desktopIcons: Array<[string, string]> = [
    ['此电脑', '#6CA9E8'],
    ['工作区', '#E3B36F'],
    ['终端', '#48535E'],
    ['代码', '#4C86C6'],
    ['渲染', '#CF835A'],
    ['资料', '#D6C9AC'],
    ['回收站', '#8E9BAA'],
    ['设置', '#7E9EBF'],
  ];
  const iconSize = compact ? 21 : 24;
  const iconGapY = compact ? 54 : 60;
  ctx.font = compact ? '500 9.5px "Segoe UI", "Microsoft YaHei", sans-serif' : '500 10.5px "Segoe UI", "Microsoft YaHei", sans-serif';
  desktopIcons.forEach(([label, color], i) => {
    const col = compact ? i % 2 : 0;
    const row = compact ? Math.floor(i / 2) : i;
    const x = (compact ? 26 : 34) + col * (compact ? 92 : 0);
    const y = (compact ? 30 : 46) + row * iconGapY;
    drawRoundedBox(ctx, x, y, iconSize, iconSize, 5, color);
    ctx.fillStyle = 'rgba(235, 242, 252, 0.78)';
    ctx.fillText(label, x - 2, y + iconSize + 14);
  });

  const cardW = compact ? w * 0.44 : w * 0.30;
  const cardH = compact ? h * 0.30 : h * 0.28;
  const cardX = w * 0.54 - cardW / 2;
  const cardY = h * 0.34;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 10, 30, 0.30)';
  ctx.shadowBlur = 34;
  drawRoundedBox(ctx, cardX, cardY, cardW, cardH, 18, 'rgba(9, 22, 45, 0.38)');
  ctx.restore();
  ctx.strokeStyle = 'rgba(198, 224, 255, 0.16)';
  ctx.lineWidth = 1;
  roundedRectPath(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.stroke();

  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  ctx.fillStyle = 'rgba(240, 248, 255, 0.94)';
  ctx.font = `300 ${compact ? 42 : 58}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(time, cardX + cardW / 2, cardY + cardH * 0.52);
  ctx.fillStyle = 'rgba(205, 226, 250, 0.76)';
  ctx.font = `${compact ? 10 : 11.5}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText(date, cardX + cardW / 2, cardY + cardH * 0.70);
  ctx.fillStyle = 'rgba(134, 205, 235, 0.82)';
  ctx.font = `${compact ? 9 : 10.5}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText('数字工位 · 双屏在线', cardX + cardW / 2, cardY + cardH * 0.86);
  ctx.textAlign = 'left';

  const pillW = compact ? 118 : 138;
  drawRoundedBox(ctx, w - pillW - 22, 20, pillW, 28, 14, 'rgba(7, 18, 40, 0.36)');
  ctx.fillStyle = 'rgba(210, 235, 255, 0.72)';
  ctx.font = `${compact ? 8.5 : 9.5}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillText('WORKSTATION · DESKTOP', w - pillW - 8, 38);

  drawTaskbar(ctx, w, h, compact ? 0.82 : 1.0);
}

function drawFocusScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: ScreenKind): void {
  const w = canvas.width;
  const h = canvas.height;
  const compact = kind === 'laptop';
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.46, h * 0.04, w * 0.5, h * 0.5, w * 0.78);
  bg.addColorStop(0, '#241C13');
  bg.addColorStop(0.55, '#17130E');
  bg.addColorStop(1, '#0D0B08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(231, 187, 128, 0.8)';
  ctx.font = `${compact ? 9.5 : 10.5}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('FOCUS SESSION', 28, 28);
  ctx.fillStyle = 'rgba(214, 198, 176, 0.38)';
  ctx.textAlign = 'right';
  ctx.fillText('减少干扰 · 保持当前任务', w - 28, 28);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(217, 187, 148, 0.14)';
  ctx.beginPath();
  ctx.moveTo(28, 46);
  ctx.lineTo(w - 28, 46);
  ctx.stroke();

  const cx = compact ? w * 0.5 : w * 0.42;
  const cy = compact ? h * 0.46 : h * 0.52;
  const radius = Math.min(w, h) * (compact ? 0.23 : 0.235);
  const progress = 0.68;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(231, 187, 128, 0.13)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#E7BB80';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  const endAngle = -Math.PI / 2 + Math.PI * 2 * progress;
  ctx.fillStyle = '#F6D8AB';
  ctx.beginPath();
  ctx.arc(cx + Math.cos(endAngle) * radius, cy + Math.sin(endAngle) * radius, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'butt';

  const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.88);
  innerGlow.addColorStop(0, 'rgba(231, 187, 128, 0.08)');
  innerGlow.addColorStop(1, 'rgba(231, 187, 128, 0)');
  ctx.fillStyle = innerGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.88, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#F5EBDD';
  ctx.font = `300 ${compact ? 44 : 54}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.fillText('25:00', cx, cy - 2);
  ctx.fillStyle = 'rgba(231, 187, 128, 0.9)';
  ctx.font = `${compact ? 10 : 11.5}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText('整理工作位交互', cx, cy + radius * 0.34);
  ctx.fillStyle = 'rgba(214, 198, 176, 0.48)';
  ctx.font = `${compact ? 9 : 10}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText('第 2 / 4 个专注周期', cx, cy + radius * 0.34 + 18);
  ctx.textAlign = 'left';

  const tasks: Array<[string, boolean]> = [
    ['检查交互入口', true],
    ['整理双屏内容', true],
    ['复核渲染截图', false],
  ];
  if (!compact) {
    const taskX = w * 0.68;
    const taskY = h * 0.31;
    const taskW = w * 0.24;
    drawRoundedBox(ctx, taskX, taskY, taskW, 222, 14, 'rgba(255, 244, 228, 0.035)');
    ctx.fillStyle = 'rgba(231, 187, 128, 0.82)';
    ctx.font = '600 10.5px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillText('今日专注', taskX + 20, taskY + 30);
    tasks.forEach(([label, done], i) => {
      const y = taskY + 66 + i * 44;
      ctx.strokeStyle = done ? 'rgba(231, 187, 128, 0.72)' : 'rgba(214, 198, 176, 0.26)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(taskX + 27, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      if (done) {
        ctx.fillStyle = 'rgba(231, 187, 128, 0.8)';
        ctx.beginPath();
        ctx.arc(taskX + 27, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = done ? 'rgba(240, 229, 213, 0.84)' : 'rgba(214, 198, 176, 0.4)';
      ctx.font = '10.5px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.fillText(label, taskX + 44, y + 1);
    });
  } else {
    const baseY = h * 0.82;
    tasks.forEach(([label, done], i) => {
      const x = 42 + i * (w - 84) / 3;
      ctx.fillStyle = done ? 'rgba(231, 187, 128, 0.86)' : 'rgba(214, 198, 176, 0.34)';
      ctx.font = '9px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.fillText(`${done ? '●' : '○'} ${label}`, x, baseY);
    });
  }

  ctx.fillStyle = 'rgba(214, 198, 176, 0.3)';
  ctx.font = `${compact ? 8.5 : 9.5}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText('FOCUS MODE · 关闭无关通知，保留屏幕与键盘照明', 28, h - 22);
  ctx.textAlign = 'right';
  const now = new Date();
  ctx.fillText(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), w - 28, h - 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawScreenByContent(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: ScreenKind): void {
  switch (activeScreenContent) {
    case 'code':
      drawCodeScreen(canvas, ctx, kind);
      break;
    case 'terminal':
      drawTerminalScreen(canvas, ctx, kind);
      break;
    case 'desktop':
      drawDesktopScreen(canvas, ctx, kind);
      break;
    case 'focus':
      drawFocusScreen(canvas, ctx, kind);
      break;
    default:
      if (kind === 'laptop') drawDashboardLaptop(canvas, ctx);
      else drawDashboardMonitor(canvas, ctx);
      break;
  }
}

function drawLaptopScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  drawScreenByContent(canvas, ctx, 'laptop');
}

function drawMonitorScreen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  drawScreenByContent(canvas, ctx, 'monitor');
}

function labelTexture(text: string, color: string, width: number, height: number, font: string, options: {
  vertical?: boolean; background?: string; align?: CanvasTextAlign;
} = {}): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(width, height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = options.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (options.vertical) {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.fillText(text, width / 2, height / 2);
  }
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function addDecal(parent: THREE.Object3D, texture: THREE.Texture, width: number, height: number,
                  position: [number, number, number], rotation: [number, number, number] = [0, 0, 0],
                  opacity = 1, renderOrder = 4): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.renderOrder = renderOrder;
  parent.add(mesh);
  return mesh;
}

function hideMesh(meshes: Record<string, THREE.Mesh>, id: string): void {
  if (meshes[id]) {
    meshes[id].visible = false;
    meshes[id].castShadow = false;
  }
}

function createLaptopScreen(root: THREE.Object3D, mesh: THREE.Mesh): ScreenState | null {
  const [canvas, ctx] = makeCanvas(1024, 640);
  drawLaptopScreen(canvas, ctx);
  const texture = makeTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, canvas, ctx, texture, kind: 'laptop', power: true, nextClock: 0 };
}

function createMonitorScreen(root: THREE.Object3D, mesh: THREE.Mesh): ScreenState | null {
  const [canvas, ctx] = makeCanvas(1280, 720);
  drawMonitorScreen(canvas, ctx);
  const texture = makeTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, canvas, ctx, texture, kind: 'monitor', power: true, nextClock: 0 };
}

function refreshScreen(screen: ScreenState): void {
  if (screen.kind === 'laptop') drawLaptopScreen(screen.canvas, screen.ctx);
  else drawMonitorScreen(screen.canvas, screen.ctx);
  screen.texture.needsUpdate = true;
}

function createKeyLayout(pivot: THREE.Object3D): {
  keys: THREE.InstancedMesh;
  spacebar: THREE.Mesh;
  underlay: THREE.Mesh;
  legends: THREE.Mesh;
  pressed: Set<number>;
  keyPositions: THREE.Vector3[];
  baseQuaternions: THREE.Quaternion[];
  baseScales: THREE.Vector3[];
  press: (index: number, travel: number) => void;
  release: (index: number) => void;
  underRainbowMap: THREE.CanvasTexture;
  underSolidMap: THREE.CanvasTexture;
} {
  const rows = 6;
  const cols = 17;
  const pitchX = 0.0212;
  const pitchZ = 0.0202;
  const keyW = 0.0198;
  const keyD = 0.0186;
  const keyH = 0.0095;
  const baseY = 0.0020;
  const labels: string[][] = [
    ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrtSc', 'Ins', 'Home', 'Del'],
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Back', 'Num', '/', '*'],
    ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'PgUp', '7', '8'],
    ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter', 'PgDn', '4', '5', '6'],
    ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift', 'Up', 'End', '1', '2', '3'],
    ['Ctrl', 'Win', 'Alt', '', '', '', '', '', 'Alt', 'Fn', 'Ctrl', 'Left', 'Down', 'Right', '0', '.', ''],
  ];
  const geometry = new RoundedBoxGeometry(keyW, keyH, keyD, 2, 0.0012);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.64, metalness: 0.02 });
  const keyBump = surfaceTexture('micro', 256, 3);
  const keyRough = surfaceRoughness('micro', 256, 3, 0.86);
  material.bumpMap = keyBump;
  material.bumpScale = 0.00006;
  material.roughnessMap = keyRough;
  material.needsUpdate = true;
  const keyPositions: THREE.Vector3[] = [];
  const baseScales: THREE.Vector3[] = [];
  const baseQuaternions: THREE.Quaternion[] = [];
  const keyTransforms: { x: number; z: number; w: number }[] = [];
  const legendLabels: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (row === rows - 1 && col >= 4 && col <= 8) continue;
      const x = (col - (cols - 1) / 2) * pitchX;
      const z = (row - (rows - 1) / 2) * pitchZ;
      keyPositions.push(new THREE.Vector3(x, baseY, z));
      baseScales.push(new THREE.Vector3(1, 1, 1));
      baseQuaternions.push(new THREE.Quaternion());
      keyTransforms.push({ x, z, w: 1 });
      legendLabels.push(labels[row][col] ?? '');
    }
  }
  // 5u spacebar replaces columns 4..8 on the bottom row.
  const spaceX = (6 - (cols - 1) / 2) * pitchX;
  const spaceZ = (rows - 1 - (rows - 1) / 2) * pitchZ;
  const spaceW = pitchX * 5 - 0.0025;
  const spaceGeometry = new RoundedBoxGeometry(keyW, keyH, keyD, 2, 0.0012);
  const spaceMesh = new THREE.Mesh(spaceGeometry, material.clone());
  const spaceMat = spaceMesh.material as THREE.MeshStandardMaterial;
  // 参考 桌面-4.jpg：空格与最前排键帽同为接近炭黑的深灰。
  spaceMat.color.set('#3F474B');
  spaceMat.bumpMap = keyBump;
  spaceMat.bumpScale = 0.00006;
  spaceMat.roughnessMap = keyRough;
  spaceMat.needsUpdate = true;
  spaceMesh.scale.x = spaceW / keyW;
  spaceMesh.position.set(spaceX, baseY - 0.0002, spaceZ);
  spaceMesh.castShadow = true;
  spaceMesh.receiveShadow = true;
  pivot.add(spaceMesh);
  keyTransforms.push({ x: spaceX, z: spaceZ, w: spaceW / keyW });
  legendLabels.push('SPACE');

  const keys = new THREE.InstancedMesh(geometry, material, keyPositions.length);
  keys.castShadow = true;
  keys.receiveShadow = true;
  const color = new THREE.Color();
  // 参考 桌面-4.jpg 的渐变键帽：F 排近白，向后逐排过渡到底排近炭黑；
  // 修饰键与同排字母键同色，靠 RGB 键缝光与字色区分层次。
  const rowColors = ['#D9DDDF', '#C5CACC', '#AAB1B4', '#8B9296', '#6B7377', '#4C5458'];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  keyPositions.forEach((position, index) => {
    const row = Math.min(rows - 1, Math.floor(index / cols));
    color.set(rowColors[row]);
    keys.setColorAt(index, color);
    matrix.compose(position, quat, new THREE.Vector3(1, 1, 1));
    keys.setMatrixAt(index, matrix);
  });
  keys.instanceMatrix.needsUpdate = true;
  if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  pivot.add(keys);

  // The RGB glow visible through the key gaps.
  const [underCanvas, underCtx] = makeCanvas(512, 160);
  const ug = underCtx.createLinearGradient(0, 0, 512, 0);
  ['#d543ff', '#4c6bff', '#23c7ff', '#26e6a8', '#f4c343', '#ff5f5f'].forEach((c, i, a) => {
    ug.addColorStop(i / (a.length - 1), c);
  });
  underCtx.fillStyle = ug;
  underCtx.fillRect(0, 0, 512, 160);
  const underTexture = makeTexture(underCanvas);

  // 单色/呼吸/柔光模式用灰度渐变贴图，再由材质 color 染色；
  // 彩虹模式保留原始彩色渐变贴图，避免被单色相乘而发灰。
  const [solidCanvas, solidCtx] = makeCanvas(512, 160);
  const solidGradient = solidCtx.createLinearGradient(0, 0, 512, 0);
  solidGradient.addColorStop(0, '#FFFFFF');
  solidGradient.addColorStop(0.5, '#ECECEC');
  solidGradient.addColorStop(1, '#DCDCDC');
  solidCtx.fillStyle = solidGradient;
  solidCtx.fillRect(0, 0, 512, 160);
  const underSolidTexture = makeTexture(solidCanvas);

  const underMaterial = new THREE.MeshBasicMaterial({
    map: underTexture, transparent: true, opacity: 1, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  // 贴在定位板上方、键帽底面之下，并收进最外圈键帽的投影内：
  // 只透过按键缝隙发光；深度收窄到 0.104，避免从前排键帽底部的
  // 0.7 mm 缝隙里透成一条连续的前沿光带。
  const underlay = new THREE.Mesh(new THREE.PlaneGeometry(0.358, 0.104), underMaterial);
  underlay.rotation.x = -Math.PI / 2;
  underlay.position.set(0, -0.003, 0);
  underlay.renderOrder = 2;
  pivot.add(underlay);

  // Legends are one transparent overlay plane, so the 98 caps stay a single draw call.
  const [legendCanvas, legendCtx] = makeCanvas(1024, 512);
  legendCtx.clearRect(0, 0, 1024, 512);
  legendCtx.textAlign = 'center';
  legendCtx.textBaseline = 'middle';
  legendCtx.font = '800 19px "Segoe UI", Arial, sans-serif';
  let labelIndex = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (row === rows - 1 && col >= 4 && col <= 8) continue;
      const px = ((col + 0.5) / cols) * 1024;
      const py = ((row + 0.5) / rows) * 512;
      // 浅色后三排用深字，深色前三排改用浅字，保持与参考一致的可读性。
      legendCtx.fillStyle = row <= 2 ? 'rgba(36,42,46,0.95)' : 'rgba(236,241,244,0.92)';
      legendCtx.fillText(legendLabels[labelIndex] ?? '', px, py);
      labelIndex += 1;
    }
  }
  legendCtx.font = '800 19px "Segoe UI", Arial, sans-serif';
  legendCtx.fillStyle = 'rgba(236,241,244,0.92)';
  legendCtx.fillText('SPACE', ((spaceX / pitchX + (cols - 1) / 2 + 0.5) / cols) * 1024, ((rows - 1 + 0.5) / rows) * 512);
  const legendTexture = makeTexture(legendCanvas);
  legendTexture.wrapS = THREE.ClampToEdgeWrapping;
  legendTexture.wrapT = THREE.ClampToEdgeWrapping;
  const legendMaterial = new THREE.MeshBasicMaterial({
    map: legendTexture, transparent: true, opacity: 1.0, depthWrite: false, depthTest: false, toneMapped: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const legends = new THREE.Mesh(new THREE.PlaneGeometry(0.368, 0.124), legendMaterial);
  legends.rotation.x = -Math.PI / 2;
  legends.position.set(0, 0.0076, 0);
  legends.renderOrder = 20;
  pivot.add(legends);

  const pressed = new Set<number>();
  const writeMatrix = (index: number) => {
    const p = keyPositions[index].clone();
    if (pressed.has(index)) p.y -= 0.0024;
    const s = baseScales[index].clone();
    matrix.compose(p, baseQuaternions[index], s);
    keys.setMatrixAt(index, matrix);
    keys.instanceMatrix.needsUpdate = true;
  };
  return {
    keys, spacebar: spaceMesh, underlay, legends, pressed, keyPositions, baseQuaternions, baseScales,
    underRainbowMap: underTexture, underSolidMap: underSolidTexture,
    press: (index, travel = 2.4) => {
      if (index < 0 || index >= keyPositions.length) return;
      pressed.add(index);
      keyPositions[index].y = baseY - travel / 1000;
      writeMatrix(index);
    },
    release: (index) => {
      if (index < 0 || index >= keyPositions.length) return;
      pressed.delete(index);
      keyPositions[index].y = baseY;
      writeMatrix(index);
    },
  };
}

function buildKeycapRgbUnderlay(keyState: ReturnType<typeof createKeyLayout>): THREE.Mesh {
  return keyState.underlay;
}

function createSteam(mug: THREE.Object3D): { points: THREE.Points; update: (t: number, dt: number) => void } {
  const count = 42;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const offsets = new Float32Array(count);
  const rand = rng(123);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rand() - 0.5) * 0.035;
    positions[i * 3 + 1] = 0.05 + rand() * 0.09;
    positions[i * 3 + 2] = (rand() - 0.5) * 0.025;
    speeds[i] = 0.011 + rand() * 0.015;
    offsets[i] = rand() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: drawSmokeTexture(), color: '#edf4ef', size: 0.028, sizeAttenuation: true,
    transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.position.set(0, 0.0, 0);
  mug.add(points);
  return {
    points,
    update: (t, dt) => {
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i += 1) {
        let y = pos.getY(i) + speeds[i] * dt;
        if (y > 0.2) y = 0.05;
        pos.setY(i, y);
        pos.setX(i, (rand() - 0.5) * 0.02 + Math.sin(t * 0.8 + offsets[i]) * 0.012);
        pos.setZ(i, (rand() - 0.5) * 0.015);
      }
      pos.needsUpdate = true;
      material.opacity = 0.1 + Math.sin(t * 1.4) * 0.02;
    },
  };
}

function createCables(root: THREE.Object3D): void {
  const makeCable = (points: [number, number, number][], color: string, radius: number) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.4);
    const geometry = new THREE.TubeGeometry(curve, 64, radius, 7, false);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.56, metalness: 0.0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const plugShell = new THREE.MeshPhysicalMaterial({
    color: '#D5D6D2', roughness: 0.4, metalness: 0.05, clearcoat: 0.32, clearcoatRoughness: 0.24,
  });
  const plugTrim = new THREE.MeshStandardMaterial({ color: '#2C2E30', roughness: 0.55, metalness: 0.2 });

  const laptopPlug = new THREE.Group();
  laptopPlug.name = 'laptop-power-plug';
  // 接头贴在机身左后侧的实际斜面上，方向随机身 10° 偏转，避免插头悬空。
  laptopPlug.position.set(-0.4112, 0.858, -0.130);
  laptopPlug.rotation.y = THREE.MathUtils.degToRad(10);
  const laptopTip = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.0055, 0.004), plugTrim);
  laptopTip.position.x = 0.0005;
  const laptopShell = new THREE.Mesh(new RoundedBoxGeometry(0.009, 0.0075, 0.0085, 3, 0.0018), plugShell);
  laptopShell.position.x = -0.0065;
  const laptopRelief = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.006, 14), plugTrim);
  laptopRelief.rotation.z = Math.PI / 2;
  laptopRelief.position.x = -0.014;
  laptopPlug.add(laptopTip, laptopShell, laptopRelief);

  const brickPlug = new THREE.Group();
  brickPlug.name = 'brick-power-plug';
  brickPlug.position.set(-0.445, 0.772, -0.185);
  const brickCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.0025, 16), plugTrim);
  brickCollar.rotation.x = Math.PI / 2;
  brickCollar.position.z = 0.0012;
  const brickShell = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.010, 0.014, 3, 0.0022), plugShell);
  brickShell.position.z = 0.007;
  const brickRelief = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 14), plugTrim);
  brickRelief.rotation.x = Math.PI / 2;
  brickRelief.position.z = 0.016;
  brickPlug.add(brickCollar, brickShell, brickRelief);

  for (const plug of [laptopPlug, brickPlug]) {
    plug.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    root.add(plug);
  }

  const laptopPowerCable = makeCable([
    [-0.4279, 0.858, -0.1270], [-0.431, 0.842, -0.130], [-0.432, 0.824, -0.136],
    [-0.432, 0.804, -0.143], [-0.430, 0.783, -0.153], [-0.428, 0.766, -0.163],
    [-0.428, 0.7597, -0.171], [-0.433, 0.7597, -0.164], [-0.440, 0.7597, -0.158],
    [-0.444, 0.762, -0.158], [-0.445, 0.768, -0.162], [-0.445, 0.771, -0.167],
  ], '#D8D6D0', 0.0022);
  laptopPowerCable.name = 'laptop-power-cable';
  const monitorPowerCable = makeCable([
    [0.215, 0.90, -0.265], [0.245, 0.86, -0.275], [0.275, 0.82, -0.285],
    [0.285, 0.78, -0.288], [0.285, 0.761, -0.29],
  ], '#16181A', 0.0035);
  monitorPowerCable.name = 'monitor-power-cable';
  // 显示器信号线已由用户确认删除：它横穿竖放后的鼠标垫上方，视觉上像一条杂乱悬线。
}

function createPowerStrip(parent: THREE.Object3D): void {
  // 放在显示器左后、笔记本右后的桌面空隙，避开杯垫、显示器圆盘底座与笔记本支架。
  const strip = new THREE.Group();
  strip.name = 'desk-power-strip';
  strip.position.set(0.026, 0.7735, -0.135);
  strip.rotation.y = -0.03;
  parent.add(strip);

  const shellMat = new THREE.MeshPhysicalMaterial({
    color: '#E4E2DA', roughness: 0.48, metalness: 0.0,
    clearcoat: 0.12, clearcoatRoughness: 0.35,
  });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.032, 0.05, 4, 0.007), shellMat);
  body.name = 'desk-power-strip-body';
  body.castShadow = true;
  body.receiveShadow = true;
  strip.add(body);

  const top = new THREE.Mesh(
    new RoundedBoxGeometry(0.192, 0.0025, 0.044, 3, 0.004),
    new THREE.MeshPhysicalMaterial({ color: '#ECE9E1', roughness: 0.5 }),
  );
  top.position.y = 0.0155;
  top.receiveShadow = true;
  strip.add(top);

  const socketMat = new THREE.MeshStandardMaterial({ color: '#8D8B84', roughness: 0.62, metalness: 0.05 });
  const holeMat = new THREE.MeshBasicMaterial({ color: '#202224', toneMapped: false });
  for (const sx of [-0.072, -0.028, 0.016, 0.060]) {
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.0012, 0.028, 3, 0.004), socketMat);
    plate.position.set(sx, 0.0172, 0);
    strip.add(plate);
    for (const [hx, hz] of [[-0.006, -0.006], [0.006, -0.006], [0, 0.007]]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0032, 12), holeMat);
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(sx + hx, 0.0179, hz);
      strip.add(hole);
    }
  }

  const switchBase = new THREE.Mesh(new RoundedBoxGeometry(0.013, 0.003, 0.011, 2, 0.002), socketMat);
  switchBase.position.set(0.086, 0.018, 0);
  strip.add(switchBase);
  const switchButton = new THREE.Mesh(
    new RoundedBoxGeometry(0.008, 0.0035, 0.008, 2, 0.0015),
    new THREE.MeshPhysicalMaterial({ color: '#F4F2EA', roughness: 0.4 }),
  );
  switchButton.position.set(0.086, 0.0205, 0);
  strip.add(switchButton);

  const adapterMat = new THREE.MeshPhysicalMaterial({
    color: '#E9E7E0', roughness: 0.36, clearcoat: 0.2, clearcoatRoughness: 0.3,
  });
  const adapter = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.032, 0.026, 4, 0.005), adapterMat);
  adapter.position.set(-0.072, 0.033, 0);
  adapter.castShadow = true;
  adapter.receiveShadow = true;
  strip.add(adapter);
  const port = new THREE.Mesh(
    new THREE.PlaneGeometry(0.009, 0.0035),
    new THREE.MeshBasicMaterial({ color: '#1A1C1E', toneMapped: false }),
  );
  port.rotation.x = -Math.PI / 2;
  port.position.set(-0.072, 0.0492, 0.002);
  strip.add(port);

  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0125, 0.018, 24), adapterMat);
  plug.position.set(-0.028, 0.0262, 0);
  plug.castShadow = true;
  strip.add(plug);
  const plugTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0075, 0.004, 20), adapterMat);
  plugTop.position.set(-0.028, 0.0372, 0);
  strip.add(plugTop);

  const makeStripCable = (points: [number, number, number][]): void => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.4);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.0022, 8, false),
      new THREE.MeshStandardMaterial({ color: '#E7E6E0', roughness: 0.58, metalness: 0.0 }),
    );
    cable.castShadow = true;
    strip.add(cable);
  };
  makeStripCable([
    [-0.072, 0.0494, 0], [-0.076, 0.036, -0.035], [-0.080, 0.026, -0.075],
    [-0.083, 0.030, -0.115], [-0.085, 0.070, -0.135], [-0.086, 0.105, -0.14],
  ]);
  makeStripCable([
    [-0.028, 0.0392, 0], [-0.030, 0.030, -0.035], [-0.034, 0.024, -0.075],
    [-0.038, 0.030, -0.115], [-0.040, 0.070, -0.135], [-0.041, 0.100, -0.14],
  ]);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(0.23, 0.08),
    new THREE.MeshBasicMaterial({
      map: drawContactShadowTexture(), transparent: true, opacity: 0.55,
      depthWrite: false, toneMapped: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, -0.0155, 0);
  contact.renderOrder = 2;
  strip.add(contact);
}

function createDeskProps(root: THREE.Object3D): void {
  // The generated paper block no longer matches the narrower desk; rebuild the
  // left-front still life at the measured scale instead of stretching it.
  const group = new THREE.Group();
  group.name = 'desk-props-layout';
  root.add(group);

  const stillLife = new THREE.Group();
  stillLife.name = 'desk-still-life';
  // 纸笔与笔袋整体右移，避让 x=-0.4925 的左前铝立柱，键盘同步右移保持相对间距。
  stillLife.position.x = 0.013;
  group.add(stillLife);

  const paperMat = new THREE.MeshPhysicalMaterial({ color: '#DED6C7', roughness: 0.9, metalness: 0.0 });
  paperMat.bumpMap = surfaceTexture('micro', 256, 2);
  paperMat.bumpScale = 0.00004;
  const notebookMat = new THREE.MeshPhysicalMaterial({ color: '#D9C9AB', roughness: 0.8, metalness: 0.0 });
  const notebook = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.012, 0.16), notebookMat);
  notebook.name = 'desk-notebook';
  notebook.position.set(-0.404, 0.7635, 0.09);
  notebook.rotation.y = -0.10;
  notebook.castShadow = true;
  notebook.receiveShadow = true;
  stillLife.add(notebook);

  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.004, 0.19), paperMat);
  paper.name = 'desk-paper';
  paper.position.set(-0.40, 0.7715, 0.09);
  paper.rotation.y = -0.04;
  paper.castShadow = true;
  paper.receiveShadow = true;
  stillLife.add(paper);

  const [handCanvas, handCtx] = makeCanvas(1024, 768);
  handCtx.clearRect(0, 0, 1024, 768);
  handCtx.strokeStyle = 'rgba(27, 38, 69, 0.76)';
  handCtx.lineWidth = 3;
  handCtx.font = '500 34px "KaiTi", "Microsoft YaHei", cursive';
  for (let i = 0; i < 9; i += 1) {
    handCtx.beginPath();
    const y = 120 + i * 62;
    handCtx.moveTo(80, y);
    for (let x = 80; x < 900; x += 26) {
      handCtx.lineTo(x, y + Math.sin(x * 0.07 + i) * 10 + Math.sin(x * 0.018) * 8);
    }
    handCtx.stroke();
  }
  const handTex = makeTexture(handCanvas);
  handTex.wrapS = THREE.ClampToEdgeWrapping;
  handTex.wrapT = THREE.ClampToEdgeWrapping;
  addDecal(stillLife, handTex, 0.16, 0.15, [-0.40, 0.7738, 0.09], [-Math.PI / 2, 0, 0.02], 0.8, 6);

  // 软质黑色笔袋：鼓胀的圆角布壳、沿上前沿的拉链、端部织带提手和曲面布标。
  const pencilCase = new THREE.Group();
  pencilCase.name = 'desk-pencil-case';
  pencilCase.position.set(-0.395, 0.8105, 0.068);
  pencilCase.rotation.y = 0.20;
  stillLife.add(pencilCase);

  const POUCH_L = 0.19;
  const POUCH_H = 0.074;
  const POUCH_D = 0.086;
  const POUCH_R = 0.028;
  const pouchBottom = -POUCH_H / 2;
  const pouchScale = (x: number) => {
    const t = x / (POUCH_L / 2);
    const crown = Math.cos(t * Math.PI / 2);
    return {
      y: 1 + 0.016 * crown,
      z: 1 + 0.028 * crown + 0.012 * Math.max(0, -t),
    };
  };
  const deformPouch = (v: THREE.Vector3): THREE.Vector3 => {
    const scale = pouchScale(v.x);
    v.y = pouchBottom + (v.y - pouchBottom) * scale.y;
    v.z *= scale.z;
    return v;
  };
  const pouchFrontZ = (x: number, y: number): number => {
    const dx = Math.max(0, Math.abs(x) - (POUCH_L / 2 - POUCH_R));
    const dy = Math.max(0, Math.abs(y) - (POUCH_H / 2 - POUCH_R));
    return (POUCH_D / 2 - POUCH_R) + Math.sqrt(Math.max(0, POUCH_R ** 2 - dx ** 2 - dy ** 2));
  };
  const pouchEdgePoint = (x: number, theta: number, offset = 0, front = true): THREE.Vector3 => {
    const dx = Math.max(0, Math.abs(x) - (POUCH_L / 2 - POUCH_R));
    const rho = Math.sqrt(Math.max(0, POUCH_R ** 2 - dx ** 2));
    const y = (POUCH_H / 2 - POUCH_R) + (rho + offset) * Math.cos(theta);
    const z = (front ? 1 : -1) * ((POUCH_D / 2 - POUCH_R) + (rho + offset) * Math.sin(theta));
    return deformPouch(new THREE.Vector3(x, y, z));
  };

  const caseMat = new THREE.MeshPhysicalMaterial({
    color: '#17181A', roughness: 0.95, metalness: 0.0,
    sheen: 0.38, sheenColor: new THREE.Color('#3A3C3F'), sheenRoughness: 0.82,
  });
  caseMat.bumpMap = surfaceTexture('fabric', 512, 5);
  caseMat.bumpScale = 0.00034;
  caseMat.roughnessMap = surfaceRoughness('fabric', 256, 3, 0.94);
  const caseGeo = new RoundedBoxGeometry(POUCH_L, POUCH_H, POUCH_D, 16, POUCH_R);
  const casePos = caseGeo.getAttribute('position') as THREE.BufferAttribute;
  const caseVertex = new THREE.Vector3();
  for (let i = 0; i < casePos.count; i += 1) {
    caseVertex.fromBufferAttribute(casePos, i);
    deformPouch(caseVertex);
    casePos.setXYZ(i, caseVertex.x, caseVertex.y, caseVertex.z);
  }
  casePos.needsUpdate = true;
  const caseBody = new THREE.Mesh(caseGeo, caseMat);
  caseBody.name = 'desk-pencil-case-body';
  caseBody.castShadow = true;
  caseBody.receiveShadow = true;
  pencilCase.add(caseBody);

  // 布标：织物底纹、虚线包边和手写体，做成贴合格面曲率的网格。
  const [labelCanvas, labelCtx] = makeCanvas(1280, 400);
  const labelRand = rng(4217);
  labelCtx.clearRect(0, 0, 1280, 400);
  roundedRectPath(labelCtx, 0, 0, 1280, 400, 34);
  labelCtx.save();
  labelCtx.clip();
  labelCtx.fillStyle = '#D3C7B2';
  labelCtx.fillRect(0, 0, 1280, 400);
  for (let y = 0; y < 400; y += 3) {
    const alpha = 0.08 + labelRand() * 0.1;
    labelCtx.fillStyle = `rgba(255,250,238,${alpha})`;
    labelCtx.fillRect(0, y, 1280, 1);
  }
  for (let x = 0; x < 1280; x += 4) {
    labelCtx.fillStyle = `rgba(112,100,80,${0.05 + labelRand() * 0.08})`;
    labelCtx.fillRect(x, 0, 1, 400);
  }
  for (let i = 0; i < 3400; i += 1) {
    const v = 130 + Math.floor(labelRand() * 70);
    labelCtx.fillStyle = `rgba(${v},${v - 8},${v - 22},${0.06 + labelRand() * 0.1})`;
    labelCtx.fillRect(labelRand() * 1280, labelRand() * 400, 1 + labelRand() * 2, 1 + labelRand() * 2);
  }
  const stain = labelCtx.createRadialGradient(1010, 300, 8, 1010, 300, 180);
  stain.addColorStop(0, 'rgba(118,102,78,0.12)');
  stain.addColorStop(1, 'rgba(118,102,78,0)');
  labelCtx.fillStyle = stain;
  labelCtx.fillRect(0, 0, 1280, 400);
  labelCtx.setLineDash([10, 8]);
  labelCtx.lineWidth = 2.6;
  labelCtx.strokeStyle = 'rgba(92,80,62,0.55)';
  roundedRectPath(labelCtx, 16, 16, 1248, 368, 26);
  labelCtx.stroke();
  labelCtx.setLineDash([]);
  labelCtx.lineWidth = 5;
  labelCtx.strokeStyle = 'rgba(104,92,72,0.22)';
  roundedRectPath(labelCtx, 5, 5, 1270, 390, 30);
  labelCtx.stroke();
  labelCtx.restore();
  const labelChars = [...'人间就要多读书'];
  const labelAdvance = 145;
  const labelStart = 640 - (labelChars.length * labelAdvance) / 2 + labelAdvance / 2;
  labelCtx.fillStyle = 'rgba(60,50,38,0.94)';
  labelCtx.font = '500 184px "KaiTi", "STKaiti", "FangSong", "Microsoft YaHei", cursive';
  labelCtx.textAlign = 'center';
  labelCtx.textBaseline = 'middle';
  const labelTilt = [-0.03, 0.022, -0.014, 0.03, -0.026, 0.016, -0.02, 0.026];
  const labelLift = [4, -6, 2, 7, -3, 5, -5, 1];
  labelChars.forEach((char, i) => {
    labelCtx.save();
    labelCtx.translate(labelStart + i * labelAdvance, 202 + labelLift[i]);
    labelCtx.rotate(labelTilt[i]);
    labelCtx.scale(0.8, 1.02);
    labelCtx.fillText(char, 0, 0);
    labelCtx.fillText(char, 1.4, 0.9);
    labelCtx.restore();
  });
  const labelTex = makeTexture(labelCanvas);
  labelTex.wrapS = THREE.ClampToEdgeWrapping;
  labelTex.wrapT = THREE.ClampToEdgeWrapping;
  const labelW = 0.076;
  const labelH = 0.023;
  const labelCols = 36;
  const labelRows = 12;
  const labelAngle = -0.06;
  const labelPositions: number[] = [];
  const labelUvs: number[] = [];
  const labelIndices: number[] = [];
  for (let row = 0; row <= labelRows; row += 1) {
    for (let col = 0; col <= labelCols; col += 1) {
      const u = (col / labelCols - 0.5) * labelW;
      const v = (row / labelRows - 0.5) * labelH;
      const x = 0.008 + u * Math.cos(labelAngle) - v * Math.sin(labelAngle);
      const y = 0.001 + u * Math.sin(labelAngle) + v * Math.cos(labelAngle);
      const z = pouchFrontZ(x, y) + 0.0012;
      const p = deformPouch(new THREE.Vector3(x, y, z));
      labelPositions.push(p.x, p.y, p.z);
      labelUvs.push(col / labelCols, row / labelRows);
    }
  }
  for (let row = 0; row < labelRows; row += 1) {
    for (let col = 0; col < labelCols; col += 1) {
      const a = row * (labelCols + 1) + col;
      const b = a + 1;
      const c = a + labelCols + 2;
      const d = a + labelCols + 1;
      labelIndices.push(a, d, c, a, c, b);
    }
  }
  const labelGeo = new THREE.BufferGeometry();
  labelGeo.setAttribute('position', new THREE.Float32BufferAttribute(labelPositions, 3));
  labelGeo.setAttribute('uv', new THREE.Float32BufferAttribute(labelUvs, 2));
  labelGeo.setIndex(labelIndices);
  labelGeo.computeVertexNormals();
  const labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({
    map: labelTex, roughness: 0.95, metalness: 0.0,
    transparent: true, alphaTest: 0.02, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  }));
  labelMesh.name = 'desk-pencil-case-label';
  labelMesh.renderOrder = 3;
  labelMesh.receiveShadow = true;
  pencilCase.add(labelMesh);

  // 拉链：两片布带夹一条金属齿，沿布标上方的上前沿走线。
  const zipperTheta = 0.85;
  const sliderEdge = new THREE.Vector3(0, Math.cos(zipperTheta), Math.sin(zipperTheta)).normalize();
  const tapeMat = new THREE.MeshPhysicalMaterial({
    color: '#24262A', roughness: 0.86, metalness: 0.0,
    sheen: 0.35, sheenColor: new THREE.Color('#45484C'), sheenRoughness: 0.8,
  });
  const teethMat = new THREE.MeshStandardMaterial({ color: '#3B3D40', roughness: 0.48, metalness: 0.35 });
  const addZipperLine = (thetaOffset: number, offset: number, radius: number, material: THREE.Material) => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i += 1) {
      const x = -0.088 + (i / 24) * 0.168;
      points.push(pouchEdgePoint(x, zipperTheta + thetaOffset, offset));
    }
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2), 96, radius, 7, false),
      material,
    );
    mesh.name = 'desk-pencil-case-zipper';
    mesh.castShadow = true;
    pencilCase.add(mesh);
  };
  addZipperLine(-0.068, 0.0008, 0.003, tapeMat);
  addZipperLine(0.068, 0.0008, 0.003, tapeMat);
  const toothCount = 53;
  const toothGeo = new THREE.BoxGeometry(0.0016, 0.0036, 0.0012);
  const teethMesh = new THREE.InstancedMesh(toothGeo, teethMat, toothCount);
  teethMesh.name = 'desk-pencil-case-zipper-teeth';
  const toothDummy = new THREE.Object3D();
  for (let i = 0; i < toothCount; i += 1) {
    const x = -0.086 + (i / (toothCount - 1)) * 0.164;
    const p = pouchEdgePoint(x, zipperTheta, 0.0038);
    const p2 = pouchEdgePoint(x + 0.002, zipperTheta, 0.0038);
    const track = new THREE.Vector3().subVectors(p2, p).normalize();
    const across = new THREE.Vector3().crossVectors(sliderEdge, track).normalize();
    toothDummy.position.copy(p).addScaledVector(across, (i % 2 === 0 ? -1 : 1) * 0.0009);
    toothDummy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(track, across, sliderEdge));
    toothDummy.updateMatrix();
    teethMesh.setMatrixAt(i, toothDummy.matrix);
  }
  teethMesh.castShadow = true;
  teethMesh.receiveShadow = true;
  pencilCase.add(teethMesh);
  for (const x of [-0.087, 0.079]) {
    const stop = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.0055, 0.004, 3, 0.0012), tapeMat);
    stop.position.copy(pouchEdgePoint(x, zipperTheta, 0.0022));
    stop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sliderEdge);
    stop.castShadow = true;
    pencilCase.add(stop);
  }

  const sliderMat = new THREE.MeshStandardMaterial({ color: '#626569', roughness: 0.32, metalness: 0.72 });
  const addZipperSlider = (x: number, style: 'ring' | 'cord') => {
    const p = pouchEdgePoint(x, zipperTheta, 0.0042);
    const p2 = pouchEdgePoint(x + 0.004, zipperTheta, 0.0042);
    const track = new THREE.Vector3().subVectors(p2, p).normalize();
    const widthAxis = new THREE.Vector3().crossVectors(sliderEdge, track).normalize();
    const slider = new THREE.Mesh(new RoundedBoxGeometry(0.0095, 0.009, 0.0045, 3, 0.0014), sliderMat);
    slider.position.copy(p);
    slider.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(track, widthAxis, sliderEdge));
    slider.castShadow = true;
    pencilCase.add(slider);
    const surfaceQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sliderEdge);
    const connector = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.0018), sliderMat);
    connector.position.copy(p).addScaledVector(track, -0.0075).addScaledVector(sliderEdge, 0.0022);
    connector.quaternion.copy(surfaceQuat);
    pencilCase.add(connector);
    if (style === 'ring') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0048, 0.0009, 6, 18), sliderMat);
      ring.position.copy(p).addScaledVector(track, -0.0145).addScaledVector(sliderEdge, 0.0024);
      ring.quaternion.copy(surfaceQuat);
      ring.castShadow = true;
      pencilCase.add(ring);
    } else {
      const cordMat = new THREE.MeshStandardMaterial({ color: '#131416', roughness: 0.92, metalness: 0.0 });
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.0085, 0.0013, 6, 22), cordMat);
      loop.position.copy(p).addScaledVector(track, -0.0155).addScaledVector(sliderEdge, 0.0024);
      loop.quaternion.copy(surfaceQuat);
      loop.scale.set(0.78, 1, 1);
      loop.castShadow = true;
      pencilCase.add(loop);
    }
  };
  addZipperSlider(-0.072, 'ring');
  addZipperSlider(-0.055, 'cord');

  // 端部宽织带提手：在袋口与纸面之间自然下垂。
  const handleMat = new THREE.MeshPhysicalMaterial({
    color: '#111214', roughness: 0.94, metalness: 0.0,
    sheen: 0.35, sheenColor: new THREE.Color('#35373A'), sheenRoughness: 0.85,
  });
  handleMat.bumpMap = surfaceTexture('fabric', 256, 4);
  handleMat.bumpScale = 0.00012;
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.080, 0.006, 0.030),
    new THREE.Vector3(-0.092, 0.020, 0.048),
    new THREE.Vector3(-0.101, 0.008, 0.066),
    new THREE.Vector3(-0.096, -0.028, 0.076),
    new THREE.Vector3(-0.078, -0.035, 0.058),
    new THREE.Vector3(-0.072, -0.025, 0.032),
  ], false, 'catmullrom', 0.35);
  const handleSteps = 48;
  const handleWidth = 0.014;
  const handleThickness = 0.0028;
  const handlePositions: number[] = [];
  const handleUvs: number[] = [];
  const handleIndices: number[] = [];
  const worldUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= handleSteps; i += 1) {
    const t = i / handleSteps;
    const point = handleCurve.getPoint(t);
    const tangent = handleCurve.getTangent(t).normalize();
    const across = new THREE.Vector3().crossVectors(worldUp, tangent).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, across).normalize();
    const corners: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    corners.forEach(([acrossUnit, normalUnit], cornerIndex) => {
      const q = point.clone()
        .addScaledVector(across, acrossUnit * handleWidth)
        .addScaledVector(normal, normalUnit * handleThickness);
      handlePositions.push(q.x, q.y, q.z);
      handleUvs.push(t, cornerIndex % 2);
    });
  }
  for (let i = 0; i < handleSteps; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const a = i * 4 + j;
      const b = i * 4 + (j + 1) % 4;
      const c = (i + 1) * 4 + (j + 1) % 4;
      const d = (i + 1) * 4 + j;
      handleIndices.push(a, b, c, a, c, d);
    }
  }
  const handleGeo = new THREE.BufferGeometry();
  handleGeo.setAttribute('position', new THREE.Float32BufferAttribute(handlePositions, 3));
  handleGeo.setAttribute('uv', new THREE.Float32BufferAttribute(handleUvs, 2));
  handleGeo.setIndex(handleIndices);
  handleGeo.computeVertexNormals();
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.name = 'desk-pencil-case-handle';
  handle.castShadow = true;
  handle.receiveShadow = true;
  pencilCase.add(handle);

  const brick = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.035, 0.07),
    new THREE.MeshPhysicalMaterial({ color: '#C9C8C3', roughness: 0.62, clearcoat: 0.1, clearcoatRoughness: 0.4 }));
  brick.name = 'desk-power-brick';
  // 左缘须让开 x=-0.505 的侧板内表面，右缘保持与支架底座的净距。
  brick.position.set(-0.45, 0.775, -0.22);
  brick.castShadow = true;
  group.add(brick);
  for (let i = 0; i < 5; i += 1) {
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.055),
      new THREE.MeshBasicMaterial({ color: '#C9C7C0', toneMapped: false }));
    vent.rotation.x = -Math.PI / 2;
    vent.position.set(-0.488 + i * 0.019, 0.7928, -0.22);
    group.add(vent);
  }

}

// --- 桌顶格架与陈设（参考 figure/桌顶架子-1..3.jpg） ------------------------
// 参考格子净高按 A4 透明文件盒（约 315 mm）与顶部约 15 mm 余量反推为 330 mm；
// 搁板面 1.3725 m 保持不变，顶板顶面位于 1.7275 m。所有坐标直接使用世界坐标。
const SHELF_TOP_Y = 1.3725;
const HUTCH_CLEAR_HEIGHT = 0.330;
const HUTCH_TOP_THICKNESS = 0.025;
const HUTCH_UNDERSIDE_Y = SHELF_TOP_Y + HUTCH_CLEAR_HEIGHT;
const HUTCH_TOP_Y = HUTCH_UNDERSIDE_Y + HUTCH_TOP_THICKNESS;
const SHELF_PROP_BASE_Y = SHELF_TOP_Y + 0.0003;
const SHELF_PAPER_TOP_Y = SHELF_TOP_Y + 0.0007;
const SHELF_PAPER_B_TOP_Y = SHELF_TOP_Y + 0.0009;
const SHELF_PAPER_STACK_TOP_Y = SHELF_TOP_Y + 0.0016;
const SHELF_GIFT_BASE_Y = SHELF_PAPER_TOP_Y + 0.0002;
const SHELF_CAN_BASE_Y = SHELF_PAPER_B_TOP_Y + 0.0002;
const SHELF_BACK_Z = -0.298;

type ShelfBookSpec = {
  id: string;
  title: string;
  english?: string;
  author?: string;
  publisher: string;
  base: string;
  text: string;
  accent: string;
  band: 'top' | 'bottom' | 'both' | 'none';
  emblem?: 'pearson' | 'watermelon' | 'seal' | 'huazhong' | 'none';
  size: [number, number, number];
  yaw?: number;
  depthOffset?: number;
  fileBox?: boolean;
};

const SHELF_BOOKS: ShelfBookSpec[] = [
  {
    id: 'opencv', title: 'OpenCV3编程入门', publisher: '电子工业出版社',
    base: '#232F68', text: '#F1F0E8', accent: '#B43B4A', band: 'top', emblem: 'seal',
    size: [0.026, 0.280, 0.196], yaw: -0.008, depthOffset: 0.008,
  },
  {
    id: 'mech-design', title: '机械设计(第三版)', publisher: '华中科技大学出版社',
    base: '#8C3B4A', text: '#F6EEE3', accent: '#E7D7C7', band: 'bottom',
    size: [0.020, 0.262, 0.184], yaw: 0.012,
  },
  {
    id: 'robot-measure', title: '机器人加工视觉测量与力控技术', publisher: '科学出版社',
    base: '#1E3762', text: '#F3F3EA', accent: '#A33B39', band: 'top', emblem: 'seal',
    size: [0.030, 0.272, 0.204], yaw: -0.006,
  },
  {
    id: 'robotics-thin', title: '机器人学导论', publisher: '机械工业出版社',
    base: '#797B6C', text: '#F0EDE0', accent: '#C9C3AF', band: 'bottom',
    size: [0.010, 0.256, 0.188], yaw: 0.010,
  },
  {
    id: 'grad-handbook', title: '2023年研究生手册', publisher: '华中科技大学',
    base: '#C8BCD4', text: '#443A50', accent: '#F0EAF6', band: 'top', emblem: 'huazhong',
    size: [0.013, 0.252, 0.148], yaw: 0.006,
  },
  {
    id: 'robot-vision', title: '机器视觉', english: 'Robot Vision', publisher: '机械工业出版社',
    base: '#5D7A93', text: '#EEF3F5', accent: '#A7C5D8', band: 'top',
    size: [0.027, 0.258, 0.198], yaw: -0.004,
  },
  {
    id: 'slam', title: '视觉SLAM十四讲', author: '高翔 等 著', publisher: '电子工业出版社',
    base: '#15171B', text: '#F0EFE8', accent: '#B23A3E', band: 'top', emblem: 'seal',
    size: [0.024, 0.256, 0.178], yaw: 0.008,
  },
  {
    id: 'ml', title: '机器学习', author: '周志华 著', publisher: '清华大学出版社',
    base: '#EFEDE4', text: '#2E2D28', accent: '#B8B6AC', band: 'none', emblem: 'watermelon',
    size: [0.024, 0.274, 0.186], yaw: -0.010,
  },
  {
    id: 'dip', title: '数字图像处理(第三版)', english: 'Digital Image Processing',
    publisher: '电子工业出版社', base: '#2E5846', text: '#F1F2E8', accent: '#9AB5A2',
    band: 'none', emblem: 'pearson', size: [0.030, 0.298, 0.208], yaw: 0.006,
  },
  {
    id: 'file-box', title: '', publisher: '', base: '#D6E5EA', text: '', accent: '',
    band: 'none', size: [0.042, 0.315, 0.288], fileBox: true,
  },
  {
    id: 'robotics', title: '机器人学', author: '建模、控制与视觉(第2版)', publisher: '华中科技大学出版社',
    base: '#1A1C20', text: '#E9EEF4', accent: '#4C76A6', band: 'none', emblem: 'seal',
    size: [0.032, 0.280, 0.206], yaw: -0.012,
  },
  {
    id: 'nutrition', title: '健康营养饮食', publisher: '江苏凤凰科学技术出版社',
    base: '#EFEEE6', text: '#2B3D47', accent: '#B53A40', band: 'top',
    size: [0.016, 0.216, 0.150], yaw: 0.010,
  },
  {
    id: 'mockingbird', title: '杀死一只知更鸟', author: '哈珀·李 著', publisher: '译林出版社',
    base: '#E98936', text: '#FFF7EA', accent: '#2E2A26', band: 'none',
    size: [0.019, 0.210, 0.148], yaw: -0.006,
  },
  {
    id: 'running', title: '当我谈跑步时我谈些什么', author: '村上春树 著', publisher: '南海出版公司',
    base: '#E9EFF0', text: '#2E454C', accent: '#48A1B3', band: 'top',
    size: [0.016, 0.208, 0.146], yaw: 0.008,
  },
  {
    id: 'animal-farm', title: '动物庄园', author: '乔治·奥威尔 著', publisher: '北京时代华文书局',
    base: '#8C8E81', text: '#F3EFE3', accent: '#D7D0BF', band: 'bottom',
    size: [0.015, 0.200, 0.144], yaw: -0.008,
  },
  {
    id: 'red-crag', title: '红岩', author: '罗广斌 杨益言 著', publisher: '中国青年出版社',
    base: '#B02A35', text: '#FFF6E8', accent: '#E6C7AE', band: 'none', emblem: 'seal',
    size: [0.024, 0.222, 0.150], yaw: 0.006,
  },
];


function drawBookEmblem(ctx: CanvasRenderingContext2D, spec: ShelfBookSpec, width: number, height: number): void {
  if (!spec.emblem || spec.emblem === 'none') return;
  const cx = width / 2;
  ctx.save();
  if (spec.emblem === 'pearson') {
    const cy = 138;
    ctx.fillStyle = 'rgba(244, 247, 240, 0.95)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.lineTo(cx + 30, cy);
    ctx.lineTo(cx, cy + 30);
    ctx.lineTo(cx - 30, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2E5846';
    ctx.font = '700 26px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', cx, cy + 1);
    ctx.fillStyle = 'rgba(240, 244, 236, 0.9)';
    ctx.font = '600 17px Georgia, serif';
    ctx.fillText('PEARSON', cx, cy + 52);
  } else if (spec.emblem === 'watermelon') {
    const cy = height - 250;
    ctx.fillStyle = '#2E7D46';
    ctx.beginPath();
    ctx.arc(cx, cy, 43, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E35856';
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#F7F4EC';
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E35856';
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2B211C';
    for (const [dx, dy, angle] of [[-13, 10, 0.4], [2, 16, -0.2], [15, 8, 0.9]]) {
      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.6, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (spec.emblem === 'huazhong') {
    const cy = height - 250;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5A4E68';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#5A4E68';
    ctx.font = '700 30px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('华', cx, cy + 2);
  } else {
    const cy = height - 236;
    ctx.fillStyle = spec.accent;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(cx - 28, cy - 28, 56, 56);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 247, 235, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 21, cy - 21, 42, 42);
    ctx.fillStyle = '#F8F1E3';
    ctx.font = '700 27px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('电', cx, cy + 1);
  }
  ctx.restore();
}

function drawBookSpine(spec: ShelfBookSpec): THREE.CanvasTexture {
  const width = 256;
  const height = 1024;
  const [canvas, ctx] = makeCanvas(width, height);
  const rand = rng(1300 + spec.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0));
  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, width, height);

  const rounding = ctx.createLinearGradient(0, 0, width, 0);
  rounding.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
  rounding.addColorStop(0.14, 'rgba(0, 0, 0, 0.06)');
  rounding.addColorStop(0.5, 'rgba(255, 255, 255, 0.10)');
  rounding.addColorStop(0.86, 'rgba(0, 0, 0, 0.05)');
  rounding.addColorStop(1, 'rgba(0, 0, 0, 0.36)');
  ctx.fillStyle = rounding;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 700; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(rand() * width, rand() * height, 0.8 + rand() * 2, 0.6 + rand() * 1.8);
  }

  let titleTop = 52;
  const bottomBandHeight = 118;
  if (spec.emblem === 'pearson') titleTop = 196;
  if (spec.band === 'top' || spec.band === 'both') {
    ctx.fillStyle = spec.accent;
    ctx.fillRect(0, 0, width, 74);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(0, 74, width, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.font = '600 21px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.id === 'opencv' ? 'OpenCV 3' : spec.id === 'dip' ? 'IMAGE PROCESSING' : '', width / 2, 38);
    titleTop = 96;
  }

  if (spec.id === 'red-case') {
    ctx.fillStyle = '#EDE5D5';
    roundedRectPath(ctx, 42, 156, 172, 520, 8);
    ctx.fill();
    ctx.strokeStyle = '#8A2B2E';
    ctx.lineWidth = 3;
    roundedRectPath(ctx, 42, 156, 172, 520, 8);
    ctx.stroke();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#742427';
    ctx.font = '600 27px "Microsoft YaHei", "SimHei", sans-serif';
    [...'中国共产党历史'].forEach((char, index) => ctx.fillText(char, 128, 220 + index * 52));
    ctx.fillStyle = 'rgba(116, 36, 39, 0.7)';
    ctx.font = '500 15px "Microsoft YaHei", sans-serif';
    ctx.fillText('中共党史出版社', 128, 640);
    ctx.restore();
    ctx.fillStyle = 'rgba(240, 230, 213, 0.7)';
    ctx.fillRect(24, height - 52, width - 48, 2);
    const texture = makeTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  const chars = [...spec.title];
  const titleBottom = height - bottomBandHeight - 54;
  const line = Math.min(64, (titleBottom - titleTop) / Math.max(1, chars.length));
  const fontSize = Math.max(30, Math.min(60, line * 0.92, width * 0.47));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontSize}px "Microsoft YaHei", "SimHei", sans-serif`;
  ctx.fillStyle = spec.text;
  const titleStart = titleTop + line / 2 + Math.max(0, (titleBottom - titleTop - line * chars.length) * 0.28);
  chars.forEach((char, index) => {
    if (char === ' ') return;
    ctx.fillText(char, width / 2, titleStart + index * line);
  });
  const titleEnd = titleStart + line * Math.max(0, chars.length - 1);
  ctx.restore();

  if (spec.english) {
    ctx.save();
    ctx.translate(30, height - bottomBandHeight - 34);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 21px Arial, sans-serif';
    ctx.fillStyle = spec.text;
    ctx.globalAlpha = 0.78;
    ctx.fillText(spec.english.toUpperCase(), 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (spec.author && titleEnd < height - bottomBandHeight - 150) {
    const authorChars = [...spec.author];
    const aStart = titleEnd + 30;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 23px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = spec.text;
    ctx.globalAlpha = 0.82;
    authorChars.forEach((char, index) => ctx.fillText(char, width / 2, aStart + index * 26));
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawBookEmblem(ctx, spec, width, height);

  const fullPublisherBand = ['ml', 'nutrition', 'running', 'grad-handbook',
    'mockingbird', 'animal-farm', 'robot-vision'].includes(spec.id);
  const publisherChars = [...spec.publisher];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (fullPublisherBand) {
    ctx.fillStyle = '#EDE8DA';
    ctx.fillRect(0, height - bottomBandHeight, width, bottomBandHeight);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, height - bottomBandHeight, width, 2);
    if (spec.band === 'bottom' || spec.band === 'both') {
      ctx.fillStyle = spec.accent;
      ctx.fillRect(0, height - bottomBandHeight - 9, width, 9);
    }
    const publisherFont = Math.max(15, Math.min(23, Math.floor(218 / Math.max(1, publisherChars.length))));
    ctx.fillStyle = '#3B352F';
    ctx.font = `600 ${publisherFont}px "Microsoft YaHei", "SimHei", sans-serif`;
    ctx.fillText(spec.publisher, width / 2, height - bottomBandHeight + 44);
    ctx.fillStyle = 'rgba(59, 53, 47, 0.62)';
    ctx.font = '500 15px Georgia, serif';
    ctx.fillText(spec.id === 'dip' ? 'THIRD EDITION' : 'CHINA', width / 2, height - 42);
  } else {
    // 深色书脊不整条压白，只在底部压一枚出版社小标，避免整排出现同高白条。
    ctx.fillStyle = 'rgba(238, 233, 219, 0.94)';
    roundedRectPath(ctx, 46, height - 118, 164, 74, 4);
    ctx.fill();
    const publisherFont = Math.max(11, Math.min(16, Math.floor(148 / Math.max(1, publisherChars.length))));
    ctx.fillStyle = '#3B352F';
    ctx.font = `600 ${publisherFont}px "Microsoft YaHei", "SimHei", sans-serif`;
    ctx.fillText(spec.publisher, width / 2, height - 78);
    ctx.fillStyle = 'rgba(238, 233, 219, 0.72)';
    ctx.fillRect(34, height - 28, width - 68, 1.5);
  }

  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

let bookPageMaterialCache: THREE.MeshStandardMaterial | null = null;
function bookPageMaterial(): THREE.MeshStandardMaterial {
  if (bookPageMaterialCache) return bookPageMaterialCache;
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#F2EEE2';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 1; y < 256; y += 3) {
    ctx.fillStyle = `rgba(118, 108, 92, ${0.055 + (y % 7) * 0.006})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const texture = makeTexture(canvas);
  bookPageMaterialCache = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.9, metalness: 0.0,
  });
  return bookPageMaterialCache;
}

function addShelfBook(parent: THREE.Object3D, spec: ShelfBookSpec, xCenter: number, zBack: number): THREE.Group {
  const [w, h, d] = spec.size;
  const group = new THREE.Group();
  group.name = `shelf-book-${spec.id}`;
  group.position.set(xCenter, SHELF_PROP_BASE_Y, zBack + d / 2);
  group.rotation.y = spec.yaw ?? 0;

  const coverMaterial = new THREE.MeshStandardMaterial({
    color: spec.base, roughness: 0.77, metalness: 0.02,
  });
  const pages = new THREE.Mesh(
    new RoundedBoxGeometry(Math.max(0.002, w - 0.004), Math.max(0.004, h - 0.006), Math.max(0.002, d - 0.004), 2, 0.0011),
    bookPageMaterial(),
  );
  pages.position.set(0, h / 2, -0.0012);
  pages.castShadow = true;
  pages.receiveShadow = true;

  const coverLeft = new THREE.Mesh(
    new RoundedBoxGeometry(0.0016, h, d, 2, 0.0006),
    coverMaterial,
  );
  coverLeft.position.set(-(w - 0.0016) / 2, h / 2, 0);
  coverLeft.castShadow = true;
  coverLeft.receiveShadow = true;
  const coverRight = coverLeft.clone();
  coverRight.position.x = (w - 0.0016) / 2;

  const spine = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, 0.0018, 2, 0.0006),
    coverMaterial,
  );
  spine.position.set(0, h / 2, d / 2 - 0.0009);
  spine.castShadow = true;
  spine.receiveShadow = true;

  const spinePrint = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.998, h * 0.998),
    new THREE.MeshStandardMaterial({
      map: drawBookSpine(spec), roughness: 0.64, metalness: 0.02,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  spinePrint.position.set(0, h / 2, d / 2 + 0.0002);

  group.add(pages, coverLeft, coverRight, spine, spinePrint);
  parent.add(group);
  return group;
}

let clearPlasticMaterialCache: THREE.MeshPhysicalMaterial | null = null;
function clearPlasticMaterial(): THREE.MeshPhysicalMaterial {
  if (clearPlasticMaterialCache) return clearPlasticMaterialCache;
  clearPlasticMaterialCache = new THREE.MeshPhysicalMaterial({
    color: '#A9C9DB', roughness: 0.08, metalness: 0.0,
    transparent: true, opacity: 0.48, clearcoat: 0.9, clearcoatRoughness: 0.06,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.0,
  });
  return clearPlasticMaterialCache;
}

function addShelfFileBox(parent: THREE.Object3D, xCenter: number): THREE.Group {
  const w = 0.042;
  const h = 0.315;
  const d = 0.288;
  const group = new THREE.Group();
  group.name = 'shelf-file-box';
  group.position.set(xCenter, SHELF_PROP_BASE_Y, -0.154);

  const pages = new THREE.Mesh(
    new RoundedBoxGeometry(w - 0.028, h - 0.082, d - 0.086, 2, 0.0016),
    new THREE.MeshStandardMaterial({ color: '#C7D5D9', roughness: 0.9, metalness: 0.0 }),
  );
  pages.position.set(0, h / 2 - 0.009, 0.0);
  pages.castShadow = true;

  const blueSheet = new THREE.Mesh(
    new RoundedBoxGeometry(w - 0.020, h - 0.050, 0.0016, 1, 0.0006),
    new THREE.MeshStandardMaterial({ color: '#8FB8CE', roughness: 0.38, metalness: 0.0 }),
  );
  blueSheet.position.set(0, h / 2, 0.007);

  const shell = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 3, 0.0035),
    clearPlasticMaterial(),
  );
  shell.position.set(0, h / 2, 0);
  shell.renderOrder = 2;

  const spineStrip = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, 0.0032, 2, 0.0012),
    clearPlasticMaterial(),
  );
  spineStrip.position.set(0, h / 2, d / 2 + 0.0004);

  const rivetMaterial = new THREE.MeshStandardMaterial({ color: '#D8DDDE', roughness: 0.24, metalness: 0.9 });
  for (const fraction of [0.24, 0.53, 0.8]) {
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.0056, 0.0056, 0.0032, 20), rivetMaterial);
    rivet.rotation.x = Math.PI / 2;
    rivet.position.set(0, h * fraction, d / 2 + 0.0026);
    group.add(rivet);
    const rivetPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0024, 0.0024, 0.0036, 12),
      new THREE.MeshStandardMaterial({ color: '#7D8588', roughness: 0.35, metalness: 0.8 }),
    );
    rivetPin.rotation.x = Math.PI / 2;
    rivetPin.position.set(0, h * fraction, d / 2 + 0.0031);
    group.add(rivetPin);
  }

  group.add(pages, blueSheet, shell, spineStrip);
  parent.add(group);
  return group;
}

function drawGiftBoxPavilion(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = '#C6DCFA';
  ctx.lineWidth = 2.6;
  // 歇山屋顶：屋面曲线 + 檐下平线 + 少量脊饰，避免过多排线糊成网格。
  const roof = (cx: number, baseY: number, halfW: number, rise: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - halfW, baseY + rise * 0.46);
    ctx.quadraticCurveTo(cx - halfW * 0.52, baseY - rise * 0.34, cx, baseY - rise);
    ctx.quadraticCurveTo(cx + halfW * 0.52, baseY - rise * 0.34, cx + halfW, baseY + rise * 0.46);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - halfW * 0.99, baseY + rise * 0.6);
    ctx.quadraticCurveTo(cx, baseY + rise * 0.12, cx + halfW * 0.99, baseY + rise * 0.6);
    ctx.stroke();
    ctx.beginPath();
    for (const t of [-0.68, -0.34, 0, 0.34, 0.68]) {
      const x = cx + t * halfW;
      const y = baseY - rise * (1 - Math.abs(t) * 1.05) + rise * 0.2;
      ctx.moveTo(x, y);
      ctx.lineTo(x, baseY + rise * 0.46);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - halfW, baseY + rise * 0.46);
    ctx.quadraticCurveTo(cx - halfW * 1.14, baseY + rise * 0.22, cx - halfW * 1.24, baseY - rise * 0.04);
    ctx.moveTo(cx + halfW, baseY + rise * 0.46);
    ctx.quadraticCurveTo(cx + halfW * 1.14, baseY + rise * 0.22, cx + halfW * 1.24, baseY - rise * 0.04);
    ctx.stroke();
  };
  roof(470, 330, 150, 54);
  roof(470, 388, 196, 44);
  roof(690, 372, 54, 26);
  // 额枋、柱列、栏杆与台基
  ctx.beginPath();
  ctx.moveTo(266, 396);
  ctx.lineTo(674, 396);
  ctx.moveTo(266, 406);
  ctx.lineTo(674, 406);
  ctx.stroke();
  for (let x = 280; x <= 660; x += 63.3) {
    ctx.beginPath();
    ctx.moveTo(x, 410);
    ctx.lineTo(x, 462);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(266, 450);
  ctx.lineTo(674, 450);
  ctx.moveTo(266, 462);
  ctx.lineTo(674, 462);
  ctx.stroke();
  for (let x = 280; x <= 660; x += 63.3) {
    ctx.beginPath();
    ctx.moveTo(x, 450);
    ctx.lineTo(x, 462);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(246, 474);
  ctx.lineTo(694, 474);
  ctx.moveTo(232, 486);
  ctx.lineTo(708, 486);
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(438 + i * 11, 474 + i * 3);
    ctx.lineTo(502 - i * 11, 474 + i * 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGiftBoxCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#EBD188';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(-92, 26);
  ctx.bezierCurveTo(-122, -8, -84, -36, -52, -18);
  ctx.bezierCurveTo(-42, -54, 14, -62, 28, -26);
  ctx.bezierCurveTo(66, -46, 98, -16, 78, 12);
  ctx.bezierCurveTo(106, 18, 100, 40, 72, 42);
  ctx.lineTo(-64, 42);
  ctx.bezierCurveTo(-94, 42, -102, 30, -92, 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-52, 30);
  ctx.bezierCurveTo(-38, 8, -8, 10, -4, 30);
  ctx.moveTo(30, 32);
  ctx.bezierCurveTo(46, 10, 74, 12, 78, 34);
  ctx.stroke();
  ctx.restore();
}

function drawGiftBoxBlossom(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = 'rgba(248, 242, 228, 0.96)';
    ctx.beginPath();
    ctx.ellipse(Math.cos(angle) * radius * 0.6, Math.sin(angle) * radius * 0.6,
      radius * 0.54, radius * 0.35, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(211, 165, 74, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.fillStyle = '#D9A94E';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGiftBoxPlum(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = '#D9B368';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(556, 522);
  ctx.bezierCurveTo(648, 484, 700, 432, 766, 378);
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(636, 468);
  ctx.bezierCurveTo(688, 468, 720, 500, 744, 530);
  ctx.stroke();
  ctx.fillStyle = 'rgba(233, 200, 116, 0.92)';
  for (const [x, y, angle, scale] of [
    [596, 506, -0.5, 1.0], [700, 452, 0.4, 0.85], [750, 512, -0.9, 0.9], [662, 522, 0.2, 0.75],
  ] as Array<[number, number, number, number]>) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 22 * scale, 9 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const [x, y, radius] of [[634, 452, 15], [712, 400, 12], [756, 468, 10]] as Array<[number, number, number]>) {
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = 'rgba(250, 246, 236, 0.96)';
      ctx.beginPath();
      ctx.ellipse(Math.cos(angle) * radius * 0.6, Math.sin(angle) * radius * 0.6,
        radius * 0.56, radius * 0.36, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#D9A94E';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawGiftBoxFront(): THREE.CanvasTexture {
  const width = 1024;
  // 面宽高比 1.667，对应 250 × 150 mm 的横向礼盒。
  const height = 614;
  const [canvas, ctx] = makeCanvas(width, height);
  const rand = rng(6421);

  const background = ctx.createLinearGradient(0, 0, width * 0.9, height);
  background.addColorStop(0, '#E8963A');
  background.addColorStop(0.45, '#EFA640');
  background.addColorStop(0.8, '#F3BC48');
  background.addColorStop(1, '#F4C64E');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const bandGradient = ctx.createLinearGradient(0, height * 0.78, 0, height);
  bandGradient.addColorStop(0, 'rgba(248, 214, 104, 0)');
  bandGradient.addColorStop(0.3, 'rgba(248, 214, 104, 0.92)');
  bandGradient.addColorStop(1, 'rgba(250, 222, 122, 1)');
  ctx.fillStyle = bandGradient;
  ctx.fillRect(0, height * 0.78, width, height * 0.22);
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(146,88,26,0.045)';
    ctx.fillRect(rand() * width, rand() * height, 1 + rand() * 2.2, 1 + rand() * 1.8);
  }

  // 月盘：圆心在盒面下方的大圆，弧顶横跨窗口上方（参考 giftbox-ref-full.jpg）。
  const moon = { x: 608, y: 552, r: 457 };
  const moonFill = ctx.createRadialGradient(moon.x, 110, 60, moon.x, moon.y, moon.r);
  moonFill.addColorStop(0, 'rgba(255, 246, 202, 0.99)');
  moonFill.addColorStop(0.5, 'rgba(252, 228, 140, 0.97)');
  moonFill.addColorStop(1, 'rgba(246, 206, 106, 0.95)');
  ctx.fillStyle = moonFill;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220, 172, 70, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.stroke();

  // 镂空窗：左段低平，向右经如意收头抬到高位（参考窗口右段更高）。
  const win = { x0: 300, x1: 758, yBot: 518, yTL: 282, yTR: 196 };
  const windowPath = new Path2D();
  windowPath.moveTo(win.x0, win.yBot);
  windowPath.lineTo(win.x0, win.yTL);
  windowPath.bezierCurveTo(win.x0 + 120, win.yTL - 6, win.x0 + 210, win.yTL - 10, win.x0 + 266, win.yTL - 18);
  windowPath.bezierCurveTo(win.x0 + 298, win.yTL - 24, win.x0 + 300, win.yTR + 34, win.x0 + 336, win.yTR + 16);
  windowPath.bezierCurveTo(win.x0 + 360, win.yTR + 5, win.x0 + 386, win.yTR, win.x0 + 412, win.yTR);
  windowPath.lineTo(win.x1, win.yTR);
  windowPath.lineTo(win.x1, win.yBot);
  windowPath.closePath();

  ctx.save();
  ctx.clip(windowPath);
  const innerGradient = ctx.createLinearGradient(win.x0, win.yTR - 90, win.x1, win.yBot);
  innerGradient.addColorStop(0, '#1D53C2');
  innerGradient.addColorStop(0.5, '#1747AE');
  innerGradient.addColorStop(1, '#103A8C');
  ctx.fillStyle = innerGradient;
  ctx.fillRect(win.x0 - 6, win.yTR - 104, win.x1 - win.x0 + 12, win.yBot - win.yTR + 108);

  ctx.strokeStyle = 'rgba(163, 197, 240, 0.2)';
  ctx.lineWidth = 1.3;
  for (let x = 606; x < win.x1; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 276);
    ctx.lineTo(x, 476);
    ctx.stroke();
  }
  for (let y = 276; y < 476; y += 30) {
    ctx.beginPath();
    ctx.moveTo(606, y);
    ctx.lineTo(win.x1, y);
    ctx.stroke();
  }
  drawGiftBoxPavilion(ctx);
  drawGiftBoxCloud(ctx, 648, 424, 0.88);
  drawGiftBoxPlum(ctx);

  // 窗内左下角的实体插卡（参考照片里透出的灰色纸片）。
  const stripTop = win.yTL - 6;
  const stripBottom = win.yTL + 0.58 * (win.yBot - win.yTL);
  const grayStrip = ctx.createLinearGradient(win.x0, 0, win.x0 + 40, 0);
  grayStrip.addColorStop(0, 'rgba(118, 128, 140, 0.96)');
  grayStrip.addColorStop(0.72, 'rgba(148, 158, 170, 0.92)');
  grayStrip.addColorStop(1, 'rgba(148, 158, 170, 0)');
  ctx.fillStyle = grayStrip;
  ctx.fillRect(win.x0, stripTop, 40, stripBottom - stripTop);
  ctx.restore();

  ctx.strokeStyle = '#F7E3BE';
  ctx.lineWidth = 7;
  ctx.stroke(windowPath);
  ctx.strokeStyle = 'rgba(206, 158, 62, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke(windowPath);

  drawGiftBoxBlossom(ctx, win.x1 - 54, win.yTR - 4, 13);

  const tracked = (text: string, x: number, y: number, spacing: number, align: CanvasTextAlign) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const chars = [...text];
    const widths = chars.map((char) => ctx.measureText(char).width);
    const total = widths.reduce((sum, w) => sum + w, 0) + spacing * (chars.length - 1);
    let cursor = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
    chars.forEach((char, index) => {
      ctx.fillText(char, cursor, y);
      cursor += widths[index] + spacing;
    });
  };
  ctx.fillStyle = '#DFB455';
  ctx.font = '600 34px Georgia, "Times New Roman", serif';
  tracked('MID-AUTUMN', 70, 84, 7, 'left');
  ctx.font = '600 36px Georgia, "Times New Roman", serif';
  tracked('FESTIVAL', width - 70, 84, 9, 'right');

  ctx.save();
  ctx.strokeStyle = 'rgba(208, 160, 70, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(520, 150, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(520, 150, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(208, 160, 70, 0.85)';
  ctx.beginPath();
  ctx.arc(520, 150, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '500 17px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('华中科技大学', 550, 151);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 132px "Microsoft YaHei", "SimHei", sans-serif';
  for (const [chars, cx] of [[['月', '耀'], 152], [['喻', '园'], 872]] as Array<[string[], number]>) {
    chars.forEach((char, index) => {
      const y = 300 + index * 148;
      ctx.fillStyle = 'rgba(196, 132, 58, 0.32)';
      ctx.fillText(char, cx + 4, y + 5);
      ctx.fillStyle = '#F4CFA0';
      ctx.fillText(char, cx, y);
    });
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#C08A3E';
  ctx.font = '500 22px "Microsoft YaHei", "SimHei", sans-serif';
  tracked('月满人团圆', 388, 578, 12, 'left');
  tracked('千里共婵娟', 596, 578, 12, 'left');
  for (const [x, color, radius] of [
    [286, 'rgba(211, 158, 66, 0.9)', 3.4],
    [306, 'rgba(211, 158, 66, 0.9)', 3.4],
    [326, 'rgba(198, 62, 52, 0.9)', 3.6],
    [742, 'rgba(211, 158, 66, 0.9)', 3.4],
    [762, 'rgba(211, 158, 66, 0.9)', 3.4],
  ] as Array<[number, string, number]>) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, 578, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(211, 158, 66, 0.75)';
  ctx.lineWidth = 2;
  for (const x of [782, 800]) {
    ctx.beginPath();
    ctx.arc(x, 578, 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(233, 200, 120, 0.72)';
  for (const [x, y, angle, scale] of [
    [252, 236, -0.7, 1.0], [286, 316, 0.4, 0.8], [212, 300, 1.1, 0.7],
    [712, 250, 0.5, 0.9], [760, 208, -0.4, 0.8], [640, 214, 2.2, 0.7],
  ] as Array<[number, number, number, number]>) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 17 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
function addShelfGiftBox(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const width = 0.25;
  const height = 0.15;
  const depth = 0.055;
  const group = new THREE.Group();
  group.name = 'shelf-gift-box';
  group.position.set(x, SHELF_GIFT_BASE_Y, z);
  group.rotation.y = 0.03;
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(width, height, depth, 3, 0.0024),
    new THREE.MeshStandardMaterial({ color: '#E99A37', roughness: 0.82, metalness: 0.0 }),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.002, height - 0.002),
    new THREE.MeshStandardMaterial({
      map: drawGiftBoxFront(), roughness: 0.8, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  front.position.set(0, height / 2 + 0.001, depth / 2 + 0.0005);
  group.add(body, front);
  parent.add(group);
  return group;
}

function drawTeaTinWrap(): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const [canvas, ctx] = makeCanvas(width, height);
  const rand = rng(9182);
  ctx.fillStyle = '#1B1A1C';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 1200; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(rand() * width, rand() * height, 1.2 + rand() * 2, 0.7 + rand() * 1.4);
  }
  ctx.strokeStyle = '#B58C3D';
  ctx.lineWidth = 4;
  ctx.strokeRect(56, 52, width - 112, height - 104);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(72, 68, width - 144, height - 136);

  const logoX = 860;
  ctx.save();
  ctx.fillStyle = '#C89A43';
  ctx.beginPath();
  ctx.moveTo(logoX, 206);
  ctx.bezierCurveTo(logoX + 46, 262, logoX + 38, 330, logoX, 352);
  ctx.bezierCurveTo(logoX - 38, 330, logoX - 46, 262, logoX, 206);
  ctx.fill();
  ctx.fillStyle = '#1B1A1C';
  ctx.beginPath();
  ctx.moveTo(logoX, 236);
  ctx.bezierCurveTo(logoX + 24, 274, logoX + 20, 316, logoX, 326);
  ctx.bezierCurveTo(logoX - 20, 316, logoX - 24, 274, logoX, 236);
  ctx.fill();
  ctx.fillStyle = '#C89A43';
  ctx.beginPath();
  ctx.moveTo(logoX + 3, 194);
  ctx.lineTo(logoX + 11, 210);
  ctx.lineTo(logoX + 3, 206);
  ctx.lineTo(logoX - 4, 210);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 66px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.fillText('武夷星', logoX, 438);
  ctx.font = '500 22px Georgia, serif';
  ctx.globalAlpha = 0.8;
  ctx.fillText('W U Y I S T A R', logoX, 490);
  ctx.restore();

  const branch = (startX: number, startY: number, endX: number, endY: number) => {
    ctx.strokeStyle = '#9A7638';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(startX + 130, startY - 80, endX - 170, endY + 120, endX, endY);
    ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(startX + 120, startY - 48);
    ctx.bezierCurveTo(startX + 180, startY - 130, endX - 260, endY - 30, endX - 130, endY - 70);
    ctx.stroke();
  };
  branch(1030, 770, 1540, 300);
  branch(1180, 620, 1680, 440);
  branch(1120, 470, 1420, 250);

  const leaf = (x: number, y: number, angle: number, scale: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#4E7249';
    ctx.beginPath();
    ctx.ellipse(0, 0, 30 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(206, 176, 108, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-26 * scale, 0);
    ctx.lineTo(26 * scale, 0);
    ctx.stroke();
    ctx.restore();
  };
  for (const [x, y, angle, scale] of [
    [1080, 700, -0.5, 1.15], [1160, 560, 0.2, 1.05], [1310, 420, -0.9, 1.25],
    [1410, 590, 0.7, 1.0], [1480, 340, -0.2, 1.05], [1560, 500, 0.5, 1.15],
    [1210, 750, -0.15, 0.95], [1600, 690, 0.25, 0.95], [1260, 460, 1.1, 0.9],
    [1520, 230, 0.35, 0.85],
  ] as Array<[number, number, number, number]>) {
    leaf(x, y, angle, scale);
  }

  const flower = (x: number, y: number, radius: number) => {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(241, 232, 216, 0.96)' : 'rgba(226, 199, 195, 0.96)';
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(angle) * radius * 0.72, y + Math.sin(angle) * radius * 0.72,
        radius * 0.56, radius * 0.34, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#C99A47';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(201, 154, 71, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.86, 0, Math.PI * 2);
    ctx.stroke();
  };
  flower(1300, 470, 56);
  flower(1470, 300, 42);
  flower(1540, 640, 38);
  flower(1220, 690, 30);

  ctx.save();
  ctx.translate(1290, 820);
  ctx.rotate(-0.06);
  ctx.fillStyle = 'rgba(157, 40, 47, 0.92)';
  roundedRectPath(ctx, -48, -48, 96, 96, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(239, 214, 170, 0.7)';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, -38, -38, 76, 76, 12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(247, 232, 205, 0.9)';
  ctx.font = '600 26px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('茶', 0, 1);
  ctx.restore();

  const texture = makeTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function addShelfTeaTin(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const radius = 0.065;
  const bodyHeight = 0.192;
  const group = new THREE.Group();
  group.name = 'shelf-tea-tin';
  group.position.set(x, SHELF_CAN_BASE_Y, z);

  const tinMaterial = new THREE.MeshStandardMaterial({ color: '#1C1B1D', roughness: 0.52, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bodyHeight, 64, 2, false), tinMaterial);
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;

  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.0004, radius + 0.0004, bodyHeight - 0.006, 64, 1, true),
    new THREE.MeshStandardMaterial({ map: drawTeaTinWrap(), roughness: 0.5, metalness: 0.08 }),
  );
  wrap.position.y = bodyHeight / 2;
  wrap.rotation.y = Math.PI;
  wrap.castShadow = false;

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.0032, radius + 0.0032, 0.018, 64, 1, false), tinMaterial);
  lid.position.y = bodyHeight + 0.009;
  lid.castShadow = true;
  const lidTop = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.0014, radius + 0.0014, 0.0016, 64),
    new THREE.MeshStandardMaterial({ color: '#111113', roughness: 0.3, metalness: 0.4 }),
  );
  lidTop.position.y = bodyHeight + 0.0188;

  const goldRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius + 0.0024, 0.0009, 8, 80),
    new THREE.MeshStandardMaterial({ color: '#B28A42', roughness: 0.3, metalness: 0.78 }),
  );
  goldRing.rotation.x = Math.PI / 2;
  goldRing.position.y = bodyHeight + 0.0008;

  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius - 0.0004, 0.0007, 6, 72),
    new THREE.MeshStandardMaterial({ color: '#8E6F35', roughness: 0.42, metalness: 0.7 }),
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.004;

  group.add(body, wrap, lid, lidTop, goldRing, baseRing);
  parent.add(group);
  return group;
}

function drawJarLabel(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const [canvas, ctx] = makeCanvas(width, height);
  const rand = rng(2251);
  ctx.fillStyle = '#EDEAE1';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(105,95,78,0.035)';
    ctx.fillRect(rand() * width, rand() * height, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.fillStyle = '#5E3F7E';
  ctx.fillRect(0, 0, width, 92);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = '600 30px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('桑 · 黑果枸杞', width / 2, 47);

  ctx.strokeStyle = 'rgba(107, 77, 134, 0.45)';
  ctx.lineWidth = 3;
  roundedRectPath(ctx, 262, 116, 500, 356, 10);
  ctx.stroke();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#292723';
  ctx.font = '700 68px "Microsoft YaHei", "SimHei", sans-serif';
  [...'黑果枸杞'].forEach((char, index) => ctx.fillText(char, 512, 176 + index * 72));
  ctx.fillStyle = 'rgba(56, 52, 46, 0.66)';
  ctx.font = '500 19px Arial, sans-serif';
  ctx.fillText('BLACK GOJI BERRY', 512, 447);
  ctx.restore();

  ctx.fillStyle = 'rgba(64, 60, 54, 0.72)';
  ctx.font = '500 18px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('净含量 150 g', 300, 168);
  ctx.fillText('产地 宁夏', 300, 200);
  ctx.fillText('储存 阴凉干燥处', 300, 232);
  ctx.fillStyle = 'rgba(120, 116, 106, 0.55)';
  ctx.font = '400 14px "Microsoft YaHei", sans-serif';
  ctx.fillText('颗粒饱满 · 色泽紫黑', 300, 286);
  ctx.fillText('适合泡水、煮粥', 300, 310);

  const qrX = 706;
  const qrY = 160;
  const cell = 11;
  ctx.fillStyle = '#2A2926';
  for (let y = 0; y < 13; y += 1) {
    for (let x = 0; x < 13; x += 1) {
      if (rand() > 0.5) ctx.fillRect(qrX + x * cell, qrY + y * cell, cell - 2, cell - 2);
    }
  }
  ctx.strokeStyle = 'rgba(58, 56, 51, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(qrX - 6, qrY - 6, 13 * cell + 10, 13 * cell + 10);
  ctx.fillStyle = 'rgba(60, 57, 52, 0.55)';
  ctx.font = '400 11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCAN FOR TRACE', qrX + 68, qrY + 168);

  ctx.fillStyle = 'rgba(107, 77, 134, 0.16)';
  ctx.fillRect(0, height - 40, width, 40);
  ctx.fillStyle = 'rgba(64, 60, 54, 0.52)';
  ctx.font = '500 14px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('宁夏黑果枸杞 · 花青素', width / 2, height - 19);

  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function addShelfGlassJar(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const radius = 0.045;
  const bodyHeight = 0.105;
  const group = new THREE.Group();
  group.name = 'shelf-goji-jar';
  group.position.set(x, SHELF_CAN_BASE_Y, z);

  const contentsMaterial = new THREE.MeshStandardMaterial({ color: '#1C0F20', roughness: 0.92, metalness: 0.02 });
  const contents = new THREE.Mesh(
    new THREE.CylinderGeometry(radius - 0.007, radius - 0.009, 0.062, 40),
    contentsMaterial,
  );
  // 参考里果料只装到约六成，上部留空，玻璃更透。
  contents.position.y = 0.033;
  contents.castShadow = true;

  const berryMaterial = new THREE.MeshStandardMaterial({ color: '#331B38', roughness: 0.62, metalness: 0.02 });
  const berryGeometry = new THREE.SphereGeometry(0.0043, 8, 6);
  const berries = new THREE.InstancedMesh(berryGeometry, berryMaterial, 46);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < 46; i += 1) {
    const angle = i * 2.399963;
    const r = 0.004 + (i % 7) * 0.0042;
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * r, 0.061 + (i % 5) * 0.0022, Math.sin(angle) * r),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    berries.setMatrixAt(i, matrix);
    color.set(i % 3 === 0 ? '#3E2044' : '#1B0D20');
    berries.setColorAt(i, color);
  }
  berries.instanceMatrix.needsUpdate = true;
  if (berries.instanceColor) berries.instanceColor.needsUpdate = true;

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#E9F2EF', roughness: 0.08, metalness: 0.0,
    transmission: 0.5, thickness: 0.0025, ior: 1.48,
    transparent: true, opacity: 0.14, side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bodyHeight, 48, 1, true), glassMaterial);
  glass.position.y = bodyHeight / 2;
  glass.castShadow = false;
  const glassBottom = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.003, 48), glassMaterial);
  glassBottom.position.y = 0.0015;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.0014, 8, 64),
    glassMaterial,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = bodyHeight;

  const labelMaterial = new THREE.MeshStandardMaterial({
    map: drawJarLabel(), roughness: 0.52, metalness: 0.02, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.0005, radius + 0.0005, 0.058, 48, 1, true, -Math.PI * 0.56, Math.PI * 1.12),
    labelMaterial,
  );
  label.position.y = 0.049;

  const lidMaterial = new THREE.MeshStandardMaterial({ color: '#8B9092', roughness: 0.34, metalness: 0.9 });
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.0018, radius + 0.0018, 0.017, 48, 1, false), lidMaterial);
  lid.position.y = bodyHeight + 0.0085;
  lid.castShadow = true;
  const lidRib = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.0022, radius + 0.0022, 0.006, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#7E8486', roughness: 0.38, metalness: 0.86,
      bumpMap: surfaceTexture('metal', 256, 10), bumpScale: 0.0004,
    }),
  );
  lidRib.position.y = bodyHeight + 0.005;
  const gasket = new THREE.Mesh(
    new THREE.TorusGeometry(radius + 0.0004, 0.0012, 6, 56),
    new THREE.MeshStandardMaterial({ color: '#3E4142', roughness: 0.7, metalness: 0.1 }),
  );
  gasket.rotation.x = Math.PI / 2;
  gasket.position.y = bodyHeight - 0.0005;

  const [glintCanvas, glintCtx] = makeCanvas(64, 256);
  const glintGradient = glintCtx.createLinearGradient(0, 0, 0, 256);
  glintGradient.addColorStop(0, 'rgba(255,255,255,0)');
  glintGradient.addColorStop(0.42, 'rgba(255,255,255,0.7)');
  glintGradient.addColorStop(0.65, 'rgba(255,255,255,0.08)');
  glintGradient.addColorStop(1, 'rgba(255,255,255,0)');
  glintCtx.fillStyle = glintGradient;
  glintCtx.fillRect(0, 0, 64, 256);
  const glintTexture = makeTexture(glintCanvas);
  glintTexture.wrapS = THREE.ClampToEdgeWrapping;
  glintTexture.wrapT = THREE.ClampToEdgeWrapping;
  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(0.007, 0.086),
    new THREE.MeshBasicMaterial({
      map: glintTexture, transparent: true, opacity: 0.44, depthWrite: false, toneMapped: false,
    }),
  );
  glint.position.set(-0.022, 0.055, radius - 0.0015);
  glint.renderOrder = 4;

  group.add(contents, berries, glass, glassBottom, rim, label, lid, lidRib, gasket, glint);
  parent.add(group);
  return group;
}

function drawShelfPaper(withMarks: boolean): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  const rand = rng(withMarks ? 771 : 772);
  ctx.fillStyle = '#F3F0E7';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(150,142,126,0.045)';
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 3, 0.6 + rand() * 1.2);
  }
  if (withMarks) {
    ctx.strokeStyle = 'rgba(80, 106, 128, 0.28)';
    ctx.lineWidth = 1.2;
    for (let y = 140; y < 440; y += 34) {
      ctx.beginPath();
      ctx.moveTo(58, y);
      ctx.lineTo(452, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(56, 72, 86, 0.5)';
    ctx.lineWidth = 3;
    for (const [x, y, length] of [[84, 172, 120], [84, 240, 190], [84, 308, 160], [84, 376, 210]] as Array<[number, number, number]>) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 8; i += 1) {
        ctx.lineTo(x + (length / 8) * (i + 1), y + Math.sin(i * 1.7 + x) * 5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(66, 82, 96, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(300, 150);
    ctx.lineTo(360, 420);
    ctx.stroke();
  }
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function addShelfPaperSheet(
  parent: THREE.Object3D,
  x: number, z: number, yTop: number,
  width = 0.297, depth = 0.21, rotationY = 0, withMarks = false,
): THREE.Mesh {
  const thickness = 0.0007;
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(width, thickness, depth, 1, 0.00025),
    new THREE.MeshStandardMaterial({
      map: drawShelfPaper(withMarks), roughness: 0.93, metalness: 0.0,
    }),
  );
  mesh.name = 'shelf-paper-sheet';
  mesh.position.set(x, yTop - thickness / 2, z);
  mesh.rotation.y = rotationY;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addShelfContactShadow(
  parent: THREE.Object3D, x: number, z: number, w: number, d: number, opacity: number,
  y = SHELF_TOP_Y + 0.00012,
): void {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: drawContactShadowTexture(), color: '#000000', transparent: true,
      opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 2;
  parent.add(mesh);
}

// 参考图架内右前方是一件黑色剪刀（用户更正，不是订书机）：平放、刀尖朝左、
// 双指环在右侧靠近格架侧板，整体落在纸面/搁板交界处。
function addShelfScissors(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shelf-scissors';
  group.position.set(x, SHELF_PAPER_B_TOP_Y + 0.0045, z);
  group.rotation.y = Math.PI + 0.06;
  const flat = new THREE.Group();
  // 平放：先绕 X 轴放倒，再让刀尖一端略低、指环一端略高，使刀刃贴住纸面。
  flat.rotation.x = -Math.PI / 2;
  flat.rotation.y = 0.0195;
  group.add(flat);

  const bladeMaterial = new THREE.MeshStandardMaterial({ color: '#2A2D30', roughness: 0.3, metalness: 0.78 });
  const handleMaterial = new THREE.MeshStandardMaterial({ color: '#17181A', roughness: 0.45, metalness: 0.12 });
  const screwMaterial = new THREE.MeshStandardMaterial({ color: '#A8ADAE', roughness: 0.3, metalness: 0.9 });
  const extrude = (shape: THREE.Shape, depth: number) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });

  const bladeShape = (side: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(0.006, side * 0.0016);
    shape.lineTo(0.034, side * 0.0092);
    shape.lineTo(0.062, side * 0.0078);
    shape.lineTo(0.075, side * 0.0026);
    shape.lineTo(0.052, side * 0.0016);
    shape.lineTo(0.006, side * 0.0016);
    return shape;
  };
  for (const side of [1, -1]) {
    const blade = new THREE.Mesh(extrude(bladeShape(side), 0.0024), bladeMaterial);
    blade.position.z = side * 0.0012;
    blade.castShadow = true;
    flat.add(blade);
  }

  const shankShape = (side: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(0.004, side * 0.0022);
    shape.lineTo(-0.028, side * 0.0115);
    shape.lineTo(-0.05, side * 0.0235);
    shape.lineTo(-0.055, side * 0.0335);
    shape.lineTo(-0.042, side * 0.0355);
    shape.lineTo(-0.028, side * 0.0255);
    shape.lineTo(-0.008, side * 0.0145);
    shape.lineTo(0.004, side * 0.0075);
    return shape;
  };
  for (const side of [1, -1]) {
    const shank = new THREE.Mesh(extrude(shankShape(side), 0.0034), handleMaterial);
    shank.position.z = side * 0.0017;
    shank.castShadow = true;
    flat.add(shank);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0115, 0.0036, 12, 32), handleMaterial);
    ring.position.set(-0.059, side * 0.029, side * 0.0017);
    ring.castShadow = true;
    flat.add(ring);
  }

  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.0046, 20), screwMaterial);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(0.008, 0, 0);
  flat.add(screw);

  parent.add(group);
  return group;
}

function addShelfTopClutter(parent: THREE.Object3D): void {
  const greenBook = new THREE.Mesh(
    new RoundedBoxGeometry(0.19, 0.012, 0.13, 2, 0.002),
    new THREE.MeshStandardMaterial({ color: '#4C8457', roughness: 0.8, metalness: 0.0 }),
  );
  greenBook.name = 'shelf-top-green-book';
  greenBook.position.set(-0.355, HUTCH_TOP_Y + 0.0066, -0.145);
  greenBook.rotation.y = 0.06;
  // 顶板不参与投影以免压暗格架内部；顶面物件改用接触阴影贴地。
  greenBook.castShadow = false;

  const greenBox = new THREE.Mesh(
    new RoundedBoxGeometry(0.16, 0.052, 0.12, 3, 0.004),
    new THREE.MeshStandardMaterial({ color: '#3E7B4B', roughness: 0.78, metalness: 0.0 }),
  );
  greenBox.name = 'shelf-top-green-box';
  greenBox.position.set(-0.31, HUTCH_TOP_Y + 0.038, -0.18);
  greenBox.rotation.y = -0.12;
  greenBox.castShadow = false;

  const [labelCanvas, labelCtx] = makeCanvas(256, 256);
  labelCtx.fillStyle = 'rgba(247, 247, 238, 0.92)';
  labelCtx.fillRect(0, 0, 256, 256);
  const rand = rng(3312);
  labelCtx.fillStyle = '#2E4936';
  labelCtx.font = '600 24px "Microsoft YaHei", sans-serif';
  labelCtx.textAlign = 'center';
  labelCtx.fillText('办公用品', 128, 42);
  labelCtx.fillStyle = '#1E1E1E';
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (rand() > 0.5) labelCtx.fillRect(88 + x * 9, 76 + y * 9, 7, 7);
    }
  }
  labelCtx.fillStyle = '#3A5D43';
  labelCtx.font = '500 16px Arial, sans-serif';
  labelCtx.fillText('OFFICE SET', 128, 196);
  const labelTexture = makeTexture(labelCanvas);
  labelTexture.wrapS = THREE.ClampToEdgeWrapping;
  labelTexture.wrapT = THREE.ClampToEdgeWrapping;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.05, 0.042),
    new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.88, metalness: 0.0 }),
  );
  label.position.set(0, 0, 0.0604);
  greenBox.add(label);

  addShelfPaperSheet(parent, 0.29, -0.21, HUTCH_TOP_Y + 0.0012, 0.297, 0.21, -0.035);
  addShelfPaperSheet(parent, 0.34, -0.155, HUTCH_TOP_Y + 0.0021, 0.297, 0.21, 0.055);
  addShelfContactShadow(parent, -0.33, -0.16, 0.28, 0.16, 0.2, HUTCH_TOP_Y + 0.00005);
  parent.add(greenBook, greenBox);
}

function shelfPanelWood(
  source: THREE.Mesh | undefined,
  tint: string, vertical: boolean, repeat: number,
): THREE.MeshPhysicalMaterial {
  const base = source?.material as THREE.MeshPhysicalMaterial | undefined;
  const material = base
    ? base.clone() as THREE.MeshPhysicalMaterial
    : new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.6, metalness: 0.0 });
  material.color.set(tint);
  if (base) {
    for (const key of ['map', 'bumpMap', 'roughnessMap'] as const) {
      const texture = base[key] as THREE.Texture | null;
      if (!texture) continue;
      const copy = texture.clone();
      copy.center.set(0.5, 0.5);
      copy.rotation = vertical ? Math.PI / 2 : 0;
      copy.repeat.set(repeat, repeat);
      copy.needsUpdate = true;
      (material as unknown as Record<string, THREE.Texture | null>)[key] = copy;
    }
  }
  material.needsUpdate = true;
  return material;
}

function buildShelfHutch(
  root: THREE.Object3D,
  nodes: Record<string, THREE.Object3D>,
  meshes: Record<string, THREE.Mesh>,
): void {
  // 工厂的旧书列、茶罐和金属托架与参考不符；从父级移除而不是仅隐藏，
  // 避免后续 Box3/AABB 仍把旧件计入。
  for (const id of ['shelfBracketL', 'shelfBracketR', 'shelfProps', 'bookRowB',
    'jarPurple', 'jarOrange', 'teaCanister', 'bookEnd']) {
    const node = nodes[id];
    if (node?.parent) node.parent.remove(node);
  }

  if (meshes.shelf) {
    replaceGeometry(meshes.shelf, new RoundedBoxGeometry(1.05, 0.025, 0.30, 3, 0.0018));
    // 搁板必须参与投影，否则架上物件的阴影会穿过板体落到下方背板上。
    meshes.shelf.castShadow = true;
    meshes.shelf.receiveShadow = true;
  }

  const hutch = new THREE.Group();
  hutch.name = 'shelf-hutch';
  root.add(hutch);

  const structure = new THREE.Group();
  structure.name = 'shelf-hutch-structure';
  hutch.add(structure);

  const backMaterial = shelfPanelWood(meshes.partition, '#C9C0B1', false, 2.4);
  const sideMaterial = shelfPanelWood(meshes.leftSidePanel, '#CCC3B3', true, 1.8);
  const topMaterial = shelfPanelWood(meshes.shelf, '#C3B7A3', false, 1.2);

  const addPanel = (name: string, size: [number, number, number], position: [number, number, number],
    material: THREE.Material): THREE.Mesh => {
    const panel = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.0012), material);
    panel.name = name;
    panel.position.set(...position);
    panel.castShadow = false;
    panel.receiveShadow = true;
    structure.add(panel);
    return panel;
  };

  addPanel('shelf-hutch-back', [1.05, HUTCH_CLEAR_HEIGHT, 0.03], [0, SHELF_TOP_Y + HUTCH_CLEAR_HEIGHT / 2, -0.315], backMaterial);
  addPanel('shelf-hutch-side-left', [0.018, HUTCH_CLEAR_HEIGHT, 0.29], [-0.516, SHELF_TOP_Y + HUTCH_CLEAR_HEIGHT / 2, -0.155], sideMaterial);
  addPanel('shelf-hutch-side-right', [0.018, HUTCH_CLEAR_HEIGHT, 0.29], [0.516, SHELF_TOP_Y + HUTCH_CLEAR_HEIGHT / 2, -0.155], sideMaterial);
  addPanel('shelf-hutch-top', [1.05, HUTCH_TOP_THICKNESS, 0.31], [0, HUTCH_UNDERSIDE_Y + HUTCH_TOP_THICKNESS / 2, -0.155], topMaterial);

  // 背板上的安装孔：参考图中顶板下方的一排黑孔。
  const holeMaterial = new THREE.MeshBasicMaterial({ color: '#3A3129', toneMapped: false });
  const holeGeometry = new THREE.CircleGeometry(0.0036, 16);
  const holes = new THREE.InstancedMesh(holeGeometry, holeMaterial, 8);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 8; i += 1) {
    matrix.makeTranslation(-0.455 + i * 0.13, HUTCH_UNDERSIDE_Y - 0.048, -0.2993);
    holes.setMatrixAt(i, matrix);
  }
  holes.instanceMatrix.needsUpdate = true;
  holes.name = 'shelf-hutch-mount-holes';
  holes.renderOrder = 3;
  structure.add(holes);

  const booksGroup = new THREE.Group();
  booksGroup.name = 'shelf-books';
  hutch.add(booksGroup);

  const decorGroup = new THREE.Group();
  decorGroup.name = 'shelf-decor';
  hutch.add(decorGroup);

  const topGroup = new THREE.Group();
  topGroup.name = 'shelf-top-items';
  hutch.add(topGroup);

  // 左侧被前排书遮住一半的红色硬壳书盒，补足参考图左端的红色量体。
  const redCase = addShelfBook(booksGroup, {
    id: 'red-case', title: '中国共产党历史', publisher: '中共党史出版社',
    base: '#B93A3C', text: '#F6EAD9', accent: '#E0C4A8', band: 'none',
    size: [0.030, 0.288, 0.150], yaw: 0.03,
  }, -0.484, -0.292);
  redCase.name = 'shelf-book-red-case';

  let cursor = -0.462;
  let bookCount = 0;
  let fileBoxX = 0;
  for (const spec of SHELF_BOOKS) {
    const [width] = spec.size;
    const gap = bookCount === 0 ? 0 : 0.0022;
    cursor += gap;
    const xCenter = cursor + width / 2;
    if (spec.fileBox) {
      fileBoxX = addShelfFileBox(booksGroup, xCenter).position.x;
    } else {
      addShelfBook(booksGroup, spec, xCenter, SHELF_BACK_Z + (spec.depthOffset ?? 0));
      bookCount += 1;
    }
    cursor += width;
  }

  const bookRowEnd = cursor;
  const giftCenter = bookRowEnd + 0.010 + 0.125;
  addShelfGiftBox(decorGroup, giftCenter, -0.17);
  const jarCenter = giftCenter + 0.125 + 0.006 + 0.0472;
  addShelfGlassJar(decorGroup, jarCenter, -0.17);
  const tinCenter = jarCenter + 0.0472 + 0.007 + 0.0683;
  addShelfTeaTin(decorGroup, tinCenter, -0.17);

  // 白色纸张：礼盒与罐体下分层铺纸，前方再压一张带手写字的散纸。
  addShelfPaperSheet(decorGroup, 0.09, -0.16, SHELF_PAPER_TOP_Y, 0.23, 0.21, 0.02, false);
  addShelfPaperSheet(decorGroup, 0.36, -0.16, SHELF_PAPER_B_TOP_Y, 0.28, 0.21, 0.03, false);
  addShelfPaperSheet(decorGroup, 0.105, -0.058, SHELF_PAPER_STACK_TOP_Y, 0.26, 0.09, 0.04, true);

  addShelfScissors(decorGroup, 0.42, -0.05);

  const foldedPaper = new THREE.Mesh(
    new RoundedBoxGeometry(0.018, 0.08, 0.045, 2, 0.003),
    new THREE.MeshStandardMaterial({ color: '#EEEBE2', roughness: 0.92, metalness: 0.0 }),
  );
  foldedPaper.name = 'shelf-folded-paper';
  foldedPaper.position.set(0.492, SHELF_PAPER_B_TOP_Y + 0.0402, -0.205);
  foldedPaper.rotation.set(0, 0.12, 0);
  foldedPaper.castShadow = true;
  decorGroup.add(foldedPaper);

  addShelfContactShadow(decorGroup, -0.25, -0.185, 0.46, 0.22, 0.22);
  addShelfContactShadow(decorGroup, fileBoxX, -0.155, 0.07, 0.30, 0.18);
  addShelfContactShadow(decorGroup, giftCenter, -0.17, 0.285, 0.11, 0.26, SHELF_PAPER_TOP_Y + 0.00005);
  addShelfContactShadow(decorGroup, jarCenter, -0.17, 0.11, 0.11, 0.28, SHELF_PAPER_B_TOP_Y + 0.00005);
  addShelfContactShadow(decorGroup, tinCenter, -0.17, 0.15, 0.15, 0.3, SHELF_PAPER_B_TOP_Y + 0.00005);
  addShelfContactShadow(decorGroup, 0.42, -0.05, 0.17, 0.07, 0.22, SHELF_PAPER_B_TOP_Y + 0.00005);

  addShelfTopClutter(topGroup);

  // 让三组小物件在审计中可独立寻址。
  hutch.userData.shelfHutch = {
    innerClearHeight: HUTCH_CLEAR_HEIGHT,
    topY: HUTCH_TOP_Y,
    bookRowEnd,
    giftCenter,
    jarCenter,
    tinCenter,
  };
}

function createMousepadSurface(pad: THREE.Object3D): void {
  const [canvas, ctx] = makeCanvas(1024, 512);
  ctx.clearRect(0, 0, 1024, 512);
  // Print only; the woven base remains the underlying mesh.
  ctx.save();
  ctx.translate(0, 0);
  // 中央深灰几何印花：大块折角带 + 竖条 + 角标（参考 鼠标垫-1.jpg 的斜向大印花）。
  ctx.fillStyle = 'rgba(64, 69, 74, 0.92)';
  ctx.beginPath();
  ctx.moveTo(336, 512);
  ctx.lineTo(336, 306);
  ctx.lineTo(470, 168);
  ctx.lineTo(556, 168);
  ctx.lineTo(556, 258);
  ctx.lineTo(434, 396);
  ctx.lineTo(434, 512);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(586, 512);
  ctx.lineTo(586, 150);
  ctx.lineTo(648, 96);
  ctx.lineTo(648, 512);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(78, 84, 90, 0.6)';
  ctx.fillRect(676, 168, 24, 300);
  ctx.fillRect(736, 224, 14, 220);
  ctx.strokeStyle = 'rgba(72, 78, 84, 0.62)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(60, 512);
  ctx.lineTo(150, 430);
  ctx.lineTo(150, 340);
  ctx.lineTo(246, 266);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(120, 60);
  ctx.lineTo(214, 148);
  ctx.lineTo(300, 148);
  ctx.stroke();
  ctx.fillStyle = 'rgba(54, 59, 63, 0.9)';
  ctx.font = '600 19px "Segoe UI", Arial, sans-serif';
  ctx.fillText('inphic', 880, 70);
  ctx.font = '500 10px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(84, 90, 94, 0.8)';
  // 10/11.jpg 垫面印有 Inspiring Innovation 长句。
  ctx.fillText('Inspiring Innovation Persistent', 640, 90);
  // 右上角虚线装饰。
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.arc(850 + i * 12, 110, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 四角小标记与点列（参考垫的角部符号）。
  ctx.fillStyle = 'rgba(70, 76, 82, 0.75)';
  ctx.beginPath();
  ctx.arc(92, 92, 4, 0, Math.PI * 2);
  ctx.arc(116, 104, 4, 0, Math.PI * 2);
  ctx.arc(104, 124, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70, 76, 82, 0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(920, 452);
  ctx.lineTo(966, 452);
  ctx.moveTo(943, 430);
  ctx.lineTo(943, 474);
  ctx.stroke();
  ctx.restore();
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, roughness: 0.86, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false,
  });
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.26), material);
  print.rotation.x = -Math.PI / 2;
  print.position.set(0, 0.0026, 0);
  print.renderOrder = 2;
  pad.add(print);

  const stitchCount = 220;
  const stitchGeo = new THREE.BoxGeometry(0.0021, 0.0009, 0.0052);
  const stitchMat = new THREE.MeshStandardMaterial({ color: '#C6C9C9', roughness: 0.66 });
  const stitches = new THREE.InstancedMesh(stitchGeo, stitchMat, stitchCount);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const halfW = 0.158;
  const halfD = 0.128;
  const radius = 0.012;
  for (let i = 0; i < stitchCount; i += 1) {
    const t = (i / stitchCount) * Math.PI * 2;
    const x = Math.sign(Math.cos(t)) * (halfW - radius) + Math.cos(t) * radius;
    const z = Math.sign(Math.sin(t)) * (halfD - radius) + Math.sin(t) * radius;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t + Math.PI / 2);
    matrix.compose(new THREE.Vector3(x, 0.0032, z), q, new THREE.Vector3(1, 1, 1));
    stitches.setMatrixAt(i, matrix);
  }
  stitches.instanceMatrix.needsUpdate = true;
  stitches.castShadow = false;
  pad.add(stitches);
}

function createLaptopKeys(deck: THREE.Object3D): void {
  // 参考机械革命耀世 16 Ultra：白色全尺寸键盘，主键区 15U + 半 U 分隔 + 4U 小键盘。
  const U = 0.0162;
  const gap = 0.00125;
  const keyW = U - gap;
  const rowPitch = 0.0163;
  const keyD = rowPitch - gap;
  const keyH = 0.0028;
  const keyY = 0.0020;
  const row0 = -0.057;
  const totalUnits = 19.5;
  const left = -(totalUnits * U) / 2;
  const xOf = (u: number) => left + u * U;
  const zOf = (row: number) => row0 + row * rowPitch;

  const specs: LaptopKeySpec[] = [];
  const key = (u: number, row: number, label: string, w = 1, h = 1, modifier = false) => {
    specs.push({ u, row, w, h, label, modifier });
  };

  // 功能键行：esc + F1–F12 + Del。
  key(0, 0, 'esc', 1, 1, true);
  for (let i = 0; i < 12; i += 1) key(1.5 + i, 0, `F${i + 1}`, 1, 1, true);
  key(13.5, 0, 'Del', 1, 1, true);

  // 主键区第 1 行：数字与退格。
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].forEach((label, i) => key(i, 1, label));
  key(13, 1, 'backspace', 2, 1, true);

  // 主键区第 2 行：Tab、QWERTY、括号与反斜杠。
  key(0, 2, 'tab', 1.5, 1, true);
  'QWERTYUIOP'.split('').forEach((label, i) => key(1.5 + i, 2, label));
  key(11.5, 2, '[');
  key(12.5, 2, ']');
  key(13.5, 2, '\\', 1.5, 1, true);

  // 主键区第 3 行：Caps、ASDF、回车上半段。
  key(0, 3, 'caps', 1.75, 1, true);
  'ASDFGHJKL'.split('').forEach((label, i) => key(1.75 + i, 3, label));
  key(10.75, 3, ';');
  key(11.75, 3, "'");
  key(12.75, 3, 'enter', 2.25, 1, true);

  // 主键区第 4 行：左右 Shift 与标点。
  key(0, 4, 'shift', 2.25, 1, true);
  'ZXCVBNM'.split('').forEach((label, i) => key(2.25 + i, 4, label));
  key(9.25, 4, ',');
  key(10.25, 4, '.');
  key(11.25, 4, '/');
  key(12.25, 4, 'shift', 2.75, 1, true);

  // 主键区第 5 行：Ctrl / Fn / Win / Alt / 空格。
  key(0, 5, 'ctrl', 1.25, 1, true);
  key(1.25, 5, 'fn', 1, 1, true);
  key(2.25, 5, 'win', 1, 1, true);
  key(3.25, 5, 'alt', 1.25, 1, true);
  key(4.5, 5, '', 5.75, 1, false);
  key(10.25, 5, 'alt', 1, 1, true);
  key(11.25, 5, 'fn', 1, 1, true);
  key(12.25, 5, 'ctrl', 1.25, 1, true);
  key(13.5, 5, 'PgUp', 0.75, 1, true);
  key(14.25, 5, 'PgDn', 0.75, 1, true);

  // 小键盘：+ 与 Enter 跨两行，与实物一致。
  key(15.5, 0, 'NumLk', 1, 1, true);
  key(16.5, 0, '/');
  key(17.5, 0, '*');
  key(18.5, 0, '-');
  key(15.5, 1, '7');
  key(16.5, 1, '8');
  key(17.5, 1, '9');
  key(18.5, 1, '+', 1, 2, true);
  key(15.5, 2, '4');
  key(16.5, 2, '5');
  key(17.5, 2, '6');
  key(15.5, 3, '1');
  key(16.5, 3, '2');
  key(17.5, 3, '3');
  key(18.5, 3, 'enter', 1, 2, true);
  key(15.5, 4, '0', 2, 1);
  key(17.5, 4, '.');
  key(15.5, 5, '←', 1, 1, true);
  key(16.5, 5, '↓', 1, 1, true);
  key(17.5, 5, '→', 1, 1, true);
  key(18.5, 5, 'PgDn', 1, 1, true);

  const geometry = new RoundedBoxGeometry(keyW, keyH, keyD, 2, 0.00075);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.03 });
  material.bumpMap = surfaceTexture('micro', 256, 3);
  material.bumpScale = 0.00004;
  material.roughnessMap = surfaceRoughness('micro', 256, 3, 0.84);
  material.needsUpdate = true;

  const keys = new THREE.InstancedMesh(geometry, material, specs.length);
  keys.name = 'laptop-keycaps';
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const color = new THREE.Color();
  specs.forEach((spec, index) => {
    const width = spec.w * U - gap;
    const depth = spec.h * rowPitch - gap;
    matrix.compose(
      new THREE.Vector3(xOf(spec.u + spec.w / 2), keyY, zOf(spec.row + (spec.h - 1) / 2)),
      quat,
      new THREE.Vector3(width / keyW, 1, depth / keyD),
    );
    keys.setMatrixAt(index, matrix);
    color.set(spec.modifier ? '#DCD9D3' : '#F3F0EA');
    color.multiplyScalar(0.985 + ((index * 37) % 9) / 9 * 0.025);
    keys.setColorAt(index, color);
  });
  keys.instanceMatrix.needsUpdate = true;
  if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  keys.castShadow = true;
  keys.receiveShadow = true;
  deck.add(keys);

  // 键帽字符单独成层。depthTest 保持开启，合盖后由盖板正常遮挡。
  const padW = totalUnits * U;
  const zMin = row0 - keyD / 2 - 0.0002;
  const zMax = zOf(5) + keyD / 2 + 0.0002;
  const padD = zMax - zMin;
  const canvasW = 2048;
  const canvasH = Math.round((canvasW * padD) / padW);
  const [canvas, ctx] = makeCanvas(canvasW, canvasH);
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const spec of specs) {
    if (!spec.label) continue;
    const cx = xOf(spec.u + spec.w / 2);
    const cz = zOf(spec.row + (spec.h - 1) / 2);
    const px = ((cx + padW / 2) / padW) * canvasW;
    const py = ((cz - zMin) / padD) * canvasH;
    const chars = spec.label.length;
    const fontPx = chars <= 1 ? 38 : chars <= 2 ? 29 : chars <= 4 ? 22 : 17;
    ctx.font = `700 ${fontPx}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = spec.modifier ? 'rgba(64,69,73,0.93)' : 'rgba(52,57,61,1)';
    ctx.fillText(spec.label, px, py);
  }
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const legendMaterial = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity: 1, depthWrite: false, depthTest: true,
    toneMapped: false, side: THREE.DoubleSide,
  });
  const legends = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), legendMaterial);
  legends.name = 'laptop-key-legends';
  legends.rotation.x = -Math.PI / 2;
  legends.position.set(0, 0.00355, (zMin + zMax) / 2);
  legends.renderOrder = 3;
  deck.add(legends);
}

const LAPTOP_LID_THICKNESS = 0.0055;
const LAPTOP_OPEN_TILT = -Math.PI / 12;
const LAPTOP_LID_CENTER_Y = 0.1295;
const LAPTOP_LID_CENTER_Z = -0.1429;

function replaceGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

// 工厂同款归一化 lathe：points 在 [-0.5,0.5]² 域，随后缩放到真实尺寸。
function buildScaledLathe(points: Array<[number, number]>, width: number, height: number, segments = 40): THREE.LatheGeometry {
  const pts = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.scale(width, height, width);
  return geo;
}

// 瓶身局部半径近似，用于把平面印刷卷成贴合曲面；与重建后的宽颈 lathe 一致（压缩后）。
function bottleRadiusAt(localY: number): number {
  // 瓶身压缩到约 207 mm 后，局部 y ∈ [-0.0715, 0.135]；宽肩缓收：y≈0.05 处仍为近全宽。
  if (localY >= 0.05) return THREE.MathUtils.lerp(0.0408, 0.0383, Math.min(1, (localY - 0.05) / 0.067));
  return 0.0408 - 0.0012 * Math.cos((localY + 0.0715) * 12);
}

// 在瓶身圆柱面上贴一段弧形印刷：刻度线、数字或说明文字。
function addBottleWrapDecal(bottle: THREE.Object3D, texture: THREE.Texture, arcRad: number,
                            height: number, localY: number, opacity = 0.94): THREE.Mesh {
  const radius = bottleRadiusAt(localY) + 0.0004;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 32, 1, true, -arcRad / 2, arcRad);
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = localY;
  mesh.renderOrder = 5;
  bottle.add(mesh);
  return mesh;
}

function drawBottleScaleTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 1024);
  ctx.clearRect(0, 0, 256, 1024);
  ctx.fillStyle = 'rgba(233, 237, 234, 0.92)';
  ctx.strokeStyle = 'rgba(233, 237, 234, 0.92)';
  // 与实物一致：650 ml 在最上、150 ml 在最下，底部加 Approximate Volume 说明。
  ctx.font = '600 26px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const marks: Array<[number, string]> = [
    [0.965, '650ml'], [0.83, '600ml'], [0.695, '550ml'], [0.56, '500ml'], [0.425, '450ml'],
    [0.29, '400ml'], [0.175, '350ml'], [0.06, '300ml'], [-0.055, '250ml'], [-0.17, '200ml'], [-0.285, '150ml'],
  ];
  for (const [v, label] of marks) {
    // v 为相对瓶身 [-1, 1] 区间；映射到画布纵坐标（自上而下为 1 → -1）。
    const y = (1 - (v + 1) / 2) * 1024;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(58, y);
    ctx.stroke();
    ctx.fillText(label, 66, y);
  }
  ctx.font = '500 22px Arial';
  ctx.fillText('Approximate', 12, 940);
  ctx.fillText('Volume', 12, 968);
  ctx.font = '600 20px Arial';
  ctx.fillText('Max Volume 750ml', 12, 996);
  return makeTexture(canvas);
}

// 水壶细节：翻盖、卡扣、提环桥、容量刻度与挂绳扣。
function buildBottleDetails(nodes: Record<string, THREE.Object3D>, meshes: Record<string, THREE.Mesh>): void {
  const bottle = nodes.bottle;
  if (!bottle) return;

  // 瓶盖由零件拼装：下环、翻盖、饮水口、铰链耳、前卡扣与提环桥。
  const capPivot = nodes.bottleCap ?? bottle;
  const capMat = new THREE.MeshPhysicalMaterial({
    color: '#1B1C1D', roughness: 0.5, metalness: 0.0, clearcoat: 0.22, clearcoatRoughness: 0.3,
  });
  const capY = 0.015; // 瓶盖枢轴局部坐标系中心
  const capParts: THREE.Mesh[] = [];
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0395, 0.0405, 0.014, 48), capMat);
  baseRing.position.set(0, capY - 0.004, 0);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.0395, 0.02, 48), capMat);
  lid.position.set(0, capY + 0.012, 0);
  // 翻盖顶面略微下沉的饮水口。
  const sipRecess = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.015, 0.004, 32),
    new THREE.MeshPhysicalMaterial({ color: '#0C0D0E', roughness: 0.42 }),
  );
  sipRecess.position.set(0, capY + 0.0225, -0.011);
  // 后侧铰链耳 + 前侧按压卡扣（带防滑棱）。
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.008), capMat);
  hinge.position.set(0, capY + 0.01, 0.038);
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.017, 0.007), capMat);
  latch.position.set(0, capY + 0.006, -0.0385);
  latch.rotation.x = 0.12;
  const latchRib = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.004), capMat);
  latchRib.position.set(0, capY + 0.0125, -0.0415);
  // 提环桥：盖侧竖耳，织带从中穿过。
  const ears: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.022, 0.014), capMat);
    ear.position.set(side * 0.0365, capY + 0.014, 0.018);
    ears.push(ear);
  }
  const loopBar = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.073, 12), capMat);
  loopBar.rotation.z = Math.PI / 2;
  loopBar.position.set(0, capY + 0.026, 0.018);
  capParts.push(baseRing, lid, sipRecess, hinge, latch, latchRib, loopBar, ...ears);
  for (const m of capParts) {
    m.castShadow = true;
    m.receiveShadow = true;
    capPivot.add(m);
  }
  if (meshes.bottleCap) meshes.bottleCap.visible = false;

  // 容量刻度：卷在瓶身右前侧（朝向正面相机的一侧）；高度随瓶身缩短同步收缩，避免探出瓶底。
  const wrap = addBottleWrapDecal(bottle, drawBottleScaleTexture(), THREE.MathUtils.degToRad(70), 0.16, 0.02);
  wrap.rotation.y = THREE.MathUtils.degToRad(-50);

  // 织带穿过提环的金属小扣。
  const strapClip = new THREE.Mesh(
    new THREE.TorusGeometry(0.0075, 0.0022, 8, 20),
    new THREE.MeshStandardMaterial({ color: '#3A3D40', roughness: 0.4, metalness: 0.85 }),
  );
  strapClip.position.set(0.024, 0.178, 0.030);
  strapClip.rotation.x = Math.PI / 2;
  strapClip.castShadow = true;
  bottle.add(strapClip);

  // 织带加人字纹 bump，去掉平面感（8.jpg 的编织纹）。
  const strapMat = meshes.bottleStrap?.material as THREE.MeshPhysicalMaterial | undefined;
  if (strapMat) {
    const [canvas, ctx] = makeCanvas(128, 512);
    ctx.fillStyle = '#7F7F7F';
    ctx.fillRect(0, 0, 128, 512);
    ctx.strokeStyle = '#B0B0B0';
    ctx.lineWidth = 5;
    for (let y = -16; y < 528; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y + 14);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    const weave = makeTexture(canvas);
    weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
    weave.repeat.set(1, 3);
    strapMat.bumpMap = weave;
    strapMat.bumpScale = 0.0016;
    strapMat.roughness = 0.85;
    strapMat.needsUpdate = true;
  }
}

// 透明粘钩 + 金属钩：替换工厂黑色方块挂钩（9.jpg 证据）。
function buildBottleHook(nodes: Record<string, THREE.Object3D>, meshes: Record<string, THREE.Mesh>): void {
  const hook = nodes.bottleHook;
  if (!hook) return;
  if (meshes.bottleHook) meshes.bottleHook.visible = false;

  // 粘钩底座：透明磨砂小方片贴在玻璃上（玻璃面在内侧 -X 方向）。
  const pad = new THREE.Mesh(
    new RoundedBoxGeometry(0.0035, 0.052, 0.042, 3, 0.004),
    new THREE.MeshPhysicalMaterial({
      color: '#E8ECEA', roughness: 0.32, transmission: 0.72, thickness: 0.002,
      ior: 1.45, transparent: true, opacity: 0.9,
    }),
  );
  pad.position.set(0.0012, 0.012, 0);
  hook.add(pad);
  addDecal(pad, labelTexture('粘钩', 'rgba(120,128,126,0.75)', 128, 64, '600 34px "Segoe UI", Arial', {}),
    0.03, 0.015, [-0.0019, 0, 0], [0, -Math.PI / 2, 0], 0.8, 5);

  const metal = new THREE.MeshStandardMaterial({ color: '#D7DADC', roughness: 0.28, metalness: 0.92 });
  // 挂钩柄：从底座中下段向前伸出再折向上。
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.02, 12), metal);
  stem.rotation.z = Math.PI / 2;
  stem.position.set(-0.011, -0.008, 0);
  const upturn = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.03, 12), metal);
  upturn.position.set(-0.0205, 0.004, 0);
  const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 16, 12), metal);
  tipBall.position.set(-0.0205, 0.02, 0);
  for (const m of [stem, upturn, tipBall]) {
    m.castShadow = true;
    m.receiveShadow = true;
    hook.add(m);
  }
}

function buildLaptopHardware(
  nodes: Record<string, THREE.Object3D>,
  meshes: Record<string, THREE.Mesh>,
): void {
  const base = nodes.laptopBase;
  const lid = nodes.laptopLid;
  if (!base || !lid) return;
  const baseMesh = meshes.laptopBase;
  const lidMesh = meshes.laptopLid;
  const lidHalfThickness = LAPTOP_LID_THICKNESS / 2;
  const bodyMat = baseMesh?.material as THREE.MeshPhysicalMaterial | undefined;

  // 工厂自带的 320 mm 单根屏轴、旧触控板和青色贴纸固定在同一平面上，
  // 会与新结构叠加或从新掌托里穿出；统一隐藏后由本次重建的部件替代。
  const factoryHinge = base.getObjectByName('笔记本屏轴__pivot');
  if (factoryHinge) factoryHinge.visible = false;
  for (const id of ['laptopHinge', 'laptopTrackpad', 'laptopSticker']) {
    if (nodes[id]) nodes[id].visible = false;
    if (meshes[id]) meshes[id].visible = false;
  }

  if (baseMesh) {
    // 耀世16 Ultra 实测 357×264.1×20.6mm：底座 14.5mm + 盖 5.5mm ≈ 20mm，更接近实物。
    replaceGeometry(baseMesh, new RoundedBoxGeometry(0.357, 0.0145, 0.264, 4, 0.0018));
  }
  if (lidMesh) {
    replaceGeometry(lidMesh, new RoundedBoxGeometry(0.352, 0.235, LAPTOP_LID_THICKNESS, 4, 0.0016));
  }

  // 105° 开盖姿态；真实转轴位于盖板下边缘中点，由后续铰链步骤计算。
  lid.position.set(0, LAPTOP_LID_CENTER_Y, LAPTOP_LID_CENTER_Z);
  lid.rotation.set(LAPTOP_OPEN_TILT, 0, 0);

  const palmMat = bodyMat ? bodyMat.clone() : new THREE.MeshPhysicalMaterial({
    color: '#E8E5DF', roughness: 0.42, metalness: 0.08, clearcoat: 0.14, clearcoatRoughness: 0.3,
  });
  palmMat.color.set('#E9E6E0');
  palmMat.roughness = 0.5;
  palmMat.metalness = 0.03;
  palmMat.clearcoat = 0.05;
  palmMat.clearcoatRoughness = 0.45;

  const underlayMat = new THREE.MeshStandardMaterial({ color: '#D2CFC9', roughness: 0.7, metalness: 0.02 });
  const trackpadMat = new THREE.MeshPhysicalMaterial({
    color: '#E4E1DB', roughness: 0.28, metalness: 0.04, clearcoat: 0.3, clearcoatRoughness: 0.2,
  });
  const recessMat = new THREE.MeshStandardMaterial({ color: '#B9B6B0', roughness: 0.7, metalness: 0.02 });
  const darkPlateMat = new THREE.MeshStandardMaterial({ color: '#232527', roughness: 0.42, metalness: 0.35 });
  const portRimMat = new THREE.MeshStandardMaterial({ color: '#8D9194', roughness: 0.36, metalness: 0.8 });
  const portMat = new THREE.MeshBasicMaterial({ color: '#090A0B' });

  // 掌托与底座顶面齐平，不再凸出；耀世16 Ultra 的 C 面是一整块平整金属。
  const palmRest = new THREE.Mesh(new RoundedBoxGeometry(0.353, 0.002, 0.089, 3, 0.0012), palmMat);
  palmRest.name = 'laptop-palm-rest';
  palmRest.position.set(0, 0.0073, 0.078);
  palmRest.receiveShadow = true;
  base.add(palmRest);

  const underlay = new THREE.Mesh(new RoundedBoxGeometry(0.327, 0.0003, 0.098, 2, 0.0012), underlayMat);
  underlay.name = 'laptop-keyboard-well';
  underlay.position.set(0, 0.00735, -0.01625);
  underlay.receiveShadow = true;
  base.add(underlay);

  const trackpadRecess = new THREE.Mesh(new RoundedBoxGeometry(0.111, 0.0006, 0.068, 2, 0.0025), recessMat);
  trackpadRecess.name = 'laptop-trackpad-recess';
  trackpadRecess.position.set(0, 0.0074, 0.078);
  trackpadRecess.receiveShadow = true;
  base.add(trackpadRecess);

  const trackpad = new THREE.Mesh(new RoundedBoxGeometry(0.107, 0.0006, 0.064, 3, 0.0025), trackpadMat);
  trackpad.name = 'laptop-trackpad';
  trackpad.position.set(0, 0.0075, 0.078);
  trackpad.receiveShadow = true;
  base.add(trackpad);

  // 屏幕黑色玻璃基底与白色边框分离，屏幕上移后不再悬在盖板前方 4 mm。
  if (lidMesh) {
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.344, 0.220, 0.0006),
      new THREE.MeshPhysicalMaterial({
        color: '#08090B', roughness: 0.16, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.08,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    );
    bezel.name = 'laptop-screen-bezel';
    bezel.position.set(0, 0.0015, 0.0029);
    bezel.receiveShadow = true;
    lid.add(bezel);

    const camera = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0016, 0.0016, 0.0005, 18),
      new THREE.MeshPhysicalMaterial({ color: '#17191B', roughness: 0.12, metalness: 0.1, clearcoat: 0.8 }),
    );
    camera.name = 'laptop-webcam';
    camera.rotation.x = Math.PI / 2;
    camera.position.set(0, 0.1135, 0.0030);
    lid.add(camera);
  }

  if (meshes.laptopScreen) {
    replaceGeometry(meshes.laptopScreen, new THREE.PlaneGeometry(0.336, 0.210));
  }

  // 后掌托上的 NVIDIA / Intel 贴纸（参考图右下角）。
  const nvidiaMat = new THREE.MeshStandardMaterial({ color: '#6F9E21', roughness: 0.5, metalness: 0.05 });
  const intelMat = new THREE.MeshStandardMaterial({ color: '#1E64A4', roughness: 0.48, metalness: 0.05 });
  const nvidiaSticker = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.0005, 0.0105), nvidiaMat);
  nvidiaSticker.name = 'laptop-sticker-nvidia';
  nvidiaSticker.position.set(0.113, 0.01125, 0.086);
  nvidiaSticker.receiveShadow = true;
  base.add(nvidiaSticker);
  const intelSticker = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.0005, 0.0105), intelMat);
  intelSticker.name = 'laptop-sticker-intel';
  intelSticker.position.set(0.142, 0.01125, 0.086);
  intelSticker.receiveShadow = true;
  base.add(intelSticker);
  addDecal(base, labelTexture('NVIDIA', 'rgba(18,24,14,0.9)', 256, 64, '700 30px Arial', {}),
    0.025, 0.0026, [0.113, 0.01156, 0.083], [-Math.PI / 2, 0, 0], 0.94, 6);
  addDecal(base, labelTexture('GEFORCE RTX', 'rgba(16,24,12,0.92)', 512, 64, '700 28px Arial', {}),
    0.028, 0.0028, [0.113, 0.01156, 0.0888], [-Math.PI / 2, 0, 0], 0.94, 6);
  addDecal(base, labelTexture('intel CORE', 'rgba(248,251,255,0.96)', 512, 96, '600 34px Arial', {}),
    0.022, 0.0042, [0.142, 0.01156, 0.086], [-Math.PI / 2, 0, 0], 0.96, 6);

  // 机身尾部 MECHREVO 铭牌，开盖时朝向使用者。
  const nameplate = new THREE.Mesh(new RoundedBoxGeometry(0.104, 0.0012, 0.010, 2, 0.0015), darkPlateMat);
  nameplate.name = 'laptop-nameplate';
  nameplate.position.set(0, 0.0088, -0.088);
  nameplate.receiveShadow = true;
  base.add(nameplate);
  addDecal(base, labelTexture('MECHREVO', 'rgba(222,226,228,0.96)', 1024, 128, '700 64px Arial', {}),
    0.09, 0.0042, [0, 0.00945, -0.0858], [-Math.PI / 2, 0, 0], 0.96, 7);
  addDecal(base, labelTexture('耀世 16 ULTRA', 'rgba(158,166,171,0.9)', 512, 64, '600 28px "Microsoft YaHei", Arial, sans-serif', {}),
    0.058, 0.0022, [0, 0.00945, -0.0908], [-Math.PI / 2, 0, 0], 0.9, 7);

  // 上盖外表面品牌字样；合盖后在顶面可见。
  addDecal(lid, labelTexture('MECHREVO', 'rgba(56,60,64,0.8)', 1024, 128, '700 64px Arial', {}),
    0.082, 0.014, [0, 0.01, -(lidHalfThickness + 0.00035)], [0, Math.PI, Math.PI], 0.92, 6);
  // 屏幕下边框的极细品牌字样。
  addDecal(lid, labelTexture('MECHREVO', 'rgba(78,83,87,0.62)', 512, 64, '600 30px Arial', {}),
    0.052, 0.0042, [0, -0.1135, lidHalfThickness + 0.0003], [0, 0, 0], 0.9, 6);

  // 右侧 USB-C 接口与后部散热风口。
  for (const z of [-0.04, 0.002]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0042, 0.013), portRimMat);
    rim.name = 'laptop-usbc-rim';
    rim.position.set(0.1776, 0.0006, z);
    rim.castShadow = true;
    base.add(rim);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.0026, 0.0102), portMat);
    slot.name = 'laptop-usbc-port';
    slot.position.set(0.1784, 0.0006, z);
    base.add(slot);
  }
}

const KEYBOARD_CASE_HEIGHT = 0.011;
const KEYBOARD_CASE_RISE = 0.007;
const KEYBOARD_CASE_DEPTH = 0.144;
const KEYBOARD_DECK_SLOPE = KEYBOARD_CASE_RISE / KEYBOARD_CASE_DEPTH;
const KEYBOARD_DECK_ANGLE = Math.atan(KEYBOARD_DECK_SLOPE);
const KEYBOARD_DECK_CENTER_Y = 0.0075 + KEYBOARD_CASE_HEIGHT / 2 + KEYBOARD_CASE_RISE / 2;

function keyboardDeckTop(z: number): number {
  return KEYBOARD_DECK_CENTER_Y - z * KEYBOARD_DECK_SLOPE;
}

function buildWedgeKeyboardCase(): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(0.389, KEYBOARD_CASE_HEIGHT, KEYBOARD_CASE_DEPTH, 4, 0.003);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const height = box.max.y - box.min.y;
  const depth = box.max.z - box.min.z;
  const positions = geometry.attributes.position;
  // 只按高度权重抬升顶面，底面保持水平贴桌；2.8° 剪切不重算法线，
  // 避免圆角盒在分缝处重算法线后出现硬边。
  for (let i = 0; i < positions.count; i += 1) {
    const heightFactor = THREE.MathUtils.clamp((positions.getY(i) - box.min.y) / height, 0, 1);
    const rearFactor = THREE.MathUtils.clamp((box.max.z - positions.getZ(i)) / depth, 0, 1);
    positions.setY(i, positions.getY(i) + KEYBOARD_CASE_RISE * rearFactor * heightFactor);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function slimExternalKeyboard(
  nodes: Record<string, THREE.Object3D>,
  meshes: Record<string, THREE.Mesh>,
): void {
  const keyboard = nodes.keyboard;
  if (!keyboard) return;

  // 实物是前低后高的薄楔形壳：前缘总高 13 mm、后缘 20 mm，台面坡度约 2.8°。
  if (meshes.keyboard) {
    replaceGeometry(meshes.keyboard, buildWedgeKeyboardCase());
    meshes.keyboard.position.set(0, 0.0075, 0);
  }

  const plate = keyboard.getObjectByName('键盘定位板__pivot');
  if (plate) {
    plate.position.set(0, keyboardDeckTop(-0.001) + 0.0007 - 0.0009, -0.001);
    plate.rotation.x = KEYBOARD_DECK_ANGLE;
    plate.scale.set(1, 0.3, 1);
  }

  const keyPivot = keyboard.getObjectByName('98 键渐变键帽矩阵__pivot');
  if (keyPivot) {
    keyPivot.position.set(0, keyboardDeckTop(-0.001) + 0.0007 + 0.00275, -0.001);
    keyPivot.rotation.x = KEYBOARD_DECK_ANGLE;
  }

  const statusLight = keyboard.getObjectByName('键盘状态灯条__pivot');
  if (statusLight) {
    statusLight.position.y = keyboardDeckTop(-0.062) + 0.001;
    statusLight.rotation.x = KEYBOARD_DECK_ANGLE;
  }

  for (const name of ['键盘脚 L__pivot', '键盘脚 R__pivot', '右上旋钮__pivot']) {
    const stale = keyboard.getObjectByName(name);
    if (stale) {
      stale.visible = false;
      stale.parent?.remove(stale);
    }
  }

  const rubber = new THREE.MeshStandardMaterial({ color: '#151719', roughness: 0.9, metalness: 0.0 });
  for (const x of [-0.155, 0.155]) {
    for (const z of [-0.052, 0.052]) {
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.002, 0.012, 2, 0.0005), rubber);
      foot.position.set(x, 0.001, z);
      foot.castShadow = true;
      foot.receiveShadow = true;
      keyboard.add(foot);
    }
  }

  const knob = new THREE.Group();
  knob.name = 'keyboard-knob';
  const knobMat = new THREE.MeshStandardMaterial({ color: '#1B1D20', roughness: 0.42, metalness: 0.25 });
  const knobDeckY = keyboardDeckTop(-0.035);
  const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.0118, 0.0118, 0.0015, 24), knobMat);
  knobBase.position.set(0.166, knobDeckY + 0.00075, -0.035);
  const knobBody = new THREE.Mesh(new THREE.CylinderGeometry(0.0098, 0.0104, 0.012, 24, 1), knobMat);
  knobBody.position.set(0.166, knobDeckY + 0.0065, -0.035);
  const knobTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.0012, 24), knobMat);
  knobTop.position.set(0.166, knobDeckY + 0.0131, -0.035);
  for (const mesh of [knobBase, knobBody, knobTop]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    knob.add(mesh);
  }
  keyboard.add(knob);
}

// 蓝色中性笔已由用户确认移除；工厂遗留笔在调用处隐藏。

// 英菲克有线电竞鼠标：放样壳体 + 独立左右按键 + DPI + V 形灯标 + 透光滚轮 + 侧键 + 编织线。
// 参考 figure/鼠标-1.jpg（俯视）与 figure/鼠标-2.jpg（侧视）。前缘朝 -Z，底部局部 y=0。
type MouseDetail = { wheel: THREE.Group };

const MOUSE_STATIONS: Array<[number, number, number]> = [
  // z, 半宽, 顶面高度
  [-0.0575, 0.0245, 0.0225],
  [-0.045, 0.0295, 0.0275],
  [-0.028, 0.0325, 0.0335],
  [-0.008, 0.0338, 0.0395],
  [0.012, 0.0335, 0.0420],
  [0.03, 0.0305, 0.0395],
  [0.045, 0.0250, 0.0330],
  [0.0565, 0.0150, 0.0245],
  [0.0585, 0.0060, 0.0180],
];

function mouseStationAt(z: number): { halfWidth: number; top: number } {
  const s = MOUSE_STATIONS;
  if (z <= s[0][0]) return { halfWidth: s[0][1], top: s[0][2] };
  for (let i = 0; i < s.length - 1; i += 1) {
    if (z <= s[i + 1][0]) {
      const t = (z - s[i][0]) / (s[i + 1][0] - s[i][0]);
      return {
        halfWidth: THREE.MathUtils.lerp(s[i][1], s[i + 1][1], t),
        top: THREE.MathUtils.lerp(s[i][2], s[i + 1][2], t),
      };
    }
  }
  const last = s[s.length - 1];
  return { halfWidth: last[1], top: last[2] };
}

// 逐站放样：截面为压扁的超椭圆，底面近似水平，尾部收成圆角。
function buildMouseShellGeometry(): THREE.BufferGeometry {
  const ringCount = 40;
  const positions: number[] = [];
  const indices: number[] = [];
  const stations = MOUSE_STATIONS;
  for (let i = 0; i < stations.length; i += 1) {
    const [z, halfWidth, top] = stations[i];
    for (let j = 0; j < ringCount; j += 1) {
      const t = (j / ringCount) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      // 超椭圆指数让侧腰更挺、顶面更平，底面压平。
      const x = halfWidth * Math.sign(c) * Math.pow(Math.abs(c), 0.82);
      let y = 0.002 + (top - 0.002) * (0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 0.9));
      if (s < 0) y = Math.max(0.0012, 0.002 + (top - 0.002) * 0.5 * (1 + s));
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < stations.length - 1; i += 1) {
    for (let j = 0; j < ringCount; j += 1) {
      const a = i * ringCount + j;
      const b = i * ringCount + ((j + 1) % ringCount);
      const c = a + ringCount;
      const d = b + ringCount;
      indices.push(a, c, b, b, c, d);
    }
  }
  // 前后端盖。
  const frontCenter = positions.length / 3;
  positions.push(0, 0.012, stations[0][0] - 0.0005);
  for (let j = 0; j < ringCount; j += 1) {
    indices.push(frontCenter, ((j + 1) % ringCount), j);
  }
  const rearCenter = positions.length / 3;
  positions.push(0, 0.012, stations[stations.length - 1][0] + 0.0005);
  const rearStart = (stations.length - 1) * ringCount;
  for (let j = 0; j < ringCount; j += 1) {
    indices.push(rearCenter, rearStart + j, rearStart + ((j + 1) % ringCount));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// 封闭底盖：实心圆角盒，与各站环底缘重合并略向外扩，避免低角度看进壳体内部。
function buildMouseBaseGeometry(): THREE.BufferGeometry {
  // 直接用一个覆盖整个底面的薄圆角盒，比放样环更可靠。
  return new RoundedBoxGeometry(0.066, 0.0024, 0.114, 3, 0.0011);
}

// 顶面左右按键：沿壳体前段坡度布置的薄板，中央留 1.2 mm 分缝。
function buildMouseButton(side: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  // 按键在 XZ 平面内的多边形（外缘带折角，符合 10.jpg 的棱角语言）。
  const outline: Array<[number, number]> = [
    [0.0012, -0.0555], [0.0195, -0.0555], [0.0275, -0.043], [0.0305, -0.026],
    [0.0240, -0.0095], [0.0105, -0.0060], [0.0012, -0.0090],
  ];
  outline.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(side * x, -z);
    else shape.lineTo(side * x, -z);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0005, bevelSegments: 2 });
  // Shape 建立在 (x, -z)，旋转 -90° 后回到 XZ 平面，挤出方向 +Y。
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  // 前段顶面坡度（由放样站求得），让按键随壳体前倾。
  const slope = Math.atan2(mouseStationAt(-0.01).top - mouseStationAt(-0.05).top, 0.04);
  mesh.rotation.x = -slope;
  mesh.position.y = mouseStationAt(-0.03).top + 0.0006;
  return mesh;
}

function drawInphicLogoTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(216, 222, 226, 0.9)';
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 简化的英菲克线条徽标：开口圆环 + 上划折线（参考 10.jpg 尾部白色轮廓标）。
  ctx.beginPath();
  ctx.arc(128, 140, 62, Math.PI * 0.15, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(84, 150);
  ctx.lineTo(150, 116);
  ctx.lineTo(150, 84);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(150, 58);
  ctx.lineTo(168, 44);
  ctx.lineTo(186, 58);
  ctx.stroke();
  return makeTexture(canvas);
}

function drawChevronTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 256);
  ctx.clearRect(0, 0, 128, 256);
  ctx.strokeStyle = '#F2F6FF';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 三道 V 形灯标，指向鼠标尾部。
  for (let i = 0; i < 3; i += 1) {
    const y = 58 + i * 62;
    ctx.beginPath();
    ctx.moveTo(30, y + 20);
    ctx.lineTo(64, y - 8);
    ctx.lineTo(98, y + 20);
    ctx.stroke();
  }
  return makeTexture(canvas);
}

function buildInphicMouse(nodes: Record<string, THREE.Object3D>, meshes: Record<string, THREE.Mesh>): MouseDetail | null {
  const shellNode = nodes.mouseShell;
  if (!shellNode) return null;
  // 工厂旧件全部从层级移除：避免包围盒与重影；交互仅依赖 mouseShell 枢轴。
  for (const id of ['mouseBase', 'mouseWheel', 'mouseGripL', 'mouseGripR']) {
    const node = nodes[id];
    if (node?.parent) node.parent.remove(node);
    delete nodes[id];
    delete meshes[id];
  }
  // 鼠标垫已竖放（pivot 绕 Y 转 -90°），鼠标朝向需补偿 +90° 以继续朝向用户。
  // 局部位置移到垫子中央偏前：垫子局部 X 对应世界前后，局部 Z 对应世界左右。
  shellNode.rotation.y = -0.28 + Math.PI / 2;
  shellNode.position.set(0.02, 0.024, 0.01);

  const group = new THREE.Group();
  group.name = 'inphic-mouse-assembly';
  // 鼠标垫顶面在 mouseShell 枢轴局部 y=-0.022。
  group.position.y = -0.022;
  shellNode.add(group);

  const shellMat = new THREE.MeshPhysicalMaterial({
    color: '#17181A', roughness: 0.42, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.32,
    side: THREE.DoubleSide,
  });
  const buttonMat = new THREE.MeshPhysicalMaterial({
    color: '#1B1C1F', roughness: 0.38, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.25,
  });
  const glossyMat = new THREE.MeshPhysicalMaterial({
    color: '#0B0C0E', roughness: 0.16, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12,
  });

  const shell = new THREE.Mesh(buildMouseShellGeometry(), shellMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);
  if (meshes.mouseShell) meshes.mouseShell.visible = false;

  // 底壳：实心圆角盒封底，与壳体底缘重合，防止低角度透视看到空心内部。
  const base = new THREE.Mesh(buildMouseBaseGeometry(), glossyMat);
  base.position.set(0, 0.0012, 0.001);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  for (const side of [-1, 1]) {
    const button = buildMouseButton(side, buttonMat);
    button.castShadow = true;
    group.add(button);
  }

  // 中央亮黑饰板：滚轮 → DPI → V 形灯标依次排列。
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.013, 0.0022, 0.062, 2, 0.003), glossyMat);
  spine.position.set(0, mouseStationAt(-0.026).top + 0.0012, -0.024);
  spine.rotation.x = -Math.atan2(mouseStationAt(-0.008).top - mouseStationAt(-0.05).top, 0.042);
  group.add(spine);

  // 滚轮：黑色橡胶胎面 + 两侧蓝紫透光环。
  const wheel = new THREE.Group();
  wheel.name = 'inphic-scroll-wheel';
  const wheelRadius = 0.0092;
  const rubber = new THREE.MeshPhysicalMaterial({ color: '#101114', roughness: 0.82 });
  const glow = new THREE.MeshStandardMaterial({
    color: '#8FA2FF', emissive: '#5F6FFF', emissiveIntensity: 1.35, roughness: 0.3,
  });
  const wheelMesh = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.0086, 40), [rubber, glow, glow]);
  wheelMesh.rotation.z = Math.PI / 2; // 轴向 +X
  wheel.add(wheelMesh);
  // 胎面人字纹：24 道浅棱。
  const treadGeo = new THREE.BoxGeometry(0.0082, 0.0006, 0.0011);
  const tread = new THREE.InstancedMesh(treadGeo, rubber, 24);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    m.compose(new THREE.Vector3(0, Math.cos(a) * wheelRadius, Math.sin(a) * wheelRadius), q, new THREE.Vector3(1, 1, 1));
    tread.setMatrixAt(i, m);
  }
  tread.instanceMatrix.needsUpdate = true;
  wheel.add(tread);
  wheel.position.set(0, mouseStationAt(-0.042).top - 0.0025, -0.042);
  group.add(wheel);

  // DPI 键与小字。
  const dpi = new THREE.Mesh(new RoundedBoxGeometry(0.0072, 0.0018, 0.0058, 2, 0.0009), buttonMat);
  const dpiZ = -0.018;
  dpi.position.set(0, mouseStationAt(dpiZ).top + 0.0024, dpiZ);
  dpi.rotation.x = -Math.atan2(mouseStationAt(-0.008).top - mouseStationAt(-0.028).top, 0.02);
  group.add(dpi);
  addDecal(dpi, labelTexture('DPI', '#B9BEC6', 128, 64, '700 40px Arial', {}),
    0.0056, 0.0028, [0, 0.0011, 0], [-Math.PI / 2, 0, 0], 0.9, 6);

  // V 形灯标：发光 decal 贴在中央饰板后段。
  const chevronZ = 0.0015;
  const chevron = addDecal(group, drawChevronTexture(), 0.0085, 0.017,
    [0, mouseStationAt(chevronZ).top + 0.0016, chevronZ],
    [-Math.PI / 2 + 0.1, 0, 0], 1, 6);
  (chevron.material as THREE.MeshBasicMaterial).color.set('#EAF0FF');

  // 英菲克尾部徽标。
  const logoZ = 0.036;
  addDecal(group, drawInphicLogoTexture(), 0.013, 0.013,
    [0, mouseStationAt(logoZ).top + 0.0012, logoZ], [-Math.PI / 2 + 0.32, 0, 0], 0.9, 6);

  // 左侧两枚侧键（朝 -X），细长楔形。
  for (const z of [-0.014, -0.032]) {
    const sideButton = new THREE.Mesh(new RoundedBoxGeometry(0.0032, 0.0052, 0.0135, 2, 0.0012), buttonMat);
    const halfWidth = mouseStationAt(z).halfWidth;
    sideButton.position.set(-halfWidth + 0.0015, 0.0195, z);
    sideButton.rotation.z = -0.18;
    sideButton.castShadow = true;
    group.add(sideButton);
  }
  // 左裙两道防滑浅槽。
  for (const z of [-0.02, -0.026]) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0008, 0.02), glossyMat);
    groove.position.set(-mouseStationAt(z).halfWidth + 0.002, 0.0115, z);
    group.add(groove);
  }

  // 英菲克为无线鼠标：无出线护套与线缆。
  return { wheel };
}

export type WorkstationAnimationApi = {
  openLaptop: (angleDeg?: number) => void;
  closeLaptop: () => void;
  /** 跳段时间线时使用：不播放开合动画，直接落到目标角度。 */
  setLaptopLidInstant: (closed: boolean) => void;
  panMonitor: (deg: number) => void;
  tiltMonitor: (deg: number) => void;
  pressKey: (index: number, travelMm?: number) => void;
  releaseKey: (index: number) => void;
  setKeyboardRgb: (mode: RgbMode | 'sweep') => void;
  setKeyboardRgbColor: (color: string) => void;
  /** 演示用亮度缩放：只影响 RGB 三层光效，不改变灯效模式。 */
  setKeyboardRgbScale: (scale: number) => void;
  /** 冻结设备动画时钟，用于展示模式暂停；恢复时顺延笔记本开合起点。 */
  pauseAnimations: () => void;
  resumeAnimations: () => void;
  moveMouse: (dx: number, dz: number) => void;
  spinWheel: (delta: number) => void;
  openMugLid: (open: boolean) => void;
  toggleSteam: (on: boolean) => void;
  swayBottle: (amplitudeDeg: number) => void;
  setScreenPower: (on: boolean) => void;
  setScreenContent: (content: ScreenContent) => void;
  setLightingMode: (mode: 'day' | 'night') => void;
  swivelChair: (deg: number) => void;
  reclineChair: (deg: number) => void;
  getState: () => Record<string, unknown>;
};

// --- 人体工学椅（参考 figure/椅子-1.jpg–椅子-4.jpg，网布+尼龙骨架） -------------

type ChairDetail = {
  group: THREE.Group;
  backPivot: THREE.Group;
};

// 椅座前缘世界 z = CHAIR_POS.z - 0.25，取 0.45 时正好贴住桌沿 z = 0.20；
// 再前移椅座底面会与桌下前横梁（z 0.145–0.175，y 0.38–0.42）相交。
const CHAIR_POS = { x: 0.0, z: 0.45 };
const SEAT_TOP = 0.45;

// 站格式截面放样：[y 站高, 半宽 x, 靠背 z（局部 -z 为坐者后方）]
const BACK_STATIONS: Array<[number, number, number]> = [
  [0.00, 0.235, 0.000],
  [0.10, 0.252, -0.012],
  [0.22, 0.262, -0.030],
  [0.34, 0.258, -0.052],
  [0.46, 0.238, -0.062],
  [0.56, 0.212, -0.056],
];

function chairMeshMaterial(): THREE.MeshPhysicalMaterial {
  // 网布：深色底 + 浅色网孔浮雕。材质色保持白色，让贴图自身的织纹对比可见。
  const material = new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF',
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    map: drawMeshWeaveTexture(),
    bumpMap: drawMeshWeaveBump(),
    bumpScale: 0.0014,
    sheen: 0.06,
    sheenColor: new THREE.Color('#6E7478'),
    sheenRoughness: 0.9,
  });
  material.map.repeat.set(3, 3);
  material.bumpMap!.repeat.set(3, 3);
  return material;
}

function drawMeshWeaveBump(): THREE.CanvasTexture {
  // 黑白网孔凹凸：孔处下凹、纱线隆起。
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 8) {
    for (let x = ((y / 8) % 2) * 4; x < 512; x += 8) {
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(x + 1, y + 1, 5, 5);
    }
  }
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#D8D8D8';
  for (let x = 0; x < 512; x += 8) ctx.fillRect(x, 0, 2, 512);
  for (let y = 0; y < 512; y += 8) ctx.fillRect(0, y, 512, 2);
  ctx.globalAlpha = 1;
  return makeTexture(canvas);
}

function chairShellMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#26282B',
    roughness: 0.62,
    metalness: 0.0,
  });
  applySurfaceMaps(material, 'micro', 0.0003, 3, 0.72);
  return material;
}

function drawMeshWeaveTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#26292C';
  ctx.fillRect(0, 0, 512, 512);
  const rand = rng(9021);
  // 横向细孔行 + 纵向纱线，模仿座椅三明治网布的蜂窝织纹。
  for (let y = 0; y < 512; y += 6) {
    for (let x = ((y / 6) % 2) * 3; x < 512; x += 6) {
      const v = 12 + rand() * 10;
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
      ctx.fillRect(x + 1, y + 1, 3.6, 3.6);
    }
  }
  ctx.globalAlpha = 0.5;
  for (let x = 0; x < 512; x += 3) {
    ctx.fillStyle = '#42474A';
    ctx.fillRect(x, 0, 1, 512);
  }
  ctx.globalAlpha = 0.4;
  for (let y = 0; y < 512; y += 3) {
    ctx.fillStyle = '#3A3F42';
    ctx.fillRect(0, y, 512, 1);
  }
  ctx.globalAlpha = 1;
  return makeTexture(canvas);
}

// 网布面片：宽度随 BACK_STATIONS 变化、带前后弯曲的双面网格布。
function buildMeshPanel(stations: Array<[number, number, number]>, cols: number, bulge: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = stations.length;
  for (let r = 0; r < rows; r += 1) {
    const [y, halfW, zEdge] = stations[r];
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols;
      const x = (u - 0.5) * 2 * halfW;
      // 横向轻微内凹（包裹感），中竖带略前凸（托腰）。
      const lateral = Math.cos((u - 0.5) * Math.PI);
      const z = zEdge - bulge * (0.55 * lateral + 0.45 * (1 - Math.abs(u - 0.5) * 2));
      positions.push(x, y, z);
      uvs.push(u * 4, (y / stations[rows - 1][0]) * 4);
    }
  }
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// 沿放样站的外框（顶/底横梁 + 两侧立柱），用变截面管近似注塑边框。
function buildFrameLoop(stations: Array<[number, number, number]>, tubeR: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const edge = (u: number, r: number): THREE.Vector3 => {
    const [, halfW, z] = stations[r];
    return new THREE.Vector3((u - 0.5) * 2 * halfW, stations[r][0], z + 0.012);
  };
  const cols = 12;
  const railPath = (side: 'left' | 'right' | 'top' | 'bottom'): THREE.Curve<THREE.Vector3> => {
    const pts: THREE.Vector3[] = [];
    if (side === 'left' || side === 'right') {
      const u = side === 'left' ? 0.02 : 0.98;
      for (let r = 0; r < stations.length; r += 1) pts.push(edge(u, r));
    } else {
      const r = side === 'bottom' ? 0 : stations.length - 1;
      for (let c = 0; c <= cols; c += 1) pts.push(edge(c / cols, r));
    }
    return new THREE.CatmullRomCurve3(pts);
  };
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const geo = new THREE.TubeGeometry(railPath(side), 24, tubeR, 8, false);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildArmrest(side: 1 | -1, shell: THREE.Material): THREE.Group {
  // 参考 figure/椅子-3.jpg / 椅子-4.jpg：扶手是闭合三角框，垫子前后两端都接到座垫侧面。
  // 调用方把它挂在 seat 组（原点在椅组原点，y=0 为地面）。
  // 椅组 rotation.y = π，因此局部 +z 朝向桌子（坐者前方）；座垫前缘 z=+0.25、后缘 z=-0.25。
  const group = new THREE.Group();
  // 后立柱：截面 0.045×0.06，从座垫连接片（y=0.39）一直顶到扶手垫底，不能留缝。
  const post = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.25, 0.06, 3, 0.012), shell);
  post.position.set(side * 0.262, 0.515, -0.16);
  post.castShadow = true;
  group.add(post);
  // 后连接片：把立柱贴到座垫外缘。
  const bracket = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.06, 0.10, 2, 0.01), shell);
  bracket.position.set(side * 0.252, 0.42, -0.16);
  bracket.castShadow = true;
  group.add(bracket);
  // 扶手垫：前后向长条 0.34m，前端伸到座垫前缘后方 0.08m，垫面 y≈0.66。
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.026, 0.34, 3, 0.012), chairPadMaterial());
  pad.position.set(side * 0.262, 0.66, 0.0);
  pad.castShadow = true;
  group.add(pad);
  // 前斜撑：从垫前端向后下方落到座垫侧面，与后立柱、垫子构成三角框。
  // 上端 (y≈0.65, z≈0.16) 顶住垫底，下端 (y≈0.41, z≈0.014) 进入前连接片。
  const brace = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.28, 0.032, 3, 0.014), shell);
  brace.position.set(side * 0.262, 0.53, 0.0875);
  brace.rotation.x = Math.atan2(0.135, 0.22);
  brace.castShadow = true;
  group.add(brace);
  // 前连接片：贴住座垫外缘，承接斜撑下端。
  const frontBracket = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.06, 0.10, 2, 0.01), shell);
  frontBracket.position.set(side * 0.252, 0.42, 0.02);
  frontBracket.castShadow = true;
  group.add(frontBracket);
  // 后立柱顶部的固定盖（垫底）。
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.010, 12), shell);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(side * 0.262, 0.645, -0.16);
  group.add(cap);
  // 前端关节：垫子与斜撑的铰点，外侧露出约 6 mm。
  const frontJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.024, 16), shell);
  frontJoint.rotation.z = Math.PI / 2;
  frontJoint.position.set(side * 0.2935, 0.645, 0.155);
  frontJoint.castShadow = true;
  group.add(frontJoint);
  // 前连接片外侧螺栓盖。
  const frontBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.014, 14), shell);
  frontBolt.rotation.z = Math.PI / 2;
  frontBolt.position.set(side * 0.2815, 0.428, 0.02);
  frontBolt.castShadow = true;
  group.add(frontBolt);
  return group;
}

function chairPadMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: '#33363A', roughness: 0.78, metalness: 0.0 });
  applySurfaceMaps(material, 'micro', 0.0004, 3, 0.85);
  return material;
}

// --- 桌下结构、书包与垃圾桶 ------------------------------------------------
// 参考 figure/桌底-1.jpg、桌底-2.jpg、书包-1.jpg、书包-2.jpg：
// 桌体由落地木侧板/背板承重，旧四腿与横梁不再成立；背板底部是带横向
// 加强肋的铝线槽，两只 86 型五孔插座直接嵌在线槽上。

const UNDER_DESK_TOP = 0.7325;
const UNDER_DESK_BACK_Z = -0.315;
const UNDER_DESK_SIDE_X = 0.515;
const UNDER_DESK_FRONT_Z = 0.17;

type BagStation = { y: number; halfWidth: number; halfDepthBack: number; halfDepthFront: number; shiftZ: number };

function buildBackpackBodyGeometry(): THREE.BufferGeometry {
  const stations: BagStation[] = [
    { y: 0.004, halfWidth: 0.128, halfDepthBack: 0.064, halfDepthFront: 0.070, shiftZ: 0.000 },
    { y: 0.026, halfWidth: 0.143, halfDepthBack: 0.073, halfDepthFront: 0.080, shiftZ: 0.000 },
    { y: 0.075, halfWidth: 0.153, halfDepthBack: 0.080, halfDepthFront: 0.088, shiftZ: 0.002 },
    { y: 0.145, halfWidth: 0.160, halfDepthBack: 0.085, halfDepthFront: 0.095, shiftZ: 0.004 },
    { y: 0.225, halfWidth: 0.162, halfDepthBack: 0.087, halfDepthFront: 0.100, shiftZ: 0.004 },
    { y: 0.305, halfWidth: 0.159, halfDepthBack: 0.086, halfDepthFront: 0.100, shiftZ: 0.002 },
    { y: 0.375, halfWidth: 0.152, halfDepthBack: 0.082, halfDepthFront: 0.096, shiftZ: -0.001 },
    { y: 0.435, halfWidth: 0.140, halfDepthBack: 0.075, halfDepthFront: 0.088, shiftZ: -0.004 },
    { y: 0.480, halfWidth: 0.120, halfDepthBack: 0.064, halfDepthFront: 0.074, shiftZ: -0.007 },
    { y: 0.506, halfWidth: 0.092, halfDepthBack: 0.048, halfDepthFront: 0.055, shiftZ: -0.009 },
  ];
  const segments = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const exponent = 2.65;
  for (let s = 0; s < stations.length; s += 1) {
    const st = stations[s];
    for (let i = 0; i <= segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const sx = Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent);
      const cz = Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent);
      const depth = cos >= 0 ? st.halfDepthFront : st.halfDepthBack;
      // 轻微非对称鼓起：软包比正圆柱更松弛，但保持可控轮廓。
      const widthLump = 1 + Math.sin(theta * 3 + s * 0.55) * 0.008;
      const x = st.halfWidth * sx * widthLump;
      const z = st.shiftZ + depth * cz;
      positions.push(x, st.y, z);
      uvs.push((i / segments + 0.5) % 1, s / (stations.length - 1));
    }
  }
  for (let s = 0; s < stations.length - 1; s += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = s * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRibbonGeometry(points: THREE.Vector3[], width: number, thickness: number, segments = 72): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let previousSide: THREE.Vector3 | null = null;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const p = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-5) side.copy(previousSide ?? new THREE.Vector3(1, 0, 0));
    side.normalize();
    if (previousSide && side.dot(previousSide) < 0) side.negate();
    previousSide = side.clone();
    const localUp = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const hw = width / 2;
    const ht = thickness / 2;
    const corners = [
      p.clone().addScaledVector(side, -hw).addScaledVector(localUp, -ht),
      p.clone().addScaledVector(side, hw).addScaledVector(localUp, -ht),
      p.clone().addScaledVector(side, hw).addScaledVector(localUp, ht),
      p.clone().addScaledVector(side, -hw).addScaledVector(localUp, ht),
    ];
    for (const corner of corners) positions.push(corner.x, corner.y, corner.z);
    uvs.push(0, t * 10, 1, t * 10, 1, t * 10, 0, t * 10);
    if (i < segments) {
      const a = i * 4;
      const b = (i + 1) * 4;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
      indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      indices.push(a + 3, a, b + 3, a, b, b + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function drawBackpackPrintTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1536, 1536);
  const rand = rng(7319);
  ctx.fillStyle = '#4A2A33';
  ctx.fillRect(0, 0, 1536, 1536);
  const shade = ctx.createLinearGradient(0, 0, 0, 1536);
  shade.addColorStop(0, 'rgba(94,58,70,0.34)');
  shade.addColorStop(0.45, 'rgba(74,42,51,0.06)');
  shade.addColorStop(1, 'rgba(28,18,22,0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1536, 1536);
  for (let i = 0; i < 220; i += 1) {
    const x = rand() * 1536;
    const y = rand() * 1536;
    const r = 20 + rand() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? 'rgba(132,86,98,0.08)' : 'rgba(31,20,25,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 织纹
  for (let y = 0; y < 1536; y += 3) {
    ctx.fillStyle = `rgba(20,12,16,${0.02 + rand() * 0.025})`;
    ctx.fillRect(0, y, 1536, 1);
  }
  for (let x = 0; x < 1536; x += 4) {
    ctx.fillStyle = `rgba(220,185,190,${0.012 + rand() * 0.018})`;
    ctx.fillRect(x, 0, 1, 1536);
  }
  // 底部黑色包边，与真实书包的黑色底布对应。
  ctx.fillStyle = '#1C1D20';
  ctx.fillRect(0, 1320, 1536, 216);
  ctx.strokeStyle = 'rgba(150,144,132,0.62)';
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.moveTo(0, 1318);
  ctx.lineTo(1536, 1318);
  ctx.stroke();
  ctx.setLineDash([]);
  // 全幅白色印花：实物是小号散印——文字块多、位置随机、方向含倒置与斜向，疏密不匀。
  const phrases = ['ANTI LOSER', 'BADS BATTLE GROUND', 'LE CHRONO'];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 52; i += 1) {
    const x = rand() * 1536;
    const y = 92 + rand() * 1128;
    const phrase = phrases[Math.floor(rand() * phrases.length)];
    const size = 17 + Math.round(rand() * 11);
    const angle = (rand() - 0.5) * 2.0 + (rand() > 0.74 ? Math.PI : 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = `600 ${size}px Arial, "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = `rgba(226,218,206,${0.3 + rand() * 0.26})`;
    ctx.fillText(phrase, 0, 0);
    ctx.restore();
  }
  // 少量中号印花做疏密对比（照片里同款文字有大小两档）。
  for (let i = 0; i < 5; i += 1) {
    const x = 120 + rand() * 1296;
    const y = 150 + rand() * 1000;
    const phrase = phrases[Math.floor(rand() * phrases.length)];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rand() - 0.5) * 1.6);
    ctx.font = `700 ${34 + Math.round(rand() * 8)}px Arial, "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = `rgba(226,218,206,${0.4 + rand() * 0.2})`;
    ctx.fillText(phrase, 0, 0);
    ctx.restore();
  }
  // 前幅上部圆形徽标：细环 + 环内弧线字 + 中心 B 方框（参考照片的 LE CHRONO 圆标）。
  ctx.save();
  ctx.translate(768, 188);
  ctx.strokeStyle = 'rgba(235,228,216,0.84)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(235,228,216,0.84)';
  ctx.font = '600 12px Arial';
  ctx.fillText('LE CHRONO', 0, 26);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-11, -20, 22, 28, 5);
  ctx.stroke();
  ctx.font = '800 22px Arial';
  ctx.fillText('B', 0, -5);
  ctx.restore();
  // 印刷磨损与布料颗粒。
  for (let i = 0; i < 1300; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(79,46,57,0.22)' : 'rgba(232,222,210,0.10)';
    ctx.fillRect(rand() * 1536, rand() * 1280, 1 + rand() * 4, 1 + rand() * 2);
  }
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function drawBackpackPatchTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 336);
  const rand = rng(4122);
  ctx.fillStyle = '#5B6165';
  ctx.fillRect(0, 0, 512, 336);
  for (let i = 0; i < 3800; i += 1) {
    const v = 58 + Math.floor(rand() * 54);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.06 + rand() * 0.15})`;
    ctx.fillRect(rand() * 512, rand() * 336, 1 + rand() * 3, 1 + rand() * 2);
  }
  ctx.strokeStyle = 'rgba(34,36,38,0.9)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 326);
  ctx.strokeStyle = 'rgba(170,174,176,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(17, 17, 478, 302);
  ctx.setLineDash([]);
  // 参考贴片是灰底白色涂鸦。三个字母分开绘制并加斜切与飞白，避免糊成一块白斑。
  ctx.save();
  ctx.translate(256, 176);
  ctx.rotate(-0.085);
  ctx.font = '900 128px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const [letter, x] of [[('B'), -104], [('A'), 0], [('P'), 104]] as const) {
    ctx.strokeStyle = 'rgba(232,235,233,0.92)';
    ctx.lineWidth = 6;
    ctx.strokeText(letter, x, 0);
    ctx.fillStyle = 'rgba(244,245,241,0.96)';
    ctx.fillText(letter, x, 0);
  }
  // 斜切飞白让字形更像喷涂而不是印刷体。
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(72,78,82,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 13; i += 1) {
    const x = -166 + rand() * 330;
    const y = -58 + rand() * 118;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + rand() * 28, y + 3 + rand() * 6);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(236,239,236,0.88)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-164, 82);
  ctx.bezierCurveTo(-74, 102, 52, 104, 166, 68);
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 110; i += 1) {
    ctx.strokeStyle = `rgba(229,232,230,${0.12 + rand() * 0.28})`;
    ctx.lineWidth = 1 + rand() * 3;
    ctx.beginPath();
    const x = 130 + rand() * 290;
    const y = 90 + rand() * 190;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + rand() * 24, y + (rand() - 0.5) * 14);
    ctx.stroke();
  }
  const texture = makeTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function drawWebbingTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  const rand = rng(871);
  ctx.fillStyle = '#1F2124';
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 3) {
    ctx.fillStyle = `rgba(70,74,78,${0.03 + rand() * 0.05})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  for (let y = 0; y < 256; y += 2) {
    ctx.fillStyle = `rgba(7,8,9,${0.06 + rand() * 0.06})`;
    ctx.fillRect(0, y, 256, 1);
  }
  ctx.strokeStyle = 'rgba(133,137,137,0.58)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  for (const x of [24, 232]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const texture = makeTexture(canvas);
  texture.repeat.set(1, 1);
  return texture;
}

function buildBackpack(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'backpack';
  // 用户更正：书包背面靠左侧板（不是背板），正面朝桌内（+x）。
  // 倚靠姿态用“剪切”而不是整体旋转：包底保持水平、随包体完全贴地（y 不随姿态变化），
  // 上半身向 -x 侧倾（等效约 4.6°）靠住左板——避免整体旋转把包底前缘抬离地面造成的悬空/穿模观感。
  const leanShear = -0.08;
  group.matrixAutoUpdate = false;
  group.matrix
    .makeShear(0, 0, leanShear, 0, 0, 0)
    .multiply(new THREE.Matrix4().makeRotationY(1.50))
    .setPosition(-0.357, -0.0035, -0.022);
  group.matrixWorldNeedsUpdate = true;

  const printTexture = drawBackpackPrintTexture();
  const fabricBump = surfaceTexture('fabric', 512, 7);
  const burgundy = new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF',
    map: printTexture,
    bumpMap: fabricBump,
    bumpScale: 0.00032,
    roughness: 0.88,
    metalness: 0.0,
    sheen: 0.34,
    sheenColor: new THREE.Color('#7A4A57'),
    sheenRoughness: 0.7,
    side: THREE.DoubleSide,
  });
  const blackFabric = new THREE.MeshPhysicalMaterial({
    color: '#24272B',
    bumpMap: fabricBump,
    bumpScale: 0.00042,
    roughness: 0.82,
    metalness: 0.0,
    sheen: 0.24,
    sheenColor: new THREE.Color('#5B6168'),
  });
  const blackTrim = new THREE.MeshPhysicalMaterial({
    color: '#141619',
    roughness: 0.62,
    metalness: 0.06,
    clearcoat: 0.08,
    side: THREE.DoubleSide,
  });
  const greyPatch = new THREE.MeshPhysicalMaterial({
    map: drawBackpackPatchTexture(),
    bumpMap: fabricBump,
    bumpScale: 0.00024,
    roughness: 0.9,
    metalness: 0.0,
  });
  const webbing = new THREE.MeshPhysicalMaterial({
    map: drawWebbingTexture(),
    bumpMap: fabricBump,
    bumpScale: 0.00035,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const zipperMetal = new THREE.MeshStandardMaterial({ color: '#9FA3A3', roughness: 0.38, metalness: 0.8 });

  const body = new THREE.Mesh(buildBackpackBodyGeometry(), burgundy);
  body.name = 'backpack-body';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const bottom = new THREE.Mesh(new THREE.CircleGeometry(1, 32), blackFabric);
  bottom.scale.set(0.142, 0.077, 1);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(0, 0.0035, 0.002);
  bottom.receiveShadow = true;
  group.add(bottom);

  const topDome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), burgundy);
  topDome.scale.set(0.105, 0.042, 0.064);
  topDome.position.set(0, 0.500, -0.006);
  topDome.castShadow = true;
  group.add(topDome);

  // 下前袋：黑色织物软包，顶部拉链与灰色涂鸦贴片；参考照片中前袋几乎占满包宽。
  const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.286, 0.176, 0.064, 4, 0.028), blackFabric);
  pocket.name = 'backpack-front-pocket';
  pocket.position.set(0, 0.175, 0.086);
  pocket.rotation.x = -0.055;
  pocket.castShadow = true;
  pocket.receiveShadow = true;
  group.add(pocket);
  const pocketZipperPoints = [
    new THREE.Vector3(-0.128, 0.236, 0.119),
    new THREE.Vector3(-0.068, 0.247, 0.128),
    new THREE.Vector3(0.000, 0.250, 0.132),
    new THREE.Vector3(0.068, 0.247, 0.128),
    new THREE.Vector3(0.128, 0.236, 0.119),
  ];
  const pocketZipper = new THREE.Mesh(buildRibbonGeometry(pocketZipperPoints, 0.013, 0.003, 36), blackTrim);
  group.add(pocketZipper);
  const pocketTeeth = new THREE.Mesh(buildRibbonGeometry(pocketZipperPoints.map((p) => p.clone().add(new THREE.Vector3(0, 0, 0.0024))), 0.0032, 0.0015, 36), zipperMetal);
  group.add(pocketTeeth);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.100, 0.066), greyPatch);
  patch.name = 'backpack-logo-patch';
  patch.position.set(0.006, 0.158, 0.132);
  patch.rotation.set(-0.055, 0, -0.018);
  group.add(patch);

  // 主拉链：绕前幅上缘，终点各挂一个黑色拉头。
  const mainZipperPoints = [
    new THREE.Vector3(-0.154, 0.330, 0.060),
    new THREE.Vector3(-0.128, 0.357, 0.078),
    new THREE.Vector3(-0.070, 0.378, 0.093),
    new THREE.Vector3(0.000, 0.384, 0.099),
    new THREE.Vector3(0.070, 0.378, 0.093),
    new THREE.Vector3(0.128, 0.357, 0.078),
    new THREE.Vector3(0.154, 0.330, 0.060),
  ];
  const mainZipper = new THREE.Mesh(buildRibbonGeometry(mainZipperPoints, 0.015, 0.0035, 48), blackTrim);
  group.add(mainZipper);
  const mainTeeth = new THREE.Mesh(buildRibbonGeometry(mainZipperPoints.map((p) => p.clone().add(new THREE.Vector3(0, 0.001, 0.0025))), 0.0038, 0.0016, 48), zipperMetal);
  group.add(mainTeeth);

  const addZipperPull = (x: number, y: number, z: number): void => {
    const pull = new THREE.Group();
    pull.position.set(x, y, z);
    const slider = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.018, 0.005, 2, 0.002), zipperMetal);
    pull.add(slider);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0018, 6, 14), blackTrim);
    loop.position.set(0, -0.021, 0.002);
    loop.rotation.x = Math.PI / 2;
    pull.add(loop);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.032, 6), blackTrim);
    cord.position.set(0, -0.040, 0.002);
    pull.add(cord);
    group.add(pull);
  };
  addZipperPull(0.142, 0.318, 0.070);
  addZipperPull(-0.020, 0.374, 0.104);
  addZipperPull(0.085, 0.244, 0.138);

  // 肩带：从包背侧上方落到地面。落地段局部 y=+0.007，配合包体的剪切姿态（底部补偿 -0.0035）
  // 让肩带底面与包底同时贴地，不悬空也不穿地。
  const strapA = [
    new THREE.Vector3(-0.095, 0.468, -0.088),
    new THREE.Vector3(-0.138, 0.385, -0.028),
    new THREE.Vector3(-0.162, 0.250, 0.030),
    new THREE.Vector3(-0.156, 0.110, 0.060),
    new THREE.Vector3(-0.148, 0.052, 0.070),
    new THREE.Vector3(-0.112, 0.010, 0.086),
    new THREE.Vector3(-0.032, 0.008, 0.100),
    new THREE.Vector3(0.038, 0.008, 0.070),
  ];
  const strapB = [
    new THREE.Vector3(0.095, 0.468, -0.088),
    new THREE.Vector3(0.156, 0.390, -0.020),
    new THREE.Vector3(0.198, 0.255, 0.032),
    new THREE.Vector3(0.202, 0.115, 0.055),
    new THREE.Vector3(0.196, 0.055, 0.062),
    new THREE.Vector3(0.156, 0.010, 0.078),
    new THREE.Vector3(0.078, 0.008, 0.096),
    new THREE.Vector3(0.010, 0.008, 0.082),
  ];
  for (const [index, strapPoints] of [strapA, strapB].entries()) {
    const strap = new THREE.Mesh(buildRibbonGeometry(strapPoints, 0.030, 0.006, 72), webbing);
    strap.name = `backpack-shoulder-strap-${index}`;
    strap.castShadow = true;
    strap.receiveShadow = true;
    group.add(strap);
    const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.022, 0.010, 2, 0.003), blackTrim);
    buckle.position.copy(strapPoints[2]);
    buckle.position.x += index === 0 ? 0.006 : -0.004;
    buckle.rotation.set(0.10, 0.2, index === 0 ? -0.2 : 0.18);
    group.add(buckle);
    const buckleSlot = new THREE.Mesh(new RoundedBoxGeometry(0.023, 0.006, 0.002, 2, 0.0015), blackFabric);
    buckleSlot.position.copy(buckle.position).add(new THREE.Vector3(0, 0, 0.0055));
    buckleSlot.rotation.copy(buckle.rotation);
    group.add(buckleSlot);
  }

  const handlePoints = [
    new THREE.Vector3(-0.048, 0.505, -0.020),
    new THREE.Vector3(-0.052, 0.558, -0.008),
    new THREE.Vector3(0.000, 0.575, -0.002),
    new THREE.Vector3(0.052, 0.558, -0.008),
    new THREE.Vector3(0.048, 0.505, -0.020),
  ];
  const handle = new THREE.Mesh(buildRibbonGeometry(handlePoints, 0.026, 0.006, 48), webbing);
  handle.name = 'backpack-top-handle';
  handle.castShadow = true;
  group.add(handle);

  // 背部的黑色网布衬垫与侧袋，只在 3/4 和低角度可见。
  const backPad = new THREE.Mesh(new RoundedBoxGeometry(0.225, 0.310, 0.022, 3, 0.014), blackFabric);
  backPad.position.set(0, 0.300, -0.087);
  backPad.castShadow = true;
  group.add(backPad);
  for (let i = 0; i < 3; i += 1) {
    const channel = new THREE.Mesh(new RoundedBoxGeometry(0.200, 0.012, 0.012, 2, 0.005), blackTrim);
    channel.position.set(0, 0.220 + i * 0.085, -0.097);
    group.add(channel);
  }
  const sidePocket = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.150, 0.120, 3, 0.012), blackFabric);
  sidePocket.position.set(-0.150, 0.185, 0.010);
  sidePocket.castShadow = true;
  group.add(sidePocket);
  const sideBand = new THREE.Mesh(new RoundedBoxGeometry(0.021, 0.011, 0.124, 2, 0.004), blackTrim);
  sideBand.position.set(-0.155, 0.220, 0.010);
  group.add(sideBand);

  group.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return group;
}

function buildWasteBin(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'waste-bin';
  group.position.set(-0.675, 0, 0.130);
  group.rotation.y = 0.22;

  const white = new THREE.MeshPhysicalMaterial({
    color: '#E4E2DB',
    roughness: 0.52,
    metalness: 0.02,
    clearcoat: 0.16,
    clearcoatRoughness: 0.4,
  });
  const green = new THREE.MeshPhysicalMaterial({
    color: '#6FBF7C',
    transparent: true,
    opacity: 0.55,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    transmission: 0.05,
    thickness: 0.001,
    side: THREE.DoubleSide,
  });
  const greenRim = new THREE.MeshPhysicalMaterial({
    color: '#5FB271',
    transparent: true,
    opacity: 0.6,
    roughness: 0.26,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    side: THREE.DoubleSide,
  });

  // 白色冲孔塑料篮：用 alphaMap 冲出一排排圆角方孔，孔后露出绿色袋子；
  // 这比用细杆拼篮子更接近参考照片中的白色薄壁塑料筐。
  const [perfCanvas, perfCtx] = makeCanvas(512, 512);
  perfCtx.fillStyle = '#FFFFFF';
  perfCtx.fillRect(0, 0, 512, 512);
  perfCtx.fillStyle = '#000000';
  const columns = 12;
  const rows = 5;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = (col + 0.5) * (512 / columns) - 9;
      const y = 74 + row * 78;
      perfCtx.beginPath();
      perfCtx.roundRect(x, y, 18, 58, 6);
      perfCtx.fill();
    }
  }
  const perfTexture = makeTexture(perfCanvas, THREE.NoColorSpace);
  perfTexture.wrapS = THREE.RepeatWrapping;
  perfTexture.wrapT = THREE.ClampToEdgeWrapping;
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: '#E8E6DF',
    alphaMap: perfTexture,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.02,
    clearcoat: 0.14,
    clearcoatRoughness: 0.4,
  });
  const basketProfile = [
    new THREE.Vector2(0.104, 0.018),
    new THREE.Vector2(0.106, 0.055),
    new THREE.Vector2(0.116, 0.120),
    new THREE.Vector2(0.126, 0.210),
    new THREE.Vector2(0.134, 0.290),
    new THREE.Vector2(0.137, 0.325),
  ];
  const basket = new THREE.Mesh(new THREE.LatheGeometry(basketProfile, 56), shellMaterial);
  basket.name = 'waste-bin-perforated-shell';
  basket.scale.z = 0.86;
  basket.castShadow = true;
  basket.receiveShadow = true;
  group.add(basket);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.0065, 10, 48), white);
  rim.rotation.x = Math.PI / 2;
  rim.scale.z = 0.86;
  rim.position.y = 0.325;
  group.add(rim);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.101, 0.106, 0.022, 32), white);
  foot.position.y = 0.011;
  group.add(foot);
  const bottomRing = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.0045, 8, 40), white);
  bottomRing.rotation.x = Math.PI / 2;
  bottomRing.scale.z = 0.86;
  bottomRing.position.y = 0.022;
  group.add(bottomRing);
  const topBand = new THREE.Mesh(new THREE.CylinderGeometry(0.137, 0.135, 0.018, 40, 1, true), white);
  topBand.scale.z = 0.86;
  topBand.position.y = 0.316;
  group.add(topBand);

  // 绿色垃圾袋：袋口高过篮沿，前侧折边压在白框上。
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.038, 0.022),
    new THREE.Vector2(0.064, 0.028),
    new THREE.Vector2(0.078, 0.070),
    new THREE.Vector2(0.089, 0.140),
    new THREE.Vector2(0.099, 0.220),
    new THREE.Vector2(0.109, 0.300),
    new THREE.Vector2(0.116, 0.348),
  ];
  const linerGeometry = new THREE.LatheGeometry(profile, 56);
  const linerPositions = linerGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < linerPositions.count; i += 1) {
    const x = linerPositions.getX(i);
    const y = linerPositions.getY(i);
    const z = linerPositions.getZ(i);
    const angle = Math.atan2(z, x);
    // 整袋加轻微起伏，顶部袋口再额外翻卷，避免读成一只光滑绿桶。
    const wrinkle = 1 + Math.sin(angle * 9 + y * 34) * 0.018 + Math.sin(angle * 17 + y * 61) * 0.010;
    linerPositions.setX(i, x * wrinkle);
    linerPositions.setZ(i, z * wrinkle);
    const topFold = Math.max(0, y - 0.290) / 0.058;
    linerPositions.setY(i, y + Math.sin(angle * 6 + 0.4) * 0.011 * topFold);
  }
  linerPositions.needsUpdate = true;
  linerGeometry.computeVertexNormals();
  const liner = new THREE.Mesh(linerGeometry, green);
  liner.scale.z = 0.86;
  liner.name = 'waste-bin-green-liner';
  group.add(liner);
  // 袋口外翻：整圈薄壁翻边挂在篮沿外侧（参考 桌底-2 左前垃圾桶）。
  const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.146, 0.139, 0.062, 48, 2, true), greenRim);
  fold.position.y = 0.312;
  fold.scale.z = 0.86;
  group.add(fold);
  const foldRim = new THREE.Mesh(new THREE.TorusGeometry(0.1455, 0.0045, 8, 56), greenRim);
  foldRim.rotation.x = Math.PI / 2;
  foldRim.scale.z = 0.86;
  foldRim.position.y = 0.343;
  group.add(foldRim);
  const interiorShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.100, 32),
    new THREE.MeshBasicMaterial({ color: '#183522', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  interiorShadow.rotation.x = -Math.PI / 2;
  interiorShadow.position.y = 0.09;
  group.add(interiorShadow);

  group.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return group;
}

function makeUnderDeskWoodMaterial(base: THREE.MeshPhysicalMaterial, tint: string, vertical: boolean, repeat = 1.8): THREE.MeshPhysicalMaterial {
  const material = base.clone();
  material.color.set(tint);
  material.map = drawWoodTexture();
  material.bumpMap = surfaceTexture('wood', 512, 1.8);
  material.roughnessMap = surfaceRoughness('wood', 512, 1.8, 0.7);
  material.bumpScale = 0.00045;
  material.roughness = 0.64;
  material.metalness = 0.0;
  material.clearcoat = 0.1;
  material.clearcoatRoughness = 0.34;
  material.envMapIntensity = 0.58;
  for (const key of ['map', 'bumpMap', 'roughnessMap'] as const) {
    const texture = material[key];
    if (!texture) continue;
    texture.center.set(0.5, 0.5);
    texture.rotation = vertical ? Math.PI / 2 : 0;
    texture.repeat.set(repeat, repeat);
  }
  material.needsUpdate = true;
  return material;
}

function buildUnderDeskSockets(parent: THREE.Group, aluminum: THREE.MeshPhysicalMaterial): void {
  const plastic = new THREE.MeshPhysicalMaterial({
    color: '#E9E8E3',
    roughness: 0.5,
    metalness: 0.02,
    clearcoat: 0.14,
    clearcoatRoughness: 0.35,
  });
  const plasticInner = new THREE.MeshPhysicalMaterial({
    color: '#F1F0EC',
    roughness: 0.58,
    metalness: 0.0,
  });
  const slotMat = new THREE.MeshStandardMaterial({ color: '#5C5D5C', roughness: 0.8, metalness: 0.05 });
  const blackPlug = new THREE.MeshPhysicalMaterial({ color: '#151719', roughness: 0.52, metalness: 0.02, clearcoat: 0.14 });
  const whitePlug = new THREE.MeshPhysicalMaterial({ color: '#D9D8D2', roughness: 0.48, metalness: 0.02, clearcoat: 0.2 });
  const plugGrey = new THREE.MeshStandardMaterial({ color: '#8F8E86', roughness: 0.66, metalness: 0.04 });

  const [faceCanvas, faceCtx] = makeCanvas(256, 256);
  faceCtx.fillStyle = '#ECEBE6';
  faceCtx.fillRect(0, 0, 256, 256);
  const faceShade = faceCtx.createLinearGradient(0, 0, 0, 256);
  faceShade.addColorStop(0, 'rgba(255,255,255,0.30)');
  faceShade.addColorStop(0.62, 'rgba(202,201,194,0.12)');
  faceShade.addColorStop(1, 'rgba(126,126,120,0.16)');
  faceCtx.fillStyle = faceShade;
  faceCtx.fillRect(0, 0, 256, 256);
  faceCtx.strokeStyle = 'rgba(135,135,128,0.55)';
  faceCtx.lineWidth = 3;
  faceCtx.strokeRect(24, 24, 208, 208);
  faceCtx.strokeStyle = 'rgba(255,255,255,0.65)';
  faceCtx.lineWidth = 1.5;
  faceCtx.strokeRect(28, 28, 200, 200);
  const drawSlot = (x: number, y: number, w: number, h: number, angle: number): void => {
    faceCtx.save();
    faceCtx.translate(x, y);
    faceCtx.rotate(angle);
    faceCtx.fillStyle = '#373B3D';
    faceCtx.beginPath();
    faceCtx.roundRect(-w / 2, -h / 2, w, h, 4);
    faceCtx.fill();
    faceCtx.strokeStyle = 'rgba(255,255,255,0.30)';
    faceCtx.lineWidth = 1;
    faceCtx.stroke();
    faceCtx.restore();
  };
  // 五孔面板：上三孔 + 下两孔，孔被插头遮住时仍保留轮廓。
  drawSlot(112, 66, 16, 34, -0.55);
  drawSlot(144, 66, 16, 34, 0.55);
  drawSlot(128, 52, 12, 26, 0);
  drawSlot(112, 164, 13, 38, 0);
  drawSlot(144, 164, 13, 38, 0);
  faceCtx.strokeStyle = 'rgba(92,94,92,0.55)';
  faceCtx.lineWidth = 2;
  faceCtx.beginPath();
  faceCtx.roundRect(32, 34, 192, 188, 8);
  faceCtx.stroke();
  const faceTexture = makeTexture(faceCanvas);
  faceTexture.wrapS = THREE.ClampToEdgeWrapping;
  faceTexture.wrapT = THREE.ClampToEdgeWrapping;
  const faceMaterial = new THREE.MeshPhysicalMaterial({ map: faceTexture, roughness: 0.62, metalness: 0.0 });

  const buildSocket = (x: number, plugType: 'black' | 'white' | 'none'): void => {
    const socket = new THREE.Group();
    socket.name = `under-desk-socket-${plugType}-${x.toFixed(3)}`;
    socket.position.set(x, 0.054, -0.2505);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.086, 0.007, 3, 0.004), plastic);
    plate.castShadow = true;
    plate.receiveShadow = true;
    socket.add(plate);
    const inner = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.075, 0.0024, 3, 0.003), plasticInner);
    inner.position.z = 0.0045;
    socket.add(inner);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.070, 0.070), faceMaterial);
    face.position.z = 0.0062;
    socket.add(face);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.0012, 10), slotMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, 0.0375, 0.0068);
    socket.add(screw);
    if (plugType !== 'none') {
      const plugMat = plugType === 'black' ? blackPlug : whitePlug;
      const plug = new THREE.Group();
      plug.name = `under-desk-plug-${plugType}`;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(plugType === 'black' ? 0.021 : 0.017, plugType === 'black' ? 0.020 : 0.016, 0.018, 20), plugMat);
      shell.rotation.x = Math.PI / 2;
      shell.position.set(plugType === 'black' ? -0.003 : 0.0, -0.004, 0.015);
      plug.add(shell);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.008, 16), plugGrey);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(plugType === 'black' ? -0.003 : 0.0, -0.020, 0.024);
      plug.add(collar);
      socket.add(plug);
    }
    parent.add(socket);
  };
  buildSocket(0.105, 'black');
  buildSocket(0.205, 'white');

  // 右侧空白敲落孔：金属框 + 深色内腔，对应参考照片。
  const knockout = new THREE.Group();
  knockout.name = 'under-desk-knockout';
  knockout.position.set(0.342, 0.058, -0.2520);
  const cavity = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.052, 0.003, 3, 0.006), new THREE.MeshStandardMaterial({ color: '#24272A', roughness: 0.85 }));
  cavity.position.z = 0.001;
  knockout.add(cavity);
  const frameMat = aluminum;
  const framePieces: Array<[number, number, number, number, number, number]> = [
    [0.084, 0.004, 0.004, 0, 0.028, 0.0025],
    [0.084, 0.004, 0.004, 0, -0.028, 0.0025],
    [0.004, 0.060, 0.004, -0.040, 0, 0.0025],
    [0.004, 0.060, 0.004, 0.040, 0, 0.0025],
  ];
  for (const [w, h, d, px, py, pz] of framePieces) {
    const piece = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.0012), frameMat);
    piece.position.set(px, py, pz);
    knockout.add(piece);
  }
  for (const side of [-1, 1]) {
    const tab = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.0025, 10), frameMat);
    tab.rotation.x = Math.PI / 2;
    tab.position.set(side * 0.044, 0, 0.003);
    knockout.add(tab);
  }
  parent.add(knockout);

  // 线槽上下沿的细压条与底部阴影缝。
  const topLip = new THREE.Mesh(new RoundedBoxGeometry(0.986, 0.005, 0.052, 2, 0.0015), aluminum);
  topLip.position.set(0, 0.1055, -0.2775);
  parent.add(topLip);
  const bottomReveal = new THREE.Mesh(new THREE.BoxGeometry(0.982, 0.0035, 0.0022), new THREE.MeshStandardMaterial({ color: '#242524', roughness: 0.9 }));
  bottomReveal.position.set(0, 0.0035, -0.2552);
  parent.add(bottomReveal);
}

function buildUnderDeskCables(parent: THREE.Group): void {
  const makeCable = (points: [number, number, number][], color: string, radius: number, name: string): THREE.Mesh => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, 'catmullrom', 0.35);
    const geometry = new THREE.TubeGeometry(curve, 96, radius, 7, false);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.56, metalness: 0.0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  makeCable([
    [0.292, 0.730, -0.286], [0.322, 0.620, -0.276], [0.338, 0.500, -0.262],
    [0.318, 0.372, -0.254], [0.276, 0.252, -0.250], [0.222, 0.156, -0.248],
    [0.168, 0.100, -0.246], [0.105, 0.074, -0.245],
  ], '#17191B', 0.0034, 'under-desk-black-drop');

  makeCable([
    [0.444, 0.730, -0.286], [0.468, 0.624, -0.276], [0.472, 0.486, -0.260],
    [0.446, 0.344, -0.252], [0.392, 0.218, -0.249], [0.304, 0.130, -0.247],
    [0.205, 0.076, -0.245],
  ], '#D8D6CF', 0.0030, 'under-desk-white-drop');
}

function buildUnderDeskArea(
  root: THREE.Group,
  nodes: Record<string, THREE.Object3D>,
  wood: THREE.MeshPhysicalMaterial | undefined,
  aluminum: THREE.MeshPhysicalMaterial | undefined,
): void {
  // 旧工厂的四腿与前/后横梁属于错误结构，直接从层级移除，避免隐藏件继续
  // 参与包围盒或阴影计算。
  for (const id of ['deskPostFL', 'deskPostFR', 'deskPostRL', 'deskPostRR', 'deskRailFront', 'deskRailBack']) {
    const node = nodes[id];
    if (node) node.removeFromParent();
  }
  if (!wood || !aluminum) return;

  const structure = new THREE.Group();
  structure.name = 'under-desk-structure';
  root.add(structure);

  const sideWood = makeUnderDeskWoodMaterial(wood, '#D0C9BC', true, 2.4);
  const backWood = makeUnderDeskWoodMaterial(wood, '#D6CFC3', false, 2.3);
  const postMat = aluminum.clone();
  postMat.color.set('#D1D3D2');
  postMat.metalness = 0.62;
  postMat.roughness = 0.42;
  postMat.envMapIntensity = 0.9;
  postMat.needsUpdate = true;
  const trunkingMat = aluminum.clone();
  trunkingMat.color.set('#CDD0CF');
  trunkingMat.metalness = 0.48;
  trunkingMat.roughness = 0.46;
  trunkingMat.clearcoat = 0.08;
  trunkingMat.envMapIntensity = 0.82;
  trunkingMat.needsUpdate = true;

  const sideGeo = new RoundedBoxGeometry(0.02, UNDER_DESK_TOP, 0.47, 3, 0.002);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(sideGeo, sideWood);
    panel.name = side < 0 ? 'under-desk-left-panel' : 'under-desk-right-panel';
    panel.position.set(side * UNDER_DESK_SIDE_X, UNDER_DESK_TOP / 2, -0.065);
    panel.castShadow = true;
    panel.receiveShadow = true;
    structure.add(panel);

    const edgeTrim = new THREE.Mesh(new RoundedBoxGeometry(0.022, UNDER_DESK_TOP, 0.0022, 2, 0.001), postMat);
    edgeTrim.name = side < 0 ? 'under-desk-left-edge-trim' : 'under-desk-right-edge-trim';
    edgeTrim.position.set(side * UNDER_DESK_SIDE_X, UNDER_DESK_TOP / 2, UNDER_DESK_FRONT_Z + 0.0011);
    edgeTrim.castShadow = true;
    structure.add(edgeTrim);
  }

  const backPanel = new THREE.Mesh(new RoundedBoxGeometry(1.05, UNDER_DESK_TOP, 0.03, 2, 0.002), backWood);
  backPanel.name = 'under-desk-back-panel';
  backPanel.position.set(0, UNDER_DESK_TOP / 2, UNDER_DESK_BACK_Z);
  backPanel.castShadow = true;
  backPanel.receiveShadow = true;
  structure.add(backPanel);

  // 背板上下铝框与角柱：40×40 型材，正面用两条浅槽复刻挤压件的明暗。
  const topRail = new THREE.Mesh(new RoundedBoxGeometry(1.05, 0.028, 0.014, 2, 0.002), trunkingMat);
  topRail.name = 'under-desk-top-rail';
  topRail.position.set(0, 0.717, -0.294);
  topRail.castShadow = true;
  structure.add(topRail);
  const gapLine = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.0016, 0.002), new THREE.MeshStandardMaterial({ color: '#383734', roughness: 0.9 }));
  gapLine.position.set(0, 0.7320, -0.294);
  structure.add(gapLine);

  const postGeo = new RoundedBoxGeometry(0.04, UNDER_DESK_TOP, 0.04, 2, 0.002);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.name = side < 0 ? 'under-desk-left-post' : 'under-desk-right-post';
    post.position.set(side * 0.51, UNDER_DESK_TOP / 2, -0.285);
    post.castShadow = true;
    post.receiveShadow = true;
    structure.add(post);
    for (const offset of [-0.012, 0.012]) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.0035, UNDER_DESK_TOP, 0.002), new THREE.MeshStandardMaterial({ color: '#7E8281', roughness: 0.5, metalness: 0.6 }));
      groove.position.set(side * 0.51 + offset, UNDER_DESK_TOP / 2, -0.2645);
      structure.add(groove);
    }
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.006, 0.046, 2, 0.002), postMat);
    shoe.position.set(side * 0.51, 0.003, -0.285);
    structure.add(shoe);
  }

  // 上缘压条下的成对挂扣，参考照片中 3 对金属件。
  const clipMat = postMat.clone();
  clipMat.color.set('#A9ACAB');
  clipMat.roughness = 0.55;
  clipMat.metalness = 0.8;
  for (const center of [-0.345, 0.000, 0.315]) {
    for (const offset of [-0.038, 0.038]) {
      const x = center + offset;
      const clip = new THREE.Group();
      clip.name = 'under-desk-top-clip';
      const plate = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.026, 0.006, 2, 0.0015), clipMat);
      plate.position.set(0, 0.700, -0.288);
      clip.add(plate);
      const hook = new THREE.Mesh(new RoundedBoxGeometry(0.0075, 0.007, 0.020, 2, 0.0015), clipMat);
      hook.position.set(0, 0.689, -0.278);
      clip.add(hook);
      const tip = new THREE.Mesh(new RoundedBoxGeometry(0.0075, 0.011, 0.006, 2, 0.0015), clipMat);
      tip.position.set(0, 0.696, -0.269);
      clip.add(tip);
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0016, 10), new THREE.MeshStandardMaterial({ color: '#4B4C4A', roughness: 0.5, metalness: 0.6 }));
      screw.rotation.x = Math.PI / 2;
      screw.position.set(0, 0.707, -0.2835);
      clip.add(screw);
      clip.position.x = x;
      structure.add(clip);
    }
  }

  // 底部带横向加强肋的铝线槽。肋条用真实几何而非贴图，近距离掠射光下可见。
  const trunkWidth = 0.978;
  const trunkHeight = 0.105;
  const trunkDepth = 0.045;
  const trunkZ = -0.2775;
  const trunk = new THREE.Mesh(new RoundedBoxGeometry(trunkWidth, trunkHeight, trunkDepth, 3, 0.0035), trunkingMat);
  trunk.name = 'under-desk-cable-trunking';
  trunk.position.set(0, trunkHeight / 2, trunkZ);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  structure.add(trunk);
  const ribGeo = new THREE.BoxGeometry(trunkWidth - 0.006, 0.0022, 0.0024);
  for (let i = 0; i < 16; i += 1) {
    const rib = new THREE.Mesh(ribGeo, trunkingMat);
    rib.position.set(0, 0.010 + i * 0.00555, trunkZ + trunkDepth / 2 + 0.0012);
    structure.add(rib);
  }
  buildUnderDeskSockets(structure, postMat);

  // 桌下线缆与地面陈设。
  buildUnderDeskCables(structure);
  const bag = buildBackpack();
  root.add(bag);
  const bin = buildWasteBin();
  root.add(bin);

  // 书包与垃圾桶的落地接触阴影 + 线槽前的浮灰。
  const contactTexture = drawContactShadowTexture();
  const groundShadow = (x: number, z: number, w: number, d: number, opacity: number): void => {
    const material = new THREE.MeshBasicMaterial({ map: contactTexture, color: '#000000', transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.0016, z);
    mesh.renderOrder = 2;
    root.add(mesh);
  };
  groundShadow(-0.330, -0.150, 0.46, 0.34, 0.34);
  groundShadow(-0.675, 0.130, 0.36, 0.30, 0.28);
  groundShadow(0.05, -0.220, 0.62, 0.11, 0.12);

  const [grimeCanvas, grimeCtx] = makeCanvas(512, 128);
  const grimeRand = rng(1934);
  grimeCtx.clearRect(0, 0, 512, 128);
  for (let i = 0; i < 600; i += 1) {
    const x = grimeRand() * 512;
    const y = 40 + grimeRand() * 86;
    const r = 1 + grimeRand() * 16;
    const g = grimeCtx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(78,68,53,${0.04 + grimeRand() * 0.1})`);
    g.addColorStop(1, 'rgba(78,68,53,0)');
    grimeCtx.fillStyle = g;
    grimeCtx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const grimeTexture = makeTexture(grimeCanvas);
  grimeTexture.wrapS = THREE.ClampToEdgeWrapping;
  grimeTexture.wrapT = THREE.ClampToEdgeWrapping;
  const grime = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.20), new THREE.MeshBasicMaterial({ map: grimeTexture, transparent: true, opacity: 0.7, depthWrite: false }));
  grime.rotation.x = -Math.PI / 2;
  grime.position.set(0.03, 0.0012, -0.215);
  grime.renderOrder = 1;
  root.add(grime);
}

function buildErgonomicChair(): ChairDetail {
  const shell = chairShellMaterial();
  const meshMat = chairMeshMaterial();
  const padMat = chairPadMaterial();
  const group = new THREE.Group();
  group.name = 'ergonomic-chair';

  // ---- 五星脚 + 滚轮（贴地）----
  // 参考：黑色尼龙五星脚，每条腿末端一双并排滚轮。轮半径 0.026m，腿与 hub 都贴到轮顶附近。
  const base = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.06, 20), shell);
  hub.position.y = 0.10;
  hub.castShadow = true;
  base.add(hub);
  // 腿的几何中心在长度一半处，沿 -Z 方向拉伸后旋转朝外。
  const legGeo = new RoundedBoxGeometry(0.058, 0.030, 0.30, 3, 0.013);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + Math.PI / 10;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 腿中心：从轴心外推 0.17m，让 0.30m 长的腿跨 0.02–0.32m；腿顶与 hub 顶齐平。
    const leg = new THREE.Mesh(legGeo, shell);
    leg.position.set(cos * 0.17, 0.085, sin * 0.17);
    leg.rotation.y = Math.PI / 2 - angle;
    leg.castShadow = true;
    base.add(leg);
    // 腿末端叉架。
    const fx = cos * 0.305;
    const fz = sin * 0.305;
    const fork = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.05, 0.04, 2, 0.01), shell);
    fork.position.set(fx, 0.055, fz);
    fork.castShadow = true;
    base.add(fork);
    // 双轮：沿腿方向前后各一，轮轴横向。
    for (const off of [-0.017, 0.017]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.017, 16), padMat);
      wheel.castShadow = true;
      wheel.rotation.order = 'YXZ';
      wheel.rotation.y = -angle;
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(fx + cos * off, 0.026, fz + sin * off);
      base.add(wheel);
    }
  }
  group.add(base);

  // ---- 气压杆（hub 顶 0.10+0.03=0.13 到座垫底 0.41，长度约 0.28）----
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 16), shell);
  piston.position.y = 0.13 + 0.12;
  piston.castShadow = true;
  group.add(piston);
  const pistonShroud = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.10, 16), shell);
  pistonShroud.position.y = 0.16;
  pistonShroud.castShadow = true;
  group.add(pistonShroud);
  // 顶部防尘套（座底到气压杆顶端过渡）。
  const shroudTop = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.06, 14), shell);
  shroudTop.position.y = 0.36;
  group.add(shroudTop);

  // ---- 底盘 + 操纵杆 ----
  const mech = new THREE.Mesh(new RoundedBoxGeometry(0.20, 0.055, 0.22, 3, 0.02), shell);
  mech.position.y = 0.415;
  mech.castShadow = true;
  group.add(mech);
  const leverRod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.11, 10), shell);
  leverRod.rotation.z = 1.25;
  leverRod.position.set(0.135, 0.40, 0.02);
  group.add(leverRod);
  const leverTip = new THREE.Mesh(new RoundedBoxGeometry(0.028, 0.05, 0.024, 2, 0.008), padMat);
  leverTip.position.set(0.19, 0.372, 0.02);
  group.add(leverTip);

  // ---- 坐垫：前缘瀑布形厚垫，微凹网面；向后伸出与靠背下沿贴合 ----
  // 座垫坐标系：原点在座垫底面中心（y=SEAT_TOP-0.045），z 向 + 为坐者后方。
  const seat = new THREE.Group();
  const seatCushion = new THREE.Mesh(new RoundedBoxGeometry(0.50, 0.09, 0.50, 4, 0.045), padMat);
  seatCushion.position.set(0, SEAT_TOP - 0.045, 0.0);
  seatCushion.castShadow = true;
  seat.add(seatCushion);
  // 座面网布：中心微凹 8 mm，前缘顺势下压 6 mm，形成参考中的瀑布前缘。
  const seatPadGeo = new THREE.PlaneGeometry(0.46, 0.44, 24, 24);
  seatPadGeo.rotateX(-Math.PI / 2);
  seatPadGeo.translate(0, 0, 0.01);
  {
    const positions = seatPadGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const bowl = Math.max(0, 1 - (x / 0.215) ** 2 - (z / 0.205) ** 2);
      const waterfall = THREE.MathUtils.clamp((z - 0.12) / 0.10, 0, 1);
      positions.setY(i, SEAT_TOP + 0.003 - 0.008 * bowl - 0.006 * waterfall);
    }
    positions.needsUpdate = true;
    seatPadGeo.computeVertexNormals();
  }
  const seatWeave = new THREE.Mesh(seatPadGeo, meshMat);
  seatWeave.receiveShadow = true;
  seat.add(seatWeave);
  // 扶手挂在座垫层：与座垫刚性连接，不随后仰转动。
  // seat 组原点在椅组原点（y=0 地面），扶手内部坐标用 seat 局部。
  seat.add(buildArmrest(-1, shell));
  seat.add(buildArmrest(1, shell));
  group.add(seat);

  // ---- 靠背（整体可绕底盘后仰）；下沿贴近座垫后缘 ----
  const backPivot = new THREE.Group();
  backPivot.position.set(0, SEAT_TOP, -0.225);
  group.add(backPivot);

  // 背部外框 + 网布
  const backPanel = new THREE.Mesh(buildMeshPanel(BACK_STATIONS, 14, 0.045), meshMat);
  backPanel.castShadow = true;
  backPivot.add(backPanel);
  backPivot.add(buildFrameLoop(BACK_STATIONS, 0.020, shell));

  // 靠背整体后仰约 8°，与参考侧视一致。
  backPivot.rotation.x = THREE.MathUtils.degToRad(-8);

  // 腰靠：浅灰翼形承托板，孔面朝后（参考椅子-1 背面视角），
  // 下缘用两根金属横杆固定到背框。
  const lumbar = new THREE.Group();
  const lumbarMat = new THREE.MeshPhysicalMaterial({ color: '#8A908E', roughness: 0.65, metalness: 0.12 });
  const lumbarPlate = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.145, 0.014, 3, 0.02), lumbarMat);
  lumbarPlate.castShadow = true;
  lumbar.add(lumbarPlate);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.115, 0.012, 3, 0.02), lumbarMat);
    // 翼板贴住背板侧缘，不越过网布外轮廓。
    wing.position.set(side * 0.112, 0.004, 0.010);
    wing.rotation.y = side * -0.32;
    wing.castShadow = true;
    lumbar.add(wing);
  }
  const holeMat = new THREE.MeshBasicMaterial({ color: '#0B0C0D' });
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const hx = (c - 3) * 0.027;
      const hy = (r - 2) * 0.024;
      if (Math.abs(hx) > 0.085 - Math.abs(hy) * 0.35) continue;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0026, 8), holeMat);
      hole.position.set(hx, hy, -0.0075);
      hole.rotation.y = Math.PI;
      lumbar.add(hole);
    }
  }
  for (const side of [-1, 1]) {
    for (let r = 0; r < 3; r += 1) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0026, 8), holeMat);
      hole.position.set(side * (0.105 + r * 0.014), -0.03 + r * 0.03, 0.02 - r * 0.008);
      hole.rotation.y = Math.PI + side * -0.32;
      lumbar.add(hole);
    }
  }
  lumbar.position.set(0, 0.15, -0.07);
  backPivot.add(lumbar);

  // 两根金属横杆：托住腰靠下缘，也是参考背面可见的银色细杆。
  const barMat = new THREE.MeshStandardMaterial({ color: '#B9BDBC', roughness: 0.35, metalness: 0.8 });
  for (const y of [0.072, 0.098]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.30, 12), barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, -0.094);
    bar.castShadow = true;
    backPivot.add(bar);
  }

  // 全宽 X 背架：两条扁条在背板后方交叉，与中脊组成参考中的背部主结构。
  for (const dir of [-1, 1]) {
    const strip = new THREE.Mesh(new RoundedBoxGeometry(0.042, 0.58, 0.028, 3, 0.011), shell);
    strip.position.set(0, 0.28, -0.09);
    strip.rotation.z = dir * 0.38;
    strip.castShadow = true;
    backPivot.add(strip);
  }

  // 头枕：宽大的叶形网布枕，正面不设任何支架。支撑臂从靠背顶梁后方伸出，
  // 在头枕背面用夹块与铰点固定（参考 figure/椅子-1..4.jpg）。
  const HEADREST_STATIONS: Array<[number, number, number]> = [
    [0.000, 0.135, 0.012],
    [0.045, 0.175, 0.002],
    [0.105, 0.195, -0.008],
    [0.155, 0.190, -0.016],
    [0.180, 0.160, -0.024],
  ];
  const headrest = new THREE.Group();
  const headPanel = new THREE.Mesh(buildMeshPanel(HEADREST_STATIONS, 16, 0.010), meshMat);
  headPanel.castShadow = true;
  headrest.add(headPanel);
  headrest.add(buildFrameLoop(HEADREST_STATIONS, 0.024, shell));
  headrest.position.set(0, 0.61, -0.058);
  headrest.rotation.x = THREE.MathUtils.degToRad(-6);
  backPivot.add(headrest);

  // 背面夹块与两侧铰点螺栓：顺头枕后壳倾斜，正面被网布完全遮住。
  const headClampGroup = new THREE.Group();
  headClampGroup.position.set(0, 0.12, -0.043);
  headClampGroup.rotation.x = THREE.MathUtils.degToRad(-10);
  headrest.add(headClampGroup);
  const headClamp = new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.10, 0.030, 3, 0.012), shell);
  headClamp.castShadow = true;
  headClampGroup.add(headClamp);
  for (const side of [-1, 1]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.018, 14), shell);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(side * 0.057, 0, 0);
    bolt.castShadow = true;
    headClampGroup.add(bolt);
  }
  // 支撑臂：位于头枕背后，从顶梁升到夹块；底夹抱住靠背顶梁。
  const headArm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.20, 0.036, 3, 0.014), shell);
  headArm.position.set(0, 0.06, -0.064);
  headArm.castShadow = true;
  headrest.add(headArm);
  const headCollar = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.06, 0.075, 3, 0.016), shell);
  headCollar.position.set(0, -0.04, -0.040);
  headCollar.castShadow = true;
  headrest.add(headCollar);

  // 中央脊梁：从底盘到顶梁背后的注塑中柱，参考图脊梁是较宽的扁条。
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.60, 0.030, 3, 0.014), shell);
  spine.position.set(0, 0.28, -0.095);
  spine.castShadow = true;
  backPivot.add(spine);

  group.position.set(CHAIR_POS.x, 0, CHAIR_POS.z);
  group.rotation.y = Math.PI;
  return { group, backPivot };
}

export function enhanceWorkstation(root: THREE.Group): WorkstationAnimationApi {
  const runtime = root.userData.sculptRuntime as Runtime | undefined;
  if (!runtime) {
    return {
      openLaptop: () => {}, closeLaptop: () => {}, setLaptopLidInstant: () => {}, panMonitor: () => {}, tiltMonitor: () => {},
      pressKey: () => {}, releaseKey: () => {}, setKeyboardRgb: () => {}, setKeyboardRgbColor: () => {},
      setKeyboardRgbScale: () => {}, pauseAnimations: () => {}, resumeAnimations: () => {}, moveMouse: () => {},
      spinWheel: () => {}, openMugLid: () => {}, toggleSteam: () => {}, swayBottle: () => {},
      setScreenPower: () => {}, setScreenContent: () => {}, setLightingMode: () => {}, swivelChair: () => {}, reclineChair: () => {},
      getState: () => ({}),
    };
  }
  const { nodes, meshes } = runtime;
  let displayMugLid: THREE.Group | null = null;

  // --- clean material corrections -----------------------------------------
  const wood = meshes.desk?.material as THREE.MeshPhysicalMaterial | undefined;
  if (wood) {
    wood.map = drawWoodTexture();
    wood.map.repeat.set(0.92, 0.92);
    wood.color.set('#DFCBAE');
    wood.bumpMap = surfaceTexture('wood', 512, 1.6);
    wood.bumpScale = 0.0005;
    wood.normalMap = null;
    wood.roughnessMap = surfaceRoughness('wood', 512, 1.6, 0.68);
    wood.roughness = 0.6;
    wood.metalness = 0.0;
    wood.clearcoat = 0.16;
    wood.clearcoatRoughness = 0.26;
    wood.envMapIntensity = 0.62;
    wood.needsUpdate = true;

    const woodVariant = (id: string, tint: string, vertical: boolean, repeatScale = 1) => {
      const mesh = meshes[id];
      if (!mesh) return;
      const variant = wood.clone();
      variant.color.set(tint);
      variant.map = drawWoodTexture();
      variant.bumpMap = surfaceTexture('wood', 512, 1.6);
      variant.roughnessMap = surfaceRoughness('wood', 512, 1.6, 0.68);
      if (vertical) variant.bumpScale = 0.0005;
      for (const key of ['map', 'bumpMap', 'roughnessMap'] as const) {
        const texture = variant[key];
        if (!texture) continue;
        texture.center.set(0.5, 0.5);
        texture.rotation = vertical ? Math.PI / 2 : 0;
        texture.repeat.set(repeatScale, repeatScale);
      }
      variant.needsUpdate = true;
      mesh.material = variant;
    };
    // Veneer direction follows the panel, as in the reference: vertical on the
    // partition leaves, horizontal on the worktop and shelf. Higher repeats keep the
    // wall fibre at furniture scale instead of reading as corrugation.
    woodVariant('partition', '#C9C0B1', true, 2.4);
    woodVariant('leftSidePanel', '#CCC3B3', true, 1.8);
    woodVariant('rightSidePanel', '#CCC3B3', true, 1.8);
    woodVariant('shelf', '#C3B7A3', false, 1.2);
  }
  const white = meshes.laptopBase?.material as THREE.MeshPhysicalMaterial | undefined;
  if (white) {
    white.map = null;
    white.normalMap = null;
    white.color.set('#E6E3DD');
    applySurfaceMaps(white, 'micro', 0.0001, 5, 0.88);
    white.roughness = 0.44;
    white.metalness = 0.08;
    white.clearcoat = 0.16;
    white.clearcoatRoughness = 0.26;
    white.envMapIntensity = 0.88;
    white.needsUpdate = true;
  }
  for (const id of ['leftGlass', 'rightGlass']) {
    // Frosted panels pass daylight; letting them cast keeps a hard fake shadow across
    // the back wall that no real glass partition would produce.
    if (meshes[id]) meshes[id].castShadow = false;
    const glass = meshes[id]?.material as THREE.MeshPhysicalMaterial | undefined;
    if (glass) {
      glass.map = null;
      glass.normalMap = null;
      glass.color.set('#95A49A');
      applySurfaceMaps(glass, 'frost', 0.00065, 1.4, 0.92);
      glass.transmission = 0.06;
      glass.opacity = 0.96;
      glass.transparent = true;
      glass.roughness = 0.9;
      glass.metalness = 0.0;
      glass.thickness = 0.006;
      glass.ior = 1.5;
      glass.attenuationColor.set('#DCE6E2');
      glass.attenuationDistance = 0.25;
      glass.side = THREE.DoubleSide;
      glass.envMapIntensity = 0.12;
      glass.needsUpdate = true;
    }
  }
  const glassSticker = meshes.leftGlassSticker?.material as THREE.MeshStandardMaterial | undefined;
  if (glassSticker) {
    glassSticker.color.set('#D2D3CE');
    glassSticker.needsUpdate = true;
  }
  hideMesh(meshes, 'mug');
  hideMesh(meshes, 'teaLiquid');
  for (const id of ['mugLid', 'mugLidKnob', 'mugGrip']) {
    if (nodes[id]) nodes[id].visible = false;
  }
  if (nodes.mug) displayMugLid = buildGlassMug(nodes.mug);
  const padMat = meshes.mousepad?.material as THREE.MeshPhysicalMaterial | undefined;
  if (padMat) {
    padMat.map = drawFabricTexture();
    padMat.normalMap = null;
    // 参考鼠标垫是偏冷的中灰布面，不是浅米色。
    padMat.color.set('#A8ABAE');
    applySurfaceMaps(padMat, 'fabric', 0.0008, 3, 0.94);
    padMat.roughness = 0.95;
    padMat.metalness = 0.0;
    padMat.needsUpdate = true;
  }
  // 背板保持均匀受光：既不接收搁板投下的楔形暗带，也不接收架上物件
  // 越过搁板边缘的残余阴影。架上物件的真实遮挡由搁板自身完成。
  if (meshes.partition) meshes.partition.receiveShadow = false;
  const mugDeck = meshes.laptopKeyboardDeck?.material as THREE.MeshPhysicalMaterial | undefined;
  if (mugDeck) {
    mugDeck.normalMap = null;
    mugDeck.color.set('#C8CAC5');
    applySurfaceMaps(mugDeck, 'micro', 0.0001, 5, 0.86);
    mugDeck.roughness = 0.58;
    mugDeck.metalness = 0.0;
    mugDeck.needsUpdate = true;
  }
  const aluminumMat = meshes.leftMullion?.material as THREE.MeshPhysicalMaterial | undefined;
  if (aluminumMat) {
    applySurfaceMaps(aluminumMat, 'metal', 0.00028, 3, 0.48);
    aluminumMat.color.set('#C4C7C8');
    aluminumMat.metalness = 0.94;
    aluminumMat.roughness = 0.4;
    aluminumMat.envMapIntensity = 1.2;
    aluminumMat.needsUpdate = true;
  }
  // 桌下结构在木材/铝材修正之后建立，保证新件直接复用同一套程序化材质。
  buildUnderDeskArea(root, nodes, wood, aluminumMat);
  const standMat = meshes.laptopStandBase?.material as THREE.MeshPhysicalMaterial | undefined;
  if (standMat) {
    applySurfaceMaps(standMat, 'metal', 0.0003, 3, 0.58);
    standMat.metalness = 0.6;
    standMat.roughness = 0.55;
    standMat.needsUpdate = true;
  }
  const monitorShell = meshes.monitor?.material as THREE.MeshPhysicalMaterial | undefined;
  if (monitorShell) {
    applySurfaceMaps(monitorShell, 'micro', 0.00016, 4, 0.78);
    monitorShell.roughness = 0.4;
    monitorShell.clearcoat = 0.28;
    monitorShell.clearcoatRoughness = 0.2;
    monitorShell.envMapIntensity = 1.0;
    monitorShell.needsUpdate = true;
  }
  const bottleMat = meshes.bottle?.material as THREE.MeshPhysicalMaterial | undefined;
  if (bottleMat) {
    bottleMat.bumpMap = surfaceTexture('micro', 512, 2);
    bottleMat.bumpScale = 0.00022;
    // 8/9.jpg：瓶身为烟灰半透明磨砂塑料，表面应发哑而不是镜面。
    bottleMat.color.set('#858B86');
    bottleMat.roughness = 0.7;
    bottleMat.metalness = 0.0;
    bottleMat.transmission = 0.26;
    bottleMat.thickness = 0.005;
    bottleMat.ior = 1.46;
    // transmission 只有在 transparent 材质上才会进入折射采样通道。
    bottleMat.transparent = true;
    bottleMat.opacity = 1;
    bottleMat.depthWrite = false;
    bottleMat.clearcoat = 0.0;
    bottleMat.envMapIntensity = 0.4;
    bottleMat.attenuationColor.set('#4E5551');
    bottleMat.attenuationDistance = 0.14;
    bottleMat.side = THREE.DoubleSide;
    bottleMat.roughnessMap = surfaceRoughness('micro', 512, 2, 0.86);
    bottleMat.needsUpdate = true;
  }
  if (meshes.bottle) {
    // 以瓶口为基准压缩瓶身，瓶盖、挂带与挂钩的连接点保持不动。
    // 实物 750 ml 规格约 251 × 78 mm；瓶身 270 × 0.765 ≈ 206.5 mm，含盖总高约 251 mm。
    const bottleBodyScaleY = 0.765;
    // 实物为宽口设计：颈部几乎与瓶肩同宽，只收一层浅肩线（8/9.jpg 证据）。
    // 工厂 lathe 把颈部收到 0.24 比例（≈20 mm），与实物不符；此处重建为薄壁中空瓶：
    // 外壁轮廓保持原宽口肩线，内壁按 2–3 mm 壁厚内缩，底部约 5 mm 厚。
    const neckProfile: Array<[number, number]> = [
      [0.45, 0.5], [0.455, 0.47], [0.465, 0.4], [0.48, 0.25], [0.5, -0.4], [0.485, -0.48], [0.44, -0.5],
      [0.0, -0.5], [0.0, -0.482],
      [0.425, -0.482], [0.465, -0.4], [0.455, 0.25], [0.44, 0.4], [0.43, 0.47], [0.425, 0.5],
      [0.45, 0.5],
    ];
    replaceGeometry(meshes.bottle, buildScaledLathe(neckProfile, 0.085, 0.27, 48));
    meshes.bottle.scale.y = bottleBodyScaleY;
    meshes.bottle.position.y = 0.135 * (1 - bottleBodyScaleY);

    // 瓶内饮用水：透过磨砂瓶壁看到约 55% 的液面（参考 水壶-1.jpg）。
    // 挂在瓶身枢轴而不是压缩后的网格上，坐标即最终瓶身空间。
    const liquid = new THREE.Group();
    liquid.name = 'bottle-liquid';
    const liquidBody = new THREE.Mesh(
      // 半径随瓶身内壁收分，液面处贴住瓶壁，避免悬空的硬边圆环。
      new THREE.CylinderGeometry(0.038, 0.0355, 0.1126, 48),
      // 不透明：透明物体不会进入 three.js 的 transmission 采样，液面会消失。
      new THREE.MeshStandardMaterial({ color: '#232926', roughness: 0.45, metalness: 0.05 }),
    );
    liquidBody.position.y = -0.0142;
    liquidBody.castShadow = false;
    liquidBody.receiveShadow = false;
    liquid.add(liquidBody);
    const liquidSurface = new THREE.Mesh(
      new THREE.CircleGeometry(0.038, 48),
      new THREE.MeshStandardMaterial({ color: '#2E3531', roughness: 0.5, metalness: 0.06 }),
    );
    liquidSurface.rotation.x = -Math.PI / 2;
    liquidSurface.position.y = 0.0421;
    liquid.add(liquidSurface);
    nodes.bottle?.add(liquid);
  }

  // --- screens -------------------------------------------------------------
  const screens: ScreenState[] = [];
  if (meshes.laptopScreen) {
    hideMesh(meshes, 'keycapMatrix');
    const s = createLaptopScreen(root, meshes.laptopScreen);
    if (s) screens.push(s);
  }
  if (meshes.monitorScreen) {
    const s = createMonitorScreen(root, meshes.monitorScreen);
    if (s) screens.push(s);
  }

  // --- keyboard ------------------------------------------------------------
  let keyState: ReturnType<typeof createKeyLayout> | null = null;
  let keyboardRgbLight: THREE.PointLight | null = null;
  let keyboardDeskGlow: THREE.Mesh | null = null;
  if (nodes.keycapMatrix) {
    hideMesh(meshes, 'keycapMatrix');
    keyState = createKeyLayout(nodes.keycapMatrix);
  }
  slimExternalKeyboard(nodes, meshes);

  if (nodes.keyboard) {
    // 键下灯只照亮键缝；这盏点光负责把颜色带到键帽与腕托。
    // 抬到键床上方中央并降低强度，避免在机身前沿斜面上烧出一条粉色高光。
    keyboardRgbLight = new THREE.PointLight(0x2bd8ff, 0.09, 0.55, 1.9);
    keyboardRgbLight.name = 'keyboard-rgb-light';
    keyboardRgbLight.position.set(0, 0.095, 0);
    keyboardRgbLight.castShadow = false;
    nodes.keyboard.add(keyboardRgbLight);

    const glowMaterial = new THREE.MeshBasicMaterial({
      map: drawRgbGlowTexture(),
      color: '#2bd8ff',
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // 溢光面收在机身后侧与两侧，避免从壳体 2 mm 离地缝里露成前沿硬光带。
    keyboardDeskGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.15), glowMaterial);
    keyboardDeskGlow.name = 'keyboard-rgb-desk-glow';
    keyboardDeskGlow.rotation.x = -Math.PI / 2;
    keyboardDeskGlow.position.set(0, 0.00012, -0.055);
    keyboardDeskGlow.renderOrder = 3;
    nodes.keyboard.add(keyboardDeskGlow);
  }

  if (nodes.laptopKeyboardDeck) {
    // 工厂键盘面自身带 0.14 rad 倾斜，作为子级会与机身叠加；此处归零并只作为一个键盘坐标组。
    nodes.laptopKeyboardDeck.position.set(0, 0.008, 0);
    nodes.laptopKeyboardDeck.rotation.set(0, 0, 0);
    if (meshes.laptopKeyboardDeck) meshes.laptopKeyboardDeck.visible = false;
    createLaptopKeys(nodes.laptopKeyboardDeck);
  }

  // --- 桌顶格架与陈设 -------------------------------------------------------
  buildShelfHutch(root, nodes, meshes);

  // --- paper still life on the narrower desk ------------------------------
  if (nodes.paperStack) nodes.paperStack.visible = false;
  createDeskProps(root);

  // --- mousepad print and stitching ---------------------------------------
  if (nodes.mousepad) {
    // 用户实物鼠标垫竖放：长边（340mm）沿桌面前后方向，短边（250mm）沿左右。
    // 绕 Y 轴转 90°，印刷、缝线与垫子上的鼠标作为子级一并旋转。
    nodes.mousepad.rotation.y = -Math.PI / 2;
    // 重新定位中心：旋转后垫子占 x ∈ [中心±0.125]、z ∈ [中心±0.17]，
    // 保持在桌面右侧、不超出桌沿（z ∈ [-0.30, 0.20]）。
    nodes.mousepad.position.set(0.330, 0.759, 0.015);
    createMousepadSurface(nodes.mousepad);
  }

  // --- cables --------------------------------------------------------------
  hideMesh(meshes, 'whiteLead');
  hideMesh(meshes, 'blackLead');
  hideMesh(meshes, 'earphoneLead');
  createCables(root);
  createPowerStrip(root);

  // --- decals --------------------------------------------------------------
  const monitorDecals: THREE.Mesh[] = [];
  if (nodes.monitor) {
    const aoc = addDecal(nodes.monitor, labelTexture('AOC', '#D9DCDD', 512, 128, '700 82px Arial', { align: 'center' }),
      0.044, 0.011, [0, -0.151, 0.0155]);
    aoc.name = 'aoc-logo-decal';
    const chin = addDecal(nodes.monitor, labelTexture('AOC  Q24G2', 'rgba(150,160,170,0.6)', 512, 40, '600 24px Arial', { align: 'center' }),
      0.066, 0.0065, [0, -0.159, 0.0155]);
    chin.name = 'aoc-model-decal';
    monitorDecals.push(aoc, chin);
  }
  // 笔记本外壳、键盘面与品牌铭牌统一重建，避免沿用错误的 ROG 标识。
  buildLaptopHardware(nodes, meshes);
  if (nodes.bottle) {
    addDecal(nodes.bottle, labelTexture('UZSPACE', '#EEF2EF', 128, 512, '700 34px Arial', { vertical: true }),
      0.043, 0.135, [0.008, 0.028, 0.0452], [0, 0, 0], 0.98, 6);
    buildBottleDetails(nodes, meshes);
    // 织带从瓶盖侧折向玻璃挂钩，补上工厂挂带的最后 3 cm。
    const strapBridge = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.024, 0.310, 0.030),
        new THREE.Vector3(0.036, 0.313, 0.023),
        new THREE.Vector3(0.047, 0.312, 0.011),
        new THREE.Vector3(0.053, 0.309, 0.002),
      ]), 24, 0.0032, 6, false),
      new THREE.MeshStandardMaterial({ color: '#17181A', roughness: 0.82, metalness: 0.05 }),
    );
    strapBridge.name = 'bottle-strap-hook-bridge';
    strapBridge.castShadow = true;
    nodes.bottle.add(strapBridge);
  }
  const mouseDetail = buildInphicMouse(nodes, meshes);
  buildBottleHook(nodes, meshes);
  if (nodes.laptopBase) {
    // 参考图中的白色机身只有极轻的前缘暖光，不再使用高饱和 RGB 灯条。
    const lightBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.27, 0.0016, 0.0018),
      new THREE.MeshBasicMaterial({ color: '#E8D8CB', transparent: true, opacity: 0.38, toneMapped: false }),
    );
    lightBar.name = 'laptop-front-lightbar';
    lightBar.position.set(0, -0.0074, 0.1234);
    nodes.laptopBase.add(lightBar);
  }
  if (nodes.laptopStandCrossbar) {
    const screwMat = new THREE.MeshStandardMaterial({ color: '#2E3235', roughness: 0.35, metalness: 0.8 });
    for (const side of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0022, 14), screwMat);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(side * 0.105, 0, 0.014);
      nodes.laptopStandCrossbar.add(screw);
    }
  }
  if (nodes.keyboard) {
    addDecal(nodes.keyboard, labelTexture('WK', '#B7BEC2', 256, 64, '800 38px Arial', {}),
      0.022, 0.0055, [0.105, keyboardDeckTop(-0.062) + 0.0003, -0.062],
      [-Math.PI / 2 + KEYBOARD_DECK_ANGLE, 0, 0], 0.75, 6);
  }
  if (nodes.usbHub) {
    for (let i = 0; i < 2; i += 1) {
      const port = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.004),
        new THREE.MeshBasicMaterial({ color: '#151719', toneMapped: false }));
      port.position.set(-0.005 + i * 0.014, 0.0, 0.0118);
      nodes.usbHub.add(port);
    }
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.0025),
      new THREE.MeshBasicMaterial({ color: '#EAF6FF', toneMapped: false }));
    led.position.set(0, 0.018, 0.0118);
    nodes.usbHub.add(led);
  }

  // Screen glass reflection: a faint diagonal sheen in front of the emissive layer.
  const screenReflectionTexture = drawScreenReflectionTexture();
  for (const screen of screens) {
    const mesh = screen.mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) continue;
    const w = box.max.x - box.min.x;
    const h = box.max.y - box.min.y;
    const reflection = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: screenReflectionTexture, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    reflection.position.z = screen.kind === 'laptop' ? 0.0003 : 0.0008;
    reflection.renderOrder = 4;
    mesh.add(reflection);
  }

  // Contact shadows ground the small desk objects without adding a second shadow map.
  const contactTexture = drawContactShadowTexture();
  const addContactShadow = (x: number, z: number, w: number, d: number, opacity: number) => {
    const mat = new THREE.MeshBasicMaterial({ map: contactTexture, color: '#000000', transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.7595, z);
    mesh.renderOrder = 2;
    root.add(mesh);
  };
  addContactShadow(-0.2275, -0.105, 0.40, 0.30, 0.3);
  addContactShadow(0.215, -0.19, 0.21, 0.21, 0.34);
  addContactShadow(-0.087, 0.124, 0.42, 0.14, 0.32);
  addContactShadow(0.05, -0.03, 0.15, 0.15, 0.3);
  addContactShadow(0.37, 0.17, 0.11, 0.15, 0.24);
  addContactShadow(-0.387, 0.118, 0.22, 0.15, 0.24);
  addContactShadow(0.30, -0.04, 0.08, 0.08, 0.2);
  addContactShadow(-0.45, -0.22, 0.12, 0.10, 0.18);

  // --- pivot groups for lid and monitor -----------------------------------
  // The generated factory puts every component transform on a pivot Group and leaves the mesh
  // at local zero. Reparenting the MESH therefore loses the transform; this must move the pivot
  // nodes (and the monitor's own bezel mesh) instead.
  let lidState: LidState | null = null;
  if (nodes.laptopBase && nodes.laptopLid && nodes.laptopScreen && meshes.laptopLid) {
    const lidNode = nodes.laptopLid;
    const screenNode = nodes.laptopScreen;
    meshes.laptopLid.geometry.computeBoundingBox();
    const lidBox = meshes.laptopLid.geometry.boundingBox;
    if (!lidBox) throw new Error('laptop lid bounds missing');
    const lidHalfHeight = Math.abs(lidBox.max.y - lidBox.min.y) / 2;
    // 真实转轴 = 105° 开态时盖板下边缘中点，而不是工厂给出的偏前 18 mm 的插座位置。
    const hingeLocal = lidNode.position.clone().add(
      new THREE.Vector3(0, -lidHalfHeight, 0).applyEuler(lidNode.rotation),
    );
    const group = new THREE.Group();
    group.name = 'laptop-lid-hinge-pivot';
    group.position.copy(hingeLocal);
    nodes.laptopBase.add(group);
    const lidOffset = lidNode.position.clone().sub(hingeLocal);
    nodes.laptopBase.remove(lidNode);
    group.add(lidNode);
    lidNode.position.copy(lidOffset);

    // 屏幕跟随上盖，不再作为独立节点绕错误的枢轴旋转。
    // 前移到 bezel 前表面（0.0032）之外 0.9 mm，避免与黑玻璃基底 z-fighting（表现为屏幕时有时无）。
    nodes.laptopBase.remove(screenNode);
    lidNode.add(screenNode);
    screenNode.position.set(0, 0.0015, 0.0041);
    screenNode.rotation.set(0, 0, 0);

    // 双段屏轴与盖板下缘同轴：开合时保持位置不变，只更换可见的深色轴套。
    const hingeMaterial = new THREE.MeshStandardMaterial({ color: '#2B2E31', roughness: 0.32, metalness: 0.82 });
    for (const side of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0031, 0.0031, 0.044, 20), hingeMaterial);
      barrel.name = `laptop-hinge-${side < 0 ? 'left' : 'right'}`;
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(side * 0.132, hingeLocal.y, hingeLocal.z);
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      nodes.laptopBase.add(barrel);
      const socket = nodes.laptopBase.getObjectByName(`hinge-${side < 0 ? 'left' : 'right'}`);
      if (socket) socket.position.set(side * 0.132, hingeLocal.y, hingeLocal.z);
    }

    const openTilt = lidNode.rotation.x;
    lidState = {
      group,
      targetClosed: 0,
      closed: 0,
      openTilt,
      closedAngle: Math.PI / 2 - openTilt,
      fromClosed: 0,
      animStart: performance.now(),
      duration: 0.8,
    };
  }
  // 参考照片中两块屏幕不平行：笔记本向显示器一侧内转，显示器面板略微回望。
  if (nodes.laptopBase) nodes.laptopBase.rotation.y += THREE.MathUtils.degToRad(10);
  const monitorBaseYaw = THREE.MathUtils.degToRad(-4);
  let monitorPanel: THREE.Group | null = null;
  if (nodes.monitor) {
    const group = new THREE.Group();
    group.name = 'monitor-panel-pivot';
    nodes.monitor.add(group);
    if (meshes.monitor) {
      nodes.monitor.remove(meshes.monitor);
      group.add(meshes.monitor);
    }
    for (const id of ['monitorScreen', 'monitorRearHousing', 'monitorLed']) {
      const node = nodes[id];
      if (!node) continue;
      nodes.monitor.remove(node);
      group.add(node);
    }
    for (const decal of monitorDecals) {
      nodes.monitor.remove(decal);
      group.add(decal);
    }
    monitorPanel = group;
    monitorPanel.rotation.y = monitorBaseYaw;
  }

  // --- 桌面接触与避让修正 --------------------------------------------------
  if (nodes.laptopBase) {
    // 整机后移，让出桌沿，使外接键盘完整落在桌面上，同时拉开与支架托钩的净距。
    nodes.laptopBase.position.z -= 0.055;
  }
  const pencilCase = root.getObjectByName('desk-pencil-case');
  if (pencilCase) {
    // 笔袋移到笔记本前缘之前，避开机身和托钩；减小偏转以收回左右占位。
    pencilCase.position.z = 0.096;
    pencilCase.rotation.y = THREE.MathUtils.degToRad(2);
  }
  if (nodes.keyboard) {
    // 键盘后移回到桌面内，前缘保留约 3 mm 桌沿余量；同时随左侧纸笔右移，保持相对净距。
    nodes.keyboard.position.z += 0.0145;
    nodes.keyboard.position.x += 0.013;
    root.updateMatrixWorld(true);
    const keyboardBox = new THREE.Box3().setFromObject(nodes.keyboard);
    nodes.keyboard.position.y += 0.7575 - keyboardBox.min.y;
  }
  if (nodes.monitor) {
    // 实物图中显示器更靠后且左缘贴近笔记本右端：整体后移 30 mm、左移 20 mm。
    // 用户确认屏幕面应与笔记本屏幕面接近：再后移 40 mm，使两块屏幕深度接近。
    nodes.monitor.position.x -= 0.0215;
    nodes.monitor.position.z -= 0.070;
    // 左移后圆盘底座会压到后方插排，按实物比例收小底座避让。
    // 底座与立柱都是 monitor pivot 的子级，会随后移一并移动，不再单独偏移。
    const monitorBase = root.getObjectByName('显示器圆盘底座__pivot');
    if (monitorBase) {
      monitorBase.scale.x *= 0.84;
      monitorBase.scale.z *= 0.84;
    }
    // 实物显示器面板只有 8-10 mm 厚：把工厂 28 mm 厚壳压成 9 mm 薄板。
    if (meshes.monitor) {
      replaceGeometry(meshes.monitor, new RoundedBoxGeometry(0.54, 0.322, 0.009, 3, 0.0015));
    }
    // 背壳同步减薄并贴近面板背面：50 mm 鼓包 → 14 mm 薄弧背。
    if (meshes.monitorRearHousing) {
      replaceGeometry(meshes.monitorRearHousing, new RoundedBoxGeometry(0.44, 0.26, 0.014, 3, 0.002));
      nodes.monitorRearHousing?.position.set(0, 0, -0.0115);
    }
  }
  if (nodes.laptopStandBase) {
    const stand = nodes.laptopStandBase;
    const parent = stand.parent;
    if (parent) {
      // 支架托盘随笔记本倾斜，但底座必须与桌面平行并落到桌面上。
      const parentQ = new THREE.Quaternion();
      parent.getWorldQuaternion(parentQ);
      const levelWorldQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        nodes.laptopBase ? nodes.laptopBase.rotation.y : 0,
      );
      stand.quaternion.copy(parentQ).invert().multiply(levelWorldQ);
      const invParentQ = parentQ.clone().invert();
      stand.scale.set(0.9, 1, 0.8);
      stand.position.add(new THREE.Vector3(0, 0, -0.02).applyQuaternion(invParentQ));
      root.updateMatrixWorld(true);
      const standBox = new THREE.Box3().setFromObject(stand);
      stand.position.add(new THREE.Vector3(0, 0.7575 - standBox.min.y, 0).applyQuaternion(invParentQ));
    }
  }
  // 耀世16 Ultra 机身只有 20.6mm 厚：把工厂 22mm 高的前托钩压扁到 8mm，
  // 避免侧视时托钩+机身堆成一整条厚边。
  if (meshes.laptopStandLip) {
    replaceGeometry(meshes.laptopStandLip, new THREE.BoxGeometry(0.3, 0.008, 0.016));
  }
  if (nodes.mugNapkin) {
    // 纸垫原来悬空，杯底反而压进纸垫；将纸垫落到桌面。
    root.updateMatrixWorld(true);
    const napkinBox = new THREE.Box3().setFromObject(nodes.mugNapkin);
    nodes.mugNapkin.position.y += 0.7575 - napkinBox.min.y;
  }
  if (nodes.mug) {
    // 杯垫与鼠标垫角部相交，整体左移后挪，留出缝合并远离键盘前沿。
    nodes.mug.position.x -= 0.02;
    nodes.mug.position.z -= 0.01;
  }
  // 用户确认不需要蓝色中性笔：隐藏工厂遗留笔并移除细节层笔。
  for (const name of ['蓝色中性笔__pivot', '笔帽__pivot', 'desk-blue-pen', 'desk-blue-pen-cap']) {
    const stale = root.getObjectByName(name);
    if (stale) stale.visible = false;
  }

  // --- steam and bottle ----------------------------------------------------
  let steam: ReturnType<typeof createSteam> | null = null;
  if (nodes.mug) steam = createSteam(nodes.mug);
  const bottleBase = nodes.bottle ? nodes.bottle.rotation.clone() : new THREE.Euler();
  const bottleBasePosition = nodes.bottle ? nodes.bottle.position.clone() : new THREE.Vector3();
  // 摆动支点取挂带最高处（与挂钩的接触点）：顶部挂钩处不动、瓶身像钟摆一样向下摆。
  const bottleSwayPivot = bottleBasePosition.clone();
  if (nodes.bottle && meshes.bottleStrap && nodes.bottle.parent) {
    root.updateMatrixWorld(true);
    const strapBox = new THREE.Box3().setFromObject(meshes.bottleStrap);
    const pivotWorld = nodes.bottle.getWorldPosition(new THREE.Vector3());
    const topWorld = new THREE.Vector3(pivotWorld.x, strapBox.max.y, pivotWorld.z);
    bottleSwayPivot.copy(nodes.bottle.parent.worldToLocal(topWorld));
  } else {
    bottleSwayPivot.y += 0.31;
  }
  const bottleSwayOffset = new THREE.Vector3();
  let bottleAmplitude = 0.02;
  let screenPower = true;
  let rgbMode: RgbMode = 'rainbow';
  let rgbColor = '#2BD8FF';
  let rgbScale = 1;
  let animationPausedAt: number | null = null;
  const mouseBase = nodes.mouseShell ? nodes.mouseShell.position.clone() : null;
  if (nodes.mouseShell && nodes.mouseWheel) {
    // The wheel is a child of the same pivot group as the shell; keep its local transform.
  }

  let monitorPanTarget = 0;
  let monitorTiltTarget = 0;
  let monitorPan = 0;
  let monitorTilt = 0;
  let last = performance.now();
  let elapsed = 0;
  let nextScreenRefresh = 0;
  const setLidTarget = (target: number): void => {
    if (!lidState || lidState.targetClosed === target) return;
    lidState.fromClosed = lidState.closed;
    lidState.targetClosed = target;
    lidState.animStart = performance.now();
    lidState.duration = 0.72 + 0.24 * Math.abs(target - lidState.fromClosed);
  };
  // 人体工学椅：figure/椅子-1..4.jpg 中的网布转椅，放在桌子正前方略靠后。
  const chair = buildErgonomicChair();
  root.add(chair.group);
  let chairYaw = 0;
  let chairYawTarget = 0;
  let chairRecline = THREE.MathUtils.degToRad(-8);
  let chairReclineTarget = chairRecline;
  const chairYawBase = chair.group.rotation.y;
  const chairReclineBase = chairRecline;
  const syncRgbUnderlay = (): void => {
    const active = rgbMode !== 'off';
    const rainbow = rgbMode === 'rainbow';
    if (keyboardRgbLight) {
      keyboardRgbLight.visible = active;
      keyboardRgbLight.color.set(rainbow ? '#2BD8FF' : rgbColor);
      keyboardRgbLight.intensity = (rainbow ? 0.1 : rgbMode === 'static' ? 0.09
        : rgbMode === 'breathe' ? 0.07 : 0.04) * rgbScale;
    }
    if (keyboardDeskGlow) {
      const material = keyboardDeskGlow.material as THREE.MeshBasicMaterial;
      keyboardDeskGlow.visible = active;
      material.color.set(rainbow ? '#FFFFFF' : rgbColor);
      material.opacity = (rainbow ? 0.46 : rgbMode === 'static' ? 0.44
        : rgbMode === 'breathe' ? 0.24 : rgbMode === 'soft' ? 0.2 : 0) * rgbScale;
    }
    if (!keyState) return;
    const material = keyState.underlay.material as THREE.MeshBasicMaterial;
    keyState.underlay.visible = active;
    if (!active) return;
    material.map = rainbow ? keyState.underRainbowMap : keyState.underSolidMap;
    material.color.set(rainbow ? '#FFFFFF' : rgbColor);
    material.opacity = (rainbow ? 1 : rgbMode === 'static' ? 0.95
      : rgbMode === 'breathe' ? 0.5 : 0.5) * rgbScale;
    material.needsUpdate = true;
  };
  const api: WorkstationAnimationApi = {
    openLaptop: () => { setLidTarget(0); },
    closeLaptop: () => { setLidTarget(1); },
    setLaptopLidInstant: (closed) => {
      if (!lidState) return;
      const value = closed ? 1 : 0;
      lidState.fromClosed = value;
      lidState.closed = value;
      lidState.targetClosed = value;
      lidState.animStart = performance.now();
      lidState.group.rotation.x = value * lidState.closedAngle;
    },
    panMonitor: (deg) => { monitorPanTarget = THREE.MathUtils.degToRad(deg); },
    tiltMonitor: (deg) => { monitorTiltTarget = THREE.MathUtils.degToRad(deg); },
    pressKey: (index, travelMm = 2.4) => { keyState?.press(index, travelMm); },
    releaseKey: (index) => { keyState?.release(index); },
    setKeyboardRgb: (mode) => {
      // 兼容旧调用名 'sweep'：它与新的彩虹模式是同一套视觉。
      rgbMode = mode === 'sweep' ? 'rainbow' : mode;
      syncRgbUnderlay();
    },
    setKeyboardRgbColor: (color) => {
      if (!/^#[0-9a-f]{6}$/i.test(color)) return;
      rgbColor = color;
      syncRgbUnderlay();
    },
    setKeyboardRgbScale: (scale) => {
      rgbScale = THREE.MathUtils.clamp(scale, 0, 1);
      syncRgbUnderlay();
    },
    pauseAnimations: () => {
      if (animationPausedAt === null) animationPausedAt = performance.now();
    },
    resumeAnimations: () => {
      if (animationPausedAt === null) return;
      const pausedFor = performance.now() - animationPausedAt;
      if (lidState) lidState.animStart += pausedFor;
      animationPausedAt = null;
    },
    moveMouse: (dx, dz) => {
      if (!nodes.mouseShell || !mouseBase) return;
      // 垫子竖放后：局部 X 沿世界前后（340mm 方向），局部 Z 沿世界左右（250mm 方向）。
      nodes.mouseShell.position.x = THREE.MathUtils.clamp(mouseBase.x + dx, -0.155, 0.155);
      nodes.mouseShell.position.z = THREE.MathUtils.clamp(mouseBase.z + dz, -0.11, 0.11);
    },
    spinWheel: (delta) => {
      // 滚轮轴向为 +X，正 delta 向前滚动。
      if (mouseDetail) mouseDetail.wheel.rotation.x += delta * 0.012;
    },
    openMugLid: (open) => {
      if (displayMugLid) {
        displayMugLid.position.y = 0.0705 + (open ? 0.025 : 0);
        displayMugLid.position.x = open ? 0.006 : 0;
        displayMugLid.rotation.z = open ? 0.34 : 0;
      }
    },
    toggleSteam: (on) => { if (steam) steam.points.visible = on; },
    swayBottle: (amplitudeDeg) => { bottleAmplitude = THREE.MathUtils.degToRad(amplitudeDeg); },
    setScreenPower: (on) => {
      screenPower = on;
      for (const s of screens) {
        s.power = on;
        s.mesh.visible = on;
        if (on) refreshScreen(s);
      }
    },
    setScreenContent: (content) => {
      const allowed: ScreenContent[] = ['dashboard', 'code', 'terminal', 'desktop', 'focus'];
      if (!allowed.includes(content)) return;
      activeScreenContent = content;
      for (const s of screens) {
        if (s.power) refreshScreen(s);
      }
    },
    setLightingMode: (mode) => {
      // The viewer owns the studio lights; the model dims its own emissive UI.
      for (const s of screens) {
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(mode === 'night' ? '#FFFFFF' : '#F2F2F2');
      }
    },
    swivelChair: (deg) => { chairYawTarget = THREE.MathUtils.degToRad(deg); },
    reclineChair: (deg) => { chairReclineTarget = chairReclineBase + THREE.MathUtils.degToRad(deg); },
    getState: () => ({
      lidClosed: lidState?.closed ?? 0,
      lidAngleDeg: lidState
        ? 90 - THREE.MathUtils.radToDeg(lidState.openTilt + lidState.closed * lidState.closedAngle)
        : 105,
      monitorPanDeg: THREE.MathUtils.radToDeg(monitorPan),
      monitorTiltDeg: THREE.MathUtils.radToDeg(monitorTilt),
      rgbMode, rgbColor, rgbScale, screenPower, screenContent: activeScreenContent,
      animationsPaused: animationPausedAt !== null,
      steamOn: steam?.points.visible ?? false,
      chairYawDeg: THREE.MathUtils.radToDeg(chairYaw),
      chairReclineDeg: THREE.MathUtils.radToDeg(chairRecline - chairReclineBase),
    }),
  };

  const tick = (dt: number): void => {
    const now = performance.now();
    if (animationPausedAt !== null) {
      last = now;
      return;
    }
    elapsed += dt;
    if (keyState) {
      const rgbMaterial = keyState.underlay.material as THREE.MeshBasicMaterial;
      const glowMaterial = keyboardDeskGlow?.material as THREE.MeshBasicMaterial | undefined;
      if (rgbMode === 'rainbow') {
        const hue = (elapsed * 0.045) % 1;
        rgbMaterial.color.set('#FFFFFF');
        rgbMaterial.opacity = rgbScale;
        keyboardRgbLight?.color.setHSL(hue, 0.82, 0.55);
        if (keyboardRgbLight) keyboardRgbLight.intensity = (0.1 + Math.sin(elapsed * 1.4) * 0.015) * rgbScale;
        if (glowMaterial) {
          glowMaterial.color.setHSL(hue, 0.82, 0.55);
          glowMaterial.opacity = 0.46 * rgbScale;
        }
      } else if (rgbMode === 'breathe') {
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 1.9);
        rgbMaterial.opacity = (0.42 + pulse * 0.56) * rgbScale;
        if (keyboardRgbLight) keyboardRgbLight.intensity = (0.04 + pulse * 0.1) * rgbScale;
        if (glowMaterial) glowMaterial.opacity = (0.14 + pulse * 0.36) * rgbScale;
      } else if (rgbMode === 'soft') {
        rgbMaterial.opacity = 0.5 * rgbScale;
        if (keyboardRgbLight) keyboardRgbLight.intensity = 0.04 * rgbScale;
        if (glowMaterial) glowMaterial.opacity = 0.2 * rgbScale;
      } else if (rgbMode === 'static') {
        rgbMaterial.opacity = 0.95 * rgbScale;
        if (keyboardRgbLight) keyboardRgbLight.intensity = 0.16 * rgbScale;
        if (glowMaterial) glowMaterial.opacity = 0.44 * rgbScale;
      }
    }
    if (steam) steam.update(elapsed, dt);
    if (nodes.bottle) {
      // 主摆动放在前后方向（±z），左右方向（±x）只用 45%，避免下摆时贴到右侧木板。
      const swayX = Math.sin(elapsed * 1.35) * bottleAmplitude;
      const swayZ = Math.sin(elapsed * 0.72) * bottleAmplitude * 0.45;
      nodes.bottle.rotation.set(bottleBase.x + swayX, bottleBase.y, bottleBase.z + swayZ);
      // 绕挂点摆动：补偿位置让支点保持不动（顶部挂钩处不动、下部摆动）。
      bottleSwayOffset.copy(bottleBasePosition).sub(bottleSwayPivot).applyEuler(nodes.bottle.rotation);
      nodes.bottle.position.copy(bottleSwayPivot).add(bottleSwayOffset);
    }
    if (lidState) {
      // 按真实时间而不是帧步进推进：无头/低帧率下也能在结束时精确吸附到全开或全合。
      const lidElapsed = Math.max(0, (now - lidState.animStart) / 1000);
      const progress = Math.min(1, lidElapsed / lidState.duration);
      const eased = progress * progress * (3 - 2 * progress);
      lidState.closed = lidState.fromClosed + (lidState.targetClosed - lidState.fromClosed) * eased;
      if (progress >= 1) lidState.closed = lidState.targetClosed;
      lidState.group.rotation.x = lidState.closed * lidState.closedAngle;
    }
    if (monitorPanel) {
      monitorPan = THREE.MathUtils.damp(monitorPan, monitorPanTarget, 6, dt);
      monitorTilt = THREE.MathUtils.damp(monitorTilt, monitorTiltTarget, 6, dt);
      monitorPanel.rotation.y = monitorBaseYaw + monitorPan;
      monitorPanel.rotation.x = monitorTilt;
    }
    chairYaw = THREE.MathUtils.damp(chairYaw, chairYawTarget, 6, dt);
    chairRecline = THREE.MathUtils.damp(chairRecline, chairReclineTarget, 6, dt);
    chair.group.rotation.y = chairYawBase + chairYaw;
    chair.backPivot.rotation.x = chairRecline;
    if (screens.length && screenPower && elapsed >= nextScreenRefresh) {
      nextScreenRefresh = elapsed + 1.0;
      for (const s of screens) refreshScreen(s);
    }
    last = now;
  };

  root.userData.animation = api;
  root.userData.tick = tick;
  root.userData.workstationDetails = { version: '1.1', screens: screens.length, keycaps: keyState ? 98 : 0 };
  return api;
}
