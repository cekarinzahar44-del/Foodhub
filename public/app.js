// app.js — Professional init (без GLB-загрузки)
(async () => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready(); tg.expand();
    tg.enableClosingConfirmation();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#1a0e07');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#1a0e07');
  }

  const fill  = document.getElementById('load-fill');
  const label = document.getElementById('load-label');

  function setProgress(pct, text) {
    if (fill)  fill.style.width = pct + '%';
    if (label) label.textContent = text;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  try {
    setProgress(10, 'Проверка движка...');
    await sleep(80);

    if (typeof THREE === 'undefined') throw new Error('Three.js не загружен');

    if (typeof window.__initOrbitControls === 'function') window.__initOrbitControls();

    setProgress(30, 'Создание сцены...');
    await sleep(60);

    const gameScreen = document.getElementById('screen-game');
    const prevDisplay = gameScreen.style.display;
    gameScreen.style.display = 'block';
    gameScreen.style.visibility = 'hidden';
    await sleep(50);

    Scene3D.init(document.getElementById('chess-canvas'));

    gameScreen.style.display = prevDisplay || '';
    gameScreen.style.visibility = '';

    setProgress(60, 'Подготовка фигур...');
    await PieceFactory.init();
    await sleep(100);

    setProgress(85, 'Подключение...');
    Game.init();

    setProgress(95, 'Почти готово...');
    await sleep(200);
    setProgress(100, 'Готово!');
    await sleep(300);

    const ls = document.getElementById('screen-loading');
    ls.style.opacity = '0';
    await sleep(500);
    ls.style.display = 'none';

    UI.showMenu();

    const savedBg = localStorage.getItem('chess_bg');
    if (savedBg !== null) Scene3D.setBackground(parseInt(savedBg));

  } catch (err) {
    console.error('Init error:', err);
    if (label) { label.textContent = 'Ошибка: ' + err.message; label.style.color='#e03333'; }
    if (fill)  { fill.style.background = '#e03333'; fill.style.width = '100%'; }
  }

  if (tg) {
    tg.BackButton.onClick(() => {
      const game = document.getElementById('screen-game');
      const mode = document.getElementById('screen-mode');
      if (game && !game.classList.contains('hidden')) {
        tg.showConfirm('Покинуть партию?', ok => { if (ok) { Game.resign(); UI.showMenu(); } });
      } else if (mode && !mode.classList.contains('hidden')) {
        UI.showMenu();
      }
    });

    const observer = new MutationObserver(() => {
      const onMenu = !document.getElementById('screen-menu').classList.contains('hidden');
      if (onMenu) tg.BackButton.hide(); else tg.BackButton.show();
    });
    observer.observe(document.getElementById('screen-menu'), { attributes:true, attributeFilter:['class'] });
  }
})();
