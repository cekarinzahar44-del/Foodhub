// === ИНИЦИАЛИЗАЦИЯ ===
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Глобальные переменные
let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

// === БЕЗОПАСНАЯ ЗАГРУЗКА ===
window.addEventListener('load', () => {
  console.log('🚀 App loaded, initializing...');
  
  // Скрываем splash через 1.5 сек в любом случае
  setTimeout(() => {
    try {
      document.body.classList.remove('loading');
      const splash = document.getElementById('splash-screen');
      if (splash) splash.style.display = 'none';
      
      console.log('✅ Splash hidden');
      
      // Загружаем меню
      loadMenu().catch(err => {
        console.error('❌ loadMenu error:', err);
        showMenuError();
      });
      
      // Загружаем профиль
      if (currentUser.id) {
        loadUserProfile().catch(err => console.error('Profile error:', err));
      }
    } catch (err) {
      console.error('❌ Init error:', err);
      showMenuError();
    }
  }, 1500);
});

// Показываем ошибку загрузки
function showMenuError() {
  const grid = document.getElementById('menu-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <div style="font-weight: 600; margin-bottom: 8px;">Не удалось загрузить меню</div>
        <div style="font-size: 14px; color: #888; margin-bottom: 16px;">          Проверьте подключение к интернету
        </div>
        <button onclick="location.reload()" class="btn-primary" style="padding: 12px 24px;">
          🔄 Обновить
        </button>
      </div>
    `;
  }
}

// === НАВИГАЦИЯ ===
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(btn.dataset.target);
    if (targetPage) targetPage.classList.add('active');
    
    if (btn.dataset.target === 'page-cart') renderCart();
    if (btn.dataset.target === 'page-profile') {
      if (currentUser.id) loadUserProfile();
    }
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
const searchInput = document.getElementById('search-input');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    renderMenu(e.target.value.toLowerCase());
  });
}

// === ЗАГРУЗКА МЕНЮ ===
async function loadMenu() {
  try {
    console.log('📡 Loading menu from /api/menu...');
    const res = await fetch('/api/menu');    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    menu = await res.json();
    console.log(`✅ Menu loaded: ${menu.length} items`);
    
    if (menu.length === 0) {
      console.warn('⚠️ Menu is empty!');
    }
    
    renderMenu();
  } catch (err) {
    console.error('❌ Failed to load menu:', err);
    showMenuError();
    throw err;
  }
}

// === ОТРИСОВКА МЕНЮ ===
function renderMenu(searchTerm = '') {
  const grid = document.getElementById('menu-grid');
  if (!grid) {
    console.error('Menu grid not found!');
    return;
  }
  
  let items = menu;
  
  if (currentCategory !== 'all') {
    items = items.filter(i => i.category === currentCategory);
  }
  
  if (searchTerm) {
    items = items.filter(i => 
      i.name.toLowerCase().includes(searchTerm) || 
      (i.description && i.description.toLowerCase().includes(searchTerm))
    );
  }
  
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="padding: 40px;">🔍 Ничего не найдено</div>';
    return;
  }
  
  grid.innerHTML = items.map(item => `
    <div class="menu-item" data-id="${item.id}">
      <div class="item-image">
        <img src="${item.image_url || 'https://via.placeholder.com/300x200?text=ЕдаТут'}"              alt="${item.name}" 
             onerror="this.src='https://via.placeholder.com/300x200?text=Нет+фото'">
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
  
  // Обработчики кнопок "Добавить"
  grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      addToCart(id);
      if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
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
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

function renderCart() {
  const container = document.getElementById('cart-items-list');
  if (!container) return;
  
  if (cart.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 40px;">🛒 Корзина пуста</div>';
    const totalDisplay = document.getElementById('cart-total-display');
    if (totalDisplay) totalDisplay.textContent = '0 ₽';
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
  const totalDisplay = document.getElementById('cart-total-display');
  if (totalDisplay) totalDisplay.textContent = `${total} ₽`;
  
  // Обработчики
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

// === ОФОРМЛЕНИЕ ЗАКАЗА ===
const submitBtn = document.getElementById('submit-order-btn');
if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    if (cart.length === 0) {
      tg.showAlert('Корзина пуста!');
      return;
    }
    
    const addressInput = document.getElementById('address');
    const address = addressInput?.value.trim();
    if (!address) {
      tg.showAlert('Укажите адрес доставки!');
      return;
    }
    
    const commentInput = document.getElementById('comment');
    const comment = commentInput?.value || '';
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const userId = currentUser.id;
    
    if (!userId) {
      tg.showAlert('Ошибка: пользователь не авторизован');
      return;
    }
    
    // Блокируем кнопку
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '⏳ Оформление...';
    
    try {
      console.log('📡 Creating payment...', { userId, total, items: cart.length });
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
      console.log('📥 Payment response:', data);
      
      if (data.success) {
        // Открываем оплату
        tg.openInvoice(data.invoice_url, (status) => {
          console.log('💳 Payment status:', status);
          
          if (status === 'paid') {
            tg.showAlert('✅ Оплата прошла успешно!\nВаш заказ принят.');
            cart = [];
            updateCartBadge();
            renderCart();
            if (addressInput) addressInput.value = '';
            if (commentInput) commentInput.value = '';
          } else if (status === 'cancelled') {
            tg.showAlert('❌ Оплата отменена');
          } else {
            tg.showAlert('⏳ Статус: ' + status);
          }
        });
      } else {
        throw new Error(data.error || 'Ошибка сервера');
      }
      
    } catch (err) {
      console.error('❌ Payment error:', err);
      tg.showAlert('❌ Ошибка: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// === ПРОФИЛЬ ===
async function loadUserProfile() {
  if (!currentUser.id) {    console.log('No user ID');
    return;
  }
  
  try {
    // Имя и ID
    const nameEl = document.getElementById('profile-name');
    const idEl = document.getElementById('profile-id');
    
    if (nameEl) nameEl.textContent = currentUser.first_name || 'Пользователь';
    if (idEl) idEl.textContent = `ID: ${currentUser.id}`;
    
    // Номер карты
    const cardNumEl = document.getElementById('card-number');
    if (cardNumEl) {
      const cardNum = `•••• •••• •••• ${String(currentUser.id).slice(-4)}`;
      cardNumEl.textContent = cardNum;
    }
    
    // QR-код
    const qrContainer = document.getElementById('qrcode');
    if (qrContainer && typeof QRCode !== 'undefined') {
      // Очищаем если уже есть
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, {
        text: `foodhub_user_${currentUser.id}`,
        width: 120,
        height: 120,
        correctLevel: QRCode.CorrectLevel.M
      });
    }
    
    // Бонусы
    try {
      const res = await fetch(`/api/user/${currentUser.id}/balance`);
      const data = await res.json();
      const bonusEl = document.getElementById('bonus-points');
      if (bonusEl) bonusEl.textContent = `${data.balance || 0} ₽`;
    } catch (err) {
      console.log('Bonus fetch error (ok):', err);
    }
    
    // Реферальная ссылка
    const refLink = document.getElementById('ref-link');
    if (refLink) {
      const botUsername = tg.botInfo?.username || 'foodhub_bot';
      refLink.textContent = `https://t.me/${botUsername}?start=ref_${currentUser.id}`;
    }
    
  } catch (err) {    console.error('Profile error:', err);
  }
}

// Копирование реф-ссылки
window.copyRefLink = function() {
  const link = document.getElementById('ref-link')?.textContent;
  if (link) {
    navigator.clipboard.writeText(link);
    tg.showAlert('🔗 Ссылка скопирована!');
  }
};

// === ВСПОМОГАТЕЛЬНЫЕ ===
function showCartToast(message) {
  const existing = document.querySelector('.cart-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'cart-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.8); color: white; padding: 10px 20px; 
    border-radius: 20px; font-size: 14px; z-index: 1000;
    animation: fadeInOut 2s ease-in-out;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// === ИНИЦИАЛИЗАЦИЯ ===
console.log('🚀 Foodhub App initializing...');
console.log('User:', currentUser);
updateCartBadge();
