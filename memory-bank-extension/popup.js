document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(
        ['memoryBankApiKey', 'userName', 'userRole', 'currentWorkspaceId', 'workspaces', 'isSavingInProgress', 'dailyCredits'],
        (data) => {
            if (!data.memoryBankApiKey || !data.workspaces) return;

            // 🌟 [핵심 픽스] userRole이 비어있으면 'FREE'로 강제 지정하여 에러 방지
            const currentRole = data.userRole || 'FREE';

            showLoggedInUI(
                data.userName,
                data.workspaces,
                data.currentWorkspaceId,
                data.isSavingInProgress,
                data.dailyCredits ?? 0,
                currentRole
            );

            // 🌟 함수의 인자가 아니라, 밖으로 빼서 안전하게 독립 실행!
            const tabMenu = document.getElementById('tab-menu');
            if (tabMenu) tabMenu.style.display = 'flex';

            updateStoreVisibility(currentRole);

            silentRefreshUserData();
            checkActiveJobProgress();
            renderHistory();
        }
    );
});

async function silentRefreshUserData() {
    chrome.storage.local.get(['memoryBankApiKey', 'lastCreditResetDate', 'userRole'], async (data) => {
        if (!data.memoryBankApiKey) return;

        const today = new Date().toISOString().slice(0, 10);
        const lastReset = data.lastCreditResetDate || "";
        const isNewDay = today !== lastReset;

        if (!isNewDay) return;

        try {
            const response = await fetch("https://aimemorybank.cloud/api/members/me", {
                method: "GET",
                headers: { "X-API-KEY": data.memoryBankApiKey }
            });

            if (!response.ok) {
                await silentRefreshViaGoogleToken(today);
                return;
            }

            const result = await response.json();
            chrome.storage.local.set({
                userRole: result.role || data.userRole || 'FREE',
                dailyCredits: result.dailyCredits ?? 0,
                lastCreditResetDate: today
            });
        } catch {
            await silentRefreshViaGoogleToken(today);
        }
    });
}

function silentRefreshViaGoogleToken(today) {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, async (token) => {
            if (chrome.runtime.lastError || !token) { resolve(); return; }
            try {
                const response = await fetch("https://aimemorybank.cloud/api/auth/google", {
                    method: "POST",
                    mode: "cors",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ accessToken: token })
                });
                if (!response.ok) { resolve(); return; }

                const data = await response.json();
                if (!data.apiKey) { resolve(); return; }

                const saveData = { userRole: data.role || 'FREE', dailyCredits: data.dailyCredits ?? 0 };
                if (today) saveData.lastCreditResetDate = today;
                chrome.storage.local.set(saveData);
            } catch (error) {
                console.error("백그라운드 동기화 실패:", error);
            }
            resolve();
        });
    });
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.isSavingInProgress) {
        if (changes.isSavingInProgress.newValue === true) {
            lockWorkspaceUI();
            const statusMsg = document.getElementById('status-message');
            statusMsg.style.color = '#ff9800';
            statusMsg.innerHTML = `⏳ <b>웹페이지에서 작업 진행 중!</b><br>완료될 때까지 조작이 제한됩니다.`;
        } else {
            location.reload();
        }
    }

    if (changes.dailyCredits) {
        const creditCount = document.getElementById('credit-count');
        if (creditCount) creditCount.textContent = changes.dailyCredits.newValue;
    }

    if (changes.userRole?.oldValue && changes.userRole.newValue !== changes.userRole.oldValue) {
        location.reload();
    }

    if (changes.activeMbJob || changes.activityHistory) {
        checkActiveJobProgress();
        renderHistory();
    }
});

function lockWorkspaceUI() {
    document.getElementById('workspace-container').classList.add('locked-ui');
    ['workspace-select', 'edit-workspace-btn', 'delete-workspace-btn', 'add-workspace-btn', 'logout-btn']
        .forEach(id => { document.getElementById(id).disabled = true; });
}

document.getElementById('login-btn').addEventListener('click', () => {
    const btn = document.getElementById('login-btn');
    const statusMsg = document.getElementById('status-message');
    btn.innerHTML = '⏳ 로그인 중...';
    btn.disabled = true;

    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
        if (chrome.runtime.lastError) {
            btn.innerHTML = 'Google 계정으로 로그인';
            btn.disabled = false;
            statusMsg.style.display = 'block';
            statusMsg.style.color = '#ef4444';
            statusMsg.innerHTML = `❌ 로그인 실패: ${chrome.runtime.lastError.message}`;
            return;
        }
        try {
            const response = await fetch("https://aimemorybank.cloud/api/auth/google", {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ accessToken: token })
            });

            if (!response.ok) throw new Error("서버 인증 실패");
            const data = await response.json();

            if (!data.apiKey || !data.workspaces) throw new Error("응답 데이터 오류");

            const defaultWorkspaceId = data.workspaces[0].id;
            const fetchedCredits = data.dailyCredits ?? 0;
            const safeRole = data.role || 'FREE';

            chrome.storage.local.set({
                memoryBankApiKey: data.apiKey,
                userName: data.name,
                userEmail: data.email,
                userRole: safeRole,
                currentWorkspaceId: defaultWorkspaceId,
                workspaces: data.workspaces,
                dailyCredits: fetchedCredits
            }, () => {
                showLoggedInUI(data.name, data.workspaces, defaultWorkspaceId, false, fetchedCredits, safeRole);
                document.getElementById('history-container').style.display = 'block';

                const tabMenu = document.getElementById('tab-menu');
                if (tabMenu) tabMenu.style.display = 'flex';
                updateStoreVisibility(safeRole);
            });
        } catch {
            btn.innerHTML = 'Google 계정으로 로그인';
            btn.disabled = false;
            statusMsg.style.display = 'block';
            statusMsg.style.color = '#ef4444';
            statusMsg.innerHTML = `🚨 서버 연결 실패`;
        }
    });
});

function showLoggedInUI(name, workspaces, currentWsId, isSaving, credits, role) {
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('desc').style.display = 'none';

    const creditBadge = document.getElementById('credit-badge');
    const creditCount = document.getElementById('credit-count');
    if (creditBadge && creditCount && credits !== undefined) {
        creditCount.textContent = credits;
        creditBadge.style.display = 'block';
    }

    const statusMsg = document.getElementById('status-message');
    statusMsg.style.display = 'block';

    const roleHtml = `<span class="role-badge ${role.toLowerCase()}">${role}</span>`;

    if (isSaving) {
        lockWorkspaceUI();
        statusMsg.style.color = '#f59e0b';
        statusMsg.innerHTML = `⏳ <b>웹페이지에서 작업 진행 중!</b><br>완료될 때까지 조작이 제한됩니다.`;
    } else {
        statusMsg.style.color = '#10b981';
        statusMsg.innerHTML = `✅ 환영합니다, <b>${name}</b>님! ${roleHtml}`;
    }

    const wsSelect = document.getElementById('workspace-select');
    const fragment = document.createDocumentFragment();
    workspaces.forEach(ws => {
        const option = document.createElement('option');
        option.value = ws.id;
        option.textContent = ws.name;
        if (ws.id == currentWsId) option.selected = true;
        fragment.appendChild(option);
    });
    wsSelect.innerHTML = '';
    wsSelect.appendChild(fragment);

    document.getElementById('workspace-container').style.display = 'block';
    document.getElementById('history-container').style.display = 'block';
    wsSelect.addEventListener('change', (e) => chrome.storage.local.set({ currentWorkspaceId: e.target.value }));
}

document.getElementById('logout-btn').addEventListener('click', () => {
    chrome.storage.local.clear(() => chrome.identity.clearAllCachedAuthTokens(() => location.reload()));
});

document.getElementById('add-workspace-btn').addEventListener('click', async () => {
    const wsName = prompt("새로운 워크스페이스 이름을 입력하세요:");
    if (!wsName?.trim()) return;

    chrome.storage.local.get(['memoryBankApiKey', 'workspaces'], async ({ memoryBankApiKey, workspaces }) => {
        try {
            const response = await fetch("https://aimemorybank.cloud/api/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": memoryBankApiKey },
                body: JSON.stringify({ name: wsName.trim() })
            });
            if (!response.ok) throw new Error("생성 실패");

            const newWs = await response.json();
            const updated = [...(workspaces || []), newWs];
            chrome.storage.local.set({ workspaces: updated, currentWorkspaceId: newWs.id }, () => location.reload());
        } catch {
            alert("🚨 워크스페이스 생성 중 오류가 발생했습니다.");
        }
    });
});

document.getElementById('edit-workspace-btn').addEventListener('click', () => {
    chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'workspaces'], async ({ memoryBankApiKey, currentWorkspaceId, workspaces }) => {
        const currentWs = workspaces.find(w => w.id == currentWorkspaceId);
        const newName = prompt("워크스페이스의 새 이름을 입력하세요:", currentWs?.name ?? "");
        if (!newName?.trim() || newName === currentWs?.name) return;

        try {
            const response = await fetch(`https://aimemorybank.cloud/api/workspaces/${currentWorkspaceId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-API-KEY": memoryBankApiKey },
                body: JSON.stringify({ name: newName.trim() })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const updated = workspaces.map(w => w.id == currentWorkspaceId ? { ...w, name: newName.trim() } : w);
            chrome.storage.local.set({ workspaces: updated }, () => location.reload());
        } catch {
            alert(`🚨 이름 수정 실패!`);
        }
    });
});

document.getElementById('delete-workspace-btn').addEventListener('click', () => {
    chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'workspaces'], async ({ memoryBankApiKey, currentWorkspaceId, workspaces }) => {
        if (workspaces.length <= 1) {
            alert("최소 1개의 워크스페이스는 유지해야 합니다.");
            return;
        }
        if (!confirm("정말 이 워크스페이스를 삭제하시겠습니까?\n내부의 모든 기억이 영구적으로 삭제됩니다!")) return;

        try {
            const response = await fetch(`https://aimemorybank.cloud/api/workspaces/${currentWorkspaceId}`, {
                method: "DELETE",
                headers: { "X-API-KEY": memoryBankApiKey }
            });
            if (!response.ok) throw new Error("삭제 실패");

            const updated = workspaces.filter(w => w.id != currentWorkspaceId);
            chrome.storage.local.set({ workspaces: updated, currentWorkspaceId: updated[0].id }, () => location.reload());
        } catch {
            alert("🚨 삭제 중 오류가 발생했습니다.");
        }
    });
});

document.getElementById('toggle-history-btn').addEventListener('click', () => {
    const list = document.getElementById('history-list');
    const arrow = document.getElementById('history-arrow');
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▲' : '▼';
    if (isHidden) renderHistory();
});

function renderHistory() {
    chrome.storage.local.get(['activityHistory'], (data) => {
        const list = document.getElementById('history-list');
        const history = data.activityHistory || [];
        if (history.length === 0) {
            list.innerHTML = '<li style="text-align: center; color: #9ca3af; padding: 10px;">최근 내역이 없습니다.</li>';
            return;
        }
        list.innerHTML = history.map(item => `
            <li style="display: flex; justify-content: space-between; padding: 8px 6px; border-bottom: 1px solid #f3f4f6;">
                <span style="color: #4b5563; font-weight: 600;">${item.action}</span>
                <div style="text-align: right;">
                    <span style="color: #f59e0b; font-weight: 800; margin-right: 6px;">-${item.cost}⚡</span>
                    <span style="color: #9ca3af; font-size: 10px;">${item.time}</span>
                </div>
            </li>
        `).join('');
    });
}

let activePollInterval = null;
let simulatedPercent = 0;

function checkActiveJobProgress() {
    chrome.storage.local.get(['memoryBankApiKey', 'activeMbJob'], (data) => {
        const container = document.getElementById('job-progress-container');
        if (!data.activeMbJob || !data.memoryBankApiKey) {
            container.style.display = 'none';
            if (activePollInterval) clearInterval(activePollInterval);
            return;
        }

        container.style.display = 'block';
        const { jobId, startTime } = data.activeMbJob;

        // 🌟 [수정 포인트] 팝업 늦게 열었을 때, 경과 시간(초)에 비례해서 퍼센트를 당겨놓음
        if (startTime) {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            simulatedPercent = Math.min(85, elapsedSeconds * 1.5); // 1초당 1.5%씩 올랐다고 가정
        }

        const percentEl = document.getElementById('job-percent');
        const barEl = document.getElementById('job-progress-bar');
        const statusEl = document.getElementById('job-status-text');

        // 여는 즉시 보정된 퍼센트로 렌더링
        percentEl.textContent = `${Math.round(simulatedPercent)}%`;
        barEl.style.width = `${Math.round(simulatedPercent)}%`;

        if (activePollInterval) clearInterval(activePollInterval);

        activePollInterval = setInterval(async () => {
            try {
                const res = await fetch(`https://aimemorybank.cloud/api/memories/full-save/${jobId}/status`, {
                    headers: { "X-API-KEY": data.memoryBankApiKey }
                });
                if (!res.ok) return;
                const jobData = await res.json();

                if (jobData.status === "PENDING") {
                    let actualProcessed = jobData.processed || 0;
                    let total = jobData.total || 0;

                    if (total > 0) {
                        let targetPercent = ((actualProcessed + 0.9) / total) * 100;
                        if (targetPercent > 99) targetPercent = 99;
                        let minPercent = (actualProcessed / total) * 100;
                        if (simulatedPercent < minPercent) simulatedPercent = minPercent;
                        simulatedPercent += (targetPercent - simulatedPercent) * 0.15;
                    } else {
                        simulatedPercent += (90 - simulatedPercent) * 0.05;
                    }

                    const displayPercent = Math.min(99, Math.round(simulatedPercent));

                    percentEl.textContent = `${displayPercent}%`;
                    barEl.style.width = `${displayPercent}%`;
                    statusEl.textContent = total > 0 ? `분석 중... (${actualProcessed}/${total} 블록)` : "서버 텍스트 분류 중...";

                } else if (jobData.status === "COMPLETED") {
                    clearInterval(activePollInterval);
                    percentEl.textContent = "100%";
                    barEl.style.width = "100%";
                    statusEl.textContent = "✅ 저장 완료!";
                    setTimeout(() => { container.style.display = 'none'; renderHistory(); }, 2500);
                } else if (jobData.status === "FAILED") {
                    clearInterval(activePollInterval);
                    statusEl.textContent = "🚨 서버 처리 실패";
                    statusEl.style.color = "#ef4444";
                    setTimeout(() => { container.style.display = 'none'; }, 3000);
                }
            } catch (e) {
                console.error("Progress polling error", e);
            }
        }, 1500);
    });
}

// =========================================================
// [결제 연동] 레몬스퀴지 체크아웃 팝업 띄우기
// =========================================================

// popup.js 상단에 추가
const CHECKOUT_LINKS = {
    STARTER: "https://memory-bank.lemonsqueezy.com/checkout/buy/5673c702-c027-4ce2-94d3-2d3abbc703ba",
    LITE: "https://memory-bank.lemonsqueezy.com/checkout/buy/48419913-7c97-4859-b3b6-50438e33db61",
    PRO: "https://memory-bank.lemonsqueezy.com/checkout/buy/b6069143-22c7-4a59-ab74-bff25050e880",
    PREMIUM: "https://memory-bank.lemonsqueezy.com/checkout/buy/49f98617-3a0d-4940-bbe4-ac2389965cd8"
};

// 🌟 탭 전환 로직
document.getElementById('tab-settings').addEventListener('click', () => switchTab('settings'));
document.getElementById('tab-store').addEventListener('click', () => switchTab('store'));

function switchTab(tab) {
    const isSettings = tab === 'settings';
    document.getElementById('content-settings').style.display = isSettings ? 'block' : 'none';
    document.getElementById('content-store').style.display = isSettings ? 'none' : 'block';

    document.getElementById('tab-settings').style.color = isSettings ? '#3b82f6' : '#6b7280';
    document.getElementById('tab-settings').style.borderBottom = isSettings ? '2px solid #3b82f6' : 'none';
    document.getElementById('tab-store').style.color = isSettings ? '#6b7280' : '#3b82f6';
    document.getElementById('tab-store').style.borderBottom = isSettings ? 'none' : '2px solid #3b82f6';
}

// 🌟 결제 버튼 이벤트 (이메일 파라미터 포함)
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('upgrade-btn')) {
        const plan = e.target.getAttribute('data-plan');
        const baseUrl = CHECKOUT_LINKS[plan];

        chrome.storage.local.get(['userEmail'], (data) => {
            const email = data.userEmail;
            if (!email) { alert("로그인이 필요합니다."); return; }

            // 레몬스퀴지 커스텀 데이터 및 자동 이메일 입력 파라미터 주입
            const finalUrl = `${baseUrl}?checkout[custom][user_email]=${encodeURIComponent(email)}&checkout[email]=${encodeURIComponent(email)}`;
            chrome.tabs.create({ url: finalUrl });
        });
    }
});

function updateStoreVisibility(role) {
    const starter = document.getElementById('card-starter');
    const lite = document.getElementById('card-lite');
    const pro = document.getElementById('card-pro');
    const premium = document.getElementById('card-premium');
    const storeTab = document.getElementById('tab-store');

    // 🌟 HTML에 카드가 없어서 에러가 터지는 현상 원천 차단
    if (!starter || !lite || !pro || !premium) {
        console.error("상점 UI 요소를 찾을 수 없습니다. popup.html에 id를 확인하세요.");
        return;
    }

    // 초기화: 일단 다 보임
    starter.style.display = 'block';
    lite.style.display = 'block';
    pro.style.display = 'block';
    premium.style.display = 'block';
    if (storeTab) storeTab.style.display = 'block';

    if (role === 'FREE') {
        // FREE: 모든 혜택 다 뜸
    } else if (role === 'LITE') {
        // LITE: Starter, LITE 사라짐
        starter.style.display = 'none';
        lite.style.display = 'none';
    } else if (role === 'PRO') {
        // PRO: Starter, LITE 사라짐 (PRO, PREMIUM만 남음)
        starter.style.display = 'none';
        lite.style.display = 'none';
    } else if (role === 'PREMIUM') {
        // PREMIUM: 아무것도 안 뜸 (상점 탭 자체를 숨김)
        starter.style.display = 'none';
        lite.style.display = 'none';
        pro.style.display = 'none';
        premium.style.display = 'none';
        if (storeTab) storeTab.style.display = 'none';
    }

    // 혹시 모를 에러 방지: FREE 이상이면 무조건 스타터팩은 숨김
    if (role && role !== 'FREE') {
        starter.style.display = 'none';
    }
}