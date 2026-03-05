import firebase_admin
from firebase_admin import credentials, firestore, messaging
import os, json, time, threading
from datetime import datetime, timezone
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
    print(f'🌐 HTTP Server على port {port}')
    server.serve_forever()

http_thread = threading.Thread(target=run_http_server, daemon=True)
http_thread.start()

# ══════════════════════════════════
# FCM - المديرين فقط
# ══════════════════════════════════
def get_manager_tokens():
    tokens = []
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
                continue
            if not role:
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

        tokens = [t for t, _ in uid_tokens.values()]
        print(f'✅ مديرين: {len(tokens)} توكن')
    except Exception as e:
        print(f'خطأ: {e}')
    return tokens


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
    except Exception as e:
        print(f'خطأ FCM: {e}')


# ══════════════════════════════════
# FIRESTORE LISTENER
# ══════════════════════════════════
startup_done = False  # اول batch = اوردرات قديمة نتجاهلها

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
            driver = o.get('driverName', '?')
            rest = o.get('restName', '?')
            address = o.get('address', '')
            delivery = o.get('delivery', 0)
            print(f'اوردر جديد: {order_id} | {driver} | {rest}')
            send_fcm(
                'اوردر جديد',
                f'{driver} - {rest}\n{address}\n{delivery} توصيل'
            )


col_watch = db.collection('orders').on_snapshot(on_snapshot)
print('بيسمع على Firestore...')

while True:
    time.sleep(60)
