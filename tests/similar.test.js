import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SIZE, borderColor, contentBox, describe, rank, readIndex, similarity } from "../similar.js";

const file = readFileSync(new URL("../data/similar.bin", import.meta.url));
const index = readIndex(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const data = JSON.parse(readFileSync(new URL("../data/glyphs.json", import.meta.url), "utf8"));

/** 把第 i 枚浮印的色块图放大后贴进一张带背景的“截图”。 */
function screenshot(i, { bg = [24, 26, 32], scale = 6, margin = 20 } = {}) {
  const side = SIZE * scale;
  const w = side + margin * 2;
  const px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let c = bg;
      const gx = Math.floor((x - margin) / scale);
      const gy = Math.floor((y - margin) / scale);
      if (gx >= 0 && gy >= 0 && gx < SIZE && gy < SIZE) {
        const s = (i * SIZE * SIZE + gy * SIZE + gx) * 4;
        const a = index.px[s + 3] / 255;
        c = [0, 1, 2].map((k) => index.px[s + k] + bg[k] * (1 - a));
      }
      px.set([...c, 255], o);
    }
  return { px, w, h: w };
}

test("特征文件和浮印列表一一对应", () => {
  assert.equal(index.count, data.glyphs.length);
});

test("背景色和图案范围", () => {
  const shot = screenshot(0, { bg: [200, 210, 220] });
  assert.deepEqual(borderColor(shot.px, shot.w, shot.h), [200, 210, 220]);
  const box = contentBox(shot.px, shot.w, shot.h, [200, 210, 220]);
  assert.ok(box.x >= 18 && box.w <= SIZE * 6 + 4);
});

test("贴在不同背景上的浮印能被认出来", () => {
  const picks = [3, 97, 404, 777, 1200, 1650];
  for (const i of picks)
    for (const bg of [
      [20, 22, 28],
      [235, 235, 238],
    ]) {
      const shot = screenshot(i, { bg });
      const top = rank(index, describe(shot.px, shot.w, shot.h), 5);
      assert.ok(top.some((r) => r.i === i), `${data.glyphs[i].name} on ${bg}`);
      if (top[0].i === i) assert.ok(similarity(top[0].d) > 0.7);
    }
});
