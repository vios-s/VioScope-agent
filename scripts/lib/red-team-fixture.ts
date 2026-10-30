import type {RedTeamInput,RedTeamOutput} from '../../src/mastra/submission/internal-red-team';
export async function fakeRedTeam(input:RedTeamInput) {
  const evidence=[{source:'project:title',quote:input.sources['project:title']}];
  const output:RedTeamOutput={format:'meta-review-v1',summary:['The synthetic paper studies a research question.','The proposed method requires independent validation.','The current evidence leaves important limitations.'],score:null,confidence:1,ratingReason:'Synthetic report for workflow validation, not a scientific rating.',strengths:[1,2,3].map(n=>({title:`Potential strength ${n}`,critique:'The recorded motivation is a starting point for evaluation.',evidence})),reasons:[1,2,3].map(n=>({title:`Evidence gap ${n}`,critique:'The manuscript evidence needs independent verification.',evidence})),questions:['Which baseline is strongest?','Which ablation isolates the contribution?'],revisions:(['writing','experiments','visuals'] as const).map(category=>({category,action:'Verify this category against the manuscript and document the remaining limitations.',evidence}))};
  return {model:'synthetic-red-team',rules:'Synthetic Meta-Review rules',output};
}
export function syntheticPaperPdf() {
  const text='Abstract: We test a module for visual robustness. Introduction: Distribution shift degrades accuracy. Results: Baseline 71 percent, proposed method 74 percent, averaged over three seeds. The module ablation is missing.';
  const stream=`BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
