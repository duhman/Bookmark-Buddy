const syncButton = document.getElementById("syncButton");
const status = document.getElementById("status");

function renderSummary(result) {
    if (!result?.ok) {
        return `Sync failed: ${result?.reason ?? "Unknown error"}`;
    }

    const { snapshot, nativeResult } = result;
    return [
        `Synced at: ${snapshot.capturedAt}`,
        `Reason: ${snapshot.reason}`,
        `Open tabs: ${snapshot.tabs.length}`,
        `Bookmarks: ${snapshot.bookmarks.length}`,
        `Native storage: ${nativeResult?.ok ? "updated" : `unavailable (${nativeResult?.reason ?? "unknown"})`}`
    ].join("\n");
}

async function showLastSnapshot() {
    try {
        const data = await browser.runtime.sendMessage({ type: "get-last-snapshot" });
        const snapshot = data?.lastSnapshot;

        if (!snapshot) {
            status.textContent = "No sync yet. Tap 'Sync now'.";
            return;
        }

        status.textContent = renderSummary({
            ok: true,
            snapshot,
            nativeResult: snapshot.nativeResult
        });
    } catch (error) {
        status.textContent = `Could not read last sync: ${String(error)}`;
    }
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
showLastSnapshot();
