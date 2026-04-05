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
        uid = body.get('uid','').strip()
        title = body.get('title','')
        body_text = body.get('body','')
        if not uid or not title:
            self._respond(400, {'error': 'uid و title مطلوبان'}); return
        try:
            doc = db.collection('fcm_tokens').document(uid).get()
            if not doc.exists:
                self._respond(200, {'success': True}); return
            token = doc.to_dict().get('token')
            if not token:
                self._respond(200, {'success': True}); return
            messaging.send(messaging.Message(
                notification=messaging.Notification(title=title, body=body_text),
                token=token,
                webpush=messaging.WebpushConfig(
                    headers={'Urgency':'high'},
                    notification=messaging.WebpushNotification(title=title, body=body_text, icon='https://nabil-pro.vercel.app/icon-192.png', require_interaction=True),
                    fcm_options=messaging.WebpushFCMOptions(link='https://nabil-pro.vercel.app')
                )
            ))
            self._respond(200, {'success': True})
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