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
        manager_uid = self._verify_manager(db)
        if not manager_uid:
            self._respond(403, {'error': 'غير مصرح'}); return
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        uid = body.get('uid','').strip()
        new_pin = str(body.get('pin','')).strip()
        if not uid or not re.match(r'^\d{6}$', new_pin):
            self._respond(400, {'error': 'uid وpin مطلوبان'}); return
        try:
            auth.update_user(uid, password=new_pin)
            db.collection('users').document(uid).update({'pin': new_pin, 'pinUpdatedAt': firestore.SERVER_TIMESTAMP})
            self._send_fcm(db, uid, '🔑 تم تغيير كودك', 'تم تغيير كود الدخول بتاعك من قِبل المدير')
            self._respond(200, {'success': True})
        except auth.UserNotFoundError:
            self._respond(404, {'error': 'المستخدم مش موجود'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _verify_manager(self, db):
        ah = self.headers.get('Authorization','')
        if not ah.startswith('Bearer '): return None
        try:
            decoded = auth.verify_id_token(ah.split('Bearer ')[1])
            uid = decoded['uid']
            doc = db.collection('users').document(uid).get()
            return uid if doc.exists and doc.to_dict().get('role')=='manager' else None
        except: return None

    def _send_fcm(self, db, uid, title, body_text):
        try:
            doc = db.collection('fcm_tokens').document(uid).get()
            if not doc.exists: return
            token = doc.to_dict().get('token')
            if not token: return
            messaging.send(messaging.Message(
                notification=messaging.Notification(title=title, body=body_text),
                token=token,
                webpush=messaging.WebpushConfig(
                    headers={'Urgency':'high'},
                    notification=messaging.WebpushNotification(title=title, body=body_text, icon='https://nabil-pro.vercel.app/icon-192.png', require_interaction=True),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                )
            ))
        except: pass

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