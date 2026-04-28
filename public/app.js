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
  }, 3000);
});

function initProfile() {
  const user = tg.initDataUnsafe.user;
  if (user) {
    document.getElementById('profile-name').innerText = user.first_name || 'Пользователь';
    document.getElementById('profile-id').innerText = `ID: ${user.id}`;
    const refLink = `https://t.me/FoodhubBot?start=ref_${user.id}`;
    document.getElementById('ref-link').innerText = refLink;
  }
}

window.copyRefLink = function() {
  const link = document.getElementById('ref-link').innerText;
  navigator.clipboard.writeText(link).then(() => {
    tg.HapticFeedback.notificationOccurred('success');
    tg.showAlert('Ссылка скопирована в буфер обмена!');
  });
}

async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu('all');
    setupCategories();
  } catch (e) { console.error(e); }
}

function renderMenu(filterCat) {
  const grid = document.getElementById('menu-grid');
  let items = menu;
  if (filterCat !== 'all') items = menu.filter(i => i.category === filterCat);
  grid.innerHTML = items.map(item => `
    <div class="menu-item" onclick="addToCart(${item.id})">
      <img src="${item.image}" alt="${item.name}" class="item-image" loading="lazy">
      <div class="item-content">        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.desc}</div>
        <div class="item-footer">
          <div class="item-price">${item.price} ₽</div>
          <button class="add-btn">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

function setupCategories() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMenu(btn.dataset.cat);
    };
  });
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
  const btn = document.getElementById('cart-btn');
  if (count > 0) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}

document.getElementById('cart-btn').onclick = () => { renderCart(); document.getElementById('cart-modal').classList.remove('hidden'); };
document.getElementById('close-cart').onclick = () => document.getElementById('cart-modal').classList.add('hidden');
document.getElementById('profile-btn').onclick = () => document.getElementById('profile-modal').classList.remove('hidden');
document.getElementById('close-profile').onclick = () => document.getElementById('profile-modal').classList.add('hidden');

function renderCart() {
  const container = document.getElementById('cart-items');
  if (cart.length === 0) { container.innerHTML = '<div style="text-align:center;padding:20px;color:#888">Корзина пуста</div>'; return; }
  container.innerHTML = cart.map(item => `
    <div class="cart-item">      <div><b>${item.name}</b> x${item.qty}</div>
      <div class="cart-item-price">${item.price * item.qty} ₽</div>
    </div>
  `).join('');
}

document.getElementById('submit-order').onclick = async () => {
  const address = document.getElementById('address').value.trim();
  if (!address) { tg.showAlert('Укажите адрес'); return; }
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const data = { items: cart, total, address };
  try {
    await fetch('/api/order', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
    tg.sendData(JSON.stringify(data));
  } catch (e) { tg.showAlert('Ошибка отправки'); }
};
