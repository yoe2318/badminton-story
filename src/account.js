// 帳號與存檔（企劃 §13.2）：Firebase Google 登入＋Firestore，每人一份文件 players/{uid}
// 原則「畫面先動、雲端背景存」：所有變更先存手機（localStorage），再在背景上傳；連不上就留著，之後自動重送。
// 不登入也能玩（訪客）：進度只存這支手機；登入後把手機裡的進度和雲端合併。
// 合併規則：設定＝比「最後修改時間」，新的贏；新手訓練完成的課＝兩邊合起來（進度不會變少）。
// Firebase 從 gstatic 載入；載不到（離線、私人版的網頁限制）就只存手機，不影響玩。

const FB_VER = '10.12.2';
const FB_CONFIG = {
  apiKey: 'AIzaSyDluqz3gmHc9qhNcRxQTxtefGAR0fm0rpA',
  authDomain: 'badminton-story.firebaseapp.com',
  projectId: 'badminton-story',
  storageBucket: 'badminton-story.firebasestorage.app',
  messagingSenderId: '101378605413',
  appId: '1:101378605413:web:d1723ab90db43683c2a18c',
};
const META_KEY = 'bm-acct';
const NO_SYNC = new Set(['demo']); // 只在這次有意義的設定，不同步

let meta = (() => { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch (e) { return {}; } })();
meta.t = meta.t || {}; // 每個欄位最後修改的時間（毫秒）
const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} };

let fb = null;        // { auth, db, fns }
let user = null;
let hooks = { getLocal: () => ({}), applyRemote: () => {}, onStatus: () => {} };
let status = 'guest'; // guest | loading | syncing | synced | pending | offline | unavailable
let pushTimer = 0, retryN = 0, pulling = false;

function setStatus(s) { status = s; hooks.onStatus(info()); }
export function info() {
  return { status, signedIn: !!user, name: user ? (user.displayName || user.email || '玩家') : '', photo: user ? user.photoURL : '', dirty: !!meta.dirty, lastSync: meta.lastSync || 0, ready: !!fb };
}

// 本機有變更：記下時間、標成待上傳，稍後在背景上傳（連續改很多次只傳一次）
export function touch(field) {
  meta.t[field] = Date.now(); meta.dirty = true; saveMeta();
  if (user) { schedulePush(1500); setStatus('pending'); }
}

function schedulePush(ms) { clearTimeout(pushTimer); pushTimer = setTimeout(push, ms); }

function cleanSettings(s) { const o = {}; for (const k in s) if (!NO_SYNC.has(k)) o[k] = s[k]; return o; }

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]); }

async function push() {
  if (!user || !fb) return;
  const { db, fns } = fb;
  const L = hooks.getLocal();
  const data = {
    settings: cleanSettings(L.settings || {}), settingsT: meta.t.settings || 0,
    lessons: [...(L.lessons || [])].sort((a, b) => a - b), lessonsT: meta.t.lessons || 0,
    name: user.displayName || '', updatedAt: Date.now(),
  };
  setStatus('syncing');
  try {
    await withTimeout(fns.setDoc(fns.doc(db, 'players', user.uid), data, { merge: true }), 10000);
    meta.dirty = false; meta.lastSync = Date.now(); saveMeta(); retryN = 0;
    setStatus('synced');
  } catch (e) {
    if (e && e.code === 'permission-denied') { console.warn('雲端拒絕寫入', e); setStatus('pending'); return; }
    retryN++; setStatus(navigator.onLine === false ? 'offline' : 'pending');
    schedulePush(Math.min(60000, 5000 * retryN)); // 連不上：5 秒、10 秒…最多 1 分鐘後重送
  }
}

// 從雲端拿下來和手機的合併；有變就套用到遊戲，再把合併後的結果傳上去
async function pull() {
  if (!user || !fb || pulling) return;
  pulling = true;
  const { db, fns } = fb;
  try {
    const snap = await withTimeout(fns.getDoc(fns.doc(db, 'players', user.uid)), 10000);
    const R = snap.exists() ? snap.data() : null;
    const L = hooks.getLocal();
    let changed = false, needPush = !R || !!meta.dirty;
    const out = {};
    if (R && R.settings && (R.settingsT || 0) > (meta.t.settings || 0)) { out.settings = cleanSettings(R.settings); meta.t.settings = R.settingsT; changed = true; }
    else if (R && (meta.t.settings || 0) > (R.settingsT || 0)) needPush = true;
    if (R && Array.isArray(R.lessons)) {
      const mine = new Set(L.lessons || []), union = new Set([...mine, ...R.lessons]);
      if (union.size > mine.size) { out.lessons = [...union]; changed = true; }
      if (union.size > R.lessons.length) needPush = true;
      meta.t.lessons = Math.max(meta.t.lessons || 0, R.lessonsT || 0);
    }
    saveMeta();
    if (changed) hooks.applyRemote(out);
    if (needPush) await push(); else { meta.lastSync = Date.now(); saveMeta(); setStatus(meta.dirty ? 'pending' : 'synced'); }
  } catch (e) {
    setStatus(navigator.onLine === false ? 'offline' : 'pending');
    setTimeout(() => { pulling = false; pull(); }, 15000);
    return;
  } finally { pulling = false; }
}

export async function initAccount(h) {
  hooks = { ...hooks, ...h };
  setStatus('loading');
  try {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [appM, authM, fsM] = await withTimeout(Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]), 15000);
    const app = appM.initializeApp(FB_CONFIG);
    const auth = authM.getAuth(app);
    const db = fsM.getFirestore(app);
    fb = { auth, db, fns: { ...authM, ...fsM } };
    authM.getRedirectResult(auth).catch(() => {}); // 從 Google 登入頁跳回來時接住結果
    authM.onAuthStateChanged(auth, u => {
      user = u || null;
      if (user) { setStatus('syncing'); pull(); } else setStatus('guest');
    });
  } catch (e) {
    console.warn('登入服務載入失敗，只存在這支手機', e);
    setStatus('unavailable');
    return;
  }
  addEventListener('online', () => { if (user) { retryN = 0; pull(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) pull(); }); // 回到遊戲時拿另一支手機的新進度
}

export async function signIn() {
  if (!fb) return;
  const { auth, fns } = fb;
  const provider = new fns.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await fns.signInWithPopup(auth, provider); }
  catch (e) {
    const code = e && e.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') { await fns.signInWithRedirect(auth, provider); return; }
    if (code === 'auth/popup-closed-by-user') return;
    throw e;
  }
}
export async function signOut() {
  if (!fb) return;
  if (meta.dirty && user) { try { await push(); } catch (e) {} } // 登出前把還沒傳的傳上去
  await fb.fns.signOut(fb.auth);
}
// 測試用：模擬雲端（不碰真的資料）
export const __acct = { get meta() { return meta; }, push, pull, setFake(f, u) { fb = f; user = u; } };
