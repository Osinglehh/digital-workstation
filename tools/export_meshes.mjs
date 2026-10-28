import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workstation);
await page.waitForTimeout(1500);
const data = await page.evaluate(() => {
  const root = window.__workstation.root;
  root.updateMatrixWorld(true);
  const R = root.userData.sculptRuntime;
  const meshes = [];
  const measured = {};
  for (const [id, node] of Object.entries(R.nodes)) {
    node.updateMatrixWorld(true);
    const v = new node.position.constructor();
    node.getWorldPosition(v);
    measured[id] = [Math.round(v.x * 10000) / 10000, Math.round(v.y * 10000) / 10000, Math.round(v.z * 10000) / 10000];
  }
  for (const [id, mesh] of Object.entries(R.meshes)) {
    if (!mesh.visible || mesh.isInstancedMesh) continue;
    mesh.updateMatrixWorld(true);
    const attr = mesh.geometry.getAttribute('position');
    if (!attr) continue;
    const vertices = [];
    const p = new mesh.position.constructor();
    for (let i = 0; i < attr.count; i += 1) {
      p.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      vertices.push([Math.round(p.x * 100000) / 100000, Math.round(p.y * 100000) / 100000, Math.round(p.z * 100000) / 100000]);
    }
    const index = mesh.geometry.index;
    const indices = index ? Array.from(index.array) : Array.from({ length: attr.count }, (_, i) => i);
    meshes.push({ id, name: mesh.name, vertices, indices });
  }
  return { meshes, measured, meshCount: meshes.length, nodeCount: Object.keys(R.nodes).length };
});
const outDir = path.resolve('analysis/gates'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'meshes.json'), JSON.stringify({ meshes: data.meshes }, null, 1));
fs.writeFileSync(path.join(outDir, 'measured.json'), JSON.stringify(data.measured, null, 2));
console.log(JSON.stringify({ meshCount: data.meshCount, nodeCount: data.nodeCount, meshes: path.join(outDir, 'meshes.json') }, null, 2));
await browser.close();
