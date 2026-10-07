// Runs in a Web Worker: reading, parsing, filtering, stats and export all happen
// here so the page never freezes, even with 500,000+ lines.
import { readLogFile } from './readLogFile'
import { parseLog, filterEntries, computeStats, summarizeErrors, fullMessage } from './logParser'
import { buildXlsx, buildCsv } from './exporters'

let entries = []
let filtered = []
let errorsAll = []
let stats = { byLevel: {}, byTag: {}, byMinute: {} }

const post = (m) => self.postMessage(m)

// Keep the per-minute series small so the chart (and the message to the page) stays cheap
function shrink(byMinute, max = 300) {
  const keys = Object.keys(byMinute).sort()
  const size = Math.max(1, Math.ceil(keys.length / max))
  const labels = []
  const values = []
  for (let i = 0; i < keys.length; i += size) {
    let sum = 0
    for (let j = i; j < Math.min(i + size, keys.length); j++) sum += byMinute[keys[j]]
    labels.push(keys[i])
    values.push(sum)
  }
  return { labels, values, bucket: size }
}
const progress = (label, pct) => post({ type: 'progress', label, pct })
const slice = (n) =>
  filtered.slice(0, n).map((e) => ({ date: e.date, time: e.time, pid: e.pid, tid: e.tid, lv: e.lv, tag: e.tag, msg: fullMessage(e) }))

async function load(file) {
  progress('Reading file...', 0)
  const { files, zipped } = await readLogFile(file)
  let list = []
  const report = []
  const firstLines = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const parsed = parseLog(f.text, (p) => progress(`Parsing ${f.name}`, Math.round(((i + p) / files.length) * 100)))
    report.push(`${f.name} - ${Math.max(1, Math.round(f.text.length / 1024))} KB, ${parsed.length} log entries`)
    firstLines.push((f.text.trim().split(/\r?\n/)[0] || '').slice(0, 140))
    list = list.concat(parsed)
  }
  if (files.length > 1) {
    progress('Sorting entries by time...', 100)
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  }
  entries = list
  const src = zipped ? `Read ${files.length} file(s). ` : ''
  const rangeNote = list.length
    ? `${src}Log range: ${list[0].date} ${list[0].time} to ${list.at(-1).date} ${list.at(-1).time}.`
    : `${src}No logcat lines recognized.` + (files.length ? ` First line of the first file: "${firstLines[0]}"` : ' The file contained no readable text files.')
  post({ type: 'loaded', total: list.length, rangeNote, report })
}

function runFilter(m) {
  filtered = filterEntries(entries, m.params)
  stats = computeStats(filtered)
  errorsAll = summarizeErrors(filtered)
  post({
    type: 'result', id: m.id, search: m.params.search, count: filtered.length,
    stats: {
      byLevel: stats.byLevel,
      tagCount: Object.keys(stats.byTag).length,
      topTags: Object.entries(stats.byTag).sort((a, b) => b[1] - a[1]).slice(0, 10),
      minutes: shrink(stats.byMinute),
    },
    errorTypes: errorsAll.length, errors: errorsAll.slice(0, 200), rows: slice(m.limit),
  })
}

function doExport(format) {
  progress('Building file... this can take a while for large results', 50)
  if (format === 'csv') {
    post({ type: 'exported', filename: 'log-report.csv', blob: new Blob(buildCsv(filtered), { type: 'text/csv;charset=utf-8' }) })
  } else {
    const data = buildXlsx(filtered, errorsAll, stats)
    post({ type: 'exported', filename: 'log-report.xlsx', blob: new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) })
  }
}

self.onmessage = async (ev) => {
  const m = ev.data
  try {
    if (m.type === 'load') await load(m.file)
    else if (m.type === 'filter') runFilter(m)
    else if (m.type === 'rows') post({ type: 'rows', rows: slice(m.limit) })
    else if (m.type === 'export') doExport(m.format)
    else if (m.type === 'clear') { entries = []; filtered = []; errorsAll = [] }
  } catch (err) {
    post({ type: 'error', message: 'Something went wrong: ' + err.message })
  }
}
