import Foundation

/// Prompt text stays canonical. Only the editor collapses known skill mentions to one character.
struct SkillChipText {
    struct Chip: Equatable {
        let range: NSRange
        let skill: ComposerSkill
    }

    let text: String
    let chips: [Chip]
    var renderedLength: Int { text.utf16.count - chips.reduce(0) { $0 + $1.range.length - 1 } }

    init(text: String, chips: [Chip]) {
        self.text = text
        self.chips = chips
    }

    init(text: String, skills: [ComposerSkill]) {
        self.text = text
        chips = Self.tokens.matches(in: text, range: NSRange(location: 0, length: text.utf16.count)).compactMap { match in
            guard match.range(at: 2).location != NSNotFound else { return nil }
            let alias = (text as NSString).substring(with: match.range(at: 2))
            guard let skill = skills.first(where: { $0.insertText.caseInsensitiveCompare(alias) == .orderedSame }) else { return nil }
            let range = NSRange(location: match.range(at: 2).location - 1, length: match.range(at: 2).length + 1)
            return Chip(range: range, skill: skill)
        }
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

    // Match the SDK editor's token boundaries and preserve inline code as ordinary text.
    private static let tokens = try! NSRegularExpression(pattern: #"(`[^`]+`)|(?<![\w.%+\-$])\$([^\s@$]+)"#)
}
