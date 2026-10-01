# Premium UI refinement - 2026-10-01

## Scope

Presentation across public pages, dashboard, inventory/catalog/categories/warehouses/transfers/movements, POS/kitchen/payments/invoices/returns, orders, customer directory/loyalty/rewards, all five purchasing workflows, users/roles/activity/audit, reports and settings sections. Staff profile was reviewed with a Manager role. Role-restricted routes continue redirecting according to existing navigation rules.

The committed two-level navigation remains the foundation, with its navy rail, cloud identity and blue selection. The top bar remains removed. `premium.css` is the final presentation layer after `muster-brand.css`. Inter is used for controls and general content, Sora for headings and totals. Blue actions are darkened to #4464CE for readable white labels; branding keeps the existing #5D8EF9 family.

## Refinements

- Consistent 40-42px desktop controls, 48px touch controls, 9px control radii and 14-16px panel radii.
- Shared spacing, title scale, form labels, neutral canvas, table padding and tabular numeric alignment.
- Refined KPI cards, dashboard hierarchy, catalog cards, purchasing forms, reports, settings and empty/loading states.
- Explicit line-discount labels and usable fields, mobile quantity controls and catalog scrolling.
- Mobile onboarding prioritizes the forms, with readable registration step labels.
- Dialogs render above the application, contain keyboard focus, restore focus and preserve scroll locking.
- Navigation drawer contains keyboard focus and makes background workspace inert; tables can be focused and scrolled by keyboard.
- Skip-to-content link and reduced-motion support.

## Visual verification

Read-only local sample API; no live financial transactions, record writes, permission changes, printer jobs or external login were performed. Product initials in screenshots represent products without uploaded photos. Real product-photo rendering remains in place.

Desktop 1440x1000: inventory, customer, sales, purchasing, administration, settings and reports route families reviewed. Phone 390x844: 40 accessible workspace views checked for headings, empty rendering and page-level horizontal overflow; no overflow found. Tablet 820x1180: dashboard, products, customers, purchase orders, POS, reports and personal profile checked; no overflow found. Admin-only settings and staff profile reviewed under separate fixture roles. Guest landing, sign-in shell and registration were reviewed; Catalyst iframe authentication requires a live session.

Product editor and purchase order dialogs inspected. Modal Tab wrapping, Escape dismissal, payment cancellation/cart preservation, payment focus restoration and unbalanced split validation verified. Screenshots and route results are in `docs/design-preview`.

## Checks and limits

Production build, ESLint and purchasing/receipt regression checks run. Existing lint warnings and Vite bundle size warnings are reported separately from errors. This is a local UI update; deployment is a separate step. Live backend data, auth iframe contents, permission variants beyond the preview roles, physical printing and every possible form state are not covered by the sample preview.
