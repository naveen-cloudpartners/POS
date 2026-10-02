# Notifications and sounds

The shared navigation bell uses real operational data instead of placeholder alerts. Its badge counts unread notifications in the current feed. Open an alert to mark it read and navigate to the relevant workspace, or select **Mark all read**. Read updates are confirmed by the server; failures remain visible with Retry.

## Role-based alerts

| Event | Recipients | Destination |
|---|---|---|
| New Kitchen/Bar ticket | Admin, Kitchen, Chef | Kitchen board |
| Ticket ready to serve | Admin, Manager, Cashier, Waiter | Kitchen for Admin; POS for other service staff |
| Ticket cancelled or dishes adjusted | Admin, Kitchen, Chef | Kitchen board |
| Low/out-of-stock product | Admin, Manager, Storekeeper | Inventory products |

Ready notifications are shared with authorized service staff. Tickets currently have no assigned waiter, so delivery is not restricted to a specific waiter. Notification access does not grant service staff access to the Kitchen board, catalog access to Kitchen staff, or access to order payment/customer information.

## Data flow and storage

`GET /api/notifications` builds the feed from existing company-scoped KOT records and the stock records available through the caller's existing Catalyst catalog permissions. Kitchen events are read with server credentials only after verifying the session and POS role. The live Products table has no `org_id` column; stock reads therefore use user SDK scope rather than a project-wide admin query. Catalog read failures show a stock warning while keeping kitchen alerts available.

`PUT /api/notifications/state` marks supplied visible notification IDs read or updates the user's `soundEnabled` preference. Both values live in **Configurations**, under `org_<companyId>_setting_notifications_user_<hexEncodedSessionUserId>`. The backend derives company/user IDs from the session and ignores client identity fields. No new Catalyst table or email/push provider is needed.

Kitchen tickets retain a small `prepHistory` so READY is still discoverable if staff mark SERVED between polls. Older tickets without history are projected from their current status and fired time; earlier transitions cannot be reconstructed. The feed covers retained tickets within seven days, returns the newest 100 alerts, and checks at most 30 stock candidates. Stock alert IDs stay stable within the low/out-of-stock band to avoid repeated alerts on ordinary sales. Read-state JSON is bounded below the existing text-column budget; this is a limited operational feed, not a permanent notification archive.

Reads and preferences reuse the existing configuration storage model. Writes serialize within one function instance, with the same cross-instance race limitations documented in [Kitchen board](kitchen-board.md).

## Sounds

| Interaction | Sound |
|---|---|
| Add/scan a valid POS item | Short confirmation tone |
| Checkout, save, update or other successful API action | Success tone |
| Mark kitchen order READY | Ready tone |
| New unread kitchen ticket | New-order chime |
| New ready-order alert | Ready chime |
| Cancellation, adjustment or stock alert | Warning tone |
| Failed action or local POS validation | Error tone |

Routine polling, login checks, notification read-state changes and QZ certificate/signing calls stay quiet. Checkout warnings produce a warning rather than a success sound. Sounds use generated Web Audio tones with no external media download.

The bell provides **Sound on / Muted**, **Enable audio** and **Test sound**. Kitchen has an additional toolbar toggle. The preference applies to the user's operational sounds and is saved in Catalyst. Browsers require a click/key press to unlock audio; a new browser session may require that gesture again. Unsupported/blocked audio does not prevent checkout or notifications. These are in-app alerts, not OS notifications, and closed/background pages do not continuously poll.

The first successful snapshot establishes a silent baseline. Later unseen/unread events trigger one chime per arriving batch and a short visual toast. IDs are deduplicated across polls/reloads and shared browser tabs using an audience-scoped local delivery cache. An action's own ready alert is registered before refreshing the bell so it does not chime twice. Tabs with disabled local storage still suppress repeats within the current session.

## Validation

October 2, 2026: 104 backend and 21 frontend regression tests passed across the full suites and added targeted checks. TypeScript, backend syntax, scoped ESLint (no errors), production build and diff checks passed. Existing bundle-size and React context Fast Refresh warnings remain. Both backend and client were deployed successfully to Catalyst Development.

Backend tests cover role projection, private-field exclusion, session identity, READY preservation after SERVED, user-scoped stock reads, stock-failure isolation, input validation and bounded read-state storage. Frontend tests cover silent baselines, deduplication, batch priority, mutation sound selection, mute/unlock and rapid-call throttling. Desktop/mobile loopback browser checks cover new arrivals, read counts, mute/test controls and ready transitions. The fixture never writes restaurant sales or Catalyst records. Live speaker output and multi-device staff sessions require verification on the restaurant's devices.
