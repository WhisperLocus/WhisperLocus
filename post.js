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
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?language=en&access_token=${MAPBOX_TOKEN}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const context = feature.context; 
                
                let county = "";
                let country = "";

                if (context) {
                    context.forEach(item => {
                        if (item.id.includes('place')) county = item.text;
                        if (item.id.includes('country')) country = item.text;
                    });
                }

                if (county && country) {
                    return `${county}, ${country}`;
                } else {
                    const parts = feature.place_name.split(',').map(p => p.trim());
                    return parts.length >= 2 
                        ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}` 
                        : feature.place_name;
                }
            }
            return `座標 (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
        } catch (error) {
            console.error("Geocoding error:", error);
            return `座標 (${lng.toFixed(4)}, ${lat.toFixed(4)})`;
        }
    };

    const updateLocationState = async (lng, lat) => {
        selectedLongitude = lng;
        selectedLatitude = lat;
        mapStatusDiv.textContent = '🔍 正在解析地址...';
        selectedPlaceName = await reverseGeocode(lng, lat);
        mapStatusDiv.textContent = `📍 已選定：${selectedPlaceName}`;
        confirmLocationButton.disabled = false;
    };

    const initializeMap = (center) => {
        if (isMapInitialized) {
            map.setStyle('mapbox://styles/mapbox/streets-v12');
            map.jumpTo({ center: center });
            marker.setLngLat(center);
            return;
        }

        mapboxgl.accessToken = MAPBOX_TOKEN;
        map = new mapboxgl.Map({
            container: 'location-map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: center,
            zoom: 14
        });

        marker = new mapboxgl.Marker({ draggable: true, color: "#ff5722" })
            .setLngLat(center)
            .addTo(map);

        marker.on('dragend', () => {
            const lngLat = marker.getLngLat();
            updateLocationState(lngLat.lng, lngLat.lat);
        });

        map.on('click', (e) => {
            marker.setLngLat(e.lngLat);
            updateLocationState(e.lngLat.lng, e.lngLat.lat);
        });

        isMapInitialized = true;
    };

    const resetMapStyle = () => {
        if (map) {
            map.setStyle('mapbox://styles/mapbox/light-v11');
        }
    };

    // ----------------------------------------------------------------
    // 🎯 事件監聽
    // ----------------------------------------------------------------

    contentInput.addEventListener('input', () => {
        const len = contentInput.value.length;
        charCountSpan.textContent = `${len} / ${MAX_CHAR_LIMIT}`;
        charCountSpan.style.color = len > MAX_CHAR_LIMIT ? 'red' : '#999';
    });

    submitButton.addEventListener('click', () => {
        const content = contentInput.value.trim();
        const emotionRadio = postForm.querySelector('input[name="emotion"]:checked');

        if (content.length < 5) return alert('內容太短了，再多寫一點吧。');
        if (!emotionRadio) return alert('請選擇一個現在的心情。');

        tempContent = content;
        tempEmotion = emotionRadio.value;

        locationModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        mapSelectionArea.style.display = 'block';

        const teshima = [134.1031, 34.4878];
        initializeMap(teshima);

        setTimeout(() => {
            if (map) map.resize();
        }, 300);
    });

    useGpsButton.addEventListener('click', () => {
        if (!navigator.geolocation) return alert('瀏覽器不支援 GPS 定位');
        
        useGpsButton.textContent = '📡 定位中...';
        useGpsButton.disabled = true;

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lng = pos.coords.longitude;
                const lat = pos.coords.latitude;
                
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

    confirmLocationButton.addEventListener('click', () => {
        if (selectedLongitude && selectedLatitude) {
            finalizePostSubmission();
        }
    });

    window.addEventListener('click', (e) => {
        if (e.target === locationModal) {
            locationModal.style.display = 'none';
            document.body.style.overflow = 'auto';
            resetMapStyle();
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
            
            resetMapStyle();
            
            // ✨ 核心修正：將選定的經緯度帶回首頁 URL
            const finalLng = Number(selectedLongitude);
            const finalLat = Number(selectedLatitude);
            location.href = `index.html?success=true&code=${resultCode}&lng=${finalLng}&lat=${finalLat}`;

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