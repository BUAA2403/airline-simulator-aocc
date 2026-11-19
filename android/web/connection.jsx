import React,{useState} from 'react';
import {Smartphone,ExternalLink,Copy,FileKey,ShieldCheck} from 'lucide-react';
import {MOBILE_BOOKMARKLET,parseMobileSession,LIVERY_ORIGIN} from './session.mjs';
export function AndroidConnectionPanel({busy,run,notify}){
 const [copied,setCopied]=useState(false);
 const copy=()=>{window.PolarisNative.copyText(MOBILE_BOOKMARKLET);setCopied(true);notify('已复制授权工具，请粘贴到手机浏览器书签的网址栏。');};
 const connect=()=>run('phone-connect',async()=>{
  const text=await window.polarisMobile.chooseSession();if(text===null)return;
  const config=parseMobileSession(text);
  const response=await fetch('/api/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||result.connection?.message||'连接未完成');
  notify('手机独立连接成功，已加密保存授权。请删除下载目录中的临时授权文件。');
 });
 return <section className="panel bridge-panel phone-connection"><div className="panel-title"><div className="title-with-icon"><Smartphone size={19}/><h2>手机独立连接</h2></div><span className="recommended">无需电脑运行</span></div><div className="bridge-body"><div className="bridge-heading"><div className="bridge-icon"><Smartphone size={26}/></div><div><strong>在手机上授权，一次连接</strong><p>手机直接同步游戏数据，拥有独立的加密会话和历史记录。</p></div></div><ol className="bridge-steps"><li><span>01</span><div><strong>在手机 Chrome 中登录官方页面</strong><p>请在手机上重新登录，建立独立会话。不要使用电脑端导出的会话文件。</p><a className="button secondary official-livery-link" href={LIVERY_ORIGIN} target="_blank" rel="noreferrer">打开官方涂装编辑器<ExternalLink size={14}/></a></div></li><li><span>02</span><div><strong>建立一次性授权书签</strong><p>先收藏官方页面，名称改为「AOCC 授权」。复制下方工具，再编辑该书签，将「网址」完整替换为复制内容。</p><button className="button secondary" onClick={copy}><Copy size={15}/>{copied?'已复制授权工具':'复制手机授权工具'}</button></div></li><li><span>03</span><div><strong>在已登录的官方页面执行授权</strong><p>在浏览器地址栏输入「AOCC 授权」，点选书签结果。浏览器将下载 aocc-phone-session.json。若输入法删除了网址开头的 javascript:，请在编辑书签时补全。</p></div></li><li><span>04</span><div><strong>导入授权，开始独立同步</strong><p>回到这里选择刚才下载的文件。成功后请删除下载目录中的授权文件。</p><button className="button primary" disabled={!!busy} onClick={connect}><FileKey size={16}/>{busy==='phone-connect'?'正在连接…':'选择手机授权文件'}</button></div></li></ol><div className="bridge-safety"><ShieldCheck size={15}/><span>授权只保存在本手机；打开应用时自动同步，离线时保留上次数据。切到后台或关闭应用后，自动同步会暂停。重新登录请沿用上述手机流程。</span></div><p className="phone-help">游戏暂未提供第三方应用直接登录入口。上述书签需由你在官方页面手动执行，不会要求输入 Google 密码到 AOCC。</p></div></section>;
}
