const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

// Скрываем заставку
window.addEventListener('load', () => {
  setTimeout(() => {
    document.body.classList.remove('loading');
    document.getElementById('splash-screen').style.display = 'none';
    loadMenu();
    loadUserProfile();
  }, 1500);
});

// Навигация
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(btn.dataset.target).classList.add('active');
    if (btn.dataset.target === 'page-cart') renderCart();
  });
});

// Категории
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderMenu();
  });
});

// Поиск
document.getElementById('search-input')?.addEventListener('input', (e) => {
  renderMenu(e.target.value.toLowerCase());
});

// Загрузка меню
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();    renderMenu();
  } catch (err) {
    console.error('Menu error:', err);
    document.getElementById('menu-grid').innerHTML = `
      <div class="empty-state" style="padding: 40px;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <div>Не удалось загрузить меню</div>
        <button onclick="location.reload()" class="btn-primary" style="margin-top: 16px;">🔄 Обновить</button>
      </div>
    `;
  }
}

// Отрисовка меню
function renderMenu(searchTerm = '') {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  
  if (currentCategory !== 'all') items = items.filter(i => i.category === currentCategory);
  if (searchTerm) items = items.filter(i => i.name.toLowerCase().includes(searchTerm));
  
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="padding: 40px;">🔍 Ничего не найдено</div>';
    return;
  }
  
  grid.innerHTML = items.map(item => `
    <div class="menu-item" data-id="${item.id}">
      <div class="item-image">
        <img src="${item.image_url}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/300x200'">
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
  
  grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(parseInt(btn.dataset.id));
      tg.HapticFeedback.impactOccurred('light');
    });
  });
}
// Корзина
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  if (!item) return;
  const existing = cart.find(c => c.id === id);
  if (existing) existing.qty++;
  else cart.push({ ...item, qty: 1 });
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
  if (item.qty <= 0) removeFromCart(id);
  else { renderCart(); updateCartBadge(); }
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
  if (cart.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 40px;">🛒 Корзина пуста</div>';
    document.getElementById('cart-total-display').textContent = '0 ₽';
    return;
  }
  
  let total = 0;
  container.innerHTML = cart.map(item => {
    total += item.price * item.qty;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>          <div class="cart-item-price">${item.price} ₽</div>
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
  
  container.querySelectorAll('.qty-btn.minus').forEach(btn => btn.onclick = () => updateCartQty(parseInt(btn.dataset.id), -1));
  container.querySelectorAll('.qty-btn.plus').forEach(btn => btn.onclick = () => updateCartQty(parseInt(btn.dataset.id), 1));
  container.querySelectorAll('.remove-btn').forEach(btn => btn.onclick = () => removeFromCart(parseInt(btn.dataset.id)));
}

// ОФОРМЛЕНИЕ ЗАКАЗА С ОПЛАТОЙ
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {
  if (cart.length === 0) { tg.showAlert('Корзина пуста!'); return; }
  
  const address = document.getElementById('address')?.value.trim();
  if (!address) { tg.showAlert('Укажите адрес!'); return; }
  
  const comment = document.getElementById('comment')?.value || '';
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const userId = currentUser.id;
  
  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Оформление...';
  
  try {
    const res = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, items: cart, total, address, comment })
    });
    
    const data = await res.json();
    
    if (data.success) {
      tg.openInvoice(data.invoice_url, (status) => {
        if (status === 'paid') {
          tg.showAlert('✅ Оплата прошла успешно!');
          cart = []; updateCartBadge(); renderCart();
          document.getElementById('address').value = '';
          document.getElementById('comment').value = '';        } else {
          tg.showAlert('❌ Оплата отменена');
        }
        btn.disabled = false;
        btn.textContent = '💳 Оплатить заказ';
      });
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    tg.showAlert('❌ Ошибка: ' + err.message);
    btn.disabled = false;
    btn.textContent = '💳 Оплатить заказ';
  }
});

// Профиль
async function loadUserProfile() {
  if (!currentUser.id) return;
  document.getElementById('profile-name').textContent = currentUser.first_name || 'Пользователь';
  document.getElementById('profile-id').textContent = `ID: ${currentUser.id}`;
  document.getElementById('card-number').textContent = `•••• •••• •••• ${String(currentUser.id).slice(-4)}`;
  
  const qrContainer = document.getElementById('qrcode');
  if (qrContainer && typeof QRCode !== 'undefined') {
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, { text: `foodhub_${currentUser.id}`, width: 120, height: 120 });
  }
  
  const refLink = document.getElementById('ref-link');
  if (refLink) refLink.textContent = `https://t.me/${tg.botInfo?.username || 'bot'}?start=ref_${currentUser.id}`;
}

window.copyRefLink = function() {
  const link = document.getElementById('ref-link')?.textContent;
  if (link) { navigator.clipboard.writeText(link); tg.showAlert('🔗 Скопировано!'); }
};

function showCartToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:10px 20px;border-radius:20px;z-index:1000;';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

updateCartBadge();
