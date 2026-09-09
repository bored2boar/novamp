# Security

novamp reads. It never signs.

There is no private key setting in this repository, no wallet client, no
transaction path, and no code that could move funds. CI runs a job on every push
that fails the build if a signing primitive appears anywhere in `src/`, `bin/` or
`scripts/`.

Read-only is a property of this tree, not a sandbox. A fork can obviously add a
write path. Review the exact commit you run.

## Supported versions

The `main` branch is the supported version. This project is pre-1.0 and moves
fast; older tags do not get backported fixes.

## Reporting a vulnerability

Open a GitHub issue for anything that is already public, such as a crash, a
parsing bug or a rule that produces a wrong verdict.

For anything that could put a user's funds or keys at risk, do not open a public
issue. Use GitHub's private reporting: the Security tab of this repository, then
"Report a vulnerability". Expect a first reply within 72 hours.

## Out of scope

- The public RPC being rate limited or unreachable
- A verdict you disagree with. That is an issue, and a welcome one, but it is not
  a security report
- Anything requiring a modified fork of this code
