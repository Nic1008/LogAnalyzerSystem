import * as XLSX from 'xlsx'
import { fullMessage } from './logParser'

// Excel workbook (4 sheets) -> Uint8Array
export function buildXlsx(entries, errors, stats) {
  const logs = entries.map((e) => ({
    Date: e.date, Time: e.time, PID: e.pid, TID: e.tid, Level: e.lv, Tag: e.tag, Message: fullMessage(e),
  }))
  const errs = errors.map((g) => ({
    Count: g.count, Tag: g.tag, Message: g.msg, 'First seen': g.first, 'Last seen': g.last,
  }))
  const levels = Object.entries(stats.byLevel).map(([Level, Count]) => ({ Level, Count }))
  const tags = Object.entries(stats.byTag).sort((a, b) => b[1] - a[1]).map(([Tag, Count]) => ({ Tag, Count }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logs), 'Logs')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(errs), 'Error Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(levels), 'By Level')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tags), 'By Tag')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

const q = (v) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// CSV (fast, handles very large results) -> array of string chunks for a Blob
export function buildCsv(entries) {
  const parts = ['\uFEFFDate,Time,PID,TID,Level,Tag,Message\n']
  let buf = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    buf.push([e.date, e.time, e.pid, e.tid, e.lv, q(e.tag), q(fullMessage(e))].join(','))
    if (buf.length === 10000) { parts.push(buf.join('\n') + '\n'); buf = [] }
  }
  if (buf.length) parts.push(buf.join('\n') + '\n')
  return parts
}
