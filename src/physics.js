// 羽毛球物理：重力＋與速度平方成正比的空氣阻力
// 終端速度約 6.8 m/s（羽毛球實測值約 6.5～7 m/s），所以擊出很快、很快減速、最後幾乎垂直落下。
export const G = 9.81;
export const VT = 6.8;
export const K = G / (VT * VT);
export const DT = 1 / 240;
export const NET_H = 1.524;
export const COURT = { halfW: 2.59, halfL: 6.7, shortLine: 1.98 }; // 單打邊線、底線、前發球線

export function step(s, dt = DT) {
  const v = s.v;
  const sp = Math.hypot(v.x, v.y, v.z);
  v.x -= K * sp * v.x * dt;
  v.y -= (G + K * sp * v.y) * dt;
  v.z -= K * sp * v.z * dt;
  s.p.x += v.x * dt;
  s.p.y += v.y * dt;
  s.p.z += v.z * dt;
}

// 預測整條飛行路線（到落地為止）
export function simulate(p0, v0, maxT = 7) {
  const s = { p: { ...p0 }, v: { ...v0 } };
  const pts = [{ t: 0, x: p0.x, y: p0.y, z: p0.z, vx: v0.x, vy: v0.y, vz: v0.z }];
  let netY = null, t = 0;
  while (t < maxT) {
    const zPrev = s.p.z, yPrev = s.p.y;
    step(s);
    t += DT;
    if (netY === null && zPrev !== 0 && Math.sign(zPrev) !== Math.sign(s.p.z)) {
      const f = zPrev / (zPrev - s.p.z);
      netY = yPrev + (s.p.y - yPrev) * f;
    }
    pts.push({ t, x: s.p.x, y: s.p.y, z: s.p.z, vx: s.v.x, vy: s.v.y, vz: s.v.z });
    if (s.p.y <= 0) break;
  }
  const last = pts[pts.length - 1];
  return { pts, land: { x: last.x, z: last.z, t: last.t }, netY };
}

export function vel(dir, ang, sp) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: dir.x * c * sp, y: s * sp, z: dir.z * c * sp };
}

function reach(p0, dir, v) {
  const r = simulate(p0, v);
  return (r.land.x - p0.x) * dir.x + (r.land.z - p0.z) * dir.z;
}

// 固定仰角，找出能落在距離 D 的初速
export function solveSpeed(p0, dir, ang, D) {
  let lo = 0.5, hi = 140;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (reach(p0, dir, vel(dir, ang, m)) < D) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// 固定初速（殺球、撲球），找出能落在距離 D 的角度
export function solveAngle(p0, dir, sp, D) {
  let lo = -1.2, hi = 0.75;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (reach(p0, dir, vel(dir, m, sp)) < D) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
