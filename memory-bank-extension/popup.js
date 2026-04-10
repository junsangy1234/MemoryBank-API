document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['memoryBankApiKey', 'userName', 'userRole', 'currentWorkspaceId', 'workspaces', 'isSavingInProgress', 'dailyCredits'], (data) => {
        if (data.memoryBankApiKey && data.workspaces) {
            const currentCredits = data.dailyCredits !== undefined ? data.dailyCredits : 0;
            const currentRole = data.userRole || 'FREE';
            showLoggedInUI(data.userName, data.workspaces, data.currentWorkspaceId, data.isSavingInProgress, currentCredits, currentRole);
        }
    });
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
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
});

function lockWorkspaceUI() {
    document.getElementById('workspace-container').classList.add('locked-ui');
    document.getElementById('workspace-select').disabled = true;
    document.getElementById('edit-workspace-btn').disabled = true;
    document.getElementById('delete-workspace-btn').disabled = true;
    document.getElementById('add-workspace-btn').disabled = true;
    document.getElementById('logout-btn').disabled = true;
}

document.getElementById('login-btn').addEventListener('click', () => {
    const btn = document.getElementById('login-btn');
    const statusMsg = document.getElementById('status-message');
    btn.innerHTML = '⏳ 로그인 중...'; btn.disabled = true;

    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
        if (chrome.runtime.lastError) {
            btn.innerHTML = 'Google 계정으로 로그인'; btn.disabled = false;
            statusMsg.style.display = 'block'; statusMsg.style.color = '#f44336';
            statusMsg.innerHTML = `❌ 로그인 실패: ${chrome.runtime.lastError.message}`;
            return;
        }
        try {
            const response = await fetch("https://aimemorybank.cloud/api/auth/google", {
                method: "POST", mode: "cors", headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ accessToken: token })
            });

            if (!response.ok) throw new Error("서버 인증 실패");
            const data = await response.json();

            if (data.apiKey && data.workspaces) {
                const defaultWorkspaceId = data.workspaces[0].id;
                const fetchedCredits = data.dailyCredits !== undefined ? data.dailyCredits : 0;

                // 🌟 백엔드가 보내주는 role 값을 100% 신뢰합니다. (안 보내주면 FREE 처리)
                const safeRole = data.role || 'FREE';
                console.log("백엔드에서 받은 내 권한: ", safeRole); // 디버깅용 로그

                chrome.storage.local.set({
                    'memoryBankApiKey': data.apiKey,
                    'userName': data.name,
                    'userEmail': data.email,
                    'userRole': safeRole,
                    'currentWorkspaceId': defaultWorkspaceId,
                    'workspaces': data.workspaces,
                    'dailyCredits': fetchedCredits
                }, function() {
                    showLoggedInUI(data.name, data.workspaces, defaultWorkspaceId, false, fetchedCredits, safeRole);
                });
            }
        } catch (error) {
            btn.innerHTML = 'Google 계정으로 로그인'; btn.disabled = false;
            statusMsg.style.display = 'block'; statusMsg.style.color = '#f44336'; statusMsg.innerHTML = `🚨 서버 연결 실패`;
        }
    });
});

function showLoggedInUI(name, workspaces, currentWsId, isSaving, credits, role) {
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('desc').style.display = 'none';

    const creditBadge = document.getElementById('credit-badge');
    const creditCount = document.getElementById('credit-count');
    if (creditBadge && creditCount && credits !== undefined) {
        creditCount.textContent = credits; creditBadge.style.display = 'block';
    }

    const statusMsg = document.getElementById('status-message');
    statusMsg.style.display = 'block';

    const roleClass = role.toLowerCase();
    const roleHtml = `<span class="role-badge ${roleClass}">${role}</span>`;

    if (isSaving) {
        lockWorkspaceUI();
        statusMsg.style.color = '#ff9800'; statusMsg.innerHTML = `⏳ <b>웹페이지에서 작업 진행 중!</b><br>완료될 때까지 조작이 제한됩니다.`;
    } else {
        statusMsg.style.color = '#4caf50'; statusMsg.innerHTML = `✅ 환영합니다, <b>${name}</b>님! ${roleHtml}`;
    }

    const wsContainer = document.getElementById('workspace-container');
    const wsSelect = document.getElementById('workspace-select');
    wsSelect.innerHTML = '';
    workspaces.forEach(ws => {
        const option = document.createElement('option');
        option.value = ws.id; option.textContent = ws.name;
        if (ws.id == currentWsId) option.selected = true;
        wsSelect.appendChild(option);
    });
    wsContainer.style.display = 'block';
    wsSelect.addEventListener('change', (e) => chrome.storage.local.set({ 'currentWorkspaceId': e.target.value }));
}

document.getElementById('logout-btn').addEventListener('click', () => {
    chrome.storage.local.clear(() => chrome.identity.clearAllCachedAuthTokens(() => location.reload()));
});

document.getElementById('add-workspace-btn').addEventListener('click', async () => {
    const wsName = prompt("새로운 워크스페이스 이름을 입력하세요:");
    if (!wsName || wsName.trim() === "") return;
    chrome.storage.local.get(['memoryBankApiKey', 'workspaces'], async (data) => {
        try {
            const response = await fetch("https://aimemorybank.cloud/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": data.memoryBankApiKey }, body: JSON.stringify({ name: wsName }) });
            if (!response.ok) throw new Error("생성 실패");
            const newWs = await response.json();
            const updatedWorkspaces = data.workspaces || []; updatedWorkspaces.push(newWs);
            chrome.storage.local.set({ 'workspaces': updatedWorkspaces, 'currentWorkspaceId': newWs.id }, () => location.reload());
        } catch (e) { alert("🚨 워크스페이스 생성 중 오류가 발생했습니다."); }
    });
});

document.getElementById('edit-workspace-btn').addEventListener('click', () => {
    chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'workspaces'], async (data) => {
        const currentWs = data.workspaces.find(w => w.id == data.currentWorkspaceId);
        const newName = prompt("워크스페이스의 새 이름을 입력하세요:", currentWs ? currentWs.name : "");
        if (!newName || newName.trim() === "" || newName === currentWs.name) return;
        try {
            const response = await fetch(`https://aimemorybank.cloud/api/workspaces/${data.currentWorkspaceId}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-API-KEY": data.memoryBankApiKey }, body: JSON.stringify({ name: newName }) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const updatedWorkspaces = data.workspaces.map(w => w.id == data.currentWorkspaceId ? { ...w, name: newName } : w);
            chrome.storage.local.set({ 'workspaces': updatedWorkspaces }, () => location.reload());
        } catch (e) { alert(`🚨 이름 수정 실패!`); }
    });
});

document.getElementById('delete-workspace-btn').addEventListener('click', () => {
    chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId', 'workspaces'], async (data) => {
        if (data.workspaces.length <= 1) { alert("최소 1개의 워크스페이스는 유지해야 합니다."); return; }
        if (!confirm("정말 이 워크스페이스를 삭제하시겠습니까?\n내부의 모든 기억이 영구적으로 삭제됩니다!")) return;
        try {
            const response = await fetch(`https://aimemorybank.cloud/api/workspaces/${data.currentWorkspaceId}`, { method: "DELETE", headers: { "X-API-KEY": data.memoryBankApiKey } });
            if (!response.ok) throw new Error("삭제 실패");
            const updatedWorkspaces = data.workspaces.filter(w => w.id != data.currentWorkspaceId);
            chrome.storage.local.set({ 'workspaces': updatedWorkspaces, 'currentWorkspaceId': updatedWorkspaces[0].id }, () => location.reload());
        } catch (e) { alert("🚨 삭제 중 오류가 발생했습니다."); }
    });
});