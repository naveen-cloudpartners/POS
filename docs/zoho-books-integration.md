# Zoho Books setup

Implementation checkpoint: **1 October 2026**. Changes are local and require backend/client deployment. TypeScript, ESLint (no errors), production build, 78 backend tests and 6 receipt-printing tests passed. OAuth tests use mocked responses; real Books authorization and a live sale have not been verified.

## Catalyst requirements

No additional Catalyst Connection such as `zohobooks_conn` is required for this OAuth flow. Deploy both `pos_backend` and the frontend to the intended environment and use its displayed callback URL.

- The existing `Configurations` table requires `config_key` and `config_value` columns and server-side read/write access.
- Product import requires `Products.org_id` and existing catalog columns, including `books_item_id`. Missing company storage fails the import rather than writing unscoped data.
- The connecting user needs an active Catalyst session and POS Admin role. Staff use the saved company connection without authorizing separately.
- `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` are optional shared developer credentials, not function startup prerequisites. Company credentials can be entered in Admin settings. `ZOHO_DC` supplies the recognized default region; otherwise US is used.
- Development and Production have separate configurations. Register each environment's callback URL before using it.

## Admin connection steps

The app runs without Books credentials. After deployment, an Admin opens **Settings → Integrations**:

1. Choose the region of the Zoho account.
2. Copy the displayed callback URL into a server-based application in the Zoho API Console.
3. Enter its Client ID and Client Secret and save setup. Platform `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` variables may supply shared developer credentials instead; company settings override them.
4. Click Connect Zoho Books and authorize access.
5. Select the correct Books organization and click Use this organization.
6. Test the connection. Import products if Books holds the catalog.
7. Test a small checkout and compare the POS receipt with the Books invoice, tax and payment.

## Actions and sync direction

| Action | Current behavior |
|---|---|
| Admin authorizes and selects an organization | Saves the company connection in Catalyst; does not change POS roles |
| Authorized seller completes checkout | Attempts customer lookup/create, invoice creation and supported payment posting to the company Books account |
| Admin or Manager runs product import | Fetches Books products into Catalyst; refreshes matching prices and stock |
| Product changes directly in Books | Appear after the next manual import, not instantly |
| User/profile/printer/settings change in POS | Stored in Catalyst; not sent to Books |
| Local stock adjustment, purchasing, void or return | Not automatically mirrored to Books; accounting reversals are separate |
| Orders recorded before connecting | Retained in Catalyst; not automatically uploaded later |

Connecting does not enable complete two-way synchronization. Catalyst remains the operational POS store; Books holds contacts, invoices and payments successfully posted through the integration.

Purchasing vendors, orders, warehouse receipts, bills and supplier payments use Catalyst tables. A `No privileges to perform this action` error on Purchasing concerns Catalyst table access, not Books authorization. Purchasing now uses server SDK credentials after POS authentication/action checks; its loading errors are separate from form validation. These fixes require deployment and live verification.

## Storage and authorization

Credentials, refresh tokens, pending organization selection and connection state stay in Catalyst Configurations under the authenticated POS company's key. They are never returned to the browser. OAuth state expires after 10 minutes and is bound to the initiating Admin and company. Organization selection expires after 30 minutes. Connecting does not change POS user roles.

Active sellers share their company's server-side connection. Browser-supplied Books organization/token headers are ignored. Global legacy `last_connected_org` records are not adopted: reconnect each company to establish its own verified connection.

Imports page through Books items and update matching `books_item_id` records under the POS company's `org_id`, preserving local categories. Prices and stock are refreshed from Books; zero stock stays zero. Products requires an `org_id` column. A missing column/access error fails the import instead of writing unscoped data. Existing local-only products are not automatically matched by name/SKU and may need manual reconciliation before importing.

Checkout uses live product Books IDs and tax mappings, discounted net rates, and individual Cash/Card/UPI payment legs. A tax mapping/total mismatch stops automatic payment posting and displays an incomplete-posting warning. Sales remain recorded in Catalyst. Inspect partial invoices/payments in Books before manual retries. Existing local orders are not automatically backfilled, and voids/returns need a separate Books reversal. This change does not add a background reconciliation queue, two-way purchasing sync or automatic recovery of partial remote operations.

Disconnect removes this company's stored authorization and local access-token cache; it retains POS records. To revoke access at Zoho as well, remove the app from the Zoho account's connected applications.

Validation uses mocked OAuth/Books APIs; live authorization requires a real account and registered credentials.

References: [Zoho Books OAuth](https://www.zoho.com/books/api/v3/oauth/) and [Invoices API](https://www.zoho.com/books/api/v3/invoices/).
