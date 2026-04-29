# Agent Guidelines

This file steers automated code review and security scanning agents
(notably Codex Cloud) when they operate on this repository. Human
contributors should also follow these guidelines.

## Project Context

CampusIntel is a Next.js 16 educational resource hub for University of
Lagos, Department of Business Administration, 200 Level First Semester
students. It is pre-launch, single-owner, and currently being hardened
before public release. The codebase is being progressively reviewed and
improved in place.

Stack: Next.js 16 (App Router), React 19, TypeScript 5.7 strict,
Tailwind 3.4 with shadcn/ui, react-hook-form + zod, pnpm 9, Node 22.

## Review Focus Areas

When reviewing pull requests or auditing the codebase, prioritize the
following lanes in order:

### 1. Security (P0)

- **Hardcoded secrets, credentials, or API keys** in source files.
  Flag any string literal that resembles a password, token, or signing
  key.
- **Secrets exposed via NEXT_PUBLIC_ prefix.** Variables that hold
  passwords, tokens, or signing material must be server-side only.
- **Client-side authentication** for protected routes. Authentication
  decisions must happen server-side (Middleware, Route Handlers, or
  Server Components reading httpOnly cookies). Client-side password
  checks are not security.
- **Missing or weak security headers** in next.config.mjs. Expect
  Content-Security-Policy, Strict-Transport-Security,
  X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and
  Permissions-Policy.
- **Unsanitized user input** flowing into URLs, dangerouslySetInnerHTML,
  or downstream services. Form inputs should be length-limited and
  validated with zod schemas.
- **localStorage reads without try/catch** or without shape
  validation before use. Treat stored data as untrusted.
- **Dependency vulnerabilities** surfaced by pnpm audit.

### 2. Next.js 16 Correctness (P1)

- **Unnecessary 'use client' directives.** Components that don't use
  useState, useEffect, useReducer, event handlers, browser APIs,
  or React Context should be Server Components.
- **Incorrect Server/Client boundaries.** Server-only modules imported
  into client components, or next/headers / cookies() used
  client-side.
- **Hydration mismatches** from non-deterministic rendering
  (Date.now(), Math.random(), locale-dependent formatting) outside
  useEffect.
- **Missing or incorrect metadata** on routes that need it.
- **Improper use of next/image and next/font** (missing dimensions,
  no priority on LCP images, fonts loaded client-side).
- **Cosmetic build-tool fingerprints** in metadata.

### 3. TypeScript Correctness (P1)

- **any types** without an explanatory comment. Prefer unknown with
  narrowing.
- **@ts-ignore, @ts-expect-error, or @ts-nocheck** without a
  comment explaining why.
- **ignoreBuildErrors: true** in next.config.mjs (must be false).
- **Type assertions** (as Foo) used to bypass real type errors.
- **Implicit any on function parameters** when stricter typing is
  achievable.

### 4. React 19 / Hooks Correctness (P2)

- **Missing or incorrect dependency arrays** in useEffect,
  useMemo, useCallback.
- **Stale closures** captured by event handlers.
- **State updates that should be batched** or derived rather than
  stored.
- **Effects that should be event handlers** (synchronizing with
  external systems vs reacting to user input).

### 5. Code Quality (P2)

- **Magic numbers** without a named constant.
- **Files exceeding 300 lines** that should be split into smaller
  components.
- **Repeated string literals** that should be centralized (contact
  numbers, URLs, brand strings).
- **Commented-out code** — should be deleted; git history preserves it.
- **console.log / console.warn / console.info** in production
  code paths. console.error in catch blocks is acceptable.

## Out of Scope

The following should NOT be flagged in reviews unless they intersect
with one of the focus areas above:

- Subjective visual design opinions (color choices, spacing,
  typography preferences). These are handled in a dedicated design
  phase.
- Micro-optimizations without measured impact (e.g. premature
  memoization).
- Naming style preferences when names are already clear and
  consistent.
- Comment style or JSDoc completeness on internal helpers (exported
  functions should have JSDoc; private ones may not).
- Choice of state management approach unless it introduces a
  correctness or performance bug.
- File or folder organization unless it violates Next.js App Router
  conventions.

## Severity Rubric

- **Critical** — Exploitable now. Exposes secrets, user data, or
  enables account takeover. Blocks any merge.
- **High** — Will break in production at any scale, or exposes
  secrets at scale. Blocks any non-fix merge.
- **Medium** — Correctness or maintainability issue. Should be fixed
  before launch but does not block unrelated work.
- **Low** — Polish or nice-to-have. Queue for batch cleanup.

## Review Output Expectations

When producing findings:

- Cite specific files and line ranges. Vague findings ("review error
  handling") are not actionable.
- Provide a concrete recommended fix or approach for each finding,
  not just a description of the problem.
- Do not propose architectural rewrites. This codebase is being
  hardened in place.
- Group findings by severity, then by file.
