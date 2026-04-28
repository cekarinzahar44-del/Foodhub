const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let menu = [];
let cart = [];

// Показываем приложение после заставки
window.addEventListener('load', () => {
  setTimeout(() => {
    document.body.classList.add('loaded');
    loadMenu();
  }, 3000);
});

// Загрузка товаров
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu('all');
    setupCategories();
  } catch (e) {
    console.error('Ошибка загрузки меню:', e);
  }
}

// Отображение товаров
function renderMenu(filterCat) {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  
  if (filterCat !== 'all') {
    items = menu.filter(i => i.category === filterCat);
  }
  
  if (items.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:#888">Товаров нет</div>';
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
          <button class="add-btn">+</button>        </div>
      </div>
    </div>
  `).join('');
}

// Категории
function setupCategories() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMenu(btn.dataset.cat);
    };
  });
}

// Добавить в корзину
window.addToCart = function(id) {
  const item = menu.find(i => i.id === id);
  const existing = cart.find(i => i.id === id);
  
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  
  updateCartUI();
  tg.HapticFeedback.impactOccurred('light');
};

// Обновление корзины
function updateCartUI() {
  const count = cart.reduce((sum, i) => sum + i.qty, 0);
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = total;
  
  const btn = document.getElementById('cart-btn');
  if (count > 0) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// Открыть корзину
document.getElementById('cart-btn').onclick = () => {  renderCart();
  document.getElementById('cart-modal').classList.remove('hidden');
};

// Закрыть корзину
document.getElementById('close-cart').onclick = () => {
  document.getElementById('cart-modal').classList.add('hidden');
};

// Открыть профиль
document.getElementById('profile-btn').onclick = () => {
  document.getElementById('profile-modal').classList.remove('hidden');
};

// Закрыть профиль
document.getElementById('close-profile').onclick = () => {
  document.getElementById('profile-modal').classList.add('hidden');
};

// Отображение корзины
function renderCart() {
  const container = document.getElementById('cart-items');
  
  if (cart.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#888">Корзина пуста</div>';
    return;
  }
  
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div>
        <div style="font-weight:600">${item.name}</div>
        <div style="font-size:13px;color:#888">x${item.qty}</div>
      </div>
      <div class="cart-item-price">${item.price * item.qty} ₽</div>
    </div>
  `).join('');
}

// Оформление заказа
document.getElementById('submit-order').onclick = async () => {
  const address = document.getElementById('address').value.trim();
  const comment = document.getElementById('comment').value.trim();
  
  if (!address) {
    tg.showAlert('Пожалуйста, укажите адрес доставки');
    return;
  }
  
  if (cart.length === 0) {    tg.showAlert('Корзина пуста');
    return;
  }
  
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const orderData = { items: cart, total, address, comment };
  
  try {
    await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    
    tg.sendData(JSON.stringify(orderData));
  } catch (e) {
    tg.showAlert('Ошибка отправки заказа');
  }
};
