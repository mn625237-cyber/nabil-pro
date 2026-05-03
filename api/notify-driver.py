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

        # مديرين فقط
        ah = self.headers.get('Authorization', '')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            decoded    = auth.verify_id_token(ah.split('Bearer ')[1])
            uid_caller = decoded['uid']
            user_doc   = db.collection('users').document(uid_caller).get()
            if not user_doc.exists or user_doc.to_dict().get('role') != 'manager':
                self._respond(403, {'error': 'مديرين فقط'}); return
        except Exception as e:
            self._respond(403, {'error': 'غير مصرح: ' + str(e)}); return

        body      = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        uid       = body.get('uid',   '').strip()
        title     = body.get('title', '')
        body_text = body.get('body',  '')

        if not uid or not title:
            self._respond(400, {'error': 'uid و title مطلوبان'}); return

        try:
            doc = db.collection('fcm_tokens').document(uid).get()
            if not doc.exists:
                self._respond(200, {'success': True, 'note': 'no token'}); return
            token = doc.to_dict().get('token')
            if not token:
                self._respond(200, {'success': True, 'note': 'empty token'}); return

            messaging.send(messaging.Message(
                notification=messaging.Notification(title=title, body=body_text),
                token=token,
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
                        require_interaction=True
                    ),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                )
            ))
            self._respond(200, {'success': True})

        except Exception as e:
            err_str = str(e)
            if 'UNREGISTERED' in err_str.upper():
                try:
                    db.collection('fcm_tokens').document(uid).delete()
                except:
                    pass
                self._respond(200, {'success': True, 'note': 'token deleted'})
            else:
                self._respond(500, {'error': err_str})

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
