import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-indigo-600 text-white'
      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
  }`

export function NavBar() {
  return (
    <nav className="border-b border-black bg-gray-950">
      <div className="mx-auto flex max-w-4xl items-center gap-2 overflow-x-auto px-4 py-3">
        <span className="mr-2 flex shrink-0 items-center gap-2 text-sm font-semibold text-white">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          個人財富管理工具
        </span>
        <NavLink to="/" end className={linkClass}>
          儀表板
        </NavLink>
        <NavLink to="/journey" className={linkClass}>
          行動路線
        </NavLink>
        <NavLink to="/handbook" className={linkClass}>
          策略手冊
        </NavLink>
        <NavLink to="/fire" className={linkClass}>
          財務自由試算
        </NavLink>
        <NavLink to="/records" className={linkClass}>
          收支記錄
        </NavLink>
        <NavLink to="/strategy" className={linkClass}>
          投資策略
        </NavLink>
        <NavLink to="/portfolio" className={linkClass}>
          投資組合
        </NavLink>
        <NavLink to="/trades" className={linkClass}>
          交易日誌
        </NavLink>
        <NavLink to="/market" className={linkClass}>
          市場檢視
        </NavLink>
        <NavLink to="/research" className={linkClass}>
          個股研究
        </NavLink>
        <NavLink to="/progress" className={linkClass}>
          進度追蹤
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          設定
        </NavLink>
      </div>
    </nav>
  )
}
