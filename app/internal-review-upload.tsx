'use client';
import {useId,useState,type FormEvent} from 'react';
import {requestJson} from './client-request';
export function ReviewPdfUpload({projectId,submissionId,previousRoundId,onSaved}:{projectId:string;submissionId:string;previousRoundId:string|null;onSaved:(id:string)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const hint=useId();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form),file=data.get('pdf');setError('');
    if(!(file instanceof File)||!file.size||file.size>5*1024*1024||!file.name.toLowerCase().endsWith('.pdf')){setError('Choose a non-empty PDF of at most 5 MB.');return;}
    data.set('submissionId',submissionId);data.set('previousRoundId',previousRoundId||'');setBusy(true);
    try{const result=await requestJson<{roundId:string}>(`/api/projects/${projectId}/internal-review/manuscript`,'Could not upload the manuscript.',{method:'POST',body:data});await onSaved(result.roundId);form.reset();}
    catch(e){setError(e instanceof Error?e.message:'Could not upload the manuscript.');}finally{setBusy(false);}
  }
  return <details className="checklist-import ir-pdf-upload" open={!previousRoundId}><summary>Upload a manuscript PDF</summary>
    <p className="checklist-hint" id={hint}>Text-based PDF, up to 5 MB. Saves to project materials and evidence, starts a new review round and runs AI review.</p>
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}>
      <label>Manuscript version label<input name="label" required maxLength={200} placeholder="Manuscript v1"/></label>
      <label>Manuscript PDF<input name="pdf" type="file" accept=".pdf,application/pdf" required aria-describedby={hint}/></label>
      <label className="checklist-confirm"><input name="confirmed" type="checkbox" required value="true"/>I confirm this manuscript version and start a new review round.</label>
      {error&&<p className="ops-notice error" role="alert">{error}</p>}
      <button className="ops-primary" type="submit">{busy?'Uploading…':'Upload PDF and start review'}</button>
    </fieldset></form>
  </details>;
}
