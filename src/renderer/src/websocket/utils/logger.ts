// @ts-nocheck
function timestamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default class Logger {
  static log(text) {
    console.log(`[${timestamp()}] ${text}`)
  }
}

export function installConsoleTimestamp() {
  const _log   = console.log.bind(console)
  const _warn  = console.warn.bind(console)
  const _error = console.error.bind(console)

  console.log = (...args) => _log(`[${timestamp()}]`, ...args)
  console.warn = (...args) => _warn(`[${timestamp()}]`, ...args)
  console.error = (...args) => _error(`[${timestamp()}]`, ...args)
}