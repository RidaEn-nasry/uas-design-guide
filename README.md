# Unmanned Aerial Systems Design Guide

A reading guide for Design of Unmanned Aerial Systems by Mohammad H. Sadraey, using the same reader layout as the earlier aircraft guide.

Read online at https://ennasryme.github.io/uas-design-guide/.

For a local copy, open `index.html` directly, or run `python3 -m http.server 8000` from this directory and visit `http://localhost:8000`.

The guide includes all 14 chapters, front matter, exercises, references, and the index. Search covers section titles and extracted text. Reading progress, completion marks, and highlights are saved in the current browser. Use the left/right arrow keys to move between sections, and click a figure to enlarge it. Each lesson links to the corresponding pages in the source PDF.

## Rebuild

The source is `book.pdf`. Install the extraction dependencies listed in `tools/requirements.txt`, then run `python3 tools/build-guide-data.py`. The converter detects headings directly in the PDF, preserves displayed equations as image regions, and caches completed lessons in `.build-cache`. Remove that cache before rebuilding after a source or converter change.

The PDF, generated lesson text, and extracted artwork stay together in this static guide. No external fonts, accounts, or network requests are needed to read the guide. Search does not include text inside extracted equation or figure images; those remain available visually and in the source PDF.

## Verify

Run `node tools/verify-guide.mjs` to check chapter coverage, lesson IDs, source-page ranges, and image references.

## Publish

Static hosting serves the `main` branch from the repository root. Push changes to `main` to update the reading site.
