'use strict';

(function() {
  var WolfTour = window.WolfTour;
  var data = window.APP_DATA;

  // =========================================================================
  // ГЛАВНЫЕ НАСТРОЙКИ ПРОЕКТА
  // =========================================================================
  var START_SCENE_INDEX = 0;        // Индекс стартовой сцены
  var GAME_TITLE = "Finder: Animals";
  var TILES_URL = "tiles";          // Путь к тайлам
  var DEFAULT_TOLERANCE = 0.18;     // Допуск попадания клика (в радианах)

  // Размер контейнера превью выбранного пазла (в пикселях)
  var PREVIEW_WIDTH_PC = 240;       // Ширина окна превью на ПК
  var PREVIEW_WIDTH_MOBILE = 155;   // Ширина окна превью на смартфоне
  // =========================================================================

  document.documentElement.style.setProperty('--preview-width-pc', PREVIEW_WIDTH_PC + 'px');
  document.documentElement.style.setProperty('--preview-width-mobile', PREVIEW_WIDTH_MOBILE + 'px');

  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var counterElement = document.getElementById('puzzle-counter');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneListUl = document.getElementById('sceneListUl');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');

  var inventoryContainer = document.getElementById('puzzle-inventory');
  var inventoryWrapper = document.getElementById('puzzle-inventory-wrapper');
  var previewBox = document.getElementById('puzzle-preview-box');
  var previewImg = document.getElementById('puzzle-preview-img');
  var previewCloseBtn = document.getElementById('puzzle-preview-close');
  var fireworksContainer = document.getElementById('puzzle-fireworks');
  var winModal = document.getElementById('win-modal');
  var winRestartBtn = document.getElementById('win-restart-btn');

  var activeSceneObj = null;
  var remainingPuzzles = [];
  var totalPuzzlesCount = 0;
  var selectedPuzzle = null;
  var isAnimatingMatch = false;

  if (window.matchMedia) {
    var setMode = function() {
      document.body.classList.toggle('mobile', mql.matches);
      document.body.classList.toggle('desktop', !mql.matches);
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    if (mql.addEventListener) mql.addEventListener('change', setMode);
  } else {
    document.body.classList.add('desktop');
  }

  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function onFirstTouch() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
    window.removeEventListener('touchstart', onFirstTouch);
  });

  var viewer = new WolfTour.Viewer(panoElement, {
    controls: { mouseViewMode: data.settings.mouseViewMode }
  });
  window.viewer = viewer;

  var scenes = data.scenes.map(function(sceneData, index) {
    var urlPrefix = TILES_URL.replace(/\/+$/, '');
    var ext = (data.settings && data.settings.tileFormat) ? data.settings.tileFormat : "jpg";
    var source = WolfTour.ImageUrlSource.fromString(
      urlPrefix + "/" + sceneData.id + "/{z}/{f}/{y}/{x}." + ext,
      { cubeMapPreviewUrl: urlPrefix + "/" + sceneData.id + "/preview." + ext }
    );
    var geometry = new WolfTour.CubeGeometry(sceneData.levels);
    var limiter = WolfTour.RectilinearView.limit.traditional(sceneData.faceSize * 2, 125 * Math.PI / 180, 140 * Math.PI / 180);
    var view = new WolfTour.RectilinearView(sceneData.initialViewParameters, limiter);
    var scene = viewer.createScene({ source: source, geometry: geometry, view: view, pinFirstLevel: true });

    if (sceneListUl) {
      var li = document.createElement('li');
      li.className = 'scene';
      var a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.className = 'text';
      a.textContent = sceneData.name || ('Уровень ' + (index + 1));
      a.addEventListener('click', function() { switchScene(scenes[index]); hideSceneList(); });
      li.appendChild(a);
      sceneListUl.appendChild(li);
    }

    return { data: sceneData, scene: scene, view: view };
  });
  if (sceneListToggleElement && sceneListElement) {
    sceneListToggleElement.addEventListener('click', function() {
      sceneListElement.classList.toggle('enabled');
      sceneListToggleElement.classList.toggle('enabled');
    });
  }

  function hideSceneList() {
    if (sceneListElement) sceneListElement.classList.remove('enabled');
    if (sceneListToggleElement) sceneListToggleElement.classList.remove('enabled');
  }

  function updateCounter() {
    if (!counterElement) return;
    counterElement.textContent = (totalPuzzlesCount - remainingPuzzles.length) + " / " + totalPuzzlesCount;
  }

  function selectPuzzle(puzzle) {
    if (isAnimatingMatch) return;
    selectedPuzzle = puzzle;

    var slots = inventoryContainer.querySelectorAll('.inventory-slot');
    slots.forEach(function(slot) {
      slot.classList.toggle('active', !!(puzzle && slot.getAttribute('data-puzzle-id') === puzzle.id));
    });

    if (puzzle) {
      previewImg.src = puzzle.image;
      previewBox.classList.remove('hidden', 'shake-error', 'match-success');
      panoElement.classList.add('puzzle-aim-mode');
    } else {
      previewBox.classList.add('hidden');
      previewBox.classList.remove('match-success', 'shake-error');
      panoElement.classList.remove('puzzle-aim-mode');
    }
  }

  function triggerPreviewSuccessAnimation(onComplete) {
    isAnimatingMatch = true;
    previewBox.classList.remove('shake-error');
    previewBox.classList.add('match-success');

    if (fireworksContainer) {
      fireworksContainer.innerHTML = '';
      var colors = ['#34c759', '#ffcc00', '#00d2ff', '#ffffff', '#ff6b6b'];
      var sparkCount = 18;

      for (var i = 0; i < sparkCount; i++) {
        var spark = document.createElement('span');
        spark.className = 'firework-spark';
        var angle = (Math.PI * 2 * i) / sparkCount;
        var dist = 45 + Math.random() * 45;
        spark.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        spark.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        spark.style.backgroundColor = colors[i % colors.length];
        fireworksContainer.appendChild(spark);
      }
    }

    setTimeout(function() {
      isAnimatingMatch = false;
      if (fireworksContainer) fireworksContainer.innerHTML = '';
      if (onComplete) onComplete();
    }, 850);
  }

  function renderInventory() {
    inventoryContainer.innerHTML = '';
    if (remainingPuzzles.length === 0) {
      inventoryWrapper.style.display = 'none';
      return;
    }
    inventoryWrapper.style.display = 'block';

    remainingPuzzles.forEach(function(puzzle) {
      var slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.setAttribute('data-puzzle-id', puzzle.id);

      var img = document.createElement('img');
      img.src = puzzle.image;
      img.alt = 'Фрагмент пазла';
      slot.appendChild(img);

      slot.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isAnimatingMatch) return;
        selectPuzzle(selectedPuzzle && selectedPuzzle.id === puzzle.id ? null : puzzle);
      });
      inventoryContainer.appendChild(slot);
    });
  }

  function initPuzzlesForScene(sceneObj) {
    isAnimatingMatch = false;
    winModal.classList.add('hidden');
    selectPuzzle(null);

    var rawPuzzles = (sceneObj.data && sceneObj.data.puzzles) ? sceneObj.data.puzzles : [];
    remainingPuzzles = rawPuzzles.slice().sort(function() { return Math.random() - 0.5; });
    totalPuzzlesCount = remainingPuzzles.length;

    updateCounter();
    renderInventory();
  }
  function getAngularDistance(yaw1, pitch1, yaw2, pitch2) {
    var cosAngle = Math.sin(pitch1) * Math.sin(pitch2) + Math.cos(pitch1) * Math.cos(pitch2) * Math.cos(yaw1 - yaw2);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  }

  function handleSceneClick(clientX, clientY) {
    if (!selectedPuzzle || !activeSceneObj || isAnimatingMatch) return;

    var rect = panoElement.getBoundingClientRect();
    var coords = activeSceneObj.view.screenToCoordinates({
      x: clientX - rect.left,
      y: clientY - rect.top
    });
    if (!coords) return;

    var tolerance = selectedPuzzle.tolerance || DEFAULT_TOLERANCE;
    var distance = getAngularDistance(coords.yaw, coords.pitch, selectedPuzzle.yaw, selectedPuzzle.pitch);

    if (distance <= tolerance) {
      var matched = selectedPuzzle;
      triggerPreviewSuccessAnimation(function() {
        remainingPuzzles = remainingPuzzles.filter(function(p) { return p.id !== matched.id; });
        selectPuzzle(null);
        renderInventory();
        updateCounter();

        if (remainingPuzzles.length === 0 && totalPuzzlesCount > 0) {
          setTimeout(function() { winModal.classList.remove('hidden'); }, 250);
        }
      });
    } else {
      previewBox.classList.remove('shake-error');
      void previewBox.offsetWidth;
      previewBox.classList.add('shake-error');
    }
  }

  var pointerDownPos = null;
  panoElement.addEventListener('pointerdown', function(e) {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  panoElement.addEventListener('pointerup', function(e) {
    if (!pointerDownPos) return;
    var dx = e.clientX - pointerDownPos.x;
    var dy = e.clientY - pointerDownPos.y;
    pointerDownPos = null;

    if (Math.hypot(dx, dy) < 6) {
      handleSceneClick(e.clientX, e.clientY);
    }
  });

  if (previewCloseBtn) {
    previewCloseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      selectPuzzle(null);
    });
  }

  if (winRestartBtn) {
    winRestartBtn.addEventListener('click', function() {
      if (activeSceneObj) initPuzzlesForScene(activeSceneObj);
    });
  }

  function switchScene(scene) {
    if (!scene) return;
    activeSceneObj = scene;
    scene.scene.switchTo();

    if (sceneNameElement) {
      sceneNameElement.textContent = GAME_TITLE + (scene.data.name ? " — " + scene.data.name : "");
    }
    initPuzzlesForScene(scene);
  }

  var startScene = scenes[START_SCENE_INDEX] || scenes;
  if (startScene) switchScene(startScene);
  hideSceneList();

})();
