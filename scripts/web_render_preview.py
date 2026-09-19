"""Serve the actual frontend with fake read-only APIs for browser regression tests."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            if path == '/api/chat/sessions':
                value = [{'id': 'render-fixture', 'title': '长输出回归测试'}]
            elif path == '/api/skills':
                value = []
            elif path.endswith('/sandbox'):
                value = {'state': 'NOT_ALLOCATED'}
            else:
                value = {'id': 'render-fixture', 'title': '长输出回归测试', 'messages': []}
            body, mime = json.dumps(value).encode(), 'application/json'
        else:
            module = ROOT / self.server.module
            if path.startswith('/tests/'):
                base = module / 'src/test/browser'
                file = (base / path.removeprefix('/tests/')).resolve()
            else:
                base = module / 'src/main/resources/static'
                file = (base / (path.strip('/') or 'index.html')).resolve()
            if not file.is_relative_to(base) or not file.is_file():
                self.send_error(404)
                return
            body = file.read_bytes()
            mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}.get(file.suffix, 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module', default='liteflow-agent-web-local-mysql',
                        choices=sorted(path.name for path in ROOT.glob('liteflow-agent-web-*')))
    parser.add_argument('--port', type=int, default=18793)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.module = args.module
    print(f'Layout: http://127.0.0.1:{args.port}/tests/chat-layout.html', flush=True)
    print(f'Long output: http://127.0.0.1:{args.port}/tests/long-output.html', flush=True)
    print(f'Execution UI: http://127.0.0.1:{args.port}/tests/execution-process.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
