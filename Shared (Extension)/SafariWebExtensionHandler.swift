//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Created by Adrian Martén on 2025-01-09.
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let logger = Logger(subsystem: "marten.Bookmark-Buddy.Extension", category: "sync")
    private let snapshotStorageKey = "latestBrowserSnapshot"

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        logger.log("Received native message from extension profile=\(profile?.uuidString ?? "none", privacy: .public)")

        let payload = message as? [String: Any]
        let responseMessage = handle(message: payload)

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responseMessage]
        } else {
            response.userInfo = ["message": responseMessage]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func handle(message: [String: Any]?) -> [String: Any] {
        guard let message else {
            return ["ok": false, "reason": "missing-message"]
        }

        guard let type = message["type"] as? String else {
            return ["ok": false, "reason": "missing-type"]
        }

        switch type {
        case "syncSnapshot":
            guard let payload = message["payload"] as? [String: Any] else {
                return ["ok": false, "reason": "missing-payload"]
            }

            guard payload["capturedAt"] as? String != nil,
                  payload["tabs"] as? [[String: Any]] != nil,
                  payload["bookmarks"] as? [[String: Any]] != nil else {
                return ["ok": false, "reason": "invalid-payload-shape"]
            }

            do {
                let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
                UserDefaults.standard.set(data, forKey: snapshotStorageKey)
                return [
                    "ok": true,
                    "stored": true,
                    "tabCount": (payload["tabs"] as? [[String: Any]])?.count ?? 0,
                    "bookmarkCount": (payload["bookmarks"] as? [[String: Any]])?.count ?? 0
                ]
            } catch {
                logger.error("Could not serialize snapshot payload: \(error.localizedDescription, privacy: .public)")
                return ["ok": false, "reason": "serialization-failed"]
            }

        case "getLatestSnapshot":
            guard let data = UserDefaults.standard.data(forKey: snapshotStorageKey) else {
                return ["ok": true, "snapshot": NSNull()]
            }

            let object = (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()
            return ["ok": true, "snapshot": object]

        default:
            return ["ok": false, "reason": "unsupported-type"]
        }
    }
}
