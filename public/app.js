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
    grid.innerHTML = `<div class="empty-state" style="grid-column:span 2">Не удалось загрузить меню</div>`;
  }
}

/* ════ РЕНДЕР МЕНЮ (ИСПРАВЛЕНО ПОД 2 КОЛОНКИ) ════ */
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

  // Здесь используются классы, которые мы прописали в новом CSS (index.html)
  grid.innerHTML = items.map(item => `
    <div class="menu-card">
      <div class="menu-card-img">
        <img src="${item.image_url || ''}" alt="${item.name}" loading="lazy"
             onerror="this.src='https://via.placeholder.com/300x200/222/444?text=Food'">
      </div>
      <div class="menu-card-body">
        <div class="menu-card-name">${item.name}</div>
        <div class="menu-card-desc">${item.description || ''}</div>
        <div class="menu-card-footer">
          <div class="menu-card-price">${parseFloat(item.price).toLocaleString('ru-RU')} ₽</div>
          <button class="add-btn" onclick="addToCart(${item.id})">+</button>
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
  if (!address) return tg.showAlert('Введите адрес доставки!');
  
  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;
  btn.textContent = 'Обработка...';

  try {
    const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
    const res = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        items: cart,
        total,
        address,
        comment: document.getElementById('comment')?.value || ''
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    tg.openInvoice(data.invoice_url, status => {
      if (status === 'paid') {
        tg.showAlert('Заказ оплачен!');
        cart = []; saveCart(); renderCart(); updateBadge();
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
  const container = document.querySelector('.orders-empty'); // В HTML у тебя только этот класс в заказах
  if (!container) return;
  
  try {
    const res = await fetch(`/api/user/${currentUser.id}/orders`);
    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) return;

    container.parentElement.innerHTML = `
      <div class="top-header"><div class="header-row"><div class="header-title">Заказы</div></div></div>
      <div class="page-pad">
        ${orders.map(o => `
          <div class="cart-item" style="flex-direction:column; align-items:flex-start; gap:5px;">
            <div style="display:flex; justify-content:space-between; width:100%">
              <b style="font-size:14px">Заказ #${o.id}</b>
              <span style="font-size:11px; color:var(--accent)">${getStatusText(o.status)}</span>
            </div>
            <div style="font-size:12px; color:var(--text2)">${getOrderItemsHTML(o)}</div>
            <div style="font-size:13px; font-weight:800; margin-top:5px">${parseFloat(o.total_amount).toLocaleString('ru-RU')} ₽</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {}
}

function getStatusText(s) {
  return { pending_payment:'Ожидает', paid:'Оплачен', cooking:'Готовится', delivering:'В пути', delivered:'Доставлен' }[s] || s;
}
function getOrderItemsHTML(o) {
  try { return JSON.parse(o.items||'[]').map(i=>`${i.name} (${i.qty})`).join(', '); }
  catch { return 'Детали заказа'; }
}

/* ════ ПРОФИЛЬ ════ */
async function loadUserProfile() {
  const name = currentUser.first_name || 'Пользователь';
  const el = id => document.getElementById(id);

  if (el('profile-name'))   el('profile-name').textContent  = name;
  if (el('profile-id'))     el('profile-id').textContent    = 'ID: ' + (currentUser.id || '—');
  if (el('profile-avatar')) el('profile-avatar').textContent = name.charAt(0).toUpperCase();
  if (el('card-number'))    el('card-number').textContent   = '•••• •••• •••• ' + String(currentUser.id || '0000').slice(-4);

  const qrBox = el('qrcode');
  if (qrBox && typeof QRCode !== 'undefined') {
    qrBox.innerHTML = '';
    new QRCode(qrBox, { text: 'foodhub_' + currentUser.id, width: 80, height: 80 });
  }

  const botUsername = 'ваша_ссылка_на_бота';
  if (el('ref-link')) el('ref-link').textContent = `https://t.me/${botUsername}?start=ref_${currentUser.id}`;

  try {
    const res = await fetch(`/api/user/${currentUser.id}/balance`);
    const { balance } = await res.json();
    if (el('bonus-points')) el('bonus-points').textContent = parseFloat(balance||0).toLocaleString('ru-RU') + ' ₽';
  } catch {}
}

window.copyRefLink = () => {
  const text = document.getElementById('ref-link')?.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => tg.showAlert('Скопировано!'));
};

updateBadge();
