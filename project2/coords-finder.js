const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE_PATH = path.join(__dirname, 'data.js');
const HTML_FILE_PATH = path.join(__dirname, 'coords-finder.html');

// Функция безопасного чтения и разбора файла data.js
function getAppData() {
    if (!fs.existsSync(DATA_FILE_PATH)) {
        throw new Error(`Файл не найден по пути: ${DATA_FILE_PATH}`);
    }
    const fileContent = fs.readFileSync(DATA_FILE_PATH, 'utf8');
    const jsonStart = fileContent.indexOf('{');
    const jsonEnd = fileContent.lastIndexOf('}') + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error("Неверный формат data.js. Ожидался 'var APP_DATA = {...};'");
    }
    return JSON.parse(fileContent.substring(jsonStart, jsonEnd));
}

const server = http.createServer((req, res) => {
    // Настройка CORS заголовков для связи с браузером
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Отдача страницы coords-finder.html по ссылке из консоли
    if (req.method === 'GET' && (req.url === '/' || req.url === '/coords-finder.html')) {
        if (fs.existsSync(HTML_FILE_PATH)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(HTML_FILE_PATH, 'utf8'));
            return;
        }
    }

    // Отдача картинки карты из папки img/
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
        const imgPath = path.join(__dirname, req.url);
        if (fs.existsSync(imgPath)) {
            const ext = path.extname(imgPath).toLowerCase();
            const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs.createReadStream(imgPath).pipe(res);
            return;
        }
    }

    // МАРШРУТ GET: Отдаем сцены вместе с их текущими координатами mapCoords
    if (req.method === 'GET' && req.url === '/get-scenes') {
        try {
            const appData = getAppData();
            const scenesList = appData.scenes.map(s => ({ 
                id: s.id, 
                name: s.name || s.id,
                mapCoords: s.mapCoords || null
            }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(scenesList));
        } catch (error) {
            console.error("Ошибка получения сцен:", error.message);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(error.message);
        }
        return;
    }

    // МАРШРУТ POST: Сохранение новых координат за один запрос (для сцены и её пары)
    if (req.method === 'POST' && req.url === '/save') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsedBody = JSON.parse(body);
                const sceneIds = parsedBody.sceneIds;
                const coordinates = parsedBody.coordinates;

                if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
                    throw new Error("Не передан список ID сцен.");
                }
                if (!coordinates || !coordinates.left || !coordinates.top) {
                    throw new Error("Неверный формат координат от клиента.");
                }

                const appData = getAppData();
                const updatedIds = [];

                sceneIds.forEach(id => {
                    const scene = appData.scenes.find(s => s.id === id);
                    if (scene) {
                        scene.mapCoords = {
                            left: coordinates.left,
                            top: coordinates.top
                        };
                        updatedIds.push(id);
                    }
                });
                
                if (updatedIds.length === 0) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(`Ошибка: Указанные сцены не найдены.`);
                    return;
                }

                // Пересобираем структуру и записываем обратно в файл один раз
                const updatedContent = `var APP_DATA = ${JSON.stringify(appData, null, 2)};`;
                fs.writeFileSync(DATA_FILE_PATH, updatedContent, 'utf8');

                console.log(`[Обновлено] Сцены: ${updatedIds.join(', ')} -> left: ${coordinates.left}, top: ${coordinates.top}`);
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Координаты обновлены успешно!`);

            } catch (error) {
                console.error("Ошибка при сохранении:", error.message);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Внутренняя ошибка сервера: ' + error.message);
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`Node.js сервер успешно запущен на порту ${PORT}`);
    console.log(`Ссылка для запуска: http://localhost:${PORT}/coords-finder.html`);
    console.log(`==================================================\n`);
});
