console.log("🚀 AI Memory Bank Load (V22: 하드웨어 락 & 버튼 꾹 눌림 효과 적용)");

const CREDIT_COST = {
    SEARCH: 1,
    SYNC: 2,
    SAVE: 3
};

// 🌟 글로벌 통신 락 (중복 클릭 원천 차단)
window.isMbSaving = false;
window.isMbSyncing = false;
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
        chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'userEmail'], function(result) {
            resolve({
                apiKey: result.memoryBankApiKey,
                workspaceId: result.currentWorkspaceId,
                userEmail: result.userEmail
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: '100000',
        display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: 'white', padding: '30px', borderRadius: '16px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)', textAlign: 'center', width: '320px', animation: 'slideUp 0.3s ease-out'
    });
    box.innerHTML = `
        <div style="font-size: 40px; margin-bottom: 10px;">🔒</div>
        <h3 style="margin: 0 0 10px 0; color: #333;">로그인이 필요합니다</h3>
        <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">안전한 데이터 백업을 위해<br>로그인이 필요합니다.</p>
        <button id="mb-close-prompt" style="background: #8a2be2; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%;">확인</button>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('mb-close-prompt').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); }
}

function showPaywallModal(actionType) {
    if (document.getElementById('mb-paywall-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mb-paywall-modal';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: '100000',
        display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(3px)'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: 'white', padding: '30px', borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)', textAlign: 'center', width: '320px',
        animation: 'slideUp 0.3s ease-out'
    });

    box.innerHTML = `
        <div style="font-size: 45px; margin-bottom: 10px;">⚡</div>
        <h3 style="margin: 0 0 10px 0; color: #333;">번개가 부족합니다!</h3>
        <p style="color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
            ${actionType}에 필요한 크레딧이 부족합니다.<br>광고를 시청하거나 Premium으로 업그레이드하세요.
        </p>
        <div style="display: flex; gap: 12px; flex-direction: column;">
            <button id="mb-watch-ad" style="background: linear-gradient(135deg, #ff9800, #f44336); color: white; border: none; padding: 14px; border-radius: 10px; font-weight: 800; cursor: pointer; transition: 0.3s; box-shadow: 0 4px 15px rgba(255, 152, 0, 0.4);">📺 동영상 광고 보고 번개 +15 충전</button>
            <button id="mb-upgrade-pro" style="background: #8a2be2; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s;">👑 Premium 무제한 업그레이드</button>
            <button id="mb-close-paywall" style="background: transparent; color: #aaa; border: none; padding: 8px; cursor: pointer; font-size: 12px; text-decoration: underline;">다음에 할게요</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('mb-watch-ad').onclick = async () => {
        const auth = await getAuthInfo();
        const btn = document.getElementById('mb-watch-ad');
        btn.innerText = "⏳ 보상 확인 중...";
        btn.disabled = true;

        try {
            const response = await fetch("https://aimemorybank.cloud/api/billing/ad-reward", {
                method: "POST", headers: { "X-API-KEY": auth.apiKey }
            });

            if (response.ok) {
                const newCredits = await response.json();
                chrome.storage.local.set({ dailyCredits: newCredits });
                alert(`⚡ 충전 완료! 현재 번개: ${newCredits}개`);
                overlay.remove();
            } else throw new Error("보상 처리 실패");
        } catch (e) {
            alert("🚨 보상 처리 중 오류가 발생했습니다.");
            btn.disabled = false; btn.innerText = "📺 광고 보고 번개 +15 충전";
        }
    };

    document.getElementById('mb-upgrade-pro').onclick = async () => {
        const auth = await getAuthInfo();
        window.open(`http://localhost:3000/billing?key=${auth.apiKey}`, '_blank');
        overlay.remove();
    };

    document.getElementById('mb-close-paywall').onclick = () => overlay.remove();
}

document.addEventListener('input', function (e) {
    const target = e.target;
    if (target.tagName?.toLowerCase() === 'textarea' || target.isContentEditable) {
        let text = target.value || target.innerText;
        if (text && text.startsWith('/m ')) {
            target.style.color = '#8a2be2'; target.style.fontWeight = 'bold';
        } else {
            target.style.color = ''; target.style.fontWeight = '';
        }
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
                    if (currentCredits < CREDIT_COST.SEARCH) {
                        showPaywallModal(`기억 검색(${CREDIT_COST.SEARCH}개 차감)`); return;
                    }

                    isSearching = true;
                    const rect = target.getBoundingClientRect();
                    const loader = document.createElement('div');
                    loader.id = 'mb-searching-loader';
                    Object.assign(loader.style, {
                        position: 'absolute', top: `${rect.top + window.scrollY}px`, left: `${rect.left + window.scrollX}px`, width: `${rect.width}px`, height: `${rect.height}px`,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)', color: '#8a2be2', fontSize: '14px', fontWeight: 'bold', display: 'flex', justifyContent: 'center', alignItems: 'center',
                        borderRadius: window.getComputedStyle(target).borderRadius, zIndex: '10000', pointerEvents: 'auto', userSelect: 'none', border: '2px solid rgba(138, 43, 226, 0.3)'
                    });
                    loader.innerHTML = `⏳ AI Memory Bank Searching...`;
                    document.body.appendChild(loader);
                    target.style.opacity = '0.4';

                    try {
                        const response = await fetch(`https://aimemorybank.cloud/api/memories/search?workspaceId=${auth.workspaceId}&question=${encodeURIComponent(question)}&topK=10&threshold=0.8`, {
                            method: 'GET', headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey}
                        });

                        if (response.status === 402) { showPaywallModal(`기억 검색(${CREDIT_COST.SEARCH}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
                        if (!response.ok) throw new Error("서버 에러");

                        const result = await response.json();
                        chrome.storage.local.get(['dailyCredits'], (data) => {
                            const c = data.dailyCredits !== undefined ? data.dailyCredits : 0;
                            chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SEARCH)});
                        });

                        const memoryText = result.data && result.data.length > 0 ? result.data.join('\n') : "No relevant memories found.";
                        const cleanPrompt = `Memory Bank\n[System Instruction: You are my personal assistant. Answer my question based ONLY on the provided [Loaded Memory] data below. If you don't know the answer based on the data, simply say "I don't know. Please rewrite the question.".]\n\n[Loaded Memory]\n${memoryText}\n\n[Question]\n${question}`.trim();

                        target.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, cleanPrompt);
                    } catch (error) {
                        target.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, text);
                    } finally {
                        if (document.getElementById('mb-searching-loader')) document.getElementById('mb-searching-loader').remove();
                        target.style.opacity = '1'; isSearching = false; triggerEnter(target);
                    }
                }
            }
        }
    }
}, true);

function triggerEnter(target) {
    setTimeout(() => {
        const sendButton = document.querySelector('button[data-testid="send-button"]');
        if (sendButton && !sendButton.disabled) sendButton.click();
        else {
            isAutoSubmitting = true;
            const enterEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 });
            target.dispatchEvent(enterEvent);
            isAutoSubmitting = false;
        }
        setTimeout(() => {
            if (target.value !== undefined) { target.value = ''; target.dispatchEvent(new Event('input', {bubbles: true})); }
            else if (target.isContentEditable) { target.innerText = ''; target.dispatchEvent(new Event('input', {bubbles: true})); }
        }, 150);
    }, 200);
}

function injectFloatingMenu() {
    if (document.getElementById('memory-bank-fab-container')) return;

    const fabContainer = document.createElement('div');
    fabContainer.id = 'memory-bank-fab-container';
    Object.assign(fabContainer.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '9999',
        display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '10px'
    });

    const mainBtn = document.createElement('button');
    mainBtn.innerHTML = '🧠';
    Object.assign(mainBtn.style, {
        position: 'relative', width: '56px', height: '56px', borderRadius: '50%',
        backgroundColor: '#8a2be2', color: 'white', border: 'none',
        fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        transition: 'transform 0.3s ease, background-color 0.3s ease',
        display: 'flex', justifyContent: 'center', alignItems: 'center'
    });

    const progressLabel = document.createElement('div');
    Object.assign(progressLabel.style, {
        position: 'absolute', bottom: '-26px', fontSize: '11px', fontWeight: '900',
        color: '#8a2be2', backgroundColor: '#ffffff', padding: '3px 10px', borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)', border: '1px solid #8a2be2',
        opacity: '0', transition: 'opacity 0.3s', whiteSpace: 'nowrap',
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", letterSpacing: '0.5px'
    });
    mainBtn.appendChild(progressLabel);

    const setupSubButton = (btn, text) => {
        btn.innerHTML = text;
        Object.assign(btn.style, {
            padding: '10px 16px', backgroundColor: '#ffffff', color: '#333', border: '1px solid #ddd', borderRadius: '20px',
            fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            transition: 'all 0.15s ease-in-out', opacity: '0', transform: 'translateY(20px)', pointerEvents: 'none', whiteSpace: 'nowrap'
        });
        btn.onmouseover = () => { if (btn.disabled || btn.dataset.locked === 'true') return; btn.style.backgroundColor = '#f3e5f5'; btn.style.borderColor = '#8a2be2'; };
        btn.onmouseout = () => { if (btn.disabled || btn.dataset.locked === 'true') return; btn.style.backgroundColor = '#ffffff'; btn.style.borderColor = '#ddd'; };
    };

    const saveBtn = document.createElement('button'); setupSubButton(saveBtn, '💾 대화 저장');
    const loadBtn = document.createElement('button'); setupSubButton(loadBtn, '📥 기억 연동');

    fabContainer.onmouseenter = () => {
        if(mainBtn.dataset.saving === 'true') return;
        mainBtn.style.transform = 'scale(1.1)';
        [saveBtn, loadBtn].forEach((btn, index) => { btn.style.opacity = '1'; btn.style.transform = 'translateY(0) scale(1)'; btn.style.pointerEvents = 'auto'; btn.style.transitionDelay = `${index * 0.05}s`; });
    };

    fabContainer.onmouseleave = () => {
        mainBtn.style.transform = 'scale(1)';
        [saveBtn, loadBtn].forEach((btn) => { btn.style.opacity = '0'; btn.style.transform = 'translateY(20px)'; btn.style.pointerEvents = 'none'; btn.style.transitionDelay = '0s'; });
    };

    // 🌟 [대화 저장 버튼 클릭 이벤트] - 강력한 락과 애니메이션 적용
    saveBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation(); // 1. 부모로 이벤트 퍼지는 것 방지

        // 2. 이미 작업 중이면 클릭 원천 무시
        if (window.isMbSaving || saveBtn.dataset.locked === 'true') return;
        window.isMbSaving = true;
        saveBtn.dataset.locked = 'true';

        // 3. 버튼 꾹! 눌리는 물리적 시각 효과
        saveBtn.style.transform = 'scale(0.9)';
        setTimeout(() => { saveBtn.style.transform = 'scale(1)'; }, 150);

        saveBtn.disabled = true;
        saveBtn.innerHTML = "⏳ 준비 중...";
        saveBtn.style.backgroundColor = '#f3e5f5';

        const unlockSaveBtn = () => {
            window.isMbSaving = false; saveBtn.disabled = false; saveBtn.dataset.locked = 'false';
            saveBtn.innerHTML = "💾 대화 저장"; saveBtn.style.backgroundColor = '#ffffff';
        };

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); unlockSaveBtn(); return; }

            const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
            const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
            if (currentCredits < CREDIT_COST.SAVE) { showPaywallModal(`대화 저장(${CREDIT_COST.SAVE}개 차감)`); unlockSaveBtn(); return; }

            const hostname = window.location.hostname;
            const pathname = window.location.pathname;
            let isTemporary = false;
            if (hostname.includes("chatgpt.com") && !pathname.startsWith("/c/")) isTemporary = true;
            if (hostname.includes("gemini.google.com") && (pathname === "/app" || pathname === "/app/" || pathname === "/")) isTemporary = true;
            if (hostname.includes("claude.ai") && !pathname.startsWith("/chat/")) isTemporary = true;
            if (hostname.includes("grok.com") && pathname === "/") isTemporary = true;
            if (hostname.includes("chat.deepseek.com") && pathname === "/") isTemporary = true;

            if (isTemporary) { alert("🚨 임시 채팅방에서는 저장을 지원하지 않습니다."); unlockSaveBtn(); return; }

            const currentPlatform = Object.keys(siteConfig).find(domain => hostname.includes(domain));
            if (!currentPlatform) { unlockSaveBtn(); return; }

            const allBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
            if (allBubbles.length === 0) { unlockSaveBtn(); return; }

            const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
            const storageKey = `mb_${safeEmail}_${auth.workspaceId}_${hostname}_${pathname}`;
            const storageTextKey = `mb_text_${safeEmail}_${auth.workspaceId}_${hostname}_${pathname}`;

            let roomLastIndex = parseInt(localStorage.getItem(storageKey)) || 0;
            let lastSavedText = localStorage.getItem(storageTextKey);
            let startIndex = 0, foundAnchor = false;

            if (lastSavedText) {
                for (let i = allBubbles.length - 1; i >= 0; i--) {
                    if (allBubbles[i].innerText.trim() === lastSavedText) { startIndex = i + 1; foundAnchor = true; break; }
                }
            }
            if (!foundAnchor) startIndex = (allBubbles.length < roomLastIndex) ? Math.max(0, allBubbles.length - 2) : roomLastIndex;

            const newBubbles = Array.from(allBubbles).slice(startIndex);
            if (newBubbles.length === 0) { alert("✅ 이미 모든 대화가 저장되어 있습니다."); unlockSaveBtn(); return; }

            const cleanedBubbles = [];
            for (let bubble of newBubbles) {
                let text = bubble.innerText.trim().replace(/말씀하신 내용\n*/g, '').replace(/^말씀하신 내용$/gm, '');
                let uniqueLines = [...new Set(text.split('\n').map(l => l.trim()).filter(l => l.length > 0))];
                let finalText = uniqueLines.join('\n');
                if (finalText.length > 0 && !cleanedBubbles.includes(finalText)) cleanedBubbles.push(finalText);
            }

            let newConversationText = cleanedBubbles.join('\n\n');
            if (!newConversationText) { unlockSaveBtn(); return; }

            saveBtn.innerHTML = "⏳ AI 통신 중...";
            mainBtn.dataset.saving = 'true';
            mainBtn.style.transform = 'scale(1)';
            [saveBtn, loadBtn].forEach((btn) => { btn.style.opacity = '0'; btn.style.transform = 'translateY(20px)'; btn.style.pointerEvents = 'none'; });

            const preventClose = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
            window.addEventListener('beforeunload', preventClose);
            chrome.storage.local.set({isSavingInProgress: true});

            progressLabel.style.opacity = '1';
            let fakePercent = 0;
            const progressInterval = setInterval(() => {
                if (fakePercent < 50) fakePercent += Math.floor(Math.random() * 8) + 5;
                else if (fakePercent < 85) fakePercent += Math.floor(Math.random() * 5) + 1;
                else if (fakePercent < 99) fakePercent += 1;
                progressLabel.innerText = `${fakePercent}%`;
            }, 400);

            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST", headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey},
                body: JSON.stringify({ workspaceId: auth.workspaceId, content: newConversationText, type: "FULL_CONV" })
            });

            if (response.status === 402) { showPaywallModal(`대화 저장(${CREDIT_COST.SAVE}개 차감)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 에러");

            chrome.storage.local.get(['dailyCredits'], (data) => {
                const c = data.dailyCredits !== undefined ? data.dailyCredits : 0;
                chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SAVE)});
            });

            localStorage.setItem(storageKey, allBubbles.length);
            localStorage.setItem(storageTextKey, allBubbles[allBubbles.length - 1].innerText.trim());

            clearInterval(progressInterval);
            progressLabel.innerText = `100%`; progressLabel.style.color = '#4caf50'; progressLabel.style.borderColor = '#4caf50';
            setTimeout(() => { alert("✅ 대화가 성공적으로 AI 메모리 뱅크에 저장되었습니다!"); }, 300);

            window.removeEventListener('beforeunload', preventClose);
            chrome.storage.local.set({isSavingInProgress: false});
            setTimeout(() => {
                mainBtn.dataset.saving = 'false';
                progressLabel.style.opacity = '0'; progressLabel.style.color = '#8a2be2'; progressLabel.style.borderColor = '#8a2be2';
                unlockSaveBtn();
            }, 3000);

        } catch (error) {
            if (error.message !== "INSUFFICIENT_CREDITS") alert("🚨 저장 중 오류가 발생했습니다.");
            chrome.storage.local.set({isSavingInProgress: false});
            mainBtn.dataset.saving = 'false';
            progressLabel.style.opacity = '0';
            unlockSaveBtn();
        }
    };

    // 🌟 [연동 버튼 클릭 이벤트] - 강력한 락과 애니메이션 적용
    const syncLimit = 50;
    loadBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();

        if (window.isMbSyncing || loadBtn.dataset.locked === 'true') return;
        window.isMbSyncing = true;
        loadBtn.dataset.locked = 'true';

        loadBtn.style.transform = 'scale(0.9)';
        setTimeout(() => { loadBtn.style.transform = 'scale(1)'; }, 150);

        loadBtn.disabled = true;
        loadBtn.innerHTML = "⏳ 준비 중...";
        loadBtn.style.backgroundColor = '#f3e5f5';

        const unlockLoadBtn = () => {
            window.isMbSyncing = false; loadBtn.disabled = false; loadBtn.dataset.locked = 'false';
            loadBtn.innerHTML = "📥 기억 연동"; loadBtn.style.backgroundColor = '#ffffff';
        };

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); unlockLoadBtn(); return; }

            const creditData = await new Promise(resolve => chrome.storage.local.get(['dailyCredits'], resolve));
            const currentCredits = creditData.dailyCredits !== undefined ? creditData.dailyCredits : 0;
            if (currentCredits < CREDIT_COST.SYNC) {
                showPaywallModal(`기억 연동(${CREDIT_COST.SYNC}개 차감)`);
                unlockLoadBtn(); return;
            }

            const hostname = window.location.hostname; const pathname = window.location.pathname;
            const safeEmail = auth.userEmail ? auth.userEmail.replace(/[^a-zA-Z0-9]/g, "") : "unknown";
            const syncStorageKey = `mb_sync_${safeEmail}_${auth.workspaceId}_${hostname}_${pathname}`;
            let lastId = parseInt(localStorage.getItem(syncStorageKey));
            if (isNaN(lastId)) lastId = 0;

            await executeSyncChunk(syncStorageKey, lastId, 0, auth, unlockLoadBtn);
        } catch(e) {
            unlockLoadBtn();
        }
    };

    async function executeSyncChunk(storageKey, lastId, sessionLoadedCount, auth, unlockCallback) {
        loadBtn.style.backgroundColor = '#9e9e9e'; loadBtn.style.color = 'white'; loadBtn.innerHTML = `⏳ 새로운 기억 동기화 중...`;
        try {
            const response = await fetch(`https://aimemorybank.cloud/api/memories/sync?workspaceId=${auth.workspaceId}&lastId=${lastId}&limit=${syncLimit}`, {
                method: 'GET', headers: {"Content-Type": "application/json", "X-API-KEY": auth.apiKey}
            });

            if (response.status === 402) {
                showPaywallModal(`기억 연동(${CREDIT_COST.SYNC}개 차감)`);
                throw new Error("INSUFFICIENT_CREDITS");
            }
            if (!response.ok) throw new Error("서버 응답 에러");

            const result = await response.json();
            const memories = result.data || [];
            if (memories.length === 0) {
                alert("✅ 모든 최신 기억이 동기화되어 있습니다.");
                if(unlockCallback) unlockCallback();
                return;
            }

            chrome.storage.local.get(['dailyCredits'], (data) => {
                const c = data.dailyCredits !== undefined ? data.dailyCredits : 0;
                chrome.storage.local.set({dailyCredits: Math.max(0, c - CREDIT_COST.SYNC)});
            });

            const newLastId = memories[memories.length - 1].id;
            const memoryContents = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
            const cleanSyncPrompt = `[System Instruction: Memorize the following data and reply strictly with "Yes, I have updated my memory." Do not summarize or add any other text.]\n\n---\n[Loaded Memory Chunk]\n${memoryContents}`.trim();
            const inputTarget = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');

            if (inputTarget) {
                inputTarget.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, cleanSyncPrompt); triggerEnter(inputTarget);
                localStorage.setItem(storageKey, newLastId);
                if (result.hasMore) {
                    showSyncDialog(sessionLoadedCount + memories.length, sessionLoadedCount + memories.length + result.remainingCount, storageKey, newLastId, auth, unlockCallback);
                } else {
                    loadBtn.style.backgroundColor = '#4caf50'; loadBtn.style.color = 'white'; loadBtn.innerHTML = "✅ 동기화 완료";
                    setTimeout(() => { if(unlockCallback) unlockCallback(); }, 2000);
                }
            }
        } catch (error) {
            loadBtn.style.backgroundColor = '#f44336'; loadBtn.innerHTML = "❌ 연동 실패";
            setTimeout(() => { if(unlockCallback) unlockCallback(); }, 2000);
        }
    }

    function showSyncDialog(loadedThisTime, totalToLoad, storageKey, nextLastId, auth, unlockCallback) {
        const existingDialog = document.getElementById('memory-sync-dialog'); if (existingDialog) existingDialog.remove();
        const dialog = document.createElement('div'); dialog.id = 'memory-sync-dialog';
        Object.assign(dialog.style, { position: 'absolute', bottom: '80px', right: '0', width: '260px', backgroundColor: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', border: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '10px', animation: 'slideUp 0.3s ease-out' });
        const percent = Math.min(100, Math.round((loadedThisTime / totalToLoad) * 100));
        dialog.innerHTML = `<div style=\"font-size: 13px; font-weight: bold; color: #333;\">📦 추가 데이터 발견! (진행률: <span style=\"color:#8a2be2\">${percent}%</span>)</div><div style=\"width: 100%; height: 6px; background-color: #eee; border-radius: 3px; overflow: hidden;\"><div style=\"width: ${percent}%; height: 100%; background-color: #8a2be2; transition: width 0.3s ease;\"></div></div><div style=\"font-size: 11px; color: #666; margin-bottom: 5px;\">정보가 많아 분할해서 가져옵니다. 남은 ${totalToLoad - loadedThisTime}개를 이어서 주입할까요?</div>`;
        const btnContainer = document.createElement('div'); btnContainer.style.display = 'flex'; btnContainer.style.gap = '8px';
        const nextBtn = document.createElement('button'); nextBtn.innerHTML = '🔄 더 가져오기'; Object.assign(nextBtn.style, { flex: '1', padding: '8px 0', backgroundColor: '#8a2be2', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' });
        nextBtn.onclick = () => { dialog.remove(); executeSyncChunk(storageKey, nextLastId, loadedThisTime, auth, unlockCallback); };
        const stopBtn = document.createElement('button'); stopBtn.innerHTML = '🛑 여기까지'; Object.assign(stopBtn.style, { flex: '1', padding: '8px 0', backgroundColor: '#f1f3f4', color: '#333', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' });
        stopBtn.onclick = () => { dialog.remove(); if(unlockCallback) unlockCallback(); };
        btnContainer.appendChild(nextBtn); btnContainer.appendChild(stopBtn); dialog.appendChild(btnContainer); document.getElementById('memory-bank-fab-container').appendChild(dialog);
    }

    fabContainer.appendChild(loadBtn); fabContainer.appendChild(saveBtn); fabContainer.appendChild(mainBtn); document.body.appendChild(fabContainer);
}

setInterval(injectFloatingMenu, 1000);

function injectScrollToTopButton() {
    if (document.getElementById('memory-bank-scroll-btn')) return;
    const scrollBtn = document.createElement('button'); scrollBtn.id = 'memory-bank-scroll-btn'; scrollBtn.innerHTML = '⬆️ 맨 위로';
    Object.assign(scrollBtn.style, { position: 'fixed', bottom: '20px', left: '20px', zIndex: '9999', padding: '10px 15px', backgroundColor: '#607d8b', color: 'white', border: 'none', borderRadius: '50px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', opacity: '0.8' });
    scrollBtn.onclick = () => {
        if (document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) window.scrollTo({top: 0, behavior: 'smooth'});
        document.querySelectorAll('*').forEach(el => { if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) { el.scrollTo({top: 0, behavior: 'smooth'}); } });
    };
    document.body.appendChild(scrollBtn);
}
setInterval(injectScrollToTopButton, 1000);