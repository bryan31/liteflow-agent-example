"""Serve the actual chat UI with fixture data for browser layout regression (no model or Docker)."""
import argparse
import http.server
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18935)
parser.add_argument('--stylesheet', type=Path, help='Optional old stylesheet for demonstrating the regression')
parser.add_argument('--session-delay-ms', type=int, default=0, help='Delay history responses to verify the loading state')
options = parser.parse_args()
module = Path(__file__).resolve().parents[3]
static = module / 'src/main/resources/static'
session = {'id': 'layout-fixture', 'title': 'Layout regression', 'messages': [], 'loadedSkills': [], 'messageCount': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/chat/sessions':
            body, content_type = json.dumps([session]).encode(), 'application/json'
        elif path == '/api/chat/sessions/layout-fixture':
            time.sleep(max(0, options.session_delay_ms) / 1000)
            body, content_type = json.dumps(session).encode(), 'application/json'
        elif path == '/api/chat/sessions/layout-fixture/sandbox':
            body, content_type = json.dumps({'conversationId': session['id'], 'scope': 'PROCESS_LOCAL',
                'state': 'RUNNING', 'containerId': 'a' * 64, 'containerName': 'agentscope-sandbox-layout-fixture',
                'image': 'liteflow-agent-sandbox:node22', 'busy': False,
                'lastActiveAt': 1789398000000, 'checkedAt': 1789398000000}).encode(), 'application/json'
        elif path == '/api/skills':
            body, content_type = b'[]', 'application/json'
        elif path == '/__tests/chat-layout.html':
            body, content_type = (module / 'src/test/browser/chat-layout.html').read_bytes(), 'text/html'
        elif path in ('/', '/styles.css', '/app.js', '/stream-state.js'):
            file = static / ('index.html' if path == '/' else path[1:])
            if path == '/styles.css' and options.stylesheet:
                file = options.stylesheet
            body = file.read_bytes()
            content_type = 'text/html' if path == '/' else 'text/css' if path == '/styles.css' else 'text/javascript'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

print(f'Open http://127.0.0.1:{options.port}/__tests/chat-layout.html in Chrome', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', options.port), Handler).serve_forever()
