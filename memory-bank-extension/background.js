console.log("Memory Bank Background Load");

let isSaving = false;

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-to-memory-bank",
        title: "🧠 Memory Bank에 부분 저장",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "save-to-memory-bank") {
        if (isSaving) {
            console.log("⏳ 이미 저장 작업이 진행 중입니다. 중복 클릭을 차단합니다.");
            return;
        }

        let selectedText = info.selectionText;
        if (!selectedText) return;

        selectedText = selectedText.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/gu, '');

        isSaving = true;
        chrome.contextMenus.update("save-to-memory-bank", {
            title: "⏳ AI 분석 및 저장 중...",
            enabled: false
        });

        try {
            const authData = await new Promise((resolve) => {
                chrome.storage.local.get(['memoryBankApiKey', 'currentWorkspaceId'], resolve);
            });

            if (!authData.memoryBankApiKey) {
                chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => alert("🚨 로그인이 필요합니다.") });
                return;
            }

            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": authData.memoryBankApiKey },
                body: JSON.stringify({ workspaceId: authData.currentWorkspaceId || 1, content: selectedText, type: "SNIPPET" })
            });

            if (response.ok) {
                chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => alert("✅ Memory Bank에 성공적으로 저장되었습니다!") });
            } else {
                throw new Error("서버 에러");
            }
        } catch (error) {
            chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => alert("🚨 [부분 저장 실패]\n서버와 통신하는 중 문제가 발생했습니다.") });
        } finally {
            isSaving = false;
            chrome.contextMenus.update("save-to-memory-bank", { title: "🧠 Memory Bank에 부분 저장", enabled: true });
        }
    }
});