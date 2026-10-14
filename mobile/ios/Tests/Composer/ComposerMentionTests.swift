import Foundation
import XCTest
@testable import CompanionComposer

final class ComposerMentionTests: XCTestCase {
    private let agent = ComposerSuggestion(id: "agent:a", name: "Reviewer · korus", insertText: "agent:a", description: "", kind: .agent)
    private let plugin = ComposerSuggestion(id: "plugin:github", name: "GitHub", insertText: "github", description: "Repositories and pull requests", kind: .plugin)
    private let skill = ComposerSuggestion(id: "review", name: "Review", insertText: "review", description: "Review changes")

    func testAtOffersAgentsAndPluginsAndFiltersLabelsAndDescriptions() throws {
        let items = [skill, agent, plugin]
        let query = try XCTUnwrap(ComposerQuery.at("@", selection: NSRange(location: 1, length: 0)))
        XCTAssertEqual(query.matches(items), [agent, plugin])
        for (text, expected) in [("@review", agent), ("@korus", agent), ("@GITHUB", plugin), ("@pull", plugin)] {
            let query = try XCTUnwrap(ComposerQuery.at(text, selection: NSRange(location: text.utf16.count, length: 0)))
            XCTAssertEqual(query.matches(items), [expected])
        }
        XCTAssertEqual(ComposerQuery.at("$", selection: NSRange(location: 1, length: 0))?.matches(items), [skill])
        XCTAssertNil(query.inserting(skill, into: "@"))
        for text in ["name@example.com", "@@", "@github ", "`@github", "https://host/@git"] {
            XCTAssertNil(ComposerQuery.at(text, selection: NSRange(location: text.utf16.count, length: 0)), text)
        }
    }

    func testSelectionCreatesChipsWithCanonicalTokensAndAtomicCopyDelete() throws {
        for item in [agent, plugin] {
            let draft = "🦞 Ask @rev later"
            let caret = (draft as NSString).range(of: "@r").upperBound
            let query = try XCTUnwrap(ComposerQuery.at(draft, selection: NSRange(location: caret, length: 0)))
            let result = try XCTUnwrap(query.inserting(item, into: draft))
            XCTAssertEqual(result.text, "🦞 Ask \(item.token) later")
            let document = ComposerChipText(text: result.text, suggestions: [agent, plugin])
            XCTAssertEqual(document.chips.map(\.item), [item])
            let renderedCaret = document.renderedRange(NSRange(location: result.caret, length: 0))
            // One backspace removes the trailing space; the next removes the whole chip.
            let deletion = document.canonicalRange(NSRange(location: renderedCaret.location - 2, length: 1))
            XCTAssertEqual((result.text as NSString).substring(with: deletion), item.token)
            XCTAssertEqual((result.text as NSString).replacingCharacters(in: deletion, with: ""), "🦞 Ask  later")
            XCTAssertEqual(document.canonicalRange(renderedCaret).location, result.caret)
        }
    }

    func testMixedChipsPreserveCodeEmailsAndUnknownMentionsAsText() {
        let text = "@agent:a @github $review `@github` x@github @unknown"
        let document = ComposerChipText(text: text, suggestions: [agent, plugin, skill])
        XCTAssertEqual(document.chips.map(\.item), [agent, plugin, skill])
        XCTAssertEqual(document.chips.map { (text as NSString).substring(with: $0.range) }, ["@agent:a", "@github", "$review"])
    }

    func testEngineCatalogDecodesKindsAndLegacySkills() throws {
        let json = #"[{"id":"a","name":"A","insertText":"agent:a","description":"","kind":"agent"},{"id":"p","name":"P","insertText":"p","description":"","kind":"plugin"},{"id":"s","name":"S","insertText":"s","description":""}]"#
        let items = try JSONDecoder().decode([ComposerSuggestion].self, from: Data(json.utf8))
        XCTAssertEqual(items.map(\.kind), [.agent, .plugin, .skill])
    }
}
