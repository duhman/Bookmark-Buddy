const NATIVE_APP_IDENTIFIER = "marten.Bookmark-Buddy";

async function getOpenTabsSnapshot() {
    const tabs = await browser.tabs.query({});
    return tabs
        .filter((tab) => tab.url)
        .map((tab) => ({
            id: tab.id,
            title: tab.title ?? "Untitled",
            url: tab.url,
            active: Boolean(tab.active),
            pinned: Boolean(tab.pinned),
            windowId: tab.windowId
        }));
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

async function synchronizeSnapshot() {
    const [tabs, bookmarks] = await Promise.all([
        getOpenTabsSnapshot(),
        getBookmarkSnapshot()
    ]);

    const snapshot = {
        capturedAt: new Date().toISOString(),
        tabs,
        bookmarks,
        device: "iPhone 13 Pro+",
        minimumiOS: "26.0"
    };

    await browser.storage.local.set({ lastSnapshot: snapshot });

    let nativeResult = { ok: false, reason: "native-messaging-unavailable" };
    try {
        nativeResult = await browser.runtime.sendNativeMessage(NATIVE_APP_IDENTIFIER, {
            type: "syncSnapshot",
            payload: snapshot
        });
    } catch (error) {
        nativeResult = { ok: false, reason: String(error) };
    }

    return {
        ok: true,
        snapshot,
        nativeResult
    };
}

browser.runtime.onMessage.addListener((request) => {
    if (request?.type === "sync-now") {
        return synchronizeSnapshot();
    }

    if (request?.type === "get-last-snapshot") {
        return browser.storage.local.get("lastSnapshot");
    }

    return Promise.resolve({ ok: false, reason: "unsupported-message" });
});
