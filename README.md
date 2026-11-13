# 個人財富管理工具

以專業基金經理人的流程經營個人資產的網站，目標是財務獨立、全職經營自有資產。網站：https://aceehsu7396.github.io/personal-wealth-management/

## 網站內容

| 區域 | 頁面 |
|---|---|
| 研究分析 | 市場（局勢狀態、總經三支柱、每日大盤、事件日曆）、選股與觀察名單、研究卡 |
| 模擬交易 | 策略卡、回測（含偏誤檢查）、虛擬帳戶 |
| 投資持有與檢討回顧 | 今日、目標與政策、交易計畫、持股與風控、風險、交易日誌、績效歸因、檢討與校準 |
| 手冊 | 策略手冊（`docs/strategy/`）與行動路線 |

- 資料存在瀏覽器（localStorage），不需要帳號。
- **示範模式**：「設定 → 示範資料」載入手冊 12 章的完整範例，結束時還原自己的資料。
- **同步與推播（選用）**：部署自己的 Cloudflare Worker，資料在瀏覽器端加密後才上傳，步驟見 [docs/backend-setup.md](docs/backend-setup.md)。
- **AI 說明**：各頁產生提示詞，貼到自己的 Claude 對話，不需要金鑰（[docs/ai-eval.md](docs/ai-eval.md)）。

## 開發

```bash
npm install
npm run dev        # 本機開發
npm test           # 單元測試（vitest）
npm run build      # 型別檢查與建置
npm run lint       # oxlint
npm run ui-check   # 畫面檢查，規範見 docs/ui-guidelines.md
```

## 資料腳本（`scripts/`）

部署時 GitHub Actions 每天執行，產生 `public/data/` 的免費公開資料（不進版本控制）：

| 腳本 | 內容 |
|---|---|
| `macro-data.mts` | 總經指標 |
| `index-data.mts` | 市場頁的每日大盤指數 |
| `stocks-data.mts` | 選股頁的全市場個股資料 |
| `brief-data.mts` | 推播用的全市場摘要（局勢、事件） |
| `valuation-data.mts` | 全市場本益比歷史（估值面向） |
| `events-data.mts` | 事件日曆：除權息與法說會 |
| `fund-nav.mts` | 基金淨值 |

手動執行：
- `demo-data.mts`：重建示範資料 `src/lib/demo/demo-data.json`；手寫的紀錄（計畫單、暫停檢討、決策、情境）在 `demo-curated.json`。
- `stress-data.mts`：更新壓力測試的歷史情境。

## 文件

- [docs/strategy/](docs/strategy/README.md)：策略手冊
- [docs/ui-guidelines.md](docs/ui-guidelines.md)：介面規範
- [docs/backend-setup.md](docs/backend-setup.md)：同步與推播的後端設定
- [docs/ai-eval.md](docs/ai-eval.md)：AI 提示詞範本的評估

本工具是個人的投資流程紀律工具，不構成投資建議。
