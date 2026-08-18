# Software design review

Date: 2026-08-18
Reviewed on: `dev`; release target: `main`
Reference: [A Philosophy of Software Design, Second Edition (Chinese translation)](https://yingang.github.io/aposd2e-zh/)

## Review standard

The review treats complexity as change amplification, cognitive load, and unknown unknowns. It favors deep modules, information hiding, explicit trust boundaries, consistent conventions, and small continuous design investments. File or function length alone is not considered a defect.

## Findings

| Priority | Status | Evidence | Design response |
| --- | --- | --- | --- |
| P1 | Fixed | `check:projects` depended on June 2026 fixture dates and failed once the 14-day planning window moved past them. | The integration check now derives lifecycle dates from the current UTC day, keeping the production clock behavior while making the check repeatable. |
| P1 | Fixed | Both project create and update routes duplicated the same request parser. TODO `done` used `Boolean(value)`, so the invalid string `"false"` became `true`. | `src/mastra/projects/input.ts` is the single write-boundary parser. It rejects ambiguous boolean and username-list values before business logic runs. |
| P1 | Fixed | Live chat and memory checks hardcoded stable port 3000, which prevented isolated test-port validation and could target the wrong deployment. | Both checks now use `VIOSCOPE_BASE_URL`; `.env.example` documents the boundary. |
| P2 | Fixed | 33 API route files implemented the same error JSON serializer and repeated `AuthError` status selection at each call site. | `src/mastra/http/error-response.ts` owns the response shape and authentication-status rule. Routes provide only the context-specific fallback status. |
| P2 | Fixed | The shared Playwright helper sampled welcome-dialog visibility before asynchronous session loading opened it, so the dialog intermittently blocked later clicks. | The helper now waits briefly for the dialog and closes it through its accessible control. Project and theme-meeting UI checks pass through the shared path. |
| P2 | Open | `app/operations-console.tsx` is 8,559 lines; its largest components are `UsersView` (1,021), `ProjectDetailModal` (856), `ThemeMeetingPanel` (546), and `ChatView` (544). | Extract by domain only when the extracted module can hide state or protocol knowledge. Splitting solely to shorten the file would create shallow modules and more navigation. |
| P2 | Fixed | `operations-console.tsx` and `review-form.tsx` contained 55 `fetch` calls and 54 local JSON parses with repeated fallback-error handling. | `app/client-request.ts` now owns network failure normalization, JSON parsing, API error extraction, and HTTP status metadata. All JSON workflows use its single interface; only best-effort logout keeps a direct `fetch`. |
| P3 | Accepted | Database modules such as `projects.ts` and `users.ts` are large. | They currently expose comparatively narrow domain APIs and hide SQL/schema details. Decompose only when a concrete change crosses unrelated responsibilities or tests show excessive coupling. |

## Design alternatives considered

1. Split the large React console immediately. This reduces file size but does not by itself reduce knowledge required for a change, and it creates a broad UI regression surface.
2. Add a generic validation framework. Zod is already installed, but converting every boundary would be a large migration with little immediate product value.
3. Consolidate the two demonstrated sources of change amplification and strengthen the existing integration check. This was selected because it removes duplicated policy, fixes observable behavior, and stays inside the current project-management/theme-meeting roadmap.

## Review gate for future changes

- Identify the information or policy the module hides; do not add pass-through wrappers.
- Keep validation at external boundaries and reject ambiguous values instead of coercing them.
- Put each cross-route policy in one place, with context-specific choices left to the caller.
- Make time-window checks relative to an explicit clock or to the test run date.
- Require one focused runnable check for each non-trivial branch or parser change.
- Prefer deleting duplicated knowledge over introducing a new abstraction layer.

## Verification

The reviewed change set passes TypeScript checking, the production Next.js build, the focused client-request check, the local API regression checks, and the Project, Theme Meeting, and Release Playwright checks. The final production build is running from the `dev` worktree on port 9999: HTTP readiness, unauthenticated API handling, live chat with cited sources, session memory, personal-memory isolation, and shared-chat memory boundaries all pass against that deployed instance.
