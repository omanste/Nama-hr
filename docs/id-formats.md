# Omani ID card versions — how the portal reads each

The reader is `server/idread.mjs`. Each version has a made-up test card in `tests/id-docs.test.mjs` or
`tests/fixtures/`; real cards are never stored in the code or the repository.

| Version (`found.format`) | What arrives | How it is read |
|---|---|---|
| Photo of the card | A JPG/PNG from a phone camera | Tesseract on the picture. The three `<<<` lines give the number, dates, sex and nationality (check digits verified). The front gives the printed labels and the Arabic name. Cleaned copies help when the security pattern hides the Arabic. |
| `om-id-scan` — phone scan PDF | A PDF from a scanner app, with an English text layer | The `<<<` lines from the text layer. Then the pages are read as pictures for the Arabic name and a cleaner coded line. |
| `om-eid-copy` — electronic copy (2026) | A PDF marked «نسخة إلكترونية», with two pages (front, back) | The text layer holds everything. The Arabic is in joined letter shapes with direction marks (fixed with NFKC). The **English name is printed over two lines** when long ("… AL" / "OBAIDANI"). The `<<<` name line is cut at 30 letters ("AL<OB"). The cut name is finished from the wrapped printed line. A word printed on its own counts as complete and is never stretched from the Arabic. This prevents "Obaidanii". |

## Rules that hold for every version
- The `<<<` lines win for numbers and dates (check digits). The printed English name wins for the full name. A passport
  never changes a name or nationality.
- A name the `<<<` line cut short is completed, in this order:
  1. the English printed on the card (wrapped lines too);
  2. the family name in the Arabic name on the same card;
  3. the family-name list.
- Nothing is added or reordered beyond that.

## When a new version appears
1. Upload it once on dev and use «الإبلاغ عن خطأ» (report a mistake) with the right value. The report and the document
   are in Admin › reading feedback (zip).
2. Add its layout as a made-up test card (same structure, invented name and numbers). Add a `format` name in `idFormat()`
   if it can be told apart. Then fix the reader until the test passes.
