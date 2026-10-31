import ActivityKit
import SwiftUI
import WidgetKit

@main struct WorkActivityBundle: WidgetBundle {
    var body: some Widget { WorkActivityWidget() }
}

struct WorkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkActivityAttributes.self) { context in
            WorkActivityLockScreen(state: context.state, isStale: context.isStale, hostId: context.attributes.hostId)
                .activityBackgroundTint(.black.opacity(0.8))
                .widgetURL(context.attributes.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    WorkActivityContent(state: context.state, isStale: context.isStale, hostId: context.attributes.hostId, spacing: 8)
                }
            } compactLeading: {
                WorkActivityMark(size: 16)
            } compactTrailing: {
                Group {
                    if let startedAt = context.state.singleTaskStartedAt {
                        Text(Date(timeIntervalSince1970: startedAt / 1000), style: .timer)
                            .monospacedDigit().frame(width: 42)
                    } else {
                        Text("\(context.state.activeCount)").monospacedDigit()
                            .accessibilityLabel("\(context.state.activeCount) tasks")
                    }
                }.foregroundStyle(context.state.attention > 0 ? Color.orange : Color.primary)
            } minimal: {
                WorkActivityMark(size: 16)
            }
            .widgetURL(context.attributes.url)
        }
    }
}
