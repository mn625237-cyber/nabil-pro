import json, os, re
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

        # Layer 1: API Secret
        api_secret = os.environ.get('API_SECRET', '')
        if api_secret:
            if self.headers.get('x-api-key', '') != api_secret:
                self._respond(403, {'error': 'غير مصرح'}); return

        # Layer 2: Firebase ID Token — مديرين فقط
        ah = self.headers.get('Authorization','')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            decoded = auth.verify_id_token(ah.split('Bearer ')[1])
            uid_caller = decoded['uid']
            user_doc = db.collection('users').document(uid_caller).get()
            if not user_doc.exists or user_doc.to_dict().get('role') != 'manager':
                self._respond(403, {'error': 'مديرين فقط'}); return
        except:
            self._respond(403, {'error': 'غير مصرح'}); return

        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        uid     = body.get('uid','').strip()
        new_pin = str(body.get('pin','')).strip()

        if not uid or not re.match(r'^\d{6}$', new_pin):
            self._respond(400, {'error': 'uid وpin مطلوبان (6 أرقام)'}); return

        try:
            auth.update_user(uid, password=new_pin)
            db.collection('users').document(uid).update({
                'pin': new_pin,
                'pinUpdatedAt': firestore.SERVER_TIMESTAMP
            })
            # إشعار المندوب
            try:
                token_doc = db.collection('fcm_tokens').document(uid).get()
                if token_doc.exists:
                    token = token_doc.to_dict().get('token')
                    if token:
                        messaging.send(messaging.Message(
                            notification=messaging.Notification(
                                title='🔑 تم تغيير كودك',
                                body='تم تغيير كود الدخول بتاعك من قِبل المدير'
                            ),
                            token=token,
                            webpush=messaging.WebpushConfig(
                                headers={'Urgency':'high'},
                                notification=messaging.WebpushNotification(
                                    title='🔑 تم تغيير كودك',
                                    body='تم تغيير كود الدخول بتاعك من قِبل المدير',
                                    icon='https://nabil-pro.vercel.app/icon-192.png',
                                    require_interaction=True
                                ),
                                fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                            )
                        ))
            except: pass

            self._respond(200, {'success': True})

        except auth.UserNotFoundError:
            self._respond(404, {'error': 'المستخدم مش موجود'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _cors(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization, x-api-key')

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header('Content-type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
