"""Real HTTP + Docker streaming acceptance with a local deterministic OpenAI-compatible model."""
import argparse
import http.server,json,threading,time,pathlib,subprocess,os,signal,re,urllib.request,uuid
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=18927)
parser.add_argument('--keep-running',action='store_true',help='Keep the isolated app open for browser QA')
options=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[4]
root=repo/'liteflow-agent-web-container-mysql'/'target'/('chat-stream-ui-check-'+uuid.uuid4().hex[:8]);root.mkdir(parents=True);(root/'workspace').mkdir()
command="pwd; printf '状态：检查中\\n'; sleep 2; printf '状态：完成\\n'"
class Model(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  request=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));messages=request.get('messages',[])
  last_user=max((i for i,m in enumerate(messages) if m['role']=='user'),default=-1)
  has_tool=any(m['role']=='tool' for m in messages[last_user+1:])
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  def emit(delta,finish=None):
   chunk={'id':'chatcmpl-'+('final' if has_tool else 'initial'),'object':'chat.completion.chunk','created':int(time.time()),'model':'test-model','choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
   self.wfile.write(('data: '+json.dumps(chunk,ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.65)
  if not has_tool:
   emit({'role':'assistant','reasoning_content':'先确认工作目录，'})
   emit({'reasoning_content':'再检查命令执行的结果。'})
   emit({'content':'我会检查当前工作目录，'})
   emit({'content':'并观察命令返回的日志。'})
   arguments=json.dumps({'command':command},ensure_ascii=False)
   cut=len(arguments)//2
   emit({'tool_calls':[{'index':0,'id':'tool-check','type':'function','function':{'name':'execute','arguments':arguments[:cut]}}]})
   emit({'tool_calls':[{'index':0,'function':{'arguments':arguments[cut:]}}]})
   emit({},'tool_calls')
  else:
   for text in ['工作目录检查已完成。\n\n','当前目录为 `/workspace`，','命令已正常执行，两条检查日志均已返回。\n\n','- **工作目录**：可正常访问。\n','- **命令执行**：已完成。\n\n','可以继续处理下一项任务。']:
    emit({'content':text})
   emit({},'stop')
  self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
model=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
args=['--server.port='+str(options.port),'--server.address=127.0.0.1','--liteflow.agent.application-name='+root.name,'--liteflow.agent.execution-timeout=45s','--liteflow.agent.harness.local.workspace-root='+str(root/'workspace'),'--liteflow.agent.harness.docker.lifecycle=SESSION_IDLE','--liteflow.agent.openai-compatible.deepseek.api-key=local-regression-only','--liteflow.agent.openai-compatible.deepseek.base-url=http://127.0.0.1:'+str(model.server_port)+'/v1','--example.agent.model=test-model','--liteflow.agent.skills.enabled=false']
env=os.environ.copy()
output=(root/'server.log').open('w');process=None;database=None
base='http://127.0.0.1:'+str(options.port)
def request(path,data=None): return urllib.request.urlopen(urllib.request.Request(base+path,None if data is None else json.dumps(data).encode(),{'Content-Type':'application/json'}),timeout=45)
try:
 # The example's artifact store requires shared storage. Use a disposable database,
 # isolated from the user's MySQL sessions, with no host volume and a random loopback port.
 database=subprocess.check_output(['docker','run','--rm','-d','--name','liteflow-stream-test-'+uuid.uuid4().hex[:10],
  '-e','MYSQL_ROOT_PASSWORD=local-test-only','-e','MYSQL_DATABASE=liteflow_status_test',
  '-p','127.0.0.1::3306','mysql:8.4'],text=True).strip()
 port=subprocess.check_output(['docker','port',database,'3306/tcp'],text=True).strip().rsplit(':',1)[1]
 deadline=time.monotonic()+60
 while subprocess.run(['docker','exec','-e','MYSQL_PWD=local-test-only',database,'mysql','-h','127.0.0.1','-uroot','-e','SELECT 1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
  if time.monotonic()>deadline: raise RuntimeError('Isolated MySQL startup timed out')
  time.sleep(.5)
 env['SPRING_APPLICATION_JSON']=json.dumps({'liteflow':{'agent':{'session-store':{'type':'MYSQL','mysql':{
  'jdbc-url':'jdbc:mysql://127.0.0.1:'+port+'/liteflow_status_test?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC',
  'username':'root','password':'local-test-only','database-name':'liteflow_status_test',
  'table-name':'status_acceptance','create-if-not-exist':True}}}}})
 process=subprocess.Popen(['mvn','-o','-pl','liteflow-agent-web-container-mysql','spring-boot:run','-Dspring-boot.run.arguments='+' '.join(args)],cwd=repo,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
 deadline=time.monotonic()+40
 while True:
  try:
   with request('/api/chat/sessions') as response: response.read()
   break
  except Exception:
   if process.poll() is not None or time.monotonic()>deadline: raise RuntimeError('Startup failed: '+str(root/'server.log'))
   time.sleep(.2)
 with request('/api/chat/sessions',{'title':'界面验收 · 实时过程'}) as response: session=json.load(response)['id']
 def sandbox_status():
  with request('/api/chat/sessions/'+session+'/sandbox') as response:
   assert response.headers.get('Cache-Control')=='no-store'
   return json.load(response)
 assert sandbox_status()['state']=='NOT_ALLOCATED'
 sandbox_observations=[]
 events=[];start=time.monotonic();event_name='message'
 with request('/api/chat/sessions/'+session+'/messages/stream',{'message':'[界面验收] 检查工作目录，展示实时执行过程。'}) as response:
  assert response.headers.get('X-Accel-Buffering')=='no',dict(response.headers)
  while True:
   raw=response.readline()
   if not raw: break
   line=raw.decode().strip()
   if not line: continue
   if line.startswith('event:'): event_name=line[6:].strip()
   elif line.startswith('data:'):
    data=json.loads(line[5:]);events.append({'seconds':round(time.monotonic()-start,3),'name':event_name,'data':data})
    print(json.dumps({'seconds':events[-1]['seconds'],'name':event_name,'type':data.get('type'),'chars':len(data.get('text') or '')},ensure_ascii=False),flush=True)
    if event_name=='reasoning' and not sandbox_observations:
     observed=sandbox_status();sandbox_observations.append(observed)
     assert observed['state']=='RUNNING' and observed['busy'],observed
    if event_name in ['done','error']: break
 (root/'events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
 assert events[-1]['name']=='done',events[-1]
 done=events[-1]['seconds'];reasoning=[e for e in events if e['name']=='reasoning'];actions=[e for e in events if e['name']=='action'];texts=[e for e in events if e['name']=='message']
 assert reasoning and reasoning[0]['seconds']<done-3,reasoning
 assert actions and actions[0]['seconds']<done-3,actions
 assert len(texts)>3 and texts[0]['seconds']<done-3,texts
 tool_input=''.join(e['data']['toolInput'].get('delta','') for e in actions)
 assert json.loads(tool_input)['command']==command,tool_input
 assert all(e['data']['toolCallId']=='tool-check' for e in actions),actions
 idle=sandbox_status();sandbox_observations.append(idle)
 assert idle['state']=='RUNNING' and not idle['busy'],idle
 assert idle['containerId']==sandbox_observations[0]['containerId'],sandbox_observations
 assert idle['image']=='liteflow-agent-sandbox:node22',idle
 (root/'sandbox-status.json').write_text(json.dumps(sandbox_observations,ensure_ascii=False,indent=2))
 print('CHECK_PASSED '+json.dumps({'url':base,'session':session,'duration':done,'reasoning_first':reasoning[0]['seconds'],'action_first':actions[0]['seconds'],'artifacts':str(root)},ensure_ascii=False),flush=True)
 if options.keep_running: input('Preview running. Press Enter to stop.\n')
finally:
 if process is not None:
  try: os.killpg(process.pid,signal.SIGTERM)
  except ProcessLookupError: pass
  try: process.wait(timeout=15)
  except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL);process.wait()
 if database is not None: subprocess.run(['docker','rm','-f',database],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 output.close();model.shutdown()
