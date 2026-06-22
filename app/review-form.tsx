'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import type { ReviewResult, ReviewRunRecord, ReviewRunSummary, ReviewSignoffStatus, ReviewVerdict } from './review-types';

type SkillId = 'vios-skeleton-lock' | 'vios-pdra-meta-review' | 'vios-internal-red-team' | 'vios-revision-lock';

type SkillConfig = {
  id: SkillId;
  label: string;
  shortLabel: string;
};

type RunMeta = {
  projectName: string;
  targetVenue: string;
  deadline: string;
  initiator: string;
  piOrSeniorReviewer: string;
  cooperators: string;
  reviewer: string;
};

type SignoffState = {
  signoffStatus: ReviewSignoffStatus;
  reviewerNote: string;
  signedOffBy: string;
};

const reviewSkills: SkillConfig[] = [
  { id: 'vios-skeleton-lock', label: 'Skeleton Lock', shortLabel: 'Skeleton' },
  { id: 'vios-pdra-meta-review', label: 'PDRA Meta Review', shortLabel: 'PDRA' },
  { id: 'vios-internal-red-team', label: 'Internal Red Team', shortLabel: 'Red Team' },
  { id: 'vios-revision-lock', label: 'Revision Lock', shortLabel: 'Revision' },
];

const signoffOptions: Array<{ value: ReviewSignoffStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'needs_revision', label: 'Needs Revision' },
  { value: 'rejected', label: 'Rejected' },
];

const emptyRunMeta: RunMeta = {
  projectName: '',
  targetVenue: '',
  deadline: '',
  initiator: '',
  piOrSeniorReviewer: '',
  cooperators: '',
  reviewer: '',
};

function defaultSignoff(): SignoffState {
  return {
    signoffStatus: 'pending',
    reviewerNote: '',
    signedOffBy: '',
  };
}

function verdictClass(verdict: ReviewVerdict) {
  if (verdict === 'CLEARED') return 'verdict verdict-cleared';
  if (verdict === 'CONDITIONAL') return 'verdict verdict-conditional';
  return 'verdict verdict-slide';
}

function tabVerdictClass(verdict: ReviewVerdict) {
  if (verdict === 'CLEARED') return 'tab-verdict tab-cleared';
  if (verdict === 'CONDITIONAL') return 'tab-verdict tab-conditional';
  return 'tab-verdict tab-slide';
}

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function skillById(skillId: SkillId) {
  return reviewSkills.find((skill) => skill.id === skillId) || reviewSkills[0];
}

function resultDownloadStem(skill: SkillConfig) {
  return `vioscope-${skill.id.replace(/^vios-/, '')}`;
}

function VerdictIcon({ verdict }: { verdict: ReviewVerdict }) {
  return verdict === 'CLEARED' ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />;
}

function cooperatorsArray(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function checkedSkillIds(results: Partial<Record<SkillId, ReviewResult>>): SkillId[] {
  return reviewSkills.map((skill) => skill.id).filter((skillId) => Boolean(results[skillId]));
}

export function ReviewForm({ embedded = false, canSignOff = true }: { embedded?: boolean; canSignOff?: boolean } = {}) {
  const [activeSkillId, setActiveSkillId] = useState<SkillId>('vios-skeleton-lock');
  const [results, setResults] = useState<Partial<Record<SkillId, ReviewResult>>>({});
  const [signoffs, setSignoffs] = useState<Partial<Record<SkillId, SignoffState>>>({});
  const [errors, setErrors] = useState<Partial<Record<SkillId, string>>>({});
  const [busySkillId, setBusySkillId] = useState<SkillId | 'all' | null>(null);
  const [fileName, setFileName] = useState('');
  const [runMeta, setRunMeta] = useState<RunMeta>(emptyRunMeta);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReviewRunSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const activeSkill = skillById(activeSkillId);
  const activeResult = results[activeSkillId] || null;
  const activeError = errors[activeSkillId] || null;
  const activeSignoff = signoffs[activeSkillId] || defaultSignoff();
  const completedSkillIds = checkedSkillIds(results);
  const isBusy = busySkillId !== null || saving || Boolean(loadingRunId);

  const completion = useMemo(
    () => ({ completed: completedSkillIds.length, total: reviewSkills.length }),
    [completedSkillIds.length],
  );

  useEffect(() => {
    void loadHistory();
  }, []);

  async function loadHistory() {
    try {
      setHistoryError(null);
      const response = await fetch('/api/review-runs?limit=8');
      const payload = (await response.json()) as { runs?: ReviewRunSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Could not load review history.');
      }
      setHistory(payload.runs || []);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : 'Could not load review history.');
    }
  }

  function setMetaField(key: keyof RunMeta, value: string) {
    setRunMeta((current) => ({ ...current, [key]: value }));
  }

  async function requestReview(skillId: SkillId): Promise<ReviewResult> {
    if (!formRef.current) {
      throw new Error('Review form is not ready.');
    }

    const formData = new FormData(formRef.current);
    formData.delete('skills');
    formData.append('skills', skillId);

    const response = await fetch('/api/submission-review', {
      method: 'POST',
      body: formData,
    });
    const payload = (await response.json()) as ReviewResult | { error?: string };

    if (!response.ok) {
      throw new Error('error' in payload && payload.error ? payload.error : 'Review failed.');
    }

    return payload as ReviewResult;
  }

  async function runSkill(skillId: SkillId) {
    setBusySkillId(skillId);
    setStatusMessage(null);
    setErrors((current) => ({ ...current, [skillId]: undefined }));

    try {
      const result = await requestReview(skillId);
      setResults((current) => ({ ...current, [skillId]: result }));
      setSignoffs((current) => ({ ...current, [skillId]: current[skillId] || defaultSignoff() }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [skillId]: caught instanceof Error ? caught.message : 'Review failed.',
      }));
    } finally {
      setBusySkillId(null);
    }
  }

  async function runAllSkills() {
    setBusySkillId('all');
    setStatusMessage(null);
    setErrors({});
    let runningSkillId: SkillId = reviewSkills[0].id;

    try {
      for (const skill of reviewSkills) {
        runningSkillId = skill.id;
        setActiveSkillId(skill.id);
        setBusySkillId(skill.id);
        const result = await requestReview(skill.id);
        setResults((current) => ({ ...current, [skill.id]: result }));
        setSignoffs((current) => ({ ...current, [skill.id]: current[skill.id] || defaultSignoff() }));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Review failed.';
      setErrors((current) => ({ ...current, [runningSkillId]: message }));
      setActiveSkillId(runningSkillId);
    } finally {
      setBusySkillId(null);
    }
  }

  function resetForm() {
    formRef.current?.reset();
    setFileName('');
    setResults({});
    setSignoffs({});
    setErrors({});
    setRunMeta(emptyRunMeta);
    setCurrentRunId(null);
    setActiveSkillId('vios-skeleton-lock');
    setBusySkillId(null);
    setStatusMessage(null);
  }

  function clearDraftReviewState() {
    setResults({});
    setSignoffs({});
    setErrors({});
    setCurrentRunId(null);
    setStatusMessage(null);
  }

  function buildSavePayload() {
    const checks = completedSkillIds.map((skillId) => {
      const skill = skillById(skillId);
      const result = results[skillId];
      const signoff = signoffs[skillId] || defaultSignoff();
      if (!result) {
        throw new Error(`No result for ${skill.label}.`);
      }

      return {
        skillName: skill.id,
        skillLabel: skill.label,
        verdict: result.structured.verdict,
        reportMarkdown: result.report,
        resultJson: result,
        ...signoff,
      };
    });

    const firstResult = checks.length ? results[completedSkillIds[0]] : undefined;

    return {
      id: currentRunId || undefined,
      projectName: runMeta.projectName,
      draftName: firstResult?.draftName || fileName || 'inline-draft',
      targetVenue: runMeta.targetVenue,
      deadline: runMeta.deadline,
      initiator: runMeta.initiator,
      piOrSeniorReviewer: runMeta.piOrSeniorReviewer,
      cooperators: cooperatorsArray(runMeta.cooperators),
      reviewer: runMeta.reviewer,
      metadata: {
        source: 'next-review-workbench',
      },
      checks,
    };
  }

  function applyPersistedRun(run: ReviewRunRecord) {
    const nextResults: Partial<Record<SkillId, ReviewResult>> = {};
    const nextSignoffs: Partial<Record<SkillId, SignoffState>> = {};

    for (const check of run.checks) {
      if (reviewSkills.some((skill) => skill.id === check.skillName)) {
        const skillId = check.skillName as SkillId;
        nextResults[skillId] = check.resultJson;
        nextSignoffs[skillId] = {
          signoffStatus: check.signoffStatus,
          reviewerNote: check.reviewerNote,
          signedOffBy: check.signedOffBy || '',
        };
      }
    }

    setCurrentRunId(run.id);
    setResults(nextResults);
    setSignoffs(nextSignoffs);
    setErrors({});
    setRunMeta({
      projectName: run.projectName || '',
      targetVenue: run.targetVenue || '',
      deadline: run.deadline || '',
      initiator: run.initiator || '',
      piOrSeniorReviewer: run.piOrSeniorReviewer || '',
      cooperators: run.cooperators.join(', '),
      reviewer: run.reviewer || '',
    });

    const firstCompleted = reviewSkills.find((skill) => nextResults[skill.id]);
    setActiveSkillId(firstCompleted?.id || 'vios-skeleton-lock');
  }

  async function saveRun() {
    if (!completedSkillIds.length) {
      setStatusMessage('Run at least one check before saving.');
      return;
    }

    setSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/review-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSavePayload()),
      });
      const payload = (await response.json()) as { run?: ReviewRunRecord; error?: string };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error || 'Could not save review run.');
      }

      applyPersistedRun(payload.run);
      await loadHistory();
      setStatusMessage(`Saved review run ${payload.run.id.slice(0, 8)}.`);
    } catch (caught) {
      setStatusMessage(caught instanceof Error ? caught.message : 'Could not save review run.');
    } finally {
      setSaving(false);
    }
  }

  async function openRun(runId: string) {
    setLoadingRunId(runId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/review-runs/${runId}`);
      const payload = (await response.json()) as { run?: ReviewRunRecord; error?: string };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error || 'Could not open review run.');
      }

      applyPersistedRun(payload.run);
      setStatusMessage(`Opened review run ${payload.run.id.slice(0, 8)}.`);
    } catch (caught) {
      setStatusMessage(caught instanceof Error ? caught.message : 'Could not open review run.');
    } finally {
      setLoadingRunId(null);
    }
  }

  async function saveSignoff() {
    if (!currentRunId || !activeResult) {
      setStatusMessage('Save the review run before saving sign-off.');
      return;
    }

    setSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/review-runs/${currentRunId}/signoff`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillName: activeSkillId,
          ...activeSignoff,
        }),
      });
      const payload = (await response.json()) as { run?: ReviewRunRecord; error?: string };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error || 'Could not save sign-off.');
      }

      applyPersistedRun(payload.run);
      await loadHistory();
      setStatusMessage(`Saved ${activeSkill.label} sign-off.`);
    } catch (caught) {
      setStatusMessage(caught instanceof Error ? caught.message : 'Could not save sign-off.');
    } finally {
      setSaving(false);
    }
  }

  function updateActiveSignoff(patch: Partial<SignoffState>) {
    setSignoffs((current) => ({
      ...current,
      [activeSkillId]: {
        ...(current[activeSkillId] || defaultSignoff()),
        ...patch,
      },
    }));
  }

  function downloadCurrentMarkdown() {
    if (!activeResult) return;
    downloadText(`${resultDownloadStem(activeSkill)}.md`, activeResult.report, 'text/markdown;charset=utf-8');
  }

  function downloadCurrentJson() {
    if (!activeResult) return;
    downloadText(`${resultDownloadStem(activeSkill)}.json`, `${JSON.stringify(activeResult, null, 2)}\n`, 'application/json');
  }

  function downloadBundleJson() {
    const bundle = reviewSkills.reduce<Record<string, ReviewResult>>((accumulator, skill) => {
      const result = results[skill.id];
      if (result) {
        accumulator[skill.id] = result;
      }
      return accumulator;
    }, {});

    downloadText('vioscope-b2-review-tabs.json', `${JSON.stringify(bundle, null, 2)}\n`, 'application/json');
  }

  const content = (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">VioScope</div>
          <h1>B2 Review Workbench</h1>
        </div>
        <div className="status-pill">
          <ClipboardList aria-hidden="true" />
          {completion.completed}/{completion.total}
        </div>
      </header>

      <section className="workspace">
        <form ref={formRef} className="input-panel">
          <div className="panel-heading">
            <FileText aria-hidden="true" />
            <h2>Draft</h2>
          </div>

          <label className="file-drop">
            <input
              name="draftFile"
              type="file"
              accept=".md,.markdown,.txt,.tex,.latex,.rst,.pptx"
              onChange={(event) => {
                setFileName(event.currentTarget.files?.[0]?.name || '');
                clearDraftReviewState();
              }}
            />
            <Upload aria-hidden="true" />
            <span>{fileName || 'Select draft or deck'}</span>
          </label>

          <label className="field">
            <span>Paste Draft</span>
            <textarea name="draftText" rows={10} placeholder="Optional if a file is selected" onChange={clearDraftReviewState} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Project</span>
              <input value={runMeta.projectName} onChange={(event) => setMetaField('projectName', event.target.value)} />
            </label>
            <label className="field">
              <span>Target</span>
              <input
                name="targetVenue"
                value={runMeta.targetVenue}
                onChange={(event) => setMetaField('targetVenue', event.target.value)}
                placeholder="Venue or journal"
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Deadline</span>
              <input
                name="deadline"
                value={runMeta.deadline}
                onChange={(event) => setMetaField('deadline', event.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>Initiator</span>
              <input value={runMeta.initiator} onChange={(event) => setMetaField('initiator', event.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>PI / Senior</span>
              <input
                value={runMeta.piOrSeniorReviewer}
                onChange={(event) => setMetaField('piOrSeniorReviewer', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Reviewer</span>
              <input value={runMeta.reviewer} onChange={(event) => setMetaField('reviewer', event.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Cooperators</span>
            <input
              value={runMeta.cooperators}
              onChange={(event) => setMetaField('cooperators', event.target.value)}
              placeholder="Comma-separated names"
            />
          </label>

          <div className="field-row compact">
            <label className="field">
              <span>Draft Chars</span>
              <input name="maxDraftChars" type="number" min="1000" step="1000" placeholder="60000" />
            </label>
            <label className="field">
              <span>Output Tokens</span>
              <input name="maxOutputTokens" type="number" min="2500" step="500" placeholder="5000" />
            </label>
          </div>

          <div className="action-row">
            <button className="primary-button" type="button" disabled={isBusy} onClick={() => runSkill(activeSkillId)}>
              {busySkillId === activeSkillId ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{busySkillId === activeSkillId ? 'Running' : 'Run This Check'}</span>
            </button>
            <button className="ghost-button" type="button" onClick={runAllSkills} disabled={isBusy}>
              {busySkillId === 'all' ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              Run All
            </button>
            <button className="ghost-button" type="button" onClick={saveRun} disabled={isBusy || !completedSkillIds.length}>
              {saving ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              Save Run
            </button>
            <button className="ghost-button" type="button" onClick={resetForm} disabled={isBusy}>
              <RotateCcw aria-hidden="true" />
              Reset
            </button>
          </div>

          {statusMessage && <div className="notice inline">{statusMessage}</div>}

          <section className="history-block">
            <div className="history-heading">
              <h2>History</h2>
              <button className="tiny-button" type="button" onClick={loadHistory} disabled={isBusy}>
                Refresh
              </button>
            </div>
            {historyError && <div className="notice error compact-notice">{historyError}</div>}
            <div className="history-list">
              {history.length ? (
                history.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`history-item${currentRunId === run.id ? ' history-active' : ''}`}
                    onClick={() => openRun(run.id)}
                    disabled={isBusy}
                  >
                    <span>{run.projectName || run.draftName}</span>
                    <small>
                      {run.checkCount}/4 checks · {formatDate(run.updatedAt)}
                    </small>
                  </button>
                ))
              ) : (
                <div className="history-empty">No saved runs</div>
              )}
            </div>
          </section>
        </form>

        <section className="result-panel">
          <div className="panel-heading result-heading">
            <div>
              <ClipboardList aria-hidden="true" />
              <h2>{activeSkill.label}</h2>
            </div>
            <div className="download-row">
              <button
                type="button"
                className="icon-button"
                title="Download current Markdown"
                aria-label="Download current Markdown"
                onClick={downloadCurrentMarkdown}
                disabled={!activeResult}
              >
                <Download aria-hidden="true" />
                <span>MD</span>
              </button>
              <button
                type="button"
                className="icon-button"
                title="Download current JSON"
                aria-label="Download current JSON"
                onClick={downloadCurrentJson}
                disabled={!activeResult}
              >
                <Download aria-hidden="true" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                className="icon-button"
                title="Download all completed JSON"
                aria-label="Download all completed JSON"
                onClick={downloadBundleJson}
                disabled={completion.completed === 0}
              >
                <Download aria-hidden="true" />
                <span>ALL</span>
              </button>
            </div>
          </div>

          <div className="check-tabs" role="tablist" aria-label="B2 checks">
            {reviewSkills.map((skill) => {
              const result = results[skill.id];
              const hasError = Boolean(errors[skill.id]);
              const selected = activeSkillId === skill.id;
              const running = busySkillId === skill.id;
              const signoff = signoffs[skill.id];

              return (
                <button
                  key={skill.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`tab-button${selected ? ' tab-active' : ''}${hasError ? ' tab-error' : ''}`}
                  onClick={() => setActiveSkillId(skill.id)}
                  disabled={busySkillId === 'all'}
                >
                  <span>{skill.shortLabel}</span>
                  {running && <Loader2 className="spin" aria-hidden="true" />}
                  {!running && result && <span className={tabVerdictClass(result.structured.verdict)}>{result.structured.verdict}</span>}
                  {!running && hasError && <span className="tab-verdict tab-error-pill">Error</span>}
                  {!running && result && signoff?.signoffStatus !== 'pending' && (
                    <span className="tab-verdict tab-signed">{signoff?.signoffStatus.replace('_', ' ')}</span>
                  )}
                </button>
              );
            })}
          </div>

          {activeError && (
            <div className="notice error">
              <AlertTriangle aria-hidden="true" />
              <span>{activeError}</span>
            </div>
          )}

          {!activeResult && !activeError && (
            <div className="empty-state">
              {busySkillId === activeSkillId ? <Loader2 className="spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
              <span>{busySkillId === activeSkillId ? 'Running check' : 'No result for this check'}</span>
            </div>
          )}

          {activeResult && (
            <div className="result-stack">
              <div className="verdict-row">
                <div className={verdictClass(activeResult.structured.verdict)}>
                  <VerdictIcon verdict={activeResult.structured.verdict} />
                  <span>{activeResult.structured.verdict}</span>
                </div>
                <div className="metric-strip compact-strip">
                  <span>Draft: {activeResult.draftName}</span>
                  <span>Chars: {activeResult.draftChars.toLocaleString()}</span>
                  <span>{activeResult.draftTruncated ? 'Truncated' : 'Full'}</span>
                </div>
              </div>

              <p className="summary">{activeResult.structured.summary}</p>

              <section className="section-block signoff-block">
                <h3>Human Sign-Off</h3>
                <div className="signoff-controls">
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={activeSignoff.signoffStatus}
                      disabled={!canSignOff}
                      onChange={(event) =>
                        updateActiveSignoff({ signoffStatus: event.target.value as ReviewSignoffStatus })
                      }
                    >
                      {signoffOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Signed By</span>
                    <input
                      value={activeSignoff.signedOffBy}
                      disabled={!canSignOff}
                      onChange={(event) => updateActiveSignoff({ signedOffBy: event.target.value })}
                      placeholder={runMeta.reviewer || 'Name'}
                    />
                  </label>
                  <label className="field signoff-note">
                    <span>Reviewer Note</span>
                    <textarea
                      value={activeSignoff.reviewerNote}
                      disabled={!canSignOff}
                      onChange={(event) => updateActiveSignoff({ reviewerNote: event.target.value })}
                      rows={3}
                    />
                  </label>
                  <button className="ghost-button signoff-button" type="button" onClick={saveSignoff} disabled={!canSignOff || isBusy || !currentRunId}>
                    <Save aria-hidden="true" />
                    Save Sign-Off
                  </button>
                </div>
              </section>

              <section className="section-block">
                <h3>Findings</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Status</th>
                        <th>Evidence</th>
                        <th>Required Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.structured.findings.map((finding) => (
                        <tr key={`${finding.area}-${finding.status}`}>
                          <td>{finding.area}</td>
                          <td>
                            <span className={`status status-${finding.status}`}>{finding.status}</span>
                          </td>
                          <td>{finding.evidence.join(', ') || 'missing'}</td>
                          <td>{finding.requiredAction}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="section-block split-block">
                <div>
                  <h3>Reasons To Reject</h3>
                  <ol className="tight-list">
                    {activeResult.structured.reasonsToReject.length ? (
                      activeResult.structured.reasonsToReject.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>None identified.</li>
                    )}
                  </ol>
                </div>
                <div>
                  <h3>Checkmate Questions</h3>
                  <ol className="tight-list">
                    {activeResult.structured.checkmateQuestions.length ? (
                      activeResult.structured.checkmateQuestions.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>None identified.</li>
                    )}
                  </ol>
                </div>
              </section>

              <section className="section-block">
                <h3>Mitigations</h3>
                <div className="mitigation-grid">
                  {activeResult.structured.mitigations.map((item) => (
                    <article className="mitigation-item" key={`${item.priority}-${item.risk}`}>
                      <strong>{item.priority}</strong>
                      <span>{item.risk}</span>
                      <p>{item.action}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </section>
    </>
  );

  return embedded ? <div className="shell review-embedded">{content}</div> : <main className="shell">{content}</main>;
}
