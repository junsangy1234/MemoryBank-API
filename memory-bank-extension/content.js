console.log("🚀 AI Memory Bank Load (V26: 꼬리말 패턴 매칭 나침반 & 자동 권한 해제)");

const style = document.createElement('style');
style.innerHTML = `
    @keyframes mb-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .mb-busy-ring {
        position: absolute; top: -4px; left: -4px; right: -4px; bottom: -4px;
        border: 4px solid transparent; border-top-color: #ff9800; border-right-color: #ff9800;
        border-radius: 50%; animation: mb-spin 1s linear infinite; pointer-events: none;
        display: none;
    }
    .mb-busy-mode .mb-busy-ring { display: block; }
    .mb-busy-mode { transform: scale(1) !important; background-color: #9e9e9e !important; }
`;
document.head.appendChild(style);

const CREDIT_COST = { SEARCH: 1, SYNC: 2, SAVE: 3 };

window.mbIsBusy = false;
let isAutoSubmitting = false;
let isSearching = false;

const siteConfig = {
    "chatgpt.com": '[data-message-author-role]',
    "gemini.google.com": 'user-query, model-response',
    "claude.ai": '.font-user-message, .font-claude-message',
    "grok.com": '.prose, .message-row, [data-testid="message-content"]',
    "chat.deepseek.com": '.ds-markdown, .fbb737a4, .text-message'
};

function getAuthInfo() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'userEmail', 'userRole'], function(result) {
            resolve({
                apiKey: result.memoryBankApiKey,
                workspaceId: result.currentWorkspaceId,
                userEmail: result.userEmail,
                userRole: result.userRole || 'FREE'
            });
        });
    });
}

function showLoginPrompt() {
    if (document.getElementById('mb-login-prompt')) return;
    const overlay = document.createElement('div');
    overlay.id = 'mb-login-prompt';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: '100000', display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', textAlign: 'center', width: '320px', animation: 'slideUp 0.3s ease-out'
    });
    box.innerHTML = `
        <div style="font-size: 40px; margin-bottom: 10px;">🔒</div>
        <h3 style="margin: 0 0 10px 0; color: #333;">로그인이 필요합니다</h3>
        <p style="color: #666; font-size: 14px; margin-bottom: 20px;">안전한 데이터 백업을 위해<br>로그인이 필요합니다.</p>
        <button id="mb-close-prompt" style="background: #8a2be2; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%;">확인</button>
    `;
    overlay.appendChild(box); document.body.appendChild(overlay);
    document.getElementById('mb-close-prompt').onclick = () => overlay.remove();
}

function showPaywallModal(actionType) {
    if (document.getElementById('mb-paywall-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'mb-paywall-modal';
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: '100000', display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)' });
    const box = document.createElement('div');
    Object.assign(box.style, { backgroundColor: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', textAlign: 'center', width: '320px', animation: 'slideUp 0.3s ease-out' });
    box.innerHTML = `
        <div style="font-size: 45px; margin-bottom: 10px;">⚡</div>
        <h3 style="margin: 0 0 10px 0; color: #333;">번개가 부족합니다!</h3>
        <p style="color: #666; font-size: 14px; margin-bottom: 20px;">${actionType}에 필요한 크레딧이 부족합니다.</p>
        <div style="display: flex; gap: 12px; flex-direction: column;">
            <button id="mb-watch-ad" style="background: linear-gradient(135deg, #ff9800, #f44336); color: white; border: none; padding: 14px; border-radius: 10px; font-weight: bold; cursor: pointer;">📺 광고 보고 번개 +15 충전</button>
            <button id="mb-upgrade-pro" style="background: #8a2be2; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">👑 Premium 업그레이드</button>
            <button id="mb-close-paywall" style="background: transparent; color: #aaa; border: none; padding: 8px; cursor: pointer; text-decoration: underline;">닫기</button>
        </div>
    `;
    overlay.appendChild(box); document.body.appendChild(overlay);

    document.getElementById('mb-watch-ad').onclick = async () => {
        const auth = await getAuthInfo();
        const btn = document.getElementById('mb-watch-ad'); btn.innerText = "⏳ 보상 확인 중..."; btn.disabled = true;
        try {
            const response = await fetch("https://aimemorybank.cloud/api/billing/ad-reward", { method: "POST", headers: { "X-API-KEY": auth.apiKey } });
            if (response.ok) { const newCredits = await response.json(); chrome.storage.local.set({ dailyCredits: newCredits }); alert(`⚡ 충전 완료! 현재 번개: ${newCredits}개`); overlay.remove(); } else throw new Error("보상 실패");
        } catch (e) { alert("🚨 오류 발생"); overlay.remove(); }
    };
    document.getElementById('mb-upgrade-pro').onclick = async () => { const auth = await getAuthInfo(); window.open(`http://localhost:3000/billing?key=${auth.apiKey}`, '_blank'); overlay.remove(); };
    document.getElementById('mb-close-paywall').onclick = () => overlay.remove();
}

document.addEventListener('input', function (e) {
    const target = e.target;
    if (target.tagName?.toLowerCase() === 'textarea' || target.isContentEditable) {
        let text = target.value || target.innerText;
        if (text && text.startsWith('/m ')) { target.style.color = '#8a2be2'; target.style.fontWeight = 'bold'; }
        else { target.style.color = ''; target.style.fontWeight = ''; }
    }
});

document.addEventListener('keydown', async function (e) {
    if (isAutoSubmitting) return;
    if (isSearching) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }

    const target = e.target;
    if (target.tagName?.toLowerCase() === 'textarea' || target.isContentEditable) {
        if (e.key === 'Enter' && !e.shiftKey) {
            let text = target.value || target.innerText;
            if (text && text.startsWith('/m ')) {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                const question = text.replace('/m ', '').trim();
                if (question.length > 1) {
                    const auth = await getAuthInfo();
                    if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
                    const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
                    const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
                    if (currentCredits < CREDIT_COST.SEARCH) { showPaywallModal(`기억 검색(${CREDIT_COST.SEARCH}개 차감)`); return; }

                    isSearching = true; target.style.opacity = '0.4';

                    try {
                        const response = await fetch(`https://aimemorybank.cloud/api/memories/search?workspaceId=${auth.workspaceId}&question=${encodeURIComponent(question)}&topK=10&threshold=0.8`, { method: 'GET', headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey} });
                        if (response.status === 402) { showPaywallModal(`검색(${CREDIT_COST.SEARCH}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
                        if (!response.ok) throw new Error("서버 에러");

                        const result = await response.json();
                        chrome.storage.local.get(['dailyCredits'], (data) => { const c = data.dailyCredits !== undefined ? data.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SEARCH)}); });
                        const memoryText = result.data && result.data.length > 0 ? result.data.join('\n') : "No relevant memories found.";
                        const cleanPrompt = `Memory Bank\n[System Instruction: Answer based ONLY on the provided [Loaded Memory].]\n\n[Loaded Memory]\n${memoryText}\n\n[Question]\n${question}`.trim();
                        target.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, cleanPrompt);
                    } catch (error) { target.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, text); }
                    finally { target.style.opacity = '1'; isSearching = false; triggerEnter(target); }
                }
            }
        }
    }
}, true);

function triggerEnter(target) {
    setTimeout(() => {
        const sendButton = document.querySelector('button[data-testid="send-button"]');
        if (sendButton && !sendButton.disabled) sendButton.click();
        else { isAutoSubmitting = true; target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 })); isAutoSubmitting = false; }
        setTimeout(() => { if (target.value !== undefined) { target.value = ''; target.dispatchEvent(new Event('input', {bubbles: true})); } else if (target.isContentEditable) { target.innerText = ''; target.dispatchEvent(new Event('input', {bubbles: true})); } }, 150);
    }, 200);
}

function showFullScanOverlay(textLength) {
    let overlay = document.getElementById('mb-fullscan-overlay');
    if (!overlay) {
        overlay = document.createElement('div'); overlay.id = 'mb-fullscan-overlay';
        Object.assign(overlay.style, { position: 'fixed', bottom: '20px', left: '20px', backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: '12px 20px', borderRadius: '30px', zIndex: '99999', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' });
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<span style="font-size: 18px; animation: spin 2s linear infinite;">⏳</span> 스크롤하며 대화를 수집 중입니다... (${textLength.toLocaleString()}자 확보)`;
}

function hideFullScanOverlay() { const overlay = document.getElementById('mb-fullscan-overlay'); if (overlay) overlay.remove(); }

function showFullScanConfirmModal(scanData, auth, unifiedFlagKey, unlockCallback) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: '100000', display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)' });
    const box = document.createElement('div');
    Object.assign(box.style, { backgroundColor: 'white', padding: '30px', borderRadius: '16px', textAlign: 'center', width: '350px' });
    box.innerHTML = `
        <div style="font-size: 45px; margin-bottom: 10px;">📋</div>
        <h3 style="margin: 0 0 15px 0; color: #333;">스캔 완료!</h3>
        <div style="background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; padding: 15px; margin-bottom: 20px; text-align: left; font-size: 14px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="color: #666;">수집된 텍스트:</span><strong style="color: #333;">${scanData.textLength.toLocaleString()} 자</strong></div>
            <div style="display: flex; justify-content: space-between;"><span style="color: #666;">예상 번개 소모:</span><strong style="color: #ff9800;">${scanData.estimatedCredits} 개</strong></div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button id="mb-scan-cancel" style="flex: 1; background: #f1f3f4; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">취소</button>
            <button id="mb-scan-confirm" style="flex: 1; background: #8a2be2; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">저장 확정</button>
        </div>
    `;
    overlay.appendChild(box); document.body.appendChild(overlay);

    document.getElementById('mb-scan-cancel').onclick = () => { overlay.remove(); unlockCallback(); };
    document.getElementById('mb-scan-confirm').onclick = async () => {
        document.getElementById('mb-scan-confirm').innerText = "⏳ 서버 전송 중..."; document.getElementById('mb-scan-confirm').disabled = true; document.getElementById('mb-scan-cancel').style.display = 'none';
        try {
            const initRes = await fetch("https://aimemorybank.cloud/api/memories/full-save/init", {
                method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": auth.apiKey },
                body: JSON.stringify({ workspaceId: auth.workspaceId, rawContent: scanData.rawText, estimatedTokens: scanData.estimatedCredits })
            });
            if (initRes.status === 402) { overlay.remove(); showPaywallModal(`전체 저장(${scanData.estimatedCredits}개 차감)`); unlockCallback(); return; }
            if (!initRes.ok) throw new Error("접수 실패");
            const responseText = await initRes.text();
            const match = responseText.match(/ID: (\d+)/);
            if (match) { overlay.remove(); startJobPolling(match[1], auth, scanData, unifiedFlagKey, unlockCallback); } else throw new Error("Job ID 파싱 실패");
        } catch (error) { alert("🚨 오류 발생: " + error.message); overlay.remove(); unlockCallback(); }
    };
}

function startJobPolling(jobId, auth, scanData, unifiedFlagKey, unlockCallback) {
    showFullScanOverlay(0);
    document.getElementById('mb-fullscan-overlay').innerHTML = `<span style="font-size: 18px; animation: spin 2s linear infinite;">⏳</span> 서버에서 AI 대화 분석 및 저장 중입니다...`;
    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`https://aimemorybank.cloud/api/memories/full-save/${jobId}/status`, { headers: { "X-API-KEY": auth.apiKey } });
            if (!res.ok) return;
            const data = await res.json();
            if (data.status === "COMPLETED") {
                clearInterval(pollInterval); hideFullScanOverlay();
                chrome.storage.local.get(['dailyCredits'], (storageData) => { const c = storageData.dailyCredits !== undefined ? storageData.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - scanData.estimatedCredits)}); });
                localStorage.setItem(unifiedFlagKey, scanData.newFlag);
                alert("✅ 전체 대화 저장이 완료되었습니다!"); unlockCallback();
            } else if (data.status === "FAILED") {
                clearInterval(pollInterval); hideFullScanOverlay(); alert("🚨 서버 처리 중 에러가 발생했습니다."); unlockCallback();
            }
        } catch (e) { console.error("Polling check failed", e); }
    }, 3000);
}


function injectFloatingMenu() {
    if (document.getElementById('memory-bank-fab-container')) return;

    const fabContainer = document.createElement('div'); fabContainer.id = 'memory-bank-fab-container';
    Object.assign(fabContainer.style, { position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999', display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '10px' });

    const mainBtn = document.createElement('button'); mainBtn.innerHTML = '🧠'; mainBtn.id = 'mb-main-fab';
    Object.assign(mainBtn.style, { position: 'relative', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#8a2be2', color: 'white', border: 'none', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', transition: 'transform 0.3s ease, background-color 0.3s ease', display: 'flex', justifyContent: 'center', alignItems: 'center' });

    const spinnerRing = document.createElement('div'); spinnerRing.className = 'mb-busy-ring';
    mainBtn.appendChild(spinnerRing);

    const setupSubButton = (btn, text) => {
        btn.innerHTML = text;
        Object.assign(btn.style, { padding: '10px 16px', backgroundColor: '#ffffff', color: '#333', border: '1px solid #ddd', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', transition: 'all 0.15s ease-in-out', opacity: '0', transform: 'translateY(20px)', pointerEvents: 'none' });
    };

    const saveBtn = document.createElement('button'); setupSubButton(saveBtn, '💾 단일 저장');
    const loadBtn = document.createElement('button'); setupSubButton(loadBtn, '📥 기억 연동');
    const scanBtn = document.createElement('button'); setupSubButton(scanBtn, '🚀 전체 스캔');

    const setBusyState = (isBusy) => {
        window.mbIsBusy = isBusy;
        chrome.storage.local.set({ isSavingInProgress: isBusy });
        if (isBusy) {
            mainBtn.classList.add('mb-busy-mode');
            [saveBtn, loadBtn, scanBtn].forEach(b => { b.style.opacity = '0'; b.style.pointerEvents = 'none'; });
        } else { mainBtn.classList.remove('mb-busy-mode'); }
    };

    fabContainer.onmouseenter = async () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1.1)';

        const auth = await getAuthInfo();
        if (auth.userRole === 'FREE') { scanBtn.innerHTML = '🔒 전체 스캔'; scanBtn.style.color = '#9e9e9e'; }
        else { scanBtn.innerHTML = '✨ 전체 스캔'; scanBtn.style.color = '#333'; }

        [saveBtn, loadBtn, scanBtn].forEach((btn, index) => { btn.style.opacity = '1'; btn.style.transform = 'translateY(0) scale(1)'; btn.style.pointerEvents = 'auto'; btn.style.transitionDelay = `${index * 0.05}s`; });
    };

    fabContainer.onmouseleave = () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1)';
        [saveBtn, loadBtn, scanBtn].forEach((btn) => { btn.style.opacity = '0'; btn.style.transform = 'translateY(20px)'; btn.style.pointerEvents = 'none'; btn.style.transitionDelay = '0s'; });
    };

    // 🚀 [전체 스캔 버튼]
    scanBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;

        const auth = await getAuthInfo();
        if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
        if (auth.userRole === 'FREE') { alert("🔒 전체 대화 스캔 기능은 LITE 등급 이상부터 사용 가능합니다."); return; }

        setBusyState(true);
        const unlockScanBtn = () => { setBusyState(false); };

        const hostname = window.location.hostname;
        const currentPlatform = Object.keys(siteConfig).find(domain => hostname.includes(domain));
        if (!currentPlatform) { unlockScanBtn(); return; }

        const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
        const cleanPath = window.location.pathname.replace(/\/$/, ''); // URL 꼬리 슬래시 제거
        const unifiedFlagKey = `mb_unified_flag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPath}`;

        const stopFlagText = localStorage.getItem(unifiedFlagKey);
        // 🌟 나침반을 위한 꼬리말 매칭 (마지막 40글자)
        const safeTarget = stopFlagText ? stopFlagText.replace(/\s+/g, '').slice(-40) : null;

        showFullScanOverlay(0);

        try {
            let reachedFlag = false; let seenTexts = new Set(); let collectedChunks = []; let sameHeightCount = 0;
            window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 800));
            let currentScroll = window.scrollY || document.documentElement.scrollTop;
            let newFlagText = null;

            while (!reachedFlag) {
                const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                let chunkForThisView = [];
                for (let i = bubbles.length - 1; i >= 0; i--) {
                    let text = bubbles[i].innerText.trim().replace(/말씀하신 내용\n*/g, '').replace(/^말씀하신 내용$/gm, '');
                    if (!newFlagText && text.length > 0) newFlagText = text;

                    // 🌟 정밀한 꼬리말 패턴 매칭
                    if (safeTarget && text.replace(/\s+/g, '').includes(safeTarget)) { reachedFlag = true; break; }

                    if (text.length > 0 && !seenTexts.has(text)) { seenTexts.add(text); chunkForThisView.unshift(text); }
                }
                if (chunkForThisView.length > 0) { collectedChunks.unshift(chunkForThisView.join('\n\n')); showFullScanOverlay(collectedChunks.join('\n\n').length); }
                if (reachedFlag) break;

                window.scrollBy(0, -window.innerHeight * 0.8); await new Promise(r => setTimeout(r, 600));
                let newScroll = window.scrollY || document.documentElement.scrollTop;
                if (newScroll === currentScroll) { sameHeightCount++; if (sameHeightCount >= 2) break; } else sameHeightCount = 0;
                currentScroll = newScroll;
            }

            window.scrollTo(0, document.body.scrollHeight); hideFullScanOverlay();
            const rawFinalText = collectedChunks.join('\n\n'); const textLength = rawFinalText.length;
            if (textLength < 10) { alert("새로 스캔할 대화 내용이 없습니다."); unlockScanBtn(); return; }

            const estimatedCredits = Math.ceil(textLength / 500) * 3;
            showFullScanConfirmModal({ rawText: rawFinalText, textLength, estimatedCredits, newFlag: newFlagText }, auth, unifiedFlagKey, unlockScanBtn);

        } catch (error) { hideFullScanOverlay(); alert("스캔 중 오류 발생"); unlockScanBtn(); }
    };

    // 💾 [단일 저장 버튼]
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
            const unlockSaveBtn = () => { setBusyState(false); };

            const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
            const cleanPath = window.location.pathname.replace(/\/$/, '');
            const unifiedFlagKey = `mb_unified_flag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPath}`;
            const lastSavedText = localStorage.getItem(unifiedFlagKey);
            const safeTarget = lastSavedText ? lastSavedText.replace(/\s+/g, '').slice(-40) : null;

            let startIndex = 0, foundAnchor = false;
            if (safeTarget) {
                for (let i = allBubbles.length - 1; i >= 0; i--) {
                    if (allBubbles[i].innerText.trim().replace(/\s+/g, '').includes(safeTarget)) { startIndex = i + 1; foundAnchor = true; break; }
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

            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST", headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey},
                body: JSON.stringify({ workspaceId: auth.workspaceId, content: cleanedBubbles.join('\n\n'), type: "FULL_CONV" })
            });

            if (response.status === 402) { showPaywallModal(`저장(${CREDIT_COST.SAVE}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 에러");

            chrome.storage.local.get(['dailyCredits'], (data) => { const c = data.dailyCredits !== undefined ? data.dailyCredits : 0; chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SAVE)}); });

            // 🌟 플래그 업데이트
            localStorage.setItem(unifiedFlagKey, allBubbles[allBubbles.length - 1].innerText.trim());

            alert("✅ 대화가 성공적으로 저장되었습니다!");
            unlockSaveBtn();
        } catch (error) { if(error.message !== "INSUFFICIENT_CREDITS") unlockSaveBtn(); }
    };

    // 📥 [기억 연동 버튼]
    loadBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
            const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
            const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
            if (currentCredits < CREDIT_COST.SYNC) { showPaywallModal(`연동(${CREDIT_COST.SYNC}개 차감)`); return; }

            setBusyState(true);
            const unlockLoadBtn = () => { setBusyState(false); };

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

    fabContainer.appendChild(scanBtn); fabContainer.appendChild(loadBtn); fabContainer.appendChild(saveBtn); fabContainer.appendChild(mainBtn); document.body.appendChild(fabContainer);
}

setInterval(injectFloatingMenu, 1000);

// 🧭 [스마트 나침반 및 뱃지 시스템: 꼬리말 매칭 알고리즘 적용]
function injectBookmarkNavigator() {
    chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'userEmail'], function(auth) {
        if (!auth.memoryBankApiKey) return;

        const hostname = window.location.hostname;
        const cleanPath = window.location.pathname.replace(/\/$/, '');
        const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
        const unifiedFlagKey = `mb_unified_flag_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPath}`;

        const targetText = localStorage.getItem(unifiedFlagKey);
        if (!targetText) return;

        const currentPlatform = Object.keys(siteConfig).find(domain => hostname.includes(domain));
        if (!currentPlatform) return;

        const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
        let targetBubble = null;

        // 🌟 꼬리말(마지막 40자) 패턴 매칭으로 가상 DOM 방어력 극대화
        const safeTarget = targetText.replace(/\s+/g, '').slice(-40);

        for (let i = bubbles.length - 1; i >= 0; i--) {
            let text = bubbles[i].innerText.trim().replace(/말씀하신 내용\n*/g, '').replace(/^말씀하신 내용$/gm, '');
            if (text.replace(/\s+/g, '').includes(safeTarget)) { targetBubble = bubbles[i]; break; }
        }

        // 말풍선 뱃지
        if (targetBubble && !targetBubble.dataset.mbFlagged) {
            targetBubble.dataset.mbFlagged = "true";
            targetBubble.style.border = "2px dashed #8a2be2";
            targetBubble.style.position = "relative";

            const badge = document.createElement('div');
            badge.innerHTML = "💾 마지막 저장 위치";
            Object.assign(badge.style, {
                position: 'absolute', top: '-14px', right: '0px', backgroundColor: '#8a2be2', color: 'white', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', zIndex: '10'
            });
            targetBubble.appendChild(badge);
        }

        // 나침반 컨트롤
        let compass = document.getElementById('mb-bookmark-compass');
        if (!compass) {
            compass = document.createElement('button');
            compass.id = 'mb-bookmark-compass';
            Object.assign(compass.style, {
                position: 'fixed', left: '20px', top: '50%', transform: 'translateY(-50%)', backgroundColor: '#ffffff', border: '2px solid #8a2be2', color: '#8a2be2', padding: '10px 15px', borderRadius: '30px', fontSize: '12px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.15)', zIndex: '999999', display: 'none', alignItems: 'center'
            });
            document.body.appendChild(compass);
        }

        if (!targetBubble) {
            compass.innerHTML = "⬆️ 이전 저장 위치 (위로 스크롤)"; compass.style.display = 'flex';
            compass.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            const rect = targetBubble.getBoundingClientRect();
            compass.onclick = () => targetBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (rect.bottom < 0) { compass.innerHTML = "⬆️ 저장 위치"; compass.style.display = 'flex'; }
            else if (rect.top > window.innerHeight) { compass.innerHTML = "⬇️ 저장 위치"; compass.style.display = 'flex'; }
            else { compass.style.display = 'none'; }
        }
    });
}
setInterval(injectBookmarkNavigator, 1000);

// 맨 위로 스크롤 버튼
function injectScrollToTopButton() {
    if (document.getElementById('memory-bank-scroll-btn')) return;
    const scrollBtn = document.createElement('button'); scrollBtn.id = 'memory-bank-scroll-btn'; scrollBtn.innerHTML = '🔝';
    Object.assign(scrollBtn.style, { position: 'fixed', bottom: '20px', left: '20px', zIndex: '99999', padding: '10px 15px', backgroundColor: '#607d8b', color: 'white', border: 'none', borderRadius: '50px', fontSize: '15px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', opacity: '0.8' });
    scrollBtn.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
    document.body.appendChild(scrollBtn);
}
setInterval(injectScrollToTopButton, 1000);