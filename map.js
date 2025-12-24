/**
 * 🗺️ 悄悄話地圖 (Whisper Map) - 同色優先叢集版
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
    'LOVE':     { name: '愛',   color: '#8e354a' }, // 蘇芳色 (深紅)
    'GRATEFUL': { name: '感謝', color: '#c7a252' }, // 舊金色
    'WISH':     { name: '希望', color: '#557c7c' }, // 藍綠青
    'REGRET':   { name: '懊悔', color: '#5b644d' }, // 橄欖綠灰
    'SAD':      { name: '哀傷', color: '#3e4e6c' }  // 影青色 (深藍)
};

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
// 🎨 核心：呼吸動畫邏輯 (適應多心情圖層)
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
        Object.keys(EMOTION_COLORS).forEach(e => {
            const unclusteredPulse = `pulse-unclustered-${e}`;
            const clusterPulse = `pulse-cluster-${e}`;

            if (map.getLayer(unclusteredPulse)) {
                map.setPaintProperty(unclusteredPulse, 'circle-opacity', opacity);
                map.setPaintProperty(unclusteredPulse, 'circle-radius', [
                    'interpolate', ['exponential', 1.5], ['zoom'],
                    10, (baseRadius * 2) * pulseScale, 14, (baseRadius * 10) * pulseScale, 18, (baseRadius * 20) * pulseScale
                ]);
            }
            if (map.getLayer(clusterPulse)) {
                map.setPaintProperty(clusterPulse, 'circle-opacity', opacity);
                map.setPaintProperty(clusterPulse, 'circle-radius', [
                    'interpolate', ['exponential', 1.5], ['zoom'],
                    10, ['interpolate', ['linear'], ['get', 'point_count'], 5, (baseRadius * 4) * pulseScale, 10, (baseRadius * 10) * pulseScale, 20, (baseRadius * 16) * pulseScale],
                    14, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 4) * pulseScale, 6, (baseRadius * 10) * pulseScale, 10, (baseRadius * 16) * pulseScale],
                    18, ['interpolate', ['linear'], ['get', 'point_count'], 2, (baseRadius * 4) * pulseScale, 4, (baseRadius * 10) * pulseScale, 8, (baseRadius * 16) * pulseScale]
                ]);
            }
        });
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
        handleUrlNavigation(); 
        startSmoothPulsing(Date.now());
    });
});

// ==========================================
// 🏗️ 圖層定義 (依心情拆分 Source 以達成同色叢集)
// ==========================================
function addMapLayers() {
    Object.keys(EMOTION_COLORS).forEach(e => {
        const sourceId = `source-${e}`;
        const color = EMOTION_COLORS[e].color;

        if (map.getSource(sourceId)) return;

        // 為每一種心情建立獨立資料源
        map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 40 
        });

        // 1. 叢集擴散層
        map.addLayer({
            id: `pulse-cluster-${e}`,
            type: 'circle',
            source: sourceId,
            filter: ['has', 'point_count'],
            paint: { 'circle-color': color, 'circle-opacity': 0.2, 'circle-radius': baseRadius * 4, 'circle-pitch-alignment': 'map' }
        });

        // 2. 叢集核心點
        map.addLayer({
            id: `cluster-${e}`,
            type: 'circle',
            source: sourceId,
            filter: ['has', 'point_count'],
            paint: { 
                'circle-color': color, 
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.6, 10, baseRadius * 0.8, 15, baseRadius * 1.0 ], 
                'circle-opacity': 0.7 
            }
        });

        // 3. 單點擴散層
        map.addLayer({
            id: `pulse-unclustered-${e}`,
            type: 'circle',
            source: sourceId,
            filter: ['!', ['has', 'point_count']],
            paint: { 'circle-color': color, 'circle-opacity': 0.3, 'circle-radius': baseRadius * 4, 'circle-pitch-alignment': 'map' }
        });

        // 4. 單點核心
        map.addLayer({
            id: `point-${e}`,
            type: 'circle',
            source: sourceId,
            filter: ['!', ['has', 'point_count']],
            paint: { 
                'circle-color': color, 
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, baseRadius * 0.6, 10, baseRadius * 0.8, 15, baseRadius * 1.0 ], 
                'circle-opacity': 0.7
            }
        });

        // 5. 隱形觸控層
        map.addLayer({ 
            id: `touch-${e}`, 
            type: 'circle', 
            source: sourceId, 
            filter: ['!', ['has', 'point_count']], 
            paint: { 'circle-radius': 25, 'circle-opacity': 0 } 
        });

        // 綁定互動
        setupLayerInteraction(e);
    });
}

function setupLayerInteraction(emotionKey) {
    const clickableLayers = [`cluster-${emotionKey}`, `point-${emotionKey}`, `touch-${emotionKey}`];

    clickableLayers.forEach(layerId => {
        map.on('click', layerId, (e) => {
            const feature = e.features[0];
            const coords = feature.geometry.coordinates.slice();
            
            if (feature.properties.cluster) {
                // 叢集點擊：放大
                const clusterId = feature.properties.cluster_id;
                map.getSource(`source-${emotionKey}`).getClusterExpansionZoom(clusterId, (err, zoom) => {
                    if (err) return;
                    map.easeTo({ center: coords, zoom: zoom });
                });
            } else {
                // 單點點擊：顯示彈窗
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
// 🛰️ URL 導航邏輯
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
    } else {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 }),
                (err) => console.warn("GPS Off")
            );
        }
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
            btnElement.style.fontSize = "10px";
            btnElement.onclick = (e) => {
                e.stopPropagation();
                textElement.innerText = originalText;
                btnElement.innerHTML = originalBtnHTML;
                btnElement.style.fontSize = "";
                btnElement.onclick = () => window.translateText(textId, btnElement);
            };
        }, 200);
    } catch (e) { btnElement.innerHTML = originalBtnHTML; } 
    finally { textElement.removeAttribute('data-translating'); }
};

function buildPopupContent(props) {
    const emotionKey = (props.emotion || 'REGRET').toUpperCase();
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
        
        // 將資料分派給各個心情的 Source
        Object.keys(EMOTION_COLORS).forEach(e => {
            const filtered = allPostsData.filter(p => (p.emotion || 'REGRET').toUpperCase() === e);
            const sourceId = `source-${e}`;
            if (map.getSource(sourceId)) {
                map.getSource(sourceId).setData(postsToGeoJSON(filtered));
            }
        });
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
                'properties': { ...post, 'emotion': emotion, 'createdAt': formattedDate },
                'geometry': { 'type': 'Point', 'coordinates': [post.longitude, post.latitude] }
            };
        })
    };
}

function setupInteraction() {
    // 搜尋表單邏輯
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

    // 刪除按鈕 (事件代理)
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

async function searchAndFlyToPost(code) {
    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code.toUpperCase()));
        const snap = await window.getDocs(q);
        if (snap.empty) throw new Error(i18n[currentLangKey].searchErrorNotFound);
        const docSnap = snap.docs[0];
        const post = docSnap.data();
        const coords = [post.longitude, post.latitude];
        const emotion = (post.emotion || 'REGRET').toUpperCase();
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
                .setLngLat(coords).setHTML(buildPopupContent(formattedProps)).addTo(map);
            activePopups.push(popup);
        });
    } catch (e) { 
        const msgEl = document.getElementById('code-search-message');
        if (msgEl) msgEl.textContent = e.message; 
    }
}

function applyLanguage() {
    const browserLang = (navigator.language || 'zh').substring(0, 2);
    currentLangKey = i18n[browserLang] ? browserLang : 'zh';
}
function closeAllPopups() { activePopups.forEach(p => p.remove()); activePopups = []; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopups(); });