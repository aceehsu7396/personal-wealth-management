# 同步與推播：部署自己的 Cloudflare Worker

> 2026-11-12 建立。網站在沒有 Worker 時照常運作；部署後才能跨裝置同步與收盤後推播。費用：Cloudflare 免費方案，每月 0 元（2026-10 官方價格：每天 10 萬次請求、KV 每天 1,000 次寫入、單筆 25 MiB）。

## 這個 Worker 做什麼、看得到什麼

| 功能 | 伺服器存了什麼 | 伺服器看不到什麼 |
|---|---|---|
| 同步 | 加密後的資料、版本號、存取權杖的雜湊值 | 你的密語、任何持股或交易內容 |
| 推播 | 瀏覽器提供的推播網址與金鑰 | 通知內容：通知是你的裝置自己算出來的 |

忘記密語就沒有人能解開雲端的資料，包括你自己。請把密語記在安全的地方。

## 需要的東西

- 一個 Cloudflare 帳號（免費）：https://dash.cloudflare.com/sign-up
- 這台電腦已裝 Node.js（專案本來就需要）

## 步驟

以下指令都在專案的 `worker` 資料夾執行。

```
cd worker
npm install
```

### 1. 登入 Cloudflare

```
npx wrangler login
```

瀏覽器會打開 Cloudflare 的授權頁，按「Allow」。

### 2. 建立 KV 儲存空間

```
npx wrangler kv namespace create VAULT
```

畫面會印出一段 `id = "…"`。把這個值貼到 `worker/wrangler.toml` 的 `[[kv_namespaces]]` 底下，取代 `REPLACE_WITH_KV_ID`。

### 3. 產生推播金鑰（VAPID）

```
node scripts/vapid.mjs
```

畫面印出兩行：

- `VAPID_PUBLIC_KEY = …`：貼到 `wrangler.toml` 的 `VAPID_PUBLIC_KEY = ""` 引號裡。
- `VAPID_PRIVATE_JWK = {…}`：這是私鑰，**不要**放進檔案，改存成 secret：

```
npx wrangler secret put VAPID_PRIVATE_JWK
```

出現提示時，貼上 `{` 到 `}` 的整段，按 Enter。

再把 `wrangler.toml` 裡的 `VAPID_SUBJECT` 改成你的聯絡方式，例如 `mailto:你的信箱`。推播服務只會在出問題時用它聯絡。

### 4. 部署

```
npx wrangler deploy
```

完成後會印出網址，例如 `https://pfm-sync.你的帳號.workers.dev`。打開它應該看到 `{"ok":true,…}`。

### 5. 在網站上連線

1. 打開網站的「設定 → 同步與推播」。
2. 貼上 Worker 網址，輸入密語（至少 12 個字，所有裝置用同一把）。
3. 第一台裝置會問「建立雲端保險箱」；其他裝置輸入同一把密語就會下載。
4. 要收推播就按「開啟推播」，允許通知後按「送一則測試」。
   - iPhone 要先用 Safari 把網站「加入主畫面」，再從主畫面打開才能開啟推播。

## 常見問題

| 狀況 | 原因與處理 |
|---|---|
| 「同步伺服器回應 401」或「密語不符」 | 密語打錯；在這台裝置登出後重新輸入 |
| 「雲端還沒有這把密語的資料」 | 第一台裝置就建立；如果其他裝置已經設定過，代表密語打錯了 |
| 兩台裝置都改過 | 網站會問要保留哪一份；不會自動合併 |
| 瀏覽器顯示 CORS 錯誤 | `wrangler.toml` 的 `SITE_ORIGIN` 要是網站的網址（`https://aceehsu7396.github.io`），改完重新部署 |
| 「上傳太頻繁」 | 同一個保險箱 5 秒內只能寫一次；稍等即可 |
| 收不到推播 | 確認瀏覽器允許通知；推播在台北時間每個交易日 15:30 左右送出 |

## 在本機測試（選用）

建立 `worker/.dev.vars`（已列在 .gitignore）：

```
SITE_ORIGIN=http://localhost:4173
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_JWK='{…}'
```

然後執行 `npx wrangler dev --test-scheduled`。打開 `http://localhost:8787/__scheduled` 可以手動觸發每日推播。
