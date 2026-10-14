import Foundation
import XCTest
@testable import CompanionComposer

final class ComposerChipTextTests: XCTestCase {
    private let skills = [ComposerSuggestion(id: "commit", name: "Commit-Push (cp)", insertText: "cp", description: "Commit changes")]

    func testKnownSkillsBecomeChipsButCodeUnknownMentionsAndEmbeddedDollarsStayText() {
        let text = "🦞 $cp then `$cp` price$cp $unknown $CP"
        let document = ComposerChipText(text: text, suggestions: skills)
        XCTAssertEqual(document.chips.map(\.item.name), ["Commit-Push (cp)", "Commit-Push (cp)"])
        XCTAssertEqual(document.chips.map { (text as NSString).substring(with: $0.range) }, ["$cp", "$CP"])
        XCTAssertEqual(document.renderedLength, text.utf16.count - 4)
    }

    func testCaretAndSelectionRoundTripAcrossEmojiAndMultipleChips() {
        let text = "🦞 $cp and $cp "
        let document = ComposerChipText(text: text, suggestions: skills)
        // The emoji occupies two UTF-16 units; each item occupies one rendered unit.
        XCTAssertEqual(document.canonicalRange(NSRange(location: 4, length: 0)), NSRange(location: 6, length: 0))
        XCTAssertEqual(document.canonicalRange(NSRange(location: 3, length: 7)), NSRange(location: 3, length: 11))
        XCTAssertEqual(document.renderedRange(NSRange(location: 14, length: 0)), NSRange(location: 10, length: 0))
        XCTAssertEqual(document.renderedRange(NSRange(location: 4, length: 0)), NSRange(location: 3, length: 0))
        XCTAssertEqual(document.renderedRange(NSRange(location: 5, length: 0)), NSRange(location: 4, length: 0))
    }

    func testDeletingOrCopyingAChipUsesItsWholeCanonicalMention() {
        let text = "Use $cp here"
        let document = ComposerChipText(text: text, suggestions: skills)
        let selection = document.canonicalRange(NSRange(location: 4, length: 1))
        XCTAssertEqual((text as NSString).substring(with: selection), "$cp")
        XCTAssertEqual((text as NSString).replacingCharacters(in: selection, with: ""), "Use  here")
        XCTAssertEqual(document.canonicalRange(NSRange(location: 0, length: document.renderedLength)), NSRange(location: 0, length: text.utf16.count))
    }
}
