// 羽球物語：離線也能玩。
// 第一次打開時把遊戲檔案和自己的角色存在手機裡；對手角色選到才下載、下載過就存著。
// 打開時：有網路就拿最新的（3 秒沒回應或沒網路才用存著的）；角色模型和外部程式庫存過就直接用。
// 改版：build_site.py 會換 VERSION，舊的存檔就清掉。
const VERSION = "badminton-1.7.2";
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'models/player.vrm', 'src/arena.js?v=172', 'src/character.js?v=172', 'src/footwork.js?v=172', 'src/gesture.js?v=172', 'src/main.js?v=172', 'src/physics.js?v=172', 'src/shots.js?v=172'];
const LIBS = ["https://cdn.jsdelivr.net/npm/three@0.160.0/", "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.4.5/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: "no-cache" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== "badminton-models") await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cacheFirst = (name) => e.respondWith(caches.open(name).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
  if (LIBS.some((p) => req.url.startsWith(p))) return cacheFirst(VERSION);                 // three.js 等程式庫：版本固定，存過就用
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith(".vrm") && !url.pathname.endsWith("/player.vrm")) return cacheFirst("badminton-models"); // 對手角色：很大、不常變
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const key = req.mode === "navigate" ? "./" : req;
    const fresh = fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) c.put(key, r.clone()); return r; });
    const late = new Promise((ok) => setTimeout(() => ok(null), 3000));
    const r = await Promise.race([fresh.catch(() => null), late]);
    if (r && r.ok) return r;
    const hit = await c.match(key);
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});
