import { NET_H, simulate, solveSpeed, solveAngle, vel } from './physics.js?v=140';

// mode 'angle'：固定仰角求初速；mode 'speed'：固定初速（m/s）求角度
// depth：落點離球網的距離（公尺），依滑動長短在範圍內取
export const SHOTS = {
  clear:      { name: '高遠球', mode: 'angle', angle: 40, depth: [5.6, 6.4] },
  aclear:     { name: '平高球', mode: 'angle', angle: 20, depth: [5.6, 6.4] },
  smash:      { name: '殺球', mode: 'speed', speed: [55, 85], depth: [3.6, 5.2], big: true },
  jumpsmash:  { name: '跳殺', mode: 'speed', speed: [68, 95], depth: [3.2, 4.6], big: true, jump: true },
  stick:      { name: '點殺', mode: 'speed', speed: [42, 58], depth: [2.4, 3.4], big: true },
  slicesmash: { name: '劈殺', mode: 'speed', speed: [48, 72], depth: [3.2, 4.6], big: true, slice: true },
  fastdrop:   { name: '快吊', mode: 'angle', angle: 0, depth: [1.9, 2.8] },
  slowdrop:   { name: '輕吊', mode: 'angle', angle: -15, depth: [0.5, 1.2], tight: true },
  slicedrop:  { name: '劈吊', mode: 'angle', angle: -2, depth: [1.6, 2.4], slice: true },
  drive:      { name: '平抽', mode: 'angle', angle: 3, depth: [4.0, 6.0] },
  block:      { name: '擋網', mode: 'angle', angle: 0, depth: [0.6, 1.3], tight: true },
  lift:       { name: '挑球', mode: 'angle', angle: 51, depth: [5.7, 6.4], fine: true }, // fine：過不了網時角度一次只加 1°，取剛好過網的弧線 // 又高又深（最高約 4.7 m、飛約 1.9 秒，接近真實單打）
  net:        { name: '放網', mode: 'angle', angle: 0, depth: [0.25, 0.8], tight: true },
  spin:       { name: '搓球', mode: 'angle', angle: 0, depth: [0.2, 0.6], tumble: true, tight: true },
  cross:      { name: '勾對角', mode: 'angle', angle: 0, depth: [0.5, 1.0], cross: true, tight: true },
  push:       { name: '推球', mode: 'angle', angle: 10, depth: [4.2, 5.8], fine: true },
  kill:       { name: '撲球', mode: 'speed', speed: [30, 42], depth: [1.5, 3.0], big: true },
  sserve:     { name: '發短球', mode: 'angle', angle: 0, depth: [2.02, 3.2], serve: true, tight: true }, // 滑越長越深
  lserve:     { name: '發高遠球', mode: 'angle', angle: 50, depth: [5.9, 6.5], serve: true },
  fserve:     { name: '發平快球', mode: 'angle', angle: 16, depth: [5.6, 6.5], serve: true }, // 快速一甩：壓低、平快打到後場
};

const lerp = (a, b, t) => a + (b - a) * t;

// 算出能打到目標點、又能過網的初速度
export function planShot(p0, tx, tz, spec, power) {
  const dx = tx - p0.x, dz = tz - p0.z, D = Math.hypot(dx, dz);
  const dir = { x: dx / D, z: dz / D };
  let ang = (spec.angle ?? 0) * Math.PI / 180, Dd = D, v;
  const tight = !!spec.tight, fine = !!spec.fine, maxTries = tight || fine ? 60 : 12; // 小球（放網、輕吊、擋網、發短球）：從低角度往上試，取剛好過網的最低弧線
  for (let tries = 0; tries < maxTries; tries++) {
    if (spec.mode === 'angle') v = vel(dir, ang, solveSpeed(p0, dir, ang, Dd));
    else v = vel(dir, solveAngle(p0, dir, lerp(spec.speed[0], spec.speed[1], power), Dd), lerp(spec.speed[0], spec.speed[1], power));
    const r = simulate(p0, v);
    if (r.netY !== null && r.netY > NET_H + (tight ? (spec.margin ?? 0.05) : 0.06)) return { v, sim: r }; // margin：小球貼網程度（越大越冒高）
    if (spec.mode === 'angle') ang = Math.min(ang + (tight ? 0.035 : fine ? 0.018 : 0.07), 1.48); else Dd += 0.6;
  }
  return { v, sim: simulate(p0, v) };
}

// 預測接球點：頭上球（2.8 m）／快球（1.3 m）／低球（0.85 m）
export function predictContact(pts, side, t0, pos, react = 0.18) {
  const mine = q => q.z * side > 0.4;
  const mk = (q, kind) => ({ t: t0 + q.t, x: q.x, y: q.y, z: q.z, kind });
  // 撲球優先：前場（離網 2.2 m 內）的球比網高（擋網、放網冒高、吊太高、在網前飄高的球），來得及就衝上去撲，不跑到球下面做頭頂動作
  let firstKill = null;
  if (pos) { // 前場（離網 2.2 m 內）的慢球比網高（網前小球冒高、吊球吊太高）：來得及就衝上去在高點撲
    for (const q of pts) {
      if (q.z * side <= 0.06 || q.z * side > 2.2 || q.y < 1.58 || q.y > 2.9) continue; // 撲球：拍子伸到網邊、比網高就能撲
      if (Math.hypot(q.vx, q.vz) > 12) break; // 殺球、平抽這種快球不算
      const need = react + 0.12 + Math.max(0, Math.hypot(q.x - pos.x, q.z - pos.z) - 0.8) / 3.8; // 跟實際腳步的速度一致，不會算成來得及卻停在半路
      if (q.t < need) continue;
      if (q.y <= 2.1) return mk(q, 'mid'); // 撲球點：比網高一點最好打（教學：網上方約 30 cm、越早越好）
      if (!firstKill) firstKill = q;       // 太高：先記著，看等一下會不會掉到好打的高度
    }
    if (firstKill) return mk(firstKill, 'mid'); // 一直很高才撲得到：跳撲（在最高點擊球）
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], q = pts[i];
    if (mine(q) && mine(a) && a.y > 2.8 && q.y <= 2.8) return mk(q, 'high');
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], q = pts[i];
    if (mine(q) && a.y > 1.3 && q.y <= 1.3 && Math.hypot(q.vx, q.vz) > 9) {
      // 快球（殺球、平抽）：不要衝去網前接，在飛行路線上挑離自己最近、高度 0.3～1.4 m 的點（站著等球過來擋）
      if (!pos) return mk(q, 'mid');
      let best = q, bd = Infinity;
      for (let j = i; j < pts.length; j++) {
        const r = pts[j]; if (r.y < 0.3) break;
        const dd = Math.hypot(r.x - pos.x, r.z - pos.z) - r.t * 0.8; // 越晚到越有時間移動
        if (mine(r) && r.y <= 1.4 && dd < bd) { bd = dd; best = r; }
      }
      return mk(best, best.y >= 1.0 ? 'mid' : 'low');
    }
  }
  // 落在網前的小球（放網、擋網、吊球）：剛過網、掉到 1.4 m 就上前搶高點，不要等球掉低才被動挑
  const end = pts[pts.length - 1];
  if (Math.abs(end.z) < 3.0 && pos) { // 落在前場的球（吊球、放網）：來得及的前提下盡量早、盡量高去接，不站在後面等球掉
    for (const q of pts) {
      const zz = q.z * side;
      if (zz <= 0.3 || zz > 2.6 || q.y > 1.58 || q.vy > 0.3) continue;
      const need = react + 0.12 + Math.max(0, Math.hypot(q.x - pos.x, q.z - pos.z) - 0.8) / 3.8;
      if (q.t >= need) return mk(q, 'low');
    }
  }
  if (Math.abs(end.z) < 2.2) for (const q of pts) if (q.z * side > 0.3 && q.y <= 1.4 && q.vy < 0) return mk(q, 'low'); // 離網至少 0.3 m（太貼網拍子會碰網）
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], q = pts[i];
    if (mine(q) && a.y > 0.85 && q.y <= 0.85) return mk(q, 'low');
  }
  // 貼網的小球：掉到 0.85 m 時還在網前 0.4 m 內 → 剛過網、還在 1.25 m 左右時就上前接（真人也是搶高點，不等球掉到網下）
  let far = null; // 球一直貼著網掉：取離網最遠、還在 0.4 m 以上的點
  for (const q of pts) if (q.z * side > 0.12 && q.y >= 0.4 && q.y <= 1.4 && q.vy < 0 && (!far || q.z * side > far.z * side + 0.01)) far = q;
  if (far) return mk(far, 'low');
  return mk(pts[pts.length - 1], 'low');
}

// 擊球位置 × 滑法 → 球路（擊球位置＝擊球那一刻球的高度）
//   top（2.8 m 以上）往上滑＝高遠球；high（2.2～2.8 m）往上滑＝殺球（配合 170 cm 的角色）
//   往下滑＝小球；點一下＝平抽
export const CURVE_MIN = 0.08;
export const TOP_Y = 2.8;
export function classify(g, zone, front, y) {
  const curved = Math.abs(g.curve) > CURVE_MIN;
  const overhead = zone === 'top' || zone === 'high';
  const netHigh = front && zone === 'mid' && y < 1.6; // 網前搶到的高點
  if (g.type === 'tap') return zone === 'low' || netHigh ? 'push' : 'drive'; // 網前點一下＝推後場
  if (g.dir === 'down') {
    if (overhead) return curved ? 'slicedrop' : g.speedN > 2.2 ? 'fastdrop' : 'slowdrop';
    if (zone === 'mid' && !netHigh) return 'block';
    if (curved) return 'spin';
    return Math.abs(g.aimX) > 0.6 && front ? 'cross' : 'net';
  }
  if (front && y > 1.55) return 'kill'; // 比網高（1.524 m）就能撲
  if (overhead && g.crouch) return 'jumpsmash';
  if (zone === 'top') return 'clear';
  if (zone === 'high') return curved ? 'slicesmash' : 'smash';
  return 'lift';
}
