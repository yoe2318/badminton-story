import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { DT, NET_H, COURT, step, simulate } from './physics.js?v=151';
import { SHOTS, planShot, predictContact, classify, CURVE_MIN, TOP_Y } from './shots.js?v=151';
import { attachGesture, chargeOf } from './gesture.js?v=151';
import { loadVRM, Rig } from './character.js?v=151';
import { planMove, planRecover, planJumpFollow, bodyAt, yawAt, bobAt } from './footwork.js?v=151';
import { buildArena } from './arena.js?v=151';

const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- 設定 ----------------
const settings = { target: 11, diff: 1, slow: 0, ring: 1, demo: 0, assist: 1, cam: 0, pers: 0, opp: 0, games: 1, stamina: 0, mode: 1, sound: 1, crowd: 1, call: 1, me: 0 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('bm-proto') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('bm-proto', JSON.stringify(settings)); } catch (e) {} };
// 電腦難度：tactic＝多常照戰術出球（其餘隨機）、err＝落點誤差倍數、poor＝勉強擊球的機率
const DIFF = [
  { speed: 3.4, react: 0.34, perfect: 0.25, poor: 0.35, readOut: 0.5, tactic: 0, err: 1.0, backhand: 0.1 },
  { speed: 3.9, react: 0.24, perfect: 0.5, poor: 0.12, readOut: 0.85, tactic: 0.6, err: 0.7, backhand: 0.3 },
  { speed: 4.3, react: 0.18, perfect: 0.7, poor: 0.04, readOut: 0.97, tactic: 0.85, err: 0.5, backhand: 0.45 },
  { speed: 4.7, react: 0.13, perfect: 0.85, poor: 0, readOut: 1, tactic: 1, err: 0.35, backhand: 0.55 },
];
const dOf = a => DIFF[a.human ? 3 : settings.diff];
// 舊版教學會把難度鎖成「簡單」，升級時改回普通
if (settings.v !== 2) { if (settings.diff === 0) settings.diff = 1; settings.v = 2; saveSettings(); }
const HUMAN = { speed: 4.2, react: 0.18 }; // 你的球員：對手擊球後先墊步 0.18 秒才起動
const ACC = 13; // 加速度 m/s²
const DIFF_ = [
];
const QUAL = { perfect: '完美', good: '不錯', poor: '勉強' };

// ---------------- 畫面 ----------------
const frame = $('#frame');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
frame.prepend(renderer.domElement);
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0045, defaultColor: [0, 0, 0] });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1e7d6);
scene.fog = new THREE.Fog(0xf1e7d6, 20, 45);
const camera = new THREE.PerspectiveCamera(58, 9 / 16, 0.1, 100);
const swipeCv = $('#swipe'), sctx = swipeCv.getContext('2d');

function layout() {
  const vw = innerWidth, vh = innerHeight;
  let w, h;
  if (vw / vh < 0.75) { w = vw; h = vh; } else { h = vh; w = Math.round(vh * 9 / 16); }
  frame.style.width = w + 'px'; frame.style.height = h + 'px';
  renderer.setSize(w, h, false);
  const dpr = Math.min(devicePixelRatio, 2);
  swipeCv.width = w * dpr; swipeCv.height = h * dpr; sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 固定水平視角，讓不同長寬比的手機都看得到整個寬度
  const hfov = 2 * Math.atan(Math.tan((58 * Math.PI / 180) / 2) * 9 / 16);
  camera.aspect = w / h;
  camera.fov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI;
  camera.updateProjectionMatrix();
}
addEventListener('resize', layout);
layout();

function grad(steps) {
  const t = new THREE.DataTexture(new Uint8Array(steps.map(v => Math.round(v * 255))), steps.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
const G3 = grad([0.35, 0.7, 1]);
const toon = c => new THREE.MeshToonMaterial({ color: c, gradientMap: G3 });
const noOutline = m => { m.userData.outlineParameters = { visible: false }; return m; };

scene.add(new THREE.HemisphereLight(0xffffff, 0x806040, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 12, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 9, bottom: -9, near: 1, far: 30 });
scene.add(sun);

(function buildCourt() {
  const court = new THREE.Mesh(new THREE.PlaneGeometry(7.1, 14.6), noOutline(toon(0x3f9e74)));
  court.rotation.x = -Math.PI / 2; court.position.y = 0.005; court.receiveShadow = true; scene.add(court);
  const lm = noOutline(new THREE.MeshBasicMaterial({ color: 0xffffff })), W = 0.05;
  const line = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1) + W;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 === x2 ? W : len, x1 === x2 ? len : W), lm);
    m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2); scene.add(m);
  };
  const X = 3.05, Xs = 2.59, Z = 6.7;
  line(-X, -Z, X, -Z); line(-X, Z, X, Z); line(-X, -Z, -X, Z); line(X, -Z, X, Z);
  line(-Xs, -Z, -Xs, Z); line(Xs, -Z, Xs, Z);
  for (const s of [-1, 1]) { line(-X, s * 1.98, X, s * 1.98); line(-X, s * 5.94, X, s * 5.94); line(0, s * 1.98, 0, s * Z); }
  const pm = noOutline(toon(0x333333));
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 12), pm);
    p.position.set(s * 3.1, 0.775, 0); p.castShadow = true; scene.add(p);
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d'); cx.strokeStyle = 'rgba(20,20,20,0.85)'; cx.lineWidth = 3;
  cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(64, 0); cx.moveTo(0, 0); cx.lineTo(0, 64); cx.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(80, 10);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 0.76),
    noOutline(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
  net.position.set(0, NET_H - 0.38, 0); scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.075, 0.012), noOutline(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  tape.position.set(0, NET_H - 0.02, 0); scene.add(tape);
})();
const arena = buildArena(scene, toon);
let crowdCheer = 0; // 觀眾歡呼的程度（0～1，慢慢退）

// 球拍（真實尺寸，整支再乘 0.9）：握把約 2.6 cm 粗、拍桿 7 mm、拍框寬 8 mm、拍面 22×28 cm、看得到拍線
function makeRacket() {
  const g = new THREE.Group();
  const mat = c => noOutline(toon(c)); // 不加描邊（描邊會讓細的拍框看起來很粗）
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0135, 0.2, 10), mat(0x8a2c2c)); grip.position.y = 0.1; g.add(grip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10), mat(0x1c1c1c)); cap.position.y = 0.006; g.add(cap);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0045, 0.27, 6), mat(0x1c1c1c)); shaft.position.y = 0.335; g.add(shaft);
  const hy = 0.61, a = 0.112, b = 0.142; // 拍面中心、半寬、半長
  const fr = new THREE.Mesh(new THREE.TorusGeometry(1, 0.0042 / a, 6, 48), mat(0x1c1c1c)); fr.scale.set(a, b, a); fr.position.y = hy; g.add(fr);
  // T 頭（拍框和拍桿接起來的地方）
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.05, 6), mat(0x1c1c1c)); throat.position.y = hy - b - 0.015; g.add(throat);
  // 拍線：縱橫交錯的細線
  const pts = [];
  for (let i = -10; i <= 10; i++) { const x = i / 10.5 * a, h = b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2)); pts.push(x, hy - h, 0, x, hy + h, 0); }
  for (let j = -12; j <= 12; j++) { const y = j / 12.5 * b, w = a * Math.sqrt(Math.max(0, 1 - (y / b) ** 2)); pts.push(-w, hy + y, 0, w, hy + y, 0); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.75 })));
  return g;
}

function makePlayerMesh(shirt, shorts) {
  const g = new THREE.Group(), seg = 18, skin = 0xf1c7a3;
  const legH = 0.85, torsoH = 0.62, headR = 0.13, armL = 0.6;
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, legH, seg), toon(skin)); leg.position.set(sx, legH / 2, 0); g.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.26), toon(0xf5f5f5)); shoe.position.set(sx, 0.04, -0.04); g.add(shoe);
  }
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.22, seg), toon(shorts)); sh.position.y = legH + 0.04; g.add(sh);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, torsoH - 0.2, 4, seg), toon(shirt)); torso.position.y = legH + torsoH / 2 + 0.08; g.add(torso);
  const neckY = legH + torsoH + 0.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 22, 18), toon(skin)); head.position.y = neckY + headR * 0.9; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.07, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), toon(0x2b1d14));
  hair.position.copy(head.position); hair.rotation.x = 0.25; g.add(hair);
  const shY = neckY - 0.06;
  const aL = new THREE.Group(); aL.position.set(-0.25, shY, 0);
  const al = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, armL, seg), toon(skin)); al.position.y = -armL / 2; aL.add(al);
  aL.rotation.set(-0.7, 0, -0.5); g.add(aL);
  const aR = new THREE.Group(); aR.position.set(0.25, shY, 0);
  const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, armL, seg), toon(skin)); ar.position.y = armL / 2; aR.add(ar);
  const rk = makeRacket(); rk.position.y = armL; aR.add(rk);
  aR.rotation.z = -0.25; g.add(aR);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.aR = aR;
  return g;
}

// 羽毛球（真實尺寸 × 1.5 讓手機看得清楚）：+z＝球頭方向。球頭直徑 2.6 cm；羽毛 16 根、長 6.6 cm、尾端張開 6.4 cm
function makeShuttleMesh() {
  const g = new THREE.Group();
  const rc = 0.013;
  const cork = new THREE.Mesh(new THREE.SphereGeometry(rc, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xf6f1e6));
  cork.rotation.x = Math.PI / 2; cork.position.z = 0.0; g.add(cork);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(rc, rc * 0.98, 0.009, 16, 1, true), noOutline(toon(0x2d5fa8))); // 球頭的色帶
  band.rotation.x = Math.PI / 2; band.position.z = -0.0045; g.add(band);
  const base = new THREE.Mesh(new THREE.CircleGeometry(rc * 0.98, 16), noOutline(new THREE.MeshLambertMaterial({ color: 0xe8e1d0, side: THREE.DoubleSide })));
  base.position.z = -0.009; g.add(base);
  // 16 根羽毛：從球頭邊緣往後張開，每根之間留一點縫
  const N = 16, z0 = -0.008, z1 = -0.074, r0 = rc * 0.95, r1 = 0.032, pos = [], rib = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, w0 = (Math.PI * 2 / N) * 0.34, w1 = (Math.PI * 2 / N) * 0.42;
    const P = (r, ang, z) => [Math.cos(ang) * r, Math.sin(ang) * r, z];
    const A = P(r0, a - w0, z0), B = P(r0, a + w0, z0), C = P(r1, a + w1, z1), D = P(r1, a - w1, z1), E = P(r1 * 1.02, a, z1 - 0.004); // E：羽毛尾端圓弧的尖
    pos.push(...A, ...B, ...C, ...A, ...C, ...D, ...D, ...C, ...E);
    rib.push(...P(r0, a, z0), ...P(r1 * 1.01, a, z1 - 0.003)); // 羽軸
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.computeVertexNormals();
  g.add(new THREE.Mesh(fg, noOutline(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.96 }))));
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rib, 3));
  g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xcfcac0 })));
  // 兩圈綁羽毛的線
  for (const [z, c] of [[-0.024, 0x6a7f9a], [-0.036, 0x6a7f9a]]) {
    const t = (z - z0) / (z1 - z0), r = r0 + (r1 - r0) * t;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0007, 4, 32), noOutline(toon(c))); ring.position.z = z; g.add(ring);
  }
  g.scale.setScalar(1.5);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------- 遊戲狀態 ----------------
function makeActor(side, human, shirt, shorts) {
  const mesh = makePlayerMesh(shirt, shorts);
  if (side < 0) mesh.rotation.y = Math.PI;
  scene.add(mesh);
  return { side, human, mesh, pos: { x: 0, z: side * 3.6 }, base: { x: 0, z: side * 3.6 },
            plan: null, swingT: -9, low: false, reactAt: 0, letGo: false, coolUntil: 0, charge: 0,
           vel: { x: 0, z: 0 }, splitT: -9, stand: null, anim: {} };
}
const me = makeActor(1, true, 0xd8572a, 0x2a2a2a);
const cpu = makeActor(-1, false, 0x2a6fd8, 0xf0f0f0);
const mate = makeActor(1, false, 0x2aa36a, 0x2a2a2a); mate.isMate = true; // 雙打：你的電腦隊友
const cpu2 = makeActor(-1, false, 0x8a4fd8, 0xf0f0f0);                       // 雙打：第二個電腦
const actors = [me, cpu];
const dbl = () => settings.mode === 2 && !lesson;
const mateOf = a => actors.find(b => b !== a && b.side === a.side) || null;
const oppsOf = a => actors.filter(b => b.side !== a.side);
const other = a => oppsOf(a)[0];
// 單打／雙打切換：換球員名單、顯示或藏起隊友和第二個電腦
function applyMode() {
  actors.length = 0;
  if (dbl()) actors.push(me, mate, cpu, cpu2); else actors.push(me, cpu);
  for (const a of [mate, cpu2]) {
    const on = actors.includes(a);
    if (a.rig) a.rig.root.visible = on; else a.mesh.visible = on;
    if (!on) { a.plan = null; a.fw = null; }
  }
  if (dbl()) loadDoublesRigs();
}
const auto = a => !a.human || settings.demo;
const kindOf = y => (y >= 2.0 ? 'over' : y >= 1.0 ? 'side' : 'under');
// 角色：自己＝models/player.vrm（私人手機版嵌在 model_data.js）；對手＝設定選的 CC0 角色（VRoid 官方 β 版範本，CC0），沒有檔案就跟自己同一個
const OPP_MODELS = ['models/cc0_D.vrm', 'models/cc0_E.vrm', 'models/cc0_F.vrm', 'models/cc0_G.vrm'];
let playerURL = 'models/player.vrm';
// 角色編號：0＝自己捏的貓耳浴衣、1～4＝CC0 角色（渋、ビビ、ヴィータ、ヴィクトリア）
const charURL = id => (id > 0 ? OPP_MODELS[id - 1] : playerURL);
async function putRig(a, url) {
  const token = a.rigToken = (a.rigToken || 0) + 1; // 連續換角色時，只用最後一次選的
  const vrm = await loadVRM(url);
  if (token !== a.rigToken) return;
  const rig = new Rig(vrm, makeRacket(), a.side > 0 ? -1 : 1);
  if (a.rig) scene.remove(a.rig.root);
  scene.add(rig.root); a.mesh.visible = false; a.rig = rig; a.rigURL = url;
  if (a === mate || a === cpu2) rig.root.visible = actors.includes(a);
}
async function loadMe() {
  try { await putRig(me, charURL(settings.me || 0)); }
  catch (e) { try { await putRig(me, playerURL); } catch (e2) { console.error('角色載入失敗，先用方塊人', e2); } }
}
// 雙打的隊友和第二個電腦：用你和對手沒用到的角色（第一次切到雙打才下載；換角色後會重選）
let doublesLoading = false, doublesAgain = false;
async function loadDoublesRigs() {
  if (doublesLoading) { doublesAgain = true; return; } doublesLoading = true;
  const used = [settings.me || 0, (settings.opp || 0) + 1];
  const free = [1, 2, 3, 4, 0].filter(id => !used.includes(id));
  for (const [a, id] of [[mate, free[0]], [cpu2, free[1]]]) {
    if (a.rig && a.rigURL === charURL(id)) continue;
    try { await putRig(a, charURL(id)); } catch (e) { try { await putRig(a, playerURL); } catch (e2) {} }
  }
  doublesLoading = false;
  if (doublesAgain) { doublesAgain = false; if (dbl()) loadDoublesRigs(); }
}
async function loadOpponent() {
  try { await putRig(cpu, OPP_MODELS[settings.opp || 0]); }
  catch (e) { try { await putRig(cpu, playerURL); } catch (e2) { console.error('對手角色載入失敗', e2); } }
}
(async () => {
  try {
  } catch (e) {}
  await loadMe();
  await loadOpponent();
})();

const shuttleMesh = makeShuttleMesh(); scene.add(shuttleMesh);
const shuttleTmp = new THREE.Object3D(); // 算羽毛球轉向用
const shuttle = { p: { x: 0, y: 1, z: 3 }, v: { x: 0, y: 0, z: 0 }, held: true, lastHitter: null, tumble: false, netFault: false, serve: false };

const TRAIL = 30, trailPos = new Float32Array(TRAIL * 3), trailHist = [];
const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
trail.frustumCulled = false; scene.add(trail);

// 擊球提示：地上的落點圈＋會縮小的時機圈
const ringMat = c => noOutline(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
const groundMark = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), ringMat(0xffd84d));
groundMark.rotation.x = -Math.PI / 2; groundMark.renderOrder = 5; scene.add(groundMark);
const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.28, 40), ringMat(0xffffff));
const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.31, 40), ringMat(0xffd84d));
innerRing.renderOrder = outerRing.renderOrder = 6;
scene.add(innerRing, outerRing);

let phase = 'serve', simT = 0, phaseT = 0, server = 0, pending = null, hitStop = 0, shake = 0;
let serverActor = me, receiverActor = cpu; // 發球員、接發球員（單打＝兩人；雙打＝四人中的兩個）
const rightCourt = { 1: me, '-1': cpu };   // 雙打：每隊誰站右區（自己面向網的右邊）
const sideIdx = s => (s === me.side ? 0 : 1);
const scores = [0, 0];

// 球相對於球員：lat＞0＝在右邊（正手），fwd＞0＝在前方（靠網）
function relOf(a, p) { return { lat: (p.x - a.pos.x) * a.side, fwd: (a.pos.z - p.z) * a.side }; }
// 打得到的距離跟高度有關：頭上要站到球下面；腰部手伸出去；低球可以跨步
function reachR(y) { return y >= 2.2 ? 0.95 : y >= 1.0 ? 1.25 : 1.6; }
function reachOf(a, p) {
  const fast = Math.hypot(shuttle.v.x, shuttle.v.y, shuttle.v.z) > 15 && p.y < 2.2; // 接殺：重心壓低、跨一步伸拍，左右搆得比較遠
  const killable = !fast && p.y > 1.55 && p.y < 3.0 && Math.abs(p.z) < 2.3; // 網前比網高：右腳往前跨一步撲，搆得比較遠
  const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z), R = reachR(p.y) + (fast ? 0.45 : 0) + (killable ? 0.5 : 0), r = relOf(a, p);
  return { d, R, ok: d <= R && p.y <= TOP && p.y >= 0.08, ...r };
}
// 揮拍種類：看球在身體哪一邊、多高
function strokeOf(a, p) {
  const { lat } = relOf(a, p);
  if (p.y >= 2.2) return lat >= -0.15 ? 'over' : lat >= -0.6 ? 'rth' : 'bover';
  if (p.y < 1.7 && Math.abs(p.z) < 2.8) return lat >= 0 ? 'net' : 'bnet'; // 網前
  if (p.y >= 1.0) return lat >= 0 ? 'side' : 'bside';
  return lat >= 0 ? 'under' : 'bunder';
}
// 要站哪裡：球在右邊用正手、在左邊用反手（選比較近的）；頭上的球盡量用正手或頭頂
function standFor(a, c) {
  if (c.y > 1.55 && c.y < 2.95 && Math.abs(c.z) < 2.3 && c.kind === 'mid') { // 撲球：往球的方向衝一步、拍子伸出去搆得到就好（不用跑到球下面）
    const dx = a.pos.x - c.x, dz = a.pos.z - c.z, d = Math.hypot(dx, dz) || 1, keep = Math.min(d, 0.95);
    const latNow = (c.x - a.pos.x) * a.side, lat = latNow < -0.6 ? -0.35 : 0.3; // 球在正前方或右邊：讓球在拿拍手那側（正手撲）；明顯在左邊才反手
    return { x: c.x + dx / d * keep * 0.85 - lat * a.side * 0.9, z: c.z + dz / d * keep, lat };
  }
  const s = a.side, over = c.y >= 2.2, low = !over && (c.y < 1.0 || (c.y < 1.7 && Math.abs(c.z) < 2.8));
  const fwd = over ? 0.2 : low ? 0.7 : 0.35;
  const mk = lat => ({ x: clamp(c.x - lat * s, -3.6, 3.6), z: clamp(c.z + fwd * s, -7.6, 7.6), lat });
  const F = mk(over ? 0.3 : low ? 0.45 : 0.55), B = mk(low ? -0.45 : -0.55);
  const dF = Math.hypot(F.x - a.pos.x, F.z - a.pos.z), dB = Math.hypot(B.x - a.pos.x, B.z - a.pos.z);
  // 來得及嗎：起動 0.2 秒＋平均約 3 m/s
  const tAvail = c.t !== undefined ? c.t - simT : 9, can = d => 0.2 + d / 3.0 <= tAvail;
  if (over) {
    const R = mk(-0.35), dR = Math.hypot(R.x - a.pos.x, R.z - a.pos.z), Bo = mk(-0.85);
    if (dF <= dB + 0.6 && can(dF)) return F;      // 跑得到：正手
    if (dR <= dB + 0.6 && can(dR)) return R;      // 偏左一點：頭頂
    return Bo;                                    // 來不及繞過去：反手頭頂（背對網）
  }
  if (can(dF) && dF <= dB + 0.4) return F;
  return can(dB) || dB < dF ? B : F;
}

function setupServe() {
  phase = 'serve'; rallyHits = 0;
  if (!dbl()) {
    serverActor = actors[server]; receiverActor = other(serverActor);
    const s = serverActor, r = receiverActor, even = scores[server] % 2 === 0;
    s.pos = { x: (even ? 1 : -1) * s.side * 1.0, z: s.side * 2.5 };
    r.pos = { x: (even ? 1 : -1) * r.side * 1.0, z: r.side * 3.0 };
  } else {
    // 發球員一定站在跟分數單雙對應的區：雙數＝右區
    const s = serverActor, ss = s.side, even = scores[sideIdx(ss)] % 2 === 0;
    rightCourt[ss] = even ? s : mateOf(s);
    const rs = -ss, r = even ? rightCourt[rs] : mateOf(rightCourt[rs]);
    receiverActor = r;
    const cx = a => (rightCourt[a.side] === a ? 1 : -1) * a.side; // 右區的 x 方向
    s.pos = { x: cx(s) * 0.9, z: ss * 2.3 };             // 發球員：靠前發球線
    mateOf(s).pos = { x: cx(mateOf(s)) * 0.6, z: ss * 4.0 }; // 發球員的隊友：站後面
    r.pos = { x: cx(r) * 0.9, z: rs * 2.5 };             // 接發球員：對角、靠前
    mateOf(r).pos = { x: cx(mateOf(r)) * 1.0, z: rs * 3.8 };
  }
  const s = serverActor;
  for (const a of actors) { a.base = { ...a.pos }; a.plan = null; a.letGo = false; a.vel = { x: 0, z: 0 }; a.stand = null; a.fw = null; }
  s.serveType = s.human && !settings.demo ? 'sserve' : Math.random() < 0.55 ? 'sserve' : 'lserve';
  Object.assign(shuttle, { held: true, lastHitter: null, tumble: false, netFault: false, serve: false, bounces: 0, restT: 0, spin: 0 });
  trailHist.length = 0;
  phaseT = simT + 1.2;
  $('#banner').textContent = '';
  if (!lesson && !settings.demo && scores[0] + scores[1] === 0) $('#ailabel').textContent = persLabel();
  updateScore();
  setHint();
}

function holdShuttle() {
  const s = serverActor;
  shuttle.p = { x: s.pos.x + 0.3 * s.side, y: 1.0, z: s.pos.z - 0.25 * s.side };
  shuttle.v = { x: 0, y: 0, z: 0 };
}

// ---------- 雙打 ----------
// 誰接：發球一定是接發球員；其他球兩人都算一次，看誰「到得了、離得近」，差不多時讓玩家打（你是來打球的）
function pickReceiver(hitter, pts, serve) {
  const team = oppsOf(hitter);
  if (team.length === 1) return team[0];
  if (serve) return receiverActor;
  let best = null, bestC = Infinity;
  for (const b of team) {
    const pl = predictContact(pts, b.side, simT, b.pos, auto(b) ? dOf(b).react : HUMAN.react);
    const st = standFor(b, pl), d = Math.hypot(st.x - b.pos.x, st.z - b.pos.z);
    const c = d - Math.max(0, pl.t - simT) * 3.2 - (b === me && !settings.demo ? 0.35 : 0);
    if (c < bestC) { bestC = c; best = b; }
  }
  return best;
}
// 站位：自己隊打進攻球（殺、吊、放網、平抽、推）→ 前後站；打高球（高遠、挑）→ 左右站。接球的人去接，另一個補位
const ATTACK_SHOTS = new Set(['smash', 'jumpsmash', 'slicesmash', 'stick', 'kill', 'fastdrop', 'slowdrop', 'slicedrop', 'drive', 'push', 'net', 'spin', 'cross', 'block', 'sserve', 'fserve']);
function doublesPositions(hitter, key, receiver) {
  const s = hitter.side, m = mateOf(hitter);
  if (m) {
    if (ATTACK_SHOTS.has(key)) { // 前後站：打的人在後場就留後面，隊友上網；打的人在前面就封網，隊友補後場
      const back = Math.abs(hitter.pos.z) >= 2.8;
      hitter.base = { x: clamp(hitter.pos.x * 0.4, -1.2, 1.2), z: s * (back ? 4.2 : 1.9) };
      m.base = { x: clamp(-hitter.pos.x * 0.3, -1, 1), z: s * (back ? 1.9 : 4.2) };
    } else { // 左右站：各守一半
      const hs = Math.sign(hitter.pos.x || 1);
      hitter.base = { x: hs * 1.3, z: s * 3.4 }; m.base = { x: -hs * 1.3, z: s * 3.4 };
    }
    if (!m.plan) { m.letGo = false; m.fw = planRecover(m, m.base, simT + 0.1, false); if (m.fw) m.fw.recover = false; }
    if (!(lesson && hitter === cpu)) hitter.fw = planRecover(hitter, hitter.base, simT + (key === 'jumpsmash' ? 0.4 : 0.1), hitter.lunge);
  }
  // 接球方：沒接的那個人補位（接的人在後場 → 補前面；在前面 → 補後場；中場 → 補另一邊）
  const rm = mateOf(receiver);
  if (rm && receiver.plan) {
    const pz = Math.abs(receiver.plan.z), rs = receiver.side;
    rm.base = pz > 3.6 ? { x: clamp(-receiver.plan.x * 0.3, -1, 1), z: rs * 2.0 }
      : pz < 2.2 ? { x: 0, z: rs * 4.2 } : { x: -Math.sign(receiver.plan.x || 1) * 1.3, z: rs * 3.3 };
    rm.plan = null; rm.letGo = true;
    rm.fw = planRecover(rm, rm.base, simT + (auto(rm) ? dOf(rm).react : HUMAN.react), false); if (rm.fw) rm.fw.recover = false;
  }
}
// 電腦看對手：單打＝那一個人；雙打＝兩人位置綜合（平均位置、誰在前誰在後）
function oppView(a) {
  const os = oppsOf(a);
  if (os.length === 1) return os[0];
  const [p, q] = os;
  return { pos: { x: (p.pos.x + q.pos.x) / 2, z: (p.pos.z + q.pos.z) / 2 }, vel: { x: Math.max(Math.abs(p.vel.x), Math.abs(q.vel.x)), z: Math.max(Math.abs(p.vel.z), Math.abs(q.vel.z)) }, recoverUntil: Math.max(p.recoverUntil || 0, q.recoverUntil || 0), side: p.side };
}
const halfW = () => (dbl() ? 3.05 : COURT.halfW);          // 雙打邊線比較寬
const serveLong = () => (dbl() ? COURT.halfL - 0.76 : COURT.halfL); // 雙打發球不能超過雙打後發球線

// 界內：單打邊線、底線；發球還要過前發球線、落在對角的發球區（serveX＝發球的人站的 x；中線壓線算界內）
function inBounds(x, z, side, serve, serveX) {
  if (!(Math.abs(x) <= halfW() && Math.abs(z) <= COURT.halfL && z * side > 0)) return false;
  if (!serve) return true;
  return Math.abs(z) >= COURT.shortLine && Math.abs(z) <= serveLong() && (serveX === undefined || x * Math.sign(serveX || 1) <= 0.02);
}

function hit(a, key, o) {
  const spec = SHOTS[key];
  let opp = other(a);
  let depth = spec.depth[0] + (spec.depth[1] - spec.depth[0]) * (o.depthFrac ?? 0.5);
  let tx = o.tx ?? clamp(o.aimX ?? 0, -1, 1) * 2.2;
  if (key === 'kill' && a === me && !settings.demo && o.tx === undefined) { // 玩家撲球：直直滑＝從擊球點直直往前壓（不是往球場中間斜飛）；稍微歪一點不算斜滑
    const ax = Math.abs(o.aimX || 0) < 0.3 ? 0 : (o.aimX - Math.sign(o.aimX) * 0.3) / 0.7;
    tx = clamp(shuttle.p.x + ax * 1.6, -halfW() + 0.3, halfW() - 0.3);
  }
  else if (a === me && !settings.demo && o.tx === undefined && !o.tap && !spec.serve) { // 玩家：滑的方向＝球飛的方向（以擊球點為準，直直滑＝直直打，不是打向對面中間）
    const ax = Math.abs(o.aimX || 0) < 0.15 ? 0 : (o.aimX - Math.sign(o.aimX) * 0.15) / 0.85; // 稍微歪一點不算斜滑
    const travel = Math.abs(-a.side * depth - shuttle.p.z);                                  // 球要飛的前後距離：越遠，同樣的角度橫移越多
    tx = clamp(shuttle.p.x + ax * travel * 0.32, -halfW() + 0.3, halfW() - 0.3);
  }
  if (spec.cross) tx = (Math.sign(o.aimX || 1)) * 2.0;
  if (spec.slice) tx += clamp(o.curve ?? 0, -0.5, 0.5) * 2;
  if (o.noPull) depth -= 1.8; // 沒拉拍：打不深
  if (o.backhand && !spec.serve) depth -= key === 'clear' ? 1.2 : 0.3; // 反手頭頂高遠不容易打深（反手下手挑球照樣挑得到底）
  const err = ({ perfect: 0.08, good: 0.4, poor: 1.0 }[o.quality || 'good'] + (o.backhand ? 0.15 : 0)) * (o.errK ?? 1) * (1 + 0.8 * tiredOf(a));
  if (o.safe) { const m = err * o.safe; tx = clamp(tx, -halfW() + m, halfW() - m); if (!spec.serve) depth = Math.min(depth, COURT.halfL - m); else depth = clamp(depth, COURT.shortLine + m, serveLong() - m); } // 電腦發短球：瞄前發球線後面一點 // 電腦：瞄準線內留邊界
  const ang = Math.random() * Math.PI * 2, rr = err * Math.sqrt(Math.random());
  tx += Math.cos(ang) * rr; depth = Math.max(0.15, depth + Math.sin(ang) * rr);
  const tired = tiredOf(a);
  let power = (o.power ?? 0.6) * (o.quality === 'poor' ? 0.8 : o.quality === 'good' ? 0.93 : 1) * (o.backhand ? 0.75 : 1) * (1 - 0.18 * tired);
  if (spec.big && key !== 'kill' && !spec.jump && o.y !== undefined) power *= clamp((o.y - 2.0) / 1.0, 0.6, 1); // 擊球點越高殺越快
  let sp2 = spec;
  if (spec.tight && !spec.serve) sp2 = { ...spec, margin: { perfect: 0.05, good: 0.2, poor: 0.4 }[o.quality || 'good'] }; // 小球貼不貼網看擊球品質：不夠好就冒高，對手可以搶網
  if (key === 'lift') { // 挑球：越遠角度越低，最高點大約固定 4.3 m（不會越挑越高）
    const dist = Math.hypot(tx - shuttle.p.x, -a.side * depth - shuttle.p.z);
    let ang = clamp(51 - (dist - 6.8) * 4.8, 38, 51);
    if (shuttle.p.y > 1.0) ang = Math.min(ang, 51 - (shuttle.p.y - 1.0) * 30); // 高點挑：又平又快（進攻挑），過不了網會自己往上調
    sp2 = { ...spec, angle: ang };
  }
  let res = planShot({ ...shuttle.p }, tx, -a.side * depth, sp2, clamp(power, 0, 1));
  if (spec.tight && !spec.serve && shuttle.p.y < 1.5) { // 網前小球：從很低、很貼網的地方放，算出來會變成高球 → 落點縮短，最高不超過 2.4 m（頭頂的吊球不適用）
    const apexOf = r => r.sim.pts.reduce((m, q) => Math.max(m, q.y), 0);
    if (apexOf(res) > 2.4) { // 太高（會變成沖天球）：試「貼網一點」和不同落點，挑過得了網、最低的那一個
      let best = res, bestA = apexOf(res);
      for (const mg of [sp2.margin ?? 0.05, 0.05]) for (const dd of [depth, depth + 0.4, depth + 0.8, depth - 0.2, 0.3]) {
        if (dd < 0.15) continue;
        const r = planShot({ ...shuttle.p }, tx, -a.side * dd, { ...sp2, margin: mg }, clamp(power, 0, 1)), ap = apexOf(r);
        if (r.sim.netY !== null && r.sim.netY > NET_H && ap < bestA) { best = r; bestA = ap; }
      }
      res = best;
    }
  }
  if (key === 'lift') { // 貼網挑球要很陡才過得了網：最高不超過 5 m，太高就讓球落淺一點
    const apex = r => r.sim.pts.reduce((m, q) => Math.max(m, q.y), 0);
    for (let i = 0; i < 6 && apex(res) > 7 && depth > 5.6; i++) { depth -= 0.3; res = planShot({ ...shuttle.p }, tx, -a.side * depth, sp2, clamp(power, 0, 1)); }
    for (let i = 0; i < 20 && apex(res) > 7; i++) { // 還是太高（太貼網、太低才挑）：出手速度一點一點壓下來，變成比較短的挑球
      const v = { x: res.v.x * 0.93, y: res.v.y * 0.93, z: res.v.z * 0.93 };
      res = { v, sim: simulate({ ...shuttle.p }, v) };
    }
  }
  shuttle.v = { ...res.v };
  Object.assign(shuttle, { held: false, lastHitter: a, tumble: !!spec.tumble, serve: !!spec.serve, serveX: a.pos.x, netFault: false, bounces: 0, restT: 0, spin: 0 });
  if (spec.jump) a.recoverUntil = simT + 0.45; // 跳殺落地要時間，回位比較慢
  a.plan = null; a.swingT = simT; a.low = shuttle.p.y < 1.6; a.swingKind = o.fancy || (spec.serve ? (key === 'sserve' || key === 'fserve' ? 'serveB' : 'serveF') : strokeOf(a, shuttle.p));
  a.lastKey = key;
  if (!ATTACK_KEYS.has(key)) a.jumpH = 0; // 不是殺球就不跳
  a.lunge = !spec.serve && shuttle.p.y < 2.2 && Math.hypot(shuttle.p.x - a.pos.x, shuttle.p.z - a.pos.z) > 0.8;
  a.lungeAt = relOf(a, shuttle.p);
  a.contactP = { x: shuttle.p.x, z: shuttle.p.z };
  if (key === 'lift' && ['net', 'bnet', 'under', 'bunder', 'side', 'bside'].includes(a.swingKind)) a.swingKind = a.swingKind[0] === 'b' ? 'blift' : 'lift'; // 挑球：專用動作（下手往上甩、收拍舉過頭）
  if (key === 'kill' && !o.fancy) { a.swingKind = relOf(a, shuttle.p).lat >= -0.15 ? 'kill' : 'bkill'; a.aimP = { ...shuttle.p }; } // 撲球：專用動作、手臂對準球
  const smartBase = !lesson && (!auto(a) || dOf(a).tactic > 0);
  const bz = !smartBase ? 3.4 : ['net', 'spin', 'cross', 'kill'].includes(key) ? 1.7 : ['smash', 'jumpsmash', 'slicesmash'].includes(key) ? 2.6 : ['block', 'slowdrop', 'slicedrop', 'stick', 'sserve'].includes(key) ? 2.4 : ['lift', 'clear', 'lserve', 'fserve'].includes(key) ? 3.8 : 3.4; // 放網後往前封網，對手回高就能撲
  a.base = { x: smartBase ? clamp(-shuttle.p.x * 0.15, -0.4, 0.4) : 0, z: a.side * bz }; a.coolUntil = simT + 0.25;
  // 打完回位：跨步的話先蹬回來；跳殺要等落地
  if (o.fancy === 'dive') { a.lunge = true; a.fw = null; a.recoverUntil = simT + 0.9; a.pendingRecover = simT + 0.9; } // 魚躍：趴 0.9 秒才起來
  else if (spec.jump && !(lesson && a === cpu)) { // 跳殺：空中往前帶、落地馬上衝上網（單打；雙打的殺球員留在後場，下面 doublesPositions 會改掉）
    a.base = { x: clamp(res.sim.land.x * 0.5, -1.2, 1.2), z: a.side * 2.2 }; // 往殺過去的那一邊上網（對手多半擋直線）
    a.fw = planJumpFollow(a, a.base, simT, Math.max(0.05, 0.32 - Math.max(0, simT - (a.jumpT ?? simT)))); a.recoverUntil = 0;
  }
  else if (!(lesson && a === cpu)) a.fw = planRecover(a, a.base, simT + (o.fancy ? 0.5 : a.lunge ? 0.14 : 0.06), a.lunge);
  if (dbl()) opp = pickReceiver(a, res.sim.pts, spec.serve);
  { const m = mateOf(a); if (m) { m.plan = null; } } // 自己隊友不用再打
  opp.plan = predictContact(res.sim.pts, opp.side, simT, opp.pos, auto(opp) ? dOf(opp).react : HUMAN.react);
  opp.letGo = false;
  opp.stand = standFor(opp, opp.plan); opp.splitT = simT;
  staminaHit(a, key, o);
  if (!auto(opp)) opp.reactAt = simT + HUMAN.react + (o.hold ? 0.15 : 0) + 0.1 * tiredOf(opp); // 對手停頓假動作：慢一拍；累了也慢
  if (lesson && opp === cpu) { opp.plan = null; opp.letGo = true; }
  else if (auto(opp)) {
    const D = dOf(opp);
    opp.reactAt = simT + D.react + (o.hold ? 0.3 : 0) + (spec.tumble ? 0.1 : 0) + 0.1 * tiredOf(opp);
    const out = !inBounds(res.sim.land.x, res.sim.land.z, opp.side, spec.serve, a.pos.x);
    opp.letGo = out && Math.random() < D.readOut;
    if (!opp.letGo) { opp.swingT = opp.plan.t; opp.low = opp.plan.kind !== 'high'; opp.jumpT = opp.plan.t; opp.jumpRise = 0.275; opp.swingKind = strokeOf({ pos: opp.stand, side: opp.side }, opp.plan); aiPreChoose(opp); opp.contactP = { x: opp.plan.x, z: opp.plan.z }; opp.lungeAt = relOf({ pos: opp.stand, side: opp.side }, opp.plan); opp.lunge = opp.plan.y < 2.2 && Math.hypot(opp.plan.x - opp.stand.x, opp.plan.z - opp.stand.z) > 0.8; }
  }
  if (opp.plan && !opp.letGo) planFootwork(opp);
  if (dbl()) doublesPositions(a, key, opp);
  phase = 'rally';
  const kmh = Math.round(Math.hypot(res.v.x, res.v.y, res.v.z) * 3.6);
  const feel = feelOf(key);
  sfx(key); hitFlash(shuttle.p, feel); rallyHits++;
  if (a.lunge) squeak(a, 0); if (spec.jump) squeak(a, 0.42); // 跨步、跳殺落地：球鞋摩擦聲
  if (kmh >= 300 && !lesson) roar(0.35, 380); // 很快的殺球：觀眾「喔～」
  hitStop = spec.jump ? 0.02 : feel === 'heavy' ? 0.045 : feel === 'solid' ? 0.02 : 0.006; // 擊球瞬間的停頓：重擊停一下、輕球幾乎不停
  shake = Math.max(shake, feel === 'heavy' ? (spec.jump ? 0.38 : 0.28) : feel === 'solid' ? 0.06 : 0);
  if (a === me) {
    const tags = [o.quality ? QUAL[o.quality] : '', o.noPull ? '沒拉拍' : '', Math.abs(o.curve || 0) > CURVE_MIN ? '弧線' : '', o.hold ? '停頓' : ''].filter(Boolean).join('・');
    const sp = styleHit(key, o);
    if (o.fancy || key === 'jumpsmash') fancyFX(o.fancy ? FANCY[o.fancy][0] : '跳殺', sp, !o.fancy); // 跳殺不放慢（球要直接衝過去）
    else popup(`${o.backhand && !spec.serve ? '反手' : o.rth ? '頭頂' : ''}${spec.name}`, `${tags}${spec.big || key === 'drive' ? `　${kmh} km/h` : ''}　+${sp}`, o.quality === 'perfect' ? '#ffd84d' : '#fff'); // 只有殺球、平抽這類攻擊球顯示球速
  } else {
    $('#ailabel').textContent = lesson ? `教練：${spec.name}` : `電腦：${o.backhand ? '反手' : ''}${spec.name}${spec.big || key === 'drive' ? `　${kmh} km/h` : ''}`;
  }
  if (a === me && lesson) lessonCheck(key, o, res.sim.land);
  setHint();
}

function aiServe(a) {
  const D = dOf(a), key = a.serveType || (Math.random() < D.tactic * 0.2 ? 'lserve' : 'sserve');
  hit(a, key, { tx: -Math.sign(a.pos.x) * rand(0.5, 2.0), depthFrac: key === 'sserve' ? rand(0, 0.5 + D.err * 0.5) : Math.random(), quality: 'good', errK: D.err, safe: 0.5 });
}

function aiChoose(a) {
  const y = shuttle.p.y, front = Math.abs(a.pos.z) < 2.6, r = Math.random();
  if (Math.abs(a.pos.z) < 2.2 && y > 1.55) return 'kill'; // 在網前、球比網高：撲
  if (y >= 2.0) {
    if (Math.abs(a.pos.z) > 5.6) return r < 0.6 ? 'clear' : r < 0.8 ? 'fastdrop' : 'slowdrop';
    return r < 0.12 ? 'jumpsmash' : r < 0.4 ? 'smash' : r < 0.5 ? 'stick' : r < 0.75 ? 'aclear' : 'fastdrop';
  }
  if (y >= 1.0) {
    if (front && y > 1.6) return 'kill';
    if (front) return r < 0.35 ? 'net' : r < 0.5 ? 'spin' : r < 0.75 ? 'push' : 'lift';
    return r < 0.45 ? 'drive' : r < 0.7 ? 'block' : 'lift';
  }
  if (front) return r < 0.4 ? 'net' : r < 0.55 ? 'spin' : r < 0.65 ? 'cross' : 'lift';
  return r < 0.6 ? 'lift' : 'block';
}

// 電腦個性：在戰術選好的球路上再加自己的習慣
const PERS = [null,
  { name: '全能型', desc: '什麼都打、很均衡' },
  { name: '進攻型', desc: '有機會就殺、愛跳殺' },
  { name: '防守型', desc: '高遠球拉底線、很穩' },
  { name: '網前型', desc: '愛放網、搓球、吊網前' },
  { name: '花招型', desc: '假動作、勾對角、劈殺劈吊' },
];
function pickPers() { cpu.pers = settings.pers > 0 ? settings.pers : 1 + Math.floor(Math.random() * 5); cpu2.pers = 1 + Math.floor(Math.random() * 5); mate.pers = 1; } // 雙打：第二個電腦隨機、隊友全能型
function persLabel() { const P = PERS[cpu.pers]; return P ? `對手：${P.name}（${P.desc}）` : ''; }
function personalize(a, t) {
  const p = a.pers || 1, y = shuttle.p.y, myD = Math.abs(a.pos.z), r = Math.random(), k = t.key;
  const deep = () => rand(0.65, 1), short = () => rand(0, 0.45);
  if (p === 2) { // 進攻型
    if (['clear', 'aclear', 'fastdrop', 'slowdrop'].includes(k) && y >= 2.2 && myD < 5.6 && r < 0.45) return { ...t, key: y > 2.5 && r < 0.18 ? 'jumpsmash' : 'smash', depthFrac: rand(0.3, 1) };
    if (k === 'smash' && y > 2.5 && myD < 5 && r < 0.3) return { ...t, key: 'jumpsmash' };
    if (k === 'lift' && myD < 2.6 && r < 0.4) return { ...t, key: 'push', depthFrac: deep() };
  } else if (p === 3) { // 防守型
    if (['smash', 'stick', 'jumpsmash'].includes(k) && r < 0.45) return { ...t, key: 'clear', depthFrac: deep() };
    if (['net', 'spin', 'cross'].includes(k) && r < 0.45) return { ...t, key: 'lift', depthFrac: deep() };
    return { ...t, errMul: 0.75 }; // 很穩：落點誤差小
  } else if (p === 4) { // 網前型
    if (['clear', 'aclear'].includes(k) && y >= 2.0 && r < 0.5) return { ...t, key: r < 0.25 ? 'slicedrop' : 'slowdrop', depthFrac: short() };
    if (['lift', 'push'].includes(k) && myD < 2.6 && y < 1.4 && r < 0.55) return { ...t, key: r < 0.25 ? 'spin' : 'net', depthFrac: short() };
  } else if (p === 5) { // 花招型
    const hold = r < 0.35;
    if (k === 'smash' && r < 0.5) return { ...t, key: 'slicesmash', hold, curve: rand(-0.4, 0.4) };
    if ((k === 'fastdrop' || k === 'slowdrop') && r < 0.55) return { ...t, key: 'slicedrop', hold, curve: rand(-0.4, 0.4) };
    if (k === 'net' && r < 0.45) return { ...t, key: 'cross', hold };
    return { ...t, hold };
  }
  return t;
}

// 戰術：看對手站哪裡，打空檔；對手在前就打後、在後就打前；有機會就殺
function aiTactic(a, D) {
  const o = oppView(a), y = shuttle.p.y, r = Math.random();
  const myD = Math.abs(a.pos.z), oD = Math.abs(o.pos.z); // 離網距離
  const open = -Math.sign(o.pos.x || rand(-1, 1)); // 對手不在的那一邊
  const offX = Math.abs(o.pos.x) > 0.7; // 對手被拉開了
  const late = simT < (o.recoverUntil || 0) || Math.hypot(o.vel.x, o.vel.z) > 2; // 對手還在跑／剛落地
  const side = k => open * rand(k, 1);
  const deep = () => rand(0.65, 1), short = () => rand(0, 0.45);
  if (myD < 2.2 && y > 1.55) return { key: 'kill', aimX: side(0.3), depthFrac: Math.random() }; // 在網前、球比網高：撲
  if (y >= 2.0) {
    if (myD > 5.6) { // 自己在底線：殺不痛，打高遠或吊
      if (oD < 3.0) return { key: r < 0.7 ? 'clear' : 'aclear', aimX: side(0.5), depthFrac: deep() };
      if (oD > 4.2) return { key: r < 0.55 ? 'fastdrop' : 'slowdrop', aimX: side(0.4), depthFrac: short() };
      return { key: r < 0.45 ? 'clear' : r < 0.75 ? 'fastdrop' : 'slowdrop', aimX: side(0.5), depthFrac: r < 0.45 ? deep() : short() };
    }
    const chance = (y > 2.4 ? 0.45 : 0.25) + (offX || late ? 0.3 : 0) + (myD < 4 ? 0.15 : 0);
    if (r < chance) {
      if (y > 2.5 && myD < 5 && Math.random() < 0.3 * D.tactic) return { key: 'jumpsmash', aimX: side(0.5), depthFrac: rand(0.3, 1) };
      if (oD > 4.3) return { key: 'stick', aimX: side(0.4), depthFrac: rand(0.2, 0.8) }; // 對手在後場：點殺到他前面
      return { key: 'smash', aimX: offX ? side(0.6) : (Math.random() < 0.4 ? o.pos.x / 2.2 : side(0.5)), depthFrac: rand(0.3, 1) };
    }
    if (oD < 3.0) return { key: r < 0.5 ? 'aclear' : 'clear', aimX: side(0.5), depthFrac: deep() };
    if (oD > 4.2) return { key: r < 0.6 ? 'fastdrop' : 'slowdrop', aimX: side(0.4), depthFrac: short() };
    return { key: r < 0.4 ? 'fastdrop' : r < 0.7 ? 'aclear' : 'slowdrop', aimX: side(0.5), depthFrac: Math.random() };
  }
  if (y >= 1.0) {
    if (myD < 2.6 && y > 1.55) return { key: 'kill', aimX: side(0.3), depthFrac: Math.random() };
    if (myD < 2.6) { // 網前搶到高點：對手在後就回放網／搓球，對手在前就推或挑後場
      if (oD > 3.6 || late) return { key: r < 0.35 ? 'spin' : r < 0.75 ? 'net' : 'cross', aimX: side(0.4), depthFrac: short() };
      return { key: r < 0.5 ? 'push' : 'lift', aimX: side(0.5), depthFrac: deep() };
    }
    if (oD < 2.8) return { key: r < 0.5 ? 'push' : 'drive', aimX: side(0.5), depthFrac: deep() };
    if (oD > 4.2) return { key: 'block', aimX: side(0.4), depthFrac: short() };
    return { key: r < 0.6 ? 'drive' : 'block', aimX: side(0.5), depthFrac: Math.random() };
  }
  if (myD < 2.6) { // 網前低球
    const tight = shuttle.p.y > 0.6 && Math.abs(shuttle.p.z) < 1.0; // 球還貼著網：可以搓、勾
    if (oD > 3.8 || (late && oD > 3.2)) return { key: tight && r < 0.4 ? 'spin' : r < 0.75 ? 'net' : 'cross', aimX: side(0.4), depthFrac: short() };
    if (oD < 3.0) return { key: 'lift', aimX: side(0.5), depthFrac: deep() };
    return { key: r < 0.5 ? 'net' : 'lift', aimX: side(0.5), depthFrac: r < 0.5 ? short() : deep() };
  }
  return { key: oD > 4.0 ? 'block' : 'lift', aimX: side(0.5), depthFrac: oD > 4.0 ? short() : deep() };
}

// 電腦在起動時就決定這球要打什麼（真人也是先想好）；起跳只給殺球，挑球用挑球動作
function aiPreChoose(a) {
  const D = dOf(a), c = a.plan, pos = a.stand || a.pos;
  const saved = { y: shuttle.p.y, x: shuttle.p.x, z: shuttle.p.z }, savedPos = { ...a.pos };
  shuttle.p.y = c.y; shuttle.p.x = c.x; shuttle.p.z = c.z; a.pos.x = pos.x; a.pos.z = pos.z; // 用預測的擊球點和站位來想
  try { a.preKey = !lesson && Math.random() < D.tactic ? personalize(a, aiTactic(a, D)).key : aiChoose(a); }
  finally { Object.assign(shuttle.p, saved); a.pos.x = savedPos.x; a.pos.z = savedPos.z; }
  if (Math.abs(c.z) < 0.6 && c.y < 0.9 && (a.preKey === 'lift' || a.preKey === 'push')) a.preKey = 'net'; // 貼網低球：放網
  a.jumpH = a.preKey === 'jumpsmash' ? 0.6 : ATTACK_KEYS.has(a.preKey) ? clamp((c.y - 2.6) * 0.8, 0, 0.4) : 0;
  if (a.preKey === 'lift' && ['net', 'bnet', 'under', 'bunder', 'side', 'bside'].includes(a.swingKind)) a.swingKind = a.swingKind[0] === 'b' ? 'blift' : 'lift';
  if (a.preKey === 'kill') { a.swingKind = relOf({ pos: a.stand || a.pos, side: a.side }, c).lat >= -0.15 ? 'kill' : 'bkill'; a.aimP = { x: c.x, y: c.y, z: c.z }; if (c.y > 2.3) { a.jumpH = clamp(c.y - 2.15, 0.12, 0.45); a.jumpRise = 0.2; } }
}
const SHORT_KEYS = new Set(['fastdrop', 'slowdrop', 'slicedrop', 'block', 'net', 'spin', 'cross', 'stick', 'kill']);

function aiTryHit(a) {
  a.plan = null;
  if (a.letGo || shuttle.lastHitter === a || (shuttle.lastHitter && shuttle.lastHitter.side === a.side)) return;
  const rc = reachOf(a, shuttle.p);
  if (!rc.ok) return; // 跑不到
  const D = dOf(a), r = Math.random();
  let quality = r < D.perfect ? 'perfect' : r < 1 - D.poor ? 'good' : 'poor';
  if (rc.d / rc.R > 0.8 && quality === 'perfect') quality = 'good';
  const opp = oppView(a);
  let aimX = D.tactic > 0 ? -Math.sign(opp.pos.x || rand(-1, 1)) * rand(0.45, 1) : rand(-0.8, 0.8);
  if (Math.random() < D.backhand) aimX = -opp.side * rand(0.7, 1); // 打對手的反手邊
  const stroke = strokeOf(a, shuttle.p);
  let t = !lesson && Math.random() < D.tactic ? aiTactic(a, D) : { key: aiChoose(a), aimX, depthFrac: Math.random() };
  const pk = a.preKey; a.preKey = null;
  const tightLow = Math.abs(shuttle.p.z) < 0.6 && shuttle.p.y < 0.9; // 球貼網又低：挑不深，改放網
  // 用起動時想好的球路（高度對得上才用），落點照現在對手的位置瞄
  if (pk && (SHOTS[pk].big && pk !== 'kill' ? shuttle.p.y >= 2.0 : true) && !(pk === 'kill' && shuttle.p.y < 1.0)) {
    const open = -Math.sign(opp.pos.x || rand(-1, 1));
    t = { key: pk, aimX: D.tactic > 0 ? open * rand(0.45, 1) : aimX, depthFrac: SHORT_KEYS.has(pk) ? rand(0, 0.45) : rand(0.55, 1) };
  }
  if (!lesson && !pk) t = personalize(a, t);
  if (tightLow && (t.key === 'lift' || t.key === 'push')) t = { ...t, key: Math.random() < 0.3 ? 'spin' : 'net', depthFrac: rand(0, 0.4) };
  const hold = t.hold ?? (a.pers === 5 && Math.random() < 0.3);
  hit(a, t.key, { aimX: t.aimX, depthFrac: t.depthFrac, power: rand(0.6 + D.tactic * 0.25, 1), quality, backhand: stroke[0] === 'b', rth: stroke === 'rth', errK: D.err * (t.errMul || (a.pers === 3 ? 0.75 : 1)), safe: D.tactic ? 0.6 : 0, hold, curve: t.curve });
}

function humanSwing(g) {
  if (simT < me.coolUntil) return;
  me.coolUntil = simT + 0.3;
  if (phase === 'serve' && serverActor === me && !settings.demo) {
    // 發球：往下滑＝短球（滑越長越深、斜滑選內外角）；點一下＝最短的貼線小球；往上滑＝高遠（快速一甩＝平快球）
    const sx = -Math.sign(me.pos.x || 1), short = g.dir === 'down' || g.type === 'tap';
    const key = short ? 'sserve' : (g.speedN || 0) > 3.2 ? 'fserve' : 'lserve';
    const tx = sx * clamp(1.3 + g.aimX * sx * 1.1, 0.25, 2.35); // 往右滑＝落點往右（發球一定要發到對角的發球區，所以只能在那一區裡左右調）
    const depthFrac = g.type === 'tap' ? 0 : short ? clamp(((g.lenN || 0) - 0.06) / 0.3, 0, 1) : g.depthFrac;
    hit(me, key, { tx, depthFrac, quality: 'good' });
    return;
  }
  me.swingT = simT + 0.05;
  me.low = shuttle.p.y < 1.6;
  me.swingKind = strokeOf(me, shuttle.p);
  me.contactP = { x: shuttle.p.x, z: shuttle.p.z };
  me.lungeAt = relOf(me, shuttle.p);
  me.lunge = shuttle.p.y < 2.2 && Math.hypot(shuttle.p.x - me.pos.x, shuttle.p.z - me.pos.z) > 0.8;
  // 起跳＝要殺球：先用手勢判斷會打出什麼球，不是殺球就不跳
  const y0 = shuttle.p.y, zone0 = y0 >= TOP_Y ? 'top' : y0 >= 2.2 ? 'high' : y0 >= 1.0 ? 'mid' : 'low';
  let k0 = classify(g, zone0, Math.abs(shuttle.p.z) < 2.6, y0);
  me.jumpH = ATTACK_KEYS.has(k0) ? clamp((y0 - 2.6) * 0.8, 0, 0.4) : 0;
  if (k0 === 'jumpsmash') me.jumpH = 0.75; // 跳殺
  const r0 = reachInfo();
  if (k0 === 'kill') me.swingKind = me.lungeAt.lat >= -0.15 ? 'kill' : 'bkill'; // 撲球動作
  const kp = me.plan && me.plan.kind === 'mid' && me.plan.y > 1.55 && Math.abs(me.plan.z) < 2.3 && shuttle.lastHitter !== me;
  let waitKill = 0;
  if (kp && g.dir === 'up' && !g.crouch) { // 撲球機會、提早往上滑：等球到撲球點再出手
    const early = me.plan.t - simT;
    if (early > 0.05 && early < 0.8) { waitKill = early; k0 = 'kill'; me.contactP = { x: me.plan.x, z: me.plan.z }; me.lungeAt = relOf(me, me.plan); me.swingKind = me.lungeAt.lat >= -0.15 ? 'kill' : 'bkill'; me.lunge = true; }
  }
  if (k0 === 'kill') me.aimP = waitKill ? { x: me.plan.x, y: me.plan.y, z: me.plan.z } : { ...shuttle.p }; // 手臂和拍子要對準的點
  const killJump = k0 === 'kill' && me.aimP && me.aimP.y > 2.3; // 高的撲球：往前小跳、在最高點撲
  if (g.dir === 'up' && g.crouch && k0 !== 'jumpsmash') { // 先下再上＝起跳＝要殺：不管球在哪都跳（球不在就揮空）
    k0 = 'jumpsmash'; me.jumpH = 0.6; me.swingKind = 'over';
  }
  // 起跳要時間：手指放開才蹬地，升到最高點時才擊球（跳殺 0.18 秒、一般殺球小跳 0.1 秒）
  if (killJump) me.jumpH = clamp(me.aimP.y - 2.15, 0.12, 0.45);
  const rise = killJump ? Math.max(0.15, waitKill) : me.jumpH > 0 ? (k0 === 'jumpsmash' ? 0.18 : 0.1) : 0.05;
  me.jumpRise = Math.max(0.05, rise); me.jumpT = simT + rise; me.swingT = simT + Math.max(rise, waitKill);
  pending = { t: simT + Math.max(0.05, rise, waitKill), g, k0 };
}

// 球在打得到的範圍內就能打；擊球那一刻球的高度決定是哪一類球
const REACH = 1.0, TOP = 3.4; // 3.4 m＝170 cm 選手跳起來打得到的高度
function reachInfo() {
  if (phase !== 'rally' || shuttle.lastHitter === me || (shuttle.lastHitter && shuttle.lastHitter.side === me.side) || shuttle.held || shuttle.p.z <= 0.02 || shuttle.netFault) return null;
  const y = shuttle.p.y, rc = reachOf(me, shuttle.p);
  return { dh: rc.d, R: rc.R, y, ok: rc.ok, lat: rc.lat, fwd: rc.fwd, zone: y >= TOP_Y ? 'top' : y >= 2.2 ? 'high' : y >= 1.0 ? 'mid' : 'low' };
}
const ATTACK_KEYS = new Set(['smash', 'jumpsmash', 'stick', 'slicesmash']);
const NOPULL_KEYS = new Set(['clear', 'lift', 'smash', 'stick', 'slicesmash']);
function humanTryHit(sw) {
  const r = reachInfo();
  if (!r) { popup('揮空', '球還沒過來', '#ddd'); return; }
  if (r.y > TOP + (me.jumpH || 0)) { popup('揮空', '球還太高，等它掉下來', '#ddd'); return; }
  if (r.y < 0.08) { popup('揮空', '球已經落地', '#ddd'); return; }
  // 花式：魚躍救球（比打得到的範圍再遠一點、而且是低球）
  let fancy = null;
  const jumped = sw.k0 === 'jumpsmash' && me.jumpH > 0.05; // 起跳了：一定是進攻球，不做花式救球
  if (r.dh > r.R) {
    if (!jumped && r.dh <= r.R + 0.9 && r.y < 1.4) fancy = 'dive';
    else { popup('揮空', '球離你太遠', '#ddd'); return; }
  }
  if (jumped) { /* 起跳中不觸發胯下、背後 */ }
  else if (!fancy && r.y < 0.75 && r.fwd < 0.05 && Math.abs(r.lat) < 0.45) fancy = 'tweener'; // 胯下球：很低、球已在身體正下方或身後
  else if (!fancy && r.lat < -0.2 && r.fwd < -0.05 && r.y > 0.6 && r.y < 1.9) fancy = 'behind'; // 背後接球：球跑到身後左側
  const q = Math.min(1, r.dh / r.R);
  let quality = q < 0.55 ? 'perfect' : q < 0.8 ? 'good' : 'poor';
  if (fancy) quality = fancy === 'dive' ? 'poor' : quality === 'perfect' ? 'good' : quality;
  if (r.zone !== 'low' && r.zone !== 'mid' && r.fwd < -0.35 && quality === 'perfect') quality = 'good'; // 球跑到身後：被壓了
  const stroke = strokeOf(me, shuttle.p);
  if (shuttle.tumble && quality === 'perfect') quality = 'good';
  let key = classify(sw.g, r.zone, Math.abs(shuttle.p.z) < 2.6, r.y); // 網前與否看球的位置（人可能還在跑）
  if (!fancy && ATTACK_KEYS.has(sw.k0) && me.jumpH > 0.05 && r.y >= 1.8) key = sw.k0; // 人在空中：照起跳時的殺球打
  if (jumped) key = r.y >= 1.5 ? 'jumpsmash' : 'drive'; // 起跳＝殺：球夠高就跳殺，太低就平快抽過去（絕不變挑球）
  if (!fancy && sw.k0 === 'kill' && r.y >= 1.3 && sw.g.dir === 'up') key = 'kill'; // 滑的那一刻球比網高＝撲球（不因為晚 0.05 秒變挑球）
  if (fancy) key = sw.g.dir === 'down' || sw.g.type === 'tap' ? (r.y < 1.0 ? 'net' : 'block') : 'lift'; // 花式只能救回去：放小球或挑高
  hit(me, key, { aimX: sw.g.aimX, tap: sw.g.type === 'tap', depthFrac: sw.g.depthFrac, power: sw.g.power, quality, hold: sw.g.hold,
                 curve: sw.g.curve, y: r.y, backhand: stroke[0] === 'b', rth: stroke === 'rth', fancy });
}

function resolveLanding() {
  const s = shuttle, h = s.lastHitter;
  if (!h) return;
  if (lesson) { lessonLanded(); return; }
  const landSide = s.p.z >= 0 ? 1 : -1;
  let winner, reason;
  if (s.netFault) { winner = other(h); reason = '掛網'; }
  else if (landSide === h.side) { winner = other(h); reason = '沒過網'; }
  else if (inBounds(s.p.x, s.p.z, landSide, s.serve, s.serveX)) { winner = h; reason = '落地得分'; }
  else if (s.serve && Math.abs(s.p.z) < COURT.shortLine && Math.abs(s.p.x) <= halfW()) { winner = other(h); reason = '發球沒過前發球線'; }
  else if (s.serve && Math.abs(s.p.x) <= halfW() && Math.abs(s.p.z) > serveLong() && Math.abs(s.p.z) <= COURT.halfL) { winner = other(h); reason = '發球太長（超過雙打後發球線）'; }
  else if (s.serve && Math.abs(s.p.x) <= halfW() && Math.abs(s.p.z) <= COURT.halfL) { winner = other(h); reason = '發球發錯區（要發到對角）'; }
  else { winner = other(h); reason = '出界'; }
  point(winner, reason);
}

// ---------------- 風格分 ----------------
const style = { total: 0, combo: 0, best: 0 };
const STYLE_BASE = { clear: 50, aclear: 60, smash: 100, stick: 110, slicesmash: 150, jumpsmash: 200, fastdrop: 60, slowdrop: 70, slicedrop: 90,
  drive: 60, block: 50, lift: 40, net: 60, spin: 80, cross: 90, push: 60, kill: 120, sserve: 20, lserve: 20 };
const FANCY = { behind: ['背後接球', 600], tweener: ['胯下球', 800], dive: ['魚躍救球', 500] };
let fancySlowUntil = 0;
function styleHit(key, o) {
  const good = o.quality === 'perfect' || o.fancy || key === 'jumpsmash';
  style.combo = good ? style.combo + 1 : 0;
  style.best = Math.max(style.best, style.combo);
  let pts = (STYLE_BASE[key] || 40) * ({ perfect: 1.5, good: 1, poor: 0.6 }[o.quality] || 1);
  if (o.fancy) pts += FANCY[o.fancy][1];
  if (key === 'jumpsmash') pts += 200;
  if (o.hold) pts += 100;
  pts = Math.round(pts * (1 + Math.min(1.5, 0.1 * style.combo)));
  style.total += pts;
  updateStyle();
  return pts;
}
function styleBonus(pts, label) {
  style.total += pts; updateStyle();
  const el = $('#fancy'); el.innerHTML = `${label}<small>+${pts}</small>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function updateStyle() {
  $('#style').innerHTML = `風格分 <b>${style.total.toLocaleString()}</b>${style.combo >= 2 ? `<span>連擊 ×${(1 + Math.min(1.5, 0.1 * style.combo)).toFixed(1)}</span>` : ''}`;
}
// 花式特效：慢動作、金色大字、鏡頭輕震
function fancyFX(name, pts, fast) {
  if (fast) shake = Math.max(shake, 0.35); // 攻擊型花式：不放慢，鏡頭震大一點
  else { fancySlowUntil = performance.now() + 550; shake = Math.max(shake, 0.12); } // 防守型花式：慢動作看清楚動作
  const el = $('#fancy'); el.innerHTML = `花式・${name}<small>+${pts}</small>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function point(w, reason) {
  const i = w.side === me.side ? 0 : 1;
  if (!lesson) {
    if (w === me && reason === '落地得分') {
      const x = Math.abs(shuttle.p.x), z = Math.abs(shuttle.p.z);
      if (Math.min(COURT.halfW - x, COURT.halfL - z) < 0.15) styleBonus(400, '壓線！');
      else if (['smash', 'stick', 'slicesmash', 'jumpsmash', 'kill'].includes(me.lastKey)) styleBonus(300, '殺球得分');
    }
    if (w !== me) { style.combo = 0; updateStyle(); }
  }
  scores[i]++;
  const prevServer = server;
  if (dbl()) { // 雙打發球輪轉
    if (serverActor.side === w.side) rightCourt[w.side] = rightCourt[w.side] === serverActor ? mateOf(serverActor) : serverActor; // 發球方得分：發球員換區、繼續發
    else serverActor = scores[i] % 2 === 0 ? rightCourt[w.side] : mateOf(rightCourt[w.side]);                                 // 換對方發：站在對的區的人發
  } else serverActor = w;
  server = i;
  if (!lesson) staminaPoint();
  for (const a of actors) { a.plan = null; a.letGo = false; }
  pending = null;
  updateScore();
  const T = settings.target, cap = T === 21 ? 30 : T + 9;
  const gameWon = (scores[i] >= T && scores[i] - scores[1 - i] >= 2) || scores[i] >= cap;
  $('#banner').textContent = `${i === 0 ? (dbl() ? '你們得分' : '你得分') : '電腦得分'}・${reason}`;
  $('#banner').style.color = i === 0 ? '#ffd84d' : '#9fd0ff';
  const need = settings.games === 3 ? 2 : 1;
  if (gameWon) { games[i]++; gameLog.push(`${scores[0]}:${scores[1]}`); }
  const won = gameWon && games[i] >= need;
  if (gameWon && !won) { // 這局結束、比賽還沒結束：換場、勝方下一局先發
    const n = games[0] + games[1];
    $('#banner').textContent = `第 ${n} 局 ${i === 0 ? '你贏' : '電腦贏'}　${scores[0]}:${scores[1]}　（局數 ${games[0]}:${games[1]}）・換場`;
    scores[0] = scores[1] = 0; server = i; midSwitched = false;
    if (dbl()) serverActor = rightCourt[w.side]; // 新的一局：勝方右區的人先發
    for (const a of actors) a.stam = clamp((a.stam ?? 100) + 40, 0, 100); // 局間休息
    phase = 'point'; phaseT = simT + 3.2; updateScore(); setHint();
    return;
  }
  if (!gameWon && settings.games === 3 && games[0] + games[1] === 2 && !midSwitched && Math.max(scores[0], scores[1]) === 11) { // 決勝局 11 分換場
    midSwitched = true;
    $('#banner').textContent += '　・決勝局 11 分，換場';
    phaseT = simT + 2.6;
  }
  crowdReact(w, reason, gameWon, won);
  umpireCall(i, prevServer, gameWon, won, T, cap);
  if (won) {
    phase = 'over';
    setTimeout(() => {
      $('#overtext').textContent = i === 0 ? (dbl() ? '你們贏了！' : '你贏了！') : '電腦贏了';
      $('#overscore').innerHTML = `${need > 1 ? `局數 ${games[0]} : ${games[1]}<br><small>${gameLog.join('・')}</small>` : `${scores[0]} : ${scores[1]}`}<br>風格分 ${style.total.toLocaleString()}・最高連擊 ${style.best}`;
      $('#over').classList.remove('hidden');
    }, 900);
  } else { phase = 'point'; phaseT = Math.max(phaseT || 0, simT + 1.5); }
  setHint();
}
const games = [0, 0], gameLog = [];
let midSwitched = false;

// ---------- 3. 體力（設定開了才有）：跑動、殺球、跳殺、撲球、魚躍會累；每分之間恢復；累了反應慢、落點不準、殺不快 ----------
const STAM_COST = { smash: 2.5, slicesmash: 2.5, stick: 1.5, jumpsmash: 5, kill: 1.5, clear: 1, aclear: 1, lift: 0.8, drive: 0.8, push: 0.8 }; // 大約打 20 分才會明顯累
function tiredOf(a) { return settings.stamina ? clamp((45 - (a.stam ?? 100)) / 45, 0, 1) : 0; } // 0＝有力、1＝很累
function staminaHit(a, key, o) {
  if (!settings.stamina || lesson) return;
  a.stam = clamp((a.stam ?? 100) - (STAM_COST[key] || 0.5) - (a.lunge ? 0.8 : 0) - (o.fancy === 'dive' ? 5 : 0), 0, 100);
}
function staminaMove(a, dist) { if (settings.stamina && !lesson) a.stam = clamp((a.stam ?? 100) - dist * 0.45, 0, 100); }
function staminaPoint() { if (settings.stamina) for (const a of actors) a.stam = clamp((a.stam ?? 100) + 5, 0, 100); }
function staminaUI() {
  const el = $('#stam'); if (!el) return;
  el.style.display = settings.stamina && !lesson ? 'flex' : 'none';
  if (!settings.stamina) return;
  for (const [k, a] of [['st0', me], ['st1', cpu]]) {
    const v = a.stam ?? 100, b = $('#' + k);
    b.style.width = v + '%'; b.style.background = v > 45 ? '#7ee2a8' : v > 20 ? '#ffd84d' : '#ff6b5a';
  }
}

// 搶網：玩家按「搶網」→ 角色往網前衝
//  球正飛過來：從網前的位置重新找最早、最高接得到的點（比網高就撲）
//  球飛向對手：先站到網前封網，對手回不好就撲得到（對手挑後場就要退回去）
let rushCool = 0;
function rush() {
  if (phase !== 'rally' || settings.demo || lesson || simT < rushCool) return;
  rushCool = simT + 0.6;
  const s = shuttle, coming = s.lastHitter && s.lastHitter !== me && !s.held;
  const tgt = { x: clamp((coming ? s.p.x : me.pos.x) * 0.6, -1.8, 1.8), z: me.side * 1.3 };
  popup('搶網！', '', '#9fd0ff');
  if (coming) {
    const sim = simulate({ ...s.p }, { ...s.v }, 3);
    const pl = predictContact(sim.pts, me.side, simT, me.pos, 0); // 從現在的位置、不等反應，找最早最高接得到的點
    if (pl && pl.y > 0.15) {
      me.plan = pl; me.letGo = false; me.reactAt = simT; me.stand = standFor(me, pl);
      planFootwork(me); me.rushUntil = simT + 0.7;
      return;
    }
  }
  me.base = { ...tgt }; me.reactAt = simT;
  const fw = planRecover(me, tgt, simT, false);
  if (fw) { fw.recover = false; me.fw = fw; }
  me.rushUntil = simT + 0.7;
}
// （搶網按鈕已移除：使用者覺得沒什麼用，改成自動撲球更積極）

// 球飛過來的途中重新判斷：本來打算等球掉下來，但現在衝上去撲得到 → 改成撲（不在網前遲疑）
let replanAt = 0;
function replanKill(a) {
  if (lesson && a === cpu) return;
  const s = shuttle;
  if (!a.plan || a.letGo || s.lastHitter === a || !s.lastHitter || s.held || s.netFault) return;
  if (a.plan.kind === 'mid' && a.plan.y > 1.55) return; // 已經要撲了
  if (a.plan.t - simT < 0.12) return; // 快打到了，不換
  const sim = simulate({ ...s.p }, { ...s.v }, 1.5), wait = a === me && simT < (me.rushUntil || 0) ? 0 : Math.max(0, (a.reactAt || 0) - simT);
  for (const q of sim.pts) {
    const zz = q.z * a.side;
    if (zz <= 0.06 || zz > 2.2 || q.y < 1.58 || q.y > 2.9) continue;
    if (Math.hypot(q.vx, q.vz) > 12) break;
    const need = wait + 0.08 + Math.max(0, Math.hypot(q.x - a.pos.x, q.z - a.pos.z) - 0.8) / 3.8;
    if (q.t < need) continue;
    a.plan = { t: simT + q.t, x: q.x, y: q.y, z: q.z, kind: 'mid' };
    a.stand = standFor(a, a.plan);
    if (auto(a)) {
      a.swingT = a.plan.t; a.low = false; a.jumpT = a.plan.t; a.jumpRise = 0.275;
      a.contactP = { x: q.x, z: q.z }; a.lungeAt = relOf({ pos: a.stand, side: a.side }, a.plan); a.lunge = false;
      a.swingKind = strokeOf({ pos: a.stand, side: a.side }, a.plan); aiPreChoose(a);
    }
    planFootwork(a);
    return;
  }
}

function planFootwork(a) {
  const pl = a.plan, S = a.stand;
  // 正在踩的那一步要保留，新的步法從那一步結束後接上
  let keep = null;
  if (a.fw) keep = a.fw.moves.find(m => simT >= m.t0 && simT < m.t0 + m.dur) || null;
  const tStart = Math.max(a.reactAt || simT, keep ? keep.t0 + keep.dur : simT);
  const low = pl.y < 1.0 || (pl.y < 1.7 && Math.abs(pl.z) < 2.8);
  const killStep = pl.kind === 'mid' && pl.y > 1.55 && Math.abs(pl.z) < 2.3;
  const from0 = keep ? keep.body : { ...a.pos };
  if (killStep && pl.t - tStart > 0.9) { // 球還要飛很久（高球從網前落下）：先往前移到準備位置，不站在原地等
    const dx = from0.x - pl.x, dz = from0.z - pl.z, d = Math.hypot(dx, dz) || 1;
    if (d > 1.9) {
      const stage = { x: pl.x + dx / d * 1.5, z: pl.z + dz / d * 1.5 };
      const pre = planRecover({ pos: from0, side: a.side }, stage, tStart, false);
      if (pre) {
        pre.recover = false;
        const rest = planMove(a, S, { contact: pl, tStart: pre.end, tHit: pl.t, stroke: strokeOf({ pos: S, side: a.side }, pl), low, mid: !low && pl.y < 2.2, kill: pl.y > 2.3, killStep: true, start: stage });
        const moves = [...(keep ? [keep] : []), ...pre.moves, ...(rest ? rest.moves : [])];
        a.fw = { moves, end: rest ? rest.end : pre.end };
        return;
      }
    }
  }
  const fw = planMove(a, S, { contact: pl, tStart, tHit: pl.t, stroke: strokeOf({ pos: S, side: a.side }, pl), low, mid: !low && pl.y < 2.2, kill: pl.kind === 'mid' && pl.y > 2.3 && Math.abs(pl.z) < 2.3, killStep: pl.kind === 'mid' && pl.y > 1.55 && Math.abs(pl.z) < 2.3, start: keep ? keep.body : { ...a.pos } });
  if (fw && keep) fw.moves.unshift(keep);
  a.fw = fw || (keep ? { moves: [keep], end: keep.t0 + keep.dur } : null);
}

function moveActors() {
  for (const a of actors) {
    if (a.pendingRecover && simT >= a.pendingRecover) { a.pendingRecover = 0; a.fw = planRecover(a, a.base, simT, true); }
    if (a.fw) { // 照排好的步法走：身體由每一步帶著
      const px = a.pos.x, pz = a.pos.z, b = bodyAt(a.fw, simT);
      if (phase === 'rally') staminaMove(a, Math.hypot(b.x - px, b.z - pz));
      a.anim.bob = bobAt(a.fw, simT);
      a.pos.x = b.x; a.pos.z = b.z;
      a.vel = { x: (a.pos.x - px) / DT, z: (a.pos.z - pz) / DT };
      continue;
    }
    a.anim.bob = 0;
    if (simT < (a.recoverUntil || 0)) { a.vel.x *= 0.9; a.vel.z *= 0.9; continue; } // 跳殺落地
    let tgt = a.base;
    if (a.plan && !a.letGo && simT >= (a.reactAt || 0)) tgt = a.stand || standFor(a, a.plan);
    const vmax = a.human && !settings.demo ? HUMAN.speed : dOf(a).speed;
    const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z, d = Math.hypot(dx, dz);
    const want = Math.min(vmax, Math.sqrt(2 * ACC * Math.max(0, d - 0.03)));
    const tvx = d > 1e-3 ? (dx / d) * want : 0, tvz = d > 1e-3 ? (dz / d) * want : 0;
    const ax = tvx - a.vel.x, az = tvz - a.vel.z, am = Math.hypot(ax, az), dv = ACC * DT;
    if (am > dv) { a.vel.x += (ax / am) * dv; a.vel.z += (az / am) * dv; } else { a.vel.x = tvx; a.vel.z = tvz; }
    a.pos.x += a.vel.x * DT; a.pos.z += a.vel.z * DT;
  }
}

// 每格算好角色要做的腳步動作，交給 character.js
function updateAnim(a) {
  const an = a.anim, s = a.side;
  const sp = Math.hypot(a.vel.x, a.vel.z);
  const fwdV = -a.vel.z * s, latV = a.vel.x * s;
  an.speed = sp; an.fwdV = fwdV; an.latV = latV;
  an.gait = sp < 0.4 ? 'idle' : fwdV < -Math.abs(latV) * 0.8 ? 'back' : Math.abs(latV) > Math.abs(fwdV) ? 'chasse' : 'run';
  an.latDir = latV >= 0 ? 1 : -1;
  an.split = (simT - a.splitT) / 0.22;
  // 離擊球還有多久：0.9 秒前開始準備、0.4 秒前準備到位，之後直接接揮拍
  an.tPlan = a.plan && !a.letGo ? a.plan.t - simT : null;
  const killPl = a.plan && a.plan.kind === 'mid' && a.plan.y > 1.55 && Math.abs(a.plan.z) < 2.3;
  an.planKind = an.tPlan !== null && a.stand ? (killPl ? (relOf({ pos: a.stand, side: a.side }, a.plan).lat >= -0.15 ? 'kill' : 'bkill') : strokeOf({ pos: a.stand, side: a.side }, a.plan)) : null;
  const overK = an.planKind === 'over' || an.planKind === 'rth' || an.planKind === 'bover';
  an.antic = an.tPlan !== null && an.tPlan > -0.35 ? clamp(((killPl ? 1.0 : overK ? 1.2 : 0.48) - an.tPlan) / (overK ? 0.55 : 0.3), 0, 1) : 0; // 撲球早一點舉拍；頭頂球邊退邊側身引拍（影片比對：真人一退就側身舉拍）
  an.relax = (an.relax || 0) + ((a.fw && a.fw.recover && !a.plan ? 1 : 0) - (an.relax || 0)) * 0.08; // 回位時放鬆（慢慢變）
  an.jumpProg = jumpOf(a).prog;
  an.stance = phase === 'serve' ? (a === serverActor ? (a.serveType === 'lserve' ? 'F' : 'B') : 'R') : null;
  // 全身轉向
  let yaw = 0;
  const swinging = Math.abs(simT - a.swingT) < 0.6;
  const kind = a.swingKind;
  const tgt = a.plan && a.stand ? a.stand : null;
  if (swinging && kind === 'bover') yaw = 2.3; // 反手頭頂：背對網
  else if (swinging && kind === 'behind') yaw = 0.9; // 背後接球：身體往左轉過去
  else if (swinging && kind === 'dive' && a.lungeAt) yaw = clamp(Math.atan2(-a.lungeAt.lat, Math.max(0.2, a.lungeAt.fwd)), -1.3, 1.3); // 魚躍：朝球撲
  else if (swinging && a.lunge && a.lungeAt) yaw = clamp(Math.atan2(-a.lungeAt.lat, Math.max(0.2, a.lungeAt.fwd)), -1.1, 1.1); // 跨步朝向球
  else if (an.planKind === 'bover' && an.tPlan < 0.35) yaw = 2.3; // 反手頭頂：球過頭頂時才轉身背對網
  else if ((an.planKind === 'over' || an.planKind === 'rth') && an.antic > 0) { // 頭頂：側身（退後場時步法已經側過來的話，不要先轉回正面再轉過去）
    const fy = a.fw && simT < a.fw.end + 0.3 ? (yawAt(a.fw, simT) ?? 0) : 0;
    yaw = Math.min(-0.85 * an.antic, fy < 0 ? Math.max(fy, -0.95) : 0);
  }
  else if (swinging && (kind === 'bside' || kind === 'bunder' || kind === 'bnet' || kind === 'blift' || kind === 'bkill')) yaw = 0.8; // 反手：身體轉向左、右肩對著球
  else if (a.fw && yawAt(a.fw, simT) !== null && simT < a.fw.end + 0.3) yaw = yawAt(a.fw, simT); // 照步法轉身
  else if (an.gait === 'back') yaw = -0.6; // 退後場：側身
  an.bodyYaw = yaw;
  // 對手要擊球了嗎？（快打的瞬間才把拍子抬起來）
  const o = oppsOf(a).find(b => b.plan && !b.letGo) || other(a);
  const oT = o.plan && !o.letGo && shuttle.lastHitter && shuttle.lastHitter.side === a.side ? o.plan.t - simT : 9;
  an.alert = phase === 'rally' && oT < 0.45 && oT > -0.15 ? clamp(1 - (oT - 0.1) / 0.35, 0, 1) : 0;
  an.mode = o.plan && o.plan.y >= 2.2 && Math.abs(o.plan.z) < 5.4 ? 'def' : Math.abs(a.pos.z) < 2.6 ? 'net' : 'base';
  // 移動時提早準備：要退後場打頭頂就先引拍；要上網打低球就先把拍子伸出去
  an.look = shuttle.p;
}

function fixed() {
  simT += DT;
  if (phase === 'feed') { floorTick(); moveActors(); if (simT >= phaseT) doFeed(); return; }
  if (phase === 'lessonwait') { floorTick(); return; }
  if (phase === 'serve') {
    holdShuttle();
    if (auto(serverActor) && simT >= phaseT) {
      const s = serverActor;
      if (s.human) hit(s, s.serveType || 'sserve', { tx: -Math.sign(s.pos.x) * rand(0.5, 2), depthFrac: Math.random(), quality: 'good' });
      else aiServe(s);
    }
    return;
  }
  if (phase === 'point' || phase === 'over') {
    floorTick();
    moveActors();
    if (phase === 'point' && simT >= phaseT) setupServe();
    return;
  }
  const zPrev = shuttle.p.z;
  step(shuttle);
  if (!shuttle.netFault && Math.sign(zPrev) !== Math.sign(shuttle.p.z) && shuttle.p.y < NET_H) {
    shuttle.netFault = true; netSound();
    shuttle.p.z = zPrev > 0 ? 0.06 : -0.06;
    shuttle.v = { x: 0, y: Math.min(shuttle.v.y, 0), z: 0 };
    for (const a of actors) a.plan = null;
  }
  moveActors();
  if (simT >= (replanAt || 0)) { replanAt = simT + 0.08; for (const a of actors) replanKill(a); }
  for (const a of actors) if (auto(a) && a.plan && simT >= a.plan.t) aiTryHit(a);
  if (pending && simT >= pending.t) { const p = pending; pending = null; humanTryHit(p); }
  if (shuttle.p.y <= 0) { shuttle.p.y = 0; resolveLanding(); floorHit(); }
}

// 羽毛球碰到地板：球頭（軟木）先著地 → 小小彈起來、往前滑一點、翻一下 → 最後側躺（球頭和羽毛邊緣都碰地）
function floorHit() {
  const v = shuttle.v, sp = Math.hypot(v.x, v.z);
  shuttle.lieDir = sp > 0.05 ? { x: v.x / sp, z: v.z / sp } : (shuttle.lieDir || { x: 0, z: -1 });
  shuttle.bounces = (shuttle.bounces || 0) + 1;
  floorSound(Math.min(1, -v.y / 6) * (shuttle.bounces === 1 ? 1 : 0.4));
  if (v.y < -1.5 && shuttle.bounces <= 2) { // 彈起來：軟木有彈性，羽毛很快把速度吃掉
    v.y = -v.y * (shuttle.bounces === 1 ? 0.3 : 0.18); v.x *= 0.45; v.z *= 0.45;
    shuttle.p.y = 0.001; shuttle.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
  } else { shuttle.v = { x: 0, y: 0, z: 0 }; shuttle.restT = simT; shuttle.spin = 0; }
}
function floorTick() {
  if (shuttle.held || shuttle.restT) return;
  if (shuttle.p.y > 0) { step(shuttle); if (shuttle.p.y <= 0) { shuttle.p.y = 0; floorHit(); } }
  else if (!shuttle.restT) { shuttle.restT = simT; shuttle.v = { x: 0, y: 0, z: 0 }; }
}

// ---------------- 介面 ----------------
function updateScore() {
  $('#s0').textContent = scores[0]; $('#s1').textContent = scores[1];
  { const w = document.querySelectorAll('#score .who'); if (w.length >= 2) { w[0].textContent = dbl() ? '你們' : '你'; w[1].textContent = dbl() ? '電腦隊' : '電腦'; } }
  $('#d0').classList.toggle('on', server === 0); $('#d1').classList.toggle('on', server === 1);
  arena.setScore(dbl() ? ['你們', '電腦隊'] : ['你', '電腦'], scores[0], scores[1], settings.games === 3 ? `局數 ${games[0]} : ${games[1]}` : `${settings.target} 分制`);
  $('#target').textContent = `${settings.target} 分制${settings.games === 3 ? `・局數 ${games[0]}:${games[1]}` : ''}${settings.demo ? '・自動示範' : ''}`;
  staminaUI();
}
let popTimer;
function popup(main, sub, color) {
  const el = $('#popup');
  el.innerHTML = `${main}<small>${sub}</small>`; el.style.color = color;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function setHint() {
  lastZoneHint = '';
  if (lesson) { $('#hint').textContent = LESSONS[lesson.i].hint; return; }
  let t = '';
  if (settings.demo) t = '自動示範中（設定裡可以關掉）';
  else if (phase === 'serve' && serverActor === me) t = '發球：往下滑＝短球（越長越深、斜滑換角度）｜往上滑＝高遠（快甩＝平快）';
  else if (phase === 'rally' && me.plan) t = '球進到打得到的範圍時，球旁邊的圈會亮起來';
  $('#hint').textContent = t;
}
const ZONE_HINT = {
  top: '高處（橘）｜往上＝高遠　先下再上＝跳殺　往下＝吊球',
  high: '殺球點（紅）｜往上＝殺球　先下再上＝跳殺　往下＝吊球',
  mid: '腰部快球｜點一下＝平抽　往上滑＝挑球　往下滑＝擋網',
  low: '低球｜往上滑＝挑球　往下滑＝放網（弧形＝搓球）　點一下＝推球',
  front: '網前高球｜往上滑＝撲球　往下滑＝放網',
  kill: '撲球機會！球比網高時往上滑＝撲球',
};
let lastZoneHint = '';
function zoneHint(r) {
  if (lesson || settings.demo) return;
  const killPlan = phase === 'rally' && me.plan && me.plan.kind === 'mid' && me.plan.y > 1.55 && Math.abs(me.plan.z) < 2.3 && shuttle.lastHitter !== me;
  const key = r && r.ok ? (r.zone !== 'low' && Math.abs(shuttle.p.z) < 2.6 && r.y > 1.55 ? 'front' : r.zone) : killPlan ? 'kill' : '';
  if (key === lastZoneHint) return;
  lastZoneHint = key;
  if (key) $('#hint').textContent = ZONE_HINT[key]; else setHint();
}

let actx = null, master = null, crowdBed = null, rallyHits = 0;
const EXTRA_SFX = false; // 觀眾聲、球鞋、掛網、落地、裁判報分：使用者說先不要（2026-11-21），留著之後要再打開
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (actx.state === 'suspended') actx.resume();
  if (EXTRA_SFX && !crowdBed) startCrowdBed();
  applySound();
}
function audioOut() {
  if (!master) { master = actx.createGain(); master.connect(actx.destination); master.gain.value = 1; }
  return master;
}
function applySound() {
  if (crowdBed) crowdBed.gain.value = settings.crowd ? 0.05 : 0;
  arena.setCrowdVisible(true);
}
// 雜訊緩衝（env(i/n) 決定音量變化）
function noiseBuf(sec, env) {
  const n = Math.floor(sec * actx.sampleRate), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * env(i / n, i);
  return b;
}
function play(buf, chain, gain, when = 0) {
  const s = actx.createBufferSource(); s.buffer = buf;
  let node = s; for (const f of chain) node = node.connect(f);
  const g = actx.createGain(); g.gain.value = gain; node.connect(g).connect(audioOut());
  s.start(actx.currentTime + when); return s;
}
const bq = (type, freq, q = 1) => { const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
// 觀眾的背景人聲：一直循環、很小聲
function startCrowdBed() {
  const sr = actx.sampleRate, k = [0.31, 0.53, 0.87, 1.37].map(f => [f, Math.random() * 6.28]);
  const buf = noiseBuf(6, (u, i) => { const t = i / sr; return 0.55 + 0.45 * k.reduce((a, [f, p]) => a + Math.sin(t * f * 6.28 + p) / 4, 0); });
  const s = actx.createBufferSource(); s.buffer = buf; s.loop = true;
  crowdBed = actx.createGain(); crowdBed.gain.value = 0;
  s.connect(bq('bandpass', 520, 0.7)).connect(bq('lowpass', 1400)).connect(crowdBed).connect(audioOut()); s.start();
}
// 觀眾吶喊（「喔～」「耶～」）：雜訊通過人聲的共振峰
function roar(level, f1 = 650) {
  if (!EXTRA_SFX || !actx || !settings.crowd) return;
  const len = 1.2 + level * 1.2;
  const buf = noiseBuf(len, u => Math.min(1, u * 12) * Math.pow(1 - u, 1.6));
  play(buf, [bq('bandpass', f1, 1.6)], 0.9 * level);
  play(buf, [bq('bandpass', f1 * 1.75, 2.2)], 0.45 * level);
  crowdCheer = Math.max(crowdCheer, level * 0.6);
}
// 掌聲：很多個短短的「啪」，隨機時間點
function applause(level) {
  if (!EXTRA_SFX || !actx || !settings.crowd) return;
  const sr = actx.sampleRate, len = 1.6 + level * 2.2, n = Math.floor(len * sr), b = actx.createBuffer(1, n, sr), d = b.getChannelData(0);
  const claps = Math.floor((120 + 520 * level) * len);
  for (let c = 0; c < claps; c++) {
    const u = Math.pow(Math.random(), 1.4), i0 = Math.floor(u * n), amp = (0.3 + Math.random() * 0.7) * Math.pow(1 - u, 0.8), L = Math.floor(sr * (0.004 + Math.random() * 0.006));
    for (let i = 0; i < L && i0 + i < n; i++) d[i0 + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (L * 0.3));
  }
  for (let i = 0; i < Math.min(n, sr * 0.05); i++) d[i] *= i / (sr * 0.05);
  play(b, [bq('highpass', 700), bq('peaking', 2200, 1)], 0.16 + 0.1 * level);
}
// 球鞋摩擦聲（跨步、急停、跳起落地）
function squeak(a, delay) {
  if (!EXTRA_SFX || !actx || Math.random() < 0.25) return;
  const near = a.side === me.side ? 1 : 0.45, t = actx.currentTime + delay, len = 0.07 + Math.random() * 0.08;
  const o = actx.createOscillator(), g = actx.createGain(), f0 = 1500 + Math.random() * 900;
  o.type = 'triangle';
  const curve = new Float32Array(16); for (let i = 0; i < 16; i++) curve[i] = f0 * (1 + 0.35 * i / 15) + 120 * Math.sin(i * 2.2);
  o.frequency.setValueCurveAtTime(curve, t, len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * near, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(bq('bandpass', 2200, 1.5)).connect(g).connect(audioOut()); o.start(t); o.stop(t + len + 0.02);
}
// 球打到網子：網子晃動的悶聲
function netSound() { if (EXTRA_SFX && actx) { noiseHit(0.16, 260, 0.7, 0.55, 'lowpass', 2); noiseHit(0.05, 1300, 1, 0.12); } }
// 球落地：軟木頭敲到地板的「叩」
function floorSound(k) { if (EXTRA_SFX && actx && k > 0.05) { noiseHit(0.025, 1700, 2.2, 0.45 * k, 'bandpass', 4); thump(420, 0.04, 0.12 * k); } }
// 得分時觀眾的反應：來回越多拍、殺球、壓線越熱烈；你（你們）得分比電腦得分熱烈
function crowdReact(w, reason, gameWon, won) {
  if (lesson || !actx) return;
  const mine = w.side === me.side;
  let lv = 0.3 + Math.min(0.35, rallyHits * 0.03);
  const nearLine = reason === '落地得分' && Math.min(halfW() - Math.abs(shuttle.p.x), COURT.halfL - Math.abs(shuttle.p.z)) < 0.15;
  if (nearLine || ['smash', 'stick', 'slicesmash', 'jumpsmash', 'kill'].includes(shuttle.lastHitter?.lastKey)) lv += 0.15;
  if (reason !== '落地得分') lv *= 0.55; // 對方失誤：掌聲比較小
  if (!mine) lv *= 0.6;
  if (gameWon) lv = won ? 1 : 0.85;
  applause(Math.min(1, lv));
  if (lv > 0.45) roar(lv * (mine ? 1 : 0.7));
  crowdCheer = Math.max(crowdCheer, lv);
}
// 裁判報分（瀏覽器的語音）：發球方的分數先講；換發球、局點、賽點也會講
function say(text) {
  if (!EXTRA_SFX || !settings.call || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-TW'; u.rate = 1.05; u.volume = settings.sound ? 1 : 0;
    const v = speechSynthesis.getVoices().find(v => /zh[-_]TW/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function umpireCall(i, prevServer, gameWon, won, T, cap) {
  if (lesson) return;
  if (won) { setTimeout(() => say('比賽結束'), 400); return; }
  if (gameWon) { setTimeout(() => say(`第${games[0] + games[1]}局，${i === 0 ? (dbl() ? '你們' : '你') : '電腦'}勝`), 400); return; }
  const a = scores[server], b = scores[1 - server];
  let t = a === b ? `${a}平` : `${a}比${b}`;
  if (server !== prevServer) t = '換發球，' + t;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi !== lo && ((hi >= T - 1 && hi - lo >= 1) || hi === cap - 1)) {
    const lead = a > b ? server : 1 - server, need = settings.games === 3 ? 2 : 1;
    t += games[lead] + 1 >= need ? '，賽點' : '，局點';
  }
  setTimeout(() => say(t), 450);
}
// 擊球聲：noise＝拍線打到球的「啪」；thump＝低音的力量感
function noiseHit(len, freq, q, gain, type = 'bandpass', decay = 3) {
  const n = Math.floor(len * actx.sampleRate), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  const s = actx.createBufferSource(); s.buffer = b;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); g.gain.value = gain;
  s.connect(f).connect(g).connect(audioOut()); s.start();
}
function thump(freq, len, gain) {
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + len);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(audioOut()); o.start(t); o.stop(t + len);
}
// 擊球的三種感覺：heavy（殺、撲）、solid（高遠、挑、抽、推）、soft（放網、搓、吊、擋）
const FEEL = { smash: 'heavy', jumpsmash: 'heavy', slicesmash: 'heavy', stick: 'heavy', kill: 'heavy',
  clear: 'solid', aclear: 'solid', lift: 'solid', lserve: 'solid', fserve: 'solid', drive: 'solid', push: 'solid', fastdrop: 'solid' };
const feelOf = key => FEEL[key] || 'soft';
function sfx(key) {
  const feel = feelOf(key);
  try { if (navigator.vibrate) navigator.vibrate(feel === 'heavy' ? 35 : feel === 'solid' ? 15 : 5); } catch (e) {} // 手機震動（Android）
  if (!actx) return;
  if (feel === 'heavy') { noiseHit(0.035, 4200, 0.7, 1.4, 'highpass', 2); noiseHit(0.07, 1100, 1, 0.9); thump(130, 0.12, 0.7); }
  else if (feel === 'solid') { noiseHit(0.05, 1500, 1.1, 0.85); thump(170, 0.07, 0.3); }
  else { noiseHit(0.025, 2800, 2.2, 0.28, 'bandpass', 4); if (key === 'spin') noiseHit(0.08, 5200, 3, 0.12, 'bandpass', 1); }
}
// 擊球閃光：打到的那一點亮一圈（重擊大又亮、輕球幾乎沒有）
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
const flash = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 24), flashMat); flash.visible = false; scene.add(flash);
let flashT = 0, flashMax = 0;
function hitFlash(p, feel) {
  if (feel === 'soft') return;
  flash.position.set(p.x, p.y, p.z); flash.visible = true; flashT = 0; flashMax = feel === 'heavy' ? 1 : 0.5;
  flashMat.color.set(feel === 'heavy' ? 0xffe08a : 0xffffff);
}
function updateFlash(dt) {
  if (!flash.visible) return;
  flashT += dt; const u = flashT / 0.16;
  if (u >= 1) { flash.visible = false; return; }
  flash.scale.setScalar((1 + u * 5) * (flashMax > 0.7 ? 1.6 : 1)); flash.quaternion.copy(camera.quaternion); flashMat.opacity = (1 - u) * flashMax;
}

// 滑動軌跡
let swipePts = null, swipeFade = 0;
attachGesture(swipeCv, {
  onStart: () => {
    ensureAudio();
    me.touching = true;
    const r = reachInfo();
    me.prepKind = strokeOf(me, r ? shuttle.p : me.plan ? me.plan : { x: me.pos.x, y: 2.5, z: me.pos.z });
  },
  onMove: pts => {
    if (!pts) { me.charge = 0; me.touching = false; return; } // 手勢被取消
    swipePts = pts.slice(); swipeFade = 1; me.charge = chargeOf(pts, swipeCv.clientHeight);
  },
  onEnd: g => { me.charge = 0; me.touching = false; if (!settings.demo && phase !== 'over') humanSwing(g); swipeFade = 1; },
});
function drawSwipe(rdt) {
  const w = swipeCv.clientWidth, h = swipeCv.clientHeight;
  sctx.clearRect(0, 0, w, h);
  if (!swipePts || swipeFade <= 0) return;
  const r = swipeCv.getBoundingClientRect();
  sctx.lineCap = 'round'; sctx.lineJoin = 'round';
  sctx.strokeStyle = `rgba(255,255,255,${0.75 * swipeFade})`; sctx.lineWidth = 6;
  sctx.beginPath();
  swipePts.forEach((p, i) => { const x = p.x - r.left, y = p.y - r.top; i ? sctx.lineTo(x, y) : sctx.moveTo(x, y); });
  sctx.stroke();
  swipeFade -= rdt * 2.2;
  if (me.charge > 0) { // 蓄力條
    const bh = h * 0.3, bx = w - 22, by = h * 0.62;
    sctx.fillStyle = 'rgba(0,0,0,0.45)'; sctx.fillRect(bx, by - bh, 10, bh);
    sctx.fillStyle = me.charge >= 1 ? '#ffd84d' : '#e0703f'; sctx.fillRect(bx, by - bh * me.charge, 10, bh * me.charge);
    sctx.fillStyle = '#fff'; sctx.font = '700 12px "Noto Sans TC",sans-serif'; sctx.fillText('蹲低', bx - 8, by + 16);
  }
}

// 設定面板
function syncSettingsUI() {
  document.querySelectorAll('.seg').forEach(seg => {
    const k = seg.dataset.k;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(settings[k]) === b.dataset.v));
  });
}
document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.k, v = Number(b.dataset.v), changedTarget = k === 'target' && v !== settings.target;
  settings[k] = v; saveSettings(); syncSettingsUI(); updateScore(); setHint();
  if (k === 'pers') { pickPers(); $('#ailabel').textContent = persLabel(); }
  if (k === 'opp') { loadOpponent(); if (dbl()) loadDoublesRigs(); }
  if (k === 'me') { loadMe(); if (dbl()) loadDoublesRigs(); }
  if (changedTarget || k === 'games' || k === 'mode') restart();
  if (k === 'stamina') { for (const a of actors) a.stam = 100; staminaUI(); }
  if (k === 'sound' || k === 'crowd') applySound();
  if (k === 'call' && v) { ensureAudio(); say('報分開啟'); }
}));
function restart() { serverActor = me; rightCourt[1] = me; rightCourt[-1] = cpu; games[0] = games[1] = 0; gameLog.length = 0; midSwitched = false; for (const a of actors) a.stam = 100; pickPers(); endLesson(); applyMode(); Object.assign(style, { total: 0, combo: 0, best: 0 }); updateStyle(); scores[0] = scores[1] = 0; server = 0; $('#over').classList.add('hidden'); setupServe(); }
$('#gear').onclick = () => { syncSettingsUI(); $('#settings').classList.remove('hidden'); };
$('#close').onclick = () => $('#settings').classList.add('hidden');
$('#restart').onclick = () => { restart(); $('#settings').classList.add('hidden'); };
$('#showhelp').onclick = () => { $('#settings').classList.add('hidden'); $('#help').classList.remove('hidden'); };
$('#start').onclick = () => {
  $('#help').classList.add('hidden'); restart();
  ensureAudio();
};
$('#again').onclick = restart;

// ---------------- 新手訓練 ----------------
const LESSONS = [
  { t: '擊球範圍', feed: 'lift', need: 3, slow: true, ok: () => true,
    intro: '球飛到你這邊、進到<b>打得到的範圍</b>時，球旁邊會亮一個圈，這時放開手指就能打到。圈的顏色代表高度：<b>橘＝高處</b>、<b>紅＝殺球點</b>、<b>黃＝腰部</b>、<b>藍＝低處</b>。球會一路往下掉，所以圈會依序變色；在不同顏色時打，會變成不同的球。這一課先往上滑，把球打回去。',
    hint: '球旁邊的圈亮起來時放開手指' },
  { t: '高遠球', feed: 'lift', need: 3, slow: true, ok: k => k === 'clear',
    intro: '球在<b>高處（橘色圈）</b>時<b>往上滑</b>＝高遠球，把球送到對方底線。不用很大力，球就會飛到底線附近。',
    hint: '橘色圈時往上滑＝高遠球' },
  { t: '殺球', feed: 'lift', need: 3, slow: true, ok: k => k === 'smash' || k === 'slicesmash',
    intro: '等球掉低一點、圈變成<b>紅色</b>時<b>往上滑</b>＝殺球。紅圈一出現就打，擊球點比較高，殺得比較快。太早打（還是橘圈）會變成高遠球；太晚打（變黃圈）就變成腰部的球。',
    hint: '紅色圈時往上滑＝殺球' },
  { t: '吊球', feed: 'lift', need: 3, slow: true, ok: k => k === 'slowdrop' || k === 'fastdrop' || k === 'slicedrop',
    intro: '頭上的球，<b>往下滑</b>＝吊球，讓球落在對方網前。慢慢滑＝輕吊（貼網），快速滑＝快吊（落點較遠、較快）。',
    hint: '頭上球：往下滑＝吊球' },
  { t: '放網', feed: 'net', need: 3, slow: true, ok: k => k === 'net' || k === 'spin' || k === 'cross',
    intro: '教練會放一個網前小球給你。網前的低球，<b>往下滑</b>＝放網，讓球貼網過去。',
    hint: '網前低球：往下滑＝放網' },
  { t: '挑球', feed: 'net', need: 3, slow: true, ok: k => k === 'lift' || k === 'push',
    intro: '網前的低球（藍色圈），<b>往上滑</b>＝挑球，把球挑到對方後場。滑得越長挑得越深。',
    hint: '網前低球：往上滑＝挑球' },
  { t: '擋網', feed: 'smash', need: 3, slow: true, ok: k => k === 'block',
    intro: '教練會殺球過來！對方殺球時，<b>往下滑</b>＝擋網，輕輕把球擋到對方網前。殺球很快，要提早準備。',
    hint: '被殺球：往下滑＝擋網' },
  { t: '平抽', feed: 'smash', need: 3, slow: true, ok: k => k === 'drive',
    intro: '對方殺球或平球過來、球在腰部（黃色圈）時，<b>點一下</b>＝平抽，用平快的球直接打回去。點螢幕<b>左半邊</b>打左邊、<b>右半邊</b>打右邊。',
    hint: '腰部快球：點一下＝平抽' },
  { t: '打右邊', feed: 'lift', need: 3, slow: false, ok: (k, o, land) => land.x > 0.6,
    intro: '滑的方向＝球飛的方向：<b>直直滑</b>＝從你打到球的地方直直飛過去；<b>往右上滑</b>＝往右斜，斜越多越往右（你看過去的右邊）。用任何球路都可以。',
    hint: '往右上方滑，把球打到右邊' },
  { t: '打左邊', feed: 'lift', need: 3, slow: false, ok: (k, o, land) => land.x < -0.6,
    intro: '<b>往左上滑</b>，球就會飛到對方場地的左邊。高遠球、殺球、吊球都可以加方向。',
    hint: '往左上方滑，把球打到左邊' },
  { t: '發短球', serve: true, need: 2, slow: false, ok: (k, o, land) => k === 'sserve' && Math.abs(land.z) >= 1.98 && Math.abs(land.z) < 3.2,
    intro: '輪到你發球時，<b>往下滑</b>＝發短球，讓球剛好過前發球線、貼網落下。',
    hint: '發球：往下滑＝發短球' },
  { t: '發高遠球', serve: true, need: 2, slow: false, ok: k => k === 'lserve',
    intro: '發球時<b>往上滑</b>＝發高遠球，又高又深，把對方逼到底線。',
    hint: '發球：往上滑＝發高遠球' },
  { t: '進階：搓球', feed: 'net', need: 2, slow: true, ok: k => k === 'spin',
    intro: '網前往下滑的時候，<b>滑成一個弧形</b>（像畫半個圓）＝搓球。球會在空中翻滾，對方很難回好。畫成功時，擊球文字會出現「弧線」。',
    hint: '網前低球：往下滑成「弧形」＝搓球' },
  { t: '進階：劈殺', feed: 'lift', need: 2, slow: true, ok: k => k === 'slicesmash',
    intro: '紅色圈時往上滑，<b>把路線畫成弧形</b>（像半個圓）＝劈殺。球會帶側旋飛向斜線。畫成功時，擊球文字會出現「弧線」。',
    hint: '紅色圈時，往上滑成弧形' },
  { t: '進階：停頓假動作', feed: 'lift', need: 2, slow: true, ok: (k, o) => !!o.hold,
    intro: '手指<b>按下去先停住一下</b>（約 0.2 秒），再滑出去。這是停頓假動作，對手會慢一拍才起步。任何球路都可以加停頓。',
    hint: '按住先停一下，再滑' },
  { t: '進階：跳殺', feed: 'lift', need: 2, slow: true, ok: k => k === 'jumpsmash',
    intro: '球在頭上（橘圈或紅圈）時，<b>先往下滑（蹲低準備），再往上滑</b>＝跳殺。人物會跳起來，殺得比一般殺球更快、更陡。代價是落地要一點時間，回位比較慢。只往下滑不往上，還是吊球。',
    hint: '先往下滑蹲低，再往上滑＝跳殺' },
  { t: '進階：撲球', feed: 'pop', need: 3, slow: true, ok: k => k === 'kill',
    intro: '教練的放網沒放好，球<b>冒得比網高</b>。這時不要等球掉下來，衝上去在<b>比網高的時候往上滑</b>＝撲球，把球往下壓死。角色會自己衝上網、先把拍子舉高；畫面出現「撲球機會」時就可以滑，早一點滑也沒關係，角色會等球到最好的位置再撲。等球掉到網下才滑，就只能挑或放網了。',
    hint: '球比網高時往上滑＝撲球（早一點滑沒關係）' },
  { t: '畢業賽', match: true, need: 0, ok: () => false,
    intro: '學會了！最後跟簡單電腦打一局 11 分的比賽。忘記怎麼打的話，畫面下方會提示這顆球可以怎麼滑。',
    hint: '' },
];
const FEEDS = {
  lift:  { cz: -1.9, y: 0.85, key: 'lift',  tx: 0.5, d: 0.35 },
  net:   { cz: -1.9, y: 0.85, key: 'net',   tx: 0.3, d: 0.7 },
  smash: { cz: -4.6, y: 2.7,  key: 'smash', tx: 0.5, d: 0.2, power: 0 },
  pop:   { cz: -1.0, y: 1.1,  key: 'net',   tx: 0, spread: 1.0, d: 1.0, q: 'poor', mz: 2.2 }, // 撲球練習：放網沒放好、冒高
};
let lesson = null;
const doneSet = (() => { try { return new Set(JSON.parse(localStorage.getItem('bm-lessons') || '[]')); } catch (e) { return new Set(); } })();
const saveDone = () => { try { localStorage.setItem('bm-lessons', JSON.stringify([...doneSet])); } catch (e) {} };

function lessonBar() {
  const L = LESSONS[lesson.i];
  $('#lessontitle').textContent = `第 ${lesson.i + 1} 課・${L.t}`;
  $('#lessoncount').textContent = `${lesson.count} / ${L.need}`;
}
function hideOverlays() { document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); }
function openLessonIntro(i) {
  const L = LESSONS[i];
  hideOverlays();
  $('#introtitle').textContent = `第 ${i + 1} 課・${L.t}`;
  $('#introtext').innerHTML = L.intro;
  $('#intro').dataset.i = i;
  $('#intro').classList.remove('hidden');
}
function startLesson(i) {
  const L = LESSONS[i];
  hideOverlays();
  settings.demo = 0;
  if (L.match) {
    settings.target = 11; saveSettings(); syncSettingsUI(); // 難度照設定，不再強制改成簡單
    doneSet.add(i); saveDone(); restart(); return;
  }
  lesson = { i, count: 0 }; applyMode(); // 教學只有單打
  $('#score').style.display = 'none'; $('#lessonbar').style.display = 'flex';
  $('#banner').textContent = ''; $('#ailabel').textContent = ''; $('#lessonmsg').textContent = '';
  lessonBar(); setHint();
  if (L.serve) { server = 0; scores[0] = scores[1] = 0; setupServe(); }
  else { phase = 'feed'; phaseT = simT + 1.0; me.plan = cpu.plan = null; pending = null; }
}
function endLesson() {
  lesson = null;
  if (phase === 'feed' || phase === 'lessonwait') { phase = 'point'; phaseT = simT + 0.3; }
  $('#score').style.display = ''; $('#lessonbar').style.display = 'none'; $('#lessonmsg').textContent = '';
  applyMode(); // 回到設定的單打／雙打
}
function doFeed() {
  if (!lesson) { setupServe(); return; }
  const L = LESSONS[lesson.i];
  if (L.serve) { server = 0; setupServe(); return; }
  const F = FEEDS[L.feed];
  me.pos = { x: 0.3, z: F.mz ?? 3.6 }; me.base = { ...me.pos }; me.plan = null; me.fw = null; cpu.fw = null;
  cpu.pos = { x: F.spread ? rand(-1.1, 1.1) : -0.4, z: F.cz }; cpu.base = { ...cpu.pos }; // 撲球練習：教練左右換位置（正手、反手都練到）
  shuttle.p = { x: cpu.pos.x - 0.45, y: F.y, z: F.cz + 0.35 };
  trailHist.length = 0;
  hit(cpu, F.key, { tx: F.tx + rand(-(F.spread ?? 0.3), F.spread ?? 0.3), depthFrac: F.d, quality: F.q || 'perfect', power: F.power ?? 0.5, errK: F.q ? 0.3 : 1 });
}
function lessonCheck(key, o, land) {
  const L = LESSONS[lesson.i];
  if (L.ok(key, o, land)) {
    lesson.count++;
    $('#lessonmsg').textContent = '✓ 對了！';
    $('#lessonmsg').style.color = '#7ee2a8';
  } else {
    $('#lessonmsg').textContent = `這球打成「${SHOTS[key].name}」，再試一次`;
    $('#lessonmsg').style.color = '#ffcf9e';
  }
  lessonBar();
}
function lessonLanded() {
  const L = LESSONS[lesson.i];
  if (lesson.count >= L.need) {
    phase = 'lessonwait';
    doneSet.add(lesson.i); saveDone();
    setTimeout(() => {
      $('#donetitle').textContent = `第 ${lesson.i + 1} 課・${L.t}　完成！`;
      $('#donenext').style.display = lesson.i + 1 < LESSONS.length ? '' : 'none';
      $('#done').classList.remove('hidden');
    }, 500);
    return;
  }
  phase = 'feed'; phaseT = simT + 1.0;
}
function openLessonMenu() {
  hideOverlays();
  const box = $('#lessonlist'); box.innerHTML = '';
  LESSONS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'lessonitem';
    b.innerHTML = `<span>${i + 1}. ${L.t}</span><span class="ok">${doneSet.has(i) ? '完成' : ''}</span>`;
    b.onclick = () => openLessonIntro(i);
    box.appendChild(b);
  });
  $('#lessons').classList.remove('hidden');
}
$('#tolessons').onclick = () => { ensureAudio(); openLessonMenu(); };
$('#menulessons').onclick = openLessonMenu;
$('#introgo').onclick = () => startLesson(Number($('#intro').dataset.i));
$('#introback').onclick = openLessonMenu;
$('#donenext').onclick = () => { const i = lesson.i + 1; endLesson(); openLessonIntro(i); };
$('#doneretry').onclick = () => { const i = lesson.i; startLesson(i); };
$('#donemenu').onclick = () => { endLesson(); openLessonMenu(); };
$('#lessonquit').onclick = () => { endLesson(); restart(); };
$('#lessonsclose').onclick = () => { hideOverlays(); };

// ---------------- 動畫 ----------------
function swingAnim(a) {
  const d = simT - a.swingT, low = a.low;
  const rest = low ? -1.2 : 0.5, back = low ? 0.2 : 2.3, thru = low ? -2.0 : -0.7, end = low ? -2.2 : -1.1;
  const L = (x, y, t) => x + (y - x) * clamp(t, 0, 1);
  let r;
  if (d < -0.3) r = rest;
  else if (d < -0.05) r = L(rest, back, (d + 0.3) / 0.25);
  else if (d < 0.06) r = L(back, thru, (d + 0.05) / 0.11);
  else if (d < 0.3) r = L(thru, end, (d - 0.06) / 0.24);
  else if (d < 0.8) r = L(end, rest, (d - 0.3) / 0.5);
  else r = rest;
  if (a.charge > 0 && d > 0.8) r = L(0.5, 2.4, a.charge); // 拉拍：拍子往後引
  a.mesh.userData.aR.rotation.x = r;
}

const tmpV = new THREE.Vector3();
const CAM = { y: 7.2, z: 12.8, ay: 0.3, az: -0.6 }; // 鏡頭：高度、距離、看向的高度和位置
// 跳躍：jumpT＝最高點（擊球），之前 jumpRise 秒蹬地，之後 0.32 秒落地；prog 0→0.5 上升、0.5→1 下降
function jumpOf(a) {
  const rise = a.jumpRise || 0.275, fall = 0.32, t = simT - (a.jumpT ?? -9);
  if (!a.jumpH || t < -rise) return { y: 0, prog: -1 };
  if (t > fall) return { y: 0, prog: 2 };
  if (t < 0) { const u = (t + rise) / rise; return { y: a.jumpH * Math.sin(u * Math.PI / 2), prog: u * 0.5 }; }
  const u = t / fall; return { y: a.jumpH * Math.cos(u * Math.PI / 2), prog: 0.5 + u * 0.5 };
}
// 視角：0 標準（看全場）、1 近距離、2 肩後（跟在球員後面）、3 球員視角（眼睛高度，看著球）
const camPos = new THREE.Vector3(0, 7.2, 12.8), camAt = new THREE.Vector3(0, 0.3, -0.6);
const camWant = new THREE.Vector3(), atWant = new THREE.Vector3();
function placeCamera(rdt) {
  const m = settings.cam || 0, p = me.pos, s = shuttle.p;
  if (m === 0) { const CP = window.__camP || CAM; camWant.set(p.x * 0.35, CP.y, CP.z); atWant.set(p.x * 0.2, CP.ay, CP.az); }
  else if (m === 1) { camWant.set(p.x * 0.6, 4.3, p.z + 5.6); atWant.set(p.x * 0.35, 1.0, p.z - 4.5); }
  else if (m === 2) { camWant.set(p.x + 0.55, 2.35, p.z + 2.7); atWant.set(p.x * 0.45 + s.x * 0.15, 1.5, p.z - 6); }
  else { // 球員視角：在頭後上方一點，視線往球的方向帶
    const by = clamp(s.y, 0.5, 4), bz = Math.min(s.z, p.z - 1.5);
    camWant.set(p.x + 0.03, 1.62 + jumpOf(me).y, p.z - 0.32); // 眼睛前方一點（不會被自己的頭擋住）
    atWant.set(p.x * 0.5 + s.x * 0.5, 1.2 + (by - 1.2) * 0.35, p.z - 5 + (bz - p.z + 5) * 0.3);
  }
  const k = 1 - Math.exp(-rdt * (m === 0 ? 30 : m === 3 ? 14 : 7)); // 近的視角慢慢跟，不會晃
  camPos.lerp(camWant, k); camAt.lerp(atWant, k);
  camera.position.copy(camPos); camera.lookAt(camAt);
}
function render(rdt) {
  for (const a of actors) {
    const jy = jumpOf(a).y;
    updateAnim(a);
    if (a.rig) { a.rig.update(a, simT, rdt, jy); continue; }
    a.mesh.position.set(a.pos.x, jy, a.pos.z); swingAnim(a);
    a.mesh.scale.y = 1 - 0.12 * (a.charge || 0); // 蹲低
  }
  const p = shuttle.p;
  shuttleMesh.position.set(p.x, p.y, p.z);
  if (shuttle.restT && !shuttle.held) { // 側躺：球頭朝前、往下壓到地，羽毛尾端翹起約 15°（球頭半徑 2 cm、羽毛尾端碰地）
    const d = shuttle.lieDir || { x: 0, z: -1 }, k = Math.min(1, (simT - shuttle.restT) / 0.22), tilt = 0.27;
    shuttleMesh.position.y = 0.02;
    shuttleTmp.position.copy(shuttleMesh.position); shuttleTmp.lookAt(p.x + d.x * Math.cos(tilt), 0.02 - Math.sin(tilt), p.z + d.z * Math.cos(tilt));
    shuttleMesh.quaternion.slerp(shuttleTmp.quaternion, k < 1 ? 0.25 : 1);
  } else if (shuttle.bounces && !shuttle.held) { // 彈跳中：翻滾
    shuttleTmp.position.copy(shuttleMesh.position); shuttleTmp.lookAt(p.x + shuttle.v.x, p.y + shuttle.v.y, p.z + shuttle.v.z);
    shuttleTmp.rotateX(simT * (shuttle.spin || 8));
    shuttleMesh.quaternion.slerp(shuttleTmp.quaternion, 0.35);
    shuttleMesh.position.y = Math.max(p.y, 0.018);
  } else {
    if (shuttle.held || Math.hypot(shuttle.v.x, shuttle.v.y, shuttle.v.z) < 0.05) shuttleMesh.lookAt(p.x, p.y - 1, p.z);
    else shuttleMesh.lookAt(p.x + shuttle.v.x, p.y + shuttle.v.y, p.z + shuttle.v.z);
    if (shuttle.tumble && !shuttle.held && phase === 'rally') shuttleMesh.rotateX(simT * 30);
  }
  if (!shuttle.held) { trailHist.unshift({ ...p }); if (trailHist.length > TRAIL) trailHist.pop(); }
  for (let i = 0; i < TRAIL; i++) {
    const h = trailHist[Math.min(i, trailHist.length - 1)] || p;
    trailPos[i * 3] = h.x; trailPos[i * 3 + 1] = h.y; trailPos[i * 3 + 2] = h.z;
  }
  trailGeo.attributes.position.needsUpdate = true;

  // 提示：地上標出球會落到哪裡；球進到打得到的範圍時，球旁邊亮一個圈（顏色＝高／腰／低）
  const showAid = settings.ring && !settings.demo && phase === 'rally' && me.plan && shuttle.lastHitter !== me;
  groundMark.visible = !!showAid;
  if (showAid) groundMark.position.set(me.plan.x, 0.02, me.plan.z);
  innerRing.visible = false;
  const reach = settings.demo ? null : reachInfo();
  outerRing.visible = !!(settings.ring && reach && reach.ok);
  if (outerRing.visible) {
    outerRing.position.set(p.x, p.y, p.z);
    outerRing.quaternion.copy(camera.quaternion);
    outerRing.scale.setScalar(1.1);
    outerRing.material.color.set({ top: 0xff9a3d, high: 0xff3b3b, mid: 0xffd84d, low: 0x6fc3ff }[reach.zone]);
  }
  const killPlan = !settings.demo && phase === 'rally' && me.plan && me.plan.kind === 'mid' && me.plan.y > 1.55 && Math.abs(me.plan.z) < 2.3 && shuttle.lastHitter !== me;
  if (settings.ring && killPlan && !outerRing.visible) { // 還搆不到：在撲球點先亮紫色預告圈
    outerRing.visible = true;
    outerRing.position.set(me.plan.x, me.plan.y, me.plan.z); outerRing.quaternion.copy(camera.quaternion);
    outerRing.scale.setScalar(1.25 + 0.15 * Math.sin(performance.now() / 120));
    outerRing.material.color.set(0xb98cff);
  }
  zoneHint(reach);

  placeCamera(rdt);
  updateFlash(rdt);
  { arena.update(performance.now() / 1000, crowdCheer); crowdCheer = Math.max(0, crowdCheer - rdt * 0.35); }
  if (settings.stamina) staminaUI();
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.3; camera.position.y += rand(-1, 1) * shake * 0.3; shake -= rdt; }
  const co = window.__camOverride; // 測試用特寫鏡頭
  if (co) { camera.position.set(...co.pos); camera.lookAt(...co.at); }
  effect.render(scene, camera);
  drawSwipe(rdt);
}

let acc = 0, last = performance.now(), assistS = 1;
function loop(now) {
  let rdt = Math.min((now - last) / 1000, 0.05); last = now;
  const realDt = rdt;
  if (hitStop > 0) { hitStop -= rdt; rdt = 0; }
  if (window.__freeze) rdt = 0; // 測試用：暫停
  const rr = settings.assist && !settings.demo ? reachInfo() : null;
  // 慢動作輔助：球進到打得到的範圍才慢慢變慢；很快的球（殺球、平抽）不放慢
  const fastBall = Math.hypot(shuttle.v.x, shuttle.v.y, shuttle.v.z) > 14;
  const assistTgt = rr && rr.ok && !fastBall ? 0.5 : 1;
  assistS += (assistTgt - assistS) * Math.min(1, realDt * 7);
  acc += rdt * (lesson && LESSONS[lesson.i].slow ? 0.6 : settings.slow ? 0.5 : 1) * assistS * (performance.now() < fancySlowUntil ? 0.3 : 1);
  let guard = 0;
  requestAnimationFrame(loop);
  if (window.__recording) { last = now; return; } // 錄連續格時暫停
  try {
    while (acc >= DT && guard++ < 40) { fixed(); acc -= DT; }
    render(realDt);
  } catch (e) { console.error(e); acc = 0; }
}

syncSettingsUI();
pickPers();
applyMode();
applySound();
updateScore();
setupServe();
requestAnimationFrame(loop);
window.__testThrow = (p, v) => { // 測試用：直接丟一顆電腦打過來的球（玩家照正常流程判斷）
  Object.assign(shuttle, { p: { ...p }, v: { ...v }, held: false, lastHitter: cpu, tumble: false, serve: false, netFault: false });
  phase = 'rally'; cpu.swingT = simT; me.plan = predictContact(simulate({ ...p }, { ...v }).pts, me.side, simT, me.pos, HUMAN.react);
  me.letGo = false; me.stand = standFor(me, me.plan); me.splitT = simT; me.reactAt = simT + HUMAN.react; planFootwork(me);
};
window.__testHit = (key, o, at) => { if (at) { Object.assign(shuttle.p, at); cpu.pos.x = at.x; cpu.pos.z = at.z - 0.4; } shuttle.held = false; hit(cpu, key, o || {}); }; // 測試用：讓電腦打指定的球
window.__serveMe = even => { scores[0] = even ? 0 : 1; scores[1] = 0; server = 0; serverActor = me; setupServe(); }; // 測試用：輪到我在右區（雙數）或左區發球
window.__testMeHit = (key, o, at) => { Object.assign(shuttle.p, at); me.pos.x = at.x; me.pos.z = at.z + 0.4; shuttle.held = false; phase = 'rally'; hit(me, key, o || {}); const s = simulate({ ...shuttle.p }, { ...shuttle.v }); return s.land; }; // 測試用：玩家打指定的球，回傳落點
window.__game = { settings, scores, games, me, cpu, mate, cpu2, actors, shuttle, get serverActor() { return serverActor; }, get receiverActor() { return receiverActor; }, get phase() { return phase; }, get simT() { return simT; } };

// 測試用：把動作錄成連續格（一張圖排成格子），方便和真人影片逐格比對
// o = { frames: 12, step: 0.1, cols: 6, cellW: 200, cam: { pos: [x,y,z], at: [x,y,z] } }
window.__record = (o = {}) => {
  const frames = o.frames || 12, step = o.step || 0.1, cols = o.cols || 6, cw = o.cellW || 200;
  window.__recording = true;
  if (o.cam) window.__camOverride = o.cam;
  const src = renderer.domElement, ch = Math.round(cw * src.height / src.width), rows = Math.ceil(frames / cols);
  const cv = document.createElement('canvas'); cv.width = cw * cols; cv.height = ch * rows;
  const c2 = cv.getContext('2d');
  for (let i = 0; i < frames; i++) {
    if (i > 0) { let n = Math.round(step / DT); while (n-- > 0) fixed(); }
    render(step);
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    c2.drawImage(src, x, y, cw, ch);
    c2.fillStyle = '#000a'; c2.fillRect(x, y, 70, 22);
    c2.fillStyle = '#fff'; c2.font = 'bold 14px sans-serif'; c2.fillText(`${(i * step).toFixed(2)}s`, x + 6, y + 16);
  }
  window.__recording = false;
  let img = document.getElementById('__sheet');
  if (!img) { img = document.createElement('img'); img.id = '__sheet'; img.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000'; document.body.appendChild(img); }
  img.src = cv.toDataURL('image/jpeg', 0.88); img.style.width = cv.width + 'px';
  return { w: cv.width, h: cv.height };
};
