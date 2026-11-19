const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE_PATH = path.join(__dirname, 'data.js');
const INDEX_FILE_PATH = path.join(__dirname, 'index.html');
const JS_FILE_PATH = path.join(__dirname, 'index.js');
const PANEL_FILE_PATH = path.join(__dirname, 'hotpoint_edit.html');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
};

function getCleanAppData() {
    if (!fs.existsSync(DATA_FILE_PATH)) throw new Error("Файл data.js не найден!");
    const content = fs.readFileSync(DATA_FILE_PATH, 'utf8');
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    return JSON.parse(content.substring(start, end));
}

function saveAppData(appData) {
    fs.writeFileSync(DATA_FILE_PATH, 'var APP_DATA = ' + JSON.stringify(appData, null, 2) + ';', 'utf8');
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const parsedUrl = new URL(req.url, 'http://' + req.headers.host);

    if (req.method === 'GET' && parsedUrl.pathname === '/get-all-scenes-list') {
        try {
            const list = getCleanAppData().scenes.map(s => ({ id: s.id, name: s.name || s.id }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(list));
        } catch (e) { res.writeHead(500); res.end(e.message); }
        return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/get-scene-data') {
        try {
            const sceneId = parsedUrl.searchParams.get('sceneId');
            const appData = getCleanAppData();
            const scene = appData.scenes.find(s => s.id === sceneId);
            if (!scene) { res.writeHead(404); res.end('Сцена не найдена'); return; }

            const hps = (scene.linkHotspots || []).map(hp => {
                const ts = appData.scenes.find(s => s.id === hp.target);
                return {
                    targetId: hp.target,
                    targetName: ts ? (ts.name || hp.target) : hp.target,
                    yaw: hp.yaw,
                    pitch: hp.pitch
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ id: scene.id, name: scene.name || scene.id, hotspots: hps }));
        } catch (e) { res.writeHead(500); res.end(e.message); }
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/save-hotspot') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { sourceSceneId, targetSceneId, yaw, pitch } = JSON.parse(body);
                const appData = getCleanAppData();
                const scene = appData.scenes.find(s => s.id === sourceSceneId);
                if (!scene) { res.writeHead(404); res.end('Сцена не найдена'); return; }

                if (!scene.linkHotspots) scene.linkHotspots = [];
                scene.linkHotspots.push({
                    yaw: parseFloat(yaw),
                    pitch: parseFloat(pitch),
                    rotation: 0,
                    target: targetSceneId
                });

                console.log(`[Добавлено] Сцена "${scene.name}" (ID: ${scene.id}) -> Target ID: ${targetSceneId}`);
                saveAppData(appData);
                res.writeHead(200);
                res.end('OK');
            } catch (e) { res.writeHead(500); res.end(e.message); }
        });
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/delete-hotspot') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { sceneId, index } = JSON.parse(body);
                const appData = getCleanAppData();
                const scene = appData.scenes.find(s => s.id === sceneId);
                if (!scene) { res.writeHead(404); res.end('Scene not found'); return; }

                if (scene.linkHotspots && scene.linkHotspots[index] !== undefined) {
                    console.log(`[Удалено] Сцена "${scene.name}" (ID: ${scene.id}), индекс: ${index}`);
                    scene.linkHotspots.splice(index, 1);
                }

                saveAppData(appData);
                res.writeHead(200);
                res.end('Deleted');
            } catch (e) { res.writeHead(500); res.end(e.message); }
        });
        return;
    }

    const filePath = path.join(__dirname, decodeURIComponent(parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname));
    const ext = path.extname(filePath).toLowerCase();

    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        if (filePath === INDEX_FILE_PATH) {
            let html = fs.readFileSync(filePath, 'utf8');
            let panelHtml = fs.existsSync(PANEL_FILE_PATH) ? fs.readFileSync(PANEL_FILE_PATH, 'utf8') : '';
            res.end(html.includes('</body>') ? html.replace('</body>', panelHtml + '\n</body>') : html + panelHtml);
        } else if (filePath === JS_FILE_PATH) {
            let js = fs.readFileSync(filePath, 'utf8');
            // Привязываем ID сцены прямо к объекту Marzipano.Scene
            js = js.replace(
                'var scene = viewer.createScene({',
                'var scene = viewer.createScene({'
            );
            js = js.replace(
                'return {\n      data: sceneData,\n      scene: scene,\n      view: view\n    };',
                'scene._customId = sceneData.id;\n    return {\n      data: sceneData,\n      scene: scene,\n      view: view\n    };'
            );
            if (js.includes('window.viewer = viewer;')) {
                js = js.replace(
                    'window.viewer = viewer;',
                    'window.viewer = viewer; viewer.addEventListener("sceneChange", function() { if (window.updateEditorSceneContext) window.updateEditorSceneContext(true); });'
                );
            }
            res.end(js);
        } else {
            res.end(fs.readFileSync(filePath));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log('\n==================================================');
    console.log('Локальный 3D-Редактор запущен: http://localhost:' + PORT);
    console.log('==================================================\n');
});
