'use client';
import {useEffect,useState} from 'react';
import {requestJson} from './client-request';
import {formatDayTime} from './format';
import type {ReviewRound} from '../src/mastra/submission/internal-review';
export function RedTeamPanel({projectId,round,canRun,onRefresh}:{projectId:string;round:ReviewRound&{current:boolean};canRun:boolean;onRefresh:()=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
  const ai=round.data.redTeam,report=ai?.reports.find(r=>r.id===selected)||ai?.reports.at(-1);
  const running=!!ai&&['pending','running'].includes(ai.status)&&Date.now()-Date.parse(ai.startedAt)<180000;
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>{void onRefresh().catch(()=>{});},4000);return()=>clearInterval(timer);},[running,onRefresh]);
  async function run(){setBusy(true);setError('');try{await requestJson(`/api/projects/${projectId}/internal-review/red-team`,'Could not run the AI review.',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roundId:round.id})});await onRefresh();setSelected('');}catch(e){setError(e instanceof Error?e.message:'Could not run the AI review.');}finally{setBusy(false);}}
  return <section className="ir-card ir-ai" aria-label="AI Internal Red-Team">
    <h3>AI Internal Red-Team</h3><p className="checklist-hint">Advisory manuscript review; PDRA review and human clearance remain required.</p>
    {running&&<p role="status">AI reviewing… Round saved; human review can continue.</p>}
    {ai?.status==='failed'&&<p className="ops-notice error" role="alert">{ai.error}</p>}
    {!report&&!running&&ai?.status!=='failed'&&<p>No AI report is available for this round.</p>}
    {round.current&&canRun&&<button className="ops-secondary" type="button" disabled={busy||running} onClick={()=>void run()}>{busy?'Reviewing…':report?'Run a fresh AI review':running?'AI review running…':'Run AI review'}</button>}
    {error&&<p className="ops-notice error" role="alert">{error}</p>}
    {report&&<>
      <p className="checklist-hint">Saved {formatDayTime(report.at)} · {report.model} · Project changes require a fresh report.</p>
      {(ai?.reports.length||0)>1&&<label>AI report history<select value={report.id} onChange={e=>setSelected(e.target.value)}>{ai!.reports.map((r,i)=><option key={r.id} value={r.id}>Report {i+1} · {formatDayTime(r.at)}</option>)}</select></label>}
      {'format' in report.output ? <>
        <p className="checklist-hint">Project: {report.input.sources['project:title']} · Lead: {report.input.lead?`@${report.input.lead}`:'Not recorded'} · Internal reviewer: AI (advisory)</p>
        <MetaHeading number="01" title="Summary & Contribution"/><p className="ir-prose">{report.output.summary.join(' ')}</p>
        <MetaHeading number="02" title="The Likely Rating"/><p><strong>{report.output.score===null?'Not rated — insufficient evidence':`${report.output.score} / 10`}</strong> · Confidence: {report.output.confidence} / 5</p><p className="ir-prose">{report.output.ratingReason}</p>
        <MetaHeading number="03" title="Primary Strengths — Reasons to Accept"/><Findings items={report.output.strengths}/>
        <MetaHeading number="04" title="Primary Weaknesses — Reasons to Reject"/><Findings items={report.output.reasons}/>
        <MetaHeading number="05" title="The Checkmate Questions"/><ol>{report.output.questions.map((q,i)=><li className="ir-prose" key={i}>{q}</li>)}</ol>
        <MetaHeading number="06" title="Required Revisions — Revision Lock Plan"/><p className="checklist-hint">Proposals for the next 14 days. The PDRA decides which changes become required project tasks.</p>
        {report.output.revisions.map(r=><article key={r.category}><h4>{({writing:'Writing',experiments:'Experiments',visuals:'Visuals'})[r.category]}</h4><p className="ir-prose">{r.action}</p><Citations evidence={r.evidence}/></article>)}
      </> : <>
        <p className="checklist-hint">Legacy Red-Team format. Run a fresh review for the Internal Meta-Review Template.</p>
        <details open><summary>Summary of Rejection</summary>{report.output.summary.map((p,i)=><p className="ir-prose" key={i}>{p}</p>)}</details>
        <details open><summary>Top 3 Reasons to Reject</summary><Findings items={report.output.reasons}/></details>
        <details open><summary>Killer Questions</summary><ol>{report.output.questions.map((q,i)=><li className="ir-prose" key={i}>{q}</li>)}</ol></details>
      </>}
      <details><summary>Input data and review scope</summary><p>Conference target: {report.input.venue} · Manuscript: {report.input.manuscript}</p><ul>{report.input.limitations.map((p,i)=><li key={i}>{p}</li>)}</ul>{Object.entries(report.input.sources).map(([key,value])=><details key={key}><summary>{key}</summary><p className="ir-prose">{value}</p></details>)}<details><summary>Applied review rules</summary><pre className="ir-prose">{report.rules}</pre></details></details>
    </>}
  </section>;
}

function MetaHeading({number,title}:{number:string;title:string}) {return <div className="checklist-block-head"><span className="checklist-block-num" aria-hidden="true">{number}</span><h4>{title}</h4></div>;}
function Citations({evidence}:{evidence:{source:string;quote:string}[]}) {return <>{evidence.map((e,j)=><blockquote key={j}><p className="ir-prose">{e.quote}</p><cite>{e.source}</cite></blockquote>)}</>;}
function Findings({items}:{items:{title:string;critique:string;evidence:{source:string;quote:string}[]}[]}) {return <ol>{items.map((r,i)=><li key={i}><h4>{r.title}</h4><p className="ir-prose">{r.critique}</p><Citations evidence={r.evidence}/></li>)}</ol>;}
