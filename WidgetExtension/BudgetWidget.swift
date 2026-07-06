import WidgetKit
import SwiftUI

// MARK: - Timeline Provider

struct BudgetTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> BudgetEntry {
        BudgetEntry(date: Date(), spent: 1280.50, budget: 5000.00, category: "本月预算")
    }

    func getSnapshot(in context: Context, completion: @escaping (BudgetEntry) -> Void) {
        let entry = BudgetEntry(date: Date(), spent: 1280.50, budget: 5000.00, category: "本月预算")
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BudgetEntry>) -> Void) {
        // In production, this would read from shared UserDefaults via App Group
        let entry = BudgetEntry(date: Date(), spent: 1280.50, budget: 5000.00, category: "本月预算")
        let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
}

// MARK: - Timeline Entry

struct BudgetEntry: TimelineEntry {
    let date: Date
    let spent: Double
    let budget: Double
    let category: String

    var remaining: Double {
        max(budget - spent, 0)
    }

    var percentage: Double {
        guard budget > 0 else { return 0 }
        return min(spent / budget, 1.0)
    }

    var isOverBudget: Bool {
        spent > budget
    }
}

// MARK: - Budget Progress View

struct BudgetProgressView: View {
    let entry: BudgetEntry
    let isMedium: Bool

    private var progressColor: Color {
        if entry.isOverBudget {
            return .red
        } else if entry.percentage > 0.8 {
            return .orange
        } else {
            return Color(red: 0.85, green: 0.2, blue: 0.2) // 大红花 red
        }
    }

    var body: some View {
        if isMedium {
            mediumLayout
        } else {
            smallLayout
        }
    }

    private var smallLayout: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("大红花")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
                Spacer()
            }

            Spacer()

            Text("\(Int(entry.percentage * 100))%")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundColor(progressColor)

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.gray.opacity(0.2))
                        .frame(height: 8)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(progressColor)
                        .frame(width: geometry.size.width * entry.percentage, height: 8)
                }
            }
            .frame(height: 8)

            Text("剩余 ¥\(String(format: "%.0f", entry.remaining))")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.secondary)
        }
        .padding()
    }

    private var mediumLayout: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("大红花记账")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)

                Text(entry.category)
                    .font(.system(size: 15, weight: .semibold))

                Spacer()

                VStack(alignment: .leading, spacing: 2) {
                    Text("已花费 ¥\(String(format: "%.2f", entry.spent))")
                        .font(.system(size: 13, weight: .medium))
                    Text("预算 ¥\(String(format: "%.0f", entry.budget))")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.15), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: entry.percentage)
                    .stroke(progressColor, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.8), value: entry.percentage)

                VStack(spacing: 0) {
                    Text("\(Int(entry.percentage * 100))%")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundColor(progressColor)
                    Text(entry.isOverBudget ? "超支" : "已用")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }
            .frame(width: 80, height: 80)
        }
        .padding()
    }
}

// MARK: - Widget

struct BudgetWidget: Widget {
    let kind: String = "BudgetWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BudgetTimelineProvider()) { entry in
            BudgetWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("预算概览")
        .description("查看本月预算使用情况")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct BudgetWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: BudgetEntry

    var body: some View {
        switch family {
        case .systemSmall:
            BudgetProgressView(entry: entry, isMedium: false)
        case .systemMedium:
            BudgetProgressView(entry: entry, isMedium: true)
        default:
            BudgetProgressView(entry: entry, isMedium: false)
        }
    }
}

// MARK: - Preview

#Preview(as: .systemSmall) {
    BudgetWidget()
} timeline: {
    BudgetEntry(date: Date(), spent: 1280.50, budget: 5000.00, category: "本月预算")
    BudgetEntry(date: Date(), spent: 4200.00, budget: 5000.00, category: "本月预算")
}

#Preview(as: .systemMedium) {
    BudgetWidget()
} timeline: {
    BudgetEntry(date: Date(), spent: 1280.50, budget: 5000.00, category: "本月预算")
    BudgetEntry(date: Date(), spent: 5500.00, budget: 5000.00, category: "本月预算")
}
