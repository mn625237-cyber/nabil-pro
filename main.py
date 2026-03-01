import os
import json
import time
import firebase_admin
from firebase_admin import credentials, firestore, messaging

# ── Firebase init ──────────────────────────────────────────────
cred_json = os.environ.get("FIREBASE_CREDENTIALS")
cred_dict = json.loads(cred_json)
cred = credentials.Certificate(cred_dict)
firebase_admin.initialize_app(cred)

db = firestore.client()
print("🚀 Nabil Pro FCM Listener شغال...")

# ── جيب كل FCM tokens من Firestore ───────────────────────────
def get_all_tokens():
    tokens = []
    try:
        docs = db.collection("fcm_tokens").stream()
        for doc in docs:
            data = doc.to_dict()
            token = data.get("token")
            if token:
                tokens.append(token)
    except Exception as e:
        print(f"❌ خطأ في جلب الـ tokens: {e}")
    return tokens

# ── بعت FCM لكل الـ tokens ────────────────────────────────────
def send_fcm(title, body):
    tokens = get_all_tokens()
    if not tokens:
        print("⚠️ مفيش FCM tokens محفوظة!")
        return

    message = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        tokens=tokens,
    )
    try:
        response = messaging.send_each_for_multicast(message)
        print(f"✅ إشعار اتبعت لـ {response.success_count} جهاز")
        if response.failure_count > 0:
            print(f"⚠️ فشل في {response.failure_count} جهاز")
    except Exception as e:
        print(f"❌ خطأ في FCM: {e}")

# ── Firestore Listener على orders ─────────────────────────────
def on_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name == "ADDED":
            order    = change.document.to_dict()
            order_id = change.document.id

            customer = order.get("customerName", "عميل")
            address  = order.get("address", "")
            total    = order.get("total", "")

            title = "🛵 أوردر جديد!"
            body  = f"{customer} — {address} — {total} جنيه"

            print(f"📦 أوردر جديد: {order_id}")
            send_fcm(title, body)

# ── ابدأ الاستماع ──────────────────────────────────────────────
col_ref   = db.collection("orders")
col_watch = col_ref.on_snapshot(on_snapshot)

# إبقى شغال
while True:
    time.sleep(60)
