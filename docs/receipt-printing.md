# Automatic receipt printing

On each terminal, install QZ Tray, keep it running, and install the receipt printer's manufacturer driver. USB and network printers must appear in the operating system printer list. This integration prints HTML through that driver; a generic text-only/raw driver is not sufficient.

In Admin Settings → Printers:

1. Click Refresh detected printers.
2. Add a printer, select Counter, QZ Tray, and 58 or 80 mm.
3. Choose its exact detected system printer name and enable it.
4. Save, then Test print. Set the matching receipt paper size in the driver too.

Successful POS checkout automatically submits one bill to the first enabled counter QZ printer. Browser printers continue to use manual Print. A QZ failure never opens browser printing or reverses a completed sale. The receipt shows the failure and offers Print to retry. A successful submission means the spooler accepted the job; it does not prove paper was physically printed.

Printer settings are shared within the company. Use matching OS queue names across terminals. QZ must be installed and running on every terminal. Changing terminal/printer settings requires reloading an already open POS page.

## Removing QZ permission prompts

Without signing, QZ may prompt for permission. The browser print dialog is not used for QZ jobs.

Admin Settings → Printers includes QZ certificate setup. Choose or drag `digital-certificate.txt` and `private-key.pem` into their respective fields, then Save certificate files and refresh detected printers. Allow and remember the trusted certificate once if QZ prompts. Files must match, be valid PEM, and contain a currently valid certificate and an RSA private key of at least 2048 bits.

For uploaded certificates, configure `QZ_KEY_ENCRYPTION_SECRET` on the backend: 64 hexadecimal characters from 32 cryptographically random bytes. The local ignored backend `.env` has been configured. Set the same stable secret in the relevant Catalyst environment before using uploads there; keep it backed up and do not change it after uploads without migrating the encrypted keys. The backend stores only an encrypted private key in company-specific configuration and never returns it to users.

QZ Site Manager demo files work only on the computer where their trust was installed. Uploading them does not make other computers trust them. Client terminals need a trusted QZ-issued certificate or explicit local trust provisioning. An unsigned site does not automatically discover printers on Settings page load; use Refresh detected printers to connect explicitly.

Configure these backend environment variables with your trusted QZ certificate/key pair:

- `QZ_CERTIFICATE`: public certificate PEM text.
- `QZ_PRIVATE_KEY`: matching RSA private key PEM text, stored only in backend configuration.

Literal `\n` or real newlines are supported. Never put the private key in Vite variables, public files, or frontend code. QZ must trust the certificate (a QZ-issued trusted certificate, or a locally provisioned trusted root for testing). See https://qz.io/docs/signing.

The authenticated backend signs only fresh discovery or inline HTML printing requests addressed to an enabled QZ printer belonging to the current company. It does not sign file access, raw device commands, or remote HTML URLs.

The connector is bundled locally in `react-app/public/vendor/qz-tray` from the installed QZ Tray 2.3.0 distribution, with its license notice, so printing does not depend on a CDN.
