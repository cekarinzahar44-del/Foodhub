const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

// ── 💾 ФУНКЦИИ СОХРАНЕНИЯ КОРЗИНЫ (НОВОЕ) ──
function saveCart() {
  try {
    localStorage.setItem('foodhub_cart', JSON.stringify(cart));
  } catch (e) {
    console.error('Cart save error:', e);
  }
}

function loadCart() {
  try {
    const saved = localStorage.getItem('foodhub_cart');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        cart = parsed;
        return true;
      }
    }
  } catch (e) {
    console.error('Cart load error:', e);
  }
  return false;
}

// ── ЗАСТАВКА ──
window.addEventListener('load', () => {
  // 💾 Загружаем сохраненную корзину при старте
  if (loadCart()) {
    updateBadge();
  }
  
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('hiding');
      setTimeout(() => {
        splash.style.display = 'none';
        document.body.classList.remove('loading');
        loadMenu();
        loadUserProfile();      }, 500);
    }
  }, 2000);
});

// ── НАВИГАЦИЯ ──
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(btn.dataset.target);
    if (targetPage) targetPage.classList.add('active');
    if (btn.dataset.target === 'page-cart') renderCart();
  });
});

// ── КАТЕГОРИИ ──
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderMenu();
  });
});

// ── ПОИСК ──
document.getElementById('search-input')?.addEventListener('input', (e) => {
  renderMenu(e.target.value.toLowerCase().trim());
});

// ── ЗАГРУЗКА МЕНЮ ──
async function loadMenu() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = '<div class="empty-state">Загрузка меню...</div>';
  try {
    const res = await fetch('/api/menu');
    if (!res.ok) throw new Error('Server error');
    menu = await res.json();
    renderMenu();
  } catch {
    grid.innerHTML = '<div class="empty-state">Не удалось загрузить меню. Попробуйте позже.</div>';
  }
}

// ── ОТРИСОВКА МЕНЮ ──
function renderMenu(search = '') {
  const grid = document.getElementById('menu-grid');
  let items = menu;  if (currentCategory !== 'all') items = items.filter(i => i.category === currentCategory);
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search) || (i.description || '').toLowerCase().includes(search));

  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state">Ничего не найдено</div>';
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="menu-item">
      <div class="item-image">
        <img src="${item.image_url || ''}" alt="${item.name}"
             onerror="this.src='https://via.placeholder.com/300x200/F3F4F6/9CA3AF?text=Фото'">
      </div>
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.description || ''}</div>
        <div class="item-footer">
          <div class="item-price">${parseFloat(item.price).toLocaleString('ru-RU')} ₽</div>
          <button class="add-btn" onclick="addToCart(${item.id})" aria-label="Добавить в корзину">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── КОРЗИНА ──
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  if (!item) return;
  const exist = cart.find(c => c.id === id);
  if (exist) exist.qty++;
  else cart.push({ ...item, qty: 1 });
  updateBadge();
  tg.HapticFeedback.impactOccurred('light');
  saveCart(); // 💾 Сохраняем корзину
}

function updateQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(c => c.id !== id);
  renderCart();
  updateBadge();
  saveCart(); // 💾 Сохраняем корзину
}

function updateBadge() {
  const count = cart.reduce((s, i) => s + i.qty, 0);  const badge = document.getElementById('nav-cart-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderCart() {
  const list     = document.getElementById('cart-items-list');
  const emptyMsg = document.getElementById('cart-empty-msg');
  const checkout = document.getElementById('cart-checkout-block');

  if (cart.length === 0) {
    list.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    checkout.classList.add('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');
  checkout.classList.remove('hidden');

  list.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${(parseFloat(item.price) * item.qty).toLocaleString('ru-RU')} ₽</div>
      </div>
      <div class="cart-controls">
        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
    </div>
  `).join('');

  const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
  document.getElementById('cart-total-display').textContent = total.toLocaleString('ru-RU') + ' ₽';
}

// ── ОПЛАТА ──
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {
  const address = document.getElementById('address')?.value.trim();
  if (!address) return tg.showAlert('Введите адрес доставки!');
  if (!currentUser.id) return tg.showAlert('Не удалось определить пользователя. Перезапустите приложение.');

  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;
  btn.textContent = 'Обработка...';

  try {    const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
    const res = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId:  currentUser.id,
        items:   cart,
        total,
        address,
        comment: document.getElementById('comment')?.value || ''
      })
    });
    const data = await res.json();

    if (data.success) {
      tg.openInvoice(data.invoice_url, (status) => {
        if (status === 'paid') {
          tg.showAlert('Заказ оплачен! Ждите доставки.');
          cart = [];
          saveCart(); // 💾 Очищаем сохраненную корзину после оплаты
          renderCart();
          updateBadge();
          if (document.getElementById('address')) document.getElementById('address').value = '';
          if (document.getElementById('comment')) document.getElementById('comment').value = '';
        } else {
          tg.showAlert('Оплата не завершена.');
        }
        btn.disabled = false;
        btn.textContent = 'Оплатить заказ';
      });
    } else {
      throw new Error(data.error || 'Неизвестная ошибка');
    }
  } catch (e) {
    tg.showAlert('Ошибка: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Оплатить заказ';
  }
});

// ── ПРОФИЛЬ ──
async function loadUserProfile() {
  if (!currentUser.id) return;

  document.getElementById('profile-name').textContent = currentUser.first_name || 'Пользователь';
  document.getElementById('profile-id').textContent   = 'ID: ' + currentUser.id;
  document.getElementById('card-number').textContent  = '•••• •••• •••• ' + String(currentUser.id).slice(-4);

  // QR-код
  const qrBox = document.getElementById('qrcode');  if (qrBox) {
    qrBox.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrBox, { text: 'foodhub_user_' + currentUser.id, width: 80, height: 80 });
    }
  }

  // Реферальная ссылка
  const botUsername = tg.initDataUnsafe?.bot?.username || 'foodhub_bot';
  const refEl = document.getElementById('ref-link');
  if (refEl) refEl.textContent = `https://t.me/${botUsername}?start=ref_${currentUser.id}`;

  // Баланс бонусов
  try {
    const res = await fetch(`/api/user/${currentUser.id}/balance`);
    const { balance } = await res.json();
    const el = document.getElementById('bonus-points');
    if (el) el.textContent = parseFloat(balance).toLocaleString('ru-RU') + ' ₽';
  } catch {}
}

window.copyRefLink = () => {
  const text = document.getElementById('ref-link')?.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    tg.showAlert('Ссылка скопирована!');
  }).catch(() => {
    tg.showAlert('Не удалось скопировать ссылку.');
  });
};

// Инициализация
updateBadge();
