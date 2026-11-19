'use strict';

(function() {
  let isPicking = false;
  let editingItemUid = null;
  let pickedYaw = 0;
  let pickedPitch = 0;
  let tempPin = null;

  function initEditor() {
    const api = window.QuestAPI;
    if (!api) return;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'q-editor-toggle';
    toggleBtn.textContent = '🛠 Редактор квеста';
    document.body.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.id = 'q-editor-panel';
    panel.classList.add('open');
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

      <button id="q-ed-save-btn" class="q-ed-btn q-ed-btn-save">💾 Создать и сохранить объект</button>

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
    function syncEditorFieldsVisibility(autoSetIcon = true) {
      const val = typeSelect.value;
      document.getElementById('q-ed-itemid-row').style.display = (val === 'item') ? 'block' : 'none';
      document.getElementById('q-ed-req-row').style.display = (val === 'lock') ? 'block' : 'none';
      document.getElementById('q-ed-succ-row').style.display = (val === 'lock') ? 'block' : 'none';
      if (autoSetIcon) {
        if (val === 'item') document.getElementById('q-ed-icon').value = 'quest/img/key.png';
        if (val === 'lock') document.getElementById('q-ed-icon').value = 'quest/img/lock.png';
        if (val === 'note') document.getElementById('q-ed-icon').value = 'quest/img/note.png';
      }
    }
    typeSelect.onchange = () => syncEditorFieldsVisibility(true);

    function resetEditorForm() {
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
      syncEditorFieldsVisibility(false);

      const info = api.getCurrentSceneInfo();
      if (tempPin && info) {
        try { info.sceneObj.hotspotContainer().destroyHotspot(tempPin); tempPin = null; } catch (err) {}
      }
      updateEditorList();
    }

    document.getElementById('q-ed-cancel-btn').onclick = () => {
      resetEditorForm();
      api.showToast('Редактирование отменено');
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

      const info = api.getCurrentSceneInfo();
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

    document.getElementById('q-ed-save-btn').onclick = async () => {
      const info = api.getCurrentSceneInfo();
      if (!info) return;
      const newItem = collectFormData('q_' + Date.now(), info.data.id);
      if (!newItem.title) { api.showToast('Введите название объекта!'); return; }

      try {
        const res = await fetch('/save-quest-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItem)
        });
        if (res.ok) {
          window.QUEST_DATA.items.push(newItem);
          resetEditorForm();
          api.renderSceneQuests();
          api.showToast(`Создано: ${newItem.title}`);
        }
      } catch (err) {
        api.showToast('Нет связи с quest_server.js!');
      }
    };

    document.getElementById('q-ed-confirm-btn').onclick = async () => {
      const info = api.getCurrentSceneInfo();
      if (!info || !editingItemUid) return;
      const updatedItem = collectFormData(editingItemUid, info.data.id);
      if (!updatedItem.title) { api.showToast('Введите название объекта!'); return; }

      try {
        const res = await fetch('/update-quest-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem)
        });
        if (res.ok) {
          const idx = window.QUEST_DATA.items.findIndex(i => i.uid === editingItemUid);
          if (idx !== -1) window.QUEST_DATA.items[idx] = updatedItem;
          resetEditorForm();
          api.renderSceneQuests();
          api.showToast(`Изменения сохранены: ${updatedItem.title}`);
        }
      } catch (err) {
        api.showToast('Ошибка связи с сервером!');
      }
    };

    function updateEditorList() {
      const info = api.getCurrentSceneInfo();
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
          syncEditorFieldsVisibility(false);

          api.showToast(`Редактируем: ${item.title}`);
          updateEditorList();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'q-ed-del';
        delBtn.textContent = '🗑';
        delBtn.onclick = async () => {
          if (editingItemUid === item.uid) resetEditorForm();
          await fetch('/delete-quest-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: item.uid })
          });
          window.QUEST_DATA.items = window.QUEST_DATA.items.filter(i => i.uid !== item.uid);
          api.renderSceneQuests();
        };

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        row.appendChild(actions);
        listEl.appendChild(row);
      });
    }

    window.QuestEditor = { updateList: updateEditorList };
  }

  function startEditorWhenReady() {
    if (window.QuestAPI && document.body) {
      initEditor();
      setTimeout(() => {
        if (window.QuestEditor) window.QuestEditor.updateList();
      }, 450);
    } else {
      setTimeout(startEditorWhenReady, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEditorWhenReady);
  } else {
    startEditorWhenReady();
  }
})();

