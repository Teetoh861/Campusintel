# Architecture

## Overview

CampusIntel is a Next.js 16 App Router application. Most pages render
statically from content in the repo; a few are interactive client
components. There is no backend or database yet; personalization
(bookmarks) uses on-device storage.

## Routing

    /                          Homepage
    /courses                   Course directory (search + filters)
    /courses/[slug]            Course detail
    /courses/[slug]/materials  Request/share materials (WhatsApp)
    /courses/[slug]/quiz       Timed quiz (intro / active / results)
    /bookmarks                 Saved courses (localStorage)
    /tutors                    Coming-soon waitlist
    /become-a-tutor            Application form (WhatsApp)
    /contact                   Contact methods
    /admin                     Internal stats

## Content layer

Content lives in lib/data/ (courses, quizzes, topic notes, theory
questions), typed via lib/types.ts. Intentional for the current stage;
a headless CMS is planned so content can be edited without code changes.

## Design system

Design is produced as a handoff package (tokens + component spec +
reference HTML) and implemented with Tailwind utilities driven by ci-*
tokens in tailwind.config. Typography is Hanken Grotesk via next/font.
Shared chrome (Nav, Footer, Card, HeroMotif) lives in components/chrome/;
components/ui/ holds shadcn primitives. The current visual system is
Variant B; the prior dossier system is preserved on variant-a-dossier.

## Client vs server components

Server Components by default. Client components are used only where
interactivity requires it: the course directory (search/filter), the
course-page table of contents (scroll-spy), the quiz (state, timer,
scoring), the bookmark toggle and bookmarks page (localStorage), and the
become-a-tutor form. Everything else renders on the server.

## Shared configuration

- lib/whatsapp.ts: buildWhatsAppUrl(message) and the contact number,
  centralized so no page hardcodes it
- lib/contact.ts: the support email, single source of truth

## Direction

The platform evolves in dependency order: harden the current free
product, then add identity/auth for personalization (accounts,
cross-device bookmarks, a dashboard), then a freemium business layer.
Auth is added before, and separately from, any paid features.
