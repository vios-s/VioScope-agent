export type ReviewVerdict = 'CLEARED' | 'CONDITIONAL' | 'SLIDE';
export type ReviewSignoffStatus = 'pending' | 'accepted' | 'needs_revision' | 'rejected';

export type ReviewFinding = {
  area: string;
  status: 'pass' | 'partial' | 'fail' | 'missing' | 'conditional';
  evidence: string[];
  gap: string;
  requiredAction: string;
};

export type ReviewMitigation = {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  risk: string;
  action: string;
  owner: string;
  due: string;
  evidenceNeeded: string;
};

export type ReviewResult = {
  report: string;
  structured: {
    verdict: ReviewVerdict;
    summary: string;
    appliedSkills: Array<{
      name: string;
      version: string;
      sourcePath: string;
    }>;
    findings: ReviewFinding[];
    reasonsToReject: string[];
    checkmateQuestions: string[];
    mitigations: ReviewMitigation[];
    humanSignOff: {
      leadPdra: string;
      piOrOrganizer: string;
      remainingEvidenceNeeded: string[];
    };
    perSkillNotes: Array<{
      skill: string;
      notes: string[];
    }>;
  };
  draftName: string;
  draftTruncated: boolean;
  draftChars: number;
  finishReason: string;
};

export type ReviewRunSummary = {
  id: string;
  projectName: string | null;
  draftName: string;
  targetVenue: string | null;
  deadline: string | null;
  initiator: string | null;
  piOrSeniorReviewer: string | null;
  cooperators: string[];
  reviewer: string | null;
  createdAt: string;
  updatedAt: string;
  checkCount: number;
  verdicts: ReviewVerdict[];
  signoffStatuses: ReviewSignoffStatus[];
};

export type ReviewCheckRecord = {
  id: string;
  skillName: string;
  skillLabel: string;
  verdict: ReviewVerdict;
  reportMarkdown: string;
  resultJson: ReviewResult;
  signoffStatus: ReviewSignoffStatus;
  reviewerNote: string;
  signedOffBy: string | null;
  signedOffAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRunRecord = Omit<ReviewRunSummary, 'checkCount' | 'verdicts' | 'signoffStatuses'> & {
  metadata: Record<string, unknown>;
  checks: ReviewCheckRecord[];
};
