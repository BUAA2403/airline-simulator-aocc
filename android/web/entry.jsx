import {installMobileRuntime} from './runtime.mjs';
async function start(){
 if(!window.PolarisNative){document.getElementById('root').textContent='请在 Airline Simulator AOCC 安卓应用中打开。';return;}
 await installMobileRuntime();
 await import('../../web/main.jsx');
 await import('./mobile.css');
}
start().catch(()=>{document.getElementById('root').textContent='手机工作区启动失败。请关闭并重新打开应用；请保留应用数据。';});
