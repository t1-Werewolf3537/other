'use strict';

(function() {
  var WolfTour = window.WolfTour;
  var data = window.APP_DATA;

  // =========================================================================
  // ГЛАВНЫЕ НАСТРОЙКИ ПРОЕКТА
  // =========================================================================
  var START_SCENE_INDEX = 0;        // Индекс стартовой сцены
  var GAME_TITLE = "Finder: Animals";
  var STORAGE_KEY = "finder_animals_progress_v1"; // Ключ сохранения прогресса в браузере
  var TILES_URL = "tiles";          // Путь к тайлам
  var DEFAULT_TOLERANCE = 0.18;     // Допуск попадания клика (в радианах)
  var FALLBACK_SECONDS_PER_PUZZLE = 15; // Секунд на 1 пазл, если в data.js нет timeLimit

  // Размер контейнера превью выбранного пазла (в пикселях)
  var PREVIEW_WIDTH_PC = 310;       // Ширина окна превью на ПК
  var PREVIEW_WIDTH_MOBILE = 155;   // Ширина окна превью на смартфоне
  // =========================================================================

  document.documentElement.style.setProperty('--preview-width-pc', PREVIEW_WIDTH_PC + 'px');
  document.documentElement.style.setProperty('--preview-width-mobile', PREVIEW_WIDTH_MOBILE + 'px');

  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var counterElement = document.getElementById('puzzle-counter');
  var timerElement = document.getElementById('game-timer');

  var sceneListElement = document.querySelector('#sceneList');
  var sceneListUl = document.getElementById('sceneListUl');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var totalProgressStat = document.getElementById('total-progress-stat');

  var inventoryContainer = document.getElementById('puzzle-inventory');
  var inventoryWrapper = document.getElementById('puzzle-inventory-wrapper');
  var previewBox = document.getElementById('puzzle-preview-box');
  var previewImg = document.getElementById('puzzle-preview-img');
  var previewCloseBtn = document.getElementById('puzzle-preview-close');
  var fireworksContainer = document.getElementById('puzzle-fireworks');

  var winModal = document.getElementById('win-modal');
  var modalTitle = document.getElementById('modal-title');
  var modalSubtitle = document.getElementById('modal-subtitle');
  var modalStats = document.getElementById('modal-stats');
  var winRestartBtn = document.getElementById('win-restart-btn');
  var winNextBtn = document.getElementById('win-next-btn');

  // --- СИНТЕЗАТОР ЗВУКОВ (WEB AUDIO API) ------------------------------------
  var audioCtx = null;

  function playTone(freq, type, duration, delay, vol) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var startTime = audioCtx.currentTime + (delay || 0);
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(vol || 0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) {}
  }

  var SoundFX = {
    select: function() { playTone(520, 'sine', 0.08, 0, 0.12); },
    success: function() {
      playTone(523.25, 'triangle', 0.18, 0, 0.18);
      playTone(659.25, 'triangle', 0.18, 0.09, 0.18);
      playTone(783.99, 'triangle', 0.3, 0.18, 0.2);
    },
    error: function() {
      playTone(180, 'sawtooth', 0.14, 0, 0.12);
      playTone(140, 'sawtooth', 0.18, 0.1, 0.12);
    },
    win: function() {
      playTone(523.25, 'sine', 0.15, 0, 0.18);
      playTone(659.25, 'sine', 0.15, 0.1, 0.18);
      playTone(783.99, 'sine', 0.15, 0.2, 0.18);
      playTone(1046.5, 'sine', 0.4, 0.3, 0.22);
    },
    timeout: function() {
      playTone(300, 'sawtooth', 0.25, 0, 0.15);
      playTone(220, 'sawtooth', 0.35, 0.2, 0.15);
    }
  };

  // --- ХРАНЕНИЕ ПРОГРЕССА В LOCALSTORAGE ------------------------------------
  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { completed: {}, totalTimeSpent: 0 };
    } catch (e) {
      return { completed: {}, totalTimeSpent: 0 };
    }
  }

  function saveLevelWin(sceneId, timeSpentSec) {
    var prog = loadProgress();
    prog.totalTimeSpent = (prog.totalTimeSpent || 0) + timeSpentSec;
    var prev = prog.completed[sceneId];
    if (!prev || timeSpentSec < prev.bestTime) {
      prog.completed[sceneId] = {
        completed: true,
        bestTime: timeSpentSec
      };
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prog)); } catch (e) {}
    renderSceneMenu();
  }
  var activeSceneObj = null;
  var activeSceneIndex = 0;
  var remainingPuzzles = [];
  var totalPuzzlesCount = 0;
  var selectedPuzzle = null;
  var isAnimatingMatch = false;

  var timeLeft = 0;
  var levelTotalTime = 0;
  var timerInterval = null;
  var isGameOver = false;

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

  var scenes = data.scenes.map(function(sceneData) {
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

    return { data: sceneData, scene: scene, view: view };
  });

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Отрисовка меню уровней с галочкой (пройдено) и нейтральным значком (не пройдено)
  function renderSceneMenu() {
    if (!sceneListUl) return;
    var prog = loadProgress();
    var completedCount = 0;
    sceneListUl.innerHTML = '';

    scenes.forEach(function(sc, idx) {
      var sceneId = sc.data.id;
      var record = prog.completed[sceneId];
      if (record && record.completed) completedCount++;

      var li = document.createElement('li');
      li.className = 'scene' + (idx === activeSceneIndex ? ' active-scene' : '');

      var a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.className = 'text';

      var titleSpan = document.createElement('span');
      titleSpan.textContent = (idx + 1) + '. ' + (sc.data.name || ('Сцена ' + (idx + 1)));

      var statusSpan = document.createElement('span');
      if (record && record.completed) {
        statusSpan.className = 'scene-status-badge scene-status-done';
        statusSpan.textContent = '✓ ' + formatTime(record.bestTime);
      } else {
        statusSpan.className = 'scene-status-badge scene-status-new';
        statusSpan.textContent = '○';
      }

      a.appendChild(titleSpan);
      a.appendChild(statusSpan);
      a.addEventListener('click', function() {
        switchScene(idx);
        hideSceneList();
      });

      li.appendChild(a);
      sceneListUl.appendChild(li);
    });

    if (totalProgressStat) {
      totalProgressStat.textContent = completedCount + ' / ' + scenes.length;
    }
  }

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

  function updateHUD() {
    if (counterElement) {
      counterElement.textContent = (totalPuzzlesCount - remainingPuzzles.length) + ' / ' + totalPuzzlesCount;
    }
    if (timerElement) {
      timerElement.textContent = formatTime(timeLeft);
      timerElement.classList.toggle('timer-warning', timeLeft <= 10 && timeLeft > 0);
    }
  }

  function startLevelTimer(seconds) {
    clearInterval(timerInterval);
    levelTotalTime = seconds;
    timeLeft = seconds;
    updateHUD();

    timerInterval = setInterval(function() {
      if (isGameOver) return;
      timeLeft--;
      updateHUD();

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        isGameOver = true;
        selectPuzzle(null);
        SoundFX.timeout();
        showEndModal(false);
      }
    }, 1000);
  }
  function selectPuzzle(puzzle) {
    if (isAnimatingMatch) return;
    selectedPuzzle = puzzle;

    var slots = inventoryContainer.querySelectorAll('.inventory-slot');
    slots.forEach(function(slot) {
      slot.classList.toggle('active', !!(puzzle && slot.getAttribute('data-puzzle-id') === puzzle.id));
    });

    if (puzzle) {
      SoundFX.select();
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
      for (var i = 0; i < 18; i++) {
        var spark = document.createElement('span');
        spark.className = 'firework-spark';
        var angle = (Math.PI * 2 * i) / 18;
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
    }, 800);
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
        if (isAnimatingMatch || isGameOver) return;
        selectPuzzle(selectedPuzzle && selectedPuzzle.id === puzzle.id ? null : puzzle);
      });
      inventoryContainer.appendChild(slot);
    });
  }

  function showEndModal(isWin) {
    var prog = loadProgress();
    if (isWin) {
      var spent = Math.max(1, levelTotalTime - timeLeft);
      saveLevelWin(activeSceneObj.data.id, spent);
      prog = loadProgress();

      modalTitle.textContent = 'Уровень пройден!';
      modalTitle.style.color = '#ffcc00';
      modalSubtitle.style.display = 'none';
      modalStats.innerHTML =
        'Время уровня: <b>' + formatTime(spent) + '</b><br>' +
        'Всего времени в игре: <b>' + formatTime(prog.totalTimeSpent) + '</b>';
    } else {
      modalTitle.textContent = 'Время вышло!';
      modalTitle.style.color = '#ff3b30';
      modalSubtitle.style.display = 'block';
      modalSubtitle.textContent = 'Не успели найти все фрагменты панорамы.';
      modalStats.innerHTML =
        'Найдено фрагментов: <b>' + (totalPuzzlesCount - remainingPuzzles.length) + ' из ' + totalPuzzlesCount + '</b>';
    }

    if (winNextBtn) {
      winNextBtn.style.display = (activeSceneIndex + 1 < scenes.length) ? 'inline-block' : 'none';
    }
    winModal.classList.remove('hidden');
  }

  function initPuzzlesForScene(sceneObj) {
    isAnimatingMatch = false;
    isGameOver = false;
    winModal.classList.add('hidden');
    selectPuzzle(null);

    var rawPuzzles = (sceneObj.data && sceneObj.data.puzzles) ? sceneObj.data.puzzles : [];
    remainingPuzzles = rawPuzzles.slice().sort(function() { return Math.random() - 0.5; });
    totalPuzzlesCount = remainingPuzzles.length;

    renderInventory();

    var calcTime = sceneObj.data.timeLimit || Math.max(20, totalPuzzlesCount * FALLBACK_SECONDS_PER_PUZZLE);
    startLevelTimer(calcTime);
  }

  function getAngularDistance(yaw1, pitch1, yaw2, pitch2) {
    var cosAngle = Math.sin(pitch1) * Math.sin(pitch2) + Math.cos(pitch1) * Math.cos(pitch2) * Math.cos(yaw1 - yaw2);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  }

  function handleSceneClick(clientX, clientY) {
    if (!selectedPuzzle || !activeSceneObj || isAnimatingMatch || isGameOver) return;

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
      SoundFX.success();
      updateHUD();

      triggerPreviewSuccessAnimation(function() {
        remainingPuzzles = remainingPuzzles.filter(function(p) { return p.id !== matched.id; });
        selectPuzzle(null);
        renderInventory();
        updateHUD();

        if (remainingPuzzles.length === 0 && totalPuzzlesCount > 0) {
          clearInterval(timerInterval);
          isGameOver = true;
          SoundFX.win();
          setTimeout(function() { showEndModal(true); }, 250);
        }
      });
    } else {
      SoundFX.error();
      previewBox.classList.remove('shake-error');
      void previewBox.offsetWidth;
      previewBox.classList.add('shake-error');
    }
  }

  var pointerDownPos = null;
  panoElement.addEventListener('pointerdown', function(e) { pointerDownPos = { x: e.clientX, y: e.clientY }; });
  panoElement.addEventListener('pointerup', function(e) {
    if (!pointerDownPos) return;
    var dx = e.clientX - pointerDownPos.x;
    var dy = e.clientY - pointerDownPos.y;
    pointerDownPos = null;
    if (Math.hypot(dx, dy) < 6) handleSceneClick(e.clientX, e.clientY);
  });

  if (previewCloseBtn) previewCloseBtn.addEventListener('click', function(e) { e.stopPropagation(); selectPuzzle(null); });
  if (winRestartBtn) winRestartBtn.addEventListener('click', function() { if (activeSceneObj) initPuzzlesForScene(activeSceneObj); });
  if (winNextBtn) winNextBtn.addEventListener('click', function() {
    if (activeSceneIndex + 1 < scenes.length) switchScene(activeSceneIndex + 1);
  });

  function switchScene(index) {
    var target = scenes[index];
    if (!target) return;
    activeSceneIndex = index;
    activeSceneObj = target;
    target.scene.switchTo();

    if (sceneNameElement) {
      sceneNameElement.textContent = GAME_TITLE + (target.data.name ? ' — ' + target.data.name : '');
    }
    renderSceneMenu();
    initPuzzlesForScene(target);
  }

  switchScene(START_SCENE_INDEX);
  hideSceneList();

})();
