console.log("🚀 AI Memory Bank Load (V44: 인페이지 모달 스캔 현황 UI 및 모던 디자인 적용)");

// =========================================================
// 1. 스타일 주입
// =========================================================
const style = document.createElement('style');
style.textContent = `
    @keyframes mb-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes float-up-fade { 0% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -40px); } }

    .mb-busy-ring { position: absolute; top: -4px; left: -4px; right: -4px; bottom: -4px; border: 4px solid transparent; border-top-color: #3b82f6; border-right-color: #3b82f6; border-radius: 50%; animation: mb-spin 1s linear infinite; pointer-events: none; display: none; }
    .mb-busy-mode .mb-busy-ring { display: block; }
    .mb-busy-mode { transform: scale(1) !important; background-color: #9ca3af !important; }

    #mb-fullscan-lockdown { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0,0,0,0.85); z-index: 2147483647; display: flex; flex-direction: column; justify-content: center; align-items: center; backdrop-filter: blur(8px); color: white; text-align: center; }
    
    .mb-slash-mode { color: #3b82f6 !important; font-weight: bold !important; transition: color 0.3s ease; }
    .mb-input-blocker { position: absolute; background-color: rgba(255,255,255,0.9); display: flex; justify-content: center; align-items: center; z-index: 2147483647; font-size: 14px; font-weight: bold; color: #3b82f6; backdrop-filter: blur(4px); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); cursor: not-allowed; }
`;
document.head.appendChild(style);

// =========================================================
// 2. 상수 및 전역 상태
// =========================================================
const CREDIT_COST = { SEARCH: 1, SYNC: 1, SAVE: 1 };
const API_BASE = "https://aimemorybank.cloud/api";

const siteConfig = {
    "chatgpt.com": '[data-message-author-role]',
    "gemini.google.com": 'user-query, model-response',
    "claude.ai": '.font-user-message, .font-claude-message',
    "grok.com": '.prose, .message-row, [data-testid="message-content"]',
    "chat.deepseek.com": '.ds-markdown, .fbb737a4, .text-message'
};

chrome.storage.local.set({ isSavingInProgress: false });
window.mbIsBusy = false;
window.addEventListener('beforeunload', () => {
    if (window.mbIsBusy) chrome.storage.local.set({ isSavingInProgress: false });
});

// =========================================================
// 3. 유틸리티 함수
// =========================================================
function calculateFullScanCredits(textLength) {
    return Math.max(1, Math.ceil(textLength / 10000));
}

function getCleanedText(element) {
    if (!element) return "";
    return element.innerText.trim()
        .replace(/말씀하신 내용\n*/g, '')
        .replace(/^말씀하신 내용$/gm, '')
        .replace(/\n복사하기\n/g, '')
        .replace(/\n공유하기\n/g, '');
}

function normalizeForMatch(text) {
    return text ? text.replace(/[^가-힣a-zA-Z0-9]/g, '') : "";
}

function isSystemPrompt(text) {
    if (!text) return false;
    const clean = text.trim();
    return clean.startsWith("Memory Bank\n[System Instruction:") ||
        clean.startsWith("[System Instruction: Memorize the following");
}

function getCurrentPlatform() {
    const hostname = window.location.hostname;
    return Object.keys(siteConfig).find(d => hostname.includes(d)) || null;
}

function getFlagKey(auth) {
    const hostname = window.location.hostname;
    const cleanPath = window.location.pathname.split('/').filter(Boolean).join('_');
    const safeEmail = auth.userEmail?.replace(/[^a-zA-Z0-9]/g, "") ?? "guest";
    return `mb_flag_v3_${safeEmail}_${auth.workspaceId}_${hostname}_${cleanPath}`;
}

function getAuthInfo() {
    return new Promise(resolve => {
        chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'userEmail', 'userRole', 'hasStarterPack'], result => {
            resolve({
                apiKey: result.memoryBankApiKey,
                workspaceId: result.currentWorkspaceId,
                userEmail: result.userEmail,
                userRole: result.userRole || 'FREE',
                hasStarterPack: result.hasStarterPack || false
            });
        });
    });
}

function showLoginPrompt() {
    alert("Memory Bank 익스텐션 팝업을 열어 먼저 로그인해주세요!");
}

function showPaywallModal(actionType) {
    const msg = `⚡ 충전된 번개가 모두 소진되었습니다! (요청 작업: ${actionType})\n\n흐름이 끊기셨나요? LITE 요금제로 업그레이드하고 매일 100개의 번개를 받아보세요!\n\n[확인]을 누르시면 안전한 결제 페이지로 즉시 이동합니다.`;

    if (confirm(msg)) {
        getAuthInfo().then(auth => {
            if (auth.userEmail) {
                const checkoutUrl = `https://memory-bank.lemonsqueezy.com/checkout/buy/48419913-7c97-4859-b3b6-50438e33db61?checkout[custom][user_email]=${encodeURIComponent(auth.userEmail)}&checkout[email]=${encodeURIComponent(auth.userEmail)}`;
                window.open(checkoutUrl, '_blank');
            } else {
                alert("팝업을 열어 먼저 로그인해주세요!");
            }
        });
    }
}

function insertTextAndTrigger(target, text) {
    target.focus();
    if (target.isContentEditable) {
        target.innerText = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(target, text);
        } else {
            target.value = text;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }));
}

// =========================================================
// 4. 크레딧 관련
// =========================================================
function deductLocalCredit(auth, cost, actionName) {
    chrome.storage.local.get(['dailyCredits', 'activityHistory'], (data) => {
        const c = data.dailyCredits ?? 0;
        let newCredit;

        if (c < cost) {
            const maxMap = { PREMIUM: 1000, PRO: 300, LITE: 100 };
            const max = maxMap[auth.userRole] ?? 10;
            newCredit = max - cost;
        } else {
            newCredit = c - cost;
        }

        const history = data.activityHistory || [];
        const now = new Date();
        const timeString = `${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

        history.unshift({ action: actionName, cost: cost, time: timeString });
        if (history.length > 20) history.pop();

        chrome.storage.local.set({
            dailyCredits: Math.max(0, newCredit),
            activityHistory: history
        });
    });
}

function showTokenDeduction(element, cost) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const floating = document.createElement('div');
    floating.textContent = `-${cost} ⚡`;
    Object.assign(floating.style, {
        position: 'fixed', left: `${rect.left + rect.width / 2}px`, top: `${rect.top}px`,
        color: '#f59e0b', fontWeight: '900', fontSize: '18px', zIndex: '2147483647',
        pointerEvents: 'none', animation: 'float-up-fade 1s ease-out forwards', textShadow: '0px 2px 4px rgba(0,0,0,0.2)', transform: 'translateX(-50%)'
    });
    document.body.appendChild(floating);
    setTimeout(() => floating.remove(), 1100);
}

// =========================================================
// 5. UI 헬퍼: 락다운 오버레이
// =========================================================
function getOrCreateEl(id, tag = 'div') {
    return document.getElementById(id) || (() => {
        const el = document.createElement(tag);
        el.id = id;
        document.body.appendChild(el);
        return el;
    })();
}

function showFullScanLockdown(textLength) {
    const overlay = getOrCreateEl('mb-fullscan-lockdown');
    overlay.innerHTML = `
        <div style="font-size:60px;animation:mb-spin 2s linear infinite;margin-bottom:20px;">⏳</div>
        <h2 style="margin:0 0 10px 0; font-family: sans-serif;">전체 대화 스캔 중...</h2>
        <p style="font-size:16px;font-weight:bold;color:#60a5fa; font-family: sans-serif;">데이터 로딩을 위해 창을 닫거나 스크롤을 만지지 마세요.</p>
        <p style="margin-top:10px;color:#9ca3af; font-family: sans-serif;">현재 수집량: ${textLength.toLocaleString()} 자</p>
    `;
}

function hideFullScanLockdown() {
    document.getElementById('mb-fullscan-lockdown')?.remove();
}

// =========================================================
// 6. 전체 저장 모달 & 🌟 인페이지(In-page) 프로그레스 팝업 전환
// =========================================================
function showFullScanConfirmModal(scanData, auth, unifiedFlagKey, unlockCallback) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: '2147483647',
        display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: '#ffffff', padding: '32px', borderRadius: '16px',
        textAlign: 'center', width: '360px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)'
    });

    // 모던 컨펌 UI
    box.innerHTML = `
        <div style="font-size:48px;margin-bottom:12px;">📋</div>
        <h3 style="margin:0 0 16px 0; color:#111827; font-size: 20px; font-weight: 700;">스캔 완료!</h3>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:24px;text-align:left;font-size:14px;color:#374151;">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                <span style="color:#6b7280;font-weight:600;">수집된 텍스트:</span>
                <strong style="color:#111827;">${scanData.textLength.toLocaleString()} 자</strong>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span style="color:#6b7280;font-weight:600;">예상 번개 소모:</span>
                <strong style="color:#2563eb;font-size:15px;">${scanData.estimatedCredits} ⚡</strong>
            </div>
        </div>
        <p style="color:#9ca3af;font-size:12px;margin-bottom:24px;line-height:1.4;">확정 시 화면 중앙에 진행률이 표시되며<br>백그라운드에서 안전하게 저장됩니다.</p>
        <div style="display:flex;gap:12px;">
            <button id="mb-scan-cancel" style="flex:1;background:#f3f4f6;color:#374151;border:none;padding:14px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;transition:background 0.2s;">취소</button>
            <button id="mb-scan-confirm" style="flex:1;background:#3b82f6;color:white;border:none;padding:14px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 4px 6px -1px rgba(59,130,246,0.3);transition:background 0.2s;">저장 확정</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('mb-scan-cancel').onmouseover = function(){this.style.background='#e5e7eb';};
    document.getElementById('mb-scan-cancel').onmouseout = function(){this.style.background='#f3f4f6';};
    document.getElementById('mb-scan-confirm').onmouseover = function(){this.style.background='#2563eb';};
    document.getElementById('mb-scan-confirm').onmouseout = function(){this.style.background='#3b82f6';};

    document.getElementById('mb-scan-cancel').onclick = () => { overlay.remove(); unlockCallback(); };


    document.getElementById('mb-scan-confirm').onclick = async () => {
        const confirmBtn = document.getElementById('mb-scan-confirm');
        confirmBtn.textContent = "⏳ 서버 접수 중...";
        confirmBtn.disabled = true;

        try {
            const initRes = await fetch(`${API_BASE}/memories/full-save/init`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": auth.apiKey },
                body: JSON.stringify({
                    workspaceId: auth.workspaceId,
                    rawContent: scanData.rawText,
                    estimatedTokens: scanData.estimatedCredits
                })
            });

            if (initRes.status === 402) {
                overlay.remove(); showPaywallModal(`전체 저장(${scanData.estimatedCredits}개 차감)`); unlockCallback(); return;
            }
            if (!initRes.ok) throw new Error("접수 실패");

            const responseText = await initRes.text();
            const match = responseText.match(/ID: (\d+)/);
            if (!match) throw new Error("Job ID 파싱 실패");

            const jobId = match[1];

            // 🌟 [수정 포인트] startTime을 기록하여 팝업이 늦게 열려도 시간 보정 가능하게 함
            chrome.storage.local.set({
                activeMbJob: { jobId, flagKey: unifiedFlagKey, newFlag: scanData.newFlag, estimatedCredits: scanData.estimatedCredits, startTime: Date.now() }
            });

            // 🌟 [수정 포인트] 인페이지 모달 생성 안 함! 바로 닫고 화면 잠금 해제!
            overlay.remove();
            unlockCallback();

            // 안내 팝업창 (확인 누르면 바로 다른 웹서핑 가능)
            alert("🚀 대용량 저장이 시작되었습니다!\n\n현재 페이지에서 다른 작업을 계속하셔도 됩니다. 진행 상황은 우측 상단의 익스텐션 팝업(🧠)에서 확인하세요.");

            // 조용히 백그라운드 폴링만 시작
            startJobPolling(jobId, auth, scanData.estimatedCredits, unifiedFlagKey, scanData.newFlag);

        } catch (error) {
            alert("🚨 오류 발생: " + error.message);
            overlay.remove(); unlockCallback();
        }
    };
}

// =========================================================
// 7. 폴링: 백그라운드 태스크 (UI 간섭 없음)
// =========================================================
function startJobPolling(jobId, auth, estimatedCredits, flagKey, newFlag) {
    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/memories/full-save/${jobId}/status`, {
                headers: { "X-API-KEY": auth.apiKey }
            });
            if (!res.ok) return;

            const data = await res.json();

            if (data.status === "COMPLETED") {
                clearInterval(pollInterval);
                deductLocalCredit(auth, estimatedCredits, "🚀 전체 스캔");
                localStorage.setItem(flagKey, newFlag);
                chrome.storage.local.remove(['activeMbJob']);

                // 완료 시점에만 알림!
                alert("✅ 전체 대화 백그라운드 저장이 완벽하게 완료되었습니다!");
            } else if (data.status === "FAILED") {
                clearInterval(pollInterval);
                chrome.storage.local.remove(['activeMbJob']);
                alert("🚨 백그라운드 저장 처리 중 서버 에러가 발생했습니다.");
            }
        } catch {
            // 네트워크 오류 시 무시하고 계속 폴링
        }
    }, 2000);
}

// =========================================================
// 8. 플로팅 메뉴 (FAB) 모던 테마
// =========================================================
function injectFloatingMenu() {
    if (document.getElementById('memory-bank-fab-container')) return;

    const fabContainer = document.createElement('div');
    fabContainer.id = 'memory-bank-fab-container';
    const isGrok = window.location.hostname.includes('grok.com');
    Object.assign(fabContainer.style, {
        position: 'fixed', bottom: isGrok ? '30px' : '20px', right: isGrok ? '80px' : '20px', zIndex: '2147483640',
        display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '10px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    });

    const mainBtn = document.createElement('button');
    mainBtn.innerHTML = '🧠';
    mainBtn.id = 'mb-main-fab';
    Object.assign(mainBtn.style, {
        position: 'relative', width: '56px', height: '56px', borderRadius: '50%',
        backgroundColor: '#3b82f6', color: 'white', border: 'none', fontSize: '24px',
        cursor: 'pointer', boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)', transition: 'transform 0.3s ease',
        display: 'flex', justifyContent: 'center', alignItems: 'center'
    });

    const spinnerRing = document.createElement('div');
    spinnerRing.className = 'mb-busy-ring';
    mainBtn.appendChild(spinnerRing);

    const setupSubButton = (btn, text, costStr) => {
        btn.innerHTML = `<span class="mb-btn-text">${text}</span> <span class="mb-btn-cost" style="color:#3b82f6;font-size:11px;opacity:0;max-width:0;overflow:hidden;transition:all 0.3s ease;white-space:nowrap;">(-${costStr})</span>`;
        Object.assign(btn.style, {
            padding: '12px 18px', backgroundColor: '#ffffff', color: '#111827',
            border: '1px solid #e5e7eb', borderRadius: '30px', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', transition: 'all 0.2s ease-in-out',
            opacity: '0', transform: 'translateY(20px)', pointerEvents: 'none',
            display: 'flex', alignItems: 'center'
        });

        const showCost = (show) => {
            const c = btn.querySelector('.mb-btn-cost');
            if (!c) return;
            c.style.opacity = show ? '1' : '0';
            c.style.maxWidth = show ? '60px' : '0px';
            c.style.marginLeft = show ? '6px' : '0px';
        };
        btn.onmouseenter = () => showCost(true);
        btn.onmouseleave = () => showCost(false);
    };

    const saveBtn = document.createElement('button'); setupSubButton(saveBtn, '💾 단일 저장', `${CREDIT_COST.SAVE}⚡`);
    const loadBtn = document.createElement('button'); setupSubButton(loadBtn, '📥 기억 연동', `${CREDIT_COST.SYNC}⚡`);
    const scanBtn = document.createElement('button'); setupSubButton(scanBtn, '🚀 전체 스캔', `1만자당 1⚡`);

    const subBtns = [saveBtn, loadBtn, scanBtn];

    const setBusyState = (isBusy) => {
        window.mbIsBusy = isBusy;
        chrome.storage.local.set({ isSavingInProgress: isBusy });
        if (isBusy) {
            mainBtn.classList.add('mb-busy-mode');
            subBtns.forEach(b => { b.style.opacity = '0'; b.style.pointerEvents = 'none'; });
        } else {
            mainBtn.classList.remove('mb-busy-mode');
        }
    };

    fabContainer.onmouseenter = () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1.1)';
        subBtns.forEach((btn, i) => {
            btn.style.opacity = '1';
            btn.style.transform = 'translateY(0) scale(1)';
            btn.style.pointerEvents = 'auto';
            btn.style.transitionDelay = `${i * 0.05}s`;
        });

        getAuthInfo().then(auth => {
            const textSpan = scanBtn.querySelector('.mb-btn-text');
            if (textSpan) textSpan.textContent = auth.userRole === 'FREE' ? '🔒 전체 스캔' : '✨ 전체 스캔';
        });
    };

    fabContainer.onmouseleave = () => {
        if (window.mbIsBusy) return;
        mainBtn.style.transform = 'scale(1)';
        subBtns.forEach(btn => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(20px)';
            btn.style.pointerEvents = 'none';
            btn.style.transitionDelay = '0s';
        });
    };

    // 🚀 전체 스캔
    scanBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }
            if (auth.userRole === 'FREE' && !auth.hasStarterPack) { alert("🔒 전체 대화 스캔 기능은 LITE 등급 이상부터 사용 가능합니다."); return; }

            const currentPlatform = getCurrentPlatform();
            if (!currentPlatform) { alert("❌ 지원하지 않는 플랫폼입니다."); return; }

            setBusyState(true);

            const flagKey = getFlagKey(auth);
            const stopFlagText = localStorage.getItem(flagKey);
            const safeTarget = stopFlagText ? normalizeForMatch(stopFlagText).slice(-60) : null;

            showFullScanLockdown(0);

            let reachedFlag = false;
            const seenTexts = new Set();
            let collectedChunks = [];
            let sameTopCount = 0;
            let previousFirstMessage = "";

            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 800));

            while (!reachedFlag) {
                const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                if (bubbles.length === 0) break;

                const chunkForThisView = [];
                for (let i = bubbles.length - 1; i >= 0; i--) {
                    const rawText = bubbles[i].innerText;
                    if (isSystemPrompt(rawText)) continue;

                    const cleanText = getCleanedText(bubbles[i]);
                    if (safeTarget && normalizeForMatch(cleanText).includes(safeTarget)) { reachedFlag = true; break; }
                    if (cleanText.length > 0 && !seenTexts.has(cleanText)) {
                        seenTexts.add(cleanText);
                        chunkForThisView.unshift(cleanText);
                    }
                }

                if (chunkForThisView.length > 0) {
                    collectedChunks.unshift(chunkForThisView.join('\n\n'));
                    showFullScanLockdown(collectedChunks.join('\n\n').length);
                }

                if (reachedFlag) break;

                window.scrollTo(0, 0);
                document.querySelectorAll('*').forEach(el => {
                    if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) el.scrollTo(0, 0);
                });

                await new Promise(r => setTimeout(r, 1500));

                const newBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                const currentFirstMessage = newBubbles[0]?.innerText ?? "";

                if (currentFirstMessage === previousFirstMessage) {
                    if (++sameTopCount >= 3) break;
                } else {
                    sameTopCount = 0;
                }
                previousFirstMessage = currentFirstMessage;
            }

            window.scrollTo(0, document.body.scrollHeight);
            hideFullScanLockdown();

            let rawFinalText = collectedChunks.join('\n\n');
            let textLength = rawFinalText.length;

            if (textLength < 10) { alert("⚠️ 새로 스캔할 대화 내용이 없습니다."); setBusyState(false); return; }

            if (textLength > 4000000) {
                alert(`⚠️ 대화가 너무 방대합니다! (${textLength.toLocaleString()}자)\n\n브라우저 메모리 보호를 위해 최신 대화 400만 자까지만 스캔을 진행합니다.`);
                rawFinalText = rawFinalText.slice(-4000000);
                textLength = 4000000;
            }

            const estimatedCredits = calculateFullScanCredits(textLength);

            let newFlagText = "";
            const finalBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
            for (let i = finalBubbles.length - 1; i >= 0; i--) {
                if (!isSystemPrompt(finalBubbles[i].innerText)) {
                    newFlagText = getCleanedText(finalBubbles[i]);
                    break;
                }
            }

            showFullScanConfirmModal(
                { rawText: rawFinalText, textLength, estimatedCredits, newFlag: newFlagText },
                auth, flagKey, () => setBusyState(false)
            );

        } catch (error) {
            hideFullScanLockdown();
            setBusyState(false);
            alert("🚨 스캔 중 오류 발생: " + error.message);
        }
    };

    // 💾 단일 저장
    saveBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }

            const currentPlatform = getCurrentPlatform();
            if (!currentPlatform) { alert("❌ 지원하지 않는 플랫폼입니다."); return; }

            const allBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
            if (allBubbles.length === 0) { alert("❌ 저장할 대화 내용을 찾을 수 없습니다."); return; }

            const flagKey = getFlagKey(auth);
            const flagText = localStorage.getItem(flagKey);
            const safeTarget = flagText ? normalizeForMatch(flagText).slice(-60) : null;

            let startIndex = 0;
            if (safeTarget) {
                for (let i = allBubbles.length - 1; i >= 0; i--) {
                    if (isSystemPrompt(allBubbles[i].innerText)) continue;
                    if (normalizeForMatch(getCleanedText(allBubbles[i])).includes(safeTarget)) {
                        startIndex = i + 1;
                        break;
                    }
                }
            }

            const newBubbles = Array.from(allBubbles).slice(startIndex);
            if (newBubbles.length === 0) { alert("✅ 최근 대화가 이미 완벽하게 저장되어 있습니다."); return; }

            const cleanedBubbles = [];
            let currentLength = 0;
            let isTruncated = false;
            const seenBubbleTexts = new Set();

            for (let i = newBubbles.length - 1; i >= 0; i--) {
                const rawText = newBubbles[i].innerText;
                if (isSystemPrompt(rawText)) continue;

                const text = getCleanedText(newBubbles[i]);
                if (!text || seenBubbleTexts.has(text)) continue;

                if (currentLength + text.length > 10000) {
                    if (cleanedBubbles.length === 0) {
                        // 맨 처음 담으려는 답변 하나가 10000자 넘을 경우, 튕겨내지 않고 잘라서 넣음
                        cleanedBubbles.unshift(text.substring(0, 10000) + "\n\n...[내용이 너무 길어 생략됨]");
                    }
                    isTruncated = true;
                    break;
                }

                seenBubbleTexts.add(text);
                cleanedBubbles.unshift(text);
                currentLength += text.length;
            }

            if (cleanedBubbles.length === 0) {
                alert("⚠️ 새로 저장할 일반 텍스트 대화가 없습니다. (시스템 명령만 존재)");
                setBusyState(false);
                return;
            }

            if (isTruncated) {
                const proceed = confirm(
                    `⚠️ 한 번에 저장하기엔 텍스트가 너무 길어 단일 저장 한도(10,000자)에 맞춰 최근 내용만 저장됩니다.\n\n(끊김 없이 모두 저장하려면 '🚀 전체 스캔'을 이용해 주세요.)\n이대로 진행하시겠습니까?`
                );
                if (!proceed) { setBusyState(false); return; }
            }

            setBusyState(true);

            const response = await fetch(`${API_BASE}/memories/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": auth.apiKey },
                body: JSON.stringify({ workspaceId: auth.workspaceId, content: cleanedBubbles.join('\n\n'), type: "FULL_CONV" })
            });

            if (response.status === 402) { showPaywallModal(`단일저장(${CREDIT_COST.SAVE}⚡)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 통신 에러가 발생했습니다.");

            deductLocalCredit(auth, CREDIT_COST.SAVE,"💾 단일 저장");

            for (let i = newBubbles.length - 1; i >= 0; i--) {
                let rawText = newBubbles[i].innerText;
                if (!isSystemPrompt(rawText)) {
                    let clean = getCleanedText(newBubbles[i]);
                    if (clean.length > 5) {
                        localStorage.setItem(flagKey, clean);
                        break;
                    }
                }
            }

            showTokenDeduction(saveBtn, CREDIT_COST.SAVE);
            setTimeout(() => { alert("✅ 최신 대화가 성공적으로 저장되었습니다!"); setBusyState(false); }, 300);

        } catch (error) {
            setBusyState(false);
            if (error.message !== "INSUFFICIENT_CREDITS") alert("🚨 단일 저장 실패: " + error.message);
        }
    };

    // 📥 기억 연동
    loadBtn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.mbIsBusy) return;

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey || !auth.workspaceId) { showLoginPrompt(); return; }

            setBusyState(true);

            const safeEmail = auth.userEmail?.replace(/[^a-zA-Z0-9]/g, "") ?? "unknown";
            const syncStorageKey = `mb_sync_${safeEmail}_${auth.workspaceId}_${window.location.hostname}_${window.location.pathname}`;
            const lastId = parseInt(localStorage.getItem(syncStorageKey)) || 0;

            const response = await fetch(
                `${API_BASE}/memories/sync?workspaceId=${auth.workspaceId}&lastId=${lastId}&limit=50`,
                { method: 'GET', headers: { "Content-Type": "application/json", "X-API-KEY": auth.apiKey } }
            );

            if (response.status === 402) { showPaywallModal(`기억연동(${CREDIT_COST.SYNC}⚡)`); throw new Error("INSUFFICIENT_CREDITS"); }
            if (!response.ok) throw new Error("서버 에러");

            const result = await response.json();
            const memories = result.data || [];

            if (memories.length === 0) {
                alert("✅ 모든 최신 기억이 이미 동기화되어 있습니다.");
                setBusyState(false);
                return;
            }

            deductLocalCredit(auth, CREDIT_COST.SYNC, "📥 기억 연동");

            const newLastId = memories[memories.length - 1].id;
            const memoryContents = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
            const cleanSyncPrompt = `[System Instruction: Memorize the following data and reply strictly with "Yes, I have updated my memory."]\n\n[Loaded Memory Chunk]\n${memoryContents}`.trim();

            const inputTarget = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
            if (inputTarget) {
                insertTextAndTrigger(inputTarget, cleanSyncPrompt);
                localStorage.setItem(syncStorageKey, newLastId);
                showTokenDeduction(loadBtn, CREDIT_COST.SYNC);
                setTimeout(() => { alert("✅ 동기화 완료"); setBusyState(false); }, 1000);
            } else {
                setBusyState(false);
                alert("채팅 입력창을 찾을 수 없습니다.");
            }
        } catch (e) {
            setBusyState(false);
            if (e.message !== "INSUFFICIENT_CREDITS") alert("🚨 기억 연동 실패");
        }
    };

    fabContainer.append(scanBtn, loadBtn, saveBtn, mainBtn);
    document.body.appendChild(fabContainer);
}

const fabObserver = new MutationObserver(() => {
    if (!document.getElementById('memory-bank-fab-container')) injectFloatingMenu();
});
fabObserver.observe(document.body, { childList: true, subtree: false });
injectFloatingMenu();

// =========================================================
// 9. /m 인라인 검색 커맨드
// =========================================================
function initSlashCommandListener() {
    document.addEventListener('input', (e) => {
        const target = e.target;
        if (target.tagName !== 'TEXTAREA' && !target.isContentEditable && target.tagName !== 'INPUT') return;
        const text = target.value !== undefined ? target.value : target.innerText;
        target.classList.toggle('mb-slash-mode', text.startsWith('/m '));
    });

    document.addEventListener('keydown', async (e) => {
        const target = e.target;
        if ((target.tagName !== 'TEXTAREA' && !target.isContentEditable && target.tagName !== 'INPUT') ||
            e.key !== 'Enter' || e.shiftKey) return;

        const text = target.value !== undefined ? target.value : target.innerText;
        if (!text.startsWith('/m ')) return;

        e.preventDefault();
        e.stopPropagation();

        if (target.dataset.mbSearching === "true") return;

        const query = text.substring(3).trim();
        if (!query) { alert("검색할 질문을 입력해주세요. (예: /m 내가 좋아하는 음식은?)"); return; }

        target.dataset.mbSearching = "true";

        const rect = target.getBoundingClientRect();
        const blocker = document.createElement('div');
        blocker.id = 'mb-input-blocker';
        blocker.textContent = '⏳ Memory Bank AI 검색 중...';
        blocker.className = 'mb-input-blocker';
        Object.assign(blocker.style, {
            position: 'absolute',
            top: `${rect.top + window.scrollY}px`,
            left: `${rect.left + window.scrollX}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            borderRadius: window.getComputedStyle(target).borderRadius
        });
        document.body.appendChild(blocker);

        const removeBlocker = () => document.getElementById('mb-input-blocker')?.remove();

        try {
            const auth = await getAuthInfo();
            if (!auth.apiKey) throw new Error("NO_AUTH");

            const response = await fetch(
                `${API_BASE}/memories/search?workspaceId=${auth.workspaceId}&question=${encodeURIComponent(query)}&topK=10`,
                { method: 'GET', headers: { "X-API-KEY": auth.apiKey } }
            );

            if (response.status === 402) { showPaywallModal(`검색(1⚡)`); throw new Error("NO_CREDIT"); }
            if (!response.ok) throw new Error("SEARCH_FAILED");

            const responseData = await response.json();
            const memoryResults = responseData.data || [];

            const memoryText = memoryResults.length > 0
                ? memoryResults.map((mem, idx) => `${idx + 1}. ${mem}`).join('\n')
                : "No relevant memories found.";

            const finalPrompt = `Memory Bank\n[System Instruction: You are my personal assistant. Answer my question based ONLY on the provided [Loaded Memory] data below. If you don't know the answer based on the data, simply say "I don't know. Please rewrite the question.".]\n\n[Loaded Memory]\n${memoryText.trim()}\n\n[Question]\n${query}`;

            removeBlocker();
            target.dataset.mbSearching = "false";
            target.classList.remove('mb-slash-mode');

            deductLocalCredit(auth, CREDIT_COST.SEARCH, "🔍 AI 기억 검색");
            showTokenDeduction(target, CREDIT_COST.SEARCH);

            insertTextAndTrigger(target, finalPrompt);

        } catch (error) {
            removeBlocker();
            target.dataset.mbSearching = "false";
            if (error.message !== "NO_CREDIT" && error.message !== "NO_AUTH") {
                alert("🚨 검색 중 오류가 발생했습니다.");
            }
        }
    }, true);
}
setTimeout(initSlashCommandListener, 2000);

// =========================================================
// 10. 스마트 나침반 (🌟 모던 테마 및 깃발 클린업 적용)
// =========================================================
let isNavigatorInitialized = false;

async function initSmartNavigator() {
    if (isNavigatorInitialized) return;
    isNavigatorInitialized = true;

    const compass = document.createElement('button');
    compass.id = 'mb-bookmark-compass';
    const isGrok = window.location.hostname.includes('grok.com');

    Object.assign(compass.style, {
        position: 'fixed', right: isGrok ? '80px' : '20px', bottom: '260px',
        backgroundColor: '#ffffff', border: '2px solid #3b82f6', color: '#3b82f6',
        padding: '10px 16px', borderRadius: '30px', fontSize: '12px', fontWeight: '900',
        cursor: 'pointer', zIndex: '2147483647', display: 'none', alignItems: 'center', gap: '6px',
        boxShadow: '0 4px 10px rgba(0,0,0,0.1)', transition: 'all 0.3s ease', opacity: '0.6',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    });

    compass.onmouseenter = () => {
        Object.assign(compass.style, { backgroundColor: '#3b82f6', color: '#ffffff', opacity: '1', transform: 'scale(1.05)' });
    };
    compass.onmouseleave = () => {
        Object.assign(compass.style, { backgroundColor: '#ffffff', color: '#3b82f6', opacity: '0.6', transform: 'scale(1)' });
    };
    document.body.appendChild(compass);

    const track = async () => {
        const auth = await getAuthInfo();
        if (!auth.apiKey) return;

        const currentPlatform = getCurrentPlatform();
        if (!currentPlatform) return;

        const flagKey = getFlagKey(auth);
        const targetText = localStorage.getItem(flagKey);

        // 🌟 저장 지점이 없으면 화면의 깃발 싹 다 지우기 (워크스페이스 변경 시)
        if (!targetText || normalizeForMatch(targetText).slice(-60).length < 5) {
            compass.style.display = 'none';
            document.querySelectorAll('[data-mb-flagged="true"]').forEach(el => {
                delete el.dataset.mbFlagged;
                el.querySelector('.mb-flag-line')?.remove();
            });
            return;
        }

        const searchTarget = normalizeForMatch(targetText).slice(-60);

        const bubbles = document.querySelectorAll(siteConfig[currentPlatform]);
        let targetBubble = null;

        for (let i = bubbles.length - 1; i >= 0; i--) {
            if (isSystemPrompt(bubbles[i].innerText)) continue;

            let clean = getCleanedText(bubbles[i]);
            if (normalizeForMatch(clean).includes(searchTarget)) {
                targetBubble = bubbles[i];
                break;
            }
        }

        if (targetBubble) {
            const role = targetBubble.getAttribute('data-message-author-role');
            const tagName = targetBubble.tagName.toLowerCase();
            if (role === 'user' || tagName === 'user-query') {
                const idx = Array.from(bubbles).indexOf(targetBubble);
                if (idx >= 0 && idx < bubbles.length - 1) targetBubble = bubbles[idx + 1];
            }
        }

        if (targetBubble && !targetBubble.dataset.mbFlagged) {
            document.querySelectorAll('[data-mb-flagged="true"]').forEach(el => {
                delete el.dataset.mbFlagged;
                el.querySelector('.mb-flag-line')?.remove();
            });

            targetBubble.dataset.mbFlagged = "true";
            targetBubble.style.position = "relative";

            const line = document.createElement('div');
            line.className = 'mb-flag-line';
            Object.assign(line.style, {
                position: 'absolute', bottom: '-5px', left: '0', width: '100%', height: '3px',
                backgroundColor: '#3b82f6', zIndex: '2147483646', boxShadow: '0 0 8px rgba(59,130,246,0.6)'
            });

            const badge = document.createElement('div');
            badge.textContent = "💾 마지막 저장 지점";
            Object.assign(badge.style, {
                position: 'absolute', top: '-12px', right: '10px', backgroundColor: '#3b82f6',
                color: 'white', padding: '4px 14px', borderRadius: '15px', fontSize: '11px',
                fontWeight: 'bold', zIndex: '2147483647', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
            });
            line.appendChild(badge);
            targetBubble.appendChild(line);
        }

        if (!targetBubble) {
            if (!window.isNavSearching) compass.textContent = "⬆️ 저장 위치 (클릭하여 찾기)";
            compass.style.display = 'flex';

            compass.onclick = () => {
                if (window.isNavSearching) return;
                window.isNavSearching = true;
                compass.textContent = "⏳ 위치 찾는 중...";

                let sameTopCount = 0;
                let previousScrollHeight = document.documentElement.scrollHeight;

                const searchInterval = setInterval(() => {
                    const currentBubbles = document.querySelectorAll(siteConfig[currentPlatform]);
                    let found = null;
                    for (let i = currentBubbles.length - 1; i >= 0; i--) {
                        if (isSystemPrompt(currentBubbles[i].innerText)) continue;
                        let clean = getCleanedText(currentBubbles[i]);
                        if (normalizeForMatch(clean).includes(searchTarget)) {
                            found = currentBubbles[i]; break;
                        }
                    }

                    if (found) {
                        clearInterval(searchInterval);
                        window.isNavSearching = false;
                        found.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    } else {
                        window.scrollTo(0, 0);
                        document.querySelectorAll('*').forEach(el => {
                            if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) el.scrollTo(0, 0);
                        });

                        const currentScrollHeight = document.documentElement.scrollHeight;
                        if (currentScrollHeight === previousScrollHeight) {
                            if (++sameTopCount >= 3) {
                                clearInterval(searchInterval);
                                window.isNavSearching = false;
                                compass.textContent = "❌ 위치를 찾을 수 없음 (새 대화일 수 있습니다)";
                                setTimeout(() => track(), 3000);
                                return;
                            }
                        } else {
                            sameTopCount = 0;
                        }
                        previousScrollHeight = currentScrollHeight;
                    }
                }, 1500);
            };
        } else {
            window.isNavSearching = false;
            const rect = targetBubble.getBoundingClientRect();
            const moveToTarget = () => targetBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

            if (rect.bottom < 0) {
                compass.textContent = "⬆️ 마지막 저장 위치"; compass.style.display = 'flex'; compass.onclick = moveToTarget;
            } else if (rect.top > window.innerHeight) {
                compass.textContent = "⬇️ 마지막 저장 위치"; compass.style.display = 'flex'; compass.onclick = moveToTarget;
            } else {
                compass.style.display = 'none';
            }
        }
    };

    setInterval(track, 1000);
}
setTimeout(initSmartNavigator, 1500);

// =========================================================
// 11. 페이지 복귀 시 진행 중인 저장 작업 재개
// =========================================================
async function checkPendingJobs() {
    chrome.storage.local.get(['activeMbJob'], async ({ activeMbJob }) => {
        if (!activeMbJob) return;
        const auth = await getAuthInfo();
        if (!auth.apiKey) return;

        // 파라미터 간소화 (UI 모달 넘기지 않음)
        startJobPolling(activeMbJob.jobId, auth, activeMbJob.estimatedCredits, activeMbJob.flagKey, activeMbJob.newFlag);
    });
}
setTimeout(checkPendingJobs, 2500);