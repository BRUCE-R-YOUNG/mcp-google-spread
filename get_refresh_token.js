// get_refresh_token.js (Desktop/Loopback)
// 依存: 内蔵 http/url と googleapis だけ
import 'dotenv/config';
import http from 'http';
import { URL } from 'url';
import open from 'node:child_process';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// 使いやすい固定ポート。衝突する場合は変えてOK
const PORT = 53177;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が見つかりません。.env を確認してください。');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',   // ★ refresh_token を得る
  prompt: 'consent',        // ★ 毎回同意を促す
  scope: scopes
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400); res.end('Missing code'); return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK! このウィンドウは閉じて構いません。ターミナルにトークンが表示されます。');

    console.log('\n=== TOKENS RECEIVED ===');
    console.log('access_token :', tokens.access_token ? '(省略)' : '(なし)');
    console.log('refresh_token:', tokens.refresh_token || '(なし)');
    console.log('expiry_date  :', tokens.expiry_date || '(不明)');

    if (!tokens.refresh_token) {
      console.error('\n※ refresh_token が取得できませんでした。手順1の「アクセス削除」を実施し、再度やり直してください。');
      process.exit(1);
    } else {
      console.log('\n--- .env に書く値（例）---');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      process.exit(0);
    }
  } catch (e) {
    console.error('ERROR:', e.response?.data || e.message);
    res.writeHead(500); res.end('Error');
    process.exit(1);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser:\n', authUrl, '\n');
  // Windowsなら自動で開きたい場合↓（失敗しても無視）
  try {
    const cmd = `start "" "${authUrl}"`;
    open.exec(cmd);
  } catch (e) {}
});
