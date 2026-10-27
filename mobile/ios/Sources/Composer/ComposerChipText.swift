import Foundation

/// Only picker-selected mentions collapse to one rendered character.
struct ComposerChipText {
    struct Chip: Equatable {
        let range: NSRange
        let item: ComposerSuggestion
    }

    let text: String
    let chips: [Chip]
    var renderedLength: Int { text.utf16.count - chips.reduce(0) { $0 + $1.range.length - 1 } }

    init(text: String, chips: [Chip]) {
        self.text = text
        self.chips = chips
    }

    func selecting(_ item: ComposerSuggestion, at query: ComposerQuery) -> (document: ComposerChipText, caret: Int)? {
        guard let result = query.inserting(item, into: text) else { return nil }
        let delta = result.text.utf16.count - text.utf16.count
        let retained = chips.compactMap { chip -> Chip? in
            if chip.range.upperBound <= query.range.location { return chip }
            if chip.range.location >= query.range.upperBound { return Chip(range: NSRange(location: chip.range.location + delta, length: chip.range.length), item: chip.item) }
            return nil
        }
        let selected = Chip(range: NSRange(location: query.range.location, length: item.token.utf16.count), item: item)
        return (ComposerChipText(text: result.text, chips: (retained + [selected]).sorted { $0.range.location < $1.range.location }), result.caret)
    }

    var content: [ComposerPromptPart] {
        var result: [ComposerPromptPart] = []
        var cursor = 0
        for chip in chips {
            if chip.range.location > cursor { result.append(.init(type: "text", text: (text as NSString).substring(with: NSRange(location: cursor, length: chip.range.location - cursor)))) }
            let item = chip.item
            let prefix = item.kind == .agent ? "agent:" : "plugin:"
            let id = item.kind != .skill && item.id.hasPrefix(prefix) ? String(item.id.dropFirst(prefix.count)) : item.id
            result.append(.init(type: "mention", kind: item.kind == .agent ? "custom" : item.kind.rawValue, id: id, label: item.name, value: item.value, groupId: item.kind == .agent ? "agents" : nil))
            cursor = chip.range.upperBound
        }
        if cursor < text.utf16.count { result.append(.init(type: "text", text: (text as NSString).substring(from: cursor))) }
        return result
    }

    func canonicalRange(_ range: NSRange) -> NSRange {
        let start = canonicalOffset(range.location)
        return NSRange(location: start, length: canonicalOffset(range.upperBound) - start)
    }

    func renderedRange(_ range: NSRange) -> NSRange {
        let start = renderedOffset(range.location)
        return NSRange(location: start, length: renderedOffset(range.upperBound) - start)
    }

    private func canonicalOffset(_ offset: Int) -> Int {
        let offset = min(max(0, offset), renderedLength)
        var removed = 0
        for chip in chips {
            if offset <= chip.range.location - removed { break }
            removed += chip.range.length - 1
        }
        return offset + removed
    }

    private func renderedOffset(_ offset: Int) -> Int {
        let offset = min(max(0, offset), text.utf16.count)
        var removed = 0
        for chip in chips {
            if offset <= chip.range.location { break }
            if offset < chip.range.upperBound {
                return chip.range.location - removed + (offset - chip.range.location > chip.range.length / 2 ? 1 : 0)
            }
            removed += chip.range.length - 1
        }
        return offset - removed
    }

}

struct ComposerPromptPart: Encodable {
    let type: String
    var text: String? = nil
    var kind: String? = nil
    var id: String? = nil
    var label: String? = nil
    var value: String? = nil
    var groupId: String? = nil
}
