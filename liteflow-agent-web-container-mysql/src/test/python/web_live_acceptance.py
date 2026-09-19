#!/usr/bin/env python3
# Explicit live acceptance; never invoked by the normal build.
from pathlib import Path
import argparse, os, subprocess, time, json, urllib.request, urllib.error, signal, uuid, socket
parser = argparse.ArgumentParser(description='Real Web/LLM/MySQL/Docker acceptance; requires the isolated test database on port 13306.')
parser.add_argument('--env-file', type=Path, help='Optional LiteFlow Agent env.txt; environment variables take precedence')
parser.add_argument('--port', type=int, default=18906)
args = parser.parse_args()
module = Path(__file__).resolve().parents[3]
repo = module.parent
root = module / 'target' / ('web-live-acceptance-' + uuid.uuid4().hex[:10])
root.mkdir(parents=True, exist_ok=True)
print('Evidence: ' + str(root), flush=True)
(root / 'workspace').mkdir(exist_ok=True)
values = {}
if args.env_file:
    for line in args.env_file.read_text().splitlines():
        if line.strip() and (not line.strip().startswith('#')) and ('=' in line):
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip()
for key in ['LITEFLOW_AGENT_TEST_API_KEY', 'LITEFLOW_AGENT_TEST_BASE_URL', 'LITEFLOW_AGENT_TEST_MODEL']:
    values[key] = os.environ.get(key, '').strip() or values.get(key, '').strip()
    if not values[key]:
        parser.error('Missing ' + key + '; configure it in the environment or --env-file')
with socket.socket() as probe:
    try:
        probe.bind(('127.0.0.1', args.port))
    except OSError:
        parser.error('Port is already in use; select another --port')
namespace = 'web-release-' + uuid.uuid4().hex
marker = 'WEB-RELEASE-CHECK-' + uuid.uuid4().hex[:10]
config = {'server': {'port': args.port, 'address': '127.0.0.1'}, 'liteflow': {'agent': {'application-name': namespace, 'execution-timeout': '3m', 'logging': {'enabled': False}, 'session-store': {'type': 'MYSQL', 'mysql': {'jdbc-url': 'jdbc:mysql://localhost:13306/liteflow?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC', 'username': 'root', 'password': 'root123456', 'database-name': 'liteflow', 'table-name': 'web_release_check', 'create-if-not-exist': True}}, 'openai-compatible': {'deepseek': {'api-key': values['LITEFLOW_AGENT_TEST_API_KEY'], 'base-url': values['LITEFLOW_AGENT_TEST_BASE_URL']}}}}, 'example': {'agent': {'model': values['LITEFLOW_AGENT_TEST_MODEL']}}}
env = os.environ.copy()
env['SPRING_APPLICATION_JSON'] = json.dumps(config)
base = 'http://127.0.0.1:' + str(args.port)
proc = None
logfile = None

def request(path, method='GET', body=None, timeout=150):
    req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()

def stop():
    global proc, logfile
    if proc:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
    if logfile:
        logfile.close()
    proc = None

def start(round):
    global proc, logfile
    logfile = (root / f'server-{round}.log').open('w')
    proc = subprocess.Popen(['mvn', '-q', '-f', str(repo / 'liteflow-agent-web-container-mysql/pom.xml'), 'spring-boot:run'], cwd=repo, env=env, stdout=logfile, stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f'Web startup failed; inspect server-{round}.log')
        if 'Started ContainerMysqlAgentApplication' not in (root / f'server-{round}.log').read_text():
            time.sleep(0.5)
            continue
        try:
            request('/api/chat/sessions', timeout=1)
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    raise RuntimeError('Web startup timed out')
results = {}
try:
    start(1)
    print('Web server started', flush=True)
    session = json.loads(request('/api/chat/sessions', 'POST', {'title': 'Release acceptance'}))
    sid = session['id']
    stream = request('/api/chat/sessions/' + sid + '/messages/stream', 'POST', {'message': '只回复 ' + marker + '，不要调用任何工具。'})
    (root / 'stream.txt').write_text(stream)
    assert 'event:done' in stream.replace('event: ', 'event:'), 'SSE run did not complete'
    detail = json.loads(request('/api/chat/sessions/' + sid))
    assert any((m['stage'] == 'result' and marker in m['content'] for m in detail['messages']))
    original = detail['messages']
    results['sse_and_persisted_history'] = True
    print('SSE reply and history verified', flush=True)
    stop()
    start(2)
    restored = json.loads(request('/api/chat/sessions/' + sid))
    assert restored['messages'] == original
    recalled = request('/api/chat/sessions/' + sid + '/messages/stream', 'POST', {'message': '上一轮你回复了哪个验收标记？请原样回复，不要调用工具。'})
    assert 'event:done' in recalled.replace('event: ', 'event:')
    after = json.loads(request('/api/chat/sessions/' + sid))
    assert marker in after['messages'][-1]['content'], 'Harness memory did not survive Web JVM restart'
    results['harness_memory_after_web_restart'] = True
    page = json.loads(request('/api/chat/sessions/' + sid + '/messages?cursor=0&limit=1'))
    assert len(page['items']) == 1 and page['hasMore']
    results['web_jvm_restart_history'] = True
    results['message_paging'] = True
    request('/api/chat/sessions/' + sid, 'DELETE')
    assert all((s['id'] != sid for s in json.loads(request('/api/chat/sessions'))))
    try:
        request('/api/chat/sessions/' + sid)
        raise AssertionError('Deleted conversation remains readable')
    except urllib.error.HTTPError as e:
        assert e.code == 404
    results['delete_and_not_found'] = True
    print(json.dumps(results), flush=True)
    print('Evidence: ' + str(root), flush=True)
finally:
    stop()
    (root / 'result.json').write_text(json.dumps(results, indent=2))
