import SwiftUI

struct ComposerAttachmentsView: View {
    let drafts: ComposerDrafts
    let openImage: (ComposerAttachment) -> Void

    var body: some View {
        if !drafts.items.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(drafts.items) { item in
                        HStack(spacing: 6) {
                            if item.type == .image, let image = UIImage(data: item.data) {
                                Button { openImage(item) } label: {
                                    Image(uiImage: image).resizable().scaledToFill().frame(width: 44, height: 44).clipped().clipShape(.rect(cornerRadius: 6))
                                }.buttonStyle(.plain).accessibilityLabel("View \(item.name)")
                            } else { Image(systemName: "doc").font(.title3).frame(width: 32, height: 44) }
                            Text(item.name).font(.caption).lineLimit(2).frame(maxWidth: 130, alignment: .leading)
                            Button { drafts.remove(item.id) } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(width: 32, height: 44)
                            }
                            .accessibilityLabel("Remove \(item.name)")
                            .disabled(drafts.sending)
                        }
                        .padding(.leading, 6)
                        .background(.quaternary, in: .rect(cornerRadius: 10))
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        if drafts.importing {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Preparing attachments…").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
        if let error = drafts.error {
            HStack(alignment: .top) {
                Text(error).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button { drafts.dismissError() } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }
                    .accessibilityLabel("Dismiss attachment message")
            }
        }
    }
}
