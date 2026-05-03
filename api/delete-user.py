import json, os
from http.server import BaseHTTPRequestHandler
import firebase_admin
from firebase_admin import credentials, auth, firestore

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

        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        uid  = body.get('uid', '').strip()

        if not uid:
            self._respond(400, {'error': 'uid مطلوب'}); return

        # منع حذف النفس
        if uid == uid_caller:
            self._respond(400, {'error': 'لا يمكنك حذف حسابك الخاص'}); return

        errors = []

        # 1) حذف من Firebase Auth
        try:
            auth.delete_user(uid)
        except auth.UserNotFoundError:
            pass  # مش موجود في Auth — متابعة
        except Exception as e:
            errors.append('Auth: ' + str(e))

        # 2) حذف من Firestore
        try:
            db.collection('users').document(uid).delete()
        except Exception as e:
            errors.append('Firestore: ' + str(e))

        # 3) حذف الـ FCM token
        try:
            db.collection('fcm_tokens').document(uid).delete()
        except Exception as e:
            pass  # مش مشكلة لو مش موجود

        if errors:
            self._respond(500, {'error': ' | '.join(errors)})
        else:
            self._respond(200, {'success': True, 'uid': uid})

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
