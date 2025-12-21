/**
 * 🗺️ 悄悄話地圖 (Whisper Map) - 縮放同步擴散版
 * 修正：擴散半徑隨 Zoom Level 動態調整，確保視覺比例和諧
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
const defaultCenter = [134.1031, 34.4878]; 

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
// 🎨 核心：高度同步的呼吸動畫邏輯
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
    const pulseScale = 0.2 + (breathFactor * 1.2); // 呼吸時的擴張倍率

    try {
        // --- 單點擴散半徑：隨 Zoom 縮放 ---
        if (map.getLayer('unclustered-pulse')) {
            map.setPaintProperty('unclustered-pulse', 'circle-opacity', opacity);
            map.setPaintProperty('unclustered-pulse', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                10, (baseRadius * 2) * pulseScale,   // 縮小時圓圈較小
                14, (baseRadius * 10) * pulseScale,   // 一般視角
                18, (baseRadius * 20) * pulseScale   // 放大到極限時圓圈跟著變大
            ]);
        }
        
        // --- 叢集擴散半徑：隨 Zoom 與 數量 同步縮放 ---
        if (map.getLayer('clusters-pulse')) {
            map.setPaintProperty('clusters-pulse', 'circle-opacity', opacity);
            map.setPaintProperty('clusters-pulse', 'circle-radius', [
                'interpolate', ['exponential', 1.5], ['zoom'],
                10, [
                    'interpolate', ['linear'], ['get', 'point_count'],
                    5, (baseRadius * 4) * pulseScale,
                    10, (baseRadius * 10) * pulseScale,
                    20, (baseRadius * 16) * pulseScale
                ],
                14, [
                    'interpolate', ['linear'], ['get', 'point_count'],
                    2, (baseRadius * 4) * pulseScale,
                    6, (baseRadius * 10) * pulseScale,
                    10, (baseRadius * 16) * pulseScale
                ],
                18, [
                    'interpolate', ['linear'], ['get', 'point_count'],
                    2, (baseRadius * 4) * pulseScale,
                    4, (baseRadius * 10) * pulseScale,
                    8, (baseRadius * 16) * pulseScale
                ]
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

    map = new mapboxgl.Map({
        container: 'map-container',
        style: 'mapbox://styles/mapbox/light-v11',
        center: defaultCenter,
        zoom: 12
    });

    map.on('load', async () => {
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

        // 1. 叢集擴散層
        map.addLayer({
            id: 'clusters-pulse',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': colorExpr,
                'circle-opacity': 0.2,
                'circle-radius': baseRadius * 4,
                'circle-pitch-alignment': 'map' // 讓圓圈隨地圖傾斜
            }
        });

        // 2. 叢集核心點
        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': colorExpr,
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    3, baseRadius * 0.6,  // 極小縮放時
                    10, baseRadius * 0.8, // 中等縮放
                    15, baseRadius * 1.0  // 放大後
                ],
                'circle-opacity': 1,
                'circle-stroke-width': 0
            }
        });

        // 3. 單點擴散層
        map.addLayer({
            id: 'unclustered-pulse',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.3,
                'circle-radius': baseRadius * 4,
                'circle-pitch-alignment': 'map'
            }
        }, 'clusters');

        // 4. 單點核心
        map.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['get', 'color'],
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    3, baseRadius * 0.6,  // 極小縮放時
                    10, baseRadius * 0.8, // 中等縮放
                    15, baseRadius * 1.0  // 放大後
                ],
                'circle-stroke-width': 0
            }
        });

        setupInteraction();
        await loadWhispersFromFirebase();
        startSmoothPulsing(Date.now());
    });
});

// ==========================================
// 🛠️ 輔助函式 (其餘邏輯維持不變)
// ==========================================

function applyLanguage() {
    const browserLang = (navigator.language || navigator.userLanguage).substring(0, 2);
    currentLangKey = i18n[browserLang] ? browserLang : 'zh';
    const lang = i18n[currentLangKey] || i18n['en'];
    const elements = { 'leave-post-link': 'postButton', 'code-input': 'placeholder|searchInput' };
    for (const [id, val] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
            if (val.includes('|')) {
                const [attr, key] = val.split('|');
                el[attr] = lang[key];
            } else { el.textContent = lang[val]; }
        }
    }
}

function buildPopupContent(props) {
    const lang = i18n[currentLangKey] || i18n['zh'];
    const enforcedColor = props.color || EMOTION_COLORS['REGRET'].color;
    let deleteBtn = window.isAdminMode ? `<button class="popup-delete-btn" style="color:${enforcedColor}; border-color:${enforcedColor};">✕ ${lang.popupLabelDelete}</button>` : '';

    return `
        <div class="mapboxgl-popup-content is-expanded">
            <div class="emotion-popup-content-wrapper" style="border-left: 5px solid ${enforcedColor};">
                <div class="popup-code-label popup-top-left">${props.code}</div>
                <p class="popup-message-content memo-content-text">${props.content || ""}</p>
                <div class="popup-location-label popup-bottom-left">${props.locationText || ''}</div>
                <div class="popup-bottom-right">${props.createdAt || ''}</div>
                ${deleteBtn}
            </div>
        </div>
    `;
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

async function loadWhispersFromFirebase() {
    try {
        const querySnapshot = await window.getDocs(window.collection(window.db, "posts"));
        allPostsData = [];
        querySnapshot.forEach(doc => allPostsData.push({ id: doc.id, ...doc.data() }));
        if (map.getSource('emotion-posts')) map.getSource('emotion-posts').setData(postsToGeoJSON(allPostsData));
    } catch (e) { console.error(e); }
}

function setupInteraction() {
    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        map.getSource('emotion-posts').getClusterExpansionZoom(features[0].properties.cluster_id, (err, zoom) => {
            if (!err) map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    });

    map.on('click', 'unclustered-point', (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        map.flyTo({ center: coords, zoom: 15 });
        const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
            .setLngLat(coords).setHTML(buildPopupContent(props)).addTo(map);
        activePopups.push(popup);
    });

    const layers = ['clusters', 'unclustered-point'];
    layers.forEach(lyr => {
        map.on('mouseenter', lyr, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', lyr, () => map.getCanvas().style.cursor = '');
    });

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
}

async function searchAndFlyToPost(code) {
    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code.toUpperCase()));
        const snap = await window.getDocs(q);
        
        if (snap.empty) throw new Error(i18n[currentLangKey].searchErrorNotFound);
        
        const post = snap.docs[0].data();
        const coords = [post.longitude, post.latitude];

        // --- 🎯 格式化數據：確保與 postsToGeoJSON 產出的格式一致 ---
        const emotion = (post.emotion || 'REGRET').toUpperCase();
        let formattedDate = '';
        if (post.createdAt) {
            const date = post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
            formattedDate = new Intl.DateTimeFormat('en-US', { 
                month: 'short', 
                day: '2-digit', 
                year: 'numeric' 
            }).format(date);
        }

        const formattedProps = {
            ...post,
            emotion: emotion,
            color: (EMOTION_COLORS[emotion] || EMOTION_COLORS['REGRET']).color,
            createdAt: formattedDate // 將 Timestamp 物件轉為格式化字串
        };

        // --- 🚀 飛行並顯示 Popup ---
        map.flyTo({ center: coords, zoom: 15, speed: 1.2 });

        // 使用 once('moveend') 確保在飛行停止後才彈出，避免位置偏移
        map.once('moveend', () => {
            closeAllPopups(); // 顯示新彈窗前先關閉舊的
            const popup = new mapboxgl.Popup({ 
                offset: 25, 
                closeButton: false, 
                className: 'custom-memo-popup' 
            })
            .setLngLat(coords)
            .setHTML(buildPopupContent(formattedProps)) 
            .addTo(map);

            activePopups.push(popup);
        });
    } catch (e) { 
        const msgEl = document.getElementById('code-search-message');
        if (msgEl) msgEl.textContent = e.message; 
    }
}

function closeAllPopups() { activePopups.forEach(p => p.remove()); activePopups = []; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopups(); });