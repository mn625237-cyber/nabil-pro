import json, os, re
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

        body  = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        name  = body.get('name',  '').strip()
        phone = body.get('phone', '').strip()
        email = body.get('email', '').strip()
        pin   = str(body.get('pin', '')).strip()
        role  = body.get('role', 'driver').strip()

        # التحقق من البيانات
        if not name or not email or not re.match(r'^\d{6}$', pin):
            self._respond(400, {'error': 'بيانات ناقصة أو PIN غلط'}); return

        # ✅ تحقق أن الـ email ينتهي بـ @nabilpro.app
        if not email.endswith('@nabilpro.app'):
            self._respond(400, {'error': 'الـ email لازم ينتهي بـ @nabilpro.app'}); return

        if role not in ('driver', 'manager'):
            self._respond(400, {'error': 'role غير صالح'}); return

        try:
            # إنشاء في Firebase Auth
            user = auth.create_user(email=email, password=pin, display_name=name)

            # ✅ حفظ في Firestore مباشرة من الـ API
            db.collection('users').document(user.uid).set({
                'uid':       user.uid,
                'name':      name,
                'phone':     phone,
                'email':     email,
                'role':      role,
                'pin':       pin,
                'createdAt': firestore.SERVER_TIMESTAMP,
                'createdBy': uid_caller
            })

            self._respond(200, {'success': True, 'uid': user.uid})

        except auth.EmailAlreadyExistsError:
            self._respond(409, {'error': 'الرقم ده موجود بالفعل'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

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
