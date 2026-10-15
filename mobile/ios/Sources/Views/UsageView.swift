import SwiftUI

struct UsageView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        AppSheetList {
            if model.connection != .connected {
                ContentUnavailableView {
                    Label("Laptop disconnected", systemImage: "laptopcomputer")
                } description: {
                    Text("Connect to your laptop to see usage.")
                } actions: {
                    Button("Reconnect") { model.reconnect() }
                }
            } else {
                switch model.usage.status {
                case .idle, .loading:
                    HStack { Spacer(); ProgressView("Loading usage…"); Spacer() }
                case .failed:
                    ContentUnavailableView {
                        Label("Couldn’t load usage", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("Check your laptop connection and try again.")
                    } actions: {
                        Button("Retry") { model.loadUsage() }
                    }
                case .loaded:
                    if model.usage.visibleProviders.isEmpty {
                        Text("No usage limits available.").foregroundStyle(.secondary)
                    }
                    ForEach(model.usage.visibleProviders) { provider in
                        Section(provider.name) {
                            if provider.failed {
                                Text("Couldn’t load usage").foregroundStyle(.secondary)
                                Button("Retry") { model.loadUsage() }
                            } else {
                                TimelineView(.periodic(from: .now, by: 60)) { context in
                                    VStack(spacing: 16) {
                                        ForEach(provider.rows) { row in
                                            HStack {
                                                VStack(alignment: .leading, spacing: 4) {
                                                    Text(row.label)
                                                    if let reset = row.reset(at: context.date) {
                                                        Text("Resets in \(reset)").font(.caption).foregroundStyle(.secondary)
                                                    }
                                                }
                                                Spacer()
                                                Text("\(row.remaining) left").monospacedDigit()
                                            }
                                            .accessibilityElement(children: .combine)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Usage")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Refresh", systemImage: "arrow.clockwise") { model.loadUsage() }
                    .disabled(model.connection != .connected || model.usage.status == .loading)
            }
        }
        .task { model.loadUsage() }
        .onChange(of: model.connection) { _, connection in if connection == .connected { model.loadUsage() } }
    }
}
