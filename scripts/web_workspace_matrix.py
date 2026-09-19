"""Run all six workspace combinations against isolated Docker databases and a local model."""
import argparse
import json
import os
import pathlib
import subprocess
import uuid
repo=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--execution', choices=['local', 'container'])
parser.add_argument('--backends', nargs='+', choices=['json', 'mysql', 'redis'], default=['json', 'mysql', 'redis'])
options=parser.parse_args()
project='liteflow-workspace-parity-'+uuid.uuid4().hex[:8]
root=repo/'target'/project
root.mkdir(parents=True)
config={'services':{
'mysql':{'image':'mysql:8.4','environment':{'MYSQL_DATABASE':'liteflow_parity','MYSQL_USER':'fixture','MYSQL_PASSWORD':'fixture_pass','MYSQL_ROOT_PASSWORD':'fixture_root'},'ports':['127.0.0.1::3306'],'volumes':['mysql-data:/var/lib/mysql'],'healthcheck':{'test':['CMD-SHELL','MYSQL_PWD=$$MYSQL_PASSWORD mysql -h 127.0.0.1 -u$$MYSQL_USER $$MYSQL_DATABASE -e "SELECT 1"'],'interval':'2s','timeout':'3s','retries':45}},
'redis':{'image':'redis:7.4-alpine','command':['redis-server','--appendonly','yes'],'ports':['127.0.0.1::6379'],'volumes':['redis-data:/data'],'healthcheck':{'test':['CMD','redis-cli','ping'],'interval':'2s','timeout':'3s','retries':30}}},'volumes':{'mysql-data':{},'redis-data':{}}}
path=root/'compose.json';path.write_text(json.dumps(config))
base=['docker','compose','-p',project,'-f',str(path)]
def compose(*args):return subprocess.check_output(base+list(args),text=True,stderr=subprocess.STDOUT)
env=os.environ.copy()
results=[]
try:
 print('Starting isolated MySQL and Redis fixtures. Logs:',root,flush=True)
 compose('up','-d','--wait','--wait-timeout','120','--pull','never')
 mysql_port=compose('port','mysql','3306').strip().rsplit(':',1)[1]
 redis_port=compose('port','redis','6379').strip().rsplit(':',1)[1]
 env.update(MYSQL_JDBC_URL=f'jdbc:mysql://127.0.0.1:{mysql_port}/liteflow_parity',MYSQL_DATABASE='liteflow_parity',MYSQL_USER='fixture',MYSQL_PASSWORD='fixture_pass')
 for execution in ([options.execution] if options.execution else ('local','container')):
  for backend in options.backends:
   print('Checking',execution,backend,flush=True)
   log=root/(execution+'-'+backend+'.log')
   args=['python3','scripts/web_local_acceptance.py','--execution',execution,'--backend',backend]
   if backend=='redis':args+=['--redis-uri',f'redis://127.0.0.1:{redis_port}/0']
   with log.open('w') as output:
    result=subprocess.run(args,cwd=repo,env=env,stdout=output,stderr=subprocess.STDOUT)
   results.append({'execution':execution,'backend':backend,'exit_code':result.returncode,'log':str(log)})
   (root/'results.json').write_text(json.dumps(results,indent=2))
   if result.returncode:
    print(log.read_text()[-9000:],flush=True)
    raise RuntimeError(f'{execution}/{backend} failed')
   print('PASS',execution,backend,log.read_text().strip(),flush=True)
finally:
 compose('down','-v')
 print('Isolated database fixtures cleaned up.',flush=True)
