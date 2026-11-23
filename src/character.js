// VRM 角色：讀檔＋用程式控制骨架做動作
// 姿勢用「肢體指向哪個方向」描述（身體座標：面向 +Z、右手在 -X、上方 +Y），再換算成骨頭旋轉。
// 全身的轉向（側身、背對網）由 root 的 yaw 處理，姿勢本身都相對於身體。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const REST_R_ARM = new THREE.Vector3(-1, 0, 0);
const REST_L_ARM = new THREE.Vector3(1, 0, 0);
const REST_LEG = new THREE.Vector3(0, -1, 0);

// ---------- 姿勢庫 ----------
// rU/rF 右上臂／右前臂；lU/lF 左手；rT/rS、lT/lS 大腿／小腿；lean 前傾；yaw 轉肩；tilt 側彎（負＝往左）；drop 重心下沉
const READY = { // 影片比對（2026-11-23）：拍子舉在胸前、拍頭朝上；非持拍手往側邊抬到胸口下（平衡）
  rU: V(-0.35, -0.72, 0.6), rF: V(0.22, 0.5, 0.84),
  lU: V(0.7, -0.5, 0.5), lF: V(0.45, 0.2, 0.87),
  rT: V(-0.22, -0.9, 0.35), rS: V(-0.12, -0.95, -0.25),
  lT: V(0.22, -0.92, 0.2), lS: V(0.12, -0.95, -0.28),
  lean: 0.2, yaw: 0, tilt: 0, drop: 0.13, wZ: -0.15, wY: 0, tw: 0.8, ltw: 0.6, // tw 0.8：握手式握拍、拍子直立拍頭朝上（不是手背朝下、拍子平放）；ltw：非持拍手手心朝內
};
// 回位走路：上身直、放鬆，拍子垂在身體旁邊
const RELAX = { ...READY, rU: V(-0.3, -0.85, 0.42), rF: V(0.15, 0.2, 0.97), lU: V(0.55, -0.7, 0.45), lF: V(0.35, -0.05, 0.94), lean: 0.12, drop: 0.07 };
// 對手要擊球的瞬間把拍子抬起來（平常放低）
const ALERT = { ...READY, rU: V(-0.45, -0.6, 0.66), rF: V(0.1, 0.6, 0.8), lU: V(0.45, -0.82, 0.35), lF: V(0.3, -0.4, 0.87), drop: 0.13 };
// 防守（預期對方殺球）：拍子在腰的高度、拍面平、偏反手邊，站得比較寬
const DEFENSE = { ...READY, rU: V(-0.35, -0.85, 0.4), rF: V(0.3, 0.3, 0.9), lU: V(0.42, -0.86, 0.28), lF: V(0.3, -0.45, 0.84),
  rT: V(-0.32, -0.88, 0.3), lT: V(0.32, -0.88, 0.25), lean: 0.24, drop: 0.15 };
// 網前（可能撲球）：拍子舉高在身前
const NETUP = { ...READY, rU: V(-0.4, -0.2, 0.9), rF: V(-0.05, 0.85, 0.52), lU: V(0.5, -0.35, 0.8), lF: V(0.2, 0.3, 0.93), lean: 0.22, drop: 0.12 };
// 移動中：兩手跟著步伐抬高（不是慢跑那樣甩）
const MOVE_ARMS = { rU: V(-0.45, -0.6, 0.66), rF: V(0.05, 0.72, 0.69), lU: V(0.75, -0.55, 0.37), lF: V(0.45, 0.25, 0.86) }; // 拍子舉在身前、手肘彎；非持拍手彎著在身體旁邊平衡
// 跨步（右腳在前）
const LUNGE = {
  rT: V(-0.12, -0.35, 0.93), rS: V(-0.08, -0.97, 0.2),
  lT: V(0.18, -0.8, -0.57), lS: V(0.08, -0.35, -0.93),
  lean: 0.18, drop: 0.12, // 跨步再往下降多少由腳的距離自動算
};
const HALF = { rT: V(-0.25, -0.85, 0.45), rS: V(-0.12, -0.96, -0.2), lT: V(0.25, -0.88, 0.1), lS: V(0.12, -0.9, -0.4), drop: 0.2 };

// 正手頭頂：轉身引拍（手肘抬高、拍子舉起）→ 往上伸直擊球 → 往身體前下方收拍
const OVER = {
  prep: { ...READY, rU: V(-0.98, 0.08, -0.18), rF: V(-0.12, 0.97, -0.2), lU: V(0.3, 0.9, 0.3), lF: V(0.25, 0.95, 0.2), lean: -0.05, yaw: -0.8, drop: 0.1,
          rT: V(-0.2, -0.9, -0.3), lT: V(0.2, -0.9, 0.35) },
  hit: { ...READY, rU: V(-0.22, 0.88, 0.42), rF: V(-0.08, 0.86, 0.5), lU: V(0.3, -0.45, 0.84), lF: V(-0.35, 0.1, 0.93), lean: 0.1, yaw: 0.3, drop: 0.02 },
  follow: { ...READY, rU: V(0.55, -0.6, 0.58), rF: V(0.75, -0.55, 0.35), lU: V(0.25, -0.75, 0.6), lF: V(-0.3, -0.2, 0.93), lean: 0.35, yaw: 1.0, drop: 0.12,
            rT: V(-0.2, -0.85, 0.45), lT: V(0.2, -0.9, -0.3) },
};
OVER.drop = { ...OVER.prep, rU: V(-0.62, 0.62, 0.48), rF: V(0.12, -0.72, -0.68), lU: V(0.35, 0.3, 0.88), lF: V(0.1, -0.2, 0.97), yaw: -0.35, lean: 0, drop: 0.08 };
// 頭頂（繞頭）：球在左上方，身體往左側彎
const RTH = {
  prep: { ...OVER.prep, tilt: -0.15 },
  hit: { ...OVER.hit, rU: V(0.15, 0.97, 0.12), rF: V(0.25, 0.95, 0.2), tilt: -0.4, yaw: 0.1 },
  follow: { ...OVER.follow, tilt: -0.2 },
  drop: { ...OVER.drop, tilt: -0.25 },
};
// 反手頭頂（背對網）：拍子從左肩前方往上、往網的方向（身體後方）打
const BOVER_LEGS = { rT: V(-0.12, -0.6, 0.79), rS: V(-0.08, -0.97, 0.15), lT: V(0.18, -0.88, -0.42), lS: V(0.08, -0.6, -0.8), drop: 0.22 };
const BOVER = {
  prep: { ...READY, ...BOVER_LEGS, rU: V(0.35, 0.55, 0.76), rF: V(0.3, -0.85, 0.42), lU: V(0.45, -0.75, -0.48), lF: V(0.25, -0.9, 0.1), lean: 0.1, yaw: 0.3 },
  hit: { ...READY, ...BOVER_LEGS, rU: V(-0.3, 0.95, -0.05), rF: V(-0.25, 0.96, -0.1), lU: V(0.5, -0.75, 0.3), lF: V(0.3, -0.9, 0.2), lean: -0.05, yaw: -0.2 },
  follow: { ...READY, ...BOVER_LEGS, rU: V(-0.38, 0.88, -0.28), rF: V(-0.32, 0.88, -0.35), lU: V(0.5, -0.75, 0.3), lF: V(0.3, -0.9, 0.2), lean: 0, yaw: -0.25 },
};
// 正手下手（挑球、放網）
const UNDER = {
  prep: { ...READY, ...LUNGE, rU: V(-0.55, -0.7, 0.45), rF: V(-0.25, -0.35, 0.9), lU: V(0.6, 0.0, -0.8), lF: V(0.45, 0.05, -0.89), yaw: -0.2 }, // 手肘彎、拍頭靠手腕後扣放低
  hit: { ...READY, ...LUNGE, rU: V(-0.35, -0.65, 0.68), rF: V(-0.15, -0.5, 0.85), lU: V(0.55, 0.08, -0.83), lF: V(0.4, 0.12, -0.91), yaw: 0.05 },
  follow: { ...READY, ...LUNGE, rU: V(-0.25, 0.2, 0.95), rF: V(-0.05, 0.75, 0.65), lU: V(0.5, -0.3, -0.8), lF: V(0.4, -0.4, -0.8), yaw: 0.2 },
};
// 反手下手：拍子在身體左前方
const BUNDER = {
  prep: { ...READY, ...LUNGE, rU: V(0.3, -0.65, 0.7), rF: V(0.45, -0.3, 0.84), lU: V(0.55, -0.05, -0.83), lF: V(0.4, 0.0, -0.92), yaw: 0.8 },
  hit: { ...READY, ...LUNGE, rU: V(0.15, -0.55, 0.82), rF: V(0.3, -0.45, 0.85), lU: V(0.5, -0.2, -0.8), lF: V(0.4, -0.3, -0.85), yaw: 0.15 },
  follow: { ...READY, ...LUNGE, rU: V(-0.05, 0.2, 0.98), rF: V(0.05, 0.75, 0.65), lU: V(0.5, -0.3, -0.8), lF: V(0.4, -0.4, -0.8), yaw: 0 },
};
// 挑球（下手往上挑）：引拍時手腕後扣、拍頭垂在身後下方 → 從下往上甩 → 收拍舉過頭、停一下
const LIFT = {
  prep: { ...READY, ...LUNGE, rU: V(-0.45, -0.75, 0.48), rF: V(-0.3, -0.9, -0.3), lU: V(0.6, 0.0, -0.8), lF: V(0.45, 0.05, -0.89), yaw: -0.3 }, // 手肘彎、拍頭靠手腕放到後下方（精簡）
  hit: { ...READY, ...LUNGE, rU: V(-0.3, -0.6, 0.74), rF: V(-0.12, -0.55, 0.83), lU: V(0.55, 0.08, -0.83), lF: V(0.4, 0.12, -0.91), yaw: 0.05 },
  follow: { ...READY, ...LUNGE, rU: V(-0.15, 0.8, 0.58), rF: V(0.05, 0.97, 0.25), lU: V(0.55, -0.4, -0.73), lF: V(0.4, -0.5, -0.77), yaw: 0.3, lean: (LUNGE.lean ?? 0.3) * 0.6 },
  prepT: -0.2, hold: 0.36, // 引拍短；收拍高舉多停一下，看得出是挑球
};
const BLIFT = {
  prep: { ...READY, ...LUNGE, rU: V(0.35, -0.7, 0.62), rF: V(0.45, -0.85, -0.25), lU: V(0.55, -0.05, -0.83), lF: V(0.4, 0.0, -0.92), yaw: 0.9 },
  hit: { ...READY, ...LUNGE, rU: V(0.15, -0.55, 0.82), rF: V(0.25, -0.5, 0.83), lU: V(0.5, -0.2, -0.8), lF: V(0.4, -0.3, -0.85), yaw: 0.2 },
  follow: { ...READY, ...LUNGE, rU: V(0.1, 0.8, 0.59), rF: V(-0.05, 0.97, 0.25), lU: V(0.5, -0.4, -0.77), lF: V(0.4, -0.5, -0.77), yaw: -0.1, lean: (LUNGE.lean ?? 0.3) * 0.6 },
  prepT: -0.2, hold: 0.36,
};
// 撲球：拍子先高舉在身前、手腕後扣 → 手腕往下一壓（短、快）→ 收拍很短停在身前；拿拍腳往前跨
const KILL = {
  prep: { ...READY, rU: V(-0.45, 0.45, 0.77), rF: V(-0.1, 0.95, 0.3), lU: V(0.8, 0.0, -0.6), lF: V(0.55, 0.15, -0.82), lean: 0.15, yaw: -0.2, drop: 0.03 },
  hit: { ...READY, rU: V(-0.3, 0.38, 0.87), rF: V(-0.05, 0.42, 0.91), lU: V(0.75, -0.05, -0.66), lF: V(0.5, 0.05, -0.86), lean: 0.18, yaw: 0.1, drop: 0.03 },
  follow: { ...READY, rU: V(-0.25, 0.05, 0.97), rF: V(0, -0.3, 0.95), lU: V(0.75, -0.3, -0.58), lF: V(0.5, -0.1, -0.86), lean: 0.2, yaw: 0.15, drop: 0.04 },
  prepT: -0.16,
};
// 反手撲球：拍子舉在身體左前方、手肘帶頭 → 反手往下一壓
const BKILL = {
  prep: { ...READY, rU: V(0.35, 0.45, 0.82), rF: V(0.5, 0.75, 0.43), lU: V(0.6, -0.45, -0.66), lF: V(0.4, -0.3, -0.87), lean: 0.15, yaw: 0.55, drop: 0.03 },
  hit: { ...READY, rU: V(0.15, 0.38, 0.91), rF: V(0.15, 0.38, 0.91), lU: V(0.6, -0.45, -0.66), lF: V(0.4, -0.3, -0.87), lean: 0.18, yaw: 0.2, drop: 0.03 },
  follow: { ...READY, rU: V(0.05, 0.05, 0.99), rF: V(-0.1, -0.25, 0.96), lU: V(0.6, -0.5, -0.62), lF: V(0.4, -0.35, -0.85), lean: 0.2, yaw: 0.1, drop: 0.04 },
  prepT: -0.16,
};
// 網前（放網、搓球、勾對角）：拿拍手伸到身前、拍面接近水平、動作很小；另一隻手往後平衡
const NET = {
  prep: { ...READY, ...LUNGE, rU: V(-0.4, -0.6, 0.69), rF: V(-0.15, 0.3, 0.94), lU: V(0.6, -0.1, -0.79), lF: V(0.45, 0.0, -0.89), yaw: -0.1 }, // 跑過去時拍子舉在身前，落地才伸出去
  hit: { ...READY, ...LUNGE, rU: V(-0.28, -0.22, 0.93), rF: V(-0.12, 0.02, 0.99), lU: V(0.55, 0.08, -0.83), lF: V(0.4, 0.12, -0.91), yaw: 0 },
  follow: { ...READY, ...LUNGE, rU: V(-0.25, -0.15, 0.96), rF: V(-0.08, 0.15, 0.98), lU: V(0.5, -0.3, -0.8), lF: V(0.35, -0.45, -0.82), yaw: 0.05 },
};
const BNET = {
  prep: { ...READY, ...LUNGE, rU: V(0.1, -0.6, 0.79), rF: V(0.35, 0.3, 0.89), lU: V(0.5, -0.5, -0.7), lF: V(0.35, -0.5, -0.79), yaw: 0.6 },
  hit: { ...READY, ...LUNGE, rU: V(0.18, -0.22, 0.96), rF: V(0.28, 0.02, 0.96), lU: V(0.5, -0.25, -0.83), lF: V(0.35, -0.4, -0.85), yaw: 0.15 },
  follow: { ...READY, ...LUNGE, rU: V(0.12, -0.15, 0.98), rF: V(0.18, 0.15, 0.97), lU: V(0.5, -0.3, -0.8), lF: V(0.35, -0.45, -0.82), yaw: 0.1 },
};
// 正手側身（平抽、擋網）
const SIDE = {
  prep: { ...READY, rU: V(-0.85, -0.3, 0.1), rF: V(-0.3, 0.85, -0.3), lU: V(0.75, -0.35, 0.45), lF: V(0.5, 0.2, 0.84), yaw: -0.55, drop: 0.14 }, // 手肘彎、拍子在肩旁（不是手臂打直往外伸）
  hit: { ...READY, rU: V(-0.7, 0, 0.7), rF: V(-0.2, 0.3, 0.93), yaw: 0.1, drop: 0.14 },
  follow: { ...READY, rU: V(0.2, 0, 0.97), rF: V(0.6, 0.2, 0.77), yaw: 0.45, drop: 0.12 },
};
// 反手側身：拍子在身體左邊
const BSIDE = {
  prep: { ...READY, rU: V(0.55, -0.2, 0.8), rF: V(0.7, 0.35, 0.6), lU: V(0.6, -0.6, -0.5), lF: V(0.4, -0.8, -0.4), yaw: 1.0, drop: 0.14 },
  hit: { ...READY, rU: V(0.2, -0.1, 0.97), rF: V(0.45, 0.25, 0.85), lU: V(0.6, -0.6, -0.5), lF: V(0.4, -0.8, -0.4), yaw: 0.1, drop: 0.14 },
  follow: { ...READY, rU: V(-0.45, 0, 0.9), rF: V(-0.6, 0.3, 0.75), lU: V(0.6, -0.6, -0.5), lF: V(0.4, -0.8, -0.4), yaw: -0.45, drop: 0.12 },
};
// 發球站姿
const SERVE_B = { // 反手發短球：右腳在前，拍子橫在身體前方，左手拿球在拍前
  ...READY, rT: V(-0.15, -0.88, 0.45), rS: V(-0.1, -0.97, -0.1), lT: V(0.18, -0.95, -0.25), lS: V(0.1, -0.95, -0.3),
  rU: V(-0.1, -0.75, 0.65), rF: V(0.55, -0.3, 0.78), lU: V(0.3, -0.45, 0.85), lF: V(0, 0.15, 0.99), lean: 0.22, drop: 0.06, tw: 0, ltw: 0,
};
const SERVE_F = { // 正手發高遠：左腳在前，拍子往後拉
  ...READY, lT: V(0.15, -0.88, 0.45), lS: V(0.1, -0.97, -0.1), rT: V(-0.2, -0.92, -0.3), rS: V(-0.1, -0.95, -0.3),
  rU: V(-0.6, -0.45, -0.6), rF: V(-0.4, 0.3, -0.85), lU: V(0.3, -0.2, 0.93), lF: V(0.1, 0, 1), lean: 0.1, yaw: -0.4, drop: 0.04, tw: 0, ltw: 0,
};
const RECEIVE = { // 接發球：左腳在前、拍子舉高、重心低
  ...READY, lT: V(0.18, -0.85, 0.5), lS: V(0.1, -0.97, -0.15), rT: V(-0.22, -0.9, -0.35), rS: V(-0.1, -0.9, -0.42),
  rU: V(-0.6, -0.3, 0.55), rF: V(-0.1, 0.92, 0.35), lU: V(0.6, -0.2, 0.6), lF: V(0.3, 0.3, 0.9), lean: 0.3, drop: 0.16,
};
const SERVEB = {
  prep: SERVE_B,
  hit: { ...SERVE_B, rU: V(0.05, -0.7, 0.7), rF: V(0.3, -0.1, 0.95) },
  follow: { ...SERVE_B, rU: V(0.05, -0.6, 0.8), rF: V(0.2, 0.3, 0.93) },
};
const SERVEF = {
  prep: SERVE_F,
  hit: { ...SERVE_F, rU: V(-0.3, -0.75, 0.6), rF: V(-0.1, -0.4, 0.9), yaw: 0 },
  follow: { ...SERVE_F, rU: V(0.2, 0.5, 0.85), rF: V(0.4, 0.8, 0.4), yaw: 0.4, rT: V(-0.2, -0.85, 0.45), lT: V(0.15, -0.95, -0.2) },
};
// 花式：背後接球（拍子繞到背後）、胯下球（彎腰從兩腿之間打）、魚躍救球（撲出去、趴一下）
const BEHIND = {
  prep: { ...READY, rU: V(-0.55, -0.5, -0.67), rF: V(0.5, -0.3, -0.81), lU: V(0.5, -0.4, 0.77), lF: V(0.2, 0, 0.98), yaw: -0.3, lean: 0.25, drop: 0.15 },
  hit: { ...READY, rU: V(-0.35, -0.55, -0.76), rF: V(0.85, -0.05, -0.52), lU: V(0.55, -0.3, 0.78), lF: V(0.2, 0.1, 0.97), yaw: 0.3, lean: 0.25, drop: 0.15 },
  follow: { ...READY, rU: V(-0.1, -0.6, -0.8), rF: V(0.9, 0.2, -0.38), lU: V(0.5, -0.4, 0.77), lF: V(0.2, 0, 0.98), yaw: 0.5, lean: 0.2, drop: 0.12 },
};
const TWEENER = {
  prep: { ...READY, rU: V(-0.15, -0.95, 0.25), rF: V(0.05, -0.7, 0.71), lU: V(0.5, -0.5, 0.7), lF: V(0.3, -0.2, 0.93), lean: 1.0, drop: 0.25 },
  hit: { ...READY, rU: V(-0.05, -0.9, -0.43), rF: V(0.05, -0.45, -0.89), lU: V(0.5, -0.4, 0.77), lF: V(0.3, -0.1, 0.95), lean: 1.15, drop: 0.28 },
  follow: { ...READY, rU: V(0, -0.7, -0.71), rF: V(0, -0.1, -0.99), lU: V(0.5, -0.4, 0.77), lF: V(0.3, 0, 0.95), lean: 0.9, drop: 0.22 },
};
const DIVE = {
  prep: { ...READY, ...LUNGE, rU: V(-0.3, -0.3, 0.9), rF: V(-0.1, -0.2, 0.97), lU: V(0.6, -0.1, 0.79), lF: V(0.4, 0, 0.92), lean: 0.6 },
  hit: { ...READY, rU: V(-0.2, 0.85, 0.48), rF: V(-0.1, 0.9, 0.42), lU: V(0.3, 0.75, 0.59), lF: V(0.2, 0.85, 0.49), lean: 0.1, drop: 0 },
  follow: { ...READY, rU: V(-0.25, 0.8, 0.55), rF: V(-0.1, 0.75, 0.65), lU: V(0.35, 0.6, 0.72), lF: V(0.2, 0.4, 0.89), lean: 0.15, drop: 0 },
  long: true, // 撲倒後要停一下才起來
};
// 每個動作的手腕和前臂：準備時扣腕、外旋 → 擊球時甩腕、內旋 → 收拍
const WRIST = {
  OVER: [[-1.0, -0.5], [0.05, 0.35], [0.7, 0.9]],
  RTH: [[-1.0, -0.5], [0.05, 0.35], [0.7, 0.9]],
  BOVER: [[0.7, 0.6], [0, 0], [-0.6, -0.6]],
  UNDER: [[-0.7, -0.3], [0, 0.2], [0.5, 0.6]],
  LIFT: [[-1.1, -0.5], [0, 0.25], [0.9, 0.8]],
  KILL: [[-0.4, -0.2], [0.6, 0.3], [0.95, 0.5]],   // 撲球準備：手腕只微扣（拍頭朝上在身前）
  BKILL: [[0.4, 0.25], [-0.5, 0], [-0.85, -0.3]],
  BLIFT: [[0.9, 0.6], [0, 0], [-0.8, -0.6]],
  BUNDER: [[0.5, 0.4], [0, 0], [-0.4, -0.3]],
  SIDE: [[-0.85, -0.4], [0, 0.25], [0.6, 0.75]],
  BSIDE: [[0.7, 0.5], [0, 0], [-0.5, -0.5]],
  SERVEB: [[0.35, 0], [-0.1, 0], [0, 0]],
  NET: [[-0.45, -0.7], [-0.1, -0.5], [0, -0.4]],
  BNET: [[0.4, 0.6], [0.05, 0.45], [0, 0.4]],
  BEHIND: [[0.5, 0.4], [0, 0.2], [-0.3, 0]],
  TWEENER: [[-0.5, 0], [0.3, 0], [0.4, 0]],
  DIVE: [[-0.6, -0.4], [0, 0], [0.2, 0.2]],
  SERVEF: [[-0.8, -0.3], [0, 0.2], [0.6, 0.6]],
};
for (const [name, K] of Object.entries({ OVER, RTH, BOVER, UNDER, BUNDER, LIFT, BLIFT, KILL, BKILL, SIDE, BSIDE, SERVEB, SERVEF, NET, BNET, BEHIND, TWEENER, DIVE })) {
  ['prep', 'hit', 'follow'].forEach((ph, i) => { K[ph] = { ...K[ph], wZ: WRIST[name][i][0], tw: WRIST[name][i][1] }; });
  if (K.drop) K.drop = { ...K.drop, wZ: -1.25, tw: -0.75 }; // 拍子下垂：手腕往後扣、前臂外旋
}
const RECOVER = { ...READY, rT: V(-0.18, -0.85, 0.48), rS: V(-0.1, -0.97, 0.05), lT: V(0.2, -0.92, -0.05), lS: V(0.1, -0.97, -0.15),
  rU: V(-0.4, -0.5, 0.75), rF: V(0, 0.5, 0.86), lean: 0.12, drop: 0.18 };
const KINDS = { behind: BEHIND, tweener: TWEENER, dive: DIVE, net: NET, bnet: BNET, over: OVER, rth: RTH, bover: BOVER, under: UNDER, bunder: BUNDER, lift: LIFT, blift: BLIFT, kill: KILL, bkill: BKILL, side: SIDE, bside: BSIDE, serveB: SERVEB, serveF: SERVEF };
const STANCES = { B: SERVE_B, F: SERVE_F, R: RECEIVE };
if (typeof window !== 'undefined') window.__POSE = { READY, RELAX, ALERT, DEFENSE, NETUP, MOVE_ARMS, RECEIVE, SERVE_B, SERVE_F, RECOVER }; // 測試用：調姿勢

// ---------- 魚躍救球（照教學影片＋林丹的魚躍）----------
// 蹬地壓低 → 低低地平飛出去（超人姿勢、拍子伸直往前）→ 雙手彎著先著地緩衝、全身同時貼地 → 趴一下 → 撐起來（手和膝蓋著地）→ 右腳往前踩、站起來
// t：擊球後幾秒；p：身體往前倒的角度；l：抬高；f：往前飛了全程的幾成；A：手臂、L：腿（身體座標）
const DV = {
  REACH: { rU: V(-0.25, 0.15, 0.96), rF: V(-0.15, 0.2, 0.97), lU: V(0.35, 0.2, 0.92), lF: V(0.25, 0.35, 0.9) },
  SUPER: { rU: V(-0.2, 0.75, 0.63), rF: V(-0.1, 0.85, 0.5), lU: V(0.3, 0.6, 0.74), lF: V(0.25, 0.55, 0.8) },
  CUSH: { rU: V(-0.45, 0.1, 0.89), rF: V(-0.1, 0.97, 0.2), lU: V(0.45, 0.1, 0.89), lF: V(0.1, 0.97, 0.2) },
  PUSH: { rU: V(-0.25, -0.32, 0.92), rF: V(-0.22, -0.32, 0.92), lU: V(0.25, -0.32, 0.92), lF: V(0.22, -0.32, 0.92) },
  LAUNCH: { rT: V(-0.12, -0.7, 0.7), rS: V(-0.1, -0.97, -0.2), lT: V(0.12, -0.95, -0.3), lS: V(0.1, -0.9, -0.43) },
  FLY: { rT: V(-0.12, -0.99, -0.06), rS: V(-0.1, -0.99, -0.12), lT: V(0.12, -0.99, -0.02), lS: V(0.1, -0.98, -0.18) },
  KNEEL: { rT: V(-0.12, -0.32, 0.94), rS: V(-0.06, -0.95, -0.32), lT: V(0.12, -0.32, 0.94), lS: V(0.06, -0.95, -0.32) },
  RISE: { rT: V(-0.15, -0.45, 0.88), rS: V(-0.1, -0.97, 0.15), lT: V(0.12, -0.6, 0.8), lS: V(0.06, -0.9, -0.43) },
};
const DIVE_KEYS = [
  { t: 0, p: 0.35, l: -0.12, f: 0.08, A: 'REACH', L: 'LAUNCH' },
  { t: 0.1, p: 1.0, l: 0.22, f: 0.4, A: 'SUPER', L: 'FLY' },
  { t: 0.22, p: 1.42, l: 0.26, f: 0.78, A: 'SUPER', L: 'FLY' },
  { t: 0.32, p: 1.52, l: 0.1, f: 0.95, A: 'CUSH', L: 'FLY' },
  { t: 0.42, p: 1.52, l: 0.1, f: 1, A: 'CUSH', L: 'FLY' },
  { t: 0.72, p: 1.52, l: 0.1, f: 1, A: 'CUSH', L: 'FLY' },
  { t: 0.9, p: 1.25, l: 0.17, f: 1, A: 'PUSH', L: 'KNEEL' },
  { t: 1.08, p: 0.6, l: 0.0, f: 1, A: 'READY', L: 'RISE' },
  { t: 1.3, p: 0, l: 0, f: 1, A: 'READY', L: 'READY' },
];
// 側撲（羽球最常見，使用者給的影片）：身體還是面向網、往球的那一側整個人倒過去（頭先往球那邊）、
// 拿拍手伸到底；下面那隻腳彎著擦地、上面那隻腳往後上踢；側身落地、順勢翻到背上、再撐起來站好
// 以下是往右（正手）撲的版本；往左撲時左右鏡像（mirrorSet）
const DS = {
  REACH: { rU: V(-0.55, 0.3, 0.78), rF: V(-0.45, 0.25, 0.86), lU: V(0.5, -0.4, 0.77), lF: V(0.3, 0.1, 0.95) },
  STRETCH: { rU: V(-0.25, 0.93, 0.27), rF: V(-0.15, 0.96, 0.24), lU: V(-0.15, -0.35, 0.92), lF: V(-0.45, 0.2, 0.87) },
  BRACE: { rU: V(-0.25, 0.93, 0.27), rF: V(-0.15, 0.96, 0.24), lU: V(-0.25, -0.2, 0.95), lF: V(-0.6, 0.35, 0.72) },
  TUCK: { rU: V(-0.5, 0.75, 0.43), rF: V(-0.3, 0.9, 0.3), lU: V(0.5, 0.2, 0.84), lF: V(0.3, 0.6, 0.74) },
  PUSH: { rU: V(-0.4, 0.5, 0.77), rF: V(-0.2, 0.7, 0.68), lU: V(-0.55, -0.55, 0.63), lF: V(-0.6, -0.55, 0.58) },
  LAUNCH: { rT: V(-0.3, -0.75, 0.6), rS: V(-0.15, -0.97, -0.2), lT: V(0.25, -0.92, -0.3), lS: V(0.15, -0.9, -0.4) },
  FLY: { rT: V(-0.15, -0.55, 0.82), rS: V(-0.1, -0.97, -0.22), lT: V(0.45, -0.8, -0.4), lS: V(0.4, -0.75, -0.53) }, // 下面（右）腳彎著擦地、上面（左）腳往後上踢
  ROLL: { rT: V(-0.2, -0.25, 0.95), rS: V(-0.12, -0.95, -0.28), lT: V(0.2, -0.15, 0.97), lS: V(0.12, -0.9, -0.42) },   // 翻到背上：兩膝縮起來
  TUCK2: { rT: V(-0.15, -0.1, 0.99), rS: V(-0.1, -0.93, -0.35), lT: V(0.12, -0.05, 0.99), lS: V(0.08, -0.9, -0.43) }, // 兩膝縮到胸前（準備起身）
  KNEEL1: { rT: V(-0.12, -0.99, 0.05), rS: V(-0.08, -0.12, -0.99), lT: V(0.15, -0.2, 0.97), lS: V(0.1, -0.99, 0.02) },   // 單膝跪：下面（右）膝著地、上面（左）腳踩在前面
  RISE: { rT: V(-0.15, -0.9, -0.3), rS: V(-0.1, -0.9, -0.42), lT: V(0.15, -0.6, 0.79), lS: V(0.1, -0.99, -0.05) },
};
const mirrorV = v => new THREE.Vector3(-v.x, v.y, v.z);
const mirrorSet = S => { const o = {}; for (const k in S) { const n = k[0] === 'r' ? 'l' + k.slice(1) : k[0] === 'l' ? 'r' + k.slice(1) : k; o[n] = mirrorV(S[k]); } return o; };
const DSL = {}; for (const k in DS) DSL[k] = mirrorSet(DS[k]);
// r：往球那側倒下去的角度；s：沿身體長軸翻（翻到背上）；l、f 同上
const SIDE_KEYS = [
  { t: 0, r: 0.3, s: 0, l: -0.1, f: 0.06, A: 'REACH', L: 'LAUNCH' },
  { t: 0.1, r: 0.95, s: 0, l: 0.26, f: 0.4, A: 'STRETCH', L: 'FLY' },
  { t: 0.22, r: 1.3, s: 0, l: 0.32, f: 0.78, A: 'STRETCH', L: 'FLY' },
  { t: 0.32, r: 1.5, s: 0.15, l: 0.13, f: 0.95, A: 'BRACE', L: 'FLY' },
  { t: 0.46, r: 1.55, s: 1.05, l: 0.15, f: 1.02, A: 'TUCK', L: 'ROLL' },
  { t: 0.6, r: 1.55, s: 1.2, l: 0.15, f: 1.04, A: 'TUCK', L: 'ROLL' },
  { t: 0.75, r: 1.5, s: 0.1, l: 0.13, f: 1.04, A: 'BRACE', L: 'TUCK2' },  // 翻回側躺、膝蓋縮起來
  { t: 0.9, r: 1.1, s: 0, l: -0.24, f: 1.04, A: 'PUSH', L: 'TUCK2' },    // 下面那隻手撐地、側坐起來
  { t: 1.04, r: 0.3, s: 0, l: -0.42, f: 1.04, A: 'PUSH', L: 'KNEEL1' },  // 單膝跪、另一腳踩在前面
  { t: 1.17, r: 0.08, s: 0, l: -0.2, f: 1.04, A: 'READY', L: 'RISE' },  // 踩著前腳站起來
  { t: 1.3, r: 0, s: 0, l: 0, f: 1.04, A: 'READY', L: 'READY' },
];
function sideFrame(d, S) {
  const tt = Math.max(0, d);
  let i = 0; while (i < SIDE_KEYS.length - 2 && tt > SIDE_KEYS[i + 1].t) i++;
  const a = SIDE_KEYS[i], b = SIDE_KEYS[i + 1], u = smooth(clampN((tt - a.t) / (b.t - a.t), 0, 1));
  const lib = S > 0 ? DS : DSL, set = n => (n === 'READY' ? READY : lib[n]);
  const mixV = (A, B, keys) => { const o = {}; for (const n of keys) o[n] = A[n].clone().lerp(B[n], u).normalize(); return o; };
  return {
    side: S, p: 0, r: a.r + (b.r - a.r) * u, s: a.s + (b.s - a.s) * u, l: a.l + (b.l - a.l) * u, f: a.f + (b.f - a.f) * u,
    arms: mixV(set(a.A), set(b.A), ['rU', 'rF', 'lU', 'lF']), legs: mixV(set(a.L), set(b.L), ['rT', 'rS', 'lT', 'lS']),
  };
}
export const DIVE_LEN = 1.3;
function diveFrame(d) {
  const tt = Math.max(0, d);
  let i = 0; while (i < DIVE_KEYS.length - 2 && tt > DIVE_KEYS[i + 1].t) i++;
  const a = DIVE_KEYS[i], b = DIVE_KEYS[i + 1], u = smooth(clampN((tt - a.t) / (b.t - a.t), 0, 1));
  const set = n => (n === 'READY' ? READY : DV[n]);
  const mixV = (A, B, k) => { const o = {}; for (const n in A) o[n] = A[n].clone().lerp(B[n], u).normalize(); return o; };
  const pick = (src, keys) => { const o = {}; for (const n of keys) o[n] = src[n]; return o; };
  return {
    p: a.p + (b.p - a.p) * u, l: a.l + (b.l - a.l) * u, f: a.f + (b.f - a.f) * u,
    arms: mixV(pick(set(a.A), ['rU', 'rF', 'lU', 'lF']), pick(set(b.A), ['rU', 'rF', 'lU', 'lF'])),
    legs: mixV(pick(set(a.L), ['rT', 'rS', 'lT', 'lS']), pick(set(b.L), ['rT', 'rS', 'lT', 'lS'])),
  };
}

function mixPose(a, b, t) {
  const o = {};
  for (const k in a) {
    if (a[k] instanceof THREE.Vector3) o[k] = a[k].clone().lerp(b[k] ?? a[k], t).normalize();
    else o[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * t;
  }
  return o;
}
const smooth = t => t * t * (3 - 2 * t);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = x => Math.atan2(Math.sin(x), Math.cos(x));

// 揮拍時間軸：d＝離擊球那一刻幾秒
function swingPose(kind, d, from, lunge) {
  const K = KINDS[kind] || OVER;
  const keys = K.drop ? [[-0.5, from], [-0.26, K.prep], [-0.11, K.drop], [-0.05, K.drop], [0, K.hit], [0.2, K.follow]] // 頭頂：準備 → 拍子下沉到背後（停一下）→ 往上甩擊球 → 收拍
                     : [[-0.4, from], [K.prepT ?? -0.14, K.prep], [0, K.hit], [0.2, K.follow]];
  if (K.hold) keys.push([K.hold, K.follow]); // 收拍停一下
  const h = K.hold ? K.hold - 0.2 : 0;
  if (K.long) keys.push([0.85, K.follow], [1.2, READY]); // 魚躍：趴一下再起來
  else if (lunge) keys.push([0.42 + h, RECOVER], [0.75 + h, READY]); // 跨步打完：先蹬回來再回準備
  else keys.push([0.7 + h, READY]);
  if (d <= keys[0][0] || d >= keys[keys.length - 1][0]) return null; // （花式動作從擊球那一刻開始）
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
    if (d >= t0 && d < t1) return mixPose(p0, p1, smooth((d - t0) / (t1 - t0)));
  }
  return null;
}

// ---------- 讀檔 ----------
export async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  let gltf;
  if (url.startsWith('data:')) { // 手機版：資料直接嵌在程式裡（頁面不允許用 data: 網址讀取，所以自己解碼）
    const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    gltf = await loader.parseAsync(buf.buffer, '');
  } else gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.userData.outlineParameters = { visible: false }; // MToon 自己有描邊
    }
  });
  return vrm;
}

// ---------- 角色動作 ----------
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qT = new THREE.Quaternion(), qY = new THREE.Quaternion();
const YAXIS = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const add = (v, x, y, z) => v.add(new THREE.Vector3(x, y, z)).normalize();
// 給一根往下的骨頭：指向 down、正面朝 fwd（避免腿自己扭轉，膝蓋才會往前彎）
const _m4 = new THREE.Matrix4();
function basisQ(down, fwd, out) {
  const y = down.clone().negate().normalize();
  const z = fwd.clone().addScaledVector(y, -fwd.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(_m4.makeBasis(x, y, z));
}
// 繞 Y 軸轉 th（身體座標 ↔ 世界座標）
const rotY = (x, z, th) => ({ x: x * Math.cos(th) + z * Math.sin(th), z: -x * Math.sin(th) + z * Math.cos(th) });
// 站姿：每隻腳在身體座標的位置 [往右, 往前]（公尺）
const FEET = {
  base: { R: [0.27, 0.08], L: [-0.27, -0.06] }, // 比肩寬（影片比對）
  B: { R: [0.17, 0.3], L: [-0.17, -0.22] },   // 反手發短球：右腳在前
  net: { R: [0.24, 0.24], L: [-0.24, -0.2] },  // 打完網前球／吊球：右腳在前（準備上網）
  F: { R: [0.22, -0.25], L: [-0.15, 0.25] },  // 正手發高遠：左腳在前
  R: { R: [0.2, -0.22], L: [-0.18, 0.3] },    // 接發球：左腳在前
};
const LUNGE_KINDS = new Set(['under', 'bunder', 'lift', 'blift', 'kill', 'bkill', 'side', 'bside', 'net', 'bnet', 'dive']);

export class Rig {
  constructor(vrm, racket, facing) {
    this.vrm = vrm;
    this.root = new THREE.Group();
    this.root.add(vrm.scene);
    // 舊版 VRM 0.x 的模型面朝 -Z、骨架座標是新版繞垂直軸轉 180°：模型多轉 180°，每格算完的骨頭旋轉再換成舊版方向（three-vrm 官方做法）
    this.v0 = vrm.meta?.metaVersion === '0';
    this.faceRot = facing < 0 ? Math.PI : 0; // 近端球員面向 -Z
    vrm.scene.rotation.y = this.faceRot + (this.v0 ? Math.PI : 0);
    this.allBones = Object.values(vrm.humanoid.normalizedHumanBones || {}).map(h => h && h.node).filter(Boolean);
    const b = n => vrm.humanoid.getNormalizedBoneNode(n);
    this.b = {
      hips: b('hips'), spine: b('spine'), chest: b('chest'), upperChest: b('upperChest'), neck: b('neck'), head: b('head'),
      rSh: b('rightShoulder'), rU: b('rightUpperArm'), rF: b('rightLowerArm'), rH: b('rightHand'),
      lSh: b('leftShoulder'), lU: b('leftUpperArm'), lF: b('leftLowerArm'), lH: b('leftHand'),
      rT: b('rightUpperLeg'), rS: b('rightLowerLeg'), rFt: b('rightFoot'),
      lT: b('leftUpperLeg'), lS: b('leftLowerLeg'), lFt: b('leftFoot'),
    };
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const head = new THREE.Vector3(); this.b.neck.getWorldPosition(head);
    this.scale = 1.43 / Math.max(1, head.y); // 脖子約 1.43 m → 身高約 170 cm（真實選手身高；場地是正式尺寸）
    vrm.scene.scale.setScalar(this.scale);
    // 腿長、髖關節位置（腳踩地的 IK 要用）
    vrm.scene.updateMatrixWorld(true);
    const wp = n => { const v = new THREE.Vector3(); n.getWorldPosition(v); const r = rotY(v.x, v.z, -this.faceRot); return new THREE.Vector3(r.x, v.y, r.z); };
    const pRT = wp(this.b.rT), pRS = wp(this.b.rS), pRF = wp(this.b.rFt), pLT = wp(this.b.lT);
    this.hipOff = { R: pRT, L: pLT };
    this.L1 = pRT.distanceTo(pRS); this.L2 = pRS.distanceTo(pRF); this.ankleY = pRF.y;
    racket.rotation.set(0, 0, Math.PI / 2);
    racket.scale.setScalar(0.9 / this.scale); // 拍子全長約 67 公分（真實尺寸）
    const holder = new THREE.Group(); holder.position.set(-0.06, 0, 0); holder.rotation.y = 0.5;
    holder.add(racket);
    if (this.v0) { const fix = new THREE.Group(); fix.rotation.y = Math.PI; fix.add(holder); this.b.rH.add(fix); } // 舊版手的座標轉 180°
    else this.b.rH.add(holder);
    this.yaw = 0;
    this.fingers = [];
    for (const side of ['right', 'left']) {
      for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
        for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
          const n = b(side + f + seg);
          if (n) this.fingers.push([n, side === 'right' ? 1.25 : -0.45]);
        }
      }
    }
    this.thumbs = [[b('rightThumbProximal'), 1], [b('rightThumbDistal'), 1], [b('leftThumbProximal'), -1]].filter(t => t[0]);
    // 腳是踩在地上算出來的，不做平滑（不然會滑）
    this.smoothBones = [this.b.spine, this.b.chest, this.b.neck, this.b.head, this.b.rU, this.b.rF, this.b.rH, this.b.lU, this.b.lF, this.b.lH].filter(Boolean);
    this.feet = null;
  }

  // ---------- 腳步：一步一步踩，踩著的腳不動 ----------
  footPos(f, t) {
    const F = this.feet[f];
    if (!F.sw) return { x: F.x, y: this.ankleY, z: F.z };
    const p = clampN((t - F.t0) / F.dur, 0, 1), s = p * p * (3 - 2 * p);
    return { x: F.fx + (F.tx - F.fx) * s, y: this.ankleY + F.lift * Math.sin(Math.PI * p), z: F.fz + (F.tz - F.fz) * s };
  }
  step(f, tx, tz, t, dur, lift, toe) {
    const c = this.footPos(f, t);
    Object.assign(this.feet[f], { sw: true, fx: c.x, fz: c.z, tx, tz, t0: t, dur, lift, toe });
  }
  updateFeet(a, t, an, th, sp, d) {
    const vel = a.vel || { x: 0, z: 0 }, p = a.pos;
    const set = FEET[an.stance] || (an.footSet && FEET[an.footSet]) || FEET.base;
    const wide = 1 + 0.4 * (an.alert || 0);
    const rv = { x: -Math.cos(th), z: Math.sin(th) }, fv = { x: Math.sin(th), z: Math.cos(th) };
    const W = (f, w = wide, ahead = 0.26) => {
      const o = set[f];
      return { x: p.x + vel.x * ahead + rv.x * o[0] * w + fv.x * o[1], z: p.z + vel.z * ahead + rv.z * o[0] * w + fv.z * o[1] };
    };
    if (!this.feet) {
      this.feet = {};
      for (const f of ['R', 'L']) { const w = W(f, 1, 0); this.feet[f] = { x: w.x, z: w.z, sw: false, toe: th }; }
    }
    for (const f of ['R', 'L']) { // 落地
      const F = this.feet[f];
      if (F.sw && t >= F.t0 + F.dur) { F.sw = false; F.x = F.tx; F.z = F.tz; }
    }
    // 啟動墊步：雙腳同時離地，落地站得稍寬
    if (an.split > 0 && an.split < 0.3 && this.splitFor !== a.splitT) {
      this.splitFor = a.splitT;
      for (const f of ['R', 'L']) { const w = W(f, 1.45, 0.1); this.step(f, w.x, w.z, t, 0.2, 0.06, th); }
      return;
    }
    // 花式動作的腳步（優先於排好的步法）
    if (sp && (a.swingKind === 'behind' || a.swingKind === 'tweener') && this.fancyFor !== a.swingT && d > -0.15) {
      this.fancyFor = a.swingT;
      if (a.swingKind === 'tweener') { // 雙腳往兩側張開成大跨步，球從兩腿之間過
        for (const [f, sgn] of [['R', 1], ['L', -1]]) this.step(f, p.x + rv.x * 0.45 * sgn - fv.x * 0.05, p.z + rv.z * 0.45 * sgn - fv.z * 0.05, t, 0.1, 0.06, th);
      } else if (a.contactP) { // 右腳交叉往身後左側跨，身體轉過去
        const cx = a.contactP.x - p.x, cz = a.contactP.z - p.z, dl = Math.hypot(cx, cz) || 1, k = Math.min(0.7, dl);
        this.step('R', p.x + cx / dl * k, p.z + cz / dl * k, t, 0.12, 0.1, Math.atan2(cx, cz));
      }
      this.lungeHold = a.swingT + 0.5;
    }
    if (this.lungeHold && t < this.lungeHold && (a.swingKind === 'behind' || a.swingKind === 'tweener')) return;
    // 有排好的步法：照著踩（真實羽球步法），不自己補步
    if (a.fw && t <= a.fw.end + 0.12) {
      for (const m of a.fw.moves) if (!m.started && t >= m.t0) {
        m.started = true; this.step(m.foot, m.to.x, m.to.z, m.t0, m.dur, m.lift, m.toe ?? th);
        if (m.lunge && m.foot === 'R') this.dragBack(m.to, m.body, m.t0, m.dur, a.side); // 跨步：後腳往後滑、伸直
      }
      this.lastStep = t;
      return;
    }
    // 跨步：拿拍腳（右腳）朝球跨出去，腳跟在擊球前一瞬間落地
    const netK = a.swingKind === 'net' || a.swingKind === 'bnet' || (['lift', 'blift', 'kill', 'bkill'].includes(a.swingKind) && a.contactP && Math.abs(a.contactP.z) < 2.6); // 網前一定是右腳在前
    if (sp && (a.lunge || netK) && a.contactP && LUNGE_KINDS.has(a.swingKind) && this.lungeFor !== a.swingT && d > -0.32 && d < 0.05) {
      this.lungeFor = a.swingT;
      const cx = a.contactP.x - p.x, cz = a.contactP.z - p.z, dist = Math.hypot(cx, cz) || 1;
      const reach = clampN(dist - 0.3, netK ? 0.4 : 0.5, a.swingKind === 'kill' || a.swingKind === 'bkill' ? 0.85 : 1.15); // 撲球最後一步大步跨、身體保持高
      this.step('R', p.x + (cx / dist) * reach, p.z + (cz / dist) * reach, t, Math.max(0.08, -0.03 - d), 0.1, Math.atan2(cx, cz));
      if (reach > 0.6 && !(a.swingKind === 'kill' || a.swingKind === 'bkill')) this.dragBack({ x: p.x + (cx / dist) * reach, z: p.z + (cz / dist) * reach }, p, t, Math.max(0.08, -0.03 - d), a.side);
      this.lungeHold = a.swingT + 0.42; // 打完才蹬回來
      this.lungeDist = reach;
    }
    // 腳快要被拉直了（身體走太遠）：這隻腳馬上踩過去，跨步的停留也提早結束
    const reachMax = (this.L1 + this.L2) * 0.82;
    for (const f of ['R', 'L']) {
      const F = this.feet[f];
      if (F.sw) continue;
      const off = this.hipOff[f], ho = rotY(off.x, off.z, th);
      const lim = f === 'R' && this.lungeHold && t < this.lungeHold ? Math.max(reachMax, this.lungeDist + 0.35) : reachMax; // 跨出去的腳本來就遠
      if (Math.hypot(F.x - (p.x + ho.x), F.z - (p.z + ho.z)) > lim) {
        this.lungeHold = 0;
        const w = W(f, wide, 0.2);
        this.step(f, w.x, w.z, t, 0.12, 0.08, th);
        this.lastStep = t;
      }
    }
    if (this.lungeHold && t < this.lungeHold) return;
    this.lungeHold = 0;
    if (this.feet.R.sw || this.feet.L.sw) return;
    // 一般步伐：哪隻腳離它該在的位置太遠就踩過去；側移時領頭的腳先動（並步，不交叉）
    const spd = Math.hypot(vel.x, vel.z);
    const thr = spd > 0.3 ? 0.11 : 0.32;
    const movingRight = vel.x * rv.x + vel.z * rv.z > 0;
    let best = null, bd = thr;
    for (const f of ['R', 'L']) {
      const w = W(f);
      const dd = Math.hypot(this.feet[f].x - w.x, this.feet[f].z - w.z) + ((f === 'R') === movingRight ? 0.03 : 0);
      if (dd > bd) { bd = dd; best = f; }
    }
    if (best && t - (this.lastStep ?? -9) > 0.04) {
      let w = W(best, wide, 0.45);
      // 步幅上限：落腳點不能離髖關節太遠，腿才不會被拉直
      const dur = clampN(0.09 + Math.hypot(this.feet[best].x - w.x, this.feet[best].z - w.z) * 0.12, 0.1, 0.22);
      const off = this.hipOff[best], ho = rotY(off.x, off.z, th);
      const hx = p.x + vel.x * dur + ho.x, hz = p.z + vel.z * dur + ho.z, lim = (this.L1 + this.L2) * 0.62;
      const ex = w.x - hx, ez = w.z - hz, el = Math.hypot(ex, ez);
      if (el > lim) w = { x: hx + ex / el * lim, z: hz + ez / el * lim };
      this.step(best, w.x, w.z, t, dur, spd > 0.3 ? 0.07 + 0.035 * spd : 0.05, th);
      this.lastStep = t;
    }
  }
  // 跨步時後腳（左腳）貼地往後滑：離身體約 0.55 m、在跨步方向的正後方偏左，後腿才會伸直、膝蓋不會跪到地上
  dragBack(front, body, t0, dur, side = 1) {
    const F = this.feet.L, dx = front.x - body.x, dz = front.z - body.z, dl = Math.hypot(dx, dz) || 1;
    if (-dz * side < -0.25 * dl) return; // 往後退的跨步（後場）：不滑，不然兩腳會劈開
    const ux = dx / dl, uz = dz / dl, lx = -uz, lz = ux; // 跨步方向、往左
    const tx = body.x - ux * 0.55 + lx * 0.12, tz = body.z - uz * 0.55 + lz * 0.12;
    if (Math.hypot(F.x - tx, F.z - tz) < 0.12) return;
    this.step('L', tx, tz, t0 + dur * 0.3, dur * 1.1, 0.0, Math.atan2(ux, uz) + 0.9); // 不抬腳（拖地）、腳尖朝側邊
  }
  // 兩段式 IK：給髖關節和腳踝位置，算出大腿、小腿方向（膝蓋朝腳尖方向彎）
  legIK(f, rootPos, th, foot, toe) {
    const off = this.hipOff[f], ho = rotY(off.x, off.z, th);
    const H = new THREE.Vector3(rootPos.x + ho.x, rootPos.y + off.y, rootPos.z + ho.z);
    const D = new THREE.Vector3(foot.x, foot.y, foot.z).sub(H);
    let d = D.length();
    const maxd = (this.L1 + this.L2) * 0.999;
    if (d > maxd) { D.multiplyScalar(maxd / d); d = maxd; }
    const dir = D.clone().divideScalar(d || 1);
    const bend = new THREE.Vector3(Math.sin(toe), 0, Math.cos(toe));
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-4) bend.set(Math.sin(th), 0, Math.cos(th));
    bend.normalize();
    const cosA = clampN((this.L1 * this.L1 + d * d - this.L2 * this.L2) / (2 * this.L1 * (d || 1)), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const K = H.clone().addScaledVector(dir, this.L1 * cosA).addScaledVector(bend, this.L1 * sinA);
    const thigh = K.clone().sub(H).normalize(), shin = H.clone().add(D).sub(K).normalize();
    const toModel = v => { const r = rotY(v.x, v.z, -th); return new THREE.Vector3(r.x, v.y, r.z).normalize(); };
    return [toModel(thigh), toModel(shin), toModel(bend)];
  }

  // a：球員狀態（a.anim 由遊戲每格算好）；t：遊戲時間
  // 舊版 VRM：骨頭旋轉在「新版方向」和「舊版方向」之間換算（x、z 分量反號，換兩次＝還原）
  flipV0() { if (this.v0) for (const n of this.allBones) { n.quaternion.x = -n.quaternion.x; n.quaternion.z = -n.quaternion.z; } }
  update(a, t, dt, jumpY) {
    this.flipV0(); // 換回新版方向來算這一格
    const an = a.anim || {};
    const speed = an.speed || 0;
    let base = an.relax > 0 ? mixPose(READY, RELAX, an.relax) : READY;
    if (an.stance) base = STANCES[an.stance];
    else if (an.alert > 0) base = mixPose(base, an.mode === 'def' ? DEFENSE : an.mode === 'net' ? NETUP : ALERT, an.alert);
    const antic = an.antic || 0, aKind = an.planKind;
    const from = antic > 0 && KINDS[aKind] ? mixPose(base, KINDS[aKind].prep, antic) : base;
    let pose = from;
    const d = t - a.swingT, kind = a.swingKind || 'over';
    const lg = (!!a.lunge || kind === 'net' || kind === 'bnet') && LUNGE_KINDS.has(kind);
    // 發力順序：腿和身體先轉（早 0.06 秒），手臂跟著，手腕最後（晚 0.03 秒）
    const spArm = swingPose(kind, d, from, lg), spBody = swingPose(kind, d + 0.06, from, lg), spWrist = swingPose(kind, d - 0.03, from, lg);
    const sp = spArm || spBody;
    if (sp) {
      const A = spArm || sp, Bd = spBody || sp, W = spWrist || sp;
      pose = { ...Bd, rU: A.rU, rF: A.rF, lU: A.lU, lF: A.lF, wZ: W.wZ, tw: W.tw };
    }
    else if (a.touching) pose = mixPose(from, (KINDS[a.prepKind] || OVER).prep, Math.max(antic, 0.35 + 0.6 * clampN(a.charge || 0, 0, 1))); // 按住蹲低：手先引拍
    if (a.charge > 0) pose = { ...pose, drop: pose.drop + 0.25 * a.charge, lean: pose.lean + 0.15 * a.charge };
    if (!sp && speed > 0.4) { // 移動中：重心壓低、上身往要去的方向傾
      const k = Math.min(1, speed / 3.5);
      pose = { ...pose, drop: pose.drop + 0.12 * k, lean: pose.lean + 0.34 * clampN((an.fwdV || 0) / 3.5, 0, 1) + 0.06 * k, tilt: pose.tilt - 0.14 * clampN((an.latV || 0) / 3.5, -1, 1) }; // 跑起來：重心壓低、往前衝時上身前傾；往後退上身保持直
    }
    if (sp && LUNGE_KINDS.has(kind) && !a.lunge) pose = { ...pose, drop: Math.min(pose.drop, 0.12), lean: Math.min(pose.lean, 0.3) }; // 球很近：小跨步就好

    const prevQ = this.smoothBones.map(n => n.quaternion.clone());
    let arms = { rU: pose.rU.clone(), rF: pose.rF.clone(), lU: pose.lU.clone(), lF: pose.lF.clone() };
    if (!sp && speed > 0.4) {
      const kk = Math.min(1, speed / 3.2) * 0.8 * (1 - antic); // 已經在準備擊球的話，手就維持準備姿勢
      for (const n of ['rU', 'rF', 'lU', 'lF']) arms[n].lerp(MOVE_ARMS[n], kk).normalize();
    }
    this.t = (this.t || 0) + dt;
    if (!sp && !a.touching) { // 呼吸：手和身體輕輕晃
      const br = Math.sin(this.t * 2.2);
      add(arms.lU, 0, 0, 0.04 * br); add(arms.rU, 0, 0, -0.03 * br);
      pose = { ...pose, lean: pose.lean + 0.015 * br };
    }
    // 全身轉向（側身退後場、背對網打反手、跨步朝向球）
    const ty = an.bodyYaw || 0;
    this.yaw += (ty - this.yaw) * Math.min(1, dt * 9);
    this.root.rotation.y = this.yaw;
    const th = this.yaw + this.faceRot;
    // 墊步時身體小跳
    let hop = an.split > 0 && an.split < 1 ? Math.sin(Math.PI * an.split) * 0.06 : 0;
    if (!sp && speed < 0.25 && an.tPlan != null && an.tPlan > 0.3 && !(jumpY > 0.02)) hop += 0.012 * Math.abs(Math.sin(t * 8.5)); // 到位等球：腳下輕輕彈、調整重心（不是定住）
    const rootPos = { x: a.pos.x, y: jumpY + hop + (an.bob || 0) - pose.drop * this.scale, z: a.pos.z };

    // 魚躍：身體往前倒成水平、往球的方向滑出去，趴一下再起來
    const dv = a.swingKind === 'dive' && a.dive && d > -0.05 && d < DIVE_LEN ? (a.dive.side ? sideFrame(d, a.dive.side) : diveFrame(d)) : null;
    const dive = dv ? 1 : 0;
    if (dv) { // 位置照飛出去的距離算（從起跳點出發，最後停在落地的地方）
      rootPos.x = a.dive.from.x + a.dive.dir.x * a.dive.len * dv.f;
      rootPos.z = a.dive.from.z + a.dive.dir.z * a.dive.len * dv.f;
      rootPos.y = dv.l;
      // 身體是繞腳底倒下去的：倒下時髖部離腳底約一個腿長。把整個人往回挪這段距離，髖部才會停在飛出去的那一點（起身時不會整個人往腳那邊滑回去）
      const tilt = Math.sin(Math.max(dv.r || 0, dv.p || 0)) * this.hipOff.R.y * (dv.r ? 0.9 : 0.75);
      rootPos.x -= a.dive.dir.x * tilt; rootPos.z -= a.dive.dir.z * tilt;
      pose = { ...pose, lean: 0, tilt: 0, yaw: 0 };
    }
    if (jumpY > 0.05) { // 空中：上升時微微展腹蓄力，擊球那一下往前收
      const kj = Math.min(1, jumpY / 0.25), arch = d < -0.03 ? -0.14 : d < 0.12 ? -0.14 + (d + 0.03) / 0.15 * 0.44 : 0.3;
      pose = { ...pose, lean: pose.lean * (1 - kj) + arch * kj };
    }
    // 腿：在地上用 IK（腳真的踩地）；跳起來時用剪刀腳姿勢
    let legs;
    if (dv) { // 魚躍：腿照時間軸（蹬地 → 往後伸直 → 跪起來 → 右腳往前踩）
      this.air = true;
      legs = dv.legs;
      this.footYaw = { R: 0, L: 0 }; this.footPitch = { R: 0.6, L: 0.6 };
    } else if (jumpY > 0.05) {
      this.air = true;
      legs = { rT: pose.rT.clone(), rS: pose.rS.clone(), lT: pose.lT.clone(), lS: pose.lS.clone() };
      const k = Math.min(1, jumpY / 0.25), jp = an.jumpProg || 0;
      let R, L;
      if (jp < 0.4) { R = [V(-0.08, -0.86, 0.5), V(-0.05, -0.9, -0.43)]; L = [V(0.1, -0.9, 0.42), V(0.06, -0.86, -0.5)]; }        // 起跳：兩膝微彎收在身體下面
      else if (jp < 0.72) { R = [V(-0.08, -0.62, 0.78), V(-0.05, -0.95, -0.3)]; L = [V(0.1, -0.96, -0.25), V(0.06, -0.8, -0.6)]; } // 空中剪刀腳：右膝往前上帶、左腳往後微彎
      else { R = [V(-0.1, -0.82, 0.56), V(-0.06, -0.98, 0.05)]; L = [V(0.1, -0.98, -0.16), V(0.06, -0.99, -0.1)]; }                // 落地：左腳先伸直著地、右腳在前
      legs.rT.lerp(R[0], k).normalize(); legs.rS.lerp(R[1], k).normalize();
      legs.lT.lerp(L[0], k).normalize(); legs.lS.lerp(L[1], k).normalize();
      this.footYaw = { R: 0, L: 0 }; this.footPitch = { R: 0.3, L: 0.3 };
    } else {
      if (this.air && this.feet) { // 落地：左腳先著地在後、右腳在前
        this.air = false;
        const rv = { x: -Math.cos(th), z: Math.sin(th) }, fv = { x: Math.sin(th), z: Math.cos(th) };
        const put = (f, r, fw) => Object.assign(this.feet[f], { sw: false, x: a.pos.x + rv.x * r + fv.x * fw, z: a.pos.z + rv.z * r + fv.z * fw, toe: th });
        put('L', -0.25, -0.25); put('R', 0.25, 0.3);
      }
      this.updateFeet(a, t, an, th, sp, d);
      for (const [sw, st] of [['R', 'L'], ['L', 'R']]) {
        const F = this.feet[sw];
        if (F.sw && !this.feet[st].sw) {
          const pr = clampN((t - F.t0) / F.dur, 0, 1), S = this.feet[st];
          const sx = S.x - a.pos.x, sz = S.z - a.pos.z, sl = Math.hypot(sx, sz) || 1;
          const shift = 0.05 * Math.sin(Math.PI * pr);
          rootPos.x += sx / sl * shift; rootPos.z += sz / sl * shift;
          rootPos.y += 0.025 * Math.sin(Math.PI * pr);
        }
      }
      const fR = this.footPos('R', t), fL = this.footPos('L', t);
      // 腳伸得越遠，髖關節要降得越低（膝蓋彎下去），腿才不會被抬成水平
      let need = 0;
      for (const [f, fp] of [['R', fR], ['L', fL]]) {
        const off = this.hipOff[f], ho = rotY(off.x, off.z, th);
        const h = Math.hypot(fp.x - (rootPos.x + ho.x), fp.z - (rootPos.z + ho.z));
        const maxH = Math.sqrt(Math.max(0, (0.97 * (this.L1 + this.L2)) ** 2 - h * h));
        need = Math.max(need, rootPos.y + off.y - (fp.y + maxH));
      }
      const lunging = (a.fw && a.fw.moves.some(m => m.lunge && t >= m.t0 - 0.05 && t <= m.t0 + m.dur + 0.45)) || (this.lungeHold && t < this.lungeHold);
      const killK = (a.swingKind === 'kill' || a.swingKind === 'bkill') && Math.abs(t - a.swingT) < 0.8; // 撲球：快速一步，不蹲深
      const sideK = (a.swingKind === 'side' || a.swingKind === 'bside') && Math.abs(t - a.swingT) < 0.8; // 平抽：側跨一步、身體比較高（影片：中場兩點抽球）
      const tgtDrop = clampN(need, 0, lunging ? (killK ? 0.12 : sideK ? 0.15 : 0.3) : 0.06), xd = this.xDrop || 0; // 只有跨步才大幅降低（最多 30 公分：前腳大腿接近水平、後腳伸直），平常最多 6 公分
      this.xDrop = xd + (tgtDrop - xd) * Math.min(1, dt * (tgtDrop > xd ? 10 : 6)); // 蹲下跟著跨步的速度、站起來慢
      rootPos.y -= this.xDrop;
      const toeR = this.feet.R.toe ?? th, toeL = this.feet.L.toe ?? th;
      const [rT, rS, rB] = this.legIK('R', rootPos, th, fR, toeR);
      const [lT, lS, lB] = this.legIK('L', rootPos, th, fL, toeL);
      legs = { rT, rS, lT, lS, rB, lB };
      this.footYaw = { R: clampN(wrapA(toeR - th), -1.2, 1.2), L: clampN(wrapA(toeL - th), -1.2, 1.2) };
      const vl = Math.hypot(a.vel?.x || 0, a.vel?.z || 0);
      const behind = f => { const F = this.feet[f]; if (F.sw || vl < 0.8) return 0; return -((F.x - a.pos.x) * a.vel.x + (F.z - a.pos.z) * a.vel.z) / vl; };
      this.footPitch = { R: clampN((behind('R') - 0.1) * 1.6, 0, 0.7), L: clampN((behind('L') - 0.1) * 1.6, 0, 0.7) };
      if (!an.stance && !this.feet.R.sw) this.footPitch.R = Math.max(this.footPitch.R, lunging ? 0 : 0.12); // 墊腳尖：腳跟微微離地（跨步的前腳腳跟著地）
      if (!an.stance && !this.feet.L.sw) this.footPitch.L = Math.max(this.footPitch.L, lunging ? 0.6 : 0.12); // 跨步的後腳：腳跟抬起、腳尖內側拖地
    }

    const B = this.b;
    B.hips.rotation.set(0, 0, 0);
    B.spine.rotation.set(pose.lean * 0.6, pose.yaw * 0.4, pose.tilt * 0.5);
    B.chest.rotation.set(pose.lean * 0.4, pose.yaw * 0.6, pose.tilt * 0.5);
    if (B.upperChest) B.upperChest.rotation.set(0, 0, 0);
    if (B.neck) B.neck.rotation.set(-pose.lean * 0.6, -pose.yaw * 0.6, -pose.tilt * 0.5);
    if (B.rSh) B.rSh.rotation.set(0, 0, 0);
    if (B.lSh) B.lSh.rotation.set(0, 0, 0);
    const chestQ = new THREE.Quaternion();
    for (const n of [B.hips, B.spine, B.chest, B.upperChest, B.rSh]) if (n) chestQ.multiply(n.quaternion);
    // 撲球：手臂和拍子朝球的實際位置伸出去（拍頭要真的碰到球），手腕在擊球時伸直
    if ((kind === 'kill' || kind === 'bkill') && a.aimP && d > -0.3 && d < 0.15) {
      const w = d < 0 ? smooth(clampN((d + 0.3) / 0.25, 0, 1)) : 1 - smooth(clampN(d / 0.15, 0, 1));
      const sh = new THREE.Vector3(); B.rU.getWorldPosition(sh);
      const dir = new THREE.Vector3(a.aimP.x - sh.x, a.aimP.y - sh.y, a.aimP.z - sh.z);
      const sq = new THREE.Quaternion(); this.root.getWorldQuaternion(sq); sq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.faceRot)); // 身體座標（不含舊版模型多轉的 180°）
      dir.applyQuaternion(sq.invert()).normalize(); // 換成身體座標
      const up = dir.clone().add(new THREE.Vector3(0, -0.07, 0)).normalize(); // 手臂幾乎伸直（盡早在身前最遠的點擊球）
      arms.rU.lerp(up, w).normalize(); arms.rF.lerp(dir, w).normalize();
      pose = { ...pose, wZ: pose.wZ * (1 - w) + (kind === 'kill' ? 0.15 : -0.15) * w, tw: pose.tw * (1 - w) };
    }
    if ((kind === 'kill' || kind === 'bkill') && a.killBrush && d > -0.03 && d < 0.3) { // 刷撲：往側邊掃（不是往下壓）
      const w = smooth(clampN((d + 0.03) / 0.12, 0, 1)) * (d > 0.18 ? 1 - (d - 0.18) / 0.12 : 1);
      arms.rF.lerp(V(kind === 'kill' ? 0.6 : -0.6, 0.2, 0.78), 0.75 * w).normalize();
      pose = { ...pose, wZ: pose.wZ * (1 - w), tw: (kind === 'kill' ? 0.6 : -0.6) * w };
    }
    if (dv) arms = dv.arms; // 魚躍：伸手 → 超人 → 彎手緩衝 → 撐地
    this.aimChain(B.rU, B.rF, B.rH, REST_R_ARM, arms.rU, arms.rF, chestQ, false, pose.tw || 0);
    B.rH.rotation.set(0, pose.wY || 0, pose.wZ || 0); // 手腕：扣腕／甩腕
    this.aimChain(B.lU, B.lF, B.lH, REST_L_ARM, arms.lU, arms.lF, chestQ, false, pose.ltw || 0); // ltw：非持拍手前臂轉（手心朝哪）
    B.lH.rotation.set(0, 0, -0.15);
    for (const [n, c] of this.fingers) n.rotation.set(0, 0, c);
    for (const [n, c] of this.thumbs) n.rotation.set(0, -0.6 * c, 0.25 * c);
    const hipsQ = B.hips.quaternion.clone();
    const fwdM = new THREE.Vector3(0, 0, 1);
    this.aimLeg(B.rT, B.rS, B.rFt, legs.rT, legs.rS, legs.rB || fwdM, hipsQ, this.footYaw.R, this.footPitch.R);
    this.aimLeg(B.lT, B.lS, B.lFt, legs.lT, legs.lS, legs.lB || fwdM, hipsQ, this.footYaw.L, this.footPitch.L);

    // 頭和眼睛一直看著球
    if (an.look && B.head) {
      const dx = an.look.x - a.pos.x, dz = an.look.z - a.pos.z, dy = an.look.y - 1.5;
      const m = rotY(dx, dz, -th);
      const hy = clampN(Math.atan2(m.x, m.z) - pose.yaw, -1.2, 1.2);
      const pitch = clampN(Math.atan2(dy, Math.hypot(m.x, m.z)), -0.5, 1.1);
      B.head.rotation.set(-pitch * 0.55, hy * 0.55, 0);
      if (B.neck) { B.neck.rotation.x -= pitch * 0.3; B.neck.rotation.y += hy * 0.4; }
    }
    // 平滑：上半身姿勢之間不要用跳的；只有擊球前後一瞬間保持俐落
    const crisp = sp && (Math.abs(d) < 0.1 || (KINDS[kind] && KINDS[kind].drop && d > -0.16 && d < 0.1));
    const k = crisp ? 1 : 1 - Math.exp(-dt * 16);
    this.smoothBones.forEach((n, i) => { const tgt = n.quaternion.clone(); n.quaternion.copy(prevQ[i]).slerp(tgt, k); });
    this.root.position.set(rootPos.x, rootPos.y, rootPos.z);
    // 魚躍：整個人往前倒（繞身體左右軸轉）
    const face = this.faceRot > 1 ? -1 : 1;
    this.root.rotation.set(face * (dv ? dv.p : 0), this.yaw, dv && dv.r ? face * dv.side * dv.r : 0, 'YXZ');
    this.vrm.scene.rotation.y = this.faceRot + (this.v0 ? Math.PI : 0) + (dv && dv.s ? dv.side * dv.s : 0); // 側撲落地後沿身體長軸翻到背上
    this.flipV0(); // 算完換成舊版方向給模型用
    this.vrm.update(dt);
  }

  // 腿：大腿、小腿都指向 IK 算出的方向，而且正面朝膝蓋彎的方向；腳掌平貼地面、腳尖朝 footYaw
  aimLeg(upper, lower, foot, dirT, dirS, bend, parentQ, footYaw, footPitch) {
    const wU = basisQ(dirT, bend, qA);
    upper.quaternion.copy(parentQ).invert().multiply(wU);
    const wF = basisQ(dirS, bend, qB);
    lower.quaternion.copy(wU).invert().multiply(wF);
    foot.quaternion.copy(wF).invert().multiply(qT.copy(parentQ)).multiply(qY.setFromAxisAngle(YAXIS, footYaw || 0));
    if (footPitch) foot.quaternion.multiply(qY.setFromAxisAngle(XAXIS, footPitch));
  }

  aimChain(upper, lower, end, rest, dirU, dirF, parentQ, flatEnd, twist, footYaw, footPitch) {
    const wU = qA.setFromUnitVectors(rest, dirU);
    upper.quaternion.copy(parentQ).invert().multiply(wU);
    const wF = qB.setFromUnitVectors(rest, dirF);
    if (twist) wF.premultiply(qT.setFromAxisAngle(dirF, twist)); // 前臂內旋／外旋
    lower.quaternion.copy(wU).invert().multiply(wF);
    if (end && flatEnd) { // 腳掌平貼地面、腳尖朝 footYaw
      end.quaternion.copy(wF).invert().multiply(qT.copy(parentQ)).multiply(qY.setFromAxisAngle(YAXIS, footYaw || 0));
      if (footPitch) end.quaternion.multiply(qY.setFromAxisAngle(XAXIS, footPitch)); // 腳跟抬起（蹬地）
    }
  }
}
