const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let menu = [];
let cart = [];

window.addEventListener('load', () => {
  setTimeout(() => {
    document.body.classList.add('loaded');
    loadMenu();
    initProfile();
    setupNavigation();
  }, 3000);
});

// Навигация
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      // Убираем активный класс у всех кнопок
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      // Добавляем активный класс нажатой
      btn.classList.add('active');
      
      // Скрываем все страницы
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      // Показываем нужную
      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.add('active');
      
      // Скролл вверх
      window.scrollTo(0, 0);
    };
  });
}

function switchToTab(tabName) {
  const btn = document.querySelector(`.nav-item[data-target="page-${tabName}"]`);
  if (btn) btn.click();
}

// Профиль
function initProfile() {
  const user = tg.initDataUnsafe.user;
  if (user) {
    document.getElementById('profile-name').innerText = user.first_name || 'Пользователь';
    document.getElementById('profile-id').innerText = `ID: ${user.id}`;
    const refLink = `https://t.me/FoodhubBot?start=ref_${user.id}`;
    document.getElementById('ref-link').innerText = refLink;  }
}

window.copyRefLink = function() {
  const link = document.getElementById('ref-link').innerText;
  navigator.clipboard.writeText(link).then(() => {
    tg.HapticFeedback.notificationOccurred('success');
    tg.showAlert('Ссылка скопирована!');
  });
}

// Меню
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu('all');
    setupCategories();
    setupSearch();
  } catch (e) { console.error(e); }
}

function renderMenu(filterCat, searchTerm = '') {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  
  if (filterCat !== 'all') items = items.filter(i => i.category === filterCat);
  if (searchTerm) items = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
  
  if (items.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:#888">Ничего не найдено 😔</div>';
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="menu-item" onclick="addToCart(${item.id})">
      <img src="${item.image}" alt="${item.name}" class="item-image" loading="lazy">
      <div class="item-content">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.desc}</div>
        <div class="item-footer">
          <div class="item-price">${item.price} ₽</div>
          <button class="add-btn">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

function setupCategories() {  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      const search = document.getElementById('search-input').value;
      renderMenu(cat, search);
    };
  });
}

function setupSearch() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    const activeCatBtn = document.querySelector('.cat-btn.active');
    const cat = activeCatBtn ? activeCatBtn.dataset.cat : 'all';
    renderMenu(cat, e.target.value);
  });
}

// Корзина
window.addToCart = function(id) {
  const item = menu.find(i => i.id === id);
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ ...item, qty: 1 });
  updateCartUI();
  tg.HapticFeedback.impactOccurred('light');
};

function updateCartUI() {
  const count = cart.reduce((sum, i) => sum + i.qty, 0);
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  
  // Обновляем бейдж
  const badge = document.getElementById('nav-cart-badge');
  badge.innerText = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
  
  // Обновляем страницу корзины
  document.getElementById('cart-total-display').innerText = total + ' ₽';
  
  const list = document.getElementById('cart-items-list');
  if (cart.length === 0) {
    list.innerHTML = '<div class="empty-state">🛒 Корзина пуста</div>';
  } else {
    list.innerHTML = cart.map(item => `
      <div class="cart-item-row">
        <div>
          <div style="font-weight:600">${item.name}</div>
          <div style="font-size:13px;color:#888">x${item.qty}</div>        </div>
        <div style="font-weight:bold;color:var(--accent-solid)">${item.price * item.qty} ₽</div>
      </div>
    `).join('');
  }
}

document.getElementById('submit-order-btn').onclick = async () => {
  const address = document.getElementById('address').value.trim();
  if (!address) { tg.showAlert('Укажите адрес'); return; }
  if (cart.length === 0) { tg.showAlert('Корзина пуста'); return; }
  
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const data = { items: cart, total, address, comment: document.getElementById('comment').value };
  
  try {
    await fetch('/api/order', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
    tg.sendData(JSON.stringify(data));
  } catch (e) { tg.showAlert('Ошибка отправки'); }
};
