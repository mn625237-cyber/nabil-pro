// ══════════════════════════════════
// SECURITY
// ══════════════════════════════════
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ══════════════════════════════════
// FIREBASE CONFIG
// ══════════════════════════════════
const RAILWAY_URL  = '';
const API_SECRET   = 'nabilpro2024secret';

// ✅ FIX: المفتاح السري يُرسل فقط لو في مستخدم مسجّل
async function getAuthHeaders() {
  try {
    const user  = firebase.auth().currentUser;
    const token = user ? await user.getIdToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token)      headers['Authorization'] = `Bearer ${token}`;
    if (token)      headers['x-api-key']     = API_SECRET;
    return headers;
  } catch(e) {
    return { 'Content-Type': 'application/json' };
  }
}

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAikfw9vS3PJQgaWl6SrpcOSG34B5vyXPc",
  authDomain:        "nabil-pro.firebaseapp.com",
  projectId:         "nabil-pro",
  storageBucket:     "nabil-pro.firebasestorage.app",
  messagingSenderId: "82099030853",
  appId:             "1:82099030853:web:89de9eabad2cc53817cc2c"
};

const VAPID_KEY = 'BK4AWAfsPAotKbQN4JlEKx9xSCNcXSw2uHoTXaU71b_Up70Ua_XQHJcKZFkI9n8V_AVlh_0QPa0cs2e0AyWAwWY';

// ══════════════════════════════════
// STATE
// ══════════════════════════════════
let auth, db;
let _fcmSubscribed   = false;
let currentUser      = null, userProfile = null;
let ordersCache      = [], restaurantsCache = [];
let allDrivers       = [], allOrders = [];
let currentFilter    = 'all', selectedRest = null;
let selectedPayment  = null, currentPage = 0;
let themeMode        = 'dark', recognizer = null;
let editingOrderId   = null, selectedDriverUid = null;
let reportPeriod     = 'today', mgrReportView = 'drivers';
let ordersUnsubscribe = null, allOrdersUnsubscribe = null;
let restaurantsUnsubscribe = null;
let ordersRef, restaurantsRef, usersRef, settingsRef;
let _addOrderInProgress = false;

// ══════════════════════════════════
// NETWORK
// ══════════════════════════════════
function checkOnline() {
  if (navigator.onLine) { showScreen('loadingScreen'); initApp(); }
  else showScreen('offlineScreen');
}
window.addEventListener('online',  () => { if (!currentUser) checkOnline(); });
window.addEventListener('offline', () => { if (!currentUser) showScreen('offlineScreen'); });

// ══════════════════════════════════
// SCREEN
// ══════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const skip = ['loadingScreen','offlineScreen'];
  if (!skip.includes(id)) history.pushState({ screen: id }, '', '');
}

window.addEventListener('popstate', function() {
  const modal  = document.getElementById('modalOverlay');
  if (modal && modal.classList.contains('show')) { closeModal(); history.pushState({},'',''); return; }
  const detail = document.getElementById('driverDetailOverlay');
  if (detail && detail.classList.contains('show')) { closeDriverDetail(); history.pushState({},'',''); return; }
  const inApp  = ['driverApp','managerApp'].some(id => {
    const el = document.getElementById(id);
    return el && el.classList.contains('active');
  });
  if (inApp) { history.pushState({},'',''); confirmLogout(); return; }
  history.pushState({},'',''); showScreen('authScreen');
});
history.pushState({},'','');

// ══════════════════════════════════
// INIT
// ══════════════════════════════════
async function initApp() {
  if (!navigator.onLine) { showScreen('offlineScreen'); return; }
  showScreen('loadingScreen');
  if (!auth) {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db   = firebase.firestore();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  }
  if (!window.authListenerSet) {
    auth.onAuthStateChanged(async user => {
      if (user) { currentUser = user; await loadUserProfile(user.uid); }
      else showScreen('authScreen');
    });
    window.authListenerSet = true;
  }
}

async function loadUserProfile(uid) {
  try {
    usersRef = db.collection('users');
    const doc = await usersRef.doc(uid).get();
    if (doc.exists) {
      userProfile = doc.data();
    } else {
      const email = currentUser.email || '';
      const phone = email.replace('@nabilpro.app','');
      userProfile = {
        uid, phone, email, role: 'driver', name: 'مندوب دليفري',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await usersRef.doc(uid).set(userProfile);
    }
    if (userProfile.role === 'manager') initManagerApp();
    else initDriverApp();
  } catch(e) {
    showToast('خطأ في تحميل البيانات: ' + (e.code || e.message || ''));
    showScreen('authScreen');
  }
}

// ══════════════════════════════════
// AUTH
// ══════════════════════════════════
function phoneToEmail(phone) {
  let p = phone.replace(/\D/g,'');
  if (!p.startsWith('0')) p = '0' + p;
  return p + '@nabilpro.app';
}

const LOGIN_ATTEMPTS_KEY = 'nabilpro_login_attempts';
const LOGIN_LOCKOUT_KEY  = 'nabilpro_lockout_until';
const MAX_ATTEMPTS       = 5;
const LOCKOUT_MINUTES    = 10;

function checkLoginAllowed() {
  const lockUntil = parseInt(localStorage.getItem(LOGIN_LOCKOUT_KEY) || '0');
  if (Date.now() < lockUntil) {
    const remaining = Math.ceil((lockUntil - Date.now()) / 60000);
    showToast(`🔒 الحساب مقفول — انتظر ${remaining} دقيقة`);
    return false;
  }
  return true;
}

function recordLoginFailure() {
  const lockUntil = parseInt(localStorage.getItem(LOGIN_LOCKOUT_KEY) || '0');
  if (Date.now() < lockUntil) return;
  let attempts = parseInt(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || '0') + 1;
  localStorage.setItem(LOGIN_ATTEMPTS_KEY, attempts);
  if (attempts >= MAX_ATTEMPTS) {
    const until = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    localStorage.setItem(LOGIN_LOCKOUT_KEY, until);
    localStorage.setItem(LOGIN_ATTEMPTS_KEY, '0');
    showToast(`🔒 ${MAX_ATTEMPTS} محاولات خاطئة — مقفول ${LOCKOUT_MINUTES} دقائق`);
  } else {
    showToast(`❌ رقم أو كود غير صحيح (${attempts}/${MAX_ATTEMPTS})`);
  }
}

function recordLoginSuccess() {
  localStorage.removeItem(LOGIN_ATTEMPTS_KEY);
  localStorage.removeItem(LOGIN_LOCKOUT_KEY);
}

async function doLogin() {
  if (!checkLoginAllowed()) return;
  const phone = document.getElementById('phoneInput').value.trim();
  const pin   = document.getElementById('pinInput').value.trim();
  if (phone.length < 10) { showToast('ادخل رقم الموبايل'); return; }
  if (pin.length !== 6)  { showToast('كود الدخول 6 أرقام'); return; }
  const btn   = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span>جاري الدخول...</span>';
  const email = phoneToEmail(phone);
  try {
    const result = await auth.signInWithEmailAndPassword(email, pin);
    currentUser  = result.user;
    recordLoginSuccess();
    showScreen('loadingScreen');
    // تطبيق Pending PIN لو موجود
    try {
      const uDoc    = await db.collection('users').doc(currentUser.uid).get();
      const pending = uDoc.data()?.pendingPin;
      if (pending) {
        await currentUser.updatePassword(pending);
        await db.collection('users').doc(currentUser.uid).update({
          pin: pending,
          pendingPin:      firebase.firestore.FieldValue.delete(),
          pendingPinSetAt: firebase.firestore.FieldValue.delete()
        });
      }
    } catch(pe) {}
    loadUserProfile(currentUser.uid);
  } catch(err) {
    btn.disabled = false; btn.innerHTML = '<span>دخول</span><span>←</span>';
    if (['auth/user-not-found','auth/invalid-credential','auth/wrong-password'].includes(err.code))
      recordLoginFailure();
    else showToast('خطأ في الاتصال');
  }
}

function confirmLogout() {
  showModal('تسجيل الخروج',
    '<p style="color:var(--text2);font-size:14px;">هل تريد تسجيل الخروج؟</p>',
    [{ label:'خروج', cls:'danger', action: doLogout },
     { label:'إلغاء', cls:'cancel', action: closeModal }]);
}

async function doLogout() {
  closeModal();
  if (ordersUnsubscribe)     { ordersUnsubscribe();     ordersUnsubscribe     = null; }
  if (allOrdersUnsubscribe)  { allOrdersUnsubscribe();  allOrdersUnsubscribe  = null; }
  if (restaurantsUnsubscribe){ restaurantsUnsubscribe(); restaurantsUnsubscribe = null; }
  try { if (currentUser) await db.collection('fcm_tokens').doc(currentUser.uid).delete(); } catch(e) {}
  try { await auth.signOut(); } catch(e) {}
  _fcmSubscribed = false;
  currentUser = null; userProfile = null; ordersCache = []; restaurantsCache = [];
  allDrivers  = []; allOrders   = []; selectedRest = null; selectedPayment = null;
  editingOrderId = null; selectedDriverUid = null; window.authListenerSet = false;
  const ph  = document.getElementById('phoneInput');
  const pin = document.getElementById('pinInput');
  if (ph)  ph.value  = '';
  if (pin) pin.value = '';
  window.location.reload();
}

// ══════════════════════════════════
// FCM
// ══════════════════════════════════
async function subscribeFCM() {
  if (_fcmSubscribed) return;
  try {
    if (!('serviceWorker' in navigator)) { showToast('SW غير مدعوم'); return; }
    if (!('PushManager' in window))      { showToast('Push غير مدعوم'); return; }

    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { showToast('الإذن مرفوض'); return; }
    }

    showToast('⏳ جاري التفعيل...');
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise(r => setTimeout(r, 2000));

    const msg = firebase.messaging();

    // تحقق من token موجود
    const existingDoc   = await db.collection('fcm_tokens').doc(currentUser.uid).get();
    const existingToken = existingDoc.exists ? existingDoc.data()?.token : null;

    const token = await msg.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) { showToast('Token فارغ - حاول تاني'); return; }

    if (token === existingToken) {
      _fcmSubscribed = true;
      showToast('✅ الإشعارات شغالة!');
      return;
    }

    await db.collection('fcm_tokens').doc(currentUser.uid).set({
      uid: currentUser.uid, token,
      role: userProfile.role || 'manager',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    _fcmSubscribed = true;
    showToast('✅ الإشعارات شغالة!');

    msg.onMessage(payload => {
      const title = payload.notification?.title || 'Nabil Pro 🛵';
      const body  = payload.notification?.body  || '';
      showToast('🔔 ' + title + (body ? ' — ' + body : ''));
      if (Notification.permission === 'granted')
        new Notification(title, { body, icon: 'https://nabil-pro.vercel.app/icon-192.png' });
    });

  } catch(e) {
    showToast('❌ خطأ في الإشعارات: ' + (e.message || ''));
  }
}

function testFCM() { subscribeFCM(); }

async function sendPushNotification(title, body, type, orderData) {
  const payload = orderData
    ? { restName: orderData.restName||'', address: orderData.address||'',
        total: orderData.total||0, delivery: orderData.delivery||0,
        payment: orderData.payment||'cash', driverName: orderData.driverName||'' }
    : { title, body };
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 8000);
    await fetch('/api/notify-managers', {
      method: 'POST', headers: await getAuthHeaders(),
      body: JSON.stringify(payload), signal: ctrl.signal
    });
    clearTimeout(t);
  } catch(e) {
    setTimeout(async () => {
      try {
        await fetch('/api/notify-managers', {
          method: 'POST', headers: await getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      } catch(e2) {}
    }, 3000);
  }
}