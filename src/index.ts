import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'kost_secret_wa_bot_key_2026';

app.use(cors());
app.use(express.json({ limit: '15mb' }));

let isConnected = false;
let qrCodeString = '';

// Buat client whatsapp-web.js dengan persistent local session
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.resolve(process.cwd(), 'auth_session'),
  }),
  puppeteer: {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

client.on('qr', (qr: string) => {
  qrCodeString = qr;
  console.log('\n=============================================');
  console.log('📌 SCAN QR CODE INI MENGGUNAKAN WHATSAPP:');
  qrcode.generate(qr, { small: true });
  console.log('Atau buka browser: http://localhost:' + PORT + '/qr');
  console.log('=============================================\n');
});

client.on('ready', () => {
  isConnected = true;
  qrCodeString = '';
  console.log('✅ WhatsApp Bot Kost BERHASIL TERHUBUNG dan siap kirim pesan!');
});

client.on('authenticated', () => {
  console.log('🔐 Sesi WhatsApp berhasil diautentikasi.');
});

client.on('auth_failure', (msg: any) => {
  console.error('❌ Autentikasi WhatsApp gagal:', msg);
  isConnected = false;
});

client.on('disconnected', (reason: any) => {
  isConnected = false;
  console.log('⚠️ WhatsApp Bot terputus:', reason);
  client.initialize().catch(() => {});
});

// Format nomor Indonesia (contoh 08123456789 -> 628123456789@c.us)
function formatToChatId(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return `${cleaned}@c.us`;
}

// 1. Cek status bot
app.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: isConnected ? 'connected' : 'waiting_for_qr_or_disconnected',
    connected: isConnected,
  });
});

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// API Auth Login Superadmin untuk akses QR Code
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password wajib diisi' });
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data: any = await backendRes.json();
    if (!backendRes.ok) {
      return res.status(401).json({ error: data.error || 'Autentikasi gagal' });
    }

    if (data.user?.role !== 'owner') {
      return res.status(403).json({ error: 'Akses ditolak: Hanya Superadmin/Owner yang dapat mengakses Bot WhatsApp' });
    }

    res.json({
      success: true,
      token: data.token,
      user: data.user,
    });
  } catch (err: any) {
    console.error('Error saat login bot:', err.message);
    res.status(500).json({ error: 'Gagal terhubung ke server backend' });
  }
});

// 2. Web viewer untuk scan QR dengan proteksi Login Superadmin
app.get('/qr', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
      <head>
        <title>WhatsApp Bot Management - KostFlow</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; padding: 0; }
          body { background: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #f8fafc; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 36px; max-width: 440px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; }
          .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: rgba(37,99,235,0.15); border: 1px solid rgba(59,130,246,0.3); color: #60a5fa; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
          h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #ffffff; }
          p.subtitle { color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 24px; }
          .form-group { text-align: left; margin-bottom: 16px; }
          label { display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
          input { width: 100%; padding: 12px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; color: #f8fafc; font-size: 14px; transition: border-color 0.2s; outline: none; }
          input:focus { border-color: #3b82f6; }
          button.btn { width: 100%; padding: 13px; background: #2563eb; color: #fff; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; cursor: pointer; transition: background 0.2s; margin-top: 8px; }
          button.btn:hover { background: #1d4ed8; }
          .error-msg { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 16px; display: none; }
          #qrSection { display: none; }
          .qr-box { background: #ffffff; padding: 16px; border-radius: 14px; display: inline-block; margin: 16px 0; }
          .status-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }
          .status-connected { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
          .status-waiting { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
          .btn-logout { background: transparent; border: 1px solid #475569; color: #94a3b8; padding: 8px 16px; font-size: 12px; border-radius: 8px; cursor: pointer; margin-top: 20px; }
          .btn-logout:hover { background: #334155; color: #fff; }
        </style>
      </head>
      <body>
        <div class="card">
          <!-- 1. LOGIN SECTION -->
          <div id="loginSection">
            <div class="badge">🔒 Portal Keamanan Bot</div>
            <h2>Login Superadmin</h2>
            <p class="subtitle">Akses pemindaian QR Code WhatsApp Bot dilindungi. Gunakan kredensial Superadmin / Pemilik Kost.</p>
            
            <div id="errorAlert" class="error-msg"></div>

            <form id="loginForm" onsubmit="handleLogin(event)">
              <div class="form-group">
                <label>Email Superadmin</label>
                <input type="email" id="email" placeholder="admin@kost.com" required autocomplete="username" />
              </div>
              <div class="form-group">
                <label>Kata Sandi</label>
                <input type="password" id="password" placeholder="••••••••" required autocomplete="current-password" />
              </div>
              <button type="submit" id="btnSubmit" class="btn">Buka Akses Bot</button>
            </form>
          </div>

          <!-- 2. QR / STATUS SECTION -->
          <div id="qrSection">
            <div class="badge">🤖 Sesi WhatsApp Bot</div>
            <h2 id="sessionTitle">Memuat Sesi...</h2>
            <p id="sessionDesc" class="subtitle">Buka WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
            
            <div id="statusBadgeContainer"></div>
            <div id="qrcodeWrapper" class="qr-box" style="display: none;">
              <div id="qrcode"></div>
            </div>

            <div>
              <button onclick="handleLogout()" class="btn-logout">Kunci &amp; Keluar</button>
            </div>
          </div>
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          const AUTH_KEY = 'kost_wa_bot_token';
          let checkInterval = null;

          function checkAuth() {
            // Cek token dari query parameter URL (auto-login dari Dashboard) atau localStorage
            const urlParams = new URLSearchParams(window.location.search);
            const tokenFromUrl = urlParams.get('token');
            if (tokenFromUrl) {
              localStorage.setItem(AUTH_KEY, tokenFromUrl);
              window.history.replaceState({}, document.title, window.location.pathname);
            }

            const token = localStorage.getItem(AUTH_KEY);
            if (token) {
              showBotSection();
            } else {
              showLoginSection();
            }
          }

          function showLoginSection() {
            if (checkInterval) clearInterval(checkInterval);
            document.getElementById('loginSection').style.display = 'block';
            document.getElementById('qrSection').style.display = 'none';
          }

          function showBotSection() {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('qrSection').style.display = 'block';
            refreshStatus();
            checkInterval = setInterval(refreshStatus, 3000);
          }

          async function handleLogin(e) {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const btn = document.getElementById('btnSubmit');
            const alert = document.getElementById('errorAlert');

            btn.disabled = true;
            btn.innerText = 'Memverifikasi...';
            alert.style.display = 'none';

            try {
              const res = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
              });
              const data = await res.json();
              if (res.ok && data.token) {
                localStorage.setItem(AUTH_KEY, data.token);
                showBotSection();
              } else {
                alert.innerText = data.error || 'Login gagal';
                alert.style.display = 'block';
              }
            } catch (err) {
              alert.innerText = 'Gagal menghubungi server';
              alert.style.display = 'block';
            } finally {
              btn.disabled = false;
              btn.innerText = 'Buka Akses Bot';
            }
          }

          function handleLogout() {
            localStorage.removeItem(AUTH_KEY);
            showLoginSection();
          }

          let lastQr = '';
          async function refreshStatus() {
            try {
              const res = await fetch('/status');
              const data = await res.json();
              const badgeContainer = document.getElementById('statusBadgeContainer');
              const qrWrapper = document.getElementById('qrcodeWrapper');
              const title = document.getElementById('sessionTitle');
              const desc = document.getElementById('sessionDesc');

              if (data.connected) {
                title.innerText = 'Bot Berhasil Terhubung';
                desc.innerText = 'Sesi WhatsApp aktif. Bot siap mengirim notifikasi tagihan dan resi kwitansi otomatis.';
                badgeContainer.innerHTML = '<div class="status-tag status-connected">● Online &amp; Terhubung</div>';
                qrWrapper.style.display = 'none';
              } else {
                title.innerText = 'Tautkan WhatsApp';
                desc.innerText = 'Buka WhatsApp di HP &gt; Perangkat Tertaut &gt; Tautkan Perangkat lalu scan QR code ini:';
                badgeContainer.innerHTML = '<div class="status-tag status-waiting">● Menunggu Scan QR</div>';
                
                // Ambil QR code live
                const qrRes = await fetch('/api/live-qr');
                const qrData = await qrRes.json();
                if (qrData.qr && qrData.qr !== lastQr) {
                  lastQr = qrData.qr;
                  document.getElementById('qrcode').innerHTML = '';
                  new QRCode(document.getElementById('qrcode'), {
                    text: qrData.qr,
                    width: 220,
                    height: 220,
                    correctLevel: QRCode.CorrectLevel.M
                  });
                  qrWrapper.style.display = 'inline-block';
                }
              }
            } catch (e) {}
          }

          checkAuth();
        </script>
      </body>
    </html>
  `);
});

// Endpoint untuk mengambil QR code live secara dinamis
app.get('/api/live-qr', (_req: Request, res: Response) => {
  res.json({
    connected: isConnected,
    qr: isConnected ? '' : qrCodeString,
  });
});

// 3. API KIRIM PESAN OTOMATIS
app.post('/send-message', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.replace('Bearer ', '');

  if (API_SECRET_KEY && token !== API_SECRET_KEY) {
    return res.status(401).json({ error: 'Akses ditolak: API Secret Key tidak valid' });
  }

  if (!isConnected) {
    return res.status(503).json({
      error: 'WhatsApp Bot belum terhubung. Silakan scan QR code terlebih dahulu.',
    });
  }

  const { phone, message, imageBase64, imageMimeType, imageFileName } = req.body;
  if (!phone || (!message && !imageBase64)) {
    return res.status(400).json({ error: 'Nomor telepon dan (pesan atau gambar) wajib diisi' });
  }

  try {
    const rawChatId = formatToChatId(phone);
    // Untuk pengiriman media foto resi, WhatsApp Web membutuhkan targetChatId berupa raw phone @c.us bukan LID
    const targetChatId = rawChatId;

    let sent: any;
    if (imageBase64) {
      // Kirim pesan teks dulu agar notifikasi instan terkirim
      if (message) {
        try {
          sent = await client.sendMessage(targetChatId, message);
        } catch (mErr: any) {
          console.warn('[WA Text Send Error]:', mErr.message);
        }
      }

      // Kirim foto resi invoice
      try {
        const pureBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        const media = new MessageMedia(imageMimeType || 'image/png', pureBase64, imageFileName || 'resi_kwitansi.png');
        const mediaSent = await client.sendMessage(targetChatId, media);
        if (mediaSent) sent = mediaSent;
      } catch (mediaErr: any) {
        console.warn('[WA Media Send Warning]:', mediaErr.message);
      }
    } else {
      sent = await client.sendMessage(targetChatId, message);
    }

    res.json({
      success: true,
      phone,
      targetChatId,
      messageId: sent?.id?._serialized || 'sent',
    });
  } catch (err: any) {
    console.error('Error saat kirim pesan:', err);
    res.status(500).json({ error: err.message || 'Gagal mengirim pesan WhatsApp' });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 WhatsApp Bot Service berjalan di port ${PORT}`);
  console.log(`Menghubungkan ke WhatsApp Web...`);
  client.initialize().catch((err) => {
    console.error('Gagal inisialisasi client whatsapp:', err);
  });
});
