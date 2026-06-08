# Security Policy

## Supported Versions

The latest minor release line receives security fixes. zodbridge is pre-1.0;
once 1.0 ships, the current major is supported.

## Reporting a Vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting (Security tab → "Report a
vulnerability") so the report stays confidential until a fix ships. Include a
minimal reproduction and the affected version.

We aim to acknowledge within 72 hours and to ship a fix or mitigation promptly.

## Security-relevant design notes

zodbridge sits at the DB-entity ↔ response-DTO boundary, so a few behaviors are
security-relevant (see the README "Security" section):

- `select` is **not** an authorization boundary — enforce field-level authz
  before passing untrusted selections.
- Over-exposure: closed object schemas `.strip()` unknown keys; `z.any()`,
  `.passthrough()`, and `z.record()` disable that protection.
- The dot-path helpers reject `__proto__`/`prototype`/`constructor` to prevent
  prototype pollution from untrusted data.
- `deserialize` bounds BigInt-string length and Map/Set entry counts against DoS.

If you find a way to bypass any of these, please report it privately.
