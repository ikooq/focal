from pathlib import Path
import httpx, hashlib, zipfile
version = '44.2.0'
name = f'electron-v{version}-win32-x64.zip'
base = f'https://github.com/electron/electron/releases/download/v{version}/'
target = Path('data') / name
with httpx.Client(follow_redirects=True, timeout=60) as client:
    checks = client.get(base + 'SHASUMS256.txt'); checks.raise_for_status()
    expected = next(line.split()[0] for line in checks.text.splitlines() if line.split()[-1].lstrip('*') == name)
    with client.stream('GET', base + name) as response:
        response.raise_for_status()
        with target.open('wb') as output:
            for chunk in response.iter_bytes(1024 * 1024): output.write(chunk)
assert hashlib.sha256(target.read_bytes()).hexdigest() == expected, 'Electron checksum mismatch'
folder = Path('node_modules/electron/dist'); folder.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target) as archive: archive.extractall(folder)
Path('node_modules/electron/path.txt').write_text('electron.exe', encoding='utf-8')
print('Electron 44.2.0 installed; official SHA-256 verified.', flush=True)
