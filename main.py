import firebase_admin
from firebase_admin import credentials, firestore, messaging, auth
import os, json, time, threading
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import re

# ══════════════════════════════════
# FIREBASE INIT
# ══════════════════════════════════
cred_json = os.environ.get('FIREBASE_CREDENTIALS')
cred_dict = json.loads(cred_json)
cred = credentials.Certificate(cred_dict)
firebase_admin.initialize_app(cred)
db = firestore.client()

print('🚀 Nabil Pro FCM Listener شغال...')

# ══════════════════════════════════
# TOKEN CACHE — بدل ما يجيب من Firestore كل مرة
# ══════════════════════════════════
_tokens_cache = []
_tokens_last_updated = None
_tokens_lock = threading.Lock()

def get_manager_tokens():
    global _tokens_cache, _tokens_last_updated
    now = datetime.now()
    with _tokens_lock:
        # لو الكاش أقل من 5 دقائق — استخدمه مباشرة (بدون Firestore read)
        if _tokens_last_updated and (now - _tokens_last_updated).seconds < 300:
            return list(_tokens_cache)
        # لو أكبر أو أول مرة — حدّث من Firestore
        try:
            docs = db.collection('fcm_tokens').stream()
            token_list = []
            for doc in docs:
                data = doc.to_dict()
                uid = data.get('uid')
                token = data.get('token')
                role = data.get('role', '')
                updated = data.get('updatedAt')
                if not uid or not token:
                    continue
                if role == 'manager':
                    token_list.append((uid, token, updated))
                elif not role:
                    user_doc = db.collection('users').document(uid).get()
                    if user_doc.exists and user_doc.to_dict().get('role') == 'manager':
                        token_list.append((uid, token, updated))

            uid_tokens = {}
            for uid, token, updated in token_list:
                if uid not in uid_tokens:
                    uid_tokens[uid] = (token, updated)
                else:
                    prev = uid_tokens[uid][1]
                    if updated and prev and updated > prev:
                        uid_tokens[uid] = (token, updated)

            _tokens_cache = [t for t, _ in uid_tokens.values()]
            _tokens_last_updated = now
            print(f'✅ Token cache محدث: {len(_tokens_cache)} مدير')
        except Exception as e:
            print(f'خطأ في تحديث الكاش: {e}')
        return list(_tokens_cache)

def invalidate_token_cache():
    """امسح الكاش فوراً عند أي تغيير في التوكنز"""
    global _tokens_last_updated
    with _tokens_lock:
        _tokens_last_updated = None

# ══════════════════════════════════
# HTTP SERVER — KeepAlive + PIN API
# ══════════════════════════════════
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/ping' or parsed.path == '/':
            # KeepAlive endpoint — cron-job.org بيضربه كل 10 دقائق
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Nabil Pro - Alive! ' + str(datetime.now()).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/update-pin':
            # PIN Update API — المدير يغير كود المندوب
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length))
                uid = body.get('uid', '').strip()
                new_pin = str(body.get('pin', '')).strip()
                
                # تحقق من صحة البيانات
                if not uid or not re.match(r'^\d{6}$', new_pin):
                    self._json(400, {'error': 'uid وpin مطلوبان (6 أرقام)'})
                    return
                
                # تحديث Firebase Auth مباشرة بـ Admin SDK
                auth.update_user(uid, password=new_pin)
                
                # تحديث Firestore
                db.collection('users').document(uid).update({
                    'pin': new_pin,
                    'pinUpdatedAt': firestore.SERVER_TIMESTAMP
                })
                
                print(f'✅ PIN محدث للمستخدم: {uid}')
                self._json(200, {'success': True})
                
            except auth.UserNotFoundError:
                self._json(404, {'error': 'المستخدم مش موجود'})
            except Exception as e:
                print(f'خطأ في تحديث PIN: {e}')
                self._json(500, {'error': str(e)})
        
        elif parsed.path == '/invalidate-tokens':
            # endpoint لإخبار السيرفر إن التوكنز اتغيرت
            invalidate_token_cache()
            self._json(200, {'success': True, 'message': 'Cache cleared'})
        
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, code, data):
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass  # بلاش logs مزعجة

def run_http_server():
    port = int(os.environ.get('PORT', 8080))
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f'🌐 HTTP Server على port {port}')
    server.serve_forever()

http_thread = threading.Thread(target=run_http_server, daemon=True)
http_thread.start()

# ══════════════════════════════════
# FCM
# ══════════════════════════════════
def send_fcm(title, body):
    tokens = get_manager_tokens()
    if not tokens:
        print('مفيش مديرين مسجلين')
        return
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        tokens=tokens,
        android=messaging.AndroidConfig(priority='high'),
        apns=messaging.APNSConfig(headers={'apns-priority': '10'})
    )
    try:
        r = messaging.send_each_for_multicast(msg)
        print(f'اشعار اتبعت لـ {r.success_count} مدير')
        if r.failure_count > 0:
            for i, resp in enumerate(r.responses):
                if not resp.success:
                    try:
                        bad_docs = db.collection('fcm_tokens').where('token','==',tokens[i]).stream()
                        for d in bad_docs: d.reference.delete()
                    except: pass
            invalidate_token_cache()  # امسح الكاش لو في توكنز باظت
    except Exception as e:
        print(f'خطأ FCM: {e}')

# ══════════════════════════════════
# FIRESTORE LISTENER
# ══════════════════════════════════
startup_done = False

def on_snapshot(col_snapshot, changes, read_time):
    global startup_done
    if not startup_done:
        startup_done = True
        print(f'تجاهل {len(col_snapshot)} اوردر قديم عند البداية')
        return

    for change in changes:
        if change.type.name == 'ADDED':
            o = change.document.to_dict()
            order_id = change.document.id
            driver = o.get('driverName', '؟')
            rest = o.get('restName', '؟')
            address = o.get('address', '')
            delivery = o.get('delivery', 0)
            print(f'اوردر جديد: {order_id} | {driver} | {rest}')
            send_fcm(
                '🛵 اوردر جديد',
                f'{driver} - {rest}\n{address}\nتوصيل: {delivery} ج'
            )

col_watch = db.collection('orders').on_snapshot(on_snapshot)
print('👂 بيسمع على Firestore...')

while True:
    time.sleep(60)
