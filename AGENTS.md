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

## Web platform guidance and verification

- For HTML, CSS, browser JavaScript, accessibility, and mobile UI work, consult [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance-src) before implementation. Use the installed `modern-web-guidance` skill when available: search the specific UI capability, then retrieve and apply relevant guides. Do not install tools or rewrite working features just to satisfy a scan.
- Prefer native browser elements such as modal `dialog` and `popover`, preserving save guards, keyboard access, reduced motion, manual zoom, and Apps Script iframe compatibility. Treat newer browser capabilities as progressive enhancements; keep functional behaviour on current iPhone Safari/Chrome and Android Chrome.
- Run `npm test` for server/browser adapter regressions and `npm run test:browser` for UI changes. The browser suite uses fictional data and intercepted RPCs; it must never connect to a real workbook. Check physical phone keyboards and VoiceOver/TalkBack separately when available; emulation is not a substitute for device testing.
- See [DEVELOPMENT.md](DEVELOPMENT.md) for guidance commands, browser setup, and the remaining manual checks. Never add a runtime dependency on the guidance CLI or its services to the finance app.
