export const LIVERY_ORIGIN='https://livery.airline-simulator.com';
export function parseMobileSession(text){
 if(typeof text!=='string'||text.length>100000)throw new Error('授权文件无效或过大');
 let input;try{input=JSON.parse(text);}catch{throw new Error('请选择手机授权工具生成的 JSON 文件');}
 if(input?.schema!=='polaris-aocc-mobile-session/1'||input.origin!==LIVERY_ORIGIN)throw new Error('此文件不是手机授权工具生成的会话');
 const session=input.session;
 if(!session||typeof session.access_token!=='string'||session.access_token.length>16000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.access_token)||typeof session.refresh_token!=='string'||session.refresh_token.length<10||session.refresh_token.length>8192||/\s/.test(session.refresh_token))throw new Error('授权会话不完整，请在官方页面重新登录后导出');
 return {accessToken:session.access_token,refreshToken:session.refresh_token,intervalSeconds:60};
}
// Runs only when the user invokes their bookmark on the official game website.
// No transmission, custom redirects, clipboard tokens, or account metadata.
export const MOBILE_BOOKMARKLET='javascript:'+encodeURIComponent(`(()=>{if(location.origin!=='${LIVERY_ORIGIN}'){alert('请先打开官方涂装编辑器并登录');return}try{const s=JSON.parse(localStorage.getItem('sb-auth-auth-token')||'null');if(!s?.access_token||!s?.refresh_token){alert('请先完成官方 Google 登录');return}const b=new Blob([JSON.stringify({schema:'polaris-aocc-mobile-session/1',origin:location.origin,session:{access_token:s.access_token,refresh_token:s.refresh_token}})],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='aocc-phone-session.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000)}catch{alert('授权导出未完成，请刷新官方页面后重试')}})()`);
