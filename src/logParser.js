// Parses Android logcat "threadtime" lines:
// 09-16 19:54:44.504   860  1280 E CamX    : message
const LINE =
  /^\uFEFF?\s*(?:\d{4}-)?(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(?:[A-Za-z0-9_]+\s+)??(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s(.*)$/

export const LEVELS = 'VDIWEFA'

export function parseLog(text, onProgress) {
  const out = []
  let cur = null
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (onProgress && i % 25000 === 0) onProgress(i / lines.length)
    const line = lines[i]
    const m = LINE.exec(line)
    if (m) {
      cur = { date: m[1], time: m[2], pid: m[3], tid: m[4], lv: m[5], tag: m[6], msg: m[7], extra: [] }
      out.push(cur)
    } else if (cur && line.trim()) {
      cur.extra.push(line.trim()) // stack trace / continuation line
    }
  }
  if (onProgress) onProgress(1)
  return out
}

export const fullMessage = (e) => (e.extra ? [e.msg, ...e.extra].join('\n') : e.msg)

// "2026-09-16T19:54" -> "09-16 19:54" (logs have no year)
export const toStamp = (v) => (v ? v.slice(5, 10) + ' ' + v.slice(11, 16) : '')

export function filterEntries(entries, { search, level, from, to }) {
  const q = search.trim().toLowerCase()
  const f = toStamp(from)
  const t = toStamp(to)
  return entries.filter((e) => {
    if (level !== 'ALL' && e.lv !== level) return false
    const key = e.date + ' ' + e.time
    if (f && key < f) return false
    if (t && key > t + ':59.999') return false
    if (q && !(e._s ??= (e.tag + ' ' + fullMessage(e)).toLowerCase()).includes(q)) return false // lowercase text cached per entry
    return true
  })
}

export function summarizeErrors(entries) {
  const groups = new Map()
  for (const e of entries) {
    if (e.lv !== 'E' && e.lv !== 'F') continue
    const norm = (e._n ??= e.msg.replace(/0x[0-9a-f]+/gi, '#').replace(/\d+/g, '#').slice(0, 160))
    const key = e.tag + '|' + norm
    const stamp = e.date + ' ' + e.time
    const g = groups.get(key) || { tag: e.tag, msg: e.msg.slice(0, 160), count: 0, first: stamp, last: stamp }
    g.count++
    g.last = stamp
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export function computeStats(entries) {
  const byLevel = {}, byTag = {}, byMinute = {}
  for (const e of entries) {
    byLevel[e.lv] = (byLevel[e.lv] || 0) + 1
    byTag[e.tag] = (byTag[e.tag] || 0) + 1
    byMinute[e.min] = (byMinute[e.min] || 0) + 1
  }
  return { byLevel, byTag, byMinute }
}
