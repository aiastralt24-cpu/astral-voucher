const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

// ─────────────────────────────────────────
//  DATA STORE (JSON files — no DB needed)
//  For production scale, swap with PostgreSQL
// ─────────────────────────────────────────
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const DEALERS_FILE = path.join(DATA_DIR, 'dealers.json');
const VOUCHERS_FILE = path.join(DATA_DIR, 'vouchers.json');
const OTP_FILE = path.join(DATA_DIR, 'otps.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function readJSON(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── SMS CONFIG ───────────────────────────
const SMS_API_KEY = 'DauX8VQTFLB2dxai';
const SMS_SENDER_ID = 'ASTRAL';
const SMS_TEMPLATE_ID = '1707173227385059867';

function sendOtpSms(mobile, otp) {
  return new Promise((resolve, reject) => {
    const message = encodeURIComponent(`${otp} is the OTP for Login on WeCare. Astral Pipes!`);
    const url = `https://sms.textspeed.in/vb/apikey.php?apikey=${SMS_API_KEY}&senderid=${SMS_SENDER_ID}&templateid=${SMS_TEMPLATE_ID}&number=${mobile}&message=${message}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`SMS sent to ${mobile}: ${data}`);
        resolve(data);
      });
    }).on('error', (e) => {
      console.error('SMS error:', e);
      reject(e);
    });
  });
}

// ─── RATE LIMITING (simple in-memory) ────
const rateLimits = {};
function rateLimit(key, max = 5, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key] = rateLimits[key].filter(t => now - t < windowMs);
  if (rateLimits[key].length >= max) return false;
  rateLimits[key].push(now);
  return true;
}

// ─────────────────────────────────────────
//  API: VERIFY DEALER
// ─────────────────────────────────────────
app.post('/api/verify-dealer', async (req, res) => {
  try {
    const settings = readJSON(SETTINGS_FILE, { portalActive: true });
    if (!settings.portalActive) {
      return res.json({ status: 'error', message: 'This campaign has ended. Thank you for your participation!' });
    }

    const { mobile, alpCode } = req.body;
    if (!mobile || !alpCode) {
      return res.json({ status: 'error', message: 'All fields are required.' });
    }

    // Rate limit by IP
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit(`verify_${ip}`, 10, 15 * 60 * 1000)) {
      return res.json({ status: 'error', message: 'Too many attempts. Please try again after 15 minutes.' });
    }

    const dealers = readJSON(DEALERS_FILE, {});
    const key = alpCode.toUpperCase().trim();
    const dealer = dealers[key];

    if (!dealer) {
      return res.json({ status: 'error', message: 'Invalid ALP Code. Please check and try again.' });
    }

    // Match ALP + Mobile only
    const mobileMatch = dealer.mobile.trim() === mobile.trim();

    if (!mobileMatch) {
      return res.json({ status: 'error', message: 'Mobile number does not match our records for this ALP Code.' });
    }

    if (dealer.redeemed) {
      return res.json({ status: 'already_redeemed', message: 'Your vouchers have already been claimed.' });
    }

    // Generate OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otps = readJSON(OTP_FILE, {});
    otps[mobile] = {
      otp,
      alpCode: key,
      expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0
    };
    writeJSON(OTP_FILE, otps);

    // Send SMS
    try {
      await sendOtpSms(mobile, otp);
    } catch (smsErr) {
      console.error('SMS failed:', smsErr);
      return res.json({ status: 'error', message: 'Failed to send OTP. Please try again.' });
    }

    res.json({ status: 'ok', message: 'OTP sent successfully.' });
  } catch (err) {
    console.error(err);
    res.json({ status: 'error', message: 'Server error. Please try again.' });
  }
});

// ─────────────────────────────────────────
//  API: RESEND OTP
// ─────────────────────────────────────────
app.post('/api/resend-otp', async (req, res) => {
  try {
    const { mobile, alpCode } = req.body;
    if (!mobile || !alpCode) return res.json({ status: 'error' });

    if (!rateLimit(`otp_${mobile}`, 5, 60 * 60 * 1000)) {
      return res.json({ status: 'error', message: 'Too many OTP requests. Try again later.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otps = readJSON(OTP_FILE, {});
    otps[mobile] = {
      otp,
      alpCode: alpCode.toUpperCase().trim(),
      expires: Date.now() + 10 * 60 * 1000,
      attempts: 0
    };
    writeJSON(OTP_FILE, otps);
    await sendOtpSms(mobile, otp);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.json({ status: 'error' });
  }
});

// ─────────────────────────────────────────
//  API: VERIFY OTP
// ─────────────────────────────────────────
app.post('/api/verify-otp', (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) return res.json({ status: 'error', message: 'Invalid request.' });

    const otps = readJSON(OTP_FILE, {});
    const record = otps[mobile];

    if (!record) return res.json({ status: 'error', message: 'OTP expired. Please go back and try again.' });
    if (Date.now() > record.expires) {
      delete otps[mobile];
      writeJSON(OTP_FILE, otps);
      return res.json({ status: 'error', message: 'OTP has expired. Please go back and request a new OTP.' });
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 3) {
      delete otps[mobile];
      writeJSON(OTP_FILE, otps);
      return res.json({ status: 'error', message: 'Too many failed attempts. Please go back and try again.' });
    }

    if (record.otp !== otp.trim()) {
      writeJSON(OTP_FILE, otps);
      const left = 3 - record.attempts;
      return res.json({ status: 'error', message: `Incorrect OTP. ${left} attempt${left===1?'':'s'} remaining.` });
    }

    // OTP correct — fetch pre-assigned vouchers from dealer record
    const dealers = readJSON(DEALERS_FILE, {});
    const dealer = dealers[record.alpCode];
    if (!dealer) return res.json({ status: 'error', message: 'Dealer not found.' });

    if (dealer.redeemed) {
      return res.json({ status: 'error', message: 'Already redeemed.' });
    }

    // Use pre-assigned codes from Excel upload
    const assignedCodes = dealer.assignedCodes || [];
    if (assignedCodes.length === 0) {
      return res.json({ status: 'error', message: 'No voucher codes assigned to this dealer. Please contact Astral support.' });
    }

    // Mark dealer as redeemed
    dealer.redeemed = true;
    dealer.redeemedAt = new Date().toISOString();
    dealer.vouchers = assignedCodes;
    writeJSON(DEALERS_FILE, dealers);

    // Clear OTP
    delete otps[mobile];
    writeJSON(OTP_FILE, otps);

    const token = crypto.randomBytes(16).toString('hex');
    res.json({ status: 'ok', token, vouchers: assignedCodes });

  } catch (err) {
    console.error(err);
    res.json({ status: 'error', message: 'Server error. Please try again.' });
  }
});

// ─────────────────────────────────────────
//  ADMIN: UPLOAD DEALERS
// ─────────────────────────────────────────
app.post('/api/admin/upload-dealers', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.json({ status: 'error', message: 'No file uploaded.' });

    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Group rows by ALP Code — each row is one voucher code
    const grouped = {};
    let errors = 0;

    rows.forEach((row) => {
      const alp = String(row['ALP Code'] || row['ALP'] || '').trim().toUpperCase();
      const mobile = String(row['Mobile Number'] || row['Mobile'] || '').replace(/[^0-9]/g, '').trim();
      const code = String(row['Voucher Code'] || row['Code'] || row['Voucher'] || '').trim();

      if (!alp || !mobile || !code) { errors++; return; }
      if (mobile.length !== 10) { errors++; return; }

      if (!grouped[alp]) {
        grouped[alp] = { alp, mobile, assignedCodes: [] };
      }
      // Only add code if not duplicate
      if (!grouped[alp].assignedCodes.includes(code)) {
        grouped[alp].assignedCodes.push(code);
      }
    });

    // Merge into dealers database
    const dealers = readJSON(DEALERS_FILE, {});
    let imported = 0;

    Object.values(grouped).forEach(g => {
      const existing = dealers[g.alp];
      dealers[g.alp] = {
        alp: g.alp,
        mobile: g.mobile,
        voucherCount: g.assignedCodes.length,
        assignedCodes: g.assignedCodes,          // pre-assigned from Excel
        redeemed: existing ? existing.redeemed : false,
        redeemedAt: existing ? existing.redeemedAt : null,
        vouchers: existing ? existing.vouchers : [],  // actually shown vouchers (set on redemption)
        addedAt: existing ? existing.addedAt : new Date().toISOString()
      };
      imported++;
    });

    writeJSON(DEALERS_FILE, dealers);
    fs.unlinkSync(req.file.path);
    res.json({ status: 'ok', imported, errors, totalRows: rows.length });
  } catch (err) {
    console.error(err);
    res.json({ status: 'error', message: 'Failed to parse file. Check format.' });
  }
});

// ─────────────────────────────────────────
//  ADMIN: UPLOAD VOUCHERS
// ─────────────────────────────────────────
app.post('/api/admin/upload-vouchers', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.json({ status: 'error', message: 'No file uploaded.' });

    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const vouchers = readJSON(VOUCHERS_FILE, { pool: [] });
    const existing = new Set(vouchers.pool.map(v => v.code));
    let imported = 0;

    rows.forEach(row => {
      const code = String(row['Voucher Code'] || row['voucher_code'] || row['Code'] || Object.values(row)[0] || '').trim();
      if (code && !existing.has(code)) {
        vouchers.pool.push({ code, issued: false, issuedTo: null, issuedAt: null });
        existing.add(code);
        imported++;
      }
    });

    writeJSON(VOUCHERS_FILE, vouchers);
    fs.unlinkSync(req.file.path);
    res.json({ status: 'ok', imported });
  } catch (err) {
    console.error(err);
    res.json({ status: 'error', message: 'Failed to parse file.' });
  }
});

// ─────────────────────────────────────────
//  ADMIN: STATS
// ─────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  try {
    const dealers = readJSON(DEALERS_FILE, {});
    const all = Object.values(dealers);
    const redeemed = all.filter(d => d.redeemed).length;
    // Count total assigned codes not yet redeemed
    const vouchersRemaining = all
      .filter(d => !d.redeemed)
      .reduce((sum, d) => sum + (d.assignedCodes || []).length, 0);
    res.json({ total: all.length, redeemed, vouchersRemaining });
  } catch (err) {
    res.json({ total: 0, redeemed: 0, vouchersRemaining: 0 });
  }
});

// ─────────────────────────────────────────
//  ADMIN: REDEMPTIONS LIST
// ─────────────────────────────────────────
app.get('/api/admin/redemptions', (req, res) => {
  try {
    const dealers = readJSON(DEALERS_FILE, {});
    const redemptions = Object.values(dealers).map(d => ({
      alpCode: d.alp,
      mobile: d.mobile,
      voucherCount: d.voucherCount,
      assignedCodes: d.assignedCodes || [],
      vouchers: d.vouchers || [],
      redeemed: d.redeemed,
      redeemedAt: d.redeemedAt
    }));
    // Sort: redeemed first, then pending
    redemptions.sort((a, b) => (b.redeemed ? 1 : 0) - (a.redeemed ? 1 : 0));
    res.json({ redemptions });
  } catch (err) {
    res.json({ redemptions: [] });
  }
});

// ─────────────────────────────────────────
//  ADMIN: EXPORT CSV
// ─────────────────────────────────────────
app.get('/api/admin/export-csv', (req, res) => {
  try {
    const dealers = readJSON(DEALERS_FILE, {});
    const rows = [['Dealer Name', 'ALP Code', 'Mobile', 'Voucher Count', 'Status', 'Vouchers Issued', 'Redeemed At']];
    Object.values(dealers).forEach(d => {
      rows.push([
        d.name, d.alp, d.mobile, d.voucherCount,
        d.redeemed ? 'Redeemed' : 'Pending',
        (d.vouchers || []).join(' | '),
        d.redeemedAt || ''
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="astral-redemptions.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).send('Export failed');
  }
});

// ─────────────────────────────────────────
//  ADMIN: SETTINGS
// ─────────────────────────────────────────
app.post('/api/admin/settings', (req, res) => {
  const settings = readJSON(SETTINGS_FILE, { portalActive: true });
  Object.assign(settings, req.body);
  writeJSON(SETTINGS_FILE, settings);
  res.json({ status: 'ok' });
});

// ─────────────────────────────────────────
//  ADMIN: RESET DEALER
// ─────────────────────────────────────────
app.post('/api/admin/reset-dealer', (req, res) => {
  try {
    const { alpCode } = req.body;
    if (!alpCode) return res.json({ status: 'error', message: 'ALP Code required.' });
    const dealers = readJSON(DEALERS_FILE, {});
    const key = alpCode.toUpperCase().trim();
    if (!dealers[key]) return res.json({ status: 'error', message: 'Dealer not found.' });

    // Return vouchers to pool
    const vouchers = readJSON(VOUCHERS_FILE, { pool: [] });
    const issuedCodes = dealers[key].vouchers || [];
    vouchers.pool.forEach(v => {
      if (issuedCodes.includes(v.code)) {
        v.issued = false; v.issuedTo = null; v.issuedAt = null;
      }
    });
    writeJSON(VOUCHERS_FILE, vouchers);

    dealers[key].redeemed = false;
    dealers[key].redeemedAt = null;
    dealers[key].vouchers = [];
    writeJSON(DEALERS_FILE, dealers);

    res.json({ status: 'ok' });
  } catch (err) {
    res.json({ status: 'error', message: 'Reset failed.' });
  }
});

// ─────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Astral Voucher Portal running on port ${PORT}`);
  console.log(`   Landing page: http://localhost:${PORT}`);
  console.log(`   Admin panel:  http://localhost:${PORT}/admin.html\n`);
});
