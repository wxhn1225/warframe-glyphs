// 以图搜索：把图片缩成很小的色块图，再和每枚浮印的色块图比对

export const SIZE = 16;
const CELLS = SIZE * SIZE;

/** 读入特征文件：每枚浮印一张 SIZE×SIZE 的预乘 RGBA 色块图，顺序与 glyphs.json 相同。 */
export function readIndex(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "GLYF" || view.getUint16(4, true) !== SIZE) throw new Error("特征文件格式不对");
  const count = view.getUint16(6, true);
  const px = new Uint8Array(buffer, 8, count * CELLS * 4);
  const full = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let solid = 1;
    for (let c = 0; c < CELLS && solid; c++) if (px[(i * CELLS + c) * 4 + 3] < 250) solid = 0;
    full[i] = solid;
  }
  return { count, px, full };
}

/** 图片四边一圈像素的中位色，当作背景色。 */
export function borderColor(px, w, h) {
  const ring = [[], [], []];
  const take = (x, y) => {
    const o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) ring[k].push(px[o + k]);
  };
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    take(0, y);
    take(w - 1, y);
  }
  return ring.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
}

/** 四边像素和背景色的典型差别，背景越杂这个值越大。 */
function borderNoise(px, w, h, bg) {
  const diffs = [];
  const take = (x, y) => {
    const o = (y * w + x) * 4;
    diffs.push(Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]));
  };
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    take(0, y);
    take(w - 1, y);
  }
  return diffs.sort((a, b) => a - b)[Math.floor(diffs.length * 0.9)];
}

/** 和背景色差别超过门槛的像素所在的外框；整张都像背景时返回整张。 */
export function contentBox(px, w, h, bg, cut = 48) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]);
      if (d > cut) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) < w * h * 0.002) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 把一块区域居中补成正方形（空处填背景色），按面积平均缩成 SIZE×SIZE 的 RGB，取值 0–1。 */
export function sample(px, w, box, bg) {
  const side = Math.max(box.w, box.h);
  const ox = box.x - (side - box.w) / 2;
  const oy = box.y - (side - box.h) / 2;
  const out = new Float32Array(CELLS * 3);
  const cell = side / SIZE;
  for (let gy = 0; gy < SIZE; gy++)
    for (let gx = 0; gx < SIZE; gx++) {
      const sx0 = ox + gx * cell;
      const sy0 = oy + gy * cell;
      const sum = [0, 0, 0];
      let n = 0;
      const ys = Math.max(1, Math.round(cell));
      const stepY = cell / ys;
      const stepX = stepY;
      for (let j = 0; j < ys; j++)
        for (let i = 0; i < ys; i++) {
          const x = Math.floor(sx0 + (i + 0.5) * stepX);
          const y = Math.floor(sy0 + (j + 0.5) * stepY);
          const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
          const o = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) sum[k] += inside ? px[o + k] : bg[k];
          n++;
        }
      const c = (gy * SIZE + gx) * 3;
      for (let k = 0; k < 3; k++) out[c + k] = sum[k] / n / 255;
    }
  return out;
}

/**
 * 截图的几种取法：整张，以及裁掉背景只留图案。裁剪用两道门槛：高的不会把图案的淡光晕算进去，
 * 低的能框住贴在相近底色上的图案，比对时取更像的那个。
 */
export function describe(px, w, h) {
  const bg = borderColor(px, w, h);
  const all = { x: 0, y: 0, w, h };
  const boxes = [contentBox(px, w, h, bg), contentBox(px, w, h, bg, Math.max(18, borderNoise(px, w, h, bg) * 1.5 + 8))];
  const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const trims = (same(boxes[0], boxes[1]) ? boxes.slice(0, 1) : boxes).map((box) => sample(px, w, box, bg));
  return { bg: bg.map((v) => v / 255), full: sample(px, w, all, bg), trims };
}

/** 浮印的色块图铺在给定背景色上。 */
function composite(index, i, bg, out) {
  const base = i * CELLS * 4;
  for (let c = 0; c < CELLS; c++) {
    const o = base + c * 4;
    const a = index.px[o + 3] / 255;
    for (let k = 0; k < 3; k++) out[c * 3 + k] = index.px[o + k] / 255 + bg[k] * (1 - a);
  }
  return out;
}

/** 两张色块图的差别：颜色差和明暗结构差各占一部分，0 表示一样。 */
export function distance(a, b) {
  let color = 0;
  let ma = 0;
  let mb = 0;
  const la = new Float32Array(CELLS);
  const lb = new Float32Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const o = c * 3;
    color += Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
    la[c] = 0.299 * a[o] + 0.587 * a[o + 1] + 0.114 * a[o + 2];
    lb[c] = 0.299 * b[o] + 0.587 * b[o + 1] + 0.114 * b[o + 2];
    ma += la[c];
    mb += lb[c];
  }
  ma /= CELLS;
  mb /= CELLS;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let c = 0; c < CELLS; c++) {
    const da = la[c] - ma;
    const db = lb[c] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  const corr = saa > 1e-6 && sbb > 1e-6 ? sab / Math.sqrt(saa * sbb) : 0;
  return 0.5 * (color / (CELLS * 3)) * 3 + 0.5 * ((1 - corr) / 2);
}

/** 最像的 k 枚浮印，按差别从小到大。 */
export function rank(index, query, k = 12) {
  const tmp = new Float32Array(CELLS * 3);
  const scores = [];
  for (let i = 0; i < index.count; i++) {
    let d;
    const g = composite(index, i, query.bg, tmp);
    d = index.full[i] ? distance(query.full, g) : Number.POSITIVE_INFINITY;
    for (const t of query.trims) d = Math.min(d, distance(t, g));
    scores.push({ i, d });
  }
  return scores.sort((a, b) => a.d - b.d).slice(0, k);
}

/** 差别换算成给人看的相似度：同一枚浮印多在 90% 上下，不同的多在 50% 以下。 */
export const similarity = (d) => Math.max(0, Math.min(1, 1 - 2.2 * d));
