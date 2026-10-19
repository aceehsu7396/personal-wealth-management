import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/fubon-2026-09.json'
import { dateFromFileName, parseActuals, parseContents, parseFubonReport, parseResearchList, toLines, type PdfPage } from './fubonParse'

// Text items of the 2026/9/2 report (pages 1–2 whole, other pages reduced
// to the lines the parser reads).
const pages: PdfPage[] = (fixture as [number, number, number, string][][]).map((p) =>
  p.map(([x, y, w, str]) => ({ x, y, w, str })),
)
const report = parseFubonReport(pages, '2026-09-01')

describe('parseFubonReport', () => {
  it('reads the date and title from page 1', () => {
    expect(report.reportDate).toBe('2026-09-02')
    expect(report.reportTitle).toBe('富邦總經觀點-9月市場展望')
  })

  it('reads the allocation table with full explanations', () => {
    expect(report.allocation.map((a) => a.asset)).toEqual([
      '美國公債', '台灣公債', '中國公債', '美國股市', '歐洲股市', '台灣股市', '中國股市',
    ])
    expect(report.allocation.every((a) => a.view === 'neutral')).toBe(true)
    expect(report.allocation[5].note).toBe('AI需求續強支撐基本面，但Fed政策與科技股高估值牽制漲勢，預估加權指數於44,000~48,000點區間整理。')
  })

  it('finds all twelve forecast ranges', () => {
    const byIndex = Object.fromEntries(report.forecasts.map((f) => [f.index, [f.low, f.high]]))
    expect(byIndex).toEqual({
      us10y: [4.6, 5], tw10y: [1.85, 2], cn10y: [1.65, 1.75],
      sp500: [7200, 7900], stoxx600: [630, 670], taiex: [44000, 48000], csi300: [4400, 4900],
      dxy: [97, 102], eurusd: [1.13, 1.18], usdjpy: [155, 163], usdcny: [6.68, 6.78], usdtwd: [31.3, 32],
    })
  })

  it("reads last month's closes", () => {
    expect(Object.fromEntries(report.actuals.map((a) => [a.index, a.value]))).toEqual({
      sp500: 7686.2, taiex: 46128, dxy: 99.4, usdjpy: 159.7, usdcny: 6.72, usdtwd: 31.67,
    })
  })

  it('reads the S&P 500 valuation band', () => {
    expect(report.valuation).toEqual({ pe: 19.5, average: 19.13, sdLow: 16.94, sdHigh: 21.32 })
  })

  it('groups ➢ key points by the table of contents', () => {
    expect(report.sections.map((s) => s.title)).toEqual(['總經觀點', '外匯市場', '債券市場', '成熟/新興市場'])
    expect(report.sections[0].bullets[0]).toEqual({ text: '長天期公債拋壓浮現', page: 'p.3' })
    expect(report.summary.startsWith('長天期公債拋壓浮現；')).toBe(true)
  })
})

describe('helpers', () => {
  it('splits a table of contents without spaces', () => {
    expect(parseContents(toLines(pages[0]))).toEqual([
      { title: '月度配置觀點', from: 2, to: 2 },
      { title: '總經觀點', from: 3, to: 5 },
      { title: '外匯市場', from: 6, to: 9 },
      { title: '債券市場', from: 10, to: 12 },
      { title: '成熟/新興市場', from: 13, to: 16 },
      { title: '財經大事曆', from: 17, to: 17 },
    ])
  })

  it('dates a report from its file name', () => {
    expect(dateFromFileName('富邦市場展望090226.pdf')).toBe('2026-09-02')
  })
})

describe('research list and newer layouts', () => {
  it('finds outlooks by title, whatever the file name, newest upload first', () => {
    const row = (date: string, href: string, title: string) =>
      `<tr class="x"><td class="a">${date} </td><td><a href="${href}" target="_blank" class="b">${title}</a></td></tr>`
    const html = [
      row('2026/09/02', '/api/publish/report/富邦市場展望090226.pdf', '富邦總經觀點-9月市場展望'),
      row('2026/10/08', '/api/publish/report/94416f5f-69da-4124-bee8-72f2ef601f0a.pdf', '富邦總經觀點-9月市場展望'),
      row('2026/09/20', '/api/publish/report/abc.pdf', '富邦總經分析-拉丁美洲經濟展望'),
    ].join('') + '"\\u002Fapi\\u002Fpublish\\u002Freport\\u002F富邦市場展望080526.pdf"'
    expect(parseResearchList(html)).toEqual([
      { path: '/api/publish/report/94416f5f-69da-4124-bee8-72f2ef601f0a.pdf', title: '富邦總經觀點-9月市場展望', listedDate: '2026-10-08' },
      { path: '/api/publish/report/富邦市場展望090226.pdf', title: '富邦總經觀點-9月市場展望', listedDate: '2026-09-02' },
      { path: '/api/publish/report/富邦市場展望080526.pdf', title: '', listedDate: '2026-08-05' },
    ])
  })

  it('reads a table of contents numbered with Roman numerals', () => {
    expect(parseContents(['I.月度配置觀點P2IV.債券市場P10-12', 'II.總經觀點P3-5V.成熟/新興市場P13-16', 'III.外匯市場P6-9VI.財經大事曆P17', '1'])).toEqual([
      { title: '月度配置觀點', from: 2, to: 2 },
      { title: '總經觀點', from: 3, to: 5 },
      { title: '外匯市場', from: 6, to: 9 },
      { title: '債券市場', from: 10, to: 12 },
      { title: '成熟/新興市場', from: 13, to: 16 },
      { title: '財經大事曆', from: 17, to: 17 },
    ])
  })

  it('reads 「月底…升至」 closes', () => {
    expect(parseActuals('月底美元指數升至101.8，全月升幅逾2%', [{ index: 'dxy', low: 97, high: 102 }])).toEqual([{ index: 'dxy', value: 101.8 }])
  })
})
