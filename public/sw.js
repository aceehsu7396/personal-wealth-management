// Service worker for payload-free push (stage 6). The push carries no
// data: the notification is written from the site's public daily brief
// (data/brief.json) and this device's own count of today's items, saved in
// IndexedDB by the today page. Nothing personal goes through the server.

const scope = self.registration.scope

function todaySummary() {
  return new Promise((resolve) => {
    const req = indexedDB.open('pfm-push', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('today')
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }
  })
}

async function brief() {
  try {
    const res = await fetch(`${scope}data/brief.json`, { cache: 'no-cache' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function notify() {
  const [b, t] = await Promise.all([brief(), todaySummary()])
  const lines = []
  if (t && t.total > 0) lines.push(`今天有 ${t.total} 件事要處理${t.required ? `，其中 ${t.required} 項紀律要求` : ''}。${t.first ? `第一項：${t.first}` : ''}`)
  else lines.push('打開網站看看今天要處理的事。')
  if (b && b.regime) lines.push(`局勢：${b.regime.label}${b.regime.changed ? '（剛改變）' : ''}`)
  if (b && b.events && b.events.length) lines.push(b.events.map((e) => `${e.date.slice(5).replace('-', '/')} ${e.title}`).join('、'))
  await self.registration.showNotification('收盤後檢查', { body: lines.join('\n'), tag: 'daily', icon: `${scope}favicon.svg` })
}

self.addEventListener('push', (event) => event.waitUntil(notify()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(`${scope}#/today`))
})
