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
                        Section {
                            if provider.failed {
                                Text("Couldn’t load usage").foregroundStyle(.secondary)
                                Button("Retry") { model.loadUsage() }
                            } else {
                                TimelineView(.periodic(from: .now, by: 60)) { context in
                                    VStack(spacing: 24) {
                                        ForEach(provider.rows) { row in
                                            VStack(alignment: .leading, spacing: 10) {
                                                HStack {
                                                    Text(row.label).fontWeight(.medium)
                                                    Spacer()
                                                    Text(row.remainingFraction == nil ? "Unavailable" : "\(row.remaining) left")
                                                        .foregroundStyle(.secondary)
                                                        .monospacedDigit()
                                                }
                                                if let remaining = row.remainingFraction {
                                                    ProgressView(value: remaining)
                                                        .tint(.accentColor)
                                                        .accessibilityHidden(true)
                                                }
                                                if let reset = row.reset(at: context.date) {
                                                    Text("Resets in \(reset)")
                                                        .font(.subheadline)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                            .accessibilityElement(children: .combine)
                                        }
                                    }
                                    .padding(.vertical, 8)
                                }
                            }
                        } header: {
                            HStack(spacing: 8) {
                                if ["codex", "claude"].contains(provider.backend) {
                                    Image("provider-\(provider.backend)")
                                        .resizable().scaledToFit()
                                        .frame(width: 24, height: 24)
                                        .accessibilityHidden(true)
                                }
                                Text(provider.name)
                            }
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .textCase(nil)
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
