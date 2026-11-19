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
        else if (item.type === 'note') {
          showToast(item.message || item.title);
        }
      });
    });

    if (window.QuestEditor && typeof window.QuestEditor.updateList === 'function') {
      window.QuestEditor.updateList();
    }
  }

  window.QuestAPI = {
    getCurrentSceneInfo,
    showToast,
    renderSceneQuests
  };

  window.addEventListener('load', () => {
    initHUD();

    setTimeout(() => {
      renderSceneQuests();
      if (window.viewer) {
        window.viewer.addEventListener('sceneChange', renderSceneQuests);
      }
    }, 350);
  });
})();
