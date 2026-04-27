const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cartTotal = 0;

// Загрузка меню
fetch('/api/menu')
  .then(res => res.json())
  .then(data => {
    const menu = document.getElementById('menu');
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<div style="font-size:30px">${item.img}</div><b>${item.name}</b><br>${item.price}₽`;
      div.onclick = () => addToCart(item.price);
      menu.appendChild(div);
    });
  });

function addToCart(price) {
  cartTotal += price;
  document.getElementById('total').innerText = cartTotal;
  document.getElementById('cart').classList.remove('hidden');
  tg.HapticFeedback.impactOccurred('light');
}

// Отправка заказа
document.getElementById('order-btn').onclick = () => {
  tg.sendData(JSON.stringify({ 
    items: [{name: "Заказ", price: cartTotal, qty: 1}], 
    total: cartTotal, 
    address: "Улица Пушкина, д. 1" 
  }));
};
