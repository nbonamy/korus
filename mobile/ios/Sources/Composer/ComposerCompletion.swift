import Foundation

struct ComposerSuggestion: Decodable, Equatable, Identifiable {
    enum Kind: String, Decodable, CaseIterable {
        case skill, agent, plugin
        var title: String { switch self { case .skill: "Skills"; case .agent: "Agents"; case .plugin: "Plugins" } }
        var symbol: String { switch self { case .skill: "sparkles"; case .agent: "person.crop.square"; case .plugin: "puzzlepiece.extension" } }
        var trigger: String { self == .skill ? "$" : "@" }
    }
    let id: String
    let name: String
    let insertText: String
    let description: String
    let kind: Kind
    var token: String { kind.trigger + insertText }

    init(id: String, name: String, insertText: String, description: String, kind: Kind = .skill) {
        self.id = id; self.name = name; self.insertText = insertText; self.description = description; self.kind = kind
    }
    private enum CodingKeys: CodingKey { case id, name, insertText, description, kind }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        insertText = try values.decode(String.self, forKey: .insertText)
        description = try values.decode(String.self, forKey: .description)
        kind = try values.decodeIfPresent(Kind.self, forKey: .kind) ?? .skill
    }
}

/// The editable mention under the caret, using the text field's UTF-16 selection offsets.
struct ComposerQuery: Equatable {
    let query: String
    let range: NSRange
    let trigger: String
    var isSkill: Bool { trigger == "$" }

    /// SwiftUI can briefly publish the previous selection after the text has changed.
    static func at(_ text: String, selection: Range<String.Index>) -> ComposerQuery? {
        guard selection.lowerBound >= text.startIndex, selection.upperBound <= text.endIndex else { return nil }
        return at(text, selection: NSRange(selection, in: text))
    }

    static func at(_ text: String, selection: NSRange) -> ComposerQuery? {
        guard selection.length == 0, let caret = Range(selection, in: text)?.lowerBound else { return nil }
        let prefix = String(text[..<caret])
        guard prefix.filter({ $0 == "`" }).count % 2 == 0,
              let match = pattern.firstMatch(in: prefix, range: NSRange(prefix.startIndex..., in: prefix)) else { return nil }
        let query = (prefix as NSString).substring(with: match.range(at: 2))
        let trigger = (prefix as NSString).substring(with: match.range(at: 1))
        // Replacing in the middle of a mention also consumes the remainder of that token.
        let suffix = text[caret...].prefix { !$0.isWhitespace && !"/@$".contains($0) }
        return ComposerQuery(query: query, range: NSRange(location: match.range.location, length: match.range.length + suffix.utf16.count), trigger: trigger)
    }

    func matches(_ suggestions: [ComposerSuggestion]) -> [ComposerSuggestion] {
        suggestions.filter { item in
            item.kind.trigger == trigger && (query.isEmpty ||
                [item.name, item.insertText, item.description].contains { $0.localizedStandardContains(query) })
        }
    }

    func inserting(_ item: ComposerSuggestion, into text: String) -> (text: String, caret: Int)? {
        guard item.kind.trigger == trigger, let token = Range(range, in: text) else { return nil }
        let prefix = String(text[..<token.lowerBound])
        var suffix = text[token.upperBound...]
        if suffix.first == " " { suffix = suffix.dropFirst() }
        let insertion = item.token + " "
        return (prefix + insertion + suffix, prefix.utf16.count + insertion.utf16.count)
    }

    private static let pattern = try! NSRegularExpression(pattern: #"(?<![\w.%+/@$-])([@$])([^\s/@$]*)\z"#)
}
