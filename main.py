import firebase_admin
from firebase_admin import credentials, firestore, messaging
import os, json, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

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
# HTTP KEEPALIVE SERVER
# ══════════════════════════════════
class KeepAlive(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'Nabil Pro FCM - Alive!')
    def log_message(self, format, *args):
        pass

def run_http_server():
    port = int(os.environ.get('PORT', 8080))
    server = HTTPServer(('0.0.0.0', port), KeepAlive)
    print(f'🌐 HTTP Server شغال على port {port}')
    server.serve_forever()

http_thread = threading.Thread(target=run_http_server, daemon=True)
http_thread.start()

# ══════════════════════════════════
# FCM FUNCTIONS
# ══════════════════════════════════
def get_manager_tokens():
    tokens = []
    try:
        docs = db.collection('fcm_tokens').stream()
        for doc in docs:
            data = doc.to_dict()
            uid = data.get('uid')
            if not uid:
                continue
            user_doc = db.collection('users').document(uid).get()
            if user_doc.exists:
                if user_doc.to_dict().get('role') == 'manager':
                    token = data.get('token')
                    if token:
                        tokens.append(token)
    except Exception as e:
        print(f'خطأ: {e}')
    return tokens

def send_fcm(title, body):
    tokens = get_manager_tokens()
    if not tokens:
        print('مفيش توكنات مديرين')
        return
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        tokens=tokens,
        android=messaging.AndroidConfig(priority='high'),
        apns=messaging.APNSConfig(headers={'apns-priority': '10'})
    )
    try:
        r = messaging.send_each_for_multicast(msg)
        print(f'إشعار اتبعت لـ {r.success_count} جهاز')
    except Exception as e:
        print(f'خطأ FCM: {e}')

# ══════════════════════════════════
# FIRESTORE LISTENER
# ══════════════════════════════════
def on_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name == 'ADDED':
            o = change.document.to_dict()
            print(f'📦 أوردر جديد: {change.document.id}')
            send_fcm(
                'أوردر جديد 🛵',
                f"{o.get('driverName','؟')} — {o.get('restName','؟')}\n📍 {o.get('address','')}\nج {o.get('delivery',0)} توصيل"
            )

col_watch = db.collection('orders').on_snapshot(on_snapshot)
print('بيسمع على Firestore...')

while True:
    time.sleep(60)
