import json, os
from http.server import BaseHTTPRequestHandler
import firebase_admin
from firebase_admin import credentials, firestore, messaging, auth

ALLOWED_ORIGIN = 'https://nabil-pro.vercel.app'

def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(json.loads(os.environ['FIREBASE_CREDENTIALS']))
        firebase_admin.initialize_app(cred)

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors(200); self.end_headers()

    def do_POST(self):
        init_firebase()
        db = firestore.client()

        # يسمح للمندوب والمدير — المندوب يحتاج يُشعر المدير عند إضافة أوردر
        ah = self.headers.get('Authorization', '')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            decoded    = auth.verify_id_token(ah.split('Bearer ')[1])
            uid_caller = decoded['uid']
        except Exception:
            self._respond(403, {'error': 'غير مصرح — تحقق من تسجيل الدخول'}); return

        body     = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        order_id = str(body.get('orderId', ''))[:200].strip()

        if not order_id:
            self._respond(400, {'error': 'orderId مطلوب'}); return

        # ✅ مصدر الحقيقة الوحيد لمحتوى الإشعار هو المستند الفعلي في Firestore — لا نثق بأي حقل من الجهاز
        order_doc = db.collection('orders').document(order_id).get()
        if not order_doc.exists:
            self._respond(404, {'error': 'الأوردر غير موجود'}); return

        od = order_doc.to_dict()

        caller_doc = db.collection('users').document(uid_caller).get()
        is_manager = caller_doc.exists and caller_doc.to_dict().get('role') == 'manager'

        # المتصل لازم يكون صاحب الأوردر الفعلي، أو مديراً
        if od.get('driverId') != uid_caller and not is_manager:
            self._respond(403, {'error': 'غير مصرح بهذا الأوردر'}); return

        rest_name   = str(od.get('restName',   ''))[:150]
        address     = str(od.get('address',    ''))[:300]
        driver_name = str(od.get('driverName', ''))[:100]
        payment     = od.get('payment', 'cash')
        if payment not in ('cash', 'visa'):
            payment = 'cash'
        try:
            total    = float(od.get('total', 0))
            delivery = float(od.get('delivery', 0))
        except (TypeError, ValueError):
            total, delivery = 0, 0

        pay_icon  = '💳' if payment == 'visa' else '💵'
        title     = f'{pay_icon} {rest_name}' if rest_name else 'أوردر جديد 🛵'
        body_text = f'📍 {address}\n💰 {total} ج | 🛵 {delivery} ج | 👤 {driver_name}'

        try:
            # ✅ استعلام مباشر بـ role بدل قراءة الكوليكشن كله + قراءات إضافية لكل توكن
            tokens_stream = (db.collection('fcm_tokens')
                              .where('role', '==', 'manager')
                              .limit(200)
                              .stream())
            tokens = [(d.id, d.to_dict().get('token'))
                      for d in tokens_stream if d.to_dict().get('token')]

            if not tokens:
                self._respond(200, {'success': True, 'sent': 0, 'note': 'no managers'}); return

            token_list = [t for _, t in tokens]
            msg = messaging.MulticastMessage(
                notification=messaging.Notification(title=title, body=body_text),
                tokens=token_list,
                android=messaging.AndroidConfig(
                    priority='high',
                    notification=messaging.AndroidNotification(
                        title=title, body=body_text,
                        icon='https://nabil-pro.vercel.app/icon-192.png',
                        sound='default', priority='high', channel_id='nabil_orders'
                    )
                ),
                webpush=messaging.WebpushConfig(
                    headers={'Urgency': 'high'},
                    notification=messaging.WebpushNotification(
                        title=title, body=body_text,
                        icon='https://nabil-pro.vercel.app/icon-192.png',
                        badge='https://nabil-pro.vercel.app/icon-192.png',
                        require_interaction=True, tag='nabil-order', renotify=True,
                    ),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                ),
                apns=messaging.APNSConfig(headers={'apns-priority': '10'})
            )

            r = messaging.send_each_for_multicast(msg)

            if r.failure_count > 0:
                for i, resp in enumerate(r.responses):
                    if not resp.success and 'UNREGISTERED' in str(resp.exception).upper():
                        try:
                            db.collection('fcm_tokens').document(tokens[i][0]).delete()
                        except Exception:
                            pass

            self._respond(200, {'success': True, 'sent': r.success_count, 'failed': r.failure_count})

        except Exception as e:
            print('notify-managers error:', e)
            self._respond(500, {'error': 'حدث خطأ أثناء إرسال الإشعار'})

    def _cors(self, code=200):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin',  ALLOWED_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Vary', 'Origin')

    def _respond(self, status, data):
        self._cors(status)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
