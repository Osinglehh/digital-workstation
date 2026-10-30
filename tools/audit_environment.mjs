// 场景环境与相机审计：地板/墙体世界包络、墙地接缝、工位净距、相机预设边界与画面留白。
// 运行前提：dev server 已在 http://127.0.0.1:5173/ 运行；输出写入 analysis/environment-audit.json。
// 用法：node tools/audit_environment.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__workstation, null, { timeout: 90000 });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, null, { timeout: 120000 });
await page.waitForTimeout(1800);

const result = await page.evaluate(() => {
  const api = window.__workstation;
  const scene = api.scene;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const isVisible = (object) => {
    let current = object;
    while (current) {
      if (!current.visible) return false;
      if (current === api.root) return true;
      current = current.parent;
    }
    return true;
  };

  // 逐顶点（含 InstancedMesh 实例矩阵）收集世界坐标，避免 Box3 角点膨胀。
  const points = [];
  const collect = (object, instanceMatrix = null) => {
    object.updateWorldMatrix(true, false);
    const geometry = object.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return;
    const world = instanceMatrix ?? object.matrixWorld;
    const e = world.elements;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      points.push(
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
      );
    }
  };

  api.root.traverse((child) => {
    if (!child.isMesh || !isVisible(child)) return;
    if (child.isInstancedMesh) {
      const local = api.camera.matrixWorld.clone();
      const world = api.camera.matrixWorld.clone();
      for (let i = 0; i < child.count; i += 1) {
        child.getMatrixAt(i, local);
        world.multiplyMatrices(child.matrixWorld, local);
        collect(child, world.clone());
      }
    } else {
      collect(child);
    }
  });

  const boundsOfPoints = (array) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i];
      const y = array[i + 1];
      const z = array[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return { min: { x: r4(minX), y: r4(minY), z: r4(minZ) }, max: { x: r4(maxX), y: r4(maxY), z: r4(maxZ) }, size: { x: r4(maxX - minX), y: r4(maxY - minY), z: r4(maxZ - minZ) } };
  };
  const rootBounds = boundsOfPoints(points);

  // 地板、墙体、踢脚线用几何角点求包络；不受材质/背面剔除影响。
  const boxOfObject = (object) => {
    if (!object) return null;
    object.updateWorldMatrix(true, false);
    const geometry = object.geometry;
    if (!geometry) return null;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const corners = [
      [bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.min.z],
      [bb.min.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.min.z],
      [bb.min.x, bb.min.y, bb.max.z], [bb.max.x, bb.min.y, bb.max.z],
      [bb.min.x, bb.max.y, bb.max.z], [bb.max.x, bb.max.y, bb.max.z],
    ];
    const v = api.camera.position.clone();
    const array = [];
    for (const c of corners) {
      v.set(c[0], c[1], c[2]).applyMatrix4(object.matrixWorld);
      array.push(v.x, v.y, v.z);
    }
    return boundsOfPoints(array);
  };

  const floor = scene.getObjectByName('studio-floor');
  const rearWall = scene.getObjectByName('studio-wall-rear');
  const leftWall = scene.getObjectByName('studio-wall-left');
  const rightWall = scene.getObjectByName('studio-wall-right');
  const rearBaseboard = scene.getObjectByName('studio-baseboard-rear');
  const leftBaseboard = scene.getObjectByName('studio-baseboard-left');
  const rightBaseboard = scene.getObjectByName('studio-baseboard-right');
  const floorBounds = boxOfObject(floor);
  const rearWallBounds = boxOfObject(rearWall);
  const leftWallBounds = boxOfObject(leftWall);
  const rightWallBounds = boxOfObject(rightWall);
  const baseboardBounds = [rearBaseboard, leftBaseboard, rightBaseboard].map(boxOfObject).filter(Boolean);
  const wallsBounds = [rearWallBounds, leftWallBounds, rightWallBounds].filter(Boolean);

  const groupBounds = (boxes) => ({
    min: {
      x: Math.min(...boxes.map((b) => b.min.x)),
      y: Math.min(...boxes.map((b) => b.min.y)),
      z: Math.min(...boxes.map((b) => b.min.z)),
    },
    max: {
      x: Math.max(...boxes.map((b) => b.max.x)),
      y: Math.max(...boxes.map((b) => b.max.y)),
      z: Math.max(...boxes.map((b) => b.max.z)),
    },
  });
  const walls = groupBounds(wallsBounds);

  const clearance = (a, b) => {
    const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
    const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0);
    const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
    return r4(Math.sqrt(dx * dx + dy * dy + dz * dz));
  };
  const overlap = (a, b) => a.min.x <= b.max.x && a.max.x >= b.min.x
    && a.min.y <= b.max.y && a.max.y >= b.min.y
    && a.min.z <= b.max.z && a.max.z >= b.min.z;

  // 相机预设：读取运行时 views，再按同一球坐标公式复算相机位置。
  const limits = {
    minPolarDeg: api.controls.minPolarAngle * 180 / Math.PI,
    maxPolarDeg: api.controls.maxPolarAngle * 180 / Math.PI,
  };
  const views = Object.entries(api.views).map(([name, pose]) => {
    const az = pose.azimuthDeg * Math.PI / 180;
    const el = pose.elevationDeg * Math.PI / 180;
    const position = {
      x: r4(pose.target[0] + Math.sin(az) * Math.cos(el) * pose.distance),
      y: r4(pose.target[1] + Math.sin(el) * pose.distance),
      z: r4(pose.target[2] + Math.cos(az) * Math.cos(el) * pose.distance),
    };
    return {
      name,
      target: pose.target.map(r4),
      azimuthDeg: pose.azimuthDeg,
      elevationDeg: pose.elevationDeg,
      distance: r4(pose.distance),
      fov: pose.fov,
      position,
      safe: {
        aboveFloor: position.y > 0.05,
        inFrontOfRearWall: position.z > -0.64 + 0.04,
        withinDistance: pose.distance >= api.controls.minDistance && pose.distance <= api.controls.maxDistance,
        withinAzimuth: Math.abs(pose.azimuthDeg) <= 75,
        withinPolar: (90 - pose.elevationDeg) >= limits.minPolarDeg - 0.001
          && (90 - pose.elevationDeg) <= limits.maxPolarDeg + 0.001,
      },
    };
  });

  // 画面留白：对预设计算根节点逐顶点投影包络（NDC → 屏幕百分比）。
  const framing = {};
  const projectView = (name) => {
    api.setView(name);
    api.render();
    api.camera.updateMatrixWorld(true);
    api.camera.matrixWorldInverse.copy(api.camera.matrixWorld).invert();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const v = api.camera.position.clone();
    for (let i = 0; i < points.length; i += 3) {
      v.set(points[i], points[i + 1], points[i + 2]).project(api.camera);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    }
    return {
      heightPct: r3((maxY - minY) / 2 * 100),
      widthPct: r3((maxX - minX) / 2 * 100),
      topMarginPct: r3((1 - maxY) / 2 * 100),
      bottomMarginPct: r3((minY + 1) / 2 * 100),
      leftMarginPct: r3((minX + 1) / 2 * 100),
      rightMarginPct: r3((1 - maxX) / 2 * 100),
      fullyVisible: minX > -1 && maxX < 1 && minY > -1 && maxY < 1,
    };
  };
  const closeups = new Set(['under', 'firstPerson', 'keyboard', 'monitor', 'laptop']);
  for (const name of ['default', 'front', 'left', 'right', 'overhead', 'under', 'firstPerson', 'keyboard', 'monitor', 'laptop', 'panorama']) {
    framing[name] = closeups.has(name)
      ? { applicable: false, fullyVisible: false, note: '近景/桌下视角有意裁切工位主体，不参与整机留白判定' }
      : projectView(name);
  }
  api.setView('default');
  api.render();

  const mapRepeat = floor.material.map?.repeat;
  const bumpRepeat = floor.material.bumpMap?.repeat;
  const environment = { ...api.environment };

  return {
    generatedAt: new Date().toISOString(),
    viewport: [innerWidth, innerHeight],
    environment,
    floor: {
      bounds: floorBounds,
      plane: floor.geometry.parameters,
      rotationX: floor.rotation.x,
      topY: floorBounds.max.y,
      textureRepeats: {
        map: mapRepeat ? [r4(mapRepeat.x), r4(mapRepeat.y)] : null,
        bump: bumpRepeat ? [r4(bumpRepeat.x), r4(bumpRepeat.y)] : null,
      },
    },
    walls: {
      bounds: walls,
      rear: rearWallBounds,
      left: leftWallBounds,
      right: rightWallBounds,
      baseboards: baseboardBounds,
      wallBaseGap: r4(Math.min(...wallsBounds.map((b) => b.min.y)) - floorBounds.max.y),
      baseboardBaseGap: r4(Math.min(...baseboardBounds.map((b) => b.min.y)) - floorBounds.max.y),
      overlapsWorkstation: wallsBounds.some((b) => overlap(b, rootBounds)),
    },
    workstation: {
      bounds: rootBounds,
      clearances: {
        toRearWall: clearance(rootBounds, rearWallBounds),
        toLeftWall: clearance(rootBounds, leftWallBounds),
        toRightWall: clearance(rootBounds, rightWallBounds),
        toFloorLeftEdge: r4(rootBounds.min.x - floorBounds.min.x),
        toFloorRightEdge: r4(floorBounds.max.x - rootBounds.max.x),
        toFloorBackEdge: r4(rootBounds.min.z - floorBounds.min.z),
        toFloorFrontEdge: r4(floorBounds.max.z - rootBounds.max.z),
        belowWallTop: r4(walls.max.y - rootBounds.max.y),
      },
      insideFloorFootprint: rootBounds.min.x > floorBounds.min.x && rootBounds.max.x < floorBounds.max.x
        && rootBounds.min.z > floorBounds.min.z && rootBounds.max.z < floorBounds.max.z,
    },
    camera: {
      limits: {
        minDistance: api.controls.minDistance,
        maxDistance: api.controls.maxDistance,
        minAzimuthDeg: r3(api.controls.minAzimuthAngle * 180 / Math.PI),
        maxAzimuthDeg: r3(api.controls.maxAzimuthAngle * 180 / Math.PI),
        minPolarDeg: r3(api.controls.minPolarAngle * 180 / Math.PI),
        maxPolarDeg: r3(api.controls.maxPolarAngle * 180 / Math.PI),
        maxTargetRadius: api.controls.maxTargetRadius,
        panEnabled: api.controls.enablePan,
      },
      presets: views,
      allPresetsSafe: views.every((v) => Object.values(v.safe).every(Boolean)),
      framing,
    },
    gates: {
      floorIsGroundPlane: Math.abs(floorBounds.max.y) < 0.001 && Math.abs(floor.rotation.x + Math.PI / 2) < 0.001,
      wallBaseMeetsFloor: Math.abs(Math.min(...wallsBounds.map((b) => b.min.y)) - floorBounds.max.y) < 0.001,
      baseboardBaseMeetsFloor: Math.abs(Math.min(...baseboardBounds.map((b) => b.min.y)) - floorBounds.max.y) < 0.001,
      wallsClearOfWorkstation: !wallsBounds.some((b) => overlap(b, rootBounds)),
      workstationInsideFloor: rootBounds.min.x > floorBounds.min.x && rootBounds.max.x < floorBounds.max.x
        && rootBounds.min.z > floorBounds.min.z && rootBounds.max.z < floorBounds.max.z,
      wallBehindWorkstation: rearWallBounds.max.z < rootBounds.min.z,
      allPresetsSafe: views.every((v) => Object.values(v.safe).every(Boolean)),
      defaultFramingInRange: framing.default.heightPct >= 65 && framing.default.heightPct <= 82
        && framing.default.topMarginPct >= 8 && framing.default.bottomMarginPct >= 8,
      widePresetsFullyVisible: ['left', 'right', 'overhead', 'panorama'].every((name) => framing[name].fullyVisible),
    },
  };
});
result.pageErrors = errors;

fs.writeFileSync('analysis/environment-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  floor: result.floor.bounds,
  walls: result.walls.bounds,
  workstation: result.workstation.bounds,
  clearances: result.workstation.clearances,
  camera: result.camera.limits,
  framing: result.camera.framing,
  gates: result.gates,
  pageErrors: result.pageErrors,
}, null, 2));
await browser.close();
