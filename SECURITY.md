# Security Policy

This document describes how to report security vulnerabilities for
CampusIntel and what to expect after reporting.

## Reporting a Vulnerability

If you believe you've found a security vulnerability in this project,
please report it privately. Do not open a public GitHub issue, public
discussion, or pull request that describes the vulnerability.

Preferred channels:

1. **GitHub Security Advisories** — Use the "Report a vulnerability"
   button under this repository's Security tab. This creates a private
   advisory visible only to maintainers.
2. **Direct contact** — Reach the project owner privately via the
   contact channels listed on the deployed site.

When reporting, please include:

- A description of the issue and its potential impact
- Steps to reproduce, or a proof-of-concept where possible
- The affected route, file, or component if known
- Your contact information for follow-up

## Response Expectations

- **Acknowledgement** within 7 days of receiving the report.
- **Status update or resolution** within 30 days of acknowledgement.
- **Coordinated disclosure** once a fix is deployed. We will credit
  reporters who request it.

These are best-effort timelines for a small project. We will keep you
informed if more time is needed.

## Scope

In scope:

- The deployed CampusIntel application
- Source code in this repository
- Configuration we maintain (build, deployment, headers)

Out of scope:

- Third-party services we depend on (e.g. hosting providers, CMS).
  Please report directly to the upstream vendor.
- Vulnerabilities in unmodified dependencies. Please report upstream.
  We track dependency advisories via pnpm audit.
- Findings that require physical access, social engineering of the
  owner, or denial-of-service through volumetric traffic.
- Issues only reproducible on outdated browsers or unsupported
  platforms.

## Supported Versions

Only the latest deployed main branch is supported. We do not backport
fixes to older revisions.

## Disclosure Policy

We follow coordinated disclosure. Please give us a reasonable window to
investigate and patch before any public disclosure. We will work with
you on disclosure timing and credit.

## Out-of-Scope Reports

We may close reports that fall outside the scope above without detailed
investigation. We appreciate the time taken to investigate either way.
