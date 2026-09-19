"""Exercise Redis/JSON examples with real HTTP, Docker and a deterministic local model."""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import shlex
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid


CONTENT = 'name,total\nexample,12\n'


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        names = {tool['function']['name'] for tool in body.get('tools', [])}
        assert 'execute' in names and 'execute_shell_command' not in names, names
        messages = body['messages']
        outputs = [message for message in messages if message['role'] == 'tool']
        restore = self.server.phase == 'restore'
        step = self.server.step
        self.server.step += 1
        if restore and step > 0:
            self.server.restored_output = outputs[-1:] if outputs else []
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()

        def emit(delta, finish=None):
            event = {'id': 'acceptance-' + self.server.phase + '-' + str(step), 'object': 'chat.completion.chunk',
                     'created': int(time.time()), 'model': 'test-model',
                     'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
            self.wfile.write(('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode())
            self.wfile.flush()
            time.sleep(0.12)

        if step == 0:
            emit({'role': 'assistant', 'reasoning_content': '检查工作区中的文件。'})
            emit({'content': '我会检查工作目录并处理报告文件。'})
            command = 'cat /workspace/report.csv' if restore else "printf 'name,total\\nexample,12\\n' > /workspace/report.csv; cat /workspace/report.csv"
            if not restore:
                command = 'test -f /.dockerenv && python3 --version && node --version && ' + command
                command = 'sh -c ' + shlex.quote(command)
            name, arguments = 'execute', {'command': command}
        elif not restore and step == 1:
            name, arguments = 'deliver_artifact', {'filePath': '/workspace/report.csv',
                                                   'description': 'Storage acceptance report'}
        else:
            # Include actual tool output so assertions cannot pass on a fabricated success.
            emit({'content': '验收完成。\n\n' + json.dumps(outputs, ensure_ascii=False)})
            emit({}, 'stop')
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
            return
        encoded = json.dumps(arguments, ensure_ascii=False)
        midpoint = len(encoded) // 2
        emit({'tool_calls': [{'index': 0, 'id': 'check-' + uuid.uuid4().hex[:12], 'type': 'function',
                             'function': {'name': name, 'arguments': encoded[:midpoint]}}]})
        emit({'tool_calls': [{'index': 0, 'function': {'arguments': encoded[midpoint:]}}]})
        emit({}, 'tool_calls')
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=['redis', 'json'], required=True)
    parser.add_argument('--port', type=int, default=0)
    options = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    module = repo / ('liteflow-agent-web-container-' + options.backend)
    jar = module / 'target' / (module.name + '-1.0.0-SNAPSHOT.jar')
    if not jar.is_file():
        parser.error('Build the module with mvn package first')
    root = module / 'target' / ('storage-acceptance-' + uuid.uuid4().hex[:10])
    root.mkdir()
    port = options.port or free_port()
    base = 'http://127.0.0.1:' + str(port)
    model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    env = os.environ.copy()
    # Prevent developer overrides from reaching real models, databases or data directories.
    env.pop('SPRING_APPLICATION_JSON', None)
    args = ['--spring.config.location=classpath:application.yml', '--spring.config.import=', '--server.address=127.0.0.1', '--server.port=' + str(port),
            '--liteflow.agent.application-name=' + root.name,
            '--liteflow.agent.execution-timeout=60s',
            '--liteflow.agent.openai-compatible.deepseek.api-key=local-acceptance-only',
            '--liteflow.agent.openai-compatible.deepseek.base-url=http://127.0.0.1:' + str(model.server_port) + '/v1',
            '--example.agent.model=test-model']
    database = None
    process = None
    output = None

    def request(path, data=None, method=None):
        return urllib.request.urlopen(urllib.request.Request(
            base + path, None if data is None else json.dumps(data).encode(),
            {'Content-Type': 'application/json'}, method=method), timeout=90)

    def read(path, data=None, method=None):
        with request(path, data, method) as response:
            return json.load(response)

    def stop():
        nonlocal process, output
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            process = None
        if output is not None:
            output.close()
            output = None

    def start(label):
        nonlocal process, output
        output = (root / (label + '.log')).open('w')
        java = str(Path(env['JAVA_HOME']) / 'bin/java') if env.get('JAVA_HOME') else 'java'
        process = subprocess.Popen([java, '-jar', str(jar), *args], cwd=root, env=env,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 45
        while True:
            try:
                read('/api/chat/sessions')
                return
            except (urllib.error.URLError, OSError):
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Startup failed; see ' + str(root / (label + '.log')))
                time.sleep(0.2)

    def stream(session, prompt, label):
        model.phase = label
        model.step = 0
        model.restored_output = []
        events = []
        event_name = 'message'
        with request('/api/chat/sessions/' + session + '/messages/stream', {'message': prompt}) as response:
            assert response.headers.get('X-Accel-Buffering') == 'no'
            for raw in response:
                line = raw.decode().strip()
                if line.startswith('event:'):
                    event_name = line[6:].strip()
                elif line.startswith('data:'):
                    events.append({'name': event_name, 'data': json.loads(line[5:])})
                    if event_name in ('done', 'error'):
                        break
        (root / (label + '-events.json')).write_text(json.dumps(events, ensure_ascii=False, indent=2))
        assert events and events[-1]['name'] == 'done', events[-1:]
        assert any(event['name'] == 'reasoning' for event in events)
        assert any(event['name'] == 'action' for event in events)
        return events

    def missing(path):
        try:
            request(path).close()
        except urllib.error.HTTPError as failure:
            assert failure.code == 404, failure.code
        else:
            raise AssertionError('Expected 404: ' + path)

    try:
        if options.backend == 'redis':
            redis_port = str(free_port())
            database = subprocess.check_output([
                'docker', 'run', '--rm', '-d', '--name', root.name,
                '-p', '127.0.0.1:' + redis_port + ':6379', 'redis:7.4-alpine',
                'redis-server', '--appendonly', 'yes'], text=True).strip()
            args += ['--liteflow.agent.session-store.type=REDIS',
                     '--liteflow.agent.session-store.redis.uri=redis://127.0.0.1:' + redis_port + '/0',
                     '--liteflow.agent.session-store.redis.key-prefix=' + root.name + ':']
        else:
            args += ['--liteflow.agent.session-store.type=JSON',
                     '--liteflow.agent.harness.local.workspace-root=' + str(root / 'workspace'),
                     '--liteflow.agent.session-store.json-root=' + str(root / 'agent-state'),
                     '--liteflow.agent.harness.docker.snapshot-root=' + str(root / 'snapshots'),
                     '--example.artifacts.root=' + str(root / 'artifacts')]
        start('first-start')
        # Verify actual packaged assets, not just source copies.
        for name in ('index.html', 'styles.css', 'app.js', 'stream-state.js'):
            with request('/' if name == 'index.html' else '/' + name) as response:
                assert response.read() == (repo / 'liteflow-agent-web-container-mysql/src/main/resources/static' / name).read_bytes()
        assert read('/api/skills'), 'Packaged Skill missing'
        session = read('/api/chat/sessions', {'title': 'Storage acceptance'})['id']
        path = '/api/chat/sessions/' + session
        assert read(path + '/sandbox')['state'] == 'NOT_ALLOCATED'
        events = stream(session, 'CREATE_REPORT：生成报告并交付文件。', 'create')
        artifacts = [event['data']['artifact'] for event in events if event['data'].get('artifact')]
        assert artifacts, events
        artifact = artifacts[-1]
        with request(artifact['downloadUrl']) as response:
            assert response.read().decode() == CONTENT
            assert response.headers['Content-Disposition'].startswith('attachment;')
        history = read(path)
        status = read(path + '/sandbox')
        assert status['state'] == 'RUNNING' and not status['busy'], status
        assert any(artifact['id'] in message['content'] for message in history['messages'])
        stop()
        if database:
            subprocess.run(['docker', 'restart', database], check=True, stdout=subprocess.DEVNULL)
        start('reopened')
        assert read(path)['messages'] == history['messages']
        with request(artifact['downloadUrl']) as response:
            assert response.read().decode() == CONTENT
        assert read(path + '/sandbox')['state'] == 'NOT_ALLOCATED'
        restored = stream(session, 'RESTORE_CHECK：读取已保存的 report.csv。', 'restore')
        assert 'example,12' in json.dumps(model.restored_output, ensure_ascii=False), restored
        assert read(path + '/sandbox')['containerId'] != status['containerId']
        page = read(path + '/messages?cursor=0&limit=1')
        assert len(page['items']) == 1 and page['hasMore']
        assert read(path + '/messages?cursor=' + str(page['nextCursor']) + '&limit=1')['items']
        with request(path, method='DELETE') as response:
            assert response.status == 200
        missing(path)
        missing(path + '/sandbox')
        missing(artifact['downloadUrl'])
        stop()
        start('after-delete')
        assert read('/api/chat/sessions') == []
        missing(artifact['downloadUrl'])
        result = {'backend': options.backend, 'result': 'passed', 'artifacts': str(root)}
        (root / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    finally:
        stop()
        if database:
            subprocess.run(['docker', 'rm', '-f', database], stdout=subprocess.DEVNULL, check=False)
        model.shutdown()
        model.server_close()


if __name__ == '__main__':
    main()
