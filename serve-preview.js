import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'frontend', 'public');
const PORT = 5555;

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const file = path.join(PUBLIC, req.url === '/' ? 'schedule.html' : req.url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Preview → http://localhost:${PORT}`));
