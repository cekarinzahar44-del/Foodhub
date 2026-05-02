const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

// 🍔 ГЕНЕРАТОР ЛЕТАЮЩИХ БУРГЕРОВ
function createFlyingBurgers() {
  const container = document.getElementById('flying-emojis');
  if (!container) return;
  const emojis = ['🍔', '', '🍟', '🥤', '', ''];
  for (let i = 0; i < 15; i++) {
    const el = document.createElement('div');
    el.className = 'flying-burger';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.left = Math.random() * 100 + '%';
    el.style.fontSize = (16 + Math.random() * 24) + 'px';
    el.style.animationDuration = (4 + Math.random() * 4) + 's';
    el.style.animationDelay = (Math.random() * 5) + 's';
    container.appendChild(el);
  }
}

// 🚀 ЗАПУСК
window.addEventListener('load', () => {
  createFlyingBurgers();
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('hiding');
      setTimeout(() => {
        splash.style.display = 'none';
        document.body.classList.remove('loading');
        loadMenu();
        loadUserProfile();
      }, 500);
    }
  }, 2000);
});

// 🧭 НАВИГАЦИЯ (ИСПРАВЛЕННАЯ)
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    // 1. Снимаем выделение со всех кнопок
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
        // 2. Скрываем ВСЕ страницы
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // 3. Показываем только нужную (по ID из data-target)
    const targetId = btn.dataset.target;
    const targetPage = document.getElementById(targetId);
    if (targetPage) targetPage.classList.add('active');
    
    // 4. Обновляем корзину при переходе на неё
    if (targetId === 'page-cart') renderCart();
  });
});

// КАТЕГОРИИ
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderMenu();
  });
});

// ПОИСК
document.getElementById('search-input')?.addEventListener('input', (e) => {
  renderMenu(e.target.value.toLowerCase());
});

// ЗАГРУЗКА МЕНЮ
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu();
  } catch (err) {
    document.getElementById('menu-grid').innerHTML = '<div class="empty-state">❌ Ошибка загрузки</div>';
  }
}

// ОТРИСОВКА МЕНЮ
function renderMenu(search = '') {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  if (currentCategory !== 'all') items = items.filter(i => i.category === currentCategory);
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search));

  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state">🔍 Ничего не найдено</div>';
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="menu-item">
      <div class="item-image"><img src="${item.image_url}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/300'"></div>
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.description || ''}</div>
        <div class="item-footer">
          <div class="item-price">${item.price} ₽</div>
          <button class="add-btn" onclick="addToCart(${item.id})">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

// КОРЗИНА
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  const exist = cart.find(c => c.id === id);
  if (exist) exist.qty++; else cart.push({ ...item, qty: 1 });
  updateBadge();
  tg.HapticFeedback.impactOccurred('light');
}

function updateQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(c => c.id !== id);
  renderCart();
  updateBadge();
}

function updateBadge() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const badge = document.getElementById('nav-cart-badge');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderCart() {
  const list = document.getElementById('cart-items-list');
  const emptyMsg = document.getElementById('cart-empty-msg');
  const checkout = document.getElementById('cart-checkout-block');

  if (cart.length === 0) {
    list.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    checkout.classList.add('hidden');    return;
  }

  emptyMsg.classList.add('hidden');
  checkout.classList.remove('hidden');

  list.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${item.price * item.qty} ₽</div>
      </div>
      <div class="cart-controls">
        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
    </div>
  `).join('');

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('cart-total-display').textContent = total + ' ₽';
}

// ОПЛАТА
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {
  const address = document.getElementById('address').value.trim();
  if (!address) return tg.showAlert('Введите адрес доставки!');
  
  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Обработка...';

  try {
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const res = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, items: cart, total, address, comment: document.getElementById('comment').value })
    });
    const data = await res.json();
    if (data.success) {
      tg.openInvoice(data.invoice_url, (status) => {
        if (status === 'paid') {
          tg.showAlert('✅ Заказ оплачен!');
          cart = []; renderCart(); updateBadge();
          document.getElementById('address').value = '';
        } else {
          tg.showAlert('❌ Оплата отменена');
        }        btn.disabled = false;
        btn.textContent = '💳 Оплатить заказ';
      });
    } else throw new Error(data.error);
  } catch (e) {
    tg.showAlert('❌ Ошибка: ' + e.message);
    btn.disabled = false;
    btn.textContent = '💳 Оплатить заказ';
  }
});

// ПРОФИЛЬ
async function loadUserProfile() {
  if (!currentUser.id) return;
  document.getElementById('profile-name').textContent = currentUser.first_name || 'User';
  document.getElementById('profile-id').textContent = 'ID: ' + currentUser.id;
  document.getElementById('card-number').textContent = '•••• •••• •••• ' + String(currentUser.id).slice(-4);
  
  const qrBox = document.getElementById('qrcode');
  qrBox.innerHTML = '';
  if (typeof QRCode !== 'undefined') new QRCode(qrBox, { text: 'foodhub_' + currentUser.id, width: 80, height: 80 });

  document.getElementById('ref-link').textContent = `t.me/${tg.botInfo?.username || 'bot'}?start=ref_${currentUser.id}`;
}

window.copyRefLink = () => {
  navigator.clipboard.writeText(document.getElementById('ref-link').textContent);
  tg.showAlert('📋 Ссылка скопирована!');
};

updateBadge();
