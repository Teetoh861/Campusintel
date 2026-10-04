# Student design foundation

The four source colors live in `app/globals.css`: navy `#1E417C`, blue
`#1F75BC`, orange `#F68941`, and sky `#EAF7FD`. Brand-derived shades,
surfaces, interactions, transparent layers, and shadows are derived from those
sources at the root. New UI uses semantic `--student-*` roles or `student-*`
Tailwind colors, never page or component copies of the palette.

The existing `ci-*` utilities and legacy `p-*`, `t-*`, `g-*`, `r-*`, and `n-*`
class names all resolve through that same root system. `styles/campusintel.css`
is globally loaded and retains its selectors and layout. The active directory
and quiz components use `ci-*` utilities; their standalone CSS files are not
currently imported, but their retained selectors also own no separate palette.

Browser `theme-color` metadata is intentionally omitted because it cannot
read CSS variables; the approved palette has one runtime source.

| Role | Use |
| --- | --- |
| `primary`, `primary-hover`, `primary-text` | Main actions |
| `navigation`, `navigation-active`, `navigation-text`, `navigation-hover`, `navigation-current` | Shared app navigation and inverse content |
| `accent`, `accent-hover`, `accent-text`, `accent-surface`, `accent-border` | Limited emphasis and secondary action |
| `page-surface`, `page-glass`, `brand-surface`, `elevated-surface`, `surface-muted` | Background and card layers |
| `text-primary`, `text-secondary`, `text-muted`, `link` | Reading hierarchy |
| `border`, `border-strong`, `control-border`, `focus`, `focus-inverse` | Boundaries and keyboard focus |
| `success`, `warning`, `error` and their surface/text roles | Independent feedback states |
| `disabled`, `disabled-surface`, `skeleton`, `signal`, `signal-track`, `scrim` | Loading, signals and overlays |

Use the existing `components/chrome/ui.tsx` action classes, `Feedback`, and
`components/ui/skeleton.tsx`. The current course `Card` uses compact phone
padding and touch-safe actions. Shared layout classes are defined in
`app/globals.css`:

- `app-container`: bounded at 1280px with responsive gutters.
- `student-page`: compact phone padding, then tablet and desktop rhythm.
- `student-reading` and `student-form-width`: narrow reading and form widths.
- `student-surface` and `student-surface-raised`: bordered and elevated cards.
- `student-layout`: main plus secondary utility region from tablet onward.
- `student-grid`: one, two, then three columns.
- `student-section`, `student-stack`, `student-title`, `student-section-title`,
  `student-meta`, and `student-link`: spacing and type hierarchy.

Three composition modes use 768px and 1200px boundaries. Phone uses a 56px
header and a single-column drawer. Tablet uses a 64px header with direct
Courses and Bookmarks links, plus a two-column utility drawer. Desktop uses a
72px header with expanded navigation and account actions. The content gutter
is 16px on phone, 24px on tablet, 32px on desktop, and 40px on wide screens.
The next Dashboard and Profile slices can use the two-column layout and grid
without changing authentication or data loading.

Phone surfaces start at 14px internal padding and 20px section spacing;
buttons, links and drawer controls are at least 44px high. Supporting
paragraphs start at 14px; compact metadata labels can be smaller. Focus is visible, Escape returns drawer focus to its toggle, feedback
carries status or alert semantics, and shared motion and smooth scrolling stop
under reduced-motion settings.

## Legacy consumers and deferred asset

`styles/campusintel.css` retains selector and layout structure while its old
palette names are aliases in `app/globals.css`. The retained directory and quiz
CSS uses `--student-page-glass` for bars and root roles for overlays, inverse
text and shadows. Changing the four source colors updates the active brand
roles through the same derivation layer. Success, warning and error are
independent semantic states rather than a second brand palette.

The existing `app/icon.svg` still embeds the previous logo colors. It remains
unchanged for a later asset/logo pass; no new logo asset was supplied. The
current `Logo` component uses semantic color and `currentColor`.
