// === ИНИЦИАЛИЗАЦИЯ ===
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Глобальные переменные
let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

// === ЗАСТАВКА ===
window.addEventListener('load', () => {
  setTimeout(() => {
    document.body.classList.remove('loading');
    document.getElementById('splash-screen').style.display = 'none';
    loadMenu();
    loadUserProfile();
  }, 1500);
});

// === НАВИГАЦИЯ ===
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(btn.dataset.target).classList.add('active');
    
    if (btn.dataset.target === 'page-cart') renderCart();
    if (btn.dataset.target === 'page-profile') loadUserProfile();
  });
});

// === КАТЕГОРИИ МЕНЮ ===
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderMenu();
  });
});

// === ПОИСК ===
document.getElementById('search-input')?.addEventListener('input', (e) => {
  renderMenu(e.target.value.toLowerCase());
});
// === ЗАГРУЗКА МЕНЮ ===
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu();
  } catch (err) {
    console.error('Ошибка загрузки меню:', err);
    document.getElementById('menu-grid').innerHTML = '<div class="empty-state">❌ Не удалось загрузить меню</div>';
  }
}

// === ОТРИСОВКА МЕНЮ ===
function renderMenu(searchTerm = '') {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  
  if (currentCategory !== 'all') {
    items = items.filter(i => i.category === currentCategory);
  }
  
  if (searchTerm) {
    items = items.filter(i => 
      i.name.toLowerCase().includes(searchTerm) || 
      i.description?.toLowerCase().includes(searchTerm)
    );
  }
  
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state">🔍 Ничего не найдено</div>';
    return;
  }
  
  grid.innerHTML = items.map(item => `
    <div class="menu-item" data-id="${item.id}">
      <div class="item-image">
        <img src="${item.image_url}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/300x200?text=ЕдаТут'">
      </div>
      <div class="item-info">
        <h3 class="item-name">${item.name}</h3>
        <p class="item-desc">${item.description || ''}</p>
        <div class="item-footer">
          <span class="item-price">${item.price} ₽</span>
          <button class="add-to-cart-btn" data-id="${item.id}">+</button>
        </div>
      </div>
    </div>
  `).join('');
  
  // Обработчики кнопок "Добавить"  grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      addToCart(id);
      tg.HapticFeedback.impactOccurred('light');
    });
  });
}

// === КОРЗИНА ===
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  if (!item) return;
  
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  
  updateCartBadge();
  showCartToast(`${item.name} добавлен`);
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  updateCartBadge();
  renderCart();
}

function updateCartQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(id);
  } else {
    renderCart();
    updateCartBadge();
  }
}

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const badge = document.getElementById('nav-cart-badge');
  if (badge) {
    badge.textContent = count;    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

function renderCart() {
  const container = document.getElementById('cart-items-list');
  
  if (cart.length === 0) {
    container.innerHTML = '<div class="empty-state">🛒 Корзина пуста</div>';
    document.getElementById('cart-total-display').textContent = '0 ₽';
    return;
  }
  
  let total = 0;
  container.innerHTML = cart.map(item => {
    const itemTotal = item.price * item.qty;
    total += itemTotal;
    
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">${item.price} ₽</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn minus" data-id="${item.id}">−</button>
          <span class="qty">${item.qty}</span>
          <button class="qty-btn plus" data-id="${item.id}">+</button>
          <button class="remove-btn" data-id="${item.id}">🗑</button>
        </div>
      </div>
    `;
  }).join('');
  
  document.getElementById('cart-total-display').textContent = `${total} ₽`;
  
  // Обработчики кнопок в корзине
  container.querySelectorAll('.qty-btn.minus').forEach(btn => {
    btn.onclick = () => updateCartQty(parseInt(btn.dataset.id), -1);
  });
  container.querySelectorAll('.qty-btn.plus').forEach(btn => {
    btn.onclick = () => updateCartQty(parseInt(btn.dataset.id), 1);
  });
  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.onclick = () => removeFromCart(parseInt(btn.dataset.id));
  });
}

// === ОФОРМЛЕНИЕ ЗАКАЗА С ОПЛАТОЙ ===
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {  if (cart.length === 0) {
    tg.showAlert('Корзина пуста!');
    return;
  }
  
  const address = document.getElementById('address')?.value.trim();
  if (!address) {
    tg.showAlert('Укажите адрес доставки!');
    return;
  }
  
  const comment = document.getElementById('comment')?.value || '';
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const userId = currentUser.id;
  
  // Показываем загрузку
  const btn = document.getElementById('submit-order-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Оформление...';
  
  try {
    // 🔥 СОЗДАЁМ ЗАКАЗ С ОПЛАТОЙ
    const res = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        items: cart,
        total,
        address,
        comment
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      // 🎯 ОТКРЫВАЕМ ОПЛАТУ ВНУТРИ TELEGRAM
      tg.openInvoice(data.invoice_url, (status) => {
        if (status === 'paid') {
          // ✅ Оплата прошла
          tg.showAlert('✅ Оплата прошла успешно!\nВаш заказ принят.');
          cart = [];
          updateCartBadge();
          renderCart();
          if (document.getElementById('address')) document.getElementById('address').value = '';
          if (document.getElementById('comment')) document.getElementById('comment').value = '';
        } else if (status === 'cancelled') {
          tg.showAlert('❌ Оплата отменена. Попробуйте снова.');        } else {
          tg.showAlert('⏳ Статус оплаты: ' + status);
        }
      });
    } else {
      throw new Error(data.error || 'Ошибка сервера');
    }
    
  } catch (err) {
    console.error('Ошибка оплаты:', err);
    tg.showAlert('❌ Ошибка: ' + err.message);
  } finally {
    // Возвращаем кнопку
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// === ПРОФИЛЬ И БОНУСЫ ===
async function loadUserProfile() {
  if (!currentUser.id) return;
  
  // Имя и ID
  document.getElementById('profile-name').textContent = currentUser.first_name || 'Пользователь';
  document.getElementById('profile-id').textContent = `ID: ${currentUser.id}`;
  
  // Номер карты (генерируем из ID)
  const cardNum = `•••• •••• •••• ${String(currentUser.id).slice(-4)}`;
  document.getElementById('card-number').textContent = cardNum;
  
  // QR-код
  const qrContainer = document.getElementById('qrcode');
  if (qrContainer && !qrContainer.querySelector('canvas')) {
    new QRCode(qrContainer, {
      text: `foodhub_user_${currentUser.id}`,
      width: 120,
      height: 120,
      correctLevel: QRCode.CorrectLevel.M
    });
  }
  
  // Бонусы (если есть эндпоинт)
  try {
    const res = await fetch(`/api/user/${currentUser.id}/balance`);
    const data = await res.json();
    document.getElementById('bonus-points').textContent = `${data.balance || 0} ₽`;
  } catch {}
  
  // Реферальная ссылка
  const refLink = document.getElementById('ref-link');  if (refLink) {
    refLink.textContent = `https://t.me/${tg.botInfo?.username || 'foodhub_bot'}?start=ref_${currentUser.id}`;
  }
}

function copyRefLink() {
  const link = document.getElementById('ref-link')?.textContent;
  if (link) {
    navigator.clipboard.writeText(link);
    tg.showAlert('🔗 Ссылка скопирована!');
  }
}

// === ВСПОМОГАТЕЛЬНЫЕ ===
function showCartToast(message) {
  // Простая анимация (можно улучшить)
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: #333; color: white; padding: 10px 20px; border-radius: 20px;
    font-size: 14px; z-index: 1000; animation: fadeInOut 2s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// === ИНИЦИАЛИЗАЦИЯ ===
updateCartBadge();

// Если открыли сразу корзину — отрисовать
if (document.getElementById('page-cart')?.classList.contains('active')) {
  renderCart();
}
