import Foundation

struct ComposerSkill: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let insertText: String
    let description: String
}

/// The editable mention under the caret, using the text field's UTF-16 selection offsets.
struct SkillQuery: Equatable {
    let query: String
    let range: NSRange

    /// SwiftUI can briefly publish the previous selection after the text has changed.
    static func at(_ text: String, selection: Range<String.Index>) -> SkillQuery? {
        guard selection.lowerBound >= text.startIndex, selection.upperBound <= text.endIndex else { return nil }
        return at(text, selection: NSRange(selection, in: text))
    }

    static func at(_ text: String, selection: NSRange) -> SkillQuery? {
        guard selection.length == 0, let caret = Range(selection, in: text)?.lowerBound else { return nil }
        let prefix = String(text[..<caret])
        guard let match = trigger.firstMatch(in: prefix, range: NSRange(prefix.startIndex..., in: prefix)) else { return nil }
        let query = (prefix as NSString).substring(with: match.range(at: 1))
        // Replacing in the middle of a mention also consumes the remainder of that token.
        let suffix = text[caret...].prefix { $0.unicodeScalars.allSatisfy { tokenCharacters.contains($0) } }
        return SkillQuery(query: query, range: NSRange(location: match.range.location, length: match.range.length + suffix.utf16.count))
    }

    func matches(_ skills: [ComposerSkill]) -> [ComposerSkill] {
        guard !query.isEmpty else { return skills }
        return skills.filter { skill in
            [skill.name, skill.insertText, skill.description].contains { $0.localizedStandardContains(query) }
        }
    }

    func inserting(_ skill: ComposerSkill, into text: String) -> (text: String, caret: Int)? {
        guard let token = Range(range, in: text) else { return nil }
        let prefix = String(text[..<token.lowerBound])
        var suffix = text[token.upperBound...]
        if suffix.first == " " { suffix = suffix.dropFirst() }
        let insertion = "$" + skill.insertText + " "
        return (prefix + insertion + suffix, prefix.utf16.count + insertion.utf16.count)
    }

    private static let trigger = try! NSRegularExpression(pattern: #"(?<![\w.%+$-])\$([^\s/$]*)\z"#)
    private static let tokenCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-")
}
