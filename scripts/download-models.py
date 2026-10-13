"""Download public model weights in verified byte ranges, without sending app data."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import httpx, hashlib, time, os, shutil

def download(url, target, expected=None, resume=None):
    target=Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        head=client.head(url); head.raise_for_status(); total=int(head.headers['content-length'])
    prefix=0
    if resume and Path(resume).exists(): shutil.copyfile(resume,target); prefix=target.stat().st_size
    elif target.exists(): prefix=target.stat().st_size
    if prefix>total: prefix=0
    with target.open('ab') as f: f.truncate(total)
    size=8*1024*1024; ranges=[(i,min(total-1,i+size-1)) for i in range(prefix,total,size)]
    def part(bounds):
        a,b=bounds
        for attempt in range(4):
            try:
                with httpx.Client(follow_redirects=True,timeout=90) as client:
                    with client.stream('GET',url,headers={'Range':f'bytes={a}-{b}'}) as r:
                        r.raise_for_status()
                        if r.status_code!=206: raise RuntimeError('Server did not honor byte range')
                        count=0
                        with target.open('r+b') as out:
                            out.seek(a)
                            for chunk in r.iter_bytes(256*1024):
                                if count+len(chunk)>b-a+1: raise RuntimeError('Unexpected range length')
                                out.write(chunk);count+=len(chunk)
                        if count!=b-a+1: raise RuntimeError('Incomplete range')
                return b-a+1
            except Exception:
                if attempt==3: raise
                time.sleep(2)
    completed=prefix
    with ThreadPoolExecutor(max_workers=8) as pool:
        for count in pool.map(part,ranges):
            completed+=count
            print(f'{target.name}: {completed//1048576}/{total//1048576} MB',flush=True)
    digest=hashlib.file_digest(target.open('rb'),'sha256').hexdigest()
    if expected and digest!=expected: raise RuntimeError('SHA-256 mismatch for '+str(target))
    Path(str(target)+'.verified').write_text(digest,encoding='utf-8')
    print(f'{target.name}: SHA-256 {digest}',flush=True)

if __name__=='__main__':
    import sys
    mode=sys.argv[1]
    if mode=='electron':
        import zipfile
        name='electron-v44.2.0-win32-x64.zip';base='https://github.com/electron/electron/releases/download/v44.2.0/'
        with httpx.Client(follow_redirects=True,timeout=60) as client:
            r=client.get(base+'SHASUMS256.txt');r.raise_for_status();expected=next(l.split()[0] for l in r.text.splitlines() if l.split()[-1].lstrip('*')==name)
        download(base+name,'data/'+name,expected)
        with zipfile.ZipFile('data/'+name) as z:z.extractall('node_modules/electron/dist')
        Path('node_modules/electron/path.txt').write_text('electron.exe',encoding='utf-8')
    else:
        repo,name,folder=('Systran/faster-whisper-small','model.bin','whisper') if mode=='voice' else ('Qwen/Qwen3-0.6B-GGUF','Qwen3-0.6B-Q8_0.gguf','qwen')
        url=f'https://huggingface.co/{repo}/resolve/main/{name}'
        with httpx.Client(timeout=60) as client:
            r=client.head(url);expected=r.headers.get('x-linked-etag','').strip('"')
        if len(expected)!=64:raise RuntimeError('Missing official model checksum')
        files=list(Path(f'data/models/{folder}/.cache/huggingface/download').glob('*.incomplete'))
        resume=max(files,key=lambda p:p.stat().st_size) if files else None
        download(url,f'data/models/{folder}/{name}',expected,resume)
