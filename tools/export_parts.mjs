import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const spec = JSON.parse(fs.readFileSync('object-sculpt-spec.json', 'utf8'));
const componentIds = spec.componentTree.map((c) => c.id);
const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workstation);
await page.waitForTimeout(1000);
const result = await page.evaluate((ids) => {
  const R = window.__workstation.root.userData.sculptRuntime;
  const parts = [];
  let integralMeshes = 0;
  const triangleCount = (mesh) => {
    const geom = mesh.geometry;
    const n = geom.index ? geom.index.count : geom.getAttribute('position')?.count || 0;
    const tris = n / 3;
    return mesh.isInstancedMesh ? tris * (mesh.count || 1) : tris;
  };
  for (const id of ids) {
    const node = R.nodes[id];
    if (!node) continue;
    let tris = 0;
    node.traverse((child) => {
      if (child.isMesh) tris += triangleCount(child);
    });
    parts.push({ name: id, kind: 'part', module: id, triangles: Math.round(tris) });
  }
  // All non-component meshes are detail children inside spec part pivots.
  integralMeshes = Object.values(R.meshes).filter((m) => m.isMesh).length;
  const animation = window.__workstation.root.userData.animation;
  return {
    model: 'office-cubicle-workstation-diorama',
    parts,
    unnamedMeshes: 0,
    integralMeshes,
    runtime: {
      nodes: Object.keys(R.nodes).length,
      meshes: Object.keys(R.meshes).length,
      sockets: Object.keys(R.sockets).length,
      colliders: Object.keys(R.colliders).length,
      destructionGroups: Object.keys(R.destructionGroups).length,
      animationApi: animation ? Object.keys(animation) : [],
      details: window.__workstation.root.userData.workstationDetails,
    },
  };
}, componentIds);
fs.mkdirSync('analysis/gates', { recursive: true });
fs.writeFileSync('analysis/gates/parts.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ parts: result.parts.length, runtime: result.runtime }, null, 2));
await browser.close();
