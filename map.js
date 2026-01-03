/**
 * 🗺️ 悄悄話地圖 (Whisper Map) - 權重優先整合叢集版
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

const HEARTBEAT_HOUSE_COORDS = [134.1031, 34.4878]; 

const EMOTION_COLORS = {
    'LOVE':    { name: '愛',   color: '#B53435' }, 
    'CONFESS': { name: '告白', color: '#F2B134' }, 
    'WISH':    { name: '希望', color: '#267365' }, 
    'REGRET':  { name: '懊悔', color: '#1E3D59' }, 
    'SAD':     { name: '哀傷', color: '#6A8CAF' }, 
    'DAILY':   { name: '日常', color: '#8C7B75' }  
};

// 順位權重 (用於相同點數時的判斷)
const EMOTION_PRIORITY = ['LOVE', 'CONFESS', 'WISH', 'REGRET', 'SAD', 'DAILY'];

const i18n = {
    'zh': {
        postButton: 'Leave a whisper.', searchInput: 'Search by Code.',
        popupLabelDelete: '刪除貼文', searchErrorNotFound: '❌ 查無此代碼的訊息',
        adminModeOn: '✅ 管理員模式已開啟', adminModeOff: '❌ 管理員模式已關閉',
        adminPasswordError: '❌ 密碼錯誤', deleteConfirm: '請輸入密碼：',
        deleteSuccess: (code) => `貼文 ${code} 已刪除`, postFound: (code) => `✅ 找到貼文 ${code}！`,
        originalLink: 'ORIGINAL'
    },
    'en': {
        postButton: 'Leave a whisper.', searchInput: 'Search by Code.',
        popupLabelDelete: 'Delete Post', searchErrorNotFound: '❌ Message not found',
        adminModeOn: '✅ Admin mode ON.', adminModeOff: '❌ Admin mode OFF.',
        adminPasswordError: '❌ Wrong password.', deleteConfirm: 'Enter password:',
        deleteSuccess: (code) => `Post ${code} deleted.`, postFound: (code) => `✅ Post ${code} displayed!`,
        originalLink: 'Show Original'
    }
};

const GLOBE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

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
    const pulseScale = 0.4 + (breathFactor * 1.4); 

    try {
        if (map.getLayer('pulse-unclustered')) {
            map.setPaintProperty('pulse-unclustered', 'circle-opacity', opacity);
            map.setPaintProperty('pulse-unclustered', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                8, (baseRadius * 2) * pulseScale, 14, (baseRadius * 4) * pulseScale, 18, (baseRadius * 8) * pulseScale
            ]);
        }
        if (map.getLayer('pulse-cluster')) {
            map.setPaintProperty('pulse-cluster', 'circle-opacity', opacity);
            map.setPaintProperty('pulse-cluster', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                8, ['interpolate', ['linear'], ['get', 'point_count'], 5, (baseRadius * 3) * pulseScale, 10, (baseRadius * 6) * pulseScale, 20, (baseRadius * 10) * pulseScale],
                14, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 3) * pulseScale, 6, (baseRadius * 6) * pulseScale, 10, (baseRadius * 10) * pulseScale],
                18, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 3) * pulseScale, 4, (baseRadius * 6) * pulseScale, 8, (baseRadius * 10) * pulseScale]
            ]);
        }
    } catch (e) {}
    requestAnimationFrame(() => startSmoothPulsing(startTime));
}

// ==========================================
// 🚀 初始化與地圖設定
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    applyLanguage();
    map = new mapboxgl.Map({
        container: 'map-container',
        style: 'mapbox://styles/mapbox/light-v11',
        center: HEARTBEAT_HOUSE_COORDS, 
        zoom: 12,
        clickTolerance: 15 
    });

    map.on('style.load', () => {
        addMapLayers(); 
    });

    map.on('load', async () => {
        await loadWhispersFromFirebase();
        setupInteraction(); 
        handleUrlNavigation(); 
        startSmoothPulsing(Date.now());
    });
});

// ==========================================
// 🏗️ 圖層定義 (整合型叢集邏輯)
// ==========================================
function addMapLayers() {
    if (map.getSource('whispers')) return;

    // 建立單一資料源
    map.addSource('whispers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
        // 核心邏輯：計算叢集內各心情的數量
        clusterProperties: {
            'cnt_LOVE':    ['+', ['case', ['==', ['get', 'emotion'], 'LOVE'], 1, 0]],
            'cnt_CONFESS': ['+', ['case', ['==', ['get', 'emotion'], 'CONFESS'], 1, 0]],
            'cnt_WISH':    ['+', ['case', ['==', ['get', 'emotion'], 'WISH'], 1, 0]],
            'cnt_REGRET':  ['+', ['case', ['==', ['get', 'emotion'], 'REGRET'], 1, 0]],
            'cnt_SAD':     ['+', ['case', ['==', ['get', 'emotion'], 'SAD'], 1, 0]],
            'cnt_DAILY':   ['+', ['case', ['==', ['get', 'emotion'], 'DAILY'], 1, 0]]
        }
    });

    // 🏆 勝出心情顏色判斷式 (處理點數合併與順位)
    // 邏輯：檢查各心情數量，並遵守 LOVE > CONFESS > WISH > REGRET > SAD > DAILY 的順位
    const clusterColorExpression = [
        'case',
        // 優先順位檢查：如果 LOVE 數量 >= 其他所有心情，則顯示 LOVE 色，依此類推
        ['all', 
            ['>=', ['get', 'cnt_LOVE'], ['get', 'cnt_CONFESS']],
            ['>=', ['get', 'cnt_LOVE'], ['get', 'cnt_WISH']],
            ['>=', ['get', 'cnt_LOVE'], ['get', 'cnt_REGRET']],
            ['>=', ['get', 'cnt_LOVE'], ['get', 'cnt_SAD']],
            ['>=', ['get', 'cnt_LOVE'], ['get', 'cnt_DAILY']]
        ], EMOTION_COLORS['LOVE'].color,

        ['all', 
            ['>=', ['get', 'cnt_CONFESS'], ['get', 'cnt_WISH']],
            ['>=', ['get', 'cnt_CONFESS'], ['get', 'cnt_REGRET']],
            ['>=', ['get', 'cnt_CONFESS'], ['get', 'cnt_SAD']],
            ['>=', ['get', 'cnt_CONFESS'], ['get', 'cnt_DAILY']]
        ], EMOTION_COLORS['CONFESS'].color,

        ['all', 
            ['>=', ['get', 'cnt_WISH'], ['get', 'cnt_REGRET']],
            ['>=', ['get', 'cnt_WISH'], ['get', 'cnt_SAD']],
            ['>=', ['get', 'cnt_WISH'], ['get', 'cnt_DAILY']]
        ], EMOTION_COLORS['WISH'].color,

        ['all', 
            ['>=', ['get', 'cnt_REGRET'], ['get', 'cnt_SAD']],
            ['>=', ['get', 'cnt_REGRET'], ['get', 'cnt_DAILY']]
        ], EMOTION_COLORS['REGRET'].color,

        ['>=', ['get', 'cnt_SAD'], ['get', 'cnt_DAILY']], EMOTION_COLORS['SAD'].color,

        EMOTION_COLORS['DAILY'].color // 預設
    ];

    // 單點顏色判斷式
    const pointColorExpression = [
        'match', ['get', 'emotion'],
        'LOVE', EMOTION_COLORS['LOVE'].color,
        'CONFESS', EMOTION_COLORS['CONFESS'].color,
        'WISH', EMOTION_COLORS['WISH'].color,
        'REGRET', EMOTION_COLORS['REGRET'].color,
        'SAD', EMOTION_COLORS['SAD'].color,
        EMOTION_COLORS['DAILY'].color
    ];

    // 1. 叢集擴散層
    map.addLayer({
        id: 'pulse-cluster',
        type: 'circle',
        source: 'whispers',
        filter: ['has', 'point_count'],
        paint: { 'circle-color': clusterColorExpression, 'circle-opacity': 0.2, 'circle-radius': baseRadius * 3 }
    });

    // 2. 叢集核心點
    map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'whispers',
        filter: ['has', 'point_count'],
        paint: { 
            'circle-color': clusterColorExpression, 
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.8, 10, baseRadius * 1.2, 15, baseRadius * 1.2 ], 
            'circle-opacity': 0.8 
        }
    });

    // 3. 單點擴散層
    map.addLayer({
        id: 'pulse-unclustered',
        type: 'circle',
        source: 'whispers',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': pointColorExpression, 'circle-opacity': 0.3, 'circle-radius': baseRadius * 4 }
    });

    // 4. 單點核心
    map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'whispers',
        filter: ['!', ['has', 'point_count']],
        paint: { 
            'circle-color': pointColorExpression, 
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.6, 10, baseRadius * 0.8, 15, baseRadius * 1.0 ], 
            'circle-opacity': 0.8
        }
    });

    // 5. 隱形觸控層
    map.addLayer({ 
        id: 'touch-layer', 
        type: 'circle', 
        source: 'whispers', 
        paint: { 'circle-radius': 20, 'circle-opacity': 0 } 
    });

    setupLayerInteraction();
}

function setupLayerInteraction() {
    const clickableLayers = ['cluster-circles', 'points', 'touch-layer'];

    clickableLayers.forEach(layerId => {
        map.on('click', layerId, (e) => {
            const feature = e.features[0];
            const coords = feature.geometry.coordinates.slice();
            
            if (feature.properties.cluster) {
                const clusterId = feature.properties.cluster_id;
                map.getSource('whispers').getClusterExpansionZoom(clusterId, (err, zoom) => {
                    if (err) return;
                    map.easeTo({ center: coords, zoom: zoom });
                });
            } else {
                map.flyTo({ center: coords, zoom: 15 });
                closeAllPopups();
                const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
                    .setLngLat(coords)
                    .setHTML(buildPopupContent(feature.properties))
                    .addTo(map);
                activePopups.push(popup);
            }
        });

        map.on('mouseenter', layerId, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', layerId, () => map.getCanvas().style.cursor = '');
    });
}

// ==========================================
// 🛰️ URL 導航與搜尋邏輯
// ==========================================
function handleUrlNavigation() {
    const urlParams = new URLSearchParams(window.location.search);
    const postCode = urlParams.get('code');
    const lng = urlParams.get('lng');
    const lat = urlParams.get('lat');

    if (lng && lat) {
        setTimeout(() => {
            map.flyTo({ center: [parseFloat(lng), parseFloat(lat)], zoom: 16, speed: 1.2 });
            if (postCode) searchAndFlyToPost(postCode.toUpperCase());
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 800);
    } else if (postCode) {
        setTimeout(() => searchAndFlyToPost(postCode.toUpperCase()), 1000);
    }
}

async function searchAndFlyToPost(code) {
    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code.toUpperCase()));
        const snap = await window.getDocs(q);
        
        if (snap.empty) throw new Error(i18n[currentLangKey].searchErrorNotFound);
        
        const docSnap = snap.docs[0];
        const post = docSnap.data();
        const coords = [post.longitude, post.latitude];
        const emotion = (post.emotion || 'DAILY').toUpperCase();
        
        let formattedDate = '';
        if (post.createdAt) {
            const date = post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
            formattedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(date);
        }

        const formattedProps = { ...post, id: docSnap.id, emotion, createdAt: formattedDate };

        map.flyTo({ center: coords, zoom: 15, speed: 1.2 });

        map.once('moveend', () => {
            closeAllPopups();
            const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
                .setLngLat(coords)
                .setHTML(buildPopupContent(formattedProps))
                .addTo(map);
            activePopups.push(popup);
        });

        const msgEl = document.getElementById('code-search-message');
        if (msgEl) msgEl.textContent = "";

    } catch (e) { 
        const msgEl = document.getElementById('code-search-message');
        if (msgEl) msgEl.textContent = e.message; 
    }
}

// ==========================================
// 🛠️ 輔助函式與 Firebase 邏輯
// ==========================================

window.translateText = async function(textId, btnElement) {
    const textElement = document.getElementById(textId);
    if (!textElement || textElement.getAttribute('data-translating') === 'true') return;
    textElement.setAttribute('data-translating', 'true');
    const originalText = textElement.innerText;
    const originalBtnHTML = btnElement.innerHTML;
    const rawLang = navigator.language || 'zh-TW';
    let targetLang = rawLang.includes('zh') ? 'zh-TW' : rawLang.split('-')[0];
    btnElement.innerText = '...';
    try {
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(originalText)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        let translatedText = data[0].map(line => line[0]).join("");
        textElement.style.opacity = 0;
        setTimeout(() => {
            textElement.innerText = translatedText;
            textElement.style.opacity = 1;
            btnElement.innerText = i18n[currentLangKey].originalLink;
            btnElement.onclick = (e) => {
                e.stopPropagation();
                textElement.innerText = originalText;
                btnElement.innerHTML = originalBtnHTML;
                btnElement.onclick = () => window.translateText(textId, btnElement);
            };
        }, 200);
    } catch (e) { btnElement.innerHTML = originalBtnHTML; } 
    finally { textElement.removeAttribute('data-translating'); }
};

function buildPopupContent(props) {
    const emotionKey = (props.emotion || 'DAILY').toUpperCase();
    const enforcedColor = EMOTION_COLORS[emotionKey].color;
    const contentId = `content-${props.code}-${Date.now()}`;
    let displayLocation = props.locationText || '';
    if (displayLocation.includes(',')) {
        const parts = displayLocation.split(',').map(p => p.trim());
        displayLocation = parts.length >= 2 ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}` : displayLocation;
    }
    return `
        <div class="mapboxgl-popup-content is-expanded">
            <div class="emotion-popup-content-wrapper" style="border-left: 5px solid ${enforcedColor}; position: relative;">
                <div class="popup-top-right-controls" style="position: absolute; top: 10px; right: 15px; display: flex; align-items: center; gap: 10px;">
                    <span class="translate-btn-icon" onclick="window.translateText('${contentId}', this)" style="cursor: pointer; color: #999;">${GLOBE_ICON}</span>
                    ${window.isAdminMode ? `<button class="popup-delete-btn" data-id="${props.id}" data-code="${props.code}" style="background:none; border:none; color:#999; cursor:pointer;">✕</button>` : ''}
                </div>
                <div class="popup-code-label popup-top-left">${props.code}</div>
                <div class="memo-content-text" id="${contentId}">${props.content || ""}</div>
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
        
        // 更新單一資料源
        if (map.getSource('whispers')) {
            map.getSource('whispers').setData(postsToGeoJSON(allPostsData));
        }
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
            const emotion = (post.emotion || 'DAILY').toUpperCase();
            return {
                'type': 'Feature',
                'properties': { ...post, 'emotion': emotion, 'createdAt': formattedDate },
                'geometry': { 'type': 'Point', 'coordinates': [post.longitude, post.latitude] }
            };
        })
    };
}

function setupInteraction() {
    const searchForm = document.getElementById('code-search-form');
    if (searchForm) {
        searchForm.onsubmit = async (e) => {
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
    }

    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('popup-delete-btn')) {
            const docId = e.target.getAttribute('data-id');
            const postCode = e.target.getAttribute('data-code');
            if (confirm(`確定刪除貼文 ${postCode}？`)) {
                try {
                    await window.deleteDoc(window.doc(window.db, "posts", docId));
                    alert("已刪除");
                    closeAllPopups();
                    await loadWhispersFromFirebase();
                } catch (err) { console.error(err); }
            }
        }
    });
}

function applyLanguage() {
    const browserLang = (navigator.language || 'zh').substring(0, 2);
    currentLangKey = i18n[browserLang] ? browserLang : 'zh';
}
function closeAllPopups() { activePopups.forEach(p => p.remove()); activePopups = []; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopups(); 
});