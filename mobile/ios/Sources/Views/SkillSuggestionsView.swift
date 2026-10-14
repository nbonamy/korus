import SwiftUI

/// A native list above the composer; choosing a row leaves editing and the keyboard active.
struct SkillSuggestionsView: View {
    let catalog: EngineState.Skills
    let query: SkillQuery
    let select: (ComposerSkill) -> Void
    let dismiss: () -> Void
    let retry: () -> Void

    var body: some View {
        let matches = query.matches(catalog.items)
        VStack(spacing: 0) {
            HStack {
                Text("Skills").font(.subheadline.weight(.semibold))
                Spacer()
                Button(action: dismiss) { Image(systemName: "xmark").font(.footnote.weight(.semibold)).frame(width: 44, height: 40) }
                    .accessibilityLabel("Dismiss skill suggestions")
            }
            .padding(.leading, 16).padding(.trailing, 4)
            switch catalog.status {
            case .idle, .loading:
                ProgressView("Loading skills…").frame(maxWidth: .infinity).frame(height: 56)
            case .failed:
                HStack {
                    Text("Couldn’t load skills.").foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry", action: retry)
                }
                .font(.subheadline).padding(16)
            case .loaded:
                if matches.isEmpty {
                    Text(catalog.items.isEmpty ? "No skills available." : "No matching skills.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(matches) { skill in
                                Button { select(skill) } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(skill.name).font(.subheadline.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                                        if !skill.description.isEmpty {
                                            Text(skill.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                        }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                                    .padding(.horizontal, 16).padding(.vertical, 7)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityHint("Insert $\(skill.insertText)")
                            }
                        }
                    }
                    .frame(height: min(CGFloat(matches.count) * 64, 240))
                    .scrollDismissesKeyboard(.never)
                }
            }
        }
        .padding(.bottom, 4)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}
