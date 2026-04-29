# CampusIntel

Educational resource hub for University of Lagos, Department of Business
Administration, 200 Level First Semester students. Course materials,
textbook references, topic notes, practice quizzes, and peer-tutor
connections in one place.

> **Status:** Pre-launch. In active development.

## Features

- Course directory with search and filtering
- Per-course detail pages: overview, textbooks, topic notes, exam focus,
  theory questions, downloadable resources
- Timed multiple-choice course quizzes with sectioned results
- Bookmarks for quick access to saved courses (stored locally in browser)
- Peer-tutor waitlist and tutor application flows
- Contact channels via WhatsApp, phone, and email

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.7 (strict) · Tailwind 3.4
with shadcn/ui (Radix primitives, lucide-react) · react-hook-form with zod
validation · next-themes · recharts. Package manager: pnpm 9. Runtime:
Node 22.

## Getting Started

Prerequisites: Node 22+ and pnpm 9+.

```bash
git clone https://github.com/Teetoh861/Campusintel.git
cd Campusintel
pnpm install
cp .env.example .env.local
pnpm dev
```

The dev server runs at http://localhost:3000.

## Project Structure
app/                  # Next.js App Router routes
(root pages)/       # /, /courses, /bookmarks, /tutors, /contact, etc.
courses/[slug]/     # Single course page + nested /quiz route
admin/              # Admin dashboard (auth-gated)
components/
common/             # Shared layout pieces (Footer, etc.)
navigation/         # Navigation components (MobileNav)
ui/                 # shadcn/ui primitives
lib/
data/               # Hardcoded content (courses, quizzes, notes, theory questions)
types.ts            # Domain types (Course, Topic, QuizQuestion, etc.)
utils.ts            # Shared utilities (cn helper)
public/               # Static assets

Content currently lives in `lib/data/` as TypeScript modules. A future
migration will move this content to a headless CMS so it can be edited
without code changes.

## Environment Variables

All environment variables are documented in `.env.example`. Copy it to
`.env.local` for local development. Variables prefixed `NEXT_PUBLIC_` are
exposed to the browser; everything else stays server-side.

## Scripts

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `pnpm dev`    | Start the development server (Turbo) |
| `pnpm build`  | Build the production bundle          |
| `pnpm start`  | Run the production server locally    |
| `pnpm lint`   | Run Next.js lint checks              |

## Contributing

- Branch from `main` using a short, single-word, feature-based name
  (e.g. `cleanup`, `cms`, `design-system`).
- Commit messages follow Conventional Commits
  (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Run `pnpm lint && pnpm build` before opening a PR.
- One branch, one focused PR. Keep scope tight.
- See `SECURITY.md` for security policy and reporting.

## License

License pending. All rights reserved by the project owner until a license
is selected.

## Owner

Maintained by Teetoh861 (https://github.com/Teetoh861).
