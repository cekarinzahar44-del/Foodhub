const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cart = [];
let menu = [];
let currentUser = tg.initDataUnsafe?.user || {};
let currentCategory = 'all';

/* ════ КОРЗИНА: localStorage ════ */
function saveCart() {
  try { localStorage.setItem('fh_cart', JSON.stringify(cart)); } catch {}
}
function loadCart() {
  try {
    const s = localStorage.getItem('fh_cart');
    if (s) { const p = JSON.parse(s); if (Array.isArray(p)) { cart = p; return true; } }
  } catch {}
  return false;
}

/* ════ SPLASH ════ */
window.addEventListener('load', () => {
  if (loadCart()) updateBadge();
  loadMenu();
  loadUserProfile();

  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;
    splash.classList.add('hiding');
    setTimeout(() => {
      splash.style.display = 'none';
      document.body.classList.remove('loading');
    }, 550);
  }, 2200);
});

/* ════ НАВИГАЦИЯ ════ */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(btn.dataset.target);
    if (page) page.classList.add('active');
    if (btn.dataset.target === 'page-cart')   renderCart();
    if (btn.dataset.target === 'page-orders') loadUserOrders();
  });
});

/* ════ КАТЕГОРИИ ════ */
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    renderMenu();
  });
});

/* ════ ПОИСК ════ */
document.getElementById('search-input')?.addEventListener('input', e => {
  renderMenu(e.target.value.toLowerCase().trim());
});

/* ════ ЗАГРУЗКА МЕНЮ ════ */
async function loadMenu() {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state" style="grid-column:span 2">Загрузка меню...</div>';
  try {
    const res = await fetch('/api/menu');
    if (!res.ok) throw new Error(`Ошибка ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(data.error || 'Неверный формат');
    menu = data;
    if (menu.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:span 2">Меню временно недоступно</div>';
      return;
    }
    renderMenu();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:span 2">Не удалось загрузить меню<br><small style="color:rgba(255,255,255,0.25)">${err.message}</small></div>`;
  }
}

/* ════ РЕНДЕР МЕНЮ ════ */
function renderMenu(search = '') {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;
  let items = menu;
  if (currentCategory !== 'all') items = items.filter(i => i.category === currentCategory);
  if (search) items = items.filter(i =>
    i.name.toLowerCase().includes(search) ||
    (i.description || '').toLowerCase().includes(search)
  );
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:span 2">Ничего не найдено</div>';
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="menu-item">
      <div class="item-image">
        <img src="${item.image_url || ''}" alt="${item.name}" loading="lazy"
             onerror="this.src='https://via.placeholder.com/300x180/111/333?text=+'">
      </div>
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.description || ''}</div>
        <div class="item-footer">
          <div class="item-price">${parseFloat(item.price).toLocaleString('ru-RU')} ₽</div>
          <button class="add-btn" onclick="addToCart(${item.id})" aria-label="Добавить">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

/* ════ КОРЗИНА ════ */
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  if (!item) return;
  const exist = cart.find(c => c.id === id);
  if (exist) exist.qty++;
  else cart.push({ ...item, qty: 1 });
  updateBadge();
  saveCart();
  try { tg.HapticFeedback.impactOccurred('light'); } catch {}
}

function updateQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(c => c.id !== id);
  renderCart();
  updateBadge();
  saveCart();
}

function updateBadge() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const badge = document.getElementById('nav-cart-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderCart() {
  const list     = document.getElementById('cart-items-list');
  const emptyMsg = document.getElementById('cart-empty-msg');
  const checkout = document.getElementById('cart-checkout-block');
  if (!list) return;

  if (cart.length === 0) {
    list.innerHTML = '';
    emptyMsg?.classList.remove('hidden');
    checkout?.classList.add('hidden');
    return;
  }
  emptyMsg?.classList.add('hidden');
  checkout?.classList.remove('hidden');

  list.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${(parseFloat(item.price) * item.qty).toLocaleString('ru-RU')} ₽</div>
      </div>
      <div class="cart-controls">
        <button class="qty-btn" onclick="updateQty(${item.id},-1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty(${item.id},1)">+</button>
      </div>
    </div>
  `).join('');

  const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
  const display = document.getElementById('cart-total-display');
  if (display) display.textContent = total.toLocaleString('ru-RU') + ' ₽';
}

/* ════ ОПЛАТА ════ */
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {
  const address = document.getElementById('address')?.value.trim();
  if (!address)       return tg.showAlert('Введите адрес доставки!');
  if (!currentUser.id) return tg.showAlert('Не удалось определить пользователя.');
  if (cart.length === 0) return tg.showAlert('Корзина пуста!');

  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;
  btn.textContent = 'Обработка...';

  try {
    const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
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
    if (!data.success) throw new Error(data.error || 'Неизвестная ошибка');

    tg.openInvoice(data.invoice_url, status => {
      if (status === 'paid') {
        tg.showAlert('Заказ оплачен! Ждите доставки.');
        cart = []; saveCart(); renderCart(); updateBadge();
        if (document.getElementById('address'))  document.getElementById('address').value  = '';
        if (document.getElementById('comment'))   document.getElementById('comment').value   = '';
      } else {
        tg.showAlert('Оплата не завершена.');
      }
      btn.disabled = false;
      btn.textContent = 'Оплатить заказ';
    });
  } catch (e) {
    tg.showAlert('Ошибка: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Оплатить заказ';
  }
});

/* ════ МОИ ЗАКАЗЫ ════ */
async function loadUserOrders() {
  if (!currentUser.id) return;
  const container = document.getElementById('orders-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Загрузка...</div>';
  try {
    const res = await fetch(`/api/user/${currentUser.id}/orders`);
    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) {
      container.innerHTML = `
        <div class="orders-empty">
          <div class="orders-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="M9 12h6M9 16h4"/>
            </svg>
          </div>
          <h3>Заказов пока нет</h3>
          <p>Ваши заказы появятся здесь после оформления</p>
        </div>`;
      return;
    }
    container.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="order-header">
          <span class="order-id">Заказ #${o.id}</span>
          <span class="order-status status-${o.status}">${getStatusText(o.status)}</span>
        </div>
        <div class="order-items">${getOrderItemsHTML(o)}</div>
        <div class="order-footer">
          <span class="order-total">${parseFloat(o.total_amount).toLocaleString('ru-RU')} ₽</span>
          <span class="order-date">${new Date(o.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="empty-state">Ошибка загрузки заказов</div>';
  }
}

function getStatusText(s) {
  return { pending_payment:'Ожидает оплаты', paid:'Оплачен', cooking:'Готовится',
           ready:'Готов к выдаче', delivering:'Доставляется', delivered:'Доставлен', cancelled:'Отменён' }[s] || s;
}
function getOrderItemsHTML(o) {
  try { return JSON.parse(o.items||'[]').map(i=>`• ${i.name} × ${i.qty}`).join('<br>'); }
  catch { return 'Нет данных'; }
}

/* ════ ПРОФИЛЬ ════ */
async function loadUserProfile() {
  if (!currentUser.id) return;
  const name = currentUser.first_name || 'Пользователь';
  const el = id => document.getElementById(id);

  if (el('profile-name'))   el('profile-name').textContent  = name;
  if (el('profile-id'))     el('profile-id').textContent    = 'ID: ' + currentUser.id;
  if (el('profile-avatar')) el('profile-avatar').textContent = name.charAt(0).toUpperCase();
  if (el('card-number'))    el('card-number').textContent   = '•••• •••• •••• ' + String(currentUser.id).slice(-4);

  const qrBox = el('qrcode');
  if (qrBox && typeof QRCode !== 'undefined') {
    qrBox.innerHTML = '';
    new QRCode(qrBox, { text: 'foodhub_' + currentUser.id, width: 80, height: 80 });
  }

  const botUsername = tg.initDataUnsafe?.bot?.username || 'foodhub_bot';
  if (el('ref-link')) el('ref-link').textContent = `https://t.me/${botUsername}?start=ref_${currentUser.id}`;

  try {
    const res = await fetch(`/api/user/${currentUser.id}/balance`);
    const { balance } = await res.json();
    if (el('bonus-points')) el('bonus-points').textContent = parseFloat(balance||0).toLocaleString('ru-RU') + ' ₽';
  } catch {}
}

/* ════ УТИЛИТЫ ════ */
window.copyRefLink = () => {
  const text = document.getElementById('ref-link')?.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => tg.showAlert('Ссылка скопирована!'))
    .catch(() => tg.showAlert('Не удалось скопировать.'));
};

updateBadge();
