# Security Policy

StarForge stores runtime credentials and downloaded content locally under `data/` and `.cache/`. These paths are ignored by git and must never be committed.

## What Not To Publish

- API keys or model gateway tokens
- Knowledge Planet access tokens or cookies
- SQLite runtime databases
- downloaded attachments
- generated skills based on private community content
- HAR captures or browser dumps

## Reporting

If you find a security issue in this project, open a private advisory or contact the maintainer directly before publishing details.

