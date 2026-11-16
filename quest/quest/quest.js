'use strict';

(function() {
  const gameState = {
    inventory: [],
    selectedItemId: null,
    collectedUids: {},
    unlockedUids: {}
  };

  let activeHotspots = [];
  let toastTimer = null;

  function getCurrentSceneInfo() {
    const viewer = window.viewer;
    if (!viewer || !window.APP_DATA) return null;
    const currentScene = viewer.scene();
    if (!currentScene) return null;

    const scenesList = viewer.listScenes();
    const index = scenesList.indexOf(currentScene);
    if (index !== -1 && window.APP_DATA.scenes[index]) {
      return {
        sceneObj: currentScene,
        data: window.APP_DATA.scenes[index]
      };
    }
    return null;
  }

  function initHUD() {
    const inv = document.createElement('div');
    inv.id = 'quest-inventory';
    for (let i = 0; i < 5; i++) {
      const slot = document.createElement('div');
      slot.className = 'quest-slot';
      inv.appendChild(slot);
    }
    document.body.appendChild(inv);

    const toast = document.createElement('div');
    toast.id = 'quest-toast';
    document.body.appendChild(toast);

    renderInventory();
  }

  function showToast(text) {
    const toast = document.getElementById('quest-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function renderInventory() {
    const slots = document.querySelectorAll('.quest-slot');
    slots.forEach((slot, idx) => {
      const item = gameState.inventory[idx];
      slot.innerHTML = '';
      slot.classList.remove('selected');
      slot.onclick = null;

      if (item) {
        slot.innerHTML = `
          <img src="${item.icon}" class="quest-slot-img" alt="">
          <div class="quest-slot-title">${item.title}</div>
        `;
        if (gameState.selectedItemId === item.itemId) {
          slot.classList.add('selected');
        }
        slot.onclick = () => {
          gameState.selectedItemId = (gameState.selectedItemId === item.itemId) ? null : item.itemId;
          renderInventory();
          if (gameState.selectedItemId) {
            showToast(`В руке: ${item.title}. Нажмите на объект для применения.`);
          }
        };
      }
    });
  }

  function renderSceneQuests() {
    const info = getCurrentSceneInfo();
    if (!info) return;

    const container = info.sceneObj.hotspotContainer();
    activeHotspots.forEach(hp => {
      try { container.destroyHotspot(hp); } catch (e) {}
    });
    activeHotspots = [];

    const allItems = (window.QUEST_DATA && window.QUEST_DATA.items) ? window.QUEST_DATA.items : [];
    const sceneItems = allItems.filter(item => item.sceneId === info.data.id);

    sceneItems.forEach(item => {
      if (item.type === 'item' && gameState.collectedUids[item.uid]) return;
      if (item.type === 'lock' && gameState.unlockedUids[item.uid]) return;

      const el = document.createElement('div');
      el.className = 'quest-hotspot';
      if (item.type === 'lock') {
        el.classList.add('quest-lock');
      }
      el.innerHTML = `
        <img src="${item.icon}" class="quest-hotspot-img" alt="">
        <div class="quest-hotspot-label">${item.title}</div>
      `;

      const hp = container.createHotspot(el, { yaw: item.yaw, pitch: item.pitch });
      activeHotspots.push(hp);

      el.addEventListener('click', (e) => {
        e.stopPropagation();

        // Подбор предмета
        if (item.type === 'item') {
          if (gameState.inventory.length >= 5) {
            showToast('Инвентарь полон!');
            return;
          }
          gameState.collectedUids[item.uid] = true;
          gameState.inventory.push(item);
          container.destroyHotspot(hp);
          renderInventory();
          showToast(item.message || `Подобрано: ${item.title}`);
        }
        // Замок / Сейф
        else if (item.type === 'lock') {
          if (gameState.selectedItemId && gameState.selectedItemId === item.requireItem) {
            gameState.unlockedUids[item.uid] = true;
            gameState.inventory = gameState.inventory.filter(i => i.itemId !== item.requireItem);
            gameState.selectedItemId = null;
            renderInventory();

            el.classList.add('dissolving');
            showToast(item.successMessage || 'Замок открыт!');

            setTimeout(() => {
              try { container.destroyHotspot(hp); } catch (err) {}
            }, 700);
          } else {
            showToast(item.message || 'Заперто! Нужен подходящий предмет из инвентаря.');
          }
        }
        // Записка
        else if (item.type === 'note') {
          showToast(item.message || item.title);
        }
      });
    });

    updateEditorList();
  }

  // === ВИЗУАЛЬНЫЙ РЕДАКТОР КВЕСТА ===
  let isPicking = false;
  let editingItemUid = null; // Если не null, форма работает в режиме редактирования
  let pickedYaw = 0;
  let pickedPitch = 0;
  let tempPin = null;

  function initEditor() {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'q-editor-toggle';
    toggleBtn.textContent = '🛠 Редактор квеста';
    document.body.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.id = 'q-editor-panel';
    panel.innerHTML = `
      <div class="q-ed-row" style="color:#ffb703;font-weight:bold;">
        Комната: <span id="q-ed-scene-name">...</span>
      </div>
      <div id="q-ed-mode-badge" style="display:none;background:#ffb703;color:#000;padding:4px 8px;border-radius:5px;font-weight:bold;font-size:11px;margin-bottom:8px;text-align:center;">
        ✏️ РЕЖИМ РЕДАКТИРОВАНИЯ ОБЪЕКТА
      </div>
      <div class="q-ed-row">
        <button id="q-ed-pick-btn" class="q-ed-btn q-ed-btn-pick">🎯 Указать точку на панораме</button>
        <div id="q-ed-coords" style="font-size:11px;color:#aaa;margin-top:4px;text-align:center;">yaw: 0.0000, pitch: 0.0000</div>
      </div>
      <div class="q-ed-row">
        <label>Тип объекта:</label>
        <select id="q-ed-type" class="q-ed-select">
          <option value="item">🔑 Предмет (в инвентарь)</option>
          <option value="lock">🔒 Замок / Сейф</option>
          <option value="note">📜 Записка / Осмотр</option>
        </select>
      </div>
      <div class="q-ed-row">
        <label>Название:</label>
        <input id="q-ed-title" class="q-ed-input" placeholder="Например: Ключ от двери">
      </div>
      <div class="q-ed-row">
        <label>Путь к PNG-картинке:</label>
        <input id="q-ed-icon" class="q-ed-input" value="quest/img/key.png">
      </div>
      <div class="q-ed-row" id="q-ed-itemid-row">
        <label>ID предмета (латиницей, напр. key_1):</label>
        <input id="q-ed-itemid" class="q-ed-input" placeholder="key_1">
      </div>
      <div class="q-ed-row" id="q-ed-req-row" style="display:none;">
        <label>Какой ID предмета нужен:</label>
        <input id="q-ed-req" class="q-ed-input" placeholder="key_1">
      </div>
      <div class="q-ed-row">
        <label>Сообщение при клике:</label>
        <input id="q-ed-msg" class="q-ed-input" placeholder="Вы нашли ключ!">
      </div>
      <div class="q-ed-row" id="q-ed-succ-row" style="display:none;">
        <label>Сообщение при открытии замка:</label>
        <input id="q-ed-succ" class="q-ed-input" placeholder="Замок открыт!">
      </div>

      <!-- Кнопка для создания нового объекта -->
      <button id="q-ed-save-btn" class="q-ed-btn q-ed-btn-save">💾 Создать и сохранить объект</button>

      <!-- Кнопки для сохранения/отмены при редактировании существующего -->
      <div id="q-ed-edit-actions" class="q-ed-edit-controls" style="display:none;">
        <button id="q-ed-confirm-btn" class="q-ed-btn q-ed-btn-confirm">✅ Сохранить</button>
        <button id="q-ed-cancel-btn" class="q-ed-btn q-ed-btn-cancel">❌ Отмена</button>
      </div>

      <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.15);padding-top:8px;">
        <div style="font-size:11px;color:#aaa;">Объекты в комнате (✏️ — изменить):</div>
        <div id="q-ed-items-list"></div>
      </div>
    `;
    document.body.appendChild(panel);

    toggleBtn.onclick = () => {
      panel.classList.toggle('open');
      updateEditorList();
    };

    const typeSelect = document.getElementById('q-ed-type');
    window.syncEditorFieldsVisibility = (autoSetIcon = true) => {
      const val = typeSelect.value;
      document.getElementById('q-ed-itemid-row').style.display = (val === 'item') ? 'block' : 'none';
      document.getElementById('q-ed-req-row').style.display = (val === 'lock') ? 'block' : 'none';
      document.getElementById('q-ed-succ-row').style.display = (val === 'lock') ? 'block' : 'none';
      if (autoSetIcon) {
        if (val === 'item') document.getElementById('q-ed-icon').value = 'quest/img/key.png';
        if (val === 'lock') document.getElementById('q-ed-icon').value = 'quest/img/lock.png';
        if (val === 'note') document.getElementById('q-ed-icon').value = 'quest/img/note.png';
      }
    };
    typeSelect.onchange = () => window.syncEditorFieldsVisibility(true);

    // Сброс формы в режим создания нового объекта
    window.resetEditorForm = () => {
      editingItemUid = null;
      document.getElementById('q-ed-mode-badge').style.display = 'none';
      document.getElementById('q-ed-save-btn').style.display = 'block';
      document.getElementById('q-ed-edit-actions').style.display = 'none';

      document.getElementById('q-ed-type').value = 'item';
      document.getElementById('q-ed-title').value = '';
      document.getElementById('q-ed-icon').value = 'quest/img/key.png';
      document.getElementById('q-ed-itemid').value = '';
      document.getElementById('q-ed-req').value = '';
      document.getElementById('q-ed-msg').value = '';
      document.getElementById('q-ed-succ').value = '';
      window.syncEditorFieldsVisibility(false);

      const info = getCurrentSceneInfo();
      if (tempPin && info) {
        try { info.sceneObj.hotspotContainer().destroyHotspot(tempPin); tempPin = null; } catch (err) {}
      }
      updateEditorList();
    };

    document.getElementById('q-ed-cancel-btn').onclick = () => {
      window.resetEditorForm();
      showToast('Редактирование отменено');
    };

    const pickBtn = document.getElementById('q-ed-pick-btn');
    pickBtn.onclick = () => {
      isPicking = !isPicking;
      pickBtn.classList.toggle('picking', isPicking);
      document.body.classList.toggle('q-picking-mode', isPicking);
      pickBtn.textContent = isPicking ? '🎯 Кликни в место на панораме...' : '🎯 Указать точку на панораме';
    };

    const panoEl = document.getElementById('pano');
    let downX = 0, downY = 0;
    panoEl.addEventListener('mousedown', e => { downX = e.clientX; downY = e.clientY; });
    panoEl.addEventListener('mouseup', e => {
      if (!isPicking) return;
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;

      const info = getCurrentSceneInfo();
      if (!info) return;
      const rect = panoEl.getBoundingClientRect();
      const coords = info.sceneObj.view().screenToCoordinates({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
      if (!coords) return;

      pickedYaw = Number(coords.yaw.toFixed(4));
      pickedPitch = Number(coords.pitch.toFixed(4));
      document.getElementById('q-ed-coords').textContent = `yaw: ${pickedYaw}, pitch: ${pickedPitch}`;

      const container = info.sceneObj.hotspotContainer();
      if (tempPin) { try { container.destroyHotspot(tempPin); } catch (err) {} }
      const pinEl = document.createElement('div');
      pinEl.className = 'q-temp-pin';
      tempPin = container.createHotspot(pinEl, { yaw: pickedYaw, pitch: pickedPitch });

      isPicking = false;
      pickBtn.classList.remove('picking');
      document.body.classList.remove('q-picking-mode');
      pickBtn.textContent = '🎯 Точка выбрана! (нажми чтобы изменить)';
    });

    // Сбор данных из полей формы
    function collectFormData(uid, sceneId) {
      return {
        uid: uid,
        sceneId: sceneId,
        type: document.getElementById('q-ed-type').value,
        title: document.getElementById('q-ed-title').value.trim(),
        icon: document.getElementById('q-ed-icon').value.trim() || 'quest/img/key.png',
        yaw: pickedYaw,
        pitch: pickedPitch,
        itemId: document.getElementById('q-ed-itemid').value.trim(),
        requireItem: document.getElementById('q-ed-req').value.trim(),
        message: document.getElementById('q-ed-msg').value.trim(),
        successMessage: document.getElementById('q-ed-succ').value.trim()
      };
    }

    // Создание НОВОГО объекта
    document.getElementById('q-ed-save-btn').onclick = async () => {
      const info = getCurrentSceneInfo();
      if (!info) return;
      const newItem = collectFormData('q_' + Date.now(), info.data.id);
      if (!newItem.title) { showToast('Введите название объекта!'); return; }

      try {
        const res = await fetch('/save-quest-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItem)
        });
        if (res.ok) {
          window.QUEST_DATA.items.push(newItem);
          window.resetEditorForm();
          renderSceneQuests();
          showToast(`Создано: ${newItem.title}`);
        }
      } catch (err) {
        showToast('Нет связи с quest_server.js!');
      }
    };

    // Подтверждение изменений при РЕДАКТИРОВАНИИ существующего
    document.getElementById('q-ed-confirm-btn').onclick = async () => {
      const info = getCurrentSceneInfo();
      if (!info || !editingItemUid) return;
      const updatedItem = collectFormData(editingItemUid, info.data.id);
      if (!updatedItem.title) { showToast('Введите название объекта!'); return; }

      try {
        const res = await fetch('/update-quest-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem)
        });
        if (res.ok) {
          const idx = window.QUEST_DATA.items.findIndex(i => i.uid === editingItemUid);
          if (idx !== -1) window.QUEST_DATA.items[idx] = updatedItem;
          window.resetEditorForm();
          renderSceneQuests();
          showToast(`Изменения сохранены: ${updatedItem.title}`);
        }
      } catch (err) {
        showToast('Ошибка связи с сервером!');
      }
    };
  }

  function updateEditorList() {
    const info = getCurrentSceneInfo();
    const nameEl = document.getElementById('q-ed-scene-name');
    const listEl = document.getElementById('q-ed-items-list');
    if (!info || !nameEl || !listEl) return;

    nameEl.textContent = `${info.data.name || info.data.id} (${info.data.id})`;
    const sceneItems = (window.QUEST_DATA.items || []).filter(i => i.sceneId === info.data.id);

    listEl.innerHTML = '';
    if (sceneItems.length === 0) {
      listEl.innerHTML = '<div style="color:#777;font-size:11px;margin-top:4px;">Пока пусто</div>';
      return;
    }

    sceneItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'q-ed-list-item' + (editingItemUid === item.uid ? ' editing-active' : '');
      row.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;">${item.title}</span>`;

      const actions = document.createElement('div');
      actions.className = 'q-ed-actions';

      // Кнопка полного редактирования объекта
      const editBtn = document.createElement('button');
      editBtn.className = 'q-ed-move';
      editBtn.title = 'Редактировать объект';
      editBtn.textContent = '✏️';
      editBtn.onclick = () => {
        editingItemUid = item.uid;
        pickedYaw = item.yaw;
        pickedPitch = item.pitch;

        document.getElementById('q-ed-mode-badge').style.display = 'block';
        document.getElementById('q-ed-save-btn').style.display = 'none';
        document.getElementById('q-ed-edit-actions').style.display = 'flex';

        document.getElementById('q-ed-coords').textContent = `yaw: ${pickedYaw}, pitch: ${pickedPitch}`;
        document.getElementById('q-ed-type').value = item.type;
        document.getElementById('q-ed-title').value = item.title || '';
        document.getElementById('q-ed-icon').value = item.icon || '';
        document.getElementById('q-ed-itemid').value = item.itemId || '';
        document.getElementById('q-ed-req').value = item.requireItem || '';
        document.getElementById('q-ed-msg').value = item.message || '';
        document.getElementById('q-ed-succ').value = item.successMessage || '';
        window.syncEditorFieldsVisibility(false);

        showToast(`Редактируем: ${item.title}`);
        updateEditorList();
      };

      // Кнопка удаления
      const delBtn = document.createElement('button');
      delBtn.className = 'q-ed-del';
      delBtn.textContent = '🗑';
      delBtn.onclick = async () => {
        if (editingItemUid === item.uid) window.resetEditorForm();
        await fetch('/delete-quest-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: item.uid })
        });
        window.QUEST_DATA.items = window.QUEST_DATA.items.filter(i => i.uid !== item.uid);
        renderSceneQuests();
      };

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  window.addEventListener('load', () => {
    initHUD();
    initEditor();

    setTimeout(() => {
      renderSceneQuests();
      if (window.viewer) {
        window.viewer.addEventListener('sceneChange', renderSceneQuests);
      }
    }, 350);
  });
})();
