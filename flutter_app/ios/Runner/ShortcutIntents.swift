// The app's App Intents: what Siri, the Action button, Spotlight and a
// Shortcuts automation can ask it to record.
//
// Neither records anything itself. Each writes the request down
// (`ShortcutQueue`) and returns at once — the Wallet automation is known to
// time out when an action is slow — and the entries are made by the core the
// next time the app runs (`shortcuts.dart`, `core::shortcut`). App Intents
// need no entitlement, so they work in a build signed with a free Apple ID.
//
// The strings are English, the project's development language; zh-Hans is
// in Localizable.strings, and the Siri phrases in AppShortcuts.strings.

import AppIntents

/// 记一笔: words, read the way 一句话记账 reads them — 午饭35 打车12 is two.
struct RecordEntryIntent: AppIntent {
  static var title: LocalizedStringResource = "Record an entry"
  static var description = IntentDescription(
    "Say what you spent, like “lunch 35, taxi 12”. It reaches the ledger the next time the app opens."
  )

  @Parameter(
    title: "What you spent",
    requestValueDialog: IntentDialog("What did you spend?"))
  var sentence: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    ShortcutQueue.shared.append(["sentence": sentence])
    return .result(dialog: IntentDialog("Noted. It reaches the ledger the next time Big Red Flower opens."))
  }
}

/// 记一笔付款: for the Wallet automation, which hands over the amount and the
/// merchant of every Apple Pay payment. Silent: it runs after each payment.
///
/// The amount is text, not a number. Wallet writes it with its currency —
/// `¥35.00`, `US$5.40`, `100,50 €` — and a number parameter would leave
/// Shortcuts to coerce that, in a way nobody here can test without a phone.
/// The words go through as they are, with the currency of the phone's
/// region, which is what a bare `$` or `¥` in them means; the core reads both
/// (`core::shortcut::read_amount`).
struct RecordPaymentIntent: AppIntent {
  static var title: LocalizedStringResource = "Record a payment"
  static var description = IntentDescription(
    "For the Wallet automation: the amount as Wallet writes it, and the merchant, recorded as an expense."
  )

  @Parameter(title: "Amount")
  var amount: String

  @Parameter(title: "Merchant")
  var merchant: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Record \(\.$amount) at \(\.$merchant)")
  }

  func perform() async throws -> some IntentResult {
    var row: [String: Any] = ["amount": amount]
    if let merchant { row["merchant"] = merchant }
    if let region = Locale.current.currency?.identifier { row["region"] = region }
    ShortcutQueue.shared.append(row)
    return .result()
  }
}

/// What Siri, Spotlight and the Action button offer without anybody building
/// a shortcut first.
struct DahonghuaShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RecordEntryIntent(),
      phrases: [
        "Record an entry in \(.applicationName)",
        "\(.applicationName) record an entry",
      ],
      shortTitle: "Record an entry",
      systemImageName: "plus.circle"
    )
  }
}
