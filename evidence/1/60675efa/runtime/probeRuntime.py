#!/usr/bin/env python3
"""Private harnessed built-server HTTP diagnostic, never UI acceptance."""
import base64, datetime, hashlib, http.client, json, os, pathlib, re, shutil, socket, subprocess, tempfile, time, traceback, urllib.parse

ROOT=pathlib.Path(os.environ.get('TOONFLOW_PROBE_ROOT', pathlib.Path.cwd())).resolve()
OUT=pathlib.Path(os.environ.get('TOONFLOW_EVIDENCE_DIR') or tempfile.mkdtemp(prefix='toonflowRawEvidence-'))
OUT.mkdir(parents=True,exist_ok=True)
BUN=shutil.which(os.environ.get('BUN_BINARY', 'bun'))
if not BUN: raise SystemExit('Bun executable not found; install nothing implicitly')
PRELOAD=pathlib.Path(__file__).with_name('loopbackPreload.ts')
BASE='http://127.0.0.1:3000'
run=pathlib.Path(tempfile.mkdtemp(prefix='toonflowRuntime-',dir='/tmp'))
data=run/'data'; home=run/'home'; tmp=run/'tmp'
for p in [data,home,tmp,run/'xdgConfig',run/'xdgCache']: p.mkdir()
env={'PATH':'/usr/bin:/bin','HOME':str(home),'TMPDIR':str(tmp),'XDG_CONFIG_HOME':str(run/'xdgConfig'),'XDG_CACHE_HOME':str(run/'xdgCache'),'TOONFLOW_DATA_DIR':str(data),'NODE_ENV':'production','LANG':'C.UTF-8','TZ':'UTC'}
steps=[]; requests=[]; processes=[]; current=None; process_log=None
manifest={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Harnessed exact built-server API and filesystem diagnostics; NOT unmodified startup or browser/UI acceptance','root':str(ROOT),'temporaryRoot':str(run),'dataDirectory':str(data),'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'bunVersion':subprocess.check_output([BUN,'--version'],text=True).strip(),'builtServerSha256':hashlib.sha256((ROOT/'build/server/index.js').read_bytes()).hexdigest(),'preloadSha256':hashlib.sha256(PRELOAD.read_bytes()).hexdigest(),'environment':env,'commands':[],'outcome':'running'}

def sha(b): return hashlib.sha256(b).hexdigest()
def check(name, ok, details=None):
    item={'step':len(steps)+1,'name':name,'result':'PASS' if ok else 'FAIL','details':details}
    steps.append(item); print(json.dumps(item,ensure_ascii=False),flush=True)
    if not ok: raise AssertionError(name)

def request(label, method, path, query=None, body=None, content_type=None, headers=None):
    target=path+('?' + urllib.parse.urlencode(query) if query is not None else '')
    h={'Origin':BASE,'X-Toonflow-Workspace':'1','Accept-Language':'en-US'}
    if headers is not None: h=headers
    if isinstance(body,dict): body=json.dumps(body,ensure_ascii=False).encode(); content_type='application/json'
    if content_type: h['Content-Type']=content_type
    conn=http.client.HTTPConnection('127.0.0.1',3000,timeout=20)
    conn.request(method,target,body=body,headers=h)
    response=conn.getresponse(); raw=response.read(); rh=dict(response.getheaders()); status=response.status; conn.close()
    index=len(requests)+1
    fname=f'response{index:02d}.bin'; (OUT/fname).write_bytes(raw)
    rec={'label':label,'request':{'method':method,'url':BASE+target,'headers':h,'bodyUtf8':body.decode('utf-8') if body else None},'response':{'status':status,'headers':rh,'bytes':len(raw),'sha256':sha(raw),'bodyFile':fname}}
    if len(raw)<12000: rec['response']['bodyUtf8']=raw.decode('utf-8',errors='replace')
    requests.append(rec)
    return status,raw,rh

def api(label,method,path,expected=200,**kw):
    status,raw,headers=request(label,method,path,**kw)
    obj=json.loads(raw)
    check(label,status==expected and obj.get('code')==expected,{'status':status,'body':obj if len(raw)<3000 else 'see captured response'})
    return obj.get('data')

def assert_port_free(port):
    with socket.socket() as s:
        s.settimeout(.2)
        return s.connect_ex(('127.0.0.1',port))!=0

def start(tag):
    global current,process_log
    check(tag+' port 3000 initially free',assert_port_free(3000))
    log_path=OUT/f'{tag}.log'; process_log=open(log_path,'wb')
    cmd=[BUN,'--preload',str(PRELOAD),str(ROOT/'build/server/index.js')]
    manifest['commands'].append({'argv':cmd,'cwd':str(ROOT),'env':env,'stdoutAndStderr':str(log_path)})
    current=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=process_log,stderr=subprocess.STDOUT)
    processes.append({'pid':current.pid,'tag':tag})
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        if current.poll() is not None: raise RuntimeError(f'{tag} startup exited {current.returncode}; inspect {log_path}')
        text=log_path.read_text(errors='replace')
        if '[服务启动成功]' in text:
            check(tag+' completed startup',True,{'pid':current.pid,'log':str(log_path)})
            listeners=[json.loads(line.removeprefix('RUNTIME_GUARD ')) for line in text.splitlines() if line.startswith('RUNTIME_GUARD ')]
            addresses=[e['detail'] for e in listeners if e['event']=='listenerAddress']
            check(tag+' listeners bound only to loopback',len(addresses)>=2 and all(e.get('address')=='127.0.0.1' for e in addresses),addresses)
            check(tag+' no attempted non-loopback outbound request',not any(e['event']=='blockedOutbound' for e in listeners))
            return
        time.sleep(.1)
    raise TimeoutError('startup did not reach success marker')

def stop(tag):
    global current,process_log
    if current is None: return
    pid=current.pid
    if current.poll() is None:
        current.terminate()
        try: current.wait(timeout=10)
        except subprocess.TimeoutExpired:
            current.kill(); current.wait(timeout=10)
    code=current.returncode
    if process_log: process_log.close()
    for p in processes:
        if p['pid']==pid: p['exitCode']=code
    current=None; process_log=None
    check(tag+' process stopped and port 3000 released',assert_port_free(3000),{'pid':pid,'exitCode':code})

try:
    start('firstStart')
    status,html,_=request('homepage','GET','/')
    check('homepage returns exact built HTML',status==200 and html==(ROOT/'build/web/index.html').read_bytes(),{'status':status,'sha256':sha(html)})
    html=html.decode()
    for name,pattern in [('javascript',r'<script[^>]+src="([^"]+)"'),('stylesheet',r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"')]:
        path=re.search(pattern,html).group(1)
        status,raw,_=request(name,'GET',path)
        check(name+' static resource is byte-identical to build',status==200 and raw==(ROOT/'build/web'/path.lstrip('/')).read_bytes(),{'path':path,'status':status,'sha256':sha(raw),'bytes':len(raw)})
    install_counts={}
    for target,source,pattern in [('tools','tools','*.tool.js'),('nodes','nodes','*.umd.js'),('ext','ext','ext-*.umd.js'),('providers','providers/media','*.ts')]:
        expected=list((ROOT/'build'/source).glob(pattern))
        check('first initialization copies '+target,len(expected)>0 and all((data/target/p.name).exists() and (data/target/p.name).read_bytes()==p.read_bytes() for p in expected),{'count':len(expected),'files':[p.name for p in expected]})
        install_counts[target]=len(expected)
    skills=[p for p in (ROOT/'build/skills').iterdir() if p.is_dir()]
    check('first initialization installs skill directories',len(skills)>0 and all((data/'skills'/p.name/'SKILL.md').exists() for p in skills),{'directories':[p.name for p in skills]})
    markers={name:(data/name/'initialized').read_text() for name in ['tools','nodes','providers','skills']}
    check('plugin initialization markers exist',all((data/name/'initialized').is_file() for name in markers),{'providerRevisionLength':len(markers['providers'])})
    node_list=api('node metadata API','GET','/api/nodes/get')
    check('built node metadata readable without load errors',len(node_list)==install_counts['nodes'] and all(not e.get('loadError') for e in node_list))
    tool_list=api('tool metadata API','GET','/api/tools/get')['tools']
    check('built tool metadata readable without load errors',len(tool_list)==install_counts['tools'] and all(not e.get('loadError') for e in tool_list))
    ext_list=api('extension metadata API','GET','/api/ext/list')
    check('built extension metadata readable without load errors',len(ext_list)==install_counts['ext'] and all(not e.get('loadError') for e in ext_list))
    listing=api('list server workspaces','GET','/api/workspaces/list')
    server_root=pathlib.Path(listing['absolutePath'])
    check('server workspace root is isolated data/workspaces',server_root==data/'workspaces')
    api('create test workspace through API','POST','/api/workspaces/files/mkdir',body={'directory':str(server_root),'path':'runtimeProbe'})
    workspace=server_root/'runtimeProbe'
    api('open allowed test workspace','GET','/api/workspaces/check',query={'directory':str(workspace)})
    filename='验收文档.txt'; fixture='Toonflow runtime persistence\n中文内容：保存后重新打开。\nUTF-8: 🌱\n'.encode()
    q={'directory':str(workspace),'path':filename}
    api('write exact UTF-8 fixture','PUT','/api/workspaces/files/write',query={**q,'exclusive':'true'},body=fixture,content_type='application/octet-stream')
    check('write persisted exact bytes on disk',(workspace/filename).read_bytes()==fixture,{'sha256':sha(fixture),'bytes':len(fixture)})
    status,raw,_=request('reopen raw document','GET','/api/workspaces/files/read',query=q)
    check('raw reopen returns identical content',status==200 and raw==fixture)
    snapshot=api('reopen document snapshot','GET','/api/workspaces/files/read',query={**q,'snapshot':'true'})
    check('snapshot text and revision match bytes',snapshot['text']==fixture.decode() and snapshot['revision']==sha(fixture) and snapshot['encoding']=='utf-8')
    api('exclusive write rejects existing target','PUT','/api/workspaces/files/write',expected=409,query={**q,'exclusive':'true'},body=b'UNWANTED REPLACEMENT',content_type='application/octet-stream')
    check('existing target survives exclusive conflict',(workspace/filename).read_bytes()==fixture)
    api('stale revision rejects write','PUT','/api/workspaces/files/write',expected=409,query={**q,'expectedRevision':'0'*64},body=b'UNWANTED STALE REPLACEMENT',content_type='application/octet-stream')
    check('existing target survives stale revision conflict',(workspace/filename).read_bytes()==fixture)
    updated=fixture+'Revision-checked update retained.\n'.encode()
    update_result=api('matching revision updates content','PUT','/api/workspaces/files/write',query={**q,'expectedRevision':sha(fixture)},body=updated,content_type='application/octet-stream')
    check('revision-checked update returns new revision and exact disk bytes',update_result['revision']==sha(updated) and (workspace/filename).read_bytes()==updated)
    outside=run/'outside'; outside.mkdir(); (outside/'canary.txt').write_text('untouched')
    (workspace/'outsideLink').symlink_to(outside,target_is_directory=True)
    (workspace/'fileLink.txt').symlink_to(outside/'canary.txt')
    cases=[('parent traversal','../escape.txt',400),('absolute path',str(outside/'absoluteEscape.txt'),400),('workspace root','',400),('symlink directory escape','outsideLink/escape.txt',403),('symlink file','fileLink.txt',403)]
    for label,path,expected in cases:
        api('reject '+label,'PUT','/api/workspaces/files/write',expected=expected,query={'directory':str(workspace),'path':path},body=b'UNWANTED ESCAPE',content_type='application/octet-stream')
    api('reject outside server workspace','PUT','/api/workspaces/files/write',expected=403,query={'directory':str(outside),'path':'canary.txt'},body=b'UNWANTED OUTSIDE WRITE',content_type='application/octet-stream')
    api('reject missing required directory','GET','/api/workspaces/files/read',expected=400,query={'path':filename})
    check('rejected paths leave canary and workspace intact',(outside/'canary.txt').read_text()=='untouched' and sorted(p.name for p in outside.iterdir())==['canary.txt'] and not (server_root/'escape.txt').exists() and workspace.is_dir() and (workspace/filename).read_bytes()==updated)
    settings=api('read fresh settings','GET','/api/settings/get')
    check('fresh provider settings contain no API keys',all(not p.get('apiKey') for p in settings.get('customProviders',[])))
    settings['ui']={**settings.get('ui',{}),'language':'en-US'}
    api('save non-sensitive UI language setting','PUT','/api/settings/save',body={'settings':settings})
    check('settings persisted on disk',json.loads((data/'settings.json').read_text())['settings']['ui']['language']=='en-US')
    canaries={data/'tools'/'userMaterial.txt':b'preserve custom tool-side material\n',data/'providers'/'userMaterial.txt':b'preserve custom provider-side material\n',data/'skills'/'userMaterial.txt':b'preserve custom skill-side material\n'}
    for path,value in canaries.items(): path.write_bytes(value)
    modified_tool=data/'tools'/'workspace.tool.js'; modified=modified_tool.read_bytes()+b'\n// runtime-probe local modification, no executable change\n'; modified_tool.write_bytes(modified)
    before_restart={'workspaceSha256':sha(updated),'settings':settings,'markers':markers,'customMaterial':{str(p.relative_to(data)):sha(v) for p,v in canaries.items()},'modifiedToolSha256':sha(modified)}
    (OUT/'beforeRestart.json').write_text(json.dumps(before_restart,ensure_ascii=False,indent=2)+'\n')
    stop('first stop')
    start('secondStart')
    api('reopen workspace after server restart','GET','/api/workspaces/check',query={'directory':str(workspace)})
    status,raw,_=request('reopen document after server restart','GET','/api/workspaces/files/read',query=q)
    check('document survives full process restart byte-for-byte',status==200 and raw==updated and (workspace/filename).read_bytes()==updated,{'sha256':sha(raw),'bytes':len(raw)})
    snapshot=api('snapshot after server restart','GET','/api/workspaces/files/read',query={**q,'snapshot':'true'})
    check('text and revision survive restart',snapshot['text']==updated.decode() and snapshot['revision']==sha(updated))
    reopened_settings=api('reopen saved settings after restart','GET','/api/settings/get')
    check('full settings object survives restart',reopened_settings==settings)
    check('same-build restart preserves initialized markers',all((data/name/'initialized').read_text()==value for name,value in markers.items()))
    check('same-build restart preserves custom materials',all(p.read_bytes()==value for p,value in canaries.items()))
    check('same-build restart preserves local tool modification',modified_tool.read_bytes()==modified)
    check('startup and tested API calls attempted no guarded outbound requests',all('"event":"blockedOutbound"' not in (OUT/(p['tag']+'.log')).read_text(errors='replace') for p in processes))
    manifest['outcome']='PASS for harnessed scope only'
except BaseException as exc:
    manifest['outcome']='FAIL'; manifest['error']=repr(exc); manifest['traceback']=traceback.format_exc(); print(manifest['traceback'],flush=True)
finally:
    try: stop('final cleanup')
    except BaseException as exc: manifest['cleanupError']=repr(exc); manifest['outcome']='FAIL'
    manifest['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); manifest['processes']=processes
    manifest['passedChecks']=sum(s['result']=='PASS' for s in steps); manifest['failedChecks']=sum(s['result']=='FAIL' for s in steps)
    manifest['temporaryFilesRetainedForReview']=True
    (OUT/'runtimeManifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (OUT/'runtimeChecks.json').write_text(json.dumps(steps,ensure_ascii=False,indent=2)+'\n')
    (OUT/'httpRequestsResponses.json').write_text(json.dumps(requests,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'outcome':manifest['outcome'],'passedChecks':manifest['passedChecks'],'failedChecks':manifest['failedChecks'],'temporaryRoot':str(run)},ensure_ascii=False),flush=True)
    raise SystemExit(0 if manifest['outcome'].startswith('PASS') else 1)
