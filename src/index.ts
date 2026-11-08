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

// 2. Web viewer untuk scan QR jika di-host di cloud/browser
app.get('/qr', (_req: Request, res: Response) => {
  if (isConnected) {
    return res.send(`
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0fdf4;color:#166534;">
        <h2>WhatsApp Bot Kost Sudah Terhubung! ✅</h2>
        <p>Bot siap menerima perintah pengiriman pesan otomatis.</p>
      </body>
    `);
  }
  if (!qrCodeString) {
    return res.send(`
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
        <h2>Sedang Menyiapkan QR Code...</h2>
        <p>Silakan tunggu beberapa detik lalu refresh halaman ini.</p>
        <script>setTimeout(() => window.location.reload(), 3000);</script>
      </body>
    `);
  }
  res.send(`
    <html>
      <head>
        <title>Scan QR WhatsApp Bot Kost</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f8fafc;">
        <div style="background:white;padding:32px;border-radius:16px;box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);text-align:center;">
          <h2 style="margin-top:0;color:#0f172a;">Hubungkan WhatsApp Kost</h2>
          <p style="color:#64748b;font-size:14px;">Buka WhatsApp di HP &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
          <div id="qrcode" style="margin:20px auto;display:inline-block;"></div>
          <p style="color:#94a3b8;font-size:12px;">Halaman akan otomatis refresh setelah terhubung.</p>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          new QRCode(document.getElementById("qrcode"), "${qrCodeString}");
          setInterval(async () => {
            try {
              const res = await fetch('/status');
              const data = await res.json();
              if (data.connected) window.location.reload();
            } catch(e) {}
          }, 3000);
        </script>
      </body>
    </html>
  `);
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
    // Resolve nomor terdaftar di WhatsApp untuk mendapatkan valid wid / LID
    let targetChatId = rawChatId;
    try {
      const numberId = await client.getNumberId(rawChatId);
      if (numberId?._serialized) {
        targetChatId = numberId._serialized;
      }
    } catch (e) {
      console.warn(`[getWid Warning] Gagal resolve getNumberId untuk ${rawChatId}, fallback ke default.`);
    }

    let sent: any;
    if (imageBase64) {
      // Hilangkan header data:image/...;base64, jika ada
      const pureBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const media = new MessageMedia(imageMimeType || 'image/png', pureBase64, imageFileName || 'invoice.png');
      sent = await client.sendMessage(targetChatId, media, { caption: message || '' });
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
