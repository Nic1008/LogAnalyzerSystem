# Log Analyzer (Vue 3 + Vite)

Upload an Android logcat file, then search, filter by level and date, view an error summary and charts, and export to Excel. Everything runs in the browser.

## Run
```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # production build in dist/
```
Requires Node.js 18+.

## Structure
- `src/logParser.js`  parsing, filtering, error grouping, statistics
- `src/worker.js` Web Worker: reads, parses, filters and exports off the main thread
- `src/exporters.js` Excel (SheetJS) and CSV builders
- `src/readLogFile.js` reads .txt/.log/.zip/.gz
- `src/App.vue`       UI and charts (Chart.js)
