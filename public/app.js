const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Применяем тему
document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#1a1a1a');
document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#8e8e93');
document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#007aff');
document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color || '#f8f9fa');

let menu = [];
let cart = [];

// Логика заставки
window.addEventListener('load', () => {
  const splash = document.getElementById('splash-screen');
  // Через 3 секунды начинаем скрывать
  setTimeout(() => {
    splash.classList.add('hide');
  }, 2500);
  // Через 3 секунды полностью убираем
  setTimeout(() => {
    splash.style.display = 'none';
    document.body.classList.remove('loading');
  }, 3000);
});

// Загрузка меню
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu();
  } catch (e) {
    console.error('Ошибка:', e);
  }
}

function renderMenu() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = menu.map(item => `
    <div class="menu-item" onclick="addToCart(${item.id})">
      <img src="${item.image}" alt="${item.name}" class="item-image" loading="lazy">
      <div class="item-content">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.desc}</div>
        <div class="item-footer">
          <div class="item-price">${item.price} ₽</div>          <button class="add-btn">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

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
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = total;
  const cartBtn = document.getElementById('cart-btn');
  if (count > 0) cartBtn.classList.remove('hidden');
  else cartBtn.classList.add('hidden');
}

function renderCart() {
  const container = document.getElementById('cart-items');
  if (cart.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">Корзина пуста</p>';
    return;
  }
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-qty">× ${item.qty}</div>
      </div>
      <div class="cart-item-price">${item.price * item.qty} ₽</div>
    </div>
  `).join('');
}

document.getElementById('cart-btn').onclick = () => {
  renderCart();
  document.getElementById('cart-modal').classList.remove('hidden');
};
document.getElementById('close-cart').onclick = () => {
  document.getElementById('cart-modal').classList.add('hidden');
};
document.getElementById('submit-order').onclick = async () => {
  const address = document.getElementById('address').value.trim();
  const comment = document.getElementById('comment').value.trim();
  if (!address) { tg.showAlert('Укажите адрес доставки'); return; }
  if (cart.length === 0) { tg.showAlert('Корзина пуста'); return; }

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const orderData = { items: cart, total, address, comment };

  try {
    await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
    tg.sendData(JSON.stringify(orderData));
  } catch (e) {
    tg.showAlert('Ошибка отправки.');
  }
};

loadMenu();
