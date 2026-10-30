// 浮印目录的筛选、排序和地址参数

export const TIERS = [
  { key: "free", label: "免费" },
  { key: "resource", label: "游戏资源" },
  { key: "platinum", label: "白金" },
  { key: "paid", label: "付费购买" },
  { key: "unknown", label: "待补充" },
];
export const NO_SPEND = ["free", "resource"];

export const STATUSES = [
  { key: "now", label: "当前可获取", has: ["now", "limited"] },
  { key: "again", label: "周期开放", has: ["rotating", "upcoming"] },
  { key: "ended", label: "已结束", has: ["ended"] },
  { key: "unknown", label: "未知", has: ["unknown"] },
];
export const STATUS_LABEL = { now: "当前可获取", limited: "限时开放", rotating: "周期开放", upcoming: "即将开放", ended: "已结束", unknown: "状态未知" };

/** 按自己是否已获取筛选，标记存在本机。 */
export const OWNERSHIP = [
  { key: "", label: "全部" },
  { key: "hide", label: "未获取" },
  { key: "only", label: "已获取" },
];

export const CHANNELS = ["兑换码", "游戏商城", "商人兑换", "虚空商人", "午夜电波", "节日活动", "行动与活动", "任务与挑战", "初始与登录", "创作者", "Prime 礼包", "TennoCon", "礼包与周边", "专属", "其他"];

/** 推荐顺序里排在最前的精选浮印。 */
export const FEATURED = ["g-9c5ecfc51e6a", "g-9316489041bc", "g-493ba46d1bca", "g-5db448dd40ae", "g-db711b8f330a", "g-4c572efb020d", "g-9d5231478c56", "g-82e7631cf29d", "g-cfbebf1328ad", "g-4230d01053d9", "g-9941ca57c59d", "g-5a1324536cf2"];

export const SORTS = [
  { key: "best", label: "推荐顺序" },
  { key: "name", label: "名称" },
  { key: "en", label: "英文名称" },
];

const TIER_RANK = { free: 0, resource: 1, platinum: 2, paid: 3, unknown: 4 };
const STATUS_RANK = { now: 0, limited: 0, rotating: 1, upcoming: 2, unknown: 3, ended: 4 };
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export const fold = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** 只写了日期的截止时间算到当天结束（UTC）。 */
const deadline = (s) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s);

/** 按日期算出的当前状态：限时活动过期即结束，未开始即将开放。 */
export function statusOf(way, now = Date.now()) {
  if (way.until && deadline(way.until) < now) return "ended";
  if (way.from && Date.parse(way.from) > now) return "upcoming";
  return way.status;
}

/** 页面开着时日期会过，重新算一遍每条途径的状态；有变化时返回 true。 */
export function refreshStatus(glyphs, now = Date.now()) {
  let changed = false;
  for (const g of glyphs)
    for (const w of g.ways) {
      const live = statusOf(w, now);
      if (live !== w.live) {
        w.live = live;
        changed = true;
      }
    }
  return changed;
}

export function prepare(data, now = Date.now()) {
  return data.glyphs.map((g, order) => {
    const ways = g.ways.map((w) => ({ ...w, live: statusOf(w, now) }));
    const text = [g.name, g.en, ...(g.aliases ?? []), ...ways.flatMap((w) => [w.channel, w.via, w.cost, w.code, w.how])];
    return { ...g, ways, order, search: fold(text.filter(Boolean).join("|")) };
  });
}

/** 一条途径同时满足所有已选条件，浮印才算符合。 */
export function wayMatches(way, state) {
  if (state.tiers.length && !state.tiers.includes(way.tier)) return false;
  if (state.status && !STATUSES.find((s) => s.key === state.status).has.includes(way.live)) return false;
  if (state.channel && way.channel !== state.channel) return false;
  return true;
}

/** 判断浮印是否符合条件；`marks` 是本机的收藏和已获取标记，搜索词只拆分一次。 */
export function matcher(state, marks) {
  const words = String(state.q ?? "").normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean).map(fold);
  return (g) =>
    (!state.saved || marks.saved.has(g.id)) &&
    (state.own !== "hide" || !marks.owned.has(g.id)) &&
    (state.own !== "only" || marks.owned.has(g.id)) &&
    words.every((w) => g.search.includes(w)) &&
    g.ways.some((w) => wayMatches(w, state));
}

/** 卡片上显示的途径：先看符合筛选的，再挑最容易拿到、最便宜的。 */
export function bestWay(g, state) {
  const fit = g.ways.filter((w) => wayMatches(w, state));
  return [...(fit.length ? fit : g.ways)].sort((a, b) => STATUS_RANK[a.live] - STATUS_RANK[b.live] || TIER_RANK[a.tier] - TIER_RANK[b.tier])[0];
}

export function results(glyphs, state, marks) {
  const list = glyphs.filter(matcher(state, marks));
  if (state.sort === "name") return list.sort((a, b) => collator.compare(a.name, b.name));
  if (state.sort === "en") return list.sort((a, b) => collator.compare(a.en, b.en));
  const rank = new Map(list.map((g) => {
    const w = bestWay(g, state);
    const pick = FEATURED.indexOf(g.id);
    return [g.id, pick >= 0 ? pick - FEATURED.length : STATUS_RANK[w.live] * 10 + TIER_RANK[w.tier]];
  }));
  return list.sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.order - b.order);
}

/** 某个选项单独生效时的数量，其他条件保持不变。 */
export function facetCount(glyphs, state, marks, patch) {
  const fits = matcher({ ...state, ...patch }, marks);
  let n = 0;
  for (const g of glyphs) if (fits(g)) n++;
  return n;
}

export const DEFAULT_STATE = { q: "", tiers: [], status: "", channel: "", own: "", saved: false, sort: "best", page: 1 };

export function readState(search) {
  const p = new URLSearchParams(search);
  const tiers = (p.get("cost") ?? "").split(",").filter((t) => t in TIER_RANK);
  const status = STATUSES.some((s) => s.key === p.get("status")) ? p.get("status") : "";
  const channel = CHANNELS.includes(p.get("channel")) ? p.get("channel") : "";
  const own = OWNERSHIP.some((o) => o.key && o.key === p.get("own")) ? p.get("own") : "";
  const sort = SORTS.some((s) => s.key === p.get("sort")) ? p.get("sort") : "best";
  const page = Math.max(1, Math.min(999, Number.parseInt(p.get("page") ?? "", 10) || 1));
  return { q: (p.get("q") ?? "").slice(0, 120), tiers: [...new Set(tiers)], status, channel, own, saved: p.get("saved") === "1", sort, page };
}

export function writeState(state) {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.tiers.length) p.set("cost", TIERS.map((t) => t.key).filter((k) => state.tiers.includes(k)).join(","));
  if (state.status) p.set("status", state.status);
  if (state.channel) p.set("channel", state.channel);
  if (state.own) p.set("own", state.own);
  if (state.saved) p.set("saved", "1");
  if (state.sort !== "best") p.set("sort", state.sort);
  if (state.page > 1) p.set("page", String(state.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
