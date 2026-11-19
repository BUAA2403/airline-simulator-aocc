import {defineConfig} from 'vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
// Adapt platform boundaries only in the Android build. Desktop sources stay intact.
export default defineConfig({
 root:path.join(here,'web'),publicDir:path.join(root,'public'),base:'/',
 build:{outDir:path.join(here,'web-dist'),emptyOutDir:true,target:'chrome110'},
 plugins:[{
  name:'android-platform',enforce:'pre',
  resolveId(id){if(id==='node:crypto')return path.join(here,'web/crypto.mjs');if(id==='node:timers/promises')return path.join(here,'web/timers.mjs');},
  transform(code,id){
   const file=id.replaceAll('\\','/');
   if(file.endsWith('/server/game-normalize.mjs')||file.endsWith('/server/cabin.mjs')){
    let n=0;const imports=[];
    code=code.replace(/import\s*\{\s*readFileSync\s*\}\s*from\s*'node:fs';?\s*/,'');
    code=code.replace(/JSON\.parse\(readFileSync\(new URL\('([^']+)',\s*import\.meta\.url\),\s*'utf8'\)\)/g,(_,name)=>{const variable=`androidReference${n++}`;imports.push(`import ${variable} from '${name}';`);return variable;});
    return imports.join('\n')+'\n'+code;
   }
   if(file.endsWith('/server/adapter.mjs'))return code.replace("Buffer.from((token||'').split('.')[1],'base64url').toString()","atob((token||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))");
   if(file.endsWith('/web/main.jsx')&&!file.includes('/android/')){
    const begin=code.indexOf('function PairingPanel('),end=code.indexOf('\nfunction ConnectionView(',begin);
    if(begin<0||end<0)throw new Error('Android connection integration needs review: desktop component changed');
    code=code.slice(0,begin)+`function PairingPanel(props){return <AndroidConnectionPanel {...props}/>;}\n`+code.slice(end);
    return `import {AndroidConnectionPanel} from ${JSON.stringify(path.join(here,'web/connection.jsx').replaceAll('\\','/'))};\n`+code.replaceAll('无法连接本地数据服务','无法读取手机数据').replaceAll('本机数据服务','手机独立数据服务').replaceAll('本机历史','手机历史').replaceAll('本机加密','手机加密');
   }
  }
 }],server:{host:'127.0.0.1',port:5174,fs:{allow:[root]}}
});
