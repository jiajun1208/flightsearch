// Ensure Firebase modules are loaded globally by index.html script type="module"
const {
    initializeApp,
    getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, signOut,
    getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, query, where,
    getStorage, ref, uploadBytes, getDownloadURL
} = window.firebase;

// === 在此處填入您的 Firebase 專案設定 ===
const firebaseConfig = {
    apiKey: "AIzaSyCZSC4KP9r9Ia74gjhVM4hkhkCiXU6ltR4",
    authDomain: "avny-ccbe9.firebaseapp.com",
    databaseURL: "https://avny-ccbe9-default-rtdb.firebaseio.com",
    projectId: "avny-ccbe9",
    storageBucket: "avny-ccbe9.firebasestorage.app",
    messagingSenderId: "686829295344",
    appId: "1:686829295344:web:6ac5c87b3d5f1b70701435",
    // measurementId: "YOUR_MEASUREMENT_ID" // 如果有啟用 Google Analytics，請取消註解並填入
};

// 從 firebaseConfig 中獲取 appId
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
    loading: true, // 應用程式是否正在載入中
    error: null, // 應用程式是否有錯誤訊息
    userId: null, // 當前用戶的 Firebase UID (用於 Firestore 路徑)

    // 搜尋表單的狀態
    searchDeparture: '', // 搜尋的出發地機場
    searchDestination: '', // 搜尋的目的地機場
    searchSelectedAirlines: [], // 搜尋選中的航空公司列表

    // 管理表單的狀態
    adminEditingFlight: null, // 正在編輯的航班物件 (如果為 null 則為新增模式)
    adminShowForm: false, // 是否顯示航班新增/編輯表單
    adminMessage: '', // 管理操作的訊息 (例如: "新增成功")
    adminImageFile: null, // 用於上傳的航空公司 LOGO 檔案
    adminPreviewImage: '' // 航空公司 LOGO 的預覽 URL
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
    header.querySelector('#nav-search').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'search' }));
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
                    adminPreviewImage: ''
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
                <div id="airline-checkboxes" class="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
        </div>
        <div id="flight-results-container"></div>
    `;

    // 為搜尋欄位附加事件監聽器，當值改變時更新 appState 並觸發重新渲染
    searchDiv.querySelector('#search-departure').addEventListener('input', (e) => {
        updateAppStateAndRender({ searchDeparture: e.target.value });
    });
    searchDiv.querySelector('#search-destination').addEventListener('input', (e) => {
        updateAppStateAndRender({ searchDestination: e.target.value });
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
            updateAppStateAndRender({ searchSelectedAirlines: newSelectedAirlines });
        }
    });

    // 根據當前的 appState 進行航班過濾
    // 注意：這裡直接計算並將結果傳遞給 renderFlightResults，不觸發額外渲染
    const currentFilteredFlights = appState.flights.filter(flight => {
        const matchDeparture = appState.searchDeparture === '' || flight.departure.toLowerCase().includes(appState.searchDeparture.toLowerCase());
        const matchDestination = appState.searchDestination === '' || flight.destination.toLowerCase().includes(appState.searchDestination.toLowerCase());
        const matchAirline = appState.searchSelectedAirlines.length === 0 || appState.searchSelectedAirlines.includes(flight.airlineName);
        return matchDeparture && matchDestination && matchAirline;
    });

    // 將過濾後的結果渲染到容器中
    searchDiv.querySelector('#flight-results-container').appendChild(renderFlightResults(currentFilteredFlights));

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
                <div class="flex items-center justify-between text-xl font-bold text-blue-800 mb-2">
                    <span>${flight.departure}</span>
                    <span class="text-gray-500 mx-2 text-base">→</span>
                    <span>${flight.destination}</span>
                </div>
                <p class="text-lg text-gray-600 mb-2">
                    飛行時長: <span class="font-semibold">${flight.flightDuration}</span>
                </p>
                <p class="text-lg text-gray-600 mb-2">
                    起飛時間: <span class="font-semibold">${formatTime(flight.departureTime)}</span>
                </p>
                <p class="text-lg text-gray-600 mb-4">
                    降落時間: <span class="font-semibold">${formatTime(flight.arrivalTime)}</span>
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
            updateAppStateAndRender({ adminEditingFlight: null, adminShowForm: true, adminImageFile: null, adminPreviewImage: '' });
        });

        adminContent.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', () => {
                const flightId = button.dataset.id;
                const flightToEdit = appState.flights.find(f => f.id === flightId);
                updateAppStateAndRender({ adminEditingFlight: flightToEdit, adminShowForm: true, adminImageFile: null, adminPreviewImage: flightToEdit.airlineLogoUrl || '' });
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
    const isEditing = !!appState.adminEditingFlight;
    // 創建航班數據的副本，以便在表單中修改時不會直接影響 appState
    const flightData = isEditing ? { ...appState.adminEditingFlight } : {
        departure: '',
        destination: '',
        flightDuration: '',
        departureTime: '',
        arrivalTime: '',
        airlineName: '',
        airlineLogoUrl: '',
        flightNumber: '',
        aircraftType: '',
        availableDays: [],
    };

    // 處理日期時間格式，以適應 input type="datetime-local"
    if (flightData.departureTime) {
        flightData.departureTime = new Date(flightData.departureTime).toISOString().substring(0, 16);
    }
    if (flightData.arrivalTime) {
        flightData.arrivalTime = new Date(flightData.arrivalTime).toISOString().substring(0, 16);
    }

    const formDiv = document.createElement('div');
    formDiv.className = "bg-white p-8 rounded-2xl shadow-xl space-y-6 text-blue-900";
    formDiv.innerHTML = `
        <h3 class="text-2xl font-bold text-center mb-6">${isEditing ? '編輯航班' : '新增航班'}</h3>

        <form id="flight-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label for="form-departure" class="block text-sm font-medium text-gray-700 mb-1">出發地機場</label>
                    <input type="text" id="form-departure" name="departure" value="${flightData.departure}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-destination" class="block text-sm font-medium text-gray-700 mb-1">目的地機場</label>
                    <input type="text" id="form-destination" name="destination" value="${flightData.destination}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-flightNumber" class="block text-sm font-medium text-gray-700 mb-1">航班編號</label>
                    <input type="text" id="form-flightNumber" name="flightNumber" value="${flightData.flightNumber}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-aircraftType" class="block text-sm font-medium text-gray-700 mb-1">飛機機型</label>
                    <input type="text" id="form-aircraftType" name="aircraftType" value="${flightData.aircraftType}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                    <label for="form-departureTime" class="block text-sm font-medium text-gray-700 mb-1">起飛時間</label>
                    <input type="datetime-local" id="form-departureTime" name="departureTime" value="${flightData.departureTime}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-arrivalTime" class="block text-sm font-medium text-gray-700 mb-1">降落時間</label>
                    <input type="datetime-local" id="form-arrivalTime" name="arrivalTime" value="${flightData.arrivalTime}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-flightDuration" class="block text-sm font-medium text-gray-700 mb-1">飛行時長 (例如: 2h30m)</label>
                    <input type="text" id="form-flightDuration" name="flightDuration" value="${flightData.flightDuration}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
            </div>

            <div class="mb-4">
                <label for="form-airlineName" class="block text-sm font-medium text-gray-700 mb-1">航空公司名稱</label>
                <input type="text" id="form-airlineName" name="airlineName" value="${flightData.airlineName}" required
                    class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div class="mb-4">
                <label for="form-airlineLogo" class="block text-sm font-medium text-gray-700 mb-1">航空公司 LOGO (PNG/JPG)</label>
                <input type="file" id="form-airlineLogo" name="airlineLogo" accept=".png,.jpg,.jpeg"
                    class="w-full p-3 border border-blue-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div id="logo-preview-container" class="mt-4 flex items-center space-x-3">
                    ${(appState.adminPreviewImage) ? `
                        <p class="text-gray-600">當前 LOGO 預覽:</p>
                        <img src="${appState.adminPreviewImage}" alt="Logo Preview" class="w-20 h-20 object-contain rounded-lg border border-gray-300 shadow-sm" />
                    ` : ''}
                </div>
            </div>

            <div class="mb-6">
                <p class="block text-sm font-medium text-gray-700 mb-2">一週飛行日</p>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2" id="days-checkboxes">
                    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                        <label class="inline-flex items-center text-gray-800 cursor-pointer">
                            <input type="checkbox" value="${day}"
                                class="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500"
                                ${flightData.availableDays.includes(day) ? 'checked' : ''} />
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
                    ${isEditing ? '儲存變更' : '新增航班'}
                </button>
            </div>
        </form>
    `;

    const formElement = formDiv.querySelector('#flight-form');
    const imageInput = formDiv.querySelector('#form-airlineLogo');

    // 為圖片輸入框附加事件監聽器，處理圖片預覽
    imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            appState.adminImageFile = file; // 將檔案儲存到狀態中
            const reader = new FileReader();
            reader.onload = (e) => {
                updateAppStateAndRender({ adminPreviewImage: e.target.result }); // 更新預覽圖片 URL
            };
            reader.readAsDataURL(file);
        } else {
            appState.adminImageFile = null;
            updateAppStateAndRender({ adminPreviewImage: isEditing ? flightData.airlineLogoUrl : '' }); // 如果沒有新檔案，恢復原來的或清空
        }
    });

    // 為表單提交附加事件監聽器
    formElement.addEventListener('submit', async (e) => {
        e.preventDefault();
        updateAppStateAndRender({ adminMessage: '' }); // 清除之前的訊息

        // 從表單獲取當前數據
        const currentFormData = {
            departure: formDiv.querySelector('#form-departure').value,
            destination: formDiv.querySelector('#form-destination').value,
            flightDuration: formDiv.querySelector('#form-flightDuration').value,
            departureTime: formDiv.querySelector('#form-departureTime').value,
            arrivalTime: formDiv.querySelector('#form-arrivalTime').value,
            airlineName: formDiv.querySelector('#form-airlineName').value,
            // 如果沒有新圖片，保留原有的 URL，否則會被上傳邏輯覆蓋
            airlineLogoUrl: isEditing ? (appState.adminEditingFlight.airlineLogoUrl || '') : '',
            flightNumber: formDiv.querySelector('#form-flightNumber').value,
            aircraftType: formDiv.querySelector('#form-aircraftType').value,
            availableDays: Array.from(formDiv.querySelectorAll('#days-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value),
        };

        try {
            // 如果有新圖片檔案，則上傳並獲取 URL
            if (appState.adminImageFile) {
                const storageRef = ref(storage, `airline_logos/${appState.adminImageFile.name}_${Date.now()}`);
                await uploadBytes(storageRef, appState.adminImageFile);
                currentFormData.airlineLogoUrl = await getDownloadURL(storageRef);
                console.log("LOGO已上傳:", currentFormData.airlineLogoUrl);
            }

            // 執行 Firestore 操作 (更新或新增)
            if (isEditing) {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/flights`, appState.adminEditingFlight.id), currentFormData);
                updateAppStateAndRender({ adminMessage: '航班已成功更新！', adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '' });
            } else {
                await addDoc(collection(db, `artifacts/${appId}/public/data/flights`), currentFormData);
                updateAppStateAndRender({ adminMessage: '航班已成功新增！', adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '' });
            }
        } catch (e) {
            console.error("操作航班失敗:", e);
            updateAppStateAndRender({ adminMessage: `操作航班失敗: ${e.message}` });
        }
    });

    // 為取消按鈕附加事件監聽器
    formDiv.querySelector('#form-cancel-btn').addEventListener('click', () => {
        updateAppStateAndRender({ adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '' });
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

    // 根據 activeTab 渲染主要內容區域
    if (appState.activeTab === 'search') {
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
    // 這裡我們假設每次 userId 變化都會觸發取消訂閱，所以可以直接設定
    if (unsubscribeFlightsListener) {
        // 如果此時已經有監聽器，表示在 userId 變更時，前一個沒有被正確取消
        // 這是為了防止極端情況下的重複監聽，但主要邏輯應確保正確的生命週期管理
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
        // 使用 updateAppStateAndRender 觸發 UI 更新
        updateAppStateAndRender({ flights: flightsData });
    }, (err) => {
        console.error("監聽航班數據失敗:", err);
        updateAppStateAndRender({ error: "無法載入航班數據。" });
    });
    console.log(`Firestore 航班數據監聽器已啟動 for user: ${appState.userId}`);
};


// 頁面載入完成後執行主邏輯
window.addEventListener('load', async () => {
    // 初始渲染應用程式的外殼，顯示載入中訊息
    // 這一步很重要，確保用戶在 Firebase 載入期間看到內容
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
