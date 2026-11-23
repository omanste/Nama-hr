# HR portal guides

Three guides, each in Arabic and English. The examples in them are made up; no staff data is kept here.

| Guide | Source | Built file |
|---|---|---|
| Staff guide (one long page per language) | `Main.dc.html` (Arabic), `English.dc.html` (English) | `Nama-HR-Staff-Guide.pdf` |
| Staff guide for phones | the same two files, through `guide-mobile-build.py` | `Nama-HR-Staff-Guide-Phone.pdf` |
| Managers & HR guide | the text in `guide-mgr-build.py` (the phone guide's look) | `Nama-HR-Managers-HR-Guide.pdf` |

Build (needs Playwright's Chromium — set `PW_MODULE` if Playwright isn't a project dependency — and poppler's `pdfunite`):

```sh
OUT=/tmp/guides && mkdir -p $OUT
node docs/guides/guide-pdf.mjs $OUT                     # staff guide, long pages
python3 docs/guides/guide-mobile-build.py $OUT          # → $OUT/guide-mobile.html
python3 docs/guides/guide-mgr-build.py $OUT             # → $OUT/guide-mgr.html (after the line above)
node docs/guides/guide-print.mjs $OUT/guide-mobile.html $OUT/Nama-HR-Staff-Guide-Phone.pdf
node docs/guides/guide-print.mjs $OUT/guide-mgr.html $OUT/Nama-HR-Managers-HR-Guide.pdf
```

Open the PDF pages as images (`pdftoppm -r 50 -png …`) and check the Arabic before sending. Built files are not kept in git.
Keep button names exactly as the portal shows them (`public/js/i18n.js`), in both languages.
