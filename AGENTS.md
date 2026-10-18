# Kashlo repository instructions

## Branch and repository workflow

- Use the new Kashlo repository at `https://github.com/deepukv97/kashlo.git`.
- Implement changes and push commits on `dev` by default.
- Do not push to `main` unless the user explicitly requests a production promotion for that change.
- Do not merge, copy, or push commit history from the previous repository into this repository.
- Preserve local deployment configuration when switching branches. Deploy only when the user authorizes deployment.

## Personal data and credentials

- Never commit passwords, tokens, OAuth credentials, private keys, clasp login files, or real local deployment configuration.
- Keep `.clasp.json` local and ignored. Share `.clasp.example.json` with a placeholder project ID instead.
- Never commit personal financial records, private workbook URLs/IDs, bank/card/app names from real records, profile settings, transaction notes, screenshots of personal data, or private exports and backups.
- Use generic examples and fictional test data. Public product links, the clean starter-template URL, and the repository owner's public username are allowed.
- Use the configured GitHub noreply email for commits; do not expose a personal email or computer hostname in commit metadata.
- Before every commit and push, review the exact staged files and diff for personal data and credentials. Check newly added files, not just existing tracked files. `.gitignore` does not protect data pasted into source or documentation, or files already tracked.
- Do not publish a value when its sensitivity is uncertain. Replace it with a safe placeholder or exclude the file, and report what was omitted.
