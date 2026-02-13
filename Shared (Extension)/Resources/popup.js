const syncButton = document.getElementById("syncButton");
const status = document.getElementById("status");

function renderSummary(result) {
    if (!result?.ok) {
        return `Sync failed: ${result?.reason ?? "Unknown error"}`;
    }

    const { snapshot, nativeResult } = result;
    return [
        `Synced at: ${snapshot.capturedAt}`,
        `Open tabs: ${snapshot.tabs.length}`,
        `Bookmarks: ${snapshot.bookmarks.length}`,
        `Native storage: ${nativeResult?.ok ? "updated" : `unavailable (${nativeResult?.reason ?? "unknown"})`}`
    ].join("\n");
}

async function syncNow() {
    status.textContent = "Synchronizing…";
    syncButton.disabled = true;

    try {
        const result = await browser.runtime.sendMessage({ type: "sync-now" });
        status.textContent = renderSummary(result);
    } catch (error) {
        status.textContent = `Sync failed: ${String(error)}`;
    } finally {
        syncButton.disabled = false;
    }
}

syncButton.addEventListener("click", syncNow);
