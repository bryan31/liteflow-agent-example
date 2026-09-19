"""Exercise the same session workspace in local/Docker × MySQL/Redis/JSON modes."""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import re
import shlex
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid


CONTENT = 'name,total\nexample,12\nnode,34\n'


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        (self.server.root / (self.server.phase + '-request-' + str(self.server.step) + '.json')).write_text(json.dumps(body, ensure_ascii=False, indent=2))
        names = {tool['function']['name'] for tool in body.get('tools', [])}
        assert 'execute' in names and 'execute_shell_command' not in names, 'Only the session-aware shell should be exposed'
        assert {'write_file', 'read_file', 'deliver_artifact'} <= names, names
        messages = body['messages']
        outputs = [message for message in messages if message['role'] == 'tool']
        restore = self.server.phase == 'restore'
        step = self.server.step
        self.server.step += 1
        if restore and step == 1:
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

        emit({'role': 'assistant', 'reasoning_content': '检查文件与工具结果。'})
        emit({'content': '我会使用工作区文件工具处理报告。'})
        if restore and step == 0:
            name, arguments = 'execute', {'command': "node -e 'process.stdout.write(require(\"fs\").readFileSync(\"report.csv\", \"utf8\"))'"}
        elif restore and step == 1:
            name, arguments = 'execute', {'command': 'pwd'}
        elif restore and step == 2:
            assert self.server.execution_directory in outputs[-1]['content'], outputs[-1]
            emit({'content': '恢复验收完成。'})
            emit({}, 'stop')
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
            return
        elif not restore and step == 0:
            name, arguments = 'load_skill_through_path', {'skillId': self.server.skill_id, 'path': 'SKILL.md'}
        elif not restore and step == 1:
            loaded = outputs[-1]['content']
            assert '本地文件报告' in loaded, outputs
            match = re.search(r'Files root: ([^\n]+)', loaded)
            assert match, 'The loaded Skill must expose a session-relative path'
            self.server.skill_root = match.group(1)
            assert self.server.skill_root.startswith('.skills-cache/'), self.server.skill_root
            assert not Path(self.server.skill_root).is_absolute()
            name, arguments = 'write_file', {'path': 'input.json', 'content': '[{"name":"example","total":12}]'}
        elif not restore and step == 2:
            name, arguments = 'read_file', {'path': self.server.skill_root + '/SKILL.md'}
        elif not restore and step == 3:
            assert '本地文件报告' in outputs[-1]['content'], outputs[-1]
            script = shlex.quote(self.server.skill_root + '/scripts/generate_report.py')
            name, arguments = 'execute', {'command': 'python3 ' + script + ' input.json report.csv'}
        elif not restore and step == 4:
            assert 'python-ok' in outputs[-1]['content'], outputs[-1]
            name, arguments = 'execute', {'command': "node -e 'require(\"fs\").appendFileSync(\"report.csv\", \"node,34\\n\"); console.log(\"node-ok\")'"}
        elif not restore and step == 5:
            assert 'node-ok' in outputs[-1]['content'], outputs[-1]
            name, arguments = 'execute', {'command': 'pwd'}
        elif not restore and step == 6:
            output = outputs[-1]['content']
            try:
                output = json.loads(output)
            except json.JSONDecodeError:
                pass
            cwd = next(line.strip() for line in output.splitlines() if line.startswith('/'))
            if self.server.execution == 'local':
                assert Path(cwd) == (self.server.root / 'workspace' / self.server.root.name / self.server.session_id).resolve(), cwd
                assert sorted(path.name for path in (self.server.root / 'workspace').iterdir()) == [self.server.root.name]
                assert Path(cwd, 'report.csv').read_text() == CONTENT
                assert Path(cwd, self.server.skill_root, 'SKILL.md').is_file()
            else:
                assert cwd == '/workspace', cwd
            self.server.execution_directory = cwd
            name, arguments = 'read_file', {'path': 'report.csv'}
        elif not restore and step == 7:
            assert 'node,34' in outputs[-1]['content'], outputs
            name, arguments = 'execute', {'command': 'find .skills-cache -type f'}
        elif not restore and step == 8:
            output = outputs[-1]['content']
            try:
                output = json.loads(output)
            except json.JSONDecodeError:
                pass
            paths = sorted(line.strip() for line in output.splitlines() if line.startswith('.skills-cache/'))
            expected = sorted([self.server.skill_root + '/SKILL.md', self.server.skill_root + '/scripts/generate_report.py'])
            assert paths == expected, (paths, expected)
            self.server.skill_files = paths
            name, arguments = 'deliver_artifact', {'filePath': 'report.csv',
                                                  'description': 'Unified shell acceptance report'}
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
    parser.add_argument('--backend', choices=['mysql', 'redis', 'json'], required=True)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--execution', choices=['local', 'container'], default='local')
    parser.add_argument('--redis-uri', help='Dedicated test Redis URI; otherwise start a native temporary Redis')
    options = parser.parse_args()
    for executable in ['python3', 'node']:
        if not shutil.which(executable):
            parser.error('Install ' + executable + ' and make it available on PATH')
    if options.backend == 'mysql':
        required = ['MYSQL_JDBC_URL', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']
        if any(name not in os.environ for name in required):
            parser.error('Set MYSQL_JDBC_URL, MYSQL_DATABASE, MYSQL_USER and MYSQL_PASSWORD for a dedicated test database')
    if options.backend == 'redis' and not options.redis_uri and not shutil.which('redis-server'):
        parser.error('Install redis-server for the native Redis acceptance test')
    repo = Path(__file__).resolve().parents[1]
    module = repo / ('liteflow-agent-web-' + options.execution + '-' + options.backend)
    jar = module / 'target' / (module.name + '-1.0.0-SNAPSHOT.jar')
    if not jar.is_file():
        parser.error('Build the module with mvn package first')
    root = module / 'target' / ('local-acceptance-' + uuid.uuid4().hex[:10])
    root.mkdir()
    port = options.port or free_port()
    base = 'http://127.0.0.1:' + str(port)
    model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
    model.root = root
    model.execution = options.execution
    threading.Thread(target=model.serve_forever, daemon=True).start()
    env = os.environ.copy()
    # Prevent developer overrides from reaching real models, databases or data directories.
    env.pop('SPRING_APPLICATION_JSON', None)
    for key in list(env):
        if key.startswith(('LITEFLOW_', 'SPRING_CONFIG_', 'SPRING_PROFILES_')):
            env.pop(key)
    args = ['--spring.config.location=classpath:application.yml', '--spring.config.import=',
            '--liteflow.agent.harness.filesystem-backend=' + ('DOCKER' if options.execution == 'container' else 'GUARDED_LOCAL'),
            '--server.address=127.0.0.1', '--server.port=' + str(port),
            '--liteflow.agent.application-name=' + root.name,
            '--liteflow.agent.harness.local.workspace-root=' + str(root / 'workspace'),
            '--liteflow.agent.execution-timeout=60s',
            '--liteflow.agent.skills.path=' + str(repo / 'scripts/fixtures/skills'),
            '--liteflow.agent.session-store.json-workspace-root=' + str(root / 'records'),
            '--liteflow.agent.openai-compatible.deepseek.api-key=local-acceptance-only',
            '--liteflow.agent.openai-compatible.deepseek.base-url=http://127.0.0.1:' + str(model.server_port) + '/v1',
            '--example.agent.model=test-model']
    if options.execution == 'container' and options.backend == 'json':
        args += ['--liteflow.agent.harness.docker.snapshot-root=' + str(root / 'snapshots')]
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
        model.session_id = session
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
        if options.backend == 'redis' and options.redis_uri:
            args += ['--liteflow.agent.session-store.type=REDIS',
                     '--liteflow.agent.session-store.redis.uri=' + options.redis_uri,
                     '--liteflow.agent.session-store.redis.key-prefix=' + root.name + ':']
        elif options.backend == 'redis':
            redis_port = free_port()
            database = subprocess.Popen([
                'redis-server', '--bind', '127.0.0.1', '--port', str(redis_port),
                '--appendonly', 'yes', '--dir', str(root), '--logfile', str(root / 'redis.log')],
                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 10
            while True:
                try:
                    with socket.create_connection(('127.0.0.1', redis_port), timeout=1):
                        break
                except OSError:
                    if database.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Redis startup failed; see ' + str(root / 'redis.log'))
                    time.sleep(0.1)
            args += ['--liteflow.agent.session-store.type=REDIS',
                     '--liteflow.agent.session-store.redis.uri=redis://127.0.0.1:' + str(redis_port) + '/0',
                     '--liteflow.agent.session-store.redis.key-prefix=' + root.name + ':']
        elif options.backend == 'mysql':
            args += ['--liteflow.agent.session-store.type=MYSQL']
            # Container and local examples must both use the dedicated fixture, regardless of YAML defaults.
            env['SPRING_APPLICATION_JSON'] = json.dumps({'liteflow': {'agent': {'session-store': {'mysql': {
                'jdbc-url': env['MYSQL_JDBC_URL'], 'database-name': env['MYSQL_DATABASE'],
                'username': env['MYSQL_USER'], 'password': env['MYSQL_PASSWORD']}}}}})
        else:
            args += ['--liteflow.agent.session-store.type=JSON',
                     '--liteflow.agent.session-store.json-root=' + str(root / 'agent-state'),
                     '--example.artifacts.root=' + str(root / 'artifacts')]
        start('first-start')
        # Verify actual packaged assets, not just source copies.
        for name in ('index.html', 'styles.css', 'app.js', 'stream-state.js'):
            with request('/' if name == 'index.html' else '/' + name) as response:
                assert response.read() == (module / 'src/main/resources/static' / name).read_bytes()
        skills = read('/api/skills')
        assert len(skills) == 1 and skills[0]['name'] == 'local-report', skills
        model.skill_id = skills[0]['id']
        session = read('/api/chat/sessions', {'title': 'Storage acceptance'})['id']
        path = '/api/chat/sessions/' + session
        events = stream(session, 'CREATE_REPORT：生成报告并交付文件。', 'create')
        artifacts = [event['data']['artifact'] for event in events if event['data'].get('artifact')]
        assert artifacts, events
        artifact = artifacts[-1]
        with request(artifact['downloadUrl']) as response:
            assert response.read().decode() == CONTENT
            assert response.headers['Content-Disposition'].startswith('attachment;')
        history = read(path)
        assert model.skill_id in history['loadedSkills'], history
        assert any(artifact['id'] in message['content'] for message in history['messages'])
        stop()
        if options.execution == 'local':
            assert Path(model.execution_directory).is_dir(), 'Execution directory must remain after shutdown'
        if options.execution == 'local':
            shutil.rmtree(root / 'workspace')  # Simulate another host with only database state.
        start('reopened')
        assert read(path)['messages'] == history['messages']
        with request(artifact['downloadUrl']) as response:
            assert response.read().decode() == CONTENT
        restored = stream(session, 'RESTORE_CHECK：读取已保存的 report.csv。', 'restore')
        assert 'node,34' in json.dumps(model.restored_output, ensure_ascii=False), restored
        page = read(path + '/messages?cursor=0&limit=1')
        assert len(page['items']) == 1 and page['hasMore']
        assert read(path + '/messages?cursor=' + str(page['nextCursor']) + '&limit=1')['items']
        with request(path, method='DELETE') as response:
            assert response.status == 200
        missing(path)
        missing(artifact['downloadUrl'])
        stop()
        start('after-delete')
        assert read('/api/chat/sessions') == []
        missing(artifact['downloadUrl'])
        result = {'execution': options.execution, 'backend': options.backend, 'skill_root': model.skill_root, 'skill_files': model.skill_files, 'result': 'passed', 'artifacts': str(root)}
        (root / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
    finally:
        stop()
        if database is not None:
            database.terminate()
            try:
                database.wait(timeout=10)
            except subprocess.TimeoutExpired:
                database.kill()
                database.wait()
        model.shutdown()
        model.server_close()


if __name__ == '__main__':
    main()
