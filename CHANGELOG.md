# Changelog

## 0.7.0 - 2026-09-30

- Make PostgreSQL the sole supported application database, preserving existing migration history.
- Rebuild installation, paired image distribution, upgrades and PostgreSQL backup/restore.
- Fix local HTTP sessions, nginx replacement and deployment behavior on Linux.
- Exclude legacy database files from production images while preserving customer database requirement matching.
- Publish both production images on Linux with isolated registry credentials.

See [release notes](docs/releases/v0.7.0.md) for compatibility and installation instructions.
