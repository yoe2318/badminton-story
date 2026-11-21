// 體育館場景：木地板、廣告看板、看台＋觀眾（會跟著歡呼跳）、計分大螢幕、裁判椅、天花板燈
// 觀眾用 InstancedMesh（身體一組、頭一組），手機上也只多兩次繪製
import * as THREE from 'three';

const noOutline = m => { m.userData.outlineParameters = { visible: false }; return m; };

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 木地板：一條一條的木板，深淺不一、有木紋
function woodTex() {
  const t = canvasTex(512, 512, (c, w, h) => {
    const n = 8, pw = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) { // 每條木板分三段，接縫錯開
        const y0 = ((j + (i % 3) * 0.33) % 3) / 3 * h, l = h / 3;
        const k = 0.86 + Math.random() * 0.2;
        c.fillStyle = `rgb(${Math.round(205 * k)},${Math.round(146 * k)},${Math.round(88 * k)})`;
        c.fillRect(i * pw, y0, pw, l); c.fillRect(i * pw, y0 - h, pw, l);
        c.strokeStyle = 'rgba(90,50,20,0.10)'; c.lineWidth = 1;
        for (let g = 0; g < 5; g++) { // 木紋
          const x = i * pw + 4 + Math.random() * (pw - 8);
          c.beginPath(); c.moveTo(x, y0); c.bezierCurveTo(x + 3, y0 + l * 0.3, x - 3, y0 + l * 0.6, x + 1, y0 + l); c.stroke();
        }
        c.fillStyle = 'rgba(70,40,15,0.35)'; c.fillRect(i * pw, (y0 + l) % h - 1, pw, 2);
      }
      c.fillStyle = 'rgba(70,40,15,0.45)'; c.fillRect(i * pw, 0, 1.5, h);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10);
  return t;
}

// 看板：重複的字
function boardTex(text, bg, fg) {
  return canvasTex(1024, 64, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg; c.font = '900 40px "Noto Sans TC",sans-serif'; c.textBaseline = 'middle';
    let x = 20; while (x < w) { c.fillText(text, x, h / 2 + 2); x += c.measureText(text).width + 60; }
  });
}

export function buildArena(scene, toon) {
  const group = new THREE.Group(); scene.add(group);
  scene.background = new THREE.Color(0x2b3447);
  scene.fog = new THREE.Fog(0x2b3447, 32, 75);

  // 地板（取代原本的素色地板）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), noOutline(new THREE.MeshToonMaterial({ map: woodTex(), color: 0xffffff })));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true; group.add(floor);
  // 球場外圍一圈深綠色的地墊（比賽場地的樣子）
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 18.6), noOutline(toon(0x2f7357)));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.002; mat.receiveShadow = true; group.add(mat);

  // 牆、天花板
  const wallM = noOutline(toon(0x3b4a66)), lowM = noOutline(toon(0x24324d)), ceilM = noOutline(toon(0x2a303c));
  const wall = (w, h, x, y, z, ry, m) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.y = ry; group.add(p); };
  wall(30, 12, 0, 6, -17, 0, wallM); wall(30, 12, 0, 6, 21, Math.PI, wallM);
  wall(40, 12, -14.5, 6, 2, Math.PI / 2, wallM); wall(40, 12, 14.5, 6, 2, -Math.PI / 2, wallM);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 12, 2); group.add(ceil);
  // 天花板燈：一排排亮白的燈
  const lampM = noOutline(new THREE.MeshBasicMaterial({ color: 0xfff8e8 }));
  const lampG = new THREE.BoxGeometry(1.6, 0.12, 0.5);
  for (const x of [-6, -2, 2, 6]) for (let z = -12; z <= 16; z += 4) { const l = new THREE.Mesh(lampG, lampM); l.position.set(x, 11.8, z); group.add(l); }

  // 看台：遠端（對手身後）7 排、左右兩側 6 排，一階一階往上
  const seatA = noOutline(toon(0x2f5d8a)), seatB = noOutline(toon(0x3d72a6));
  const seats = []; // 觀眾座位 {x, y, z}
  const ROW = 0.85, RISE = 0.45;
  for (let r = 0; r < 7; r++) {
    const h = 0.5 + r * RISE, z = -9.7 - r * ROW;
    const b = new THREE.Mesh(new THREE.BoxGeometry(22, h, ROW), r % 2 ? seatA : seatB); b.position.set(0, h / 2, z - ROW / 2); group.add(b);
    for (let x = -10.2; x <= 10.2; x += 0.62) seats.push({ x, y: h, z: z - ROW * 0.55, face: 0 });
  }
  for (const s of [-1, 1]) for (let r = 0; r < 6; r++) {
    const h = 0.5 + r * RISE, x = s * (8.2 + r * ROW);
    const b = new THREE.Mesh(new THREE.BoxGeometry(ROW, h, 26), r % 2 ? seatA : seatB); b.position.set(x + s * ROW / 2, h / 2, -2); group.add(b);
    for (let z = -14.5; z <= 10.5; z += 0.62) seats.push({ x: x + s * ROW * 0.55, y: h, z, face: s });
  }

  // 觀眾：身體＋頭，顏色隨機（衣服），大約七成的位子有人
  const people = seats.filter(() => Math.random() < 0.72);
  const bodyG = new THREE.CapsuleGeometry(0.2, 0.32, 2, 6), headG = new THREE.SphereGeometry(0.13, 8, 6);
  const bodyM = noOutline(new THREE.MeshLambertMaterial()), headM = noOutline(new THREE.MeshLambertMaterial());
  const bodies = new THREE.InstancedMesh(bodyG, bodyM, people.length), heads = new THREE.InstancedMesh(headG, headM, people.length);
  const SHIRT = [0xe85d4a, 0xf2c14e, 0x4a90d9, 0xffffff, 0x2d2d2d, 0x6cc070, 0xd96fb0, 0xf08a3c, 0x8a6fd9, 0x3fb8b0];
  const SKIN = [0xf3d2b3, 0xe6b991, 0xc98e66, 0xf6dcc6];
  const HAIR = [0x1d1a18, 0x3b2a20, 0x5a3b26, 0x1d1a18, 0x8a6a4a];
  const col = new THREE.Color();
  people.forEach((p, i) => {
    p.phase = Math.random() * 6.28; p.rate = 9 + Math.random() * 5; p.amp = 0.5 + Math.random() * 0.7; p.fan = Math.random() < 0.6;
    bodies.setColorAt(i, col.setHex(SHIRT[Math.floor(Math.random() * SHIRT.length)]));
    heads.setColorAt(i, col.setHex(Math.random() < 0.5 ? HAIR[Math.floor(Math.random() * HAIR.length)] : SKIN[Math.floor(Math.random() * SKIN.length)]));
  });
  group.add(bodies, heads);
  const m4 = new THREE.Matrix4();
  function placePeople(t, cheer) {
    people.forEach((p, i) => {
      const jump = cheer > 0.02 && p.fan ? cheer * p.amp * 0.28 * Math.abs(Math.sin(t * p.rate + p.phase)) : 0;
      const sway = 0.015 * Math.sin(t * 1.3 + p.phase); // 平常也會微微動
      m4.makeTranslation(p.x, p.y + 0.36 + jump + sway, p.z); bodies.setMatrixAt(i, m4);
      m4.makeTranslation(p.x, p.y + 0.78 + jump + sway, p.z); heads.setMatrixAt(i, m4);
    });
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  }
  placePeople(0, 0);

  // 廣告看板：遠端底線後面一排、左右兩側各一排
  const boardM = noOutline(new THREE.MeshBasicMaterial({ map: boardTex('羽球物語　BADMINTON STORY　', '#1d3f7a', '#ffffff') }));
  const boardM2 = noOutline(new THREE.MeshBasicMaterial({ map: boardTex('一起來打球！　SMASH！　', '#e2573b', '#fff4d6') }));
  const bf = new THREE.Mesh(new THREE.BoxGeometry(14, 0.75, 0.08), [lowM, lowM, lowM, lowM, boardM, lowM]); bf.position.set(0, 0.375, -8.9); group.add(bf);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 14), [s < 0 ? boardM2 : lowM, s < 0 ? lowM : boardM2, lowM, lowM, lowM, lowM]);
    b.position.set(s * 5.6, 0.375, -2); group.add(b);
  }

  // 計分大螢幕（遠端牆上）＋兩旁的布條
  const sbCv = document.createElement('canvas'); sbCv.width = 512; sbCv.height = 256;
  const sbTex = new THREE.CanvasTexture(sbCv); sbTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), noOutline(new THREE.MeshBasicMaterial({ map: sbTex })));
  screen.position.set(0, 5.75, -16.9); group.add(screen);
  const frameB = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.0), noOutline(toon(0x111111))); frameB.position.set(0, 5.75, -16.95); group.add(frameB);
  const banner = (text, bg, x) => {
    const m = noOutline(new THREE.MeshBasicMaterial({ map: canvasTex(512, 128, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '900 64px "Noto Sans TC",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 + 4);
    }) }));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), m); p.position.set(x, 5.4, -16.9); group.add(p);
  };
  banner('加油！', '#c2410c', -6.4); banner('羽球物語', '#1e5aa8', 6.4);
  function setScore(names, s0, s1, extra) {
    const c = sbCv.getContext('2d');
    c.fillStyle = '#0b0f16'; c.fillRect(0, 0, 512, 256);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#9fb3d1'; c.font = '700 34px "Noto Sans TC",sans-serif';
    c.fillText(names[0], 128, 52); c.fillText(names[1], 384, 52);
    c.font = '900 120px "Noto Sans TC",sans-serif';
    c.fillStyle = '#ffd84d'; c.fillText(String(s0), 128, 150);
    c.fillStyle = '#9fd0ff'; c.fillText(String(s1), 384, 150);
    c.fillStyle = '#ffffff'; c.fillText(':', 256, 145);
    if (extra) { c.fillStyle = '#9fb3d1'; c.font = '700 26px "Noto Sans TC",sans-serif'; c.fillText(extra, 256, 230); }
    sbTex.needsUpdate = true;
  }

  // 裁判椅（網子右邊）＋主審
  const chair = new THREE.Group();
  const metal = noOutline(toon(0x555b66));
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.05), metal); leg.position.set(x, 0.75, z); chair.add(leg);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.75), toon(0x2e3a50)); seat.position.y = 1.52; chair.add(seat);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.4, 2, 8), toon(0x1f2a44)); body.position.set(0.05, 2.05, 0); chair.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), toon(0xf0cfae)); head.position.set(0.05, 2.55, 0); chair.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x2a2220)); hair.position.copy(head.position); chair.add(hair);
  chair.position.set(4.1, 0, 0); group.add(chair);

  return {
    group, setScore,
    setCrowdVisible(v) { bodies.visible = heads.visible = v; },
    update(t, cheer) { placePeople(t, cheer); },
  };
}
