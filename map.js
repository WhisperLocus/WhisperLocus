/**
 * 🗺️ 悄悄話地圖 (Whisper Map) - 擴散動畫版
 * 功能：Firebase 實時同步、叢集擴散呼吸效果、無數字設計
 */

// ==========================================
// 🎯 1. 全局配置與狀態管理
// ==========================================
mapboxgl.accessToken = 'pk.eyJ1IjoiOWVvcmdlIiwiYSI6ImNtaXBoeGs5MzAxN3MzZ29pbGpsaTlwdTgifQ.ZUihSP9R0IYw7780nrJ0sA'; 

let map = null;
let activePopups = []; 
let allPostsData = []; 
let currentLangKey = 'zh'; 
window.isAdminMode = false;

const ADMIN_PASSWORD = 'joislove'; 
const ADMIN_KEY = 'IMRIGHT';    
const baseRadius = 5; // 🎯 統一核心半徑
const defaultCenter = [134.1031, 34.4878]; // 豐島中心點

const EMOTION_COLORS = {
    'LOVE': { name: '愛', color: '#b43a22' },
    'GRATEFUL': { name: '感謝', color: '#e6ae25' },
    'WISH': { name: '希望', color: '#dcceb3' },
    'REGRET': { name: '懊悔', color: '#838931' },
    'SAD': { name: '哀傷', color: '#41548f' }
};

// ==========================================
// 🌍 2. 多國語言字典 (i18n)
// ==========================================
const i18n = {
    'zh': {
        postButton: 'Leave a whisper.',
        searchInput: 'Search by Code.',
        
        popupLabelDelete: '刪除貼文',
        searchErrorNotFound: '❌ 查無此代碼的訊息',
        adminModeOn: '✅ 管理員模式已開啟',
        adminModeOff: '❌ 管理員模式已關閉',
        adminPasswordError: '❌ 密碼錯誤',
        deleteConfirm: '請輸入密碼：',
        deleteSuccess: (code) => `貼文 ${code} 已刪除`,
        deleteFailAlert: (error) => `刪除失敗：${error.message}`,
        postFound: (code) => `✅ 找到貼文 ${code}！`,
    },
    'en': {
        postButton: 'Leave a whisper.',
        searchInput: 'Search by Code.',
        
        popupLabelDelete: 'Delete Post',
        searchErrorNotFound: '❌ Message not found',
        adminModeOn: '✅ Admin mode ON.',
        adminModeOff: '❌ Admin mode OFF.',
        adminPasswordError: '❌ Wrong password.',
        deleteConfirm: 'Enter password:',
        deleteSuccess: (code) => `Post ${code} deleted.`,
        deleteFailAlert: (error) => `Failed: ${error.message}`,
        postFound: (code) => `✅ Post ${code} displayed!`,
    }
};

// ==========================================
// 🛠️ 3. 核心功能函數
// ==========================================

function applyLanguage() {
    const browserLang = (navigator.language || navigator.userLanguage).substring(0, 2);
    currentLangKey = i18n[browserLang] ? browserLang : 'zh';
    const lang = i18n[currentLangKey] || i18n['en'];

    const elements = {
        'leave-post-link': 'postButton',
        'code-input': 'placeholder|searchInput',
        'code-search-message': 'searchMessageDefault'
    };

    for (const [id, val] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) {
            if (val.includes('|')) {
                const [attr, key] = val.split('|');
                el[attr] = lang[key];
            } else {
                el.textContent = lang[val];
            }
        }
    }
}

function buildPopupContent(props) {
    const lang = i18n[currentLangKey] || i18n['zh'];
    const enforcedColor = props.color || EMOTION_COLORS['REGRET'].color;
    const content = props.content || "";
    
    const isShortText = content.length < 40 && (content.match(/\n/g) || []).length < 2;
    const centerClass = isShortText ? 'is-centered-text' : '';

    let deleteBtn = '';
    if (window.isAdminMode) {
        deleteBtn = `<button class="popup-delete-btn" style="color:${enforcedColor}; border-color:${enforcedColor};">✕ ${lang.popupLabelDelete}</button>`;
    }

    return `
        <div class="mapboxgl-popup-content is-expanded ${centerClass}">
            <div class="emotion-popup-content-wrapper" style="border-left: 5px solid ${enforcedColor};">
                <div class="popup-code-label popup-top-left">${props.code}</div>
                <p class="popup-message-content memo-content-text">${content}</p>
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
            const color = (EMOTION_COLORS[emotion] || EMOTION_COLORS['REGRET']).color;

            return {
                'type': 'Feature',
                'properties': { ...post, 'color': color, 'emotion': emotion, 'createdAt': formattedDate },
                'geometry': { 'type': 'Point', 'coordinates': [post.longitude, post.latitude] }
            };
        })
    };
}

function closeAllPopups() {
    activePopups.forEach(p => p.remove());
    activePopups = [];
}

// ==========================================
// 🔄 4. 數據與搜尋邏輯 (Firebase)
// ==========================================

async function loadWhispersFromFirebase() {
    try {
        const querySnapshot = await window.getDocs(window.collection(window.db, "posts"));
        allPostsData = [];
        querySnapshot.forEach(doc => allPostsData.push({ id: doc.id, ...doc.data() }));
        
        const geojson = postsToGeoJSON(allPostsData);
        if (map.getSource('emotion-posts')) {
            map.getSource('emotion-posts').setData(geojson);
        }
    } catch (e) {
        console.error("Firebase Load Error:", e);
    }
}

async function searchAndFlyToPost(code, showMessage = true) {
    const lang = i18n[currentLangKey] || i18n['zh'];
    const msgEl = document.getElementById('code-search-message');
    if (showMessage) msgEl.textContent = 'Searching...';

    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code.toUpperCase()));
        const snap = await window.getDocs(q);

        if (snap.empty) throw new Error(lang.searchErrorNotFound);

        const post = { id: snap.docs[0].id, ...snap.docs[0].data() };
        const coords = [post.longitude, post.latitude];

        map.flyTo({ center: coords, zoom: 15, speed: 1.2 });

        setTimeout(() => {
            closeAllPopups();
            const geojsonProps = postsToGeoJSON([post]).features[0].properties;
            const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
                .setLngLat(coords)
                .setHTML(buildPopupContent(geojsonProps))
                .addTo(map);

            activePopups.push(popup);
            if (showMessage) msgEl.textContent = lang.postFound(code);
        }, 1200);

    } catch (e) {
        if (showMessage) msgEl.textContent = e.message;
    }
}

async function deletePost(code, popup) {
    const lang = i18n[currentLangKey] || i18n['zh'];
    const secret = prompt(lang.deleteConfirm);
    if (secret !== ADMIN_PASSWORD) return alert(lang.adminPasswordError);

    try {
        const q = window.query(window.collection(window.db, "posts"), window.where("code", "==", code));
        const snap = await window.getDocs(q);
        if (!snap.empty) {
            await window.deleteDoc(window.doc(window.db, "posts", snap.docs[0].id));
            if (popup) popup.remove();
            alert(lang.deleteSuccess(code));
            loadWhispersFromFirebase();
        }
    } catch (e) {
        alert(lang.deleteFailAlert(e));
    }
}

// ==========================================
// 🎨 5. 呼吸動畫邏輯
// ==========================================

function startSmoothPulsing(startTime) {
    if (!map) return;
    
    // 呼吸週期：4秒一次
    const duration = 4000;
    const elapsed = Date.now() - startTime;
    const progress = (elapsed % duration) / duration;

    // 使用正弦函數創造平滑的呼吸感 (0 -> 1 -> 0)
    const breathFactor = Math.sin(progress * Math.PI); 
    
    // 1. 透明度呼吸：在 0.15 到 0.5 之間波動
    const opacity = 0.15 + (breathFactor * 0.35);
    
    // 2. 半徑呼吸：在基礎倍率上微調 (+20% 的動態擴張)
    const radiusMultiplier = 1.0 + (breathFactor * 0.2);

    if (map.getLayer('unclustered-pulse')) {
        map.setPaintProperty('unclustered-pulse', 'circle-opacity', opacity);
        map.setPaintProperty('unclustered-pulse', 'circle-radius', baseRadius * 4 * radiusMultiplier);
    }
    
    if (map.getLayer('clusters-pulse')) {
        map.setPaintProperty('clusters-pulse', 'circle-opacity', opacity);
        // 叢集半徑已經由 point_count 表達式決定，這裡套用呼吸倍率
        // 注意：這裡直接套用屬性會覆蓋 addLayer 的表達式，
        // 所以我們在動畫中保持半徑表達式邏輯，僅改變透明度是最穩定的做法。
        // 如果要動態改半徑，需重新傳入整個 Expression。
    }

    requestAnimationFrame(() => startSmoothPulsing(startTime));
}

// ==========================================
// 🚀 6. 初始化地圖與圖層
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
        // --- 1. 定義 Cluster 屬性 (情緒統計) ---
        const clusterProps = {};
        Object.keys(EMOTION_COLORS).forEach(e => {
            clusterProps[`count_${e}`] = ['+', ['case', ['==', ['get', 'emotion'], e], 1, 0]];
        });

        map.addSource('emotion-posts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 50,
            clusterProperties: clusterProps
        });

        // --- 2. 顏色判斷運算式 (取該區最多的情緒色) ---
        const colorExpr = [
            'case',
            ['all', ['>=', ['get', 'count_LOVE'], ['get', 'count_GRATEFUL']], ['>=', ['get', 'count_LOVE'], ['get', 'count_WISH']], ['>=', ['get', 'count_LOVE'], ['get', 'count_REGRET']], ['>=', ['get', 'count_LOVE'], ['get', 'count_SAD']]], EMOTION_COLORS.LOVE.color,
            ['all', ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_WISH']], ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_REGRET']], ['>=', ['get', 'count_GRATEFUL'], ['get', 'count_SAD']]], EMOTION_COLORS.GRATEFUL.color,
            ['all', ['>=', ['get', 'count_WISH'], ['get', 'count_REGRET']], ['>=', ['get', 'count_WISH'], ['get', 'count_SAD']]], EMOTION_COLORS.WISH.color,
            ['>=', ['get', 'count_REGRET'], ['get', 'count_SAD']], EMOTION_COLORS.REGRET.color,
            EMOTION_COLORS.SAD.color
        ];

        // --- 3. 建立圖層 (無數字、擴大範圍) ---

        // A. 叢集擴大層 (擴散光暈)
        map.addLayer({
            id: 'clusters-pulse',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': colorExpr,
                'circle-opacity': 0.3,
                // 🎯 關鍵：擴散範圍隨數量 (point_count) 增加
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['get', 'point_count'],
                    2, baseRadius * 5,   // 2個點
                    5, baseRadius * 8,  // 5個點
                    10, baseRadius * 12, // 10個點
                    20, baseRadius * 20 // 20個點以上
                ]
            }
        });

        // B. 叢集主體 (核心點)
        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': colorExpr,
                'circle-radius': baseRadius, // 🎯 核心與單點一致
                'circle-opacity': 1,

            }
        });

        // C. 單點擴散層
        map.addLayer({
            id: 'unclustered-pulse',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.3,
                'circle-radius': baseRadius * 3
            }
        }, 'clusters');

        // D. 單點核心
        map.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'emotion-posts',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['get', 'color'],
                'circle-radius': baseRadius,

            }
        });

        // --- 4. 點擊與互動 ---
        map.on('click', 'clusters', (e) => {
            closeAllPopups();
            const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            map.getSource('emotion-posts').getClusterExpansionZoom(features[0].properties.cluster_id, (err, zoom) => {
                if (!err) map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
            });
        });

        map.on('click', 'unclustered-point', (e) => {
            closeAllPopups();
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates.slice();
            map.flyTo({ center: coords, zoom: 15 });

            const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'custom-memo-popup' })
                .setLngLat(coords)
                .setHTML(buildPopupContent(props))
                .addTo(map);

            activePopups.push(popup);

            if (window.isAdminMode) {
                setTimeout(() => {
                    const btn = popup.getElement().querySelector('.popup-delete-btn');
                    if (btn) btn.onclick = () => deletePost(props.code, popup);
                }, 100);
            }
        });

        // 指標樣式
        const layers = ['clusters', 'unclustered-point'];
        layers.forEach(lyr => {
            map.on('mouseenter', lyr, () => map.getCanvas().style.cursor = 'pointer');
            map.on('mouseleave', lyr, () => map.getCanvas().style.cursor = '');
        });

        // --- 5. 啟動數據載入與呼吸動畫 ---
        await loadWhispersFromFirebase();
        startSmoothPulsing(Date.now());

        // URL 成功提示處理
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('success') === 'true' && urlParams.get('code')) {
            searchAndFlyToPost(urlParams.get('code'), true);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    });

    // 搜尋功能
    document.getElementById('code-search-form').onsubmit = async (e) => {
        e.preventDefault();
        const input = document.getElementById('code-input');
        const val = input.value.trim().toUpperCase();
        const lang = i18n[currentLangKey] || i18n['zh'];

        if (val === ADMIN_KEY) {
            const pw = prompt(lang.deleteConfirm);
            if (pw === ADMIN_PASSWORD) {
                window.isAdminMode = !window.isAdminMode;
                document.getElementById('code-search-message').textContent = window.isAdminMode ? lang.adminModeOn : lang.adminModeOff;
            }
            input.value = '';
            return;
        }
        await searchAndFlyToPost(val);
        input.value = '';
    };
});

// ESC 關閉 Popups
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPopups();
});