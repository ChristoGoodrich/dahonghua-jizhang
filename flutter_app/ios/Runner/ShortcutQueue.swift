// The requests Shortcuts handed the app, kept until Dart has recorded them.
//
// An App Intent may run with the app closed — after an Apple Pay payment,
// from Siri, from the Action button — and then no Dart is running, so the
// intent only writes the request down here. Dart reads the queue through the
// `com.dahonghua/shortcuts` channel the next time the app runs
// (`shortcuts.dart`), has the core turn each request into entries, saves the
// ledger, and only then tells this queue to forget them. A crash in between
// hands the same requests over again, and the core recognises them.
//
// A JSON array in Application Support rather than Documents: it is not the
// ledger, and a backup or a restore has no business with it.

import Foundation

final class ShortcutQueue: @unchecked Sendable {
  static let shared = ShortcutQueue()

  /// Posted after a request is written, so an app that is open records it now.
  static let queued = Notification.Name("com.dahonghua.shortcutQueued")

  private let lock = NSLock()
  private let url: URL

  init(directory: URL? = nil) {
    let base =
      directory
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    url = base.appendingPathComponent("shortcuts.json")
  }

  /// Write a request down: `sentence`, or `amount`, `merchant` and `region`.
  /// Its id and the moment are added here, and the moment is what an entry
  /// is put at.
  func append(_ fields: [String: Any]) {
    var row = fields
    row["id"] = UUID().uuidString
    row["at"] = Int64(Date().timeIntervalSince1970 * 1000)
    lock.lock()
    var rows = read()
    rows.append(row)
    write(rows)
    lock.unlock()
    NotificationCenter.default.post(name: Self.queued, object: nil)
  }

  /// Every request not yet acknowledged, oldest first.
  func pending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return read()
  }

  /// Forget these, once their entries are on disk.
  func consume(_ ids: [String]) {
    let gone = Set(ids)
    lock.lock()
    defer { lock.unlock() }
    write(read().filter { !gone.contains($0["id"] as? String ?? "") })
  }

  private func read() -> [[String: Any]] {
    guard let data = try? Data(contentsOf: url),
      let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return rows
  }

  private func write(_ rows: [[String: Any]]) {
    try? FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let data = try? JSONSerialization.data(withJSONObject: rows) else { return }
    try? data.write(to: url, options: .atomic)
  }
}
