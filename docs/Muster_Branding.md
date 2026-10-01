# Muster POS interface

The frontend follows the supplied RestroBit references with Muster identity: a dark icon rail and light context panel, white workspace, thin neutral borders, compact product cards and a dedicated checkout panel. The shared stylesheet `react-app/src/styles/muster-brand.css` must remain last in `main.tsx`; it covers public pages, all authenticated workspaces, forms, tables and dialogs.

## Palette and typography

- Workspace and cards: white; sidebar and subtle surfaces: #FAFAFA.
- Main text and dark secondary actions: #111827; secondary text: #6B7280; borders: #E5E7EB.
- Muster blue identity and action buttons: #5D8EF9, with #3A76F8 on hover. Navigation rail: #0B1226 to #131D3A; supporting blue: #7BA4FF.
- Success, warning and errors retain green, amber and red with descriptive labels.
- Inter for interface content; Sora for headings and prominent numbers. Corners range from 7px to 14px, with light shadows.

## Interaction and responsive layout

Navigation and page search respect role permissions. Desktop uses the original collapsible two-level sidebar without a top header. Tablet and mobile use a floating navigation button and drawer, at least 48px touch controls and responsive content grids. The POS stacks its checkout beneath the catalog on narrow screens, while product photos use the existing uploaded assets.

Collect payment opens a dialog with the order total, existing payment methods and split-payment controls. Cancellation retains the cart. Dialogs support Escape, keyboard focus containment and focus restoration. Existing payment service calls and split-payment validation remain in place.

Customer logos remain in business settings and documents, separate from the Muster interface identity.

## Review

Run the production build, ESLint, purchasing and receipt regression tests, and git diff whitespace checks. `react-app/tests/preview-api.py` is an optional read-only, loopback-only sample API for visual review; it rejects writes and must be stopped before reconnecting to a real backend. Screenshots in `docs/design-preview` contain sample data. Live Catalyst integration requires the actual backend and account session.

Navigation rail and context panel are restored from commit 5208b85, including their original component layouts, gradients, selection styling and account controls. Current page geometry and payment dialog remain intact.

The final premium layer is `react-app/src/styles/premium.css`, imported last. It retains the navigation identity and uses #4464CE for readable primary actions, #F5F7FB for the workspace, #18243C main text, and #63718A secondary text. See `Premium_UI_Review.md` for coverage and validation.
