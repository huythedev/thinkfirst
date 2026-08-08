# Deployment

ThinkFirst has three intended environments. The repository contains the deployment
workflow, but this workspace has no Firebase project, Git remote, Cloud Run service,
or deployment credentials. The commands below are the handoff procedure for the
first provisioned environment.

## Environment model

| Environment | Trigger | Purpose | Approval |
|---|---|---|---|
| Development | Push to `main` after CI | Shared integration environment | Automatic after CI |
| Staging | Push to `staging` | Release candidate and acceptance checks | Automatic after CI |
| Production | After development deploy on `main` | Real student and teacher traffic | GitHub Environment required reviewer |

Production is gated by the `production` GitHub Environment. Configure at least one
required reviewer in **Settings -> Environments -> production -> Required reviewers**.
The workflow job cannot start until that reviewer approves it. This setting is held
in GitHub, not in YAML, so it must be configured before calling the pipeline
production-ready.

## One-time Google Cloud setup

1. Create separate Firebase projects for development, staging and production, or
   use separate projects owned by the same Google Cloud organization.
2. Enable Firebase Authentication, the Google provider, Firestore, Cloud Storage,
   Cloud Run, Secret Manager, and reCAPTCHA Enterprise.
3. Register the web app in each Firebase project and put its public configuration in
   the matching GitHub Environment variables. Public Firebase config is not a
   secret; the Admin SDK credential and Gemini key are secrets.
4. Create a Cloud Run service account with only the permissions it needs: deploy
   permissions for the CI service account, Firebase Admin access for the runtime,
   Secret Manager access to `GEMINI_API_KEY`, and Cloud Run invocation as required
   by the chosen hosting policy.
5. Store `GEMINI_API_KEY` in Secret Manager in each project. Do not put it in a
   repository variable, `.env` file, workflow command argument, or image layer.
6. Create a GitHub Actions service-account key (or replace the key-based auth with
   Workload Identity Federation) and store it as the environment secret
   `GCP_SERVICE_ACCOUNT_KEY`. `FIREBASE_TOKEN` is an environment secret used only
   to deploy Firebase rules and indexes.

Prefer Workload Identity Federation for a production hardening pass. If a JSON key
is used initially, rotate it regularly and never echo it in a workflow step.

## Required GitHub settings

Set these variables separately in the `development`, `staging`, and `production`
environments:

- `FIREBASE_PROJECT_ID`
- `GCP_REGION` (for example, `us-central1`)
- `APP_URL`
- `GEMINI_TUTOR_MODEL`
- `GEMINI_CLASSIFIER_MODEL`
- `GEMINI_VALIDATOR_MODEL`

Set these secrets separately in each environment:

- `FIREBASE_TOKEN`
- `GCP_SERVICE_ACCOUNT_KEY`

Environment secrets are not available to `pull_request` jobs from forks. The CI
workflow intentionally uses emulators and `AI_MODEL_DRIVER=mock`, so it requires no
secret at all. The deploy workflow only runs for pushes to `main` or `staging`,
never for a pull request, and production additionally waits for the required
reviewer.

## Local development

Use the emulator-backed path; it does not require a Google Cloud credential:

```bash
npm ci
npm run emulators
npm run dev
```

In a second terminal, run the quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run eval
npm run test:e2e
```

The Playwright configuration starts the Next.js dev server and selects the mock AI
driver. Firebase emulators must already be running for E2E tests. `npm run seed`
creates the deterministic demo classroom and is emulator-only.

## Firebase deployment

After authenticating the Firebase CLI and adding a `.firebaserc` or passing a
project explicitly, deploy the rules and indexes from the repository root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
```

Never deploy development rules to production by accident. Review the diff of
`firebase/firestore.rules`, `firebase/firestore.indexes.json`, and
`firebase/storage.rules` before each deployment.

## App Check and production configuration

Before enabling enforcement:

1. Register the deployed web domain in reCAPTCHA Enterprise.
2. Put the verified website key in `firebase-applet-config.json` or the deployment
   configuration used to generate it.
3. Register the app in Firebase App Check.
4. Monitor traffic in audit mode until legitimate traffic is verified.
5. Enable enforcement for Authentication, Firestore, and Storage one service at a
   time, with a rollback owner identified.

Do not add an unverified crisis contact while configuring safety. The application
intentionally ships no hotline number until a jurisdiction, reviewer, and review
date are recorded, as documented in `docs/ASSUMPTIONS.md`.

## Rollback

1. Stop the production workflow if the approval has not been granted.
2. For an application regression, redeploy the previous Cloud Run revision and
   confirm the health endpoint and sign-in flow.
3. For a rules or index regression, restore the previously reviewed rules/index
   files and deploy only the affected Firebase resource.
4. Disable a newly enabled App Check enforcement service if it blocks verified
   users, then return it to monitoring mode while investigating.
5. Record the incident, revision, rule release, affected environment, and recovery
   in the project incident log. Never roll back by weakening authorization rules.

## Current limitation

The workflow has not run on GitHub yet because this workspace has no remote
repository or cloud project. Local emulators, deterministic evaluation, lint,
typecheck, build, unit tests, rules tests, integration tests, and the mock-backed
application paths remain the available verification evidence.
