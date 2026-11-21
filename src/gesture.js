// 滑動手勢
//   拉拍：先往下拉（引拍、蓄力）
//   往上滑：直直往上＝高球；最後往下一勾（∧）＝殺球／撲球
//   往下滑：小球
//   點一下：平抽（點左半邊打左邊、右半邊打右邊）
export function attachGesture(el, { onStart, onMove, onEnd }) {
  let pts = null, id = null;
  const add = e => {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (list.length) for (const c of list) pts.push({ x: c.clientX, y: c.clientY, t: c.timeStamp || e.timeStamp });
    else pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  };
  el.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch (err) {}
    pts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    onStart && onStart();
    onMove && onMove(pts);
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { id = null; pts = null; onMove && onMove(null); return; } // 滑鼠早就放開了
    add(e);
    onMove && onMove(pts);
  });
  el.addEventListener('pointerup', e => {
    if (e.pointerId !== id) return;
    pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    const r = el.getBoundingClientRect();
    const g = analyze(pts, r);
    id = null; pts = null;
    onEnd(g);
  });
  const cancel = e => { if (e.pointerId === id) { id = null; pts = null; onMove && onMove(null); } };
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('lostpointercapture', cancel);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 目前拉拍的程度（0～1），給蓄力條和引拍動作用
export function chargeOf(pts, H) {
  if (!pts || pts.length < 2) return 0;
  let maxY = pts[0].y;
  for (const p of pts) maxY = Math.max(maxY, p.y);
  const last = pts[pts.length - 1];
  if (last.y < maxY - 0.03 * H) return 0; // 已經開始往上揮
  return clamp((maxY - pts[0].y) / (0.12 * H), 0, 1);
}

function maxDev(pts, i0, i1) {
  const a = pts[i0], b = pts[i1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 10) return 0;
  let best = 0;
  for (let i = i0; i <= i1; i++) {
    const c = ((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  return best / len;
}

function dwell(pts, i0) {
  const ps = pts[i0];
  let tIn = ps.t, tOut = ps.t;
  for (let i = i0; i >= 0 && Math.hypot(pts[i].x - ps.x, pts[i].y - ps.y) < 12; i--) tIn = pts[i].t;
  for (let i = i0; i < pts.length && Math.hypot(pts[i].x - ps.x, pts[i].y - ps.y) < 12; i++) tOut = pts[i].t;
  return tOut - tIn;
}

export function analyze(pts, rect) {
  const W = rect.width, H = rect.height;
  const first = pts[0], last = pts[pts.length - 1];
  let path = 0;
  for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (path < 0.03 * H) {
    const cx = ((first.x - rect.left) / W) * 2 - 1;
    return { type: 'tap', dir: 'tap', aimX: clamp(cx * 1.5, -1, 1), hook: false, curve: 0, hold: false,
             pullN: 0, noPull: false, power: 0.7, depthFrac: 0.6, lenN: 0, speedN: 0 };
  }
  // 最高點，以及最高點之前的最低點（拉拍的底）
  let iTop = 0;
  pts.forEach((p, i) => { if (p.y < pts[iTop].y) iTop = i; });
  let iBot = 0;
  for (let i = 0; i <= iTop; i++) if (pts[i].y > pts[iBot].y) iBot = i;
  const upLen = pts[iBot].y - pts[iTop].y;
  // 最低點，以及最低點之前的最高點（往下滑的起點）
  let iLow = 0;
  pts.forEach((p, i) => { if (p.y > pts[iLow].y) iLow = i; });
  let iHi = 0;
  for (let i = 0; i <= iLow; i++) if (pts[i].y < pts[iHi].y) iHi = i;
  const downLen = pts[iLow].y - pts[iHi].y;

  const isUp = upLen >= 0.05 * H && (upLen >= downLen * 0.8 || iTop > iLow);
  if (isUp) {
    const pullN = Math.max(0, pts[iBot].y - first.y) / H;
    const hookLen = last.y - pts[iTop].y;
    const hook = hookLen > Math.max(0.03 * H, 0.15 * upLen);
    const dx = pts[iTop].x - pts[iBot].x, len = Math.hypot(dx, upLen);
    const dt = Math.max(16, pts[iTop].t - pts[iBot].t);
    return {
      type: 'swipe', dir: 'up', hook, crouch: pullN >= 0.08, // 先往下滑（蹲低）再往上＝跳殺
      aimX: clamp((dx / len) * 1.8, -1, 1),
      curve: maxDev(pts, iBot, iTop),
      hold: dwell(pts, iBot) > 200,
      pullN, noPull: false,
      power: clamp(0.55 + 0.45 * ((len / H) / (dt / 1000)) / 4, 0.55, 1),
      depthFrac: clamp(0.55 + (len / H - 0.15), 0.35, 1),
      lenN: len / H, speedN: (len / H) / (dt / 1000),
    };
  }
  const dx = pts[iLow].x - pts[iHi].x, len = Math.hypot(dx, downLen);
  const dt = Math.max(16, pts[iLow].t - pts[iHi].t);
  const pullN = Math.max(0, first.y - pts[iHi].y) / H;
  return {
    type: 'swipe', dir: 'down', hook: false,
    aimX: clamp((dx / (len || 1)) * 1.8, -1, 1),
    curve: maxDev(pts, iHi, iLow),
    hold: dwell(pts, iHi) > 200,
    pullN, noPull: false, power: 0.5,
    depthFrac: clamp((len / H - 0.04) / 0.3, 0, 1),
    lenN: len / H, speedN: (len / H) / (dt / 1000),
  };
}
