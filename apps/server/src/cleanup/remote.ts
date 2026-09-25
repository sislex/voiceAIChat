import { randomUUID } from 'node:crypto'
import type { TemporaryResource } from '@voicechat/shared'
import type { Inspection, ResourceBackend } from './service.js'
import { shellQuote } from '../ci/executor.js'

/** Run on the owning machine. All traversal/deletion is relative to open directory
 * descriptors; replacing an ancestor with a symlink cannot redirect removal.
 * Git metadata is removed by its exact verified registration, never global prune.
 */
export const RESOURCE_HELPER = String.raw`
import os, sys, json, stat, subprocess, hashlib
request=json.loads(sys.argv[1])
r=request['resource']; mode=request['mode']
result=dict(present=True,identity=None,gitCommonDir=None,gitRegistration=None,bytes=None,sizeReason=None,reasons=[])
fds=[]
deleting=False
def fail(reason):
    raise RuntimeError(reason)
# Ancestors need lookup, not enumeration. O_SEARCH (macOS) and O_PATH
# (Linux) retain openat/fstat and no-follow semantics without read access.
search_flags=getattr(os,'O_SEARCH',getattr(os,'O_PATH',os.O_RDONLY))|os.O_DIRECTORY|os.O_NOFOLLOW
def opened(path, create=False):
    if not isinstance(path,str) or not path.startswith('/') or path=='/' or os.path.normpath(path)!=path:
        fail('path_not_canonical')
    fd=os.open('/',search_flags); fds.append(fd)
    parts=path.split('/')[1:]
    for index,part in enumerate(parts):
        flags=(os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW) if index==len(parts)-1 else search_flags
        try: child=os.open(part,flags,dir_fd=fd)
        except FileNotFoundError:
            if not create: raise
            try: os.mkdir(part,0o700,dir_fd=fd)
            except FileExistsError: pass
            child=os.open(part,flags,dir_fd=fd)
        fd=child; fds.append(fd)
    return fd
def ident(st): return str(st.st_dev)+':'+str(st.st_ino)
def git(fd,*args, allow=False):
    p=subprocess.run(['git','--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',*args],preexec_fn=lambda:os.fchdir(fd),capture_output=True,text=True,timeout=30)
    if p.returncode and not allow: fail('git_verification_unavailable')
    return p
def measure(fd,dev,top=True):
    total=0
    for name in os.listdir(fd):
        if name in ('.voicechat-permanent','.generated_images') or name.endswith(('.db','.sqlite','.sqlite3')) or (name=='.git' and not top): fail('excluded_data')
        st=os.stat(name,dir_fd=fd,follow_symlinks=False)
        if st.st_dev!=dev: fail('nested_mount')
        if stat.S_ISDIR(st.st_mode):
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            try: total+=measure(child,dev,False)
            finally: os.close(child)
        elif stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
            if st.st_nlink>1: fail('shared_hardlink')
            total+=st.st_blocks*512
        else: fail('special_file')
    return total
def digest(fd):
    h=hashlib.sha256()
    while True:
        data=os.read(fd,1024*1024)
        if not data: break
        h.update(data)
    return h.digest()
def copy_verified(source,target,name):
    st=os.stat(name,dir_fd=source,follow_symlinks=False)
    if stat.S_ISDIR(st.st_mode):
        try: os.mkdir(name,0o700,dir_fd=target)
        except FileExistsError: pass
        a=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=source)
        b=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=target)
        try:
            for child in os.listdir(a): copy_verified(a,b,child)
        finally: os.close(a); os.close(b)
    elif stat.S_ISREG(st.st_mode):
        a=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=source)
        try:
            try: b=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=target)
            except FileExistsError: b=None
            if b is not None:
                try:
                    while True:
                        data=os.read(a,1024*1024)
                        if not data: break
                        view=memoryview(data)
                        while view: view=view[os.write(b,view):]
                    os.fsync(b)
                finally: os.close(b)
            os.lseek(a,0,0)
            b=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=target)
            try:
                if digest(a)!=digest(b): fail('diagnostic_archive_conflict')
            finally: os.close(b)
        finally: os.close(a)
    else: fail('diagnostic_archive_unsupported_file')
def archive(fd):
    names=[name for name in os.listdir(fd) if name in ('test-results','playwright-report','coverage','artifacts','logs','reports') or name.endswith(('.log','.junit.xml'))]
    if not names: return 0
    destination=r.get('resultsPath')
    if not destination or not destination.startswith(root+'/.voicechat-cleanup-results/') or destination.startswith(path+'/'): fail('results_not_saved')
    target=opened(destination,True)
    before=measure(target,os.fstat(target).st_dev)
    for name in names: copy_verified(fd,target,name)
    return max(0,measure(target,os.fstat(target).st_dev)-before)
def erase(parent,name,expected=None):
    st=os.stat(name,dir_fd=parent,follow_symlinks=False)
    if expected and ident(st)!=expected: fail('identity_changed')
    if not stat.S_ISDIR(st.st_mode): fail('directory_replaced')
    fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    try:
        if ident(os.fstat(fd))!=ident(st): fail('identity_changed')
        for entry in os.listdir(fd):
            child=os.stat(entry,dir_fd=fd,follow_symlinks=False)
            if child.st_dev!=st.st_dev: fail('nested_mount')
            if stat.S_ISDIR(child.st_mode): erase(fd,entry,ident(child))
            elif stat.S_ISREG(child.st_mode) or stat.S_ISLNK(child.st_mode):
                os.unlink(entry,dir_fd=fd)
            else: fail('special_file')
        if ident(os.stat(name,dir_fd=parent,follow_symlinks=False))!=ident(st): fail('identity_changed')
        os.rmdir(name,dir_fd=parent)
    finally: os.close(fd)
try:
    root=r['root']; path=r['path']
    if not root or root=='/' or not path.startswith(root+'/') or os.path.normpath(path)!=path: fail('path_outside_root')
    opened(root,mode=='create')
    parent=opened(os.path.dirname(path),mode=='create')
    name=os.path.basename(path)
    if mode=='create':
        # Existing directories never acquire ownership by guessing their name.
        try: os.mkdir(name,0o700,dir_fd=parent)
        except FileExistsError: fail('existing_resource_unconfirmed')
    try: fd=opened(path)
    except FileNotFoundError:
        result.update(present=False,bytes=0,sizeReason=None)
        fd=None
    if fd is not None:
        st=os.fstat(fd); result['identity']=ident(st)
        if mode!='create' and result['identity']!=r['identity']: fail('identity_changed')
        if mode not in ('create','bind'):
            # A successful scan and no diagnostics are required; lsof errors are not emptiness.
            proc=subprocess.Popen(['lsof','-nP','-Fp','+D',path],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            output,errors=proc.communicate(timeout=30)
            if errors.strip() or proc.returncode not in (0,1): fail('process_state_unknown')
            pids={int(line[1:]) for line in output.splitlines() if line.startswith('p') and line[1:].isdigit()}
            if pids-{os.getpid(),proc.pid}: fail('active_process')
            if r['category']!='process':
                status=git(fd,'status','--porcelain=v1','--untracked-files=all').stdout
                if status.strip(): fail('git_changes')
                ignored=git(fd,'ls-files','--others','--ignored','--exclude-standard','--directory','-z').stdout.split('\0')
                for entry in filter(None,ignored):
                    parts=entry.rstrip('/').split('/')
                    archived=parts[0] in ('test-results','playwright-report','coverage','artifacts','logs','reports') or (len(parts)==1 and parts[0].endswith(('.log','.junit.xml')))
                    if 'node_modules' not in parts and not archived: fail('ignored_data_unconfirmed')
                refs=git(fd,'ls-remote','--heads','origin').stdout.splitlines()
                shas=[line.split()[0] for line in refs if line.split()]
                if not shas: fail('publication_unknown')
                heads=git(fd,'rev-parse','HEAD').stdout.split()
                heads+=git(fd,'reflog','--format=%H','HEAD','--').stdout.split()
                if r['category']=='task-environment':
                    heads+=git(fd,'for-each-ref','--format=%(objectname)').stdout.split()
                    heads+=git(fd,'reflog','--all','--format=%H').stdout.split()
                for head in set(heads):
                    if not any(git(fd,'merge-base','--is-ancestor',head,sha,allow=True).returncode==0 for sha in shas):
                        fail('unpublished_commits')
                # Nested repositories and databases are rejected by the descriptor walk.
        try: result['bytes']=measure(fd,st.st_dev)
        except Exception as e: result['sizeReason']=str(e)
        if mode!='create' and r['category']=='merge-worktree':
            common=git(fd,'rev-parse','--path-format=absolute','--git-common-dir').stdout.strip()
            registration=git(fd,'rev-parse','--absolute-git-dir').stdout.strip()
            if not registration.startswith(common+'/worktrees/') or '/' in registration[len(common+'/worktrees/'):]:
                fail('worktree_registration_unconfirmed')
            result['gitCommonDir']=common; result['gitRegistration']=registration
            registrationFd=opened(registration)
            if 'locked' in os.listdir(registrationFd): fail('worktree_locked')
            result['gitRegistrationIdentity']=ident(os.fstat(registrationFd))
            if r.get('gitRegistration') and (r['gitCommonDir']!=common or r['gitRegistration']!=registration): fail('worktree_registration_changed')
    if mode=='remove':
        if os.environ.get('VC_CLEANUP_ADMISSION')!=request['nonce']: fail('agent_cleanup_admission_unavailable')
        # Re-open every path immediately before destruction; absent paths are reconciled too.
        parent=opened(os.path.dirname(path))
        if fd is not None:
            check=opened(path)
            if ident(os.fstat(check))!=r['identity']: fail('identity_changed')
            if result['sizeReason']: fail(result['sizeReason'])
        registration=result['gitRegistration'] or r.get('gitRegistration')
        metadata=None
        if r['category']=='merge-worktree' and not registration: fail('worktree_registration_unknown')
        if registration:
            common=result['gitCommonDir'] or r.get('gitCommonDir')
            if not common or not registration.startswith(common+'/worktrees/'): fail('worktree_registration_unconfirmed')
            try: metadata=opened(registration)
            except FileNotFoundError: metadata=None
            if metadata is not None:
                if 'locked' in os.listdir(metadata): fail('worktree_locked')
                if not r.get('gitRegistrationIdentity') or ident(os.fstat(metadata))!=r['gitRegistrationIdentity']: fail('worktree_registration_changed')
                linkfd=os.open('gitdir',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=metadata)
                with os.fdopen(linkfd) as link:
                    if link.read().strip()!=path+'/.git': fail('worktree_registration_conflict')
                if fd is None:
                    heads=git(metadata,'--git-dir=.','rev-parse','HEAD').stdout.split()
                    heads+=git(metadata,'--git-dir=.','--work-tree=.','reflog','--format=%H','HEAD','--').stdout.split()
                    remote=git(metadata,'--git-dir=.','ls-remote','--heads','origin').stdout.splitlines()
                    if not remote: fail('publication_unknown')
                    for head in set(heads):
                        if not any(git(metadata,'--git-dir=.','merge-base','--is-ancestor',head,line.split()[0],allow=True).returncode==0 for line in remote): fail('unpublished_commits')
        archived=archive(fd) if fd is not None else 0
        deleting=True
        if fd is not None: erase(parent,name,r['identity'])
        if registration and metadata is not None:
            metaParent=opened(os.path.dirname(registration))
            erase(metaParent,os.path.basename(registration),ident(os.fstat(metadata)))
        try:
            opened(path)
            fail('path_replaced_during_cleanup')
        except FileNotFoundError: pass
        result.update(outcome='deleted' if fd is not None else 'absent',reason='owner_completed' if fd is not None else 'already_absent',freedBytes=max(0,result['bytes']-archived) if fd is not None else 0)
except Exception as error:
    reason=str(error)
    result['reasons'].append(reason)
    if result['bytes'] is None: result['sizeReason']=reason
    result.update(outcome='partial' if deleting else 'deferred',reason=reason,freedBytes=None)
finally:
    for fd in reversed(fds):
        try: os.close(fd)
        except OSError: pass
print(json.dumps(result))
`
export class RemoteResourceBackend implements ResourceBackend {
  constructor(private exec: (machineId: string, command: string) => Promise<{ stdout: string; exitCode: number | null; timedOut?: boolean }>) {}
  private async call(resource: TemporaryResource, mode: 'create' | 'inspect' | 'remove' | 'bind'): Promise<Inspection & { outcome: 'deleted' | 'absent' | 'deferred'; reason: string; freedBytes: number | null }> {
    const nonce = randomUUID()
    const command = (mode === 'remove' ? '# voicechat-cleanup-v1 ' + nonce + '\n' : '') +
      'python3 -c ' + shellQuote(RESOURCE_HELPER) + ' ' + shellQuote(JSON.stringify({ resource, mode, nonce }))
    const response = await this.exec(resource.machineId, command)
    if (response.exitCode !== 0 || response.timedOut) throw new Error('machine_inspection_unavailable')
    const value = JSON.parse(response.stdout.trim()) as Inspection & { outcome: 'deleted' | 'absent' | 'deferred'; reason: string; freedBytes: number | null }
    if (!Array.isArray(value.reasons) || typeof value.present !== 'boolean') throw new Error('invalid_machine_evidence')
    return value
  }
  async create(r: TemporaryResource): Promise<Inspection> {
    const result = await this.call(r, 'create')
    if (result.reasons.length) throw new Error(result.reasons.join(', '))
    return result
  }
  bind(r: TemporaryResource): Promise<Inspection> { return this.call(r, 'bind') }
  inspect(r: TemporaryResource): Promise<Inspection> { return this.call(r, 'inspect') }
  remove(r: TemporaryResource) { return this.call(r, 'remove') }
}
