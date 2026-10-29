import { CHANNELS, DEFAULT_STATE, FEATURED, NO_SPEND, SORTS, STATUS_LABEL, STATUSES, TIERS, bestWay, facetCount, prepare, readState, refreshStatus, results, writeState } from "./catalog.js";
import { describe, rank, readIndex, similarity } from "./similar.js";

const $ = (id) => document.getElementById(id);
const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]));
const TIER_RANK = { free: 0, resource: 1, platinum: 2, paid: 3, unknown: 4 };
const LIVE_RANK = { now: 0, limited: 0, rotating: 1, upcoming: 2, unknown: 3, ended: 4 };
const COSTS = [
  { key: "all", label: "全部", tiers: [] },
  { key: "nospend", label: "无需付费", tiers: NO_SPEND },
  ...TIERS.filter((t) => t.key !== "unknown").map((t) => ({ key: t.key, label: t.label, tiers: [t.key], icon: t.key })),
];
const SAVED_KEY = "warframe-glyphs:saved";
const THEME_KEY = "warframe-glyphs:theme";
const DENSITY_KEY = "warframe-glyphs:density";
const PAGE_TARGET = { cozy: 60, dense: 120 };
const num = new Intl.NumberFormat("zh-CN");
const when = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

const ui = Object.fromEntries(
  ["q", "grid", "count", "clear", "empty", "state", "costs", "saved", "savedCount", "theme", "updated", "total", "collage", "pager", "go-nospend", "nospend-total", "gallery-title", "detail", "d-art", "d-img", "d-name", "d-en", "d-ways", "d-pos", "d-fav", "d-share", "toast", "lens", "lens-btn", "lens-file", "lens-img", "lens-note", "lens-grid", "drop"].map((id) => [
    id.replace(/-(\w)/g, (_, c) => c.toUpperCase()),
    $(id),
  ]),
);
const menus = {
  status: { btn: $("status-btn"), label: $("status-label"), list: $("status-list"), pop: $("pop-status") },
  channel: { btn: $("channel-btn"), label: $("channel-label"), list: $("channel-list"), pop: $("pop-channel") },
  sort: { btn: $("sort-btn"), label: $("sort-label"), list: $("sort-list"), pop: $("pop-sort") },
};

let glyphs = [];
let byId = new Map();
let list = [];
let state = readState(location.search);
let current = null;
let density = loadText(DENSITY_KEY) === "dense" ? "dense" : "cozy";
const nodes = new Map();
const saved = new Set(load(SAVED_KEY, []).filter((x) => typeof x === "string"));

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function loadText(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key, value) {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {}
}

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...kids.filter((x) => x != null && x !== false));
  return node;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// ---------- 首屏拼贴 ----------

// 六枚精选浮印的位置、大小、角度和视差深度
const PINS = [
  { x: 0, y: 6, w: 34, r: -6, z: 3, d: 16 },
  { x: 29, y: 0, w: 37, r: 5, z: 2, d: 10 },
  { x: 24, y: 47, w: 35, r: -4, z: 4, d: 20 },
  { x: 63, y: 44, w: 34, r: 7, z: 5, d: 24 },
  { x: 68, y: 2, w: 29, r: 9, z: 1, d: 8 },
  { x: 0, y: 58, w: 27, r: 6, z: 1, d: 12 },
];

function buildCollage() {
  const picks = FEATURED.slice(0, PINS.length).map((id) => byId.get(id)).filter(Boolean);
  ui.collage.replaceChildren(
    ...picks.map((g, i) => {
      const p = PINS[i];
      return el(
        "button",
        {
          class: `pin${g.plate === "full" ? " card" : ""}`,
          type: "button",
          "data-id": g.id,
          "aria-label": g.name,
          style: `--x:${p.x}%;--y:${p.y}%;--w:${p.w}%;--r:${p.r}deg;--z:${p.z};--d:${p.d};--delay:${-i * 1.3}s`,
        },
        el("img", { src: `images/${g.id}.webp`, alt: "", width: 512, height: 512, decoding: "async", fetchpriority: i < 2 ? "high" : "auto" }),
      );
    }),
  );
  // 指针移动时各层以不同幅度错开，形成纵深
  ui.collage.closest(".hero").addEventListener("pointermove", (e) => {
    if (!finePointer.matches || reduceMotion.matches) return;
    const r = ui.collage.getBoundingClientRect();
    ui.collage.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    ui.collage.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  });
}

// ---------- 卡片 ----------

function priceOf(w) {
  if (w.tier === "platinum" && /^\d+ 白金$/.test(w.cost ?? "")) return w.cost;
  return TIER_LABEL[w.tier];
}
function channelOf(w) {
  return w.live === "ended" ? `${w.channel}，已结束` : w.live === "rotating" ? `${w.channel}，周期开放` : w.channel;
}

function tileButton(g) {
  return el(
    "button",
    { class: "tile", type: "button", "data-id": g.id, "data-plate": g.plate, style: g.tint ? `--tint:${g.tint}` : null },
    el("span", { class: "plate" }, el("img", { src: `thumbs/${g.id}.webp`, alt: "", width: 256, height: 256, loading: "lazy", decoding: "async" })),
    el("span", { class: "cap" }, el("span", { class: "name", text: g.name }), el("span", { class: "meta" }, el("span", { class: "ch" }), el("span", { class: "price" }, icon("free"), el("span")))),
  );
}

function tileFor(g) {
  let li = nodes.get(g.id);
  if (li) return li;
  const fav = el("button", { class: "fav", type: "button", "aria-pressed": String(saved.has(g.id)), "aria-label": `收藏 ${g.name}`, "data-fav": g.id }, icon("heart"));
  li = el("li", {}, tileButton(g), fav);
  nodes.set(g.id, li);
  return li;
}

/** 卡片下方的渠道和价格；`price` 给出时用它代替价格，比如相似度。 */
function paintTile(tile, g, w, price) {
  const tag = tile.querySelector(".price");
  tag.className = `price t-${w.tier}`;
  tag.querySelector("use").setAttribute("href", `#i-${w.tier}`);
  tag.lastChild.textContent = price ?? priceOf(w);
  tile.querySelector(".ch").textContent = channelOf(w);
  tile.setAttribute("aria-label", `${g.name}，${price ?? priceOf(w)}，${channelOf(w)}`);
}

// ---------- 筛选 ----------

function option(label, value, extra = {}) {
  return el("button", { class: "opt", type: "button", role: "radio", "aria-checked": "false", "data-value": value, ...extra }, el("span", { text: label }), el("b"), icon("check"));
}

function buildControls() {
  ui.costs.append(
    ...COSTS.map((c) =>
      el("button", { class: `tab${c.icon ? ` t-${c.icon}` : ""}`, type: "button", role: "radio", "aria-checked": "false", "data-cost": c.key }, c.icon ? icon(c.icon) : null, el("span", { text: c.label }), el("b")),
    ),
  );
  menus.status.list.append(...[{ key: "", label: "全部状态" }, ...STATUSES].map((s) => option(s.label, s.key)));
  menus.channel.list.append(...["", ...CHANNELS].map((c) => option(c || "全部渠道", c)));
  menus.sort.list.append(...SORTS.map((s) => option(s.label, s.key)));
  for (const b of menus.sort.list.children) b.querySelector("b").remove();
}

function costKey() {
  const set = new Set(state.tiers);
  return COSTS.find((c) => c.tiers.length === set.size && c.tiers.every((t) => set.has(t)))?.key ?? null;
}

/** 改筛选条件时回到第一页；只翻页时保留其他条件。 */
function setState(patch) {
  state = { ...state, page: 1, ...patch };
  render();
}

const isDefault = () => !state.q && !state.tiers.length && !state.status && !state.channel && !state.saved;

/** 每页数量凑成整行：按当前列数把 60（小图 120）向上取整。 */
function pageSize() {
  const cols = getComputedStyle(ui.grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  return cols * Math.ceil(PAGE_TARGET[density] / cols);
}

function render() {
  list = results(glyphs, state, saved);
  ui.grid.classList.toggle("dense", density === "dense");
  const size = pageSize();
  const pages = Math.max(1, Math.ceil(list.length / size));
  if (state.page > pages) state = { ...state, page: pages };
  const start = (state.page - 1) * size;
  const shown = list.slice(start, start + size);
  for (const g of shown) paintTile(tileFor(g).firstChild, g, bestWay(g, state));
  ui.grid.replaceChildren(...shown.map((g) => nodes.get(g.id)));
  for (const b of document.querySelectorAll("[data-density]")) b.setAttribute("aria-checked", String(b.dataset.density === density));
  renderPager(pages);

  const n = num.format(list.length);
  ui.galleryTitle.textContent = state.saved ? "我的收藏" : isDefault() ? "全部浮印" : "筛选结果";
  ui.count.textContent = list.length
    ? `共 ${n} 枚${pages > 1 ? `，当前第 ${num.format(start + 1)}–${num.format(start + shown.length)} 枚` : ""}`
    : "共 0 枚";
  ui.clear.hidden = isDefault();
  ui.empty.hidden = list.length > 0;

  const count = (patch) => num.format(facetCount(glyphs, state, saved, patch));
  const active = costKey();
  for (const b of ui.costs.children) {
    const c = COSTS.find((x) => x.key === b.dataset.cost);
    b.setAttribute("aria-checked", String(c.key === active));
    b.querySelector("b").textContent = count({ tiers: c.tiers });
  }
  const pick = (menu, value, label, counts) => {
    for (const b of menu.list.children) {
      b.setAttribute("aria-checked", String(b.dataset.value === value));
      if (counts) b.querySelector("b").textContent = counts(b.dataset.value);
    }
    menu.label.textContent = label;
    menu.btn.classList.toggle("on", Boolean(value) && menu !== menus.sort);
  };
  pick(menus.status, state.status, STATUSES.find((s) => s.key === state.status)?.label ?? "全部状态", (v) => count({ status: v }));
  pick(menus.channel, state.channel, state.channel || "全部渠道", (v) => count({ channel: v }));
  pick(menus.sort, state.sort, SORTS.find((s) => s.key === state.sort).label);
  if (document.activeElement !== ui.q && ui.q.value !== state.q) ui.q.value = state.q;
  ui.saved.setAttribute("aria-pressed", String(state.saved));
  showSavedCount();
  if (ui.detail.open) updateNav();

  history.replaceState(history.state, "", writeState(state) + location.hash || location.pathname);
}

// 页码：首尾两页、当前页前后各两页，其余折叠
function renderPager(pages) {
  if (pages <= 1) return ui.pager.replaceChildren();
  const p = state.page;
  const nums = [...new Set([1, 2, p - 2, p - 1, p, p + 1, p + 2, pages - 1, pages])].filter((x) => x >= 1 && x <= pages).sort((a, b) => a - b);
  const items = [];
  nums.forEach((x, i) => {
    if (i && x - nums[i - 1] > 1) items.push(el("span", { class: "gap", "aria-hidden": "true", text: "…" }));
    items.push(el("button", { type: "button", "data-page": x, "aria-label": `第 ${x} 页`, "aria-current": x === p ? "page" : null, text: num.format(x) }));
  });
  ui.pager.replaceChildren(
    el("button", { class: "step-btn", type: "button", "data-page": p - 1, disabled: p <= 1, "aria-label": "上一页" }, icon("left"), el("span", { text: "上一页" })),
    ...items,
    el("button", { class: "step-btn", type: "button", "data-page": p + 1, disabled: p >= pages, "aria-label": "下一页" }, el("span", { text: "下一页" }), icon("right")),
  );
}

function goPage(page) {
  setState({ page });
  $("gallery").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
}

// 弹出菜单贴在按钮下方，下方放不下时改到上方，靠右时不出屏
function placePop(menu) {
  const r = menu.btn.getBoundingClientRect();
  const w = menu.pop.offsetWidth;
  const h = menu.pop.offsetHeight;
  menu.pop.style.top = `${r.bottom + 8 + h > innerHeight - 12 ? Math.max(12, r.top - 8 - h) : r.bottom + 8}px`;
  menu.pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
}

// ---------- 详情 ----------

function wayCard(w) {
  const status = w.live === "limited" && w.until ? `${STATUS_LABEL.limited}，至 ${when.format(new Date(w.until))}` : STATUS_LABEL[w.live];
  const cost = w.cost ?? (w.tier === "unknown" ? "暂无价格信息" : w.tier === "free" ? null : TIER_LABEL[w.tier]);
  const actions = el("div", { class: "way-actions" });
  if (w.code) actions.append(el("span", { class: "code" }, el("span", { text: w.code }), el("button", { type: "button", "data-copy": w.code, text: "复制" })));
  if (w.url) actions.append(el("a", { href: w.url, target: "_blank", rel: "noopener noreferrer" }, w.code ? "前往兑换页面" : "打开相关页面", icon("out")));
  return el(
    "article",
    { class: `way t-${w.tier}` },
    el("div", { class: "way-top" }, el("span", { class: "way-icon" }, icon(w.tier)), el("span", { class: "way-tier", text: TIER_LABEL[w.tier] }), el("span", { class: `badge s-${w.live}`, text: status })),
    cost && el("p", { class: "way-cost", text: cost }),
    el("p", { class: "way-where", text: [w.channel, w.via].filter(Boolean).join(" · ") }),
    w.how && el("p", { class: "way-how", text: w.how }),
    actions.childElementCount ? actions : null,
  );
}

function fill(g) {
  ui.dName.textContent = g.name;
  ui.dEn.textContent = g.en && g.en !== g.name ? g.en : "";
  ui.dArt.dataset.plate = g.plate ?? "";
  ui.detail.querySelector(".stage").style.setProperty("--tint", g.tint ?? "#888888");
  const backdrops = ui.detail.querySelector(".backdrops");
  backdrops.hidden = g.plate === "full";
  for (const b of backdrops.children) b.setAttribute("aria-checked", String(b.dataset.bg === "auto"));
  ui.dImg.src = `thumbs/${g.id}.webp`;
  const full = new Image();
  full.onload = () => {
    if (current === g.id) ui.dImg.src = full.src;
  };
  full.src = `images/${g.id}.webp`;
  const on = saved.has(g.id);
  ui.dFav.setAttribute("aria-pressed", String(on));
  ui.dFav.lastChild.textContent = on ? "已收藏" : "收藏";

  const ways = [...g.ways].sort((a, b) => LIVE_RANK[a.live] - LIVE_RANK[b.live] || TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  const open = ways.filter((w) => w.live !== "ended");
  const past = ways.filter((w) => w.live === "ended");
  const blocks = (open.length ? open : past).map(wayCard);
  if (open.length && past.length) blocks.push(el("details", { class: "past" }, el("summary", { text: `已结束的获取方式（${past.length}）` }), ...past.map(wayCard)));
  ui.dWays.replaceChildren(...blocks);

  updateNav();
  ui.detail.querySelector(".info").scrollTop = 0;
}

// 详情所在的位置；这一枚已不在列表里时（比如在收藏里刚取消收藏）沿用它原来的位置
let anchor = 0;

function updateNav() {
  const i = list.findIndex((x) => x.id === current);
  if (i >= 0) anchor = i;
  ui.dPos.textContent = i >= 0 ? `${num.format(i + 1)} / ${num.format(list.length)}` : `共 ${num.format(list.length)} 枚`;
  ui.detail.querySelector(".prev").disabled = anchor <= 0;
  ui.detail.querySelector(".next").disabled = i >= 0 ? anchor >= list.length - 1 : anchor >= list.length;
}

// 从列表打开的详情占一条历史记录，关闭时退回；从链接直接打开的不占
let pushed = false;
let closingFromHistory = false;

function openDetail(id, { push = true, from = null } = {}) {
  const g = byId.get(id);
  if (!g) return;
  const wasOpen = ui.detail.open;
  current = id;
  const show = () => {
    fill(g);
    if (!ui.detail.open) ui.detail.showModal();
  };
  const img = from?.querySelector("img");
  if (img && !wasOpen && document.startViewTransition && !reduceMotion.matches) {
    img.style.viewTransitionName = "glyph";
    const t = document.startViewTransition(() => {
      img.style.viewTransitionName = "";
      ui.dImg.style.viewTransitionName = "glyph";
      show();
    });
    t.finished.finally(() => {
      ui.dImg.style.viewTransitionName = "";
    });
  } else show();
  const url = `${writeState(state)}#${id}`;
  if (push && !wasOpen) {
    history.pushState({ detail: id, fromList: true }, "", url);
    pushed = true;
  } else history.replaceState({ ...history.state, detail: id }, "", url);
}

function closeDetail() {
  if (ui.detail.open) ui.detail.close();
}
ui.detail.addEventListener("close", () => {
  const id = current;
  current = null;
  if (!closingFromHistory) {
    if (pushed) history.back();
    else history.replaceState(null, "", writeState(state) || location.pathname);
  }
  pushed = false;
  closingFromHistory = false;
  const tile = id && nodes.get(id)?.firstChild;
  if (tile?.isConnected) tile.focus({ preventScroll: true });
});

// 在详情里切换时，背后的列表跟着翻到同一页，关闭后焦点落在这一枚上
function step(dir) {
  const i = list.findIndex((x) => x.id === current);
  const target = i >= 0 ? i + dir : dir > 0 ? anchor : anchor - 1;
  const next = list[target];
  if (!next) return;
  openDetail(next.id, { push: false });
  const page = Math.floor(target / pageSize()) + 1;
  if (page !== state.page) {
    state = { ...state, page };
    render();
  }
}

function syncFromHash() {
  const id = location.hash.slice(1);
  if (id && byId.has(id)) {
    // 从列表打开时留下的记录（用前进键回来或刷新后仍在）关闭时退回列表；直接打开的链接关闭时留在本站
    const ours = Boolean(history.state?.fromList);
    openDetail(id, { push: false });
    pushed = ours;
    return;
  }
  if (ui.detail.open) {
    closingFromHistory = true;
    closeDetail();
  }
  // 退回列表时地址里的页码以当前列表为准
  history.replaceState(null, "", writeState(state) || location.pathname);
}

// 指针移动时卡片轻微倾斜，高光跟着走
function bindTilt() {
  const art = ui.dArt;
  art.addEventListener("pointermove", (e) => {
    if (!finePointer.matches || reduceMotion.matches) return;
    const r = art.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    art.classList.add("tilting");
    art.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
    art.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    art.style.setProperty("--gx", `${x * 100}%`);
    art.style.setProperty("--gy", `${y * 100}%`);
    art.style.setProperty("--go", "1");
  });
  art.addEventListener("pointerleave", () => {
    art.classList.remove("tilting");
    for (const p of ["--rx", "--ry", "--go"]) art.style.removeProperty(p);
  });
}

// ---------- 收藏、复制、提示 ----------

function toggleSaved(id) {
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  keep(SAVED_KEY, [...saved]);
  const on = saved.has(id);
  nodes.get(id)?.querySelector(".fav")?.setAttribute("aria-pressed", String(on));
  if (current === id) {
    ui.dFav.setAttribute("aria-pressed", String(on));
    ui.dFav.lastChild.textContent = on ? "已收藏" : "收藏";
  }
  if (state.saved) render();
  else showSavedCount();
  toast(on ? "已加入收藏" : "已取消收藏");
}

// 窄屏只显示数字，按钮名称写全
function showSavedCount() {
  ui.savedCount.textContent = num.format(saved.size);
  ui.saved.setAttribute("aria-label", `收藏，${num.format(saved.size)} 枚`);
}

let toastTimer = 0;
function toast(text) {
  ui.toast.replaceChildren(icon("check"), text);
  // 每次重新放到最上层，压在已打开的详情上面
  if (ui.toast.showPopover) {
    if (ui.toast.matches(":popover-open")) ui.toast.hidePopover();
    ui.toast.showPopover();
  } else ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidePopover ? ui.toast.hidePopover() : ui.toast.classList.remove("show")), 1800);
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el("textarea", { readonly: true, style: "position:fixed;opacity:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(done);
}

// ---------- 以图搜索 ----------

let indexReady = null;
let lensUrl = "";
let lensTop = [];
// 连续选了几张图时，只显示最后一张的结果
let lensRun = 0;
const indexOnce = () => (indexReady ??= fetch("data/similar.bin").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))).then(readIndex));

async function pixelsOf(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { px: ctx.getImageData(0, 0, w, h).data, w, h };
}

async function searchImage(file) {
  if (!file?.type.startsWith("image/")) return;
  const run = ++lensRun;
  // 新的一张开始比对时清掉上一张的结果，失败时不会再冒出来
  lensTop = [];
  if (ui.detail.open) closeDetail();
  URL.revokeObjectURL(lensUrl);
  lensUrl = URL.createObjectURL(file);
  ui.lensImg.src = lensUrl;
  ui.lensNote.textContent = "正在比对…";
  ui.lensGrid.replaceChildren();
  ui.lens.hidden = false;
  $("gallery").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  try {
    const [index, img] = await Promise.all([indexOnce(), pixelsOf(file)]);
    if (run !== lensRun) return;
    lensTop = rank(index, describe(img.px, img.w, img.h), 48);
    renderLens();
    ui.lensNote.textContent = "按相似度排列。截图只框住浮印本身时结果最准确。";
  } catch {
    indexReady = null;
    if (run !== lensRun) return;
    ui.lensNote.textContent = "这张图片无法读取，请换一张。";
  }
}

/** 以图搜索的结果铺满三行：按当前列数取前几名。 */
function lensColumns() {
  return getComputedStyle(ui.lensGrid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}
function renderLens() {
  ui.lensGrid.replaceChildren(
    ...lensTop.slice(0, lensColumns() * 3).map(({ i, d }) => {
      const g = glyphs[i];
      const tile = tileButton(g);
      paintTile(tile, g, bestWay(g, DEFAULT_STATE), `相似度 ${Math.round(similarity(d) * 100)}%`);
      return el("li", {}, tile);
    }),
  );
}

function closeLens() {
  lensRun++;
  lensTop = [];
  ui.lens.hidden = true;
  ui.lensGrid.replaceChildren();
  URL.revokeObjectURL(lensUrl);
  lensUrl = "";
}

// ---------- 事件 ----------

function bind() {
  let composing = false;
  ui.q.addEventListener("compositionstart", () => {
    composing = true;
  });
  ui.q.addEventListener("compositionend", () => {
    composing = false;
    setState({ q: ui.q.value.trim() });
  });
  ui.q.addEventListener("input", () => {
    if (!composing) setState({ q: ui.q.value.trim() });
  });
  ui.q.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.q.value) {
      ui.q.value = "";
      setState({ q: "" });
    }
    if (e.key === "Enter") $("gallery").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  });

  ui.costs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cost]");
    if (b) setState({ tiers: [...COSTS.find((c) => c.key === b.dataset.cost).tiers] });
  });
  ui.costs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const items = [...ui.costs.children];
    const i = items.indexOf(document.activeElement);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    next.focus();
    next.click();
  });
  for (const [key, menu] of Object.entries(menus)) {
    menu.pop.addEventListener("beforetoggle", (e) => {
      menu.btn.setAttribute("aria-expanded", String(e.newState === "open"));
      if (e.newState === "open") requestAnimationFrame(() => placePop(menu));
    });
    menu.list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-value]");
      if (!b) return;
      setState({ [key]: b.dataset.value });
      menu.pop.hidePopover();
    });
  }
  // 窗口宽度变化让列数变了，就重新分页，仍停在原来第一枚所在的那一页
  let lastSize = 0;
  addEventListener("resize", () => {
    for (const m of Object.values(menus)) if (m.pop.matches(":popover-open")) placePop(m);
    if (lensTop.length && !ui.lens.hidden && ui.lensGrid.childElementCount !== Math.min(lensTop.length, lensColumns() * 3)) renderLens();
    const size = pageSize();
    if (!glyphs.length || size === lastSize) return;
    const first = (state.page - 1) * lastSize;
    lastSize = size;
    state = { ...state, page: Math.floor(first / size) + 1 };
    render();
  });
  lastSize = pageSize();

  ui.saved.addEventListener("click", () => setState({ saved: !state.saved }));
  const reset = () => {
    ui.q.value = "";
    setState({ ...DEFAULT_STATE, sort: state.sort });
  };
  ui.clear.addEventListener("click", reset);
  ui.empty.querySelector("[data-clear]").addEventListener("click", reset);
  ui.theme.addEventListener("click", () => {
    const root = document.documentElement;
    const light = root.dataset.theme === "light";
    if (light) delete root.dataset.theme;
    else root.dataset.theme = "light";
    keep(THEME_KEY, light ? "dark" : "light");
  });
  ui.pager.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b && !b.disabled) goPage(Number(b.dataset.page));
  });
  for (const b of document.querySelectorAll("[data-density]"))
    b.addEventListener("click", () => {
      if (b.dataset.density === density) return;
      // 换密度后仍停在原来第一枚所在的那一页
      const first = (state.page - 1) * pageSize();
      density = b.dataset.density;
      keep(DENSITY_KEY, density);
      ui.grid.classList.toggle("dense", density === "dense");
      state = { ...state, page: Math.floor(first / pageSize()) + 1 };
      render();
    });
  ui.goNospend.addEventListener("click", () => {
    setState({ tiers: [...NO_SPEND] });
    $("gallery").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  });

  document.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) return toggleSaved(fav.dataset.fav);
    const tile = e.target.closest(".tile[data-id], .pin[data-id]");
    if (tile) return openDetail(tile.dataset.id, { from: tile });
    const c = e.target.closest("[data-copy]");
    if (c) {
      // 按钮本身也变成“已复制”，一眼能看到
      c.classList.add("done");
      c.replaceChildren(icon("check"), "已复制");
      clearTimeout(c.doneTimer);
      c.doneTimer = setTimeout(() => {
        c.classList.remove("done");
        c.replaceChildren("复制");
      }, 1600);
      return copy(c.dataset.copy, `已复制兑换码 ${c.dataset.copy}`);
    }
  });

  ui.detail.addEventListener("click", (e) => {
    if (e.target === ui.detail || e.target.closest("[data-close]")) return closeDetail();
    const s = e.target.closest("[data-step]");
    if (s) return step(Number(s.dataset.step));
    const bg = e.target.closest("[data-bg]");
    if (bg) {
      for (const b of bg.parentElement.children) b.setAttribute("aria-checked", String(b === bg));
      ui.dArt.dataset.plate = bg.dataset.bg === "auto" ? (byId.get(current)?.plate ?? "") : bg.dataset.bg;
    }
  });
  ui.dFav.addEventListener("click", () => current && toggleSaved(current));
  ui.dShare.addEventListener("click", () => current && copy(`${location.origin}${location.pathname}#${current}`, "已复制链接"));
  bindTilt();

  document.addEventListener("keydown", (e) => {
    if (ui.detail.open) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // 焦点在底色选项上时，方向键切换底色
      const group = e.target.closest?.(".backdrops");
      if (group) {
        e.preventDefault();
        const items = [...group.children];
        const next = items[(items.indexOf(e.target) + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
        next.focus();
        next.click();
        return;
      }
      step(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
    if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      ui.q.focus({ preventScroll: true });
      ui.q.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
      ui.q.select();
    }
  });
  addEventListener("popstate", syncFromHash);

  ui.lensBtn.addEventListener("click", () => ui.lensFile.click());
  ui.lensFile.addEventListener("change", () => {
    searchImage(ui.lensFile.files[0]);
    ui.lensFile.value = "";
  });
  $("lens-again").addEventListener("click", () => ui.lensFile.click());
  $("lens-close").addEventListener("click", closeLens);
  addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    searchImage(file);
  });
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    ui.drop.hidden = false;
  });
  addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      ui.drop.hidden = true;
    }
  });
  addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    ui.drop.hidden = true;
    searchImage([...e.dataTransfer.files].find((f) => f.type.startsWith("image/")));
  });
}

// ---------- 启动 ----------

async function start() {
  buildControls();
  bind();
  ui.q.value = state.q;
  try {
    const res = await fetch("data/glyphs.json");
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    glyphs = prepare(data);
    byId = new Map(glyphs.map((g) => [g.id, g]));
    const [y, m, d] = data.updated.split("-").map(Number);
    ui.total.textContent = num.format(glyphs.length);
    ui.updated.textContent = `收录 ${num.format(glyphs.length)} 枚浮印，更新于 ${y} 年 ${m} 月 ${d} 日`;
    ui.state.hidden = true;
    ui.nospendTotal.textContent = num.format(facetCount(glyphs, DEFAULT_STATE, saved, { tiers: NO_SPEND }));
    buildCollage();
    render();
    syncFromHash();
    // 页面一直开着时，过了截止时间的途径要变成已结束
    const recheck = () => {
      if (refreshStatus(glyphs)) render();
    };
    setInterval(recheck, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && recheck());
  } catch {
    ui.state.textContent = "浮印数据没有载入成功，请刷新页面重试。";
  }
}

start();
