console.log("Memory Bank Background Load");

// 💡 1. 무한 연타 방지용 깃발 (메모리에 기억하고 있음)
let isSaving = false;

// 우클릭 메뉴 생성
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-to-memory-bank",
        title: "🧠 Memory Bank에 부분 저장",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "save-to-memory-bank") {

        // 💡 2. [논리적 방어막] 이미 저장 중이면 아무것도 안 하고 튕겨냅니다!
        if (isSaving) {
            console.log("⏳ 이미 저장 작업이 진행 중입니다. 중복 클릭을 차단합니다.");
            return;
        }

        let selectedText = info.selectionText;
        if (!selectedText) return;

        // 이모지 완벽 제거 (안전한 유니코드 범위 사용)
        selectedText = selectedText.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/gu, '');

        console.log("⚡ [부분 저장] 통신 시작. 메뉴를 잠급니다.");

        // 💡 3. [시각적 방어막] 통신 시작 직전, 깃발을 들고 우클릭 메뉴를 회색으로 비활성화합니다.
        isSaving = true;
        chrome.contextMenus.update("save-to-memory-bank", {
            title: "⏳ AI 분석 및 저장 중...",
            enabled: false // 클릭 금지!
        });

        try {
            // 1. 🌟 스토리지에서 API 키와 현재 워크스페이스 ID를 가져옵니다.
            const authData = await new Promise((resolve) => {
                chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId'], (result) => {
                    resolve(result);
                });
            });

            const apiKey = authData.memoryBankApiKey;
            const workspaceId = authData.currentWorkspaceId;

            // 2. 로그인이 안 되어 있다면 중단
            if (!apiKey) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => alert("🚨 로그인이 필요합니다. 확장 프로그램 팝업에서 로그인해 주세요.")
                });
                return;
            }

            // 3. 🚀 가져온 키를 헤더에 꽂아서 통신합니다.
            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": apiKey // 👈 이제 하드코딩이 아닌 실제 키가 들어갑니다!
                },
                body: JSON.stringify({
                    workspaceId: workspaceId || 1, // 👈 워크스페이스도 동적으로! (없으면 기본값 1)
                    content: selectedText,
                    type: "SNIPPET"
                })
            });

        } catch (error) {
            console.error("🚨 부분 저장 실패:", error);
            // 실패 시 화면 중앙에 에러 팝업
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => alert("🚨 [부분 저장 실패]\n서버와 통신하는 중 문제가 발생했습니다.")
            });

        } finally {
            // 💡 4. [상태 복구] 성공하든 실패하든, 통신이 끝나면 다시 메뉴를 켜줍니다.
            isSaving = false;
            chrome.contextMenus.update("save-to-memory-bank", {
                title: "🧠 Memory Bank에 부분 저장",
                enabled: true // 다시 클릭 가능!
            });
        }
    }
});