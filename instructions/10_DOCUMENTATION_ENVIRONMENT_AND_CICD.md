<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 45, 46, 47, 48.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 45. README REQUIREMENTS

The root README must include:

1. Product overview.
2. Problem statement.
3. Product principles.
4. Screenshots or placeholders generated from the running app.
5. Architecture diagram.
6. Technology stack.
7. Local setup.
8. Firebase emulator setup.
9. Environment variables.
10. Google Cloud setup.
11. Running tests.
12. Running evaluations.
13. Deployment.
14. Data model.
15. AI behavior overview.
16. Safety overview.
17. Privacy overview.
18. Known limitations.
19. Demo instructions.
20. License information.

Provide a Mermaid architecture diagram.

---

# 46. ENVIRONMENT VARIABLES

Create `.env.example`.

Include variables similar to:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_APP_ID=

GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=
GEMINI_TUTOR_MODEL=
GEMINI_CLASSIFIER_MODEL=
GEMINI_VALIDATOR_MODEL=

AI_GATEWAY_BASE_URL=
AI_GATEWAY_SHARED_SECRET=

FIREBASE_STORAGE_BUCKET=
LOG_LEVEL=info
NODE_ENV=development

ENABLE_IMAGE_INPUT=true
ENABLE_TEACHER_DASHBOARD=true
ENABLE_VERIFY_MODE=true
ENABLE_SAFETY_ESCALATION=false
```

Do not commit secrets.

Fail safely when required variables are missing.

---

# 47. LOCAL DEVELOPMENT

A new developer should be able to run:

```bash
pnpm install
pnpm dev
```

Provide commands for:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm eval
pnpm build
```

Use Firebase emulators locally.

Provide seed commands:

```bash
pnpm seed
```

Mock Gemini responses should be available for deterministic local tests.

The production AI path must use the real configured Gemini service.

---

# 48. CI/CD

Create GitHub Actions workflows for:

- Install.
- Lint.
- Type checking.
- Unit tests.
- Firestore rule tests.
- Build.
- Prompt evaluation on a limited deterministic set.
- End-to-end smoke test.

Do not expose secrets in pull requests from forks.

Add deployment documentation for:

- Development.
- Staging.
- Production.

Require manual approval for production deployment.

---
