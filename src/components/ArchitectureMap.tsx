import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ARCH_EDGES,
  ARCH_LAYERS,
  ARCH_NODES,
  edgesInto,
  edgesOutOf,
  nodeStatus,
  type ArchEdge,
  type NodeStatus,
} from '../lib/architecture'
import { useJourney } from '../lib/useJourney'

const STATUS_MARK: Record<NodeStatus, string> = { done: '✓', current: '▶', todo: '○', ongoing: '↻' }
const STATUS_LABEL: Record<NodeStatus, string> = { done: '已完成', current: '目前這一步', todo: '尚未開始', ongoing: '持續使用' }
const STATUS_STYLE: Record<NodeStatus, string> = {
  done: 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
  current: 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-600 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-100 dark:ring-indigo-400',
  todo: 'border-dashed border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400',
  ongoing: 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
}
const EDGE_DASH: Record<ArchEdge['kind'], string | undefined> = { flow: undefined, gate: '6 4', feedback: '2 4' }
const EDGE_KIND_LABEL: Record<ArchEdge['kind'], string> = { flow: '資料流', gate: '關卡（通過才往下）', feedback: '回饋' }

interface Line {
  edge: ArchEdge
  d: string
}

// Curved connector from the bottom of one card to the top of another, or
// side to side within a row; feedback edges loop round the right edge.
function connector(a: DOMRect, b: DOMRect, box: DOMRect, kind: ArchEdge['kind']): string {
  const ax = a.left + a.width / 2 - box.left
  const bx = b.left + b.width / 2 - box.left
  if (kind === 'feedback' && b.top < a.top) {
    const x = box.width - 6
    const ay = a.top + a.height / 2 - box.top
    const by = b.top + b.height / 2 - box.top
    return `M ${a.right - box.left} ${ay} C ${x} ${ay}, ${x} ${by}, ${b.right - box.left} ${by}`
  }
  if (Math.abs(a.top - b.top) < 4) {
    const y = a.top + a.height / 2 - box.top
    const [x1, x2] = a.left < b.left ? [a.right - box.left, b.left - box.left] : [a.left - box.left, b.right - box.left]
    return `M ${x1} ${y} L ${x2} ${y}`
  }
  const down = b.top > a.top
  const ay = (down ? a.bottom : a.top) - box.top
  const by = (down ? b.top : b.bottom) - box.top
  const mid = (ay + by) / 2
  return `M ${ax} ${ay} C ${ax} ${mid}, ${bx} ${mid}, ${bx} ${by}`
}

// The whole process as an interactive map (handbook chapter 00 §2): layers
// top to bottom, what each part hands on, and where you are on the roadmap.
export function ArchitectureMap() {
  const { journey } = useJourney()
  const doneSteps = new Set(journey.stages.flatMap((s) => s.steps.filter((x) => x.done).map((x) => x.id)))
  const next = journey.nextStep?.id ?? null
  const initial = Object.values(ARCH_NODES).find((n) => nodeStatus(n, doneSteps, next) === 'current')?.id ?? 'ips'
  const [selected, setSelected] = useState(initial)
  const boxRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      const rect = box.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      setLines(
        ARCH_EDGES.flatMap((edge) => {
          const a = nodeRefs.current[edge.from]?.getBoundingClientRect()
          const b = nodeRefs.current[edge.to]?.getBoundingClientRect()
          return a && b ? [{ edge, d: connector(a, b, rect, edge.kind) }] : []
        }),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const node = ARCH_NODES[selected]
  const status = nodeStatus(node, doneSteps, next)
  const related = (e: ArchEdge) => e.from === selected || e.to === selected
  const stepTitles = new Map(journey.stages.flatMap((s) => s.steps.map((x) => [x.id, x] as const)))

  return (
    <div className="not-prose mt-4">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {(Object.keys(STATUS_MARK) as NodeStatus[]).map((s) => (
          <span key={s}>
            {STATUS_MARK[s]} {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="hidden sm:inline">── 資料流　╌╌ 關卡　┈┈ 回饋</span>
        <span>點選任一方塊看說明</span>
      </div>

      <div ref={boxRef} className="relative rounded-lg border border-gray-200 bg-gray-50 p-3 pr-6 dark:border-gray-700 dark:bg-gray-900/40">
        <svg className="pointer-events-none absolute inset-0 hidden sm:block" width={size.w} height={size.h} aria-hidden="true">
          <defs>
            {['muted', 'active'].map((k) => (
              <marker key={k} id={`arch-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={k === 'active' ? 'fill-indigo-600 dark:fill-indigo-400' : 'fill-gray-300 dark:fill-gray-600'} />
              </marker>
            ))}
          </defs>
          {[...lines].sort((a, b) => Number(related(a.edge)) - Number(related(b.edge))).map(({ edge, d }) => {
            const on = related(edge)
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={d}
                fill="none"
                strokeWidth={on ? 2 : 1.25}
                strokeOpacity={on ? 1 : 0.5}
                strokeDasharray={EDGE_DASH[edge.kind]}
                markerEnd={`url(#arch-arrow-${on ? 'active' : 'muted'})`}
                className={on ? 'stroke-indigo-600 dark:stroke-indigo-400' : 'stroke-gray-300 dark:stroke-gray-600'}
              />
            )
          })}
        </svg>

        <div className="relative space-y-6">
          {ARCH_LAYERS.map((layer) => (
            <div key={layer.title} className="sm:grid sm:grid-cols-[120px_1fr] sm:items-center sm:gap-3">
              <div className="mb-1 sm:mb-0">
                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{layer.title}</p>
                <p className="text-[11px] leading-4 text-gray-500 dark:text-gray-400">{layer.summary}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                {layer.nodes.map((id) => {
                  const n = ARCH_NODES[id]
                  const s = nodeStatus(n, doneSteps, next)
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        nodeRefs.current[id] = el
                      }}
                      type="button"
                      onClick={() => setSelected(id)}
                      aria-pressed={selected === id}
                      title={`${n.title}：${STATUS_LABEL[s]}`}
                      className={`min-w-24 rounded-md border px-2.5 py-2 text-left text-sm shadow-sm transition ${STATUS_STYLE[s]} ${
                        selected === id ? 'outline-2 outline-offset-2 outline-indigo-600 dark:outline-indigo-400' : 'hover:border-indigo-400'
                      }`}
                    >
                      <span className="mr-1 font-mono">{STATUS_MARK[s]}</span>
                      <span className="font-medium">{n.title}</span>
                      {n.steps.length > 0 && (
                        <span className="ml-1 text-[11px] opacity-70">
                          {n.steps.length > 2 ? `${n.steps[0]}–${n.steps[n.steps.length - 1]}` : n.steps.join('・')}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-indigo-200 bg-white p-4 dark:border-indigo-900 dark:bg-gray-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {STATUS_MARK[status]} {node.title}
            <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">{STATUS_LABEL[status]}</span>
          </p>
          <div className="flex gap-3 text-xs font-medium">
            <Link to={node.page.to} className="text-indigo-700 hover:underline dark:text-indigo-400">
              前往「{node.page.label}」→
            </Link>
            <Link to={`/handbook/${node.handbook.slug}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
              手冊 {node.handbook.label}
            </Link>
          </div>
        </div>
        <dl className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <div>
            <dt className="inline font-semibold text-gray-900 dark:text-gray-100">做什麼：</dt>
            <dd className="inline">{node.what}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-gray-900 dark:text-gray-100">為什麼：</dt>
            <dd className="inline">{node.why}</dd>
          </div>
        </dl>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {(
            [
              ['輸入（從哪裡來）', edgesInto(selected), 'from'],
              ['輸出（交給誰）', edgesOutOf(selected), 'to'],
            ] as const
          ).map(([title, edges, side]) => (
            <div key={title}>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{title}</p>
              {edges.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">—</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {edges.map((e) => (
                    <li key={`${e.from}-${e.to}`}>
                      <button
                        type="button"
                        onClick={() => setSelected(e[side])}
                        className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                      >
                        {ARCH_NODES[e[side]].title}
                      </button>
                      <span className="text-gray-600 dark:text-gray-400">：{e.label}</span>
                      {e.kind !== 'flow' && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">（{EDGE_KIND_LABEL[e.kind]}）</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        {node.steps.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">行動路線步驟</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {node.steps.map((id) => {
                const step = stepTitles.get(id)
                return (
                  <li key={id} className={step?.done ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}>
                    {step?.done ? '✓' : id === next ? '▶' : '○'} {id} {step?.title}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
