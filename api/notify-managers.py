import json, os
from http.server import BaseHTTPRequestHandler
import firebase_admin
from firebase_admin import credentials, firestore, messaging, auth

def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(json.loads(os.environ.get('FIREBASE_CREDENTIALS')))
        firebase_admin.initialize_app(cred)

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors(); self.end_headers()

    def do_POST(self):
        init_firebase()
        db = firestore.client()

        # التحقق من الـ token
        # Layer 1: API Secret (Denial-of-Wallet protection)
        api_secret = os.environ.get('API_SECRET', '')
        if api_secret:
            req_secret = self.headers.get('x-api-key', '')
            if req_secret != api_secret:
                self._respond(403, {'error': 'غير مصرح'}); return

        # Layer 2: Firebase ID Token
        ah = self.headers.get('Authorization','')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            auth.verify_id_token(ah.split('Bearer ')[1])
        except:
            self._respond(403, {'error': 'غير مصرح'}); return

        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))

        rest_name   = body.get('restName', '')
        address     = body.get('address', '')
        total       = body.get('total', 0)
        delivery    = body.get('delivery', 0)
        payment     = body.get('payment', 'cash')
        driver_name = body.get('driverName', '')

        pay_icon = '💳' if payment == 'visa' else '💵'
        title = f'{pay_icon} {rest_name}'
        body_text = f'📍 {address}\n💰 {total} ج | 🛵 {delivery} ج | 👤 {driver_name}'

        try:
            # اجمع كل tokens المديرين
            docs = db.collection('fcm_tokens').stream()
            tokens = []
            for doc in docs:
                data = doc.to_dict()
                token = data.get('token')
                uid   = data.get('uid')
                role  = data.get('role', '')
                if not token or not uid: continue
                if role == 'manager':
                    tokens.append((uid, token))
                elif not role:
                    u = db.collection('users').document(uid).get()
                    if u.exists and u.to_dict().get('role') == 'manager':
                        tokens.append((uid, token))

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
                        sound='default', priority='high',
                        channel_id='nabil_orders'
                    )
                ),
                webpush=messaging.WebpushConfig(
                    headers={'Urgency': 'high'},
                    notification=messaging.WebpushNotification(
                        title=title, body=body_text,
                        icon='https://nabil-pro.vercel.app/icon-192.png',
                        badge='https://nabil-pro.vercel.app/icon-192.png',
                        require_interaction=True,
                        tag='nabil-order',
                        renotify=True,
                    ),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                ),
                apns=messaging.APNSConfig(headers={'apns-priority': '10'})
            )

            r = messaging.send_each_for_multicast(msg)

            # احذف الـ tokens الفاسدة تلقائياً
            if r.failure_count > 0:
                for i, resp in enumerate(r.responses):
                    if not resp.success:
                        err = str(resp.exception)
                        if 'UNREGISTERED' in err.upper() or 'unregistered' in err.lower():
                            uid_to_delete = tokens[i][0]
                            try:
                                db.collection('fcm_tokens').document(uid_to_delete).delete()
                            except: pass

            self._respond(200, {'success': True, 'sent': r.success_count, 'failed': r.failure_count})

        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _cors(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header('Content-type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
