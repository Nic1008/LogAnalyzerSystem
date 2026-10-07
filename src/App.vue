<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Chart from 'chart.js/auto'
import { LEVELS } from './logParser'

// All heavy work (reading, parsing, filtering, stats, export) runs in a Web Worker.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

const PAGE = 200 // rows drawn at first; "Show more" adds 500 at a time
const BIG_EXCEL = 100000 // warn before building an Excel file with more rows than this

// ---- State coming back from the worker ----
const total = ref(0)
const count = ref(0)
const stats = shallowRef({ byLevel: {}, tagCount: 0, topTags: [], minutes: { labels: [], values: [], bucket: 1 } })
const errors = shallowRef([])
const errorTypes = ref(0)
const rows = shallowRef([])
const rowsSearch = ref('')
const rangeNote = ref('')
const report = ref([])
const visible = ref(PAGE)

// ---- Filters ----
const searchInput = ref('') // what the user types (instant)
const search = ref('') // what the filters use (updated 300 ms after typing stops)
const level = ref('ALL')
const from = ref('')
const to = ref('')
const fileInput = ref(null)
let searchTimer
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (search.value = v), 400)
})

// ---- Progress bar ----
const busy = ref(false)
const pct = ref(0)
const busyLabel = ref('')

// ---- Theme (light = Clean, dark = Console colours) ----
const saved = localStorage.getItem('theme')
const theme = ref(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
document.documentElement.dataset.theme = theme.value
const toggleTheme = () => (theme.value = theme.value === 'dark' ? 'light' : 'dark')

// ---- Talking to the worker ----
let reqId = 0
function requestFilter() {
  visible.value = PAGE
  worker.postMessage({
    type: 'filter', id: ++reqId, limit: PAGE,
    params: { search: search.value, level: level.value, from: from.value, to: to.value },
  })
}
watch([search, level, from, to], requestFilter)

worker.onmessage = (ev) => {
  const m = ev.data
  if (m.type === 'progress') {
    busy.value = true
    pct.value = m.pct
    busyLabel.value = m.label
  } else if (m.type === 'loaded') {
    total.value = m.total
    rangeNote.value = m.rangeNote
    report.value = m.report
    busyLabel.value = 'Applying filters...'
    requestFilter()
  } else if (m.type === 'result') {
    if (m.id !== reqId) return // an older request; ignore
    count.value = m.count
    stats.value = m.stats
    errors.value = m.errors
    errorTypes.value = m.errorTypes
    rows.value = m.rows
    rowsSearch.value = m.search
    busy.value = false
  } else if (m.type === 'rows') {
    rows.value = m.rows
  } else if (m.type === 'exported') {
    download(m.blob, m.filename)
    busy.value = false
  } else if (m.type === 'error') {
    busy.value = false
    rangeNote.value = m.message
  }
}

function onFile(ev) {
  const file = ev.target.files[0]
  if (!file) return
  busy.value = true
  pct.value = 0
  busyLabel.value = 'Reading file...'
  report.value = []
  worker.postMessage({ type: 'load', file })
}

function reset() {
  worker.postMessage({ type: 'clear' })
  if (fileInput.value) fileInput.value.value = ''
  clearTimeout(searchTimer)
  searchInput.value = ''
  search.value = ''
  from.value = ''
  to.value = ''
  level.value = 'ALL'
  total.value = 0
  rangeNote.value = ''
  report.value = []
  requestFilter()
}

function showMore() {
  visible.value += 500
  worker.postMessage({ type: 'rows', limit: visible.value })
}

function onExport(format) {
  if (!count.value) return alert('Nothing to export. Upload a log file first.')
  if (format === 'xlsx' && count.value > BIG_EXCEL &&
      !confirm(`${count.value.toLocaleString()} rows is very large for Excel. It can take a minute or crash the tab.\n\nTip: use "Export CSV" for big results, or narrow the filters.\n\nContinue with Excel anyway?`)) return
  busy.value = true
  pct.value = 50
  busyLabel.value = 'Building file...'
  worker.postMessage({ type: 'export', format })
}

function download(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// ---- Highlighting ----
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const hlRe = computed(() => {
  const q = rowsSearch.value.trim()
  return q ? new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null
})
function highlight(text) {
  const safe = esc(text)
  return hlRe.value ? safe.replace(hlRe.value, (m) => `<mark>${m}</mark>`) : safe
}

// ---- Charts ----
const cLevel = ref(null)
const cTag = ref(null)
const cTime = ref(null)
const charts = {}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

// Charts are created once and then updated in place (much cheaper than rebuilding them)
function createCharts() {
  Object.values(charts).forEach((c) => c.destroy())
  Chart.defaults.color = cssVar('--mute')
  Chart.defaults.borderColor = cssVar('--line')
  const acc = cssVar('--acc')
  const base = { maintainAspectRatio: false, animation: false }
  charts.level = new Chart(cLevel.value, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: cssVar('--panel') }] },
    options: { ...base, plugins: { title: { display: true, text: 'Entries by level' } } },
  })
  charts.tag = new Chart(cTag.value, {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Entries', data: [], backgroundColor: acc }] },
    options: { ...base, indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Top 10 tags' } } },
  })
  charts.time = new Chart(cTime.value, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Entries', data: [], borderColor: acc, backgroundColor: acc + '22', fill: true, tension: 0.25, pointRadius: 0, pointHitRadius: 8 }] },
    options: { ...base, plugins: { legend: { display: false }, title: { display: true, text: 'Entries per minute' } } },
  })
  updateCharts()
}

function updateCharts() {
  if (!charts.level) return
  const s = stats.value
  const lv = LEVELS.split('').filter((l) => s.byLevel[l])
  charts.level.data.labels = lv
  charts.level.data.datasets[0].data = lv.map((l) => s.byLevel[l])
  charts.level.data.datasets[0].backgroundColor = lv.map((l) => cssVar('--' + l))
  charts.tag.data.labels = s.topTags.map((t) => t[0])
  charts.tag.data.datasets[0].data = s.topTags.map((t) => t[1])
  charts.time.data.labels = s.minutes.labels
  charts.time.data.datasets[0].data = s.minutes.values
  charts.time.options.plugins.title.text = s.minutes.bucket > 1 ? 'Entries over time (grouped)' : 'Entries per minute'
  Object.values(charts).forEach((c) => c.update('none'))
}

onMounted(createCharts)
watch(stats, updateCharts)
watch(theme, (t) => {
  document.documentElement.dataset.theme = t
  localStorage.setItem('theme', t)
  createCharts()
})
onBeforeUnmount(() => {
  worker.terminate()
  Object.values(charts).forEach((c) => c.destroy())
})
</script>

<template>
  <main>
    <header class="top">
      <h1>Log Analyzer<small>Android logcat explorer</small></h1>
      <button class="theme" @click="toggleTheme" :aria-label="'Switch to ' + (theme === 'dark' ? 'light' : 'night') + ' mode'">
        {{ theme === 'dark' ? '☀ Light mode' : '☾ Night mode' }}
      </button>
    </header>

    <section class="card">
      <div class="filters">
        <label style="flex: 1 1 220px">1. Upload log file (.txt, .log or .zip)
          <input ref="fileInput" type="file" accept=".txt,.log,.zip,.gz,text/plain,application/zip" @change="onFile" />
        </label>
        <label>2. Search text
          <input v-model="searchInput" type="text" placeholder="e.g. NULL or camx" />
        </label>
        <label style="flex: 0 1 150px">3. Level
          <select v-model="level">
            <option value="ALL">All levels</option>
            <option value="D">D - Debug</option>
            <option value="I">I - Info</option>
            <option value="W">W - Warning</option>
            <option value="E">E - Error</option>
          </select>
        </label>
        <label style="flex: 0 1 200px">4. From (date/time)
          <input v-model="from" type="datetime-local" />
        </label>
        <label style="flex: 0 1 200px">To (date/time)
          <input v-model="to" type="datetime-local" />
        </label>
        <button @click="reset">Reset</button>
        <button class="primary" @click="onExport('xlsx')">5. Export Excel</button>
        <button @click="onExport('csv')">Export CSV</button>
      </div>
      <div v-if="busy" class="progress" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><div :style="{ width: pct + '%' }"></div></div>
      <p class="note" style="margin-top: 10px">
        {{ busy ? busyLabel : 'Logs have no year, so the date filter compares month, day and time only. ' + rangeNote }}
      </p>
      <details v-if="report.length" class="note"><summary>Files read ({{ report.length }})</summary><ul><li v-for="r in report" :key="r">{{ r }}</li></ul></details>
    </section>

    <div class="kpis">
      <div class="card kpi"><b>{{ total.toLocaleString() }}</b><span>Total entries</span></div>
      <div class="card kpi"><b>{{ count.toLocaleString() }}</b><span>Matching filters</span></div>
      <div class="card kpi bad"><b>{{ (stats.byLevel.E || 0).toLocaleString() }}</b><span>Errors</span></div>
      <div class="card kpi warn"><b>{{ (stats.byLevel.W || 0).toLocaleString() }}</b><span>Warnings</span></div>
      <div class="card kpi"><b>{{ errorTypes }}</b><span>Unique error types</span></div>
      <div class="card kpi"><b>{{ stats.tagCount }}</b><span>Tags</span></div>
    </div>

    <div class="charts">
      <div class="card chartbox"><canvas ref="cLevel"></canvas></div>
      <div class="card chartbox"><canvas ref="cTag"></canvas></div>
      <div class="card chartbox"><canvas ref="cTime"></canvas></div>
    </div>

    <section class="card">
      <h2>Error summary (Error and Fatal, grouped by tag and message)</h2>
      <div class="scroll">
        <table>
          <thead><tr><th>Count</th><th>Tag</th><th>Message</th><th>First seen</th><th>Last seen</th></tr></thead>
          <tbody>
            <tr v-for="g in errors" :key="g.tag + g.msg">
              <td class="cnt">{{ g.count }}</td><td>{{ g.tag }}</td><td class="m">{{ g.msg }}</td><td>{{ g.first }}</td><td>{{ g.last }}</td>
            </tr>
            <tr v-if="!errors.length"><td colspan="5">No errors in the current selection.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Log entries
        <span class="note">
          {{ count > visible ? `(showing ${visible.toLocaleString()} of ${count.toLocaleString()}; exports contain all)` : `(${count.toLocaleString()})` }}
        </span>
      </h2>
      <div class="scroll tall">
        <table>
          <thead><tr><th>Date</th><th>Time</th><th>PID</th><th>TID</th><th>Lv</th><th>Tag</th><th>Message</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in rows" :key="i" v-memo="[e, rowsSearch]">
              <td>{{ e.date }}</td><td>{{ e.time }}</td><td>{{ e.pid }}</td><td>{{ e.tid }}</td>
              <td><span :class="['pill', e.lv]">{{ e.lv }}</span></td><td>{{ e.tag }}</td>
              <td class="m" v-html="highlight(e.msg)"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="count > visible" style="margin: 10px 0 0">
        <button @click="showMore">Show 500 more</button>
      </p>
    </section>
  </main>
</template>
