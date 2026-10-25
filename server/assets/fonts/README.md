# Fonts used for certificate PDFs

| File | Font | Subset |
|---|---|---|
| `NotoSans-Regular.woff`, `NotoSans-Bold.woff` | Noto Sans | Latin |
| `NotoSansDevanagari-Regular.woff`, `NotoSansDevanagari-Bold.woff` | Noto Sans Devanagari | Devanagari (Hindi) |

Both families are licensed under the **SIL Open Font License 1.1** (see the
`LICENSE-*.txt` files next to them) and were taken unmodified from the
`@fontsource/noto-sans` and `@fontsource/noto-sans-devanagari` npm packages (v5.3.0).
The OFL permits bundling and redistribution with software as long as the
license text stays with the fonts.

PDFKit's built-in Helvetica cannot draw Devanagari, which is why worker and
course names in Hindi used to come out blank or garbled on certificates.
