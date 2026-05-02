const NATIVE_APP_IDENTIFIER = "marten.Bookmark-Buddy";
const LAST_SYNC_KEY = "lastSnapshot";
const SYNC_DEBOUNCE_MS = 1200;

let pendingSyncTimer;
let syncInFlight = false;
let lastSnapshotSignature;

function normalizeTab(tab) {
    return {
        id: tab.id,
        title: tab.title ?? "Untitled",
        url: tab.url,
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        windowId: tab.windowId
    };
}

async function getOpenTabsSnapshot() {
    const tabs = await browser.tabs.query({});
    return tabs.filter((tab) => tab.url).map(normalizeTab);
}

async function getBookmarkSnapshot() {
    if (!browser.bookmarks?.getTree) {
        return [];
    }

    const roots = await browser.bookmarks.getTree();
    const flattened = [];

    const walk = (nodes, parentPath = "") => {
        for (const node of nodes) {
            const label = node.title || "Root";
            const path = parentPath ? `${parentPath}/${label}` : label;

            if (node.url) {
                flattened.push({
                    id: node.id,
                    title: node.title ?? "Untitled Bookmark",
                    url: node.url,
                    path
                });
            }

            if (node.children?.length) {
                walk(node.children, path);
            }
        }
    };

    walk(roots);
    return flattened;
}

function buildSnapshotSignature(tabs, bookmarks) {
    return JSON.stringify({
        tabs: tabs.map((tab) => [tab.url, tab.title, tab.pinned]),
        bookmarks: bookmarks.map((bookmark) => [bookmark.url, bookmark.title, bookmark.path])
    });
}

async function getDeviceDescriptor() {
    try {
        const info = await browser.runtime.getPlatformInfo();
        return `${info.os}-${info.arch}`;
    } catch {
        return "unknown-platform";
    }
}

async function sendSnapshotToNativeHost(snapshot) {
    try {
        return await browser.runtime.sendNativeMessage(NATIVE_APP_IDENTIFIER, {
            type: "syncSnapshot",
            payload: snapshot
        });
    } catch (error) {
        return { ok: false, reason: String(error) };
    }
}

async function synchronizeSnapshot(reason = "manual") {
    if (syncInFlight) {
        return { ok: false, reason: "sync-already-running" };
    }

    syncInFlight = true;

    try {
        const [tabs, bookmarks, device] = await Promise.all([
            getOpenTabsSnapshot(),
            getBookmarkSnapshot(),
            getDeviceDescriptor()
        ]);

        const signature = buildSnapshotSignature(tabs, bookmarks);
        const isUnchanged = signature === lastSnapshotSignature;

        const snapshot = {
            capturedAt: new Date().toISOString(),
            reason,
            tabs,
            bookmarks,
            device,
            changed: !isUnchanged
        };

        let nativeResult = { ok: true, skipped: true, reason: "snapshot-unchanged" };
        if (!isUnchanged || reason === "manual") {
            nativeResult = await sendSnapshotToNativeHost(snapshot);
            if (nativeResult?.ok) {
                lastSnapshotSignature = signature;
            }
        }

        await browser.storage.local.set({
            [LAST_SYNC_KEY]: {
                ...snapshot,
                nativeResult
            }
        });

        return {
            ok: true,
            snapshot,
            nativeResult
        };
    } finally {
        syncInFlight = false;
    }
}

function queueBackgroundSync(reason) {
    clearTimeout(pendingSyncTimer);
    pendingSyncTimer = setTimeout(() => {
        synchronizeSnapshot(reason);
    }, SYNC_DEBOUNCE_MS);
}

function registerAutoSyncListeners() {
    browser.tabs.onCreated.addListener(() => queueBackgroundSync("tab-created"));
    browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
        if (changeInfo.url || changeInfo.title || typeof changeInfo.pinned === "boolean") {
            queueBackgroundSync("tab-updated");
        }
    });
    browser.tabs.onRemoved.addListener(() => queueBackgroundSync("tab-removed"));

    if (browser.bookmarks?.onCreated) {
        browser.bookmarks.onCreated.addListener(() => queueBackgroundSync("bookmark-created"));
        browser.bookmarks.onChanged.addListener(() => queueBackgroundSync("bookmark-changed"));
        browser.bookmarks.onMoved.addListener(() => queueBackgroundSync("bookmark-moved"));
        browser.bookmarks.onRemoved.addListener(() => queueBackgroundSync("bookmark-removed"));
        browser.bookmarks.onImportEnded?.addListener(() => queueBackgroundSync("bookmark-import"));
    }

    browser.runtime.onStartup.addListener(() => queueBackgroundSync("extension-startup"));
    browser.runtime.onInstalled.addListener(() => queueBackgroundSync("extension-installed"));
}

browser.runtime.onMessage.addListener((request) => {
    if (request?.type === "sync-now") {
        return synchronizeSnapshot("manual");
    }

    if (request?.type === "get-last-snapshot") {
        return browser.storage.local.get(LAST_SYNC_KEY);
    }

    return Promise.resolve({ ok: false, reason: "unsupported-message" });
});

registerAutoSyncListeners();
queueBackgroundSync("background-initialized");
