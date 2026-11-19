import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import path from 'node:path';

async function dpapi(value, decrypt = false) {
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $r=[Security.Cryptography.ProtectedData]::${method}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', chunk => out += chunk);
    proc.stderr.resume();
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(Buffer.from(out.trim(), 'base64')) : reject(new Error('无法访问当前 Windows 用户的凭据保管库')));
    proc.stdin.end(Buffer.from(value).toString('base64'));
  });
}

export class Vault {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'session.vault'); this.queue=Promise.resolve(); }
  async key() {
    const p = path.join(this.directory, 'vault.key');
    try { return await readFile(p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const key = randomBytes(32);
    await writeFile(p, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
  save(value) {
    const captured=JSON.parse(JSON.stringify(value));
    this.queue=this.queue.catch(()=>{}).then(()=>this.saveNow(captured));
    return this.queue;
  }
  async saveNow(value) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const plain = Buffer.from(JSON.stringify(value));
    let envelope;
    if (process.platform === 'win32') envelope = { algorithm: 'windows-dpapi', data: (await dpapi(plain)).toString('base64') };
    else {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await this.key(), nonce);
      const data = Buffer.concat([cipher.update(plain), cipher.final()]);
      envelope = { algorithm: 'aes-256-gcm', data: data.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    }
    const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(envelope), { mode: 0o600 });
    await rename(temp, this.file);
    if (process.platform !== 'win32') await chmod(this.file, 0o600);
  }
  async load() {
    let envelope;
    try { envelope = JSON.parse(await readFile(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    if (envelope.algorithm === 'windows-dpapi') return JSON.parse((await dpapi(Buffer.from(envelope.data, 'base64'), true)).toString());
    if (envelope.algorithm !== 'aes-256-gcm') throw new Error('未知的凭据保管库格式');
    const cipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(envelope.nonce, 'base64'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString());
  }
}
