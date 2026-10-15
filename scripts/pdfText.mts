import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfPage } from '../src/lib/macro/fubonParse'

// Text items of every page, with positions, for the rule-based parser.
export async function pdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const doc = await getDocument({ data, verbosity: 0 }).promise
  const pages: PdfPage[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    pages.push(
      content.items
        .filter((it) => 'str' in it && it.str.trim() !== '')
        .map((it) => {
          const t = it as { str: string; transform: number[]; width: number }
          return { x: Math.round(t.transform[4]), y: Math.round(t.transform[5]), w: Math.round(t.width), str: t.str }
        }),
    )
  }
  await doc.cleanup()
  return pages
}
