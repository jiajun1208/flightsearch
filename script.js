// Ensure Firebase modules are loaded globally by index.html script type="module"
const {
    initializeApp,
    getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, signOut,
    getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, query, where,
    getStorage, ref, uploadBytes, getDownloadURL
} = window.firebase;

const firebaseConfig = JSON.parse(window.__firebase_config || '{}');
const appId = window.__app_id || 'default-app-id';
const initialAuthToken = window.__initial_auth_token || null;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Global application state
const appState = {
    activeTab: 'search', // 'search' or 'admin'
    currentUser: null,
    flights: [],
    loading: true,
    error: null,
    userId: null,
    // Search form state
    searchDeparture: '',
    searchDestination: '',
    searchSelectedAirlines: [],
    filteredFlights: [],
    // Admin form state
    adminEditingFlight: null,
    adminShowForm: false,
    adminMessage: ''
};

// Updated Airline Data
const AIRLINES = [
    { name: '七岩維國家航空', id: 'QYWA' },
    { name: '南省航空', id: 'NSH' },
    { name: '大五股航空', id: 'DWG' },
    { name: '福航航空', id: 'FUH' },
    { name: '東森快運航空', id: 'ETEX' },
];

// Utility Functions
const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
};

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

const updateAppStateAndRender = (newState) => {
    Object.assign(appState, newState);
    renderApp();
};

// --- Rendering Functions ---

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

    // Attach event listeners
    header.querySelector('#nav-search').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'search' }));
    if (appState.currentUser) {
        header.querySelector('#nav-admin').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'admin' }));
        header.querySelector('#nav-logout').addEventListener('click', async () => {
            try {
                await signOut(auth);
                updateAppStateAndRender({ activeTab: 'search' }); // 登出後回到搜尋頁面
            } catch (error) {
                console.error("登出失敗:", error);
                // In a real app, use a custom modal instead of alert
                alert("登出失敗，請重試。");
            }
        });
    } else {
        header.querySelector('#nav-login').addEventListener('click', () => updateAppStateAndRender({ activeTab: 'admin' }));
    }
    return header;
};

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
        try {
            // This example uses anonymous login for simplicity.
            // For actual admin login, you'd use signInWithEmailAndPassword here.
            // For now, this just displays a message.
            messageEl.textContent = '此範例使用匿名登入。若需管理員功能，請確保使用登入用戶權限。';
        } catch (error) {
            console.error("登入錯誤:", error);
            messageEl.textContent = `登入失敗: ${error.message}`;
        }
    });
    return authDiv;
};

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

    // Attach event listeners
    const departureInput = searchDiv.querySelector('#search-departure');
    departureInput.addEventListener('input', (e) => {
        updateAppStateAndRender({ searchDeparture: e.target.value });
    });

    const destinationInput = searchDiv.querySelector('#search-destination');
    destinationInput.addEventListener('input', (e) => {
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

    // Filter flights based on current state
    let currentFiltered = appState.flights.filter(flight => {
        const matchDeparture = appState.searchDeparture === '' || flight.departure.toLowerCase().includes(appState.searchDeparture.toLowerCase());
        const matchDestination = appState.searchDestination === '' || flight.destination.toLowerCase().includes(appState.searchDestination.toLowerCase());
        const matchAirline = appState.searchSelectedAirlines.length === 0 || appState.searchSelectedAirlines.includes(flight.airlineName);
        return matchDeparture && matchDestination && matchAirline;
    });
    updateAppStateAndRender({ filteredFlights: currentFiltered }); // Update appState and re-render

    const resultsContainer = searchDiv.querySelector('#flight-results-container');
    resultsContainer.appendChild(renderFlightResults(currentFiltered));

    return searchDiv;
};

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
        // Clear message after a few seconds
        setTimeout(() => updateAppStateAndRender({ adminMessage: '' }), 5000);
    } else {
        messageContainer.innerHTML = '';
    }


    const adminContent = adminDiv.querySelector('#admin-content');

    if (!appState.adminShowForm) {
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

        // Attach event listeners for Add/Edit/Delete buttons
        adminContent.querySelector('#add-flight-btn').addEventListener('click', () => {
            updateAppStateAndRender({ adminEditingFlight: null, adminShowForm: true });
        });

        adminContent.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', () => {
                const flightId = button.dataset.id;
                const flightToEdit = appState.flights.find(f => f.id === flightId);
                updateAppStateAndRender({ adminEditingFlight: flightToEdit, adminShowForm: true });
            });
        });

        adminContent.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const flightId = button.dataset.id;
                // Using window.confirm here; replace with custom modal in production
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

    } else {
        adminContent.appendChild(renderFlightForm());
    }
    return adminDiv;
};

const renderFlightForm = () => {
    const isEditing = !!appState.adminEditingFlight;
    const flightData = isEditing ? appState.adminEditingFlight : {
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
                    <input type="datetime-local" id="form-departureTime" name="departureTime" value="${flightData.departureTime ? new Date(flightData.departureTime).toISOString().substring(0, 16) : ''}" required
                        class="w-full p-3 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label for="form-arrivalTime" class="block text-sm font-medium text-gray-700 mb-1">降落時間</label>
                    <input type="datetime-local" id="form-arrivalTime" name="arrivalTime" value="${flightData.arrivalTime ? new Date(flightData.arrivalTime).toISOString().substring(0, 16) : ''}" required
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
                    ${(flightData.airlineLogoUrl || appState.adminPreviewImage) ? `
                        <p class="text-gray-600">當前 LOGO 預覽:</p>
                        <img src="${appState.adminPreviewImage || flightData.airlineLogoUrl}" alt="Logo Preview" class="w-20 h-20 object-contain rounded-lg border border-gray-300 shadow-sm" />
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
    const logoPreviewContainer = formDiv.querySelector('#logo-preview-container');

    // Attach event listeners for form inputs and changes
    formElement.addEventListener('change', (e) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox' && name === undefined) { // Checkboxes for days don't have a name attribute
            const dayValue = e.target.value;
            let newDays = [...(flightData.availableDays || [])];
            if (checked) {
                newDays.push(dayValue);
            } else {
                newDays = newDays.filter(day => day !== dayValue);
            }
            flightData.availableDays = newDays; // Update local flightData directly for form
        } else if (name) {
            flightData[name] = value; // Update local flightData
        }
    });

    imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            appState.adminImageFile = file; // Store file globally
            const reader = new FileReader();
            reader.onload = (e) => {
                updateAppStateAndRender({ adminPreviewImage: e.target.result }); // Update preview image
            };
            reader.readAsDataURL(file);
        } else {
            appState.adminImageFile = null;
            updateAppStateAndRender({ adminPreviewImage: flightData.airlineLogoUrl || '' });
        }
    });


    formElement.addEventListener('submit', async (e) => {
        e.preventDefault();
        updateAppStateAndRender({ adminMessage: '' }); // Clear previous message

        const currentFormData = {
            departure: formDiv.querySelector('#form-departure').value,
            destination: formDiv.querySelector('#form-destination').value,
            flightDuration: formDiv.querySelector('#form-flightDuration').value,
            departureTime: formDiv.querySelector('#form-departureTime').value,
            arrivalTime: formDiv.querySelector('#form-arrivalTime').value,
            airlineName: formDiv.querySelector('#form-airlineName').value,
            airlineLogoUrl: flightData.airlineLogoUrl, // Keep existing URL unless new image uploaded
            flightNumber: formDiv.querySelector('#form-flightNumber').value,
            aircraftType: formDiv.querySelector('#form-aircraftType').value,
            availableDays: Array.from(formDiv.querySelectorAll('#days-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value),
        };

        try {
            let logoUrl = currentFormData.airlineLogoUrl;
            if (appState.adminImageFile) {
                const storageRef = ref(storage, `airline_logos/${appState.adminImageFile.name}_${Date.now()}`);
                await uploadBytes(storageRef, appState.adminImageFile);
                logoUrl = await getDownloadURL(storageRef);
                console.log("LOGO已上傳:", logoUrl);
            }
            currentFormData.airlineLogoUrl = logoUrl; // Update with new URL or retain old

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

    formDiv.querySelector('#form-cancel-btn').addEventListener('click', () => {
        updateAppStateAndRender({ adminShowForm: false, adminEditingFlight: null, adminImageFile: null, adminPreviewImage: '' });
    });

    return formDiv;
};

// Main rendering function
const renderApp = () => {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = ''; // Clear existing content

    // Render Header
    appContainer.appendChild(renderHeader());

    const mainContent = document.createElement('main');
    mainContent.className = "flex-grow p-6";

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

    // Render Footer
    const footer = document.createElement('footer');
    footer.className = "w-full bg-blue-950 text-white text-xs p-2 text-center shadow-inner mt-auto";
    footer.innerHTML = `當前用戶ID: ${appState.userId || '未登入'}`;
    appContainer.appendChild(footer);
};

// --- Firebase Initialization and Listeners ---
window.addEventListener('load', async () => {
    // Initial Firebase Auth attempt
    try {
        if (initialAuthToken) {
            try {
                await signInWithCustomToken(auth, initialAuthToken);
                console.log("使用自訂 token 登入成功。");
            } catch (customTokenError) {
                console.warn("自訂 token 登入失敗 (auth/invalid-claims 等錯誤)，嘗試匿名登入:", customTokenError);
                await signInAnonymously(auth);
                console.log("匿名登入成功 (fallback)。");
            }
        } else {
            await signInAnonymously(auth);
            console.log("沒有自訂 token，直接匿名登入。");
        }
    } catch (e) {
        console.error("Firebase認證初始化失敗:", e);
        updateAppStateAndRender({ error: `Firebase認證初始化失敗: ${e.message}` });
        return; // Stop if initial auth fails critically
    }

    // Listen to Auth State Changes
    onAuthStateChanged(auth, (user) => {
        let newUserId = null;
        if (user) {
            newUserId = user.uid;
            console.log("onAuthStateChanged: 用戶已登入:", user.uid);
        } else {
            console.log("onAuthStateChanged: 用戶已登出。");
        }
        updateAppStateAndRender({ currentUser: user, userId: newUserId, loading: false });
    });

    // Listen to Flights Collection Changes (only after userId is confirmed and not loading)
    // This listener is set up within the main render loop's effect to ensure it's re-evaluated
    // when userId or loading state changes, but should ideally be managed to avoid duplicate listeners.
    // For this direct DOM manipulation setup, we will ensure it's called once after initial load.
    // The renderApp will trigger a re-render when appState.flights changes, which is updated by onSnapshot.
    if (!appState.userId && !appState.loading) { // Initial check if we can already listen
        setupFlightsListener();
    }
});

// Separate function for setting up the Firestore listener to control its lifecycle
let unsubscribeFlightsListener = null;
const setupFlightsListener = () => {
    if (unsubscribeFlightsListener) {
        unsubscribeFlightsListener(); // Unsubscribe previous listener if exists
    }

    if (!appState.userId) { // Ensure we have a userId before trying to listen
        console.log("Waiting for userId to establish Firestore listener.");
        return;
    }

    const flightsCollectionRef = collection(db, `artifacts/${appId}/public/data/flights`);
    const q = query(flightsCollectionRef);

    unsubscribeFlightsListener = onSnapshot(q, (snapshot) => {
        const flightsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log("Firestore 數據更新:", flightsData);
        updateAppStateAndRender({ flights: flightsData }); // Update state and re-render
    }, (err) => {
        console.error("監聽航班數據失敗:", err);
        updateAppStateAndRender({ error: "無法載入航班數據。" });
    });
};

// Initial render once all scripts are loaded and Firebase state is being observed
// The first render will show "載入中..." handled by HTML, then JS takes over.
// We call renderApp after auth state is determined to show correct content.
// The onAuthStateChanged listener will call updateAppStateAndRender which triggers renderApp.

// Call setupFlightsListener once after initial load, and it will be re-evaluated
// when appState.userId changes.
window.onload = function() {
    // This ensures that the app doesn't try to render before all Firebase modules are globally available.
    // The renderApp is called by onAuthStateChanged which covers the initial loading state.
    // We explicitly call setupFlightsListener once here.
    if (appState.userId && !appState.loading) { // If auth is already resolved before onload
        setupFlightsListener();
    } else {
        // Fallback for cases where userId might not be immediately available
        // onAuthStateChanged will eventually call updateAppStateAndRender which re-triggers.
        // We ensure a listener is set once userId is ready.
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && !appState.loading) { // Ensure user is available and app is not in initial loading screen
                setupFlightsListener();
                unsubscribe(); // Only set up once
            }
        });
    }
};

