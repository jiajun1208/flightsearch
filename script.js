// Ensure Firebase modules are loaded globally by index.html script type="module"
const {
    initializeApp,
    getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, signOut,
    getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, query, where,
    getStorage, ref, uploadBytes, getDownloadURL
} = window.firebase;

// === 在此處填入您的 Firebase 專案設定 (請務必替換佔位符!) ===
const firebaseConfig = {
    apiKey: "AIzaSyCZSC4KP9r9Ia74gjhVM4hkhkCiXU6ltR4",
    authDomain: "avny-ccbe9.firebaseapp.com",
    databaseURL: "https://avny-ccbe9-default-rtdb.firebaseio.com",
    projectId: "avny-ccbe9",
    storageBucket: "avny-ccbe9.firebasestorage.app",
    messagingSenderId: "686829295344",
    appId: "1:686829295344:web:6ac5c87b3d5f1b70701435"
    // measurementId: "YOUR_MEASUREMENT_ID" // 如果有啟用 Google Analytics，請取消註解並填入
};

// 從 firebaseConfig 中獲取 appId。確保上述 appId 已被正確填寫。
const appId = firebaseConfig.appId;

// 如果您有自訂認證令牌，請在此處填入。如果沒有，請設為 null。
const initialAuthToken = null; // 或者 'YOUR_CUSTOM_AUTH_TOKEN_STRING';
// ===========================================

// 初始化 Firebase 服務
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// 全局應用程式狀態物件
const appState = {
    activeTab: 'search', // 當前活躍的頁籤: 'search' (航班搜尋) 或 'admin' (管理後台)
    currentUser: null, // 當前登入的用戶物件 (Firebase User)
    flights: [], // 從 Firestore 獲取的全部航班資料
    loading: true, // 應用程式是否正在載入中 (指 Firebase Auth 和初始設定)
    flightsDataInitialized: false, // 新增狀態：true 表示初始 Firestore 航班數據已載入 (無論成功或失敗)
    error: null, // 應用程式是否有錯誤訊息
    userId: null, // 當前用戶的 Firebase UID (用於 Firestore 路徑)

    // 搜尋表單的狀態
    searchDeparture: '', // 搜尋的出發地機場
    searchDestination: '', // 搜尋的目的地機場
    searchSelectedAirlines: [], // 搜尋選中的航空公司列表
    hasSearched: false, // 新增狀態：是否已執行過搜尋，控制結果顯示
    sortOrder: 'departureTime', // 新增狀態：搜尋結果的排序方式 ('departureTime', 'airlineGroup')

    // 管理表單的狀態
    adminEditingFlight: null, // 正在編輯的航班物件 (如果為 null 則為新增模式)
    adminShowForm: false, // 是否顯示航班新增/編輯表單
    adminMessage: '', // 管理操作的訊息 (例如: "新增成功")
    adminImageFile: null, // 用於上傳的航空公司 LOGO 檔案
    adminPreviewImage: '', // 航空公司 LOGO 的預覽 URL
    adminCurrentFormValues: {}, // 儲存管理表單的即時輸入值
};

// 航空公司數據列表
const AIRLINES = [
    { name: '七岩維國家航空', id: 'QYWA' },
    { name: '南省航空', id: 'NSH' },
    { name: '大五股航空', id: 'DWG' },
    { name: '福航航空', id: 'FUH' },
    { name: '東森快運航空', id: 'ETEX' },
];

// --- 工具函數 ---

/**
 * 將 ISO 8601 時間字串格式化為本地時間 (例如: 10:00)
 * @param {string} isoString - ISO 8601 時間字串
 * @returns {string} 格式化後的時間字串
 */
const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
};

/**
 * 從 ISO 8601 時間字串中提取 HH:MM 格式的時間
 * 適用於 <input type="time"> 的 value 屬性
 * @param {string} isoString - ISO 8601 時間字串
 * @returns {string} HH:MM 格式的時間字串
 */
const get24HourTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // 'en-GB' 確保 24 小時制
};


/**
 * 格式化航班的可用飛行日期 (例如: "一 二 三")
 * @param {string[]} daysArray - 包含星期幾縮寫 (Mon, Tue...) 的陣列
 * @returns {string} 渲染成 HTML 標籤的星期幾字串
 */
const formatDays = (daysArray) => {
    const dayMap = {
        "Mon": "一", "Tue": "二", "Wed": "三", "Thu": "四",
        "Fri": "五", "Sat": "六", "Sun": "日"
    };
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `
        <span class="inline-block w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
            daysArray.includes(day) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
        }" title="${dayMap[day]}">
            ${dayMap[day]}
        </span>
    `).join('');
};

/**
 * 防抖函數：在事件觸發後延遲執行函數，如果在延遲時間內再次觸發，則重置計時器。
 * @param {Function} func - 要防抖的函數
 * @param {number} delay - 延遲時間 (毫秒)
 * @returns {Function} 防抖後的函數
 */
const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
};

/**
 * 計算兩個時間點之間的飛行時長 (格式為 "XhYm")
 * 假設跨日的情況，如果抵達時間早於起飛時間，則假定抵達日為起飛日的隔天
 * @param {string} departureTime - HH:MM 格式的起飛時間
 * @param {string} arrivalTime - HH:MM 格式的抵達時間
 * @returns {string} 飛行時長字串 (例如 "2h30m") 或空字串
 */
const calculateDuration = (departureTime, arrivalTime) => {
    if (!departureTime || !arrivalTime) return '';

    // 使用一個固定的日期，因為我們只關心時間差，不關心實際日期
    const dummyDate = '2000-01-01';
    const depDateTime = new Date(`${dummyDate}T${departureTime}:00`);
    let arrDateTime = new Date(`${dummyDate}T${arrivalTime}:00`);

    // 如果抵達時間早於起飛時間，則假定是隔天抵達
    if (arrDateTime < depDateTime) {
        arrDateTime.setDate(arrDateTime.getDate() + 1);
    }

    const diffMs = arrDateTime.getTime() - depDateTime.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    let durationString = '';
    if (diffHours > 0) {
        durationString += `${diffHours}h`;
    }
    if (diffMinutes > 0) {
        durationString += `${diffMinutes}m`;
    }
    if (durationString === '' && (diffHours === 0 && diffMinutes === 0)) {
        return '0m'; // 如果時間完全相同，顯示為 0m
    }
    return durationString;
};

/**
 * 更新應用程式狀態並觸發重新渲染
 * @param {object} newState - 要更新的 appState 部分
 */
const updateAppStateAndRender = (newState) => {
    // 使用 Object.assign 智慧地合併狀態，而不是直接替換物件
    Object.assign(appState, newState);
    renderApp(); // 每次狀態改變時呼叫主渲染函數
};

// --- 渲染函數 ---

/**
 * 渲染網站的頁首導覽列
 * @returns {HTMLElement} 頁首 DOM 元素
 */
const renderHeader = () => {
    const header = document.createElement('header');
    header.className = "bg-blue-950 shadow-lg p-4 flex justify-between items-center rounded-b-lg";
    header.innerHTML = `
        <div class="text-2xl font-bold text-white tracking-wide">
            七岩維出境航班查詢網
        </div>
        <nav class="flex space-x-6">
            <button id="nav-search"
                class="text-white hover:text-blue-200 transition-colors duration-300 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                航班搜尋
            </button>
            ${appState.currentUser ? `
                <button id="nav-admin"
                    class="text-white hover:text-blue-200 transition-colors duration-300 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    管理航班
                </button>
                <button id="nav-logout"
                    class="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-1 rounded-md shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500">
                    登出
                </button>
            ` : `
                <button id="nav-login"
                    class="text-white hover:text-blue-200 transition-colors duration-300 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    管理員登入
                </button>
            `}
        </nav>
    `;

    // 為導覽按鈕附加事件監聽器
    header.querySelector('#nav-search').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'search', hasSearched: false })); // 重設 hasSearched
    if (appState.currentUser) {
        header.querySelector('#nav-admin').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'admin' }));
        header.querySelector('#nav-logout').addEventListener('click', async () => {
            try {
                await signOut(auth);
                // 登出後，將 activeTab 設為 'search'，並重設 admin 相關狀態
                updateAppStateAndRender({
                    activeTab: 'search',
                    adminEditingFlight: null,
                    adminShowForm: false,
                    adminMessage: '',
                    adminImageFile: null,
                    adminPreviewImage: '',
                    adminCurrentFormValues: {}, // 清空表單值
                    hasSearched: false // 登出後也重設搜尋狀態
                });
            } catch (error) {
                console.error("登出失敗:", error);
                // 實際應用中請使用自定義模態框替代 alert
                alert("登出失敗，請重試。");
            }
        });
    } else {
        header.querySelector('#nav-login').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'admin' }));
    }
    return header;
};

/**
 * 渲染管理員登入表單（此範例僅作佔位符，主要透過匿名登入）
 * @returns {HTMLElement} 登入表單 DOM 元素
 */
const renderAuth = () => {
    const authDiv = document.createElement('div');
    authDiv.className = "flex flex-col items-center justify-center p-6 bg-white bg-opacity-10 rounded-xl shadow-2xl max-w-md mx-auto mt-10";
    authDiv.innerHTML = `
        <h2 class="text-3xl font-bold text-white mb-6">管理員登入</h2>
        <form id="auth-form" class="w-full flex flex-col space-y-4">
            <input type="email" placeholder="電子郵件 (僅作示範)" id="auth-email"
                class="p-3 bg-blue-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-blue-300" />
            <input type="password" placeholder="密碼 (僅作示範)" id="auth-password"
                class="p-3 bg-blue-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-blue-300" />
            <button type="submit"
                class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400">
                登入
            </button>
        </form>
        <p id="auth-message" class="mt-4 text-center text-sm"></p>
    `;

    authDiv.querySelector('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageEl = authDiv.querySelector('#auth-message');
        messageEl.textContent = '';
        // 由於我們預設使用匿名登入，這裡的登入按鈕僅作示範和提示
        messageEl.textContent = '此範例使用匿名登入。管理員功能應透過 Firestore 權限規則控制。';
    });
    return authDiv;
};

/**
 * 渲染航班搜尋介面
 * @returns {HTMLElement} 航班搜尋 DOM 元素
 */
const renderFlightSearch = () => {
    const searchDiv = document.createElement('div');
    searchDiv.className = "p-6";
    searchDiv.innerHTML = `
        <h2 class="text-4xl font-extrabold text-white mb-8 text-center drop-shadow-lg">尋找您的完美航班</h2>
        <div class="bg-white p-8 rounded-2xl shadow-xl max-w-4xl mx-auto mb-10 flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0">
            <div class="flex-1 space-y-4">
                <input type="text" id="search-departure" placeholder="出發地機場 (例如: TPE)"
                    value="${appState.searchDeparture}"
                    class="w-full p-4 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-blue-900 placeholder-blue-400 transition-all duration-300" />
                <input type="text" id="search-destination" placeholder="目的地機場 (例如: NRT)"
                    value="${appState.searchDestination}"
                    class="w-full p-4 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-blue-900 placeholder-blue-400 transition-all duration-300" />
            </div>
            <div class="flex-1">
                <h3 class="text-lg font-semibold text-blue-900 mb-3">航空公司</h3>
                <div id="airline-checkboxes" class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                    ${AIRLINES.map(airline => `
                        <label class="inline-flex items-center text-blue-900 cursor-pointer">
                            <input type="checkbox" value="${airline.name}"
                                class="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500"
                                ${appState.searchSelectedAirlines.includes(airline.name) ? 'checked' : ''} />
                            <span class="ml-2 text-base">${airline.name}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="flex justify-center lg:justify-end items-end">
                <button id="search-flights-btn"
                    class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400">
                    搜尋航班
                </button>
            </div>
        </div>
        
        <div class="bg-white p-4 rounded-xl shadow-xl max-w-4xl mx-auto mb-6 flex justify-end">
            <label for="sort-select" class="block text-sm font-medium text-gray-700 mr-2 self-center">排序方式:</label>
            <select id="sort-select" class="p-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-blue-900">
                <option value="departureTime" ${appState.sortOrder === 'departureTime' ? 'selected' : ''}>依起飛時間 (最早)</option>
                <option value="airlineGroup" ${appState.sortOrder === 'airlineGroup' ? 'selected' : ''}>依航空公司分組</option>
            </select>
        </div>

        <div id="flight-results-container"></div>
    `;

    // 為搜尋欄位附加事件監聽器，僅更新狀態，不觸發立即渲染
    const departureInput = searchDiv.querySelector('#search-departure');
    departureInput.addEventListener('input', (e) => {
        appState.searchDeparture = e.target.value;
    });

    const destinationInput = searchDiv.querySelector('#search-destination');
    destinationInput.addEventListener('input', (e) => {
        appState.searchDestination = e.target.value;
    });

    searchDiv.querySelector('#airline-checkboxes').addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const airlineName = e.target.value;
            let newSelectedAirlines = [...appState.searchSelectedAirlines];
            if (e.target.checked) {
                newSelectedAirlines.push(airlineName);
            } else {
                newSelectedAirlines = newSelectedAirlines.filter(name => name !== airlineName);
            }
            appState.searchSelectedAirlines = newSelectedAirlines; // 直接更新狀態，不觸發渲染
        }
    });

    // 搜尋按鈕的點擊事件，觸發渲染並標記已搜尋
    searchDiv.querySelector('#search-flights-btn').addEventListener('click', () => {
        updateAppStateAndRender({ hasSearched: true });
    });

    // 排序下拉選單的事件監聽器
    searchDiv.querySelector('#sort-select').addEventListener('change', (e) => {
        updateAppStateAndRender({ sortOrder: e.target.value });
    });


    const resultsContainer = searchDiv.querySelector('#flight-results-container');
    if (appState.hasSearched) {
        // 根據當前的 appState 進行航班過濾
        let currentFilteredFlights = appState.flights.filter(flight => {
            const matchDeparture = appState.searchDeparture === '' || flight.departure.toLowerCase().includes(appState.searchDeparture.toLowerCase());
            const matchDestination = appState.searchDestination === '' || flight.destination.toLowerCase().includes(appState.searchDestination.toLowerCase());
            const matchAirline = appState.searchSelectedAirlines.length === 0 || appState.searchSelectedAirlines.includes(flight.airlineName);
            return matchDeparture && matchDestination && matchAirline;
        });

        // 根據選擇的排序方式進行排序
        if (appState.sortOrder === 'departureTime') {
            currentFilteredFlights.sort((a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime());
        } else if (appState.sortOrder === 'airlineGroup') {
            currentFilteredFlights.sort((a, b) => {
                const airlineCompare = a.airlineName.localeCompare(b.airlineName);
                if (airlineCompare === 0) {
                    // 如果航空公司相同，則按起飛時間排序
                    return new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime();
                }
                return airlineCompare;
            });
        }

        resultsContainer.appendChild(renderFlightResults(currentFilteredFlights));
    } else {
        // 初始狀態或未搜尋時顯示提示
        const messageDiv = document.createElement('div');
        messageDiv.className = "text-center text-white text-2xl mt-10 p-6 bg-white bg-opacity-10 rounded-xl shadow-xl";
        messageDiv.textContent = "請輸入搜尋條件並點擊搜尋。";
        resultsContainer.appendChild(messageDiv);
    }

    return searchDiv;
};

/**
 * 渲染航班搜尋結果列表
 * @param {object[]} flights - 要顯示的航班陣列
 * @returns {HTMLElement} 航班結果列表 DOM 元素
 */
const renderFlightResults = (flights) => {
    const resultsDiv = document.createElement('div');
    if (flights.length === 0) {
        resultsDiv.className = "text-center text-white text-2xl mt-10 p-6 bg-white bg-opacity-10 rounded-xl shadow-xl";
        resultsDiv.textContent = "沒有找到符合條件的航班。";
    } else {
        resultsDiv.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6";
        flights.forEach(flight => {
            resultsDiv.appendChild(renderFlightCard(flight));
        });
    }
    return resultsDiv;
};

/**
 * 渲染單一航班卡片
 * @param {object} flight - 航班數據物件
 * @returns {HTMLElement} 航班卡片 DOM 元素
 */
const renderFlightCard = (flight) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = "bg-white p-6 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-105 flex flex-col justify-between";
    cardDiv.innerHTML = `
        <div>
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center space-x-3">
                    ${flight.airlineLogoUrl ? `
                        <img src="${flight.airlineLogoUrl}" alt="${flight.airlineName} Logo"
                            class="w-12 h-12 rounded-full object-contain border border-gray-200"
                            onerror="this.onerror=null;this.src='https://placehold.co/48x48/CCCCCC/333333?text=Logo';" />
                    ` : ''}
                    <h3 class="text-2xl font-bold text-blue-900">${flight.airlineName}</h3>
                </div>
                <span class="text-lg font-semibold text-blue-700">${flight.flightNumber}</span>
            </div>

            <div class="text-gray-700 mb-4">
                <div class="flex justify-between items-start text-blue-800 mb-4">
                    <div class="flex flex-col items-center text-center">
                        <span class="text-3xl font-bold">${flight.departure}</span>
                        <span class="text-lg text-gray-600 mt-1">${formatTime(flight.departureTime)}</span>
                    </div>
                    <div class="flex flex-col items-center justify-center h-full pt-2">
                        <span class="text-gray-500 text-base">→</span>
                    </div>
                    <div class="flex flex-col items-center text-center">
                        <span class="text-3xl font-bold">${flight.destination}</span>
                        <span class="text-lg text-gray-600 mt-1">${formatTime(flight.arrivalTime)}</span>
                    </div>
                </div>
                
                <p class="text-lg text-gray-600 mb-2">
                    飛行時長: <span class="font-semibold">${flight.flightDuration}</span>
                </p>
                <p class="text-lg text-gray-600 mb-4">
                    機型: <span class="font-semibold">${flight.aircraftType}</span>
                </p>
            </div>
        </div>

        <div class="mt-auto pt-4 border-t border-gray-200">
            <p class="text-sm font-semibold text-blue-900 mb-2">一週飛行日:</p>
            <div class="flex space-x-2 justify-center">
                ${formatDays(flight.availableDays || [])}
            </div>
        </div>
    `;
    return cardDiv;
};

/**
 * 渲染管理面板 (顯示航班列表、新增/編輯/刪除按鈕)
 * @returns {HTMLElement} 管理面板 DOM 元素
 */
const renderAdminPanel = () => {
    const adminDiv = document.createElement('div');
    adminDiv.className = "p-6 bg-white bg-opacity-10 rounded-xl shadow-2xl mx-auto max-w-6xl";
    adminDiv.innerHTML = `
        <h2 class="text-3xl font-bold text-white mb-6 text-center">管理航班資訊</h2>
        <div id="admin-message-container"></div>
        <div id="admin-content"></div>
    `;

    const messageContainer = adminDiv.querySelector('#admin-message-container');
    if (appState.adminMessage) {
        messageContainer.innerHTML = `
            <div class="bg-green-500 text-white p-3 rounded-lg mb-4 text-center">
                ${appState.adminMessage}
            </div>
        `;
        // 清除訊息，避免長時間顯示
        setTimeout(() => updateAppStateAndRender({ adminMessage: '' }), 5000);
    } else {
        messageContainer.innerHTML = '';
    }

    const adminContent = adminDiv.querySelector('#admin-content');

    if (!appState.adminShowForm) { // 顯示航班列表和新增按鈕
        adminContent.innerHTML = `
            <button id="add-flight-btn"
                class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg mb-6 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400">
                新增航班
            </button>
            <div class="overflow-x-auto bg-white rounded-lg shadow-md">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-blue-100">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase tracking-wider">航空公司</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase tracking-wider">航班號</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase tracking-wider">起飛</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase tracking-wider">降落</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase tracking-wider">操作</th>
                        </tr>
                    </thead>
                    <tbody id="flights-table-body" class="bg-white divide-y divide-gray-200">
                        ${appState.flights.length === 0 ? `
                            <tr>
                                <td colSpan="5" class="px-6 py-4 whitespace-nowrap text-center text-gray-500">
                                    目前沒有航班資訊。
                                </td>
                            </tr>
                        ` : appState.flights.map(flight => `
                            <tr class="hover:bg-blue-50 transition-colors duration-200">
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 flex items-center">
                                    ${flight.airlineLogoUrl ? `
                                        <img src="${flight.airlineLogoUrl}" alt="Logo"
                                            class="w-8 h-8 rounded-full mr-2 object-contain"
                                            onerror="this.onerror=null;this.src='https://placehold.co/32x32/CCCCCC/333333?text=Logo';" />
                                    ` : ''}
                                    ${flight.airlineName}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${flight.flightNumber}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${flight.departure} (${formatTime(flight.departureTime)})</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${flight.destination} (${formatTime(flight.arrivalTime)})</td>
                                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button data-id="${flight.id}" class="edit-btn text-blue-600 hover:text-blue-900 mr-3 px-3 py-1 rounded-md bg-blue-100 hover:bg-blue-200 transition-colors duration-200">
                                        編輯
                                    </button>
                                    <button data-id="${flight.id}" class="delete-btn text-red-600 hover:text-red-900 px-3 py-1 rounded-md bg-red-100 hover:bg-red-200 transition-colors duration-200">
                                        刪除
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // 為新增、編輯、刪除按鈕附加事件監聽器
        adminContent.querySelector('#add-flight-btn').addEventListener('click', () => {
            // 新增時初始化空表單
            updateAppStateAndRender({
                adminEditingFlight: null,
                adminShowForm: true,
                adminImageFile: null,
                adminPreviewImage: '',
                adminCurrentFormValues: { // 初始化表單值
                    departure: '', destination: '',
                    departureTime: '', arrivalTime: '',
                    airlineName: '', flightNumber: '', aircraftType: '',
                    availableDays: []
                }
            });
        });

        adminContent.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', () => {
                const flightId = button.dataset.id;
                const flightToEdit = appState.flights.find(f => f.id === flightId);
                // 編輯時載入現有數據
                updateAppStateAndRender({
                    adminEditingFlight: flightToEdit,
                    adminShowForm: true,
                    adminImageFile: null, // 清除可能的舊檔案，準備上傳新檔案
                    adminPreviewImage: flightToEdit.airlineLogoUrl || '', // 顯示現有預覽圖
                    adminCurrentFormValues: { // 載入編輯數據到表單值
                        ...flightToEdit,
                        departureTime: get24HourTime(flightToEdit.departureTime), // 轉為 HH:MM
                        arrivalTime: get24HourTime(flightToEdit.arrivalTime),     // 轉為 HH:MM
                        availableDays: flightToEdit.availableDays || []
                    }
                });
            });
        });

        adminContent.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const flightId = button.dataset.id;
                // 實際應用中請使用自定義模態框替代 window.confirm
                if (confirm("確定要刪除這個航班嗎？")) {
                    try {
                        await deleteDoc(doc(db, `artifacts/${appId}/public/data/flights`, flightId));
                        updateAppStateAndRender({ adminMessage: '航班已成功刪除！' });
                    } catch (e) {
                        console.error("刪除航班失敗:", e);
                        updateAppStateAndRender({ adminMessage: `刪除航班失敗: ${e.message}` });
                    }
                }
            });
        });

    } else { // 顯示航班新增/編輯表單
        adminContent.appendChild(renderFlightForm());
    }
    return adminDiv;
};

/**
 * 渲染航班新增/編輯表單
 * @returns {HTMLElement} 航班表單 DOM 元素
 */
const renderFlightForm = () => {
    // 直接從 appState 中讀取表單的即時值
    const formValues = appState.adminCurrentFormValues;

    const formDiv = document.createElement('div');
    formDiv.className = "bg-white p-8 rounded-2xl shadow-xl space-y-6 text-blue-900";
    formDiv.innerHTML = `
        <h3 class="text-2xl font-bold text-center mb-6">${appState.adminEditingFlight ? '編輯航班' : '新增航班'}</h3>

        <form id="flight-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label for="form-departure" class="block text-sm font-medium text-gray-700 mb-1">出發地機場</label>
                    <input type="text" id="form-departure" name="departure" value="${formValues.departure || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-destination" class="block text-sm font-medium text-gray-700 mb-1">目的地機場</label>
                    <input type="text" id="form-destination" name="destination" value="${formValues.destination || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-flightNumber" class="block text-sm font-medium text-gray-700 mb-1">航班編號</label>
                    <input type="text" id="form-flightNumber" name="flightNumber" value="${formValues.flightNumber || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-aircraftType" class="block text-sm font-medium text-gray-700 mb-1">飛機機型</label>
                    <input type="text" id="form-aircraftType" name="aircraftType" value="${formValues.aircraftType || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label for="form-departureTime" class="block text-sm font-medium text-gray-700 mb-1">起飛時間 (僅時分)</label>
                    <input type="time" id="form-departureTime" name="departureTime" value="${formValues.departureTime || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-arrivalTime" class="block text-sm font-medium text-gray-700 mb-1">降落時間 (僅時分)</label>
                    <input type="time" id="form-arrivalTime" name="arrivalTime" value="${formValues.arrivalTime || ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
            </div>

            <div class="mb-4">
                <label for="form-airlineName" class="block text-sm font-medium text-gray-700 mb-1">航空公司名稱</label>
                <input type="text" id="form-airlineName" name="airlineName" value="${formValues.airlineName || ''}" required
                    class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div class="mb-4">
                <label for="form-airlineLogo" class="block text-sm font-medium text-gray-700 mb-1">航空公司 LOGO (PNG/JPG)</label>
                <input type="file" id="form-airlineLogo" name="airlineLogo" accept=".png,.jpg,.jpeg"
                    class="w-full p-3 border border-blue-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div id="logo-preview-container" class="mt-4 flex items-center space-x-3">
                    ${(appState.adminPreviewImage) ? `
                        <p class="text-gray-600">當前 LOGO 預覽:</p>
                        <img id="current-logo-preview" src="${appState.adminPreviewImage}" alt="Logo Preview" class="w-20 h-20 object-contain rounded-lg border border-gray-300 shadow-sm" />
                    ` : `
                        <p class="text-gray-600" id="current-logo-preview-placeholder">沒有 LOGO 預覽</p>
                        <img id="current-logo-preview" src="" alt="Logo Preview" class="hidden w-20 h-20 object-contain rounded-lg border border-gray-300 shadow-sm" />
                    `}
                </div>
                ${appState.adminImageFile ? '<p class="text-sm text-blue-600 mt-2" id="file-chosen-message">已選擇檔案: ' + appState.adminImageFile.name + '</p>' : '<p class="text-sm text-blue-600 mt-2" id="file-chosen-message"></p>'}
                <p class="text-sm text-gray-500 mt-2">注意: 上傳圖片後，文件選擇框可能會顯示"未選擇任何檔案"，但圖片已成功載入預覽。</p>
            </div>

            <div class="mb-6">
                <p class="block text-sm font-medium text-gray-700 mb-2">一週飛行日</p>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2" id="days-checkboxes">
                    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                        <label class="inline-flex items-center text-gray-800 cursor-pointer">
                            <input type="checkbox" value="${day}"
                                class="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500"
                                ${formValues.availableDays.includes(day) ? 'checked' : ''} />
                            <span class="ml-2 text-base">${{ Mon: '星期一', Tue: '星期二', Wed: '星期三', Thu: '星期四', Fri: '星期五', Sat: '星期六', Sun: '星期日' }[day]}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div class="flex justify-end space-x-4 mt-8">
                <button type="button" id="form-cancel-btn"
                    class="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-100 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-gray-400">
                    取消
                </button>
                <button type="submit"
                    class="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400">
                    ${appState.adminEditingFlight ? '儲存變更' : '新增航班'}
                </button>
            </div>
        </form>
    `;

    const formElement = formDiv.querySelector('#flight-form');
    const imageInput = formDiv.querySelector('#form-airlineLogo');
    const logoPreviewImg = formDiv.querySelector('#current-logo-preview');
    const logoPreviewPlaceholder = formDiv.querySelector('#current-logo-preview-placeholder');
    const fileChosenMessage = formDiv.querySelector('#file-chosen-message');


    // 為所有輸入欄位附加事件監聽器，更新 appState.adminCurrentFormValues
    // 這裡不觸發 updateAppStateAndRender，以避免表單重新繪製
    formElement.querySelectorAll('input:not([type="checkbox"]):not([type="file"]), select, textarea').forEach(input => {
        input.addEventListener('input', (e) => {
            appState.adminCurrentFormValues[e.target.name] = e.target.value;
        });
    });

    // 為日期選擇框單獨處理，因為它們沒有 name 屬性，且需要處理 checked 狀態
    formDiv.querySelector('#days-checkboxes').addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const dayValue = e.target.value;
            let newDays = [...(appState.adminCurrentFormValues.availableDays || [])];
            if (e.target.checked) {
                newDays.push(dayValue);
            } else {
                newDays = newDays.filter(day => day !== dayValue);
            }
            appState.adminCurrentFormValues.availableDays = newDays;
        }
    });


    // 為圖片輸入框附加事件監聽器，處理圖片預覽
    imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            appState.adminImageFile = file; // 將檔案儲存到狀態中
            const reader = new FileReader();
            reader.onload = (e) => {
                // 直接更新 DOM，不觸發整個應用程式重新渲染
                if (logoPreviewImg) {
                    logoPreviewImg.src = e.target.result;
                    logoPreviewImg.classList.remove('hidden'); // 顯示圖片
                    if (logoPreviewPlaceholder) logoPreviewPlaceholder.classList.add('hidden'); // 隱藏佔位符
                }
                if (fileChosenMessage) {
                    fileChosenMessage.textContent = '已選擇檔案: ' + file.name;
                }
                appState.adminPreviewImage = e.target.result; // 更新狀態中的預覽 URL
            };
            reader.readAsDataURL(file);
        } else {
            appState.adminImageFile = null;
            // 如果沒有選擇新檔案，且是在編輯模式，則恢復舊的預覽圖；否則清空
            const defaultPreviewUrl = appState.adminEditingFlight ? (appState.adminEditingFlight.airlineLogoUrl || '') : '';
            if (logoPreviewImg) {
                logoPreviewImg.src = defaultPreviewUrl;
                if (!defaultPreviewUrl) {
                    logoPreviewImg.classList.add('hidden'); // 如果沒有預覽圖，隱藏圖片
                    if (logoPreviewPlaceholder) logoPreviewPlaceholder.classList.remove('hidden'); // 顯示佔位符
                } else {
                    logoPreviewImg.classList.remove('hidden'); // 顯示圖片
                    if (logoPreviewPlaceholder) logoPreviewPlaceholder.classList.add('hidden'); // 隱藏佔位符
                }
            }
            if (fileChosenMessage) {
                fileChosenMessage.textContent = '';
            }
            appState.adminPreviewImage = defaultPreviewUrl; // 更新狀態
        }
        // !!! 這裡不再呼叫 updateAppStateAndRender() 以避免重繪表單導致輸入內容消失 !!!
    });


    // 為表單提交附加事件監聽器
    formElement.addEventListener('submit', async (e) => {
        e.preventDefault();
        updateAppStateAndRender({ adminMessage: '' }); // 清除之前的訊息

        // 提交時，從 appState.adminCurrentFormValues 獲取數據
        const currentFormData = { ...appState.adminCurrentFormValues }; // 複製一份確保提交的是當前狀態的數據

        // 獲取時分值，並結合一個固定的日期轉換為 ISO 格式儲存
        // 檢查時間輸入是否為空，避免創建無效日期
        const departureTimeInput = currentFormData.departureTime;
        const arrivalTimeInput = currentFormData.arrivalTime;

        currentFormData.departureTime = departureTimeInput ? new Date(`2000-01-01T${departureTimeInput}:00`).toISOString() : '';
        currentFormData.arrivalTime = arrivalTimeInput ? new Date(`2000-01-01T${arrivalTimeInput}:00`).toISOString() : '';

        // 計算飛行時長
        currentFormData.flightDuration = calculateDuration(departureTimeInput, arrivalTimeInput);


        // *** 修正 LOGO URL 處理邏輯 (重要！) ***
        let finalAirlineLogoUrl = '';
        if (appState.adminImageFile) {
            // 情況 A: 有新圖片被選取，上傳它
            try {
                const storageRef = ref(storage, `airline_logos/${appState.adminImageFile.name}_${Date.now()}`);
                await uploadBytes(storageRef, appState.adminImageFile);
                finalAirlineLogoUrl = await getDownloadURL(storageRef);
                console.log("LOGO已上傳:", finalAirlineLogoUrl);
            } catch (storageError) {
                console.error("LOGO上傳失敗:", storageError);
                updateAppStateAndRender({ adminMessage: `LOGO上傳失敗: ${storageError.message}` });
                return; // 上傳失敗則停止提交
            }
        } else if (appState.adminEditingFlight && appState.adminEditingFlight.airlineLogoUrl) {
            // 情況 B: 沒有新圖片，但處於編輯模式且有舊 LOGO URL，則保留舊的
            finalAirlineLogoUrl = appState.adminEditingFlight.airlineLogoUrl;
        }
        // 情況 C: 沒有新圖片，也不是編輯模式下的舊圖片 (例如新增模式且未選圖片)，則 finalAirlineLogoUrl 保持空字串
        
        // 將最終確定的 LOGO URL 賦值給表單數據
        currentFormData.airlineLogoUrl = finalAirlineLogoUrl;


        try {
            // 執行 Firestore 操作 (更新或新增)
            if (appState.adminEditingFlight) {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/flights`, appState.adminEditingFlight.id), currentFormData);
                updateAppStateAndRender({ adminMessage: '航班已成功更新！', adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '', adminCurrentFormValues: {} });
            } else {
                await addDoc(collection(db, `artifacts/${appId}/public/data/flights`), currentFormData);
                updateAppStateAndRender({ adminMessage: '航班已成功新增！', adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '', adminCurrentFormValues: {} });
            }
        } catch (e) {
            console.error("操作航班失敗:", e);
            // 顯示更詳細的錯誤訊息給用戶
            updateAppStateAndRender({ adminMessage: `操作航班失敗: ${e.message}` });
        }
    });

    // 為取消按鈕附加事件監聽器
    formDiv.querySelector('#form-cancel-btn').addEventListener('click', () => {
        updateAppStateAndRender({ adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '', adminCurrentFormValues: {} });
    });

    return formDiv;
};

/**
 * 主要渲染函數：根據 appState 渲染整個應用程式 UI
 */
const renderApp = () => {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = ''; // 清除現有內容

    // 渲染頁首
    appContainer.appendChild(renderHeader());

    const mainContent = document.createElement('main');
    mainContent.className = "flex-grow p-6";

    // 根據載入狀態和數據初始化狀態來顯示內容
    if (appState.loading) {
        mainContent.innerHTML = `<div class="min-h-screen flex items-center justify-center text-white text-2xl">載入中...</div>`;
    } else if (appState.error) {
        mainContent.innerHTML = `<div class="min-h-screen flex items-center justify-center text-red-500 text-2xl">錯誤: ${appState.error}</div>`;
    } else if (!appState.flightsDataInitialized && appState.activeTab === 'search') {
        // 顯示訊息，直到初始航班數據載入完成
        mainContent.innerHTML = `<div class="min-h-screen flex items-center justify-center text-white text-2xl">載入航班資料中，請稍候...</div>`;
    }
    else if (appState.activeTab === 'search') {
        mainContent.appendChild(renderFlightSearch());
    } else if (appState.activeTab === 'admin') {
        if (appState.currentUser) {
            mainContent.appendChild(renderAdminPanel());
        } else {
            mainContent.appendChild(renderAuth());
        }
    }
    appContainer.appendChild(mainContent);

    // 渲染底部用戶 ID 資訊
    const footer = document.createElement('footer');
    footer.className = "w-full bg-blue-950 text-white text-xs p-2 text-center shadow-inner mt-auto";
    footer.innerHTML = `當前用戶ID: ${appState.userId || '未登入'}`;
    appContainer.appendChild(footer);
};

// --- Firebase 初始化與監聽器 ---

/**
 * 設定 Firestore 航班數據的即時監聽器
 */
let unsubscribeFlightsListener = null; // 用於儲存取消訂閱函數
const setupFlightsListener = () => {
    // 確保 userId 已有值，因為 Firestore 路徑需要它
    if (!appState.userId) {
        console.warn("未提供 userId，無法建立 Firestore 監聽器。");
        return;
    }

    // 如果已經有監聽器且是針對同一個用戶，則無需重新設定
    if (unsubscribeFlightsListener) {
        unsubscribeFlightsListener();
        unsubscribeFlightsListener = null;
        console.log("已取消先前的 Firestore 航班數據監聽器。");
    }

    const flightsCollectionRef = collection(db, `artifacts/${appId}/public/data/flights`);
    const q = query(flightsCollectionRef);

    // 建立新的即時監聽
    unsubscribeFlightsListener = onSnapshot(q, (snapshot) => {
        const flightsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log("Firestore 數據更新:", flightsData);
        // 使用 updateAppStateAndRender 觸發 UI 更新，並標記數據已初始化
        updateAppStateAndRender({ flights: flightsData, flightsDataInitialized: true });
    }, (err) => {
        console.error("監聽航班數據失敗:", err);
        updateAppStateAndRender({ error: "無法載入航班數據。", flightsDataInitialized: true }); // 即使失敗也標記為已嘗試初始化
    });
    console.log(`Firestore 航班數據監聽器已啟動 for user: ${appState.userId}`);
};


// 頁面載入完成後執行主邏輯
window.addEventListener('load', async () => {
    // 初始渲染應用程式的外殼，顯示載入中訊息
    renderApp();

    let initialAuthResolved = false; // 標記初始認證是否已處理
    let previousUserId = null; // 追蹤上一次的 userId

    // 監聽 Firebase 認證狀態變化
    onAuthStateChanged(auth, async (user) => {
        const currentUserId = user ? user.uid : null;

        // 第一次認證狀態變化時，執行初始登入邏輯
        if (!initialAuthResolved) {
            initialAuthResolved = true; // 標記為已處理
            try {
                if (initialAuthToken) {
                    try {
                        await signInWithCustomToken(auth, initialAuthToken);
                        console.log("使用自訂 token 登入成功。");
                    } catch (customTokenError) {
                        console.warn("自訂 token 登入失敗 (auth/invalid-claims 等錯誤)，嘗試匿名登入:", customTokenError);
                        await signInAnonymously(auth); // 回退到匿名登入
                        console.log("匿名登入成功 (fallback)。");
                    }
                } else {
                    await signInAnonymously(auth); // 沒有自訂 token，直接匿名登入
                    console.log("沒有自訂 token，直接匿名登入。");
                }
            } catch (e) {
                console.error("Firebase認證初始化失敗:", e);
                updateAppStateAndRender({ error: `Firebase認證初始化失敗: ${e.message}`, loading: false });
                return; // 如果認證嚴重失敗，則停止
            }
        }

        // 更新應用程式狀態
        updateAppStateAndRender({ currentUser: user, userId: currentUserId, loading: false });
        console.log(`onAuthStateChanged - 用戶ID變更：從 ${previousUserId} 到 ${currentUserId}`);

        // 判斷是否需要設定或取消 Firestore 數據監聽器
        if (currentUserId && currentUserId !== previousUserId) {
            // 用戶登入或切換，設定新的監聽器
            setupFlightsListener();
        } else if (!currentUserId && previousUserId) {
            // 用戶登出，取消監聽器
            if (unsubscribeFlightsListener) {
                unsubscribeFlightsListener();
                unsubscribeFlightsListener = null;
                console.log("Firestore 航班數據監聽器已停止。");
            }
        }
        previousUserId = currentUserId; // 更新 previousUserId 以供下次回調使用
    });
});
