import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'

const quote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'"

/** Production and shared workspaces never opt in. */
export function processTaskRoot(workdir: string): string | null {
  const match = /^(\/.*\/projects\/[^/]+\/tasks\/[^/]+)(?:\/|$)/.exec(workdir)
  return match && posix.normalize(workdir) === workdir ? match[1] : null
}

export interface ProcessScope {
  root: string
  runId: string
  stage: string
  retain?: boolean
  scope?: string
}

/** Python is also required by machine cleanup, including macOS. */
export const RUN_PROCESS_HELPER = String.raw`
import os, sys, json, subprocess, signal, time, fcntl
request=json.loads(sys.argv[1])
root=request['root']
if not os.path.isabs(root) or os.path.realpath(root)!=root or '/tasks/' not in root:
    raise RuntimeError('process_root_not_canonical')
def command(args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=15,env=dict(os.environ,LC_ALL='C'))
    if p.returncode not in (0,1): raise RuntimeError('process_scan_failed: '+p.stderr)
    return p.stdout
def table():
    rows={}
    for line in command(['ps','-axo','pid=,ppid=,pgid=,stat=,lstart=']).splitlines():
        parts=line.split()
        if len(parts)>=9 and not parts[3].startswith('Z'):
            pid,ppid,pgid=map(int,parts[:3])
            rows[pid]=dict(pid=pid,ppid=ppid,pgid=pgid,start=' '.join(parts[4:]))
    return rows
def locations(pids=None):
    rows={}; pid=None
    args=['lsof','-nP','-d','cwd','-Fpn']
    if pids is not None:
        if not pids: return rows
        args+=['-a','-p',','.join(map(str,pids))]
    for line in command(args).splitlines():
        if line.startswith('p') and line[1:].isdigit(): pid=int(line[1:])
        elif line.startswith('n') and pid: rows[pid]=line[1:]
    return rows
def inside(path): return path==root or path.startswith(root+'/')
def listening(pids):
    result={}; pid=None
    if not pids: return result
    for line in command(['lsof','-nP','-a','-p',','.join(map(str,pids)),'-iTCP','-sTCP:LISTEN','-Fpn']).splitlines():
        if line.startswith('p') and line[1:].isdigit(): pid=int(line[1:])
        elif line.startswith('n') and pid:
            try: result.setdefault(pid,set()).add(int(line.rsplit(':',1)[1]))
            except ValueError: pass
    return {pid:sorted(values) for pid,values in result.items()}
def ports(pid): return listening([pid]).get(pid,[])
def same(record,rows):
    current=rows.get(record['pid'])
    return current and current['start']==record['start'] and current['pgid']==record['pgid']
def registry_path(run):
    if not run or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in run):
        raise RuntimeError('invalid_process_run')
    return root+'/.process-'+run
def update(run,scope,records,deadline):
    path=registry_path(run)
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        text=f.read(); data=json.loads(text) if text else dict(version=1,runId=run,scopes={})
        data['scopes'][scope]=dict(stage=request.get('stage','command'),cwd=request.get('cwd',root),deadline=deadline,processes=records)
        f.seek(0); json.dump(data,f); f.truncate(); f.flush()
def stop(records):
    rows=table()
    live={r['pid']:r for r in records if same(r,rows)}
    groups={r['pgid'] for r in live.values() if r['pgid']>1 and r['pgid']!=os.getpgrp()}
    # A shared group is never signalled as a whole.
    groups={g for g in groups if all(pid in live for pid,row in rows.items() if row['pgid']==g)}
    for g in groups:
        try: os.killpg(g,signal.SIGTERM)
        except ProcessLookupError: pass
    for pid,r in live.items():
        if r['pgid'] not in groups:
            try: os.kill(pid,signal.SIGTERM)
            except ProcessLookupError: pass
    deadline=time.monotonic()+10
    while live and time.monotonic()<deadline:
        rows=table(); live={pid:r for pid,r in live.items() if same(r,rows)}
        if live: time.sleep(.1)
    rows=table()
    live={pid:r for pid,r in live.items() if same(r,rows)}
    killgroups={r['pgid'] for r in live.values() if r['pgid'] in groups}
    killgroups={g for g in killgroups if all(pid in live for pid,row in rows.items() if row['pgid']==g)}
    for g in killgroups:
        try: os.killpg(g,signal.SIGKILL)
        except ProcessLookupError: pass
    for pid,r in live.items():
        if r['pgid'] not in killgroups:
            try: os.kill(pid,signal.SIGKILL)
            except ProcessLookupError: pass
    return len(records)
def snapshot(group,known):
    rows=table()
    owned={pid for pid,r in rows.items() if r['pgid']==group or (pid in known and same(known[pid],rows))}
    changed=True
    while changed:
        children={pid for pid,r in rows.items() if r['ppid'] in owned}
        changed=bool(children-owned); owned|=children
    cwd=locations(owned); listeners=listening(owned)
    for pid in owned:
        row=rows[pid]
        row.update(cwd=cwd.get(pid,known.get(pid,{}).get('cwd',request.get('cwd',root))),ports=listeners.get(pid,[]))
        known[pid]=row
    return list(known.values())
def stop_gradle(cwds):
    homes=[root+'/.gradle-'+request['runId']] if request.get('runId') else [root+'/'+name for name in os.listdir(root) if name.startswith('.gradle-')]
    wrappers=set()
    for cwd in cwds:
        while inside(cwd):
            wrapper=cwd+'/gradlew'
            if os.path.isfile(wrapper):
                wrappers.add(wrapper); break
            if cwd==root: break
            cwd=os.path.dirname(cwd)
    for home in homes:
        if not os.path.isdir(home) or os.path.islink(home): continue
        for wrapper in wrappers:
            try: subprocess.run([wrapper,'--stop'],cwd=os.path.dirname(wrapper),env=dict(os.environ,GRADLE_USER_HOME=home),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
            except (OSError,subprocess.TimeoutExpired): pass
def sweep():
    st=os.stat(root)
    if request.get('identity') and request['identity']!=str(st.st_dev)+':'+str(st.st_ino):
        raise RuntimeError('process_root_identity_changed')
    rows=table(); cwd=locations()
    excluded={os.getpid()}; parent=os.getppid()
    while parent in rows and parent not in excluded:
        excluded.add(parent); parent=rows[parent]['ppid']
    records={}; protected=set()
    for name in os.listdir(root):
        if not name.startswith('.process-') or '.' in name[len('.process-'):]: continue
        path=root+'/'+name
        if os.path.islink(path) or not os.path.isfile(path): continue
        try:
            with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW)) as f:
                fcntl.flock(f,fcntl.LOCK_SH); data=json.load(f)
        except (OSError,ValueError): continue
        if not isinstance(data,dict) or data.get('version')!=1: continue
        if request.get('runId') and data.get('runId')!=request['runId']: continue
        for scope_id,scope in data['scopes'].items():
            if request.get('scope') and scope_id!=request['scope']: continue
            if request.get('expiredOnly') and scope['deadline']>time.time():
                protected.update(r['pid'] for r in scope['processes'] if same(r,rows))
                continue
            for r in scope['processes']:
                if r['pid'] not in excluded and same(r,rows): records[r['pid']]=r
    if not request.get('runId'):
        for pid,path in cwd.items():
            if pid in rows and pid not in excluded and pid not in protected and inside(path):
                if request.get('expiredOnly'):
                    started=time.mktime(time.strptime(rows[pid]['start'],'%a %b %d %H:%M:%S %Y'))
                    if (time.time()-started)*1000<request.get('maxAgeMs',1800000): continue
                records[pid]=dict(rows[pid],cwd=path,ports=ports(pid))
    count=stop(list(records.values()))
    stop_gradle({r['cwd'] for r in records.values()})
    if count:
        fd=os.open(root+'/.process-cleanup.log',os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'a') as log: log.write(json.dumps(dict(at=time.time(),stopped=list(records.values())))+'\n')
    print(json.dumps(dict(stopped=count)))
if request['mode']=='sweep':
    sweep()
else:
    run=request['runId']; scope=request['scope']; known={}
    registry_path(run)
    deadline=time.time()+request['timeoutMs']/1000
    env=dict(os.environ,**request.get('env',{}))
    env['GRADLE_USER_HOME']=root+'/.gradle-'+run
    env['GRADLE_OPTS']=env.get('GRADLE_OPTS','')+' -Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process'
    env['ORG_GRADLE_PROJECT_kotlin.compiler.execution.strategy']='in-process'
    child=None; aborted=False
    def abort(signum,frame):
        global aborted
        aborted=True
    signal.signal(signal.SIGTERM,abort); signal.signal(signal.SIGINT,abort)
    try:
        child=subprocess.Popen(['/bin/bash','-c',request['script']],cwd=request['cwd'],env=env,start_new_session=True)
        while True:
            records=snapshot(child.pid,known)
            update(run,scope,records,deadline)
            code=child.poll()
            if code is not None or aborted or time.time()>=deadline:
                records=snapshot(child.pid,known)
                update(run,scope,records,deadline)
                break
            time.sleep(1)
        if aborted or time.time()>=deadline or not request.get('retain'):
            stop(records)
            stop_gradle({request['cwd'],*[r['cwd'] for r in records]})
        sys.exit(124 if time.time()>=deadline else 130 if aborted else code)
    finally:
        if child is not None and child.poll() is None:
            stop(snapshot(child.pid,known))
`

export function processCommand(script: string, cwd: string, env: Record<string, string>, timeoutMs: number, scope: ProcessScope): string {
  return 'python3 -c ' + quote(RUN_PROCESS_HELPER) + ' ' + quote(JSON.stringify({
    ...scope, mode: 'run', scope: scope.scope ?? randomUUID(), cwd, script, env, timeoutMs
  }))
}

export function stopTaskProcessesCommand(root: string, options: { runId?: string; scope?: string; expiredOnly?: boolean; identity?: string; maxAgeMs?: number } = {}): string {
  return 'python3 -c ' + quote(RUN_PROCESS_HELPER) + ' ' + quote(JSON.stringify({ mode: 'sweep', root, ...options }))
}
