document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------
    // 🎯 變數與常數宣告
    // ----------------------------------------------------------------
    const postForm = document.getElementById('post-form');
    const contentInput = document.getElementById('content');
    const charCountSpan = document.getElementById('char-count');
    const MAX_CHAR_LIMIT = 800;

    const submitButton = document.getElementById('submit-button'); 

    // 彈窗相關元素
    const locationModal = document.getElementById('location-modal');
    const useGpsButton = document.getElementById('use-gps-button');
    const mapSelectionArea = document.getElementById('map-selection-area');
    const mapStatusDiv = document.getElementById('map-status');
    const confirmLocationButton = document.getElementById('confirm-location-button');

    // 地圖相關
    const MAPBOX_TOKEN = 'pk.eyJ1IjoiOWVvcmdlIiwiYSI6ImNtaXBoeGs5MzAxN3MzZ29pbGpsaTlwdTgifQ.ZUihSP9R0IYw7780nrJ0sA'; 
    let selectedLongitude = null;
    let selectedLatitude = null;
    let selectedPlaceName = ''; 

    let map = null;
    let marker = null;
    let isMapInitialized = false; 
    
    // 暫存使用者輸入
    let tempContent = null; 
    let tempEmotion = null; 

    // ----------------------------------------------------------------
    // 🎯 工具函數
    // ----------------------------------------------------------------
    
    const generateCode = () => {
        const randomHex = Math.floor(Math.random() * 0xFFFFFFF).toString(16).padStart(7, '0').toUpperCase();
        return randomHex.substring(0, 3) + '-' + randomHex.substring(3, 7);
    };

const reverseGeocode = async (lng, lat) => {
    // 將語言設定為英文 'en'
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?language=en&access_token=${MAPBOX_TOKEN}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const feature = data.features[0];
            let county = "";
            let country = "";

            // 從 context 陣列中精確尋找 Place (城市) 與 Country (國家)
            if (feature.context) {
                feature.context.forEach(item => {
                    if (item.id.includes('place')) county = item.text;
                    if (item.id.includes('country')) country = item.text;
                });
            }

            // 如果沒有抓到 place (城市)，嘗試抓取 region (區域/省份)
            if (!county && feature.context) {
                const region = feature.context.find(item => item.id.includes('region'));
                if (region) county = region.text;
            }

            // 根據抓取到的結果組合格式
            if (county && country) {
                return `${county}, ${country}`;
            } else if (country) {
                return country;
            } else {
                // 若都抓不到，回傳該位置的主要地名
                return feature.text || `Coordinates (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
            }
        }
        return `Coordinates (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
    } catch (error) {
        console.error('Geocoding Error:', error);
        return `Coordinates (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
    }
};

// 3. 更新位置狀態與 UI 顯示
const updateLocationState = async (lng, lat) => {
    selectedLongitude = lng;
    selectedLatitude = lat;
    
    // UI 反饋
    mapStatusDiv.textContent = '🔍 Resolving address...';
    
    // 取得英文格式地址
    selectedPlaceName = await reverseGeocode(lng, lat);
    
    // 更新地圖下方的狀態文字 (同步顯示為英文)
    mapStatusDiv.textContent = `📍 Selected: ${selectedPlaceName}`;
    
    // 啟用確認按鈕
    confirmLocationButton.disabled = false;
};

// 4. 初始化地圖
const initializeMap = (center) => {
    if (isMapInitialized) {
        map.jumpTo({ center: center });
        marker.setLngLat(center);
        return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    map = new mapboxgl.Map({
        container: 'location-map',
        style: 'mapbox://styles/mapbox/light-v11',
        center: center,
        zoom: 14
    });

    marker = new mapboxgl.Marker({ draggable: true, color: "#ff5722" })
        .setLngLat(center)
        .addTo(map);

    // 拖拽標記結束後更新
    marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        updateLocationState(lngLat.lng, lngLat.lat);
    });

    // 點擊地圖任意處移動標記並更新
    map.on('click', (e) => {
        marker.setLngLat(e.lngLat);
        updateLocationState(e.lngLat.lng, e.lngLat.lat);
    });

    isMapInitialized = true;
};

    // ----------------------------------------------------------------
    // 🎯 事件監聽
    // ----------------------------------------------------------------

    // 1. 字數計數器
    contentInput.addEventListener('input', () => {
        const len = contentInput.value.length;
        charCountSpan.textContent = `${len} / ${MAX_CHAR_LIMIT}`;
        charCountSpan.style.color = len > MAX_CHAR_LIMIT ? 'red' : '#999';
    });

    // 2. 第一步：點擊「選擇封存地點」按鈕（直跳地圖）
    submitButton.addEventListener('click', () => {
        const content = contentInput.value.trim();
        const emotionRadio = postForm.querySelector('input[name="emotion"]:checked');

        if (content.length < 5) return alert('內容太短了，再多寫一點吧。');
        if (!emotionRadio) return alert('請選擇一個現在的心情。');

        tempContent = content;
        tempEmotion = emotionRadio.value;

        // 顯示彈窗
        locationModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // ✨ 直接開啟地圖區域
        mapSelectionArea.style.display = 'block';

        // 初始化地圖 (預設豐島)
        const teshima = [134.1031, 34.4878];
        initializeMap(teshima);

        // 🔥 關鍵修正：給予極短延遲確保 Modal 完全展開後重新計算地圖尺寸
        setTimeout(() => {
            if (map) map.resize();
        }, 300);
    });

    // 3. GPS 定位按鈕邏輯
    useGpsButton.addEventListener('click', () => {
        if (!navigator.geolocation) return alert('瀏覽器不支援 GPS 定位');
        
        useGpsButton.textContent = '📡 定位中...';
        useGpsButton.disabled = true;

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lng = pos.coords.longitude;
                const lat = pos.coords.latitude;
                
                // 地圖飛往該座標並移動標記
                if (map) {
                    map.flyTo({ center: [lng, lat], zoom: 16 });
                    marker.setLngLat([lng, lat]);
                }
                
                await updateLocationState(lng, lat);
                
                useGpsButton.textContent = '📡 使用我目前的位置';
                useGpsButton.disabled = false;
            },
            (err) => {
                alert('無法獲取位置，請在地圖上手動選取。');
                mapStatusDiv.textContent = '❌ 定位失敗';
                useGpsButton.textContent = '📡 使用我目前的位置';
                useGpsButton.disabled = false;
            }
        );
    });

    // 4. 確認提交按鈕
    confirmLocationButton.addEventListener('click', () => {
        if (selectedLongitude && selectedLatitude) {
            finalizePostSubmission();
        }
    });

    // 點擊 Modal 背景關閉
    window.addEventListener('click', (e) => {
        if (e.target === locationModal) {
            locationModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // ----------------------------------------------------------------
    // 🎯 最終提交
    // ----------------------------------------------------------------
    const finalizePostSubmission = async () => {
        submitButton.disabled = true;
        submitButton.textContent = '封存中...';
        confirmLocationButton.disabled = true;
        confirmLocationButton.textContent = '傳送中...';

        try {
            if (!window.db || !window.addDoc) throw new Error("Firebase 未就緒");

            const resultCode = generateCode();
            const postData = {
                code: resultCode,
                content: tempContent,
                emotion: tempEmotion,
                latitude: Number(selectedLatitude),
                longitude: Number(selectedLongitude),
                locationText: selectedPlaceName || "未知地點",
                createdAt: window.serverTimestamp(),
                lang: 'zh-TW'
            };

            await window.addDoc(window.collection(window.db, "posts"), postData);
            location.href = `index.html?success=true&code=${resultCode}`;

        } catch (error) {
            console.error(error);
            alert(`封存失敗：${error.message}`);
            submitButton.disabled = false;
            submitButton.textContent = '選擇封存地點';
            confirmLocationButton.disabled = false;
            confirmLocationButton.textContent = '確認地點並發佈';
        }
    };
});