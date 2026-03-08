import firebase_admin
from firebase_admin import credentials, firestore, messaging, auth
import os, json, time, threading, re
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS

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
# FLASK APP
# ══════════════════════════════════
app = Flask(__name__)
CORS(app)

# ══════════════════════════════════
# TOKEN CACHE
# ══════════════════════════════════
_tokens_cache = []
_tokens_last_updated = None
_tokens_lock = threading.Lock()

def get_manager_tokens():
    global _tokens_cache, _tokens_last_updated
    now = datetime.now()
    with _tokens_lock:
        if _tokens_last_updated and (now - _tokens_last_updated).seconds < 300:
            return list(_tokens_cache)
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
    global _tokens_last_updated
    with _tokens_lock:
        _tokens_last_updated = None

# ══════════════════════════════════
# FCM
# ══════════════════════════════════
def send_fcm(title, body, data=None):
    tokens = get_manager_tokens()
    if not tokens:
        print('مفيش مديرين مسجلين')
        return
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
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
            invalidate_token_cache()
    except Exception as e:
        print(f'خطأ FCM: {e}')

def send_fcm_to_user(uid, title, body):
    """إرسال إشعار لمستخدم معين (مندوب)"""
    try:
        token_doc = db.collection('fcm_tokens').document(uid).get()
        if not token_doc.exists:
            return
        token = token_doc.to_dict().get('token')
        if not token:
            return
        msg = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            token=token,
            android=messaging.AndroidConfig(priority='high'),
        )
        messaging.send(msg)
        print(f'✅ إشعار لـ {uid}')
    except Exception as e:
        print(f'خطأ إشعار مندوب: {e}')

# ══════════════════════════════════
# ROUTES
# ══════════════════════════════════

@app.route('/ping', methods=['GET'])
@app.route('/', methods=['GET'])
def ping():
    return f'Nabil Pro - Alive! {datetime.now()}', 200

@app.route('/update-pin', methods=['POST'])
def update_pin():
    try:
        body = request.get_json()
        uid = body.get('uid', '').strip()
        new_pin = str(body.get('pin', '')).strip()

        if not uid or not re.match(r'^\d{6}$', new_pin):
            return jsonify({'error': 'uid وpin مطلوبان (6 أرقام)'}), 400

        auth.update_user(uid, password=new_pin)
        db.collection('users').document(uid).update({
            'pin': new_pin,
            'pinUpdatedAt': firestore.SERVER_TIMESTAMP
        })

        # إشعار للمندوب إن الـ PIN اتغير
        driver_doc = db.collection('users').document(uid).get()
        if driver_doc.exists:
            driver_name = driver_doc.to_dict().get('name', 'المندوب')
            send_fcm_to_user(uid, '🔑 تم تغيير كودك', 'تم تغيير كود الدخول بتاعك من قِبل المدير')

        print(f'✅ PIN محدث للمستخدم: {uid}')
        return jsonify({'success': True})

    except auth.UserNotFoundError:
        return jsonify({'error': 'المستخدم مش موجود'}), 404
    except Exception as e:
        print(f'خطأ في تحديث PIN: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/invalidate-tokens', methods=['POST'])
def invalidate_tokens():
    invalidate_token_cache()
    return jsonify({'success': True, 'message': 'Cache cleared'})

@app.route('/notify-driver', methods=['POST'])
def notify_driver():
    """إرسال إشعار لمندوب معين"""
    try:
        body = request.get_json()
        uid = body.get('uid', '').strip()
        title = body.get('title', '')
        message = body.get('body', '')
        if not uid or not title:
            return jsonify({'error': 'uid و title مطلوبان'}), 400
        send_fcm_to_user(uid, title, message)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    """صفحة حالة السيرفر"""
    tokens = get_manager_tokens()
    return jsonify({
        'status': 'running',
        'time': str(datetime.now()),
        'managers_with_tokens': len(tokens),
        'listener_active': startup_done
    })

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

# ══════════════════════════════════
# START SERVER
# ══════════════════════════════════
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f'🌐 Flask Server على port {port}')
    app.run(host='0.0.0.0', port=port, threaded=True)
