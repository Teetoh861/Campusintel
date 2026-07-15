# CampusIntel

Academic study platform for University of Lagos students. Currently
serving the Department of Business Administration (200 Level, First
Semester), built to expand department by department and, later, to
other universities.

Live: https://campusintell.com

## What it does

- Browse courses with overviews, topics, exam focus, recommended
  textbooks, theory questions, and shareable study materials
- Take timed, sectioned multiple-choice quizzes with scoring and a
  per-question review
- Bookmark courses (saved on-device)
- Request or share study materials, join the tutor waitlist, and
  contact the team via WhatsApp

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript 5.7 (strict)
- Tailwind CSS 3.4 + shadcn/ui (Radix, lucide-react)
- react-hook-form + zod, next-themes, recharts
- Design system: Hanken Grotesk; navy, warm off-white, amber accent,
  exposed as ci-* Tailwind tokens

## Getting started

Prerequisites: Node 22+ and pnpm 9+.

    pnpm install
    pnpm dev

The dev server runs at http://localhost:3000. See package.json for the
authoritative script list (dev, build, start, lint).

## Environment

Copy .env.example to .env.local and fill in the values:

    cp .env.example .env.local

Required: NEXT_PUBLIC_WHATSAPP_NUMBER (international format, digits
only). .env.local is gitignored.

## Project structure

    app/                    App Router routes
    components/chrome/       Shared design system (Nav, Footer, Card...)
    components/ui/           shadcn primitives
    lib/data/                Content (courses, quizzes, notes)
    lib/whatsapp.ts          WhatsApp link helper + number
    lib/contact.ts           Contact details

## Branches

- main: production (auto-deploys); current design is Variant B
- variant-a-dossier: previous design, preserved as a fallback

## Ownership

Owned by @Teetoh861. Changes go through pull requests reviewed by the
owner; main is not force-pushed.
