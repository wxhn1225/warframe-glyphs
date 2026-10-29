import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_STATE, bestWay, facetCount, prepare, readState, results, statusOf, writeState } from "../catalog.js";

const data = JSON.parse(readFileSync(new URL("../data/glyphs.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-29T00:00:00Z");
const glyphs = prepare(data, NOW);
const none = { saved: new Set(), owned: new Set() };
const find = (name) => glyphs.find((g) => g.name === name);

test("每枚浮印都有编号、名称和至少一条获取方式", () => {
  assert.equal(new Set(glyphs.map((g) => g.id)).size, glyphs.length);
  for (const g of glyphs) {
    assert.ok(g.name && g.ways.length, g.id);
    for (const w of g.ways) assert.ok(["free", "resource", "platinum", "paid", "unknown"].includes(w.tier), g.id);
  }
});

test("同一条获取方式要同时满足所有条件", () => {
  // 一条已结束的免费途径加一条当前可得的白金途径，不算“免费且当前可获取”
  const g = { id: "x", name: "x", search: "x", ways: [{ tier: "free", live: "ended", channel: "午夜电波" }, { tier: "platinum", live: "now", channel: "游戏商城" }] };
  const hit = (patch) => results([g], { ...DEFAULT_STATE, ...patch }, none).length;
  assert.equal(hit({ tiers: ["free"], status: "now" }), 0);
  assert.equal(hit({ tiers: ["free"], status: "ended" }), 1);
  assert.equal(hit({ tiers: ["platinum"], status: "now" }), 1);
});

test("无需付费是免费和游戏资源的合集", () => {
  const n = (tiers) => facetCount(glyphs, DEFAULT_STATE, none, { tiers });
  const both = glyphs.filter((g) => g.ways.some((w) => w.tier === "free" || w.tier === "resource")).length;
  assert.equal(n(["free", "resource"]), both);
  assert.ok(n(["free", "resource"]) >= Math.max(n(["free"]), n(["resource"])));
});

test("卡片上显示的途径优先选当前能拿、更便宜的", () => {
  const g = { ways: [{ tier: "platinum", live: "now" }, { tier: "free", live: "ended" }, { tier: "resource", live: "rotating" }] };
  assert.equal(bestWay(g, DEFAULT_STATE).tier, "platinum");
  assert.equal(bestWay(g, { ...DEFAULT_STATE, tiers: ["free"] }).tier, "free");
});

test("限时活动按日期判断状态", () => {
  assert.equal(statusOf({ status: "limited", until: "2026-10-01T00:00:00Z" }, NOW), "ended");
  assert.equal(statusOf({ status: "limited", from: "2026-11-01T00:00:00Z" }, NOW), "upcoming");
  assert.equal(statusOf({ status: "limited", until: "2026-11-02T16:00:00Z" }, NOW), "limited");
  // 只写日期的截止时间当天仍可获取
  assert.equal(statusOf({ status: "limited", until: "2026-10-29" }, NOW + 20 * 3600e3), "limited");
  assert.equal(statusOf({ status: "limited", until: "2026-10-28" }, NOW), "ended");
});

test("搜索中英文名和兑换码", () => {
  const q = (text) => results(glyphs, { ...DEFAULT_STATE, q: text }, none).map((g) => g.name);
  assert.ok(q("Corpus 浮印").includes("Corpus 浮印"));
  assert.ok(q("corpus glyph").includes("Corpus 浮印"));
  assert.ok(q("ADMIRALBAHROO").length >= 1);
});

test("按是否已获取筛选", () => {
  const marks = { saved: new Set(), owned: new Set(glyphs.slice(0, 5).map((g) => g.id)) };
  const n = (own) => results(glyphs, { ...DEFAULT_STATE, own }, marks).length;
  assert.equal(n("only"), 5);
  assert.equal(n("hide"), glyphs.length - 5);
  assert.equal(n(""), glyphs.length);
  assert.equal(facetCount(glyphs, DEFAULT_STATE, marks, { own: "hide" }), glyphs.length - 5);
});

test("推荐顺序先列精选浮印", () => {
  const first = results(glyphs, DEFAULT_STATE, none).slice(0, 3).map((g) => g.en);
  assert.deepEqual(first, ["Miabyte Glyph", "Aurorastarr Glyph", "Fateful Glyph"]);
});

test("修正过的获取方式", () => {
  assert.equal(find("恶意纳贝流士浮印").ways[0].cost, '5 "母亲"石印');
  assert.equal(find("星日碧浮印").ways[0].cost, "5 培训债务债券");
  assert.ok(find("Khora 战斗姿态浮印").ways.some((w) => w.tier === "resource" && w.live === "now"));
  assert.ok(find("诺拉·夜骷髅女士浮印").ways.some((w) => w.cost === '20 "母亲"石印'));
  assert.ok(find("常见秃鹰浮印").ways[0].how.includes("第 5 级"));
  for (const name of ["基础爆炸浮印", "Samat 浮印", "社区 Citrine 浮印"]) assert.ok(find(name).ways.some((w) => w.cost === "20 白金"), name);
});

test("地址参数来回转换不丢失", () => {
  const state = { q: "鸟", tiers: ["resource", "free"], status: "now", channel: "商人兑换", own: "hide", saved: true, sort: "name", page: 3 };
  assert.deepEqual(readState(writeState(state)), { ...state, tiers: ["free", "resource"] });
  assert.deepEqual(readState("?cost=bogus&status=x&channel=y&sort=z"), DEFAULT_STATE);
});
