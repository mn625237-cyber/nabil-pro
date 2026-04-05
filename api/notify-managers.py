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
        ah = self.headers.get('Authorization','')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            auth.verify_id_token(ah.split('Bearer ')[1])
        except:
            self._respond(403, {'error': 'غير مصرح'}); return
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        title = body.get('title', 'Nabil Pro 🛵')
        body_text = body.get('body', '')
        try:
            docs = db.collection('fcm_tokens').stream()
            tokens = []
            for doc in docs:
                data = doc.to_dict()
                token = data.get('token')
                uid = data.get('uid')
                role = data.get('role','')
                if not token or not uid: continue
                if role == 'manager':
                    tokens.append(token)
                elif not role:
                    u = db.collection('users').document(uid).get()
                    if u.exists and u.to_dict().get('role') == 'manager':
                        tokens.append(token)
            if not tokens:
                self._respond(200, {'success': True, 'sent': 0}); return
            msg = messaging.MulticastMessage(
                notification=messaging.Notification(title=title, body=body_text),
                tokens=tokens,
                webpush=messaging.WebpushConfig(
                    headers={'Urgency':'high'},
                    notification=messaging.WebpushNotification(
                        title=title, body=body_text,
                        icon='https://nabil-pro.vercel.app/icon-192.png',
                        badge='https://nabil-pro.vercel.app/icon-192.png',
                        require_interaction=True, tag='nabil-order', renotify=True,
                    ),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                ),
            )
            r = messaging.send_each_for_multicast(msg)
            self._respond(200, {'success': True, 'sent': r.success_count})
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