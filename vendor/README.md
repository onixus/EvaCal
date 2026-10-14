# Vendored packages

## xlsx (SheetJS)

`xlsx-0.20.3.tgz` is the official SheetJS build, vendored as
[SheetJS recommends](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/#vendoring).
The `xlsx` package on the npm registry is stuck at 0.18.5, which has known
vulnerabilities (CVE-2023-30533, CVE-2024-22363). Do not install it from npm or
from the moving `xlsx-latest` CDN URL.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- sha512: `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`

To upgrade to version `X.Y.Z`:

1. Download `https://cdn.sheetjs.com/xlsx-X.Y.Z/xlsx-X.Y.Z.tgz` into `vendor/`.
2. Compute its hash with `echo "sha512-$(openssl dgst -sha512 -binary vendor/xlsx-X.Y.Z.tgz | base64)"`
   and confirm that `node_modules/xlsx` `integrity` in `package-lock.json` matches it after step 3.
3. Run `npm install file:vendor/xlsx-X.Y.Z.tgz`, delete the old tarball and update this file.
