// 桌顶格架审计：逐顶点世界 AABB、净高/净距、落位、碰撞与旧节点移除检查。
// 运行前提：dev server 已在 http://127.0.0.1:5173/ 运行；输出写入 analysis/shelf-audit.json。
// 用法：node tools/audit_shelf.mjs
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
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__workstation, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const result = await page.evaluate(() => {
  const scene = window.__workstation.scene;
  const runtime = window.__workstation.root.userData.sculptRuntime;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const r5 = (v) => Math.round(v * 100000) / 100000;

  // 逐顶点乘 matrixWorld 求精确包络；不用 Box3.setFromObject，避免旋转物件的角点膨胀。
  // InstancedMesh（背板安装孔、罐内果粒）必须叠加实例矩阵，否则会被算到原点。
  const boxOf = (object) => {
    if (!object) return null;
    object.updateWorldMatrix(true, true);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    const scratch = object.matrixWorld.clone();
    const accum = (elements, pos) => {
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const wx = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
        const wy = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
        const wz = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
        if (wx < min.x) min.x = wx;
        if (wy < min.y) min.y = wy;
        if (wz < min.z) min.z = wz;
        if (wx > max.x) max.x = wx;
        if (wy > max.y) max.y = wy;
        if (wz > max.z) max.z = wz;
      }
    };
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      if (child.isInstancedMesh) {
        for (let inst = 0; inst < child.count; inst += 1) {
          child.getMatrixAt(inst, scratch);
          scratch.premultiply(child.matrixWorld);
          accum(scratch.elements, child.geometry.attributes.position);
        }
      } else {
        accum(child.matrixWorld.elements, child.geometry.attributes.position);
      }
    });
    if (!Number.isFinite(min.x)) return null;
    return {
      min: { x: r4(min.x), y: r5(min.y), z: r4(min.z) },
      max: { x: r4(max.x), y: r5(max.y), z: r4(max.z) },
      size: { x: r4(max.x - min.x), y: r4(max.y - min.y), z: r4(max.z - min.z) },
    };
  };
  const byName = (name) => scene.getObjectByName(name);
  const overlap = (a, b) => Boolean(a && b
    && a.min.x < b.max.x && a.max.x > b.min.x
    && a.min.y < b.max.y && a.max.y > b.min.y
    && a.min.z < b.max.z && a.max.z > b.min.z);
  const boxes = {
    hutch: boxOf(byName('shelf-hutch')),
    structure: boxOf(byName('shelf-hutch-structure')),
    back: boxOf(byName('shelf-hutch-back')),
    sideLeft: boxOf(byName('shelf-hutch-side-left')),
    sideRight: boxOf(byName('shelf-hutch-side-right')),
    topBoard: boxOf(byName('shelf-hutch-top')),
    floor: boxOf(runtime.meshes?.shelf),
    books: boxOf(byName('shelf-books')),
    booksFileBox: boxOf(byName('shelf-file-box')),
    giftBox: boxOf(byName('shelf-gift-box')),
    gojiJar: boxOf(byName('shelf-goji-jar')),
    teaTin: boxOf(byName('shelf-tea-tin')),
    scissors: boxOf(byName('shelf-scissors')),
    foldedPaper: boxOf(byName('shelf-folded-paper')),
    topGreenBook: boxOf(byName('shelf-top-green-book')),
    topGreenBox: boxOf(byName('shelf-top-green-box')),
    partition: boxOf(runtime.meshes?.partition),
    desk: boxOf(runtime.meshes?.desk),
  };
  const books = (byName('shelf-books')?.children ?? [])
    .filter((child) => child.name.startsWith('shelf-book-'))
    .map((child) => ({ name: child.name, box: boxOf(child) }));
  const papers = (byName('shelf-decor')?.children ?? [])
    .filter((child) => child.name === 'shelf-paper-sheet')
    .map((child, index) => ({ name: `paper-${index}`, box: boxOf(child) }));
  const roomItems = [
    { name: 'giftBox', box: boxes.giftBox },
    { name: 'gojiJar', box: boxes.gojiJar },
    { name: 'teaTin', box: boxes.teaTin },
    { name: 'scissors', box: boxes.scissors },
    { name: 'foldedPaper', box: boxes.foldedPaper },
  ];
  const underHutch = [
    ...books.map((book) => ({ name: book.name, box: book.box })),
    { name: 'fileBox', box: boxes.booksFileBox },
    ...roomItems,
    ...papers,
  ];
  const minBottomClearance = Math.min(...underHutch.map((item) => item.box.min.y - boxes.floor.max.y));
  const minTopClearance = Math.min(...underHutch.map((item) => boxes.topBoard.min.y - item.box.max.y));
  const minBackClearance = Math.min(...underHutch.map((item) => item.box.min.z - boxes.back.max.z));
  const minLeftClearance = Math.min(...underHutch.map((item) => item.box.min.x - boxes.sideLeft.max.x));
  const minRightClearance = Math.min(...underHutch.map((item) => boxes.sideRight.min.x - item.box.max.x));
  const collisions = {};
  for (let i = 0; i < roomItems.length; i += 1) {
    for (let j = i + 1; j < roomItems.length; j += 1) {
      collisions[`${roomItems[i].name}-${roomItems[j].name}`] = overlap(roomItems[i].box, roomItems[j].box);
    }
  }
  for (const item of [...roomItems, ...papers]) {
    collisions[`${item.name}-floor`] = overlap(item.box, boxes.floor);
    collisions[`${item.name}-topBoard`] = overlap(item.box, boxes.topBoard);
    collisions[`${item.name}-back`] = overlap(item.box, boxes.back);
    collisions[`${item.name}-sideLeft`] = overlap(item.box, boxes.sideLeft);
    collisions[`${item.name}-sideRight`] = overlap(item.box, boxes.sideRight);
  }
  for (const paper of papers) {
    collisions[`${paper.name}-books`] = overlap(paper.box, boxes.books);
    collisions[`${paper.name}-fileBox`] = overlap(paper.box, boxes.booksFileBox);
    for (const item of roomItems) {
      collisions[`${paper.name}-${item.name}`] = overlap(paper.box, item.box);
    }
  }
  for (let i = 0; i < papers.length; i += 1) {
    for (let j = i + 1; j < papers.length; j += 1) {
      collisions[`${papers[i].name}-${papers[j].name}`] = overlap(papers[i].box, papers[j].box);
    }
  }
  const bookPairs = [];
  for (let i = 0; i < books.length; i += 1) {
    for (let j = i + 1; j < books.length; j += 1) {
      const a = books[i];
      const b = books[j];
      if (overlap(a.box, b.box)) bookPairs.push([a.name, b.name, r5(a.box.max.x - b.box.min.x)]);
    }
  }
  const oldIds = ['shelfBracketL', 'shelfBracketR', 'shelfProps', 'bookRowB',
    'jarPurple', 'jarOrange', 'teaCanister', 'bookEnd'];
  const removedLegacy = Object.fromEntries(oldIds.map((id) => [id, !runtime.nodes?.[id]?.parent]));
  let legacyVisibleMeshes = 0;
  scene.traverse((child) => {
    const id = child.userData?.sculptComponent?.id;
    if (id && oldIds.includes(id) && child.isMesh && child.visible) legacyVisibleMeshes += 1;
  });
  // 架上物件投影必须被搁板遮挡；下方背板保持均匀受光，顶面物件使用接触阴影。
  const shadowOcclusion = {
    shelfCasts: Boolean(byName('顶部搁板')?.castShadow),
    partitionReceivesShadow: Boolean(byName('三面隔断与磨砂玻璃')?.receiveShadow),
    topItemCasters: ['shelf-top-green-book', 'shelf-top-green-box']
      .filter((name) => byName(name)?.castShadow),
  };
  return {
    boxes,
    books,
    papers,
    shadowOcclusion,
    clearances: {
      innerClearHeight: r4(boxes.topBoard.min.y - boxes.floor.max.y),
      innerWidth: r4(boxes.sideRight.min.x - boxes.sideLeft.max.x),
      innerDepth: r4(boxes.sideLeft.max.z - boxes.back.max.z),
      booksLeftClearance: r4(books[0].box.min.x - boxes.sideLeft.max.x),
      booksRightClearance: r4(boxes.sideRight.min.x - Math.max(...books.map((book) => book.box.max.x))),
      fileBoxToTeaTin: r4(boxes.teaTin.min.x - boxes.booksFileBox.max.x),
      giftToJar: r4(boxes.gojiJar.min.x - boxes.giftBox.max.x),
      jarToTin: r4(boxes.teaTin.min.x - boxes.gojiJar.max.x),
      minBottomClearance: r5(minBottomClearance),
      minTopClearance: r4(minTopClearance),
      minBackClearance: r4(minBackClearance),
      minLeftClearance: r4(minLeftClearance),
      minRightClearance: r4(minRightClearance),
      topBoardToDesk: r4(boxes.topBoard.max.y - boxes.desk.max.y),
      hutchOuterWidth: r4(boxes.topBoard.size.x),
      sidePanelOuterSpan: r4(boxes.sideRight.max.x - boxes.sideLeft.min.x),
    },
    contacts: {
      floorTopY: 1.3725,
      topBoardTopY: boxes.topBoard.max.y,
      topBoardUndersideY: boxes.topBoard.min.y,
      bookMinY: Math.min(...books.map((book) => book.box.min.y)),
      giftMinY: boxes.giftBox.min.y,
      jarMinY: boxes.gojiJar.min.y,
      tinMinY: boxes.teaTin.min.y,
      topGreenBookMinY: boxes.topGreenBook?.min.y,
      topGreenBoxMinY: boxes.topGreenBox?.min.y,
    },
    collisions,
    bookPairs,
    removedLegacy,
    legacyVisibleMeshes,
    counts: { books: books.length, papers: papers.length, roomItems: roomItems.length },
    errors: [],
  };
});
result.errors = errors;

const payload = {
  generated: new Date().toISOString(),
  reference: ['figure/桌顶架子-1.jpg', 'figure/桌顶架子-2.jpg', 'figure/桌顶架子-3.jpg'],
  units: 'meters, Y-up, floor top y=0',
  structure: {
    construction: '搁板上方补 330 mm 净高格架：顶板 25 mm、侧板 18 mm、背板 30 mm，背板带 8 个安装孔；旧铝托架/旧书列/旧茶罐已从层级移除。',
    shelfFloorTopY: 1.3725,
    hutchInnerClearHeight: 0.33,
    topBoardTopY: 1.7275,
    topBoardThickness: 0.025,
    sidePanelThickness: 0.018,
    backPanelThickness: 0.03,
    itemBasis: '书与文件盒直接落在搁板；礼盒/玻璃罐/茶叶罐/黑色剪刀落在纸面上，纸面抬升 0.7–0.9 mm。',
  },
  result,
  verdict: {
    allInside: result.clearances.minBottomClearance >= 0
      && result.clearances.minTopClearance > 0
      && result.clearances.minBackClearance >= 0
      && result.clearances.minLeftClearance >= 0
      && result.clearances.minRightClearance >= 0,
    roomItemCollisionCount: Object.values(result.collisions).filter(Boolean).length,
    bookAabbTouchCount: result.bookPairs.length,
    legacyRemoved: Object.values(result.removedLegacy).every(Boolean) && result.legacyVisibleMeshes === 0,
    shadowOcclusion: result.shadowOcclusion.shelfCasts
      && !result.shadowOcclusion.partitionReceivesShadow
      && result.shadowOcclusion.topItemCasters.length === 0,
    pageErrors: result.errors.length,
  },
  note: '书籍按逐本 AABB 记录；相邻书籍允许 0–4 mm 的 AABB 边缘接触，书间接触数量单独列出，不作为穿模。',
};

fs.mkdirSync('analysis', { recursive: true });
fs.writeFileSync('analysis/shelf-audit.json', JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload.verdict));
console.log('analysis/shelf-audit.json');
await browser.close();
