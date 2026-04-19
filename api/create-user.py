import json, os, re
from http.server import BaseHTTPRequestHandler
import firebase_admin
from firebase_admin import credentials, auth

def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(json.loads(os.environ.get('FIREBASE_CREDENTIALS')))
        firebase_admin.initialize_app(cred)

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors(); self.end_headers()

    def do_POST(self):
        init_firebase()

        # Layer 1: API Secret
        api_secret = os.environ.get('API_SECRET', '')
        if api_secret:
            if self.headers.get('x-api-key', '') != api_secret:
                self._respond(403, {'error': 'غير مصرح'}); return

        # Layer 2: Firebase ID Token — مديرين فقط
        ah = self.headers.get('Authorization', '')
        if not ah.startswith('Bearer '):
            self._respond(403, {'error': 'غير مصرح'}); return
        try:
            from firebase_admin import firestore
            decoded = auth.verify_id_token(ah.split('Bearer ')[1])
            uid_caller = decoded['uid']
            db = firestore.client()
            user_doc = db.collection('users').document(uid_caller).get()
            if not user_doc.exists or user_doc.to_dict().get('role') != 'manager':
                self._respond(403, {'error': 'مديرين فقط'}); return
        except Exception as e:
            self._respond(403, {'error': 'غير مصرح: ' + str(e)}); return

        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        name  = body.get('name', '').strip()
        phone = body.get('phone', '').strip()
        email = body.get('email', '').strip()
        pin   = str(body.get('pin', '')).strip()
        role  = body.get('role', 'driver').strip()

        if not name or not email or not re.match(r'^\d{6}$', pin):
            self._respond(400, {'error': 'بيانات ناقصة أو PIN غلط'}); return

        try:
            # إنشاء المستخدم باستخدام Admin SDK
            user = auth.create_user(
                email=email,
                password=pin,
                display_name=name
            )
            self._respond(200, {'success': True, 'uid': user.uid})

        except auth.EmailAlreadyExistsError:
            self._respond(409, {'error': 'الرقم ده موجود بالفعل'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _cors(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
