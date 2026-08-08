# Accessibility review -- section 40

- Reviewed: **2026-08-07**, session [13](logs/2026-08-07-13-phase-9-evaluation-and-polish.md)
- Target: WCAG 2.2 AA "where practical", per section 40 of
  `instructions/07_FRONTEND_UX_ACCESSIBILITY.md`
- Method: source audit of every route under `app/`, plus four automated checks
  executed in a real Chromium browser at two viewports
  (`tests/e2e/responsive.spec.ts`)

This is a review, not a certification. What was measured and what was only read
are separated below, because a review that does not distinguish them is worth
about as much as no review.

## How this was checked

| Technique | Coverage | What it can and cannot show |
|---|---|---|
| Automated browser checks | 4 assertions, 2 viewports | Proves the skip link focuses, the live region exists, and neither the sign-in page nor the workspace overflows horizontally. Cannot judge contrast ratios or whether a label reads sensibly |
| Source audit | All routes under `app/`, all of `components/` | Finds missing attributes and unlabelled controls. Cannot prove a control is *reachable* by keyboard in practice |
| Manual keyboard walk | **Not performed** | See "Not assessed" |
| Screen-reader walk | **Not performed** | See "Not assessed" |
| Automated axe/Lighthouse scan | **Not performed** | No axe dependency is installed; adding one is a follow-up |

## Section 40 checklist

| Requirement | Status | Evidence |
|---|---|---|
| Keyboard navigation | **Partial** | All interactive elements are native `button`, `a`, `input`, `select` or `textarea`, so they are in the tab order by construction. No custom widget re-implements a control with `div` plus a click handler, which is the usual source of keyboard traps. Not verified by an actual keyboard walk |
| Visible focus indicators | **Partial** | 17 explicit `focus:` styles, and Tailwind's default ring is not disabled anywhere (`outline-none` appears 0 times without a replacement ring). The skip link's focus visibility is asserted in a browser test. Individual controls not audited one by one |
| Semantic landmarks | **Met** | `AppShell` renders `header`, `nav aria-label="Main"` and `main id="main-content"`. Both signed-in areas render through it |
| Proper labels | **Partial** | 42 form controls, 31 `aria-label`/`htmlFor` bindings. The gap is mostly controls inside a `label` element, which needs no attribute, but this was counted rather than individually verified |
| Accessible dialogs | **Not applicable** | The application renders no modal dialog. `role="dialog"` and `aria-modal` appear 0 times, so there is nothing to get wrong. If a dialog is added later, this row becomes live |
| Accessible form errors | **Met** | Error states use `role="alert"`, including the send failure in the workspace and the scratchpad save failure |
| Sufficient contrast | **Not assessed** | Requires a contrast tool. The palette is Tailwind's defaults on white, which is generally compliant at `gray-700` and darker, but `text-gray-500` on `bg-gray-50` is the kind of pairing that fails and it is used. Recorded as a finding below |
| Reduced motion | **Fixed this session** | Was a real defect: 16 animated elements, no `prefers-reduced-motion` rule anywhere. `app/globals.css` now reduces motion to a single step under the preference |
| Text resizing | **Partial** | Type is set in `rem`-based Tailwind classes, so browser text scaling applies. No layout was tested at 200% zoom |
| Screen-reader announcements for AI loading and completion | **Met** | The conversation is `role="log"` with `aria-live="polite"`, and the loading state is `role="status" aria-live="polite"`. Both asserted in a browser test |
| Alternative text for instructional images | **Met** | Both image usages carry `alt`. The uploaded problem image is described by its extracted text, which is the meaningful alternative |
| No color-only meaning | **Partial** | Safety turns are distinguished by an icon and a heading as well as color; the hint-ladder indicator pairs color with a numeric level. Status badges elsewhere carry text. Not exhaustively audited |
| Accessible mathematics rendering | **Partial** | KaTeX is configured through `rehype-katex`, which emits MathML alongside the visual output, so mathematics is exposed to assistive technology rather than being an image. Not verified with a screen reader |
| Student-configurable larger text, reduced motion, simplified interface, increased spacing, read-aloud, extra time | **Not implemented** | See below |

## Findings

### 1. Reduced motion was unsupported. Fixed.

16 animated elements, mostly `animate-pulse` skeletons and `animate-spin`
indicators, with no `prefers-reduced-motion` rule in the stylesheet. For a
vestibular disorder this is not cosmetic: a pulsing skeleton is repeated motion
the operating system setting exists to stop, and the application was ignoring
the setting entirely.

Fixed in `app/globals.css`. Motion is collapsed to a single step rather than
removed, because the spinner still communicates "in progress" by being present
and the `role="status"` text is what actually announces state.

### 2. The document language is hardcoded to English. Partly fixed.

`app/layout.tsx` renders `<html lang="en">` unconditionally, while section 33
makes Vietnamese a first-class locale and `users/{uid}.preferredLanguage`
already stores the choice. A screen reader takes pronunciation from `lang`, so
Vietnamese content inside a document declared `en` is read with English
phonetics and is close to unintelligible.

Partly fixed: the conversation region in the learning workspace now carries the
session's own language, which is where nearly all Vietnamese text appears. The
root `<html lang>` is unchanged, because making it dynamic means reading the
profile in the root layout on every request, and that is a data-fetching change
rather than an accessibility one. Recorded as a follow-up.

### 3. The accessibility settings section 40 requires do not exist.

Section 40 says students must be able to configure larger text, reduced motion,
a simplified interface, increased spacing, read-aloud readiness and additional
response time. `app/student/settings/page.tsx` offers language and nothing else.

Not implemented, and deliberately not stubbed. A settings panel whose toggles do
not change anything is worse than an absent one, because it tells a student their
need has been met when it has not. This is genuine remaining work, sized at a
persisted preference document plus a class strategy on the root element.

One design note for whoever builds it: section 40 ends with "Accessibility
settings must not reduce the Independence Score." The scoring model reads no UI
preference today, so that constraint currently holds by construction. It stops
holding the moment "additional response time" becomes a stored field, because
§56.2's hint-efficiency and first-attempt components are time-adjacent. Whoever
implements extra time must add a test asserting the score is identical with and
without it.

### 4. Contrast is unverified and at least one pairing is suspect.

`text-gray-500` on `bg-gray-50` is used for secondary text. That is roughly
4.0:1, below the 4.5:1 that WCAG AA requires for body text. Not fixed here,
because changing it is a visual-design decision across many screens and this
session had no way to measure the rendered values. Recorded rather than guessed
at.

### 5. No automated accessibility scanner is wired in.

The four browser assertions added this session are hand-written. They catch the
specific regressions they name and nothing else. `@axe-core/playwright` would
turn this review into a repeatable gate; it is not installed, and installing it
was out of scope once the section 38 scenarios were working.

## Not assessed

Stated plainly so nobody reads this document as broader than it is.

- **No manual keyboard walk.** Tab order, focus traps and reachability of every
  control were inferred from the use of native elements, not observed.
- **No screen-reader walk.** NVDA, JAWS and VoiceOver were all unavailable. The
  live-region and `lang` claims are structural, not experiential.
- **No contrast measurement.** No tool was run over the rendered palette.
- **No 200% zoom test.**
- **The teacher surface received a lighter audit than the student surface**,
  because the student workspace is where a minor spends their time.

## Follow-ups, in priority order

1. Build the section 40 student accessibility settings, with the score-parity
   test described in finding 3.
2. Install `@axe-core/playwright` and add a scan to the existing E2E suite, so
   this review becomes a gate rather than a snapshot.
3. Make `<html lang>` follow the signed-in user's preferred language.
4. Measure contrast and fix `text-gray-500` on light-grey backgrounds.
5. Perform a manual keyboard and screen-reader walk of the learning workspace.
