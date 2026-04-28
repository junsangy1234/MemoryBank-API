console.log("Memory Bank Background Load");

// 저장 중복 방지 플래그 (Promise 기반으로 더 안전하게 관리)
let savingPromise = null;

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-to-memory-bank",
        title: "🧠 Memory Bank에 부분 저장",
        contexts: ["selection"]
    });
});

// 이모지 및 특수문자 제거 (누락된 Unicode 범위 보완)
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{1F004}\u{1F0CF}]/gu;

function setMenuState(isLoading) {
    chrome.contextMenus.update("save-to-memory-bank", {
        title: isLoading ? "⏳ AI 분석 및 저장 중..." : "🧠 Memory Bank에 부분 저장",
        enabled: !isLoading
    });
}

function showTabAlert(tabId, message) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: (msg) => alert(msg),
        args: [message]
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "save-to-memory-bank") return;

    // 이미 저장 중이면 무시 (Promise 기반으로 체크)
    if (savingPromise) {
        console.log("⏳ 이미 저장 작업이 진행 중입니다. 중복 클릭을 차단합니다.");
        return;
    }

    const selectedText = info.selectionText?.replace(EMOJI_REGEX, "");
    if (!selectedText) return;

    savingPromise = (async () => {
        setMenuState(true);
        try {
            const { memoryBankApiKey, currentWorkspaceId } = await chrome.storage.local.get([
                'memoryBankApiKey',
                'currentWorkspaceId'
            ]);

            if (!memoryBankApiKey) {
                showTabAlert(tab.id, "🚨 로그인이 필요합니다.");
                return;
            }

            const response = await fetch("https://aimemorybank.cloud/api/memories/join", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": memoryBankApiKey
                },
                body: JSON.stringify({
                    workspaceId: currentWorkspaceId || 1,
                    content: selectedText,
                    type: "SNIPPET"
                })
            });

            if (response.ok) {
                showTabAlert(tab.id, "✅ Memory Bank에 성공적으로 저장되었습니다!");
            } else {
                throw new Error("서버 에러");
            }
        } catch {
            showTabAlert(tab.id, "🚨 [부분 저장 실패]\n서버와 통신하는 중 문제가 발생했습니다.");
        } finally {
            savingPromise = null;
            setMenuState(false);
        }
    })();
});