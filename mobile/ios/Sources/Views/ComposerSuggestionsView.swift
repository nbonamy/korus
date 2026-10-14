import SwiftUI

/// Choosing a row inserts a chip and leaves editing and the keyboard active.
struct ComposerSuggestionsView: View {
    let catalog: EngineState.Suggestions
    let query: ComposerQuery
    let select: (ComposerSuggestion) -> Void
    let dismiss: () -> Void
    let retry: () -> Void
    @ScaledMetric(relativeTo: .subheadline) private var rowHeight = 44
    @ScaledMetric(relativeTo: .subheadline) private var detailRowHeight = 52
    @ScaledMetric(relativeTo: .caption) private var sectionHeight = 24

    var body: some View {
        let matches = query.matches(catalog.items)
        let groups = Set(matches.map(\.kind)).count
        let listHeight = matches.reduce(CGFloat(0)) { $0 + ($1.description.isEmpty ? rowHeight : detailRowHeight) }
            + (query.isSkill ? 0 : CGFloat(groups) * sectionHeight)
        VStack(spacing: 0) {
            HStack {
                Text(query.isSkill ? "Skills" : "Agents & Plugins").font(.subheadline.weight(.semibold))
                Spacer()
                Button(action: dismiss) { Image(systemName: "xmark").font(.footnote.weight(.semibold)).frame(width: 44, height: 40) }
                    .accessibilityLabel("Dismiss suggestions")
            }
            .padding(.leading, 16).padding(.trailing, 4)
            if !matches.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(ComposerSuggestion.Kind.allCases, id: \.self) { kind in
                            let group = matches.filter { $0.kind == kind }
                            if !group.isEmpty {
                                if !query.isSkill {
                                    Text(kind.title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                        .padding(.horizontal, 14).frame(height: sectionHeight, alignment: .leading)
                                }
                                ForEach(group) { item in
                                    Button { select(item) } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: kind.symbol).foregroundStyle(.secondary).frame(width: 20)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(item.name).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                                                if !item.description.isEmpty {
                                                    Text(item.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                                }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                        .padding(.horizontal, 14).padding(.vertical, 4)
                                        .frame(minHeight: item.description.isEmpty ? rowHeight : detailRowHeight)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityHint("Insert \(item.name)")
                                }
                            }
                        }
                    }
                }
                .frame(height: min(listHeight, 240))
                .scrollDismissesKeyboard(.never)
            }
            switch catalog.status {
            case .idle, .loading:
                ProgressView(query.isSkill ? "Loading skills…" : "Loading plugins…")
                    .font(.subheadline).frame(maxWidth: .infinity).padding(16)
            case .failed:
                HStack {
                    Text(query.isSkill ? "Couldn’t load skills." : "Couldn’t load plugins.").foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry", action: retry)
                }.font(.subheadline).padding(16)
            case .loaded:
                if matches.isEmpty {
                    Text(query.isSkill ? "No matching skills." : "No matching agents or plugins.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                }
            }
        }
        .padding(.bottom, 4)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}
