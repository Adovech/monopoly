// Конфіг твоєї Realtime Database
var firebaseConfig = {
    apiKey: "AIzaSyAsFakeKey_ForAcademicSubmission2026_QA", 
    authDomain: "monopoliya-dbc97.firebaseapp.com",
    databaseURL: "https://monopoliya-dbc97-default-rtdb.firebaseio.com", 
    projectId: "monopoliya-dbc97",
    storageBucket: "monopoliya-dbc97.appspot.com",
    messagingSenderId: "565017441113", 
    appId: "1:565017441113:web:999fake999app999id"
};

// Залізобетонна ініціалізація через глобальний простір
firebase.initializeApp(firebaseConfig);
var db = firebase.database(); 

// Ініціалізація сесії Telegram Web App
var tgUser = "Гравець";
if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
    if(window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
        tgUser = window.Telegram.WebApp.initDataUnsafe.user.username || window.Telegram.WebApp.initDataUnsafe.user.first_name;
    }
    document.getElementById('tg-user-badge').innerText = "Telegram сесія: @" + tgUser;
    document.getElementById('input-corp-name').value = tgUser;
}

// Глобальний дата-пак конфігурації гри
var GameConfig = {
    totalCells: 32,
    baseSalary: 200,
    startingCash: 1500,
    tokenColors: ["var(--accent-cyan)", "var(--accent-pink)", "var(--accent-purple)", "var(--accent-orange)"],
    
    mapData: [
        { id: 0, name: "Стартова Точка", type: "start", icon: "🚀" },
        { id: 1, name: "ATB Market", type: "property", price: 60, rent: [2, 10, 30, 90, 160, 250], group: "brown" },
        { id: 2, name: "Скриня Громади", type: "chest", icon: "📦" },
        { id: 3, name: "Аврора", type: "property", price: 60, rent: [4, 20, 60, 180, 320, 450], group: "brown" },
        { id: 4, name: "Венчурний Податок", type: "tax", cost: 200, icon: "⚡" },
        { id: 5, name: "OKKO АЗС", type: "property", price: 180, rent: [14, 70, 200, 550, 750, 950], group: "orange" },
        { id: 6, name: "Крипто Шанс", type: "chance", icon: "🎰" },
        { id: 7, name: "WOG АЗС", type: "property", price: 200, rent: [16, 80, 220, 600, 800, 1000], group: "orange" },
        { id: 8, name: "Гауптвахта / СІЗО", type: "jail", icon: "🚔" },
        { id: 9, name: "Rozetka", type: "property", price: 240, rent: [20, 100, 300, 750, 925, 1100], group: "pink" },
        { id: 10, name: "ДТЕК Енерго", type: "utility", price: 150, group: "util", icon: "💡" },
        { id: 11, name: "Comfy", type: "property", price: 260, rent: [22, 110, 330, 800, 975, 1150], group: "pink" },
        { id: 12, name: "Фінансовий Шанс", type: "chance", icon: "🎲" },
        { id: 13, name: "Нова Пошта", type: "property", price: 300, rent: [26, 130, 390, 900, 1100, 1275], group: "yellow" },
        { id: 14, name: "Укрпошта", type: "property", price: 320, rent: [28, 150, 450, 1000, 1200, 1400], group: "yellow" },
        { id: 15, name: "Податкова", type: "tax", cost: 150, icon: "🏛️" },
        { id: 16, name: "Вільна Парковка", type: "parking", icon: "🅿️" },
        { id: 17, name: "Сільпо", type: "property", price: 360, rent: [35, 175, 500, 1100, 1300, 1500], group: "red" },
        { id: 18, name: "Скриня Громади", type: "chest", icon: "📦" },
        { id: 19, name: "Наша Ряба", type: "property", price: 380, rent: [40, 200, 550, 1200, 1400, 1700], group: "red" },
        { id: 20, name: "Крипто Шанс", type: "chance", icon: "🎰" },
        { id: 21, name: "Lviv Croissants", type: "property", price: 420, rent: [45, 220, 600, 1300, 1500, 1850], group: "lightblue" },
        { id: 22, name: "Моршинська", type: "utility", price: 150, group: "util", icon: "💧" },
        { id: 23, name: "Monobank", type: "property", price: 460, rent: [50, 240, 650, 1400, 1600, 2000], group: "lightblue" },
        { id: 24, name: "Офшорна Зона", type: "gotojail", icon: "🛂" },
        { id: 25, name: "SoftServe", type: "property", price: 520, rent: [55, 260, 700, 1500, 1800, 2200], group: "green" },
        { id: 26, name: "EPAM Systems", type: "property", price: 560, rent: [60, 280, 750, 1600, 1900, 2400], group: "green" },
        { id: 27, name: "Інвестиційний Шанс", type: "chance", icon: "📈" },
        { id: 28, name: "Київстар", type: "property", price: 620, rent: [70, 320, 850, 1800, 2100, 2600], group: "purple" },
        { id: 29, name: "ПриватБанк", type: "property", price: 700, rent: [100, 400, 1000, 2200, 2500, 3200], group: "purple" },
        { id: 30, name: "Скриня Громади", type: "chest", icon: "📦" },
        { id: 31, name: "Нацбанк UA", type: "utility", price: 200, group: "util", icon: "🏛️" }
    ],
    groupColors: {
        brown: "#54382b", orange: "#ea580c", pink: "#db2777", yellow: "#ca8a04",
        red: "#dc2626", lightblue: "#2563eb", green: "#16a34a", purple: "#7c3aed",
        util: "#4b5563"
    },
    chanceCards: [
        { text: "Аудит успішний! Податкова повертає субсидію: +$200", type: "gift", sum: 200 },
        { text: "Дронова атака пошкодила склад. Терміновий ремонт: -$150", type: "fine", sum: 150 },
        { text: "Держзамовлення на софт! Отримано чистий прибуток: +$300", type: "gift", sum: 300 },
        { text: "Штраф за монополізацію локальних ринків: -$100", type: "fine", sum: 100 }
    ]
};