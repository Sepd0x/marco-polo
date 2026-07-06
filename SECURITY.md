# Security policy

## Model

Marco Polo is a static client-side application plus a local CLI. There is no
server, no authentication, no database, and no secret material anywhere in the
project. The attack surface is correspondingly small, but not zero:

- **Custom imagery URL** (Settings / `--template`): tile URLs you configure are
  fetched by your own browser/machine. Templates are plain string substitution of
  `{z}/{x}/{y}` — no code evaluation — but you should only point the scanner at
  endpoints you trust.
- **Imported GeoJSON** (CLI `--area`): parsed with `JSON.parse`, geometry fields
  only.
- **Exports**: contain coordinates and detection metadata only — no addresses, no
  imagery, no identifiers.
- Scan archives live in your browser's IndexedDB and can be deleted in-app or by
  clearing site data.

## Reporting

If you find a vulnerability, please use
[GitHub private vulnerability reporting](https://github.com/Sepd0x/marco-polo/security/advisories/new)
rather than a public issue. Reports get a response within a week.
