// UI check for docs/ui-guidelines.md: screenshots each page at laptop size
// (light and dark) and on a phone, measures what can be measured, and writes
// a Markdown report. Used by the ui-review skill before a page ships.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/ui-check.mjs                       # every page, demo data
//   node scripts/ui-check.mjs /sim/strategies /notes  # some pages
//   node scripts/ui-check.mjs --base https://aceehsu7396.github.io/personal-wealth-management/# --out /tmp/ui
//
// Options: --base <url up to "#">, --out <dir>, --no-demo (empty data).
// The browser comes from CHROME_PATH or the local Playwright cache.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const ALL_PAGES = [
  '/research/market',
  '/research/screener',
  '/research/stocks',
  '/sim/strategies',
  '/sim/backtest',
  '/sim/paper',
  '/today',
  '/goals',
  '/portfolio',
  '/portfolio/plans',
  '/portfolio/risk',
  '/portfolio/trades',
  '/portfolio/review',
  '/portfolio/calibration',
  '/notes',
  '/handbook/00',
  '/journey',
  '/settings',
]

// Laptop sizes are the main review; the phone only checks overflow and errors.
const VIEWS = [
  { name: '筆電淺色', id: 'laptop-light', width: 1366, height: 768, scheme: 'light', full: true },
  { name: '筆電深色', id: 'laptop-dark', width: 1440, height: 900, scheme: 'dark', full: true },
  { name: '手機', id: 'phone', width: 390, height: 844, scheme: 'dark', full: false },
]

// Thresholds from the guidelines (§4, §5, §8).
const LIMITS = { primaryButtons: 1, longText: 220, minFontPx: 12 }

function parseArgs(argv) {
  const opts = { base: 'http://localhost:4173/personal-wealth-management/#', out: join(tmpdir(), 'ui-check'), demo: true, pages: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--no-demo') opts.demo = false
    else opts.pages.push(a)
  }
  if (opts.pages.length === 0) opts.pages = ALL_PAGES
  return opts
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    for (const p of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
    ]) {
      if (existsSync(join(cache, d, p))) return join(cache, d, p)
    }
  }
  throw new Error('找不到 Chromium：請設定 CHROME_PATH，或執行 npx playwright install chromium')
}

// Runs in the page: everything measured without axe.
function measure({ limits, viewportHeight }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const inFirstScreen = (el) => {
    const r = el.getBoundingClientRect()
    return r.top < viewportHeight && r.bottom > 0
  }
  const main = document.querySelector('#root') ?? document.body
  // The top navigation and fixed-position controls (the notes button) are
  // site chrome, not the page's own content.
  const chrome = (el) => !!el.closest('nav') || [...ancestors(el)].some((a) => getComputedStyle(a).position === 'fixed')
  function* ancestors(el) {
    for (let a = el; a && a !== document.body; a = a.parentElement) yield a
  }
  const h1 = [...main.querySelectorAll('h1')].filter(visible)
  const headings = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => Number(h.tagName[1]))
  const skips = []
  for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) skips.push(`h${headings[i - 1]}→h${headings[i]}`)
  // Primary buttons: solid indigo, the style the guidelines reserve for the main action.
  const primaries = [...main.querySelectorAll('button, a')].filter((el) => visible(el) && !chrome(el) && /\bbg-indigo-600\b/.test(el.className))
  const buttons = [...main.querySelectorAll('button')].filter((el) => visible(el) && !chrome(el))
  const longest = [...main.querySelectorAll('p, li')]
    .filter(visible)
    .map((el) => ({ len: el.innerText.trim().length, text: el.innerText.trim().slice(0, 30) }))
    .sort((a, b) => b.len - a.len)[0]
  const small = [...main.querySelectorAll('body *')].filter((el) => {
    // Chart axes (SVG text) are left to the chart; the rule is for reading text.
    if (!visible(el) || el.children.length > 0 || !el.textContent.trim() || el.closest('svg')) return false
    return parseFloat(getComputedStyle(el).fontSize) < limits.minFontPx
  })
  return {
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    h1Count: h1.length,
    h1InFirstScreen: h1.some(inFirstScreen),
    headingSkips: [...new Set(skips)],
    buttons: buttons.length,
    primaryButtons: primaries.length,
    primaryInFirstScreen: primaries.some(inFirstScreen),
    longestText: longest ?? { len: 0, text: '' },
    smallText: small.length,
    smallSample: small.slice(0, 3).map((el) => el.textContent.trim().slice(0, 20)),
  }
}

async function axeCheck(page) {
  await page.addScriptTag({ content: AXE })
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: ['color-contrast', 'button-name', 'link-name', 'heading-order', 'image-alt'] })
    return r.violations.map((v) => ({ id: v.id, count: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) }))
  })
}

async function loadDemo(page, base) {
  await page.goto(`${base}/settings`)
  const load = page.getByRole('button', { name: '載入示範資料' })
  if (await load.count()) {
    await load.click()
    await page.getByRole('button', { name: '結束示範，還原我的資料' }).first().waitFor({ timeout: 60000 })
  }
}

function issuesOf(m, view) {
  const out = []
  if (m.errors.length) out.push(`主控台錯誤 ${m.errors.length} 個：${m.errors[0].slice(0, 80)}`)
  if (m.overflowX > 0) out.push(`水平溢出 ${m.overflowX}px`)
  if (!view.full) return out
  if (m.h1Count !== 1) out.push(`頁面標題（h1）有 ${m.h1Count} 個，應為 1 個`)
  else if (!m.h1InFirstScreen) out.push('第一個畫面看不到頁面標題')
  if (m.primaryButtons > LIMITS.primaryButtons) out.push(`主要按鈕（實心靛藍）有 ${m.primaryButtons} 個，建議一頁 1 個`)
  if (m.primaryButtons > 0 && !m.primaryInFirstScreen) out.push('主要按鈕不在第一個畫面')
  if (m.headingSkips.length) out.push(`標題層級跳級：${m.headingSkips.join('、')}`)
  if (m.longestText.len > LIMITS.longText) out.push(`有一段文字 ${m.longestText.len} 字（「${m.longestText.text}…」），建議拆短或收合`)
  if (m.smallText > 0) out.push(`小於 ${LIMITS.minFontPx}px 的文字 ${m.smallText} 處（例：${m.smallSample.join('、')}）`)
  for (const v of m.axe) out.push(`無障礙 ${v.id}：${v.count} 處（${v.sample.join('；')}）`)
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(opts.out, { recursive: true })
  const browser = await chromium.launch({ executablePath: chromePath() })
  const results = []
  for (const view of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.scheme })
    const page = await ctx.newPage()
    let errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
    if (opts.demo) await loadDemo(page, opts.base)
    for (const path of opts.pages) {
      errors = []
      await page.goto(`${opts.base}${path}`)
      await page.waitForTimeout(2500)
      const m = await page.evaluate(measure, { limits: LIMITS, viewportHeight: view.height })
      m.axe = view.full ? await axeCheck(page) : []
      m.errors = [...errors]
      const shot = join(opts.out, `${path.replace(/[/:]/g, '_').replace(/^_/, '') || 'home'}-${view.id}.png`)
      await page.screenshot({ path: shot, fullPage: false })
      results.push({ path, view, m, shot, issues: issuesOf(m, view) })
    }
    await ctx.close()
  }
  await browser.close()

  const lines = [`# UI 檢查報告（${new Date().toISOString().slice(0, 16).replace('T', ' ')}）`, '', `網址：${opts.base}；示範資料：${opts.demo ? '是' : '否'}`, '']
  lines.push('| 頁面 | 畫面 | 問題數 | 按鈕 | 主要按鈕 | 最長段落 |', '|---|---|---|---|---|---|')
  for (const r of results) {
    lines.push(`| ${r.path} | ${r.view.name} | ${r.issues.length} | ${r.view.full ? r.m.buttons : '—'} | ${r.view.full ? r.m.primaryButtons : '—'} | ${r.view.full ? r.m.longestText.len : '—'} |`)
  }
  for (const r of results.filter((x) => x.issues.length)) {
    lines.push('', `## ${r.path}（${r.view.name}）`, '', ...r.issues.map((i) => `- ${i}`), '', `截圖：${r.shot}`)
  }
  lines.push('', '自動檢查只量得到一部分規範；第一個畫面的內容、三層結構、文字是否白話，要看截圖逐條對照 docs/ui-guidelines.md §9。')
  const report = join(opts.out, 'report.md')
  writeFileSync(report, `${lines.join('\n')}\n`)
  const total = results.reduce((a, r) => a + r.issues.length, 0)
  console.log(`[ui-check] ${results.length} 個畫面、${total} 個問題；報告：${report}`)
}

await main()
