console.log("🚀 AI Memory Bank Load (V31: 지연 로딩 스캐너 & 비동기 세션 복구 시스템)");

const style = document.createElement('style');
style.innerHTML = `
    @keyframes mb-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .mb-busy-ring { position: absolute; top: -4px; left: -4px; right: -4px; bottom: -4px; border: 4px solid transparent; border-top-color: #ff9800; border-right-color: #ff9800; border-radius: 50%; animation: mb-spin 1s linear infinite; pointer-events: none; display: none; }
    .mb-busy-mode .mb-busy-ring { display: block; }
    .mb-busy-mode { transform: scale(1) !important; background-color: #9e9e9e !important; }
    
    /* 🌟 스캔 전용 풀스크린 락다운 오버레이 */
    #mb-fullscan-lockdown { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0,0,0,0.8); zIndex: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; backdrop-filter: blur(5px); color: white; text-align: center; }
    
    /* 🌟 비동기 진행용 미니 토스트 */
    #mb-progress-toast { position: fixed; bottom: 20px; left: 20px; background-color: #8a2be2; color: white; padding: 12px 20px; border-radius: 30px; zIndex: 2147483647; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
`;
document.head.appendChild(style);

const CREDIT_COST = { SEARCH: 1, SYNC: 2, SAVE: 3 };

// 강제 잠금 해제 안전장치
chrome.storage.local.set({ isSavingInProgress: false });
window.mbIsBusy = false;
window.addEventListener('beforeunload', () => { if (window.mbIsBusy) chrome.storage.local.set({ isSavingInProgress: false }); });

let isAutoSubmitting = false;
let isSearching = false;

const siteConfig = {
    "chatgpt.com": '[data-message-author-role]', "gemini.google.com": 'user-query, model-response',
    "claude.ai": '.font-user-message, .font-claude-message', "grok.com": '.prose, .message-row, [data-testid="message-content"]',
    "chat.deepseek.com": '.ds-markdown, .fbb737a4, .text-message'
};

function getFlagKey(auth) {
    const hostname = window.location.hostname;
    const cleanPath = window.location.pathname.split('/').filter(p => p).join('_');
    const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "guest";
    return `mb_flag_v3_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPath}`;
}

function getAuthInfo() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'userEmail', 'userRole'], function(result) {
            resolve({ apiKey: result.memoryBankApiKey, workspaceId: result.currentWorkspaceId, userEmail: result.userEmail, userRole: result.userRole || 'FREE' });
        });
    });
}

function showLoginPrompt() { /* ...생략 (이전과 동일)... */ }
function showPaywallModal(actionType) { /* ...생략 (이전과 동일)... */ }
function triggerEnter(target) { /* ...생략 (이전과 동일)... */ }

// 🌟 1. 풀스크린 락다운 (스캔 과정 중)
function showFullScanLockdown(textLength) {
    let overlay = document.getElementById('mb-fullscan-lockdown');
    if (!overlay) {
        overlay = document.createElement('div'); overlay.id = 'mb-fullscan-lockdown';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div style="font-size: 60px; animation: mb-spin 2s linear infinite; margin-bottom: 20px;">⏳</div>
        <h2 style="margin: 0 0 10px 0;">전체 대화 스캔 중...</h2>
        <p style="font-size: 16px; font-weight: bold; color: #ff9800;">데이터 로딩을 위해 창을 닫거나 스크롤을 만지지 마세요.</p>
        <p style="margin-top: 10px; color: #ccc;">현재 수집량: ${textLength.toLocaleString()} 자</p>
    `;
}
function hideFullScanLockdown() { const overlay = document.getElementById('mb-fullscan-lockdown'); if (overlay) overlay.remove(); }

// 🌟 2. 미니 토스트 (비동기 저장 중)
function showProgressToast(msg) {
    let toast = document.getElementById('mb-progress-toast');
    if(!toast) { toast = document.createElement('div'); toast.id = 'mb-progress-toast'; document.body.appendChild(toast); }
    toast.innerHTML = `<span style="font-size: 18px; animation: mb-spin 2s linear infinite;">⏳</span> ${msg}`;
}
function hideProgressToast() { const toast = document.getElementById('mb-progress-toast'); if (toast) toast.remove(); }

function showFullScanConfirmModal(scanData, auth, unifiedFlagKey, unlockCallback) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.7)', zIndex: '2147483647', display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)' });
    const box = document.createElement('div');
    Object.assign(box.style, { backgroundColor: 'white', padding: '30px', borderRadius: '16px', textAlign: 'center', width: '350px' });
    box.innerHTML = `
        <div style="font-size: 45px; margin-bottom: 10px;">📋</div><h3 style="margin: 0 0 15px 0;">스캔 완료!</h3>
        <div style="background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; padding: 15px; margin-bottom: 20px; text-align: left; font-size: 14px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="color: #666;">수집된 텍스트:</span><strong>${scanData.textLength.toLocaleString()} 자</strong></div>
            <div style="display: flex; justify-content: space-between;"><span style="color: #666;">예상 번개 소모:</span><strong style="color: #ff9800;">${scanData.estimatedCredits} 개</strong></div>
        </div>
        <p style="color: #666; font-size: 12px; margin-bottom: 20px;">확정 시 백그라운드에서 비동기로 안전하게 저장됩니다.</p>
        <div style="display: flex; gap: 10px;">
            <button id="mb-scan-cancel" style="flex: 1; background: #f1f3f4; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">취소</button>
            <button id="mb-scan-confirm" style="flex: 1; background: #8a2be2; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">저장 확정</button>
        </div>
    `;
    overlay.appendChild(box); document.body.appendChild(overlay);

    document.getElementById('mb-scan-cancel').onclick = () => { overlay.remove(); unlockCallback(); };
    document.getElementById('mb-scan-confirm').onclick = async () => {
        document.getElementById('mb-scan-confirm').innerText = "⏳ 서버 접수 중..."; document.getElementById('mb-scan-confirm').disabled = true; document.getElementById('mb-scan-cancel').style.display = 'none';
        try {
            const initRes = await fetch("https://aimemorybank.cloud/api/memories/full-save/init", {
                method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": auth.apiKey },
                body: JSON.stringify({ workspaceId: auth.workspaceId, rawContent: scanData.rawText, estimatedTokens: scanData.estimatedCredits })
            });
            if (initRes.status === 402) { overlay.remove(); showPaywallModal(`전체 저장(${scanData.estimatedCredits}개 차감)`); unlockCallback(); return; }
            if (!initRes.ok) throw new Error("접수 실패");
            const responseText = await initRes.text();
            const match = responseText.match(/ID: (\d+)/);
            if (match) {
                overlay.remove();
                const jobId = match[1];

                // 🌟 [핵심] 복구를 위해 로컬 스토리지에 작업 등록
                chrome.storage.local.set({
                    activeMbJob: { jobId: jobId, flagKey: unifiedFlagKey, newFlag: scanData.newFlag, estimatedCredits: scanData.estimatedCredits }
                });

                startJobPolling(jobId, auth, scanData.estimatedCredits, unifiedFlagKey, scanData.newFlag, unlockCallback);
            } else throw new Error("Job ID 파싱 실패");
        } catch (error) { alert("🚨 오류 발생: " + error.message); overlay.remove(); unlockCallback(); }
    };
}

// 🌟 비동기 폴링 (토스트 알림 기반)
function startJobPolling(jobId, auth, estimatedCredits, flagKey, newFlag, unlockCallback) {
    showProgressToast("서버에서 AI 대화 분석 및 저장 중입니다...");
    if(unlockCallback) unlockCallback(); // UI 잠금을 풀어줌 (백그라운드에서 도니까)

    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`https://aimemorybank.cloud/api/memories/full-save/${jobId}/status`, { headers: { "X-API-KEY": auth.apiKey } });
            if (!res.ok) return;
            const data = await res.json();
            if (data.status === "COMPLETED") {
                clearInterval(pollInterval); hideProgressToast();
                chrome.storage.local.get(['dailyCredits'], (storageData) => { const c = storageData.dailyCredits !== undefined ? storageData.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - estimatedCredits)}); });
                localStorage.setItem(flagKey, newFlag);
                chrome.storage.local.remove(['activeMbJob']); // 복구 데이터 삭제
                alert("✅ 전체 대화 저장이 완료되었습니다!");
            } else if (data.status === "FAILED") {
                clearInterval(pollInterval); hideProgressToast(); chrome.storage.local.remove(['activeMbJob']);
                alert("🚨 서버 처리 중 에러가 발생했습니다.");
            }
        } catch (e) {}
    }, 3000);
}

function normalizeForMatch(text) { return text ? text.replace(/[^가-힣a-zA-Z0-9]/g, '') : ""; }

function injectFloatingMenu() {
    if (document.getElementById('memory-bank-fab-container')) return;
    const fabContainer = document.createElement('div'); fabContainer.id = 'memory-bank-fab-container';
    Object.assign(fabContainer.style, { position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483640', display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '10px' });

    const mainBtn = document.createElement('button'); mainBtn.innerHTML = '🧠'; mainBtn.id = 'mb-main-fab';
    Object.assign(mainBtn.style, { position: 'relative', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#8a2be2', color: 'white', border: 'none', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', transition: 'transform 0.3s ease', display: 'flex', justifyContent: 'center', alignItems: 'center' });

    const spinnerRing = document.createElement('div'); spinnerRing.className = 'mb-busy-ring'; mainBtn.appendChild(spinnerRing);

    const setupSubButton = (btn, text) => {
        btn.innerHTML = text;
        Object.assign(btn.style, { padding: '10px 16px', backgroundColor: '#ffffff', color: '#333', border: '1px solid #ddd', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', transition: 'all 0.15s ease-in-out', opacity: '0', transform: 'translateY(20px)', pointerEvents: 'none' });
    };

    const saveBtn = document.createElement('button'); setupSubButton(saveBtn, '💾 단일 저장');
    const loadBtn = document.createElement('button'); setupSubButton(loadBtn, '📥 기억 연동');
    const scanBtn = document.createElement('button'); setupSubButton(scanBtn, '🚀 전체 스캔');

    const setBusyState = (isBusy) => {
        window.mbIsBusy = isBusy; chrome.storage.local.set({ isSavingInProgress: isBusy });
        if (isBusy) { mainBtn.classList.add('mb-busy-mode'); [saveBtn, loadBtn, scanBtn].forEach(b => { b.style.opacity = '0'; b.style.pointerEvents = 'none'; }); }
        else { mainBtn.classList.remove('mb-busy-mode'); }
    };

    fabContainer.onmouseenter = async () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1.1)';
        const auth = await getAuthInfo();
        scanBtn.innerHTML = auth.userRole === 'FREE' ? '🔒 전체 스캔' : '✨ 전체 스캔';
        [saveBtn, loadBtn, scanBtn].forEach((btn, index) => { btn.style.opacity = '1'; btn.style.transform = 'translateY(0) scale(1)'; btn.style.pointerEvents = 'auto'; btn.style.transitionDelay = `${index * 0.05}s`; });
    };

    fabContainer.onmouseleave = () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1)';
        [saveBtn, loadBtn, scanBtn].forEach((btn) => { btn.style.opacity = '0'; btn.style.transform = 'translateY(20px)'; btn.style.pointerEvents = 'none'; btn.style.transitionDelay = '0s'; });
    };

    // 🚀 [전체 스캔 로직: 지연 로딩 완벽 대응]
    scanBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;
        const auth = await getAuthInfo();
        if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
        if (auth.userRole === 'FREE') { alert("🔒 전체 대화 스캔 기능은 LITE 등급 이상부터 사용 가능합니다."); return; }

        setBusyState(true);
        const unlockScanBtn = () => { setBusyState(false); hideFullScanLockdown(); };
        const hostname = window.location.hostname;
        const currentPlatform = Object.keys(siteConfig).find(domain => hostname.includes(domain));
        if (!currentPlatform) { unlockScanBtn(); return; }

        const flagKey = getFlagKey(auth);
        const stopFlagText = localStorage.getItem(flagKey);
        const safeTarget = stopFlagText ? normalizeForMatch(stopFlagText).slice(-25) : null;

        showFullScanLockdown(0); // 🌟 강력한 화면 잠금

        try {
            let reachedFlag = false; let seenTexts = new Set(); let collectedChunks = [];
            let sameTopCount = 0; let previousFirstMessage = "";

            window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 800));

            while (!reachedFlag) {
                const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                if (bubbles.length === 0) break;

                let chunkForThisView = [];
                for (let i = bubbles.length - 1; i >= 0; i--) {
                    let text = bubbles[i].innerText.trim().replace(/말씀하신 내용\n*/g, '').replace(/^말씀하신 내용$/gm, '');
                    if (safeTarget && normalizeForMatch(text).includes(safeTarget)) { reachedFlag = true; break; }
                    if (text.length > 0 && !seenTexts.has(text)) { seenTexts.add(text); chunkForThisView.unshift(text); }
                }

                if (chunkForThisView.length > 0) {
                    collectedChunks.unshift(chunkForThisView.join('\n\n'));
                    showFullScanLockdown(collectedChunks.join('\n\n').length);
                }

                if (reachedFlag) break;

                // 🌟 스크롤 강제 펌핑 (가상 DOM 지연 로딩 뚫기)
                window.scrollTo(0, 0);
                document.querySelectorAll('*').forEach(el => {
                    if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) el.scrollTo(0, 0);
                });

                await new Promise(r => setTimeout(r, 1500)); // 넉넉히 1.5초 대기

                const newBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                const currentFirstMessage = newBubbles[0] ? newBubbles[0].innerText : "";

                if (currentFirstMessage === previousFirstMessage) {
                    sameTopCount++;
                    if (sameTopCount >= 3) break; // 3번 시도해도 안 변하면 진짜 맨 위 도착
                } else { sameTopCount = 0; }

                previousFirstMessage = currentFirstMessage;
            }

            window.scrollTo(0, document.body.scrollHeight); hideFullScanLockdown();
            const rawFinalText = collectedChunks.join('\n\n'); const textLength = rawFinalText.length;
            if (textLength < 10) { alert("새로 스캔할 대화 내용이 없습니다."); unlockScanBtn(); return; }

            const estimatedCredits = Math.ceil(textLength / 500) * 3;
            // 🌟 새 플래그용 텍스트 (방금 스캔한 내용의 맨 마지막 버블)
            const newBubblesAfterScroll = document.querySelectorAll(siteConfig[currentPlatform]);
            const newFlagText = newBubblesAfterScroll[newBubblesAfterScroll.length - 1]?.innerText || "";

            showFullScanConfirmModal({ rawText: rawFinalText, textLength, estimatedCredits, newFlag: newFlagText }, auth, flagKey, unlockScanBtn);
        } catch (error) { hideFullScanLockdown(); alert("스캔 중 오류 발생"); unlockScanBtn(); }
    };

    // 💾 [단일 저장]
    saveBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;
        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
            const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
            const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
            if (currentCredits < CREDIT_COST.SAVE) { showPaywallModal(`저장(${CREDIT_COST.SAVE}개 차감)`); return; }

            const hostname = window.location.hostname;
            const currentPlatform = Object.keys(siteConfig).find(domain => hostname.includes(domain));
            if (!currentPlatform) return;

            const allBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
            if (allBubbles.length === 0) return;

            setBusyState(true);
            const unlockSaveBtn = () => setBusyState(false);

            const flagKey = getFlagKey(auth);
            const cleanPathV2 = window.location.pathname.replace(/\/$/, '');
            const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "guest";
            const oldKey1 = `mb_unified_flag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPathV2}`;
            const oldKey2 = `mb_text_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPathV2}`;

            const lastSavedText = localStorage.getItem(flagKey) || localStorage.getItem(oldKey1) || localStorage.getItem(oldKey2);
            const safeTarget = lastSavedText ? normalizeForMatch(lastSavedText).slice(-25) : null;

            let startIndex = 0;
            if (safeTarget) {
                for (let i = allBubbles.length - 1; i >= 0; i--) {
                    if (normalizeForMatch(allBubbles[i].innerText).includes(safeTarget)) { startIndex = i + 1; break; }
                }
            }
            const newBubbles = Array.from(allBubbles).slice(startIndex);
            if (newBubbles.length === 0) { alert("✅ 최근 대화가 이미 저장되어 있습니다."); unlockSaveBtn(); return; }

            const cleanedBubbles = [];
            for (let bubble of newBubbles) {
                let text = bubble.innerText.trim().replace(/말씀하신 내용\n*/g, '').replace(/^말씀하신 내용$/gm, '');
                if (text.length > 0 && !cleanedBubbles.includes(text)) cleanedBubbles.push(text);
            }
            if (cleanedBubbles.length === 0) { unlockSaveBtn(); return; }

            // 🌟 텍스트 병합 및 길이 검증 로직 추가
            const joinedContent = cleanedBubbles.join('\n\n');

            if (joinedContent.length > 5000) {
                alert(`⚠️ 저장하려는 새로운 대화가 너무 많습니다 (${joinedContent.length.toLocaleString()}자).\n\n단일 저장은 최근 대화 요약용입니다. 전체 내용을 안전하게 분석하려면 '전체 스캔' 기능을 사용해주세요!`);
                unlockSaveBtn();
                return;
            }

            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST", headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey},
                body: JSON.stringify({ workspaceId: auth.workspaceId, content: joinedContent, type: "FULL_CONV" })
            });

            if (response.status === 402) { showPaywallModal(`저장(${CREDIT_COST.SAVE}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 에러");

            chrome.storage.local.get(['dailyCredits'], (data) => { const c = data.dailyCredits !== undefined ? data.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SAVE)}); });

            localStorage.setItem(flagKey, allBubbles[allBubbles.length - 1].innerText.trim());

            alert("✅ 대화가 성공적으로 저장되었습니다!");
            unlockSaveBtn();
        } catch (error) { unlockSaveBtn(); }
    };

    // 📥 [기억 연동] (변경 없음)
    loadBtn.onclick = async (e) => {
        // ... (기존과 완전히 동일) ...
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;
        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
            const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
            const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
            if (currentCredits < CREDIT_COST.SYNC) { showPaywallModal(`연동(${CREDIT_COST.SYNC}개 차감)`); return; }

            setBusyState(true);
            const unlockLoadBtn = () => setBusyState(false);
            const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
            const syncStorageKey = `mb_sync_${safeEmail}_${auth.workspaceId}_${window.location.hostname}_${window.location.pathname}`;
            let lastId = parseInt(localStorage.getItem(syncStorageKey)); if (isNaN(lastId)) lastId = 0;

            const response = await fetch(`https://aimemorybank.cloud/api/memories/sync?workspaceId=${auth.workspaceId}&lastId=${lastId}&limit=50`, { method: 'GET', headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey} });
            if (response.status === 402) { showPaywallModal(`연동(${CREDIT_COST.SYNC}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 에러");

            const result = await response.json();
            const memories = result.data || [];
            if (memories.length === 0) { alert("✅ 모든 최신 기억이 동기화되어 있습니다."); unlockLoadBtn(); return; }

            chrome.storage.local.get(['dailyCredits'], (data) => { const c = data.dailyCredits !== undefined ? data.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SYNC)}); });

            const newLastId = memories[memories.length - 1].id;
            const memoryContents = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
            const cleanSyncPrompt = `[System Instruction: Memorize the following data and reply strictly with "Yes, I have updated my memory."]\n\n[Loaded Memory Chunk]\n${memoryContents}`.trim();

            const inputTarget = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
            if (inputTarget) {
                inputTarget.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, cleanSyncPrompt); triggerEnter(inputTarget);
                localStorage.setItem(syncStorageKey, newLastId);
                setTimeout(() => { alert("✅ 동기화 완료"); unlockLoadBtn(); }, 2000);
            } else { unlockLoadBtn(); }
        } catch(e) { unlockLoadBtn(); }
    };

    fabContainer.append(scanBtn, loadBtn, saveBtn, mainBtn);
    document.body.appendChild(fabContainer);
}
setInterval(injectFloatingMenu, 1000);


// 🧭 [스마트 나침반 시스템]
let isNavigatorInitialized = false;

async function initSmartNavigator() {
    if (isNavigatorInitialized) return;
    isNavigatorInitialized = true;

    let compass = document.createElement('button');
    compass.id = 'mb-bookmark-compass';
    Object.assign(compass.style, {
        position: 'fixed', right: '20px', bottom: '260px',
        backgroundColor: '#ffffff', border: '2px solid #8a2be2', color: '#8a2be2',
        padding: '10px 16px', borderRadius: '30px', fontSize: '12px', fontWeight: '900',
        cursor: 'pointer', zIndex: '2147483647', display: 'none', alignItems: 'center', gap: '6px',
        boxShadow: '0 4px 10px rgba(0,0,0,0.1)', transition: 'all 0.3s ease', opacity: '0.4'
    });

    compass.onmouseenter = () => { compass.style.backgroundColor = '#8a2be2'; compass.style.color = '#ffffff'; compass.style.opacity = '1'; compass.style.transform = 'scale(1.05)'; };
    compass.onmouseleave = () => { compass.style.backgroundColor = '#ffffff'; compass.style.color = '#8a2be2'; compass.style.opacity = '0.4'; compass.style.transform = 'scale(1)'; };
    document.body.appendChild(compass);

    const track = async () => {
        const auth = await getAuthInfo();
        if (!auth.apiKey) return;

        const hostname = window.location.hostname;
        const currentPlatform = Object.keys(siteConfig).find(d => hostname.includes(d));
        if (!currentPlatform) return;

        const flagKey = getFlagKey(auth);
        const cleanPathV2 = window.location.pathname.replace(/\/$/, '');
        const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "guest";
        const oldKey1 = `mb_unified_flag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPathV2}`;
        const oldKey2 = `mb_scanflag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPathV2}`;
        const targetText = localStorage.getItem(flagKey) || localStorage.getItem(oldKey1) || localStorage.getItem(oldKey2);

        if (!targetText) { compass.style.display = 'none'; return; }

        const searchTarget = normalizeForMatch(targetText).slice(-25);
        if (searchTarget.length < 5) return;

        const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
        let targetBubble = null;

        for (let i = bubbles.length - 1; i >= 0; i--) {
            if (normalizeForMatch(bubbles[i].innerText).includes(searchTarget)) {
                targetBubble = bubbles[i]; break;
            }
        }

        if (targetBubble && !targetBubble.dataset.mbFlagged) {
            targetBubble.dataset.mbFlagged = "true";
            targetBubble.style.position = "relative";
            const line = document.createElement('div');
            Object.assign(line.style, { position: 'absolute', bottom: '-5px', left: '0', width: '100%', height: '2px', backgroundColor: '#8a2be2', zIndex: '2147483646', boxShadow: '0 0 5px rgba(138, 43, 226, 0.5)' });
            const badge = document.createElement('div');
            badge.innerHTML = "💾 마지막 저장 지점";
            Object.assign(badge.style, { position: 'absolute', top: '-10px', right: '10px', backgroundColor: '#8a2be2', color: 'white', padding: '4px 12px', borderRadius: '15px', fontSize: '11px', fontWeight: 'bold', zIndex: '2147483647' });
            line.appendChild(badge); targetBubble.appendChild(line);
        }

        if (!targetBubble) {
            if (!window.isNavSearching) compass.innerHTML = "⬆️ 저장 위치";
            compass.style.display = 'flex';

            compass.onclick = () => {
                if (window.isNavSearching) return;
                window.isNavSearching = true;
                compass.innerHTML = "⏳ 위치 찾는 중...";

                let tryCount = 0;
                const searchInterval = setInterval(() => {
                    tryCount++;
                    if (tryCount > 20) {
                        clearInterval(searchInterval); window.isNavSearching = false;
                        compass.innerHTML = "❌ 위치를 찾을 수 없음"; setTimeout(() => track(), 2000); return;
                    }

                    const currentBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                    let found = null;
                    for (let i = currentBubbles.length - 1; i >= 0; i--) {
                        if (normalizeForMatch(currentBubbles[i].innerText).includes(searchTarget)) { found = currentBubbles[i]; break; }
                    }

                    if (found) {
                        clearInterval(searchInterval); window.isNavSearching = false;
                        found.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    } else {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }, 800);
            };
        } else {
            window.isNavSearching = false;
            const rect = targetBubble.getBoundingClientRect();
            const moveToTarget = () => targetBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

            if (rect.bottom < 0) {
                compass.innerHTML = "⬆️ 마지막 저장 위치"; compass.style.display = 'flex'; compass.onclick = moveToTarget;
            } else if (rect.bottom > window.innerHeight) {
                compass.innerHTML = "⬇️ 마지막 저장 위치"; compass.style.display = 'flex'; compass.onclick = moveToTarget;
            } else {
                compass.style.display = 'none';
            }
        }
    };
    setInterval(track, 1000);
}
setTimeout(initSmartNavigator, 1500);

// 🌟 [핵심] 끊긴 비동기 작업 복구 감시자 (새로고침/재접속 시 실행)
async function checkPendingJobs() {
    chrome.storage.local.get(['activeMbJob'], async (data) => {
        if (data.activeMbJob) {
            const job = data.activeMbJob;
            const auth = await getAuthInfo();
            if(!auth.apiKey) return;

            console.log("🔄 끊긴 저장 작업 복구 감지:", job.jobId);
            alert("🔄 이전 대화 저장 작업이 아직 백그라운드에서 진행 중입니다. 이어서 상태를 확인하겠습니다.");

            // 폴링 재개
            startJobPolling(job.jobId, auth, job.estimatedCredits, job.flagKey, job.newFlag, null);
        }
    });
}
// 페이지 로드 후 2.5초 뒤에 조용히 복구 검사
setTimeout(checkPendingJobs, 2500);

function injectScrollToTopButton() {
    if (document.getElementById('memory-bank-scroll-btn')) return;
    const scrollBtn = document.createElement('button'); scrollBtn.id = 'memory-bank-scroll-btn'; scrollBtn.innerHTML = '🔝';
    Object.assign(scrollBtn.style, { position: 'fixed', bottom: '20px', left: '20px', zIndex: '99999', padding: '10px 15px', backgroundColor: '#607d8b', color: 'white', border: 'none', borderRadius: '50px', fontSize: '15px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', opacity: '0.8' });
    scrollBtn.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
    document.body.appendChild(scrollBtn);
}
setInterval(injectScrollToTopButton, 1000);