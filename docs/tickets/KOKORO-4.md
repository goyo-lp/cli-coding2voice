# KOKORO-4: End-To-End Validation

## Goal

Prove the migration works with a real local synthesis and daemon flow.

## Scope

- Run `npm run check`
- Run `npm run build`
- Run `npm test`
- Start the daemon
- Confirm default provider is Kokoro via `status`
- Register a session and trigger a real `speak` request or provider-driven publish
- Capture the evidence needed for a concise completion report

## Acceptance criteria

- All validation commands pass
- Real Kokoro synthesis succeeds locally
- Final report includes exact verification steps and outcomes
