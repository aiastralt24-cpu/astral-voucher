# Astral Dealer Voucher Portal
## Go-Live Guide — Step by Step

---

## WHAT YOU HAVE
- `public/index.html` — Dealer-facing landing page
- `public/admin.html` — Admin panel (upload Excel, view redemptions)
- `index.js` — Backend server (all API logic)
- `package.json` — Node.js dependencies
- `vercel.json` — Vercel deployment config
- `SAMPLE_DEALER_TEMPLATE.csv` — Format for your dealer Excel
- `SAMPLE_VOUCHER_CODES.csv` — Format for your voucher codes

---

## STEP 1 — INSTALL NODE.JS (if not installed)
Download from: https://nodejs.org (choose LTS version)
Verify: open Terminal/CMD → type `node -v` → should show v16+

---

## STEP 2 — TEST LOCALLY FIRST
```bash
cd astral-voucher
npm install
node index.js
```
Open browser → http://localhost:3000
Open admin → http://localhost:3000/admin.html

---

## STEP 3 — DEPLOY TO VERCEL (free, live in 5 minutes)

### 3a. Install Vercel CLI
```bash
npm install -g vercel
```

### 3b. Login to Vercel
```bash
vercel login
```
(Creates free account or logs into existing one)

### 3c. Deploy
```bash
cd astral-voucher
vercel --prod
```
Follow the prompts:
- Project name: astral-voucher-portal (or anything)
- Framework: Other
- Root directory: ./  (just press Enter)

Vercel gives you a URL like: https://astral-voucher-portal.vercel.app

⚠️ IMPORTANT: Vercel's free tier has ephemeral storage.
The JSON data files reset on each deploy.
For permanent storage, use Railway.app instead (see below).

---

## STEP 4 — DEPLOY TO RAILWAY (RECOMMENDED — persistent data)

Railway keeps your data between deploys. Free tier available.

### 4a. Go to https://railway.app → Sign up with GitHub
### 4b. New Project → Deploy from GitHub repo
### 4c. Upload your code to GitHub first:
```bash
cd astral-voucher
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOURUSERNAME/astral-voucher.git
git push -u origin main
```
### 4d. In Railway: connect that GitHub repo → Deploy
Railway auto-detects Node.js and runs `npm start`

Your live URL: https://astral-voucher-portal.up.railway.app (or similar)

---

## STEP 5 — LOAD YOUR DATA (after deploy)

1. Go to your-url.com/admin.html
2. Upload Dealer Master Excel (use SAMPLE_DEALER_TEMPLATE.csv as format guide)
3. Upload Voucher Codes Excel (use SAMPLE_VOUCHER_CODES.csv as format guide)
4. Check stats dashboard — should show dealer count + voucher count
5. Portal is LIVE!

---

## STEP 6 — SHARE WITH DEALERS
Send dealers this URL: https://your-url.com
(or set up custom domain in Railway/Vercel settings)

---

## EXCEL FORMAT REMINDER
### Dealer Master (must have these exact column names):
| Dealer Name | ALP Code | Mobile Number | Voucher Count |
|-------------|----------|---------------|---------------|
| Rajesh Traders | ALP-MH-00234 | 9876543210 | 3 |

### Voucher Codes (must have this exact column name):
| Voucher Code |
|--------------|
| ASTRAL-2026-XK9A |

---

## SMS CONFIG (already set in index.js)
- API Key: DauX8VQTFLB2dxai
- Sender ID: ASTRAL
- Template ID: 1707173227385059867
- Vendor: TextSpeed

---

## ADMIN PANEL
URL: your-url.com/admin.html
Features:
- Upload dealer Excel
- Upload voucher pool
- View live redemption stats
- Export CSV report
- Reset individual dealer
- Toggle portal on/off

---

## NEED HELP?
Contact your digital marketing team or IT agency with this README.
