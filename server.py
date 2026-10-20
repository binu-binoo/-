"""Dependency-free case-management server. Run --init-admin once, then run normally."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
COOKIE_NAME = 'approval_session'
PASSWORD_ITERATIONS = 600_000
SESSION_SECONDS = 8 * 60 * 60
MAX_BODY = 64 * 1024
STATIC_FILES = {
    'index.html', 'app.js', 'style.css', 'knowledge.js', 'rules.js', 'deputy.js',
    'cases.js', 'data/regulation.js', 'data/manual.js', 'data/regulation.pdf',
    'admin.html', 'admin.js', 'admin.css',
}
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def json_dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(24)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ITERATIONS)
    return f'pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}'


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, digest = encoded.split('$')
        if algorithm != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError):
        return False


class APIError(Exception):
    def __init__(self, status: int, message: str, code: str = 'invalid_request'):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


def text(value, name: str, limit: int, required=False) -> str:
    if not isinstance(value, str) or '\x00' in value:
        raise APIError(400, f'{name} 형식을 확인해 주세요.')
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise APIError(400, f'{name}은(는) {limit}자 이내로 입력해 주세요.')
    return value


def string_list(value, name: str, limit: int, item_limit: int, required=False) -> list[str]:
    if not isinstance(value, list) or len(value) > limit:
        raise APIError(400, f'{name} 항목을 확인해 주세요.')
    result = []
    for item in value:
        item = text(item, name, item_limit, required=True)
        if item not in result:
            result.append(item)
    if required and not result:
        raise APIError(400, f'{name}을(를) 한 개 이상 입력해 주세요.')
    return result


def normalize_case(payload: dict, existing: dict | None = None) -> dict:
    """Accept only data fields, never executable match patterns or caller-owned IDs."""
    result = {
        'title': text(payload.get('title', ''), '제목', 180, True),
        'answer': text(payload.get('answer', ''), '답변', 8000, True),
        'keywords': string_list(payload.get('keywords', []), '검색어', 20, 80, True),
        'conditions': string_list(payload.get('conditions', []), '적용 조건', 25, 1000, True),
        'notes': string_list(payload.get('notes', []), '주의사항', 20, 1000),
        'summary': text(payload.get('summary', ''), '요약', 1500),
        'scope': payload.get('scope', 'headquarters'),
        'mode': payload.get('mode', 'general'),
        'kind': 'custom',
    }
    if any(len(keyword) < 2 for keyword in result['keywords']):
        raise APIError(400, '검색어는 각각 두 글자 이상 입력해 주세요.')
    result['question'] = text(payload.get('question') or result['title'], '예시 질문', 1000, True)
    if result['scope'] not in ('headquarters', 'direct', 'all') or result['mode'] != 'general':
        raise APIError(400, '적용 조직 또는 결재 유형을 확인해 주세요.')
    refs = payload.get('regulationRefs', [])
    if not isinstance(refs, list) or len(refs) > 15:
        raise APIError(400, '규정 근거 항목을 확인해 주세요.')
    result['regulationRefs'] = []
    for item in refs:
        if not isinstance(item, dict) or type(item.get('page')) is not int or not 1 <= item['page'] <= 38:
            raise APIError(400, '규정 쪽수는 1~38 사이의 정수여야 합니다.')
        result['regulationRefs'].append({'page': item['page'], 'label': text(item.get('label', ''), '규정 근거', 300)})
    verification = payload.get('verification', {})
    if not isinstance(verification, dict):
        raise APIError(400, '검토 정보를 확인해 주세요.')
    status = verification.get('status', 'unrecorded')
    if status not in ('unrecorded', 'reviewed', 'user-provided'):
        raise APIError(400, '검토 상태를 확인해 주세요.')
    reviewer = verification.get('reviewer')
    reviewer = text(reviewer, '검토 부서·역할', 120) if reviewer is not None else None
    reviewed_at = verification.get('reviewedAt')
    if reviewed_at:
        if not isinstance(reviewed_at, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', reviewed_at):
            raise APIError(400, '검토일은 YYYY-MM-DD 형식으로 입력해 주세요.')
        try:
            dt.date.fromisoformat(reviewed_at)
        except ValueError:
            raise APIError(400, '검토일을 확인해 주세요.') from None
    else:
        reviewed_at = None
    if status == 'reviewed' and (not reviewer or not reviewed_at):
        raise APIError(400, '검토 완료 표시는 검토 부서·역할과 검토일이 모두 필요합니다.')
    result['verification'] = {'status': status, 'reviewer': reviewer or None, 'reviewedAt': reviewed_at}
    if existing:
        for key in ('id', 'number'):
            if key in existing:
                result[key] = existing[key]
    return result


class Application:
    def __init__(self, root: Path = ROOT, data_dir: Path | None = None, secure_cookies: bool | None = None, public_origin: str | None = None):
        self.root = Path(root).resolve()
        self.data_dir = Path(data_dir or self.root / '.local').resolve()
        self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db_path = self.data_dir / 'cases.sqlite3'
        self.secure_cookies = (os.environ.get('APP_SECURE_COOKIES') == '1') if secure_cookies is None else secure_cookies
        self.public_origin = (public_origin or os.environ.get('APP_PUBLIC_ORIGIN', '')).rstrip('/')
        self.rate_lock = threading.Lock()
        self.failures: dict[str, list[float]] = {}
        self._prepare()

    def connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        return conn

    def _prepare(self):
        with self.connect() as conn:
            conn.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES users(username),csrf TEXT NOT NULL,expires_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,number INTEGER UNIQUE NOT NULL,draft_json TEXT NOT NULL,published_json TEXT,revision INTEGER NOT NULL,published_revision INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS case_history(id INTEGER PRIMARY KEY,case_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,record_json TEXT NOT NULL,username TEXT NOT NULL,created_at TEXT NOT NULL);
            ''')
            conn.execute('BEGIN IMMEDIATE')
            if not conn.execute("SELECT 1 FROM metadata WHERE key='seeded'").fetchone():
                seed_path = self.root / 'data' / 'cases.js'
                seed = {'cases': []}
                if seed_path.exists():
                    raw = seed_path.read_text(encoding='utf-8')
                    match = re.fullmatch(r'\s*globalThis\.CaseData\s*=\s*(\{.*\})\s*;?\s*', raw, re.S)
                    if not match:
                        raise RuntimeError('초기 사례 자료 형식을 확인해 주세요.')
                    seed = json.loads(match.group(1))
                now = timestamp()
                for original in seed.get('cases', []):
                    record = dict(original)
                    record['kind'] = 'builtin'
                    record['state'] = 'published'
                    record['isPublished'] = True
                    encoded = json_dump(record)
                    conn.execute('INSERT INTO cases VALUES(?,?,?,?,?,?,?,?)', (record['id'], record['number'], encoded, encoded, 1, 1, now, now))
                conn.execute('INSERT INTO metadata VALUES(?,?)', ('seeded', now))
        os.chmod(self.db_path, 0o600)

    def has_admin(self) -> bool:
        with self.connect() as conn:
            return bool(conn.execute('SELECT 1 FROM users LIMIT 1').fetchone())

    def initialize_admin(self, password: str | None = None) -> Path | None:
        """Create only once. Return generated credential path, never the credential."""
        generated_path = None
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                return None
            generated = password is None
            if generated:
                password = secrets.token_urlsafe(24)
            self.validate_password(password)
            if generated:
                generated_path = self.data_dir / 'admin-initial-password.txt'
                fd = os.open(generated_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                    stream.write(password + '\n')
            try:
                conn.execute('INSERT INTO users VALUES(?,?,?,?)', ('admin', password_hash(password), 1, timestamp()))
            except Exception:
                if generated_path:
                    generated_path.unlink()
                raise
        return generated_path

    @staticmethod
    def validate_password(password):
        if not isinstance(password, str) or not 12 <= len(password) <= 256 or '\x00' in password:
            raise APIError(400, '비밀번호는 12~256자로 입력해 주세요.', 'password_policy')

    def public_cases(self):
        with self.connect() as conn:
            records = [json.loads(row['published_json']) for row in conn.execute('SELECT published_json FROM cases WHERE published_json IS NOT NULL ORDER BY number')]
            registered = conn.execute("SELECT value FROM metadata WHERE key='seeded'").fetchone()['value'][:10]
        for record in records:
            record['state'] = 'published'
            record['isPublished'] = True
        return {'version': 1, 'sourceTitle': '규정에 규정되어 있지 않은 사례', 'sourceVisibility': 'approved-for-publication', 'registeredAt': registered, 'cases': records}

    def session(self, token):
        if not token:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as conn:
            row = conn.execute('SELECT sessions.*,users.must_change FROM sessions JOIN users USING(username) WHERE token_hash=? AND expires_at>?', (digest, time.time())).fetchone()
        return dict(row) if row else None

    def session_from_hash(self, token_hash):
        with self.connect() as conn:
            row = conn.execute('SELECT sessions.*,users.must_change FROM sessions JOIN users USING(username) WHERE token_hash=? AND expires_at>?', (token_hash, time.time())).fetchone()
        return dict(row) if row else None

    def session_response(self, session):
        if not session:
            return {'authenticated': False}
        return {'authenticated': True, 'csrfToken': session['csrf'], 'username': session['username'], 'mustChangePassword': bool(session['must_change'])}

    def login(self, username, password, address):
        now = time.time()
        with self.rate_lock:
            failed = [t for t in self.failures.get(address, []) if t > now - 600]
            self.failures[address] = failed
            if len(failed) >= 8:
                raise APIError(429, '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.', 'rate_limited')
        with self.connect() as conn:
            user = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        # Use the same expensive derivation for an unknown username.
        candidate_hash = user['password_hash'] if user else 'pbkdf2_sha256$600000$' + '00'*24 + '$' + '00'*32
        accepted = isinstance(password, str) and len(password) <= 256 and verify_password(password, candidate_hash)
        if not user or not accepted:
            with self.rate_lock:
                self.failures[address].append(now)
            raise APIError(401, '아이디 또는 비밀번호를 확인해 주세요.', 'invalid_credentials')
        with self.rate_lock:
            self.failures.pop(address, None)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.connect() as conn:
            conn.execute('DELETE FROM sessions WHERE expires_at<=?', (now,))
            conn.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), username, csrf, now + SESSION_SECONDS))
        return token, self.session(token)

    @staticmethod
    def row_record(row):
        record = json.loads(row['draft_json'])
        is_published = row['published_json'] is not None
        dirty = row['draft_json'] != row['published_json']
        record.update({'state': 'draft' if not is_published or dirty else 'published', 'isPublished': is_published,
                       'revision': row['revision'], 'publishedRevision': row['published_revision'], 'updatedAt': row['updated_at'], 'createdAt': row['created_at']})
        return record

    def list_admin_cases(self):
        with self.connect() as conn:
            return [self.row_record(row) for row in conn.execute('SELECT * FROM cases ORDER BY number')]

    def change_case(self, action, payload, username, case_id=None):
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            old = None
            if case_id:
                old = conn.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
                if not old:
                    raise APIError(404, '사례를 찾을 수 없습니다.', 'not_found')
                if type(payload.get('revision')) is not int or payload['revision'] != old['revision']:
                    raise APIError(409, '다른 변경이 먼저 저장되었습니다. 목록을 새로 불러와 주세요.', 'revision_conflict')
            now = timestamp()
            if action in ('create', 'update'):
                existing = json.loads(old['draft_json']) if old else None
                record = normalize_case(payload, existing)
                if old:
                    revision = old['revision'] + 1
                    conn.execute('UPDATE cases SET draft_json=?,revision=?,updated_at=? WHERE id=?', (json_dump(record), revision, now, case_id))
                else:
                    case_id = 'custom-' + secrets.token_hex(12)
                    number = max(conn.execute('SELECT COALESCE(MAX(number),0) FROM cases').fetchone()[0], 7) + 1
                    record.update({'id': case_id, 'number': number})
                    revision = 1
                    conn.execute('INSERT INTO cases VALUES(?,?,?,?,?,?,?,?)', (case_id, number, json_dump(record), None, revision, None, now, now))
            elif action == 'publish':
                if payload.get('reviewConfirmed') is not True:
                    raise APIError(400, '적용 조건과 답변을 검토한 뒤 공개 확인을 선택해 주세요.', 'review_required')
                record = json.loads(old['draft_json'])
                revision = old['revision'] + 1
                conn.execute('UPDATE cases SET published_json=draft_json,revision=?,published_revision=?,updated_at=? WHERE id=?', (revision, revision, now, case_id))
            elif action == 'unpublish':
                record = json.loads(old['draft_json'])
                revision = old['revision'] + 1
                conn.execute('UPDATE cases SET published_json=NULL,revision=?,published_revision=NULL,updated_at=? WHERE id=?', (revision, now, case_id))
            else:
                raise APIError(404, '지원하지 않는 작업입니다.', 'not_found')
            conn.execute('INSERT INTO case_history(case_id,revision,action,record_json,username,created_at) VALUES(?,?,?,?,?,?)', (case_id, revision, action, json_dump(record), username, now))
            row = conn.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
            return self.row_record(row)


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, application):
        self.application = application
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = 'ApprovalGuide'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        # Never log query strings, entered questions, passwords, or case contents.
        pass

    @property
    def app(self):
        return self.server.application

    def common_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        if self.app.secure_cookies:
            self.send_header('Strict-Transport-Security', 'max-age=31536000')

    def send_bytes(self, status, body, content_type, cookie=None):
        self.send_response(status)
        self.common_headers()
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        if status == 429:
            self.send_header('Retry-After', '600')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_json(self, status, value, cookie=None):
        self.send_bytes(status, json_dump(value).encode(), 'application/json; charset=utf-8', cookie)

    def cookie(self, token=None, clear=False):
        value = f'{COOKIE_NAME}={token or ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else SESSION_SECONDS}'
        return value + ('; Secure' if self.app.secure_cookies else '')

    def session(self):
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            token = cookies[COOKIE_NAME].value if COOKIE_NAME in cookies else None
        except Exception:
            token = None
        return self.app.session(token)

    def require_session(self, payload_change=False):
        session = self.session()
        if not session:
            raise APIError(401, '관리자 로그인이 필요합니다.', 'authentication_required')
        if payload_change and session['must_change']:
            raise APIError(403, '초기 비밀번호를 먼저 변경해 주세요.', 'password_change_required')
        return session

    def check_origin(self):
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise APIError(403, '다른 사이트에서 보낸 요청은 허용하지 않습니다.', 'origin_rejected')
        origin = self.headers.get('Origin')
        expected = self.app.public_origin or (('https://' if self.app.secure_cookies else 'http://') + self.headers.get('Host', ''))
        if origin and origin.rstrip('/') != expected:
            raise APIError(403, '요청 출처를 확인해 주세요.', 'origin_rejected')

    def check_csrf(self, session):
        self.check_origin()
        token = self.headers.get('X-CSRF-Token', '')
        if not token or not hmac.compare_digest(token, session['csrf']):
            raise APIError(403, '요청 확인 정보가 일치하지 않습니다. 다시 로그인해 주세요.', 'csrf_rejected')

    def body(self):
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not re.fullmatch(r'\d+', lengths[0]):
            raise APIError(400, '요청 길이를 확인해 주세요.')
        length = int(lengths[0])
        if length > MAX_BODY:
            raise APIError(413, '한 번에 전송할 수 있는 크기를 초과했습니다.', 'body_too_large')
        if self.headers.get('Transfer-Encoding'):
            raise APIError(400, '지원하지 않는 전송 방식입니다.')
        if self.headers.get_content_type() != 'application/json':
            raise APIError(415, 'JSON 형식으로 요청해 주세요.', 'unsupported_media_type')
        try:
            value = json.loads(self.rfile.read(length).decode('utf-8'), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise APIError(400, '요청 내용을 확인해 주세요.') from None
        if not isinstance(value, dict):
            raise APIError(400, '요청은 JSON 객체여야 합니다.')
        return value

    def route(self):
        raw_path = urlsplit(self.path).path
        path = unquote(raw_path)
        if '\\' in path or '\x00' in path or any(part == '..' for part in path.split('/')):
            raise APIError(404, '요청한 항목을 찾을 수 없습니다.', 'not_found')
        if self.command in ('GET', 'HEAD'):
            if path == '/api/session':
                self.send_json(200, self.app.session_response(self.session()))
                return
            if path in ('/api/cases', '/data/cases.js'):
                value = self.app.public_cases()
                if path.endswith('.js'):
                    # JSON quotes guard data; Unicode line-separator escaping also protects old JS engines.
                    body = ('globalThis.CaseData = ' + json_dump(value).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029') + ';\n').encode()
                    self.send_bytes(200, body, 'application/javascript; charset=utf-8')
                else:
                    self.send_json(200, value)
                return
            if path == '/api/admin/cases':
                session = self.require_session()
                self.send_json(200, {'cases': self.app.list_admin_cases(), 'csrfToken': session['csrf']})
                return
            if path.startswith('/api/'):
                raise APIError(404, '요청한 항목을 찾을 수 없습니다.', 'not_found')
            name = {'/': 'index.html', '/admin': 'admin.html', '/admin/': 'admin.html'}.get(path, path.removeprefix('/'))
            if name not in STATIC_FILES:
                raise APIError(404, '요청한 파일을 찾을 수 없습니다.', 'not_found')
            source = self.app.root / name
            if not source.is_file() or not source.resolve().is_relative_to(self.app.root):
                raise APIError(404, '요청한 파일을 찾을 수 없습니다.', 'not_found')
            content_type = mimetypes.guess_type(name)[0] or 'application/octet-stream'
            if content_type.startswith('text/') or name.endswith('.js'):
                content_type += '; charset=utf-8'
            content = source.read_bytes()
            if name == 'index.html':
                content = content.replace(b'<!--SERVER_ADMIN_NAV-->', b'<a href="/admin" class="admin-link">'+ '사례 관리'.encode('utf-8') + b'</a>')
            self.send_bytes(200, content, content_type)
            return
        if self.command not in ('POST', 'PUT'):
            raise APIError(405, '지원하지 않는 요청 방식입니다.', 'method_not_allowed')
        self.check_origin()
        if path == '/api/login' and self.command == 'POST':
            payload = self.body()
            username = text(payload.get('username', ''), '아이디', 80, True)
            password = payload.get('password', '')
            if not isinstance(password, str) or len(password) > 256:
                raise APIError(401, '아이디 또는 비밀번호를 확인해 주세요.', 'invalid_credentials')
            token, session = self.app.login(username, password, self.client_address[0])
            self.send_json(200, self.app.session_response(session), self.cookie(token))
            return
        session = self.require_session(payload_change=path not in ('/api/password', '/api/logout'))
        self.check_csrf(session)
        payload = self.body()
        if path == '/api/logout' and self.command == 'POST':
            with self.app.connect() as conn:
                conn.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
            self.send_json(200, {'ok': True}, self.cookie(clear=True))
            return
        if path == '/api/password' and self.command == 'POST':
            current = payload.get('currentPassword', '')
            new = payload.get('newPassword', '')
            self.app.validate_password(new)
            if not isinstance(current, str) or len(current) > 256:
                raise APIError(400, '현재 비밀번호를 확인해 주세요.')
            with self.app.connect() as conn:
                user = conn.execute('SELECT password_hash FROM users WHERE username=?', (session['username'],)).fetchone()
                if not verify_password(current, user['password_hash']):
                    raise APIError(400, '현재 비밀번호를 확인해 주세요.', 'invalid_password')
                if hmac.compare_digest(current, new):
                    raise APIError(400, '새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.')
                conn.execute('UPDATE users SET password_hash=?,must_change=0 WHERE username=?', (password_hash(new), session['username']))
                conn.execute('DELETE FROM sessions WHERE username=? AND token_hash<>?', (session['username'], session['token_hash']))
            initial = self.app.data_dir / 'admin-initial-password.txt'
            if initial.is_file():
                initial.unlink()
            self.send_json(200, self.app.session_response(self.app.session_from_hash(session['token_hash'])))
            return
        if path == '/api/admin/cases' and self.command == 'POST':
            record = self.app.change_case('create', payload, session['username'])
            self.send_json(201, {'case': record})
            return
        match = re.fullmatch(r'/api/admin/cases/([A-Za-z0-9-]+)(?:/(publish|unpublish))?', path)
        if match:
            case_id, action = match.groups()
            if (action and self.command != 'POST') or (not action and self.command != 'PUT'):
                raise APIError(405, '지원하지 않는 요청 방식입니다.', 'method_not_allowed')
            record = self.app.change_case(action or 'update', payload, session['username'], case_id)
            self.send_json(200, {'case': record})
            return
        raise APIError(404, '요청한 항목을 찾을 수 없습니다.', 'not_found')

    def handle_request(self):
        try:
            self.route()
        except APIError as error:
            self.send_json(error.status, {'error': error.message, 'message': error.message, 'code': error.code})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self.send_json(500, {'error': '요청 처리 중 오류가 발생했습니다.', 'message': '요청 처리 중 오류가 발생했습니다.', 'code': 'server_error'})

    do_GET = handle_request
    do_HEAD = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_DELETE = handle_request


def create_server(host='127.0.0.1', port=8080, root=ROOT, data_dir=None, **options):
    return AppServer((host, port), Application(root, data_dir, **options))


def main():
    parser = argparse.ArgumentParser(description='전결 길잡이 일반·관리자 서버')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--data-dir', type=Path, default=ROOT / '.local')
    parser.add_argument('--init-admin', action='store_true')
    args = parser.parse_args()
    app = Application(ROOT, args.data_dir)
    initial_password = os.environ.get('APP_ADMIN_PASSWORD')
    if args.init_admin:
        existed = app.has_admin()
        credential_path = app.initialize_admin(initial_password)
        if existed:
            print('기존 관리자 계정을 유지했습니다.')
        elif credential_path:
            print(f'초기 비밀번호 파일: {credential_path}')
        else:
            print('환경설정의 비밀번호로 관리자 계정을 생성했습니다. 첫 로그인 후 변경해 주세요.')
        return
    if not app.has_admin():
        if initial_password:
            app.initialize_admin(initial_password)
        else:
            parser.error('먼저 --init-admin으로 관리자 계정을 초기화해 주세요.')
    server = AppServer((args.host, args.port), app)
    print(f'전결 길잡이 서버 실행: 포트 {server.server_address[1]} (종료: Ctrl+C)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
