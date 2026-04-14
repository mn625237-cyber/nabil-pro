// ══════════════════════════════════
// SECURITY
// ══════════════════════════════════
function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const RAILWAY_URL = '';
let _fcmSubscribed = false;

// API_SECRET — نفس القيمة المحفوظة في Vercel Environment Variables
const API_SECRET = 'nabilpro2024secret';

async function getAuthHeaders() {
  try {
    const token = await firebase.auth().currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-api-key': API_SECRET
    };
  } catch(e) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': API_SECRET
    };
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

let auth, db;
let currentUser=null, userProfile=null, ordersCache=[], restaurantsCache=[];
let allDrivers=[], allOrders=[], currentFilter='all', selectedRest=null;
let selectedPayment=null, currentPage=0, themeMode='dark', recognizer=null;
let editingOrderId=null, selectedDriverUid=null, reportPeriod='today';
let ordersUnsubscribe=null, allOrdersUnsubscribe=null, restaurantsUnsubscribe=null;
let ordersRef, restaurantsRef, usersRef, settingsRef;

// ══════════════════════════════════
// WHATSAPP SMART MESSAGE
// ══════════════════════════════════
function buildWhatsappLink(phone, restName) {
  if (!phone) return null;
  const h = new Date().getHours();
  const greeting = (h >= 5 && h < 12) ? 'صباح' : 'مساء';
  const msg = `${greeting} الخير يا فندم، أنا مندوب ${restName}.. ممكن بس لوكيشن وأنا مسافة الطريق إن شاء الله..`;
  let p = phone.replace(/\D/g,'');
  if (p.startsWith('0')) p = '2' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(msg)}`;
}

// ══════════════════════════════════
// NETWORK
// ══════════════════════════════════
function checkOnline() {
  if (navigator.onLine) { showScreen('loadingScreen'); initApp(); }
  else showScreen('offlineScreen');
}
window.addEventListener('online', () => { if (!currentUser) checkOnline(); });
window.addEventListener('offline', () => { if (!currentUser) showScreen('offlineScreen'); });

// ══════════════════════════════════
// SCREEN
// ══════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const skip = ['loadingScreen','offlineScreen'];
  if (!skip.includes(id)) history.pushState({screen:id},'','');
}

window.addEventListener('popstate', function() {
  const modal = document.getElementById('modalOverlay');
  if (modal && modal.classList.contains('show')) { closeModal(); history.pushState({},'',''); return; }
  const detail = document.getElementById('driverDetailOverlay');
  if (detail && detail.classList.contains('show')) { closeDriverDetail(); history.pushState({},'',''); return; }
  const inApp = ['driverApp','managerApp'].some(id => {
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
    db = firebase.firestore();
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
      userProfile = { uid, phone, email, role:'driver', name:'مندوب دليفري', createdAt:firebase.firestore.FieldValue.serverTimestamp() };
      await usersRef.doc(uid).set(userProfile);
    }
    if (userProfile.role === 'manager') initManagerApp();
    else initDriverApp();
  } catch(e) {
    showToast('خطأ في تحميل البيانات: ' + (e.code||e.message||''));
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
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

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
  const pin = document.getElementById('pinInput').value.trim();
  if (phone.length < 10) { showToast('ادخل رقم الموبايل'); return; }
  if (pin.length !== 6) { showToast('كود الدخول 6 أرقام'); return; }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span>جاري الدخول...</span>';
  const email = phoneToEmail(phone);
  try {
    const result = await auth.signInWithEmailAndPassword(email, pin);
    currentUser = result.user;
    recordLoginSuccess();
    showScreen('loadingScreen');
    try {
      const uDoc = await db.collection('users').doc(currentUser.uid).get();
      const pending = uDoc.data()?.pendingPin;
      if (pending) {
        await currentUser.updatePassword(pending);
        await db.collection('users').doc(currentUser.uid).update({
          pin: pending,
          pendingPin: firebase.firestore.FieldValue.delete(),
          pendingPinSetAt: firebase.firestore.FieldValue.delete()
        });
      }
    } catch(pe) {}
    loadUserProfile(currentUser.uid);
  } catch(err) {
    btn.disabled = false; btn.innerHTML = '<span>دخول</span><span>←</span>';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password')
      recordLoginFailure();
    else showToast('خطأ في الاتصال');
  }
}

function confirmLogout() {
  showModal('تسجيل الخروج','<p style="color:var(--text2);font-size:14px;">هل تريد تسجيل الخروج؟</p>',
    [{label:'خروج',cls:'danger',action:doLogout},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

async function doLogout() {
  closeModal();
  if (ordersUnsubscribe) { ordersUnsubscribe(); ordersUnsubscribe=null; }
  if (allOrdersUnsubscribe) { allOrdersUnsubscribe(); allOrdersUnsubscribe=null; }
  if (restaurantsUnsubscribe) { restaurantsUnsubscribe(); restaurantsUnsubscribe=null; }
  try { if (currentUser) await db.collection('fcm_tokens').doc(currentUser.uid).delete(); } catch(e) {}
  try { await auth.signOut(); } catch(e) {}
  currentUser=null; userProfile=null; ordersCache=[]; restaurantsCache=[];
  allDrivers=[]; allOrders=[]; selectedRest=null; selectedPayment=null;
  editingOrderId=null; selectedDriverUid=null; window.authListenerSet=false;
  _fcmSubscribed = false;
  const ph = document.getElementById('phoneInput');
  const pin = document.getElementById('pinInput');
  if (ph) ph.value=''; if (pin) pin.value='';
  window.location.reload();
}

// ══════════════════════════════════
// FCM — مرة واحدة بس
// ══════════════════════════════════
async function subscribeFCM() {
  if (_fcmSubscribed) return;
  try {
    // خطوة 1: SW موجود؟
    if (!('serviceWorker' in navigator)) {
      showToast('❌ FCM: SW غير مدعوم'); return;
    }
    if (!('PushManager' in window)) {
      showToast('❌ FCM: Push غير مدعوم'); return;
    }

    // خطوة 2: إذن الإشعارات
    if (Notification.permission === 'denied') {
      // المستخدم حظر الإشعارات — وضّح له كيف يفعّلها
      showModal('🔔 الإشعارات محظورة', `
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:40px;margin-bottom:12px">🔕</div>
          <p style="color:var(--text2);font-size:14px;line-height:1.8;margin-bottom:12px">
            أنت حظرت الإشعارات لهذا التطبيق.
          </p>
          <p style="color:var(--text3);font-size:13px;line-height:1.8">
            لتفعيلها: افتح إعدادات المتصفح ← الإشعارات ← ابحث عن nabil-pro.vercel.app ← اسمح
          </p>
        </div>`,
        [{label:'فهمت',cls:'cancel',action:closeModal}]);
      return;
    }
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        showToast('❌ فعّل الإشعارات من إعدادات المتصفح'); return;
      }
    }

    // خطوة 3: انتظر الـ SW
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_,reject) => setTimeout(() => reject(new Error('SW timeout')), 10000))
    ]);

    if (!navigator.serviceWorker.controller) {
      await new Promise(r => setTimeout(r, 2000));
    }

    // خطوة 4: احضر الـ token
    const msg = firebase.messaging();
    const token = await msg.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });

    if (!token) {
      showToast('❌ FCM: token فارغ — تحقق من VAPID Key');
      return;
    }

    // خطوة 5: احفظ في Firestore
    let existingToken = null;
    try {
      const existingDoc = await db.collection('fcm_tokens').doc(currentUser.uid).get();
      existingToken = existingDoc.exists ? existingDoc.data()?.token : null;
    } catch(e) {}

    if (token !== existingToken) {
      await db.collection('fcm_tokens').doc(currentUser.uid).set({
        uid: currentUser.uid, token,
        role: userProfile.role || 'manager',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    _fcmSubscribed = true;
    showToast('✅ الاشعارات شغالة!');

    msg.onMessage((payload) => {
      const title = payload.notification?.title || 'Nabil Pro 🛵';
      const body  = payload.notification?.body  || '';
      showToast('🔔 ' + title + (body ? ' — ' + body : ''));
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: 'https://nabil-pro.vercel.app/icon-192.png' });
      }
      if ('speechSynthesis' in window) {
        let cleanText = title.replace(/[🛵💳💵📍💰👤✏️]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'ar-SA';
        window.speechSynthesis.speak(utterance);
      }
    });

  } catch(e) {
    showToast('❌ FCM: ' + (e.message||'خطأ غير معروف'));
    console.error('FCM error:', e);
    _fcmSubscribed = false;
  }
}

// ══════════════════════════════════
// PUSH NOTIFICATIONS
// ══════════════════════════════════
async function sendPushNotification(title, body, type, orderData) {
  const payload = orderData ? {
    restName: orderData.restName||'', address: orderData.address||'',
    total: orderData.total||0, delivery: orderData.delivery||0,
    payment: orderData.payment||'cash', driverName: orderData.driverName||''
  } : { title, body };

  const doFetch = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('/api/notify-managers', {
      method:'POST', headers: await getAuthHeaders(),
      body: JSON.stringify(payload), signal: ctrl.signal
    });
    clearTimeout(t);
    return res;
  };

  try {
    await doFetch();
  } catch(e) {
    // محاولة ثانية بعد 3 ثواني
    console.warn('push attempt 1 failed:', e.message);
    setTimeout(async () => {
      try {
        await doFetch();
      } catch(e2) {
        // فشل نهائي — المدير مش هيتنبه بالـ FCM
        // الأوردر اتحفظ في Firestore والمدير هيشوفه لما يفتح التطبيق
        console.warn('push attempt 2 failed:', e2.message);
      }
    }, 3000);
  }
}

// ══════════════════════════════════
// DRIVER APP
// ══════════════════════════════════
function initDriverApp() {
  const uid = currentUser.uid;
  ordersRef = db.collection('orders');
  restaurantsRef = db.collection('restaurants');

  db.collection('users').doc(uid).onSnapshot(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    if (data.name && data.name !== userProfile.name) {
      userProfile.name = data.name;
      const snEl = document.getElementById('settingsNameVal');
      if (snEl) snEl.textContent = data.name;
    }
    if (data.phone) {
      userProfile.phone = data.phone;
      const spEl = document.getElementById('settingsPhone');
      if (spEl) spEl.textContent = data.phone;
    }
  });

  db.collection('users').doc(uid).update({ lastSeen:firebase.firestore.FieldValue.serverTimestamp(), online:true }).catch(()=>{});
  themeMode = userProfile.themeMode || 'auto';
  applyTheme(themeMode);

  const backWrap = document.getElementById('backToMgrWrap');
  if (backWrap) backWrap.style.display = userProfile._savedRole === 'manager' ? 'block' : 'none';

  const name = userProfile.name || 'مندوب دليفري';
  const snEl = document.getElementById('settingsNameVal');
  if (snEl) snEl.textContent = name;
  const spEl = document.getElementById('settingsPhone');
  if (spEl) spEl.textContent = userProfile.phone || '—';

  updateClock();
  if (!window._clockInterval) window._clockInterval = setInterval(updateClock, 30000);
  listenToRestaurants();
  listenToDriverOrders();
  showScreen('driverApp');

  setTimeout(()=>{
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') subscribeFCM(); });
    } else if (Notification.permission === 'granted') {
      subscribeFCM();
    }
  }, 2000);

  // تحديث label بداية اليوم
  updateDayStartLabel();
}

function listenToRestaurants() {
  if (restaurantsUnsubscribe) { restaurantsUnsubscribe(); restaurantsUnsubscribe = null; }
  restaurantsUnsubscribe = db.collection('restaurants').orderBy('name').limit(50)
    .onSnapshot(snap => {
      restaurantsCache = snap.docs.map(d => ({id:d.id,...d.data()}));
      try { localStorage.setItem('nabilpro_restaurants', JSON.stringify(restaurantsCache)); } catch(e) {}
      renderRestSelect();
      renderRestSettings();
      renderFilterRestOptions();
      renderMgrFilterRestOptions();
    }, () => {
      try {
        const cached = localStorage.getItem('nabilpro_restaurants');
        if (cached) { restaurantsCache = JSON.parse(cached); renderRestSelect(); renderRestSettings(); }
      } catch(e) {}
    });
}

// ══════════════════════════════════
// قائمة المطاعم المنسدلة
// ══════════════════════════════════
function renderRestSelect() {
  const el = document.getElementById('restSelect');
  if (!el) return;
  const active = restaurantsCache.filter(r => r.active !== false);
  el.innerHTML = '<option value="">اختر المطعم...</option>' +
    active.map(r => `<option value="${sanitize(r.id)}" ${selectedRest===r.id?'selected':''}>${sanitize(r.name)}</option>`).join('');
}

function renderFilterRestOptions() {
  const el = document.getElementById('filterRestSelect');
  if (!el) return;
  el.innerHTML = '<option value="">🏪 المطاعم</option>' +
    restaurantsCache.map(r => `<option value="${sanitize(r.id)}">${sanitize(r.name)}</option>`).join('');
}

function renderMgrFilterRestOptions() {
  const el = document.getElementById('mgrFilterRest');
  if (!el) return;
  const uniqueRests = [...new Set(restaurantsCache.map(r=>r.name).filter(Boolean))];
  el.innerHTML = '<option value="">🏪 كل المطاعم</option>' +
    uniqueRests.map(r => `<option value="${sanitize(r)}">${sanitize(r)}</option>`).join('');
}

function renderRestSettings() {
  const el = document.getElementById('restSettingsList');
  if (!el) return;
  if (!restaurantsCache.length) { el.innerHTML='<div class="empty-state"><div class="empty-text">لا مطاعم بعد</div></div>'; return; }
  const isManager = userProfile.role === 'manager' || userProfile._savedRole === 'manager';
  el.innerHTML = restaurantsCache.map(r=>`
    <div class="rest-row">
      <div class="rest-row-icon">🏪</div>
      <span class="rest-row-name">${sanitize(r.name)}</span>
      ${isManager ? `<button class="rest-del-btn" onclick="deleteRestaurant('${sanitize(r.id)}','${sanitize(r.name)}')">حذف</button>` : ''}
    </div>`).join('');
}

async function addRestaurant() {
  const isManager = userProfile.role === 'manager' || userProfile._savedRole === 'manager';
  if (!isManager) { showToast('❌ المدير فقط يقدر يضيف مطاعم'); return; }
  const name = prompt('اسم المطعم الجديد:');
  if (!name) return;
  await restaurantsRef.add({name:name.trim(),active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  showToast('✅ تم إضافة ' + name);
}

async function deleteRestaurant(id, name) {
  const ordersSnap = await ordersRef.where('restId','==',id).limit(1).get();
  if (!ordersSnap.empty) {
    showModal('تنبيه',`<p style="color:var(--text2);font-size:14px;">لا يمكن حذف "${sanitize(name)}" لأن لديه أوردرات.</p>`,
      [{label:'حسناً',cls:'cancel',action:closeModal}]); return;
  }
  showModal('حذف المطعم',`<p style="color:var(--text2);font-size:14px;">حذف "${sanitize(name)}"؟</p>`,
    [{label:'حذف',cls:'danger',action:async()=>{
      await restaurantsRef.doc(id).delete();
      if (selectedRest===id) selectedRest=null;
      closeModal(); showToast('تم الحذف');
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function getDayStart() {
  // استخدم dayStartAt المحفوظة لو موجودة، وإلا منتصف الليل
  try {
    const saved = localStorage.getItem('nabilpro_daystart_' + currentUser.uid);
    if (saved) {
      const d = new Date(parseInt(saved));
      const today = new Date(); today.setHours(0,0,0,0);
      // لو من نفس اليوم استخدمها، لو قديمة روح منتصف الليل
      if (d >= today) return d;
    }
  } catch(e) {}
  const d = new Date(); d.setHours(0,0,0,0);
  return d;
}

function updateDayStartLabel() {
  const el = document.getElementById('dayStartLabel');
  if (!el) return;
  try {
    const saved = localStorage.getItem('nabilpro_daystart_' + currentUser.uid);
    if (saved) {
      const d = new Date(parseInt(saved));
      const timeStr = d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      el.textContent = `اليوم من ${timeStr}`;
    } else {
      el.textContent = 'اليوم الحالي';
    }
  } catch(e) {}
}

function listenToDriverOrders() {
  if (ordersUnsubscribe) ordersUnsubscribe();
  const todayStart = getDayStart();
  ordersUnsubscribe = ordersRef
    .where('driverId','==',currentUser.uid)
    .where('timestamp','>=', firebase.firestore.Timestamp.fromDate(todayStart))
    .orderBy('timestamp','desc').limit(100)
    .onSnapshot(snap => {
      ordersCache = snap.docs.map(d=>({id:d.id,...d.data()}));
      updateDriverStats(); renderShiftReport(); renderOrdersList(); updateStatusBar();
    }, ()=>{
      document.getElementById('driverStatus').className='status-pill err';
      document.getElementById('statusDot').className='status-dot';
      document.getElementById('statusText').textContent='خطأ في المزامنة';
    });
}

function showRestBalance() {
  const today = getTodayOrders();
  const byRest = {};
  today.forEach(o=>{
    const rn=o.restName||'—';
    if(!byRest[rn]) byRest[rn]={cashOwed:0,visaDelivery:0};
    if(o.payment==='cash') byRest[rn].cashOwed += o.restAmount||0;
    if(o.payment==='visa') byRest[rn].visaDelivery += o.delivery||0;
  });
  const rows = Object.entries(byRest).map(([name,d])=>{
    const net = d.cashOwed - d.visaDelivery;
    const color = net>0?'var(--orange)':net<0?'var(--green)':'var(--text3)';
    const label = net>0?`ج${net} أنت بتدفع`:net<0?`ج${Math.abs(net)} هم بيدفعوا`:'متساوي ✅';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:800">${sanitize(name)}</span>
        <span style="color:${color};font-weight:900">${label}</span>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">كاش: ج${d.cashOwed} | فيزا: ج${d.visaDelivery}</div>
    </div>`;
  }).join('');
  showModal('🏪 حساب المطاعم',
    rows||'<div class="empty-state"><div class="empty-text">لا أوردرات بعد</div></div>',
    [{label:'إغلاق',cls:'cancel',action:closeModal}]);
}

function getTodayOrders() {
  const start = getDayStart();
  return ordersCache.filter(o => {
    if (!o.timestamp) return false;
    const t = o.timestamp.toDate?o.timestamp.toDate():new Date(o.timestamp);
    return t >= start;
  });
}
// ══════════════════════════════════
// بداية يوم جديد للمندوب
// ══════════════════════════════════
function startNewDay() {
  const todayOrders = getTodayOrders();
  const msg = todayOrders.length > 0
    ? `<p style="color:var(--text2);font-size:14px;margin-bottom:8px;">عندك <strong style="color:var(--orange)">${todayOrders.length} أوردر</strong> في اليوم الحالي.</p><p style="color:var(--text3);font-size:13px;">هيتنقلوا للأرشيف وتبدأ يوم جديد من دلوقتي.</p>`
    : `<p style="color:var(--text2);font-size:14px;">هتبدأ يوم جديد من دلوقتي.</p>`;

  showModal('🌅 بداية يوم جديد', msg, [
    {label:'ابدأ',cls:'confirm',action:async()=>{
      const now = Date.now();
      // احفظ وقت البداية
      localStorage.setItem('nabilpro_daystart_' + currentUser.uid, now.toString());
      // احفظ في Firestore كمان
      try {
        await db.collection('users').doc(currentUser.uid).update({
          dayStartAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch(e) {}
      closeModal();
      // أعد تحميل الأوردرات
      listenToDriverOrders();
      updateDayStartLabel();
      showToast('✅ بدأ يومك الجديد!');
    }},
    {label:'إلغاء',cls:'cancel',action:closeModal}
  ]);
}

// أرشيف المندوب
async function showDriverArchive() {
  showModal('📂 أرشيف أوردراتك', `
    <div style="margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <button onclick="loadDriverArchive('today')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">اليوم</button>
        <button onclick="loadDriverArchive('week')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">الأسبوع</button>
        <button onclick="loadDriverArchive('month')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">الشهر</button>
      </div>
    </div>
    <div id="driverArchiveResults" style="max-height:350px;overflow-y:auto">
      <div class="empty-state"><div class="empty-text">اختر فترة</div></div>
    </div>`,
    [{label:'إغلاق',cls:'cancel',action:closeModal}]);
}

async function loadDriverArchive(period) {
  const el = document.getElementById('driverArchiveResults');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="empty-text">⏳ جاري التحميل...</div></div>';
  const now = new Date();
  let startDate;
  if (period === 'today') {
    startDate = new Date(); startDate.setHours(0,0,0,0);
  } else if (period === 'week') {
    startDate = new Date(); startDate.setDate(now.getDate()-7); startDate.setHours(0,0,0,0);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  try {
    const snap = await db.collection('orders')
      .where('driverId','==',currentUser.uid)
      .where('timestamp','>=',firebase.firestore.Timestamp.fromDate(startDate))
      .orderBy('timestamp','desc').limit(100).get();
    const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (!orders.length) { el.innerHTML='<div class="empty-state"><div class="empty-text">لا أوردرات</div></div>'; return; }
    const totalDelivery = orders.reduce((s,o)=>s+(o.delivery||0),0);
    const totalCash = orders.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
    el.innerHTML = `
      <div style="background:var(--bg2);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;justify-content:space-between">
        <span style="font-size:12px;color:var(--text3)">${orders.length} أوردر</span>
        <span style="font-size:12px;color:var(--green);font-weight:800">🛵 ج${totalDelivery}</span>
        <span style="font-size:12px;color:var(--gold);font-weight:800">💵 ج${totalCash}</span>
      </div>` +
      orders.map(o => {
        const t = o.timestamp?.toDate?.()??new Date();
        const timeStr = t.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'}) + ' ' +
                        t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
        return `<div class="feed-card ${o.payment==='visa'?'visa':'cash'}" style="margin-bottom:6px">
          <div class="feed-pay">${o.payment==='visa'?'💳':'💵'}</div>
          <div class="feed-body">
            <div class="feed-rest-name">${sanitize(o.restName||'—')}</div>
            <div class="feed-driver-info">📍 ${sanitize(o.address||'—')}</div>
            <div class="feed-time-txt">⏰ ${timeStr}</div>
          </div>
          <div class="feed-amt">ج${o.delivery||0}</div>
        </div>`;
      }).join('');
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-text">❌ ${e.message}</div></div>`;
  }
}

function updateDriverStats() {
  const today = getTodayOrders();
  const totalDelivery = today.reduce((s,o)=>s+(o.delivery||0),0);
  const totalCashOwed = today.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.restAmount||0),0);
  const totalVisaEarned = today.filter(o=>o.payment==='visa').reduce((s,o)=>s+(o.delivery||0),0);
  const netRestOwed = Math.max(0, totalCashOwed - totalVisaEarned);
  const totalCollected = today.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('statOrders').textContent = today.length;
  document.getElementById('statDelivery').textContent = 'ج' + totalDelivery;
  document.getElementById('statCash').textContent = 'ج' + totalCollected;
  document.getElementById('statRestOwed').textContent = 'ج' + netRestOwed;
}

function updateStatusBar() {
  const today = getTodayOrders();
  document.getElementById('driverStatus').className='status-pill ok';
  document.getElementById('statusDot').className='status-dot pulse';
  document.getElementById('statusText').textContent=`متصل 🔥 • ${today.length} أوردر اليوم`;
}

function renderShiftReport() {
  const today = getTodayOrders();
  if (!today.length) {
    document.getElementById('shiftReport').innerHTML='<div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-text">لا أوردرات اليوم بعد</div></div>';
    return;
  }
  const byRest = {};
  today.forEach(o => {
    const rn = o.restName||'—';
    if (!byRest[rn]) byRest[rn]={orders:0,cashOrders:0,visaOrders:0,delivery:0,cashCollected:0,visaDelivery:0};
    byRest[rn].orders++;
    byRest[rn].delivery += o.delivery||0;
    if (o.payment==='cash') { byRest[rn].cashOrders++; byRest[rn].cashCollected += o.restAmount||0; }
    if (o.payment==='visa') { byRest[rn].visaOrders++; byRest[rn].visaDelivery += o.delivery||0; }
  });
  document.getElementById('shiftReport').innerHTML = Object.entries(byRest).map(([name,d])=>{
    const netBalance = d.cashCollected - d.visaDelivery;
    const balColor = netBalance>0?'var(--orange)':netBalance<0?'var(--green)':'var(--text3)';
    const balLabel = netBalance>0?`عليك للمطعم ج${netBalance}`:netBalance<0?`المطعم مدين لك ج${Math.abs(netBalance)}`:'متساويين ✅';
    return `<div class="report-card">
      <div class="report-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <div>
          <div class="report-rest-name">${sanitize(name)}</div>
          <div class="report-count">${d.orders} أوردر • <span style="color:${balColor};font-weight:800">${balLabel}</span></div>
        </div>
        <div class="report-delivery-val">ج ${d.delivery}</div>
      </div>
      <div class="report-body">
        ${d.cashOrders?`<div class="report-row-detail"><span>💵 كاش (${d.cashOrders})</span><span style="color:var(--orange)">ج${d.cashCollected}</span></div>`:''}
        ${d.visaOrders?`<div class="report-row-detail"><span>💳 فيزا (${d.visaOrders})</span><span style="color:var(--green)">ج${d.visaDelivery}</span></div>`:''}
        <div class="report-row-detail" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">
          <span style="font-weight:800">توصيلي</span>
          <span style="color:var(--green);font-weight:900">ج ${d.delivery}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// FIX: فلتر منسدل موحد للسجلات
// ══════════════════════════════════
function applyFilters() {
  renderOrdersList();
}

function renderOrdersList() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const weekStart = new Date(now); weekStart.setDate(now.getDate()-7);

  const timeVal = document.getElementById('filterTimeSelect')?.value || 'all';
  const payVal  = document.getElementById('filterPaySelect')?.value  || 'all';
  const restVal = document.getElementById('filterRestSelect')?.value || '';

  let list = [...ordersCache];
  if (timeVal==='today') list=list.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=todayStart;});
  else if (timeVal==='week') list=list.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=weekStart;});
  if (payVal==='cash') list=list.filter(o=>o.payment==='cash');
  else if (payVal==='visa') list=list.filter(o=>o.payment==='visa');
  if (restVal) list=list.filter(o=>o.restId===restVal);

  if (!list.length) {
    document.getElementById('ordersList').innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">لا توجد أوردرات</div></div>'; return;
  }
  document.getElementById('ordersList').innerHTML = list.map(o=>{
    const t = o.timestamp?.toDate?.()??new Date(o.timestamp??Date.now());
    const timeStr = t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    const dateStr = t.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'});
    const waLink = buildWhatsappLink(o.phone, o.restName||'');
    return `<div class="order-card ${o.payment||'cash'}">
      <div class="order-head">
        <span class="order-rest-name">${sanitize(o.restName||'—')}</span>
        <span class="order-time-txt">${dateStr} ${timeStr}</span>
      </div>
      <div class="order-body">
        <div class="order-info">
          ${o.address?'📍 '+sanitize(o.address)+'<br>':''}
          ${o.phone?'📞 '+o.phone+'<br>':''}
          <span class="order-pay-badge ${o.payment||'cash'}">${o.payment==='visa'?'💳 فيزا':'💵 كاش'}</span>
        </div>
        <div class="order-amounts">
          <div class="order-delivery-big">ج ${o.delivery||0}</div>
          <div class="order-total-small">إجمالي ج ${o.total||0}</div>
        </div>
      </div>
      <div class="order-actions">
        ${waLink?`<a class="action-btn wa" href="${waLink}" target="_blank">📱 واتساب</a>`:''}
        ${o.address?`<a class="action-btn" href="https://maps.google.com/?q=${encodeURIComponent(o.address)}" target="_blank" style="background:rgba(66,133,244,0.12);color:#4285F4;border:1px solid rgba(66,133,244,0.25);flex:1;padding:9px;border-radius:10px;font-size:12px;font-weight:700;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;">🗺️ خريطة</a>`:''}
        <button class="action-btn edit" onclick="editOrder('${o.id}')">✏️ تعديل</button>
        <button class="action-btn del" onclick="deleteOrder('${o.id}')">🗑 حذف</button>
      </div>
    </div>`;
  }).join('');
}

// kept for compatibility
function setFilter(el, filter) { currentFilter = filter; renderOrdersList(); }

function selectPayment(type) {
  selectedPayment = type;
  document.getElementById('payCash').className='pay-card'+(type==='cash'?' active-cash':'');
  document.getElementById('payVisa').className='pay-card'+(type==='visa'?' active-visa':'');
}

// ══════════════════════════════════
// ADD ORDER — Ghost Tap Fix
// ══════════════════════════════════
let _addOrderInProgress = false;
async function addOrder() {
  // منع الضغط المزدوج
  if (_addOrderInProgress) return;
  _addOrderInProgress = true;

  // اقرأ قيمة الـ select
  const restSel = document.getElementById('restSelect');
  if (restSel) selectedRest = restSel.value || null;

  if (!selectedRest) { showToast('اختر المطعم أولاً'); _addOrderInProgress = false; return; }

  const submitBtn = document.getElementById('submitOrderBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ جاري الحفظ...'; }

  const address  = document.getElementById('addressInput').value.trim();
  const phone    = document.getElementById('phoneOrderInput').value.trim();
  const total    = parseFloat(document.getElementById('restAmountInput').value)||0;
  const delivery = parseFloat(document.getElementById('deliveryInput').value)||0;

  const resetBtn = () => {
    _addOrderInProgress = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✅ حفظ الأوردر'; }
  };

  if (!address)        { showToast('ادخل العنوان');         resetBtn(); return; }
  if (!selectedPayment){ showToast('اختر طريقة الدفع');     resetBtn(); return; }
  if (!total)          { showToast('ادخل إجمالي الأوردر'); resetBtn(); return; }
  if (!delivery)       { showToast('ادخل رسوم التوصيل');   resetBtn(); return; }

  try {
    const rest = restaurantsCache.find(r=>r.id===selectedRest);
    const restAmount = total - delivery;
    const restOwed = selectedPayment==='cash' ? restAmount : -delivery;
    const orderData = {
      driverId:currentUser.uid, driverName:userProfile.name||'مندوب',
      restId:selectedRest, restName:rest?.name||'—',
      restAmount, delivery, total, payment:selectedPayment, address, phone,
      restOwed, settled: false,
      timestamp:firebase.firestore.FieldValue.serverTimestamp()
    };

    if (editingOrderId) {
      await ordersRef.doc(editingOrderId).update(orderData);
      editingOrderId=null;
      showToast('✅ تم تعديل الأوردر');
      // إشعار المدير بالتعديل
      sendPushNotification('', '', 'edit', {
        restName:`✏️ تعديل | ${rest?.name||''}`,
        address, total, delivery,
        payment: selectedPayment,
        driverName: userProfile.name||'مندوب'
      });
    } else {
      await ordersRef.add(orderData);
      showToast('✅ تم حفظ الأوردر');
      sendPushNotification('', '', 'new-order', {
        restName: rest?.name||'—', address, total, delivery,
        payment: selectedPayment, driverName: userProfile.name||'مندوب'
      });
    }

    document.getElementById('addressInput').value='';
    document.getElementById('phoneOrderInput').value='';
    document.getElementById('restAmountInput').value='';
    document.getElementById('deliveryInput').value='';
    if (restSel) restSel.value='';
    selectedRest=null; selectedPayment=null;
    document.getElementById('payCash').className='pay-card';
    document.getElementById('payVisa').className='pay-card';
    resetBtn();
    goPage(0);

  } catch(e) {
    showToast('❌ خطأ: ' + (e.message||''));
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✅ حفظ الأوردر'; }
  }
}

async function editOrder(id) {
  const o = ordersCache.find(x=>x.id===id); if (!o) return;
  editingOrderId=id; selectedRest=o.restId; selectedPayment=o.payment;
  document.getElementById('addressInput').value=o.address||'';
  document.getElementById('phoneOrderInput').value=o.phone||'';
  document.getElementById('restAmountInput').value=o.total||'';
  document.getElementById('deliveryInput').value=o.delivery||'';
  const rs = document.getElementById('restSelect');
  if (rs) rs.value = o.restId||'';
  selectPayment(o.payment); goPage(2); showToast('📝 جاري التعديل...');
}

async function deleteOrder(id) {
  showModal('حذف الأوردر','<p style="color:var(--text2);font-size:14px;">هل تريد حذف هذا الأوردر نهائياً؟</p>',
    [{label:'حذف',cls:'danger',action:async()=>{await ordersRef.doc(id).delete();closeModal();showToast('🗑 تم الحذف');}},
     {label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function goPage(n) {
  currentPage=n;
  document.getElementById('pagesWrapper').style.transform=`translateX(${n*25}%)`;
  ['nav0','nav1','nav3'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', (n===0&&i===0)||(n===1&&i===1)||(n===3&&i===2));
  });
}

function setThemeMode(mode) {
  themeMode = mode; applyTheme(mode);
  try { db.collection('users').doc(currentUser.uid).update({themeMode:mode}); } catch(e){}
  ['dark','light','auto'].forEach(m => {
    const btn = document.getElementById('tmbtn-'+m);
    if (btn) btn.className = 'theme-pill' + (m===mode?' active':'');
  });
}

function cycleTheme() {
  if (themeMode==='dark') themeMode='light';
  else if (themeMode==='light') themeMode='auto';
  else themeMode='dark';
  applyTheme(themeMode);
  try { db.collection('users').doc(currentUser.uid).update({themeMode}); } catch(e){}
}
function toggleTheme() { cycleTheme(); }

function applyTheme(mode) {
  let resolved=mode;
  if (mode==='auto'||!mode) {
    const h = new Date().getHours();
    resolved = (h >= 6 && h < 18) ? 'light' : 'dark';
  }
  document.body.dataset.theme=resolved==='light'?'light':'';
  const label=mode==='auto'?'تلقائي':resolved==='light'?'فاتح':'داكن';
  if (document.getElementById('themeVal')) document.getElementById('themeVal').textContent=label;
  const icon=mode==='auto'?'🔆':resolved==='light'?'🌙':'☀️';
  const iconEl=document.getElementById('themeIcon');
  if (iconEl) iconEl.textContent=icon;
}
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{ if (themeMode==='auto'||!themeMode) applyTheme('auto'); });

function updateClock() {
  const now=new Date();
  const h=now.getHours(),m=now.getMinutes();
  const h12=h%12||12; const mStr=String(m).padStart(2,'0');
  const ampm=h<12?'ص':'م';
  document.getElementById('clockDisplay').textContent=`${h12}:${mStr} ${ampm}`;
  const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const months=['يناير','فبراير','مارس','إبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  if (document.getElementById('dateDisplay'))
    document.getElementById('dateDisplay').textContent=days[now.getDay()]+' '+now.getDate()+' '+months[now.getMonth()];
  const g=document.getElementById('greeting');
  if (g) {
    if (h<12) g.textContent='صباح الخير 👋';
    else if (h<17) g.textContent='مساء النور 💪';
    else g.textContent='النهارده شغال 🔥';
  }
}

function startVoice(inputId, btnId) {
  if (!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)) { showToast('المتصفح لا يدعم الصوت'); return; }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if (recognizer) { recognizer.stop(); recognizer=null; document.getElementById(btnId).classList.remove('on'); return; }
  recognizer=new SR(); recognizer.lang='ar-EG'; recognizer.interimResults=false;
  document.getElementById(btnId).classList.add('on');
  recognizer.onresult=e=>{ document.getElementById(inputId).value=e.results[0][0].transcript; };
  recognizer.onend=()=>{ document.getElementById(btnId).classList.remove('on'); recognizer=null; };
  recognizer.start();
}

// ══════════════════════════════════
// MANAGER AS DRIVER
// ══════════════════════════════════
function initSwipeDriverBtn() {
  const btn=document.getElementById('swipeDriverBtn');
  const h=document.getElementById('stdHandle');
  const fill=document.getElementById('stdFill');
  const txt=document.getElementById('stdTxt');
  const done=document.getElementById('stdDone');
  if(!btn||!h) return;
  let sx=0,drag=false,cx=0;
  const max=()=>btn.offsetWidth-h.offsetWidth-10;
  function set(x){
    const c=Math.max(0,Math.min(x,max())),p=c/max();
    h.style.right=(5+(max()-c))+'px';
    fill.style.transform=`translateX(${(1-p)*100}%)`;
    txt.style.opacity=Math.max(0,1-p*2);
  }
  function finish(ok){
    h.style.transition='right .35s cubic-bezier(.4,0,.2,1)';
    fill.style.transition='transform .35s cubic-bezier(.4,0,.2,1)';
    if(ok){
      set(max()); txt.style.display='none'; done.style.opacity=1;
      if(navigator.vibrate) navigator.vibrate([20,40,20]);
      setTimeout(()=>{ closeModal(); switchToDriverMode(); },400);
    } else { set(0); }
    cx=0;
  }
  h.addEventListener('touchstart',e=>{ e.stopPropagation(); sx=e.touches[0].clientX; drag=true; h.style.transition='none'; fill.style.transition='none'; },{passive:true});
  document.addEventListener('touchmove',e=>{ if(!drag)return; cx=sx-e.touches[0].clientX; set(cx); },{passive:true});
  document.addEventListener('touchend',()=>{ if(!drag)return; drag=false; finish(cx>=max()*.6); },{passive:true});
  h.addEventListener('mousedown',e=>{ sx=e.clientX; drag=true; h.style.transition='none'; fill.style.transition='none';
    const mv=e2=>{ cx=sx-e2.clientX; set(cx); };
    const up=()=>{ drag=false; finish(cx>=max()*.6); document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
  });
}

function showMgrSettings() {
  showModal('⚙️ الإعدادات', `
    <div class="settings-group" style="margin-bottom:12px">
      <div class="settings-item" onclick="editMgrName()">
        <div class="settings-item-icon">👤</div>
        <div class="settings-item-label">الاسم</div>
        <div class="settings-item-val">${sanitize(userProfile.name||'مدير')}</div>
      </div>
    </div>
    <div class="settings-group" style="margin-bottom:12px">
      <div class="settings-item" style="flex-direction:column;align-items:flex-start;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;width:100%">
          <div class="settings-item-icon">🌙</div>
          <div class="settings-item-label">المظهر</div>
        </div>
        <div style="display:flex;gap:8px;width:100%">
          <button onclick="setThemeMode('dark')" id="tmbtn-dark" class="theme-pill ${themeMode==='dark'?'active':''}">داكن</button>
          <button onclick="setThemeMode('light')" id="tmbtn-light" class="theme-pill ${themeMode==='light'?'active':''}">فاتح</button>
          <button onclick="setThemeMode('auto')" id="tmbtn-auto" class="theme-pill ${themeMode==='auto'?'active':''}">تلقائي</button>
        </div>
      </div>
    </div>
    <div class="settings-group" style="margin-bottom:12px">
      <div style="padding:4px 0 8px">
        <div style="font-size:10px;color:rgba(255,255,255,0.35);font-weight:700;margin-bottom:8px;">🛵 وضع المندوب</div>
        <div class="swipe-to-driver" id="swipeDriverBtn">
          <div class="std-fill" id="stdFill"></div>
          <div class="std-handle" id="stdHandle">🛵</div>
          <div class="std-txt" id="stdTxt"><span class="std-arr">←</span> اسحب للتحويل</div>
          <div class="std-done" id="stdDone">🛵 تم التحويل!</div>
        </div>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-item danger" onclick="closeModal();confirmLogout()">
        <div class="settings-item-icon" style="background:var(--red-bg)">⏏️</div>
        <div class="settings-item-label" style="color:var(--red)">تسجيل الخروج</div>
      </div>
    </div>`,
    [{label:'إغلاق',cls:'cancel',action:closeModal}]);
  setTimeout(initSwipeDriverBtn, 50);
}

function editMgrName() {
  showModal('تغيير الاسم',`<input class="form-field" id="newMgrName" value="${sanitize(userProfile.name||'')}" placeholder="اسمك...">`,
    [{label:'حفظ',cls:'confirm',action:async()=>{
      const name=document.getElementById('newMgrName').value.trim()||'مدير';
      userProfile.name=name;
      await db.collection('users').doc(currentUser.uid).update({name});
      document.getElementById('managerBadge').textContent=name;
      closeModal(); showToast('✅ تم تغيير الاسم');
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function switchToDriverMode() {
  userProfile._savedRole = userProfile.role;
  userProfile.role = 'driver';
  _fcmSubscribed = false;
  initDriverApp();
  showToast('🛵 وضع المندوب — اضغط ⚙️ للعودة للإدارة');
}

function switchBackToManager() {
  if (userProfile._savedRole === 'manager') {
    userProfile.role = 'manager';
    initManagerApp();
  }
}

// ══════════════════════════════════
// MANAGER APP
// ══════════════════════════════════
function updateNotifBtn() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;
  btn.style.display = Notification.permission === 'granted' ? 'none' : '';
}

function initManagerApp() {
  themeMode=userProfile.themeMode||'auto'; applyTheme(themeMode);
  document.getElementById('managerBadge').textContent=userProfile.name||'مدير';
  setTimeout(()=>{
    if (Notification.permission==='default') {
      Notification.requestPermission().then(p=>{
        if(p==='granted') subscribeFCM();
        updateNotifBtn();
      });
    } else if (Notification.permission==='granted') {
      subscribeFCM();
    }
    updateNotifBtn();
  },2000);
  const now=new Date();
  const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const months=['يناير','فبراير','مارس','إبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  document.getElementById('mgrHeroDate').textContent=days[now.getDay()]+'، '+now.getDate()+' '+months[now.getMonth()];
  showScreen('managerApp');
  listenAllOrders(); loadAllDrivers(); loadMgrRestaurants(); listenToRestaurants();
  // تحقق من الأوردرات القديمة شهرياً
  setTimeout(checkMonthlyCleanup, 3000);
}

async function checkMonthlyCleanup() {
  try {
    const lastCheck = localStorage.getItem('nabilpro_cleanup_check');
    const now = Date.now();
    // تحقق مرة كل 7 أيام بس
    if (lastCheck && (now - parseInt(lastCheck)) < 7 * 24 * 60 * 60 * 1000) return;
    localStorage.setItem('nabilpro_cleanup_check', now.toString());

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const snap = await db.collection('orders')
      .where('timestamp','<', firebase.firestore.Timestamp.fromDate(monthAgo))
      .limit(1).get();

    if (!snap.empty) {
      // فيه أوردرات أقدم من شهر
      showModal('🗑 تنظيف شهري', `
        <p style="color:var(--text2);font-size:14px;margin-bottom:12px;">
          فيه أوردرات أقدم من شهر في قاعدة البيانات.
        </p>
        <p style="color:var(--text3);font-size:13px;">
          حذفها هيوفر مساحة ويخلي التطبيق أسرع.
        </p>`,
        [{label:'🗑 حذف الأوردرات القديمة',cls:'danger',action:()=>deleteOldOrders(monthAgo)},
         {label:'تذكيرني بعدين',cls:'cancel',action:closeModal}]);
    }
  } catch(e) {}
}

async function deleteOldOrders(before) {
  const btn = document.getElementById('mBtn0');
  if (btn) { btn.disabled=true; btn.textContent='جاري الحذف...'; }
  try {
    let deleted = 0;
    let snap;
    do {
      snap = await db.collection('orders')
        .where('timestamp','<', firebase.firestore.Timestamp.fromDate(before))
        .limit(50).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.docs.length;
    } while (!snap.empty);
    closeModal();
    showToast(`✅ تم حذف ${deleted} أوردر قديم`);
  } catch(e) {
    if (btn) { btn.disabled=false; btn.textContent='🗑 حذف الأوردرات القديمة'; }
    showToast('❌ خطأ: ' + e.message);
  }
}

function listenAllOrders() {
  if (allOrdersUnsubscribe) allOrdersUnsubscribe();
  // FIX timezone: نبدأ من 4 ساعات قبل منتصف الليل
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  todayStart.setTime(todayStart.getTime() - (4 * 60 * 60 * 1000));
  allOrdersUnsubscribe = db.collection('orders')
    .where('timestamp','>=', firebase.firestore.Timestamp.fromDate(todayStart))
    .orderBy('timestamp','desc').limit(200)
    .onSnapshot(snap=>{
      allOrders = snap.docs.map(d=>({id:d.id,...d.data()}));
      updateMgrOverview(); renderMgrRecentOrders(); renderMgrReports();
    }, ()=>{});
}

function updateMgrOverview() {
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const today=allOrders.filter(o=>{
    if (!o.timestamp) return false;
    const t=o.timestamp.toDate?o.timestamp.toDate():new Date(o.timestamp);
    return t>=todayStart;
  });
  const driverIds=[...new Set(today.map(o=>o.driverId))];
  const totalDelivery=today.reduce((s,o)=>s+(o.delivery||0),0);
  const totalCash=today.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('mgrStatDrivers').textContent=driverIds.length;
  document.getElementById('mgrStatOrders').textContent=today.length;
  document.getElementById('mgrStatDelivery').textContent='ج'+totalDelivery;
  document.getElementById('mgrStatCash').textContent='ج'+totalCash;
}

function renderMgrRecentOrders() {
  const recent=allOrders.slice(0,20);
  if (!recent.length) {
    document.getElementById('mgrRecentOrders').innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">لا أوردرات بعد</div></div>'; return;
  }
  document.getElementById('mgrRecentOrders').innerHTML=recent.map(o=>{
    const t=o.timestamp?.toDate?.()??new Date();
    const timeStr=t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    const isVisa=o.payment==='visa';
    return `<div class="feed-card ${isVisa?'visa':'cash'}">
      <div class="feed-pay">${isVisa?'💳':'💵'}</div>
      <div class="feed-body">
        <div class="feed-rest-name">${sanitize(o.restName||'—')}</div>
        <div class="feed-driver-info">👤 ${sanitize(o.driverName||'—')} • 📍 ${sanitize(o.address||'—')}</div>
        <div class="feed-time-txt">⏰ ${timeStr}</div>
      </div>
      <div class="feed-amt">ج ${o.delivery||0}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// فلتر المدير المنسدل
// ══════════════════════════════════
function filterMgrOrders() {
  const timeVal = document.getElementById('mgrFilterTime')?.value || 'today';
  const restVal = document.getElementById('mgrFilterRest')?.value || '';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const weekStart = new Date(now); weekStart.setDate(now.getDate()-7);

  let list = [...allOrders];
  if (timeVal==='today') list=list.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=todayStart;});
  else if (timeVal==='week') list=list.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=weekStart;});
  if (restVal) list=list.filter(o=>o.restName===restVal);

  if (!list.length) {
    document.getElementById('mgrRecentOrders').innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">لا نتائج</div></div>'; return;
  }
  document.getElementById('mgrRecentOrders').innerHTML = list.slice(0,30).map(o=>{
    const t=o.timestamp?.toDate?.()??new Date();
    const timeStr=t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    const dateStr=t.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'});
    const isVisa=o.payment==='visa';
    return `<div class="feed-card ${isVisa?'visa':'cash'}">
      <div class="feed-pay">${isVisa?'💳':'💵'}</div>
      <div class="feed-body">
        <div class="feed-rest-name">${sanitize(o.restName||'—')}</div>
        <div class="feed-driver-info">👤 ${sanitize(o.driverName||'—')} • 📍 ${sanitize(o.address||'—')}</div>
        <div class="feed-time-txt">⏰ ${dateStr} ${timeStr}</div>
      </div>
      <div class="feed-amt">ج ${o.delivery||0}</div>
    </div>`;
  }).join('');
}

function searchOrders(q) { filterMgrOrders(); }

async function loadAllDrivers() {
  const snap=await db.collection('users').limit(100).get();
  allDrivers=snap.docs.map(d=>({uid:d.id,...d.data()}));
  renderDriversList();
}

function renderDriversList(filter='') {
  const managers=allDrivers.filter(d=>d.role==='manager');
  const drivers=allDrivers.filter(d=>d.role!=='manager');
  let mgrs=managers, drvs=drivers;
  if (filter) {
    const q=filter.toLowerCase();
    mgrs=managers.filter(d=>(d.name||'').includes(q)||(d.phone||'').includes(q));
    drvs=drivers.filter(d=>(d.name||'').includes(q)||(d.phone||'').includes(q));
  }
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  function buildCard(d,isMgr) {
    const dOrders=allOrders.filter(o=>o.driverId===d.uid);
    const todayO=dOrders.filter(o=>{if(!o.timestamp)return false;const t=o.timestamp.toDate?o.timestamp.toDate():new Date(o.timestamp);return t>=todayStart;});
    const todayD=todayO.reduce((s,o)=>s+(o.delivery||0),0);
    const initials=(d.name||'م').charAt(0);
    const isOnline=d.lastSeen&&((Date.now()-(d.lastSeen.toDate?d.lastSeen.toDate():new Date(d.lastSeen)).getTime())<300000);
    const cardType=isMgr?'manager-type':'driver-type';
    return `<div class="user-card ${cardType}" onclick="showDriverDetail('${d.uid}')">
      <div class="user-avatar">${initials}<div class="online-indicator ${isOnline?'on':''}"></div></div>
      <div class="user-info">
        <div class="user-name-txt">${sanitize(d.name||'بدون اسم')}</div>
        <div class="user-phone-txt">${sanitize(d.phone||'—')}</div>
        <div class="user-pills">
          ${!isMgr?`<span class="upill orders">📦 ${todayO.length}</span><span class="upill earn">ج ${todayD}</span>`:''}
          ${isMgr?'<span class="upill role">👑 مدير</span>':''}
        </div>
      </div>
      <span style="color:var(--text3);font-size:14px;">‹</span>
    </div>`;
  }
  let html='';
  if (mgrs.length) {
    html+=`<div class="team-section-header">
      <span class="team-section-lbl">👑 المديرين <span class="count-pill">${mgrs.length}</span></span>
      <button class="mini-add-btn" onclick="showAddUserModal('manager')">+ مدير</button>
    </div>`;
    html+=mgrs.map(d=>buildCard(d,true)).join('');
  }
  html+=`<div class="team-section-header">
    <span class="team-section-lbl">🛵 المناديب <span class="count-pill">${drvs.length}</span></span>
    <button class="mini-add-btn" onclick="showAddUserModal('driver')">+ مندوب</button>
  </div>`;
  html+=drvs.length?drvs.map(d=>buildCard(d,false)).join('')
    :'<div class="empty-state" style="padding:20px 0;"><div class="empty-text">لا مناديب بعد</div></div>';
  document.getElementById('driversList').innerHTML=html;
}

function filterDrivers() { renderDriversList(document.getElementById('driverSearch').value.trim()); }

// ══════════════════════════════════
// FIX: إرسال ملاحظة — disable فوري
// ══════════════════════════════════
function showAddNoteModal(driverUid) {
  const driver = allDrivers.find(d => d.uid === driverUid);
  if (!driver) return;
  showModal('📝 إضافة ملاحظة', `
    <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">إلى: <strong>${sanitize(driver.name||'')}</strong></div>
    <textarea class="form-field" id="noteText" placeholder="اكتب ملاحظتك هنا..." style="height:100px;resize:none;" maxlength="300"></textarea>`,
    [{label:'إرسال',cls:'confirm',action:async()=>{
      const note = document.getElementById('noteText').value.trim();
      if (!note) { showToast('اكتب الملاحظة'); return; }
      const btn = document.getElementById('mBtn0');
      if (btn) { btn.disabled=true; btn.textContent='جاري الإرسال...'; }
      // FIX: منع الإرسال المكرر — timestamp check
      const nowTs = Date.now();
      if (window._lastNoteSentAt && (nowTs - window._lastNoteSentAt) < 5000) {
        closeModal(); showToast('✅ تم إرسال الملاحظة'); return;
      }
      window._lastNoteSentAt = nowTs;
      try {
        const res = await fetch('/api/notify-driver',{
          method:'POST', headers: await getAuthHeaders(),
          body:JSON.stringify({uid:driverUid, title:'📝 ملاحظة من المدير', body:note})
        });
        if (!res.ok) {
          const errData = await res.json().catch(()=>({}));
          throw new Error(errData.error||'خطأ في الإرسال');
        }
        await db.collection('notes').add({
          driverId: driverUid, driverName: driver.name,
          managerId: currentUser.uid, text: note,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); showToast('✅ تم إرسال الملاحظة');
      } catch(e) {
        window._lastNoteSentAt = null;
        if(btn){btn.disabled=false;btn.textContent='إرسال';}
        showToast('❌ ' + (e.message||'خطأ في الإرسال'));
      }
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function showAddUserModal(role='driver') {
  const isDriver=role==='driver';
  showModal((isDriver?'➕ إضافة مندوب':'➕ إضافة مدير'),`
    <div style="margin-bottom:12px;"><div class="field-label">👤 الاسم</div>
      <input class="form-field" id="newUserName" placeholder="${isDriver?'اسم المندوب':'اسم المدير'}"></div>
    <div style="margin-bottom:12px;"><div class="field-label">📱 رقم الموبايل</div>
      <input class="form-field" type="tel" id="newUserPhone" placeholder="01xxxxxxxxx" inputmode="numeric"></div>
    <div style="margin-bottom:8px;"><div class="field-label">🔑 كود الدخول (6 أرقام)</div>
      <input class="form-field" type="tel" id="newUserPin" placeholder="123456" maxlength="6" inputmode="numeric"></div>`,
    [{label:'إنشاء',cls:'confirm',action:()=>addUser(role)},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

async function addUser(role) {
  const name=document.getElementById('newUserName').value.trim();
  const phone=document.getElementById('newUserPhone').value.trim();
  const pin=document.getElementById('newUserPin').value.trim();
  if (!name){showToast('ادخل الاسم');return;}
  if (phone.length<10){showToast('ادخل رقم صحيح');return;}
  if (pin.length!==6){showToast('الكود لازم 6 أرقام');return;}
  const btn=document.getElementById('mBtn0');
  if (btn){btn.disabled=true;btn.textContent='جاري الإنشاء...';}
  let p=phone.replace(/\D/g,''); if(!p.startsWith('0'))p='0'+p;
  const email=p+'@nabilpro.app';
  try {
    let secondaryApp;
    try{secondaryApp=firebase.app('secondary');}catch(e){secondaryApp=firebase.initializeApp(FIREBASE_CONFIG,'secondary');}
    const secondaryAuth=secondaryApp.auth();
    const result=await secondaryAuth.createUserWithEmailAndPassword(email,pin);
    const uid=result.user.uid; await secondaryAuth.signOut();
    await db.collection('users').doc(uid).set({uid,name,phone:p,email,role,pin,createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:currentUser.uid});
    allDrivers.push({uid,name,phone:p,email,role}); renderDriversList(); closeModal();
    showToast('✅ تم إنشاء حساب '+name);
  } catch(err) {
    if(btn){btn.disabled=false;btn.textContent='إنشاء';}
    if(err.code==='auth/email-already-in-use')showToast('❌ الرقم ده موجود بالفعل');
    else showToast('خطأ في الاتصال');
  }
}

function showDriverDetail(uid) {
  selectedDriverUid=uid;
  const driver=allDrivers.find(d=>d.uid===uid); if(!driver)return;
  document.getElementById('detailDriverName').textContent=driver.name||'—';
  document.getElementById('detailDriverPhone').textContent=driver.phone||'—';
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const dOrders=allOrders.filter(o=>o.driverId===uid);
  const todayO=dOrders.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=todayStart;});
  const todayD=todayO.reduce((s,o)=>s+(o.delivery||0),0);
  const todayC=todayO.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('detailOrders').textContent=todayO.length;
  document.getElementById('detailDelivery').textContent='ج'+todayD;
  document.getElementById('detailTotal').textContent='ج'+todayC;
  document.getElementById('detailOrdersList').innerHTML=todayO.length
    ?todayO.map(o=>{
      const t=o.timestamp?.toDate?.()??new Date();
      const timeStr=t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      return `<div class="feed-card ${o.payment==='visa'?'visa':'cash'}">
        <div class="feed-pay">${o.payment==='visa'?'💳':'💵'}</div>
        <div class="feed-body">
          <div class="feed-rest-name">${sanitize(o.restName||'—')}</div>
          <div class="feed-driver-info">📍 ${sanitize(o.address||'—')}</div>
          <div class="feed-time-txt">⏰ ${timeStr}</div>
        </div>
        <div class="feed-amt">ج ${o.delivery||0}</div>
      </div>`;
    }).join('')
    :'<div class="empty-state"><div class="empty-text">لا أوردرات اليوم</div></div>';
  const extraBtns = document.getElementById('detailExtraBtns');
  if (extraBtns) {
    extraBtns.innerHTML = `
      <button class="modal-btn confirm" onclick="settleDriverAccount('${uid}')" style="width:100%;margin-bottom:8px">💰 تصفية حساب اليوم</button>
      <button class="modal-btn cancel" onclick="showDriverMonthlyStats('${uid}')" style="width:100%;margin-bottom:8px">📅 إحصائيات الشهر</button>
      <button class="modal-btn cancel" onclick="editDriverFull('${uid}')" style="width:100%;margin-bottom:8px;background:var(--orange-bg);color:var(--orange);border-color:var(--orange)">✏️ تعديل بيانات المندوب</button>
      <button class="modal-btn cancel" onclick="showAddNoteModal('${uid}')" style="width:100%;background:var(--blue-bg);color:var(--blue);border-color:var(--blue)">📝 إرسال ملاحظة</button>`;
  }
  document.getElementById('driverDetailOverlay').classList.add('show');
}

// ══════════════════════════════════
// FIX: دالة تعديل موحدة للمدير
// editDriverFull = اسم + هاتف + PIN
// ══════════════════════════════════
function editDriverFull(uid) {
  const driver = allDrivers.find(d => d.uid === uid);
  if (!driver) return;
  showModal('✏️ تعديل — ' + sanitize(driver.name||''), `
    <div style="margin-bottom:12px">
      <div class="field-label">👤 الاسم</div>
      <input class="form-field" id="ef_name" value="${sanitize(driver.name||'')}" placeholder="الاسم">
    </div>
    <div style="margin-bottom:12px">
      <div class="field-label">📞 رقم الهاتف</div>
      <input class="form-field" type="tel" id="ef_phone" value="${sanitize(driver.phone||'')}" placeholder="01xxxxxxxxx" inputmode="numeric">
    </div>
    <div style="margin-bottom:16px">
      <div class="field-label">🔑 كود جديد (اتركه فاضي لو مش عايز تغيره)</div>
      <input class="form-field" type="tel" id="ef_pin" placeholder="123456" maxlength="6" inputmode="numeric" oninput="this.value=this.value.replace(/\\D/g,'')">
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="quickRoleToggle('${uid}')" style="flex:1;padding:10px;border-radius:10px;background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple);font-family:'Cairo',sans-serif;font-weight:700;font-size:12px;cursor:pointer;touch-action:manipulation">${driver.role==='manager'?'👑 تحويل لمندوب':'👑 ترقية لمدير'}</button>
      <button onclick="quickDeleteDriver('${uid}')" style="flex:1;padding:10px;border-radius:10px;background:var(--red-bg);color:var(--red);border:1px solid var(--red);font-family:'Cairo',sans-serif;font-weight:700;font-size:12px;cursor:pointer;touch-action:manipulation">🗑 حذف الحساب</button>
    </div>`,
    [{label:'💾 حفظ التعديلات',cls:'confirm',action:async()=>{
      const name  = document.getElementById('ef_name').value.trim();
      const phone = document.getElementById('ef_phone').value.trim();
      const pin   = document.getElementById('ef_pin').value.trim();
      if (!name) { showToast('ادخل الاسم'); return; }
      const btn = document.getElementById('mBtn0');
      if (btn) { btn.disabled=true; btn.textContent='جاري...'; }
      try {
        const updates = { name };
        if (phone.length >= 10) updates.phone = phone.replace(/\D/g,'');
        // حفظ Firestore وتغيير PIN في نفس الوقت
        const promises = [db.collection('users').doc(uid).update(updates)];
        if (pin.length === 6) {
          promises.push(
            fetch('/api/update-pin', {
              method:'POST', headers: await getAuthHeaders(),
              body: JSON.stringify({ uid, pin })
            }).then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error||'خطأ PIN'); }))
          );
        }
        await Promise.all(promises);
        driver.name = name;
        if (phone.length >= 10) driver.phone = phone.replace(/\D/g,'');
        document.getElementById('detailDriverName').textContent = name;
        renderDriversList(); closeModal();
        showToast('✅ تم تحديث ' + name + (pin.length===6?' وتغيير الكود':''));
      } catch(e) {
        if (btn) { btn.disabled=false; btn.textContent='💾 حفظ التعديلات'; }
        showToast('❌ ' + (e.message||'خطأ'));
      }
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function quickRoleToggle(uid) {
  const driver = allDrivers.find(d => d.uid === uid);
  if (!driver) return;
  const newRole = driver.role==='manager' ? 'driver' : 'manager';
  closeModal();
  showModal(newRole==='manager'?'ترقية لمدير':'تحويل لمندوب',
    `<p style="color:var(--text2);font-size:14px;">${sanitize(driver.name)} → ${newRole==='manager'?'مدير':'مندوب'}؟</p>`,
    [{label:'تأكيد',cls:'confirm',action:async()=>{
      await db.collection('users').doc(uid).update({role:newRole});
      driver.role=newRole; renderDriversList(); closeModal(); showToast('✅ تم');
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function quickDeleteDriver(uid) {
  if (uid===currentUser.uid){showToast('❌ مش تقدر تحذف حسابك');return;}
  const driver = allDrivers.find(d => d.uid === uid);
  closeModal();
  showModal('حذف الحساب',`<p style="color:var(--red);font-size:14px;">حذف "${sanitize(driver?.name||'')}"؟ الأوردرات القديمة هتفضل محفوظة.</p>`,
    [{label:'🗑 حذف',cls:'danger',action:async()=>{
      await db.collection('users').doc(uid).delete();
      allDrivers=allDrivers.filter(d=>d.uid!==uid);
      renderDriversList(); closeModal(); closeDriverDetail(); showToast('✅ تم الحذف');
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function closeDriverDetail() { document.getElementById('driverDetailOverlay').classList.remove('show'); selectedDriverUid=null; }

// backward compat
async function toggleDriverRole() { if(selectedDriverUid) quickRoleToggle(selectedDriverUid); }
async function editDriverInfo() { if(selectedDriverUid) editDriverFull(selectedDriverUid); }
async function changeDriverPin() { if(selectedDriverUid) editDriverFull(selectedDriverUid); }
async function removeDriver() { if(selectedDriverUid) quickDeleteDriver(selectedDriverUid); }

async function settleDriverAccount(driverUid) {
  if (!driverUid) driverUid = selectedDriverUid;
  if (!driverUid) return;
  const driver = allDrivers.find(d => d.uid === driverUid);
  if (!driver) return;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const dOrders = allOrders.filter(o => {
    if (o.driverId !== driverUid || !o.timestamp) return false;
    const t = o.timestamp.toDate ? o.timestamp.toDate() : new Date(o.timestamp);
    return t >= todayStart && !o.settled;
  });
  if (!dOrders.length) {
    showModal('تصفية الحساب','<p style="color:var(--text2)">لا أوردرات غير مسوّاة اليوم.</p>',
      [{label:'إغلاق',cls:'cancel',action:closeModal}]); return;
  }
  const totalCash=dOrders.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
  const totalRestOwed=dOrders.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.restAmount||0),0);
  const totalDelivery=dOrders.reduce((s,o)=>s+(o.delivery||0),0);
  const netCash=totalCash-totalRestOwed;
  showModal('💰 تصفية حساب '+sanitize(driver.name),`
    <div style="text-align:center;padding:8px 0 16px">
      <div style="font-size:32px;font-weight:900;color:var(--orange)">${dOrders.length} أوردر</div>
    </div>
    <div class="settings-group" style="margin-bottom:16px">
      <div class="report-row-detail" style="padding:10px 0"><span>💵 كاش محصّل</span><span style="color:var(--gold);font-weight:900">ج${totalCash}</span></div>
      <div class="report-row-detail" style="padding:10px 0"><span>🏪 للمطاعم</span><span style="color:var(--orange);font-weight:900">ج${totalRestOwed}</span></div>
      <div class="report-row-detail" style="padding:10px 0;border-top:2px solid var(--border);margin-top:4px">
        <span style="font-weight:900">💰 يسلّم للمدير</span><span style="color:var(--green);font-weight:900;font-size:18px">ج${netCash}</span>
      </div>
      <div class="report-row-detail" style="padding:10px 0"><span>🛵 توصيله</span><span style="color:var(--blue);font-weight:900">ج${totalDelivery}</span></div>
    </div>`,
    [{label:'✅ تأكيد التصفية',cls:'confirm',action:async()=>{
      const btn=document.getElementById('mBtn0');
      if(btn){btn.disabled=true;btn.textContent='جاري...';}
      try {
        const batch=db.batch();
        dOrders.forEach(o=>{
          batch.update(db.collection('orders').doc(o.id),{settled:true,settledAt:firebase.firestore.FieldValue.serverTimestamp(),settledBy:currentUser.uid});
        });
        batch.set(db.collection('settlements').doc(),{
          driverId:driverUid,driverName:driver.name,managerId:currentUser.uid,
          totalCash,totalRestOwed,netCash,totalDelivery,ordersCount:dOrders.length,
          date:firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
        await fetch('/api/notify-driver',{
          method:'POST',headers: await getAuthHeaders(),
          body:JSON.stringify({uid:driverUid,title:'✅ تمت تصفية حسابك',body:`المدير سوّى حسابك — ${dOrders.length} أوردر، توصيلك ج${totalDelivery}`})
        }).catch(()=>{});
        closeModal(); showToast(`✅ تمت تصفية حساب ${driver.name}`);
      } catch(e){if(btn){btn.disabled=false;btn.textContent='✅ تأكيد التصفية';}showToast('❌ '+e.message);}
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

async function loadMgrRestaurants() {
  const snap=await db.collection('restaurants').orderBy('name').limit(50).get();
  const rests=snap.docs.map(d=>({id:d.id,...d.data()}));
  document.getElementById('mgrRestsList').innerHTML=rests.length
    ?rests.map(r=>`<div class="rest-card-mgr">
      <div class="rest-card-icon">🏪</div>
      <span class="rest-card-name">${sanitize(r.name)}</span>
      <button class="rest-del-btn-mgr" onclick="deleteMgrRest('${sanitize(r.id)}','${sanitize(r.name)}')">حذف</button>
    </div>`).join('')
    :'<div class="empty-state"><div class="empty-text">لا مطاعم بعد</div></div>';
}

function showAddRestModal() {
  showModal('إضافة مطعم',`<input class="form-field" id="newRestName" placeholder="اسم المطعم">`,
    [{label:'إضافة',cls:'confirm',action:async()=>{
      const name=document.getElementById('newRestName').value.trim(); if(!name)return;
      await db.collection('restaurants').add({name,active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); showToast('✅ تم إضافة '+name); loadMgrRestaurants();
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

async function deleteMgrRest(id,name) {
  showModal('حذف المطعم',`<p style="color:var(--text2);">حذف "${sanitize(name)}"؟</p>`,
    [{label:'حذف',cls:'danger',action:async()=>{
      await db.collection('restaurants').doc(id).delete();
      closeModal(); showToast('✅ تم الحذف'); loadMgrRestaurants();
    }},{label:'إلغاء',cls:'cancel',action:closeModal}]);
}

function mgrTab(n,el) {
  document.querySelectorAll('.mgr-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.mgr-panel').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); document.getElementById('mgrPanel'+n).classList.add('active');
  if (n===1) renderDriversList();
  if (n===2) loadMgrRestaurants();
  if (n===3) renderMgrReports();
}

function setReportPeriod(p,el) {
  reportPeriod=p;
  document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active'); renderMgrReports();
}

let mgrReportView = 'drivers';

function renderMgrReports() {
  const now=new Date(); let startDate;
  if (reportPeriod==='today') startDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  else if (reportPeriod==='week') {startDate=new Date(now);startDate.setDate(now.getDate()-7);}
  else startDate=new Date(now.getFullYear(),now.getMonth(),1);
  const filtered=allOrders.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=startDate;});
  const totalDelivery=filtered.reduce((s,o)=>s+(o.delivery||0),0);
  const byDriver={};
  filtered.forEach(o=>{
    if (!byDriver[o.driverId]) byDriver[o.driverId]={name:o.driverName||'—',orders:0,delivery:0,cashCollected:0};
    byDriver[o.driverId].orders++; byDriver[o.driverId].delivery+=o.delivery||0;
    if (o.payment==='cash') byDriver[o.driverId].cashCollected+=o.total||0;
  });
  const byRest={};
  filtered.forEach(o=>{
    const rn=o.restName||'—';
    if (!byRest[rn]) byRest[rn]={orders:0,cashOwed:0,visaDelivery:0,delivery:0};
    byRest[rn].orders++; byRest[rn].delivery+=o.delivery||0;
    if (o.payment==='cash') byRest[rn].cashOwed+=o.restAmount||0;
    if (o.payment==='visa') byRest[rn].visaDelivery+=o.delivery||0;
  });
  const driverEntries=Object.entries(byDriver).sort((a,b)=>b[1].delivery-a[1].delivery);
  const restEntries=Object.entries(byRest).sort((a,b)=>b[1].orders-a[1].orders);
  const rankClasses=['gold','silver','bronze'];
  document.getElementById('reportsContent').innerHTML=`
    <div class="report-stat-big">
      <div class="report-stat-icon">📊</div>
      <div class="report-stat-info">
        <div class="report-stat-lbl">إجمالي التوصيل</div>
        <div class="report-stat-num">ج ${totalDelivery}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button onclick="mgrReportView='drivers';renderMgrReports()" style="flex:1;padding:9px;border-radius:12px;border:1px solid ${mgrReportView==='drivers'?'var(--orange)':'var(--border)'};background:${mgrReportView==='drivers'?'var(--orange-bg)':'var(--card)'};color:${mgrReportView==='drivers'?'var(--orange)':'var(--text2)'};font-family:'Cairo',sans-serif;font-weight:800;font-size:12px;cursor:pointer;touch-action:manipulation">👥 المناديب</button>
      <button onclick="mgrReportView='restaurants';renderMgrReports()" style="flex:1;padding:9px;border-radius:12px;border:1px solid ${mgrReportView==='restaurants'?'var(--orange)':'var(--border)'};background:${mgrReportView==='restaurants'?'var(--orange-bg)':'var(--card)'};color:${mgrReportView==='restaurants'?'var(--orange)':'var(--text2)'};font-family:'Cairo',sans-serif;font-weight:800;font-size:12px;cursor:pointer;touch-action:manipulation">🏪 المطاعم</button>
    </div>
    ${mgrReportView==='drivers'?
      driverEntries.map(([uid,d],i)=>`
        <div class="rank-card">
          <div class="rank-num ${rankClasses[i]||'default'}">${i+1}</div>
          <div><div class="rank-name">${sanitize(d.name)}</div>
          <div class="rank-orders">${d.orders} أوردر • ج${d.cashCollected} كاش</div></div>
          <div class="rank-earn">ج ${d.delivery}</div>
        </div>`).join('')||'<div class="empty-state"><div class="empty-text">لا بيانات</div></div>'
    :
      restEntries.map(([name,d])=>{
        const net=d.cashOwed-d.visaDelivery;
        const netColor=net>0?'var(--orange)':net<0?'var(--green)':'var(--text3)';
        const netLabel=net>0?`مدينين ج${net}`:net<0?`مدين ج${Math.abs(net)}`:'متساوي';
        return `<div class="report-card" style="margin-bottom:10px">
          <div class="report-header" onclick="this.nextElementSibling.classList.toggle('open')">
            <div><div class="report-rest-name">${sanitize(name)}</div>
            <div class="report-count">${d.orders} أوردر</div></div>
            <div style="text-align:left;font-size:12px;font-weight:800;color:${netColor}">${netLabel}</div>
          </div>
          <div class="report-body">
            <div class="report-row-detail"><span>💵 كاش</span><span style="color:var(--orange)">ج${d.cashOwed}</span></div>
            <div class="report-row-detail"><span>💳 فيزا</span><span style="color:var(--green)">ج${d.visaDelivery}</span></div>
            <div class="report-row-detail" style="border-top:1px solid var(--border);margin-top:4px;padding-top:6px">
              <span>🛵 توصيل</span><span style="color:var(--green);font-weight:900">ج${d.delivery}</span>
            </div>
          </div>
        </div>`;
      }).join('')||'<div class="empty-state"><div class="empty-text">لا بيانات</div></div>'
    }
    <div style="margin-top:16px">
      <button onclick="exportDailyReport()" style="width:100%;padding:12px;border-radius:12px;background:var(--orange-bg);border:1px solid var(--orange);color:var(--orange);font-family:'Cairo',sans-serif;font-weight:800;font-size:13px;cursor:pointer;touch-action:manipulation">📊 تصدير تقرير اليوم</button>
      <button onclick="showOrdersArchive()" style="width:100%;padding:12px;border-radius:12px;margin-top:8px;background:var(--card);border:1px solid var(--border);color:var(--text2);font-family:'Cairo',sans-serif;font-weight:800;font-size:13px;cursor:pointer;touch-action:manipulation">📂 أرشيف الأوردرات</button>
    </div>`;
}

function exportDailyReport() {
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const today=allOrders.filter(o=>{if(!o.timestamp)return false;const t=o.timestamp.toDate?o.timestamp.toDate():new Date(o.timestamp);return t>=todayStart;});
  if (!today.length) { showToast('لا أوردرات اليوم'); return; }
  const dateStr=new Date().toLocaleDateString('ar-EG');
  const totalDelivery=today.reduce((s,o)=>s+(o.delivery||0),0);
  const totalCash=today.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
  const byDriver={};
  today.forEach(o=>{
    if (!byDriver[o.driverId]) byDriver[o.driverId]={name:o.driverName||'؟',orders:0,delivery:0,cash:0};
    byDriver[o.driverId].orders++; byDriver[o.driverId].delivery+=o.delivery||0;
    if (o.payment==='cash') byDriver[o.driverId].cash+=o.total||0;
  });
  let report=`📊 تقرير Nabil Pro\n📅 ${dateStr}\n${'─'.repeat(25)}\n`;
  report+=`📦 ${today.length} أوردر\n🛵 توصيل: ج${totalDelivery}\n💵 كاش: ج${totalCash}\n${'─'.repeat(25)}\n`;
  Object.values(byDriver).sort((a,b)=>b.delivery-a.delivery).forEach(d=>{report+=`• ${d.name}: ${d.orders} أوردر | ج${d.delivery} توصيل | ج${d.cash} كاش\n`;});
  if (navigator.clipboard) {
    navigator.clipboard.writeText(report).then(()=>showToast('✅ التقرير اتنسخ')).catch(()=>showExportModal(report));
  } else showExportModal(report);
}

function showExportModal(text) {
  showModal('📊 تقرير اليوم',
    `<textarea style="width:100%;height:200px;background:var(--bg2);color:var(--text1);border:1px solid var(--border);border-radius:8px;padding:10px;font-family:monospace;font-size:11px;resize:none" readonly>${text}</textarea>`,
    [{label:'📋 نسخ',cls:'confirm',action:()=>{const ta=document.querySelector('#modalBody textarea');ta.select();document.execCommand('copy');showToast('✅ تم النسخ');}},
     {label:'إغلاق',cls:'cancel',action:closeModal}]);
}

async function showDriverMonthlyStats(driverUid) {
  if (!driverUid) driverUid=selectedDriverUid;
  const driver=allDrivers.find(d=>d.uid===driverUid); if(!driver)return;
  showToast('⏳ جاري التحميل...');
  const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  try {
    const snap=await db.collection('orders')
      .where('driverId','==',driverUid)
      .where('timestamp','>=',firebase.firestore.Timestamp.fromDate(monthStart))
      .orderBy('timestamp','desc').limit(500).get();
    const orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    const totalOrders=orders.length;
    const totalDelivery=orders.reduce((s,o)=>s+(o.delivery||0),0);
    const totalCash=orders.filter(o=>o.payment==='cash').reduce((s,o)=>s+(o.total||0),0);
    const cashOrders=orders.filter(o=>o.payment==='cash').length;
    const visaOrders=orders.filter(o=>o.payment==='visa').length;
    const byRest={};
    orders.forEach(o=>{byRest[o.restName||'؟']=(byRest[o.restName||'؟']||0)+1;});
    const topRest=Object.entries(byRest).sort((a,b)=>b[1]-a[1])[0];
    const monthName=new Date().toLocaleDateString('ar-EG',{month:'long',year:'numeric'});
    showModal(`📅 ${sanitize(driver.name)} — ${monthName}`,`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:var(--orange)">${totalOrders}</div><div style="font-size:11px;color:var(--text3)">📦 أوردر</div></div>
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:var(--green)">ج${totalDelivery}</div><div style="font-size:11px;color:var(--text3)">🛵 توصيل</div></div>
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--gold)">ج${totalCash}</div><div style="font-size:11px;color:var(--text3)">💵 كاش</div></div>
        <div style="background:var(--bg2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--blue)">${cashOrders}/${visaOrders}</div><div style="font-size:11px;color:var(--text3)">كاش/فيزا</div></div>
      </div>
      ${topRest?`<div style="background:var(--orange-bg);border-radius:12px;padding:12px;text-align:center"><div style="font-size:11px;color:var(--text3)">🏆 أكثر مطعم</div><div style="font-weight:900;color:var(--orange)">${sanitize(topRest[0])} — ${topRest[1]} أوردر</div></div>`:''}`,
      [{label:'إغلاق',cls:'cancel',action:closeModal}]);
  } catch(e){showToast('❌ خطأ في التحميل');}
}

function showOrdersArchive() {
  showModal('📂 أرشيف الأوردرات',`
    <div style="margin-bottom:12px"><div class="field-label">اختر الفترة</div>
      <div style="display:flex;gap:8px">
        <button onclick="loadArchive('yesterday')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">أمس</button>
        <button onclick="loadArchive('week')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">آخر 7 أيام</button>
        <button onclick="loadArchive('month')" class="modal-btn cancel" style="flex:1;font-size:12px;touch-action:manipulation">الشهر</button>
      </div>
    </div>
    <div id="archiveResults" style="max-height:300px;overflow-y:auto"><div class="empty-state"><div class="empty-text">اختر فترة</div></div></div>`,
    [{label:'إغلاق',cls:'cancel',action:closeModal}]);
}

async function loadArchive(period) {
  const el=document.getElementById('archiveResults'); if(!el)return;
  el.innerHTML='<div class="empty-state"><div class="empty-text">⏳ جاري التحميل...</div></div>';
  const now=new Date(); let startDate,endDate;
  if (period==='yesterday'){startDate=new Date(now);startDate.setDate(now.getDate()-1);startDate.setHours(0,0,0,0);endDate=new Date(now);endDate.setHours(0,0,0,0);}
  else if (period==='week'){startDate=new Date(now);startDate.setDate(now.getDate()-7);startDate.setHours(0,0,0,0);endDate=now;}
  else {startDate=new Date(now.getFullYear(),now.getMonth(),1);endDate=now;}
  try {
    const snap=await db.collection('orders')
      .where('timestamp','>=',firebase.firestore.Timestamp.fromDate(startDate))
      .where('timestamp','<=',firebase.firestore.Timestamp.fromDate(endDate))
      .orderBy('timestamp','desc').limit(50).get();
    const orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    if (!orders.length){el.innerHTML='<div class="empty-state"><div class="empty-text">لا أوردرات</div></div>';return;}
    const total=orders.reduce((s,o)=>s+(o.delivery||0),0);
    el.innerHTML=`<div style="text-align:center;padding:8px;background:var(--bg2);border-radius:8px;margin-bottom:10px"><strong>${orders.length} أوردر</strong> — ج${total}</div>`+
      orders.map(o=>{const t=o.timestamp?.toDate?.()??new Date();const timeStr=t.toLocaleDateString('ar-EG',{day:'2-digit',month:'2-digit'})+' '+t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
        return `<div class="feed-card ${o.payment==='visa'?'visa':'cash'}" style="margin-bottom:6px"><div class="feed-pay">${o.payment==='visa'?'💳':'💵'}</div><div class="feed-body"><div class="feed-rest-name">${sanitize(o.restName||'—')}</div><div class="feed-driver-info">👤 ${sanitize(o.driverName||'—')} • 📍 ${sanitize(o.address||'—')}</div><div class="feed-time-txt">⏰ ${timeStr}</div></div><div class="feed-amt">ج${o.delivery||0}</div></div>`;
      }).join('');
  } catch(e){el.innerHTML=`<div class="empty-state"><div class="empty-text">❌ ${e.message}</div></div>`;}
}

function showModal(title,bodyHTML,buttons) {
  document.getElementById('modalTitle').textContent=title;
  document.getElementById('modalBody').innerHTML=bodyHTML;
  document.getElementById('modalActions').innerHTML=buttons.map((b,i)=>
    `<button class="modal-btn ${b.cls}" id="mBtn${i}" style="touch-action:manipulation">${b.label}</button>`
  ).join('');
  buttons.forEach((b,i) => {
    const btn = document.getElementById('mBtn'+i);
    // FIX: استخدم addEventListener بدل onclick لمنع التكرار
    btn.addEventListener('click', function handler(e) {
      btn.removeEventListener('click', handler);
      btn.disabled = true;
      b.action();
    }, { once: true });
  });
  document.getElementById('modalOverlay').classList.add('show');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('show');}
document.getElementById('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal();});

let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}

function showStatDetail(type) {
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const today=allOrders.filter(o=>{const t=o.timestamp?.toDate?.()??new Date(o.timestamp);return t>=todayStart;});
  if (type==='drivers'){
    const byDriver={};
    today.forEach(o=>{if(!byDriver[o.driverId])byDriver[o.driverId]={name:o.driverName||'؟',orders:0,delivery:0};byDriver[o.driverId].orders++;byDriver[o.driverId].delivery+=o.delivery||0;});
    const rows=Object.values(byDriver).sort((a,b)=>b.delivery-a.delivery).map(d=>`<div class="report-row-detail" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:700">${sanitize(d.name)}</span><span style="color:var(--green);font-weight:800">ج${d.delivery} • ${d.orders} أوردر</span></div>`).join('');
    showModal('👥 المناديب النشطين',rows||'<div class="empty-state"><div class="empty-text">لا مناديب</div></div>',[{label:'إغلاق',cls:'cancel',action:closeModal}]);
  } else if (type==='orders'){
    const rows=today.slice(0,20).map(o=>{const t=o.timestamp?.toDate?.()??new Date();const time=t.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});return `<div class="report-row-detail" style="padding:8px 0;border-bottom:1px solid var(--border)"><span><div style="font-weight:700">${sanitize(o.restName||'؟')}</div><div style="font-size:11px;color:var(--text3)">${sanitize(o.driverName||'؟')} • ${time}</div></span><span style="color:var(--orange);font-weight:800">ج${o.delivery||0}</span></div>`;}).join('');
    showModal('📦 أوردرات اليوم',rows||'<div class="empty-state"><div class="empty-text">لا أوردرات</div></div>',[{label:'إغلاق',cls:'cancel',action:closeModal}]);
  } else if (type==='delivery'){
    const byDriver={};
    today.forEach(o=>{if(!byDriver[o.driverId])byDriver[o.driverId]={name:o.driverName||'؟',delivery:0};byDriver[o.driverId].delivery+=o.delivery||0;});
    const total=today.reduce((s,o)=>s+(o.delivery||0),0);
    const rows=Object.values(byDriver).sort((a,b)=>b.delivery-a.delivery).map(d=>`<div class="report-row-detail" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:700">${sanitize(d.name)}</span><span style="color:var(--blue);font-weight:800">ج${d.delivery}</span></div>`).join('');
    showModal('🛵 دخل التوصيل',`<div style="text-align:center;padding:12px 0 16px;border-bottom:1px solid var(--border);margin-bottom:12px"><div style="font-size:32px;font-weight:900;color:var(--blue)">ج${total}</div></div>${rows}`,[{label:'إغلاق',cls:'cancel',action:closeModal}]);
  } else if (type==='cash'){
    const cashOrders=today.filter(o=>o.payment==='cash');
    const total=cashOrders.reduce((s,o)=>s+(o.total||0),0);
    const byDriver={};
    cashOrders.forEach(o=>{if(!byDriver[o.driverId])byDriver[o.driverId]={name:o.driverName||'؟',cash:0,count:0};byDriver[o.driverId].cash+=o.total||0;byDriver[o.driverId].count++;});
    const rows=Object.values(byDriver).sort((a,b)=>b.cash-a.cash).map(d=>`<div class="report-row-detail" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:700">${sanitize(d.name)}</span><span style="color:var(--gold);font-weight:800">ج${d.cash}</span></div>`).join('');
    showModal('💵 الكاش المحصّل',`<div style="text-align:center;padding:12px 0 16px;border-bottom:1px solid var(--border);margin-bottom:12px"><div style="font-size:32px;font-weight:900;color:var(--gold)">ج${total}</div></div>${rows}`,[{label:'إغلاق',cls:'cancel',action:closeModal}]);
  }
}

function showDriverStatDetail(type) {
  const today=getTodayOrders();
  const delivery=today.reduce((s,o)=>s+(o.delivery||0),0);
  const byRest={};
  today.forEach(o=>{if(!byRest[o.restName])byRest[o.restName]={orders:0,delivery:0};byRest[o.restName].orders++;byRest[o.restName].delivery+=o.delivery||0;});
  const rows=Object.entries(byRest).sort((a,b)=>b[1].delivery-a[1].delivery).map(([name,d])=>`<div class="report-row-detail" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:700">${sanitize(name)}</span><span style="color:var(--orange);font-weight:800">ج${d.delivery}</span></div>`).join('');
  showModal('💰 دخل التوصيل',`<div style="text-align:center;padding:12px 0 16px;border-bottom:1px solid var(--border);margin-bottom:12px"><div style="font-size:36px;font-weight:900;color:var(--orange)">ج${delivery}</div></div>${rows}`,[{label:'إغلاق',cls:'cancel',action:closeModal}]);
}

let ptrStartY=0,ptrActive=false;
const PTR_THRESHOLD=70;
document.addEventListener('touchstart',e=>{const el=e.target.closest('.page,.mgr-content');if(!el)return;if(el.scrollTop===0){ptrStartY=e.touches[0].clientY;ptrActive=true;}},{passive:true});
document.addEventListener('touchmove',e=>{if(!ptrActive)return;const dy=e.touches[0].clientY-ptrStartY;if(dy>20){const ind=document.getElementById('ptrIndicator');if(ind){ind.style.opacity=Math.min(1,dy/PTR_THRESHOLD);ind.style.transform=`translateY(${Math.min(dy*0.4,28)}px)`;}}},{passive:true});
document.addEventListener('touchend',e=>{if(!ptrActive)return;const dy=e.changedTouches[0].clientY-ptrStartY;ptrActive=false;const ind=document.getElementById('ptrIndicator');if(ind){ind.style.opacity=0;ind.style.transform='';}if(dy>PTR_THRESHOLD){showToast('🔄 جاري التحديث...');setTimeout(()=>location.reload(),400);}},{passive:true});

(function(){
  const h=new Date().getHours();
  const isDark=h<6||h>=18;
  if(!isDark)document.body.dataset.theme='light';
  themeMode=isDark?'dark':'light';
})();

window.addEventListener('load',initApp);
