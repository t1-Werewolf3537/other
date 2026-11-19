const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = path.join(__dirname, '..'); // Корень проекта (где лежит index.html)
const QUEST_DATA_PATH = path.join(__dirname, 'quest_data.js'); // База внутри папки quest/

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

function readQuestData() {
  try {
    if (!fs.existsSync(QUEST_DATA_PATH)) {
      return { items: [] };
    }
    const content = fs.readFileSync(QUEST_DATA_PATH, 'utf8');
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    if (start === -1 || end <= start) return { items: [] };
    return JSON.parse(content.substring(start, end));
  } catch (err) {
    return { items: [] };
  }
}


function writeQuestData(data) {
  const output = 'window.QUEST_DATA = ' + JSON.stringify(data, null, 2) + ';\n';
  fs.writeFileSync(QUEST_DATA_PATH, output, 'utf8');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = new URL(req.url, 'http://' + req.headers.host);

  // Сохранение нового объекта в quest/quest_data.js
  if (req.method === 'POST' && parsedUrl.pathname === '/save-quest-item') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const newItem = JSON.parse(body);
        const questData = readQuestData();
        questData.items.push(newItem);
        writeQuestData(questData);
        console.log(`[Квест] Сохранен объект "${newItem.title}" в сцену: ${newItem.sceneId}`);
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }

  // Удаление объекта из quest/quest_data.js по uid
  if (req.method === 'POST' && parsedUrl.pathname === '/delete-quest-item') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { uid } = JSON.parse(body);
        const questData = readQuestData();
        questData.items = questData.items.filter(item => item.uid !== uid);
        writeQuestData(questData);
        console.log(`[Квест] Удален объект uid: ${uid}`);
        res.writeHead(200);
        res.end('Deleted');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }

  // Полное обновление существующего объекта в quest/quest_data.js
  if (req.method === 'POST' && parsedUrl.pathname === '/update-quest-item') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const updatedItem = JSON.parse(body);
        const questData = readQuestData();
        const idx = questData.items.findIndex(item => item.uid === updatedItem.uid);
        if (idx === -1) { res.writeHead(404); res.end('Not found'); return; }
        
        questData.items[idx] = updatedItem;
        writeQuestData(questData);
        console.log(`[Квест] Обновлен объект "${updatedItem.title}" (uid: ${updatedItem.uid})`);
        res.writeHead(200);
        res.end('Updated');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }



  // Короткий удобный адрес для запуска редактора: http://localhost:3000/editor
  if (parsedUrl.pathname === '/editor' || parsedUrl.pathname === '/editor/') {
    const editorPath = path.join(__dirname, 'quest_editor.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(editorPath));
    return;
  }

  // Раздача статических файлов из корня проекта
  const reqPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const filePath = path.join(ROOT_DIR, decodeURIComponent(reqPath));
  const ext = path.extname(filePath).toLowerCase();

  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🎮 Игра запущена:      http://localhost:${PORT}`);
  console.log(`🛠 Редактор запущен:  http://localhost:${PORT}/editor`);
  console.log(`📁 База сохраняется в: ${QUEST_DATA_PATH}\n`);
});
