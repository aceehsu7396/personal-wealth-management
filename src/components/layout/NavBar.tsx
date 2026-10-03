import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-emerald-600 text-white'
      : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
  }`

export function NavBar() {
  return (
    <nav className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="mx-auto flex max-w-4xl items-center gap-2 overflow-x-auto px-4 py-3">
        <span className="mr-2 shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
          個人財富管理工具
        </span>
        <NavLink to="/" end className={linkClass}>
          儀表板
        </NavLink>
        <NavLink to="/fire" className={linkClass}>
          FIRE 試算
        </NavLink>
        <NavLink to="/strategy" className={linkClass}>
          投資策略
        </NavLink>
        <NavLink to="/market" className={linkClass}>
          市場檢視
        </NavLink>
        <NavLink to="/research" className={linkClass}>
          個股研究
        </NavLink>
        <NavLink to="/portfolio" className={linkClass}>
          投資組合
        </NavLink>
        <NavLink to="/progress" className={linkClass}>
          進度追蹤
        </NavLink>
        <NavLink to="/records" className={linkClass}>
          收支記錄
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          設定
        </NavLink>
      </div>
    </nav>
  )
}
