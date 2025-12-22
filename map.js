/**
 * 🗺️ 悄悄話地圖 (Whisper Map) - 完整整合版
 * 功能：
 * 1. 初始定位：優先抓取 GPS，失敗則定位至「心臟音小屋」。
 * 2. 呼吸動畫：擴散半徑隨 Zoom Level 動態調整。
 * 3. 貼文功能：包含搜尋、發文後自動飛行、管理員刪除模式。
 * 4. 置中優化：短貼文置中，長貼文正常捲動。
 */

mapboxgl.accessToken = 'pk.eyJ1IjoiOWVvcmdlIiwiYSI6ImNtaXBoeGs5MzAxN3MzZ29pbGpsaTlwdTgifQ.ZUihSP9R0IYw7780nrJ0sA'; 

let map = null;
let activePopups = []; 
let allPostsData = []; 
let currentLangKey = 'zh'; 
window.isAdminMode = false;

const ADMIN_PASSWORD = 'joislove'; 
const ADMIN_KEY = 'IMRIGHT';    
const baseRadius = 4; 

// 📍 定義心臟音小屋的座標 (預備位置)
const HEARTBEAT_HOUSE_COORDS = [134.1031, 34.4878]; 

const EMOTION_COLORS = {
    'LOVE': { name: '愛', color: '#b43a22' },
    'GRATEFUL': { name: '感謝', color: '#e6ae25' },
    'WISH': { name: '希望', color: '#dcceb3' },
    'REGRET': { name: '懊悔', color: '#838931' },
    'SAD': { name: '哀傷', color: '#41548f' }
};

const i18n = {
    'zh': {
        postButton: 'Leave a whisper.', searchInput: 'Search by Code.',
        popupLabelDelete: '刪除貼文', searchErrorNotFound: '❌ 查無此代碼的訊息',
        adminModeOn: '✅ 管理員模式已開啟', adminModeOff: '❌ 管理員模式已關閉',
        adminPasswordError: '❌ 密碼錯誤', deleteConfirm: '請輸入密碼：',
        deleteSuccess: (code) => `貼文 ${code} 已刪除`, postFound: (code) => `✅ 找到貼文 ${code}！`,
    },
    'en': {
        postButton: 'Leave a whisper.', searchInput: 'Search by Code.',
        popupLabelDelete: 'Delete Post', searchErrorNotFound: '❌ Message not found',
        adminModeOn: '✅ Admin mode ON.', adminModeOff: '❌ Admin mode OFF.',
        adminPasswordError: '❌ Wrong password.', deleteConfirm: 'Enter password:',
        deleteSuccess: (code) => `Post ${code} deleted.`, postFound: (code) => `✅ Post ${code} displayed!`,
    }
};

// ==========================================
// 🎨 核心：呼吸動畫邏輯
// ==========================================
function startSmoothPulsing(startTime) {
    if (!map || !map.isStyleLoaded()) {
        requestAnimationFrame(() => startSmoothPulsing(startTime));
        return;
    }
    
    const duration = 4500; 
    const elapsed = Date.now() - startTime;
    const progress = (elapsed % duration) / duration;

    const breathFactor = Math.sin(progress * Math.PI); 
    const opacity = (1 - progress) * 0.4;
    const pulseScale = 0.2 + (breathFactor * 1.2); 

    try {
        if (map.getLayer('unclustered-pulse')) {
            map.setPaintProperty('unclustered-pulse', 'circle-opacity', opacity);
            map.setPaintProperty('unclustered-pulse', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                10, (baseRadius * 2) * pulseScale,
                14, (baseRadius * 10) * pulseScale,
                18, (baseRadius * 20) * pulseScale
            ]);
        }
        
        if (map.getLayer('clusters-pulse')) {
            map.setPaintProperty('clusters-pulse', 'circle-opacity', opacity);
            map.setPaintProperty('clusters-pulse', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                10, ['interpolate', ['linear'], ['get', 'point_count'], 5, (baseRadius * 4) * pulseScale, 10, (baseRadius * 10) * pulseScale, 20, (baseRadius * 16) * pulseScale],
                14, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 4) * pulseScale, 6, (baseRadius * 10) * pulseScale, 10, (baseRadius * 16) * pulseScale],
                18, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 4) * pulseScale, 4, (baseRadius * 10) * pulseScale, 8, (baseRadius * 16) * pulseScale]
            ]);
        }
    } catch (e) {}

    requestAnimationFrame(() => startSmoothPulsing(startTime));
}

// ==========================================
// 🚀 核心初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    applyLanguage();

    // 1. 先以心臟音小屋為預設中心初始化地圖
    map = new mapboxgl.Map({
        container: 'map-container',
        style: 'mapbox://styles/mapbox/light-v11',
        center: HEARTBEAT_HOUSE_COORDS, 
        zoom: 12
    });

    // 2. 執行 GPS 定位偵測 (不顯示小藍點，僅移動地圖)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userCoords = [position.coords.longitude, position.coords.latitude];
                console.log("📍 GPS 定位成功，準備飛往使用者位置");
                map.flyTo({ center: userCoords, zoom: 14, speed: 0.8 });
            },
            (err) => {
                console.warn("⚠️ GPS 無法取用，停留在心臟音小屋:", err.message);
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    map.on('load', async () => {
        // 設定叢集屬性
        const clusterProps = {};
        Object.keys(EMOTION_COLORS).forEach(e => {
            clusterProps[`count_${e}`] = ['+', ['case', ['==', ['get', 'emotion'], e], 1, 0]];
        });

        map.addSource('emotion-posts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 40,
            clusterProperties: clusterProps
        });

        const colorExpr = [
            'case',
            ['all', ['>=', ['get', 'count_LOVE'], ['get', 'count_GRATEFUL']], ['>=', ['get', 'count_LOVE'], ['get', 'count_WISH']], ['>=', ['get', 'count_LOVE'], ['get', 'count_REGRET']], ['>=', ['get', 'count_LOVE'], ['get', 'count_SAD']]], EMOTION_COLORS.LOVE.color,
            ['all', ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_WISH']], ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_REGRET']], ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_SAD']]], EMOTION_COLORS.GRATEFUL.color,
            ['all', ['>=', ['get', 'count_WISH'], ['get', 'count_REGRET']], ['>=', ['get', 'count_WISH'], ['get', 'count_SAD']]], EMOTION_COLORS.WISH.color,
            ['>=', ['get', 'count_REGRET'], ['get', 'count_SAD']], EMOTION_COLORS.REGRET.color,
            EMOTION_COLORS.SAD.color
        ];

        // 層級設定 (脈動與點)
        map.addLayer({ id: 'clusters-pulse', type: 'circle', source: 'emotion-posts', filter: ['has', 'point_count'], paint: { 'circle-color': colorExpr, 'circle-opacity': 0.2, 'circle-radius': baseRadius * 4, 'circle-pitch-alignment': 'map' }});
        map.addLayer({ id: 'clusters', type: 'circle', source: 'emotion-posts', filter: ['has', 'point_count'], paint: { 'circle-color': colorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.6, 10, baseRadius * 0.8, 15, baseRadius * 1.0 ], 'circle-opacity': 1, 'circle-stroke-width': 0 }});
        map.addLayer({ id: 'unclustered-pulse', type: 'circle', source: 'emotion-posts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.3, 'circle-radius': baseRadius * 4, 'circle-pitch-alignment': 'map' }}, 'clusters');
        map.addLayer({ id: 'unclustered-point', type: 'circle', source: 'emotion-posts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.6, 10, baseRadius * 0.8, 15, baseRadius * 1.0 ], 'circle-stroke-width': 0 }});

        setupInteraction();
        await loadWhispersFromFirebase();

        // 偵測網址是否有發文代碼 (發文後跳轉回來)
        const urlParams = new URLSearchParams(window.location.search);
        const postCode = urlParams.get('code');
        if (postCode) {
            setTimeout(() => {
                searchAndFlyToPost(postCode.toUpperCase());
                window.history.replaceState({}, document.title, window.location.pathname);
            }, 1000);
        }

        startSmoothPulsing(Date.now());
    });
});

// ==========================================
// 🛠️ 輔助函式
// ==========================================

function buildPopupContent(props) {
    const lang = i18n[currentLangKey] || i18n['zh'];
    const enforcedColor = props.color || EMOTION_COLORS['REGRET'].color;
    
    // ✨ 管理員刪除按鈕 (✕)
    let deleteBtn = window.isAdminMode
        ? `<button class="popup-delete-btn" data-id="${props.id}" data-code="${props.code}">✕</button>`
        : '';

    let displayLocation = props.locationText || '';
    if (displayLocation.includes(',')) {
        const parts = displayLocation.split(',').map(p => p.trim());
        if (parts.length >= 2) {
            displayLocation = `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
        }
    }

    return `
        <div class="mapboxgl-popup-content is-expanded">
            <div class="emotion-popup-content-wrapper" style="border-left: 5px solid ${enforcedColor}; position: relative;">
                ${deleteBtn}
                <div class="popup-code-label popup-top-left">${props.code}</div>
                <div class="memo-content-text">${props.content || ""}</div>
                <div class="popup-location-label popup-bottom-left">${displayLocation}</div>
                <div class="popup-bottom-right">${props.createdAt || ''}</div>
            </div>
        </div>
    `;
}

async function loadWhispersFromFirebase() {
    try {
        const querySnapshot = await window.getDocs(window.collection(window.db, "posts"));
        allPostsData = [];
        querySnapshot.forEach(doc => allPostsData.push({ id: doc.id, ...doc.data() }));
        if (map.getSource('emotion-posts')) map.getSource('emotion-posts').setData(postsToGeoJSON(allPostsData));
    } catch (e) { console.error(e); }
}

function postsToGeoJSON(posts) {
    return {
        'type': 'FeatureCollection',
        'features': posts.map(post => {
            let formattedDate = '';
            if (post.createdAt) {
                const date = post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
                formattedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(date);
            }
            const emotion = (post.emotion || 'REGRET').toUpperCase();
            return {
                'type': 'Feature',
                'properties': { ...post, 'color': (EMOTION_COLORS[emotion] || EMOTION_COLORS['REGRET']).color, 'emotion': emotion, 'createdAt': formattedDate },
                'geometry': { 'type': 'Point', 'coordinates': [post.longitude, post.latitude] }
            };
        })
    };
}

function setupInteraction() {
    // 點擊事件
    const handlePointClick = (e) => {
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates.slice();
        map.flyTo({ center: coords, zoom: 15 });
        closeAllPopups();
        const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
            .setLngLat(coords).setHTML(buildPopupContent(props)).addTo(map);
        activePopups.push(popup);
    };

    map.on('click', 'unclustered-point', handlePointClick);
    map.on('click', 'clusters', handlePointClick);

    // 管理員刪除按鈕 (事件代理)
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('popup-delete-btn')) {
            const docId = e.target.getAttribute('data-id');
            const postCode = e.target.getAttribute('data-code');
            if (confirm(`確定要刪除貼文 ${postCode} 嗎？`)) {
                try {
                    await window.deleteDoc(window.doc(window.db, "posts", docId));
                    alert("已刪除貼文");
                    closeAllPopups();
                    await loadWhispersFromFirebase();
                } catch (err) { console.error(err); }
            }
        }
    });

    // 搜尋功能
    document.getElementById('code-search-form').onsubmit = async (e) => {
        e.preventDefault();
        const input = document.getElementById('code-input');
        const val = input.value.trim().toUpperCase();
        if (val === ADMIN_KEY) {
            const pw = prompt(i18n[currentLangKey].deleteConfirm);
            if (pw === ADMIN_PASSWORD) {
                window.isAdminMode = !window.isAdminMode;
                document.getElementById('code-search-message').textContent = window.isAdminMode ? i18n[currentLangKey].adminModeOn : i18n[currentLangKey].adminModeOff;
            }
            input.value = ''; return;
        }
        await searchAndFlyToPost(val);
        input.value = '';
    };

    // 滑鼠游標
    ['clusters', 'unclustered-point'].forEach(lyr => {
        map.on('mouseenter', lyr, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', lyr, () => map.getCanvas().style.cursor = '');
    });
}

async function searchAndFlyToPost(code) {
    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code.toUpperCase()));
        const snap = await window.getDocs(q);
        if (snap.empty) throw new Error(i18n[currentLangKey].searchErrorNotFound);
        
        const post = snap.docs[0].data();
        const coords = [post.longitude, post.latitude];
        const emotion = (post.emotion || 'REGRET').toUpperCase();
        let formattedDate = '';
        if (post.createdAt) {
            const date = post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
            formattedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(date);
        }

        const formattedProps = { ...post, id: snap.docs[0].id, emotion, color: (EMOTION_COLORS[emotion] || EMOTION_COLORS['REGRET']).color, createdAt: formattedDate };

        map.flyTo({ center: coords, zoom: 15, speed: 1.2 });
        map.once('moveend', () => {
            closeAllPopups();
            const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
                .setLngLat(coords).setHTML(buildPopupContent(formattedProps)).addTo(map);
            activePopups.push(popup);
        });
    } catch (e) { 
        const msgEl = document.getElementById('code-search-message');
        if (msgEl) msgEl.textContent = e.message; 
    }
}

function applyLanguage() {
    const browserLang = (navigator.language || navigator.userLanguage).substring(0, 2);
    currentLangKey = i18n[browserLang] ? browserLang : 'zh';
}

function closeAllPopups() { activePopups.forEach(p => p.remove()); activePopups = []; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopups(); 
});