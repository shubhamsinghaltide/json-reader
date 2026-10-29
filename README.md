# JSON Reader & Diff

Single-page, no-build web app (plain HTML/CSS/JS) for reading and comparing JSON.

- **Reader**: Tree / Table / Raw views, search with auto-expand, clickable JSONPath, URL/colour/date hints, and an Insights panel (type distribution, depth, common keys, largest arrays, mixed-type and inconsistent-key warnings).
- **Compare**: side-by-side line diff with word-level highlights, "ignore key order", "changed lines only" (folds unchanged context), prev/next change navigation.
- **Uniclient**: Insights flags expired URLs/expiry fields, PII/tokens to redact, float or string money, enum candidates (use `unknownEnumValue`), nulls, mixed key casing. The **Dart** view generates freezed + json_serializable models.
- **Expand**: every panel has a full-width button (top right). Press `Esc` to restore.
- Open files via the file buttons or drag and drop. Everything runs locally in the browser; nothing is uploaded.

## Run locally

    sh scripts/serve.sh 8000 .   # then open http://127.0.0.1:8000/index.html

## Deploy on GitHub Pages

1. Push to `main` on `https://github.com/shubhamsinghaltide/json-reader.git`.
2. Settings -> Pages -> Source: **GitHub Actions**.
3. The URL appears on the Pages settings page and in the `Deploy to GitHub Pages` workflow run.
