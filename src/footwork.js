// 腳步規劃：照真實羽球步法（右手持拍）排好每一步的落腳點和時間，身體由每一步帶著走。
// 參考：研究_真實動作.md 的 4c 節（正手／反手網前、正手後場、頭頂、反手後場、側邊、回位）。
// 本地座標：lat＞0 往右（正手邊），fwd＞0 往網前。
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function frame(a, P) {
  const s = a.side;
  const W = (lat, fwd) => ({ x: P.x + lat * s, z: P.z - fwd * s });
  const L = (x, z) => ({ lat: (x - P.x) * s, fwd: (P.z - z) * s });
  return { W, L };
}
// 世界座標的方向角（給腳尖用）
const yawOf = (dx, dz) => Math.atan2(dx, dz);

// a：球員；S：要站的位置；o：{ contact, tStart, tHit, stroke, low, start }
export function planMove(a, S, o) {
  const P = o.start || { ...a.pos };
  const { W, L } = frame(a, P);
  const rel = L(S.x, S.z);
  const dist = Math.hypot(rel.lat, rel.fwd);
  const C = o.contact ? L(o.contact.x, o.contact.z) : null;
  const moves = [];
  const add = (foot, f, bodyFrac, dur, lift, yaw, lunge, weight) => moves.push({
    foot, to: W(f.lat, f.fwd), body: W(rel.lat * bodyFrac, rel.fwd * bodyFrac), dur, lift, yaw, lunge: !!lunge, weight: weight || 0,
  });
  // 右腳跨向擊球點（從最後站的位置出發）
  const lungeFoot = () => {
    if (!C) return { lat: rel.lat + 0.2, fwd: rel.fwd + 0.5 };
    const dx = C.lat - rel.lat, df = C.fwd - rel.fwd, dl = Math.hypot(dx, df) || 1;
    const reach = clamp(dl - (o.killStep ? 0.3 : 0.55), 0.4, o.killStep ? 0.85 : 1.2); // 前腳停在球前約 0.55 m：手臂＋拍子伸出去剛好打到（不是腳踩到球下面） // 撲球：最後一步爆發性大步跨出、身體保持高
    return { lat: rel.lat + (dx / dl) * reach, fwd: rel.fwd + (df / dl) * reach };
  };
  const stance = (foot, frac) => ({ lat: rel.lat * frac + (foot === 'R' ? 0.2 : -0.2), fwd: rel.fwd * frac + (foot === 'R' ? 0.04 : -0.04) });
  const front = rel.fwd > 0.45 && rel.fwd >= Math.abs(rel.lat) * 0.6;
  const rear = rel.fwd < -0.45 && -rel.fwd >= Math.abs(rel.lat) * 0.6;
  const fh = rel.lat >= -0.2;
  const reachLow = o.low; // 低球、網前球：最後一步一定是右腳跨步

  if (dist < 0.3 && !reachLow) {
    if (dist > 0.12) add(rel.lat >= 0 ? 'R' : 'L', stance(rel.lat >= 0 ? 'R' : 'L', 1), 1, 0.18, 0.05, 0); // 小調整
  } else if (front || (reachLow && !rear)) {
    if (fh) { // 正手網前：（遠的話）左腳並步 → 右腳跨步
      // 遠：右腳先往球的方向踏一小步 → 左腳並步跟到右腳後面（不超過右腳）→ 右腳大跨步。重心一直跟著右腳走（不會變成左腳在前、身體壓在左腳上）
      if (dist > 1.6) {
        const r1 = { lat: rel.lat * 0.3 + 0.18, fwd: rel.fwd * 0.3 + 0.03 };
        add('R', r1, 0.3, 0.17, 0.07, -0.2);
        const ul = rel.lat / dist, uf = rel.fwd / dist; // 前進方向
        add('L', { lat: r1.lat - ul * 0.16 - 0.2, fwd: r1.fwd - uf * 0.16 }, 0.42, 0.14, 0.04, -0.2); // 左腳靠到右腳的左後方
      } else if (dist > 1.0) add('L', { lat: Math.min(rel.lat * 0.45 - 0.1, 0), fwd: Math.min(rel.fwd * 0.45 - 0.15, 0.3) }, 0.4, 0.18, 0.06, -0.15); // 近：左腳小並步（停在右腳左後方）→ 右腳跨步
      add('R', lungeFoot(), 1, 0.27, 0.13, -0.2, !o.kill); // 右腳跨出、落地那一刻擊球（撲球教學：Hit and Land）；高的跳撲不跨
    } else { // 反手網前：以左腳為軸轉身 → 右腳跨過去
      add('L', { lat: -0.28 + rel.lat * 0.2, fwd: 0.08 + rel.fwd * 0.2 }, 0.25, 0.16, 0.05, 0.6);
      add('R', lungeFoot(), 1, 0.29, 0.13, 0.85, !o.kill);
    }
  } else if (rear) {
    if (o.stroke === 'bover') { // 反手後場：左腳轉身、背對網 → 右腳大步跨到角落
      add('L', { lat: -0.25 + rel.lat * 0.25, fwd: rel.fwd * 0.25 }, 0.25, 0.18, 0.06, 1.4);
      if (dist > 1.8) add('R', stance('R', 0.62), 0.62, 0.22, 0.1, 2.3);
      add('R', { lat: rel.lat - 0.2, fwd: rel.fwd - 0.3 }, 1, 0.26, 0.1, 2.3, true);
    } else if (fh) { // 正手後場：側身並步 —— 右腳往後約 0.6 m → 左腳跟上（不超過右腳）→ 重複 → 右腳到位
      const n = Math.max(1, Math.round(dist / 0.65));
      for (let i = 1; i <= n; i++) {
        const f = i / n, half = (i - 0.5) / n;
        add('R', { lat: rel.lat * f + 0.3, fwd: rel.fwd * f - 0.12 }, i === n ? 1 : half, 0.2, 0.08, -1.1, false, i === n ? 0.3 : 0); // 最後一步重心壓在右腳；側身約 63°
        if (i < n) add('L', { lat: rel.lat * f + 0.02, fwd: rel.fwd * f + 0.2 }, f, 0.16, 0.05, -1.1);
      }
    } else { // 頭頂側（左後場）：右腳先往後蹬、轉身 → 左腳往左後方跨到位，重心壓在左腳
      add('R', { lat: rel.lat * 0.45 + 0.22, fwd: rel.fwd * 0.45 + 0.05 }, 0.45, 0.18, 0.07, -0.6);
      add('L', { lat: rel.lat - 0.25, fwd: rel.fwd - 0.12 }, 1, 0.24, 0.1, -0.7, false, 0.3);
    }
  } else if (rel.lat >= 0) { // 正手側邊：（遠的話）左腳並步 → 右腳側跨
    if (dist > 1.1) { // 並步：右腳先往右移 → 左腳靠過來（停在右腳左邊，不交叉）→ 右腳再跨出去
      add('R', { lat: rel.lat * 0.4 + 0.22, fwd: rel.fwd * 0.4 }, 0.4, 0.16, 0.06, -0.3);
      add('L', { lat: rel.lat * 0.4 - 0.12, fwd: rel.fwd * 0.4 }, 0.45, 0.15, 0.05, -0.3);
    }
    add('R', o.mid ? lungeFoot() : stance('R', 1), 1, 0.26, 0.1, -0.45, o.mid);
  } else { // 反手側邊：左腳轉 → 右腳交叉跨過去
    add('L', { lat: -0.15 + rel.lat * 0.25, fwd: rel.fwd * 0.25 }, 0.25, 0.16, 0.06, 0.8);
    add('R', o.mid ? lungeFoot() : { lat: rel.lat - 0.1, fwd: rel.fwd + 0.15 }, 1, 0.29, 0.12, 1.0, true);
  }
  return schedule(moves, P, o.tStart, o.tHit, C ? o.contact : null, a.side, !!o.killStep);
}

// 回位：跨步後右腳先蹬回，再用並步回到中間
export function planRecover(a, base, tStart, afterLunge, feet, pace = 1) { // pace：步子快慢（>1 走回去、<1 快速回位）
  const P = { ...a.pos };
  const { W, L } = frame(a, P);
  const rel = L(base.x, base.z);
  const dist = Math.hypot(rel.lat, rel.fwd);
  if (dist < 0.35) return null;
  const moves = [];
  let frac = 0;
  if (afterLunge) { // 右腳蹬回、收到左腳旁
    frac = Math.min(1, 0.35 / dist);
    moves.push({ foot: 'R', to: W(rel.lat * frac + 0.2, rel.fwd * frac + 0.04), body: W(rel.lat * frac, rel.fwd * frac), dur: 0.24, lift: 0.08, yaw: 0 });
  }
  // 並步：一次約 0.75 公尺，左右交替
  const n = Math.max(1, Math.ceil((dist * (1 - frac)) / 0.75));
  const sideways = Math.abs(rel.lat) > Math.abs(rel.fwd) * 0.8;
  let foot = afterLunge ? 'L' : sideways ? (rel.lat < 0 ? 'L' : 'R') : 'R'; // 側向回位：往哪邊移就那邊的腳先動（不交叉）；前後回位：右腳先（後場往前回時後面的右腳先上）
  for (let i = 1; i <= n; i++) {
    const f = frac + ((1 - frac) * i) / n;
    moves.push({ foot, to: W(rel.lat * f + (foot === 'R' ? 0.2 : -0.2), rel.fwd * f + (foot === 'R' ? 0.04 : -0.04)), body: W(rel.lat * f, rel.fwd * f), dur: 0.21 * pace, lift: 0.07, yaw: 0 });
    foot = foot === 'R' ? 'L' : 'R';
  }
  const fw = schedule(moves, P, tStart, null, null, a.side);
  if (fw) fw.recover = true; // 回位：可以放鬆走
  return fw;
}

// 跳殺之後：空中身體帶著往前（剪刀腳、右腳在前落地），一落地馬上往前衝（殺上網，準備撲對手擋回來的球）
// fall＝擊球後還要多久落地；target＝衝到哪裡
export function planJumpFollow(a, target, tStart, fall) {
  const P = { ...a.pos };
  const { W, L } = frame(a, P);
  const rel = L(target.x, target.z);
  const drift = 0.45; // 空中往前帶的距離
  const moves = [{ foot: 'R', to: W(0.2, drift + 0.3), body: W(rel.lat * 0.1, drift), dur: fall, lift: 0, yaw: 0, air: true }];
  const left = { lat: rel.lat * 0.9, fwd: rel.fwd - drift };
  const dist = Math.hypot(left.lat, left.fwd);
  if (rel.fwd > drift + 0.3) { // 還要往前：左腳先蹬出去、大步衝
    const n = Math.max(1, Math.ceil(dist / 0.7));
    let foot = 'L';
    for (let i = 1; i <= n; i++) {
      const f = i / n, b = { lat: rel.lat * 0.1 + left.lat * f, fwd: drift + left.fwd * f };
      moves.push({ foot, to: W(b.lat + (foot === 'R' ? 0.18 : -0.18), b.fwd + 0.1), body: W(b.lat, b.fwd), dur: 0.17, lift: 0.1, yaw: 0 });
      foot = foot === 'R' ? 'L' : 'R';
    }
  }
  const fw = schedule(moves, P, tStart, null, null, a.side);
  if (fw) { fw.recover = false; fw.rush = true; } // 衝刺：不是放鬆的回位
  return fw;
}

// 排時間：一步接一步；最後的跨步要在擊球前一瞬間落地；時間不夠就整體加快（最快到 55%）
// 一步身體最多移 0.7 m（跨步 1 m）；距離太遠就在前面補小碎步（左右腳交替），不讓一步跨太大、看起來像瞬移
const STEP_CAP = 0.8, LUNGE_CAP = 1.2; // 步子大一點（影片比對：真人大步蹬地）
function splitSteps(moves, P, side) {
  const out = []; let from = { ...P };
  for (const m of moves) {
    const dx = m.body.x - from.x, dz = m.body.z - from.z, d = Math.hypot(dx, dz);
    const cap = m.lunge ? LUNGE_CAP : STEP_CAP;
    let extra = Math.ceil(d / cap) - 1;
    // 補的步要和前一步換腳：不然會出現同一隻腳連踩兩次（例如左、左、右跨步）
    const prevFoot = out.length ? out[out.length - 1].foot : null;
    if (extra > 0 && prevFoot && ((extra - 1) % 2 === 0 ? (m.foot === 'R' ? 'L' : 'R') : m.foot) === prevFoot) extra++;
    if (extra > 0) {
      const lastBody = m.lunge ? d - cap : d * extra / (extra + 1); // 補的步走到哪
      for (let i = 1; i <= extra; i++) {
        const f = (lastBody * i / extra) / d, bx = from.x + dx * f, bz = from.z + dz * f;
        const foot = (extra - i) % 2 === 0 ? (m.foot === 'R' ? 'L' : 'R') : m.foot; // 交替，最後一步換回原本那隻腳
        out.push({ foot, to: { x: bx + (foot === 'R' ? 0.17 : -0.17) * side, z: bz }, body: { x: bx, z: bz }, dur: Math.max(0.17, (lastBody / extra) * 0.24), lift: 0.06, yaw: m.yaw });
      }
      const st = Math.hypot(m.body.x - (from.x + dx * lastBody / d), m.body.z - (from.z + dz * lastBody / d));
      m.dur = Math.max(m.dur, st * 0.24);
    } else m.dur = Math.max(m.dur, d * 0.24); // 一步的平均速度不超過約 4.2 m/s（短距離衝刺）
    out.push(m); from = m.body;
  }
  return out;
}
function schedule(moves, P, tStart, tHit, contact, side = 1, lateStart = false) {
  if (!moves.length) return null;
  moves = splitSteps(moves, P, side);
  let total = moves.reduce((s, m) => s + m.dur, 0);
  if (tHit != null) {
    const avail = tHit - 0.03 - tStart;
    if (avail < total) { const k = clamp(avail / total, 0.85, 1); moves.forEach(m => { m.dur *= k; }); total *= k; }
  }
  // 撲球（搶網）：算好時間才起跑，一路衝到擊球那一刻（不提早到網前站著等）
  if (lateStart && tHit != null) tStart = Math.max(tStart, tHit - 0.03 - total);
  let cur = tStart, from = { ...P };
  moves.forEach((m, i) => {
    const last = i === moves.length - 1;
    m.t0 = last && m.lunge && tHit != null ? Math.max(cur, tHit - 0.03 - m.dur) : cur;
    // 跨步：重心跟著往前腳移（停在兩腳之間、偏前腳），不要身體留在原地、腳伸老遠
    if (m.lunge) m.body = { x: m.body.x + (m.to.x - m.body.x) * 0.42, z: m.body.z + (m.to.z - m.body.z) * 0.42 };
    else if (m.weight) m.body = { x: m.body.x + (m.to.x - m.body.x) * m.weight, z: m.body.z + (m.to.z - m.body.z) * m.weight }; // 重心壓在這隻腳
    m.stepLen = Math.hypot(m.body.x - from.x, m.body.z - from.z);
    if (!m.air) m.lift = Math.max(m.lift || 0, Math.min(0.17, 0.04 + m.stepLen * 0.15)); // 步子大就抬高（跑步的樣子）；空中那一段不算
    m.bodyFrom = from; from = m.body; cur = m.t0 + m.dur;
    if (m.lunge && contact) m.toe = yawOf(contact.x - m.to.x, contact.z - m.to.z);
  });
  return { moves, end: cur };
}

// 照時間算身體位置
export function bodyAt(fw, t) {
  let p = fw.moves[0].bodyFrom;
  for (const m of fw.moves) {
    if (t < m.t0) return { ...m.bodyFrom };
    if (t <= m.t0 + m.dur) { const u = (t - m.t0) / m.dur, s = 0.4 * u + 0.6 * u * u * (3 - 2 * u); /* 步與步之間不完全停下來，比較順 */ return { x: m.bodyFrom.x + (m.body.x - m.bodyFrom.x) * s, z: m.bodyFrom.z + (m.body.z - m.bodyFrom.z) * s }; }
    p = m.body;
  }
  return { ...p };
}
// 跑步時身體的上下起伏：每一步中間身體往上彈（騰空），步子越大彈越高
export function bobAt(fw, t) {
  for (const m of fw.moves) {
    if (t >= m.t0 && t <= m.t0 + m.dur) { if (m.air) return 0; const u = (t - m.t0) / m.dur; return Math.sin(Math.PI * u) * Math.min(0.07, (m.stepLen || 0) * 0.08); }
  }
  return 0;
}
// 現在這一步要的身體轉向
export function yawAt(fw, t) {
  let y = null;
  for (const m of fw.moves) { if (t >= m.t0 - 0.05) y = m.yaw; }
  return y;
}
