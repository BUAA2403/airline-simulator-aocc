import React,{useState} from 'react';
import {Download,LoaderCircle,FileText,ArrowUpRight} from 'lucide-react';
import './analysis-export.css';
export function AnalysisExportButton({disabled=false,onError=()=>{},tool=false}){
 const [busy,setBusy]=useState(false);
 const download=async()=>{
  if(busy||disabled)return;setBusy(true);
  try{
   const response=await fetch('/api/analysis-export',{cache:'no-store'});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'导出未完成，请稍后重试。');}
   const blob=await response.blob(),filename=response.headers.get('Content-Disposition')?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1]||'AOCC-AI-analysis.md';
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(error){onError(error.message,true);}finally{setBusy(false);}
 };
 return <button className={tool?'data-tool ai-export-tool':'button secondary ai-export-button'} disabled={disabled||busy} onClick={download} aria-busy={busy} title="下载单个 Markdown 文件，包含分析指引、完整业务明细和已保留历史">
  {tool?<><span className="tool-icon"><FileText size={18}/></span><span><strong>{busy?'正在整理分析资料…':'导出 AI 分析包'}</strong><small>单个文件 · 机队 / 航线 / 班表 / 经营 / 历史</small></span><ArrowUpRight size={16}/></>:<>{busy?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>}<span>{busy?'正在整理…':'导出 AI 分析包'}</span></>}
 </button>;
}
export function AnalysisExportIntro(){return <section className="panel ai-analysis-intro"><span className="ai-analysis-icon"><FileText size={21}/></span><div><h2>把完整经营资料交给 AI</h2><p>点击右上角「导出 AI 分析包」，将下载的一个文件直接上传给 AI。内含分析指引、数据口径、明细和历史变化。</p></div><span className="ai-format-label">单文件 · .md</span></section>;}
