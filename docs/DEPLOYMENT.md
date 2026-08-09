# Deployment

ThinkFirst is deployed as a Dockerized Next.js service on Google Cloud Run, with Firebase Authentication, Firestore and Storage. The repository also contains GitHub Actions for CI and environment-based deployment.

Deployment existence is not the same as release readiness: live-model evaluation gates, App Check enforcement, environment separation and production review still require independent verification in the target environment.

## Environment model

| Environment | Trigger | Purpose | Approval |
|---|---|---|---|
| Development | Push to `main` after CI | Shared integration deployment | Automatic after CI |
| Staging | Push to `staging` | Release candidate | Automatic after CI |
| Production | Trusted production deploy | Student/teacher traffic | GitHub Environment reviewer |

Production should use a protected GitHub Environment with at least one required reviewer.

## Gemini configuration

The API key and model names have different security requirements:

```text
GEMINI_API_KEY -> Secret Manager -> Cloud Run runtime environment
Gemini model ids -> normal environment variables
```

Never put `GEMINI_API_KEY` in the Dockerfile, source tree, build arguments, GitHub variables, or a committed `.env` file.

Configured model roles:

- `GEMINI_TUTOR_MODEL`
- `GEMINI_CLASSIFIER_MODEL`
- `GEMINI_VALIDATOR_MODEL`
- `GEMINI_EVALUATOR_MODEL`
- `GEMINI_TRANSFER_MODEL`
- `GEMINI_EXTRACTION_MODEL`

All six resolve through one code default to `gemini-3.6-flash` when no explicit override is supplied. `GEMINI_VALIDATOR_MODEL` is load-bearing: it independently verifies tutor semantics, evaluator evidence, transfer problems/answers, and image extraction where those results become trusted application data.

The current code intentionally uses more Gemini calls for correctness. Local deterministic checks remain as schema/security/math guardrails and can replace verified subsets later after their measured accuracy is high enough.

## Required GitHub environment configuration

Variables:

- `FIREBASE_PROJECT_ID`
- `GCP_REGION`
- `APP_URL`
- `GEMINI_TUTOR_MODEL` (optional override)
- `GEMINI_CLASSIFIER_MODEL` (optional override)
- `GEMINI_VALIDATOR_MODEL` (optional override)
- `GEMINI_EVALUATOR_MODEL` (optional override)
- `GEMINI_TRANSFER_MODEL` (optional override)
- `GEMINI_EXTRACTION_MODEL` (optional override)

Secrets used by the current workflow:

- `GCP_SERVICE_ACCOUNT_KEY`
- `FIREBASE_TOKEN`

The application Gemini key itself is not passed as a workflow value. Cloud Run maps `GEMINI_API_KEY` from Secret Manager at runtime.

## One-time Google Cloud setup

1. Create/select the Firebase-backed Google Cloud project for the target environment.
2. Enable Firebase Authentication, Firestore, Cloud Storage, Cloud Run and Secret Manager.
3. Register the web application and keep its public Firebase client configuration aligned with `firebase-applet-config.json` or the environment-specific equivalent.
4. Create runtime/deployment service accounts with least privilege.
5. Create Secret Manager secret `GEMINI_API_KEY` and add the current key as a secret version.
6. Grant the Cloud Run runtime service account permission to access that secret.
7. Configure GitHub environment variables/secrets for deployment.
8. Register App Check/reCAPTCHA Enterprise before enabling enforcement.

Prefer Workload Identity Federation over a long-lived JSON service-account key when production hardening is complete.

## Local Docker

Build:

```bash
docker build -t thinkfirst .
```

Run with runtime environment values:

```bash
docker run --rm -p 8080:8080 --env-file .env.local thinkfirst
```

Docker does not interactively ask for the Gemini credential. If `GEMINI_API_KEY` is not provided at runtime, live Gemini calls cannot authenticate.

## Cloud Run deployment

The GitHub workflow deploys the built container and maps the Gemini secret at runtime. Equivalent manual shape:

```bash
gcloud run deploy <service> \
  --image <image> \
  --project <project-id> \
  --region <region> \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

Model overrides may be added as ordinary `--set-env-vars` values. They are non-secret configuration.

Changing a Secret Manager version does not bake a new key into the image. A new/restarted Cloud Run instance resolves the runtime secret mapping; deploying a new revision is the deterministic way to ensure every instance is using the intended configuration.

## Firebase deployment

Rules and indexes are deployed separately from the application image:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
```

Review changes to:

- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`
- `firebase/storage.rules`

before production deployment.

## CI verification

`.github/workflows/ci.yml` is configured to run on pull requests and on pushes to `main`, with:

```text
lint
-> typecheck
-> unit tests
-> Firestore rules tests
-> server integration tests
-> build
```

It also runs deterministic prompt evaluation and emulator-backed Playwright smoke tests. Those tests use the mock AI driver and therefore do not prove live Gemini quality.

At the time of the 2026-08-09 Gemini-first validation audit, the GitHub connector did not report a CI workflow run for the current draft PR head. Do not label the branch verified until those checks actually execute successfully.

## App Check and production hardening

Before enforcing App Check:

1. Register the deployed domain with reCAPTCHA Enterprise.
2. Configure the verified site key.
3. Register the Firebase app with App Check.
4. Observe legitimate traffic before enforcement.
5. Enable enforcement one service at a time with a rollback owner.

Do not weaken Firestore or Storage authorization rules as an incident workaround.

## Rollback

Application regression:

1. Identify the last known-good Cloud Run revision.
2. Route traffic back to that revision or redeploy the known-good image.
3. Verify authentication, tutoring, image handling and persistence.

Rules/index regression:

1. Restore the last reviewed rules/index files.
2. Deploy only the affected Firebase resources.
3. Re-run negative authorization tests.

Gemini regression/configuration issue:

1. Update the affected model environment variable or Secret Manager key/version.
2. Deploy a new Cloud Run revision.
3. Verify logs identify the intended model and validator provenance.

Record the incident and recovery in the repository/project operational record.
