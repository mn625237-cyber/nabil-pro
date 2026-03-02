import firebase_admin
from firebase_admin import credentials, firestore, messaging
import os, json, time

cred_json = os.environ.get('FIREBASE_CREDENTIALS')
cred_dict = json.loads(cred_json)
cred = credentials.Certificate(cred_dict)
firebase_admin.initialize_app(cred)
db = firestore.client()

print('🚀 Nabil Pro FCM Listener شغال...')

def get_manager_tokens():
    tokens = []
    docs = db.collection('fcm_tokens').stream()
    for doc in docs:
        data = doc.to_dict()
        uid = data.get('uid')
        user_doc = db.collection('users').document(uid).get()
        if user_doc.exists:
            if user_doc.to_dict().get('role') == 'manager':
                token = data.get('token')
                if token:
                    tokens.append(token)
    return tokens

def send_fcm(title, body):
    tokens = get_manager_tokens()
    if not tokens:
        print('⚠️ مفيش توكنات مديرين')
        return
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        tokens=tokens
    )
    r = messaging.send_each_for_multicast(msg)
    print(f'✅ إشعار اتبعت لـ {r.success_count} جهاز')

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

while True:
    time.sleep(60)