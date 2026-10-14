import Foundation
import XCTest
@testable import CompanionComposer

final class SkillCompletionTests: XCTestCase {
    private let skills = [
        ComposerSkill(id: "commit", name: "Commit-Push (cp)", insertText: "cp", description: "Commit and push changes"),
        ComposerSkill(id: "review", name: "Review", insertText: "review", description: "Inspect pending changes")
    ]

    func testDollarOpensAllSkillsAndTypingFiltersNamesAliasesAndDescriptions() throws {
        let all = try XCTUnwrap(SkillQuery.at("Please $", selection: NSRange(location: 8, length: 0)))
        XCTAssertEqual(all.matches(skills), skills)
        for query in ["CP", "commit", "push"] {
            let text = "$" + query
            let active = try XCTUnwrap(SkillQuery.at(text, selection: NSRange(location: text.utf16.count, length: 0)))
            XCTAssertEqual(active.matches(skills), [skills[0]])
        }
        XCTAssertEqual(SkillQuery.at("$absent", selection: NSRange(location: 7, length: 0))?.matches(skills), [])
    }

    func testCompletionReplacesTheTokenAtTheCaretAndPreservesTheRestOfTheDraft() throws {
        let draft = "🦞 Please $revi later"
        let caret = (draft as NSString).range(of: "$re").upperBound
        let query = try XCTUnwrap(SkillQuery.at(draft, selection: NSRange(location: caret, length: 0)))
        XCTAssertEqual(query.query, "re")
        let result = try XCTUnwrap(query.inserting(skills[1], into: draft))
        XCTAssertEqual(result.text, "🦞 Please $review later")
        XCTAssertEqual(result.caret, (result.text as NSString).range(of: "later").location)
        let alias = try XCTUnwrap(SkillQuery.at("$", selection: NSRange(location: 1, length: 0))?.inserting(skills[0], into: "$"))
        XCTAssertEqual(alias.text, "$cp ")
        XCTAssertEqual(alias.caret, 4)
    }

    func testCompletedMentionsOrdinaryDollarTextAndSelectionsDoNotOpenSuggestions() {
        for text in ["hello", "$review ", "$review\n", "price$20", "$$", "$a/b"] {
            XCTAssertNil(SkillQuery.at(text, selection: NSRange(location: text.utf16.count, length: 0)), text)
        }
        XCTAssertNil(SkillQuery.at("$review", selection: NSRange(location: 1, length: 3)))
        XCTAssertNil(SkillQuery.at("$", selection: NSRange(location: 10, length: 0)))
    }

    func testAnOldTextFieldSelectionCannotCrashAfterClearingOrShorteningTheDraft() {
        let previous = "$review"
        let selection = previous.endIndex..<previous.endIndex
        XCTAssertNil(SkillQuery.at("", selection: selection))
        XCTAssertNil(SkillQuery.at("$", selection: selection))
    }
}
