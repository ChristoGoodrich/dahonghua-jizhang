// The app's own channels, iOS side.
//
// Android has a Kotlin class per channel under android/…/kotlin; these are
// the same channels answering the same calls, so the Dart side does not ask
// which phone it is on. Three of them: which build this is, which zone the
// clock is in, and whether the phone is saving power. The widget and the
// notification listener have no iOS side yet — the Dart side already treats
// a missing channel as "not on this phone".
//
// And two Android has no counterpart for: Reduce Transparency, which Flutter
// does not carry (accessibility.dart), and the Shortcuts queue, which is the
// iPhone's 自动记账 (shortcuts.dart).

import Flutter
import UIKit

enum NativeChannels {
  static func register(with registrar: FlutterPluginRegistrar) {
    let messenger = registrar.messenger()

    // 关于大红花: the version the phone holds. On Android the package manager
    // is asked because Gradle stamps the name; here the bundle says it, and a
    // build re-signed with a free Apple ID is not the "debug-signed" trap
    // Android's is — the next re-sign with the same ID installs over it.
    FlutterMethodChannel(name: "com.dahonghua/app_info", binaryMessenger: messenger)
      .setMethodCallHandler { call, result in
        guard call.method == "info" else { return result(FlutterMethodNotImplemented) }
        let info = Bundle.main.infoDictionary ?? [:]
        #if DEBUG
          let debuggable = true
        #else
          let debuggable = false
        #endif
        result([
          "version": info["CFBundleShortVersionString"] as? String ?? "",
          "code": Int(info["CFBundleVersion"] as? String ?? "") ?? 0,
          "debugSigned": false,
          "debuggable": debuggable,
        ])
      }

    // Reminders schedule in the phone's zone, which only the platform knows.
    FlutterMethodChannel(name: "com.dahonghua/zone", binaryMessenger: messenger)
      .setMethodCallHandler { call, result in
        guard call.method == "id" else { return result(FlutterMethodNotImplemented) }
        result(TimeZone.current.identifier)
      }

    // 低电量模式, as Android's battery saver: the glass drops its blur.
    FlutterEventChannel(name: "com.dahonghua/power", binaryMessenger: messenger)
      .setStreamHandler(power)

    // 降低透明度: the glass goes solid, as it does for 移除动画.
    FlutterEventChannel(name: "com.dahonghua/transparency", binaryMessenger: messenger)
      .setStreamHandler(transparency)

    // 快捷指令: the queue the App Intents write to (ShortcutQueue), read and
    // acknowledged by shortcuts.dart, and told when a request arrives while
    // the app is open.
    let shortcuts = FlutterMethodChannel(
      name: "com.dahonghua/shortcuts", binaryMessenger: messenger)
    shortcuts.setMethodCallHandler { call, result in
      switch call.method {
      case "pending":
        result(ShortcutQueue.shared.pending())
      case "consume":
        ShortcutQueue.shared.consume(call.arguments as? [String] ?? [])
        result(nil)
      case "openShortcuts":
        if let url = URL(string: "shortcuts://") {
          MainActor.assumeIsolated { UIApplication.shared.open(url) }
        }
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    _ = NotificationCenter.default.addObserver(
      forName: ShortcutQueue.queued, object: nil, queue: .main
    ) { _ in
      shortcuts.invokeMethod("queued", arguments: nil)
    }
  }

  static let power = FlagStream(
    changed: .NSProcessInfoPowerStateDidChange,
    read: { ProcessInfo.processInfo.isLowPowerModeEnabled })

  static let transparency = FlagStream(
    changed: UIAccessibility.reduceTransparencyStatusDidChangeNotification,
    // UIKit's, so the main actor's. Flutter calls onListen on the main
    // thread and the observer is queued there, which this asserts rather
    // than assumes.
    read: { MainActor.assumeIsolated { UIAccessibility.isReduceTransparencyEnabled } })
}

/// One setting of the phone's: its current value first, then every change —
/// the same shape as PowerChannel.kt, so a change cannot land between a read
/// and a listen.
final class FlagStream: NSObject, FlutterStreamHandler {
  private let changed: Notification.Name
  private let read: () -> Bool
  private var sink: FlutterEventSink?
  private var observer: NSObjectProtocol?

  init(changed: Notification.Name, read: @escaping () -> Bool) {
    self.changed = changed
    self.read = read
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink)
    -> FlutterError?
  {
    sink = events
    events(read())
    observer = NotificationCenter.default.addObserver(
      forName: changed, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.sink?(self.read())
    }
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    sink = nil
    return nil
  }
}

/// Nothing this app keeps goes to iCloud.
///
/// The ledger, the config, the receipts and the snapshots all live under
/// Documents, and iOS backs Documents up to iCloud unless told not to. The
/// app's promise is that nothing leaves the phone unless somebody sends it —
/// 导出, 同步, or an AI request the user pressed — and Android's manifest
/// keeps it by turning cloud backup off. This is the same promise here. The
/// flag on the folder covers what is inside it, and it is set at every
/// launch, so a folder recreated by a restore is covered too.
enum BackupExclusion {
  static func apply() {
    guard
      var docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? docs.setResourceValues(values)
  }
}
