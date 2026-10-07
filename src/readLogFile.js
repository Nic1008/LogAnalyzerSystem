import JSZip from 'jszip'

const SKIP = /\.(png|jpe?g|gif|bmp|webp|7z|rar|apk|pdf|db|bin|so|dex)$/i
const numeric = (a, b) => a.localeCompare(b, undefined, { numeric: true })

// Handles UTF-8 and UTF-16 (BOM) text
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  return new TextDecoder('utf-8').decode(buf)
}

async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Recursively unpacks .zip / .gz and collects every text file
async function collect(name, buf, out, depth = 0) {
  if (/\.gz$/i.test(name)) {
    try { buf = await gunzip(buf) } catch { return }
    name = name.replace(/\.gz$/i, '')
  }
  if (/\.zip$/i.test(name) && depth < 4) {
    const zip = await JSZip.loadAsync(buf)
    const names = Object.keys(zip.files)
      .filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX') && !n.split('/').pop().startsWith('.'))
      .sort(numeric)
    for (const n of names) await collect(`${name}/${n}`, await zip.files[n].async('uint8array'), out, depth + 1)
    return
  }
  if (!SKIP.test(name)) out.push({ name, text: decode(buf) })
}

// Returns { files: [{ name, text }], zipped }
export async function readLogFile(file) {
  const files = []
  await collect(file.name, new Uint8Array(await file.arrayBuffer()), files)
  return { files, zipped: /\.(zip|gz)$/i.test(file.name) }
}
